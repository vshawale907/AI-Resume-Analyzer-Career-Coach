import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate, AuthRequest } from '../middleware/auth.middleware';
import { rateLimiter } from '../middleware/rateLimiter';
import { ChatSessionModel } from '../models/ChatSession.model';
import { AnalysisModel } from '../models/Analysis.model';
import { ResumeModel } from '../models/Resume.model';
import { runCoachTurn, summarizeOlderChatMessages, CoachingMode } from '../services/openai.service';
import { nlpClient } from '../services/nlp.client';
import { computeDeterministicJobMatch } from '../utils/resumeParser';
import { NotFoundError } from '../middleware/errorHandler';

const VALID_MODES = ['general', 'resume_review', 'skill_gap', 'interview_prep', 'career_guidance', 'bullet_rewrite', 'interview_sim', 'job_rag_coach'] as const;

const router = Router();
router.use(authenticate);

// POST /api/v1/chat/sessions - create new session
router.post('/sessions', async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const { resumeId, title } = z.object({
            resumeId: z.string().nullable().optional(),
            title: z.string().optional(),
        }).parse(req.body);
        const cleanResumeId = resumeId && resumeId.trim().length > 0 ? resumeId.trim() : undefined;
        const session = await ChatSessionModel.create({
            user: req.user!.id,
            resume: cleanResumeId,
            title: title || 'Resume Coach Session',
            messages: [],
        });
        res.success({ session }, 'Chat session created', 201);
    } catch (err) { next(err); }
});

// GET /api/v1/chat/sessions - list user's sessions
router.get('/sessions', async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const sessions = await ChatSessionModel.find({ user: req.user!.id })
            .sort({ updatedAt: -1 }).limit(20).select('-messages').lean();
        res.success({ sessions });
    } catch (err) { next(err); }
});

// GET /api/v1/chat/sessions/:id - get single session with messages & linked resume
router.get('/sessions/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const session = await ChatSessionModel.findOne({ _id: req.params.id, user: req.user!.id }).lean();
        if (!session) throw new NotFoundError('Chat session');
        res.success({ session });
    } catch (err) { next(err); }
});

// PATCH /api/v1/chat/sessions/:id - attach/switch resume and/or switch active mode (without requiring a message)
router.patch('/sessions/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const { resumeId, mode } = z.object({
            resumeId: z.string().nullable().optional(),
            mode: z.enum(VALID_MODES).optional(),
        }).parse(req.body);

        const session = await ChatSessionModel.findOne({ _id: req.params.id, user: req.user!.id });
        if (!session) throw new NotFoundError('Chat session');

        if (resumeId !== undefined) {
            if (resumeId) {
                const resume = await ResumeModel.findOne({ _id: resumeId, user: req.user!.id }).select('_id').lean();
                if (!resume) throw new NotFoundError('Resume');
                session.resume = resume._id;
            } else {
                session.resume = undefined;
            }
        }
        if (mode !== undefined) {
            session.activeMode = mode;
        }
        await session.save();

        res.success({
            session: {
                _id: session._id,
                resume: session.resume ?? null,
                activeMode: session.activeMode ?? 'general',
                interviewState: session.interviewState,
                title: session.title,
            },
        });
    } catch (err) { next(err); }
});

