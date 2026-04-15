/**
 * portfolio.js — Инвестиционный портфель
 *
 * КЛЮЧЕВЫЕ ИЗМЕНЕНИЯ:
 * 1. Цель = желаемая доходность % годовых (например 10% сверх инфляции)
 * 2. Стратегия (консервативная/умеренная/агрессивная) рассчитывается АВТОМАТИЧЕСКИ
 *    из: целевая доходность + ставка ЦБ + состав портфеля + ежемесячный взнос
 * 3. Пользователь может переопределить стратегию вручную
 * 4. Макет: двухколоночный (шапка+параметры+активы слева, рекомендации справа)
 */

import { $, fmt, state, sched, today, appConfig } from './core.js';

const esc = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ── Нормализация числа: "884,25" → 884.25 ────────────────────────────────
function toNum(val) {
  if (val == null) return 0;
  const n = parseFloat(String(val).replace(/\s/g, '').replace(',', '.'));
  return isNaN(n) ? 0 : n;
}

// ── Типы активов ──────────────────────────────────────────────────────────
const ASSET_TYPES = [
  { value: 'bond_fixed',    label: '📄 ОФЗ / фикс. купон',     color: '#4A7C3F', yieldBase: 14.67 },
  { value: 'bond_floating', label: '🔄 Флоатер (перем. купон)', color: '#5B9BD5', yieldBase: 21    },
  { value: 'etf',           label: '💵 ETF / БПИФ (денежный)', color: '#C9A96E', yieldBase: 21    },
  { value: 'stock',         label: '📈 Акция',                  color: '#C0392B', yieldBase: 15    },
  { value: 'cash',          label: '💴 Кэш / депозит',         color: '#95a5a6', yieldBase: 21    },
  { value: 'currency',      label: '💶 Валюта',                 color: '#8e44ad', yieldBase: 3     },
];
const TYPE_MAP = Object.fromEntries(ASSET_TYPES.map(t => [t.value, t]));

// ── Доходность по типу актива с учётом ставки ЦБ ─────────────────────────
function getTypeYield(assetType, keyRate, customYield) {
  if (customYield && customYield > 0) return customYield;
  const base = TYPE_MAP[assetType]?.yieldBase || 10;
  const rate = Math.round(keyRate * 100);
  // Денежные инструменты (ETF, cash, флоатеры) = примерно ставка ЦБ
  if (['etf', 'cash', 'bond_floating'].includes(assetType)) return rate;
  return base;
}

// ── Инструменты для рекомендаций ─────────────────────────────────────────
const INSTRUMENTS = {
  bond_fixed:    { ticker: 'ОФЗ 26248', name: 'ОФЗ 26248 (май 2040, фикс.)',   price: 884,  note: '14.67% YTM. При снижении ставки до 13% цена вырастет до 95–100% номинала.' },
  bond_floating: { ticker: 'ОФЗ 29019', name: 'ОФЗ 29019 (RUONIA флоатер)',   price: 990,  note: 'Купон = RUONIA + 0.1%. Защита при росте ставки.' },
  etf:           { ticker: 'LQDT',      name: 'ВТБ Ликвидность (LQDT)',        price: 1,    note: 'Денежный ETF ≈ ставке ЦБ. Начисляется ежедневно.' },
  stock:         { ticker: 'TMOS',      name: 'Индекс МосБиржи (TMOS)',        price: 6,    note: 'Широкая диверсификация. Долгосрочный рост при снижении ставки.' },
  cash:          { ticker: 'LQDT',      name: 'ВТБ Ликвидность (LQDT)',        price: 1,    note: 'Кэш выгоднее держать в денежном ETF.' },
};

// ── АВТОМАТИЧЕСКИЙ РАСЧЁТ СТРАТЕГИИ ──────────────────────────────────────
// Входные данные:
//   targetYield  — желаемая доходность % годовых (например 10)
//   keyRate      — ставка ЦБ (0.21 = 21%)
//   monthlyCash  — ежемесячный взнос ₽
//   total        — текущая стоимость портфеля ₽
//   currentYield — текущая взвешенная доходность портфеля %
//
// Логика:
//   1. Считаем максимальную доходность каждой стратегии при текущей ставке
//   2. Выбираем наименее рискованную стратегию, которая достигает targetYield
//   3. Учитываем что взнос со временем меняет структуру
function calcAutoStrategy(targetYield, keyRate, monthlyCash, total, currentYield) {
  const rate    = keyRate * 100; // в %
  const high    = keyRate >= 0.18;
  const neutral = keyRate >= 0.14 && keyRate < 0.18;
  const low     = keyRate < 0.14;

  // Ожидаемая доходность каждой стратегии при текущей ставке ЦБ
  // Расчёт: взвешенная по целевым весам стратегии
  const strategyYields = {
    conservative: high
      ? 0.55 * rate + 0.20 * 14.67 + 0.15 * rate + 0.05 * 15 + 0.05 * rate  // ~19% при 21%
      : 0.30 * rate + 0.45 * 13    + 0.10 * rate + 0.10 * 15 + 0.05 * rate,  // ~14% при 14%
    moderate: high
      ? 0.40 * rate + 0.20 * 14.67 + 0.10 * rate + 0.25 * 15 + 0.05 * rate  // ~20%
      : 0.20 * rate + 0.30 * 13    + 0.05 * rate + 0.40 * 15 + 0.05 * rate,  // ~15%
    aggressive: high
      ? 0.20 * rate + 0.10 * 14.67 + 0.05 * rate + 0.60 * 15 + 0.05 * rate  // ~19%
      : 0.10 * rate + 0.15 * 13    + 0.00 * rate + 0.70 * 15 + 0.05 * rate,  // ~15%
  };

  // Риск (волатильность) каждой стратегии
  const strategyRisk = { conservative: 8, moderate: 14, aggressive: 22 };

  // Бонус взноса: ежемесячный взнос увеличивает эффективную доходность
  const monthlyBonus = total > 0 ? (monthlyCash * 12 / total) * 100 : 0;
  const effectiveTarget = Math.max(0, targetYield - monthlyBonus * 0.5);

  // Выбираем наименее рискованную стратегию достигающую цели
  let autoStrategy = 'conservative';
  if (strategyYields.conservative >= effectiveTarget) {
    autoStrategy = 'conservative';
  } else if (strategyYields.moderate >= effectiveTarget) {
    autoStrategy = 'moderate';
  } else {
    autoStrategy = 'aggressive';
  }

  return {
    autoStrategy,
    strategyYields: Object.fromEntries(Object.entries(strategyYields).map(([k, v]) => [k, Math.round(v * 10) / 10])),
    strategyRisk,
    monthlyBonus: Math.round(monthlyBonus * 10) / 10,
    effectiveTarget: Math.round(effectiveTarget * 10) / 10,
  };
}

