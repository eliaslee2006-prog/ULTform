// Same Cloudflare Worker NexDash already uses for SharePoint sync — this app is just
// another client of the existing /sync contract. See nexdash-worker/src/index.js.
export const WORKER_BASE_URL = 'https://intake.eliaslhx.com';
export const TEMPLATE_ID = 'incorporation-factsheet';

// Shared with the Worker's SYNC_API_KEY secret so /sync and /status reject requests
// that don't come through this app. Set at build time (see .env.example) — never
// commit a real value, since this repo is public.
export const SYNC_API_KEY = import.meta.env.VITE_SYNC_API_KEY || '';
