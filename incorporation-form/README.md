# Incorporation Factsheet — Web Form

A standalone React + Vite app that turns the "Factsheet for Incorporation of New Company"
into a browsable web form: Company Names, Business Activities, Share Capital, Registered
Address, FYE, Bank Account, Directors, Shareholders, Company Secretary, Contact Person, and
a signature block.

This is a **separate app** from the ULTform/NexDash PWA at the repo root — it doesn't touch
any of the root `index.html`/`js/`/`css/` files — but it deliberately reuses the same
techniques NexDash already proved out:

- **Signature capture** uses the same `perfect-freehand` stroke-outline technique as
  `../js/canvas.js`, tuned for a tapered "Calligraphy" nib by default, with brush presets and
  a `.json` / `.abr` / `.brushset` brush-pack importer ported from that file.
- **Settings persistence** uses the same IndexedDB put/get/getAll shape as `../js/db.js`.
- **SharePoint sync** reuses the exact same worker contract as `../js/sync-engine.js` and
  `../nexdash-worker/`: `POST https://intake.eliaslhx.com/sync` with
  `X-Idempotency-Key` / `X-File-Name` / `X-Template-Id` headers, offline queue + retry with
  backoff. **No changes were made to `nexdash-worker/`** — this app is just another client of
  it. Until an admin replaces the placeholder `TENANT_ID`/`SITE_ID`/secrets in
  `nexdash-worker/wrangler.json` and runs `wrangler deploy`, sync attempts will fail
  gracefully and submissions stay queued locally (still downloadable/shareable) — this is
  expected until that backend step is done.

## Develop

```bash
cd incorporation-form
npm install
npm run dev
```

## Build

```bash
npm run build
npm run preview
```

## Deploy

Live at **`factsheet.eliaslhx.com`**, served as a Cloudflare Worker's static assets
(`wrangler.json`'s `assets.directory`), with a Custom Domain route — the same deploy
mechanism `../nexdash-worker/` already uses for `intake.eliaslhx.com`. This is fully
independent of the root NexDash app's GitHub Pages deployment (`ult.eliaslhx.com`); a
GitHub Pages site can only have one custom domain, which is why this app is deployed
separately rather than alongside it.

```bash
cd incorporation-form
npm install
npx wrangler login      # or set CLOUDFLARE_API_TOKEN
npm run deploy          # builds (vite build) then `wrangler deploy`
```

`custom_domain: true` in `wrangler.json`'s `routes` provisions DNS + SSL for
`factsheet.eliaslhx.com` automatically on deploy, as long as `eliaslhx.com`'s zone is on
the same Cloudflare account that runs `wrangler deploy`.

## Structure

- `src/data/formSchema.js` — the field schema (ids match the earlier fillable-PDF field names)
- `src/lib/pdfSummary.js` — generates the customer-copy PDF (A4, modern redesigned summary,
  not a replica of the original table layout)
- `src/lib/brushEngine.js` / `src/lib/brushImport.js` — signature ink rendering + brush pack import
- `src/lib/syncEngine.js` / `src/lib/workerConfig.js` — SharePoint sync client (see above)
- `src/components/settings/` — the gear-icon Settings drawer (Appearance, Signature Brush, Records)
- `src/components/ThankYouScreen.jsx` — customizable post-submit screen
