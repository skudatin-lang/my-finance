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
  if (isStandalone() && getWorkerUrl()) return true;
  if (!hasWebSpeech() && getWorkerUrl()) return true;
  return false;
}

// ── Web Speech API запись (без изменений) ───────────────────────
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
        if (data.result) {
          onResult && onResult(data.result);
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
    stream.getTracks().forEach(track => track.stop());
  };

  _mediaRecorder.start();
  _isRecording = true;
  onStateChange && onStateChange(true);

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

// ── Заглушки для совместимости ──────────────────────────────────
export function loadVoiceSettings() {}
export function saveVoiceSettings(sttUrl, gptUrl, appSecret) {
  if (!state.D) return;
  if (!state.D.voiceSettings) state.D.voiceSettings = {};
  state.D.voiceSettings.proxyUrl = sttUrl || '';
  state.D.voiceSettings.appSecret = appSecret || '';
}
export function isVoiceConfigured() {
  return hasWebSpeech() || !!getWorkerUrl();
}

// ── УЛУЧШЕННЫЙ РАЗБОР НАМЕРЕНИЙ ───────────────────────────────────
export async function parseIntent(text) {
  if (!state.D || !text) return { intent: 'unknown', raw_text: text };
  const t = text.toLowerCase().trim();

  // 1. Проверка на перевод
  if (/перев[её]л|перевести|перевод|перевела|перекинул|отправил|скинул|перечисл|кинул|закинул/.test(t)) {
    const amount = _extractAmount(t);
    const wallets = _extractWalletsTransfer(t);
    return {
      intent: 'add_transfer',
      amount,
      from_wallet: wallets.from,
      to_wallet: wallets.to,
      note: text
    };
  }

  // 2. Проверка на добавление в список покупок
  if (['купить','купи','куплю','добавь в список','нужно купить','добавь товар','список покупок'].some(v => t.includes(v))) {
    const items = _parseShoppingItems(t);
    if (items.length) return { intent: 'add_shopping', items };
  }

  // 3. Проверка баланса
  if (/баланс|сколько|остаток|покажи|проверь/.test(t)) {
    const w = _findWallet(t);
    return { intent: 'check_balance', wallet: w?.name || '' };
  }

  // 4. Доход
  if (['получил','получила','заработал','заработала','пришло','пришла','зарплата','аванс','начислили','перевели','закинули','капает','капнуло','поступило','перечисление'].some(v => t.includes(v))) {
    const amount = _extractAmount(t);
    const category = _extractCategory(t, 'income');
    const wallet = _findWallet(t)?.name || '';
    return { intent: 'add_income', amount, category, wallet, note: text };
  }

  // 5. Расход
  const amount = _extractAmount(t);
  if (amount > 0) {
    const category = _extractCategory(t, 'expense');
    const wallet = _findWallet(t)?.name || '';
    return { intent: 'add_expense', amount, category, wallet, note: text };
  }

  return { intent: 'unknown', raw_text: text };
}

// ── Вспомогательные функции парсинга ─────────────────────────────

