/**
 * voice.js — Yandex SpeechKit STT + GPT intent parsing
 *
 * КЛЮЧЕВЫЕ ИСПРАВЛЕНИЯ:
 * 1. Safari: audio/mp4 (AAC) → конвертируем в PCM через AudioContext → отправляем как lpcm
 * 2. Убран принудительный sampleRate:16000 в getUserMedia (браузер игнорирует)
 * 3. Убран жёсткий X-Sample-Rate:48000 — передаём реальный rate
 * 4. Правильный маппинг форматов → заголовок X-Audio-Format
 * 5. Стрим освобождается синхронно при stop (не ждёт async STT)
 * 6. Подробные сообщения об ошибках с диагностикой
 */

import { state, sched, fmt, today } from './core.js';

let _sttUrl = '', _gptUrl = '', _appSecret = '', _userId = '';
let _mediaRecorder = null, _audioChunks = [], _isRecording = false;

// ── Settings ──────────────────────────────────────────────────────────────
export function loadVoiceSettings() {
  if (!state.D) return;
  if (!state.D.voiceSettings) state.D.voiceSettings = { proxyUrl: '', gptProxyUrl: '', appSecret: '' };
  const vs  = state.D.voiceSettings;
  _sttUrl   = vs.proxyUrl    || '';
  _gptUrl   = vs.gptProxyUrl || vs.proxyUrl || '';
  _appSecret = vs.appSecret  || '';
  _userId   = state.CU?.uid  || 'anonymous';
}

export function saveVoiceSettings(sttUrl, gptUrl, appSecret) {
  if (!state.D) return;
  state.D.voiceSettings = { proxyUrl: sttUrl, gptProxyUrl: gptUrl || sttUrl, appSecret };
  loadVoiceSettings();
  sched();
}

export function isVoiceConfigured() { return !!(_sttUrl.trim()); }
export function isRecording()       { return _isRecording; }

// ── Определяем поддерживаемый формат ─────────────────────────────────────
// Возвращает { mime, format, sampleRate } или null если ничего не поддерживается
function detectFormat() {
  // Chrome/Edge/Firefox поддерживают WebM или OGG с Opus
  const webmOpus = MediaRecorder.isTypeSupported('audio/webm;codecs=opus');
  const oggOpus  = MediaRecorder.isTypeSupported('audio/ogg;codecs=opus');
  const webm     = MediaRecorder.isTypeSupported('audio/webm');

  if (webmOpus) return { mime: 'audio/webm;codecs=opus', format: 'WEBM_OPUS', needsPCM: false };
  if (oggOpus)  return { mime: 'audio/ogg;codecs=opus',  format: 'OGG_OPUS',  needsPCM: false };
  if (webm)     return { mime: 'audio/webm',             format: 'WEBM_OPUS', needsPCM: false };

  // Safari: поддерживает только audio/mp4 — нужна конвертация в PCM
  const mp4 = MediaRecorder.isTypeSupported('audio/mp4;codecs=mp4a.40.2')
           || MediaRecorder.isTypeSupported('audio/mp4');
  if (mp4) {
    return {
      mime:     MediaRecorder.isTypeSupported('audio/mp4;codecs=mp4a.40.2')
                  ? 'audio/mp4;codecs=mp4a.40.2' : 'audio/mp4',
      format:   'LPCM',    // после конвертации отправим как PCM
      needsPCM: true,      // нужна конвертация через AudioContext
      sampleRate: 16000,
    };
  }

  return null; // браузер не поддерживает MediaRecorder
}

// ── Конвертация audio/mp4 → PCM 16-bit (для Safari) ──────────────────────
async function convertToPCM(audioBlob, targetSampleRate) {
  try {
    const arrayBuffer   = await audioBlob.arrayBuffer();
    const audioCtx      = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: targetSampleRate });
    const decoded       = await audioCtx.decodeAudioData(arrayBuffer);
    await audioCtx.close();

    // Берём первый канал (моно)
    const channelData = decoded.getChannelData(0);

    // Ресэмплируем если нужно
    let samples = channelData;
    if (decoded.sampleRate !== targetSampleRate) {
      const ratio     = decoded.sampleRate / targetSampleRate;
      const newLength = Math.ceil(channelData.length / ratio);
      samples         = new Float32Array(newLength);
      for (let i = 0; i < newLength; i++) {
        samples[i] = channelData[Math.min(Math.floor(i * ratio), channelData.length - 1)];
      }
    }

    // Float32 → Int16 PCM
    const pcm    = new Int16Array(samples.length);
    const MAX    = 0x7FFF;
    for (let i = 0; i < samples.length; i++) {
      const s    = Math.max(-1, Math.min(1, samples[i]));
      pcm[i]     = s < 0 ? s * 0x8000 : s * MAX;
    }

    return pcm.buffer;
  } catch (e) {
    console.error('[voice] PCM conversion failed:', e);
    return null;
  }
}

