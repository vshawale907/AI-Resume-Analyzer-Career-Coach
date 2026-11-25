import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyResponse, isQuoteInResume, isSkillPresent, findAndReplaceInventedNumbers } from '../../src/services/coachVerifier';

const SAMPLE_RESUME = `
Arjun Mehta
Backend Engineer — FinPulse Systems
• Engineered idempotent webhook ingestion APIs in FastAPI and PostgreSQL processing 120,000 events/day at p95 latency of 45ms.
• Designed Redis + BullMQ retry workers for asynchronous PDF report generation, reducing timeout errors from 4.2% to 0.3%.
Skills: Python, TypeScript, Node.js, FastAPI, PostgreSQL, MongoDB, Redis, Docker, React
Projects: DocuQuery | Designed system prompt templates and strict SQL blocklist guardrails (29 blocked DDL/DML keywords).
Certifications: Meta Back-End Developer Professional Certificate (Coursera)
`;

test('isQuoteInResume supports exact and >=85% fuzzy whitespace/punctuation normalized matches', () => {
    assert.equal(isQuoteInResume('idempotent webhook ingestion APIs in FastAPI and PostgreSQL', SAMPLE_RESUME), true);
    assert.equal(isQuoteInResume('Designed Redis + BullMQ retry workers for async PDF report generation', SAMPLE_RESUME), true);
    assert.equal(isQuoteInResume('Built autonomous Kubernetes service mesh across 50 clusters', SAMPLE_RESUME), false);
    assert.equal(isQuoteInResume('Any quote at all', undefined), false);
});

test('verifyResponse drops hallucinated resume_review findings and records metadata warnings', () => {
    const res = verifyResponse(
        {
            findings: [
                {
                    issue: 'Weak verb usage',
                    evidenceQuote: 'Engineered idempotent webhook ingestion APIs in FastAPI and PostgreSQL',
                    fix: 'Solid verb; clarify error budget impact.',
                },
                {
                    issue: 'Fabricated Kubernetes claim',
                    evidenceQuote: 'Managed 200 Kubernetes microservices at Amazon',
                    fix: 'Add metrics.',
                },
            ],
            overallSummary: 'Strong Python/FastAPI backend profile.',
            assumptions: [],
            needsMoreInfo: false,
        },
        SAMPLE_RESUME,
        'resume_review'
    );

    assert.equal(res.response.findings.length, 1);
    assert.equal(res.response.findings[0].issue, 'Weak verb usage');
    assert.equal(res.verification.verified, false);
    assert.equal(res.verification.removedClaims, 1);
    assert.ok(res.verification.warnings.length >= 1);
});

test('verifyResponse strips hallucinated matchedRequirements in job_rag_coach', () => {
    const res = verifyResponse(
        {
            matchedRequirements: [
                {
                    requirement: 'FastAPI backend',
                    resumeEvidence: 'Engineered idempotent webhook ingestion APIs in FastAPI and PostgreSQL',
                },
                {
                    requirement: 'AUTOSAR automotive firmware',
                    resumeEvidence: 'Developed AUTOSAR drivers in Embedded C++',
                },
            ],
            missingRequirements: ['AUTOSAR', 'FreeRTOS'],
            tailoringSuggestions: [],
            assumptions: [],
            needsMoreInfo: false,
        },
        SAMPLE_RESUME,
        'job_rag_coach'
    );

    assert.equal(res.response.matchedRequirements.length, 1);
    assert.equal(res.verification.removedClaims, 1);
    assert.equal(res.verification.verified, false);
});