// ── Целевые веса по стратегии и ставке ───────────────────────────────────
function getTarget(strategy, keyRate) {
  const high = keyRate >= 0.18;
  const targets = {
    conservative: high
      ? { bond_fixed: 0.20, bond_floating: 0.15, etf: 0.55, stock: 0.05, cash: 0.05, currency: 0 }
      : { bond_fixed: 0.45, bond_floating: 0.10, etf: 0.30, stock: 0.10, cash: 0.05, currency: 0 },
    moderate: high
      ? { bond_fixed: 0.20, bond_floating: 0.10, etf: 0.40, stock: 0.25, cash: 0.05, currency: 0 }
      : { bond_fixed: 0.30, bond_floating: 0.05, etf: 0.20, stock: 0.40, cash: 0.05, currency: 0 },
    aggressive: high
      ? { bond_fixed: 0.10, bond_floating: 0.05, etf: 0.20, stock: 0.60, cash: 0.05, currency: 0 }
      : { bond_fixed: 0.15, bond_floating: 0.00, etf: 0.10, stock: 0.70, cash: 0.05, currency: 0 },
  };
  return targets[strategy] || targets.moderate;
}

const STRATEGY_LABELS = {
  conservative: { label: 'Консервативная', icon: '🛡️', color: '#4A7C3F', desc: 'Сохранение капитала, доходность чуть выше инфляции, минимальный риск' },
  moderate:     { label: 'Умеренная',      icon: '⚖️', color: '#BA7517', desc: 'Баланс роста и защиты капитала, умеренный риск' },
  aggressive:   { label: 'Агрессивная',    icon: '🚀', color: '#C0392B', desc: 'Максимизация роста, высокий риск' },
};

// ── Настройки ─────────────────────────────────────────────────────────────
function getSettings() {
  if (!state.D.portfolioSettings) {
    state.D.portfolioSettings = {
      keyRate: 0.21,
      monthlyCash: 10000,
      targetYield: 10,   // % годовых сверх инфляции
      strategy: null,    // null = авто, иначе 'conservative'/'moderate'/'aggressive'
    };
  }
  const s = state.D.portfolioSettings;
  if (s.targetYield === undefined) s.targetYield = 10;
  if (s.strategy    === undefined) s.strategy    = null;
  // Миграция со старых версий
  if (s.goalAmount !== undefined) { delete s.goalAmount; delete s.goalYears; }
  return s;
}

// ── Полный расчёт портфеля ────────────────────────────────────────────────
function calcPortfolio(assets, s) {
  const total    = assets.reduce((sum, a) => sum + a.qty * (a.currentPrice || a.buyPrice), 0);
  const invested = assets.reduce((sum, a) => sum + a.qty * a.buyPrice, 0);
  const pnl      = total - invested;
  const pnlPct   = invested > 0 ? Math.round(pnl / invested * 1000) / 10 : 0;

  // Веса по типу
  const wPct = {};
  for (const a of assets) {
    const v = a.qty * (a.currentPrice || a.buyPrice);
    const k = a.assetType || 'stock';
    wPct[k] = (wPct[k] || 0) + (total > 0 ? v / total : 0);
  }

  // Текущая взвешенная доходность
  let currentYield = 0;
  for (const a of assets) {
    const v = a.qty * (a.currentPrice || a.buyPrice);
    const w = total > 0 ? v / total : 0;
    currentYield += w * getTypeYield(a.assetType || 'stock', s.keyRate, a.yieldPct);
  }
  currentYield = Math.round(currentYield * 10) / 10;

  // Автоматический расчёт стратегии
  const autoCalc  = calcAutoStrategy(s.targetYield, s.keyRate, s.monthlyCash, total, currentYield);
  const strategy  = s.strategy || autoCalc.autoStrategy; // ручная или авто
  const isAuto    = !s.strategy;

  const target     = getTarget(strategy, s.keyRate);
  const deviations = {};
  for (const k of Object.keys(target)) {
    deviations[k] = (wPct[k] || 0) - target[k];
  }

  // Балансировочный счёт 0–100
  const totalDev = Object.values(deviations).reduce((s, v) => s + Math.abs(v), 0);
  const score    = Math.max(0, Math.round(100 - totalDev * 200));

  // Прогресс по доходности
  const targetMet = currentYield >= s.targetYield;
  const gap       = Math.round((s.targetYield - currentYield) * 10) / 10;

  return {
    total, invested, pnl, pnlPct,
    wPct, target, deviations, score,
    currentYield, strategy, isAuto, autoCalc,
    targetMet, gap,
  };
}

