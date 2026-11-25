// Shared deterministic resume section, bullet, skill, and certification parser
// Aligned with frontend/src/lib/resumeAnalysis.ts and ai-service/app/core/nlp_engine.py

export interface SectionStatus {
    name: string;
    status: 'present' | 'weak' | 'missing';
    tip: string;
}

export interface ParsedSectionChunk {
    heading: string;
    content: string;
}

interface SectionDef {
    name: string;
    headingPatterns: RegExp[];
    contentPatterns?: RegExp[];
    minContentWords: number;
}

export const SECTION_DEFS: SectionDef[] = [
    {
        name: 'Summary / Objective',
        headingPatterns: [
            /^(professional\s+)?(summary|objective|profile|about(\s+me)?|overview|introduction|personal\s+statement)\s*:?\s*$/i,
            /^(career|executive)\s+(summary|profile|objective)\s*:?\s*$/i,
        ],
        contentPatterns: [
            /seeking\s+(a|an|the)\s+\w+\s+(position|role|opportunity)/i,
            /results[- ]driven|dynamic\s+professional|passionate\s+developer/i,
        ],
        minContentWords: 10,
    },
    {
        name: 'Work Experience',
        headingPatterns: [
            /^(work\s+)?(experience|history)\s*:?\s*$/i,
            /^(professional|employment|career|work)\s+(experience|history|background)\s*:?\s*$/i,
            /^internships?\s*:?\s*$/i,
        ],
        contentPatterns: [
            /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{4}\s*[-–]\s*(present|current|\d{4})/i,
            /\d{4}\s*[-–]\s*(present|current|\d{4})/,
        ],
        minContentWords: 20,
    },
    {
        name: 'Skills',
        headingPatterns: [
            /^(technical\s+|core\s+|key\s+|professional\s+|programming\s+)?(skills|competencies|expertise|capabilities|proficiencies|technologies|tech\s+stack)\s*:?\s*$/i,
            /^(languages|tools|frameworks|libraries)\s*:?\s*$/i,
        ],
        contentPatterns: [
            /\b(python|javascript|typescript|java|react|node\.?js|sql|aws|docker|kubernetes)\b/i,
        ],
        minContentWords: 5,
    },
    {
        name: 'Education',
        headingPatterns: [
            /^(academic\s+)?(education|qualifications?|academic\s+background|schooling)\s*:?\s*$/i,
        ],
        contentPatterns: [
            /\b(bachelor|b\.?sc|b\.?tech|b\.?e|master|m\.?sc|m\.?tech|mba|ph\.?d|phd|diploma)\b/i,
            /\b(university|college|institute|school)\s+of\b/i,
        ],
        minContentWords: 10,
    },
    {
        name: 'Projects',
        headingPatterns: [
            /^(personal\s+|side\s+|open[\s-]?source\s+)?(projects?|portfolio|work\s+samples?|personal\s+work)\s*:?\s*$/i,
            /^(selected|notable|key)\s+projects?\s*:?\s*$/i,
        ],
        contentPatterns: [
            /\bgithub\.com\/\S+/i,
            /\b(built|developed|created)\s+(a|an|the)\s+\w+\s+(app|application|tool|platform|system|website|api)\b/i,
        ],
        minContentWords: 15,
    },
    {
        name: 'Certifications',
        headingPatterns: [
            /^(certifications?|certificates?|licen[sc]es?\s*(&|and|\/)?\s*certifications?|professional\s+certifications?)\s*:?\s*$/i,
            /^(certifications?\s*(&|and|\/)\s*(achievements?|courses?|training|awards?|licen[sc]es?|credentials?))\s*:?\s*$/i,
            /^((courses?|achievements?|training|awards?)\s*(&|and|\/)\s*certifications?)\s*:?\s*$/i,
            /^(training|courses?|credentials?|accreditations?)\s*:?\s*$/i,
        ],
        contentPatterns: [
            /\b(coursera|udemy|linkedin\s+learning|pluralsight|edx|udacity|datacamp|codecademy|aws\s+academy)\b/i,
            /\b(aws|azure|gcp|google|microsoft|oracle|cisco|comptia|pmi|scrum|isaca|salesforce)\s+(certified|certification|associate|professional|specialist|expert|architect|developer|academy)\b/i,
            /\b(certificate|certification|certified|credential(\s+id)?|badge|license)\b/i,
        ],
        minContentWords: 3,
    },
];

