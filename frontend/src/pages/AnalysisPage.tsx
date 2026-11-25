import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
    ArrowLeft, Download, RefreshCw, Target, Star, Award, GitCompare,
    CheckCircle2, XCircle, AlertTriangle, Copy, Check, Sparkles, MessageSquare,
    ChevronDown, ChevronUp, Info
} from 'lucide-react';
import toast from 'react-hot-toast';
import { Document, Packer, Paragraph, TextRun } from 'docx';

import { api } from '../lib/api';
import { useResumeStore } from '../stores/resumeStore';
import {
    computeSectionCompleteness,
    countQuantifiedBullets,
    checkResumeSections,
    computeReadability,
    categorizeSkills,
    computeFormattingScore,
    filterKeywordDensity,
    extractBulletLines,
    ReadabilityMetrics,
    SectionStatus,
    FormattingCriteria
} from '../lib/resumeAnalysis';

interface NLPResult {
    extractedSkills: string[];
    softSkills: string[];
    experienceYears: number;
    similarityScore: number;
    matchedSkills: string[];
    missingSkills: string[];
    keywordDensity: Record<string, number>;
    quantificationScore?: number;
    bulletCount?: number;
}

interface BulletImpactScore {
    bullet: string;
    rewritten: string;
    score: number;
}

interface OpenAIResult {
    atsScore: number;
    qualityScore: number;
    overallScore: number;
    strengths: string[];
    weaknesses: string[];
    improvements: string[];
    summary?: string;
    bulletImpactScores: BulletImpactScore[];
    interviewQuestions?: any[];
    coverLetter?: string;
    careerRoadmap?: any;
}

interface AnalysisData {
    _id: string;
    resume: string;
    jobDescriptionText?: string;
    nlpResult: NLPResult;
    openAIResult?: OpenAIResult;  // BUG 1 FIX: mark optional — it CAN be missing
    createdAt: string;
}

interface ResumeData {
    _id: string;
    title: string;
    originalFilename: string;
    rawText: string;
    cleanedText: string;
    createdAt: string;
}