// ── Главный рендер ────────────────────────────────────────────────────────
export function renderPortfolio() {
  if (!state.D) return;
  if (!state.D.portfolio) state.D.portfolio = [];

  const s      = getSettings();
  const assets = state.D.portfolio;
  const calc   = calcPortfolio(assets, s);

  // Создаём двухколоночный wrapper
  let wrap = $('port-two-col');
  if (!wrap) {
    const anchor = $('portfolio-list');
    if (!anchor) return;
    wrap = document.createElement('div');
    wrap.id = 'port-two-col';
    wrap.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:12px;align-items:start;';
    anchor.parentNode.insertBefore(wrap, anchor);
    const style = document.createElement('style');
    style.textContent = '@media(max-width:700px){#port-two-col{grid-template-columns:1fr!important;}}';
    document.head.appendChild(style);
  }
  wrap.innerHTML = '<div id="port-col-left"></div><div id="port-col-right"></div>';

  const pl = $('portfolio-list');
  if (pl) pl.style.display = 'none';

  _renderLeft(assets, calc, s);
  _renderRight(assets, calc, s);
}

// ── ЛЕВАЯ КОЛОНКА ─────────────────────────────────────────────────────────
function _renderLeft(assets, calc, s) {
  const col = $('port-col-left'); if (!col) return;

  const sl  = STRATEGY_LABELS[calc.strategy];
  const rate = Math.round(s.keyRate * 100);
  const high = s.keyRate >= 0.18;
  const rateLabel = high ? '🔴 Высокая ставка' : s.keyRate >= 0.14 ? '🟡 Нейтральная' : '🟢 Низкая ставка';

  // Строка состояния цели
  const goalStatus = calc.targetMet
    ? `<span style="color:var(--green-dark)">✓ Цель достигнута (${calc.currentYield}% ≥ ${s.targetYield}%)</span>`
    : `<span style="color:${calc.gap > 5 ? 'var(--red)' : 'var(--amber-dark)'}">Текущая ${calc.currentYield}% · нужно ещё +${calc.gap}%</span>`;

  // Индикатор стратегии (авто или ручная)
  const strategyBadge = calc.isAuto
    ? `<span style="font-size:9px;background:var(--green-bg);color:var(--green-dark);border:1px solid rgba(74,124,63,.3);padding:1px 6px;border-radius:10px;margin-left:6px">АВТО</span>`
    : `<span style="font-size:9px;background:var(--amber-light);color:var(--amber-dark);border:1px solid var(--border);padding:1px 6px;border-radius:10px;margin-left:6px">РУЧНАЯ</span>`;

  // Кнопки стратегий
  const stratBtns = Object.entries(STRATEGY_LABELS).map(([k, v]) => {
    const active = k === calc.strategy;
    const estYield = calc.autoCalc.strategyYields[k];
    return `<button onclick="window.setPortStrategy('${k}')" style="
      flex:1;padding:7px 4px;border:2px solid ${active ? v.color : 'var(--border)'};
      border-radius:8px;background:${active ? 'rgba(0,0,0,.05)' : 'var(--bg)'};
      color:${active ? v.color : 'var(--text2)'};font-size:10px;font-weight:700;cursor:pointer;
      display:flex;flex-direction:column;align-items:center;gap:2px">
      <span>${v.icon} ${v.label}</span>
      <span style="font-size:9px;opacity:.7">~${estYield}%</span>
    </button>`;
  }).join('');

  // Список активов
  const total = calc.total;
  const assetRows = assets.length
    ? assets.map((a, i) => {
        const cur   = a.currentPrice || a.buyPrice;
        const val   = a.qty * cur;
        const cost  = a.qty * a.buyPrice;
        const pnl   = val - cost;
        const pnlP  = cost > 0 ? Math.round(pnl / cost * 1000) / 10 : 0;
        const share = total > 0 ? Math.round(val / total * 100) : 0;
        const tc    = TYPE_MAP[a.assetType]?.color || 'var(--amber)';
        const pc    = pnl >= 0 ? 'var(--green-dark)' : 'var(--red)';
        const aYld  = getTypeYield(a.assetType || 'stock', s.keyRate, a.yieldPct);
        const stale = a.lastUpdated ? Math.floor((Date.now() - new Date(a.lastUpdated + 'T12:00:00')) / 864e5) >= 14 : false;
        return `
          <div style="display:flex;align-items:center;gap:7px;padding:8px 0;border-bottom:.5px solid var(--border)">
            <div style="width:3px;height:38px;border-radius:2px;background:${tc};flex-shrink:0"></div>
            <div style="flex:1;min-width:0">
              <div style="font-size:12px;font-weight:700;color:var(--topbar)">
                ${esc(a.ticker)}
                <span style="font-size:10px;font-weight:400;color:var(--text2)">${esc(a.name || '')}</span>
                ${stale ? '<span style="font-size:9px;color:var(--orange-dark)"> ⏰</span>' : ''}
              </div>
              <div style="font-size:10px;color:var(--text2)">${a.qty} шт · ${fmt(a.buyPrice)}/шт · ~${aYld}%/год</div>
            </div>
            <div style="text-align:right;flex-shrink:0">
              <div style="font-size:12px;font-weight:700;color:var(--topbar)">${fmt(Math.round(val))}</div>
              <div style="font-size:10px;color:${pc}">${pnl >= 0 ? '+' : ''}${fmt(Math.round(pnl))} (${pnlP}%)</div>
            </div>
            <div style="font-size:11px;font-weight:700;color:var(--text2);min-width:26px;text-align:right">${share}%</div>
            <div style="display:flex;gap:2px;flex-shrink:0">
              <button class="sbtn blue"  onclick="window.editAsset(${i})"          style="font-size:10px;padding:3px 5px">✎</button>
              <button class="sbtn amber" onclick="window.updateAssetPrice(${i})"    style="font-size:10px;padding:3px 5px">₽</button>
              <button class="sbtn red"   onclick="window.deleteAsset(${i})"         style="font-size:10px;padding:3px 5px">✕</button>
            </div>
          </div>`;
      }).join('')
    : `<div style="color:var(--text2);font-size:13px;padding:16px;text-align:center">
        <div style="font-size:24px;margin-bottom:6px">📋</div>
        Добавьте первый актив
      </div>`;

  // Структура портфеля
  const structRows = ASSET_TYPES.map(t => {
    const cur = Math.round((calc.wPct[t.value] || 0) * 100);
    const tgt = Math.round((calc.target[t.value] || 0) * 100);
    const dev = cur - tgt;
    const dc  = Math.abs(dev) <= 5 ? 'var(--green-dark)' : Math.abs(dev) <= 15 ? 'var(--amber-dark)' : 'var(--red)';
    return `
      <div style="margin-bottom:8px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:2px">
          <div style="display:flex;align-items:center;gap:4px">
            <div style="width:8px;height:8px;border-radius:2px;background:${t.color}"></div>
            <span style="font-size:11px;color:var(--topbar)">${t.label}</span>
          </div>
          <div style="font-size:10px;display:flex;gap:6px">
            <span style="color:var(--text2)">факт <b style="color:var(--topbar)">${cur}%</b></span>
            <span style="color:var(--text2)">цель <b>${tgt}%</b></span>
            <span style="font-weight:700;color:${dc};min-width:26px;text-align:right">${dev > 0 ? '+' : ''}${dev}п.</span>
          </div>
        </div>
        <div style="position:relative;background:var(--g50);border-radius:3px;height:6px">
          <div style="position:absolute;height:6px;border-radius:3px;background:${t.color};opacity:.2;width:${tgt}%"></div>
          <div style="position:absolute;height:6px;border-radius:3px;background:${t.color};width:${Math.min(cur,100)}%;transition:width .3s"></div>
        </div>
      </div>`;
  }).join('');

  const donutHtml = total > 0 ? _donutSvg(calc.wPct) : '';

  col.innerHTML = `
    <!-- Шапка: стоимость + цель по доходности -->
    <div style="background:var(--card);border:1.5px solid var(--border2);border-radius:12px;padding:16px;margin-bottom:10px">
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <div style="flex:2;min-width:150px">
          <div style="font-size:10px;color:var(--text2);font-weight:700;letter-spacing:.5px;margin-bottom:2px">ПОРТФЕЛЬ</div>
          <div style="font-size:26px;font-weight:700;color:var(--topbar)">₽ ${Math.round(calc.total).toLocaleString('ru-RU')}</div>
          <div style="font-size:11px;color:var(--text2);margin-top:2px">
            Вложено ₽ ${Math.round(calc.invested).toLocaleString('ru-RU')}
            <span style="margin-left:6px;font-weight:700;color:${calc.pnl >= 0 ? 'var(--green-dark)' : 'var(--red)'}">
              ${calc.pnl >= 0 ? '+' : ''}₽${Math.round(calc.pnl).toLocaleString('ru-RU')} (${calc.pnlPct}%)
            </span>
          </div>
        </div>
        <div style="flex:1;min-width:130px">
          <div style="font-size:10px;color:var(--text2);font-weight:700;letter-spacing:.5px;margin-bottom:2px">ЦЕЛЕВАЯ ДОХОДНОСТЬ</div>
          <div style="font-size:26px;font-weight:700;color:var(--topbar)">${s.targetYield}%<span style="font-size:13px;color:var(--text2)"> /год</span></div>
          <div style="font-size:11px;margin-top:2px">${goalStatus}</div>
        </div>
        <div style="flex:1;min-width:100px">
          <div style="font-size:10px;color:var(--text2);font-weight:700;letter-spacing:.5px;margin-bottom:2px">СЕЙЧАС</div>
          <div style="font-size:26px;font-weight:700;color:${calc.currentYield >= s.targetYield ? 'var(--green-dark)' : 'var(--amber-dark)'}">
            ${calc.currentYield}%
          </div>
          <div style="font-size:11px;color:var(--text2)">${rateLabel}</div>
        </div>
      </div>
    </div>

    <!-- Параметры -->
    <div style="background:var(--card);border:1.5px solid var(--border2);border-radius:12px;padding:14px;margin-bottom:10px">
      <div style="font-size:10px;font-weight:700;color:var(--text2);letter-spacing:.5px;margin-bottom:8px">ПАРАМЕТРЫ</div>

      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">
        <div style="flex:1;min-width:110px">
          <div style="font-size:10px;font-weight:700;color:var(--text2);margin-bottom:3px">🎯 ХОЧУ ДОХОДНОСТЬ % / ГОД</div>
          <input class="fi" type="number" id="port-target-yield" value="${s.targetYield}"
            min="1" max="50" step="0.5" style="padding:7px 10px;font-size:16px;font-weight:700">
          <div style="font-size:9px;color:var(--text2);margin-top:2px">Система сама выберет стратегию</div>
        </div>
        <div style="flex:1;min-width:110px">
          <div style="font-size:10px;font-weight:700;color:var(--text2);margin-bottom:3px">💰 ВЗНОС В МЕС. ₽</div>
          <input class="fi" type="number" id="port-monthly" value="${s.monthlyCash}"
            min="0" step="1000" style="padding:7px 10px;font-size:14px;font-weight:700">
        </div>
        <div style="flex:1;min-width:90px">
          <div style="font-size:10px;font-weight:700;color:var(--text2);margin-bottom:3px">📊 СТАВКА ЦБ %</div>
          <input class="fi" type="number" id="port-key-rate" value="${rate}"
            min="1" max="50" step="0.25" style="padding:7px 10px;font-size:14px;font-weight:700">
        </div>
        <button class="sbtn amber" onclick="window.savePortSettings()"
          style="padding:9px 14px;align-self:flex-end;white-space:nowrap">Пересчитать</button>
      </div>

      <!-- Стратегия -->
      <div style="font-size:10px;font-weight:700;color:var(--text2);letter-spacing:.5px;margin-bottom:6px">
        СТРАТЕГИЯ ${strategyBadge}
      </div>
      <div style="display:flex;gap:6px;margin-bottom:8px">${stratBtns}</div>
      <div style="font-size:11px;color:var(--text2);padding:6px 8px;background:var(--amber-light);border-radius:6px;margin-bottom:6px">
        <b>${sl.icon} ${sl.label}:</b> ${sl.desc}
      </div>
      ${calc.isAuto ? `
      <div style="font-size:10px;color:var(--text2);padding:5px 8px;background:var(--green-bg);border-radius:6px">
        ✓ Стратегия подобрана автоматически: для ${s.targetYield}% годовых при ставке ${rate}%
        нужна ${sl.label} (~${calc.autoCalc.strategyYields[calc.strategy]}% портфеля).
        Взнос ₽${s.monthlyCash}/мес добавляет ~${calc.autoCalc.monthlyBonus}% эффективной доходности.
        <a href="#" onclick="window.resetPortStrategy();return false"
          style="color:var(--amber-dark);font-weight:700;margin-left:4px">Задать вручную →</a>
      </div>` : `
      <div style="font-size:10px;color:var(--text2);padding:5px 8px;background:var(--amber-light);border-radius:6px">
        ⚙️ Стратегия выбрана вручную.
        <a href="#" onclick="window.resetPortStrategy();return false"
          style="color:var(--amber-dark);font-weight:700;margin-left:4px">Вернуть авторасчёт →</a>
      </div>`}
    </div>

    <!-- Активы -->
    <div style="background:var(--card);border:1.5px solid var(--border2);border-radius:12px;padding:14px;margin-bottom:10px">
      <div style="font-size:10px;font-weight:700;color:var(--text2);letter-spacing:.5px;margin-bottom:8px">АКТИВЫ В ПОРТФЕЛЕ</div>
      ${assetRows}
    </div>

    <!-- Текущая структура -->
    <div style="background:var(--card);border:1.5px solid var(--border2);border-radius:12px;padding:14px">
      <div style="font-size:10px;font-weight:700;color:var(--text2);letter-spacing:.5px;margin-bottom:10px">
        ТЕКУЩАЯ СТРУКТУРА ПОРТФЕЛЯ
        <span style="font-weight:400;color:${calc.score >= 70 ? 'var(--green-dark)' : calc.score >= 40 ? 'var(--amber-dark)' : 'var(--red)'}">
          · баланс ${calc.score}/100
        </span>
      </div>
      <div style="display:flex;gap:12px;align-items:flex-start;flex-wrap:wrap">
        ${donutHtml ? `<div style="flex-shrink:0">${donutHtml}</div>` : ''}
        <div style="flex:1;min-width:160px">${structRows}</div>
      </div>
    </div>
  `;
}

