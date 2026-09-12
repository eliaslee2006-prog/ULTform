# NexDash — build brief for Claude Code

Read this first. It captures every decision made in planning so far — the goal is that
Claude Code can continue this build without the person re-explaining context.

## What this is

An iPad-first PWA that lets staff open a PDF intake form, stamp text/checkbox/date fields
and one or more signatures onto it *without altering the underlying template artwork*,
flatten it client-side, and sync it to a SharePoint document library via a Cloudflare
Worker + Microsoft Graph. Named **NexDash**.

**Real business context (as of the second build pass):** the actual use case is Singapore
company incorporation — the person's own real intake form is a "Factsheet for
Incorporation of New Company" (proposed company names, business activities, paid-up
capital, registered address, directors, shareholders, company secretary, reasons for
incorporation, fees), used by "Medinex Healthcare Pte. Ltd. / Medinex Corporate Services
Pte. Ltd." per the form's own certification text. The earlier "Patient Intake Form" sample
was a generic placeholder invented before this was known — it's been replaced by
`templates/factsheet-incorporation.pdf` (`templates/manifest.json`'s `FactsheetIncorporation`
entry), a from-scratch 4-page recreation. The source `.docx` the person uploaded
(`Co_Name_yyyymmdd_Factsheet_3_1.docx`) is genuinely corrupted at the XML level — its
`<w:t>` text-run elements illegally contain nested child elements (a schema violation,
not just a missing part), which is why LibreOffice refuses to open it ("source file could
not be loaded") even though the ZIP/XML is syntactically well-formed. All field labels
were recovered by stripping tags from the raw XML and reconstructing the layout in
`gen-factsheet.mjs`-style pdf-lib code (script itself wasn't kept in the repo — regenerate
similarly if the layout needs revision). If the person provides a clean copy of the source
document later, re-derive the template from that instead and diff against this one for any
fields this recovery missed or mis-ordered (the corruption made table cell reading order
unreliable in a few spots — Part 6 bank/signatory section and Part 10 "Contact Information"
were the least certain reconstructions).

## Current state of this repo

All modules below are now built and verified end-to-end (headless smoke tests covering
multi-page editing, signatures, submit, My Files, Customize persistence, font upload, a
full NEXUS record→transcribe→summarize→export cycle, and Canvas drawing/layers/undo).
What's left:

- **`nexdash-worker/`** — functionally complete, but not yet deployed with real
  `TENANT_ID`/`SITE_ID`/`CLIENT_ID`/`CLIENT_SECRET`/`OPENAI_API_KEY`. Everything that
  talks to it (sync, NEXUS transcribe/summarize) degrades gracefully (queues/retries,
  falls back to "unavailable") until it's live.
- **Not built on this pass**: nothing — every module in the original scope below is done.
  If new gaps surface, add them here the same way the old ones are documented below,
  so the next session doesn't have to rediscover them.

## Non-negotiable constraints already established

- **A4, not US Letter.** `.pdf-stage-wrapper` uses `aspect-ratio: 210 / 297`. An earlier
  version used `8.5/11` — that was a bug, already fixed here, don't reintroduce it.
- **Non-destructive overlays.** Fields and signatures are a transparent DOM layer above
  the rendered PDF canvas; flattening burns them into the PDF at submit time. Multiple
  independent signature fields must be supported on one document (customer + witness,
  etc.) — the overlay engine already supports this, don't collapse it back to one signature.
- **`Sites.Selected` over `Sites.ReadWrite.All`.** Deliberate security choice — a leaked
  secret should only expose one SharePoint site, not the tenant. Don't widen this scope
  without flagging it back to the person.
- **No WhatsApp/Telegram Business API.** Sharing uses free `wa.me`/`t.me` click-to-chat
  links plus the Web Share API (`js/share.js`). Do not integrate a paid Business
  Solution Provider unless explicitly asked — it's a different cost/complexity tier than
  what was requested.
- **Font licensing is the user's responsibility**, not something the app should try to
  enforce or restrict.
- **Strobe/ambient effects are capped.** The "gentle strobe" ambient effect is a slow
  brightness breathe (4s cycle, max ~6% opacity), not rapid flashing — this is a
  deliberate photosensitive-safety cap, already implemented in the CSS
  (`--strobe-opacity`, `strobe-breathe` keyframe). Don't "improve" this into something faster.
- **Brush packs.** Procreate/Clip Studio Paint `.brush` files are proprietary and can't be
  imported directly. Canvas tab should define its own simple brush-definition format
  instead of attempting real `.brush` compatibility.

## Known gaps — all closed

The four gaps originally listed here (no `pageIndex`/multi-page support, empty icons
folder, placeholder template manifest, placeholder Worker vars) are all closed. The one
that can't be closed from inside a coding session: Worker `vars`/secrets still need real
values from the person deploying it (`TENANT_ID`, `SITE_ID`, `CLIENT_ID`,
`CLIENT_SECRET`, `OPENAI_API_KEY` — see `README.md`).

## Module-by-module scope — all built

### 1. Customize tab — done
Theme toggle, background gallery + custom photo upload, accent hue picker, button
size/roundness sliders, ambient effects (waves/glow/strobe), heading/subheading/body
text-size sliders, and custom font upload (§5). Every choice persists to IndexedDB
(`Settings` store, `js/app.js`) and reapplies on launch.

### 2. NEXUS tab — done (`js/nexus.js`, worker `/nexus/*`)
Manual activation only, with a persistent on-screen recording banner (`.nexus-rec-banner`,
visible across every tab while recording, not just the NEXUS screen). Session control,
live transcript (10s-chunked Whisper calls through the Worker), summary & key index
(figures/discrepancies/definitions/keywords via GPT-4o-mini through the Worker, both keys
server-side only), export (PNG/PDF/JPEG/TXT — see deviation below), a cross-module report
combining transcript+summary+linked My Files record, and searchable session history.
Uses OpenAI Whisper + GPT-4o-mini per the person's explicit choice (needs `OPENAI_API_KEY`
as a Worker secret — paid, per-use, as flagged originally).
**Deviation**: the spec said export raw MP3; browsers' MediaRecorder can't encode MP3
natively, so the export is the real recorded format (webm/opus) labeled "Raw audio"
rather than mislabeling it — flag back to the person if true MP3 is required.

