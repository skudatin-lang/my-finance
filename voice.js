// voice.js — Гибридный голосовой ввод: Web Speech API + MediaRecorder через Cloudflare Worker
// БАГ-ФИX: Улучшенный парсер голосовых команд
// Порядок разбора фразы: "1500 зарплата жены т-блэк"
//   1. Ищем сумму (числа / словесные числа)
//   2. Ищем кошелёк (по точному совпадению ИЛИ синонимам банков)
//   3. Определяем тип операции (доход/расход) по ключевым словам
//   4. Определяем категорию (по совпадению с категориями пользователя)
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

// ── Web Speech API ────────────────────────────────────────────
async function startWebSpeech(onResult, onError, onStateChange) {
  if (_isRecording) {
    if (_recognition) { _recognition.abort(); _recognition = null; }
    _isRecording = false;
    onStateChange?.(false);
    return;
  }
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { onError?.('Web Speech API не поддерживается'); return; }
  _recognition = new SR();
  _recognition.lang = 'ru-RU';
  _recognition.continuous = false;
  _recognition.interimResults = true;
  _recognition.maxAlternatives = 3;
  _recognition.onstart = () => { _isRecording = true; onStateChange?.(true); };
  _recognition.onresult = (e) => {
    let final = '';
    for (let i = e.resultIndex; i < e.results.length; i++)
      if (e.results[i].isFinal) final += e.results[i][0].transcript;
    if (final) {
      _isRecording = false;
      onStateChange?.(false);
      onResult?.(final.trim());
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
    onError?.(errors[e.error] || 'Ошибка: ' + e.error);
  };
  _recognition.onend = () => { if (_isRecording) _resetWebSpeech(onStateChange); };
  try { _recognition.start(); }
  catch (e) { _resetWebSpeech(onStateChange); onError?.('Не удалось запустить: ' + e.message); }
}
function _resetWebSpeech(onStateChange) {
  if (_recognition) { try { _recognition.abort(); } catch(e) {} _recognition = null; }
  _isRecording = false;
  onStateChange?.(false);
}

// ── MediaRecorder + Worker (для PWA) ─────────────────────────
async function startMediaRecorder(onResult, onError, onStateChange) {
  if (_isRecording) { stopMediaRecorder(onStateChange); return; }
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
  catch (err) { onError?.('Нет доступа к микрофону'); return; }
  const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4';
  _mediaRecorder = new MediaRecorder(stream, { mimeType });
  _audioChunks = [];
  _mediaRecorder.ondataavailable = (event) => { if (event.data.size > 0) _audioChunks.push(event.data); };
  _mediaRecorder.onstop = async () => {
    const audioBlob = new Blob(_audioChunks, { type: mimeType });
    const reader = new FileReader();
    reader.onloadend = async () => {
      const base64data = reader.result.split(',')[1];
      const workerUrl = getWorkerUrl();
      const secret = getAppSecret();
      if (!workerUrl) { onError?.('Worker URL не задан'); stopMediaRecorder(onStateChange); return; }
      try {
        const resp = await fetch(workerUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-App-Secret': secret },
          body: JSON.stringify({ audio: base64data, format: mimeType === 'audio/webm' ? 'webm' : 'm4a' })
        });
        const data = await resp.json();
        if (data.result) onResult?.(data.result);
        else onError?.(data.error || 'Не удалось распознать речь');
      } catch (err) { onError?.('Ошибка связи с сервером распознавания'); }
      finally { stopMediaRecorder(onStateChange); }
    };
    reader.readAsDataURL(audioBlob);
    stream.getTracks().forEach(track => track.stop());
  };
  _mediaRecorder.start();
  _isRecording = true;
  onStateChange?.(true);
  setTimeout(() => {
    if (_mediaRecorder && _mediaRecorder.state === 'recording') _mediaRecorder.stop();
  }, 5000);
}
function stopMediaRecorder(onStateChange) {
  if (_mediaRecorder && _mediaRecorder.state !== 'inactive') _mediaRecorder.stop();
  _mediaRecorder = null;
  _isRecording = false;
  onStateChange?.(false);
}

