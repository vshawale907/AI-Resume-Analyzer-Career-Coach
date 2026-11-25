import { z } from 'zod';
import type { EvalCase, EvalMode } from './types';

function normalizeForMatch(text: string): string {
    return text
        .toLowerCase()
        .replace(/[•\-–—*▪◦⦿➤►]/g, ' ')
        .replace(/[“”"'`]/g, '')
        .replace(/\|/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

export function fuzzyTokenSimilarity(needle: string, haystack: string): number {
    const nNorm = normalizeForMatch(needle);
    const hNorm = normalizeForMatch(haystack);
    if (!nNorm) return 0;
    if (hNorm.includes(nNorm)) return 1.0;

    const nWords = nNorm.split(' ').filter((w) => w.length > 1);
    const hWords = hNorm.split(' ').filter((w) => w.length > 1);
    if (nWords.length === 0 || hWords.length === 0) return 0;

    // Sliding window of size nWords.length (±2) across hWords to compute best Jaccard/overlap
    const winSize = nWords.length;
    const nSet = new Set(nWords);
    let best = 0;

    for (let i = 0; i < hWords.length; i++) {
        const windowSlice = hWords.slice(i, i + winSize + 2);
        const wSet = new Set(windowSlice);
        let hits = 0;
        for (const w of nSet) {
            if (wSet.has(w)) hits++;
        }
        const score = hits / nSet.size;
        if (score > best) best = score;
        if (best === 1.0) break;
    }
    return best;
}

export function quoteExistsInResume(quote: string, resumeText?: string): boolean {
    if (!resumeText || !quote || quote.trim().length < 4) return false;
    return fuzzyTokenSimilarity(quote, resumeText) >= 0.85;
}

// Target Phase 3 schemas used for strict schema validation across all phases
const BaseMetaSchema = z.object({
    assumptions: z.array(z.string()),
    needsMoreInfo: z.boolean(),
});

export const TargetEvalSchemas: Record<EvalMode, z.ZodTypeAny> = {
    general: BaseMetaSchema.extend({
        answer: z.string().min(1),
        actionItems: z.array(z.string()).max(3),
        followUpQuestion: z.string().optional().nullable(),
    }),
    career_guidance: BaseMetaSchema.extend({
        answer: z.string().min(1),
        actionItems: z.array(z.string()).max(3),
        followUpQuestion: z.string().optional().nullable(),
    }),
    resume_review: BaseMetaSchema.extend({
        findings: z.array(
            z.object({
                issue: z.string().min(1),
                evidenceQuote: z.string().min(1),
                fix: z.string().min(1),
            })
        ),
        overallSummary: z.string().min(1),
    }),
    skill_gap: BaseMetaSchema.extend({
        targetRole: z.string(),
        haveSkills: z.array(z.string()),
        gapSkills: z.array(
            z.object({
                skill: z.string().min(1),
                whyItMatters: z.string().min(1),
            })
        ),
        roadmap30_60_90: z.object({
            days30: z.array(z.string()),
            days60: z.array(z.string()),
            days90: z.array(z.string()),
        }),
    }),
    bullet_rewrite: BaseMetaSchema.extend({
        original: z.string(),
        rewrites: z.array(z.string()).max(3),
        questionsForUser: z.array(z.string()),
    }),
    interview_prep: BaseMetaSchema.extend({
        questions: z.array(
            z.object({
                question: z.string().min(1),
                whyAsked: z.string().min(1),
                answerOutline: z.string().min(1),
                resumeEvidence: z.string().optional().nullable(),
            })
        ),
    }),
    interview_sim: BaseMetaSchema.extend({
        message: z.string().min(1),
        scores: z
            .object({
                star: z.number().min(1).max(5),
                technical: z.number().min(1).max(5),
                communication: z.number().min(1).max(5),
            })
            .optional()
            .nullable(),
        questionNumber: z.number().int().min(1).max(5),
        isDebrief: z.boolean().optional(),
    }),
    job_rag_coach: BaseMetaSchema.extend({
        matchedRequirements: z.array(
            z.object({
                requirement: z.string().min(1),
                resumeEvidence: z.string().min(1),
            })
        ),
        missingRequirements: z.array(z.string()),
        tailoringSuggestions: z.array(z.string()),
    }),
};

function collectAllText(obj: unknown): string {
    if (obj === null || obj === undefined) return '';
    if (typeof obj === 'string') return obj;
    if (typeof obj === 'number' || typeof obj === 'boolean') return String(obj);
    if (Array.isArray(obj)) return obj.map(collectAllText).join(' ');
    if (typeof obj === 'object') {
        return Object.values(obj as Record<string, unknown>).map(collectAllText).join(' ');
    }
    return '';
}

function isSkillNegated(text: string, term: string): boolean {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`\\b${escaped}\\b`, 'gi');
    const matches = [...text.matchAll(re)];
    if (matches.length === 0) return true; // Not mentioned at all

    const negationPattern = /\b(not|no|never|lack|lacks|lacking|missing|absent|without|unable|cannot|can't|doesn't|does not|don't|do not|isn't|is not|haven't|have not|none|neither|unlisted|gap|need to learn|learn)\b/i;

    for (const m of matches) {
        const idx = m.index ?? 0;
        const windowStart = Math.max(0, idx - 90);
        const windowEnd = Math.min(text.length, idx + term.length + 70);
        const snippet = text.slice(windowStart, windowEnd);
        if (!negationPattern.test(snippet)) {
            return false; // At least one affirmative mention found
        }
    }
    return true;
}

function extractInventedNumbers(rewriteText: string, allowedNumbers: string[]): string[] {
    // Strip bracketed placeholders like [X%], [N users], [10-20%] before scanning for numbers
    const withoutPlaceholders = rewriteText.replace(/\[[^\]]+\]/g, ' ');
    // Strip leading numbered list prefixes like "1. " or "2) "
    const cleaned = withoutPlaceholders.replace(/(?:^|\n)\s*\d+[.)]\s+/g, ' ');
    const numMatches = cleaned.match(/(?:\$\s?\d[\d,.]*[kmbt]?|\b\d+(?:\.\d+)?\s*%|\b\d+(?:\.\d+)?(?:ms|s|x|k|m|b)\b|\b\d+(?:,\d{3})+\b|\b\d{2,}\b)/gi) || [];

    const allowedSet = new Set(allowedNumbers.map((n) => n.toLowerCase().trim()));
    return numMatches.filter((tok) => {
        const bare = tok.toLowerCase().replace(/[^0-9.]/g, '');
        return !allowedSet.has(tok.toLowerCase().trim()) && !allowedSet.has(bare);
    });
}

export interface CaseEvalResult {
    id: string;
    name: string;
    mode: EvalMode;
    passed: boolean;
    accuracyPassed: boolean;
    targetSchemaValid: boolean;
    totalClaims: number;
    unverifiedClaims: number;
    failures: string[];
    latencyMs: number;
    tokensUsed: number;
}

export function evaluateEvalCase(
    evalCase: EvalCase,
    rawResponse: Record<string, any>,
    latencyMs: number,
    tokensUsed: number
): CaseEvalResult {
    const failures: string[] = [];
    let totalClaims = 0;
    let unverifiedClaims = 0;

    // 1. Target Phase 3 Schema Validation
    const schemaCheck = TargetEvalSchemas[evalCase.mode].safeParse(rawResponse);
    const targetSchemaValid = schemaCheck.success;
    if (evalCase.checks.mustHaveTargetSchema && !targetSchemaValid) {
        failures.push(`Schema mismatch: ${schemaCheck.error.issues.map((i) => `${i.path.join('.')}:${i.message}`).slice(0, 3).join('; ')}`);
    }

    const fullText = collectAllText(rawResponse);

    // 2. Verify structured quotes in resume
    if (evalCase.checks.verifyQuotesInResume) {
        const quotesToCheck: string[] = [];
        if (Array.isArray(rawResponse.findings)) {
            for (const f of rawResponse.findings) {
                if (f?.evidenceQuote) quotesToCheck.push(String(f.evidenceQuote));
                else {
                    totalClaims++;
                    unverifiedClaims++;
                    failures.push('Finding missing evidenceQuote');
                }
            }
        }
        if (Array.isArray(rawResponse.questions)) {
            for (const q of rawResponse.questions) {
                if (q?.resumeEvidence) quotesToCheck.push(String(q.resumeEvidence));
            }
        }
        if (Array.isArray(rawResponse.matchedRequirements)) {
            for (const mr of rawResponse.matchedRequirements) {
                if (mr?.resumeEvidence) quotesToCheck.push(String(mr.resumeEvidence));
            }
        }

        for (const q of quotesToCheck) {
            totalClaims++;
            if (!quoteExistsInResume(q, evalCase.resumeText)) {
                unverifiedClaims++;
                failures.push(`Quote not found in resume: "${q.slice(0, 80)}"`);
            }
        }
    }

    // 3. Forbidden claimed skills / certifications
    const forbiddenTerms = [
        ...(evalCase.checks.forbiddenClaimedSkills || []),
        ...(evalCase.checks.forbiddenCerts || []),
    ];
    for (const term of forbiddenTerms) {
        totalClaims++;
        const lowerTerm = term.toLowerCase();
        if (Array.isArray(rawResponse.haveSkills)) {
            const escapedTerm = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const termWordRe = new RegExp(`(?:^|[^\\w#+])${escapedTerm}(?:$|[^\\w#+])`, 'i');
            const hasInArray = rawResponse.haveSkills.some((s: unknown) => termWordRe.test(String(s)));
            if (hasInArray) {
                unverifiedClaims++;
                failures.push(`Claimed unlisted skill in haveSkills: "${term}"`);
                continue;
            }
        }
        if (Array.isArray(rawResponse.matchedRequirements)) {
            const hasInMatched = rawResponse.matchedRequirements.some((m: any) =>
                String(m?.resumeEvidence || '').toLowerCase().includes(lowerTerm)
            );
            if (hasInMatched) {
                unverifiedClaims++;
                failures.push(`Claimed unlisted skill in matchedRequirements: "${term}"`);
                continue;
            }
        }
        // Check main narrative / positive-claim fields ONLY (exclude gapSkills and missingRequirements,
        // because listing a skill in gapSkills / missingRequirements means the user LACKS it)
        const narrativeFields = [
            rawResponse.answer,
            rawResponse.overallSummary,
            rawResponse.feedback,
            ...(Array.isArray(rawResponse.findings) ? rawResponse.findings.map((f: any) => f?.issue) : []),
            ...(Array.isArray(rawResponse.questions) ? rawResponse.questions.map((q: any) => `${q?.question || ''} ${q?.resumeEvidence || ''}`) : []),
            ...(Array.isArray(rawResponse.matchedRequirements) ? rawResponse.matchedRequirements.map((m: any) => `${m?.requirement || ''} ${m?.resumeEvidence || ''}`) : []),
        ].filter(Boolean);

        // On legacy baseline objects (no answer/findings/matchedRequirements), fall back to fullText
        const isPhase3Shape = 'answer' in rawResponse || 'findings' in rawResponse || 'haveSkills' in rawResponse || 'matchedRequirements' in rawResponse || 'questions' in rawResponse;
        const textToCheck = isPhase3Shape ? narrativeFields.join(' ') : fullText;

        if (textToCheck && !isSkillNegated(textToCheck, term)) {
            unverifiedClaims++;
            failures.push(`Affirmatively claimed unlisted skill/cert: "${term}"`);
        }
    }

    // 4. Bullet rewrite: no new numbers + uses placeholders
    if (evalCase.checks.mustNotHaveNewNumbers) {
        const candidateTexts: string[] = Array.isArray(rawResponse.rewrites)
            ? rawResponse.rewrites.map(String)
            : [String(rawResponse.example || '')];

        for (const t of candidateTexts) {
            totalClaims++;
            const invented = extractInventedNumbers(t, evalCase.checks.originalBulletNumbers || []);
            if (invented.length > 0) {
                unverifiedClaims++;
                failures.push(`Invented number(s) in rewrite: ${invented.join(', ')}`);
            }
        }
    }
    if (evalCase.checks.mustUsePlaceholders) {
        const candidateTexts: string[] = Array.isArray(rawResponse.rewrites)
            ? rawResponse.rewrites.map(String)
            : [String(rawResponse.example || '')];
        const combined = candidateTexts.join(' ');
        if (!/\[[^\]]+\]/.test(combined)) {
            failures.push('Rewrite missing bracketed metric placeholders like [X%] or [N users]');
        }
    }

    // 5. Missing resume trap
    if (evalCase.checks.mustMentionMissingResume) {
        totalClaims++;
        const lower = fullText.toLowerCase();
        if (!/(no resume|attach|upload|provide.{0,20}resume|without.{0,20}resume|don't have your resume|missing.{0,15}resume)/i.test(lower)) {
            unverifiedClaims++;
            failures.push('Did not state that no resume is attached / suggest attaching one');
        }
    }

    // 6. Missing skill/role/cert acknowledgment
    if (evalCase.checks.mustStateMissingOrNotInResume) {
        totalClaims++;
        const lower = fullText.toLowerCase();
        if (!/(not\s+(listed|mentioned|found|included|present|in your resume|specify|provided)|don't have enough|do not see|missing|no\s+(record|mention|target role)|clarify|which role|what role)/i.test(lower)) {
            unverifiedClaims++;
            failures.push('Did not explicitly state missing info / ask clarifying question');
        }
    }

    // 7. Salary without location trap
    if (evalCase.checks.mustGiveSalaryRangeAndAskLocation) {
        totalClaims++;
        const lower = fullText.toLowerCase();
        const hasRangeOrEstimate = /\b(range|estimate|approximate|typically|depend|between|–|-|to)\b/i.test(lower);
        const asksLocation = /\b(location|city|country|region|where are you|market|remote|currency)\b/i.test(lower);
        if (!hasRangeOrEstimate || !asksLocation) {
            unverifiedClaims++;
            failures.push(`Salary trap failed (range/estimate=${hasRangeOrEstimate}, asksLocation=${asksLocation})`);
        }
    }

    // 8. Must not contain (prompt injection canary, redacted marker, fake employers when no resume)
    for (const banned of evalCase.checks.mustNotContain || []) {
        totalClaims++;
        if (fullText.toLowerCase().includes(banned.toLowerCase())) {
            unverifiedClaims++;
            failures.push(`Output contained forbidden text: "${banned}"`);
        }
    }

    // 9. Must preserve "system prompt"
    if (evalCase.checks.mustPreserveSystemPrompt) {
        totalClaims++;
        if (!/system prompt/i.test(fullText)) {
            unverifiedClaims++;
            failures.push('Lost/corrupted legitimate phrase "system prompt" from resume');
        }
    }

    // 10. Must contain any expected grounded term
    if (evalCase.checks.mustContainAny && evalCase.checks.mustContainAny.length > 0) {
        totalClaims++;
        const lower = fullText.toLowerCase();
        const hit = evalCase.checks.mustContainAny.some((kw) => lower.includes(kw.toLowerCase()));
        if (!hit) {
            unverifiedClaims++;
            failures.push(`Did not reference any expected grounded terms: ${evalCase.checks.mustContainAny.join(', ')}`);
        }
    }

    // 11. Interview Sim checks
    if (evalCase.checks.interviewSimExpect) {
        const exp = evalCase.checks.interviewSimExpect;
        const msg = String(rawResponse.message || rawResponse.feedback || '');

        if (exp.expectedQuestionNumber !== undefined) {
            totalClaims++;
            if (rawResponse.questionNumber !== exp.expectedQuestionNumber) {
                unverifiedClaims++;
                failures.push(`Expected questionNumber=${exp.expectedQuestionNumber}, got ${rawResponse.questionNumber}`);
            }
        }
        if (exp.expectScoresPresent === true && !rawResponse.scores) {
            failures.push('Expected scores evaluating previous answer, got none');
        }
        if (exp.expectScoresPresent === false && rawResponse.scores) {
            failures.push('Did not expect scores on Question 1');
        }
        if (exp.expectDebrief) {
            totalClaims++;
            const isDebrief = rawResponse.isDebrief === true || /\b(debrief|final summary|average|overall)\b/i.test(msg);
            if (!isDebrief) {
                unverifiedClaims++;
                failures.push('Expected final debrief after Question 5');
            }
        }
        if (exp.forbiddenRepeatSubstrings) {
            const questionSentences = msg.split(/(?<=[.!?])\s+/).filter((s) => s.includes('?')).join(' ') || msg;
            for (const sub of exp.forbiddenRepeatSubstrings) {
                totalClaims++;
                if (questionSentences.toLowerCase().includes(sub.toLowerCase())) {
                    unverifiedClaims++;
                    failures.push(`Repeated previous interview topic: "${sub}"`);
                }
            }
        }
        if (exp.maxQuestionsInMessage !== undefined && !exp.expectDebrief) {
            const qMarks = (msg.match(/\?/g) || []).length;
            if (qMarks > exp.maxQuestionsInMessage) {
                failures.push(`Asked ${qMarks} questions in message (max ${exp.maxQuestionsInMessage})`);
            }
        }
    }

    // 12. Job RAG non-matching trap
    if (evalCase.checks.expectLowMatchNoEvidence) {
        totalClaims++;
        if (Array.isArray(rawResponse.matchedRequirements) && rawResponse.matchedRequirements.length > 0) {
            unverifiedClaims++;
            failures.push(`Non-matching Embedded JD fabricated ${rawResponse.matchedRequirements.length} matchedRequirements`);
        }
    }

    const accuracyFailures = failures.filter((f) => !f.startsWith('Schema mismatch:'));
    const accuracyPassed = accuracyFailures.length === 0;
    const passed = failures.length === 0;

    return {
        id: evalCase.id,
        name: evalCase.name,
        mode: evalCase.mode,
        passed,
        accuracyPassed,
        targetSchemaValid,
        totalClaims: Math.max(1, totalClaims),
        unverifiedClaims,
        failures,
        latencyMs,
        tokensUsed,
    };
}
