import { scrapeNewListings } from "./scraper.ts";
import { fetchJobDescription, tailorResume } from "./rezzy.ts";
import { submitApplication } from "./ats.ts";
import { logToSheets } from "./sheets.ts";
import { sendRunStart, sendApplicationResult, sendRunSummary, sendError } from "./telegram.ts";
import { pool } from "./db.ts";

export async function runPipeline(): Promise<void> {
  console.log("[pipeline] Run started", new Date().toISOString());

  // 1. Scrape + dedup
  const newListings = await scrapeNewListings();
  if (newListings.length === 0) {
    console.log("[pipeline] No new listings. Done.");
    return;
  }

  await sendRunStart(newListings.length);
  let applied = 0, failed = 0, manual = 0;

  // 2. Process each listing
  for (const listing of newListings) {
    try {
      // Fetch JD
      const jobDesc = await fetchJobDescription(listing.url);

      // Tailor resume
      const { resumeUrl, coverLetterUrl } = await tailorResume(
        listing.title, listing.company_name, jobDesc
      );

      // Submit application
      const result = await submitApplication(listing.id, listing.url, resumeUrl);

      // Log to DB
      await pool.query(
        `INSERT INTO applications (job_id, ats_platform, submission_status, rezzy_resume_url, cover_letter_url, error_message)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [listing.id, result.platform, result.status, resumeUrl, coverLetterUrl, result.error ?? null]
      );

      // Log to Sheets
      await logToSheets({
        jobId: listing.id,
        company: listing.company_name,
        role: listing.title,
        location: listing.locations?.join(", ") ?? "",
        applyUrl: listing.url,
        status: result.status,
        platform: result.platform,
        resumeUrl: resumeUrl ?? "",
        appliedAt: new Date().toISOString(),
        notes: result.error ?? "",
      });

      // Notify Telegram
      await sendApplicationResult(listing.company_name, listing.title, result.status, result.platform, listing.url);

      if (result.status === "success") applied++;
      else if (result.status === "manual_required") manual++;
      else failed++;

      // Polite delay between submissions
      await new Promise<void>((r) => setTimeout(r, 4000));

    } catch (e: any) {
      console.error(`[pipeline] Error on ${listing.company_name}:`, e.message);
      await sendError(`${listing.company_name} — ${listing.title}`, e.message);
      await pool.query("UPDATE seen_jobs SET status = 'failed' WHERE id = $1", [listing.id]);
      failed++;
    }
  }

  await sendRunSummary(applied, failed, manual);
  console.log("[pipeline] Done", { applied, failed, manual });
}