export async function startRecording(onResult, onError, onStateChange) {
  if (useMediaRecorder()) await startMediaRecorder(onResult, onError, onStateChange);
  else await startWebSpeech(onResult, onError, onStateChange);
}
export function stopRecording() {
  if (useMediaRecorder()) { if (_mediaRecorder && _mediaRecorder.state === 'recording') _mediaRecorder.stop(); }
  else { if (_recognition) try { _recognition.abort(); } catch(e) {} _recognition = null; }
  _isRecording = false;
}
export function isRecording() { return _isRecording; }
export function loadVoiceSettings() {}
export function saveVoiceSettings(sttUrl, gptUrl, appSecret) {
  if (!state.D) return;
  if (!state.D.voiceSettings) state.D.voiceSettings = {};
  state.D.voiceSettings.proxyUrl = sttUrl || '';
  state.D.voiceSettings.appSecret = appSecret || '';
}
export function isVoiceConfigured() { return hasWebSpeech() || !!getWorkerUrl(); }

// ══════════════════════════════════════════════════════════════
//  УЛУЧШЕННЫЙ ПАРСЕР НАМЕРЕНИЙ
//  БАГ: "1500 зарплата жены т-блэк" → неверное определение
//  ФИКС: пошаговый разбор с приоритетом точного совпадения
// ══════════════════════════════════════════════════════════════

export async function parseIntent(text) {
  if (!state.D || !text) return { intent: 'unknown', raw_text: text };
  const t = text.toLowerCase().trim();

  // 1. Переводы (с учётом фраз "перевел", "перевод")
  if (/перевёл|перевел|перевести|перевод|переведи/i.test(t)) {
    const wallets = _transferWallets(text);
    const amount = _parseAmount(t);
    return { intent: 'add_transfer', amount, from_wallet: wallets.from, to_wallet: wallets.to };
  }

  // 2. Покупки (список)
  if (/купить|купи|куплю|добавь в список|нужно купить/i.test(t)) {
    const items = _parseShoppingItems(t);
    if (items.length) return { intent: 'add_shopping', items };
  }

  // 3. Баланс
  if (/баланс|сколько.*(?:денег|осталось|на карте)|остаток/i.test(t)) {
    const w = _findWalletInText(t);
    return { intent: 'check_balance', wallet: w?.name || '' };
  }

  // ── ОСНОВНОЙ БЛОК: разбор операции ──────────────────────────────────
  // Порядок: сначала находим сумму и кошелёк, потом определяем тип и категорию

  const amount = _parseAmount(t);

  // Ищем кошелёк — это самое важное для правильного распознавания
  const walletMatch = _findWalletInText(t);

  // Определяем тип операции по ключевым словам
  const isIncomeByKeyword = /получил|получила|заработал|заработала|пришло|пришла|зарплата|аванс|начислили|поступило|прибыль|выручка|гонорар|доход/i.test(t);
  const isExpenseByKeyword = /потратил|потратила|заплатил|заплатила|купил|купила|оплатил|оплатила|расход|списали|снял|сняла/i.test(t);

  // Определяем категорию — ищем совпадение с категориями пользователя
  // ВАЖНО: ищем и в доходных, и в расходных категориях
  const { category, categoryType } = _findCategory(t);

  // Итоговый тип:
  // - если явное ключевое слово → его приоритет
  // - если категория из доходных → доход
  // - если категория из расходных → расход
  // - если нет признаков → смотрим на кошелёк
  let intent;
  if (isIncomeByKeyword || categoryType === 'income') {
    intent = 'add_income';
  } else if (isExpenseByKeyword || categoryType === 'expense') {
    intent = 'add_expense';
  } else {
    // Нет явных признаков — по умолчанию расход (самая частая операция)
    intent = 'add_expense';
  }

  // Формируем заметку из оставшихся слов (которые не сумма и не кошелёк)
  const note = _extractNote(t, amount, walletMatch?.name || '');

  return {
    intent,
    amount,
    category: category || _defaultCategory(t, intent),
    wallet: walletMatch?.name || '',
    note,
  };
}

