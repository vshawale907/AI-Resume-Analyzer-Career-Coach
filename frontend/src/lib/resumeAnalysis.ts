// ============================================================
// resumeAnalysis.ts  — fixed for all 7 bugs
// ============================================================

export interface SectionStatus {
    name: string;
    status: 'present' | 'weak' | 'missing';
    tip: string;
}

export interface ReadabilityMetrics {
    fkGrade: number;
    avgSentenceLength: number;
    actionVerbCount: number;
    totalBullets: number;
    passiveBullets: string[];
}

// ─── BUG 4 FIX: large, accurate action-verb set ─────────────
const ACTION_VERBS = new Set([
    'led','built','designed','engineered','architected','launched',
    'reduced','increased','improved','automated','deployed','scaled',
    'optimized','delivered','managed','created','developed','implemented',
    'drove','spearheaded','orchestrated','championed','streamlined',
    'mentored','directed','executed','established','founded','analyzed',
    'resolved','transformed','modernized','integrated','secured','configured',
    'migrated','tested','debugged','accelerated','maximized','minimized',
    'generated','maintained','led','planned','produced','provided',
    'rebuilt','refactored','researched','reviewed','revised','shipped',
    'simplified','solved','supported','tracked','upgraded','validated',
    'achieved','administered','advised','aligned','allocated','architected',
    'assessed','collaborated','communicated','consolidated','constructed',
    'contributed','coordinated','crafted','customized','defined','demonstrated',
    'enabled','ensured','evaluated','facilitated','formulated','grew',
    'identified','influenced','initiated','innovated','introduced','leveraged',
    'monitored','negotiated','onboarded','operated','overhauled','owned',
    'partnered','pitched','presented','prioritized','processed','published',
    'recruited','shaped','standardized','structured','supervised','trained',
]);

// ─── BUG 3 FIX: Robust section detection ────────────────────
// Each entry has: human name, an array of heading patterns (regex strings),
// and optional content patterns for headingless detection.
interface SectionDef {
    name: string;
    // Regexes tested against individual LINES (case-insensitive)
    headingPatterns: RegExp[];
    // Fallback: content patterns tested against full text
    contentPatterns?: RegExp[];
    minContentWords: number;
}

const SECTION_DEFS: SectionDef[] = [
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
        // BUG 3: Was "certification" only — now catches all variants in any order
        name: 'Certifications',
        headingPatterns: [
            /^(certifications?|certificates?|licen[sc]es?\s*(&|and|\/)?\s*certifications?|professional\s+certifications?)\s*:?\s*$/i,
            /^(certifications?\s*(&|and|\/)\s*(achievements?|courses?|training|awards?|licen[sc]es?|credentials?))\s*:?\s*$/i,
            /^((courses?|achievements?|training|awards?)\s*(&|and|\/)\s*certifications?)\s*:?\s*$/i,
            /^(training|courses?|credentials?|accreditations?)\s*:?\s*$/i,
        ],
        contentPatterns: [
            // Credential IDs, badges, issuing bodies
            /\b(coursera|udemy|linkedin\s+learning|pluralsight|edx|udacity|datacamp|codecademy|aws\s+academy)\b/i,
            /\b(aws|azure|gcp|google|microsoft|oracle|cisco|comptia|pmi|scrum|isaca|salesforce)\s+(certified|certification|associate|professional|specialist|expert|architect|developer|academy)\b/i,
            /\b(certificate|certification|certified|credential(\s+id)?|badge|license)\b/i,
        ],
        minContentWords: 3,
    },
];

const BULLET_START_RE = /^[•\-\*–—▪◦⦿➤►\u2022\u25CF\u25AA\u2023]/;
const NUM_BULLET_START_RE = /^(\d+|[a-z])[.)]\s+\S/i;