function _extractAmount(text) {
  // Ищем числа (целые и дробные) — например, "1000", "1 500", "250,50", "триста"
  const all = [...text.matchAll(/\b(\d[\d\s]{0,5}\d|\d+)(?:[,\.](\d{1,2}))?\b/g)];
  for (const m of all) {
    const n = parseFloat(m[0].replace(/\s/g, '').replace(',', '.'));
    if (!isNaN(n) && n > 0 && !(n >= 2000 && n <= 2035)) return n;
  }
  // Слова-числительные (простые)
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

function _extractWalletsTransfer(text) {
  const t = text.toLowerCase();
  let from = '', to = '';
  // Ищем все кошельки в строке
  const wallets = (state.D?.wallets || []).map(w => ({ id: w.id, name: w.name, lower: w.name.toLowerCase() }));
  // Находим индексы вхождения названий кошельков
  let fromIndex = -1, toIndex = -1;
  for (const w of wallets) {
    const idx = t.indexOf(w.lower);
    if (idx === -1) continue;
    // Определяем, является ли этот кошелёк источником или получателем по предлогам
    const before = t.slice(Math.max(0, idx - 12), idx);
    if (/с\s|из\s|со\s|от\s/.test(before)) {
      from = w.name;
      fromIndex = idx;
    } else if (/на\s|в\s|во\s|для\s|перевёл\s|перевел\s|кинул\s|отправил\s/.test(before)) {
      to = w.name;
      toIndex = idx;
    }
  }
  // Если не удалось определить по предлогам, то первый найденный кошелёк считаем источником, второй – получателем
  if (!from && !to && wallets.length >= 2) {
    const first = wallets[0];
    const second = wallets[1];
    if (first && second) {
      const idxFirst = t.indexOf(first.lower);
      const idxSecond = t.indexOf(second.lower);
      if (idxFirst !== -1 && idxSecond !== -1) {
        if (idxFirst < idxSecond) { from = first.name; to = second.name; }
        else { from = second.name; to = first.name; }
      }
    }
  }
  // Если нет явного "на" или "в", но есть кошелёк после "жене", "маме" и т.п., пытаемся угадать
  if (!to && /жен[еу]|мам[еу]|пап[еу]|другу|подруг[еу]|коллег[еу]|брату|сестр[еу]/.test(t)) {
    // Базовое: ищем кошелёк, содержащий подстроку 'карта' или 'счет', если нет — создаём временный?
    // Но лучше оставить как есть, пользователь сможет отредактировать.
  }
  return { from, to };
}

function _extractCategory(text, type) {
  if (!state.D) return 'Прочее';
  const t = text.toLowerCase();
  const cats = type === 'income' ? state.D.incomeCats : state.D.expenseCats.map(c => c.name);
  for (const c of cats) if (t.includes(c.toLowerCase())) return c;
  const map = [
    [/продукт|еда|магазин|супермаркет|пятёрочк|магнит|лента|ашан/,'Продукты'],
    [/транспорт|метро|такси|автобус|бензин|заправк|проезд/,'Транспорт'],
    [/кафе|ресторан|кофе|обед|ужин|завтрак|столовая/,'Кафе и рестораны'],
    [/аптек|лекарств|врач|больниц|здоровье|медицина/,'Здоровье'],
    [/одежд|обувь|шоппинг/,'Одежда'],
    [/зарплат|аванс|оклад|заработн|доход/,'Зарплата'],
    [/кредит|ипотек|займ/,'Кредит'],
    [/связь|интернет|телефон|мессенджер/,'Связь'],
    [/квартплат|коммунал|аренда|жкх|свет|газ|вода/,'Квартплата'],
    [/развлечен|кино|игр|концерт|театр/,'Развлечения'],
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
  // Ищем точное вхождение названия кошелька
  for (const w of state.D.wallets) {
    if (t.includes(w.name.toLowerCase())) return w;
  }
  // Если нет, пытаемся по ключевым словам
  if (/карт|безнал|тинькофф|сбер|альфа|втб|открытие|рф/.test(t)) {
    const found = state.D.wallets.find(w => /карт|black|platinum|тинькофф|сбер/i.test(w.name));
    if (found) return found;
  }
  if (/налич|кэш|рубли|деньги/.test(t)) {
    const found = state.D.wallets.find(w => /налич/i.test(w.name));
    if (found) return found;
  }
  return null;
}

function _parseShoppingItems(text) {
  const clean = text.replace(/купить|купи|куплю|добавь в список|нужно купить|список покупок/g, ' ');
  const parts = clean.split(/,|\bи\b/).map(s => s.trim()).filter(s => s.length > 1);
  return parts.map(p => {
    const qm = p.match(/(\d+)/);
    const qty = qm ? parseInt(qm[1]) : 1;
    const name = p.replace(/\d+\s*(?:шт|штук|пачк|литр|кг|грамм|упак)?/g, '').trim();
    return name.length > 1 ? { name, qty, price: 0 } : null;
  }).filter(Boolean);
}

// ── Модал подтверждения (улучшенный) ─────────────────────────────
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
    case 'add_expense':
      body = `<b>${intent.amount ? fmt(intent.amount) : '?'} ₽</b> — ${intent.category || '?'}${intent.wallet ? ` · ${intent.wallet}` : ''}`;
      break;
    case 'add_income':
      body = `<b>${intent.amount ? fmt(intent.amount) : '?'} ₽</b> — ${intent.category || '?'}${intent.wallet ? ` · ${intent.wallet}` : ''}`;
      break;
    case 'add_transfer':
      body = `<b>${intent.amount ? fmt(intent.amount) : '?'} ₽</b><br>`;
      if (intent.from_wallet) body += `из ${intent.from_wallet}<br>`;
      if (intent.to_wallet) body += `→ ${intent.to_wallet}`;
      else body += `→ (не указан)`;
      break;
    case 'add_shopping':
      body = (intent.items || []).map(i => `• <b>${i.name}</b>${i.qty > 1 ? ' × ' + i.qty : ''}`).join('<br>') || '(нет позиций)';
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
    default:
      body = `"${intent.raw_text || ''}"<br><span style="font-size:11px;color:var(--text2)">Попробуйте переформулировать</span>`;
  }

  bodyEl.innerHTML = body;

  const labels = { add_expense: 'Добавить расход', add_income: 'Добавить доход', add_shopping: 'Добавить в список', add_transfer: 'Выполнить перевод', check_balance: 'Понятно', unknown: 'Ввести вручную' };
  confirmBtn.textContent = labels[intent.intent] || 'Подтвердить';

  confirmBtn.onclick = () => {
    modal.classList.remove('open');
    onConfirm && onConfirm(intent);
  };

  editBtn.onclick = () => {
    modal.classList.remove('open');
    _openEdit(intent);
  };

  modal.classList.add('open');
}