// ── Парсинг суммы ──────────────────────────────────────────────────────────
// Ищет числа (1500, 1 500, 1.5, 1,5) и словесные числа
function _parseAmount(text) {
  // Числа с пробелами как разделитель тысяч: "1 500", "58 560"
  const groupedMatch = text.match(/\b(\d{1,3}(?:\s\d{3})+)\b/);
  if (groupedMatch) {
    const n = parseFloat(groupedMatch[1].replace(/\s/g, ''));
    if (n > 0 && n < 10000000) return n;
  }

  // Числа с точкой/запятой как десятичные
  const decimalMatch = text.match(/\b(\d+)[,.](\d{1,2})\b/);
  if (decimalMatch) {
    const n = parseFloat(decimalMatch[1] + '.' + decimalMatch[2]);
    if (n > 0) return n;
  }

  // Простые числа (исключаем годы 2020-2035)
  const nums = [...text.matchAll(/\b(\d+)\b/g)];
  for (const m of nums) {
    const n = parseInt(m[1]);
    if (n > 0 && !(n >= 2000 && n <= 2040)) return n;
  }

  // Словесные числа
  return _parseWordNumber(text);
}

// Словесные числа: "пятьсот", "тысяча пятьсот", "полторы тысячи"
function _parseWordNumber(text) {
  const WORD_MAP = {
    'ноль':0,'нуля':0,'нулей':0,
    'один':1,'одна':1,'одного':1,
    'два':2,'две':2,'двух':2,
    'три':3,'трёх':3,'трех':3,
    'четыре':4,'четырёх':4,'четырех':4,
    'пять':5,'пяти':5,
    'шесть':6,'шести':6,
    'семь':7,'семи':7,
    'восемь':8,'восьми':8,
    'девять':9,'девяти':9,
    'десять':10,'десяти':10,
    'одиннадцать':11,'двенадцать':12,'тринадцать':13,'четырнадцать':14,
    'пятнадцать':15,'шестнадцать':16,'семнадцать':17,'восемнадцать':18,'девятнадцать':19,
    'двадцать':20,'тридцать':30,'сорок':40,'пятьдесят':50,
    'шестьдесят':60,'семьдесят':70,'восемьдесят':80,'девяносто':90,
    'сто':100,'двести':200,'триста':300,'четыреста':400,
    'пятьсот':500,'шестьсот':600,'семьсот':700,'восемьсот':800,'девятьсот':900,
    'тысяча':1000,'тысячи':1000,'тысяч':1000,'тыщ':1000,'тыща':1000,
    'полторы':1500,'полтора':1500,
    'миллион':1000000,'миллиона':1000000,'миллионов':1000000,
  };
  let total = 0, cur = 0, found = false;
  const words = text.toLowerCase().split(/\s+/);
  for (const w of words) {
    const v = WORD_MAP[w];
    if (v !== undefined) {
      found = true;
      if (v >= 1000) { total = (total + (cur || 1)) * v; cur = 0; }
      else if (v === 1500) { total += v; cur = 0; } // полторы
      else cur += v;
    }
  }
  return found ? (total + cur) : 0;
}

