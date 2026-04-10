# Setup

## 1. Google Sheets (5 minutes)
1. Create a new blank Google Sheet at sheets.google.com
2. Copy the sheet ID from the URL: `docs.google.com/spreadsheets/d/{SHEET_ID}/edit`
3. Go to script.google.com → New project
4. Paste the contents of `apps-script/Code.gs`
5. Replace `YOUR_SHEET_ID_HERE` with your actual sheet ID
6. Deploy → New deployment → Web app → Execute as: Me → Anyone → Deploy
7. Copy the deployment URL → paste into `SHEETS_WEBHOOK_URL` in .env

## 2. Telegram (2 minutes)
1. Message @BotFather on Telegram → /newbot → follow prompts → copy token
2. Message @userinfobot → copy your chat ID
3. Paste both into .env

## 3. Kimi API key (2 minutes)
1. Go to platform.moonshot.cn
2. Create account → API Keys → New key
3. Paste into KIMI_API_KEY in .env

## 4. Deploy to Railway
```bash
npm install -g @railway/cli
railway login
railway init     # name it job-bot
railway add      # add PostgreSQL — DATABASE_URL is auto-set
railway up       # deploys via Dockerfile
```
Then set all env vars in the Railway dashboard Variables tab.

## 5. Test
```bash
curl -X POST https://your-railway-url.railway.app/run
```
Check Telegram for notifications and your Google Sheet for the first row.

## 6. Manual trigger anytime
- `POST /run` — start a pipeline run
- `GET /stats` — counts by status
- `GET /applications` — last 50 applications
- `GET /qa` — all question/answer pairs
- `POST /qa` with `{ "question": "...", "answer": "..." }` — override a bad Kimi answer
