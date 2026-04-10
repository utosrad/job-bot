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
  error_message TEXT
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

// Auto-migrate on import
pool.query(SCHEMA).catch((e) => {
  console.error("[db] Migration failed:", e.message);
  process.exit(1);
});
