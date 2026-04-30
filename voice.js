// voice.js — Гибридный голосовой ввод: Web Speech API + MediaRecorder через Cloudflare Worker
import { state, sched, fmt, today, appConfig } from './core.js';

let _recognition = null;
let _isRecording = false;
let _mediaRecorder = null;
let _audioChunks = [];

// ── Определение режима: добавлено на экран (PWA standalone) ──
function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches ||
         window.navigator.standalone === true;
}

// ── Получение настроек Worker ─────────────────────────────────
function getWorkerUrl() {
  return appConfig?.workerUrl || '';
}

function getAppSecret() {
  return appConfig?.appSecret || '';
}

// ── Проверка доступности Web Speech API ───────────────────────
function hasWebSpeech() {
  return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}

// ── Использовать ли MediaRecorder (Worker) вместо Web Speech ───
function useMediaRecorder() {
  // В standalone режиме на iOS Web Speech не работает → используем Worker
  if (isStandalone() && getWorkerUrl()) return true;
  // Если Web Speech недоступен (например, старый браузер) и есть Worker → Worker
  if (!hasWebSpeech() && getWorkerUrl()) return true;
  return false;
}

// ── Web Speech API запись (старый метод) ───────────────────────
async function startWebSpeech(onResult, onError, onStateChange) {
  if (_isRecording) {
    if (_recognition) {
      _recognition.abort();
      _recognition = null;
    }
    _isRecording = false;
    onStateChange && onStateChange(false);
    return;
  }

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    onError && onError('Web Speech API не поддерживается');
    return;
  }

  _recognition = new SR();
  _recognition.lang = 'ru-RU';
  _recognition.continuous = false;
  _recognition.interimResults = true;
  _recognition.maxAlternatives = 3;

  _recognition.onstart = () => {
    _isRecording = true;
    onStateChange && onStateChange(true);
  };

  _recognition.onresult = (e) => {
    let interim = '', final = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      if (e.results[i].isFinal) final += e.results[i][0].transcript;
      else interim += e.results[i][0].transcript;
    }
    if (final) {
      _isRecording = false;
      onStateChange && onStateChange(false);
      onResult && onResult(final.trim());
    }
  };

  _recognition.onerror = (e) => {
    if (e.error === 'aborted') return;
    _resetWebSpeech();
    const errors = {
      'not-allowed': 'Нет доступа к микрофону',
      'no-speech': 'Не услышал речь',
      'network': 'Нет интернета',
      'audio-capture': 'Микрофон не найден',
    };
    onError && onError(errors[e.error] || 'Ошибка: ' + e.error);
  };

  _recognition.onend = () => {
    if (_isRecording) _resetWebSpeech(onStateChange);
  };

  try {
    _recognition.start();
  } catch (e) {
    _resetWebSpeech(onStateChange);
    onError && onError('Не удалось запустить: ' + e.message);
  }
}

function _resetWebSpeech(onStateChange) {
  if (_recognition) {
    try { _recognition.abort(); } catch(e) {}
    _recognition = null;
  }
  _isRecording = false;
  onStateChange && onStateChange(false);
}

// ── MediaRecorder + Worker (для PWA standalone) ─────────────────
async function startMediaRecorder(onResult, onError, onStateChange) {
  if (_isRecording) {
    stopMediaRecorder(onStateChange);
    return;
  }

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    onError && onError('Нет доступа к микрофону');
    return;
  }

  const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4';
  _mediaRecorder = new MediaRecorder(stream, { mimeType });
  _audioChunks = [];

  _mediaRecorder.ondataavailable = (event) => {
    if (event.data.size > 0) _audioChunks.push(event.data);
  };

  _mediaRecorder.onstop = async () => {
    const audioBlob = new Blob(_audioChunks, { type: mimeType });
    const reader = new FileReader();
    reader.onloadend = async () => {
      const base64data = reader.result.split(',')[1];
      const workerUrl = getWorkerUrl();
      const secret = getAppSecret();
      if (!workerUrl) {
        onError && onError('Worker URL не задан. Настройте в Админ-панели.');
        stopMediaRecorder(onStateChange);
        return;
      }

      try {
        const resp = await fetch(workerUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-App-Secret': secret
          },
          body: JSON.stringify({
            audio: base64data,
            format: mimeType === 'audio/webm' ? 'webm' : 'm4a'
          })
        });
        const data = await resp.json();
        if (data.text) {
          onResult && onResult(data.text);
        } else {
          onError && onError(data.error || 'Не удалось распознать речь');
        }
      } catch (err) {
        console.error('Worker error:', err);
        onError && onError('Ошибка связи с сервером распознавания');
      } finally {
        stopMediaRecorder(onStateChange);
      }
    };
    reader.readAsDataURL(audioBlob);
    // освобождаем дорожки
    stream.getTracks().forEach(track => track.stop());
  };

  _mediaRecorder.start();
  _isRecording = true;
  onStateChange && onStateChange(true);

  // автоматическая остановка через 5 секунд
  setTimeout(() => {
    if (_mediaRecorder && _mediaRecorder.state === 'recording') {
      _mediaRecorder.stop();
    }
  }, 5000);
}

