# Database Setup Guide

## Prerequisites
- Node.js only — no database server to install. ReviewBot uses SQLite, a single local file.
- `DATABASE_URL` configured in `.env` file (defaults to `file:./dev.db`)

> **Note:** This project uses Prisma 7.2.0 which requires `DATABASE_URL` in `prisma.config.ts` instead of directly in `schema.prisma`. The configuration is automatically generated when you run `npx prisma init`.

## Database Schema

The ReviewBot uses SQLite with the following tables:

### Tables
1. **projects** - GitHub repositories being monitored
2. **developers** - GitHub users/developers
3. **reviews** - Code review records
4. **code_changes** - Diff details for each review
5. **project_metrics** - Aggregated stats per project
6. **developer_metrics** - Aggregated stats per developer

### Enums
- **ReviewStatus**: PENDING, PROCESSING, COMPLETED, FAILED, SKIPPED

## Quick Start

### 1. Create the Database

```bash
# From reviewbot-backend directory
npm run prisma:generate
npx prisma db push
```

This creates `dev.db` (a SQLite file) in the `reviewbot-backend` folder with all tables and indexes.

### 2. Seed Sample Data (Optional)
```bash
npm run prisma:seed
```

Creates:
- Sample project "Sample Project"
- Sample developer "test_developer"

## Available Commands

```bash
# Generate Prisma Client after schema changes
npm run prisma:generate

# Create and apply migrations
npm run prisma:migrate

# Seed database with test data
npm run prisma:seed

# Open Prisma Studio (GUI)
npm run prisma:studio
```

## Schema Changes

After modifying `prisma/schema.prisma`:

1. Generate new client: `npm run prisma:generate`
2. Create migration: `npm run prisma:migrate`
3. Migration name will be prompted

## Verification

Open Prisma Studio to browse tables visually:
```bash
npm run prisma:studio
```

Or inspect the SQLite file directly with the `sqlite3` CLI:
```bash
sqlite3 dev.db ".tables"
sqlite3 dev.db ".schema review"
```

## Troubleshooting

### Connection Errors
- Verify `DATABASE_URL` in `.env` points to a writable path (default: `file:./dev.db`)
- Test connection: `npx prisma db pull`

### Migration Errors
- Reset database: `npx prisma migrate reset` (WARNING: destroys all data)
- Or just delete `dev.db` and re-run `npx prisma db push` for a clean slate

## Production Notes

- Never commit `.env` or `dev.db` to version control
- Back up the `dev.db` file regularly (it's just a file — copy it)
- SQLite handles moderate traffic well for a single-instance deployment; if you outgrow it, Prisma makes swapping the datasource provider straightforward
