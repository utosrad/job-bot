import { chromium } from "playwright";
import axios from "axios";
import fs from "fs";
import { pool } from "./db.ts";
import { answerQuestion } from "./qa.ts";

type Platform = "greenhouse" | "lever" | "ashby" | "unknown";

export interface ApplicationResult {
  status: "success" | "failed" | "manual_required";
  platform: Platform;
  error?: string;
}

function detectPlatform(url: string): Platform {
  if (/greenhouse\.io|grnh\.se/.test(url)) return "greenhouse";
  if (/lever\.co|jobs\.lever/.test(url)) return "lever";
  if (/ashbyhq\.com|jobs\.ashbyhq/.test(url)) return "ashby";
  return "unknown";
}

async function downloadResume(resumeUrl: string): Promise<string> {
  const res = await axios.get(resumeUrl, { responseType: "arraybuffer", timeout: 30000 });
  const path = `/tmp/resume_${Date.now()}.pdf`;
  fs.writeFileSync(path, Buffer.from(res.data as ArrayBuffer));
  return path;
}

async function tryFill(page: import("playwright").Page, labelPattern: string, value: string): Promise<void> {
  try {
    await page.getByLabel(new RegExp(labelPattern, "i")).first().fill(value);
  } catch {
    // silently skip missing fields
  }
}

async function fillCommonFields(page: import("playwright").Page, resumePath: string): Promise<void> {
  const name = (process.env.APPLICANT_NAME ?? "Umar Darsot").split(" ");
  const firstName = name[0] ?? "Umar";
  const lastName = name.slice(1).join(" ") || "Darsot";

  await tryFill(page, "first.?name", firstName);
  await tryFill(page, "last.?name", lastName);
  await tryFill(page, "email", process.env.APPLICANT_EMAIL ?? "udarsot@gmail.com");
  await tryFill(page, "phone", process.env.APPLICANT_PHONE ?? "4164749987");
  await tryFill(page, "linkedin", process.env.APPLICANT_LINKEDIN ?? "https://www.linkedin.com/in/umar-darsot/");
  await tryFill(page, "github", process.env.APPLICANT_GITHUB ?? "https://github.com/utosrad");
  await tryFill(page, "website|portfolio", process.env.APPLICANT_WEBSITE ?? "https://darsot.ca");

  // Resume upload
  try {
    const fileInput = page.locator("input[type='file']").first();
    await fileInput.setInputFiles(resumePath);
  } catch {
    // silently skip if no file input
  }
}

async function fillCustomQuestions(
  page: import("playwright").Page,
  selector: string
): Promise<void> {
  try {
    const questions = page.locator(selector);
    const count = await questions.count();
    for (let i = 0; i < count; i++) {
      const qEl = questions.nth(i);
      let labelText = "";
      try {
        labelText = (await qEl.locator("label").first().textContent()) ?? "";
      } catch {
        continue;
      }
      if (!labelText.trim()) continue;

      const answer = await answerQuestion(labelText.trim());

      // Try textarea first, then input
      try {
        const textarea = qEl.locator("textarea").first();
        if (await textarea.count() > 0) {
          await textarea.fill(answer);
          continue;
        }
      } catch { /* ignore */ }

      try {
        const input = qEl.locator("input[type='text'], input:not([type])").first();
        if (await input.count() > 0) {
          await input.fill(answer);
        }
      } catch { /* ignore */ }
    }
  } catch (e) {
    console.warn("[ats] fillCustomQuestions failed:", e);
  }
}

async function submitForm(page: import("playwright").Page): Promise<boolean> {
  const selectors = [
    "button[type='submit']",
    "input[type='submit']",
    "button:has-text('Submit')",
    "button:has-text('Apply')",
  ];
  for (const sel of selectors) {
    try {
      const el = page.locator(sel).first();
      if (await el.count() > 0) {
        await el.click();
        return true;
      }
    } catch { /* try next */ }
  }
  return false;
}

export async function submitApplication(
  jobId: string,
  applyUrl: string,
  resumeUrl: string | null
): Promise<ApplicationResult> {
  const platform = detectPlatform(applyUrl);

  if (platform === "unknown") {
    console.log("[ats] Unknown platform for", applyUrl, "— manual required");
    await pool.query("UPDATE seen_jobs SET status = 'manual_required' WHERE id = $1", [jobId]);
    return { status: "manual_required", platform };
  }

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });

  try {
    const page = await browser.newPage();
    await page.goto(applyUrl, { waitUntil: "domcontentloaded", timeout: 30000 });

    // Download resume if we have one
    let resumePath: string | null = null;
    if (resumeUrl) {
      try {
        resumePath = await downloadResume(resumeUrl);
      } catch (e: any) {
        console.warn("[ats] Resume download failed:", e.message);
      }
    }

    await fillCommonFields(page, resumePath ?? "");

    // Platform-specific custom questions
    if (platform === "greenhouse") {
      await fillCustomQuestions(page, ".custom-question");
    } else if (platform === "lever") {
      await fillCustomQuestions(page, ".application-question");
    } else if (platform === "ashby") {
      await fillCustomQuestions(page, "[data-testid='additional-card']");
    }

    const submitted = await submitForm(page);
    if (!submitted) {
      await pool.query("UPDATE seen_jobs SET status = 'manual_required' WHERE id = $1", [jobId]);
      return { status: "manual_required", platform };
    }

    // Wait briefly for confirmation
    await page.waitForTimeout(3000);

    await pool.query("UPDATE seen_jobs SET status = 'applied' WHERE id = $1", [jobId]);
    return { status: "success", platform };

  } catch (e: any) {
    console.error("[ats] Error submitting application for job", jobId, ":", e.message);
    await pool.query("UPDATE seen_jobs SET status = 'failed' WHERE id = $1", [jobId]);
    return { status: "failed", platform, error: e.message };
  } finally {
    await browser.close();
  }
}