/**
 * Extract all bullet-like items from raw PDF/DOCX text (BUG 4 FIX).
 * Handles:
 * - "•Text" (no space after bullet)
 * - "•\nText" (pdf-parse puts bullet glyph on its own line)
 * - Multi-line wrapped bullets (merges continuation lines until next bullet/heading)
 */
export function extractBulletLines(rawText: string): string[] {
    const rawLines = rawText.split('\n').map(l => l.trim());
    const mergedLines: string[] = [];

    for (let i = 0; i < rawLines.length; i++) {
        const line = rawLines[i];
        if (!line) continue;

        // Lone bullet symbol on its own line -> attach to next non-empty line
        if (/^[•\-\*–—▪◦⦿➤►\u2022\u25CF\u25AA\u2023]$/.test(line)) {
            if (i + 1 < rawLines.length && rawLines[i + 1]) {
                mergedLines.push('• ' + rawLines[++i]);
            }
            continue;
        }
        mergedLines.push(line);
    }

    const isHeadingLine = (line: string): boolean =>
        SECTION_DEFS.some(def => def.headingPatterns.some(p => p.test(line))) ||
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
            // Stop merging if we hit a section heading, date-range header, or title|tech line
            if (isHeadingLine(line) || /\b\d{4}\s*[-–]\s*(present|current|\d{4})\b/i.test(line) || /\|/.test(line)) {
                bullets.push(currentBullet.trim());
                currentBullet = null;
            } else {
                currentBullet += ' ' + line;
            }
        }
    }
    if (currentBullet) bullets.push(currentBullet.trim());

    return bullets.filter(b => b.length > 15);
}

// ─── BUG 6 FIX: Real formatting criteria ────────────────────
export interface FormattingCriteria {
    score: number; // 0-25
    breakdown: Array<{ label: string; passed: boolean; detail: string }>;
}

export function computeFormattingScore(rawText: string): FormattingCriteria {
    const lines = rawText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    const wordCount = rawText.trim().split(/\s+/).length;

    const checks = [
        // 1. Contact info present (email or phone)
        {
            label: 'Contact Info Present',
            weight: 4,
            pass: /[\w.+-]+@[\w-]+\.\w+/.test(rawText) || /\+?\d[\d\s\-().]{7,}\d/.test(rawText),
            detail: 'Resume should include an email address or phone number.',
        },
        // 2. Standard section headings (at least 3 of the 6 expected)
        {
            label: 'Standard Section Headings',
            weight: 5,
            pass: (() => {
                let found = 0;
                for (const def of SECTION_DEFS) {
                    const matched = lines.some(l =>
                        def.headingPatterns.some(p => p.test(l))
                    );
                    if (matched) found++;
                }
                return found >= 3;
            })(),
            detail: 'At least 3 standard sections (Experience, Education, Skills, etc.) should have clear headings.',
        },
        // 3. Reasonable length (300–1200 words = ~1-2 pages)
        {
            label: 'Appropriate Length (1–2 pages)',
            weight: 4,
            pass: wordCount >= 200 && wordCount <= 1200,
            detail: `Resume is ${wordCount} words. Ideal is 300–900 words (1-2 pages).`,
        },
        // 4. Consistent date formats
        {
            label: 'Consistent Date Formats',
            weight: 4,
            pass: (() => {
                const mmYYYY = (rawText.match(/\b(0?[1-9]|1[0-2])\/\d{4}\b/g) || []).length;
                const monYYYY = (rawText.match(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{4}/gi) || []).length;
                const total = mmYYYY + monYYYY;
                // OK if only one style is used, or no dates at all
                return total === 0 || (mmYYYY === 0 || monYYYY === 0);
            })(),
            detail: 'Use a single consistent date format throughout (e.g., "Jan 2022" or "01/2022").',
        },
        // 5. Bullet consistency (at least 3 real bullets exist)
        {
            label: 'Bullet Point Usage',
            weight: 4,
            pass: extractBulletLines(rawText).length >= 3,
            detail: 'Use bullet points to describe experience and achievements.',
        },
        // 6. No excessive all-caps lines (table/graphic ATS killer)
        {
            label: 'ATS-Friendly Formatting',
            weight: 4,
            pass: (() => {
                const capsLines = lines.filter(l => l.length > 10 && l === l.toUpperCase() && /[A-Z]{4,}/.test(l));
                return capsLines.length < 4;
            })(),
            detail: 'Too many ALL-CAPS lines may indicate tables or graphics that confuse ATS parsers.',
        },
    ];

    const totalWeight = checks.reduce((s, c) => s + c.weight, 0); // = 25
    const earnedWeight = checks.filter(c => c.pass).reduce((s, c) => s + c.weight, 0);
    const score = Math.round((earnedWeight / totalWeight) * 25);

    return {
        score,
        breakdown: checks.map(c => ({ label: c.label, passed: c.pass, detail: c.detail })),
    };
}

