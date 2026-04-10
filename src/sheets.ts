import axios from "axios";

export async function logToSheets(payload: {
  jobId: string;
  company: string;
  role: string;
  location: string;
  applyUrl: string;
  status: string;
  platform: string;
  resumeUrl: string;
  appliedAt: string;
  notes: string;
}): Promise<void> {
  const url = process.env.SHEETS_WEBHOOK_URL;
  if (!url) return; // silently skip if not configured
  try {
    await axios.post(url, payload, { timeout: 10000 });
  } catch (e) {
    console.warn("[sheets] Webhook failed:", e);
    // Never crash the pipeline over a Sheets logging failure
  }
}