function stopMediaRecorder(onStateChange) {
  if (_mediaRecorder && _mediaRecorder.state !== 'inactive') {
    _mediaRecorder.stop();
  }
  _mediaRecorder = null;
  _isRecording = false;
  onStateChange && onStateChange(false);
}

// ── Единая точка запуска записи ─────────────────────────────────
export async function startRecording(onResult, onError, onStateChange) {
  if (useMediaRecorder()) {
    await startMediaRecorder(onResult, onError, onStateChange);
  } else {
    await startWebSpeech(onResult, onError, onStateChange);
  }
}

export function stopRecording() {
  if (useMediaRecorder()) {
    if (_mediaRecorder && _mediaRecorder.state === 'recording') {
      _mediaRecorder.stop();
    }
  } else {
    if (_recognition) {
      try { _recognition.abort(); } catch(e) {}
      _recognition = null;
    }
  }
  _isRecording = false;
}

export function isRecording() {
  return _isRecording;
}

// ── Заглушки для совместимости (не используются, но оставляем) ──
export function loadVoiceSettings() {}
export function saveVoiceSettings(sttUrl, gptUrl, appSecret) {
  if (!state.D) return;
  if (!state.D.voiceSettings) state.D.voiceSettings = {};
  state.D.voiceSettings.proxyUrl = sttUrl || '';
  state.D.voiceSettings.appSecret = appSecret || '';
}
export function isVoiceConfigured() {
  // Работает, если есть Web Speech ИЛИ настроен Worker
  return hasWebSpeech() || !!getWorkerUrl();
}

// ── Разбор намерений (локально, без GPT) ─────────────────────────
export async function parseIntent(text) {
  if (!state.D || !text) return { intent: 'unknown', raw_text: text };
  const t = text.toLowerCase().trim();

  if (['купить','купи','куплю','добавь в список','нужно купить'].some(v => t.includes(v))) {
    const items = _parseShoppingItems(t);
    if (items.length) return { intent: 'add_shopping', items };
  }
  if (/баланс|сколько|остаток/.test(t)) {
    const w = _findWallet(t);
    return { intent: 'check_balance', wallet: w?.name || '' };
  }
  if (/перевёл|перевел|перевести|перевод/.test(t)) {
    const wallets = _transferWallets(t);
    return { intent: 'add_transfer', amount: _amount(t), from_wallet: wallets.from, to_wallet: wallets.to };
  }
  if (['получил','получила','заработал','заработала','пришло','пришла','зарплата','аванс','начислили'].some(v => t.includes(v))) {
    const w = _findWallet(t);
    return { intent: 'add_income', amount: _amount(t), category: _cat(t, 'income'), wallet: w?.name || '', note: '' };
  }
  const amount = _amount(t);
  if (amount > 0) {
    const w = _findWallet(t);
    return { intent: 'add_expense', amount, category: _cat(t, 'expense'), wallet: w?.name || '', note: '' };
  }
  return { intent: 'unknown', raw_text: text };
}