/** BUG 3 + BUG 6: Robust section checker using per-line heading regex + content fallback */
export function checkResumeSections(rawText: string): SectionStatus[] {
    const lines = rawText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    const fullText = rawText; // keep original case for content patterns

    return SECTION_DEFS.map(def => {
        // 1. Try heading patterns on individual lines
        let headingLineIdx = -1;
        for (let i = 0; i < lines.length; i++) {
            if (def.headingPatterns.some(p => p.test(lines[i]))) {
                headingLineIdx = i;
                break;
            }
        }

        if (headingLineIdx !== -1) {
            // Count words in the lines following the heading (up to next heading-like line)
            let wordCount = 0;
            for (let i = headingLineIdx + 1; i < lines.length && i < headingLineIdx + 30; i++) {
                // Stop if we hit another heading-like short line (all caps or ends in colon)
                if (lines[i].length < 40 && (lines[i].endsWith(':') || lines[i] === lines[i].toUpperCase())) break;
                wordCount += lines[i].split(/\s+/).filter(w => w.length > 0).length;
            }
            if (wordCount < def.minContentWords) {
                return { name: def.name, status: 'weak', tip: `"${def.name}" section found but has very little content. Expand it.` };
            }
            return { name: def.name, status: 'present', tip: 'Looks solid.' };
        }

        // 2. No heading found — try content patterns
        if (def.contentPatterns) {
            const hasContent = def.contentPatterns.some(p => p.test(fullText));
            if (hasContent) {
                return {
                    name: def.name,
                    status: 'weak',
                    tip: `Content detected but no clear "${def.name}" heading found. Add an explicit section header for ATS compatibility.`,
                };
            }
        }

        return {
            name: def.name,
            status: 'missing',
            tip: `Add a dedicated "${def.name}" section. ATS systems scan for it by name.`,
        };
    });
}

/** Legacy alias kept for backward compat */
export function computeSectionCompleteness(rawText: string): number {
    const statuses = checkResumeSections(rawText);
    let score = 0;
    statuses.forEach(s => {
        if (s.status === 'present') score += 1;
        else if (s.status === 'weak') score += 0.5;
    });
    return Math.round((score / statuses.length) * 25);
}

/** BUG 4 FIX: Count quantified bullets from real bullet lines */
export function countQuantifiedBullets(rawText: string): { count: number; total: number } {
    const bullets = extractBulletLines(rawText);
    // Also include lines with numbers that look like achievement statements even without a bullet marker
    const allLines = rawText.split('\n')
        .map(l => l.trim())
        .filter(l => l.length > 20 && !/^([\w\s]+):?\s*$/.test(l)); // exclude short heading-like lines

    const targetLines = bullets.length > 0 ? bullets : allLines;
    const quantRegex = /\b\d+(?:\.\d+)?[%$kKmMbBx+]|\$\d+|\d+\+?\s*(?:percent|million|billion|thousand|users?|customers?|clients?|hours?|days?|weeks?|months?|years?|people|engineers?|teams?|repos?|projects?|services?|modules?|endpoints?|tests?|nodes?|contracts?|jobs?|ms|s)\b|\b(?:sub-?\d+ms|under\s+\d+\s*ms|\d+-\w+)\b/i;
    const count = targetLines.filter(l => quantRegex.test(l)).length;
    return { count, total: Math.max(1, targetLines.length) };
}

