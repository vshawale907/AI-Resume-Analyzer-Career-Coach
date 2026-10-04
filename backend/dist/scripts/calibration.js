"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const openai_service_1 = require("../services/openai.service");
const nlp_client_1 = require("../services/nlp.client");
const runCalibration = async () => {
    const jobDescription = `
    Looking for a Software Engineer with backend experience.
    Must have Python, Kubernetes, cloud provider experience (AWS/GCP), and database experience (PostgreSQL/Redis).
    Should be able to optimize application latency.
    `;
    const strongResume = `
Software Engineer at Google (3 years)
- Reduced API latency by 40% by rewriting cache layer, saving $200K/year
- Led migration of 5 microservices to Kubernetes, cutting deploy time from 2hrs to 8min
- Built fraud detection model with 94% precision, blocking $2M in fraudulent transactions
Skills: Python, Go, Kubernetes, PostgreSQL, Redis, Kafka, AWS, GCP
    `;
    const weakResume = `
Software Engineer at Startup (3 years)
- Responsible for backend development
- Helped with database migrations
- Worked on improving application performance
- Assisted team with deployment processes
Skills: Python, some cloud experience
    `;
    console.log("=== Analyzing Strong Resume ===");
    const strongNlp = await nlp_client_1.nlpClient.analyzeResume({ resumeText: strongResume, jobDescriptionText: jobDescription });
    const strongScore = await (0, openai_service_1.scoreResume)(strongResume, strongNlp, jobDescription);
    console.log(JSON.stringify(strongScore, null, 2));
    console.log("\n\n=== Analyzing Weak Resume ===");
    const weakNlp = await nlp_client_1.nlpClient.analyzeResume({ resumeText: weakResume, jobDescriptionText: jobDescription });
    const weakScore = await (0, openai_service_1.scoreResume)(weakResume, weakNlp, jobDescription);
    console.log(JSON.stringify(weakScore, null, 2));
};
runCalibration().catch(console.error);
//# sourceMappingURL=calibration.js.map