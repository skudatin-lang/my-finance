// ════════════════════════════════════════
//  AI.JS — DeepSeek через proxyapi.ru
//  Подключается к существующему appConfig
// ════════════════════════════════════════

import { appConfig } from './core.js';
import { calcHealthScore, getMOps, isPlanned, state } from './core.js';

const PROXY_URL = 'https://api.proxyapi.ru/deepseek/v1/chat/completions';
const MODEL     = 'deepseek-chat';

// ── Базовый запрос к DeepSeek ─────────────────────────────────────────────
async function askDeepSeek(systemPrompt, userMessage) {
  const key = appConfig.deepseekKey;
  if (!key) throw new Error('DeepSeek API ключ не задан. Добавьте его в Панели администратора.');

  const resp = await fetch(PROXY_URL, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': 'Bearer ' + key,
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1000,
      temperature: 0.4,
      messages: [
        { role: 'system',  content: systemPrompt },
        { role: 'user',    content: userMessage  },
      ],
    }),
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.error?.message || 'Ошибка API: ' + resp.status);
  }

  const data = await resp.json();
  return data.choices?.[0]?.message?.content?.trim() || '';
}

// ── Подготовка данных для контекста ──────────────────────────────────────
function buildFinanceContext() {
  if (!state.D) return '';

  const h = calcHealthScore();
  const ops = getMOps(0).filter(o => !isPlanned(o.type));
  const income  = ops.filter(o => o.type === 'income') .reduce((s, o) => s + o.amount, 0);
  const expense = ops.filter(o => o.type === 'expense').reduce((s, o) => s + o.amount, 0);

  // Топ-5 категорий расходов
  const byCategory = {};
  ops.filter(o => o.type === 'expense').forEach(o => {
    byCategory[o.category] = (byCategory[o.category] || 0) + o.amount;
  });
  const topCats = Object.entries(byCategory)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([cat, amt]) => `${cat}: ${Math.round(amt)} ₽`)
    .join(', ');

  // Кредиты
  const debtWallets = state.D.wallets.filter(w => w.balance < 0);
  const totalDebt   = debtWallets.reduce((s, w) => s + Math.abs(w.balance), 0);
  const debtDetails = debtWallets
    .map(w => `${w.name}: ${Math.round(Math.abs(w.balance))} ₽${w.rate ? ' (' + w.rate + '%)' : ''}`)
    .join('; ');

  return [
    `Текущий месяц: доход ${Math.round(income)} ₽, расход ${Math.round(expense)} ₽`,
    topCats ? `Топ расходов: ${topCats}` : '',
    h ? `Индекс здоровья: ${h.score}/100 (подушка ${h.s1}%, сбережения ${h.s2}%, долги ${h.s3}%)` : '',
    totalDebt ? `Общий долг: ${Math.round(totalDebt)} ₽ (${debtDetails})` : 'Долгов нет',
    `Кошельки: ${state.D.wallets.filter(w => w.balance > 0).map(w => w.name + ' ' + Math.round(w.balance) + ' ₽').join(', ')}`,
  ].filter(Boolean).join('\n');
}

// ════════════════════════════════════════
//  ПУБЛИЧНЫЕ ФУНКЦИИ
//  Вызывай их из dashboard.js или health.js
// ════════════════════════════════════════

// 1. Общий анализ финансов — для дашборда
export async function getFinanceAdvice() {
  const context = buildFinanceContext();
  const system = `Ты личный финансовый советник. Отвечай только на русском языке.
Давай конкретные, практичные советы. Без воды. Максимум 4-5 предложений.
Фокусируйся на самом важном улучшении которое можно сделать прямо сейчас.`;

  return await askDeepSeek(system,
    `Вот мои финансы за текущий месяц:\n${context}\n\nДай краткий анализ и один главный совет.`
  );
}

// 2. Стратегия погашения долгов — для раздела Кредиты
export async function getDebtStrategy() {
  const context = buildFinanceContext();
  const system = `Ты эксперт по личным финансам и управлению долгами. Отвечай только на русском.
Давай конкретный пошаговый план. Упоминай реальные цифры из данных пользователя.
Максимум 150 слов.`;

  return await askDeepSeek(system,
    `Мои финансы:\n${context}\n\nСоставь конкретный план погашения долгов. Какой кредит гасить первым и почему?`
  );
}

// 3. Анализ трат по категориям — для отчётов
export async function getCategoryInsight() {
  const context = buildFinanceContext();
  const system = `Ты финансовый аналитик. Отвечай только на русском языке.
Анализируй паттерны трат и находи аномалии. Давай 2-3 конкретных наблюдения.
Максимум 100 слов.`;

  return await askDeepSeek(system,
    `Мои финансы:\n${context}\n\nЧто необычного в моих тратах? Где можно сэкономить?`
  );
}

// 4. Ответ на произвольный вопрос — для чата
export async function askFinanceQuestion(question) {
  const context = buildFinanceContext();
  const system = `Ты личный финансовый советник пользователя. Отвечай только на русском языке.
У тебя есть доступ к его реальным финансовым данным. Используй их в ответе.
Отвечай конкретно, без общих фраз. Максимум 150 слов.`;

  return await askDeepSeek(system,
    `Мои финансы:\n${context}\n\nВопрос: ${question}`
  );
}

// ── UI хелпер: показать ответ AI в элементе ──────────────────────────────
// Использование: renderAiBlock('ai-advice-container', getFinanceAdvice)
export async function renderAiBlock(containerId, fetchFn) {
  const el = document.getElementById(containerId);
  if (!el) return;

  // Состояние загрузки
  el.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;padding:12px;color:var(--text2);font-size:12px">
      <div class="ai-spinner"></div>
      Анализирую данные...
    </div>`;

  try {
    const text = await fetchFn();
    el.innerHTML = `
      <div style="
        background:var(--amber-light);
        border:1px solid var(--border);
        border-left:3px solid var(--amber);
        border-radius:8px;
        padding:12px 14px;
        font-size:12px;
        line-height:1.7;
        color:var(--topbar)
      ">
        <div style="font-size:10px;font-weight:700;color:var(--text2);letter-spacing:.6px;margin-bottom:6px">
          ✦ AI СОВЕТНИК
        </div>
        ${text.replace(/\n/g, '<br>')}
      </div>`;
  } catch (err) {
    el.innerHTML = `
      <div style="
        background:var(--red-bg,#fff5f5);
        border:1px solid var(--r200,#fca5a5);
        border-radius:8px;
        padding:10px 12px;
        font-size:12px;
        color:var(--red)
      ">
        ⚠ ${err.message}
      </div>`;
  }
}