function _amount(text) {
  const all = [...text.matchAll(/\b(\d[\d\s]{0,5}\d|\d+)(?:[,\.](\d{1,2}))?\b/g)];
  for (const m of all) {
    const n = parseFloat(m[0].replace(/\s/g, '').replace(',', '.'));
    if (!isNaN(n) && n > 0 && !(n >= 2000 && n <= 2035)) return n;
  }
  const words = {
    'ноль':0,'один':1,'одна':1,'два':2,'две':2,'три':3,'четыре':4,'пять':5,
    'шесть':6,'семь':7,'восемь':8,'девять':9,'десять':10,'двадцать':20,'тридцать':30,
    'сорок':40,'пятьдесят':50,'шестьдесят':60,'семьдесят':70,'восемьдесят':80,
    'девяносто':90,'сто':100,'двести':200,'триста':300,'четыреста':400,'пятьсот':500,
    'шестьсот':600,'семьсот':700,'восемьсот':800,'девятьсот':900,'тысяча':1000,
    'тысячи':1000,'тысяч':1000,'тыщ':1000,'миллион':1000000
  };
  let total = 0, cur = 0;
  for (const w of text.split(/\s+/)) {
    const v = words[w];
    if (v !== undefined) {
      if (v >= 1000) { total = (total + cur) * v; cur = 0; }
      else cur += v;
    }
  }
  return total + cur;
}

function _cat(text, type) {
  if (!state.D) return 'Прочее';
  const cats = type === 'income' ? state.D.incomeCats : state.D.expenseCats.map(c => c.name);
  const t = text.toLowerCase();
  for (const c of cats) if (t.includes(c.toLowerCase())) return c;
  const map = [
    [/продукт|еда|магазин|супермаркет|пятёрочк|магнит|лента|ашан/,'Продукты'],
    [/транспорт|метро|такси|автобус|бензин|заправк/,'Транспорт'],
    [/кафе|ресторан|кофе|обед|ужин|завтрак/,'Кафе и рестораны'],
    [/аптек|лекарств|врач|больниц/,'Здоровье'],
    [/одежд|обувь/,'Одежда'],
    [/зарплат|аванс|оклад/,'Зарплата'],
    [/кредит|ипотек/,'Кредит'],
    [/связь|интернет|телефон/,'Связь'],
    [/квартплат|коммунал|аренда|жкх/,'Квартплата'],
    [/развлечен|кино|игр/,'Развлечения'],
  ];
  for (const [re, cat] of map) {
    if (re.test(t)) {
      const found = cats.find(c => c.toLowerCase() === cat.toLowerCase());
      if (found) return found;
    }
  }
  return 'Прочее';
}

function _findWallet(text) {
  if (!state.D) return null;
  const t = text.toLowerCase();
  for (const w of state.D.wallets) if (t.includes(w.name.toLowerCase())) return w;
  if (/карт|безнал/.test(t)) return state.D.wallets.find(w => /карт|black|platinum|тинькофф|сбер/i.test(w.name)) || null;
  if (/налич|кэш/.test(t)) return state.D.wallets.find(w => /налич/i.test(w.name)) || null;
  return null;
}

function _transferWallets(text) {
  const t = text.toLowerCase();
  let from = '', to = '';
  for (const w of (state.D?.wallets || [])) {
    const n = w.name.toLowerCase();
    const idx = t.indexOf(n);
    if (idx < 0) continue;
    const before = t.slice(0, idx);
    if (/(?:с|из)\s*$/.test(before)) from = w.name;
    else if (/(?:на|в|во)\s*$/.test(before)) to = w.name;
  }
  return { from, to };
}

function _parseShoppingItems(text) {
  const clean = text.replace(/купить|купи|куплю|добавь в список|нужно купить/g, ' ');
  const parts = clean.split(/,|\bи\b/).map(s => s.trim()).filter(s => s.length > 1);
  return parts.map(p => {
    const qm = p.match(/(\d+)/);
    const qty = qm ? parseInt(qm[1]) : 1;
    const name = p.replace(/\d+\s*(?:шт|штук|пачк|литр|кг|грамм|упак)?/g, '').trim();
    return name.length > 1 ? { name, qty, price: 0 } : null;
  }).filter(Boolean);
}