function _openEdit(intent) {
  switch (intent.intent) {
    case 'add_expense':
    case 'add_income': {
      const modal = document.getElementById('modal');
      if (!modal) return;
      modal.classList.add('open');
      setTimeout(() => {
        window.setOpType(intent.intent === 'add_expense' ? 'expense' : 'income');
        const amountField = document.getElementById('op-amount');
        if (amountField && intent.amount) amountField.value = intent.amount;
        const noteField = document.getElementById('op-note');
        if (noteField && intent.note) noteField.value = intent.note;
        const catSelect = document.getElementById('op-cat');
        if (catSelect && intent.category) {
          for (let i = 0; i < catSelect.options.length; i++) {
            if (catSelect.options[i].value.toLowerCase() === intent.category.toLowerCase()) {
              catSelect.selectedIndex = i; break;
            }
          }
        }
        const walletSelect = document.getElementById('op-wallet');
        if (walletSelect && intent.wallet && state.D) {
          const w = state.D.wallets.find(w => w.name.toLowerCase().includes(intent.wallet.toLowerCase()));
          if (w) walletSelect.value = w.id;
        }
      }, 100);
      break;
    }
    case 'add_transfer': {
      const modal = document.getElementById('modal');
      if (!modal) return;
      modal.classList.add('open');
      setTimeout(() => {
        window.setOpType('transfer');
        const amountField = document.getElementById('op-amount');
        if (amountField && intent.amount) amountField.value = intent.amount;
        const fromSelect = document.getElementById('op-wallet');
        const toSelect = document.getElementById('op-wallet2');
        if (fromSelect && intent.from_wallet && state.D) {
          const wf = state.D.wallets.find(w => w.name.toLowerCase().includes(intent.from_wallet.toLowerCase()));
          if (wf) fromSelect.value = wf.id;
        }
        if (toSelect && intent.to_wallet && state.D) {
          const wt = state.D.wallets.find(w => w.name.toLowerCase().includes(intent.to_wallet.toLowerCase()));
          if (wt) toSelect.value = wt.id;
        }
      }, 100);
      break;
    }
    case 'add_shopping':
      window.openAddShopItem && window.openAddShopItem();
      break;
    default:
      if (document.getElementById('modal')) document.getElementById('modal').classList.add('open');
  }
}

// ── Выполнить команду (без изменений, но с заполнением всех полей) ──
export function executeIntent(intent) {
  if (!state.D) return;
  switch (intent.intent) {
    case 'add_expense':
    case 'add_income': {
      const type = intent.intent === 'add_expense' ? 'expense' : 'income';
      if (!intent.amount) { _openEdit(intent); return; }
      const w = intent.wallet ? state.D.wallets.find(w => w.name.toLowerCase().includes(intent.wallet.toLowerCase())) : state.D.wallets[0];
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
    case 'add_transfer': {
      if (!intent.amount) { _openEdit(intent); return; }
      const wf = intent.from_wallet ? state.D.wallets.find(w => w.name.toLowerCase().includes(intent.from_wallet.toLowerCase())) : state.D.wallets[0];
      const wt = intent.to_wallet ? state.D.wallets.find(w => w.name.toLowerCase().includes(intent.to_wallet.toLowerCase())) : (state.D.wallets[1] || state.D.wallets[0]);
      if (!wf || !wt) { _openEdit(intent); return; }
      const op = {
        id: 'op' + Date.now(),
        type: 'transfer',
        amount: intent.amount,
        date: today(),
        wallet: wf.id,
        walletTo: wt.id,
        note: intent.note || ''
      };
      if (wf) wf.balance -= intent.amount;
      if (wt && wt.id !== wf.id) wt.balance += intent.amount;
      state.D.operations.push(op); sched();
      _showToast(`✓ Перевод ${fmt(intent.amount)} выполнен`);
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
      if (window._renderShopWidget) window._renderShopWidget();
      if (window.renderShoppingList) window.renderShoppingList();
      break;
    }
    case 'check_balance':
      // Ничего не делаем, просто показали в модале
      break;
    default:
      _openEdit(intent);
  }
}

// ── Плавающая кнопка (без изменений) ─────────────────────────────
export function createSmartVoiceButton() {
  const btn = document.createElement('button');
  btn.id = 'smart-voice-btn';
  btn.title = 'Голосовая команда';
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