/**
 * portfolio.js — Инвестиционный портфель с AI-аналитикой
 *
 * АРХИТЕКТУРА:
 * ┌─────────────────────┬─────────────────────────┐
 * │  ЛЕВАЯ КОЛОНКА      │  ПРАВАЯ КОЛОНКА (AI)    │
 * │  - Сводка           │  - Анализ портфеля      │
 * │  - Параметры        │  - Рекомендации         │
 * │  - Список активов   │  - Целевая структура    │
 * │  - Структура        │  - Простым языком       │
 * └─────────────────────┴─────────────────────────┘
 *
 * ФУНКЦИИ:
 * - analyzePortfolio()       — математический анализ
 * - generateRecommendations() — конкретные действия по активам
 * - fetchKeyRate()            — ставка ЦБ (кеш 24ч)
 * - getAIStrategy()           — YandexGPT стратегия
 * - runPortfolioAnalysis()    — оркестратор
 */

import { $, fmt, state, sched, today, appConfig } from './core.js';

const esc = s => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

// ── Типы активов ─────────────────────────────────────────────────────────
const ASSET_TYPES = [
  { value: 'bond_short',    label: '📄 Облигация (короткая)',     color: '#4A7C3F', defYield: 16 },
  { value: 'bond_long',     label: '📋 Облигация (длинная)',      color: '#2E5F1A', defYield: 14 },
  { value: 'bond_float',    label: '🔄 Флоатер',                  color: '#5B9BD5', defYield: 21 },
  { value: 'money_market',  label: '💵 Денежный рынок (LQDT и т.п.)', color: '#C9A96E', defYield: 21 },
  { value: 'stock_div',     label: '📈 Акция (дивидендная)',      color: '#C0392B', defYield: 12 },
  { value: 'stock_growth',  label: '🚀 Акция (рост)',             color: '#8e44ad', defYield: 8  },
  { value: 'etf',           label: '🗂 ETF / БПИФ',              color: '#BA7517', defYield: 10 },
  { value: 'deposit',       label: '🏦 Депозит / кэш',           color: '#95a5a6', defYield: 21 },
  { value: 'other',         label: '📦 Прочее',                   color: '#7f8c8d', defYield: 0  },
];
const typeMap = Object.fromEntries(ASSET_TYPES.map(t => [t.value, t]));

// Целевые веса стратегий при разных ставках ЦБ
const STRATEGIES = {
  conservative: {
    label: 'Консервативная',
    highRate: { bond_short:0.10, bond_long:0.05, bond_float:0.25, money_market:0.45, stock_div:0.05, stock_growth:0, etf:0.05, deposit:0.05, other:0 },
    lowRate:  { bond_short:0.10, bond_long:0.30, bond_float:0.10, money_market:0.10, stock_div:0.15, stock_growth:0.05, etf:0.15, deposit:0.05, other:0 },
  },
  moderate: {
    label: 'Умеренная',
    highRate: { bond_short:0.10, bond_long:0.10, bond_float:0.20, money_market:0.30, stock_div:0.15, stock_growth:0.05, etf:0.05, deposit:0.05, other:0 },
    lowRate:  { bond_short:0.05, bond_long:0.20, bond_float:0.10, money_market:0.05, stock_div:0.20, stock_growth:0.15, etf:0.20, deposit:0.05, other:0 },
  },
  aggressive: {
    label: 'Агрессивная',
    highRate: { bond_short:0.05, bond_long:0.05, bond_float:0.15, money_market:0.10, stock_div:0.20, stock_growth:0.20, etf:0.20, deposit:0.05, other:0 },
    lowRate:  { bond_short:0, bond_long:0.10, bond_float:0.05, money_market:0, stock_div:0.25, stock_growth:0.35, etf:0.20, deposit:0.05, other:0 },
  },
};

// ── Настройки портфеля ───────────────────────────────────────────────────
function getPortSettings() {
  if (!state.D.portfolioSettings) {
    state.D.portfolioSettings = {
      targetYield: 10,    // % сверх инфляции
      monthlyCash: 10000, // взнос в месяц
      strategy: 'moderate',
      inflation: 8,       // %
      keyRate: 21,        // %
      keyRateCachedAt: null,
    };
  }
  const s = state.D.portfolioSettings;
  if (!s.strategy)    s.strategy    = 'moderate';
  if (!s.targetYield) s.targetYield = 10;
  if (!s.inflation)   s.inflation   = 8;
  if (!s.keyRate)     s.keyRate     = 21;
  return s;
}

// ─────────────────────────────────────────────────────────────────────────
// 1. АВТОМАТИЧЕСКАЯ СТАВКА ЦБ
// ─────────────────────────────────────────────────────────────────────────
/**
 * fetchKeyRate() — получает ставку ЦБ
 * Порядок: кеш (24ч) → API ЦБ РФ → fallback от GPT → хардкод
 */
export async function fetchKeyRate() {
  const s = getPortSettings();

  // Кеш 24 часа
  if (s.keyRateCachedAt) {
    const hoursOld = (Date.now() - s.keyRateCachedAt) / 3_600_000;
    if (hoursOld < 24) return s.keyRate;
  }

  // API ЦБ РФ — XML через CORS-proxy (cbr.ru не поддерживает CORS)
  // Используем публичный CORS proxy или напрямую если есть воркер
  try {
    // Пробуем через наш Cloudflare Worker /cbr если есть
    const workerUrl = (appConfig?.workerUrl || '').trim().replace(/\/?$/, '');
    if (workerUrl) {
      const r = await fetch(workerUrl + '/cbr', {
        method: 'GET',
        headers: appConfig.appSecret ? { 'X-App-Secret': appConfig.appSecret } : {},
        signal: AbortSignal.timeout(5000),
      });
      if (r.ok) {
        const d = await r.json();
        if (d.keyRate && d.keyRate > 0) {
          _saveKeyRate(d.keyRate);
          return d.keyRate;
        }
      }
    }
  } catch (_) {}

  // Fallback: спрашиваем GPT о текущей ставке
  try {
    const rate = await _fetchKeyRateViaGPT();
    if (rate > 0) { _saveKeyRate(rate); return rate; }
  } catch (_) {}

  // Хардкод — возвращаем сохранённое значение
  return s.keyRate || 21;
}