// ── Recording ─────────────────────────────────────────────────────────────
export async function startRecording(onResult, onError, onStateChange) {
  if (_isRecording) return;

  if (!isVoiceConfigured()) {
    onError && onError('Голосовой ввод не настроен.\nПерейдите в раздел «Администратор» и введите URL вашего Cloudflare Worker.');
    return;
  }

  const fmt = detectFormat();
  if (!fmt) {
    onError && onError('Ваш браузер не поддерживает запись аудио.\nИспользуйте Chrome, Firefox или Safari 14.1+.');
    return;
  }

  // Запрашиваем микрофон — БЕЗ принудительного sampleRate
  // (браузер игнорирует sampleRate hint → реальный rate отличается)
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    });
  } catch (e) {
    onError && onError(
      e.name === 'NotAllowedError'
        ? 'Нет доступа к микрофону.\nРазрешите его в настройках браузера (адресная строка → значок 🎤).'
        : 'Микрофон недоступен: ' + e.message
    );
    return;
  }

  // Определяем реальный sampleRate потока
  const realSampleRate = stream.getAudioTracks()[0]?.getSettings()?.sampleRate || 48000;

  _audioChunks = [];

  let recorder;
  try {
    recorder = new MediaRecorder(stream, { mimeType: fmt.mime });
  } catch (e) {
    stream.getTracks().forEach(t => t.stop());
    onError && onError('Ошибка инициализации записи: ' + e.message);
    return;
  }

  _mediaRecorder = recorder;

  recorder.ondataavailable = e => {
    if (e.data && e.data.size > 0) _audioChunks.push(e.data);
  };

  // FIX: стрим освобождается СИНХРОННО — до async STT запроса
  recorder.onstop = async () => {
    stream.getTracks().forEach(t => t.stop()); // сразу
    onStateChange && onStateChange(false);

    if (!_audioChunks.length) {
      onError && onError('Аудио не записано. Попробуйте ещё раз.');
      return;
    }

    try {
      let text = null;

      if (fmt.needsPCM) {
        // Safari: конвертируем mp4 → PCM перед отправкой
        _showToast('⏳ Конвертация аудио...');
        const rawBlob = new Blob(_audioChunks, { type: fmt.mime });
        const targetRate = fmt.sampleRate || 16000;
        const pcmBuffer  = await convertToPCM(rawBlob, targetRate);
        if (!pcmBuffer) {
          onError && onError('Ошибка конвертации аудио Safari. Попробуйте Chrome или Firefox.');
          return;
        }
        text = await _sendSTT(pcmBuffer, 'LPCM', targetRate, 'audio/x-pcm');
      } else {
        // Chrome/Firefox: отправляем напрямую
        const blob = new Blob(_audioChunks, { type: fmt.mime });
        text = await _sendSTTBlob(blob, fmt.format, realSampleRate, fmt.mime);
      }

      if (text) onResult && onResult(text);
      else      onError  && onError('Речь не распознана. Говорите чётче и ближе к микрофону.');
    } catch (e) {
      onError && onError('Ошибка распознавания: ' + e.message);
    }
  };

  recorder.onerror = e => {
    stream.getTracks().forEach(t => t.stop());
    _isRecording = false;
    onStateChange && onStateChange(false);
    onError && onError('Ошибка записи: ' + (e.error?.message || 'неизвестная ошибка'));
  };

  recorder.start(250); // 250мс chunks — стабильнее на мобильных
  _isRecording = true;
  onStateChange && onStateChange(true);
}

export function stopRecording() {
  if (!_isRecording || !_mediaRecorder) return;
  _isRecording = false;
  try { _mediaRecorder.stop(); } catch (_) {}
}

// ── STT: отправка Blob (Chrome/Firefox) ──────────────────────────────────
async function _sendSTTBlob(blob, formatHeader, sampleRate, contentType) {
  if (!blob || blob.size < 500) return null;
  return _sendRawToSTT(blob, formatHeader, sampleRate, contentType);
}

