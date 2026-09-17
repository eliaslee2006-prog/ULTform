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
npx wrangler secret put SYNC_API_KEY
npx wrangler deploy
```

`SYNC_API_KEY` gates `/sync` and `/status` — both endpoints reject any request that doesn't
send a matching `X-App-Key` header (see "Access control" below). Pick any long random
string for it (e.g. `openssl rand -hex 32`).

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

## Access control

Both apps collect personal data (NRIC/FIN/passport numbers, addresses, signatures, and
for NexDash, clinic session audio/transcripts), so this repo is layered with two
independent controls rather than relying on either alone:

1. **Cloudflare Access, in front of both app domains** (`ult.eliaslhx.com` and
   `factsheet.eliaslhx.com`) — restricts who can ever *load* the app to your own staff.
   This is dashboard config, not something in this repo:
   - Cloudflare dashboard → **Zero Trust** → **Access** → **Applications** → **Add an application**
     → **Self-hosted**.
   - Application domain: the app's hostname (e.g. `factsheet.eliaslhx.com`). Repeat for
     `ult.eliaslhx.com` as a second application.
   - Add a policy: Action = Allow, Include = **Emails ending in** `@yourcompany.com` (or
     a specific email list for a small team).
   - Session duration: pick something reasonable (e.g. 24h) so staff aren't re-prompted
     constantly on a shared device.
   - Free tier covers up to 50 users — no paid plan needed for a small team.
2. **`SYNC_API_KEY` on the Worker** — defense in depth for the `/sync` and `/status`
   endpoints specifically. Cloudflare Access only gates *browser page loads*; a request
   sent directly to `intake.eliaslhx.com/sync` (e.g. via `curl`) never goes through
   Access at all, since Access isn't applied to that hostname. `SYNC_API_KEY` closes that
   gap — both endpoints return `401` without a matching `X-App-Key` header, regardless of
   where the request came from.
   - `incorporation-form/` reads its copy of the key from a build-time env var
     (`VITE_SYNC_API_KEY` — see `incorporation-form/.env.example`), so it's never
     committed to this public repo's source.
   - The root PWA has no build step, so it can't inject a build-time secret the same way;
     it instead asks for the key once per device (`window.prompt`, see
     `js/worker-config.js`) and remembers it in that browser's `localStorage`.

Neither control alone is sufficient: Access without the Worker key still leaves the
`/sync` API directly reachable by anyone who has the URL (this repo is public, so the
URL isn't secret); the Worker key alone still lets anyone load the app itself and read
the key out of the shipped JS. Together, Access decides who can ever load the app (and
therefore ever see the key), and the key stops direct API calls that skip the app
entirely.