// POST /api/v1/chat/sessions/:id/message - send a message (supports structured coaching modes)
router.post('/sessions/:id/message', rateLimiter.chat, async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const { message, mode: requestedMode, bulletText, targetRole, jobPosting, resumeId } = z.object({
            message: z.string().min(1).max(4000),
            mode: z.enum(VALID_MODES).optional(),
            bulletText: z.string().max(500).optional(),
            targetRole: z.string().max(200).optional(),
            jobPosting: z.string().max(10000).optional(),
            resumeId: z.string().nullable().optional(),
        }).parse(req.body);

        const session = await ChatSessionModel.findOne({ _id: req.params.id, user: req.user!.id });
        if (!session) throw new NotFoundError('Chat session');

        const mode = (requestedMode ?? session.activeMode ?? 'general') as CoachingMode;
        session.activeMode = mode;

        // Sync session resume if explicitly passed in this message request
        if (resumeId !== undefined) {
            if (resumeId) {
                const ownedResume = await ResumeModel.findOne({ _id: resumeId, user: req.user!.id }).select('_id').lean();
                if (ownedResume) session.resume = ownedResume._id;
            } else {
                session.resume = undefined;
            }
        }

        // Fetch resume context + latest NLP analysis belonging strictly to THIS resume
        let resumeText: string | undefined;
        let nlpData;
        let analysisStatus: 'ready' | 'missing' | 'stale' | 'none' = 'none';
        let analysisJobDescriptionText: string | undefined;

        if (session.resume) {
            const [resume, analysis] = await Promise.all([
                ResumeModel.findOne({ _id: session.resume, user: req.user!.id }).select('cleanedText rawText updatedAt').lean(),
                AnalysisModel.findOne({ resume: session.resume, user: req.user!.id, isLatest: true }).lean(),
            ]);
            if (resume) {
                resumeText = resume.cleanedText || resume.rawText || undefined;
                if (analysis && String(analysis.resume) === String(session.resume) && analysis.nlpResult) {
                    nlpData = analysis.nlpResult;
                    analysisJobDescriptionText = analysis.jobDescriptionText;
                    const resumeUpdated = resume.updatedAt ? new Date(resume.updatedAt).getTime() : 0;
                    const analysisUpdated = analysis.updatedAt ? new Date(analysis.updatedAt).getTime() : 0;
                    analysisStatus = analysisUpdated >= resumeUpdated ? 'ready' : 'stale';
                } else {
                    analysisStatus = 'missing';
                }
            }
        }

        // For job_rag_coach with a fresh jobPosting, fetch deterministic NLP similarity & skill gaps
        if (mode === 'job_rag_coach' && resumeText && jobPosting && jobPosting.trim().length > 0 && analysisJobDescriptionText !== jobPosting) {
            try {
                const jdNlp = await nlpClient.analyzeResume({
                    resumeText,
                    jobDescriptionText: jobPosting,
                });
                nlpData = { ...(nlpData || {}), ...jdNlp };
            } catch {
                const fallbackMatch = computeDeterministicJobMatch(resumeText, jobPosting, nlpData?.extractedSkills);
                if (nlpData) {
                    nlpData = {
                        ...nlpData,
                        similarityScore: fallbackMatch.similarityScore,
                        matchedSkills: fallbackMatch.matchedSkills,
                        missingSkills: fallbackMatch.missingSkills,
                    };
                }
            }
        }

        // Add user message to history
        session.messages.push({ role: 'user', content: message, timestamp: new Date() });

        // Summarize older messages (>10) with one cheap LLM call and persist on session.summary
        const cutoff = Math.max(0, session.messages.length - 10);
        const alreadySummarized = session.summaryMessageCount ?? 0;
        let summaryTokens = 0;
        if (cutoff > alreadySummarized) {
            const toSummarize = session.messages.slice(alreadySummarized, cutoff).map((m) => ({
                role: m.role,
                content: m.content,
                structured: m.structured,
            }));
            const sumRes = await summarizeOlderChatMessages(toSummarize, session.summary);
            session.summary = sumRes.summary;
            session.summaryMessageCount = cutoff;
            summaryTokens = sumRes.tokensUsed;
        }

        // Last 10 messages verbatim (including full structured assistant data)
        const historyForAI = session.messages.slice(-10).map((m) => ({
            role: m.role,
            content: m.content,
            structured: m.structured,
        }));

        const result = await runCoachTurn({
            messages: historyForAI,
            conversationSummary: session.summary,
            mode,
            resumeId: session.resume ? String(session.resume) : undefined,
            resumeText,
            nlpData,
            analysisStatus,
            analysisJobDescriptionText,
            bulletText,
            targetRole,
            jobPosting,
            interviewState: mode === 'interview_sim' ? session.interviewState : undefined,
        });
        const structured = result.structured;
        const aiReply = result.reply;
        if (result.updatedInterviewState) {
            session.interviewState = result.updatedInterviewState;
        }

        // Add AI reply (full structured object + reply + metadata) to session messages
        session.messages.push({
            role: 'assistant',
            content: aiReply,
            structured: structured as unknown as Record<string, unknown>,
            metadata: result.meta as unknown as Record<string, unknown>,
            timestamp: new Date(),
        });
        session.totalTokensUsed = (session.totalTokensUsed || 0) + (result.meta.tokensUsed || 0) + summaryTokens;

        // Auto-title the session from first user message
        if (session.messages.length === 2) {
            session.title = message.slice(0, 60) + (message.length > 60 ? '…' : '');
        }
        await session.save();

        res.success({
            reply: aiReply,
            structured,
            meta: result.meta,
            interviewState: session.interviewState,
            sessionId: session._id,
            resumeId: session.resume ?? null,
            activeMode: session.activeMode ?? mode,
            hasResumeContext: Boolean(resumeText),
        });
    } catch (err) { next(err); }
});

// DELETE /api/v1/chat/sessions/:id
router.delete('/sessions/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        await ChatSessionModel.deleteOne({ _id: req.params.id, user: req.user!.id });
        res.success(null, 'Session deleted');
    } catch (err) { next(err); }
});

export default router;

