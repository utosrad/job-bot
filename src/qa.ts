import crypto from "crypto";
import axios from "axios";
import { pool } from "./db.ts";

// ---------------------------------------------------------------------------
// Layer 1: Presets
// ---------------------------------------------------------------------------
const PRESETS: Record<string, string> = {
  "authorized to work": "Yes, I am authorized to work in Canada without requiring sponsorship.",
  "require sponsorship": "No, I do not require sponsorship.",
  "visa sponsorship": "No, I do not require visa sponsorship.",
  "work authorization": "I am a Canadian citizen and do not require work authorization sponsorship.",
  "legally eligible": "Yes, I am legally eligible to work in Canada.",
  "full name": "Umar Darsot",
  "phone": "416-474-9987",
  "email": "udarsot@gmail.com",
  "linkedin": "https://www.linkedin.com/in/umar-darsot/",
  "github": "https://github.com/utosrad",
  "website": "https://darsot.ca",
  "portfolio": "https://darsot.ca",
  "gpa": "I prefer not to disclose my GPA at this stage.",
  "graduation": "April 2029",
  "degree": "Bachelor of Mathematics, Financial Analysis and Risk Management, University of Waterloo",
  "university": "University of Waterloo",
  "salary": "I'm flexible and open to a competitive compensation package aligned with market rates.",
  "start date": "I am available to start on the date that works best for the team.",
  "hours per week": "40",
  "years of experience": "3",
  "gender": "Prefer not to say",
  "ethnicity": "Prefer not to say",
  "veteran": "No",
  "disability": "No",
};

function matchPreset(question: string): string | null {
  const lower = question.toLowerCase();
  for (const [key, value] of Object.entries(PRESETS)) {
    if (lower.includes(key)) return value;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Layer 2: DB memory
// ---------------------------------------------------------------------------
function hashQuestion(question: string): string {
  return crypto.createHash("sha256").update(question.trim().toLowerCase()).digest("hex");
}

async function lookupDb(question: string): Promise<string | null> {
  const hash = hashQuestion(question);
  const res = await pool.query(
    "SELECT answer FROM qa_pairs WHERE question_hash = $1",
    [hash]
  );
  if (res.rows.length === 0) return null;
  await pool.query(
    "UPDATE qa_pairs SET use_count = use_count + 1, updated_at = NOW() WHERE question_hash = $1",
    [hash]
  );
  return res.rows[0].answer as string;
}

async function saveToDb(question: string, answer: string, source: string): Promise<void> {
  const hash = hashQuestion(question);
  await pool.query(
    `INSERT INTO qa_pairs (question_hash, question_raw, answer, source, use_count, updated_at)
     VALUES ($1, $2, $3, $4, 1, NOW())
     ON CONFLICT (question_hash) DO UPDATE
       SET answer = EXCLUDED.answer, source = EXCLUDED.source,
           use_count = qa_pairs.use_count + 1, updated_at = NOW()`,
    [hash, question, answer, source]
  );
}

// ---------------------------------------------------------------------------
// Layer 3: Kimi (Moonshot AI)
// ---------------------------------------------------------------------------
const KIMI_SYSTEM = `You are answering job application questions on behalf of Umar Darsot, a UWaterloo BMath Co-op student (Financial Analysis and Risk Management, Expected April 2029).

BACKGROUND:
- Founding Engineer at Dapital (crypto trading startup): built iOS perpetual futures trading engine in Swift/UIKit processing 500+ orders/second, sub-80ms market data via Hyperliquid WebSockets/gRPC
- Technical Product Manager Intern at Interac Corp (Winter 2026): Customer Graph framework (12M+ users), BERT sentiment pipeline (50K+ posts/month), $180M transaction volume analysis
- Data Science Intern at Purolator (Summer 2025): spaCy NER automation saving 200+ hours/quarter, Docker/CI-CD refactor (4hr → 12min deploys), Apache Atlas data governance
- Projects: Project EVE (AV-HuBERT lip-reading 12.3% WER, Tacotron 2/HiFi-GAN 4.2 MOS), UFC prediction model (74% accuracy, 5000+ fights), I4 Hackathon 1st place (flight delay XGBoost + MILP gate optimizer + D3.js dashboard)
- Skills: Python, TypeScript, Swift, SQL, PyTorch, scikit-learn, FastAPI, Hono, Bun, React, AWS, GCP, Docker, Redis, PostgreSQL

Answer concisely (1-3 sentences unless a long answer is required). Be direct and confident. Never fabricate specific numbers not listed above.`;

async function askKimi(question: string): Promise<string> {
  const apiKey = process.env.KIMI_API_KEY;
  if (!apiKey) {
    console.warn("[qa] KIMI_API_KEY not set — returning placeholder answer");
    return "Please see my resume for relevant experience.";
  }

  const res = await axios.post(
    "https://api.moonshot.cn/v1/chat/completions",
    {
      model: "moonshot-v1-8k",
      messages: [
        { role: "system", content: KIMI_SYSTEM },
        { role: "user", content: question },
      ],
      max_tokens: 300,
      temperature: 0.3,
    },
    {
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      timeout: 20000,
    }
  );

  const data = res.data as { choices: { message: { content: string } }[] };
  return data.choices[0]?.message?.content?.trim() ?? "Please see my resume for relevant experience.";
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
export async function answerQuestion(question: string): Promise<string> {
  // Layer 1
  const preset = matchPreset(question);
  if (preset) return preset;

  // Layer 2
  try {
    const dbAnswer = await lookupDb(question);
    if (dbAnswer) return dbAnswer;
  } catch (e) {
    console.warn("[qa] DB lookup failed:", e);
  }

  // Layer 3
  let answer = "Please see my resume for relevant experience.";
  try {
    answer = await askKimi(question);
    await saveToDb(question, answer, "kimi");
  } catch (e) {
    console.error("[qa] Kimi failed:", e);
  }

  return answer;
}

export async function updateAnswer(question: string, answer: string): Promise<void> {
  await saveToDb(question, answer, "manual");
}
