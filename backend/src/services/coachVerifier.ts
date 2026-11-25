import type { CoachingMode } from './coachSchemas';

export interface VerificationMeta {
    verified: boolean;
    removedClaims: number;
    warnings: string[];
    inventedNumbersDetected: string[];
}

export interface VerificationResult<T = Record<string, any>> {
    response: T;
    verification: VerificationMeta;
}

const SKILL_EQUIVALENCE_GROUPS: string[][] = [
    ['node.js', 'nodejs', 'node js', 'node'],
    ['react', 'react.js', 'reactjs', 'react js'],
    ['next.js', 'nextjs', 'next js'],
    ['vue', 'vue.js', 'vuejs'],
    ['postgresql', 'postgres', 'psql'],
    ['kubernetes', 'k8s'],
    ['typescript', 'ts'],
    ['javascript', 'js'],
    ['mongodb', 'mongo'],
    ['scikit-learn', 'sklearn'],
    ['c#', 'csharp'],
    ['c++', 'cpp'],
    ['tailwindcss', 'tailwind css', 'tailwind'],
    ['express', 'express.js', 'expressjs'],
    ['ci/cd', 'cicd', 'ci cd'],
    ['rest api', 'rest', 'restful', 'rest apis', 'restful api'],
    ['websocket', 'websockets'],
    ['aws s3', 's3', 'amazon s3'],
    ['tensorflow', 'tf'],
    ['pytorch', 'torch'],
];

const CANONICAL_EQUIVALENTS: Record<string, string[]> = {};
for (const group of SKILL_EQUIVALENCE_GROUPS) {
    for (const term of group) {
        CANONICAL_EQUIVALENTS[term] = group.filter((other) => other !== term);
    }
}

const KNOWN_TECH_TERMS = [
    'python', 'javascript', 'typescript', 'java', 'c++', 'c#', 'go', 'golang', 'rust', 'ruby', 'php', 'swift', 'kotlin', 'scala',
    'react', 'angular', 'vue', 'svelte', 'next.js', 'nextjs', 'express', 'fastapi', 'django', 'flask', 'spring boot', 'nestjs',
    'postgresql', 'mongodb', 'mysql', 'redis', 'elasticsearch', 'sqlite', 'dynamodb', 'cassandra', 'qdrant', 'pinecone',
    'docker', 'kubernetes', 'k8s', 'terraform', 'ansible', 'aws', 'gcp', 'azure', 'github actions', 'jenkins',
    'kafka', 'rabbitmq', 'bullmq', 'celery', 'graphql', 'grpc', 'langchain', 'langgraph', 'spacy', 'pytorch', 'tensorflow',
    'pytest', 'vitest', 'jest', 'cypress', 'playwright', 'solidity', 'ethers.js', 'freertos', 'autosar', 'misra-c',
];