// ── ПРАВАЯ КОЛОНКА ─────────────────────────────────────────────────────────
function _renderRight(assets, calc, s) {
  const col = $('port-col-right'); if (!col) return;
  const recs = _buildRecs(calc, s);

  const recRows = recs.length
    ? recs.map(r => {
        const isBuy  = r.action === 'buy';
        const bg     = isBuy ? '#E8F5E9' : '#FFEBEE';
        const color  = isBuy ? 'var(--green-dark)' : 'var(--red)';
        const label  = isBuy ? 'Купить' : 'Продать';
        const qty    = r.pricePerUnit > 0 ? Math.floor(r.amount / r.pricePerUnit) : '—';
        return `
          <div style="display:grid;grid-template-columns:72px 1fr 88px 60px;gap:6px;align-items:center;
            padding:9px 10px;background:${bg};border-radius:8px;margin-bottom:5px">
            <div style="font-size:10px;font-weight:700;color:${color};text-align:center;
              padding:2px 4px;background:${isBuy ? 'rgba(74,124,63,.15)' : 'rgba(192,57,43,.15)'};border-radius:5px">
              ${label}
            </div>
            <div>
              <div style="font-size:12px;font-weight:700;color:var(--topbar)">${esc(r.ticker)}</div>
              <div style="font-size:10px;color:var(--text2)">${esc(r.name)}</div>
            </div>
            <div style="font-size:12px;font-weight:700;color:var(--topbar);text-align:right">${fmt(r.amount)}</div>
            <div style="font-size:11px;color:var(--text2);text-align:right">${qty !== '—' ? qty + ' шт' : '—'}</div>
          </div>`;
      }).join('')
    : `<div style="background:var(--green-bg);border:1px solid rgba(74,124,63,.2);border-radius:8px;padding:12px;font-size:12px;color:var(--green-dark);font-weight:700">
        ✅ Ребалансировка не нужна — портфель соответствует стратегии
      </div>`;

  const just = _buildJustification(calc, s, recs);
  const targetStruct = _buildTargetStruct(calc);
  const workerOk = !!(appConfig?.workerUrl || '').trim();

  col.innerHTML = `
    <!-- Рекомендации -->
    <div style="background:var(--card);border:1.5px solid var(--border2);border-radius:12px;padding:14px;margin-bottom:10px">
      <div style="font-size:10px;font-weight:700;color:var(--text2);letter-spacing:.5px;margin-bottom:8px">РЕКОМЕНДАЦИИ</div>
      <div style="display:grid;grid-template-columns:72px 1fr 88px 60px;gap:6px;padding:0 10px 6px;border-bottom:1px solid var(--border)">
        <div style="font-size:9px;font-weight:700;color:var(--text2)">ДЕЙСТВИЕ</div>
        <div style="font-size:9px;font-weight:700;color:var(--text2)">НАИМЕНОВАНИЕ</div>
        <div style="font-size:9px;font-weight:700;color:var(--text2);text-align:right">СУММА</div>
        <div style="font-size:9px;font-weight:700;color:var(--text2);text-align:right">КОЛИЧЕСТВО</div>
      </div>
      <div style="margin-top:6px">${recRows}</div>
    </div>

    <!-- Обоснование -->
    <div style="background:#E8F4FD;border:1.5px solid #B3D9F0;border-radius:12px;padding:14px;margin-bottom:10px">
      <div style="font-size:10px;font-weight:700;color:#1A6B9A;letter-spacing:.5px;margin-bottom:8px">ОБОСНОВАНИЕ</div>
      <div style="font-size:12px;color:var(--topbar);line-height:1.7">${just}</div>
    </div>

    <!-- Итоговая структура -->
    <div style="background:var(--card);border:1.5px solid var(--border2);border-radius:12px;padding:14px;margin-bottom:10px">
      <div style="font-size:10px;font-weight:700;color:var(--text2);letter-spacing:.5px;margin-bottom:10px">ИТОГОВАЯ СТРУКТУРА ПОРТФЕЛЯ</div>
      ${targetStruct}
    </div>

    <!-- Простым языком -->
    <div style="background:var(--card);border:1.5px solid var(--border2);border-radius:12px;padding:14px">
      <div style="font-size:10px;font-weight:700;color:var(--text2);letter-spacing:.5px;margin-bottom:10px">ПРОСТЫМ ЯЗЫКОМ</div>
      <button id="btn-explain-portfolio" onclick="window.explainPortfolio()" style="
        width:100%;padding:10px;border:1.5px solid var(--amber);border-radius:8px;
        background:var(--amber-light);color:var(--topbar);font-size:12px;font-weight:700;cursor:pointer">
        🤖 Объяснить рекомендации (YandexGPT)
      </button>
      ${!workerOk ? '<div style="font-size:10px;color:var(--text2);margin-top:6px;text-align:center">Настройте URL воркера в разделе «Администратор»</div>' : ''}
      <div id="portfolio-llm-result" style="margin-top:10px"></div>
    </div>
  `;
}