// ── Поиск кошелька в тексте ────────────────────────────────────────────────
// ВАЖНО: приоритет — точное совпадение имени кошелька, затем синонимы банков
function _findWalletInText(text) {
  if (!state.D) return null;
  const t = text.toLowerCase();

  // 1. ТОЧНОЕ совпадение имени кошелька (из данных пользователя)
  // Сортируем по убыванию длины, чтобы "Т-Банк Зарплатный" нашёлся раньше "Т-Банк"
  const sortedWallets = [...state.D.wallets].sort((a, b) => b.name.length - a.name.length);
  for (const w of sortedWallets) {
    if (t.includes(w.name.toLowerCase())) return w;
  }

  // 2. Расширенные синонимы банков — покрываем реальные речевые паттерны
  // Каждый банк: список произносимых вариантов + ключевые слова для поиска
  const BANK_SYNONYMS = [
    // Т-Банк (бывший Тинькофф)
    {
      keywords: ['т-блэк', 'т блэк', 'тблэк', 'т-банк', 'тбанк', 'тинькофф', 'тиньков', 'тинькоф',
                 'тинькова', 'тинек', 'тинька', 'тиньк', 'тинкофф', 'black', 'блек', 'блэк', 'ти банк',
                 'ти-банк', 'т bank', 'tinkoff', 'tbank', 't-bank'],
      searchNames: ['т-банк', 'тинькофф', 'т банк', 'тинкофф', 'black', 'блэк', 'блек'],
    },
    // Сбер
    {
      keywords: ['сбер', 'сбербанк', 'сберегательный', 'сбероне', 'сбер онлайн', 'sber', 'sbr'],
      searchNames: ['сбер', 'сбербанк'],
    },
    // ВТБ
    {
      keywords: ['втб', 'vtb', 'в т б'],
      searchNames: ['втб'],
    },
    // Альфа
    {
      keywords: ['альфа', 'альфабанк', 'alfa', 'альфа банк'],
      searchNames: ['альфа'],
    },
    // Газпром
    {
      keywords: ['газпром', 'газпромбанк', 'газпром банк', 'gpb'],
      searchNames: ['газпром'],
    },
    // Райффайзен
    {
      keywords: ['райф', 'райффайзен', 'raiff', 'raiffeisen'],
      searchNames: ['райф', 'райффайзен'],
    },
    // Наличные
    {
      keywords: ['наличные', 'наличка', 'налик', 'кэш', 'cash', 'нал', 'в руках', 'из кармана'],
      searchNames: ['наличные', 'наличка', 'нал'],
    },
    // Сберегательный / накопительный
    {
      keywords: ['сбережения', 'накопления', 'копилка', 'накопительный'],
      searchNames: ['сбережения', 'накопления'],
    },
  ];

  // Проходим по синонимам — если нашли совпадение, ищем соответствующий кошелёк
  for (const bank of BANK_SYNONYMS) {
    const matched = bank.keywords.some(kw => t.includes(kw));
    if (matched) {
      // Ищем кошелёк среди кошельков пользователя
      for (const searchName of bank.searchNames) {
        const found = state.D.wallets.find(w =>
          w.name.toLowerCase().includes(searchName)
        );
        if (found) return found;
      }
    }
  }

  // 3. Общие слова: "карта", "счёт" → возвращаем первый дебетовый кошелёк
  if (/карта|карточка|по карте|дебетовая|счёт|счет/i.test(text)) {
    const card = state.D.wallets.find(w =>
      /карт|дебет|bank|банк/i.test(w.name) && w.balance >= 0
    );
    if (card) return card;
  }

  // 4. Нет совпадений — вернуть null (не угадываем!)
  // Лучше оставить поле пустым, чем выбрать неверный кошелёк
  return null;
}

