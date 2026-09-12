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

// ---- NEXUS: Whisper transcription + GPT summarization ----
// Paid, per-use OpenAI calls — kept server-side behind this Worker so the API key
// never reaches the client, same principle as the Entra ID client secret above.

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

  const upstreamForm = new FormData();
  upstreamForm.append('file', audio, 'chunk.webm');
  upstreamForm.append('model', 'whisper-1');

  try {
    const resp = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` },
      body: upstreamForm
    });
    const data = await resp.json();
    if (!resp.ok) {
      throw new Error(data.error?.message || `Whisper request failed with status ${resp.status}`);
    }
    return jsonResponse({ success: true, text: data.text || '' });
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

  const systemPrompt = 'You summarize spoken-session transcripts for clinic staff. ' +
    'Respond with strict JSON only, matching this shape: ' +
    '{"summary": string, "figures": string[], "discrepancies": string[], ' +
    '"definitions": [{"term": string, "definition": string}], "keywords": string[]}. ' +
    '"figures" are numeric, monetary, or date figures mentioned. "discrepancies" are ' +
    'contradictions or inconsistencies noted in the conversation. Keep arrays empty ' +
    '(not omitted) when nothing applies.';

  try {
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: transcript }
        ]
      })
    });
    const data = await resp.json();
    if (!resp.ok) {
      throw new Error(data.error?.message || `GPT request failed with status ${resp.status}`);
    }
    const parsed = JSON.parse(data.choices[0].message.content);
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
