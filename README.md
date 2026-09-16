# Preshopps

A simple, mobile-first, multi-seller marketplace for pre-loved and brand-new items.

Preshopps focuses on trust, messaging, and marketplace discovery. Payments, shipping, and meetup logistics are coordinated directly between buyer and seller — Preshopps does not process payments in the MVP.

For full product behavior and architecture, see the canonical docs below. This README is intentionally short and does not restate product rules.

## Stack

- Next.js (App Router) + TypeScript + React
- Tailwind CSS
- Supabase — Auth, PostgreSQL, Row Level Security, Storage, Realtime
- Deployment: Netlify (frontend)
- Transactional email: Supabase Cron → Supabase Edge Function → Resend, independent of Netlify

## Development

Prerequisites: Node.js, a Supabase project (or local Supabase stack), and the environment variables described in `.env.example`.

Install dependencies:

```bash
npm install
```

Run the app locally:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Validation commands

Run these separately when relevant to a change:

```bash
npm run lint
npm run typecheck
npm run test
npm run build
```

Run Playwright end-to-end coverage when the changed flow has e2e tests:

```bash
npm run test:e2e
```

## Environment variables

See `.env.example` for the exact variable names and where each one is configured (Netlify vs. Supabase Edge Function secrets). Never commit real secret values.

## Canonical documentation

Read these before making any meaningful change, in this priority order:

1. [`docs/PRD.md`](docs/PRD.md) — product behavior
2. [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — technical architecture
3. [`docs/ARCHITECTURE_ESSENTIALS.md`](docs/ARCHITECTURE_ESSENTIALS.md) — compact architecture checklist
4. [`AGENTS.md`](AGENTS.md) — agent operating rules for this repository
5. [`CLAUDE.md`](CLAUDE.md) — temporary Claude Code transition supplement

For current, changing implementation state — latest migration, completed modules, backlog, known limitations — see [`docs/PROJECT_STATUS.md`](docs/PROJECT_STATUS.md). It is informational only and never overrides the canonical documents above.