/** BUG 4 FIX: Readability now works from actual bullet extraction */
export function computeReadability(rawText: string, _legacyBullets: string[]): ReadabilityMetrics {
    const words = rawText.trim().split(/\s+/).filter(w => w.length > 0);
    const sentences = rawText.split(/[.!?]+/).filter(s => s.trim().length > 0);

    const wordCount = Math.max(1, words.length);
    const sentenceCount = Math.max(1, sentences.length);
    const syllables = words.reduce((count, word) => {
        const m = word.toLowerCase().match(/[aeiouy]+/g);
        return count + (m ? m.length : 1);
    }, 0);

    const fkGrade = Math.max(0, Math.round((0.39 * (wordCount / sentenceCount) + 11.8 * (syllables / wordCount) - 15.59) * 10) / 10);
    const avgSentenceLength = Math.round(wordCount / sentenceCount);

    // Extract REAL bullets from text
    const bullets = extractBulletLines(rawText);

    let actionVerbCount = 0;
    const passiveBullets: string[] = [];

    for (const bullet of bullets) {
        const firstWord = bullet.trim().split(/\s+/)[0]?.toLowerCase().replace(/[^a-z]/g, '') ?? '';
        if (ACTION_VERBS.has(firstWord)) actionVerbCount++;
        if (/\b(was|were|been|being)\s+\w+ed\b/i.test(bullet)) passiveBullets.push(bullet);
    }

    return { fkGrade, avgSentenceLength, actionVerbCount, totalBullets: bullets.length, passiveBullets };
}