// ── STT: отправка PCM ArrayBuffer (Safari конвертация) ───────────────────
async function _sendSTT(pcmBuffer, formatHeader, sampleRate, contentType) {
  if (!pcmBuffer || pcmBuffer.byteLength < 500) return null;
  return _sendRawToSTT(pcmBuffer, formatHeader, sampleRate, contentType);
}

// ── Общая функция отправки на /stt ────────────────────────────────────────
async function _sendRawToSTT(body, formatHeader, sampleRate, contentType) {
  const baseUrl = _sttUrl.replace(/\/?$/, '');
  const url     = baseUrl.endsWith('/stt') ? baseUrl : baseUrl + '/stt';

  const headers = {
    'Content-Type':    contentType || 'audio/webm',
    'X-Audio-Format':  formatHeader,
    // sampleRate передаём только для LPCM — для oggopus Яндекс читает из контейнера
    ...(formatHeader === 'LPCM' ? { 'X-Sample-Rate': String(sampleRate || 16000) } : {}),
  };
  if (_appSecret) headers['X-App-Secret'] = _appSecret;
  if (_userId)    headers['X-User-Id']    = _userId;

  const size = body instanceof ArrayBuffer ? body.byteLength : body.size;
  console.log(`[STT] → ${url} fmt=${formatHeader} rate=${sampleRate} size=${size}b`);

  try {
    const resp = await fetch(url, { method: 'POST', headers, body });
    const data = await resp.json();
    console.log(`[STT] ← status=${resp.status} result="${data.result || ''}" err="${data.error_message || ''}"`);

    if (!resp.ok) {
      const msg = data.error_message || data.error || data.message || JSON.stringify(data).slice(0, 200);
      // Конкретные сообщения по коду ошибки
      if (resp.status === 401)   { _showToast('⚠ Ошибка авторизации воркера. Проверьте App Secret в Администраторе.'); return null; }
      if (resp.status === 415)   { _showToast('⚠ Формат аудио не поддерживается. Используйте Chrome или Firefox.'); return null; }
      if (resp.status === 402)   { _showToast('⚠ Недостаточно средств на балансе Яндекс Cloud.'); return null; }
      if (resp.status === 429)   { _showToast('⚠ Превышен лимит запросов воркера.'); return null; }
      _showToast(`STT ошибка (${resp.status}): ${msg}`);
      console.error('[STT] error response:', data);
      return null;
    }

    const result = (data.result || '').trim();
    if (!result) {
      console.warn('[STT] empty result from Yandex. Full response:', data);
      return null;
    }
    return result;

  } catch (e) {
    _showToast('Ошибка соединения с воркером: ' + e.message);
    console.error('[STT] fetch error:', e);
    return null;
  }
}

// ── GPT intent parsing ────────────────────────────────────────────────────
export async function parseIntent(spokenText) {
  if (!state.D) return { intent: 'unknown', raw_text: spokenText };

  const cats    = [...state.D.incomeCats, ...state.D.expenseCats.map(c => c.name)].slice(0, 20);
  const wallets = state.D.wallets.map(w => w.name);

  const systemPrompt = `Ты ассистент по личным финансам. Пользователь надиктовал команду.
Определи намерение и верни ТОЛЬКО JSON (без markdown, без пояснений).

Намерения:
- "add_expense": расход. Поля: amount(число), category, wallet, note
- "add_income": доход. Поля: amount(число), category, wallet, note
- "add_transfer": перевод. Поля: amount, from_wallet, to_wallet
- "add_shopping": покупки. Поля: items([{name,qty,price}])
- "check_balance": баланс. Поля: wallet(опц.)
- "add_goal": цель. Поля: name, target_amount, deadline(YYYY-MM-DD, опц.)
- "unknown": непонятно. Поля: raw_text

Категории: ${cats.join(', ')}
Кошельки: ${wallets.join(', ')}
Дата: ${today()}`;

  const gptUrl   = (_gptUrl || _sttUrl).replace(/\/?$/, '');
  const endpoint = gptUrl.endsWith('/gpt') ? gptUrl : gptUrl + '/gpt';
  const headers  = { 'Content-Type': 'application/json' };
  if (_appSecret) headers['X-App-Secret'] = _appSecret;
  if (_userId)    headers['X-User-Id']    = _userId;

  try {
    const resp = await fetch(endpoint, {
      method: 'POST', headers,
      body: JSON.stringify({
        completionOptions: { stream: false, temperature: 0.1, maxTokens: 400 },
        messages: [
          { role: 'system', text: systemPrompt },
          { role: 'user',   text: spokenText   },
        ],
      }),
    });
    if (!resp.ok) return _fallbackParse(spokenText);
    const data  = await resp.json();
    const text  = data.result?.alternatives?.[0]?.message?.text || '';
    const clean = text.replace(/```json|```|\n/g, '').trim();
    if (!clean) return _fallbackParse(spokenText);
    return JSON.parse(clean);
  } catch (e) {
    console.warn('[GPT] parse error:', e.message);
    return _fallbackParse(spokenText);
  }
}

