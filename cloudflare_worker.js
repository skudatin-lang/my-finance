// ╔══════════════════════════════════════════════════════════════════╗
// ║  Cloudflare Worker — Proxy for Yandex SpeechKit STT + GPT       ║
// ║  Deploy: workers.cloudflare.com → Create Worker → Paste → Save  ║
// ║                                                                   ║
// ║  Required Environment Variables (Settings → Variables):         ║
// ║    YANDEX_API_KEY  = "Api-Key AQVNy..."   ← your Yandex API key  ║
// ║    YANDEX_FOLDER   = "b1g..."             ← your folder ID       ║
// ║    APP_SECRET      = "any-random-string"  ← protects your worker ║
// ║                                                                   ║
// ║  Endpoints:                                                       ║
// ║    POST /stt  → Yandex SpeechKit (binary audio)                 ║
// ║    POST /gpt  → Yandex GPT (JSON)                               ║
// ║    GET  /     → health check                                     ║
// ╚══════════════════════════════════════════════════════════════════╝

const YANDEX_STT_URL = 'https://stt.api.cloud.yandex.net/speech/v1/stt:recognize';
const YANDEX_GPT_URL = 'https://llm.api.cloud.yandex.net/foundationModels/v1/completion';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-App-Secret',
  'Access-Control-Max-Age': '86400',
};

// Per-user rate limiting via Cloudflare KV (optional but recommended)
// Create KV namespace "RATE_LIMITS" and bind it to the worker

export default {
  async fetch(request, env) {
    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const url = new URL(request.url);

    // Health check
    if (request.method === 'GET') {
      return new Response(JSON.stringify({ ok: true, service: 'finance-proxy' }), {
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
      });
    }

    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405, headers: CORS_HEADERS });
    }

    // Optional: verify app secret to prevent abuse
    const appSecret = request.headers.get('X-App-Secret');
    if (env.APP_SECRET && appSecret !== env.APP_SECRET) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
      });
    }

    // Rate limiting (requires KV namespace bound as RATE_LIMITS)
    if (env.RATE_LIMITS) {
      const userId = request.headers.get('X-User-Id') || 'anonymous';
      const month = new Date().toISOString().slice(0, 7); // "2026-04"
      const key = `${userId}:${month}`;
      const count = parseInt(await env.RATE_LIMITS.get(key) || '0');
      const MONTHLY_LIMIT = 500; // requests per user per month

      if (count >= MONTHLY_LIMIT) {
        return new Response(JSON.stringify({
          error: 'Лимит запросов исчерпан',
          limit: MONTHLY_LIMIT,
          reset: 'начало следующего месяца'
        }), {
          status: 429, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
        });
      }

      // Increment counter (expires in 35 days)
      await env.RATE_LIMITS.put(key, String(count + 1), { expirationTtl: 35 * 24 * 3600 });
    }

    const apiKey = env.YANDEX_API_KEY;
    const folderId = env.YANDEX_FOLDER;

    if (!apiKey || !folderId) {
      return new Response(JSON.stringify({ error: 'Server not configured (missing env vars)' }), {
        status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
      });
    }

    const path = url.pathname;

    try {
      // ── STT: Speech-to-Text ──────────────────────────────────────
      // Receives raw binary audio, forwards to Yandex STT REST API
      if (path === '/stt' || path === '/speech') {
        const contentType = request.headers.get('Content-Type') || 'audio/webm';
        const audioFormat = request.headers.get('X-Audio-Format') || 'WEBM_OPUS';
        const sampleRate = request.headers.get('X-Sample-Rate') || '48000';

        const audioBody = await request.arrayBuffer();

        const sttUrl = `${YANDEX_STT_URL}?` + new URLSearchParams({
          folderId,
          lang: 'ru-RU',
          format: audioFormat.toLowerCase().replace('_', '-'), // webm-opus
          sampleRateHertz: sampleRate,
        });

        const sttResp = await fetch(sttUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Api-Key ${apiKey}`,
            'Content-Type': contentType,
          },
          body: audioBody,
        });

        const sttData = await sttResp.json();

        return new Response(JSON.stringify(sttData), {
          status: sttResp.status,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
        });
      }

      // ── GPT: Text completion ─────────────────────────────────────
      if (path === '/gpt' || path === '/completion' || path === '/') {
        const body = await request.json();

        // Inject model URI if not provided
        if (!body.modelUri) {
          body.modelUri = `gpt://${folderId}/yandexgpt-lite/latest`;
        }

        const gptResp = await fetch(YANDEX_GPT_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Api-Key ${apiKey}`,
            'x-folder-id': folderId,
          },
          body: JSON.stringify(body),
        });

        const gptData = await gptResp.json();

        return new Response(JSON.stringify(gptData), {
          status: gptResp.status,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
        });
      }

      return new Response(JSON.stringify({ error: 'Unknown endpoint. Use /stt or /gpt' }), {
        status: 404, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
      });

    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
      });
    }
  },
};

// ══════════════════════════════════════════════════════════════════
// HOW TO DEPLOY:
// 1. Go to https://workers.cloudflare.com → Log in → Create Worker
// 2. Paste this entire file → Save and Deploy
// 3. Go to Settings → Variables and Secrets → Add:
//      YANDEX_API_KEY = your key from console.yandex.cloud
//      YANDEX_FOLDER  = your folder ID from console.yandex.cloud
//      APP_SECRET     = any random string (e.g. "myfinance2024secret")
// 4. (Optional) Create KV namespace "RATE_LIMITS", bind to worker
// 5. Copy your worker URL: https://your-worker.YOUR-NAME.workers.dev
// 6. In the app Settings → Voice Input:
//      STT URL: https://your-worker.YOUR-NAME.workers.dev/stt
//      GPT URL: https://your-worker.YOUR-NAME.workers.dev/gpt
//      App Secret: the APP_SECRET you set in step 3
// ══════════════════════════════════════════════════════════════════