const BULLET_START_RE = /^[•\-\*–—▪◦⦿➤►\u2022\u25CF\u25AA\u2023]/;
const NUM_BULLET_START_RE = /^(\d+|[a-z])[.)]\s+\S/i;

export function extractBulletLines(rawText: string): string[] {
    const rawLines = rawText.split('\n').map((l) => l.trim());
    const mergedLines: string[] = [];

    for (let i = 0; i < rawLines.length; i++) {
        const line = rawLines[i];
        if (!line) continue;

        if (/^[•\-\*–—▪◦⦿➤►\u2022\u25CF\u25AA\u2023]$/.test(line)) {
            if (i + 1 < rawLines.length && rawLines[i + 1]) {
                mergedLines.push('• ' + rawLines[++i]);
            }
            continue;
        }
        mergedLines.push(line);
    }

    const isHeadingLine = (line: string): boolean =>
        SECTION_DEFS.some((def) => def.headingPatterns.some((p) => p.test(line))) ||
        (line.length < 45 && (line.endsWith(':') || (line === line.toUpperCase() && /[A-Z]{3,}/.test(line))));

    const bullets: string[] = [];
    let currentBullet: string | null = null;

    for (const line of mergedLines) {
        if (BULLET_START_RE.test(line)) {
            if (currentBullet) bullets.push(currentBullet.trim());
            currentBullet = line.replace(/^[•\-\*–—▪◦⦿➤►\u2022\u25CF\u25AA\u2023]\s*/, '').trim();
        } else if (NUM_BULLET_START_RE.test(line)) {
            if (currentBullet) bullets.push(currentBullet.trim());
            currentBullet = line.replace(/^(\d+|[a-z])[.)]\s+/i, '').trim();
        } else if (currentBullet) {
            if (isHeadingLine(line) || /\b\d{4}\s*[-–]\s*(present|current|\d{4})\b/i.test(line) || /\|/.test(line)) {
                bullets.push(currentBullet.trim());
                currentBullet = null;
            } else {
                currentBullet += ' ' + line;
            }
        }
    }
    if (currentBullet) bullets.push(currentBullet.trim());

    return bullets.filter((b) => b.length > 15);
}

export function checkResumeSections(rawText: string): SectionStatus[] {
    const lines = rawText.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);

    return SECTION_DEFS.map((def) => {
        let headingLineIdx = -1;
        for (let i = 0; i < lines.length; i++) {
            if (def.headingPatterns.some((p) => p.test(lines[i]))) {
                headingLineIdx = i;
                break;
            }
        }

        if (headingLineIdx !== -1) {
            let wordCount = 0;
            for (let i = headingLineIdx + 1; i < lines.length && i < headingLineIdx + 30; i++) {
                if (lines[i].length < 40 && (lines[i].endsWith(':') || (lines[i] === lines[i].toUpperCase() && /[A-Z]{3,}/.test(lines[i])))) {
                    break;
                }
                wordCount += lines[i].split(/\s+/).filter((w) => w.length > 0).length;
            }
            if (wordCount < def.minContentWords) {
                return { name: def.name, status: 'weak', tip: `"${def.name}" section found but has very little content.` };
            }
            return { name: def.name, status: 'present', tip: 'Present.' };
        }

        if (def.contentPatterns && def.contentPatterns.some((p) => p.test(rawText))) {
            return {
                name: def.name,
                status: 'weak',
                tip: `Content detected without an explicit "${def.name}" heading.`,
            };
        }

        return {
            name: def.name,
            status: 'missing',
            tip: `Missing "${def.name}" section.`,
        };
    });
}

