/**
 * investment-engine.js
 * Чистый вычислительный движок (без UI, без DOM).
 * Экспортирует: runEngine(), STRATEGIES, REGIME_LABELS, GROUP_LABELS, ASSET_TYPES, SECTORS
 */

// ── Константы ─────────────────────────────────────────────────────────────
const MIN_TRADE = 1000;

// ── Стратегии ──────────────────────────────────────────────────────────────
export const STRATEGIES = {
  conservative: {
    label: 'Консервативная',
    icon: '🛡️',
    desc: 'Сохранение капитала. Доходность чуть выше инфляции.',
    maxVolatility: 0.10, // 10% годовых
    target: { safe: 0.55, floating: 0.15, fixed: 0.20, stocks: 0.05, cash: 0.05 },
    color: 'var(--blue)',
  },
  moderate: {
    label: 'Умеренная',
    icon: '⚖️',
    desc: 'Баланс роста и защиты капитала.',
    maxVolatility: 0.15,
    target: { safe: 0.40, floating: 0.10, fixed: 0.20, stocks: 0.25, cash: 0.05 },
    color: 'var(--amber-dark)',
  },
  aggressive: {
    label: 'Агрессивная',
    icon: '🚀',
    desc: 'Максимизация роста. Высокий риск.',
    maxVolatility: 0.25,
    target: { safe: 0.20, floating: 0.05, fixed: 0.10, stocks: 0.60, cash: 0.05 },
    color: 'var(--red)',
  },
};

// ── Режимы ставки ─────────────────────────────────────────────────────────
export const REGIME_LABELS = {
  high_rate: {
    label: 'Высокая ставка ≥18%',
    color: 'var(--red)',
    icon: '🔴',
    desc: 'Акцент на денежные ETF и флоатеры — они дают максимум при текущей ставке',
  },
  neutral: {
    label: 'Нейтральный 14–18%',
    color: 'var(--amber-dark)',
    icon: '🟡',
    desc: 'Сбалансированный портфель. Начало перехода в фиксированные облигации.',
  },
  low_rate: {
    label: 'Низкая ставка <14%',
    color: 'var(--green-dark)',
    icon: '🟢',
    desc: 'Время фиксировать доходность в длинных ОФЗ и наращивать долю акций.',
  },
};

// ── Типы активов ─────────────────────────────────────────────────────────
export const ASSET_TYPES = [
  { value: 'etf',           label: 'ETF / БПИФ (денежный, облигационный)' },
  { value: 'stock',         label: 'Акции / ETF на акции' },
  { value: 'bond_fixed',    label: 'Облигации фиксированный купон (ОФЗ)' },
  { value: 'bond_floating', label: 'Облигации переменный купон (флоатеры)' },
  { value: 'cash',          label: 'Кэш / рублёвые депозиты' },
  { value: 'currency',      label: 'Валюта / замещающие облигации' },
];

// ── Группы для отображения ────────────────────────────────────────────────
export const GROUP_LABELS = {
  safe:     { label: 'Денежные ETF / ликвидность', icon: '💵', color: 'var(--amber)' },
  floating: { label: 'Флоатеры (ОФЗ перем.)',       icon: '🔄', color: 'var(--blue)' },
  fixed:    { label: 'Фиксированные облигации',     icon: '📄', color: 'var(--green-dark)' },
  stocks:   { label: 'Акции / ETF акций',            icon: '📈', color: 'var(--red)' },
  cash:     { label: 'Кэш / валюта',                 icon: '💴', color: 'var(--text2)' },
};

