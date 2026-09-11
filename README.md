# NexDash

An iPad-first PWA that lets staff stamp text/checkbox/date fields and signatures onto a
PDF intake form without altering the underlying template artwork, flatten it
client-side, and sync it to a SharePoint document library via a Cloudflare Worker +
Microsoft Graph.

Start here: **`NEXDASH_BUILD_BRIEF.md`** — full context, decisions already made, and
module-by-module scope for continuing this build.

## Domains

- **`eliaslhx.com`** — main domain.
- **`ult.eliaslhx.com`** — this app (the PWA), served via GitHub Pages from this repo's
  root (`CNAME` file). This is the `ALLOWED_ORIGIN` the Worker's CORS is locked to.
- **`intake.eliaslhx.com`** — the Cloudflare Worker's sync endpoint (`nexdash-worker/`),
  a separate custom domain from the app itself.

## Folders

- `/` (repo root) — the PWA: `index.html`, `css/`, `js/`, `manifest.json`,
  `service-worker.js`, `templates/`, `icons/`. Served as static files by GitHub Pages.
- `nexdash-worker/` — Cloudflare Worker (SharePoint sync via Graph API). Not served by
  GitHub Pages — deployed separately to Cloudflare.

## Quick start (frontend)

```bash
npm install
npm run dev
```

## Quick start (worker)

```bash
cd nexdash-worker
npm install
npx wrangler secret put CLIENT_ID
npx wrangler secret put CLIENT_SECRET
npx wrangler secret put OPENAI_API_KEY
# edit wrangler.json: set real TENANT_ID and SITE_ID first
npx wrangler deploy
```

The `TOKEN_CACHE` KV namespace is already created and wired into `wrangler.json`
(id `a0152af8e15040eab1338a0ad4e224d4`).

`OPENAI_API_KEY` powers the NEXUS tab (Whisper transcription + GPT summarization) —
paid, per-use API, budgeted and approved separately from the free Graph API calls used
for SharePoint sync.