function normalizeText(text: string): string {
    return text
        .toLowerCase()
        .replace(/[•\-–—*▪◦⦿➤►]/g, ' ')
        .replace(/[“”"'`.,;:!?()[\]{}|]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

export function fuzzyMatchScore(needle: string, haystack: string): number {
    const n = normalizeText(needle);
    const h = normalizeText(haystack);
    if (!n || !h) return 0;
    if (h.includes(n)) return 1.0;

    const nWords = n.split(' ').filter((w) => w.length > 1);
    const hWords = h.split(' ').filter((w) => w.length > 1);
    if (nWords.length === 0 || hWords.length === 0) return 0;

    // Very short phrases must match all significant words cleanly
    const winSize = nWords.length + 2;
    const nSet = new Set(nWords);
    let best = 0;

    for (let i = 0; i < hWords.length; i++) {
        const windowSlice = hWords.slice(i, i + winSize);
        const wSet = new Set(windowSlice);
        let hits = 0;
        for (const w of nSet) {
            if (wSet.has(w)) hits++;
        }
        const ratio = hits / nSet.size;
        if (ratio > best) best = ratio;
        if (best === 1.0) break;
    }

    return best;
}

export function isQuoteInResume(quote: string, resumeText?: string): boolean {
    if (!resumeText || !quote || quote.trim().length < 4) return false;
    return fuzzyMatchScore(quote, resumeText) >= 0.85;
}

export function isSkillPresent(skill: string, resumeText?: string, extractedSkills: string[] = []): boolean {
    const sLower = skill.toLowerCase().trim();
    if (!sLower) return false;

    const candidates = [sLower, ...(CANONICAL_EQUIVALENTS[sLower] || [])];
    // Handle phrases like "AWS (S3)" -> check both full string and clean parts
    const cleanTokens = sLower
        .split(/[/(),]/)
        .map((t) => t.trim())
        .filter((t) => t.length >= 2);
    for (const t of cleanTokens) {
        if (!candidates.includes(t)) candidates.push(t);
    }

    const extractedLower = extractedSkills.map((e) => e.toLowerCase().trim());
    for (const cand of candidates) {
        const escapedCand = cand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const wordBoundRe = new RegExp(`(?:^|[^\\w#+])${escapedCand}(?:$|[^\\w#+])`, 'i');
        if (extractedLower.some((e) => e === cand || wordBoundRe.test(e))) {
            return true;
        }
    }

    if (resumeText) {
        const resLower = resumeText.toLowerCase();
        for (const cand of candidates) {
            const escaped = cand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            if (new RegExp(`(?:^|[^\\w#+])${escaped}(?:$|[^\\w#+])`, 'i').test(resLower)) {
                return true;
            }
        }
    }

    return false;
}

function extractNumericTokens(text: string): Array<{ raw: string; bare: string }> {
    const matches = text.match(/(?:\$\s?\d[\d,.]*[kmbt]?|\b\d+(?:\.\d+)?\s*%|\b\d+(?:\.\d+)?(?:ms|s|x|k|m|b)\b|\b\d+(?:,\d{3})+\b|\b\d+(?:\.\d+)?\b)/gi) || [];
    return matches.map((raw) => ({
        raw,
        bare: raw.toLowerCase().replace(/[^0-9.]/g, ''),
    }));
}

export function findAndReplaceInventedNumbers(
    rewrite: string,
    allowedText: string
): { sanitized: string; invented: string[] } {
    const allowedTokens = extractNumericTokens(allowedText);
    const allowedRaw = new Set(allowedTokens.map((t) => t.raw.toLowerCase().replace(/\s+/g, '')));
    const allowedBare = new Set(allowedTokens.map((t) => t.bare));

    // Preserve bracketed placeholders like [X%], [N users], [10-20%]
    const placeholders: string[] = [];
    const masked = rewrite.replace(/\[[^\]]+\]/g, (m) => {
        const token = `__PH_${placeholders.length}__`;
        placeholders.push(m);
        return token;
    });

    const invented: string[] = [];
    // Protect leading numbered list prefixes like "1. "
    const sanitizedMasked = masked.replace(
        /(?:\$\s?\d[\d,.]*[kmbt]?|\b\d+(?:\.\d+)?\s*%|\b\d+(?:\.\d+)?(?:ms|s|x|k|m|b)\b|\b\d+(?:,\d{3})+\b|\b\d+(?:\.\d+)?\b)/gi,
        (match, offset, fullStr) => {
            // Skip our __PH_n__ markers
            const before = fullStr.slice(Math.max(0, offset - 5), offset);
            if (before.endsWith('__PH_')) return match;
            // Skip single-digit bullet list prefix at start of line like "1. "
            const lineStart = fullStr.slice(Math.max(0, offset - 3), offset + match.length + 2);
            if (/^\s*\d[.)]\s/.test(lineStart)) return match;

            const normRaw = match.toLowerCase().replace(/\s+/g, '');
            const bare = match.toLowerCase().replace(/[^0-9.]/g, '');
            if (allowedRaw.has(normRaw) || allowedBare.has(bare)) {
                return match;
            }

            invented.push(match);
            if (match.includes('%')) return '[X%]';
            if (match.includes('$')) return '[$X]';
            if (/ms$/i.test(match)) return '[Xms]';
            if (/s$/i.test(match)) return '[X time]';
            if (/x$/i.test(match)) return '[Xx]';
            return '[N]';
        }
    );

    const restored = sanitizedMasked.replace(/__PH_(\d+)__/g, (_, idx) => placeholders[Number(idx)] ?? '');
    return { sanitized: restored, invented };
}

export function verifyResponse<T extends Record<string, any>>(
    response: T,
    resumeText: string | undefined,
    mode: CoachingMode,
    options?: {
        extractedSkills?: string[];
        originalBullet?: string;
        userMessage?: string;
    }
): VerificationResult<T> {
    const clone: Record<string, any> = JSON.parse(JSON.stringify(response || {}));
    const warnings: string[] = [];
    let removedClaims = 0;
    const inventedNumbersDetected: string[] = [];
    const extractedSkills = options?.extractedSkills || [];

    // 1. Verify quotes for resume_review
    if (mode === 'resume_review' && Array.isArray(clone.findings)) {
        const kept: any[] = [];
        for (const f of clone.findings) {
            if (!resumeText || !f?.evidenceQuote || !isQuoteInResume(String(f.evidenceQuote), resumeText)) {
                removedClaims++;
                warnings.push(`Dropped unverified finding quote: "${String(f?.evidenceQuote || '').slice(0, 60)}"`);
            } else {
                kept.push(f);
            }
        }
        clone.findings = kept;
    }

    // 2. Verify quotes for job_rag_coach
    if (mode === 'job_rag_coach' && Array.isArray(clone.matchedRequirements)) {
        const kept: any[] = [];
        for (const req of clone.matchedRequirements) {
            if (!resumeText || !req?.resumeEvidence || !isQuoteInResume(String(req.resumeEvidence), resumeText)) {
                removedClaims++;
                warnings.push(`Dropped unverified matched requirement quote: "${String(req?.resumeEvidence || '').slice(0, 60)}"`);
            } else {
                kept.push(req);
            }
        }
        clone.matchedRequirements = kept;
    }

    // 3. Verify resumeEvidence on interview_prep questions
    if (mode === 'interview_prep' && Array.isArray(clone.questions)) {
        clone.questions = clone.questions.map((q: any) => {
            if (q?.resumeEvidence && (!resumeText || !isQuoteInResume(String(q.resumeEvidence), resumeText))) {
                removedClaims++;
                warnings.push(`Cleared unverified resumeEvidence on interview question: "${String(q.resumeEvidence).slice(0, 60)}"`);
                return { ...q, resumeEvidence: null };
            }
            return q;
        });
    }

    // 4. Verify skill_gap.haveSkills against extractedSkills + resumeText
    if (mode === 'skill_gap' && Array.isArray(clone.haveSkills)) {
        const keptSkills: string[] = [];
        for (const skill of clone.haveSkills) {
            const s = String(skill || '').trim();
            if (!s) continue;
            if (!resumeText || !isSkillPresent(s, resumeText, extractedSkills)) {
                removedClaims++;
                warnings.push(`Removed unlisted skill from haveSkills: "${s}"`);
            } else {
                keptSkills.push(s);
            }
        }
        clone.haveSkills = keptSkills;
    }

    // 5. Verify bullet_rewrite numbers against original bullet + user message
    if (mode === 'bullet_rewrite' && Array.isArray(clone.rewrites)) {
        const allowedSource = `${options?.originalBullet || clone.original || ''} ${options?.userMessage || ''} ${resumeText || ''}`;
        // For strict bullet metric check, primarily compare against originalBullet + userMessage
        const strictAllowedSource = `${options?.originalBullet || clone.original || ''} ${options?.userMessage || ''}`;

        clone.rewrites = clone.rewrites.map((rw: string) => {
            const { sanitized, invented } = findAndReplaceInventedNumbers(String(rw), strictAllowedSource);
            if (invented.length > 0) {
                // Double-check if the number wasn't explicitly in original bullet/userMessage
                inventedNumbersDetected.push(...invented);
                removedClaims += invented.length;
                warnings.push(`Replaced unverified metric(s) in bullet rewrite: ${invented.join(', ')}`);
            }
            return sanitized;
        });

        // If allowed source was empty in tests where user passed only original in resume, keep fallback check clean
        void allowedSource;

        if (inventedNumbersDetected.length > 0) {
            const qList = Array.isArray(clone.questionsForUser) ? clone.questionsForUser : [];
            if (qList.length === 0) {
                clone.questionsForUser = ['What exact numbers, percentages, or scale metrics did you achieve for this bullet?'];
            }
        }
    }

    // 6. Affirmative unlisted skill claim detector across narrative text
    const narrativeText = [clone.answer, clone.overallSummary, clone.message].filter(Boolean).join(' ');
    if (resumeText && narrativeText) {
        const claimRe = /\b(?:your\s+(?:production\s+|strong\s+|solid\s+|extensive\s+)?experience\s+(?:with|in)|you\s+(?:already\s+)?have\s+(?:experience\s+(?:with|in)\s+|strong\s+|solid\s+)?|listed\s+on\s+your\s+resume[^.!?]*?\b|you\s+hold\s+(?:the\s+)?|your\s+proficiency\s+(?:in|with))\s+([^.!?\n]{1,80})/gi;
        let m: RegExpExecArray | null;
        while ((m = claimRe.exec(narrativeText)) !== null) {
            const clause = m[1];
            for (const term of KNOWN_TECH_TERMS) {
                const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                if (new RegExp(`(?:^|[^\\w#+])${escaped}(?:$|[^\\w#+])`, 'i').test(clause)) {
                    if (!isSkillPresent(term, resumeText, extractedSkills)) {
                        warnings.push(`Flagged possible unverified skill claim in text: "${term}"`);
                    }
                }
            }
        }
    }

    return {
        response: clone as T,
        verification: {
            verified: warnings.length === 0,
            removedClaims,
            warnings,
            inventedNumbersDetected,
        },
    };
}