async function _fetchKeyRateViaGPT() {
  const workerUrl = (appConfig?.workerUrl || '').trim().replace(/\/?$/, '');
  if (!workerUrl) return 0;
  const h = { 'Content-Type': 'application/json' };
  if (appConfig.appSecret) h['X-App-Secret'] = appConfig.appSecret;
  const resp = await fetch(workerUrl + '/gpt', {
    method: 'POST', headers: h,
    body: JSON.stringify({
      completionOptions: { stream: false, temperature: 0, maxTokens: 50 },
      messages: [
        { role: 'system', text: 'Отвечай ТОЛЬКО числом — текущая ключевая ставка ЦБ России в процентах. Только число, без слов.' },
        { role: 'user',   text: 'Какая сейчас ключевая ставка ЦБ России?' },
      ],
    }),
    signal: AbortSignal.timeout(8000),
  });
  if (!resp.ok) return 0;
  const d = await resp.json();
  const text = (d.result?.alternatives?.[0]?.message?.text || '').trim();
  const rate = parseFloat(text.replace(',', '.'));
  return (rate > 0 && rate < 100) ? rate : 0;
}

function _saveKeyRate(rate) {
  const s = getPortSettings();
  s.keyRate = rate;
  s.keyRateCachedAt = Date.now();
  sched();
}

// ─────────────────────────────────────────────────────────────────────────
// 2. АНАЛИЗ ПОРТФЕЛЯ
// ─────────────────────────────────────────────────────────────────────────
/**
 * analyzePortfolio(portfolio, targetReturn, inflation, keyRate)
 * Возвращает: { totalValue, invested, pnl, pnlPct, expYield,
 *               summary, strengths, weaknesses, forecast,
 *               byType, weights }
 */
function analyzePortfolio(portfolio, targetReturn, inflation, keyRate) {
  if (!portfolio.length) return null;

  // Базовые расчёты
  const totalValue = portfolio.reduce((s, a) => s + a.qty * (a.currentPrice || a.buyPrice), 0);
  const invested   = portfolio.reduce((s, a) => s + a.qty * a.buyPrice, 0);
  const pnl        = totalValue - invested;
  const pnlPct     = invested > 0 ? Math.round(pnl / invested * 1000) / 10 : 0;

  // Веса по типу
  const byType = {};
  for (const a of portfolio) {
    const t = a.assetType || 'other';
    const v = a.qty * (a.currentPrice || a.buyPrice);
    byType[t] = (byType[t] || 0) + v;
  }
  const weights = {};
  for (const [t, v] of Object.entries(byType)) {
    weights[t] = totalValue > 0 ? Math.round(v / totalValue * 1000) / 10 : 0;
  }

  // Ожидаемая доходность (взвешенная)
  let expYield = 0;
  for (const a of portfolio) {
    const v     = a.qty * (a.currentPrice || a.buyPrice);
    const w     = totalValue > 0 ? v / totalValue : 0;
    const yld   = a.yieldPct ?? (typeMap[a.assetType || 'other']?.defYield || 0);
    expYield   += w * yld;
  }
  expYield = Math.round(expYield * 10) / 10;

  // Реальная доходность (сверх инфляции)
  const realYield = Math.round((expYield - inflation) * 10) / 10;
  const targetMet = realYield >= targetReturn;

  // Концентрация
  const maxWeight     = Math.max(...Object.values(weights));
  const isConcentrated = maxWeight > 50;

  // Доля денежного рынка при высокой ставке
  const moneyMarketShare = (weights['money_market'] || 0) + (weights['deposit'] || 0);
  const highRate         = keyRate >= 18;
  const lowMoneyMarket  = highRate && moneyMarketShare < 20;

  // Сильные стороны
  const strengths = [];
  if (pnlPct > 5)          strengths.push(`Портфель в плюсе: +${pnlPct}% к вложениям`);
  if (targetMet)            strengths.push(`Ожидаемая доходность ${expYield}% покрывает цель ${targetReturn}% сверх инфляции`);
  if (!isConcentrated)      strengths.push('Хорошая диверсификация — ни один актив не занимает >50%');
  if (moneyMarketShare >= 20 && highRate) strengths.push(`${Math.round(moneyMarketShare)}% в денежном рынке — разумно при ставке ${keyRate}%`);
  if (portfolio.some(a => a.assetType === 'bond_float')) strengths.push('Есть флоатеры — защита от дальнейшего роста ставки');
  if (strengths.length === 0) strengths.push('Портфель сформирован — есть с чем работать');

  // Слабые стороны
  const weaknesses = [];
  if (!targetMet)        weaknesses.push(`Ожидаемая доходность ${expYield}% ниже цели: инфляция ${inflation}% + ${targetReturn}% = ${inflation + targetReturn}%`);
  if (isConcentrated)    weaknesses.push(`Концентрация: ${maxWeight}% в одном типе актива — высокий риск`);
  if (lowMoneyMarket)    weaknesses.push(`При ставке ${keyRate}% мало денежного рынка (${Math.round(moneyMarketShare)}%) — упущенные ~${keyRate}% без риска`);
  if (!portfolio.some(a => ['bond_float','money_market','deposit'].includes(a.assetType || 'other')) && highRate)
    weaknesses.push('Нет инструментов с плавающей ставкой — уязвимость при росте ставки ЦБ');
  if (portfolio.some(a => {
    const d = a.lastUpdated ? Math.floor((Date.now() - new Date(a.lastUpdated+'T12:00:00')) / 864e5) : 999;
    return d > 14;
  })) weaknesses.push('Цены части активов не обновлялись >14 дней — расчёты приблизительные');

  // Прогноз
  const monthlyBonus = Math.round((12 * (getPortSettings().monthlyCash || 0)) / totalValue * 100) / 10;
  const forecast = targetMet
    ? `При текущем темпе (взнос ₽${(getPortSettings().monthlyCash||0).toLocaleString('ru-RU')}/мес + доходность ${expYield}%) портфель удваивается за ~${Math.round(72/expYield)} лет.`
    : `Для цели ${targetReturn}% реальной доходности нужно увеличить долю высокодоходных инструментов или взнос. Ежемесячный взнос добавляет ~${monthlyBonus}% к эффективной доходности.`;

  const summary = `Портфель ${fmt(Math.round(totalValue))} · ожид. доходность ${expYield}%/год · реальная (сверх инфляции) ${realYield}% · цель ${targetReturn}%`;

  return { totalValue, invested, pnl, pnlPct, expYield, realYield, targetMet,
           summary, strengths, weaknesses, forecast, byType, weights };
}