const AnimatedCounter = ({ value }: { value: number }) => {
    const [count, setCount] = useState(0);
    useEffect(() => {
        let start = 0;
        const duration = 800;
        const startTs = performance.now();
        const step = (ts: number) => {
            const prog = Math.min((ts - startTs) / duration, 1);
            setCount(Math.floor(prog * value));
            if (prog < 1) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
    }, [value]);
    return <>{count}</>;
};

const CircularProgress = ({ score, colorClass, icon: Icon }: { score: number, colorClass: string, icon: any }) => {
    const [offset, setOffset] = useState(251);
    useEffect(() => {
        setTimeout(() => setOffset(251 - (251 * Math.min(score, 100)) / 100), 100);
    }, [score]);

    return (
        <div className="relative w-24 h-24 flex items-center justify-center">
            <svg className="absolute inset-0 w-full h-full transform -rotate-90">
                <circle cx="48" cy="48" r="40" className="stroke-gray-800" strokeWidth="8" fill="none" />
                <circle cx="48" cy="48" r="40" className={`stroke-current ${colorClass} transition-all duration-1000 ease-out`} strokeWidth="8" fill="none" strokeDasharray="251" strokeDashoffset={offset} strokeLinecap="round" />
            </svg>
            <div className="absolute flex flex-col items-center">
                <Icon size={16} className={`mb-1 ${colorClass}`} />
                <span className="text-xl font-bold text-white leading-none"><AnimatedCounter value={score} /></span>
            </div>
        </div>
    );
};


export default function AnalysisPage() {
    const navigate = useNavigate();
    const { id } = useParams<{ id: string }>();
    const resumeId = useResumeStore(s => s.selectedResumeId) || id;

    const [loading, setLoading] = useState(true);
    const [pendingAnalysis, setPendingAnalysis] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [analysis, setAnalysis] = useState<AnalysisData | null>(null);
    const [resume, setResume] = useState<ResumeData | null>(null);
    const [copiedBullet, setCopiedBullet] = useState<string | null>(null);
    const [generatingDoc, setGeneratingDoc] = useState(false);
    const [expandedSkills, setExpandedSkills] = useState<Record<string, boolean>>({});
    const [showFormattingDetails, setShowFormattingDetails] = useState(false);

    const toggleSkillCategory = (cat: string) => {
        setExpandedSkills(prev => ({ ...prev, [cat]: !prev[cat] }));
    };

    // Derived states
    const [sectionCompleteness, setSectionCompleteness] = useState(0);
    const [quantifiedScore, setQuantifiedScore] = useState(0);
    const [quantifiedCount, setQuantifiedCount] = useState(0);
    const [quantifiedTotal, setQuantifiedTotal] = useState(0);
    const [sectionStatuses, setSectionStatuses] = useState<SectionStatus[]>([]);
    const [readability, setReadability] = useState<ReadabilityMetrics | null>(null);
    // BUG 6 FIX: real formatting criteria
    const [formattingCriteria, setFormattingCriteria] = useState<FormattingCriteria | null>(null);
    // BUG 4 FIX: real bullet count from resume text
    const [realBulletCount, setRealBulletCount] = useState(0);

    const fetchData = async () => {
        if (!resumeId) return;
        try {
            setLoading(true);
            setError(null);
            
            if (!resumeId || resumeId === "undefined") {
                throw new Error("Invalid Resume ID in URL. Please navigate from the dashboard.");
            }

            const [resAna, resResList] = await Promise.all([
                api.get(`/analysis/${resumeId}/latest`).catch((e) => {
                    console.error("Latest Analysis 404:", e);
                    return { data: null };
                }),
                api.get('/resumes?limit=100').catch((e) => {
                    console.error("Resumes Fetch Error:", e);
                    return { data: { resumes: [] } };
                })
            ]);

            const aData = resAna.data?.data?.analysis || resAna.data?.analysis || resAna.data?.data || resAna.data;
            const resumesArray = resResList.data?.data?.resumes || resResList.data?.resumes || resResList.data?.data || [];
            const rData = resumesArray.find((r: any) => r._id === resumeId);

            if (!rData) throw new Error("Could not locate the original resume document.");

            if (rData.status === 'processing' || rData.status === 'uploading') {
                setResume(rData);
                setPendingAnalysis(true);
                return;
            }
            if (rData.status === 'error') {
                throw new Error("Resume analysis failed in the background worker. Please try re-analyzing.");
            }
            if (!aData || !aData.nlpResult) {
                throw new Error("Analysis is incomplete or has not been generated yet. Please analyze your resume from the dashboard first.");
            }

            setPendingAnalysis(false);
            setAnalysis(aData);
            setResume(rData);

            // Compute Local Metrics from the ACTUAL resume text
            const text = rData.rawText || rData.cleanedText || '';

            // BUG 3 FIX: robust section detection
            const statuses = checkResumeSections(text);
            setSectionStatuses(statuses);
            
            let sScore = 0;
            statuses.forEach(s => {
                if (s.status === 'present') sScore += 1;
                else if (s.status === 'weak') sScore += 0.5;
            });
            setSectionCompleteness(Math.round((sScore / statuses.length) * 25));
            
            // BUG 4 FIX: count ALL real bullets from resume text
            const allBullets = extractBulletLines(text);
            setRealBulletCount(allBullets.length);

            // BUG 4 FIX: quantification from real bullet lines
            const { count: qCount, total: qTotal } = countQuantifiedBullets(text);
            setQuantifiedCount(qCount);
            setQuantifiedTotal(qTotal);
            const qRatio = Math.min(1, qCount / Math.max(1, qTotal));
            setQuantifiedScore(Math.round(qRatio * 25));

            // BUG 4 FIX: readability from real bullets (not just AI-rewritten ones)
            setReadability(computeReadability(text, []));

            // BUG 6 FIX: real formatting evaluation
            setFormattingCriteria(computeFormattingScore(text));

        } catch (err: any) {
            console.error('Fetch error:', err);
            setError(err.response?.data?.message || err.message || 'Failed to load analysis.');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (!resumeId) navigate('/dashboard');
        else fetchData();
    }, [resumeId]);

    // BUG 1 FIX: Poll while BullMQ job is pending/processing
    useEffect(() => {
        if (!pendingAnalysis || !resumeId) return;
        const timer = setInterval(async () => {
            try {
                const statusRes = await api.get(`/resumes/${resumeId}/status`);
                const st = statusRes.data?.data?.status || statusRes.data?.status;
                if (st === 'analyzed') {
                    setPendingAnalysis(false);
                    fetchData();
                } else if (st === 'error') {
                    setPendingAnalysis(false);
                    setError('Analysis failed while processing. Please try again.');
                }
            } catch {
                // Keep polling on transient errors
            }
        }, 2500);
        return () => clearInterval(timer);
    }, [pendingAnalysis, resumeId]);

    const handleCopy = (text: string) => {
        navigator.clipboard.writeText(text);
        setCopiedBullet(text);
        toast.success('Copied to clipboard');
        setTimeout(() => setCopiedBullet(null), 2000);
    };

    const handleDownloadDocx = async () => {
        if (!resume || !analysis) return;
        setGeneratingDoc(true);
        try {
            let optimizedText = resume.rawText || resume.cleanedText || '';
            
            analysis.openAIResult?.bulletImpactScores?.forEach(b => {
                if (b.rewritten && b.bullet && optimizedText.includes(b.bullet)) {
                    optimizedText = optimizedText.replace(b.bullet, b.rewritten);
                }
            });

            const doc = new Document({
                sections: [{
                    properties: {},
                    children: optimizedText.split('\n').map(line => new Paragraph({
                        children: [new TextRun(line)]
                    }))
                }]
            });

            const blob = await Packer.toBlob(doc);
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `Optimized_${resume.originalFilename || 'Resume'}.docx`;
            a.click();
            URL.revokeObjectURL(url);
            toast.success('Optimized resume downloaded!');
        } catch (err) {
            console.error(err);
            toast.error('Failed to generate document');
        } finally {
            setGeneratingDoc(false);
        }
    };

    const handleReanalyze = async () => {
        try {
            setPendingAnalysis(true);
            setError(null);
            await api.post(`/resumes/${resumeId}/analyze`, {
                jobDescriptionText: analysis?.jobDescriptionText || undefined,
            });
            toast.success('Re-analysis queued. Updating results...');
        } catch (err) {
            setPendingAnalysis(false);
            toast.error('Failed to queue analysis.');
        }
    };

    if (loading || pendingAnalysis) return (
        <div className="max-w-[1600px] mx-auto p-6 lg:p-8 space-y-6 animate-pulse">
            <div className="flex items-center justify-between border-b border-white/5 pb-6">
                <div className="space-y-2">
                    <div className="h-6 w-64 bg-gray-800 rounded-lg" />
                    <div className="h-4 w-44 bg-gray-900 rounded" />
                </div>
                <div className="text-xs text-amber-400 flex items-center gap-2 font-medium">
                    <RefreshCw size={14} className="animate-spin" />
                    {pendingAnalysis ? 'AI analysis in progress...' : 'Loading analysis...'}
                </div>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {[0, 1, 2, 3].map(i => (
                    <div key={i} className="bg-gray-900 border border-white/10 rounded-2xl p-5 h-32 flex items-center gap-4">
                        <div className="w-24 h-24 rounded-full bg-gray-800 flex-shrink-0" />
                        <div className="space-y-2 flex-1">
                            <div className="h-4 w-24 bg-gray-800 rounded" />
                            <div className="h-3 w-16 bg-gray-800 rounded" />
                        </div>
                    </div>
                ))}
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="bg-gray-900 border border-white/10 rounded-2xl p-6 h-64" />
                <div className="bg-gray-900 border border-white/10 rounded-2xl p-6 lg:col-span-2 h-64" />
            </div>
        </div>
    );

    if (error || !analysis || !resume) return (
        <div className="p-10 text-center">
            <div className="bg-rose-500/10 border border-rose-500/20 text-rose-400 p-6 rounded-2xl max-w-lg mx-auto">
                <AlertTriangle className="mx-auto mb-4 w-12 h-12" />
                <h3 className="text-xl font-bold mb-2">Analysis Failed</h3>
                <p className="text-sm mb-6">{error || 'Could not load analysis details. The resume might still be processing.'}</p>
                <div className="flex gap-4 justify-center">
                    <button onClick={() => navigate('/dashboard')} className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-white rounded-xl transition-colors">Go to Dashboard</button>
                    <button onClick={fetchData} className="px-4 py-2 bg-rose-500/20 hover:bg-rose-500/30 text-rose-400 rounded-xl transition-colors">Try Again</button>
                </div>
            </div>
        </div>
    );

    const { openAIResult, nlpResult } = analysis;
    const cats = categorizeSkills(nlpResult.extractedSkills);

    // ─── BUG 2 FIX: JD awareness ───
    const hasJD = Boolean(analysis.jobDescriptionText?.trim());

    // ─── BUG 1 FIX: Compute real scores with fallbacks ───
    const formattingScore = formattingCriteria?.score ?? 0;
    const keywordScore = hasJD
        ? Math.round(((nlpResult?.matchedSkills?.length || 0) / Math.max(1, (nlpResult?.matchedSkills?.length || 0) + (nlpResult?.missingSkills?.length || 0))) * 25)
        : Math.min(25, Math.round(((nlpResult?.extractedSkills?.length || 0) / 15) * 25));

    // If openAIResult exists, use it; otherwise compute from breakdown components
    const computedAtsFromBreakdown = keywordScore + formattingScore + sectionCompleteness + quantifiedScore;

    // Fallback quality score: weight readability, action verb ratio, and quantification differently from ATS
    const fallbackQuality = (() => {
        if (!readability) return Math.min(100, computedAtsFromBreakdown);
        const actionVerbRatio = readability.totalBullets > 0
            ? readability.actionVerbCount / readability.totalBullets
            : 0;
        const passivePenalty = Math.min(20, readability.passiveBullets.length * 5);
        const quantBonus = quantifiedTotal > 0 ? Math.min(25, Math.round((quantifiedCount / quantifiedTotal) * 30)) : 0;
        const verbScore = Math.round(actionVerbRatio * 30);
        const baseQuality = 40 + verbScore + quantBonus - passivePenalty;
        return Math.max(10, Math.min(100, baseQuality));
    })();

    const atsScore = openAIResult?.atsScore ?? computedAtsFromBreakdown;
    const qualityScore = openAIResult?.qualityScore ?? fallbackQuality;

    // BUG 2 FIX: overall score must NOT penalize when no JD
    const overallScore = openAIResult?.overallScore
        ? (hasJD
            ? openAIResult.overallScore
            : Math.round((atsScore * 0.5) + (qualityScore * 0.5)))  // no JD: equal weight ATS + Quality
        : Math.round((atsScore * 0.4) + (qualityScore * 0.6));

    // BUG 2 FIX: JD Match score and label
    const jdMatchScore = hasJD ? (nlpResult?.similarityScore ?? 0) : 0;

    const timeAgo = (dateStr: string) => {
        const h = Math.floor((Date.now() - new Date(dateStr).getTime()) / 3600000);
        if (h < 1) return 'Just now';
        if (h < 24) return `${h} hours ago`;
        return `${Math.floor(h/24)} days ago`;
    };

    const getColor = (score: number) => score >= 70 ? 'text-emerald-500' : score >= 50 ? 'text-amber-500' : 'text-rose-500';

    // BUG 1 + BUG 2 FIX: score ring items with proper labels
    const scoreItems = [
        { label: 'ATS Score', score: atsScore, icon: Target, noJD: false },
        { label: 'Quality Score', score: qualityScore, icon: Star, noJD: false },
        { label: 'Overall Score', score: overallScore, icon: Award, noJD: false },
        { label: 'JD Match', score: jdMatchScore, icon: GitCompare, noJD: !hasJD },
    ];

    // BUG 4: quantification percentage from real data
    const quantPct = quantifiedTotal > 0 ? Math.round((quantifiedCount / quantifiedTotal) * 100) : 0;

    // BUG 7: filtered keyword density
    const filteredKeywords = filterKeywordDensity(nlpResult.keywordDensity || {});

    return (
        <div className="w-full h-full bg-gray-950 overflow-y-auto">
            {/* Section 1 - Sticky Header */}
            <div className="sticky top-0 z-50 bg-gray-950/90 backdrop-blur-md border-b border-white/5 p-4 md:p-6 w-full flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div className="flex items-center gap-4">
                    <button onClick={() => navigate('/dashboard')} className="p-2 bg-gray-900 border border-white/10 rounded-xl hover:bg-gray-800 text-gray-400 transition-colors">
                        <ArrowLeft size={18} />
                    </button>
                    <div>
                        <h1 className="text-xl font-bold text-white flex items-center gap-2">Resume: <span className="text-amber-400 truncate max-w-[200px] md:max-w-md">{resume.originalFilename}</span></h1>
                        <p className="text-xs text-gray-500">Analyzed {timeAgo(analysis.createdAt)}</p>
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    <button onClick={handleReanalyze} className="px-4 py-2 border border-white/10 hover:border-amber-500/50 hover:bg-amber-500/10 text-gray-300 rounded-xl text-sm font-semibold transition-all flex items-center gap-2">
                        <RefreshCw size={14} /> Re-analyze
                    </button>
                    <button onClick={handleDownloadDocx} disabled={generatingDoc} className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-black rounded-xl text-sm font-semibold transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed shadow-[0_0_15px_rgba(245,158,11,0.2)]">
                        {generatingDoc ? <RefreshCw size={14} className="animate-spin" /> : <Download size={14} />} Download Optimized
                    </button>
                </div>
            </div>

            <div className="max-w-[1600px] mx-auto p-4 md:p-6 lg:p-8 space-y-6 pb-24 text-gray-200">
                
                {/* Section 2 - Score Overview Strip — BUG 1 + BUG 2 FIX */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    {scoreItems.map((item, i) => {
                        const col = item.noJD ? 'text-gray-500' : getColor(item.score);
                        const status = item.noJD ? 'No JD Provided' : item.score >= 70 ? 'Excellent' : item.score >= 50 ? 'Good' : 'Needs Work';
                        return (
                            <motion.div key={item.label} initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: i * 0.1 }} className="bg-gray-900 border border-white/10 rounded-2xl p-5 flex items-center gap-4">
                                <CircularProgress score={item.noJD ? 0 : item.score} colorClass={col} icon={item.icon} />
                                <div>
                                    <h3 className="text-sm font-medium text-gray-400">{item.label}</h3>
                                    <p className={`text-xs mt-1 ${col}`}>{status}</p>
                                </div>
                            </motion.div>
                        );
                    })}
                </div>

                {/* FAANG Verdict Banner */}
                {openAIResult?.summary && (
                    <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.15 }} className="bg-gradient-to-r from-gray-900 via-gray-900 to-rose-950/30 border border-white/10 rounded-2xl p-6 relative overflow-hidden">
                        <div className="absolute top-0 right-0 w-32 h-32 bg-rose-500/10 blur-3xl -mr-10 -mt-10 pointer-events-none" />
                        <h2 className="text-[11px] font-bold text-rose-400 tracking-widest uppercase mb-3 flex items-center gap-2"><Target size={14} /> Executive AI Verdict</h2>
                        <p className="text-lg md:text-xl text-gray-200 font-medium leading-relaxed italic border-l-2 border-rose-500/50 pl-4">
                            "{openAIResult.summary}"
                        </p>
                    </motion.div>
                )}

                {/* BUG 1: "openAIResult missing" info banner */}
                {!openAIResult && (
                    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="bg-amber-500/10 border border-amber-500/20 rounded-2xl p-5 flex items-start gap-3">
                        <Info size={18} className="text-amber-400 flex-shrink-0 mt-0.5" />
                        <div>
                            <p className="text-sm text-amber-200 font-medium">AI scoring was unavailable for this analysis.</p>
                            <p className="text-xs text-gray-400 mt-1">Scores are computed from local metrics only. Re-analyze for full AI-powered scoring.</p>
                        </div>
                    </motion.div>
                )}

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    {/* Section 3 - ATS Score Breakdown — BUG 1 + BUG 6 FIX */}
                    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="bg-gray-900 border border-white/10 rounded-2xl p-6 lg:col-span-1 flex flex-col">
                        <h2 className="text-lg font-bold text-white mb-6">ATS Score Breakdown</h2>
                        <div className="space-y-5 flex-1 flex flex-col justify-center">
                            {[
                                { label: 'Keyword Match', score: keywordScore },
                                { label: 'Formatting', score: formattingScore },
                                { label: 'Section Completeness', score: sectionCompleteness },
                                { label: 'Quantified Impact', score: quantifiedScore },
                            ].map(item => (
                                <div key={item.label}>
                                    <div className="flex justify-between text-sm mb-2">
                                        <span className="text-gray-300">{item.label}</span>
                                        <span className="text-amber-400 font-medium">{item.score}/25</span>
                                    </div>
                                    <div className="w-full bg-gray-800 h-2 rounded-full overflow-hidden">
                                        <motion.div initial={{ width: 0 }} animate={{ width: `${(item.score / 25) * 100}%` }} transition={{ duration: 1, ease: 'easeOut' }} className="h-full bg-amber-500 rounded-full" />
                                    </div>
                                </div>
                            ))}
                        </div>

                        {/* BUG 6 FIX: Formatting Details collapsible */}
                        {formattingCriteria && (
                            <div className="mt-4 border-t border-white/5 pt-4">
                                <button onClick={() => setShowFormattingDetails(!showFormattingDetails)} className="flex items-center gap-2 text-xs text-gray-400 hover:text-amber-400 transition-colors w-full">
                                    {showFormattingDetails ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                                    <span>Formatting Details</span>
                                </button>
                                {showFormattingDetails && (
                                    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="mt-3 space-y-2">
                                        {formattingCriteria.breakdown.map((c, i) => (
                                            <div key={i} className="flex items-start gap-2 text-xs">
                                                {c.passed
                                                    ? <CheckCircle2 size={14} className="text-emerald-500 flex-shrink-0 mt-0.5" />
                                                    : <XCircle size={14} className="text-rose-500 flex-shrink-0 mt-0.5" />
                                                }
                                                <div>
                                                    <span className={c.passed ? 'text-emerald-300' : 'text-rose-300'}>{c.label}</span>
                                                    <p className="text-gray-500 mt-0.5">{c.detail}</p>
                                                </div>
                                            </div>
                                        ))}
                                    </motion.div>
                                )}
                            </div>
                        )}
                    </motion.div>

                    {/* Section 4 - Resume Section Completeness Checker */}
                    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="bg-gray-900 border border-white/10 rounded-2xl p-6 lg:col-span-2">
                        <div className="mb-6">
                            <h2 className="text-lg font-bold text-white">Resume Sections</h2>
                            <p className="text-sm text-gray-500">Recruiters scan for these in the first 6 seconds</p>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {sectionStatuses.map((s, i) => (
                                <div key={i} className="bg-gray-950 border border-white/5 rounded-xl p-4 flex flex-col">
                                    <h3 className="text-sm font-semibold text-gray-200 mb-2">{s.name}</h3>
                                    <div className="flex items-center gap-2 mb-2">
                                        {s.status === 'present' ? <CheckCircle2 size={16} className="text-emerald-500" /> : s.status === 'weak' ? <AlertTriangle size={16} className="text-amber-500" /> : <XCircle size={16} className="text-rose-500" />}
                                        <span className={`text-xs font-medium uppercase tracking-wider ${s.status === 'present' ? 'text-emerald-500' : s.status === 'weak' ? 'text-amber-500' : 'text-rose-500'}`}>
                                            {s.status}
                                        </span>
                                    </div>
                                    <p className="text-xs text-gray-500 mt-auto">{s.tip}</p>
                                </div>
                            ))}
                        </div>
                    </motion.div>
                </div>

                {/* Section 5 - Quantification Score — BUG 4 FIX */}
                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 }} className="bg-gray-900 border border-white/10 rounded-2xl p-6">
                    <div className="mb-6">
                        <h2 className="text-lg font-bold text-white">Bullet Point Quantification</h2>
                        <p className="text-sm text-gray-500">Top 10% of applicants quantify 80%+ of their bullets</p>
                    </div>
                    <div className="flex flex-col md:flex-row items-center gap-6 mb-6 p-5 bg-gray-950 border border-white/5 rounded-xl">
                        <div className="flex-1 w-full">
                            <div className="flex items-center justify-between text-sm mb-3">
                                <span className="text-gray-300">Quantified: <span className="text-amber-400 font-bold">{quantifiedCount}</span> / {quantifiedTotal} bullets</span>
                                <span className="font-bold text-amber-500">{quantPct}%</span>
                            </div>
                            <div className="w-full bg-gray-800 h-2.5 rounded-full overflow-hidden">
                                <motion.div initial={{ width: 0 }} animate={{ width: `${quantPct}%` }} transition={{ duration: 1 }} className="h-full bg-amber-500 rounded-full" />
                            </div>
                        </div>
                        <div className="flex-shrink-0 text-sm bg-amber-500/10 text-amber-400 border border-amber-500/20 px-4 py-2 rounded-lg flex items-center gap-2">
                            {quantPct >= 80
                                ? <><CheckCircle2 size={16} /> Great quantification!</>
                                : <><AlertTriangle size={16} /> Add metrics to reach 80% (top 10% of applicants)</>
                            }
                        </div>
                    </div>
                </motion.div>

                {/* Section 6 - Skills Panel */}
                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }} className="bg-gray-900 border border-white/10 rounded-2xl p-6">
                    <h2 className="text-lg font-bold text-white mb-6">Skills Overview</h2>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        <div className="flex flex-col h-full border border-emerald-500/20 bg-emerald-500/5 rounded-xl p-5">
                            <h3 className="text-sm font-semibold text-emerald-400 mb-4 flex items-center gap-2"><CheckCircle2 size={16} /> Matched Skills</h3>
                            <div className="flex flex-wrap gap-2 mb-4 flex-1 content-start">
                                {nlpResult?.matchedSkills?.length > 0 ? nlpResult.matchedSkills.map(s => (
                                    <span key={s} className="px-2.5 py-1 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-lg text-xs font-medium">{s}</span>
                                )) : <span className="text-xs text-gray-500">{hasJD ? 'No matches found against the JD.' : 'No Job Description provided to match against.'}</span>}
                            </div>
                            <div className="mt-auto pt-4 border-t border-emerald-500/10">
                                <p className="text-xs text-gray-400 flex justify-between mb-2"><span>Match Ratio</span> {nlpResult?.matchedSkills?.length || 0}/{(nlpResult?.matchedSkills?.length || 0) + (nlpResult?.missingSkills?.length || 0)}</p>
                                <div className="w-full h-1.5 bg-gray-900 rounded-full overflow-hidden"><div style={{ width: `${((nlpResult?.matchedSkills?.length || 0) / Math.max(1, (nlpResult?.matchedSkills?.length || 0) + (nlpResult?.missingSkills?.length || 0))) * 100}%` }} className="h-full bg-emerald-500" /></div>
                            </div>
                        </div>

                        <div className="flex flex-col h-full border border-rose-500/20 bg-rose-500/5 rounded-xl p-5">
                            <h3 className="text-sm font-semibold text-rose-400 mb-4 flex items-center gap-2"><Target size={16} /> Missing Skills</h3>
                            <div className="flex flex-wrap gap-2 mb-4 flex-1 content-start">
                                {nlpResult?.missingSkills?.length > 0 ? nlpResult.missingSkills.map(s => (
                                    <span key={s} className="px-2.5 py-1 bg-rose-500/10 text-rose-400 border border-rose-500/20 rounded-lg text-xs font-medium">{s}</span>
                                )) : <span className="text-xs text-gray-500">{hasJD ? 'Perfect! No skills missing based on JD.' : 'No Job Description provided.'}</span>}
                            </div>
                            <div className="mt-auto pt-4 border-t border-rose-500/10">
                                <p className="text-xs text-gray-400 flex justify-between mb-2"><span>Gap Identifier</span> {nlpResult?.missingSkills?.length || 0} skills to close</p>
                                <div className="w-full h-1.5 bg-gray-900 rounded-full overflow-hidden"><div style={{ width: `${((nlpResult?.missingSkills?.length || 0) / Math.max(1, (nlpResult?.matchedSkills?.length || 0) + (nlpResult?.missingSkills?.length || 0))) * 100}%` }} className="h-full bg-rose-500" /></div>
                            </div>
                        </div>

                        <div className="flex flex-col h-full border border-amber-500/20 bg-amber-500/5 rounded-xl p-5">
                            <h3 className="text-sm font-semibold text-amber-400 mb-4 flex items-center gap-2"><Award size={16} /> All Extracted Skills</h3>
                            <div className="flex-1 space-y-4">
                                {Object.entries(cats).map(([cat, skills]) => {
                                    const isExpanded = expandedSkills[cat] || false;
                                    const displayedSkills = isExpanded ? skills : skills.slice(0, 8);
                                    
                                    return skills.length > 0 && (
                                        <div key={cat}>
                                            <p className="text-[10px] uppercase tracking-wider text-gray-500 mb-1.5">{cat}</p>
                                            <div className="flex flex-wrap gap-1.5">
                                                {displayedSkills.map(s => (
                                                    <span key={s} className="px-2 py-0.5 bg-amber-500/10 text-amber-300 border border-amber-500/20 rounded md text-[11px]">{s}</span>
                                                ))}
                                                {!isExpanded && skills.length > 8 && (
                                                    <button onClick={() => toggleSkillCategory(cat)} className="px-2 py-0.5 text-[11px] text-amber-500/70 hover:text-amber-400 cursor-pointer transition-colors bg-amber-500/5 hover:bg-amber-500/10 border border-amber-500/10 rounded">
                                                        +{skills.length - 8} more
                                                    </button>
                                                )}
                                                {isExpanded && skills.length > 8 && (
                                                    <button onClick={() => toggleSkillCategory(cat)} className="px-2 py-0.5 text-[11px] text-amber-500/70 hover:text-amber-400 cursor-pointer transition-colors bg-amber-500/5 hover:bg-amber-500/10 border border-amber-500/10 rounded">
                                                        Show less
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                                {nlpResult.extractedSkills.length === 0 && <span className="text-xs text-gray-500">No skills identified.</span>}
                            </div>
                        </div>
                    </div>
                </motion.div>

                {/* Section 7 - Keyword Density — BUG 7 FIX: filtered + JD-aware subtitle */}
                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }} className="bg-gray-900 border border-white/10 rounded-2xl p-6">
                    <div className="mb-6">
                        <h2 className="text-lg font-bold text-white">Keyword Density</h2>
                        <p className="text-sm text-gray-500">
                            {hasJD ? 'How often key terms appear vs what the JD expects' : 'Top keywords found in your resume'}
                        </p>
                    </div>
                    <div className="flex flex-wrap gap-3">
                        {Object.entries(filteredKeywords).length > 0
                            ? Object.entries(filteredKeywords).sort((a,b) => b[1] - a[1]).map(([kw, count]) => {
                                const isPct = !Number.isInteger(count) && count <= 25;
                                const cClass = isPct
                                    ? (count >= 1.5 ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' : count >= 1.0 ? 'bg-amber-500/20 text-amber-300 border-amber-500/30' : 'bg-blue-500/20 text-blue-300 border-blue-500/30')
                                    : (count >= 5 ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' : count >= 2 ? 'bg-amber-500/20 text-amber-300 border-amber-500/30' : 'bg-blue-500/20 text-blue-300 border-blue-500/30');
                                return (
                                    <div key={kw} title={isPct ? `${count}% keyword share in your resume` : `Appears ${count} times in your resume`} className={`px-3 py-1.5 rounded-xl border flex items-center gap-2 cursor-help transition-colors hover:bg-opacity-80 ${cClass}`}>
                                        <span className="text-sm font-medium">{kw}</span>
                                        <span className="text-xs opacity-70">{isPct ? `${count}%` : `×${count}`}</span>
                                    </div>
                                );
                            })
                            : <p className="text-xs text-gray-500">No significant keywords detected.</p>
                        }
                    </div>
                </motion.div>

                {/* Section 8 - Bullet Point Optimizer — BUG 4 FIX: empty state */}
                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.6 }} className="bg-gray-900 border border-white/10 rounded-2xl p-6">
                    <div className="flex flex-col md:flex-row justify-between items-start md:items-end mb-6 gap-4">
                        <div>
                            <h2 className="text-lg font-bold text-white">Bullet Point Optimizer</h2>
                            <p className="text-sm text-gray-500">AI-suggested rewrites for maximum impact and quantifiable results</p>
                        </div>
                        {(openAIResult?.bulletImpactScores?.filter(b => b.rewritten && b.bullet).length ?? 0) > 0 && (
                            <button onClick={handleDownloadDocx} disabled={generatingDoc} className="w-full md:w-auto px-5 py-2.5 bg-amber-500 hover:bg-amber-400 transition-colors text-black font-semibold rounded-xl flex items-center justify-center gap-2 shadow-[0_0_15px_rgba(245,158,11,0.15)] disabled:opacity-50">
                                <Sparkles size={16} /> Apply All Rewrites & Download
                            </button>
                        )}
                    </div>
                    
                    {(openAIResult?.bulletImpactScores?.filter(b => b.rewritten && b.bullet).length ?? 0) > 0 ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {openAIResult!.bulletImpactScores.filter(b => b.rewritten && b.bullet).map((b, i) => (
                                <div key={i} className="bg-gray-950 border border-white/10 rounded-xl p-5 flex flex-col relative group">
                                    <div className="flex justify-between items-center mb-3">
                                        <span className="text-xs font-semibold tracking-wider text-gray-500 uppercase">Original</span>
                                        <span className="text-xs font-medium text-rose-400 bg-rose-500/10 px-2 py-0.5 rounded">Impact: {b.score}/10</span>
                                    </div>
                                    <p className="text-sm text-gray-400 line-through mb-4 leading-relaxed">{b.bullet}</p>
                                    
                                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-10 bg-gray-900 border border-amber-500/30 text-amber-400 text-[10px] font-bold uppercase tracking-widest px-3 py-1 rounded-full flex items-center gap-1 shadow-xl">
                                        <Sparkles size={10} /> AI Improved
                                    </div>
                                    
                                    <div className="flex-1 bg-amber-500/5 -mx-5 -mb-5 p-5 mt-2 border-t border-amber-500/20 rounded-b-xl">
                                        <div className="flex justify-between items-center mb-3">
                                            <span className="text-xs font-semibold tracking-wider text-amber-500 uppercase">Rewritten</span>
                                            <span className="text-xs font-medium text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded flex items-center gap-1">✨ Improved <Target size={10} /></span>
                                        </div>
                                        <p className="text-sm text-white leading-relaxed font-medium">{b.rewritten}</p>
                                    </div>
                                    
                                    <button onClick={() => handleCopy(b.rewritten)} className="absolute bottom-4 right-4 bg-gray-900 border border-amber-500/30 text-amber-400 hover:bg-amber-500 hover:text-black transition-colors p-2 rounded-lg shadow-lg opacity-0 group-hover:opacity-100 focus:opacity-100 flex items-center gap-1.5 text-xs font-semibold">
                                        {copiedBullet === b.rewritten ? <Check size={14} /> : <Copy size={14} />} 
                                        {copiedBullet === b.rewritten ? 'Copied' : 'Copy'}
                                    </button>
                                </div>
                            ))}
                        </div>
                    ) : (
                        /* BUG 4 FIX: empty state for bullet optimizer */
                        <div className="text-center py-10 bg-gray-950 border border-white/5 rounded-xl">
                            <Sparkles size={32} className="mx-auto text-gray-600 mb-3" />
                            <p className="text-sm text-gray-400 mb-2">No bullet rewrites available yet.</p>
                            <p className="text-xs text-gray-500 mb-4">This can happen if the AI scoring step timed out or is still processing.</p>
                            <button onClick={handleReanalyze} className="px-4 py-2 border border-amber-500/30 text-amber-400 hover:bg-amber-500/10 rounded-xl text-sm font-semibold transition-colors">
                                <RefreshCw size={14} className="inline mr-2" /> Re-analyze to generate rewrites
                            </button>
                        </div>
                    )}
                </motion.div>

                {/* Section 9 - Readability Analysis */}
                {readability && (
                    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.7 }} className="bg-gray-900 border border-white/10 rounded-2xl p-6">
                        <h2 className="text-lg font-bold text-white mb-6">Readability Analysis</h2>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                            {[
                                { l: 'Grade Level', v: `Grade ${readability.fkGrade}`, ok: readability.fkGrade >= 10 && readability.fkGrade <= 13 },
                                { l: 'Sentence Length', v: `${readability.avgSentenceLength} wds`, ok: readability.avgSentenceLength <= 20 },
                                { l: 'Action Verbs', v: `${readability.actionVerbCount}/${readability.totalBullets}`, ok: (readability.actionVerbCount/Math.max(1, readability.totalBullets)) > 0.7 },
                                { l: 'Passive Voice', v: `${readability.passiveBullets.length} detected`, ok: readability.passiveBullets.length === 0 }
                            ].map(m => (
                                <div key={m.l} className={`p-4 rounded-xl border ${m.ok ? 'bg-emerald-500/10 border-emerald-500/20' : 'bg-amber-500/10 border-amber-500/20'}`}>
                                    <p className="text-xs text-gray-400 mb-1">{m.l}</p>
                                    <p className={`text-xl font-bold ${m.ok ? 'text-emerald-400' : 'text-amber-400'}`}>{m.v}</p>
                                </div>
                            ))}
                        </div>
                        {readability.passiveBullets.length > 0 && (
                            <div className="bg-gray-950 p-5 rounded-xl border border-white/5">
                                <h3 className="text-sm font-semibold text-rose-400 mb-3 flex items-center gap-2"><AlertTriangle size={16} /> Passive Voice Detected</h3>
                                <ul className="space-y-3">
                                    {readability.passiveBullets.map((b, i) => (
                                        <li key={i} className="flex flex-col md:flex-row md:items-center justify-between gap-3 text-sm text-gray-400 border-b border-white/5 pb-3 last:border-0 last:pb-0">
                                            <span className="italic">"...{b.length > 80 ? b.substring(0, 80) + '...' : b}"</span>
                                            <button onClick={() => navigate('/coach')} className="whitespace-nowrap flex items-center gap-1.5 px-3 py-1.5 bg-gray-900 border border-white/10 hover:border-amber-500/50 hover:text-amber-400 rounded-lg text-xs font-semibold transition-colors">
                                                <MessageSquare size={12} /> Fix with AI
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}
                    </motion.div>
                )}

                {/* Section 10 - Strengths & Weaknesses — BUG 7 FIX: empty state fallbacks */}
                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.8 }} className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="bg-gray-900 border border-white/10 rounded-2xl p-6">
                        <h2 className="text-lg font-bold text-white mb-6 flex items-center gap-2"><CheckCircle2 className="text-emerald-500" /> Positive Signals</h2>
                        <div className="space-y-3">
                            {openAIResult?.strengths && openAIResult.strengths.length > 0 ? (
                                openAIResult.strengths.map((s, i) => (
                                    <div key={i} className="p-4 bg-emerald-500/5 border-l-2 border-emerald-500 rounded-r-xl">
                                        <p className="text-sm text-emerald-100">{s}</p>
                                    </div>
                                ))
                            ) : (
                                <div className="p-4 bg-gray-950 border border-white/5 rounded-xl text-center">
                                    <p className="text-xs text-gray-500 italic">No positive signals detected yet. Re-analyze with a job description for personalized feedback.</p>
                                </div>
                            )}
                        </div>
                    </div>
                    
                    <div className="bg-gray-900 border border-rose-500/20 rounded-2xl p-6 flex flex-col relative overflow-hidden">
                        <div className="absolute top-0 right-0 w-32 h-32 bg-rose-500/10 blur-3xl -mr-10 -mt-10 pointer-events-none" />
                        <h2 className="text-lg font-bold text-white mb-6 flex items-center gap-2"><AlertTriangle className="text-rose-500" /> Critical FAANG Deductions</h2>
                        <div className="space-y-3 flex-1 mb-6">
                            {(openAIResult?.weaknesses?.length ?? 0) > 0 ? (
                                openAIResult!.weaknesses.map((w, i) => (
                                    <div key={i} className="flex items-start gap-3 p-3 bg-rose-500/5 border border-rose-500/10 rounded-xl">
                                        <span className="flex-shrink-0 mt-0.5"><XCircle size={16} className="text-rose-500" /></span>
                                        <p className="text-sm text-rose-200">{w}</p>
                                    </div>
                                ))
                            ) : (
                                <div className="p-4 bg-gray-950 border border-white/5 rounded-xl text-center">
                                    <p className="text-xs text-gray-500 italic">No critical deductions found. Re-analyze for a detailed assessment.</p>
                                </div>
                            )}
                        </div>
                        
                        <h3 className="text-xs font-bold text-amber-500 uppercase tracking-widest mb-3 border-t border-white/5 pt-4">Required Fixes</h3>
                        <div className="space-y-3">
                            {(openAIResult?.improvements?.length ?? 0) > 0 ? (
                                openAIResult!.improvements.map((imp, i) => (
                                    <div key={i} className="flex items-center gap-3 p-3 bg-amber-500/5 border border-amber-500/10 rounded-xl">
                                        <span className="flex-shrink-0 w-6 h-6 rounded-full bg-amber-500/20 text-amber-400 flex items-center justify-center text-xs font-bold">{i+1}</span>
                                        <p className="text-sm text-amber-100">{imp}</p>
                                    </div>
                                ))
                            ) : (
                                <div className="p-3 bg-gray-950 border border-white/5 rounded-xl text-center">
                                    <p className="text-xs text-gray-500 italic">No specific fixes identified yet.</p>
                                </div>
                            )}
                        </div>
                    </div>
                </motion.div>

                {/* Section 11 - JD Match View — BUG 7 FIX: no stray "0" + BUG 2 FIX: proper no-JD handling */}
                {hasJD && (nlpResult?.similarityScore ?? 0) > 0 && (
                    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.9 }} className="bg-gray-900 border border-white/10 rounded-2xl p-6 relative overflow-hidden">
                        <div className="absolute top-0 right-0 w-64 h-64 bg-amber-500/5 blur-3xl -mr-20 -mt-20 pointer-events-none" />
                        <div className="mb-8 text-center md:text-left">
                            <h2 className="text-xl font-bold text-white">Job Description Match</h2>
                            <p className="text-sm text-gray-400">Keywords present in your resume vs required by the JD</p>
                        </div>
                        
                        <div className="grid grid-cols-1 md:grid-cols-[1fr_200px_1fr] gap-8 items-center">
                            <div className="bg-emerald-500/5 border border-emerald-500/10 rounded-2xl p-6 h-full text-center">
                                <h3 className="text-emerald-400 font-bold mb-4 flex items-center justify-center gap-2"><CheckCircle2 size={18} /> Matched Keywords</h3>
                                <div className="flex flex-wrap gap-2 justify-center">
                                    {nlpResult.matchedSkills.length > 0
                                        ? nlpResult.matchedSkills.map(s => <span key={s} className="px-3 py-1 bg-emerald-500/10 text-emerald-300 rounded-lg text-sm">{s}</span>)
                                        : <span className="text-xs text-gray-500">No matched keywords found.</span>
                                    }
                                </div>
                            </div>
                            
                            <div className="flex justify-center">
                                <CircularProgress score={nlpResult.similarityScore} colorClass={getColor(nlpResult.similarityScore)} icon={GitCompare} />
                            </div>

                            <div className="bg-rose-500/5 border border-rose-500/10 rounded-2xl p-6 h-full text-center">
                                <h3 className="text-rose-400 font-bold mb-4 flex items-center justify-center gap-2"><XCircle size={18} /> Missing Keywords</h3>
                                <div className="flex flex-wrap gap-2 justify-center">
                                    {nlpResult.missingSkills.length > 0
                                        ? nlpResult.missingSkills.map(s => <span key={s} className="px-3 py-1 bg-rose-500/10 text-rose-300 rounded-lg text-sm">{s}</span>)
                                        : <span className="text-xs text-gray-500">No missing keywords — great match!</span>
                                    }
                                </div>
                            </div>
                        </div>
                    </motion.div>
                )}
            </div>
        </div>
    );
}
