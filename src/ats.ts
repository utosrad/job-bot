import { chromium } from "playwright";
import axios from "axios";
import fs from "fs";
import { pool } from "./db.ts";
import { answerQuestion } from "./qa.ts";

type Platform =
  | "greenhouse"
  | "lever"
  | "ashby"
  | "workday"
  | "icims"
  | "jobvite"
  | "smartrecruiters"
  | "bamboohr"
  | "taleo"
  | "rippling"
  | "unknown";

// Platforms we can identify but not automate (e.g. require account creation)
const KNOWN_UNSUPPORTED: ReadonlySet<Platform> = new Set([
  "workday", "icims", "jobvite", "smartrecruiters", "bamboohr", "taleo", "rippling",
]);

export interface ApplicationResult {
  status: "success" | "failed" | "manual_required";
  platform: Platform;
  resolvedUrl: string; // URL after all browser redirects; falls back to original if navigation failed
  error?: string;
}

function detectPlatform(url: string): Platform {
  if (/greenhouse\.io|grnh\.se/.test(url))                        return "greenhouse";
  if (/lever\.co|jobs\.lever\.co/.test(url))                      return "lever";
  if (/ashbyhq\.com|jobs\.ashbyhq\.com/.test(url))                return "ashby";
  if (/myworkdayjobs\.com|wd\d+\.myworkdayjobs\.com/.test(url))   return "workday";
  if (/icims\.com/.test(url))                                      return "icims";
  if (/jobvite\.com/.test(url))                                    return "jobvite";
  if (/smartrecruiters\.com/.test(url))                            return "smartrecruiters";
  if (/bamboohr\.com/.test(url))                                   return "bamboohr";
  if (/taleo\.net/.test(url))                                      return "taleo";
  if (/rippling\.com\/jobs/.test(url))                             return "rippling";
  return "unknown";
}

async function detectPlatformFromPage(page: import("playwright").Page): Promise<Platform> {
  try {
    const html = await page.content();
    if (/greenhouse\.io|grnh\.se/.test(html))       return "greenhouse";
    if (/lever\.co|data-lever/.test(html))          return "lever";
    if (/ashbyhq\.com/.test(html))                  return "ashby";
    if (/myworkdayjobs\.com/.test(html))            return "workday";
    if (/icims\.com/.test(html))                    return "icims";
    if (/jobvite\.com/.test(html))                  return "jobvite";
    if (/smartrecruiters\.com/.test(html))          return "smartrecruiters";
    if (/bamboohr\.com/.test(html))                 return "bamboohr";
    if (/taleo\.net/.test(html))                    return "taleo";
  } catch (e) {
    console.warn("[ats] detectPlatformFromPage failed:", e);
  }
  return "unknown";
}