// ── Рекомендации ──────────────────────────────────────────────────────────
function _buildRecs(calc, s) {
  const recs = [];
  const available = s.monthlyCash || 0;

  // Продать при избытке > 10%
  for (const [k, dev] of Object.entries(calc.deviations)) {
    if (dev <= 0.10) continue;
    const instr  = INSTRUMENTS[k] || INSTRUMENTS.etf;
    const amount = Math.round(calc.total * (calc.wPct[k] || 0) * Math.min(dev * 1.5, 0.30));
    if (amount < 500) continue;
    recs.push({ action: 'sell', ticker: instr.ticker, name: instr.name, amount, pricePerUnit: instr.price, group: k });
  }

  // Купить при дефиците
  const deficits = Object.entries(calc.deviations).filter(([, v]) => v < -0.05);
  const totalDef = deficits.reduce((s, [, v]) => s + Math.abs(v), 0);
  const cash     = available + recs.reduce((s, r) => s + r.amount, 0);

  if (totalDef > 0 && cash >= 500) {
    for (const [k, dev] of deficits) {
      const amount = Math.round(cash * Math.abs(dev) / totalDef);
      if (amount < 500) continue;
      const instr = INSTRUMENTS[k] || INSTRUMENTS.etf;
      recs.push({ action: 'buy', ticker: instr.ticker, name: instr.name, amount, pricePerUnit: instr.price, group: k });
    }
  }

  return recs.slice(0, 5);
}

