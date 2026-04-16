/**
 * Debug script — run locally to see exactly what's failing on a real ATS form.
 *
 * Usage:
 *   bun run src/debug-apply.ts "https://job-boards.greenhouse.io/figma/jobs/5623087004"
 *
 * Opens a VISIBLE browser so you can watch what happens. Logs every label found,
 * every field filled, and saves screenshots at key points to /tmp/debug-*.png.
 *
 * Does NOT submit the form — press Ctrl+C or close the browser when done inspecting.
 */

import { chromium } from "playwright";

const url = process.argv[2];
if (!url) {
  console.error("Usage: bun run src/debug-apply.ts <url>");
  process.exit(1);
}

const FAKE_RESUME = "/tmp/debug-resume.pdf";

// Create a minimal fake PDF so the file upload doesn't error
import fs from "fs";
if (!fs.existsSync(FAKE_RESUME)) {
  // Minimal valid PDF bytes
  fs.writeFileSync(
    FAKE_RESUME,
    Buffer.from(
      "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj " +
      "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj " +
      "3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R>>endobj\n" +
      "xref\n0 4\n0000000000 65535 f\n0000000009 00000 n\n" +
      "0000000058 00000 n\n0000000115 00000 n\n" +
      "trailer<</Size 4/Root 1 0 R>>\nstartxref\n190\n%%EOF"
    )
  );
  console.log("[debug] Created fake PDF at", FAKE_RESUME);
}