async function detectLoginWall(page: import("playwright").Page): Promise<boolean> {
  try {
    for (const sel of [
      "input[type='password']",
      "button:has-text('Sign in')",
      "button:has-text('Log in')",
      "a:has-text('Create an account')",
    ]) {
      if (await page.locator(sel).first().count() > 0) return true;
    }
  } catch { /* ignore */ }
  return false;
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

// Fill <select> dropdowns for common work-authorization questions.
// These are silently skipped by tryFill (which only targets text inputs), but
// Greenhouse and Lever forms often require them before submission will work.
async function fillSelectFields(page: import("playwright").Page): Promise<void> {
  try {
    const selects = page.locator("select");
    const count = await selects.count();
    for (let i = 0; i < count; i++) {
      const sel = selects.nth(i);
      try {
        // Get the label text associated with this select (look for a sibling/parent label)
        const labelText = await sel.evaluate((el) => {
          const id = el.getAttribute("id");
          if (id) {
            const label = document.querySelector(`label[for="${id}"]`);
            if (label) return label.textContent ?? "";
          }
          // Walk up looking for a label ancestor or sibling
          let node: Element | null = el.parentElement;
          while (node) {
            const label = node.querySelector("label");
            if (label) return label.textContent ?? "";
            node = node.parentElement;
          }
          return "";
        });

        const label = labelText.toLowerCase();
        const options = await sel.locator("option").allTextContents();
        const optionValues = await sel.locator("option").evaluateAll(
          (els) => els.map((e) => (e as HTMLOptionElement).value)
        );

        // Helper: pick the first option whose text/value matches a keyword
        const pick = async (keywords: string[]) => {
          for (const kw of keywords) {
            const idx = options.findIndex((o) => o.toLowerCase().includes(kw));
            if (idx >= 0 && optionValues[idx]) {
              await sel.selectOption({ value: optionValues[idx] });
              console.log(`[ats] Selected "${options[idx].trim()}" for "${labelText.trim()}"`);
              return true;
            }
          }
          return false;
        };

        if (/authorized|legally|work in|eligible to work/i.test(label)) {
          await pick(["yes", "authorized", "eligible", "citizen", "permanent"]);
        } else if (/sponsor|visa|require.*sponsor/i.test(label)) {
          await pick(["no", "not require", "don't require"]);
        } else if (/gender/i.test(label)) {
          await pick(["prefer not", "decline", "not to self"]);
        } else if (/race|ethnicity|hispanic/i.test(label)) {
          await pick(["prefer not", "decline", "not to self", "not wish"]);
        } else if (/veteran/i.test(label)) {
          await pick(["not", "decline", "prefer not", "i am not"]);
        } else if (/disability/i.test(label)) {
          await pick(["no", "do not", "decline", "prefer not"]);
        } else if (/graduation|grad year/i.test(label)) {
          await pick(["2026", "2027"]);
        } else if (/degree|education|highest/i.test(label)) {
          await pick(["bachelor", "undergraduate", "b.s", "b.sc"]);
        } else {
          // For any other required select with a blank/placeholder first option, skip it
          // — don't guess blindly
        }
      } catch { /* skip this select */ }
    }
  } catch (e) {
    console.warn("[ats] fillSelectFields failed:", e);
  }
}

async function submitForm(page: import("playwright").Page): Promise<boolean> {
  const selectors = [
    "button[type='submit']",
    "input[type='submit']",
    "button:has-text('Submit application')",
    "button:has-text('Send application')",
    "button:has-text('Submit')",
    "button:has-text('Apply')",
  ];
  for (const sel of selectors) {
    try {
      const el = page.locator(sel).first();
      if (await el.count() > 0) {
        await el.click();
        // Wait for a success confirmation on the page; time out is fine — click already happened
        try {
          await page.waitForFunction(() => {
            const body = document.body.innerText.toLowerCase();
            return (
              body.includes("thank you") ||
              body.includes("application submitted") ||
              body.includes("application received") ||
              body.includes("we'll be in touch")
            );
          }, { timeout: 8000 });
        } catch { /* no confirmation text — optimistically continue */ }
        return true;
      }
    } catch { /* try next selector */ }
  }
  return false;
}

// Save a screenshot to /tmp for post-mortem debugging when form filling fails
async function screenshotOnFailure(page: import("playwright").Page, jobId: string): Promise<void> {
  try {
    const path = `/tmp/ats-fail-${jobId}.png`;
    await page.screenshot({ path, fullPage: true });
    console.log(`[ats] Failure screenshot saved: ${path}`);
  } catch { /* best-effort */ }
}

export async function submitApplication(
  jobId: string,
  applyUrl: string,
  resumeUrl: string | null
): Promise<ApplicationResult> {
  const browser = await chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      // Reduce bot-detection fingerprint
      "--disable-blink-features=AutomationControlled",
      "--disable-infobars",
    ],
  });

  let resolvedUrl = applyUrl; // fallback if navigation throws

  try {
    // Use a realistic browser context to reduce bot-detection flags
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      viewport: { width: 1280, height: 900 },
    });
    const page = await context.newPage();

    // Navigate first — this follows all HTTP + JS redirects
    // (e.g. simplify.jobs/p/... → greenhouse.io/...)
    try {
      await page.goto(applyUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
      resolvedUrl = page.url();
      // Give JS-rendered forms extra time to hydrate
      await page.waitForTimeout(2000);
    } catch (navError: any) {
      console.warn(`[ats] Navigation failed for ${applyUrl}:`, navError.message);
      await pool.query("UPDATE seen_jobs SET status = 'failed' WHERE id = $1", [jobId]);
      return { status: "failed", platform: "unknown", resolvedUrl, error: navError.message };
    }

    // Detect platform from the resolved URL; fall back to page content scan
    let platform = detectPlatform(resolvedUrl);
    if (platform === "unknown") {
      platform = await detectPlatformFromPage(page);
    }

    console.log(`[ats] ${applyUrl} → ${resolvedUrl} → platform: ${platform}`);

    // Known but unsupported ATS — flag as manual with the correct platform name
    if (KNOWN_UNSUPPORTED.has(platform)) {
      console.log(`[ats] Known-unsupported platform (${platform}) for job ${jobId}`);
      await pool.query("UPDATE seen_jobs SET status = 'manual_required' WHERE id = $1", [jobId]);
      return { status: "manual_required", platform, resolvedUrl };
    }

    // Truly unknown ATS
    if (platform === "unknown") {
      console.log(`[ats] Unknown platform for job ${jobId} at ${resolvedUrl}`);
      await pool.query("UPDATE seen_jobs SET status = 'manual_required' WHERE id = $1", [jobId]);
      return { status: "manual_required", platform, resolvedUrl };
    }

    // --- Supported platforms: Greenhouse, Lever, Ashby ---

    // Bail if the page is behind a login wall
    if (await detectLoginWall(page)) {
      console.log(`[ats] Login wall detected at ${resolvedUrl} for job ${jobId}`);
      await pool.query("UPDATE seen_jobs SET status = 'manual_required' WHERE id = $1", [jobId]);
      return { status: "manual_required", platform, resolvedUrl };
    }

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
    await fillSelectFields(page);

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
      await screenshotOnFailure(page, jobId);
      await pool.query("UPDATE seen_jobs SET status = 'manual_required' WHERE id = $1", [jobId]);
      return { status: "manual_required", platform, resolvedUrl };
    }

    // Wait briefly for the page to settle
    await page.waitForTimeout(3000);

    await pool.query("UPDATE seen_jobs SET status = 'applied' WHERE id = $1", [jobId]);
    return { status: "success", platform, resolvedUrl };

  } catch (e: any) {
    console.error("[ats] Error submitting application for job", jobId, ":", e.message);
    await pool.query("UPDATE seen_jobs SET status = 'failed' WHERE id = $1", [jobId]);
    return { status: "failed", platform: "unknown", resolvedUrl, error: e.message };
  } finally {
    await browser.close();
  }
}