// ── Модал подтверждения (без изменений) ─────────────────────────
export function handleVoiceIntent(intent, onConfirm) {
  const modal = document.getElementById('modal-voice-intent');
  if (!modal) return;
  const titleEl = modal.querySelector('.vi-title');
  const bodyEl = modal.querySelector('.vi-body');
  const confirmBtn = modal.querySelector('.vi-confirm');
  const editBtn = modal.querySelector('.vi-edit');
  if (!bodyEl || !confirmBtn) return;
  const titles = { add_expense: 'РАСХОД', add_income: 'ДОХОД', add_transfer: 'ПЕРЕВОД', add_shopping: 'СПИСОК ПОКУПОК', check_balance: 'БАЛАНС', unknown: 'НЕ ПОНЯЛ' };
  if (titleEl) titleEl.textContent = titles[intent.intent] || 'КОМАНДА';
  let body = '';
  switch (intent.intent) {
    case 'add_expense': case 'add_income':
      body = `<b>${intent.amount ? fmt(intent.amount) : '?'}</b>${intent.category ? ' · ' + intent.category : ''}${intent.wallet ? ' · ' + intent.wallet : ''}`;
      break;
    case 'add_shopping':
      body = (intent.items || []).map(i => `• <b>${i.name}</b>${i.qty > 1 ? ' × ' + i.qty : ''}`).join('<br>') || '(нет позиций)';
      break;
    case 'add_transfer':
      body = `<b>${intent.amount ? fmt(intent.amount) : '?'}</b>${intent.from_wallet ? ' из ' + intent.from_wallet : ''}${intent.to_wallet ? ' → ' + intent.to_wallet : ''}`;
      break;
    case 'check_balance':
      if (state.D) {
        if (intent.wallet) {
          const w = state.D.wallets.find(w => w.name.toLowerCase().includes(intent.wallet.toLowerCase()));
          body = w ? `${w.name}: <b>${fmt(w.balance)}</b>` : 'Кошелёк не найден';
        } else {
          body = `Общий: <b>${fmt(state.D.wallets.reduce((s, w) => s + w.balance, 0))}</b><br>` +
                 state.D.wallets.map(w => `${w.name}: ${fmt(w.balance)}`).join('<br>');
        }
      }
      break;
    default: body = `"${intent.raw_text || ''}"<br><span style="font-size:11px;color:var(--text2)">Попробуйте переформулировать</span>`;
  }
  bodyEl.innerHTML = body;
  const labels = { add_expense: 'Добавить расход', add_income: 'Добавить доход', add_shopping: 'Добавить в список', add_transfer: 'Выполнить перевод', check_balance: 'Понятно', unknown: 'Ввести вручную' };
  confirmBtn.textContent = labels[intent.intent] || 'Подтвердить';
  confirmBtn.onclick = () => { modal.classList.remove('open'); onConfirm && onConfirm(intent); };
  editBtn.onclick = () => { modal.classList.remove('open'); _openEdit(intent); };
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
        const n = document.getElementById('op-note'); if (n && intent.note) n.value = intent.note;
        const cs = document.getElementById('op-cat');
        if (cs && intent.category) {
          for (let i = 0; i < cs.options.length; i++) {
            if (cs.options[i].value.toLowerCase().includes(intent.category.toLowerCase())) {
              cs.selectedIndex = i; break;
            }
          }
        }
      }, 100);
      break;
    }
    case 'add_shopping': window.openAddShopItem && window.openAddShopItem(); break;
    default: document.getElementById('modal')?.classList.add('open');
  }
}

// ── Выполнить команду ─────────────────────────────────────────────
export function executeIntent(intent) {
  if (!state.D) return;
  switch (intent.intent) {
    case 'add_expense': case 'add_income': {
      const type = intent.intent === 'add_expense' ? 'expense' : 'income';
      if (!intent.amount) { _openEdit(intent); return; }
      const w = state.D.wallets.find(w => w.name.toLowerCase().includes((intent.wallet || '').toLowerCase())) || state.D.wallets[0];
      const op = {
        id: 'op' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
        type, amount: intent.amount, date: today(), wallet: w?.id,
        category: intent.category || 'Прочее', note: intent.note || ''
      };
      if (w) { if (type === 'income') w.balance += intent.amount; else w.balance -= intent.amount; }
      state.D.operations.push(op); sched();
      _showToast(`✓ ${type === 'income' ? 'Доход' : 'Расход'} ${fmt(intent.amount)} добавлен`);
      window._refreshCurrentScreen && window._refreshCurrentScreen();
      break;
    }
    case 'add_shopping': {
      if (!state.D.shoppingLists) state.D.shoppingLists = {};
      const date = state.calDay || today();
      if (!state.D.shoppingLists[date]) state.D.shoppingLists[date] = [];
      (intent.items || []).forEach(i => {
        state.D.shoppingLists[date].push({
          id: 'sh' + Date.now() + Math.random(), name: i.name, qty: i.qty || 1, price: i.price || 0, done: false
        });
      });
      sched(); _showToast(`✓ ${(intent.items || []).length} позиций добавлено`);
      window._renderShopWidget && window._renderShopWidget();
      break;
    }
    case 'add_transfer': {
      if (!intent.amount) { _openEdit(intent); return; }
      const wf = state.D.wallets.find(w => w.name.toLowerCase().includes((intent.from_wallet || '').toLowerCase())) || state.D.wallets[0];
      const wt = state.D.wallets.find(w => w.name.toLowerCase().includes((intent.to_wallet || '').toLowerCase())) || state.D.wallets[1] || state.D.wallets[0];
      const op = { id: 'op' + Date.now(), type: 'transfer', amount: intent.amount, date: today(), wallet: wf?.id, walletTo: wt?.id };
      if (wf) wf.balance -= intent.amount; if (wt && wt !== wf) wt.balance += intent.amount;
      state.D.operations.push(op); sched();
      _showToast(`✓ Перевод ${fmt(intent.amount)} выполнен`);
      window._refreshCurrentScreen && window._refreshCurrentScreen();
      break;
    }
    case 'check_balance': break;
    default: _openEdit(intent);
  }
}

