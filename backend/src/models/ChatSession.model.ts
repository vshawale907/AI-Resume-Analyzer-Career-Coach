import mongoose, { Schema, Document, Model } from 'mongoose';

import type { CoachingMode } from '../services/coachSchemas';

export interface IChatMessage {
    role: 'user' | 'assistant';
    content: string;
    structured?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
    timestamp: Date;
}

export interface IInterviewScore {
    questionNumber: number;
    star: number;
    technical: number;
    communication: number;
}

export interface IInterviewState {
    questionNumber: number;
    scores: IInterviewScore[];
    askedQuestions: string[];
    completed: boolean;
}

export interface IChatSession extends Document {
    _id: mongoose.Types.ObjectId;
    user: mongoose.Types.ObjectId;
    resume?: mongoose.Types.ObjectId;
    title: string;
    activeMode?: CoachingMode;
    summary?: string;
    summaryMessageCount?: number;
    interviewState?: IInterviewState;
    messages: IChatMessage[];
    totalTokensUsed: number;
    createdAt: Date;
    updatedAt: Date;
}

const ChatMessageSchema = new Schema<IChatMessage>(
    {
        role: { type: String, enum: ['user', 'assistant'], required: true },
        content: { type: String, required: true },
        structured: { type: Schema.Types.Mixed },
        metadata: { type: Schema.Types.Mixed },
        timestamp: { type: Date, default: Date.now },
    },
    { _id: false }
);

const InterviewScoreSchema = new Schema<IInterviewScore>(
    {
        questionNumber: { type: Number, required: true },
        star: { type: Number, required: true },
        technical: { type: Number, required: true },
        communication: { type: Number, required: true },
    },
    { _id: false }
);

const InterviewStateSchema = new Schema<IInterviewState>(
    {
        questionNumber: { type: Number, default: 0 },
        scores: { type: [InterviewScoreSchema], default: [] },
        askedQuestions: { type: [String], default: [] },
        completed: { type: Boolean, default: false },
    },
    { _id: false }
);

const ChatSessionSchema = new Schema<IChatSession>(
    {
        user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
        resume: { type: Schema.Types.ObjectId, ref: 'Resume' },
        title: { type: String, default: 'New Chat Session', maxlength: 200 },
        activeMode: { type: String, default: 'general' },
        summary: { type: String, default: '' },
        summaryMessageCount: { type: Number, default: 0 },
        interviewState: { type: InterviewStateSchema, default: () => ({ questionNumber: 0, scores: [], askedQuestions: [], completed: false }) },
        messages: [ChatMessageSchema],
        totalTokensUsed: { type: Number, default: 0 },
    },
    { timestamps: true }
);

ChatSessionSchema.index({ user: 1, updatedAt: -1 });

export const ChatSessionModel: Model<IChatSession> = mongoose.model<IChatSession>('ChatSession', ChatSessionSchema);
