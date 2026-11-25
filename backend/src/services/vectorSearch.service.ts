import { qdrantClient, COLLECTION, EMBEDDING_DIM } from '../config/qdrant';
import { generateEmbedding } from './embedding.service';
import { JobModel } from '../models/Job.model';
import { ResumeModel } from '../models/Resume.model';
import { logger } from '../config/logger';
import crypto from 'crypto';
import { splitResumeIntoSections } from '../utils/resumeParser';
import { v5 as uuidv5 } from 'uuid';

const CHUNK_NAMESPACE = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';

export interface JobMatchResult {
    jobId: string;
    score: number;
    title: string;
    company: string;
    location: string;
    type: string;
    experienceLevel: string;
    industry: string;
}

/**
 * Generates and stores a job embedding in Qdrant.
 * Call this whenever a new job is created or its description is updated.
 */
export async function indexJob(jobId: string): Promise<void> {
    const job = await JobModel.findById(jobId).lean();
    if (!job) {
        logger.warn(`[VectorSearch] Job ${jobId} not found, skipping indexing.`);
        return;
    }

    // Compose a rich text document for the embedding
    const jobText = [
        job.title,
        job.company,
        job.industry,
        job.description,
        ...(job.requirements || []),
        ...(job.preferredSkills || []),
        ...(job.tags || []),
    ].join(' ');

    const vector = await generateEmbedding(jobText);

    await qdrantClient.upsert(COLLECTION.JOBS, {
        wait: true,
        points: [
            {
                id: jobId,
                vector,
                payload: {
                    jobId,
                    title: job.title,
                    company: job.company,
                    location: job.location,
                    type: job.type,
                    experienceLevel: job.experienceLevel,
                    industry: job.industry,
                    isActive: job.isActive,
                },
            },
        ],
    });

    logger.debug(`[VectorSearch] Indexed job ${jobId} (${job.title})`);
}

/**
 * Generates and stores a resume embedding in Qdrant.
 * Called from the background worker after resume processing is complete.
 */
export async function indexResume(resumeId: string, skills: string[]): Promise<void> {
    const resume = await ResumeModel.findById(resumeId).lean();
    if (!resume) return;

    const resumeText = [resume.cleanedText, ...skills].join(' ');
    const vector = await generateEmbedding(resumeText);

    await qdrantClient.upsert(COLLECTION.RESUMES, {
        wait: true,
        points: [
            {
                id: resumeId,
                vector,
                payload: {
                    resumeId,
                    userId: resume.user.toString(),
                    skills,
                },
            },
        ],
    });

    logger.debug(`[VectorSearch] Indexed resume ${resumeId}`);
}

/**
 * Uses the user's resume vector to find semantically similar active job postings.
 * Returns the top N jobs sorted by similarity score (0-1).
 */
export async function findMatchingJobs(
    resumeId: string,
    topN = 20,
    minScore = 0.55
): Promise<JobMatchResult[]> {
    // Fetch resume vector from Qdrant
    const resumePoints = await qdrantClient.retrieve(COLLECTION.RESUMES, {
        ids: [resumeId],
        with_vector: true,
    });

    if (!resumePoints.length || !resumePoints[0].vector) {
        logger.warn(`[VectorSearch] No vector found for resume ${resumeId}. Returning empty matches.`);
        return [];
    }

    const resumeVector = resumePoints[0].vector as number[];

    // Semantic similarity search against all active jobs
    const results = await qdrantClient.search(COLLECTION.JOBS, {
        vector: resumeVector,
        limit: topN,
        score_threshold: minScore,
        filter: {
            must: [{ key: 'isActive', match: { value: true } }],
        },
        with_payload: true,
    });

    return results.map((r) => ({
        jobId: r.payload?.jobId as string,
        score: r.score,
        title: r.payload?.title as string,
        company: r.payload?.company as string,
        location: r.payload?.location as string,
        type: r.payload?.type as string,
        experienceLevel: r.payload?.experienceLevel as string,
        industry: r.payload?.industry as string,
    }));
}

export async function deleteResumeVector(resumeId: string): Promise<void> {
    await qdrantClient.delete(COLLECTION.RESUMES, {
        wait: true,
        points: [resumeId],
    });
    logger.debug(`[VectorSearch] Deleted resume vector ${resumeId}`);
}

export async function deleteJobVector(jobId: string): Promise<void> {
    await qdrantClient.delete(COLLECTION.JOBS, {
        wait: true,
        points: [jobId],
    });
    logger.debug(`[VectorSearch] Deleted job vector ${jobId}`);
}

export interface RetrievedResumeChunk {
    heading: string;
    text: string;
    requirement: string;
    score: number;
}

export interface JobRagRetrievalResult {
    ragPath: 'qdrant' | 'full_text_fallback';
    retrievedChunks: RetrievedResumeChunk[];
}

export function chunkResumeForRag(resumeText: string): Array<{ heading: string; text: string }> {
    const sections = splitResumeIntoSections(resumeText);
    const chunks: Array<{ heading: string; text: string }> = [];
    for (const sec of sections) {
        const paragraphs = sec.content.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
        let buffer = '';
        for (const p of paragraphs) {
            if ((buffer + '\n' + p).length > 750 && buffer.length > 0) {
                chunks.push({ heading: sec.heading, text: buffer.trim() });
                buffer = p;
            } else {
                buffer = buffer ? `${buffer}\n${p}` : p;
            }
        }
        if (buffer.trim()) {
            chunks.push({ heading: sec.heading, text: buffer.trim() });
        }
    }
    return chunks;
}