// ─────────────────────────────────────────────────────────────────────────
// 3. ГЕНЕРАЦИЯ РЕКОМЕНДАЦИЙ
// ─────────────────────────────────────────────────────────────────────────
/**
 * generateRecommendations(portfolio, analysis, settings)
 * Возвращает массив действий: [{ name, action, delta, newQuantity, reason, priority }]
 */
function generateRecommendations(portfolio, analysis, settings) {
  if (!portfolio.length || !analysis) return [];

  const { keyRate, strategy, monthlyCash, targetYield } = settings;
  const highRate = keyRate >= 18;
  const strat    = STRATEGIES[strategy] || STRATEGIES.moderate;
  const targets  = highRate ? strat.highRate : strat.lowRate;

  const recs = [];

  // Анализируем каждый актив
  for (const a of portfolio) {
    const type     = a.assetType || 'other';
    const curValue = a.qty * (a.currentPrice || a.buyPrice);
    const curShare = analysis.totalValue > 0 ? curValue / analysis.totalValue : 0;
    const target   = targets[type] || 0;
    const diff     = curShare - target; // положительный = слишком много
    const yld      = a.yieldPct ?? (typeMap[type]?.defYield || 0);

    let action = 'hold', delta = 0, reason = '';

    // ПРОДАТЬ если доля избыточна > 10 п.п. от цели
    if (diff > 0.10 && curShare > 0.05) {
      const sellValue = (diff - 0.05) * analysis.totalValue; // оставляем 5% буфер
      const price     = a.currentPrice || a.buyPrice;
      delta           = -Math.max(1, Math.floor(sellValue / price));
      action          = 'sell';
      reason          = `Доля типа «${typeMap[type]?.label||type}» ${Math.round(curShare*100)}% > цели ${Math.round(target*100)}%. Частичная фиксация снизит концентрацию.`;
    }
    // ДОКУПИТЬ если доля сильно ниже цели > 10 п.п. И есть взнос
    else if (diff < -0.10 && monthlyCash > 0) {
      const buyValue = Math.min(-diff * analysis.totalValue, monthlyCash);
      const price    = a.currentPrice || a.buyPrice;
      delta          = Math.max(1, Math.floor(buyValue / price));
      action         = 'buy';
      reason         = `Доля «${typeMap[type]?.label||type}» ${Math.round(curShare*100)}% < цели ${Math.round(target*100)}%. Докупить на часть взноса.`;
    }
    // ПРОДАТЬ убыточный актив при высокой ставке (не денежный рынок)
    else if (highRate && !['money_market','bond_float','deposit'].includes(type)) {
      const pnlPct = a.buyPrice > 0 ? (((a.currentPrice||a.buyPrice) - a.buyPrice) / a.buyPrice * 100) : 0;
      if (pnlPct < -15) {
        delta  = -Math.floor(a.qty * 0.5);
        action = delta < 0 ? 'sell' : 'hold';
        reason = `Убыток ${Math.round(pnlPct)}% при высокой ставке ${keyRate}%. Рассмотрите стоп-лосс 50% позиции.`;
      }
    }
    // ДЕРЖАТЬ
    else {
      reason = yld >= keyRate
        ? `Доходность ${yld}% выше ставки ЦБ ${keyRate}% — держать.`
        : highRate && yld < keyRate
          ? `Доходность ${yld}% ниже безрисковой ставки ${keyRate}%. Рассмотрите переход в денежный рынок при следующей ребалансировке.`
          : `Позиция соответствует стратегии «${strat.label}».`;
    }

    recs.push({
      name:        a.ticker || a.name || '?',
      fullName:    a.name || a.ticker || '',
      action,
      delta,
      newQuantity: Math.max(0, a.qty + delta),
      currentQty:  a.qty,
      price:       a.currentPrice || a.buyPrice,
      tradeValue:  Math.abs(delta) * (a.currentPrice || a.buyPrice),
      reason,
      priority:    action === 'sell' ? 1 : action === 'buy' ? 2 : 3,
    });
  }

  // Новые инструменты если взнос есть и есть дефицит в типах
  const usedBudget = recs.filter(r => r.action === 'buy').reduce((s, r) => s + r.tradeValue, 0);
  const remaining  = monthlyCash - usedBudget;
  if (remaining > 500 && highRate) {
    // Рекомендуем LQDT если нет денежного рынка
    const hasMoneyMkt = portfolio.some(a => a.assetType === 'money_market');
    if (!hasMoneyMkt) {
      recs.push({
        name: 'LQDT', fullName: 'ВТБ Ликвидность (БПИФ денежного рынка)',
        action: 'buy_new', delta: Math.floor(remaining / 1),
        newQuantity: Math.floor(remaining / 1), currentQty: 0,
        price: 1, tradeValue: remaining,
        reason: `При ставке ${keyRate}% LQDT даёт ~${keyRate}% годовых без риска. Рекомендуем на остаток взноса ₽${Math.round(remaining).toLocaleString('ru-RU')}.`,
        priority: 0,
      });
    }
  }

  // Сортируем по приоритету
  return recs.sort((a, b) => a.priority - b.priority);
}

// ─────────────────────────────────────────────────────────────────────────
// 4. AI СТРАТЕГИЯ (YandexGPT)
// ─────────────────────────────────────────────────────────────────────────
const AI_PROMPT = `Ты — инвестиционный аналитик. Анализируй портфель пользователя и формируй обоснованную стратегию.

ОСНОВНЫЕ ПРАВИЛА:
- Используй только входные данные
- Не выдумывай цифры
- Делай конкретные расчёты
- Простой язык без жаргона
- Если данных мало — скажи об этом

РАБОТАЙ С: доходностью, ключевой ставкой, инфляцией, структурой портфеля

КАТЕГОРИИ ИНСТРУМЕНТОВ:
- Денежный рынок (LQDT, депозиты) — низкий риск, доходность ≈ ставке ЦБ
- Облигации короткие — низкий риск, фиксированный купон
- Облигации длинные — средний риск, выгодны при снижении ставки
- Флоатеры — плавающий купон, защита при росте ставки
- Акции дивидендные — средний риск, стабильный доход
- Акции роста — высокий риск, потенциал роста

ОБЯЗАТЕЛЬНЫЙ ФОРМАТ ОТВЕТА (7 пунктов):
1. СИТУАЦИЯ: что сейчас с портфелем (2-3 предложения)
2. ПРОБЛЕМЫ: конкретные слабые места (список)
3. ЦЕЛЕВАЯ СТРУКТУРА: % по типам инструментов
4. ДЕЙСТВИЯ: что купить/продать прямо сейчас (с суммами)
5. ИНСТРУМЕНТЫ: конкретные тикеры с обоснованием
6. ПЛАН ПОПОЛНЕНИЯ: как распределить ежемесячный взнос
7. РИСКИ: главные угрозы для этого портфеля

Без markdown. Используй только цифры из входных данных.`;