// ── Сектора по тикерам МосБиржи (расширяемый словарь) ────────────────────
export const SECTORS = {
  // Финансы
  SBER: 'Финансы', VTBR: 'Финансы', TCSG: 'Финансы', MOEX: 'Финансы', BSPB: 'Финансы',
  // Нефть и газ
  GAZP: 'Нефть/Газ', LKOH: 'Нефть/Газ', ROSN: 'Нефть/Газ', NVTK: 'Нефть/Газ',
  TATN: 'Нефть/Газ', SNGS: 'Нефть/Газ', SIBN: 'Нефть/Газ',
  // Металлы
  NLMK: 'Металлы', CHMF: 'Металлы', MAGN: 'Металлы', GMKN: 'Металлы',
  ALRS: 'Металлы', POLY: 'Металлы', RUAL: 'Металлы',
  // Телеком
  MTSS: 'Телеком', RTKM: 'Телеком', VKCO: 'IT/Телеком',
  // IT
  YDEX: 'IT', OZON: 'IT', POSI: 'IT', ASTR: 'IT', HHR: 'IT',
  // Потребительский
  MGNT: 'Потребит.', FIXP: 'Потребит.', LENT: 'Потребит.',
  // Транспорт
  AFLT: 'Транспорт', FESH: 'Транспорт',
  // Энергетика
  IRAO: 'Энергетика', FEES: 'Энергетика', HYDR: 'Энергетика',
  // ETF / облигации
  LQDT: 'ETF', SBGB: 'ETF', TMOS: 'ETF', SBRB: 'ETF',
  // ОФЗ
  OFZ26248: 'Облигации', OFZ29019: 'Облигации', OFZ26238: 'Облигации',
};

function getSector(ticker) {
  return SECTORS[ticker?.toUpperCase()] || 'Прочее';
}

// ── Режим рынка ───────────────────────────────────────────────────────────
function getRegime(keyRate) {
  if (keyRate >= 0.18) return 'high_rate';
  if (keyRate >= 0.14) return 'neutral';
  return 'low_rate';
}

// ── Целевое распределение (с учётом стратегии И ставки) ───────────────────
function getTarget(regime, strategyKey) {
  const strat = STRATEGIES[strategyKey] || STRATEGIES.moderate;
  const base = { ...strat.target };

  // Корректируем под режим ставки поверх стратегии
  if (regime === 'high_rate') {
    // Сдвигаем в пользу safe (денежный ETF) за счёт fixed
    const shift = Math.min(base.fixed * 0.3, 0.10);
    base.safe = Math.min(base.safe + shift, 0.70);
    base.fixed = Math.max(base.fixed - shift, 0);
  } else if (regime === 'low_rate') {
    // Сдвигаем в пользу fixed (длинные ОФЗ) за счёт safe
    const shift = Math.min(base.safe * 0.3, 0.10);
    base.fixed = Math.min(base.fixed + shift, 0.60);
    base.safe = Math.max(base.safe - shift, 0.05);
  }

  // Нормализуем до 100%
  const total = Object.values(base).reduce((s, v) => s + v, 0);
  return Object.fromEntries(Object.entries(base).map(([k, v]) => [k, v / total]));
}

// ── Группировка активов ───────────────────────────────────────────────────
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
      default:              groups.stocks   += val; break;
    }
  }
  if (total <= 0) return groups;
  return Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, v / total]));
}

// ── Концентрация по секторам ──────────────────────────────────────────────
function calcSectorWeights(assets, total) {
  const sectors = {};
  for (const a of assets) {
    const val = a.qty * (a.currentPrice || a.buyPrice);
    const sector = getSector(a.ticker);
    sectors[sector] = (sectors[sector] || 0) + val;
  }
  return Object.fromEntries(
    Object.entries(sectors)
      .map(([k, v]) => [k, { value: v, pct: total > 0 ? Math.round(v / total * 100) : 0 }])
      .sort((a, b) => b[1].value - a[1].value)
  );
}

// ── Отклонения от цели ────────────────────────────────────────────────────
function calcDeviations(weights, target) {
  const dev = {};
  for (const k of Object.keys(target)) {
    dev[k] = (weights[k] || 0) - target[k];
  }
  return dev;
}

// ── Расчёт необходимой доходности для цели ────────────────────────────────
function calcRequiredYield(currentValue, goalAmount, goalYears) {
  if (!goalAmount || !goalYears || currentValue <= 0) return null;
  // (goal / current) ^ (1/years) - 1
  return Math.round(((Math.pow(goalAmount / currentValue, 1 / goalYears) - 1) * 100) * 10) / 10;
}

// ── Ожидаемая доходность портфеля ────────────────────────────────────────
function calcExpectedYield(assets, total) {
  const defaults = { etf: 19, bond_floating: 21, bond_fixed: 12, stock: 15, cash: 21, currency: 3 };
  let weighted = 0;
  for (const a of assets) {
    const val = a.qty * (a.currentPrice || a.buyPrice);
    const w = total > 0 ? val / total : 0;
    const y = (a.yieldPct != null && a.yieldPct > 0) ? a.yieldPct : (defaults[a.assetType] || 10);
    weighted += w * y;
  }
  return Math.round(weighted * 10) / 10;
}

