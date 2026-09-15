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
  a separate custom domain from the app itself. CORS (`ALLOWED_ORIGINS` in
  `nexdash-worker/src/index.js`) allows both `ult.eliaslhx.com` and
  `factsheet.eliaslhx.com` — add any future frontend's origin to that list too.
- **`factsheet.eliaslhx.com`** — a separate standalone app (`incorporation-form/`,
  its own React+Vite SPA) that also syncs through this same Worker.

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
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put TENANT_ID
npx wrangler secret put SITE_ID
npx wrangler deploy
```

`TENANT_ID` and `SITE_ID` are set as secrets (not `wrangler.json` vars) because this
repo is public — plain vars would put your tenant hostname and SharePoint site path in
plaintext in the repo. `env.TENANT_ID`/`env.SITE_ID` work identically in
`nexdash-worker/src/index.js` either way, so no code change was needed for this.

The `TOKEN_CACHE` KV namespace is already created and wired into `wrangler.json`
(id `a0152af8e15040eab1338a0ad4e224d4`).

`GEMINI_API_KEY` powers the NEXUS tab (Gemini handles both transcription and
summarization) and the Generations tab (drafts a form's fields from an imported
document's text) — paid, per-use API, budgeted and approved separately from the free
Graph API calls used for SharePoint sync.