// ── Поиск категории ────────────────────────────────────────────────────────
// Возвращает { category: string, categoryType: 'income'|'expense'|null }
function _findCategory(text) {
  if (!state.D) return { category: null, categoryType: null };
  const t = text.toLowerCase();

  // Сначала проверяем РАСХОДНЫЕ категории пользователя (длинные имена — первые)
  const expCats = [...state.D.expenseCats].sort((a, b) => b.name.length - a.name.length);
  for (const c of expCats) {
    if (t.includes(c.name.toLowerCase())) {
      return { category: c.name, categoryType: 'expense' };
    }
  }

  // Затем ДОХОДНЫЕ категории
  const incCats = [...state.D.incomeCats].sort((a, b) => b.length - a.length);
  for (const c of incCats) {
    if (t.includes(c.toLowerCase())) {
      return { category: c, categoryType: 'income' };
    }
  }

  // Расширенная база синонимов категорий (русские варианты произношения)
  const CATEGORY_MAP = [
    // РАСХОДЫ
    { patterns: [/продукт|еда|магазин|супермаркет|пятёрочк|пятерочк|магнит|лента|ашан|перекресток|перекрёсток|дикси|окей|о'кей/], name: 'Продукты', type: 'expense' },
    { patterns: [/транспорт|метро|такси|автобус|маршрутка|бензин|заправк|топливо|проездной|электричка|яндекс такси|убер|uber/], name: 'Транспорт', type: 'expense' },
    { patterns: [/кафе|ресторан|кофе|кофейн|обед|ужин|завтрак|еда на работе|бизнес ланч|суши|пицца|фастфуд|макдак|kfc|бургер/], name: 'Кафе и рестораны', type: 'expense' },
    { patterns: [/аптек|лекарств|врач|больниц|поликлиник|клиник|лечение|таблетк|витамин|анализ/], name: 'Здоровье', type: 'expense' },
    { patterns: [/одежд|обувь|шмотк|гардероб|пальто|куртк|джинс|костюм|платье/], name: 'Одежда', type: 'expense' },
    { patterns: [/кредит(?!ная)|ипотек|займ|долг(?!и мне)|выплат|погашен/], name: 'Кредит', type: 'expense' },
    { patterns: [/связь|интернет|телефон|мобильн|симкарт|оператор|мтс|билайн|мегафон|теле2|tele2/], name: 'Связь', type: 'expense' },
    { patterns: [/квартплат|коммунал|аренда|жкх|жилье|жильё|электричество|свет|газ|вода|отопление/], name: 'Квартплата', type: 'expense' },
    { patterns: [/развлечен|кино|театр|игр|стриминг|netflix|нетфликс|spotify|яндекс плюс|подписк/], name: 'Развлечения', type: 'expense' },
    { patterns: [/ребенок|ребёнок|дети|детск|школ|сад(?!ик)|садик|игрушк|детское/], name: 'Дети', type: 'expense' },
    { patterns: [/спорт|фитнес|зал|тренировк|бассейн|секция/], name: 'Спорт', type: 'expense' },
    // ДОХОДЫ
    { patterns: [/зарплат|оклад|зп|зарплату|жалование/, ], name: 'Зарплата', type: 'income' },
    { patterns: [/аванс|предоплат/], name: 'Аванс', type: 'income' },
    { patterns: [/фриланс|проект|заказ|клиент/], name: 'Фриланс', type: 'income' },
    { patterns: [/подработк|халтур|шабашк/], name: 'Подработка', type: 'income' },
    { patterns: [/проценты|дивидент|инвестиц|пассивн доход/], name: 'Прочее', type: 'income' },
  ];

  for (const entry of CATEGORY_MAP) {
    for (const pat of entry.patterns) {
      if (pat.test(t)) {
        // Проверяем что такая категория есть у пользователя (точное или частичное совпадение)
        if (entry.type === 'expense') {
          const found = state.D.expenseCats.find(c =>
            c.name.toLowerCase().includes(entry.name.toLowerCase()) ||
            entry.name.toLowerCase().includes(c.name.toLowerCase())
          );
          if (found) return { category: found.name, categoryType: 'expense' };
        } else {
          const found = state.D.incomeCats.find(c =>
            c.toLowerCase().includes(entry.name.toLowerCase()) ||
            entry.name.toLowerCase().includes(c.toLowerCase())
          );
          if (found) return { category: found, categoryType: 'income' };
        }
        // Категории нет у пользователя — всё равно возвращаем тип
        return { category: entry.name, categoryType: entry.type };
      }
    }
  }

  return { category: null, categoryType: null };
}

// Категория по умолчанию если не нашли ничего
function _defaultCategory(text, intent) {
  if (intent === 'add_income') {
    return state.D?.incomeCats?.[0] || 'Прочее';
  }
  return state.D?.expenseCats?.[0]?.name || 'Прочее';
}

// ── Извлечение заметки ─────────────────────────────────────────────────────
// Убираем из текста сумму, имя кошелька, ключевые слова — остаток = заметка
function _extractNote(text, amount, walletName) {
  let note = text;
  // Убираем числа (суммы)
  note = note.replace(/\b\d[\d\s]{0,5}\b/g, ' ');
  // Убираем имя кошелька
  if (walletName) {
    note = note.replace(new RegExp(walletName.toLowerCase(), 'gi'), ' ');
  }
  // Убираем общие слова
  const STOP_WORDS = ['потратил','потратила','заплатил','заплатила','купил','купила',
    'получил','получила','рублей','рубль','рубля','руб','р','тысяч','тысячи','тыс',
    'за','на','в','с','из','по','у','от','до','к','и','или','а','но','что','это',
    'мне','мой','моя','моё','было','есть','нужно','надо'];
  STOP_WORDS.forEach(w => {
    note = note.replace(new RegExp('\\b' + w + '\\b', 'gi'), ' ');
  });
  note = note.replace(/\s+/g, ' ').trim();
  return note.length > 2 ? note : '';
}

// ── Парсинг переводов ──────────────────────────────────────────────────────
function _transferWallets(text) {
  const t = text.toLowerCase();
  let from = '', to = '';

  // Паттерн: "с [кошелёк] на [кошелёк]"
  const matchSN = t.match(/с\s+(.{2,25}?)\s+на\s+(.{2,25}?)(?:\s+\d|\s*$)/i);
  if (matchSN) {
    from = matchSN[1].trim();
    to = matchSN[2].trim();
  }

  // Ищем реальные кошельки по найденным фрагментам
  const resolveWallet = (fragment) => {
    if (!fragment || !state.D) return '';
    // Прямое совпадение
    const direct = state.D.wallets.find(w => w.name.toLowerCase().includes(fragment));
    if (direct) return direct.name;
    // Через функцию поиска
    const found = _findWalletInText(fragment);
    return found ? found.name : fragment;
  };

  return {
    from: resolveWallet(from),
    to: resolveWallet(to),
  };
}

// ── Парсинг списка покупок ─────────────────────────────────────────────────
function _parseShoppingItems(text) {
  const clean = text.replace(/купить|купи|куплю|добавь в список|нужно купить/gi, ' ');
  const parts = clean.split(/,|\bи\b/).map(s => s.trim()).filter(s => s.length > 1);
  return parts.map(p => {
    const qm = p.match(/(\d+)/);
    const qty = qm ? parseInt(qm[1]) : 1;
    const name = p.replace(/\d+\s*(?:шт|штук|пачк|литр|кг|грамм|упак)?/g, '').trim();
    return name.length > 1 ? { name, qty, price: 0 } : null;
  }).filter(Boolean);
}

// ── Открытие формы операции ────────────────────────────────────────────────
function openEditForm(intent) {
  switch (intent.intent) {
    case 'add_expense':
    case 'add_income': {
      const modal = document.getElementById('modal');
      if (!modal) return;
      modal.classList.add('open');
      setTimeout(() => {
        const type = intent.intent === 'add_expense' ? 'expense' : 'income';
        if (window.setOpType) window.setOpType(type);
        const amountInput = document.getElementById('op-amount');
        if (amountInput && intent.amount) amountInput.value = intent.amount;
        const noteInput = document.getElementById('op-note');
        if (noteInput && intent.note) noteInput.value = intent.note;
        if (intent.category) {
          const catSelect = document.getElementById('op-cat');
          if (catSelect) {
            for (let i = 0; i < catSelect.options.length; i++) {
              if (catSelect.options[i].value.toLowerCase() === intent.category.toLowerCase() ||
                  catSelect.options[i].value.toLowerCase().includes(intent.category.toLowerCase())) {
                catSelect.selectedIndex = i;
                break;
              }
            }
          }
        }
        // Устанавливаем кошелёк — только если нашли реальное совпадение
        if (intent.wallet && state.D) {
          const wallet = state.D.wallets.find(w =>
            w.name.toLowerCase() === intent.wallet.toLowerCase() ||
            w.name.toLowerCase().includes(intent.wallet.toLowerCase())
          );
          if (wallet) {
            const walletSelect = document.getElementById('op-wallet');
            if (walletSelect) walletSelect.value = wallet.id;
          }
        }
      }, 100);
      break;
    }
    case 'add_transfer': {
      const modal = document.getElementById('modal');
      if (!modal) return;
      modal.classList.add('open');
      setTimeout(() => {
        if (window.setOpType) window.setOpType('transfer');
        const amountInput = document.getElementById('op-amount');
        if (amountInput && intent.amount) amountInput.value = intent.amount;
        if (state.D) {
          const wf = state.D.wallets.find(w => w.name.toLowerCase().includes((intent.from_wallet||'').toLowerCase()));
          const wt = state.D.wallets.find(w => w.name.toLowerCase().includes((intent.to_wallet||'').toLowerCase()));
          const fromSel = document.getElementById('op-wallet');
          const toSel = document.getElementById('op-wallet2');
          if (fromSel && wf) fromSel.value = wf.id;
          if (toSel && wt) toSel.value = wt.id;
        }
        const noteInput = document.getElementById('op-note');
        if (noteInput && intent.note) noteInput.value = intent.note;
      }, 100);
      break;
    }
    case 'add_shopping':
      if (window.openAddShopItem) window.openAddShopItem();
      break;
    default:
      const modal = document.getElementById('modal');
      if (modal) modal.classList.add('open');
      break;
  }
}

// ── Экспортируемые обработчики ─────────────────────────────────────────────
export function handleVoiceIntent(intent, onConfirm) {
  openEditForm(intent);
}

export function executeIntent(intent) {
  openEditForm(intent);
}

// ── UI кнопки ──────────────────────────────────────────────────────────────
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
          // Показываем что распознали — для отладки
          const walletInfo = intent.wallet ? ` · ${intent.wallet}` : '';
          const catInfo = intent.category ? ` · ${intent.category}` : '';
          if (intent.amount > 0) {
            _showToast(`✓ ${intent.intent === 'add_income' ? 'Доход' : 'Расход'} ${intent.amount}₽${catInfo}${walletInfo}`);
          }
          setTimeout(() => openEditForm(intent), 1200);
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