// ── Концентрационные предупреждения ──────────────────────────────────────
function calcConcentration(assets, total) {
  const warnings = [];
  for (const a of assets) {
    const val = a.qty * (a.currentPrice || a.buyPrice);
    const share = total > 0 ? val / total : 0;
    if (share > 0.30) {
      warnings.push({
        ticker: a.ticker,
        share_pct: Math.round(share * 100),
        message: `${a.ticker} занимает ${Math.round(share * 100)}% — высокая концентрация в одном активе`,
      });
    }
  }
  return warnings;
}

// ── Рекомендации к продаже ────────────────────────────────────────────────
function generateSell(assets, deviations) {
  const sell = [];
  for (const a of assets) {
    if (a.assetType === 'etf' && deviations.safe > 0.10) {
      const val = a.qty * (a.currentPrice || a.buyPrice);
      const amount = Math.min(val * 0.25, val);
      if (amount > MIN_TRADE) sell.push({ ticker: a.ticker, amount_rub: Math.round(amount), reason: 'ETF в избытке — фиксация части позиции' });
    }
    if (a.assetType === 'stock' && deviations.stocks > 0.10) {
      const val = a.qty * (a.currentPrice || a.buyPrice);
      const amount = Math.min(val * 0.20, val);
      if (amount > MIN_TRADE) sell.push({ ticker: a.ticker, amount_rub: Math.round(amount), reason: 'Перевес акций — сокращение риска' });
    }
    if (a.assetType === 'bond_fixed' && deviations.fixed > 0.08) {
      const val = a.qty * (a.currentPrice || a.buyPrice);
      const amount = Math.min(val * 0.15, val);
      if (amount > MIN_TRADE) sell.push({ ticker: a.ticker, amount_rub: Math.round(amount), reason: 'Фикс. облигации в избытке при высокой ставке' });
    }
  }
  return sell;
}

// ── Рекомендации к покупке (с конкретными инструментами) ─────────────────
function generateBuy(deviations, availableCash, regime, strategyKey) {
  const deficits = {};
  let totalDeficit = 0;
  for (const [k, v] of Object.entries(deviations)) {
    if (v < 0) { deficits[k] = Math.abs(v); totalDeficit += Math.abs(v); }
  }
  if (totalDeficit === 0 || availableCash < MIN_TRADE) return [];

  const buy = [];
  for (const [k, v] of Object.entries(deficits)) {
    const amount = (v / totalDeficit) * availableCash;
    if (amount < MIN_TRADE) continue;
    const instr = getInstruments(k, regime, strategyKey);
    buy.push({
      group: k,
      ticker: instr.main.ticker,
      name: instr.main.name,
      amount_rub: Math.round(amount),
      reason: instr.main.reason,
      alternatives: instr.alternatives,
      confidence: instr.confidence,
    });
  }
  return buy;
}

// ── Ежемесячный план ─────────────────────────────────────────────────────
function generateMonthlyPlan(deviations, monthlyCash, regime, strategyKey) {
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
    const instr = getInstruments(k, regime, strategyKey);
    plan.push({
      group: k,
      ticker: instr.main.ticker,
      name: instr.main.name,
      amount_rub: Math.round(amount),
      reason: instr.main.reason,
    });
  }
  return plan;
}

