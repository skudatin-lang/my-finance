// ╔══════════════════════════════════════════════════════════════════╗
// ║  Cloudflare Worker — My Finance App Proxy                        ║
// ║                                                                   ║
// ║  DEPLOY INSTRUCTIONS:                                            ║
// ║  1. workers.cloudflare.com → Create Worker → paste → Deploy     ║
// ║  2. Settings → Variables and Secrets → Add:                     ║
// ║       YANDEX_API_KEY = "AQVNy..."  (from console.yandex.cloud)  ║
// ║       YANDEX_FOLDER  = "b1g..."    (folder ID)                  ║
// ║       APP_SECRET     = "any-random-strong-password-here"        ║
// ║  3. Copy worker URL → paste in app Admin Panel                  ║
// ╚══════════════════════════════════════════════════════════════════╝

const YANDEX_STT = 'https://stt.api.cloud.yandex.net/speech/v1/stt:recognize';
const YANDEX_GPT = 'https://llm.api.cloud.yandex.net/foundationModels/v1/completion';

// ALL headers that the browser may send — must be listed here
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': [
    'Content-Type',
    'X-App-Secret',
    'X-Audio-Format',
    'X-Sample-Rate',
    'X-User-Id',
    'Authorization',
  ].join(', '),
  'Access-Control-Max-Age': '86400',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

export default {
  async fetch(request, env) {
    // 1. Preflight — MUST respond before any auth checks
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    // 2. Health check
    if (request.method === 'GET') {
      return json({ ok: true, service: 'my-finance-proxy', version: '2.0' });
    }

    if (request.method !== 'POST') {
      return json({ error: 'Method not allowed' }, 405);
    }

    // 3. App secret guard (skip if APP_SECRET not configured — dev mode)
    if (env.APP_SECRET) {
      const secret = request.headers.get('X-App-Secret') || '';
      if (secret !== env.APP_SECRET) {
        return json({ error: 'Unauthorized' }, 401);
      }
    }

    // 4. Rate limiting via KV (optional — bind KV namespace as RATE_LIMITS)
    if (env.RATE_LIMITS) {
      const uid = request.headers.get('X-User-Id') || 'anon';
      const key = `${uid}:${new Date().toISOString().slice(0, 7)}`;
      const count = parseInt((await env.RATE_LIMITS.get(key)) || '0');
      const LIMIT = parseInt(env.MONTHLY_LIMIT || '500');
      if (count >= LIMIT) {
        return json({ error: 'Monthly limit reached', limit: LIMIT }, 429);
      }
      await env.RATE_LIMITS.put(key, String(count + 1), {
        expirationTtl: 35 * 86400,
      });
    }

    const apiKey = env.YANDEX_API_KEY;
    const folderId = env.YANDEX_FOLDER;

    if (!apiKey || !folderId) {
      return json({ error: 'Worker not configured: add YANDEX_API_KEY and YANDEX_FOLDER in Variables' }, 500);
    }

    const path = new URL(request.url).pathname;

    try {
      // ── /stt — Speech-to-Text ────────────────────────────────────
      if (path === '/stt') {
        // Get audio format from header (sent by voice.js)
        const fmt = (request.headers.get('X-Audio-Format') || 'WEBM_OPUS')
          .toLowerCase()
          .replace('_', '-'); // webm-opus or ogg-opus
        const rate = request.headers.get('X-Sample-Rate') || '48000';

        const sttUrl =
          YANDEX_STT +
          '?' +
          new URLSearchParams({
            folderId,
            lang: 'ru-RU',
            format: fmt,
            sampleRateHertz: rate,
          }).toString();

        const audio = await request.arrayBuffer();

        const resp = await fetch(sttUrl, {
          method: 'POST',
          headers: {
            Authorization: `Api-Key ${apiKey}`,
            'Content-Type': request.headers.get('Content-Type') || 'audio/webm',
          },
          body: audio,
        });

        const data = await resp.json();
        return json(data, resp.status);
      }

      // ── /gpt — Yandex GPT ────────────────────────────────────────
      if (path === '/gpt') {
        const body = await request.json();
        if (!body.modelUri) {
          body.modelUri = `gpt://${folderId}/yandexgpt-lite/latest`;
        }

        const resp = await fetch(YANDEX_GPT, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Api-Key ${apiKey}`,
            'x-folder-id': folderId,
          },
          body: JSON.stringify(body),
        });

        const data = await resp.json();
        return json(data, resp.status);
      }

      return json({ error: 'Unknown path. Use /stt or /gpt' }, 404);

    } catch (err) {
      return json({ error: err.message }, 500);
    }
  },
};