// ── Обоснование текстом ───────────────────────────────────────────────────
function _buildJustification(calc, s, recs) {
  const rate    = Math.round(s.keyRate * 100);
  const high    = s.keyRate >= 0.18;
  const sl      = STRATEGY_LABELS[calc.strategy];
  const parts   = [];

  parts.push(`Цель портфеля — ${s.targetYield}% годовых. Текущая ожидаемая доходность ${calc.currentYield}%.`);

  if (calc.isAuto) {
    parts.push(`При ставке ЦБ ${rate}% система автоматически подобрала ${sl.label.toLowerCase()} стратегию — она обеспечивает ~${calc.autoCalc.strategyYields[calc.strategy]}% при текущей конъюнктуре.`);
  }

  if (high) {
    parts.push(`Высокая ставка ЦБ ${rate}% делает денежные инструменты (LQDT, флоатеры) максимально привлекательными: ~${rate}% без риска.`);
    parts.push(`ОФЗ 26248 торгуется с дисконтом (~88% номинала): YTM 14.67% + потенциал роста тела до +16% при снижении ставки до 13%.`);
  } else {
    parts.push(`Ставка ЦБ ${rate}% — выгодно фиксировать доходность в длинных ОФЗ с фиксированным купоном.`);
  }

  if (calc.autoCalc.monthlyBonus > 0) {
    parts.push(`Ежемесячный взнос ₽${s.monthlyCash.toLocaleString('ru-RU')} добавляет ~${calc.autoCalc.monthlyBonus}% к эффективной доходности.`);
  }

  parts.push(`Ожидаемая доходность итоговой структуры: купоны ~${high ? '14–21' : '12–14'}% + дивиденды ~12% + потенциал роста длинных ОФЗ при снижении ставки (до +16%). В сумме — хороший шанс на 10% сверх инфляции.`);

  return parts.join(' ');
}

// ── Итоговая целевая структура ────────────────────────────────────────────
function _buildTargetStruct(calc) {
  return ASSET_TYPES.filter(t => (calc.target[t.value] || 0) > 0).map(t => {
    const tgt = Math.round((calc.target[t.value] || 0) * 100);
    return `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:.5px solid var(--border)">
        <div style="display:flex;align-items:center;gap:5px">
          <div style="width:8px;height:8px;border-radius:2px;background:${t.color}"></div>
          <span style="font-size:12px;color:var(--topbar)">${t.label}</span>
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          <div style="width:70px;background:var(--g50);border-radius:3px;height:5px">
            <div style="height:5px;border-radius:3px;background:${t.color};width:${tgt}%"></div>
          </div>
          <span style="font-size:12px;font-weight:700;color:var(--topbar);min-width:26px;text-align:right">${tgt}%</span>
        </div>
      </div>`;
  }).join('');
}