// ─── BUG 5 FIX: Large skill taxonomy with alias normalization ─
const SKILL_ALIASES: Record<string, string> = {
    'node.js': 'Node.js', 'nodejs': 'Node.js', 'node js': 'Node.js',
    'react.js': 'React', 'reactjs': 'React', 'react js': 'React',
    'next.js': 'Next.js', 'nextjs': 'Next.js',
    'vue.js': 'Vue', 'vuejs': 'Vue',
    'postgresql': 'PostgreSQL', 'postgres': 'PostgreSQL', 'psql': 'PostgreSQL',
    'kubernetes': 'Kubernetes', 'k8s': 'Kubernetes',
    'javascript': 'JavaScript', 'js': 'JavaScript',
    'typescript': 'TypeScript', 'ts': 'TypeScript',
    'python3': 'Python',
    'golang': 'Go',
    'c#': 'C#', 'csharp': 'C#',
    'c++': 'C++', 'cpp': 'C++',
    'mongodb': 'MongoDB', 'mongo': 'MongoDB',
    'mysql': 'MySQL',
    'graphql': 'GraphQL',
    'tailwindcss': 'Tailwind CSS', 'tailwind': 'Tailwind CSS',
    'scss': 'Sass/SCSS', 'sass': 'Sass/SCSS',
    'aws': 'AWS', 'amazon web services': 'AWS',
    'gcp': 'GCP', 'google cloud': 'GCP',
    'azure': 'Azure', 'microsoft azure': 'Azure',
    'tensorflow': 'TensorFlow',
    'pytorch': 'PyTorch',
    'scikit-learn': 'scikit-learn', 'sklearn': 'scikit-learn',
    'nlp': 'NLP',
    'llm': 'LLM',
    'ml': 'Machine Learning',
    'ci/cd': 'CI/CD', 'cicd': 'CI/CD',
    'github actions': 'GitHub Actions',
    'gitlab ci': 'GitLab CI',
    'spacy': 'spaCy',
    'langchain': 'LangChain',
    'openai': 'OpenAI',
    'fastapi': 'FastAPI',
    'springboot': 'Spring Boot', 'spring boot': 'Spring Boot',
    'expressjs': 'Express', 'express.js': 'Express',
    'qdrant': 'Qdrant', 'pinecone': 'Pinecone', 'weaviate': 'Weaviate', 'milvus': 'Milvus',
    'redis': 'Redis', 'bullmq': 'BullMQ', 'rabbitmq': 'RabbitMQ', 'kafka': 'Kafka',
    'jest': 'Jest', 'mocha': 'Mocha', 'cypress': 'Cypress', 'vitest': 'Vitest',
    'terraform': 'Terraform', 'ansible': 'Ansible', 'pulumi': 'Pulumi',
    'nginx': 'Nginx', 'apache': 'Apache',
    'linux': 'Linux', 'unix': 'Unix',
    'git': 'Git', 'github': 'GitHub', 'gitlab': 'GitLab', 'bitbucket': 'Bitbucket',
    'solidity': 'Solidity', 'web3': 'Web3', 'ethereum': 'Ethereum', 'ethers.js': 'Ethers.js', 'ipfs': 'IPFS',
    'erc-721': 'ERC-721', 'erc-1155': 'ERC-1155', 'pinata': 'Pinata',
    'langgraph': 'LangGraph', 'text-to-sql': 'Text-to-SQL', 'embeddings': 'Embeddings', 'tf-idf': 'TF-IDF',
    'aws s3': 'AWS S3', 's3': 'AWS S3', 'websocket': 'WebSockets', 'websockets': 'WebSockets',
    'bcrypt': 'bcrypt', 'joi': 'Joi', 'bull': 'Bull', 'caching': 'Caching',
    'figma': 'Figma', 'sketch': 'Sketch',
    'stripe': 'Stripe', 'twilio': 'Twilio', 'sendgrid': 'SendGrid',
    'prisma': 'Prisma', 'typeorm': 'TypeORM', 'sequelize': 'Sequelize',
    'elasticsearch': 'Elasticsearch', 'opensearch': 'OpenSearch',
    'pandas': 'Pandas', 'numpy': 'NumPy', 'matplotlib': 'Matplotlib',
    'jwt': 'JWT', 'oauth': 'OAuth', 'oauth2': 'OAuth2',
    'rest': 'REST API', 'rest api': 'REST API', 'restful': 'REST API',
    'microservices': 'Microservices',
    'agile': 'Agile', 'scrum': 'Scrum', 'kanban': 'Kanban',
    'dsa': 'DSA', 'oop': 'OOP', 'dbms': 'DBMS',
};

const LANGUAGES = new Set(['javascript','typescript','python','java','c++','cpp','c#','csharp','go','golang','rust','swift','kotlin','scala','ruby','php','dart','elixir','haskell','clojure','r','matlab','bash','shell','powershell','sql','html','css','solidity']);
const FRAMEWORKS = new Set(['react','angular','vue','svelte','nextjs','nuxtjs','gatsby','remix','express','fastapi','django','flask','spring','springboot','rails','laravel','nestjs','koa','hapi','fiber','gin','echo','actix','ethersjs','bull','bullmq','joi','websocket','websockets']);
const DATABASES = new Set(['mongodb','postgresql','mysql','sqlite','redis','elasticsearch','cassandra','dynamodb','neo4j','couchdb','firebase','supabase','planetscale','cockroachdb','influxdb','clickhouse','qdrant','pinecone','weaviate','milvus','chroma','ipfs','pinata']);
const CLOUD_DEVOPS = new Set(['aws','awss3','s3','gcp','azure','docker','kubernetes','terraform','ansible','pulumi','jenkins','github actions','githubactions','gitlab ci','circleci','travisci','nginx','apache','linux','unix','heroku','vercel','netlify','cloudflare','railway','render','cicd','devops']);
const AI_ML = new Set(['machine learning','deep learning','nlp','computer vision','tensorflow','pytorch','scikit-learn','sklearn','pandas','numpy','matplotlib','hugging face','huggingface','transformers','langchain','langgraph','openai','llm','rag','text-to-sql','texttosql','embeddings','tfidf','tf-idf','spacy','nltk','keras','xgboost','lightgbm','stable diffusion','diffusion models','reinforcement learning','bert','gpt']);
const TESTING = new Set(['jest','mocha','chai','jasmine','cypress','playwright','selenium','vitest','pytest','junit','testng','rspec','enzyme','testing library','k6','postman']);
const TOOLS = new Set(['git','github','gitlab','bitbucket','jira','confluence','notion','figma','sketch','postman','insomnia','vscode','intellij','datadog','grafana','prometheus','sentry','newrelic','splunk','sonarqube','webpack','vite','babel','eslint','prettier','storybook','swagger','stripe','twilio','sendgrid','jwt','oauth','oauth2','bcrypt','web3','ethereum','erc721','erc1155']);