export function splitResumeIntoSections(rawText: string): ParsedSectionChunk[] {
    const lines = rawText.split('\n');
    const chunks: ParsedSectionChunk[] = [];
    let currentHeading = 'Header & Contact';
    let currentLines: string[] = [];

    const matchSectionHeading = (line: string): string | null => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.length > 60) return null;
        for (const def of SECTION_DEFS) {
            if (def.headingPatterns.some((p) => p.test(trimmed))) {
                return trimmed.replace(/:$/, '');
            }
        }
        return null;
    };

    for (const line of lines) {
        const matched = matchSectionHeading(line);
        if (matched) {
            if (currentLines.join('\n').trim().length > 0) {
                chunks.push({ heading: currentHeading, content: currentLines.join('\n').trim() });
            }
            currentHeading = matched;
            currentLines = [line.trim()];
        } else {
            currentLines.push(line);
        }
    }

    if (currentLines.join('\n').trim().length > 0) {
        chunks.push({ heading: currentHeading, content: currentLines.join('\n').trim() });
    }

    return chunks;
}

export function extractCertifications(rawText: string): string[] {
    const sections = splitResumeIntoSections(rawText);
    const certSection = sections.find((s) =>
        SECTION_DEFS.find((d) => d.name === 'Certifications')!.headingPatterns.some((p) => p.test(s.heading))
    );

    const results: string[] = [];
    const seen = new Set<string>();

    if (certSection) {
        const lines = certSection.content
            .split('\n')
            .map((l) => l.replace(/^[•\-\*–—▪◦⦿➤►]\s*/, '').trim())
            .filter((l) => l.length > 4 && l.toLowerCase() !== certSection.heading.toLowerCase());
        for (const l of lines) {
            const key = l.toLowerCase();
            if (!seen.has(key)) {
                seen.add(key);
                results.push(l);
            }
        }
    }

    // Also pick up certification lines outside explicit heading
    const certLineRe = /\b(certificate|certification|certified|credential\s+id|coursera|udemy|aws\s+certified|google\s+cloud\s+certified)\b/i;
    for (const rawLine of rawText.split('\n')) {
        const l = rawLine.replace(/^[•\-\*–—▪◦⦿➤►]\s*/, '').trim();
        if (l.length > 8 && l.length < 180 && certLineRe.test(l)) {
            const key = l.toLowerCase();
            if (!seen.has(key)) {
                seen.add(key);
                results.push(l);
            }
        }
    }

    return results;
}

export function truncateResumeBySections(
    resumeText: string,
    maxChars = 20000
): { text: string; truncated: boolean; omittedSections: string[] } {
    if (resumeText.length <= maxChars) {
        return { text: resumeText, truncated: false, omittedSections: [] };
    }

    const sections = splitResumeIntoSections(resumeText);
    const kept: string[] = [];
    const omittedSections: string[] = [];
    let currentLen = 0;

    for (const sec of sections) {
        const block = sec.content;
        const addition = (kept.length > 0 ? 2 : 0) + block.length;
        if (currentLen + addition <= maxChars) {
            kept.push(block);
            currentLen += addition;
        } else if (kept.length === 0) {
            // Single massive section: trim on line boundary
            kept.push(block.slice(0, maxChars - 120));
            currentLen = maxChars;
            omittedSections.push(`${sec.heading} (partial)`);
        } else {
            omittedSections.push(sec.heading);
        }
    }

    const notice = `\n\n[TRUNCATED: Resume exceeded ${maxChars} characters; omitted later sections: ${omittedSections.join(', ')}]`;
    return {
        text: kept.join('\n\n') + notice,
        truncated: true,
        omittedSections,
    };
}