function _fallbackParse(text) {
  const t = text.toLowerCase();
  const amtMatch = text.match(/\b(\d[\d\s]*)\b/);
  const amount   = amtMatch ? parseFloat(amtMatch[1].replace(/\s/g, '')) : 0;
  if (t.match(/купи|список|магазин|продукт/)) return { intent: 'add_shopping',  items: [{ name: text.replace(/\d+/g, '').trim() || text, qty: 1, price: 0 }] };
  if (t.match(/трат|расход|купил|заплатил/))  return { intent: 'add_expense',   amount, category: 'Прочее', note: text };
  if (t.match(/доход|зарплат|получил|пришл/)) return { intent: 'add_income',    amount, category: 'Прочее', note: text };
  if (t.match(/перевод|перевел/))             return { intent: 'add_transfer',  amount, from_wallet: '', to_wallet: '' };
  return { intent: 'unknown', raw_text: text };
}

// ── Показ модального подтверждения ────────────────────────────────────────
export function handleVoiceIntent(intent, onConfirm) {
  const modal = document.getElementById('modal-voice-intent');
  if (!modal) { onConfirm && onConfirm(intent); return; }

  const titleEl   = modal.querySelector('.vi-title');
  const bodyEl    = modal.querySelector('.vi-body');
  const confirmBtn = modal.querySelector('.vi-confirm');
  const editBtn   = modal.querySelector('.vi-edit');

  const emojis = { add_expense: '💸', add_income: '💰', add_shopping: '🛒', add_transfer: '🔄', check_balance: '📊', add_goal: '🎯', unknown: '🤔' };
  const titles = { add_expense: 'Расход', add_income: 'Доход', add_shopping: 'Список покупок', add_transfer: 'Перевод', check_balance: 'Баланс', add_goal: 'Новая цель', unknown: 'Не распознано' };
  titleEl.textContent = (emojis[intent.intent] || '🎤') + ' ' + (titles[intent.intent] || 'Команда');

  let body = '';
  switch (intent.intent) {
    case 'add_expense': case 'add_income':
      body = `<b>${intent.amount ? fmt(intent.amount) : '(сумма?)'}</b>`
        + (intent.category ? ` · ${intent.category}` : '')
        + (intent.wallet   ? ` · ${intent.wallet}` : '')
        + (intent.note     ? `<br><span style="color:var(--text2);font-size:11px">${intent.note}</span>` : '');
      break;
    case 'add_shopping':
      body = (intent.items || []).map(i => `• <b>${i.name}</b>${i.qty > 1 ? ' × ' + i.qty : ''}${i.price ? ' — ' + fmt(i.price) : ''}`).join('<br>') || '(нет позиций)';
      break;
    case 'add_transfer':
      body = `<b>${intent.amount ? fmt(intent.amount) : '?'}</b>${intent.from_wallet ? ' из ' + intent.from_wallet : ''}${intent.to_wallet ? ' → ' + intent.to_wallet : ''}`;
      break;
    case 'check_balance':
      if (state.D) {
        const w = intent.wallet ? state.D.wallets.find(w => w.name.toLowerCase().includes(intent.wallet.toLowerCase())) : null;
        body = w ? `${w.name}: <b>${fmt(w.balance)}</b>` : `Общий: <b>${fmt(state.D.wallets.reduce((s, w) => s + w.balance, 0))}</b>`;
      }
      break;
    case 'add_goal':
      body = `<b>${intent.name || '?'}</b>${intent.target_amount ? ' — ' + fmt(intent.target_amount) : ''}${intent.deadline ? `<br>Срок: ${intent.deadline}` : ''}`;
      break;
    default:
      body = `"${intent.raw_text || ''}"<br><span style="color:var(--text2);font-size:11px">Попробуйте переформулировать</span>`;
  }
  bodyEl.innerHTML = body;

  const labels = { add_expense: 'Добавить расход', add_income: 'Добавить доход', add_shopping: 'Добавить в список', add_transfer: 'Выполнить перевод', check_balance: 'Понятно', add_goal: 'Создать цель', unknown: 'Ввести вручную' };
  confirmBtn.textContent = labels[intent.intent] || 'Подтвердить';
  confirmBtn.onclick = () => { modal.classList.remove('open'); onConfirm && onConfirm(intent); };
  editBtn.onclick    = () => { modal.classList.remove('open'); _openEdit(intent); };
  modal.classList.add('open');
}

