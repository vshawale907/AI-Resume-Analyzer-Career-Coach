import type { NLPAnalysisResult } from '../../src/services/nlp.client';

export type EvalMode =
    | 'general'
    | 'resume_review'
    | 'skill_gap'
    | 'interview_prep'
    | 'career_guidance'
    | 'bullet_rewrite'
    | 'interview_sim'
    | 'job_rag_coach';

export interface EvalCase {
    id: string;
    name: string;
    mode: EvalMode;
    userMessage: string;
    resumeAttached: boolean;
    resumeText?: string;
    nlpData?: NLPAnalysisResult;
    bulletText?: string;
    targetRole?: string;
    jobPosting?: string;
    history?: Array<{ role: 'user' | 'assistant'; content: string }>;
    interviewState?: {
        questionNumber: number;
        scores: Array<{ questionNumber: number; star: number; technical: number; communication: number }>;
        askedQuestions: string[];
        completed: boolean;
    };
    checks: {
        verifyQuotesInResume?: boolean;
        forbiddenClaimedSkills?: string[];
        forbiddenCerts?: string[];
        mustNotHaveNewNumbers?: boolean;
        originalBulletNumbers?: string[];
        mustUsePlaceholders?: boolean;
        mustStateMissingOrNotInResume?: boolean;
        mustMentionMissingResume?: boolean;
        mustGiveSalaryRangeAndAskLocation?: boolean;
        mustNotContain?: string[];
        mustContainAny?: string[];
        mustPreserveSystemPrompt?: boolean;
        mustHaveTargetSchema?: boolean;
        interviewSimExpect?: {
            expectedQuestionNumber?: number;
            expectScoresPresent?: boolean;
            expectDebrief?: boolean;
            forbiddenRepeatSubstrings?: string[];
            maxQuestionsInMessage?: number;
        };
        expectLowMatchNoEvidence?: boolean;
    };
}
