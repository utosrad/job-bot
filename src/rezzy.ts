import axios from "axios";

const REZZY_BASE = "https://api.rezzy.dev/v1";

function getApiKey(): string {
  const key = process.env.REZZY_API_KEY;
  if (!key) throw new Error("REZZY_API_KEY is not set");
  return key;
}

export async function fetchJobDescription(url: string): Promise<string> {
  try {
    const res = await axios.get(url, { timeout: 15000 });
    const html: string = res.data as string;
    // Strip HTML tags
    const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    return text.slice(0, 6000);
  } catch (e) {
    console.warn("[rezzy] fetchJobDescription failed for", url, e);
    return "";
  }
}

function extractUrl(data: Record<string, unknown>): string | null {
  const candidates = ["pdf_url", "resume_pdf_url", "resume_url", "url", "download_url"];
  for (const key of candidates) {
    if (typeof data[key] === "string" && data[key]) return data[key] as string;
  }
  return null;
}

export async function tailorResume(
  title: string,
  company: string,
  jobDescription: string
): Promise<{ resumeUrl: string | null; coverLetterUrl: string | null }> {
  const key = getApiKey();
  const headers = { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
  const body = { title: `${title} at ${company}`, job_description: jobDescription };

  let resumeUrl: string | null = null;
  let coverLetterUrl: string | null = null;

  // Resume
  try {
    const res = await axios.post(`${REZZY_BASE}/resume/create`, body, { headers, timeout: 30000 });
    const data = res.data as Record<string, unknown>;
    console.log("[rezzy] response:", JSON.stringify(data));
    resumeUrl = extractUrl(data) ?? JSON.stringify(data);
  } catch (e: any) {
    console.error("[rezzy] resume create failed:", e.message);
    resumeUrl = null;
  }

  // Cover letter (optional)
  try {
    const res = await axios.post(`${REZZY_BASE}/cover-letter/create`, body, { headers, timeout: 30000 });
    const data = res.data as Record<string, unknown>;
    console.log("[rezzy] cover-letter response:", JSON.stringify(data));
    coverLetterUrl = extractUrl(data) ?? null;
  } catch (e: any) {
    // 404 or any error — skip gracefully
    console.warn("[rezzy] cover letter skipped:", e.message);
    coverLetterUrl = null;
  }

  return { resumeUrl, coverLetterUrl };
}