export function chunkJobRequirements(jobPosting: string): string[] {
    const lines = jobPosting
        .split('\n')
        .map((l) => l.replace(/^[•\-*–—]\s*/, '').trim())
        .filter((l) => l.length >= 12);
    // Cap at 4 key requirement chunks to keep embedding latency low and preserve free-tier quota
    return lines.slice(0, 4);
}

async function isQdrantHealthy(timeoutMs = 1200): Promise<boolean> {
    try {
        await Promise.race([
            qdrantClient.getCollections(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Qdrant timeout')), timeoutMs)),
        ]);
        return true;
    } catch {
        return false;
    }
}

export async function retrieveRelevantResumeChunksForJD(params: {
    resumeId?: string;
    resumeText: string;
    jobPosting: string;
    topK?: number;
}): Promise<JobRagRetrievalResult> {
    const { resumeId, resumeText, jobPosting, topK = 3 } = params;
    const available = await isQdrantHealthy();

    if (!available) {
        logger.info('[RAG] job_rag_coach path=full_text_fallback reason=qdrant_unavailable');
        return { ragPath: 'full_text_fallback', retrievedChunks: [] };
    }

    try {
        const collections = await qdrantClient.getCollections();
        const exists = collections.collections.some((c) => c.name === COLLECTION.RESUME_CHUNKS);
        if (!exists) {
            await qdrantClient.createCollection(COLLECTION.RESUME_CHUNKS, {
                vectors: { size: EMBEDDING_DIM, distance: 'Cosine' },
            });
        }

        const docKey = resumeId || uuidv5(resumeText.slice(0, 200), CHUNK_NAMESPACE);
        const contentHash = crypto.createHash('sha1').update(resumeText).digest('hex').slice(0, 12);

        // Reuse already-indexed chunks for this exact resume + contentHash to avoid redundant embedding API calls
        const cachedChunks = await qdrantClient.scroll(COLLECTION.RESUME_CHUNKS, {
            filter: {
                must: [
                    { key: 'resumeId', match: { value: docKey } },
                    { key: 'contentHash', match: { value: contentHash } },
                ],
            },
            limit: 1,
            with_payload: false,
        });

        let indexedNow = false;
        if (cachedChunks.points.length === 0) {
            const resumeChunks = chunkResumeForRag(resumeText);
            if (resumeChunks.length === 0) {
                logger.info('[RAG] job_rag_coach path=full_text_fallback reason=no_chunks');
                return { ragPath: 'full_text_fallback', retrievedChunks: [] };
            }

            // Clear any stale chunks for an older version of this resumeId
            await qdrantClient.delete(COLLECTION.RESUME_CHUNKS, {
                wait: true,
                filter: { must: [{ key: 'resumeId', match: { value: docKey } }] },
            }).catch(() => {});

            const points = await Promise.all(
                resumeChunks.map(async (c, idx) => ({
                    id: uuidv5(`${docKey}:${contentHash}:${idx}:${c.heading}`, CHUNK_NAMESPACE),
                    vector: await generateEmbedding(`${c.heading}\n${c.text}`),
                    payload: { resumeId: docKey, contentHash, heading: c.heading, text: c.text },
                }))
            );
            await qdrantClient.upsert(COLLECTION.RESUME_CHUNKS, { wait: true, points });
            indexedNow = true;
        }

        const reqs = chunkJobRequirements(jobPosting);
        const seenTexts = new Set<string>();
        const retrievedChunks: RetrievedResumeChunk[] = [];

        const reqVectors = await Promise.all(reqs.map((r) => generateEmbedding(r)));
        const searchResults = await Promise.all(
            reqVectors.map((reqVec) =>
                qdrantClient.search(COLLECTION.RESUME_CHUNKS, {
                    vector: reqVec,
                    limit: topK,
                    filter: { must: [{ key: 'resumeId', match: { value: docKey } }] },
                    with_payload: true,
                })
            )
        );

        searchResults.forEach((hits, idx) => {
            const reqText = reqs[idx];
            for (const hit of hits) {
                const text = String(hit.payload?.text || '');
                if (text && !seenTexts.has(text)) {
                    seenTexts.add(text);
                    retrievedChunks.push({
                        heading: String(hit.payload?.heading || 'Section'),
                        text,
                        requirement: reqText,
                        score: Number(hit.score.toFixed(3)),
                    });
                }
            }
        });

        logger.info(`[RAG] job_rag_coach path=qdrant chunks=${retrievedChunks.length} reqs=${reqs.length} cacheHit=${!indexedNow}`);
        return { ragPath: 'qdrant', retrievedChunks };
    } catch (err: any) {
        logger.warn(`[RAG] job_rag_coach path=full_text_fallback reason=${err?.message || 'qdrant_error'}`);
        return { ragPath: 'full_text_fallback', retrievedChunks: [] };
    }
}