test('verifyResponse clears unverified resumeEvidence on interview_prep questions', () => {
    const res = verifyResponse(
        {
            questions: [
                {
                    question: 'How did you design Redis + BullMQ retries?',
                    whyAsked: 'Tests async reliability',
                    answerOutline: 'Discuss idempotency and dead-letter queues.',
                    resumeEvidence: 'Designed Redis + BullMQ retry workers for asynchronous PDF report generation',
                },
                {
                    question: 'Tell me about your Kubernetes ingress setup.',
                    whyAsked: 'Tests orchestration',
                    answerOutline: 'Describe ingress rules.',
                    resumeEvidence: 'Configured Nginx ingress across 12 Kubernetes clusters',
                },
            ],
            assumptions: [],
            needsMoreInfo: false,
        },
        SAMPLE_RESUME,
        'interview_prep'
    );

    assert.equal(res.response.questions[0].resumeEvidence?.includes('Redis + BullMQ'), true);
    assert.equal(res.response.questions[1].resumeEvidence, null);
    assert.equal(res.verification.removedClaims, 1);
});

test('isSkillPresent supports alias equivalence and avoids substring false matches (Go vs MongoDB)', () => {
    const extracted = ['python', 'nodejs', 'postgresql', 'mongodb', 'react', 'docker'];
    assert.equal(isSkillPresent('Node.js', SAMPLE_RESUME, extracted), true);
    assert.equal(isSkillPresent('Postgres', SAMPLE_RESUME, extracted), true);
    assert.equal(isSkillPresent('React.js', SAMPLE_RESUME, extracted), true);
    assert.equal(isSkillPresent('Go', SAMPLE_RESUME, extracted), false);
    assert.equal(isSkillPresent('Kubernetes', SAMPLE_RESUME, extracted), false);
});

test('verifyResponse drops unlisted skills from skill_gap.haveSkills', () => {
    const res = verifyResponse(
        {
            targetRole: 'Staff Backend Engineer',
            haveSkills: ['Python', 'Node.js', 'Go', 'Kubernetes', 'MongoDB'],
            gapSkills: [{ skill: 'Kubernetes', whyItMatters: 'Orchestration' }],
            roadmap30_60_90: { days30: [], days60: [], days90: [] },
            assumptions: [],
            needsMoreInfo: false,
        },
        SAMPLE_RESUME,
        'skill_gap',
        { extractedSkills: ['python', 'nodejs', 'mongodb', 'postgresql'] }
    );

    assert.deepEqual(res.response.haveSkills, ['Python', 'Node.js', 'MongoDB']);
    assert.equal(res.verification.removedClaims, 2);
});

test('verifyResponse detects and replaces invented numbers in bullet_rewrite while preserving allowed numbers and placeholders', () => {
    const original = 'Designed system prompt templates and strict SQL blocklist guardrails (29 blocked keywords).';
    const check = findAndReplaceInventedNumbers(
        'Engineered 29 SQL guardrails reducing errors by 45% across 10,000 users in [Xms].',
        original
    );
    assert.deepEqual(check.invented, ['45%', '10,000']);
    assert.equal(check.sanitized.includes('29'), true);
    assert.equal(check.sanitized.includes('[X%]'), true);
    assert.equal(check.sanitized.includes('[N]'), true);
    assert.equal(check.sanitized.includes('[Xms]'), true);

    const verified = verifyResponse(
        {
            original,
            rewrites: [
                'Architected 29 SQL validation rules cutting query latency to 12ms and improving accuracy by 35%.',
                'Engineered system prompt guardrails with 29 blocked keywords, reducing failures by [X%].',
            ],
            questionsForUser: [],
            assumptions: [],
            needsMoreInfo: false,
        },
        SAMPLE_RESUME,
        'bullet_rewrite',
        { originalBullet: original, userMessage: 'Rewrite this bullet.' }
    );

    assert.equal(verified.verification.verified, false);
    assert.deepEqual(verified.verification.inventedNumbersDetected, ['12ms', '35%']);
    assert.equal(verified.response.rewrites[0].includes('12ms'), false);
    assert.equal(verified.response.rewrites[0].includes('35%'), false);
    assert.equal(verified.response.rewrites[0].includes('29'), true);
    assert.ok(verified.response.questionsForUser.length > 0);
});