// ── Конкретные инструменты по группе ─────────────────────────────────────
// Все тикеры — реальные инструменты МосБиржи (апрель 2025)
function getInstruments(group, regime, strategyKey) {
  const instruments = {
    safe: {
      high_rate: {
        main: { ticker: 'LQDT', name: 'ВТБ Ликвидность', reason: 'Денежный ETF — даёт ~21% годовых при ставке ЦБ 21%, минимальный риск' },
        alternatives: [
          { ticker: 'SBMM', name: 'СберМани', yield_pct: 20.5, risk: 'Низкий' },
          { ticker: 'AKMM', name: 'Альфа-Кэш', yield_pct: 20.8, risk: 'Низкий' },
        ],
        confidence: 'Высокий',
      },
      neutral: {
        main: { ticker: 'SBGB', name: 'БПИФ ОФЗ Сбер', reason: 'Облигационный ETF — диверсифицированная ставка на снижение ставки ЦБ' },
        alternatives: [
          { ticker: 'LQDT', name: 'ВТБ Ликвидность', yield_pct: 19, risk: 'Низкий' },
          { ticker: 'GPBM', name: 'Газпромбанк Денежный', yield_pct: 20, risk: 'Низкий' },
        ],
        confidence: 'Средний',
      },
      low_rate: {
        main: { ticker: 'SBGB', name: 'БПИФ ОФЗ Сбер', reason: 'При снижении ставки облигационный ETF растёт в цене — двойная выгода' },
        alternatives: [
          { ticker: 'SBRB', name: 'БПИФ корп. обл.', yield_pct: 14, risk: 'Низкий' },
          { ticker: 'BOND', name: 'Финансовые решения', yield_pct: 13, risk: 'Низкий' },
        ],
        confidence: 'Высокий',
      },
    },
    floating: {
      main: { ticker: 'OFZ29019', name: 'ОФЗ 29019 (флоатер)', reason: 'Купон = RUONIA + 0.1%. Защищает от дальнейшего роста ставки' },
      alternatives: [
        { ticker: 'OFZ29021', name: 'ОФЗ 29021', yield_pct: 21, risk: 'Низкий' },
        { ticker: 'OFZ29024', name: 'ОФЗ 29024', yield_pct: 21.2, risk: 'Низкий' },
      ],
      confidence: 'Высокий',
    },
    fixed: {
      high_rate: {
        main: { ticker: 'OFZ26248', name: 'ОФЗ 26248 (2040)', reason: 'Длинные ОФЗ — при снижении ставки вырастут в цене. Фиксируем доходность ~12%' },
        alternatives: [
          { ticker: 'OFZ26238', name: 'ОФЗ 26238 (2041)', yield_pct: 12.1, risk: 'Низкий' },
          { ticker: 'OFZ26230', name: 'ОФЗ 26230 (2039)', yield_pct: 11.9, risk: 'Низкий' },
        ],
        confidence: 'Средний',
      },
      default: {
        main: { ticker: 'OFZ26248', name: 'ОФЗ 26248 (2040)', reason: 'Фиксируем высокую доходность на длительный срок' },
        alternatives: [
          { ticker: 'OFZ26238', name: 'ОФЗ 26238', yield_pct: 12.1, risk: 'Низкий' },
          { ticker: 'SBGB', name: 'БПИФ ОФЗ', yield_pct: 11.5, risk: 'Низкий' },
        ],
        confidence: 'Высокий',
      },
    },
    stocks: {
      aggressive: {
        main: { ticker: 'TMOS', name: 'Индекс МосБиржи (БПИФ)', reason: 'Широкая диверсификация по акциям РФ. Долгосрочный рост.' },
        alternatives: [
          { ticker: 'SBMX', name: 'Сбер Индекс МосБиржи', yield_pct: 15, risk: 'Высокий' },
          { ticker: 'EQMX', name: 'ВТБ Индекс МосБиржи', yield_pct: 15, risk: 'Высокий' },
        ],
        confidence: 'Средний',
      },
      default: {
        main: { ticker: 'TMOS', name: 'Индекс МосБиржи (БПИФ)', reason: 'Акции — долгосрочный рост выше инфляции. ETF снижает риск отдельных компаний.' },
        alternatives: [
          { ticker: 'SBER', name: 'Сбербанк', yield_pct: 14, risk: 'Средний' },
          { ticker: 'LKOH', name: 'Лукойл', yield_pct: 13, risk: 'Средний' },
        ],
        confidence: 'Средний',
      },
    },
    cash: {
      main: { ticker: 'LQDT', name: 'ВТБ Ликвидность', reason: 'Кэш-резерв лучше держать в денежном ETF — растёт каждый день' },
      alternatives: [
        { ticker: 'SBMM', name: 'СберМани', yield_pct: 20.5, risk: 'Низкий' },
      ],
      confidence: 'Высокий',
    },
  };

  // Выбираем вариант по группе/режиму/стратегии
  const g = instruments[group];
  if (!g) return { main: { ticker: '?', name: 'Нет данных', reason: '' }, alternatives: [], confidence: 'Низкий' };

  // safe зависит от режима
  if (group === 'safe') return g[regime] || g.neutral;
  // fixed зависит от режима
  if (group === 'fixed') return g[regime] || g.default;
  // stocks зависит от стратегии
  if (group === 'stocks') return strategyKey === 'aggressive' ? g.aggressive : g.default;
  // floating и cash — фиксированные
  return g;
}

