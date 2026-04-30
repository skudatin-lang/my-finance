// voice.js — Гибридный голосовой ввод: Web Speech API + MediaRecorder через Cloudflare Worker
import { state, sched, fmt, today, appConfig } from './core.js';

let _recognition = null;
let _isRecording = false;
let _mediaRecorder = null;
let _audioChunks = [];

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches ||
         window.navigator.standalone === true;
}

function getWorkerUrl() {
  return appConfig?.workerUrl || '';
}

function getAppSecret() {
  return appConfig?.appSecret || '';
}

function hasWebSpeech() {
  return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}

function useMediaRecorder() {
  if (isStandalone() && getWorkerUrl()) return true;
  if (!hasWebSpeech() && getWorkerUrl()) return true;
  return false;
}

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

// ── Улучшенный разбор намерений ─────────────────────────────────
export async function parseIntent(text) {
  if (!state.D || !text) return { intent: 'unknown', raw_text: text };
  let t = text.toLowerCase().trim();

  // 1. Переводы
  if (/перевёл|перевел|перевести|перевод|переведи|с карты на карту|на карту/i.test(t)) {
    const wallets = _transferWallets(text);
    const amount = _amount(t);
    if (!wallets.from || !wallets.to) {
      const match = t.match(/с\s+([а-яё\s\-]+?)\s+на\s+([а-яё\s\-]+?)(?:\s+(?:перевёл|перевел|перевод|$))/i);
      if (match) {
        wallets.from = match[1].trim();
        wallets.to = match[2].trim();
      }
    }
    return { intent: 'add_transfer', amount, from_wallet: wallets.from, to_wallet: wallets.to };
  }

  // 2. Покупки (список)
  if (['купить','купи','куплю','добавь в список','нужно купить'].some(v => t.includes(v))) {
    const items = _parseShoppingItems(t);
    if (items.length) return { intent: 'add_shopping', items };
  }

  // 3. Баланс
  if (/баланс|сколько|остаток|денег|кошелёк|кошелек/i.test(t)) {
    const w = _findWallet(t);
    return { intent: 'check_balance', wallet: w?.name || '' };
  }

  // 4. Доходы
  if (['получил','получила','заработал','заработала','пришло','пришла','зарплата','аванс','начислили','перевели на карту','поступило'].some(v => t.includes(v))) {
    const w = _findWallet(t);
    return { intent: 'add_income', amount: _amount(t), category: _cat(t, 'income'), wallet: w?.name || '', note: '' };
  }

  // 5. Расходы
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

// Улучшенный поиск кошелька по тексту (нечеткое сопоставление)
function _findWallet(text) {
  if (!state.D || !state.D.wallets.length) return null;
  const t = text.toLowerCase();
  // Точное совпадение
  for (const w of state.D.wallets) {
    if (t.includes(w.name.toLowerCase())) return w;
  }
  // Синонимы
  const synonyms = {
    'т банк': ['тбанк', 'тинькофф', 'т-банк', 'тблэк', 'т-блэк', 'тиньк', 'black'],
    'сбер': ['сбербанк', 'сбербанк онлайн', 'сбер'],
    'наличные': ['наличные', 'кэш', 'налик', 'наличка'],
    'карта': ['карта', 'дебетовая', 'кредитная', 'пластик', 'картой'],
  };
  for (const [canonical, aliases] of Object.entries(synonyms)) {
    for (const alias of aliases) {
      if (t.includes(alias)) {
        const wallet = state.D.wallets.find(w => w.name.toLowerCase().includes(canonical));
        if (wallet) return wallet;
      }
    }
  }
  // Поиск по вхождению частей названия (например, "блэк" -> "Т-Блэк")
  for (const w of state.D.wallets) {
    const parts = w.name.toLowerCase().split(/[\s\-]+/);
    for (const part of parts) {
      if (part.length > 2 && t.includes(part)) return w;
    }
  }
  // Fallback: первый попавшийся
  return state.D.wallets[0];
}

function _transferWallets(text) {
  const t = text.toLowerCase();
  let from = '', to = '';

  // Ищем по шаблону "с X на Y"
  let match = t.match(/с\s+([а-яё\s\-]+?)\s+на\s+([а-яё\s\-]+?)(?:\s+(?:перевёл|перевел|перевод|$))/i);
  if (match) {
    from = match[1].trim();
    to = match[2].trim();
  } else {
    // Ищем по отдельным словам "с" и "на"
    const words = t.split(/\s+/);
    let idxFrom = -1, idxTo = -1;
    for (let i = 0; i < words.length; i++) {
      if (words[i] === 'с' && i+1 < words.length) idxFrom = i+1;
      if (words[i] === 'на' && i+1 < words.length) idxTo = i+1;
    }
    if (idxFrom !== -1) from = words[idxFrom];
    if (idxTo !== -1) to = words[idxTo];
  }

  // Преобразуем найденные строки в реальные названия кошельков
  function findWalletByNamePartial(name) {
    if (!name) return '';
    const lowerName = name.toLowerCase();
    // Сначала точное совпадение
    let w = state.D.wallets.find(w => w.name.toLowerCase() === lowerName);
    if (w) return w.name;
    // Затем частичное
    w = state.D.wallets.find(w => w.name.toLowerCase().includes(lowerName) || lowerName.includes(w.name.toLowerCase()));
    if (w) return w.name;
    // По синонимам
    if (lowerName.includes('тбанк') || lowerName.includes('тиньк') || lowerName.includes('black')) {
      w = state.D.wallets.find(w => w.name.toLowerCase().includes('т банк') || w.name.toLowerCase().includes('тинькофф'));
      if (w) return w.name;
    }
    if (lowerName.includes('сбер')) {
      w = state.D.wallets.find(w => w.name.toLowerCase().includes('сбер'));
      if (w) return w.name;
    }
    if (lowerName.includes('нал')) {
      w = state.D.wallets.find(w => w.name.toLowerCase().includes('налич'));
      if (w) return w.name;
    }
    return '';
  }

  const cleanedFrom = findWalletByNamePartial(from);
  const cleanedTo = findWalletByNamePartial(to);
  return { from: cleanedFrom || from, to: cleanedTo || to };
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

// ── Новая обработка: сразу открываем форму редактирования, минуя модал подтверждения ──
export function handleVoiceIntent(intent, onConfirm) {
  // Пропускаем модальное окно, сразу вызываем редактирование
  _openEdit(intent);
  // Если передан колбэк, вызываем его (для совместимости)
  if (onConfirm) onConfirm(intent);
}

// Открыть форму редактирования с заполнением всех полей
function _openEdit(intent) {
  switch (intent.intent) {
    case 'add_expense':
    case 'add_income': {
      const modal = document.getElementById('modal');
      if (!modal) return;
      modal.classList.add('open');
      setTimeout(() => {
        const type = intent.intent === 'add_expense' ? 'expense' : 'income';
        window.setOpType && window.setOpType(type);
        const amountEl = document.getElementById('op-amount');
        if (amountEl && intent.amount) amountEl.value = intent.amount;
        const noteEl = document.getElementById('op-note');
        if (noteEl && intent.note) noteEl.value = intent.note;
        const catSel = document.getElementById('op-cat');
        if (catSel && intent.category) {
          for (let i = 0; i < catSel.options.length; i++) {
            if (catSel.options[i].value.toLowerCase().includes(intent.category.toLowerCase())) {
              catSel.selectedIndex = i;
              break;
            }
          }
        }
        // Заполняем кошелёк
        if (intent.wallet && state.D) {
          const wallet = state.D.wallets.find(w => w.name.toLowerCase().includes(intent.wallet.toLowerCase()));
          if (wallet) {
            const walletSel = document.getElementById('op-wallet');
            if (walletSel) walletSel.value = wallet.id;
          }
        }
      }, 80);
      break;
    }
    case 'add_transfer': {
      const modal = document.getElementById('modal');
      if (!modal) return;
      modal.classList.add('open');
      setTimeout(() => {
        window.setOpType && window.setOpType('transfer');
        const amountEl = document.getElementById('op-amount');
        if (amountEl && intent.amount) amountEl.value = intent.amount;
        if (intent.from_wallet && state.D) {
          const fromWallet = state.D.wallets.find(w => w.name.toLowerCase().includes(intent.from_wallet.toLowerCase()));
          if (fromWallet) {
            const fromSel = document.getElementById('op-wallet');
            if (fromSel) fromSel.value = fromWallet.id;
          }
        }
        if (intent.to_wallet && state.D) {
          const toWallet = state.D.wallets.find(w => w.name.toLowerCase().includes(intent.to_wallet.toLowerCase()));
          if (toWallet) {
            const toSel = document.getElementById('op-wallet2');
            if (toSel) toSel.value = toWallet.id;
          }
        }
        const noteEl = document.getElementById('op-note');
        if (noteEl && intent.note) noteEl.value = intent.note;
      }, 80);
      break;
    }
    case 'add_shopping':
      window.openAddShopItem && window.openAddShopItem();
      break;
    case 'check_balance':
      // Показываем баланс в тосте (можно и модал, но для простоты тост)
      if (state.D) {
        if (intent.wallet) {
          const w = state.D.wallets.find(w => w.name.toLowerCase().includes(intent.wallet.toLowerCase()));
          if (w) _showToast(`${w.name}: ${fmt(w.balance)}`);
          else _showToast(`Кошелёк не найден`);
        } else {
          const total = state.D.wallets.reduce((s, w) => s + w.balance, 0);
          _showToast(`Общий баланс: ${fmt(total)}`);
        }
      }
      break;
    default:
      // Если ничего не поняли, открываем обычную форму
      document.getElementById('modal')?.classList.add('open');
      break;
  }
}

// Выполнить команду (для совместимости, но теперь не используется)
export function executeIntent(intent) {
  // Не используется, так как после редактирования операция сохраняется вручную.
  // Оставляем пустым.
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
          handleVoiceIntent(intent);
        } catch (e) { _showToast('⚠ Не удалось разобрать команду'); }
      },
      msg => { setIdle(); _showToast('⚠ ' + msg); },
      isRec => { if (isRec) setActive(); else setIdle(); }
    );
  };
  return btn;
}

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