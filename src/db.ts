import { Pool } from "pg";

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
});

const SCHEMA = `
CREATE TABLE IF NOT EXISTS seen_jobs (
  id TEXT PRIMARY KEY,
  company_name TEXT NOT NULL,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  locations TEXT[],
  status TEXT DEFAULT 'pending',
  first_seen_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS applications (
  id SERIAL PRIMARY KEY,
  job_id TEXT REFERENCES seen_jobs(id),
  applied_at TIMESTAMPTZ DEFAULT NOW(),
  ats_platform TEXT,
  submission_status TEXT,
  rezzy_resume_url TEXT,
  cover_letter_url TEXT,
  error_message TEXT,
  resolved_url TEXT
);

CREATE TABLE IF NOT EXISTS qa_pairs (
  id SERIAL PRIMARY KEY,
  question_hash TEXT UNIQUE NOT NULL,
  question_raw TEXT NOT NULL,
  answer TEXT NOT NULL,
  source TEXT DEFAULT 'kimi',
  use_count INT DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
`;

// Idempotent column additions for deployments where the table already exists
const MIGRATIONS = `
  ALTER TABLE applications ADD COLUMN IF NOT EXISTS resolved_url TEXT;
`;

// Auto-migrate on import — retry up to 10 times with backoff so Railway's
// PostgreSQL plugin has time to become reachable before we give up.
async function migrate(attempt = 1): Promise<void> {
  try {
    await pool.query(SCHEMA);
    await pool.query(MIGRATIONS);
    console.log("[db] Migration complete");
  } catch (e: any) {
    console.error(`[db] Migration failed (attempt ${attempt}):`, e.message);
    if (attempt >= 10) {
      console.error("[db] Giving up after 10 attempts — check DATABASE_URL");
      process.exit(1);
    }
    const delay = Math.min(attempt * 2000, 15000);
    await new Promise((r) => setTimeout(r, delay));
    await migrate(attempt + 1);
  }
}

migrate();