// ── Скор соответствия стратегии (0–100) ──────────────────────────────────
function calcStrategyScore(deviations) {
  const totalDev = Object.values(deviations).reduce((s, v) => s + Math.abs(v), 0);
  return Math.max(0, Math.round(100 - totalDev * 200));
}

// ── Прогресс к цели ───────────────────────────────────────────────────────
function calcGoalProgress(total, goalAmount, goalYears) {
  if (!goalAmount) return null;
  const progressPct = Math.round(total / goalAmount * 100);
  const requiredYield = calcRequiredYield(total, goalAmount, goalYears);
  return { progressPct: Math.min(progressPct, 100), requiredYield, goalAmount, goalYears };
}

// ── Главная функция ───────────────────────────────────────────────────────
/**
 * @param {Array} assets          - state.D.portfolio
 * @param {number} keyRate        - ключевая ставка (0.21 = 21%)
 * @param {number} monthlyCash    - ежемесячный взнос ₽
 * @param {string} strategyKey    - 'conservative' | 'moderate' | 'aggressive'
 * @param {number} goalAmount     - целевая сумма ₽ (0 = не задана)
 * @param {number} goalYears      - срок в годах
 * @returns {object}
 */
export function runEngine(assets, keyRate, monthlyCash, strategyKey = 'moderate', goalAmount = 0, goalYears = 5) {
  const regime = getRegime(keyRate);
  if (!assets || !assets.length) return { empty: true, regime, strategy: STRATEGIES[strategyKey] || STRATEGIES.moderate };

  const total = assets.reduce((s, a) => s + a.qty * (a.currentPrice || a.buyPrice), 0);
  const weights = groupWeights(assets, total);
  const target = getTarget(regime, strategyKey);
  const deviations = calcDeviations(weights, target);

  const sell = generateSell(assets, deviations);
  const availableCash = sell.reduce((s, x) => s + x.amount_rub, 0) + (monthlyCash || 0);
  const buy = generateBuy(deviations, availableCash, regime, strategyKey);
  const monthlyPlan = generateMonthlyPlan(deviations, monthlyCash || 0, regime, strategyKey);
  const concentration = calcConcentration(assets, total);
  const sectorWeights = calcSectorWeights(assets, total);
  const expectedYield = calcExpectedYield(assets, total);
  const strategyScore = calcStrategyScore(deviations);
  const goalProgress = calcGoalProgress(total, goalAmount, goalYears);
  const strategyData = STRATEGIES[strategyKey] || STRATEGIES.moderate;

  // Соответствие волатильности стратегии
  const stockShare = weights.stocks || 0;
  const approxVolatility = stockShare * 0.25 + (weights.fixed || 0) * 0.08 + (weights.safe || 0) * 0.02;
  const volatilityOk = approxVolatility <= strategyData.maxVolatility;

  // Сектор концентрации
  const sectorWarnings = Object.entries(sectorWeights)
    .filter(([, v]) => v.pct > 35)
    .map(([sector, v]) => `${v.pct}% в секторе «${sector}» — риск концентрации`);

  return {
    empty: false,
    total,
    weights,
    regime,
    target,
    deviations,
    strategyScore,
    strategyData,
    expectedYield,
    approxVolatility: Math.round(approxVolatility * 100),
    volatilityOk,
    actions: { sell, buy },
    monthlyPlan,
    concentration,
    sectorWeights,
    sectorWarnings,
    goalProgress,
    // Для LLM
    llmInput: {
      portfolioSummary: { total_value: Math.round(total), weights, expectedYield },
      marketContext: { regime, key_rate_pct: Math.round(keyRate * 100) },
      strategy: { key: strategyKey, label: strategyData.label, maxVolatility: strategyData.maxVolatility * 100 },
      deviations,
      actions: { sell, buy },
      monthlyPlan,
      strategyScore,
      goalProgress,
      sectorWarnings,
      concentration: concentration.map(c => c.message),
    },
  };
}
