/**
 * investment-engine.js
 * Порт Python InvestmentEngine → ES-модуль (без UI, без зависимостей).
 *
 * Правила архитектуры:
 * - Не импортирует state, sched, DOM — только чистые вычисления.
 * - Экспортирует одну функцию runEngine(assets, keyRate, monthlyCash) → result.
 * - Все результаты возвращаются как простой объект — portfolio.js рисует UI.
 */

// ── Константы ────────────────────────────────────────────────────────────
const MIN_TRADE = 1000;

// ── Группировка активов по типу ──────────────────────────────────────────
function groupWeights(assets, total) {
  const groups = { safe: 0, floating: 0, fixed: 0, stocks: 0, cash: 0 };

  for (const a of assets) {
    const val = a.qty * (a.currentPrice || a.buyPrice);
    switch (a.assetType) {
      case 'etf':           groups.safe     += val; break;
      case 'bond_floating': groups.floating += val; break;
      case 'bond_fixed':    groups.fixed    += val; break;
      case 'stock':         groups.stocks   += val; break;
      case 'cash':
      case 'currency':      groups.cash     += val; break;
      // Если тип не задан — считаем акцией (консервативно)
      default:              groups.stocks   += val; break;
    }
  }

  if (total <= 0) return groups;
  return Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, v / total]));
}

// ── Рыночный режим ───────────────────────────────────────────────────────
function getRegime(keyRate) {
  if (keyRate >= 0.18) return 'high_rate';
  if (keyRate >= 0.14) return 'neutral';
  return 'low_rate';
}

// ── Целевое распределение ────────────────────────────────────────────────
function getTarget(regime) {
  const targets = {
    high_rate: { safe: 0.55, floating: 0.00, fixed: 0.25, stocks: 0.15, cash: 0.05 },
    neutral:   { safe: 0.45, floating: 0.05, fixed: 0.25, stocks: 0.20, cash: 0.05 },
    low_rate:  { safe: 0.25, floating: 0.00, fixed: 0.45, stocks: 0.25, cash: 0.05 },
  };
  return targets[regime] || targets.neutral;
}

// ── Отклонения от цели ───────────────────────────────────────────────────
function calcDeviations(weights, target) {
  const dev = {};
  for (const k of Object.keys(target)) {
    dev[k] = (weights[k] || 0) - target[k];
  }
  return dev;
}

// ── Рекомендации «продать» ───────────────────────────────────────────────
function generateSell(assets, deviations) {
  const sell = [];

  for (const a of assets) {
    // Продаём ETF (safe) при перевесе > 10 п.п.
    if (a.assetType === 'etf' && deviations.safe > 0.10) {
      const val = a.qty * (a.currentPrice || a.buyPrice);
      const amount = Math.min(val * 0.25, val);
      if (amount > MIN_TRADE) {
        sell.push({ ticker: a.ticker, amount_rub: Math.round(amount), reason: 'Перевес ETF — фиксация части позиции' });
      }
    }

    // Продаём акции при перевесе > 10 п.п.
    if (a.assetType === 'stock' && deviations.stocks > 0.10) {
      const val = a.qty * (a.currentPrice || a.buyPrice);
      const amount = Math.min(val * 0.20, val);
      if (amount > MIN_TRADE) {
        sell.push({ ticker: a.ticker, amount_rub: Math.round(amount), reason: 'Перевес акций — сокращение позиции' });
      }
    }

    // Продаём длинные ОФЗ при высокой ставке (risk)
    if (a.assetType === 'bond_fixed' && deviations.fixed > 0.08) {
      const val = a.qty * (a.currentPrice || a.buyPrice);
      const amount = Math.min(val * 0.15, val);
      if (amount > MIN_TRADE) {
        sell.push({ ticker: a.ticker, amount_rub: Math.round(amount), reason: 'Фиксированные облигации в избытке' });
      }
    }
  }

  return sell;
}

