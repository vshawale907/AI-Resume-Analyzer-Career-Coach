import test from 'node:test';
import assert from 'node:assert/strict';
import {
    MODE_SCHEMAS,
    getSafeFallbackForMode,
    formatStructuredToReply,
    type CoachingMode,
} from '../../src/services/coachSchemas';
import {
    checkResumeSections,
    extractBulletLines,
    extractCertifications,
    truncateResumeBySections,
} from '../../src/utils/resumeParser';

const ALL_MODES: CoachingMode[] = [
    'general',
    'resume_review',
    'skill_gap',
    'interview_prep',
    'career_guidance',
    'bullet_rewrite',
    'interview_sim',
    'job_rag_coach',
];

test('getSafeFallbackForMode produces valid schema-compliant objects for every mode', () => {
    for (const mode of ALL_MODES) {
        const fb = getSafeFallbackForMode(mode);
        const parsed = MODE_SCHEMAS[mode].safeParse(fb);
        assert.equal(parsed.success, true, `Safe fallback failed schema for mode=${mode}`);
        assert.equal(typeof formatStructuredToReply(mode, fb), 'string');
    }
});

test('MODE_SCHEMAS allow empty arrays so the model is never forced to invent content', () => {
    assert.equal(
        MODE_SCHEMAS.resume_review.safeParse({
            findings: [],
            overallSummary: 'No resume attached.',
            assumptions: ['No resume provided'],
            needsMoreInfo: true,
        }).success,
        true
    );

    assert.equal(
        MODE_SCHEMAS.job_rag_coach.safeParse({
            matchedRequirements: [],
            missingRequirements: ['Embedded C++', 'AUTOSAR'],
            tailoringSuggestions: ['Not a fit for this embedded firmware role.'],
            assumptions: [],
            needsMoreInfo: false,
        }).success,
        true
    );

    assert.equal(
        MODE_SCHEMAS.skill_gap.safeParse({
            targetRole: '',
            haveSkills: [],
            gapSkills: [],
            roadmap30_60_90: ['Month 1: Build core project', 'Month 2: Practice system design', 'Month 3: Mock interviews'],
            assumptions: ['Missing target role'],
            needsMoreInfo: true,
        }).success,
        true
    );
});

test('MODE_SCHEMAS reject invalid bounds and malformed objects', () => {
    // actionItems max 3
    assert.equal(
        MODE_SCHEMAS.general.safeParse({
            answer: 'Hello',
            actionItems: ['1', '2', '3', '4'],
            assumptions: [],
            needsMoreInfo: false,
        }).success,
        false
    );

    // interview_sim score out of range (>5)
    assert.equal(
        MODE_SCHEMAS.interview_sim.safeParse({
            message: 'Great answer. Next question?',
            scores: { star: 6, technical: 4, communication: 4 },
            questionNumber: 2,
        }).success,
        false
    );

    // interview_sim questionNumber > 5
    assert.equal(
        MODE_SCHEMAS.interview_sim.safeParse({
            message: 'Question 6?',
            questionNumber: 6,
        }).success,
        false
    );

    // resume_review missing evidenceQuote
    assert.equal(
        MODE_SCHEMAS.resume_review.safeParse({
            findings: [{ issue: 'Weak verb', fix: 'Use stronger verb' }],
            overallSummary: 'Summary',
        }).success,
        false
    );
});

test('resumeParser extracts certifications, merged bullets, sections, and truncates by whole sections above 20k chars', () => {
    const sample = `Summary
Software engineer with 2 years experience in FastAPI and Python.

Experience
Backend Developer — Acme (Jan 2024 – Present)
•
Built webhook pipelines handling 50k requests/day
across multiple regions.
• Automated CI checks in GitHub Actions.

Certifications & Training
• AWS Certified Developer Associate (Credential ID: AWS-12345)
`;
    const sections = checkResumeSections(sample);
    const certSec = sections.find((s) => s.name === 'Certifications');
    assert.equal(certSec?.status, 'present');

    const bullets = extractBulletLines(sample);
    assert.equal(bullets.length, 3);
    assert.equal(bullets[0].includes('across multiple regions'), true);

    const certs = extractCertifications(sample);
    assert.ok(certs.some((c) => c.includes('AWS Certified Developer Associate')));

    const giantResume = `${sample}\n\nProjects\n${'A'.repeat(21000)}\n\nCertifications\n• Late Cert`;
    const truncated = truncateResumeBySections(giantResume, 20000);
    assert.equal(truncated.truncated, true);
    assert.ok(truncated.text.includes('[TRUNCATED:'));
    assert.ok(truncated.omittedSections.length >= 1);
});
