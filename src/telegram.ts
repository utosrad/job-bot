import axios from "axios";

function getConfig(): { token: string; chatId: string } | null {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return null;
  return { token, chatId };
}

async function send(text: string): Promise<void> {
  const cfg = getConfig();
  if (!cfg) return;
  try {
    await axios.post(
      `https://api.telegram.org/bot${cfg.token}/sendMessage`,
      { chat_id: cfg.chatId, text, parse_mode: "HTML" },
      { timeout: 10000 }
    );
  } catch (e) {
    console.warn("[telegram] Failed to send message:", e);
  }
}

// ---------------------------------------------------------------------------
// Webhook registration
// ---------------------------------------------------------------------------
export async function setupWebhook(baseUrl: string): Promise<void> {
  const cfg = getConfig();
  if (!cfg) return;
  const webhookUrl = `${baseUrl}/telegram-webhook`;
  try {
    await axios.post(
      `https://api.telegram.org/bot${cfg.token}/setWebhook`,
      { url: webhookUrl, allowed_updates: ["message"] },
      { timeout: 10000 }
    );
    console.log("[telegram] Webhook registered:", webhookUrl);
  } catch (e) {
    console.warn("[telegram] Failed to register webhook:", e);
  }
}

// ---------------------------------------------------------------------------
// Incoming update handler — called from POST /telegram-webhook
// ---------------------------------------------------------------------------
export async function handleUpdate(
  update: TelegramUpdate,
  onRun: () => void,
  getStats: () => Promise<string>
): Promise<void> {
  const cfg = getConfig();
  if (!cfg) return;

  const msg = update.message;
  if (!msg?.text) return;

  // Only respond to the configured chat ID (security: ignore anyone else)
  if (String(msg.chat.id) !== cfg.chatId) {
    console.warn("[telegram] Ignoring message from unknown chat:", msg.chat.id);
    return;
  }

  const text = msg.text.trim().toLowerCase();

  if (text === "/run" || text === "/run@" + (await getBotUsername(cfg.token))) {
    await send("🤖 Starting a pipeline run now...");
    onRun();
  } else if (text === "/stats") {
    const stats = await getStats();
    await send(stats);
  } else if (text === "/help") {
    await send(
      "<b>Job Bot commands</b>\n\n" +
      "/run — trigger a pipeline run now\n" +
      "/stats — show application counts\n" +
      "/help — show this message"
    );
  } else {
    await send("Unknown command. Send /help for options.");
  }
}

// Cache bot username so we only fetch it once
let cachedUsername: string | null = null;
async function getBotUsername(token: string): Promise<string> {
  if (cachedUsername) return cachedUsername;
  try {
    const res = await axios.get(`https://api.telegram.org/bot${token}/getMe`, { timeout: 5000 });
    cachedUsername = (res.data as { result: { username: string } }).result.username;
    return cachedUsername ?? "";
  } catch {
    return "";
  }
}

export interface TelegramUpdate {
  message?: {
    text?: string;
    chat: { id: number };
  };
}

// ---------------------------------------------------------------------------
// Outbound notification helpers
// ---------------------------------------------------------------------------
export async function sendRunStart(newCount: number): Promise<void> {
  await send(`🤖 Job Bot started — ${newCount} new listings`);
}

export async function sendApplicationResult(
  company: string,
  role: string,
  status: string,
  platform: string,
  originalUrl: string,
  resolvedUrl?: string
): Promise<void> {
  const icon =
    status === "success" ? "✅ Applied" :
    status === "manual_required" ? "⚠️ Manual needed" :
    "❌ Failed";

  // Human-readable platform label ("workday" → "Workday", "unknown" → "Unknown ATS")
  const platformLabel = platform === "unknown"
    ? "Unknown ATS"
    : platform.charAt(0).toUpperCase() + platform.slice(1);

  // Show both URLs when the redirect resolved to something different
  const urlChanged = resolvedUrl && resolvedUrl !== originalUrl;
  const urlLine = urlChanged
    ? `<a href="${resolvedUrl}">Direct link</a> (via <a href="${originalUrl}">listing</a>)`
    : `<a href="${originalUrl}">Apply link</a>`;

  await send(`${icon}\n<b>${company}</b> — ${role}\nPlatform: ${platformLabel}\n${urlLine}`);
}

export async function sendRunSummary(
  applied: number,
  failed: number,
  manual: number,
  sheetsUrl?: string
): Promise<void> {
  let msg = `📊 Done — applied: ${applied}, manual: ${manual}, failed: ${failed}`;
  if (sheetsUrl) msg += `\n${sheetsUrl}`;
  await send(msg);
}

export async function sendError(context: string, error: string): Promise<void> {
  await send(`🚨 Error in ${context}: ${error}`);
}
