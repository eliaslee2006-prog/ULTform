# NexDash — build brief for Claude Code

Read this first. It captures every decision made in planning so far — the goal is that
Claude Code can continue this build without the person re-explaining context.

## What this is

An iPad-first PWA that lets staff open a PDF intake form, stamp text/checkbox/date fields
and one or more signatures onto it *without altering the underlying template artwork*,
flatten it client-side, and sync it to a SharePoint document library via a Cloudflare
Worker + Microsoft Graph. Named **NexDash**.

## Current state of this folder

- `nexdash-worker/` — working Cloudflare Worker: locked CORS, KV-cached Entra ID token,
  idempotent Graph upload to a `Sites.Selected`-scoped SharePoint site. Functionally
  complete for single-file sync; not yet deployed with real tenant/site values.
- `nexdash-frontend/` — working offline-first PWA shell: IndexedDB queue (Templates /
  Pending Sync / Completed), pdf-lib flattening, signature capture, the new icon-rail
  navigation and glass HUD, and a real (not mocked) Customize tab. **Files, NEXUS, and
  Canvas tabs are stub screens** — nav routes to them, but they have no functionality yet.
  This is the actual next-build scope.

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

## Known gaps to close (explicitly flagged, not yet built)

1. **Multi-page templates.** Current field schema has no `pageIndex`; renderer only shows
   page 1 (`js/app.js`, marked with `TODO(claude-code)`). Needs: per-field page tracking,
   a page navigation UI, and the continuous-scroll vs. swipe-paginated mode from the
   Customize tab (with matching desktop gestures — scroll wheel for continuous, two-finger
   trackpad swipe or arrow-key fallback for paginated).
2. **Icons folder is empty.** Needs `icon-152/167/180/192/512.png`.
3. **`templates/manifest.json` has a placeholder entry** pointing at a PDF that doesn't
   exist. Needs real templates.
4. **Worker `vars` are placeholders** — `TENANT_ID` / `SITE_ID` need real values, and
   `CLIENT_ID`/`CLIENT_SECRET` need to be set via `wrangler secret put` (never committed).

## Module-by-module scope for this build phase

### 1. Customize tab — mostly built, needs finishing
Already working: theme toggle, background gallery + custom photo upload, free-form accent
hue picker, button size/roundness sliders, ambient effects (waves/glow/strobe) with
intensity sliders. Still needed: heading/subheading/body text-size sliders (mentioned in
original spec, not yet wired), and persisting all these choices (currently reset on
reload — should save to IndexedDB or localStorage-equivalent and reapply on launch).

### 2. NEXUS tab — not started
Manual activation only (confirmed decision — no auto-record). Must show a persistent,
unmissable on-screen recording indicator whenever active — this is a UI safety
requirement, not optional. Submodules:
- Session control (start/stop)
- Live transcript (real-time scrolling text)
- Summary & key index (auto-pulled figures, discrepancies, definitions, keywords)
- Export (PNG/PDF/JPEG/TXT of transcript+summary, plus raw MP3)
- Cross-module report (pulls file locations, transcript, and the customer's form data
  from that session into one document)
- Session history (past sessions, searchable, linked to the customer record)

Needs a transcription API (e.g. Whisper or a Gemini/GPT audio endpoint) and an LLM for
summarization — both are paid, per-use APIs, unlike the free Graph API calls elsewhere in
this system. Budget for that before wiring it up.

### 3. Share — functionally done
`js/share.js` has `shareCompletedPDF()` (native share sheet) and
`openWhatsAppShare()`/`openTelegramShare()` (free click-to-chat links). Needs UI hookup:
a share icon per file row in My Files, plus a quick-share action on the post-Complete toast.

### 4. My Files tab — not started
Folders, rename, color-code, import, and the export/share entry point per file (this is
where "export" actually lives in the nav model — not a standalone rail tab, by design).

### 5. Custom fonts — not started
Upload button, font repository, kerning/spacing/bold/italic controls in the Customize tab.

### 6 & 7. Signature instruments + Canvas/mindmap tab — not started
Recommended APIs, already agreed:
- **Pointer Events API** for pressure/tilt (Apple Pencil support)
- **WebGL2** for blend modes and layer compositing
- **Perfect Freehand** (library) for smooth pressure-sensitive stroke rendering
- **Konva.js** or **Fabric.js** for layer/object management rather than hand-rolling it
- Custom brush-definition format (see constraints above — not real `.brush` import)
Canvas tab reuses the same hotbar pattern as the Editor tab's HUD, plus smudge,
select/deselect, and a layers panel.

### 8. Complete flow — done
`submitDocument()` in `js/app.js` already flattens, enqueues to the offline sync queue,
and shows the success toast. This is the pattern other "save" actions (e.g. NEXUS export,
Canvas save) should follow for consistency.

## Design system reference

- Accent color is user-customizable (color picker), default `#3E63DD` — deliberately not
  iOS system blue or Anthropic's clay/orange, so it doesn't read as a copy of either.
- Icon rail (left in landscape, collapses to a bottom strip in portrait via
  `@media (orientation: portrait)` in `css/style.css`) replaces an earlier bottom-tab-bar
  design — don't revert to that pattern.
- Every interactive control gets the ripple pulse effect (`wireRipples()` in `js/app.js`)
  — apply this convention to any new buttons added in Files/NEXUS/Canvas.
- Glassmorphic panels: `backdrop-filter: blur(20-24px) saturate(180%)`, translucent white
  (or dark-mode equivalent) fill, 1px near-white border. Keep this consistent across new
  modules rather than introducing a different surface style.
