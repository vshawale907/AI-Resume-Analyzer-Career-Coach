import { z } from 'zod';

export type CoachingMode =
    | 'general'
    | 'resume_review'
    | 'skill_gap'
    | 'interview_prep'
    | 'career_guidance'
    | 'bullet_rewrite'
    | 'interview_sim'
    | 'job_rag_coach';

const BaseMetaFields = {
    assumptions: z.array(z.string()).default([]),
    needsMoreInfo: z.boolean().default(false),
};

export const GeneralCareerSchema = z.object({
    answer: z.string().min(1),
    actionItems: z.array(z.string()).max(3).default([]),
    followUpQuestion: z.string().nullable().optional(),
    ...BaseMetaFields,
});

export const ResumeReviewSchema = z.object({
    findings: z
        .array(
            z.object({
                issue: z.string().min(1),
                evidenceQuote: z.string().min(1),
                fix: z.string().min(1),
            })
        )
        .default([]),
    overallSummary: z.string().min(1),
    ...BaseMetaFields,
});

const RoadmapObjectSchema = z.object({
    days30: z.array(z.string()).default([]),
    days60: z.array(z.string()).default([]),
    days90: z.array(z.string()).default([]),
});

export const SkillGapSchema = z.object({
    targetRole: z.string().default(''),
    haveSkills: z.array(z.string()).default([]),
    gapSkills: z
        .array(
            z.object({
                skill: z.string().min(1),
                whyItMatters: z.string().min(1),
            })
        )
        .default([]),
    roadmap30_60_90: z.preprocess((val) => {
        if (Array.isArray(val)) {
            return {
                days30: val.slice(0, 1).map(String),
                days60: val.slice(1, 2).map(String),
                days90: val.slice(2, 3).map(String),
            };
        }
        if (val && typeof val === 'object') {
            const o = val as Record<string, unknown>;
            return {
                days30: Array.isArray(o.days30) ? o.days30.map(String) : Array.isArray(o['30_days']) ? (o['30_days'] as unknown[]).map(String) : [],
                days60: Array.isArray(o.days60) ? o.days60.map(String) : Array.isArray(o['60_days']) ? (o['60_days'] as unknown[]).map(String) : [],
                days90: Array.isArray(o.days90) ? o.days90.map(String) : Array.isArray(o['90_days']) ? (o['90_days'] as unknown[]).map(String) : [],
            };
        }
        return { days30: [], days60: [], days90: [] };
    }, RoadmapObjectSchema),
    ...BaseMetaFields,
});

export const BulletRewriteSchema = z.object({
    original: z.string().default(''),
    rewrites: z.array(z.string()).max(3).default([]),
    questionsForUser: z.array(z.string()).default([]),
    ...BaseMetaFields,
});

export const InterviewPrepSchema = z.object({
    questions: z
        .array(
            z.object({
                question: z.string().min(1),
                whyAsked: z.string().min(1),
                answerOutline: z.string().min(1),
                resumeEvidence: z.string().nullable().optional(),
            })
        )
        .default([]),
    ...BaseMetaFields,
});

export const InterviewSimSchema = z.object({
    message: z.string().min(1),
    scores: z
        .object({
            star: z.number().min(1).max(5),
            technical: z.number().min(1).max(5),
            communication: z.number().min(1).max(5),
        })
        .nullable()
        .optional(),
    questionNumber: z.number().int().min(1).max(5),
    isDebrief: z.boolean().optional().default(false),
    ...BaseMetaFields,
});

export const JobRagCoachSchema = z.object({
    matchedRequirements: z
        .array(
            z.object({
                requirement: z.string().min(1),
                resumeEvidence: z.string().min(1),
            })
        )
        .default([]),
    missingRequirements: z.array(z.string()).default([]),
    tailoringSuggestions: z.array(z.string()).default([]),
    similarityScore: z.number().min(0).max(100).optional(),
    nlpMatchedSkills: z.array(z.string()).optional(),
    nlpMissingSkills: z.array(z.string()).optional(),
    ...BaseMetaFields,
});

