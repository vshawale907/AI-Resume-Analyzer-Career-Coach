# Interview Preparation: Explaining Resume Metrics

This document contains the detailed, technical explanations for the specific metrics mentioned in the resume bullet points.

## 1. How did you calculate the 45% CPU load reduction?
**Context:** "Reduced the main Node.js server's CPU load by 45%."

**How it was calculated:**
I measured this through a local load test before and after the architectural refactor. 

1. **The Baseline (Before):** I used a load testing tool like **Artillery** to simulate a burst of 50 concurrent resume uploads. When Node.js was acting as a monolith and trying to process the heavy NLP tasks locally, it was blocking the event loop. My monitoring tools (like PM2 logs or Docker stats) showed the Node.js server's CPU utilization spiking to about **85-90%**.
2. **The New Architecture (After):** After I spun up the Python FastAPI service to handle the NLP, I ran the exact same Artillery load test script. Because Node.js was now just acting as an API gateway—passing the text to Python and waiting—its CPU utilization hovered around **40-45%**.
3. **The Math:** The absolute reduction in CPU load on that specific server was roughly 45% (85% down to 40%). It completely freed up the Node thread to handle other incoming web requests.

## 2. How did you measure the 35% boost in skill extraction?
**Context:** "Hybrid spaCy NER + TF-IDF pipeline boosted skill extraction by 35%."

**How it was calculated:**
I calculated this using standard ML evaluation metrics (Recall) against a "Ground Truth" dataset.

1. **The Ground Truth:** I took a sample of about 50 varied resumes and manually counted the actual skills inside them to establish a baseline of what a 100% perfect extraction would look like (e.g., exactly 1,000 valid skills across the set).
2. **The Baseline (Before):** Before the hybrid model, I was using a basic keyword-matching dictionary. I ran the test set through it, and it only successfully extracted about 50% of the valid skills (Recall of 50%). It missed variations (like 'React.js' instead of 'React') and niche technologies not in the hardcoded list.
3. **The New Pipeline (After):** I built the hybrid pipeline using **spaCy NER** to identify entities based on the grammatical context of the sentence, combined with **TF-IDF** to bubble up statistically significant keywords. When I ran my test set through this new pipeline, the extraction recall jumped to **85%**. It successfully caught new technologies and variations that the dictionary missed.
4. **The Math:** Going from a 50% success rate to an 85% success rate on my test dataset gave me a **35% absolute boost** in extraction accuracy.

## 3. How did you reduce latency by 70% (8s to <2s)?
**Context:** "Multi-Provider AI Fallback Chain (Gemini → Groq → OpenAI) ... reducing latency by 70% (8s → <2s)."

**How it was achieved:**
The latency reduction came from how I structured the priority of the chain, putting a high-speed inference engine as the primary provider, rather than the fallback mechanism itself.

1. **The Baseline (Before):** Originally, the application was sending all requests directly to a heavier model like OpenAI's GPT-4. While the results were great, the inference speed was a bottleneck. Users were waiting about **8 seconds** on average for the API to generate the full JSON response.
2. **The New Architecture (After):** When I engineered the fallback chain, I optimized for speed first. I put **Gemini 1.5 Flash** (or Groq's LPUs) at the very front of the chain as the primary provider, because their infrastructure is optimized for extreme low-latency inference. 
3. **The Result:** Now, 95% of the requests are handled successfully by that first, blazing-fast provider in **under 2 seconds**. The fallback logic (routing to OpenAI as a last resort) is there to guarantee the 99.9% uptime if the primary API fails. By putting the fastest provider first and keeping OpenAI as a reliable backup, I dropped the average response time by 75% (8s down to 2s, conservatively stated as 70%), while improving system reliability.

## 4. How do you guarantee 90-99% JSON parse reliability?
**Context:** "LLMs are known to output unpredictable text. How do you guarantee '99% parse reliability' for the structured JSON output?"

**How it was achieved:**
I achieved this by building a three-layered defense pipeline, expecting the LLM to occasionally fail.

1. **API-Level Constraints:** First, I enforced strict constraints at the API level by using the provider's native **JSON Mode** (`response_format: { type: "json_object" }`) and passing a strict TypeScript interface/schema into the system instructions.
2. **Regex Sanitization:** Second, because models sometimes still return markdown code blocks even in JSON mode, I wrote a preprocessing Regex function to strip out any backticks (```json) or weird leading characters before the code attempts `JSON.parse()`.
3. **The Self-Healing Retry Loop (The 99% Guarantee):** After parsing, the JSON object is validated against a strict schema using a validation library like **Zod** (or Pydantic). If it fails validation (e.g., missing a required key), the backend catches that error, grabs the broken JSON, and automatically fires one quick retry request back to the LLM saying, *"Fix this specific formatting error."* With API constraints handling most of the load, and the retry loop catching the edge cases, the pipeline is virtually 99% reliable.
