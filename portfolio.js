/**
 * portfolio.js — Вкладка «Портфель»
 *
 * ИСПРАВЛЕНИЯ:
 * 1. saveAsset: нормализация запятой→точка, чёткая валидация qty/buyPrice
 * 2. _fillAssetTypeSelect: вставка полей до кнопки Сохранить (не после)
 * 3. UI: понятный дашборд с таблицей активов, диаграммой, рекомендациями
 */

import { $, fmt, state, sched, today, appConfig } from './core.js';

const esc = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ── Нормализация числа (запятая→точка, пробелы) ───────────────────────────
// ФИКС #2: пользователи вводят "884,25" или "1 000" — parseFloat не справлялся
function toNum(val) {
  if (val == null) return 0;
  const s = String(val).replace(/\s/g, '').replace(',', '.');
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

// ── Типы активов ─────────────────────────────────────────────────────────
const ASSET_TYPES = [
  { value: 'bond_fixed',    label: '📄 ОФЗ / фикс. купон' },
  { value: 'bond_floating', label: '🔄 Флоатер (перем. купон)' },
  { value: 'etf',           label: '💵 ETF / БПИФ (денежный)' },
  { value: 'stock',         label: '📈 Акция' },
  { value: 'cash',          label: '💴 Кэш / депозит' },
  { value: 'currency',      label: '💶 Валюта' },
];

// ── Цвета по типу ─────────────────────────────────────────────────────────
const TYPE_COLOR = {
  bond_fixed: '#4A7C3F', bond_floating: '#5B9BD5',
  etf: '#C9A96E', stock: '#C0392B', cash: '#95a5a6', currency: '#8e44ad',
};
const TYPE_LABEL = Object.fromEntries(ASSET_TYPES.map(t => [t.value, t.label]));

// ── Стратегии ─────────────────────────────────────────────────────────────
const STRATEGIES = {
  conservative: { label: '🛡️ Консервативная', desc: 'Сохранение капитала, доходность чуть выше инфляции', maxVol: 10 },
  moderate:     { label: '⚖️ Умеренная',       desc: 'Баланс роста и защиты', maxVol: 15 },
  aggressive:   { label: '🚀 Агрессивная',     desc: 'Максимизация роста, высокий риск', maxVol: 25 },
};

// Целевые веса по стратегии и ставке
function getTarget(strategy, keyRate) {
  const high = keyRate >= 0.18;
  const low  = keyRate < 0.14;
  const targets = {
    conservative: high
      ? { etf: 0.55, bond_floating: 0.15, bond_fixed: 0.20, stock: 0.05, cash: 0.05 }
      : { etf: 0.30, bond_floating: 0.10, bond_fixed: 0.45, stock: 0.10, cash: 0.05 },
    moderate: high
      ? { etf: 0.40, bond_floating: 0.10, bond_fixed: 0.20, stock: 0.25, cash: 0.05 }
      : { etf: 0.20, bond_floating: 0.05, bond_fixed: 0.30, stock: 0.40, cash: 0.05 },
    aggressive: high
      ? { etf: 0.20, bond_floating: 0.05, bond_fixed: 0.10, stock: 0.60, cash: 0.05 }
      : { etf: 0.10, bond_floating: 0.00, bond_fixed: 0.15, stock: 0.70, cash: 0.05 },
  };
  return targets[strategy] || targets.moderate;
}

// ── Настройки ─────────────────────────────────────────────────────────────
function getSettings() {
  if (!state.D.portfolioSettings) {
    state.D.portfolioSettings = { keyRate: 0.21, monthlyCash: 10000, strategy: 'moderate', goalAmount: 0, goalYears: 5 };
  }
  return state.D.portfolioSettings;
}

// ── Главный рендер ────────────────────────────────────────────────────────
export function renderPortfolio() {
  if (!state.D) return;
  if (!state.D.portfolio) state.D.portfolio = [];

  const s = getSettings();
  const assets = state.D.portfolio;
  const total = assets.reduce((sum, a) => sum + a.qty * (a.currentPrice || a.buyPrice), 0);
  const totalCost = assets.reduce((sum, a) => sum + a.qty * a.buyPrice, 0);
  const pnl = total - totalCost;
  const pnlPct = totalCost > 0 ? Math.round(pnl / totalCost * 1000) / 10 : 0;

  // Текущие веса по типу
  const weights = {};
  for (const a of assets) {
    const t = a.assetType || 'stock';
    const v = a.qty * (a.currentPrice || a.buyPrice);
    weights[t] = (weights[t] || 0) + v;
  }
  const wPct = Object.fromEntries(Object.entries(weights).map(([k, v]) => [k, total > 0 ? v / total : 0]));

  const target = getTarget(s.strategy, s.keyRate);
  const expectedYield = _calcExpectedYield(assets, total);
  const balScore = _calcBalanceScore(wPct, target);
  const goalPct = s.goalAmount > 0 ? Math.min(Math.round(total / s.goalAmount * 100), 100) : null;
  const reqYield = (s.goalAmount > 0 && s.goalYears > 0 && total > 0)
    ? Math.round((Math.pow(s.goalAmount / total, 1 / s.goalYears) - 1) * 1000) / 10
    : null;

  _renderHeader(total, totalCost, pnl, pnlPct, expectedYield, balScore, goalPct, reqYield, s);
  _renderStrategyBar(s);
  _renderChart(wPct, target, total, assets);
  _renderRecommendations(wPct, target, s, total, assets);
  _renderTable(assets, total);
}

// ── Блок 1: Шапка ─────────────────────────────────────────────────────────
function _renderHeader(total, totalCost, pnl, pnlPct, yld, score, goalPct, reqYield, s) {
  const summaryEl = $('portfolio-summary'); if (!summaryEl) return;

  const hl = s.keyRate >= 0.18 ? '🔴 Высокая ставка' : s.keyRate >= 0.14 ? '🟡 Нейтральная' : '🟢 Низкая ставка';
  const scoreColor = score >= 70 ? 'var(--green-dark)' : score >= 40 ? 'var(--amber-dark)' : 'var(--red)';

  summaryEl.innerHTML = `
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px">

      <div style="background:var(--card);border:1.5px solid var(--border2);border-radius:10px;padding:12px 16px;flex:2;min-width:200px">
        <div style="font-size:10px;font-weight:700;color:var(--text2);letter-spacing:.5px;margin-bottom:4px">ПОРТФЕЛЬ</div>
        <div style="font-size:26px;font-weight:700;color:var(--topbar);letter-spacing:-.5px">${fmt(Math.round(total))}</div>
        <div style="font-size:12px;margin-top:4px">
          <span style="color:var(--text2)">вложено ${fmt(Math.round(totalCost))}</span>
          <span style="margin-left:10px;font-weight:700;color:${pnl >= 0 ? 'var(--green-dark)' : 'var(--red)'}">
            ${pnl >= 0 ? '+' : ''}${fmt(Math.round(pnl))} (${pnlPct >= 0 ? '+' : ''}${pnlPct}%)
          </span>
        </div>
      </div>

      <div style="background:var(--card);border:1.5px solid var(--border2);border-radius:10px;padding:12px 16px;flex:1;min-width:120px">
        <div style="font-size:10px;font-weight:700;color:var(--text2);letter-spacing:.5px;margin-bottom:4px">БАЛАНС</div>
        <div style="font-size:26px;font-weight:700;color:${scoreColor}">${score}<span style="font-size:12px;color:var(--text2)">/100</span></div>
        <div style="font-size:10px;color:${scoreColor}">${score >= 70 ? '✓ Сбалансирован' : score >= 40 ? '⚠ Проверьте' : '✗ Дисбаланс'}</div>
      </div>

      <div style="background:var(--card);border:1.5px solid var(--border2);border-radius:10px;padding:12px 16px;flex:1;min-width:120px">
        <div style="font-size:10px;font-weight:700;color:var(--text2);letter-spacing:.5px;margin-bottom:4px">ОЖ. ДОХОДНОСТЬ</div>
        <div style="font-size:26px;font-weight:700;color:var(--green-dark)">${yld}%</div>
        <div style="font-size:10px;color:var(--text2)">${hl}</div>
      </div>

      ${goalPct !== null ? `
      <div style="background:var(--card);border:1.5px solid var(--border2);border-radius:10px;padding:12px 16px;flex:1;min-width:140px">
        <div style="font-size:10px;font-weight:700;color:var(--text2);letter-spacing:.5px;margin-bottom:4px">🎯 ЦЕЛЬ</div>
        <div style="font-size:26px;font-weight:700;color:var(--amber-dark)">${goalPct}%</div>
        <div style="background:var(--g50);border-radius:3px;height:4px;margin:4px 0">
          <div style="height:4px;border-radius:3px;background:var(--amber);width:${goalPct}%"></div>
        </div>
        ${reqYield !== null ? `<div style="font-size:10px;color:${reqYield > 0 ? 'var(--text2)' : 'var(--green-dark)'}">нужно ${reqYield > 0 ? reqYield + '%/год' : 'уже достигнуто'}</div>` : ''}
      </div>` : ''}

    </div>`;
}

// ── Блок 2: Стратегия ─────────────────────────────────────────────────────
function _renderStrategyBar(s) {
  let el = $('port-strategy-bar');
  if (!el) {
    const anchor = $('portfolio-list'); if (!anchor) return;
    el = document.createElement('div'); el.id = 'port-strategy-bar';
    anchor.parentNode.insertBefore(el, anchor);
  }

  const btns = Object.entries(STRATEGIES).map(([k, v]) => {
    const active = k === s.strategy;
    return `<button onclick="window.setPortStrategy('${k}')" style="
      flex:1;padding:8px 4px;border:2px solid ${active ? 'var(--amber)' : 'var(--border)'};
      border-radius:8px;background:${active ? 'var(--amber-light)' : 'var(--bg)'};
      color:${active ? 'var(--topbar)' : 'var(--text2)'};font-size:11px;font-weight:700;cursor:pointer">${v.label}</button>`;
  }).join('');

  el.innerHTML = `
    <div style="background:var(--card);border:1.5px solid var(--border2);border-radius:10px;padding:12px 16px;margin-bottom:12px">
      <div style="font-size:11px;font-weight:700;color:var(--text2);letter-spacing:.5px;margin-bottom:8px">⚙️ ПАРАМЕТРЫ</div>
      <div style="display:flex;gap:6px;margin-bottom:10px">${btns}</div>
      <div style="font-size:11px;color:var(--text2);margin-bottom:10px">${(STRATEGIES[s.strategy] || STRATEGIES.moderate).desc}</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end">
        <div class="fg" style="margin:0;flex:1;min-width:110px">
          <label style="font-size:10px">СТАВКА ЦБ %</label>
          <input class="fi" type="number" id="port-key-rate" value="${Math.round(s.keyRate * 100)}" min="1" max="50" step="0.25" style="padding:6px 8px">
        </div>
        <div class="fg" style="margin:0;flex:1;min-width:110px">
          <label style="font-size:10px">ВЗНОС В МЕСЯЦ ₽</label>
          <input class="fi" type="number" id="port-monthly" value="${s.monthlyCash}" min="0" step="1000" style="padding:6px 8px">
        </div>
        <div class="fg" style="margin:0;flex:1;min-width:110px">
          <label style="font-size:10px">ЦЕЛЬ ₽</label>
          <input class="fi" type="number" id="port-goal" value="${s.goalAmount || 0}" min="0" step="10000" style="padding:6px 8px">
        </div>
        <div class="fg" style="margin:0;min-width:80px">
          <label style="font-size:10px">СРОК ЛЕТ</label>
          <input class="fi" type="number" id="port-years" value="${s.goalYears || 5}" min="1" max="50" style="padding:6px 8px">
        </div>
        <button class="sbtn amber" onclick="window.savePortSettings()" style="padding:8px 12px;height:36px;align-self:flex-end">Пересчитать</button>
      </div>
    </div>`;
}

// ── Блок 3: Диаграмма и распределение ────────────────────────────────────
function _renderChart(wPct, target, total, assets) {
  let el = $('port-chart-block');
  if (!el) {
    const anchor = $('portfolio-list'); if (!anchor) return;
    el = document.createElement('div'); el.id = 'port-chart-block';
    anchor.parentNode.insertBefore(el, anchor);
  }
  if (!assets.length) { el.innerHTML = ''; return; }

  const donut = _donutSvg(wPct);
  const rows = ASSET_TYPES.map(t => {
    const cur = Math.round((wPct[t.value] || 0) * 100);
    const tgt = Math.round((target[t.value] || 0) * 100);
    const dev = cur - tgt;
    const devColor = Math.abs(dev) <= 5 ? 'var(--green-dark)' : Math.abs(dev) <= 15 ? 'var(--amber-dark)' : 'var(--red)';
    const col = TYPE_COLOR[t.value] || 'var(--amber)';
    return `
      <div style="margin-bottom:8px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:3px">
          <span style="font-size:12px;font-weight:700;color:var(--topbar)">${t.label}</span>
          <div style="font-size:11px;display:flex;gap:8px;align-items:center">
            <span style="color:var(--text2)">факт <b>${cur}%</b></span>
            <span style="color:var(--text2)">цель <b>${tgt}%</b></span>
            <span style="font-weight:700;color:${devColor};min-width:30px;text-align:right">${dev > 0 ? '+' : ''}${dev}п.</span>
          </div>
        </div>
        <div style="position:relative;background:var(--g50);border-radius:4px;height:8px">
          <div style="position:absolute;height:8px;border-radius:4px;background:${col};opacity:.2;width:${tgt}%"></div>
          <div style="position:absolute;height:8px;border-radius:4px;background:${col};width:${Math.min(cur,100)}%;transition:width .3s"></div>
        </div>
      </div>`;
  }).join('');

  el.innerHTML = `
    <div style="background:var(--card);border:1.5px solid var(--border2);border-radius:10px;padding:14px 16px;margin-bottom:12px">
      <div style="font-size:11px;font-weight:700;color:var(--text2);letter-spacing:.5px;margin-bottom:12px">📊 СТРУКТУРА ПОРТФЕЛЯ</div>
      <div style="display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start">
        <div style="flex-shrink:0">${donut}</div>
        <div style="flex:1;min-width:200px">${rows}</div>
      </div>
    </div>`;
}

function _donutSvg(wPct) {
  const R = 50, r = 32, cx = 60, cy = 60;
  const data = ASSET_TYPES.map(t => ({ key: t.value, val: wPct[t.value] || 0, color: TYPE_COLOR[t.value] || '#aaa' })).filter(d => d.val > 0.01);
  if (!data.length) return '';
  let a = -Math.PI / 2;
  const paths = data.map(d => {
    const end = a + d.val * 2 * Math.PI;
    const lg = d.val > 0.5 ? 1 : 0;
    const p = `M${cx + R * Math.cos(a)},${cy + R * Math.sin(a)} A${R},${R} 0 ${lg},1 ${cx + R * Math.cos(end)},${cy + R * Math.sin(end)} L${cx + r * Math.cos(end)},${cy + r * Math.sin(end)} A${r},${r} 0 ${lg},0 ${cx + r * Math.cos(a)},${cy + r * Math.sin(a)} Z`;
    const res = `<path d="${p}" fill="${d.color}" opacity=".85" stroke="var(--bg)" stroke-width="1.5"/>`;
    a = end; return res;
  }).join('');
  const legend = data.map(d =>
    `<div style="display:flex;align-items:center;gap:4px;font-size:10px;color:var(--topbar)">
      <div style="width:8px;height:8px;border-radius:2px;background:${d.color};flex-shrink:0"></div>
      ${TYPE_LABEL[d.key]?.replace(/[📄🔄💵📈💴💶]\s?/, '') || d.key} ${Math.round(d.val * 100)}%
    </div>`).join('');
  return `<div style="display:flex;flex-direction:column;align-items:center;gap:6px">
    <svg width="120" height="120" viewBox="0 0 120 120">${paths}</svg>
    <div style="display:flex;flex-direction:column;gap:3px">${legend}</div>
  </div>`;
}

// ── Блок 4: Рекомендации ──────────────────────────────────────────────────
function _renderRecommendations(wPct, target, s, total, assets) {
  let el = $('port-recs');
  if (!el) {
    const anchor = $('portfolio-list'); if (!anchor) return;
    el = document.createElement('div'); el.id = 'port-recs';
    anchor.parentNode.insertBefore(el, anchor);
  }
  if (!assets.length) { el.innerHTML = ''; return; }

  // Рекомендации из стратегии (из файла пользователя)
  const high = s.keyRate >= 0.18;
  const recs = [];

  for (const t of ASSET_TYPES) {
    const k = t.value;
    const cur = wPct[k] || 0;
    const tgt = target[k] || 0;
    const dev = cur - tgt;
    if (dev > 0.08) {
      recs.push({ type: 'sell', group: k, dev: Math.round(dev * 100), amount: Math.round(total * dev * 0.5) });
    } else if (dev < -0.08) {
      recs.push({ type: 'buy', group: k, dev: Math.round(-dev * 100), amount: Math.round(total * (-dev) + s.monthlyCash * (-dev / Object.values(target).filter(v => v > 0).length)) });
    }
  }

  // Конкретные инструменты из документа пользователя
  const instruments = {
    bond_fixed:    { ticker: 'ОФЗ 26248', reason: high ? 'Фиксируем 14.67% YTM. При снижении ставки до 13% цена вырастет до 95–100% от номинала — двойная выгода' : 'ОФЗ 26248 — купон 12.25%, цена ~88% номинала' },
    bond_floating: { ticker: 'ОФЗ 29019', reason: 'Флоатер RUONIA+0.1% защищает при дальнейшем росте ставки' },
    etf:           { ticker: 'LQDT',      reason: high ? 'Денежный ETF ~21% годовых при текущей ставке ЦБ — лучший кэш' : 'LQDT: парковка кэша с доходностью ключевой ставки' },
    stock:         { ticker: 'TMOS / SBER', reason: 'Индексный ETF МосБиржи или Сбер с дивидендной доходностью ~12%' },
    cash:          { ticker: 'LQDT',      reason: 'Кэш лучше держать в денежном ETF — начисляется каждый день' },
  };

  if (!recs.length) {
    el.innerHTML = `
      <div style="background:var(--green-bg);border:1.5px solid rgba(74,124,63,.3);border-radius:10px;padding:12px 16px;margin-bottom:12px;font-size:13px;color:var(--green-dark);font-weight:700">
        ✅ Портфель сбалансирован по выбранной стратегии — ребалансировка не нужна
      </div>`;
    return;
  }

  const recsHtml = recs.map(rec => {
    const instr = instruments[rec.group] || { ticker: '?', reason: '' };
    const isBuy = rec.type === 'buy';
    const bg = isBuy ? 'var(--green-bg)' : 'var(--red-bg)';
    const border = isBuy ? 'rgba(74,124,63,.2)' : 'rgba(192,57,43,.2)';
    const color = isBuy ? 'var(--green-dark)' : 'var(--red)';
    const icon = isBuy ? '📈 ДОКУПИТЬ' : '📉 СОКРАТИТЬ';
    const sign = isBuy ? '+' : '−';
    return `
      <div style="background:${bg};border:1px solid ${border};border-radius:8px;padding:10px 14px;margin-bottom:8px">
        <div style="display:flex;justify-content:space-between;align-items:flex-start">
          <div style="flex:1">
            <div style="font-size:10px;font-weight:700;color:${color};letter-spacing:.5px;margin-bottom:3px">${icon} · ${TYPE_LABEL[rec.group]}</div>
            <div style="font-size:13px;font-weight:700;color:var(--topbar);margin-bottom:3px">${instr.ticker}</div>
            <div style="font-size:11px;color:var(--text2);line-height:1.4">${instr.reason}</div>
          </div>
          <div style="text-align:right;flex-shrink:0;margin-left:10px">
            <div style="font-size:14px;font-weight:700;color:${color}">${sign}${fmt(rec.amount)}</div>
            <div style="font-size:10px;color:var(--text2)">отклонение ${rec.dev}п.п.</div>
          </div>
        </div>
      </div>`;
  }).join('');

  // Блок GPT
  const workerUrl = (appConfig?.workerUrl || '').trim();
  const gptBtn = workerUrl
    ? `<button class="btn-sec" onclick="window.explainPortfolio()" id="btn-explain-portfolio" style="font-size:12px;padding:7px 14px;margin-top:10px">🤖 Объяснить простым языком (YandexGPT)</button>`
    : `<div style="font-size:10px;color:var(--text2);margin-top:8px">Для объяснения от YandexGPT настройте URL воркера в Администраторе</div>`;

  el.innerHTML = `
    <div style="background:var(--card);border:1.5px solid var(--border2);border-radius:10px;padding:14px 16px;margin-bottom:12px">
      <div style="font-size:11px;font-weight:700;color:var(--text2);letter-spacing:.5px;margin-bottom:10px">💡 РЕКОМЕНДАЦИИ</div>
      ${recsHtml}
      ${gptBtn}
      <div id="portfolio-llm-result" style="margin-top:10px"></div>
    </div>`;
}

// ── Блок 5: Таблица активов ───────────────────────────────────────────────
function _renderTable(assets, total) {
  const el = $('portfolio-list'); if (!el) return;
  if (!assets.length) {
    el.innerHTML = `
      <div style="background:var(--card);border:1.5px solid var(--border2);border-radius:10px;padding:20px;text-align:center;color:var(--text2)">
        <div style="font-size:28px;margin-bottom:8px">📋</div>
        <div style="font-size:14px;font-weight:700;color:var(--topbar);margin-bottom:6px">Портфель пуст</div>
        <div style="font-size:12px">Добавьте первую ценную бумагу кнопкой «+ Добавить актив»</div>
      </div>`;
    return;
  }

  el.innerHTML = `
    <div style="background:var(--card);border:1.5px solid var(--border2);border-radius:10px;overflow:hidden;margin-bottom:12px">
      <div style="font-size:11px;font-weight:700;color:var(--text2);letter-spacing:.5px;padding:12px 16px;border-bottom:1px solid var(--border)">📋 МОИ АКТИВЫ</div>
      <div style="overflow-x:auto">
        <table style="width:100%;border-collapse:collapse;font-size:12px;min-width:580px">
          <thead>
            <tr style="background:var(--amber-light);text-align:left">
              <th style="padding:8px 12px;font-size:10px;font-weight:700;color:var(--text2);letter-spacing:.5px">АКТИВ</th>
              <th style="padding:8px 12px;font-size:10px;font-weight:700;color:var(--text2);letter-spacing:.5px;text-align:right">КОЛ.</th>
              <th style="padding:8px 12px;font-size:10px;font-weight:700;color:var(--text2);letter-spacing:.5px;text-align:right">ЦЕНА</th>
              <th style="padding:8px 12px;font-size:10px;font-weight:700;color:var(--text2);letter-spacing:.5px;text-align:right">СТОИМОСТЬ</th>
              <th style="padding:8px 12px;font-size:10px;font-weight:700;color:var(--text2);letter-spacing:.5px;text-align:right">П/У</th>
              <th style="padding:8px 12px;font-size:10px;font-weight:700;color:var(--text2);letter-spacing:.5px;text-align:right">ДОЛЯ</th>
              <th style="padding:8px 12px;font-size:10px;font-weight:700;color:var(--text2);letter-spacing:.5px;text-align:center">ДЕЙСТВИЯ</th>
            </tr>
          </thead>
          <tbody>
            ${assets.map((a, i) => _assetRow(a, i, total)).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
}

function _assetRow(a, i, total) {
  const curPrice = a.currentPrice || a.buyPrice;
  const curVal = a.qty * curPrice;
  const cost = a.qty * a.buyPrice;
  const pnl = curVal - cost;
  const pnlPct = cost > 0 ? Math.round(pnl / cost * 1000) / 10 : 0;
  const share = total > 0 ? Math.round(curVal / total * 100) : 0;
  const color = pnl >= 0 ? 'var(--green-dark)' : 'var(--red)';
  const daysSince = a.lastUpdated ? Math.floor((Date.now() - new Date(a.lastUpdated + 'T12:00:00')) / 864e5) : 999;
  const stale = daysSince >= 14;
  const typeColor = TYPE_COLOR[a.assetType] || 'var(--amber)';

  return `<tr style="border-bottom:.5px solid var(--border);${stale ? 'opacity:.7' : ''}">
    <td style="padding:9px 12px">
      <div style="display:flex;align-items:center;gap:6px">
        <div style="width:3px;height:32px;border-radius:2px;background:${typeColor};flex-shrink:0"></div>
        <div>
          <div style="font-weight:700;color:var(--topbar)">${esc(a.ticker)}</div>
          <div style="font-size:10px;color:var(--text2)">${esc(a.name || (TYPE_LABEL[a.assetType] || '')?.replace(/[📄🔄💵📈💴💶]\s?/, ''))}</div>
          ${stale ? `<div style="font-size:9px;color:var(--orange-dark)">⏰ цена ${daysSince}д назад</div>` : ''}
        </div>
      </div>
    </td>
    <td style="padding:9px 12px;text-align:right;color:var(--topbar)">${a.qty}</td>
    <td style="padding:9px 12px;text-align:right">
      <div style="color:var(--topbar)">${fmt(curPrice)}</div>
      <div style="font-size:10px;color:var(--text2)">вх. ${fmt(a.buyPrice)}</div>
    </td>
    <td style="padding:9px 12px;text-align:right;font-weight:700;color:var(--topbar)">${fmt(Math.round(curVal))}</td>
    <td style="padding:9px 12px;text-align:right">
      <div style="font-weight:700;color:${color}">${pnl >= 0 ? '+' : ''}${fmt(Math.round(pnl))}</div>
      <div style="font-size:10px;color:${color}">${pnlPct >= 0 ? '+' : ''}${pnlPct}%</div>
    </td>
    <td style="padding:9px 12px;text-align:right">
      <div style="font-weight:700;color:var(--topbar)">${share}%</div>
      <div style="background:var(--g50);border-radius:2px;height:3px;margin-top:3px;width:50px;margin-left:auto">
        <div style="height:3px;border-radius:2px;background:${typeColor};width:${Math.min(share * 2, 100)}%"></div>
      </div>
    </td>
    <td style="padding:9px 12px;text-align:center">
      <div style="display:flex;gap:4px;justify-content:center;flex-wrap:wrap">
        <button class="sbtn blue" onclick="window.editAsset(${i})" style="font-size:10px;padding:3px 7px">✎</button>
        <button class="sbtn amber" onclick="window.updateAssetPrice(${i})" style="font-size:10px;padding:3px 7px">₽</button>
        <button class="sbtn red" onclick="window.deleteAsset(${i})" style="font-size:10px;padding:3px 7px">✕</button>
      </div>
    </td>
  </tr>`;
}

// ── Хелперы ───────────────────────────────────────────────────────────────
function _calcExpectedYield(assets, total) {
  const def = { bond_fixed: 14, bond_floating: 21, etf: 19, stock: 15, cash: 21, currency: 3 };
  let w = 0;
  for (const a of assets) {
    const v = a.qty * (a.currentPrice || a.buyPrice);
    const y = (a.yieldPct > 0) ? a.yieldPct : (def[a.assetType] || 10);
    w += (total > 0 ? v / total : 0) * y;
  }
  return Math.round(w * 10) / 10;
}

function _calcBalanceScore(wPct, target) {
  const dev = Object.keys(target).reduce((s, k) => s + Math.abs((wPct[k] || 0) - (target[k] || 0)), 0);
  return Math.max(0, Math.round(100 - dev * 200));
}

// ── Обработчики ───────────────────────────────────────────────────────────
window.setPortStrategy = function(key) {
  const s = getSettings(); s.strategy = key;
  state.D.portfolioSettings = s; sched(); renderPortfolio();
};

window.savePortSettings = function() {
  const kr = toNum($('port-key-rate')?.value) / 100;
  const mc = toNum($('port-monthly')?.value);
  const ga = toNum($('port-goal')?.value);
  const gy = toNum($('port-years')?.value) || 5;
  if (!kr || kr < 0.01 || kr > 0.5) { alert('Введите ставку от 1 до 50'); return; }
  const s = getSettings();
  s.keyRate = kr; s.monthlyCash = mc; s.goalAmount = ga; s.goalYears = gy;
  state.D.portfolioSettings = s; sched(); renderPortfolio();
};

window.openAddAsset = function() {
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

// ФИКС #1: вставляем доп. поля ДО кнопки «Сохранить», не после последнего input
function _fillAssetTypeSelect(assetIdx) {
  const modal = document.getElementById('modal-asset'); if (!modal) return;
  const modalBody = modal.querySelector('.modal');

  // Удаляем старые динамические поля чтобы не дублировались
  modal.querySelector('#asset-type-wrap')?.remove();
  modal.querySelector('#asset-yield-wrap')?.remove();

  // Находим кнопку «Сохранить»
  const saveBtn = modalBody.querySelector('.btn-primary');

  const typeWrap = document.createElement('div');
  typeWrap.id = 'asset-type-wrap'; typeWrap.className = 'fg';
  typeWrap.innerHTML = `
    <label>ТИП АКТИВА</label>
    <select class="fi" id="asset-type">
      ${ASSET_TYPES.map(t => `<option value="${t.value}">${t.label}</option>`).join('')}
    </select>`;

  const yieldWrap = document.createElement('div');
  yieldWrap.id = 'asset-yield-wrap'; yieldWrap.className = 'fg';
  yieldWrap.innerHTML = `<label>КУПОННАЯ ДОХОДНОСТЬ % (необяз.)</label>
    <input class="fi" type="number" id="asset-yield" placeholder="напр. 14.67 для ОФЗ26248" step="0.01" min="0" max="100">`;

  // Вставляем перед кнопкой «Сохранить»
  if (saveBtn) {
    modalBody.insertBefore(yieldWrap, saveBtn);
    modalBody.insertBefore(typeWrap, yieldWrap);
  } else {
    modalBody.appendChild(typeWrap);
    modalBody.appendChild(yieldWrap);
  }

  const sel = $('asset-type');
  if (sel) sel.value = assetIdx >= 0 ? (state.D.portfolio[assetIdx]?.assetType || 'bond_fixed') : 'bond_fixed';
  const yi = $('asset-yield');
  if (yi) yi.value = assetIdx >= 0 ? (state.D.portfolio[assetIdx]?.yieldPct ?? '') : '';
}

window.updateAssetPrice = function(i) {
  const a = state.D.portfolio[i];
  const raw = prompt(`Новая цена ${a.ticker} (сейчас: ${a.currentPrice || a.buyPrice} ₽):`);
  if (raw == null) return;
  const newPrice = toNum(raw);
  if (!newPrice || newPrice <= 0) { alert('Введите корректную цену'); return; }
  state.D.portfolio[i].currentPrice = newPrice;
  state.D.portfolio[i].lastUpdated = today();
  if (!state.D.portfolioUpdated) state.D.portfolioUpdated = {};
  state.D.portfolioUpdated.lastUpdate = today();
  sched(); renderPortfolio();
};
// Обратная совместимость — старая кнопка
window.updatePrice = window.updateAssetPrice;

// ФИКС #2: saveAsset — нормализация запятой→точка + чёткая валидация
window.saveAsset = function() {
  if (!state.D.portfolio) state.D.portfolio = [];
  const idx = +$('asset-idx').value;

  const tickerRaw = ($('asset-ticker').value || '').trim().toUpperCase();
  const qtyRaw    = $('asset-qty').value;
  const buyRaw    = $('asset-buy').value;
  const curRaw    = $('asset-cur').value;

  const qty      = toNum(qtyRaw);
  const buyPrice = toNum(buyRaw);
  const curPrice = toNum(curRaw) || buyPrice;

  // Чёткие сообщения об ошибке
  if (!tickerRaw) { alert('Введите тикер (например: SBER или OFZ26248)'); return; }
  if (qty <= 0)   { alert(`Неверное количество: "${qtyRaw}"\nВведите число, например: 20\n(используйте точку, не запятую)`); return; }
  if (buyPrice <= 0) { alert(`Неверная цена покупки: "${buyRaw}"\nВведите число, например: 884.25\n(используйте точку, не запятую)`); return; }

  const asset = {
    id: idx >= 0 ? state.D.portfolio[idx].id : ('ast' + Date.now()),
    ticker: tickerRaw,
    name: ($('asset-name').value || '').trim(),
    qty,
    buyPrice,
    currentPrice: curPrice,
    assetType: $('asset-type')?.value || 'stock',
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

// ── LLM объяснение ────────────────────────────────────────────────────────
window.explainPortfolio = async function() {
  const resultEl = $('portfolio-llm-result');
  const btn = $('btn-explain-portfolio');
  if (!resultEl) return;

  const workerUrl = (appConfig?.workerUrl || '').trim();
  if (!workerUrl) {
    resultEl.innerHTML = '<div class="notice amber" style="font-size:12px">⚠ Настройте URL воркера в Администраторе</div>';
    return;
  }

  if (btn) { btn.disabled = true; btn.textContent = '⏳ Анализирую...'; }
  resultEl.innerHTML = '<div style="color:var(--text2);font-size:12px;padding:8px 0">YandexGPT анализирует...</div>';

  const s = getSettings();
  const assets = state.D.portfolio;
  const total = assets.reduce((sum, a) => sum + a.qty * (a.currentPrice || a.buyPrice), 0);

  const systemPrompt = `Ты дружелюбный финансовый советник. Объясни простым языком без терминов.
Формат ответа (строго, без markdown):
1. Ситуация на рынке — 1 предложение.
2. Главная проблема портфеля — 1 предложение.
3. Что сделать — 2-3 конкретных шага с тикерами.
4. Как это приближает к цели — 1 предложение.
5. Главный риск — 1 предложение.
Итого до 180 слов. Только русский.`;

  const userText = `Ставка ЦБ: ${Math.round(s.keyRate * 100)}%. Стратегия: ${(STRATEGIES[s.strategy] || STRATEGIES.moderate).label}.
Портфель: ${fmt(Math.round(total))}.
Активы: ${assets.map(a => `${a.ticker} (${a.qty}шт по ${a.buyPrice}₽, тип: ${TYPE_LABEL[a.assetType]?.replace(/[📄🔄💵📈💴💶]\s?/, '') || a.assetType})`).join('; ')}.
${s.goalAmount > 0 ? `Цель: ${fmt(s.goalAmount)} за ${s.goalYears} лет.` : ''}
Из документа пользователя: рынок ждёт снижения ставки до 13% к концу 2026. Рекомендуется ОФЗ 26248 (~884₽, доходность 14.67% YTM), потенциал роста до 95-100% номинала при снижении ставки.`;

  try {
    const endpoint = workerUrl.replace(/\/?$/, '') + '/gpt';
    const headers = { 'Content-Type': 'application/json' };
    if (appConfig?.appSecret) headers['X-App-Secret'] = appConfig.appSecret;

    const resp = await fetch(endpoint, {
      method: 'POST', headers,
      body: JSON.stringify({
        completionOptions: { stream: false, temperature: 0.3, maxTokens: 400 },
        messages: [{ role: 'system', text: systemPrompt }, { role: 'user', text: userText }],
      }),
    });
    if (!resp.ok) throw new Error('Сервер ответил ' + resp.status);
    const data = await resp.json();
    const text = (data.result?.alternatives?.[0]?.message?.text || '').trim();
    if (!text) throw new Error('Пустой ответ');

    resultEl.innerHTML = `
      <div style="background:var(--amber-light);border:1.5px solid var(--border);border-radius:10px;padding:14px 16px;margin-top:4px">
        <div style="font-size:10px;font-weight:700;color:var(--text2);letter-spacing:.5px;margin-bottom:8px">🤖 ОБЪЯСНЕНИЕ YANDEXGPT</div>
        <div style="font-size:13px;color:var(--topbar);line-height:1.7">${text.replace(/\n/g, '<br>')}</div>
        <div style="font-size:10px;color:var(--text2);margin-top:10px;border-top:1px solid var(--border);padding-top:6px">⚠ Не является инвестиционной рекомендацией</div>
      </div>`;
  } catch (e) {
    resultEl.innerHTML = `<div class="notice amber" style="font-size:12px">Ошибка GPT: ${esc(e.message)}</div>`;
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🤖 Объяснить простым языком (YandexGPT)'; }
  }
};

// ── Алерт дашборда ────────────────────────────────────────────────────────
export function checkPortfolioAlert() {
  if (!state.D?.portfolio?.length) return null;
  const lu = state.D.portfolioUpdated?.lastUpdate;
  if (!lu) return 'Обновите цены в портфеле инвестиций';
  const d = Math.floor((new Date(today()) - new Date(lu)) / (1000 * 60 * 60 * 24));
  if (d >= 7) return `Цены в портфеле не обновлялись ${d} дн.`;
  return null;
}