async function getAIStrategy(inputData) {
  const workerUrl = (appConfig?.workerUrl || '').trim().replace(/\/?$/, '');
  if (!workerUrl) throw new Error('URL воркера не настроен');

  const h = { 'Content-Type': 'application/json' };
  if (appConfig.appSecret) h['X-App-Secret'] = appConfig.appSecret;

  const userText = `Анализ портфеля:
Стоимость: ₽${Math.round(inputData.analysis.totalValue).toLocaleString('ru-RU')}
Ожидаемая доходность: ${inputData.analysis.expYield}%/год
Реальная (сверх инфляции): ${inputData.analysis.realYield}%
Целевая доходность: ${inputData.settings.targetYield}% сверх инфляции
Ключевая ставка ЦБ: ${inputData.settings.keyRate}%
Инфляция: ${inputData.settings.inflation}%
Стратегия: ${(STRATEGIES[inputData.settings.strategy]||STRATEGIES.moderate).label}
Ежемесячный взнос: ₽${(inputData.settings.monthlyCash||0).toLocaleString('ru-RU')}

Структура по типам (факт → цель):
${Object.entries(inputData.analysis.weights).map(([t,w]) => {
  const strat = STRATEGIES[inputData.settings.strategy] || STRATEGIES.moderate;
  const targets = inputData.settings.keyRate >= 18 ? strat.highRate : strat.lowRate;
  return `${typeMap[t]?.label||t}: ${w}% → цель ${Math.round((targets[t]||0)*100)}%`;
}).join('\n')}

Активы:
${inputData.portfolio.map(a => {
  const cur = a.currentPrice || a.buyPrice;
  const val = a.qty * cur;
  const pnlP = a.buyPrice > 0 ? Math.round(((cur - a.buyPrice) / a.buyPrice) * 100) : 0;
  return `${a.ticker} (${typeMap[a.assetType||'other']?.label||'?'}): ${a.qty} шт. × ₽${cur} = ₽${Math.round(val).toLocaleString('ru-RU')} · П/У ${pnlP>0?'+':''}${pnlP}% · доходность ${a.yieldPct??typeMap[a.assetType||'other']?.defYield??0}%`;
}).join('\n')}

Проблемы: ${inputData.analysis.weaknesses.join('; ')}`;

  const resp = await fetch(workerUrl + '/gpt', {
    method: 'POST', headers: h,
    body: JSON.stringify({
      completionOptions: { stream: false, temperature: 0.2, maxTokens: 700 },
      messages: [
        { role: 'system', text: AI_PROMPT },
        { role: 'user',   text: userText  },
      ],
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!resp.ok) throw new Error('GPT ответил ' + resp.status);
  const d = await resp.json();
  const text = d.result?.alternatives?.[0]?.message?.text || '';
  if (!text) throw new Error('Пустой ответ GPT');
  return text;
}

// ─────────────────────────────────────────────────────────────────────────
// 5. РЕНДЕР
// ─────────────────────────────────────────────────────────────────────────
function renderAnalysis(analysis, settings) {
  const el = document.getElementById('portfolio-analysis');
  if (!el || !analysis) return;

  const targetTotal = settings.inflation + settings.targetYield;
  const gap = Math.round((targetTotal - analysis.expYield) * 10) / 10;

  el.innerHTML = `
    <div style="background:var(--card);border:1.5px solid var(--border2);border-radius:10px;padding:14px;margin-bottom:10px">
      <div style="font-size:11px;font-weight:700;color:var(--text2);letter-spacing:.5px;margin-bottom:10px">📊 АНАЛИЗ ПОРТФЕЛЯ</div>

      <!-- Доходность vs цель -->
      <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap">
        <div style="flex:1;min-width:90px;background:var(--amber-light);border-radius:7px;padding:9px 11px">
          <div style="font-size:9px;font-weight:700;color:var(--text2)">ОЖИД. ДОХОДНОСТЬ</div>
          <div style="font-size:20px;font-weight:700;color:var(--topbar)">${analysis.expYield}%</div>
          <div style="font-size:10px;color:var(--text2)">в год</div>
        </div>
        <div style="flex:1;min-width:90px;background:${analysis.targetMet?'var(--green-bg)':'#ffebee'};border-radius:7px;padding:9px 11px">
          <div style="font-size:9px;font-weight:700;color:var(--text2)">РЕАЛЬНАЯ (−инфл.)</div>
          <div style="font-size:20px;font-weight:700;color:${analysis.targetMet?'var(--green-dark)':'var(--red)'}">${analysis.realYield}%</div>
          <div style="font-size:10px;color:var(--text2)">цель: ${settings.targetYield}%</div>
        </div>
        <div style="flex:1;min-width:90px;background:var(--amber-light);border-radius:7px;padding:9px 11px">
          <div style="font-size:9px;font-weight:700;color:var(--text2)">СТАВКА ЦБ</div>
          <div style="font-size:20px;font-weight:700;color:var(--topbar)">${settings.keyRate}%</div>
          <div style="font-size:10px;color:${settings.keyRate>=18?'var(--red)':'var(--green-dark)'}">
            ${settings.keyRate>=18?'🔴 высокая':'🟢 нейтральная'}
          </div>
        </div>
      </div>

      ${!analysis.targetMet ? `
      <div style="background:#fff3cd;border:1px solid #ffc107;border-radius:6px;padding:8px 10px;margin-bottom:10px;font-size:12px">
        ⚠ Для покрытия инфляции ${settings.inflation}% + цели ${settings.targetYield}% нужно
        <b>${targetTotal}%</b>. Текущий портфель даёт <b>${analysis.expYield}%</b>.
        Разрыв: <b style="color:var(--red)">−${gap}%</b>
      </div>` : `
      <div style="background:var(--green-bg);border:1px solid rgba(74,124,63,.3);border-radius:6px;padding:8px 10px;margin-bottom:10px;font-size:12px;color:var(--green-dark)">
        ✅ Цель достигнута: ${analysis.expYield}% ≥ инфляция ${settings.inflation}% + цель ${settings.targetYield}%
      </div>`}

      <!-- Сильные стороны -->
      <div style="margin-bottom:8px">
        <div style="font-size:10px;font-weight:700;color:var(--green-dark);margin-bottom:4px">✅ СИЛЬНЫЕ СТОРОНЫ</div>
        ${analysis.strengths.map(s=>`<div style="font-size:12px;color:var(--topbar);padding:2px 0;border-bottom:.5px solid var(--border)">· ${esc(s)}</div>`).join('')}
      </div>

      <!-- Слабые стороны -->
      ${analysis.weaknesses.length ? `
      <div>
        <div style="font-size:10px;font-weight:700;color:var(--red);margin-bottom:4px">⚠ ПРОБЛЕМЫ</div>
        ${analysis.weaknesses.map(s=>`<div style="font-size:12px;color:var(--topbar);padding:2px 0;border-bottom:.5px solid var(--border)">· ${esc(s)}</div>`).join('')}
      </div>` : ''}

      <!-- Прогноз -->
      <div style="margin-top:10px;background:var(--amber-light);border-radius:6px;padding:8px 10px;font-size:12px;color:var(--topbar)">
        🔭 ${esc(analysis.forecast)}
      </div>
    </div>`;
}

function renderRecommendations(recs) {
  const el = document.getElementById('portfolio-recommendations');
  if (!el) return;

  if (!recs || !recs.length) {
    el.innerHTML = '<div style="color:var(--text2);font-size:13px;padding:8px">Нет активов для анализа.</div>';
    return;
  }

  const actionStyle = {
    sell:     { bg:'#ffebee', color:'var(--red)',        label:'ПРОДАТЬ',  icon:'📉' },
    buy:      { bg:'var(--green-bg)', color:'var(--green-dark)', label:'ДОКУПИТЬ', icon:'📈' },
    buy_new:  { bg:'#e3f2fd', color:'#1565c0',          label:'ДОБАВИТЬ', icon:'💡' },
    hold:     { bg:'var(--amber-light)', color:'var(--amber-dark)', label:'ДЕРЖАТЬ', icon:'⏸' },
  };

  el.innerHTML = `
    <div style="background:var(--card);border:1.5px solid var(--border2);border-radius:10px;padding:14px">
      <div style="font-size:11px;font-weight:700;color:var(--text2);letter-spacing:.5px;margin-bottom:10px">💡 РЕКОМЕНДАЦИИ ПО АКТИВАМ</div>
      ${recs.map(r => {
        const st = actionStyle[r.action] || actionStyle.hold;
        const tradeInfo = r.action !== 'hold' && Math.abs(r.delta) > 0
          ? `${r.action.includes('buy')?'+':''}${r.delta} шт. (≈ ${fmt(Math.round(r.tradeValue))})`
          : '';
        return `
          <div style="display:flex;gap:8px;align-items:flex-start;padding:9px 10px;background:${st.bg};border-radius:8px;margin-bottom:6px">
            <div style="flex-shrink:0;min-width:72px">
              <div style="font-size:9px;font-weight:700;color:${st.color};letter-spacing:.5px">${st.icon} ${st.label}</div>
              <div style="font-size:13px;font-weight:700;color:var(--topbar)">${esc(r.name)}</div>
              ${tradeInfo?`<div style="font-size:10px;color:${st.color};font-weight:700">${esc(tradeInfo)}</div>`:''}
              ${r.newQuantity!==r.currentQty?`<div style="font-size:10px;color:var(--text2)">${r.currentQty}→${r.newQuantity} шт.</div>`:''}
            </div>
            <div style="font-size:11px;color:var(--topbar);line-height:1.5;flex:1">${esc(r.reason)}</div>
          </div>`;
      }).join('')}
    </div>`;
}

function renderTargetStructure(analysis, settings) {
  const el = document.getElementById('portfolio-target-structure');
  if (!el || !analysis) return;

  const strat   = STRATEGIES[settings.strategy] || STRATEGIES.moderate;
  const targets = settings.keyRate >= 18 ? strat.highRate : strat.lowRate;

  const rows = ASSET_TYPES
    .filter(t => (targets[t.value] || 0) > 0 || (analysis.weights[t.value] || 0) > 0)
    .map(t => {
      const fact  = analysis.weights[t.value] || 0;
      const tgt   = Math.round((targets[t.value] || 0) * 100);
      const diff  = Math.round(fact - tgt);
      const dc    = Math.abs(diff) <= 5 ? 'var(--green-dark)' : Math.abs(diff) <= 15 ? 'var(--amber-dark)' : 'var(--red)';
      return `
        <div style="margin-bottom:7px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:2px">
            <div style="display:flex;align-items:center;gap:4px">
              <div style="width:8px;height:8px;border-radius:2px;background:${t.color};flex-shrink:0"></div>
              <span style="font-size:11px;color:var(--topbar)">${t.label}</span>
            </div>
            <div style="font-size:10px;display:flex;gap:6px;align-items:center">
              <span style="color:var(--text2)">факт <b style="color:var(--topbar)">${Math.round(fact)}%</b></span>
              <span style="color:var(--text2)">цель <b>${tgt}%</b></span>
              ${diff!==0?`<span style="font-weight:700;color:${dc};min-width:30px;text-align:right">${diff>0?'+':''}${diff}п.</span>`:'<span style="color:var(--green-dark);min-width:30px;text-align:right">✓</span>'}
            </div>
          </div>
          <div style="position:relative;background:var(--g50);border-radius:3px;height:5px">
            <div style="position:absolute;height:5px;border-radius:3px;background:${t.color};opacity:.25;width:${tgt}%"></div>
            <div style="position:absolute;height:5px;border-radius:3px;background:${t.color};width:${Math.min(Math.round(fact),100)}%;transition:width .4s"></div>
          </div>
        </div>`;
    }).join('');

  el.innerHTML = `
    <div style="background:var(--card);border:1.5px solid var(--border2);border-radius:10px;padding:14px">
      <div style="font-size:11px;font-weight:700;color:var(--text2);letter-spacing:.5px;margin-bottom:10px">
        🎯 ЦЕЛЕВАЯ СТРУКТУРА · ${(STRATEGIES[settings.strategy]||STRATEGIES.moderate).label}
      </div>
      ${rows}
    </div>`;
}

// ─────────────────────────────────────────────────────────────────────────
// 6. ГЛАВНЫЙ ОРКЕСТРАТОР
// ─────────────────────────────────────────────────────────────────────────
export async function runPortfolioAnalysis() {
  if (!state.D?.portfolio?.length) return;

  const settings = getPortSettings();
  const portfolio = state.D.portfolio;

  // Обновляем ставку ЦБ
  const aiBtn = document.getElementById('btn-ai-strategy');
  if (aiBtn) { aiBtn.disabled = true; aiBtn.textContent = '⏳ Получаю ставку ЦБ...'; }

  try {
    settings.keyRate = await fetchKeyRate();
    sched();
  } catch (_) {}

  // Математический анализ
  const analysis = analyzePortfolio(
    portfolio,
    settings.targetYield,
    settings.inflation,
    settings.keyRate
  );

  // Рекомендации
  const recs = generateRecommendations(portfolio, analysis, settings);

  // Рендер левой колонки
  renderAnalysis(analysis, settings);
  renderRecommendations(recs);
  renderTargetStructure(analysis, settings);

  // Кнопка AI
  if (aiBtn) { aiBtn.disabled = false; aiBtn.textContent = '🤖 AI-стратегия (YandexGPT)'; }

  return { analysis, recs, settings };
}

// ─────────────────────────────────────────────────────────────────────────
// 7. РЕНДЕР ГЛАВНОГО ЭКРАНА (двухколоночный layout)
// ─────────────────────────────────────────────────────────────────────────
export function renderPortfolio() {
  if (!state.D) return;
  if (!state.D.portfolio) state.D.portfolio = [];

  const settings  = getPortSettings();
  const portfolio = state.D.portfolio;
  const total     = portfolio.reduce((s, a) => s + a.qty * (a.currentPrice || a.buyPrice), 0);
  const invested  = portfolio.reduce((s, a) => s + a.qty * a.buyPrice, 0);
  const pnl       = total - invested;
  const pnlPct    = invested > 0 ? Math.round(pnl / invested * 1000) / 10 : 0;

  // Summary
  const summaryEl = $('portfolio-summary');
  if (summaryEl) {
    summaryEl.innerHTML = `
      <div class="bal-grid">
        <div class="bal-item"><div class="bal-lbl">СТОИМОСТЬ</div><div class="bal-val">${fmt(Math.round(total))}</div></div>
        <div class="bal-item"><div class="bal-lbl">ВЛОЖЕНО</div><div class="bal-val">${fmt(Math.round(invested))}</div></div>
        <div class="bal-item ${pnl>=0?'green':'red'}">
          <div class="bal-lbl">ПРИБЫЛЬ/УБЫТОК</div>
          <div class="bal-val ${pnl>=0?'pos':'neg'}">${pnl>=0?'+':''}${fmt(Math.round(pnl))}</div>
        </div>
        <div class="bal-item ${pnl>=0?'green':'red'}">
          <div class="bal-lbl">ДОХОДНОСТЬ</div>
          <div class="bal-val ${pnl>=0?'pos':'neg'}">${pnlPct>=0?'+':''}${pnlPct}%</div>
        </div>
      </div>`;
  }

  // Параметры портфеля
  const listEl = $('portfolio-list');
  if (!listEl) return;

  // Двухколоночный layout
  let wrap = document.getElementById('port-wrap');
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.id = 'port-wrap';
    wrap.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:12px;align-items:start';
    // Медиа
    const st = document.createElement('style');
    st.textContent = '@media(max-width:680px){#port-wrap{grid-template-columns:1fr!important}}';
    document.head.appendChild(st);
    listEl.parentNode.insertBefore(wrap, listEl);
  }

  // Левая колонка
  wrap.innerHTML = `
    <div id="port-left">
      <!-- Параметры -->
      <div style="background:var(--card);border:1.5px solid var(--border2);border-radius:10px;padding:14px;margin-bottom:10px">
        <div style="font-size:11px;font-weight:700;color:var(--text2);letter-spacing:.5px;margin-bottom:10px">⚙️ ПАРАМЕТРЫ</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px">
          <div>
            <div style="font-size:10px;font-weight:700;color:var(--text2);margin-bottom:3px">ЦЕЛЬ % РЕАЛ. ДОХОДА</div>
            <input class="fi" type="number" id="p-target" value="${settings.targetYield}" min="1" max="50" step="0.5" style="padding:7px 10px;font-size:15px;font-weight:700">
          </div>
          <div>
            <div style="font-size:10px;font-weight:700;color:var(--text2);margin-bottom:3px">ИНФЛЯЦИЯ %</div>
            <input class="fi" type="number" id="p-infl" value="${settings.inflation}" min="1" max="50" step="0.5" style="padding:7px 10px">
          </div>
          <div>
            <div style="font-size:10px;font-weight:700;color:var(--text2);margin-bottom:3px">ВЗНОС В МЕС. ₽</div>
            <input class="fi" type="number" id="p-monthly" value="${settings.monthlyCash}" min="0" step="1000" style="padding:7px 10px">
          </div>
          <div>
            <div style="font-size:10px;font-weight:700;color:var(--text2);margin-bottom:3px">СТАВКА ЦБ %</div>
            <div style="display:flex;gap:4px;align-items:center">
              <input class="fi" type="number" id="p-rate" value="${settings.keyRate}" min="1" max="50" step="0.25" style="padding:7px 10px;flex:1">
              <button class="sbtn amber" onclick="window.refreshKeyRate()" title="Обновить ставку ЦБ" style="padding:7px 10px">🔄</button>
            </div>
          </div>
        </div>
        <div style="font-size:10px;font-weight:700;color:var(--text2);margin-bottom:4px">СТРАТЕГИЯ</div>
        <div style="display:flex;gap:6px;margin-bottom:8px">
          ${Object.entries(STRATEGIES).map(([k,v])=>`
            <button onclick="window.setPortStrategy('${k}')" style="flex:1;padding:7px 4px;border:2px solid ${k===settings.strategy?'var(--amber)':'var(--border)'};border-radius:7px;background:${k===settings.strategy?'var(--amber)':'var(--bg)'};color:${k===settings.strategy?'#fff':'var(--text2)'};font-size:10px;font-weight:700;cursor:pointer">${v.label}</button>
          `).join('')}
        </div>
        <button class="btn-primary" onclick="window.savePortSettings()" style="width:100%;padding:9px">Пересчитать</button>
      </div>

      <!-- Список активов -->
      <div id="portfolio-list-inner">
        ${_renderAssetList(portfolio, total)}
      </div>
    </div>

    <!-- Правая колонка -->
    <div id="port-right">
      <div id="portfolio-analysis"></div>
      <div id="portfolio-recommendations" style="margin-top:10px"></div>
      <div id="portfolio-target-structure" style="margin-top:10px"></div>

      <!-- AI блок -->
      <div style="background:var(--card);border:1.5px solid var(--border2);border-radius:10px;padding:14px;margin-top:10px">
        <div style="font-size:11px;font-weight:700;color:var(--text2);letter-spacing:.5px;margin-bottom:10px">🤖 AI-СТРАТЕГИЯ</div>
        <button id="btn-ai-strategy" class="btn-primary" onclick="window.runAIStrategy()" style="width:100%;padding:10px">
          🤖 AI-стратегия (YandexGPT)
        </button>
        <div id="portfolio-ai-result" style="margin-top:10px"></div>
        <div style="font-size:10px;color:var(--text2);margin-top:6px">⚠ Не является инвестиционной рекомендацией</div>
      </div>
    </div>
  `;

  // Скрываем старый portfolio-list
  if (listEl) listEl.style.display = 'none';

  // Запускаем анализ
  runPortfolioAnalysis();
}

function _renderAssetList(portfolio, total) {
  if (!portfolio.length) return '<div style="color:var(--text2);font-size:13px;padding:8px 0">Нет активов. Нажмите «+ Добавить актив».</div>';
  return portfolio.map((a, i) => {
    const cur   = a.currentPrice || a.buyPrice;
    const val   = a.qty * cur;
    const cost  = a.qty * a.buyPrice;
    const pnl   = val - cost;
    const pnlP  = cost > 0 ? Math.round(pnl / cost * 1000) / 10 : 0;
    const share = total > 0 ? Math.round(val / total * 100) : 0;
    const color = pnl >= 0 ? 'var(--green-dark)' : 'var(--red)';
    const type  = typeMap[a.assetType || 'other'];
    const stale = a.lastUpdated ? Math.floor((Date.now() - new Date(a.lastUpdated+'T12:00:00')) / 864e5) >= 14 : true;
    return `
      <div style="background:var(--card);border:1.5px solid var(--border2);border-radius:10px;padding:12px 14px;margin-bottom:8px">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px">
          <div style="flex:1;min-width:0">
            <div style="font-size:13px;font-weight:700;color:var(--topbar)">
              ${esc(a.ticker)}
              ${stale ? '<span style="font-size:9px;color:var(--orange-dark);margin-left:4px">⏰ цена устарела</span>' : ''}
            </div>
            <div style="font-size:11px;color:var(--text2)">${esc(a.name||'')}${type?` · <span style="color:${type.color}">${type.label}</span>`:''}</div>
            <div style="font-size:10px;color:var(--text2);margin-top:1px">${a.qty} шт. · покупка ${fmt(a.buyPrice)} · текущая ${fmt(cur)}</div>
          </div>
          <div style="display:flex;gap:4px;flex-shrink:0">
            <button class="sbtn blue"  onclick="window.editAsset(${i})" style="font-size:11px">✎</button>
            <button class="sbtn amber" onclick="window.updateAssetPrice(${i})" style="font-size:11px">₽</button>
            <button class="sbtn red"   onclick="window.deleteAsset(${i})" style="font-size:11px">✕</button>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-bottom:6px">
          <div style="background:var(--amber-light);border-radius:5px;padding:6px 8px">
            <div style="font-size:9px;color:var(--text2);font-weight:700">СТОИМОСТЬ</div>
            <div style="font-size:12px;font-weight:700;color:var(--topbar)">${fmt(Math.round(val))}</div>
          </div>
          <div style="background:${pnl>=0?'var(--green-bg)':'#ffebee'};border-radius:5px;padding:6px 8px">
            <div style="font-size:9px;color:var(--text2);font-weight:700">П/У</div>
            <div style="font-size:12px;font-weight:700;color:${color}">${pnl>=0?'+':''}${fmt(Math.round(pnl))} (${pnlP>=0?'+':''}${pnlP}%)</div>
          </div>
          <div style="background:var(--amber-light);border-radius:5px;padding:6px 8px">
            <div style="font-size:9px;color:var(--text2);font-weight:700">ДОЛЯ · ДОХОДН.</div>
            <div style="font-size:12px;font-weight:700;color:var(--topbar)">${share}% · ${a.yieldPct??type?.defYield??0}%</div>
          </div>
        </div>
        <div style="background:var(--g50);border-radius:3px;height:4px">
          <div style="height:4px;border-radius:3px;background:${type?.color||'var(--amber)'};width:${share}%"></div>
        </div>
      </div>`;
  }).join('');
}

// ─────────────────────────────────────────────────────────────────────────
// 8. ОБРАБОТЧИКИ
// ─────────────────────────────────────────────────────────────────────────
window.savePortSettings = function() {
  const s = getPortSettings();
  const t = parseFloat(document.getElementById('p-target')?.value);
  const f = parseFloat(document.getElementById('p-infl')?.value);
  const m = parseFloat(document.getElementById('p-monthly')?.value);
  const r = parseFloat(document.getElementById('p-rate')?.value);
  if (t>0) s.targetYield = t;
  if (f>0) s.inflation   = f;
  if (m>=0) s.monthlyCash = m;
  if (r>0) { s.keyRate = r; s.keyRateCachedAt = null; } // сброс кеша при ручном вводе
  sched(); renderPortfolio();
};

window.setPortStrategy = function(key) {
  const s = getPortSettings(); s.strategy = key; sched(); renderPortfolio();
};

window.refreshKeyRate = async function() {
  const s = getPortSettings();
  s.keyRateCachedAt = null; // Сбрасываем кеш
  sched();
  const btn = document.querySelector('[onclick="window.refreshKeyRate()"]');
  if (btn) { btn.textContent = '⏳'; btn.disabled = true; }
  try {
    const rate = await fetchKeyRate();
    const inp = document.getElementById('p-rate');
    if (inp) inp.value = rate;
    renderPortfolio();
  } catch (e) { alert('Не удалось получить ставку ЦБ: ' + e.message); }
  finally { if (btn) { btn.textContent = '🔄'; btn.disabled = false; } }
};

window.runAIStrategy = async function() {
  if (!state.D?.portfolio?.length) { alert('Добавьте активы в портфель'); return; }

  const btn = document.getElementById('btn-ai-strategy');
  const res = document.getElementById('portfolio-ai-result');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Анализирую...'; }
  if (res) res.innerHTML = '<div style="color:var(--text2);font-size:12px">YandexGPT анализирует ваш портфель...</div>';

  try {
    const settings  = getPortSettings();
    const portfolio = state.D.portfolio;
    const analysis  = analyzePortfolio(portfolio, settings.targetYield, settings.inflation, settings.keyRate);
    const recs      = generateRecommendations(portfolio, analysis, settings);
    const text      = await getAIStrategy({ portfolio, analysis, settings, recs });

    if (res) res.innerHTML = `
      <div style="background:var(--amber-light);border:1.5px solid var(--border);border-radius:8px;padding:14px">
        <div style="font-size:10px;font-weight:700;color:var(--text2);letter-spacing:.5px;margin-bottom:8px">🤖 YANDEXGPT</div>
        <div style="font-size:13px;color:var(--topbar);line-height:1.75;white-space:pre-wrap">${esc(text)}</div>
      </div>`;
  } catch (e) {
    if (res) res.innerHTML = `<div class="notice amber" style="font-size:12px">Ошибка: ${esc(e.message)}<br>Проверьте URL воркера в Администраторе.</div>`;
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🤖 AI-стратегия (YandexGPT)'; }
  }
};

// Открыть форму добавления актива
window.openAddAsset = function() {
  if (!state.D.portfolio) state.D.portfolio = [];
  $('asset-idx').value     = -1;
  $('asset-ticker').value  = '';
  $('asset-name').value    = '';
  $('asset-qty').value     = '';
  $('asset-buy').value     = '';
  $('asset-cur').value     = '';
  $('asset-yield').value   = '';
  _fillTypeSelect(-1);
  document.getElementById('modal-asset').classList.add('open');
};

window.editAsset = function(i) {
  const a = state.D.portfolio[i];
  $('asset-idx').value    = i;
  $('asset-ticker').value = a.ticker;
  $('asset-name').value   = a.name || '';
  $('asset-qty').value    = a.qty;
  $('asset-buy').value    = a.buyPrice;
  $('asset-cur').value    = a.currentPrice || a.buyPrice;
  $('asset-yield').value  = a.yieldPct ?? '';
  _fillTypeSelect(i);
  document.getElementById('modal-asset').classList.add('open');
};

function _fillTypeSelect(idx) {
  const sel = $('asset-type');
  if (!sel) return;
  sel.innerHTML = ASSET_TYPES.map(t =>
    `<option value="${t.value}">${t.label}</option>`
  ).join('');
  if (idx >= 0) sel.value = state.D.portfolio[idx]?.assetType || 'other';
  else sel.value = 'other';
}

window.updateAssetPrice = window.updatePrice = function(i) {
  const a        = state.D.portfolio[i];
  const newPrice = parseFloat(prompt(`Текущая цена ${a.ticker} (сейчас: ${a.currentPrice || a.buyPrice} ₽):`));
  if (!newPrice || isNaN(newPrice)) return;
  state.D.portfolio[i].currentPrice = newPrice;
  state.D.portfolio[i].lastUpdated  = today();
  if (!state.D.portfolioUpdated) state.D.portfolioUpdated = {};
  state.D.portfolioUpdated.lastUpdate = today();
  sched(); renderPortfolio();
};

window.saveAsset = function() {
  if (!state.D.portfolio) state.D.portfolio = [];
  const idx   = +($('asset-idx')?.value ?? -1);
  const qty   = parseFloat($('asset-qty')?.value);
  const buy   = parseFloat($('asset-buy')?.value);
  const cur   = parseFloat($('asset-cur')?.value) || buy;
  const yield_= parseFloat($('asset-yield')?.value);
  const ticker = ($('asset-ticker')?.value || '').trim().toUpperCase();

  if (!ticker || !qty || !buy) { alert('Заполните тикер, количество и цену покупки'); return; }

  const asset = {
    id:           idx >= 0 ? state.D.portfolio[idx].id : ('ast' + Date.now()),
    ticker,
    name:         ($('asset-name')?.value || '').trim(),
    qty,
    buyPrice:     buy,
    currentPrice: cur,
    assetType:    $('asset-type')?.value || 'other',
    yieldPct:     isNaN(yield_) ? null : yield_,
    lastUpdated:  today(),
  };

  if (idx >= 0) state.D.portfolio[idx] = asset;
  else state.D.portfolio.push(asset);

  if (!state.D.portfolioUpdated) state.D.portfolioUpdated = {};
  state.D.portfolioUpdated.lastUpdate = today();
  sched();
  document.getElementById('modal-asset').classList.remove('open');
  renderPortfolio();
};

window.deleteAsset = function(i) {
  if (!confirm('Удалить актив?')) return;
  state.D.portfolio.splice(i, 1); sched(); renderPortfolio();
};

// ── Алерт ────────────────────────────────────────────────────────────────
export function checkPortfolioAlert() {
  if (!state.D?.portfolio?.length) return null;
  const lu = state.D.portfolioUpdated?.lastUpdate;
  if (!lu) return 'Обновите цены в портфеле инвестиций';
  const d = Math.floor((new Date(today()) - new Date(lu)) / (1000 * 60 * 60 * 24));
  if (d >= 7) return `Цены в портфеле не обновлялись ${d} дн.`;
  return null;
}