function _openEdit(intent) {
  switch (intent.intent) {
    case 'add_expense': case 'add_income': {
      const m = document.getElementById('modal'); if (!m) return;
      m.classList.add('open');
      setTimeout(() => {
        window.setOpType && window.setOpType(intent.intent === 'add_expense' ? 'expense' : 'income');
        const a = document.getElementById('op-amount'); if (a && intent.amount) a.value = intent.amount;
        const n = document.getElementById('op-note');   if (n && intent.note)   n.value = intent.note;
        const cs = document.getElementById('op-cat');
        if (cs && intent.category) {
          for (let i = 0; i < cs.options.length; i++) {
            if (cs.options[i].value.toLowerCase().includes(intent.category.toLowerCase())) { cs.selectedIndex = i; break; }
          }
        }
      }, 100);
      break;
    }
    case 'add_shopping': window.openAddShopItem && window.openAddShopItem(); break;
    default: document.getElementById('modal')?.classList.add('open');
  }
}

// ── Выполнение интента ────────────────────────────────────────────────────
export function executeIntent(intent) {
  if (!state.D) return;
  const activeDate = window._getCalActiveDate ? window._getCalActiveDate() : today();

  switch (intent.intent) {
    case 'add_expense': case 'add_income': {
      const type = intent.intent === 'add_expense' ? 'expense' : 'income';
      if (!intent.amount) { _openEdit(intent); return; }
      const w = state.D.wallets.find(w => w.name.toLowerCase().includes((intent.wallet || '').toLowerCase())) || state.D.wallets[0];
      const op = { id: 'op' + Date.now() + '_' + Math.random().toString(36).slice(2, 6), type, amount: intent.amount, date: today(), wallet: w?.id, category: intent.category || 'Прочее', note: intent.note || '' };
      if (w) { if (type === 'income') w.balance += intent.amount; else w.balance -= intent.amount; }
      state.D.operations.push(op); sched();
      _showToast(`✓ ${type === 'income' ? 'Доход' : 'Расход'} ${fmt(intent.amount)} добавлен`);
      window._refreshCurrentScreen && window._refreshCurrentScreen();
      break;
    }
    case 'add_shopping': {
      if (!state.D.shoppingLists) state.D.shoppingLists = {};
      if (!state.D.shoppingLists[activeDate]) state.D.shoppingLists[activeDate] = [];
      (intent.items || []).forEach(item => {
        state.D.shoppingLists[activeDate].push({ id: 'sh' + Date.now() + Math.random(), name: item.name, qty: item.qty || 1, price: item.price || 0, done: false });
      });
      sched();
      _showToast(`✓ ${(intent.items || []).length} позиций добавлено`);
      window.renderShoppingList && window.renderShoppingList();
      window._renderShopWidget  && window._renderShopWidget();
      break;
    }
    case 'add_transfer': {
      if (!intent.amount) { _openEdit(intent); return; }
      const wf = state.D.wallets.find(w => w.name.toLowerCase().includes((intent.from_wallet || '').toLowerCase())) || state.D.wallets[0];
      const wt = state.D.wallets.find(w => w.name.toLowerCase().includes((intent.to_wallet   || '').toLowerCase())) || state.D.wallets[1] || state.D.wallets[0];
      const op = { id: 'op' + Date.now() + '_' + Math.random().toString(36).slice(2, 6), type: 'transfer', amount: intent.amount, date: today(), wallet: wf?.id, walletTo: wt?.id };
      if (wf) wf.balance -= intent.amount;
      if (wt && wt !== wf) wt.balance += intent.amount;
      state.D.operations.push(op); sched();
      _showToast(`✓ Перевод ${fmt(intent.amount)} выполнен`);
      window._refreshCurrentScreen && window._refreshCurrentScreen();
      break;
    }
    case 'add_goal': {
      if (!intent.name) { _openEdit(intent); return; }
      if (!state.D.goals) state.D.goals = [];
      const w = state.D.wallets.find(w => w.name.toLowerCase().includes('сбереж')) || state.D.wallets[0];
      state.D.goals.push({ id: 'goal' + Date.now(), name: intent.name, target: intent.target_amount || 0, walletId: w?.id, deadline: intent.deadline || null });
      sched(); _showToast('✓ Цель «' + intent.name + '» создана');
      break;
    }
    case 'check_balance': break; // показывается в модалке
    default: _openEdit(intent);
  }
}