// ── Плавающая кнопка ─────────────────────────────────────────────
export function createSmartVoiceButton() {
  const btn = document.createElement('button');
  btn.id = 'smart-voice-btn';
  btn.title = 'Голосовая команда';
  btn.setAttribute('aria-label', 'Голосовой ввод');
  btn.textContent = '🎤';

  const setIdle = () => { btn.textContent = '🎤'; btn.style.background = 'var(--amber)'; btn.style.transform = 'scale(1)'; };
  const setActive = () => { btn.textContent = '⏹'; btn.style.background = '#c0392b'; btn.style.transform = 'scale(1.12)'; };

  btn.onclick = async () => {
    if (isRecording()) { stopRecording(); setIdle(); return; }
    await startRecording(
      async text => {
        setIdle();
        _showToast('🔍 «' + text + '» — разбираю...');
        try {
          const intent = await parseIntent(text);
          handleVoiceIntent(intent, executeIntent);
        } catch (e) { _showToast('⚠ Не удалось разобрать команду'); }
      },
      msg => { setIdle(); _showToast('⚠ ' + msg); },
      isRec => { if (isRec) setActive(); else setIdle(); }
    );
  };
  return btn;
}

// ── Встроенная кнопка в поле ввода (для форм) ────────────────────
export function createVoiceButton(targetInputId, extraStyle = '') {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.title = 'Голосовой ввод';
  btn.style.cssText = 'background:var(--amber-light);border:1.5px solid var(--amber);border-radius:7px;padding:7px 9px;cursor:pointer;font-size:15px;flex-shrink:0;line-height:1;' + extraStyle;
  btn.textContent = '🎤';

  const setIdle = () => { btn.textContent = '🎤'; btn.style.background = 'var(--amber-light)'; };
  const setActive = () => { btn.textContent = '⏹'; btn.style.background = '#fdd'; };

  btn.onclick = async () => {
    if (isRecording()) { stopRecording(); setIdle(); return; }
    await startRecording(
      text => {
        setIdle();
        const el = document.getElementById(targetInputId);
        if (el) { el.value = text; el.dispatchEvent(new Event('input', { bubbles: true })); }
      },
      msg => { setIdle(); _showToast('⚠ ' + msg); },
      isRec => { if (isRec) setActive(); else setIdle(); }
    );
  };
  return btn;
}

function _showToast(msg) {
  let t = document.getElementById('voice-toast');
  if (!t) {
    t = document.createElement('div'); t.id = 'voice-toast';
    t.style.cssText = 'position:fixed;bottom:88px;right:24px;background:var(--topbar);color:#C9A96E;padding:10px 16px;border-radius:8px;font-size:12px;font-weight:600;z-index:999;max-width:290px;word-break:break-word;opacity:0;transition:opacity .3s;pointer-events:none;line-height:1.5;';
    document.body.appendChild(t);
  }
  if (t._tm) clearTimeout(t._tm);
  t.textContent = msg; t.style.opacity = '1';
  t._tm = setTimeout(() => { t.style.opacity = '0'; }, 3500);
}