export const MODE_SCHEMAS: Record<CoachingMode, z.ZodTypeAny> = {
    general: GeneralCareerSchema,
    career_guidance: GeneralCareerSchema,
    resume_review: ResumeReviewSchema,
    skill_gap: SkillGapSchema,
    bullet_rewrite: BulletRewriteSchema,
    interview_prep: InterviewPrepSchema,
    interview_sim: InterviewSimSchema,
    job_rag_coach: JobRagCoachSchema,
};

export function getModeSchemaPrompt(mode: CoachingMode, opts?: { expectScores?: boolean; nextQuestionNumber?: number; forceDebrief?: boolean }): string {
    const header = `## MANDATORY JSON OUTPUT SCHEMA (mode: ${mode})
Return ONLY valid JSON matching this exact structure. Do not add markdown fences or extra text. Allow empty arrays ([]) when nothing applies — NEVER invent facts just to populate an array.\n\n`;

    switch (mode) {
        case 'general':
        case 'career_guidance':
            return header + `{
  "answer": "Direct, grounded response. State 'I don't have enough information about X' if key details (like location for salary or missing resume/skill) are missing.",
  "actionItems": ["0 to 3 concrete action items (empty [] if waiting for missing info)"],
  "followUpQuestion": "Optional specific clarifying question, or null",
  "assumptions": ["Explicit assumption(s) relied on"],
  "needsMoreInfo": false
}`;

        case 'resume_review':
            return header + `{
  "findings": [
    {
      "issue": "Specific weakness or improvement area",
      "evidenceQuote": "Exact short verbatim quote copied from <resume> proving this claim",
      "fix": "Actionable fix using [X%] placeholders if numbers are missing"
    }
  ],
  "overallSummary": "Concise grounded summary of the resume's real strengths and gaps (if no resume attached, findings MUST be [] and state that no resume is attached)",
  "assumptions": ["Explicit assumption(s)"],
  "needsMoreInfo": false
}`;

        case 'skill_gap':
            return header + `{
  "targetRole": "Target role evaluated (empty string if none specified)",
  "haveSkills": ["ONLY skills explicitly present in <resume_context> or <resume>"],
  "gapSkills": [
    { "skill": "Missing skill name", "whyItMatters": "Why this matters for targetRole" }
  ],
  "roadmap30_60_90": {
    "days30": ["0-30 day focused step(s)"],
    "days60": ["31-60 day focused step(s)"],
    "days90": ["61-90 day focused step(s)"]
  },
  "assumptions": ["Explicit assumption(s)"],
  "needsMoreInfo": false
}`;

        case 'bullet_rewrite':
            return header + `{
  "original": "The exact original bullet provided by the user",
  "rewrites": [
    "Rewrite variation 1 using XYZ formula and [X%]/[N users] placeholders for any missing metrics",
    "Rewrite variation 2",
    "Rewrite variation 3"
  ],
  "questionsForUser": ["Question asking the user for each real missing metric/number"],
  "assumptions": ["No unstated metrics were invented"],
  "needsMoreInfo": true
}`;

        case 'interview_prep':
            return header + `{
  "questions": [
    {
      "question": "Interview question anchored strictly to technologies/projects in <resume>",
      "whyAsked": "Why the interviewer asks this for the target role",
      "answerOutline": "Concrete STAR or step-by-step outline grounded in their resume",
      "resumeEvidence": "Short verbatim quote from <resume> (or null if no resume)"
    }
  ],
  "assumptions": ["Explicit assumption(s)"],
  "needsMoreInfo": false
}`;

        case 'interview_sim': {
            const qNum = opts?.nextQuestionNumber ?? 1;
            const evalHint = opts?.forceDebrief
                ? 'Evaluate the final answer in "scores", deliver the overall 5-question debrief inside "message", set "isDebrief": true, and do NOT ask a new interview question.'
                : opts?.expectScores
                    ? `Evaluate the user's previous answer in "scores" (1-5 each), briefly give feedback in "message", and ask ONLY ONE new question (Question #${qNum}, never repeating earlier questions). Set "questionNumber": ${qNum} and "isDebrief": false.`
                    : `Start Question #1 directly in "message" (ask ONLY ONE question). Set "scores": null, "questionNumber": ${qNum}, "isDebrief": false.`;

            return header + `{
  "message": "${evalHint}",
  "scores": ${opts?.expectScores || opts?.forceDebrief ? '{ "star": 4, "technical": 4, "communication": 4 }' : 'null'},
  "questionNumber": ${Math.min(5, Math.max(1, qNum))},
  "isDebrief": ${Boolean(opts?.forceDebrief)},
  "assumptions": ["Explicit assumption(s)"],
  "needsMoreInfo": false
}`;
        }

        case 'job_rag_coach':
            return header + `{
  "matchedRequirements": [
    {
      "requirement": "Requirement from <job_posting>",
      "resumeEvidence": "Exact short verbatim quote from <resume> (ONLY include if truly supported; return [] if low/no match)"
    }
  ],
  "missingRequirements": ["Requirements in <job_posting> absent from <resume>"],
  "tailoringSuggestions": ["Concrete ways to position existing real experience without fabricating"],
  "assumptions": ["Explicit assumption(s)"],
  "needsMoreInfo": false
}`;
    }
}

