// nexdash-worker
// Handles token-cached Graph auth, idempotent SharePoint sync for the NexDash PWA.

// This must be the PWA's own origin (where fetch() calls to this Worker originate
// from), not this Worker's own domain — the two are deliberately different hosts.
const ALLOWED_ORIGIN = 'https://ult.eliaslhx.com';

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Idempotency-Key, X-File-Name, X-Template-Id',
    'Access-Control-Max-Age': '86400'
  };
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(), 'Content-Type': 'application/json' }
  });
}

async function getGraphToken(env) {
  const cached = await env.TOKEN_CACHE.get('graph_token', { type: 'json' });
  if (cached && cached.expiresAt > Date.now()) {
    return cached.accessToken;
  }

  const resp = await fetch(
    `https://login.microsoftonline.com/${env.TENANT_ID}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: env.CLIENT_ID,
        client_secret: env.CLIENT_SECRET,
        scope: 'https://graph.microsoft.com/.default',
        grant_type: 'client_credentials'
      })
    }
  );

  const data = await resp.json();
  if (!resp.ok) {
    throw new Error(`Entra ID auth failed: ${data.error_description || data.error}`);
  }

  const expiresAt = Date.now() + (data.expires_in - 60) * 1000;
  await env.TOKEN_CACHE.put(
    'graph_token',
    JSON.stringify({ accessToken: data.access_token, expiresAt }),
    { expirationTtl: data.expires_in }
  );

  return data.access_token;
}

async function uploadToGraph(env, token, templateId, fileName, pdfBuffer) {
  const path = encodeURIComponent(`Intakes/${templateId}/${fileName}`);
  const uploadUrl = `https://graph.microsoft.com/v1.0/sites/${env.SITE_ID}/drive/root:/${path}:/content`;

  const resp = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/pdf'
    },
    body: pdfBuffer
  });

  const data = await resp.json();
  if (!resp.ok) {
    throw new Error(`Graph upload failed: ${data.error?.message || resp.status}`);
  }

  return { success: true, fileId: data.id, webUrl: data.webUrl, fileName };
}

async function handleSync(request, env) {
  const idempotencyKey = request.headers.get('X-Idempotency-Key');
  if (!idempotencyKey) {
    return jsonResponse({ success: false, error: 'Missing X-Idempotency-Key header' }, 400);
  }

  const seen = await env.TOKEN_CACHE.get(`seen:${idempotencyKey}`);
  if (seen) {
    return new Response(seen, { headers: { ...corsHeaders(), 'Content-Type': 'application/json' } });
  }

  const contentType = request.headers.get('content-type') || '';
  if (!contentType.includes('application/pdf')) {
    return jsonResponse({ success: false, error: 'Expected Content-Type: application/pdf' }, 400);
  }

  const fileName = request.headers.get('X-File-Name') || `Document_${Date.now()}.pdf`;
  const templateId = request.headers.get('X-Template-Id') || 'General';

  try {
    const pdfBuffer = await request.arrayBuffer();
    const token = await getGraphToken(env);
    const result = await uploadToGraph(env, token, templateId, fileName, pdfBuffer);

    await env.TOKEN_CACHE.put(`seen:${idempotencyKey}`, JSON.stringify(result), {
      expirationTtl: 86400
    });

    return jsonResponse(result);
  } catch (err) {
    return jsonResponse({ success: false, error: err.message }, 500);
  }
}

// ---- NEXUS: Gemini transcription + summarization ----
// Paid, per-use Gemini calls — kept server-side behind this Worker so the API key
// never reaches the client, same principle as the Entra ID client secret above.
// Single vendor (Google) for both steps: Gemini takes audio input directly for
// transcription and handles the structured-JSON summarization step too.

const GEMINI_MODEL = 'gemini-2.0-flash';
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

async function callGemini(env, body) {
  const resp = await fetch(`${GEMINI_API_BASE}/${GEMINI_MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
    body: JSON.stringify(body)
  });
  const data = await resp.json();
  if (!resp.ok) {
    throw new Error(data.error?.message || `Gemini request failed with status ${resp.status}`);
  }
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (text === undefined) {
    throw new Error('Gemini response had no text content (possibly blocked or empty)');
  }
  return text;
}

async function handleNexusTranscribe(request, env) {
  const contentType = request.headers.get('content-type') || '';
  if (!contentType.includes('multipart/form-data')) {
    return jsonResponse({ success: false, error: 'Expected multipart/form-data with an "audio" field' }, 400);
  }

  const formData = await request.formData();
  const audio = formData.get('audio');
  if (!audio) {
    return jsonResponse({ success: false, error: 'Missing audio file' }, 400);
  }

  try {
    const audioBuffer = await audio.arrayBuffer();
    const text = await callGemini(env, {
      contents: [{
        parts: [
          { text: 'Transcribe the speech in this audio clip verbatim. Respond with only the transcript text, no commentary or formatting. If there is no discernible speech, respond with an empty string.' },
          { inline_data: { mime_type: audio.type || 'audio/webm', data: arrayBufferToBase64(audioBuffer) } }
        ]
      }]
    });
    return jsonResponse({ success: true, text: text.trim() });
  } catch (err) {
    return jsonResponse({ success: false, error: err.message }, 500);
  }
}

async function handleNexusSummarize(request, env) {
  let body;
  try { body = await request.json(); } catch { body = {}; }
  const transcript = (body.transcript || '').trim();
  if (!transcript) {
    return jsonResponse({ success: false, error: 'Missing transcript' }, 400);
  }

  const prompt = 'You summarize spoken-session transcripts for clinic staff. ' +
    'Respond with strict JSON only, matching this shape: ' +
    '{"summary": string, "figures": string[], "discrepancies": string[], ' +
    '"definitions": [{"term": string, "definition": string}], "keywords": string[]}. ' +
    '"figures" are numeric, monetary, or date figures mentioned. "discrepancies" are ' +
    'contradictions or inconsistencies noted in the conversation. Keep arrays empty ' +
    '(not omitted) when nothing applies.\n\nTranscript:\n' + transcript;

  try {
    const text = await callGemini(env, {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json' }
    });
    const parsed = JSON.parse(text);
    return jsonResponse({ success: true, ...parsed });
  } catch (err) {
    return jsonResponse({ success: false, error: err.message }, 500);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders() });
    }
    if (request.method !== 'POST') {
      return jsonResponse({ success: false, error: 'Not found' }, 404);
    }

    if (url.pathname === '/sync') return handleSync(request, env);
    if (url.pathname === '/nexus/transcribe') return handleNexusTranscribe(request, env);
    if (url.pathname === '/nexus/summarize') return handleNexusSummarize(request, env);

    return jsonResponse({ success: false, error: 'Not found' }, 404);
  }
};
