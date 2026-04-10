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

export async function sendRunStart(newCount: number): Promise<void> {
  await send(`🤖 Job Bot started — ${newCount} new listings`);
}

export async function sendApplicationResult(
  company: string,
  role: string,
  status: string,
  platform: string,
  url: string
): Promise<void> {
  const icon =
    status === "success" ? "✅ Applied" :
    status === "manual_required" ? "⚠️ Manual needed" :
    "❌ Failed";
  await send(`${icon}\n<b>${company}</b> — ${role}\nPlatform: ${platform}\n${url}`);
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