function normalizeSkill(raw: string): string {
    const lower = raw.toLowerCase().trim();
    return SKILL_ALIASES[lower] ?? (raw.charAt(0).toUpperCase() + raw.slice(1));
}

export function categorizeSkills(extractedSkills: string[]) {
    const cats: Record<string, string[]> = {
        Languages: [],
        Frameworks: [],
        Databases: [],
        'Cloud & DevOps': [],
        'AI / ML': [],
        Testing: [],
        Tools: [],
        Other: [],
    };
    const seen = new Set<string>();

    for (const rawSkill of extractedSkills) {
        const normalized = normalizeSkill(rawSkill);
        if (seen.has(normalized.toLowerCase())) continue;
        seen.add(normalized.toLowerCase());

        const lower = rawSkill.toLowerCase().replace(/[\s.\-]/g, '');
        if (LANGUAGES.has(lower) || LANGUAGES.has(rawSkill.toLowerCase())) cats.Languages.push(normalized);
        else if (FRAMEWORKS.has(lower) || FRAMEWORKS.has(rawSkill.toLowerCase())) cats.Frameworks.push(normalized);
        else if (DATABASES.has(lower) || DATABASES.has(rawSkill.toLowerCase())) cats.Databases.push(normalized);
        else if (CLOUD_DEVOPS.has(lower) || CLOUD_DEVOPS.has(rawSkill.toLowerCase())) cats['Cloud & DevOps'].push(normalized);
        else if (AI_ML.has(lower) || AI_ML.has(rawSkill.toLowerCase())) cats['AI / ML'].push(normalized);
        else if (TESTING.has(lower) || TESTING.has(rawSkill.toLowerCase())) cats.Testing.push(normalized);
        else if (TOOLS.has(lower) || TOOLS.has(rawSkill.toLowerCase())) cats.Tools.push(normalized);
        else cats.Other.push(normalized);
    }

    // Remove empty categories
    return Object.fromEntries(Object.entries(cats).filter(([, v]) => v.length > 0));
}

// ─── BUG 7: Stopword filter for keyword density ─────────────
const DENSITY_STOPWORDS = new Set([
    'the','and','for','with','that','this','from','are','was','were','has','have',
    'been','will','can','may','should','would','could','not','its','into','your',
    'our','their','they','we','you','he','she','it','is','of','to','in','on','at',
    'by','or','an','a','as','be','do','did','had','than','then','when','where',
    'which','who','what','how','all','any','some','more','most','also','just',
    // BUG 7 fix: generic technical noise words
    'built','text','multi','document','using','used','added','make','data','new','set',
    'get','use','help','way','based','made','work','let','tool','via','per','resume',
    'each','one','two','three','four','five','six','seven','eight','nine','ten',
]);

export function filterKeywordDensity(raw: Record<string, number>): Record<string, number> {
    return Object.fromEntries(
        Object.entries(raw)
            .filter(([kw]) => !DENSITY_STOPWORDS.has(kw.toLowerCase()) && kw.length > 2)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 25)
    );
}