// ── Рекомендации «купить» ────────────────────────────────────────────────
function generateBuy(deviations, availableCash, regime) {
  const deficits = {};
  let totalDeficit = 0;

  for (const [k, v] of Object.entries(deviations)) {
    if (v < 0) {
      deficits[k] = Math.abs(v);
      totalDeficit += Math.abs(v);
    }
  }

  if (totalDeficit === 0 || availableCash < MIN_TRADE) return [];

  const buy = [];
  for (const [k, v] of Object.entries(deficits)) {
    const amount = (v / totalDeficit) * availableCash;
    if (amount < MIN_TRADE) continue;

    buy.push({
      group: k,
      ticker: mapGroup(k, regime),
      amount_rub: Math.round(amount),
      reason: groupBuyReason(k, regime),
    });
  }

  return buy;
}

// ── Ежемесячный план пополнения ───────────────────────────────────────────
function generateMonthlyPlan(deviations, monthlyCash, regime) {
  const deficits = {};
  let total = 0;

  for (const [k, v] of Object.entries(deviations)) {
    if (v < 0) { deficits[k] = Math.abs(v); total += Math.abs(v); }
  }

  if (total === 0 || monthlyCash < MIN_TRADE) return [];

  const plan = [];
  for (const [k, v] of Object.entries(deficits)) {
    const amount = (v / total) * monthlyCash;
    if (amount < MIN_TRADE) continue;
    plan.push({
      group: k,
      ticker: mapGroup(k, regime),
      amount_rub: Math.round(amount),
      reason: groupBuyReason(k, regime),
    });
  }

  return plan;
}

// ── Концентрационный риск ────────────────────────────────────────────────
function calcConcentration(assets, total) {
  const warnings = [];
  for (const a of assets) {
    const val = a.qty * (a.currentPrice || a.buyPrice);
    const share = total > 0 ? val / total : 0;
    if (share > 0.30) {
      warnings.push({
        ticker: a.ticker,
        share_pct: Math.round(share * 100),
        message: `${a.ticker} занимает ${Math.round(share * 100)}% портфеля — высокая концентрация`,
      });
    }
  }
  return warnings;
}

// ── Ожидаемая доходность портфеля ────────────────────────────────────────
function calcExpectedYield(assets, total) {
  // Упрощённая модель: взвешенная доходность по типу актива и ключевой ставке
  let weighted = 0;
  for (const a of assets) {
    const val = a.qty * (a.currentPrice || a.buyPrice);
    const w = total > 0 ? val / total : 0;
    // Используем явную доходность актива, если задана, иначе прокси по типу
    const y = a.yieldPct != null ? a.yieldPct / 100 : defaultYield(a.assetType);
    weighted += w * y;
  }
  return Math.round(weighted * 1000) / 10; // %
}

function defaultYield(assetType) {
  const map = { etf: 0.17, bond_floating: 0.19, bond_fixed: 0.12, stock: 0.15, cash: 0.21, currency: 0.02 };
  return map[assetType] || 0.10;
}

// ── Хелперы ──────────────────────────────────────────────────────────────
function mapGroup(group, regime) {
  const mapping = {
    safe:     'LQDT',          // ликвидность / денежный ETF
    floating: 'OFZ29019',      // флоатер ОФЗ
    fixed:    'OFZ26248',      // длинная ОФЗ
    stocks:   'TMOS',          // индексный ETF на акции
    cash:     'RUB',
  };
  // При высокой ставке safe = денежный ETF, иначе = облигационный ETF
  if (group === 'safe' && regime !== 'high_rate') return 'SBGB';
  return mapping[group] || 'UNKNOWN';
}