async function run() {
  console.log("\n[debug] Opening:", url);

  const browser = await chromium.launch({
    headless: false,
    slowMo: 300, // slow enough to watch
    args: [
      "--no-sandbox",
      "--disable-blink-features=AutomationControlled",
      "--disable-dev-shm-usage",
    ],
  });

  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 900 },
  });

  const page = await context.newPage();

  // Log all console errors from the page
  page.on("console", (msg) => {
    if (msg.type() === "error") console.log("[page error]", msg.text());
  });

  // Navigate
  console.log("[debug] Navigating...");
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  } catch (e: any) {
    console.error("[debug] Navigation failed:", e.message);
    await browser.close();
    return;
  }

  const resolvedUrl = page.url();
  console.log("[debug] Resolved URL:", resolvedUrl);

  // Wait a bit for JS to hydrate
  await page.waitForTimeout(2000);

  // Screenshot 1: initial page load
  await page.screenshot({ path: "/tmp/debug-1-initial.png", fullPage: true });
  console.log("[debug] Screenshot: /tmp/debug-1-initial.png");

  // ── Audit: what labels exist on the page? ────────────────────────────────
  console.log("\n[debug] ── Labels found on page ──");
  const labels = await page.locator("label").allTextContents();
  labels.forEach((l, i) => console.log(`  [${i}] "${l.trim()}"`));

  // ── Audit: what input types exist? ───────────────────────────────────────
  console.log("\n[debug] ── Input fields ──");
  const inputs = page.locator("input, textarea, select");
  const inputCount = await inputs.count();
  for (let i = 0; i < inputCount; i++) {
    const el = inputs.nth(i);
    const type = await el.getAttribute("type").catch(() => "n/a");
    const name = await el.getAttribute("name").catch(() => "n/a");
    const id   = await el.getAttribute("id").catch(() => "n/a");
    const placeholder = await el.getAttribute("placeholder").catch(() => "");
    const required = await el.getAttribute("required").catch(() => null);
    const tag = await el.evaluate((e) => e.tagName.toLowerCase());
    console.log(`  [${i}] <${tag}> type=${type} name=${name} id=${id} placeholder="${placeholder}" required=${required !== null}`);
  }

  // ── Audit: submit buttons ─────────────────────────────────────────────────
  console.log("\n[debug] ── Submit buttons ──");
  const submitSelectors = [
    "button[type='submit']",
    "input[type='submit']",
    "button:has-text('Submit application')",
    "button:has-text('Submit')",
    "button:has-text('Apply')",
  ];
  for (const sel of submitSelectors) {
    const count = await page.locator(sel).count();
    if (count > 0) {
      const text = await page.locator(sel).first().textContent().catch(() => "");
      console.log(`  FOUND [${sel}] — text: "${text?.trim()}"`);
    }
  }

  // ── Try filling common fields ─────────────────────────────────────────────
  console.log("\n[debug] ── Attempting to fill common fields ──");

  const fieldAttempts: [string, string, string][] = [
    ["first.?name", "first name", "Umar"],
    ["last.?name",  "last name",  "Darsot"],
    ["email",       "email",      "udarsot@gmail.com"],
    ["phone",       "phone",      "416-474-9987"],
    ["linkedin",    "linkedin",   "https://www.linkedin.com/in/umar-darsot/"],
    ["github",      "github",     "https://github.com/utosrad"],
    ["website|portfolio", "website", "https://darsot.ca"],
  ];

  for (const [pattern, label, value] of fieldAttempts) {
    try {
      const el = page.getByLabel(new RegExp(pattern, "i")).first();
      const count = await el.count();
      if (count > 0) {
        await el.fill(value);
        console.log(`  ✓ Filled "${label}" → "${value}"`);
      } else {
        console.log(`  ✗ NOT FOUND: "${label}" (pattern: ${pattern})`);
      }
    } catch (e: any) {
      console.log(`  ✗ ERROR on "${label}": ${e.message}`);
    }
  }

  // ── Try file upload ───────────────────────────────────────────────────────
  console.log("\n[debug] ── File upload ──");
  try {
    const fileInput = page.locator("input[type='file']").first();
    const count = await fileInput.count();
    if (count > 0) {
      await fileInput.setInputFiles(FAKE_RESUME);
      console.log("  ✓ Set file input to", FAKE_RESUME);
    } else {
      console.log("  ✗ No file input found");
    }
  } catch (e: any) {
    console.log("  ✗ File upload error:", e.message);
  }

  // ── Audit: custom question selectors ─────────────────────────────────────
  console.log("\n[debug] ── Custom question selectors ──");
  const customSelectors: [string, string][] = [
    [".custom-question",              "greenhouse"],
    [".application-question",         "lever"],
    ["[data-testid='additional-card']", "ashby"],
  ];
  for (const [sel, platform] of customSelectors) {
    const count = await page.locator(sel).count();
    console.log(`  ${count > 0 ? "✓" : "✗"} ${platform} selector "${sel}" → ${count} element(s)`);
  }

  // ── Check for select (dropdown) elements ─────────────────────────────────
  console.log("\n[debug] ── Select / dropdown fields ──");
  const selects = page.locator("select");
  const selectCount = await selects.count();
  for (let i = 0; i < selectCount; i++) {
    const sel = selects.nth(i);
    const name = await sel.getAttribute("name").catch(() => "?");
    const id   = await sel.getAttribute("id").catch(() => "?");
    const options = await sel.locator("option").allTextContents();
    console.log(`  [${i}] name=${name} id=${id}`);
    console.log(`       options: ${options.slice(0, 6).map(o => `"${o.trim()}"`).join(", ")}${options.length > 6 ? "..." : ""}`);
  }

  // ── Check for Cloudflare / captcha ────────────────────────────────────────
  console.log("\n[debug] ── Bot detection check ──");
  const pageTitle = await page.title();
  const pageText  = (await page.locator("body").textContent().catch(() => "")).slice(0, 200);
  console.log("  Title:", pageTitle);
  if (/cloudflare|just a moment|captcha|verify you are human/i.test(pageTitle + pageText)) {
    console.log("  ⚠️  BOT DETECTION detected in page title/body");
  } else {
    console.log("  ✓ No obvious bot detection");
  }

  // Screenshot 2: after filling
  await page.screenshot({ path: "/tmp/debug-2-filled.png", fullPage: true });
  console.log("\n[debug] Screenshot after filling: /tmp/debug-2-filled.png");

  console.log("\n[debug] Done. Browser is open — inspect it, then close it manually.");
  console.log("[debug] Press Ctrl+C to exit.\n");

  // Keep the browser open for manual inspection
  await new Promise<void>(() => {}); // hang until Ctrl+C
}

run().catch((e) => {
  console.error("[debug] Fatal:", e);
  process.exit(1);
});
