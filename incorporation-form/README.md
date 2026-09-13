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

## Structure

- `src/data/formSchema.js` — the field schema (ids match the earlier fillable-PDF field names)
- `src/lib/pdfSummary.js` — generates the customer-copy PDF (A4, modern redesigned summary,
  not a replica of the original table layout)
- `src/lib/brushEngine.js` / `src/lib/brushImport.js` — signature ink rendering + brush pack import
- `src/lib/syncEngine.js` / `src/lib/workerConfig.js` — SharePoint sync client (see above)
- `src/components/settings/` — the gear-icon Settings drawer (Appearance, Signature Brush, Records)
- `src/components/ThankYouScreen.jsx` — customizable post-submit screen
