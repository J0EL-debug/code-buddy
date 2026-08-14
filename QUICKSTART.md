# Code Buddy Quick Start

No Docker, no database server, no paid services. The database is a local SQLite file.

## 1. Get a free Gemini API key

Go to https://aistudio.google.com/apikey, sign in with any Google account, click **Create API key**. No credit card, no approval wait.

## 2. Backend Setup

```bash
cd reviewbot-backend
npm install

cp .env.example .env
```

Edit `.env`:
```
DATABASE_URL=file:./dev.db

GEMINI_API_KEY=AIza...your key here
GEMINI_MODEL_NAME=gemini-flash-latest

JWT_SECRET=any-long-random-string
ADMIN_USERNAME=admin
ADMIN_PASSWORD=pick-a-password

FRONTEND_URL=http://localhost:5173
NODE_ENV=development
PORT=3000

# Only needed if you want GitHub PR automation - see step 5
GITHUB_ACCESS_TOKEN=
GITHUB_WEBHOOK_SECRET=
```

```bash
npx prisma generate
npx prisma db push
npm run start:dev
```

Backend runs on http://localhost:3000. API docs at http://localhost:3000/api/docs.

## 3. Frontend Setup

```bash
cd reviewbot-frontend
npm install
echo "VITE_API_URL=http://localhost:3000" > .env
npm run dev
```

Frontend runs on http://localhost:5173.

## 4. Try Review Code (no GitHub needed)

1. Log in with the `ADMIN_USERNAME` / `ADMIN_PASSWORD` from your `.env`
2. Click **Review Code**
3. Paste a snippet, or upload a file/zip, and choose **Review only** or **Review & fix**
4. Watch it process (PENDING → PROCESSING → COMPLETED) and see the results, with issues sorted by severity and clickable to jump to the flagged line

This is the whole feature - no repo, no webhook, no setup beyond the Gemini key.

## 5. Set Up GitHub PR Automation (optional)

### Get a GitHub token
1. https://github.com/settings/personal-access-tokens/new
2. Repository access: the repo(s) you want to test with
3. Permissions: **Pull requests** → Read and write, **Contents** → Read-only
4. Generate, copy the token into `GITHUB_ACCESS_TOKEN` in your `.env`

### Expose your backend publicly (for local testing)
GitHub needs to reach your backend from the internet. For local testing, use [ngrok](https://ngrok.com):
```bash
ngrok http 3000
```
Copy the `https://....ngrok-free.dev` URL it gives you.

(For a permanent setup, deploy the backend somewhere like Render or Railway instead of relying on ngrok.)

### Configure the webhook
1. On your GitHub repo → **Settings → Webhooks → Add webhook**
2. **Payload URL**: `https://your-url/webhooks/github`
3. **Content type**: `application/json`
4. **Secret**: any random string - put the same value in `GITHUB_WEBHOOK_SECRET` in your `.env` and restart the backend
5. **Which events**: "Let me select individual events" → check **Pull requests** and **Issue comments** (the second one enables the `/codebuddy recheck` comment command)
6. Save

### Test it
- Open a pull request on that repo (or push a commit to an existing open one) → watch the backend terminal for the webhook, then Gemini logs, then a posted comment
- Comment `/codebuddy recheck` on that PR → triggers a fresh review
- In the dashboard, go to **Projects** → the repo → ⚙️ to set a merge-gate score threshold or a custom style guide for that repo

## Troubleshooting

**Backend won't start**: check `DATABASE_URL` is `file:./dev.db`, run `npx prisma db push` again, or delete `dev.db` for a clean slate.

**Gemini errors mentioning quota**: the free tier caps at ~20 requests/day. Wait for it to reset, or reduce how much you're reviewing at once (a big zip upload burns through it fast).

**Webhook not firing**: confirm your ngrok URL matches exactly what's in GitHub's webhook settings (it changes every time you restart ngrok unless you have a paid static domain), and that the secret matches your `.env` exactly.

**`npm install` dependency errors**: run `npm install --legacy-peer-deps` if you hit a peer-dependency conflict on an older lockfile.