export function getSafeFallbackForMode(mode: CoachingMode, reason = 'Unable to format a complete response right now.'): Record<string, unknown> {
    const base = {
        assumptions: ['Fell back to safe default because structured generation failed validation.'],
        needsMoreInfo: true,
    };

    switch (mode) {
        case 'general':
        case 'career_guidance':
            return {
                answer: `${reason} Please try rephrasing or attach a resume for more specific guidance.`,
                actionItems: [],
                followUpQuestion: 'What specific goal or role would you like to focus on?',
                ...base,
            };
        case 'resume_review':
            return {
                findings: [],
                overallSummary: `${reason} Please re-run the review with your resume attached.`,
                ...base,
            };
        case 'skill_gap':
            return {
                targetRole: '',
                haveSkills: [],
                gapSkills: [],
                roadmap30_60_90: { days30: [], days60: [], days90: [] },
                ...base,
            };
        case 'bullet_rewrite':
            return {
                original: '',
                rewrites: [],
                questionsForUser: ['Could you paste the exact bullet point and share any real metrics (%, latency, users)?'],
                ...base,
            };
        case 'interview_prep':
            return {
                questions: [],
                ...base,
            };
        case 'interview_sim':
            return {
                message: 'Let us continue the mock interview. Could you clarify your last point or share an example from a project on your resume?',
                scores: null,
                questionNumber: 1,
                isDebrief: false,
                ...base,
            };
        case 'job_rag_coach':
            return {
                matchedRequirements: [],
                missingRequirements: [],
                tailoringSuggestions: [],
                ...base,
            };
    }
}

export function formatStructuredToReply(mode: CoachingMode, data: Record<string, any>): string {
    switch (mode) {
        case 'general':
        case 'career_guidance':
            return data.answer || 'Coaching response ready.';
        case 'resume_review':
            return data.overallSummary || `Found ${Array.isArray(data.findings) ? data.findings.length : 0} review items.`;
        case 'skill_gap':
            return data.targetRole
                ? `Skill gap analysis for ${data.targetRole}: ${data.haveSkills?.length ?? 0} matched skills, ${data.gapSkills?.length ?? 0} key gaps identified.`
                : 'Please provide a target role or job description to evaluate skill gaps.';
        case 'bullet_rewrite':
            return Array.isArray(data.rewrites) && data.rewrites.length > 0
                ? data.rewrites.map((r: string, i: number) => `${i + 1}. ${r}`).join('\n')
                : (data.questionsForUser?.[0] || 'Share a bullet point and real metrics to generate rewrites.');
        case 'interview_prep':
            return `Prepared ${Array.isArray(data.questions) ? data.questions.length : 0} tailored interview questions grounded in your resume.`;
        case 'interview_sim':
            return data.message || 'Ready for your next response.';
        case 'job_rag_coach':
            return `Matched ${data.matchedRequirements?.length ?? 0} job requirements; ${data.missingRequirements?.length ?? 0} gaps noted.`;
    }
}