// ── SVG пончик ────────────────────────────────────────────────────────────
function _donutSvg(wPct) {
  const R = 44, r = 28, cx = 54, cy = 54;
  const data = ASSET_TYPES.map(t => ({ val: wPct[t.value] || 0, color: t.color })).filter(d => d.val > 0.01);
  if (!data.length) return '';
  let a = -Math.PI / 2;
  const paths = data.map(d => {
    const end = a + d.val * 2 * Math.PI;
    const lg  = d.val > 0.5 ? 1 : 0;
    const p   = `M${cx + R * Math.cos(a)},${cy + R * Math.sin(a)} A${R},${R} 0 ${lg},1 ${cx + R * Math.cos(end)},${cy + R * Math.sin(end)} L${cx + r * Math.cos(end)},${cy + r * Math.sin(end)} A${r},${r} 0 ${lg},0 ${cx + r * Math.cos(a)},${cy + r * Math.sin(a)} Z`;
    const res = `<path d="${p}" fill="${d.color}" opacity=".85" stroke="var(--bg)" stroke-width="1.5"/>`;
    a = end; return res;
  }).join('');
  return `<svg width="108" height="108" viewBox="0 0 108 108">${paths}</svg>`;
}

// ── Обработчики ───────────────────────────────────────────────────────────
window.setPortStrategy = function(key) {
  const s = getSettings(); s.strategy = key;
  state.D.portfolioSettings = s; sched(); renderPortfolio();
};

window.resetPortStrategy = function() {
  const s = getSettings(); s.strategy = null;
  state.D.portfolioSettings = s; sched(); renderPortfolio();
};

window.savePortSettings = function() {
  const kr = toNum($('port-key-rate')?.value) / 100;
  const mc = toNum($('port-monthly')?.value);
  const ty = toNum($('port-target-yield')?.value);
  if (!kr || kr < 0.01 || kr > 0.5) { alert('Введите ставку от 1 до 50'); return; }
  if (!ty || ty < 1 || ty > 50)     { alert('Введите целевую доходность от 1 до 50%'); return; }
  const s = getSettings();
  s.keyRate = kr; s.monthlyCash = mc; s.targetYield = ty;
  state.D.portfolioSettings = s; sched(); renderPortfolio();
};

window.openAddAsset = function() {
  if (!state.D.portfolio) state.D.portfolio = [];
  $('asset-idx').value = -1;
  $('asset-ticker').value = ''; $('asset-name').value = '';
  $('asset-qty').value = ''; $('asset-buy').value = ''; $('asset-cur').value = '';
  _fillAssetTypeSelect(-1);
  document.getElementById('modal-asset').classList.add('open');
};

window.editAsset = function(i) {
  const a = state.D.portfolio[i];
  $('asset-idx').value = i;
  $('asset-ticker').value = a.ticker; $('asset-name').value = a.name || '';
  $('asset-qty').value = a.qty; $('asset-buy').value = a.buyPrice;
  $('asset-cur').value = a.currentPrice || a.buyPrice;
  _fillAssetTypeSelect(i);
  document.getElementById('modal-asset').classList.add('open');
};

function _fillAssetTypeSelect(assetIdx) {
  const modal = document.getElementById('modal-asset'); if (!modal) return;
  const modalBody = modal.querySelector('.modal');
  modal.querySelector('#asset-type-wrap')?.remove();
  modal.querySelector('#asset-yield-wrap')?.remove();

  const typeWrap = document.createElement('div');
  typeWrap.id = 'asset-type-wrap'; typeWrap.className = 'fg';
  typeWrap.innerHTML = `<label>ТИП АКТИВА</label><select class="fi" id="asset-type">
    ${ASSET_TYPES.map(t => `<option value="${t.value}">${t.label}</option>`).join('')}
  </select>`;

  const yieldWrap = document.createElement('div');
  yieldWrap.id = 'asset-yield-wrap'; yieldWrap.className = 'fg';
  yieldWrap.innerHTML = `<label>КУПОННАЯ / ДИВИДЕНДНАЯ ДОХОДНОСТЬ % (необяз.)</label>
    <input class="fi" type="number" id="asset-yield" placeholder="напр. 14.67 для ОФЗ26248" step="0.01" min="0" max="100">`;

  const saveBtn = modalBody?.querySelector('.btn-primary');
  if (saveBtn) { modalBody.insertBefore(yieldWrap, saveBtn); modalBody.insertBefore(typeWrap, yieldWrap); }
  else { modalBody?.appendChild(typeWrap); modalBody?.appendChild(yieldWrap); }

  const sel = $('asset-type');
  if (sel) sel.value = assetIdx >= 0 ? (state.D.portfolio[assetIdx]?.assetType || 'bond_fixed') : 'bond_fixed';
  const yi = $('asset-yield');
  if (yi) yi.value = assetIdx >= 0 ? (state.D.portfolio[assetIdx]?.yieldPct ?? '') : '';
}

window.updateAssetPrice = function(i) {
  const a = state.D.portfolio[i];
  const raw = prompt(`Новая цена ${a.ticker} (сейчас: ${a.currentPrice || a.buyPrice} ₽):`);
  if (raw == null) return;
  const p = toNum(raw);
  if (!p || p <= 0) { alert('Введите корректную цену'); return; }
  state.D.portfolio[i].currentPrice = p; state.D.portfolio[i].lastUpdated = today();
  if (!state.D.portfolioUpdated) state.D.portfolioUpdated = {};
  state.D.portfolioUpdated.lastUpdate = today();
  sched(); renderPortfolio();
};
window.updatePrice = window.updateAssetPrice;

