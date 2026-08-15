
# Code Buddy — AI-Powered Code Review

[![NestJS](https://img.shields.io/badge/NestJS-E0234E?logo=nestjs&logoColor=white)](https://nestjs.com/)
[![React](https://img.shields.io/badge/React-61DAFB?logo=react&logoColor=black)](https://reactjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![SQLite](https://img.shields.io/badge/SQLite-003B57?logo=sqlite&logoColor=white)](https://www.sqlite.org/)
[![Gemini](https://img.shields.io/badge/Gemini-8E75B2?logo=googlegemini&logoColor=white)](https://ai.google.dev/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

Code Buddy reviews code two ways: **automatically**, by watching GitHub pull requests and posting AI review comments as they come in, or **instantly**, by pasting/uploading code straight into the dashboard with no repo or setup required. Both modes share the same review engine (Google Gemini) and the same quality-scoring/severity model.

Built as a portfolio project — it's a real, working demonstration of an async job pipeline, webhook signature verification, an LLM-backed review engine, and a full-stack dashboard, all runnable for free (no Docker, no paid APIs).

## 📸 Screenshots

### Review Code (instant mode)
<img width="957" height="456" alt="Ai review 1" src="https://github.com/user-attachments/assets/e5953243-c2e9-48b5-abb7-0b24a0750484" />

### Dashboard
<img width="940" height="455" alt="Ai" src="https://github.com/user-attachments/assets/5a7833bd-7787-415e-9b00-c8b114dce08e" />

### GitHub Integration

<img width="1259" height="1052" alt="mr-summary" src="https://github.com/user-attachments/assets/a09909a3-1656-4b9f-8cc0-9c1adba3af93" />

## 🌟 Features

### GitHub PR Automation
- **Automatic reviews** on every PR open/update, triggered by a GitHub webhook (HMAC-SHA256 signature verified)
- **Merge gate** — optionally require a minimum quality score; PRs below it get a formal "Request changes" review instead of just a comment (works with GitHub branch protection rules)
- **Custom review conventions** — give a repo project-specific rules (e.g. "require JSDoc on exported functions") that get appended to every review prompt for that repo
- **`/codebuddy recheck`** — comment that phrase on any open PR to trigger a fresh review after pushing fixes
- **Inline + summary comments** — line-level comments on flagged code plus a PR-level summary with a quality score

### Review Code (instant mode)
- **Paste, upload, or drag-and-drop** a file — or a whole `.zip` of a small project (up to ~60 files)
- **Review-only or Review & Fix** — fix mode has the AI rewrite the file and explain each change, shown as a proper line-level diff
- **Error highlighter** — your code renders with syntax highlighting and each flagged line tinted by severity; click an issue to jump straight to it
- **Zip reviews are sorted by severity** (worst files first) and collapsible, so a 50-file zip doesn't mean 50 fully-expanded panels
- **AI project brief** — once every file in a zip finishes, Gemini synthesizes one paragraph across the whole codebase: overall health, cross-file patterns, and what to fix first
- **AI-generated topic names** — reviews are labeled by what the code *does*, not just the filename

### Shared
- **Async processing** — both modes run through an in-memory queue (PENDING → PROCESSING → COMPLETED/FAILED), polled by the frontend rather than blocking the request
- **Quota-aware** — Gemini's free tier caps at ~20 requests/day; a live usage badge shows remaining quota, and a 429 response fails fast (no wasted retries) instead of hammering an exhausted quota for minutes
- **Dashboard** — combined metrics across both review sources, with a toggle to filter by source, plus a quality-trend chart and per-project score breakdown

## 🏗️ Architecture

```
codebuddy/
├── reviewbot-backend/            # NestJS API
│   ├── src/
│   │   ├── webhooks/              # GitHub webhook receiver (pull_request + issue_comment)
│   │   ├── github/                # GitHub API client (Octokit) - comments, formal reviews, diffs
│   │   ├── llm/                   # Gemini integration - review prompts, retry/quota handling
│   │   ├── queue/                 # In-memory queue for GitHub PR reviews (p-queue)
│   │   ├── adhoc-review/          # Paste/upload/zip review flow - its own queue + endpoints
│   │   ├── projects/              # GitHub repo management, merge gate & style guide config
│   │   ├── reviews/ developers/   # Stats, timeline, leaderboard endpoints
│   │   ├── auth/                  # JWT login
│   │   └── prisma/                # Database models (SQLite)
│   └── prisma/schema.prisma
│
└── reviewbot-frontend/            # React + Vite dashboard
    └── src/
        ├── pages/                 # Dashboard, Review Code, Projects, Reviews, Developers, Login
        ├── features/dashboard/    # Metrics, quality trend chart, leaderboard
        ├── hooks/api/             # React Query hooks per resource
        └── components/            # Shared UI: CodeBlock (syntax highlighting), DiffViewer,
                                    # ConfirmDialog, ToastProvider, ErrorBoundary
```

**Both review flows share the same shape**: a request creates a row with `status: PENDING`, gets queued, and is processed in the background - the frontend polls for status the same way a CI job would be polled, rather than holding the HTTP request open for however long Gemini takes to respond.

## 🛠️ Tech Stack

**Backend**: NestJS · Prisma ORM · SQLite (via `better-sqlite3` driver adapter) · p-queue · Octokit (GitHub API) · Google Gemini (native REST API) · JWT auth · class-validator

**Frontend**: React 19 · Vite · TypeScript · Tailwind CSS v4 · TanStack Query · Recharts · prism-react-renderer (syntax highlighting) · `diff` (line-level diffing)

No Docker, no paid services, no separate message broker - everything runs as two `npm` processes against a local SQLite file.

## 📋 Prerequisites

- **Node.js** 18+
- **Google Gemini API key** — free, no credit card: https://aistudio.google.com/apikey
- **GitHub personal access token** — only needed for the PR-automation mode (`Pull requests: Read & write`, `Contents: Read`)

## 🚀 Quick Start

```bash
# Backend
cd reviewbot-backend
npm install
cp .env.example .env      # fill in GEMINI_API_KEY at minimum
npx prisma generate
npx prisma db push
npm run start:dev         # http://localhost:3000
```

```bash
# Frontend (separate terminal)
cd reviewbot-frontend
npm install
echo "VITE_API_URL=http://localhost:3000" > .env
npm run dev                # http://localhost:5173
```

Log in with the `ADMIN_USERNAME` / `ADMIN_PASSWORD` you set in the backend `.env`, then try **Review Code** — no GitHub setup needed for that mode.

See [QUICKSTART.md](./QUICKSTART.md) for the full walkthrough, including setting up the GitHub webhook for PR automation.

## ⚙️ Environment Variables

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | Yes | Defaults to `file:./dev.db` |
| `GEMINI_API_KEY` | Yes | Free tier, no card required |
| `GEMINI_MODEL_NAME` | No | Defaults to a current Gemini flash model |
| `JWT_SECRET` | Yes | Any random string |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | Yes | Dashboard login |
| `FRONTEND_URL` | Yes | For CORS; e.g. `http://localhost:5173` |
| `GITHUB_ACCESS_TOKEN` | Only for PR automation | Personal access token |
| `GITHUB_WEBHOOK_SECRET` | Only for PR automation | Shared secret for signature verification |

## ⚠️ Known Limitations

- **Gemini free tier**: ~20 requests/day per API key. A large zip upload or a burst of PR activity can exhaust it - the app detects this and fails fast with a clear message rather than retrying uselessly, but it's a real constraint of the free tier, not something the code can work around.
- **Local-only by default**: without deploying the backend somewhere with a permanent public URL, the GitHub webhook mode only works while your machine is on and reachable (e.g. via `ngrok` for local testing).
- **SQLite**: fine for a single-instance deployment; would need a swap to a hosted Postgres for anything with concurrent writers at scale (Prisma makes that a small change, not a rewrite).

## 📄 License

MIT - see [LICENSE](./LICENSE).