function groupBuyReason(group, regime) {
  const reasons = {
    safe:     regime === 'high_rate' ? 'Денежный ETF даёт ~21% при высокой ставке' : 'Облигационный ETF для стабильности',
    floating: 'Флоатеры защищают от роста ставки',
    fixed:    'Фиксированные ОФЗ — рост стоимости при снижении ставки',
    stocks:   'Акции — долгосрочный рост, докупить на просадке',
    cash:     'Денежный резерв для оперативных возможностей',
  };
  return reasons[group] || '';
}

// ── Главная функция ──────────────────────────────────────────────────────
/**
 * @param {Array} assets - массив активов из state.D.portfolio
 * @param {number} keyRate - ключевая ставка (0.21 = 21%)
 * @param {number} monthlyCash - ежемесячный взнос в рублях
 * @returns {object} - полный результат анализа
 */
export function runEngine(assets, keyRate, monthlyCash) {
  if (!assets || !assets.length) {
    return { empty: true, regime: getRegime(keyRate) };
  }

  const total = assets.reduce((s, a) => s + a.qty * (a.currentPrice || a.buyPrice), 0);
  const weights = groupWeights(assets, total);
  const regime = getRegime(keyRate);
  const target = getTarget(regime);
  const deviations = calcDeviations(weights, target);

  const sell = generateSell(assets, deviations);
  const availableCash = sell.reduce((s, x) => s + x.amount_rub, 0) + (monthlyCash || 0);
  const buy = generateBuy(deviations, availableCash, regime);
  const monthlyPlan = generateMonthlyPlan(deviations, monthlyCash || 0, regime);
  const concentration = calcConcentration(assets, total);
  const expectedYield = calcExpectedYield(assets, total);

  // Оценка качества распределения (0–100)
  const totalDeviation = Object.values(deviations).reduce((s, v) => s + Math.abs(v), 0);
  const balanceScore = Math.max(0, Math.round(100 - totalDeviation * 200));

  return {
    empty: false,
    total,
    weights,
    regime,
    target,
    deviations,
    actions: { sell, buy },
    monthlyPlan,
    concentration,
    expectedYield,
    balanceScore,
    // Для передачи в LLM
    llmInput: {
      portfolioSummary: { total_value: Math.round(total), weights },
      marketContext: { regime, key_rate_pct: Math.round(keyRate * 100) },
      deviations,
      actions: { sell, buy },
      monthlyPlan,
      balanceScore,
      expectedYield,
    },
  };
}

// ── Экспорт регимов для UI ────────────────────────────────────────────────
export const REGIME_LABELS = {
  high_rate: { label: 'Высокая ставка', color: 'var(--red)', icon: '🔴', desc: 'ЦБ держит ставку ≥18% — акцент на денежные инструменты и флоатеры' },
  neutral:   { label: 'Нейтральный',   color: 'var(--amber-dark)', icon: '🟡', desc: 'Ставка 14–18% — сбалансированный портфель' },
  low_rate:  { label: 'Низкая ставка', color: 'var(--green-dark)', icon: '🟢', desc: 'Ставка <14% — время фиксировать доходность в длинных облигациях и акциях' },
};

export const GROUP_LABELS = {
  safe:     { label: 'Денежные ETF / ликвидность', icon: '💵' },
  floating: { label: 'Флоатеры (ОФЗ перем.)',       icon: '🔄' },
  fixed:    { label: 'Фикс. облигации (ОФЗ)',       icon: '📄' },
  stocks:   { label: 'Акции / ETF акций',            icon: '📈' },
  cash:     { label: 'Кэш / валюта',                 icon: '💴' },
};

export const ASSET_TYPES = [
  { value: 'etf',           label: 'ETF / БПИФ (денежный, облигационный)' },
  { value: 'stock',         label: 'Акции / ETF на акции' },
  { value: 'bond_fixed',    label: 'Облигации с фиксированным купоном' },
  { value: 'bond_floating', label: 'Облигации с переменным купоном (флоатеры)' },
  { value: 'cash',          label: 'Кэш / рублёвые депозиты' },
  { value: 'currency',      label: 'Валюта / замещающие облигации' },
];
