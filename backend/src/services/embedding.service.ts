import OpenAI from 'openai';
import { GoogleGenerativeAI, TaskType } from '@google/generative-ai';
import { config } from '../config/env';
import { logger } from '../config/logger';

const openai = (config.OPENAI_API_KEY && config.OPENAI_API_KEY.trim().length > 0)
    ? new OpenAI({ apiKey: config.OPENAI_API_KEY })
    : null;
const genAI = (config.GEMINI_API_KEY && config.GEMINI_API_KEY.trim().length > 0)
    ? new GoogleGenerativeAI(config.GEMINI_API_KEY)
    : null;

export const EMBEDDING_DIM = 1536; // text-embedding-3-small or ada-002
let openaiEmbeddingCooldownUntil = 0;

/**
 * Generates a dense vector embedding for a given text.
 * Tries OpenAI first (text-embedding-3-small), falls back to Gemini embedding.
 *
 * @param text - The text to embed
 * @returns Float32 vector with EMBEDDING_DIM dimensions
 */
export async function generateEmbedding(text: string): Promise<number[]> {
    // Trim text to avoid token limits — embeddings work well on 512-1024 token chunks
    const truncated = text.slice(0, 6000);

    if (openai && Date.now() >= openaiEmbeddingCooldownUntil) {
        try {
            const response = await openai.embeddings.create({
                model: 'text-embedding-3-small', // 1536 dims, cost-efficient
                input: truncated,
            });
            logger.debug('[Embedding] Generated via OpenAI text-embedding-3-small');
            return response.data[0].embedding;
        } catch (err: any) {
            const msg = err?.message || '';
            if (msg.includes('credits') || msg.includes('billing') || msg.includes('quota') || msg.includes('429')) {
                openaiEmbeddingCooldownUntil = Date.now() + 15 * 60 * 1000;
            }
            logger.warn(`[Embedding] OpenAI embedding failed: ${msg}. Falling back to Gemini...`);
        }
    }

    if (genAI) {
        try {
            const model = genAI.getGenerativeModel({ model: 'gemini-embedding-001' });
            const result = await model.embedContent({
                content: { role: 'user', parts: [{ text: truncated }] },
                taskType: TaskType.SEMANTIC_SIMILARITY,
            });
            const raw = result.embedding.values;
            // gemini-embedding-001 returns 3072 dims; normalize/fit to EMBEDDING_DIM (1536) for Qdrant collection
            const sized = raw.slice(0, EMBEDDING_DIM);
            while (sized.length < EMBEDDING_DIM) sized.push(0);
            logger.debug(`[Embedding] Generated via Gemini gemini-embedding-001 (${raw.length} -> ${sized.length})`);
            return sized;
        } catch (err: any) {
            logger.warn(`[Embedding] Gemini embedding failed: ${err?.message}`);
        }
    }

    // If both fail, return a zero vector to prevent a hard crash.
    // Semantic search will score 0 for this document, which is an acceptable degraded state.
    logger.error('[Embedding] All embedding providers failed. Returning zero vector.');
    return new Array(EMBEDDING_DIM).fill(0);
}
