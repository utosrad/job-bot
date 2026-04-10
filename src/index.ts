import { Hono } from "hono";
import cron from "node-cron";
import { runPipeline } from "./pipeline.ts";
import { pool } from "./db.ts";
import { updateAnswer } from "./qa.ts";

const app = new Hono();

// Start cron
const schedule = process.env.CRON_SCHEDULE ?? "0 8,20 * * *";
cron.schedule(schedule, () => runPipeline().catch(console.error), {
  timezone: process.env.TZ ?? "America/Toronto",
});
console.log(`[cron] Scheduled: ${schedule}`);

// Run immediately on start if requested
if (process.env.RUN_ON_START === "true") {
  runPipeline().catch(console.error);
}

// Routes
app.get("/", (c) => c.json({ status: "ok", service: "job-bot" }));

app.post("/run", async (c) => {
  runPipeline().catch(console.error);
  return c.json({ started: true });
});

app.get("/stats", async (c) => {
  const res = await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE status = 'applied') AS applied,
      COUNT(*) FILTER (WHERE status = 'failed') AS failed,
      COUNT(*) FILTER (WHERE status = 'pending') AS pending,
      COUNT(*) AS total
    FROM seen_jobs
  `);
  return c.json(res.rows[0]);
});

app.get("/applications", async (c) => {
  const res = await pool.query(`
    SELECT sj.company_name, sj.title, sj.status, sj.first_seen_at,
           a.ats_platform, a.submission_status, a.applied_at, a.rezzy_resume_url
    FROM seen_jobs sj
    LEFT JOIN applications a ON a.job_id = sj.id
    ORDER BY sj.first_seen_at DESC LIMIT 50
  `);
  return c.json(res.rows);
});

app.get("/qa", async (c) => {
  const res = await pool.query(
    "SELECT question_raw, answer, source, use_count, updated_at FROM qa_pairs ORDER BY use_count DESC LIMIT 100"
  );
  return c.json(res.rows);
});

// Manual QA override — call this to correct a bad Kimi answer
app.post("/qa", async (c) => {
  const { question, answer } = await c.req.json<{ question?: string; answer?: string }>();
  if (!question || !answer) return c.json({ error: "question and answer required" }, 400);
  await updateAnswer(question, answer);
  return c.json({ saved: true });
});

export default { port: process.env.PORT ?? 3000, fetch: app.fetch };
