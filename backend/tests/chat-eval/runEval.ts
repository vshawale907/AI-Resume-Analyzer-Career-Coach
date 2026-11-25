import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import * as openaiService from '../../src/services/openai.service';
import { EVAL_CASES } from './cases';
import { evaluateEvalCase, type CaseEvalResult } from './evaluate';
import type { EvalCase } from './types';

function estimateTokens(obj: unknown): number {
    return Math.ceil(JSON.stringify(obj ?? '').length / 4);
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Timeout after ${ms}ms (${label})`)), ms);
        promise.then(
            (v) => { clearTimeout(timer); resolve(v); },
            (e) => { clearTimeout(timer); reject(e); }
        );
    });
}

async function runSingleCase(evalCase: EvalCase): Promise<CaseEvalResult> {
    const start = Date.now();
    const svc = openaiService as Record<string, any>;

    // Use Phase 1+7 runCoachTurn orchestrator if available; fallback to baseline chatWithCoachStructured
    if (typeof svc.runCoachTurn === 'function') {
        const res = await withTimeout(
            svc.runCoachTurn({
                messages: [
                    ...(evalCase.history || []),
                    { role: 'user', content: evalCase.userMessage },
                ],
                mode: evalCase.mode,
                resumeText: evalCase.resumeAttached ? evalCase.resumeText : undefined,
                nlpData: evalCase.resumeAttached ? evalCase.nlpData : undefined,
                analysisStatus: evalCase.resumeAttached ? 'ready' : 'none',
                bulletText: evalCase.bulletText,
                targetRole: evalCase.targetRole,
                jobPosting: evalCase.jobPosting,
                interviewState: evalCase.interviewState,
            }),
            45000,
            evalCase.id
        );
        const latencyMs = res?.meta?.latencyMs ?? (Date.now() - start);
        const tokensUsed = res?.meta?.tokensUsed ?? estimateTokens(res?.structured);
        return evaluateEvalCase(evalCase, res.structured ?? res, latencyMs, tokensUsed);
    }

    // Baseline path (current chatWithCoachStructured)
    const messages = [
        ...(evalCase.history || []),
        { role: 'user' as const, content: evalCase.userMessage },
    ];
    const structured = await withTimeout(
        openaiService.chatWithCoachStructured(
            messages,
            evalCase.mode as any,
            evalCase.resumeAttached ? evalCase.resumeText : undefined,
            evalCase.resumeAttached ? evalCase.nlpData : undefined,
            evalCase.bulletText,
            evalCase.targetRole,
            evalCase.jobPosting
        ),
        35000,
        evalCase.id
    );
    const latencyMs = Date.now() - start;
    const tokensUsed = estimateTokens(structured);
    return evaluateEvalCase(evalCase, structured as Record<string, any>, latencyMs, tokensUsed);
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
    const tagArg = process.argv.find((a) => a.startsWith('--tag='));
    const tag = tagArg ? tagArg.split('=')[1] : 'latest';
    const delayArg = process.argv.find((a) => a.startsWith('--delay='));
    const delayMs = delayArg ? Number(delayArg.split('=')[1]) : 2500;

    console.log(`\n=== TalentLens Chat Coach Eval [tag=${tag}] (${EVAL_CASES.length} cases, delay=${delayMs}ms) ===\n`);
    const results: CaseEvalResult[] = [];

    for (let i = 0; i < EVAL_CASES.length; i++) {
        const c = EVAL_CASES[i];
        try {
            let r: CaseEvalResult;
            try {
                r = await runSingleCase(c);
            } catch (firstErr: any) {
                if (/Timeout|NO_AI_KEYS|429|503/i.test(firstErr?.message || '')) {
                    await pause(6000);
                    r = await runSingleCase(c);
                } else {
                    throw firstErr;
                }
            }
            const icon = r.passed ? 'PASS' : r.accuracyPassed ? 'SCHEMA_FAIL' : 'FAIL';
            console.log(`[${icon}] ${r.id} (${r.mode}) ${r.latencyMs}ms | claims=${r.totalClaims} unverified=${r.unverifiedClaims}`);
            if (r.failures.length > 0) {
                console.log(`       -> ${r.failures.join(' | ')}`);
            }
            results.push(r);
        } catch (err: any) {
            console.log(`[ERROR] ${c.id} (${c.mode}): ${err?.message}`);
            results.push({
                id: c.id,
                name: c.name,
                mode: c.mode,
                passed: false,
                accuracyPassed: false,
                targetSchemaValid: false,
                totalClaims: 1,
                unverifiedClaims: 1,
                failures: [`Unhandled error: ${err?.message}`],
                latencyMs: 0,
                tokensUsed: 0,
            });
        }
        if (i < EVAL_CASES.length - 1 && delayMs > 0) {
            await pause(delayMs);
        }
    }

    // Summary metrics
    const byMode: Record<string, { total: number; passed: number; accuracyPassed: number; schemaValid: number }> = {};
    let totalClaims = 0;
    let totalUnverified = 0;
    let totalLatency = 0;
    let totalTokens = 0;

    for (const r of results) {
        byMode[r.mode] = byMode[r.mode] || { total: 0, passed: 0, accuracyPassed: 0, schemaValid: 0 };
        byMode[r.mode].total++;
        if (r.passed) byMode[r.mode].passed++;
        if (r.accuracyPassed) byMode[r.mode].accuracyPassed++;
        if (r.targetSchemaValid) byMode[r.mode].schemaValid++;
        totalClaims += r.totalClaims;
        totalUnverified += r.unverifiedClaims;
        totalLatency += r.latencyMs;
        totalTokens += r.tokensUsed;
    }

    const totalPassed = results.filter((r) => r.passed).length;
    const totalAccPassed = results.filter((r) => r.accuracyPassed).length;
    const totalSchemaValid = results.filter((r) => r.targetSchemaValid).length;
    const hallucinationRate = totalClaims > 0 ? Number(((totalUnverified / totalClaims) * 100).toFixed(1)) : 0;
    const avgLatencyMs = Math.round(totalLatency / results.length);
    const avgTokens = Math.round(totalTokens / results.length);

    console.log('\n--- Per-Mode Breakdown ---');
    for (const [mode, m] of Object.entries(byMode)) {
        const pct = Math.round((m.passed / m.total) * 100);
        const accPct = Math.round((m.accuracyPassed / m.total) * 100);
        console.log(`${mode.padEnd(16)} | Pass: ${m.passed}/${m.total} (${pct}%) | Accuracy: ${accPct}% | TargetSchema: ${m.schemaValid}/${m.total}`);
    }

    console.log('\n--- Overall Summary ---');
    console.log(`Tag:                ${tag}`);
    console.log(`Overall Pass Rate:  ${totalPassed}/${results.length} (${((totalPassed / results.length) * 100).toFixed(1)}%)`);
    console.log(`Accuracy Pass Rate: ${totalAccPassed}/${results.length} (${((totalAccPassed / results.length) * 100).toFixed(1)}%)`);
    console.log(`Target Schema Rate: ${totalSchemaValid}/${results.length} (${((totalSchemaValid / results.length) * 100).toFixed(1)}%)`);
    console.log(`Hallucination Rate: ${totalUnverified}/${totalClaims} (${hallucinationRate}%)`);
    console.log(`Avg Latency:        ${avgLatencyMs}ms`);
    console.log(`Avg Tokens:         ${avgTokens}`);

    const outDir = path.resolve(__dirname, 'results');
    fs.mkdirSync(outDir, { recursive: true });
    const report = {
        tag,
        timestamp: new Date().toISOString(),
        summary: {
            totalCases: results.length,
            totalPassed,
            overallPassRatePct: Number(((totalPassed / results.length) * 100).toFixed(1)),
            totalAccPassed,
            accuracyPassRatePct: Number(((totalAccPassed / results.length) * 100).toFixed(1)),
            totalSchemaValid,
            schemaValidPct: Number(((totalSchemaValid / results.length) * 100).toFixed(1)),
            totalClaims,
            unverifiedClaims: totalUnverified,
            hallucinationRatePct: hallucinationRate,
            avgLatencyMs,
            avgTokens,
        },
        byMode,
        results,
    };
    const filePath = path.join(outDir, `${tag}.json`);
    fs.writeFileSync(filePath, JSON.stringify(report, null, 2));
    fs.writeFileSync(path.join(outDir, 'latest.json'), JSON.stringify(report, null, 2));
    console.log(`\nSaved JSON report to: ${filePath}\n`);
}

main().catch((err) => {
    console.error('Eval runner failed:', err);
    process.exit(1);
});