// ── Плавающая кнопка голоса ───────────────────────────────────────────────
export function createSmartVoiceButton() {
  if (!document.getElementById('smart-voice-style')) {
    const style = document.createElement('style');
    style.id = 'smart-voice-style';
    style.textContent = `
      #smart-voice-btn {
        position:fixed; bottom:80px; right:20px; z-index:200;
        width:52px; height:52px; border-radius:50%;
        background:var(--amber); border:none;
        box-shadow:0 4px 16px rgba(0,0,0,.25);
        font-size:22px; cursor:pointer;
        display:flex; align-items:center; justify-content:center;
        transition:background .2s, transform .15s;
        -webkit-tap-highlight-color:transparent;
      }
      #smart-voice-btn:active { transform:scale(.93); }
      @media(min-width:700px){ #smart-voice-btn { bottom:28px; right:28px; } }
    `;
    document.head.appendChild(style);
  }

  const btn = document.createElement('button');
  btn.id = 'smart-voice-btn';
  btn.title = 'Голосовая команда';
  btn.setAttribute('aria-label', 'Голосовой ввод');
  btn.textContent = '🎤';
  let active = false;

  btn.onclick = async () => {
    if (!isVoiceConfigured()) {
      alert('Голосовой ввод не настроен.\n\nПерейдите: Администратор → введите URL Cloudflare Worker.');
      return;
    }
    if (active) { stopRecording(); return; }

    await startRecording(
      async text => {
        active = false; btn.textContent = '🎤'; btn.style.background = '';
        _showToast('🔍 «' + text + '» — анализирую...');
        const intent = await parseIntent(text);
        handleVoiceIntent(intent, executeIntent);
      },
      msg => {
        active = false; btn.textContent = '🎤'; btn.style.background = '';
        _showToast('⚠ ' + msg);
      },
      isRec => {
        active = isRec;
        btn.textContent   = isRec ? '⏹' : '⏳';
        btn.style.background = isRec ? '#c0392b' : 'var(--amber)';
        if (isRec) btn.style.transform = 'scale(1.12)';
        else btn.style.transform = '';
      }
    );
  };
  return btn;
}

// ── Инлайн-кнопка микрофона для полей ввода ───────────────────────────────
export function createVoiceButton(targetInputId, extraStyle = '') {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.title = 'Голосовой ввод';
  btn.style.cssText = 'background:var(--amber-light);border:1.5px solid var(--amber);border-radius:7px;padding:7px 9px;cursor:pointer;font-size:15px;flex-shrink:0;line-height:1;' + extraStyle;
  btn.textContent = '🎤';
  let active = false;

  btn.onclick = async () => {
    if (!isVoiceConfigured()) {
      alert('Голосовой ввод не настроен.\n\nПерейдите в «Администратор» и введите URL воркера.');
      return;
    }
    if (active) { stopRecording(); return; }
    await startRecording(
      text => {
        active = false; btn.textContent = '🎤'; btn.style.background = 'var(--amber-light)';
        const el = document.getElementById(targetInputId);
        if (el) { el.value = text; el.dispatchEvent(new Event('input', { bubbles: true })); el.focus(); }
      },
      msg => {
        active = false; btn.textContent = '🎤'; btn.style.background = 'var(--amber-light)';
        _showToast('⚠ ' + msg);
      },
      isRec => {
        active = isRec;
        btn.textContent  = isRec ? '⏹' : '⏳';
        btn.style.background = isRec ? '#fdd' : 'var(--amber-light)';
      }
    );
  };
  return btn;
}

// ── Toast уведомление ─────────────────────────────────────────────────────
export function _showToast(msg) {
  let t = document.getElementById('voice-toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'voice-toast';
    t.style.cssText = 'position:fixed;bottom:88px;right:24px;background:var(--topbar);color:#C9A96E;padding:10px 16px;border-radius:8px;font-size:12px;font-weight:600;z-index:999;max-width:290px;word-break:break-word;opacity:0;transition:opacity .3s;pointer-events:none;line-height:1.5;';
    document.body.appendChild(t);
  }
  if (t._tm) clearTimeout(t._tm);
  t.textContent   = msg;
  t.style.opacity = '1';
  t._tm = setTimeout(() => { t.style.opacity = '0'; }, 4000);
}