window.saveAsset = function() {
  if (!state.D.portfolio) state.D.portfolio = [];
  const idx      = +($('asset-idx').value || '-1');
  const tickerRaw = ($('asset-ticker').value || '').trim().toUpperCase();
  const qty      = toNum($('asset-qty').value);
  const buyPrice = toNum($('asset-buy').value);
  const curPrice = toNum($('asset-cur').value) || buyPrice;

  if (!tickerRaw)    { alert('Введите тикер (например: OFZ26248 или SBER)'); return; }
  if (qty <= 0)      { alert(`Неверное количество: "${$('asset-qty').value}"\nВведите число (точка вместо запятой)`); return; }
  if (buyPrice <= 0) { alert(`Неверная цена: "${$('asset-buy').value}"\nВведите число (точка вместо запятой)`); return; }

  const asset = {
    id: idx >= 0 ? state.D.portfolio[idx].id : ('ast' + Date.now()),
    ticker: tickerRaw, name: ($('asset-name').value || '').trim(),
    qty, buyPrice, currentPrice: curPrice,
    assetType: $('asset-type')?.value || 'bond_fixed',
    yieldPct: toNum($('asset-yield')?.value) || null,
    lastUpdated: today(),
  };

  if (idx >= 0) state.D.portfolio[idx] = asset; else state.D.portfolio.push(asset);
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

// ── YandexGPT объяснение ─────────────────────────────────────────────────
window.explainPortfolio = async function() {
  const resultEl = $('portfolio-llm-result');
  const btn      = $('btn-explain-portfolio');
  if (!resultEl) return;

  const workerUrl = (appConfig?.workerUrl || '').trim();
  if (!workerUrl) {
    resultEl.innerHTML = '<div class="notice amber" style="font-size:12px">⚠ Настройте URL воркера в разделе «Администратор»</div>';
    return;
  }

  if (btn) { btn.disabled = true; btn.textContent = '⏳ Анализирую...'; }
  resultEl.innerHTML = '<div style="color:var(--text2);font-size:12px;padding:8px 0">YandexGPT анализирует...</div>';

  const s    = getSettings();
  const assets = state.D.portfolio;
  const calc = calcPortfolio(assets, s);
  const recs = _buildRecs(calc, s);
  const sl   = STRATEGY_LABELS[calc.strategy];

  const system = `Ты дружелюбный финансовый советник. Объясни простым языком без терминов.
Структура ответа (без markdown):
1. Рынок сейчас — 1 предложение.
2. Главная проблема портфеля — 1 предложение.
3. Что сделать прямо сейчас — 2-3 действия с тикерами.
4. Как это приближает к цели ${s.targetYield}% годовых — 1 предложение.
5. Главный риск — 1 предложение.
До 180 слов. Только русский язык.`;

  const user = `Цель: ${s.targetYield}% годовых. Текущая доходность: ${calc.currentYield}%.
Ставка ЦБ: ${Math.round(s.keyRate * 100)}%. Стратегия: ${sl.label} (${calc.isAuto ? 'авто' : 'ручная'}).
Портфель: ₽${Math.round(calc.total).toLocaleString('ru-RU')}, баланс ${calc.score}/100.
Активы: ${assets.map(a => `${a.ticker} x${a.qty} (${TYPE_MAP[a.assetType]?.label?.replace(/[📄🔄💵📈💴💶]\s?/, '') || a.assetType}, ~${getTypeYield(a.assetType, s.keyRate, a.yieldPct)}%/год)`).join('; ') || 'пусто'}.
Рекомендации: ${recs.map(r => `${r.action === 'buy' ? 'купить' : 'продать'} ${r.ticker} на ₽${r.amount}`).join('; ') || 'ребалансировка не нужна'}.
Отклонения: ${Object.entries(calc.deviations).filter(([,v]) => Math.abs(v) > 0.05).map(([k,v]) => `${k} ${v > 0 ? '+' : ''}${Math.round(v*100)}п.п.`).join(', ') || 'нет'}.`;

  try {
    const endpoint = workerUrl.replace(/\/?$/, '') + '/gpt';
    const headers  = { 'Content-Type': 'application/json' };
    if (appConfig?.appSecret) headers['X-App-Secret'] = appConfig.appSecret;

    const resp = await fetch(endpoint, {
      method: 'POST', headers,
      body: JSON.stringify({
        completionOptions: { stream: false, temperature: 0.3, maxTokens: 400 },
        messages: [{ role: 'system', text: system }, { role: 'user', text: user }],
      }),
    });
    if (!resp.ok) throw new Error('Сервер ' + resp.status);
    const data = await resp.json();
    const text = (data.result?.alternatives?.[0]?.message?.text || '').trim();
    if (!text) throw new Error('Пустой ответ');

    resultEl.innerHTML = `
      <div style="background:var(--amber-light);border:1.5px solid var(--border);border-radius:10px;padding:14px;margin-top:8px">
        <div style="font-size:10px;font-weight:700;color:var(--text2);letter-spacing:.5px;margin-bottom:8px">🤖 YANDEXGPT</div>
        <div style="font-size:13px;color:var(--topbar);line-height:1.75">${text.replace(/\n/g, '<br>')}</div>
        <div style="font-size:10px;color:var(--text2);margin-top:10px;border-top:1px solid var(--border);padding-top:6px">
          ⚠ Не является инвестиционной рекомендацией
        </div>
      </div>`;
  } catch (e) {
    resultEl.innerHTML = `<div class="notice amber" style="font-size:12px">Ошибка GPT: ${esc(e.message)}</div>`;
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🤖 Объяснить рекомендации (YandexGPT)'; }
  }
};

export function checkPortfolioAlert() {
  if (!state.D?.portfolio?.length) return null;
  const lu = state.D.portfolioUpdated?.lastUpdate;
  if (!lu) return 'Обновите цены в портфеле инвестиций';
  const d = Math.floor((new Date(today()) - new Date(lu)) / (1000 * 60 * 60 * 24));
  if (d >= 7) return `Цены в портфеле не обновлялись ${d} дн.`;
  const s = getSettings();
  if (state.D.portfolio.length > 0) {
    const calc = calcPortfolio(state.D.portfolio, s);
    if (!calc.targetMet && calc.gap > 5) return `Портфель не достигает цели ${s.targetYield}% — откройте «Портфель»`;
  }
  return null;
}