### 3. Share — done
`js/share.js`'s `shareCompletedPDF()`/`openWhatsAppShare()`/`openTelegramShare()` are
wired into a share icon per file row in My Files (`js/files.js`) and a quick-share button
on the post-Complete toast (`js/app.js`).

### 4. My Files tab — done (`js/files.js`)
Folders (create/rename via the folder chip's ×/reassign per file), color-code (cycling
dot per file), import (arbitrary PDFs, local-only — not synced to SharePoint), and the
share/export entry point per file. Backed by a `Files` IndexedDB store (not `Completed` —
`sync-engine.js` patches sync status onto the same record instead of writing a separate
one).

### 5. Custom fonts — done
Upload button (`js/fonts.js`, `FontFace` API + IndexedDB), font repository re-registered
on every launch, font selector + kerning/bold/italic controls in the Customize tab.

### 6 & 7. Signature instruments + Canvas/mindmap tab — done (`js/canvas.js`)
Konva.js for the stage/layers/objects/selection, Perfect Freehand for pressure-sensitive
stroke outlines, Pointer Events for pressure. Brush/eraser/smudge/select/pan tools on a
hotbar matching the Editor's HUD, undo/redo, a layers panel (add/delete/reorder/visibility/
opacity/blend-mode), a custom brush-preset format (size/opacity/thinning/smoothing/
streamline — not real `.brush` import), pinch/wheel zoom, and an auto-saved draft so
switching tabs doesn't lose work. Save flattens to PNG, embeds it in a single-page PDF
(so it flows through the exact same My-Files/sync pipeline as intake forms), and follows
the Complete-flow pattern (§8).
**Deviation**: blend-mode compositing uses Canvas2D's native `globalCompositeOperation`
(via Konva) rather than a hand-rolled WebGL2 shader compositor — same visual blend modes
(multiply/screen/overlay/etc.), far less risk of a half-working GPU pipeline. Revisit with
real WebGL2 only if profiling shows a need at higher layer counts.
**Bug worth knowing about**: brush size must stay scale-independent (divided by
`stage.scaleX()` before feeding Perfect Freehand) — the canvas is a large virtual surface
scaled down to fit the viewport, so a size fed in raw stage units renders (and hit-tests)
as near-invisible sub-pixel width. Don't remove that division.

### 8. Complete flow — done
`submitDocument()` in `js/app.js` flattens, enqueues to the offline sync queue, and shows
the success toast. NEXUS export and Canvas save both follow the same pattern.

## Design system reference

- Accent color is user-customizable (color picker), default `#3E63DD` — deliberately not
  iOS system blue or Anthropic's clay/orange, so it doesn't read as a copy of either.
- Icon rail (left in landscape, collapses to a bottom strip in portrait via
  `@media (orientation: portrait)` in `css/style.css`) replaces an earlier bottom-tab-bar
  design — don't revert to that pattern.
- Every interactive control gets the ripple pulse effect (`wireRipples()`, now in
  `js/ripple.js` — pulled out of `js/app.js` to break a circular import that was
  double-running `bootstrap()` under Vite's dev server) — apply this convention to any
  new buttons.
- Glassmorphic panels: `backdrop-filter: blur(20-24px) saturate(180%)`, translucent white
  (or dark-mode equivalent) fill, 1px near-white border. Keep this consistent across new
  modules rather than introducing a different surface style.
