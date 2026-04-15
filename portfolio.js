/**
 * portfolio.js — Инвестиционный портфель
 * Макет: двухколоночный (как в PDF)
 * Левая: шапка + параметры + список активов + структура
 * Правая: рекомендации + обоснование + итоговая структура + простым языком
 *
 * ФИКСЫ:
 * - toNum(): запятая→точка, пробелы (исправляет ошибку валидации qty/buyPrice)
 * - _fillAssetTypeSelect: поля пересоздаются при каждом открытии, вставляются перед кнопкой
 */

import { $, fmt, state, sched, today, appConfig } from './core.js';

const esc = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ── Нормализация числа: "884,25" → 884.25, "1 000" → 1000 ─────────────────
function toNum(val) {
  if (val == null) return 0;
  const n = parseFloat(String(val).replace(/\s/g, '').replace(',', '.'));
  return isNaN(n) ? 0 : n;
}

// ── Типы активов ─────────────────────────────────────────────────────────
const ASSET_TYPES = [
  { value: 'bond_fixed',    label: '📄 ОФЗ / фикс. купон',          color: '#4A7C3F' },
  { value: 'bond_floating', label: '🔄 Флоатер (перем. купон)',      color: '#5B9BD5' },
  { value: 'etf',           label: '💵 ETF / БПИФ (денежный)',       color: '#C9A96E' },
  { value: 'stock',         label: '📈 Акция',                       color: '#C0392B' },
  { value: 'cash',          label: '💴 Кэш / депозит',              color: '#95a5a6' },
  { value: 'currency',      label: '💶 Валюта',                     color: '#8e44ad' },
];
const TYPE_MAP = Object.fromEntries(ASSET_TYPES.map(t => [t.value, t]));

// ── Стратегии ─────────────────────────────────────────────────────────────
const STRATEGIES = {
  conservative: {
    label: 'Консервативная',
    desc: 'Сохранение капитала, доходность чуть выше инфляции',
    target: (high) => high
      ? { bond_fixed: 0.20, bond_floating: 0.15, etf: 0.55, stock: 0.05, cash: 0.05, currency: 0 }
      : { bond_fixed: 0.45, bond_floating: 0.10, etf: 0.30, stock: 0.10, cash: 0.05, currency: 0 },
  },
  moderate: {
    label: 'Умеренная',
    desc: 'Баланс роста и защиты капитала',
    target: (high) => high
      ? { bond_fixed: 0.20, bond_floating: 0.10, etf: 0.40, stock: 0.25, cash: 0.05, currency: 0 }
      : { bond_fixed: 0.30, bond_floating: 0.05, etf: 0.20, stock: 0.40, cash: 0.05, currency: 0 },
  },
  aggressive: {
    label: 'Агрессивная',
    desc: 'Максимизация роста, высокий риск',
    target: (high) => high
      ? { bond_fixed: 0.10, bond_floating: 0.05, etf: 0.20, stock: 0.60, cash: 0.05, currency: 0 }
      : { bond_fixed: 0.15, bond_floating: 0.00, etf: 0.10, stock: 0.70, cash: 0.05, currency: 0 },
  },
};

// ── Инструменты для рекомендаций ──────────────────────────────────────────
const INSTRUMENTS = {
  bond_fixed:    { ticker: 'ОФЗ 26248', fullName: 'ОФЗ 26248 (май 2040)',         price: 884,  yieldPct: 14.67, note: 'Доходность 14.67% YTM. При снижении ставки до 13% цена вырастет до 95–100% номинала — двойная выгода: купон + рост тела.' },
  bond_floating: { ticker: 'ОФЗ 29019', fullName: 'ОФЗ 29019 (флоатер RUONIA)',   price: 990,  yieldPct: 21,   note: 'Купон = RUONIA + 0.1% ≈ 21% при текущей ставке. Защита от дальнейшего роста ставки.' },
  etf:           { ticker: 'LQDT',      fullName: 'ВТБ Ликвидность (LQDT)',        price: 1,    yieldPct: 21,   note: 'Денежный ETF — начисляет ~21% годовых ежедневно. Лучшая «парковка» кэша при высокой ставке.' },
  stock:         { ticker: 'TMOS',      fullName: 'Индекс МосБиржи (TMOS)',        price: 6,    yieldPct: 15,   note: 'Широкая диверсификация по акциям РФ. Долгосрочный рост при снижении ставки.' },
  cash:          { ticker: 'LQDT',      fullName: 'ВТБ Ликвидность (LQDT)',        price: 1,    yieldPct: 21,   note: 'Кэш выгоднее держать в денежном ETF — начисляется каждый день.' },
};

// ── Настройки ─────────────────────────────────────────────────────────────
function getSettings() {
  if (!state.D.portfolioSettings) {
    state.D.portfolioSettings = { keyRate: 0.21, monthlyCash: 10000, strategy: 'moderate', goalAmount: 0, goalYears: 5 };
  }
  // Обратная совместимость
  const s = state.D.portfolioSettings;
  if (!s.strategy) s.strategy = 'moderate';
  if (!s.keyRate)  s.keyRate  = 0.21;
  return s;
}

// ── Вычисления ────────────────────────────────────────────────────────────
function calcPortfolio(assets, s) {
  const total    = assets.reduce((sum, a) => sum + a.qty * (a.currentPrice || a.buyPrice), 0);
  const invested = assets.reduce((sum, a) => sum + a.qty * a.buyPrice, 0);
  const pnl      = total - invested;
  const pnlPct   = invested > 0 ? Math.round(pnl / invested * 1000) / 10 : 0;

  // Веса по типу
  const weights = {};
  for (const a of assets) {
    const v = a.qty * (a.currentPrice || a.buyPrice);
    weights[a.assetType || 'stock'] = (weights[a.assetType || 'stock'] || 0) + v;
  }
  const wPct = {};
  for (const k of Object.keys(weights)) wPct[k] = total > 0 ? weights[k] / total : 0;

  const high   = s.keyRate >= 0.18;
  const strat  = STRATEGIES[s.strategy] || STRATEGIES.moderate;
  const target = strat.target(high);

  // Ожидаемая доходность
  const yldDefaults = { bond_fixed: 14.67, bond_floating: 21, etf: 21, stock: 15, cash: 21, currency: 3 };
  let expYield = 0;
  for (const a of assets) {
    const v   = a.qty * (a.currentPrice || a.buyPrice);
    const w   = total > 0 ? v / total : 0;
    const y   = (a.yieldPct && a.yieldPct > 0) ? a.yieldPct : (yldDefaults[a.assetType || 'stock'] || 10);
    expYield += w * y;
  }
  expYield = Math.round(expYield * 10) / 10;

  // Отклонения и рекомендации
  const deviations = {};
  for (const k of Object.keys(target)) {
    deviations[k] = (wPct[k] || 0) - target[k];
  }

  // Счёт баланса 0-100
  const totalDev = Object.values(deviations).reduce((s, v) => s + Math.abs(v), 0);
  const score    = Math.max(0, Math.round(100 - totalDev * 200));

  // Прогресс к цели
  const goalPct    = s.goalAmount > 0 ? Math.min(Math.round(total / s.goalAmount * 100), 100) : null;
  const reqYield   = (s.goalAmount > 0 && s.goalYears > 0 && total > 0)
    ? Math.round((Math.pow(s.goalAmount / total, 1 / s.goalYears) - 1) * 1000) / 10
    : null;

  return { total, invested, pnl, pnlPct, wPct, target, deviations, expYield, score, goalPct, reqYield, high };
}

// ── Главный рендер ────────────────────────────────────────────────────────
export function renderPortfolio() {
  if (!state.D) return;
  if (!state.D.portfolio) state.D.portfolio = [];

  const s      = getSettings();
  const assets = state.D.portfolio;
  const calc   = calcPortfolio(assets, s);

  // Двухколоночный wrapper
  let wrap = $('port-two-col');
  if (!wrap) {
    const anchor = $('portfolio-list');
    if (!anchor) return;
    const parent = anchor.parentNode;

    wrap = document.createElement('div');
    wrap.id = 'port-two-col';
    wrap.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:12px;align-items:start;';
    parent.insertBefore(wrap, anchor);

    // Медиа: одна колонка на мобиле
    const style = document.createElement('style');
    style.textContent = `@media(max-width:700px){#port-two-col{grid-template-columns:1fr!important;}}`;
    document.head.appendChild(style);
  }

  wrap.innerHTML = `
    <div id="port-col-left"></div>
    <div id="port-col-right"></div>
  `;

  _renderLeft(assets, calc, s);
  _renderRight(assets, calc, s);

  // Скрываем старый portfolio-list (рендерим таблицу внутри левой колонки)
  const pl = $('portfolio-list');
  if (pl) pl.style.display = 'none';
}

// ── ЛЕВАЯ КОЛОНКА ─────────────────────────────────────────────────────────
function _renderLeft(assets, calc, s) {
  const col = $('port-col-left');
  if (!col) return;

  const high = calc.high;
  const rateLabel = high ? '🔴 Высокая ставка' : s.keyRate >= 0.14 ? '🟡 Нейтральная' : '🟢 Низкая ставка';

  // Стратегии — кнопки
  const stratBtns = Object.entries(STRATEGIES).map(([k, v]) => {
    const active = k === s.strategy;
    return `<button onclick="window.setPortStrategy('${k}')" style="
      flex:1;padding:8px 6px;border:2px solid ${active ? 'var(--amber-dark)' : 'var(--border)'};
      border-radius:8px;background:${active ? 'var(--amber)' : 'var(--bg)'};
      color:${active ? '#fff' : 'var(--text2)'};font-size:11px;font-weight:700;cursor:pointer;
      transition:.15s">${v.label}</button>`;
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
        const pColor = pnl >= 0 ? 'var(--green-dark)' : 'var(--red)';
        const daysSince = a.lastUpdated ? Math.floor((Date.now() - new Date(a.lastUpdated + 'T12:00:00')) / 864e5) : 999;
        return `
          <div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:.5px solid var(--border)">
            <div style="width:3px;height:36px;border-radius:2px;background:${tc};flex-shrink:0"></div>
            <div style="flex:1;min-width:0">
              <div style="font-size:12px;font-weight:700;color:var(--topbar)">${esc(a.ticker)}
                <span style="font-size:10px;font-weight:400;color:var(--text2)">${esc(a.name || '')}</span>
                ${daysSince >= 14 ? '<span style="font-size:9px;color:var(--orange-dark)">⏰</span>' : ''}
              </div>
              <div style="font-size:10px;color:var(--text2)">${a.qty} шт · вх. ${fmt(a.buyPrice)}</div>
            </div>
            <div style="text-align:right;flex-shrink:0">
              <div style="font-size:12px;font-weight:700;color:var(--topbar)">${fmt(Math.round(val))}</div>
              <div style="font-size:10px;color:${pColor}">${pnl >= 0 ? '+' : ''}${fmt(Math.round(pnl))} (${pnlP >= 0 ? '+' : ''}${pnlP}%)</div>
            </div>
            <div style="font-size:11px;font-weight:700;color:var(--text2);min-width:28px;text-align:right">${share}%</div>
            <div style="display:flex;gap:3px;flex-shrink:0">
              <button class="sbtn blue" onclick="window.editAsset(${i})" style="font-size:10px;padding:3px 6px">✎</button>
              <button class="sbtn amber" onclick="window.updateAssetPrice(${i})" style="font-size:10px;padding:3px 6px">₽</button>
              <button class="sbtn red" onclick="window.deleteAsset(${i})" style="font-size:10px;padding:3px 6px">✕</button>
            </div>
          </div>`;
      }).join('')
    : `<div style="color:var(--text2);font-size:13px;padding:16px;text-align:center">
        <div style="font-size:24px;margin-bottom:6px">📋</div>
        Добавьте первый актив
      </div>`;

  // Структура портфеля — полосы
  const structRows = ASSET_TYPES.map(t => {
    const cur = Math.round((calc.wPct[t.value] || 0) * 100);
    const tgt = Math.round((calc.target[t.value] || 0) * 100);
    const dev = cur - tgt;
    const devColor = Math.abs(dev) <= 5 ? 'var(--green-dark)' : Math.abs(dev) <= 15 ? 'var(--amber-dark)' : 'var(--red)';
    return `
      <div style="margin-bottom:8px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:2px">
          <div style="display:flex;align-items:center;gap:4px">
            <div style="width:8px;height:8px;border-radius:2px;background:${t.color};flex-shrink:0"></div>
            <span style="font-size:11px;color:var(--topbar)">${t.label}</span>
          </div>
          <div style="font-size:10px;display:flex;gap:6px;align-items:center">
            <span style="color:var(--text2)">факт <b style="color:var(--topbar)">${cur}%</b></span>
            <span style="color:var(--text2)">цель <b>${tgt}%</b></span>
            <span style="font-weight:700;color:${devColor};min-width:28px;text-align:right">${dev > 0 ? '+' : ''}${dev}п.</span>
          </div>
        </div>
        <div style="position:relative;background:var(--g50);border-radius:3px;height:6px">
          <div style="position:absolute;height:6px;border-radius:3px;background:${t.color};opacity:.2;width:${tgt}%"></div>
          <div style="position:absolute;height:6px;border-radius:3px;background:${t.color};width:${Math.min(cur, 100)}%;transition:width .3s"></div>
        </div>
      </div>`;
  }).join('');

  // SVG пончик
  const donutHtml = total > 0 ? _donutSvg(calc.wPct) : '';

  col.innerHTML = `
    <!-- Шапка -->
    <div style="background:var(--card);border:1.5px solid var(--border2);border-radius:12px;padding:16px;margin-bottom:10px">
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <div style="flex:1;min-width:150px">
          <div style="font-size:11px;color:var(--text2);font-weight:700;letter-spacing:.5px;margin-bottom:2px">ПОРТФЕЛЬ</div>
          <div style="font-size:26px;font-weight:700;color:var(--topbar);letter-spacing:-.5px">₽ ${Math.round(calc.total).toLocaleString('ru-RU')}</div>
          <div style="font-size:11px;color:var(--text2);margin-top:3px">
            Вложено ₽ ${Math.round(calc.invested).toLocaleString('ru-RU')}
            <span style="margin-left:6px;font-weight:700;color:${calc.pnl >= 0 ? 'var(--green-dark)' : 'var(--red)'}">
              ${calc.pnl >= 0 ? '+' : ''}₽ ${Math.round(calc.pnl).toLocaleString('ru-RU')} (${calc.pnlPct >= 0 ? '+' : ''}${calc.pnlPct}%)
            </span>
          </div>
        </div>
        <div style="flex:1;min-width:120px">
          <div style="font-size:11px;color:var(--text2);font-weight:700;letter-spacing:.5px;margin-bottom:2px">ЦЕЛЕВАЯ ДОХОДНОСТЬ</div>
          <div style="font-size:26px;font-weight:700;color:var(--green-dark)">${calc.expYield}%</div>
          <div style="font-size:11px;color:var(--text2)">В год · ${rateLabel}</div>
        </div>
        ${calc.goalPct !== null ? `
        <div style="flex:1;min-width:110px">
          <div style="font-size:11px;color:var(--text2);font-weight:700;letter-spacing:.5px;margin-bottom:2px">🎯 ЦЕЛЬ</div>
          <div style="font-size:22px;font-weight:700;color:var(--amber-dark)">${calc.goalPct}%</div>
          <div style="background:var(--g50);border-radius:3px;height:4px;margin:4px 0;max-width:80px">
            <div style="height:4px;border-radius:3px;background:var(--amber);width:${calc.goalPct}%"></div>
          </div>
          ${calc.reqYield !== null ? `<div style="font-size:10px;color:var(--text2)">нужно ${calc.reqYield}%/год</div>` : ''}
        </div>` : ''}
      </div>
    </div>

    <!-- Параметры -->
    <div style="background:var(--card);border:1.5px solid var(--border2);border-radius:12px;padding:14px;margin-bottom:10px">
      <div style="font-size:11px;font-weight:700;color:var(--text2);letter-spacing:.5px;margin-bottom:8px">ПАРАМЕТРЫ</div>
      <div style="display:flex;gap:6px;margin-bottom:8px">${stratBtns}</div>
      <div style="font-size:11px;color:var(--text2);padding:6px 8px;background:var(--amber-light);border-radius:6px;margin-bottom:10px">
        ${(STRATEGIES[s.strategy] || STRATEGIES.moderate).desc}
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end">
        <div style="display:flex;flex-direction:column;gap:2px;flex:1;min-width:110px">
          <div style="font-size:10px;font-weight:700;color:var(--text2);letter-spacing:.3px">БЛИЖАЙШИЙ ВЗНОС ₽</div>
          <input class="fi" type="number" id="port-monthly" value="${s.monthlyCash}" min="0" step="1000" style="padding:7px 10px;font-size:14px;font-weight:700">
        </div>
        <div style="display:flex;flex-direction:column;gap:2px;flex:1;min-width:90px">
          <div style="font-size:10px;font-weight:700;color:var(--text2);letter-spacing:.3px">ТЕКУЩАЯ СТАВКА ЦБ</div>
          <div style="display:flex;align-items:center;gap:6px">
            <input class="fi" type="number" id="port-key-rate" value="${Math.round(s.keyRate * 100)}" min="1" max="50" step="0.25" style="padding:7px 10px;font-size:14px;font-weight:700;max-width:80px">
            <span style="font-size:18px;font-weight:700;color:var(--topbar)">%</span>
          </div>
        </div>
        <div style="display:flex;flex-direction:column;gap:2px;flex:1;min-width:90px">
          <div style="font-size:10px;font-weight:700;color:var(--text2);letter-spacing:.3px">ЦЕЛЬ ₽</div>
          <input class="fi" type="number" id="port-goal" value="${s.goalAmount || 0}" min="0" step="10000" style="padding:7px 10px">
        </div>
        <button class="sbtn amber" onclick="window.savePortSettings()" style="padding:9px 14px;align-self:flex-end;white-space:nowrap">Пересчитать</button>
      </div>
    </div>

    <!-- Активы в портфеле -->
    <div style="background:var(--card);border:1.5px solid var(--border2);border-radius:12px;padding:14px;margin-bottom:10px">
      <div style="font-size:11px;font-weight:700;color:var(--text2);letter-spacing:.5px;margin-bottom:8px">АКТИВЫ В ПОРТФЕЛЕ</div>
      ${assetRows}
    </div>

    <!-- Текущая структура портфеля -->
    <div style="background:var(--card);border:1.5px solid var(--border2);border-radius:12px;padding:14px">
      <div style="font-size:11px;font-weight:700;color:var(--text2);letter-spacing:.5px;margin-bottom:10px">ТЕКУЩАЯ СТРУКТУРА ПОРТФЕЛЯ</div>
      <div style="display:flex;gap:12px;align-items:flex-start;flex-wrap:wrap">
        ${donutHtml ? `<div style="flex-shrink:0">${donutHtml}</div>` : ''}
        <div style="flex:1;min-width:160px">${structRows}</div>
      </div>
    </div>
  `;
}

// ── ПРАВАЯ КОЛОНКА ────────────────────────────────────────────────────────
function _renderRight(assets, calc, s) {
  const col = $('port-col-right');
  if (!col) return;

  // Генерируем рекомендации
  const recs = _buildRecs(calc, s);

  const recRows = recs.length
    ? recs.map(r => {
        const isBuy = r.action === 'buy';
        const isSell = r.action === 'sell';
        const bg    = isBuy  ? '#E8F5E9' : isSell ? '#FFEBEE' : 'var(--amber-light)';
        const color = isBuy  ? 'var(--green-dark)' : isSell ? 'var(--red)' : 'var(--amber-dark)';
        const label = isBuy  ? 'Купить' : isSell ? 'Продать' : 'Перераспределить';
        const qty   = r.pricePerUnit > 0 ? Math.floor(r.amount / r.pricePerUnit) : '—';
        return `
          <div style="display:grid;grid-template-columns:80px 1fr 90px 70px;gap:8px;align-items:center;
            padding:10px 12px;background:${bg};border-radius:8px;margin-bottom:6px">
            <div style="font-size:11px;font-weight:700;color:${color};text-align:center;
              padding:3px 6px;background:${isBuy ? 'rgba(74,124,63,.15)' : isSell ? 'rgba(192,57,43,.15)' : 'rgba(186,117,23,.15)'};
              border-radius:5px">${label}</div>
            <div>
              <div style="font-size:13px;font-weight:700;color:var(--topbar)">${esc(r.ticker)}</div>
              <div style="font-size:10px;color:var(--text2)">${esc(r.name)}</div>
            </div>
            <div style="font-size:12px;font-weight:700;color:var(--topbar);text-align:right">${fmt(r.amount)}</div>
            <div style="font-size:12px;color:var(--text2);text-align:right">${qty !== '—' ? qty + ' шт' : '—'}</div>
          </div>`;
      }).join('')
    : `<div style="background:var(--green-bg);border:1px solid rgba(74,124,63,.2);border-radius:8px;padding:12px;font-size:12px;color:var(--green-dark);font-weight:700">
        ✅ Портфель сбалансирован — ребалансировка не нужна
      </div>`;

  // Обоснование
  const justification = _buildJustification(calc, s, recs);

  // Итоговая структура (после рекомендаций)
  const targetStruct = _buildTargetStruct(calc);

  // GPT кнопка
  const workerConfigured = !!(appConfig?.workerUrl || '').trim();
  const gptSection = `
    <div style="background:var(--card);border:1.5px solid var(--border2);border-radius:12px;padding:14px;margin-top:10px">
      <div style="font-size:11px;font-weight:700;color:var(--text2);letter-spacing:.5px;margin-bottom:10px">ПРОСТЫМ ЯЗЫКОМ</div>
      <button id="btn-explain-portfolio" onclick="window.explainPortfolio()" style="
        width:100%;padding:10px;border:1.5px solid var(--amber);border-radius:8px;
        background:var(--amber-light);color:var(--topbar);font-size:12px;font-weight:700;cursor:pointer">
        🤖 Объяснить рекомендации (YandexGPT)
      </button>
      ${!workerConfigured ? '<div style="font-size:10px;color:var(--text2);margin-top:6px;text-align:center">Настройте URL воркера в Администраторе</div>' : ''}
      <div id="portfolio-llm-result" style="margin-top:10px"></div>
    </div>`;

  col.innerHTML = `
    <!-- Рекомендации -->
    <div style="background:var(--card);border:1.5px solid var(--border2);border-radius:12px;padding:14px;margin-bottom:10px">
      <div style="font-size:11px;font-weight:700;color:var(--text2);letter-spacing:.5px;margin-bottom:10px">РЕКОМЕНДАЦИИ</div>
      <!-- Заголовки колонок -->
      <div style="display:grid;grid-template-columns:80px 1fr 90px 70px;gap:8px;padding:0 12px 6px;border-bottom:1px solid var(--border)">
        <div style="font-size:9px;font-weight:700;color:var(--text2);letter-spacing:.5px">ДЕЙСТВИЕ</div>
        <div style="font-size:9px;font-weight:700;color:var(--text2);letter-spacing:.5px">НАИМЕНОВАНИЕ</div>
        <div style="font-size:9px;font-weight:700;color:var(--text2);letter-spacing:.5px;text-align:right">СУММА</div>
        <div style="font-size:9px;font-weight:700;color:var(--text2);letter-spacing:.5px;text-align:right">КОЛИЧЕСТВО</div>
      </div>
      <div style="margin-top:8px">${recRows}</div>
    </div>

    <!-- Обоснование -->
    <div style="background:#E8F4FD;border:1.5px solid #B3D9F0;border-radius:12px;padding:14px;margin-bottom:10px">
      <div style="font-size:11px;font-weight:700;color:#1A6B9A;letter-spacing:.5px;margin-bottom:8px">ОБОСНОВАНИЕ</div>
      <div style="font-size:12px;color:var(--topbar);line-height:1.7">${justification}</div>
    </div>

    <!-- Итоговая структура -->
    <div style="background:var(--card);border:1.5px solid var(--border2);border-radius:12px;padding:14px">
      <div style="font-size:11px;font-weight:700;color:var(--text2);letter-spacing:.5px;margin-bottom:10px">ИТОГОВАЯ СТРУКТУРА ПОРТФЕЛЯ</div>
      ${targetStruct}
    </div>

    ${gptSection}
  `;
}

// ── Построение рекомендаций ───────────────────────────────────────────────
function _buildRecs(calc, s) {
  const recs   = [];
  const monthlyCash = s.monthlyCash || 0;

  // Считаем дефицит/избыток по суммам
  const deficits  = {};
  const surpluses = {};
  let   totalDef  = 0;

  for (const [k, dev] of Object.entries(calc.deviations)) {
    if (dev < -0.05) { deficits[k]  = Math.abs(dev); totalDef += Math.abs(dev); }
    if (dev > 0.10)  { surpluses[k] = dev; }
  }

  // Продать — при избытке > 10%
  for (const [k, dev] of Object.entries(surpluses)) {
    const instr = INSTRUMENTS[k] || INSTRUMENTS.etf;
    const valInGroup = calc.total * (calc.wPct[k] || 0);
    const sellAmt = Math.round(valInGroup * Math.min(dev / 2, 0.25));
    if (sellAmt > 500) {
      recs.push({
        action: 'sell',
        ticker: instr.ticker,
        name:   instr.fullName,
        amount: sellAmt,
        pricePerUnit: instr.price,
        group: k,
      });
    }
  }

  // Купить — распределяем доступный кэш по дефицитам
  const available = (recs.reduce((s, r) => s + (r.action === 'sell' ? r.amount : 0), 0) + monthlyCash);
  if (totalDef > 0 && available > 500) {
    for (const [k, def] of Object.entries(deficits)) {
      const share = def / totalDef;
      const buyAmt = Math.round(available * share);
      if (buyAmt < 500) continue;
      const instr = INSTRUMENTS[k] || INSTRUMENTS.etf;
      recs.push({
        action: 'buy',
        ticker: instr.ticker,
        name:   instr.fullName,
        amount: buyAmt,
        pricePerUnit: instr.price,
        group: k,
      });
    }
  }

  return recs.slice(0, 5); // Максимум 5 строк
}

// ── Построение обоснования ────────────────────────────────────────────────
function _buildJustification(calc, s, recs) {
  const rate = Math.round(s.keyRate * 100);
  const high = calc.high;

  const parts = [];

  if (high) {
    parts.push(`Ставка ЦБ ${rate}% — это максимум за последние годы.`);
    parts.push(`При такой ставке денежные ETF (LQDT) дают ~${rate}% годовых почти без риска.`);
    parts.push(`ОФЗ 26248 торгуется ниже номинала (~88%) и обеспечивает доходность 14.67% YTM — плюс при снижении ставки до 13% цена вырастет до 95–100% от номинала.`);
  } else {
    parts.push(`Ставка ЦБ ${rate}% — рынок ожидает дальнейшего снижения.`);
    parts.push(`Сейчас выгодно фиксировать доходность в длинных ОФЗ с фиксированным купоном.`);
  }

  if (recs.some(r => r.group === 'stock')) {
    parts.push(`Акции (~12% дивидендная доходность у топ-эмитентов) добавляют долгосрочный потенциал роста.`);
  }

  parts.push(`Ожидаемая доходность текущей структуры: купоны ~${high ? '14–21' : '12–14'}% + дивиденды ~12% + потенциал роста тела длинных ОФЗ при снижении ставки (до +16%). В сумме — хороший шанс на 10% сверх инфляции.`);

  return parts.join(' ');
}

// ── Итоговая структура (целевые веса) ─────────────────────────────────────
function _buildTargetStruct(calc) {
  const totalTarget = Object.values(calc.target).reduce((s, v) => s + v, 0);
  return ASSET_TYPES.filter(t => (calc.target[t.value] || 0) > 0).map(t => {
    const tgt = Math.round((calc.target[t.value] || 0) * 100);
    return `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:.5px solid var(--border)">
        <div style="display:flex;align-items:center;gap:6px">
          <div style="width:8px;height:8px;border-radius:2px;background:${t.color}"></div>
          <span style="font-size:12px;color:var(--topbar)">${t.label}</span>
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          <div style="width:80px;background:var(--g50);border-radius:3px;height:5px">
            <div style="height:5px;border-radius:3px;background:${t.color};width:${tgt}%"></div>
          </div>
          <span style="font-size:12px;font-weight:700;color:var(--topbar);min-width:28px;text-align:right">${tgt}%</span>
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
    a = end;
    return res;
  }).join('');
  return `<svg width="108" height="108" viewBox="0 0 108 108">${paths}</svg>`;
}

// ── Обработчики ───────────────────────────────────────────────────────────
window.setPortStrategy = function(key) {
  const s = getSettings();
  s.strategy = key;
  state.D.portfolioSettings = s;
  sched();
  renderPortfolio();
};

window.savePortSettings = function() {
  const kr = toNum($('port-key-rate')?.value) / 100;
  const mc = toNum($('port-monthly')?.value);
  const ga = toNum($('port-goal')?.value);
  if (!kr || kr < 0.01 || kr > 0.5) { alert('Введите ставку от 1 до 50'); return; }
  const s = getSettings();
  s.keyRate = kr; s.monthlyCash = mc; s.goalAmount = ga;
  state.D.portfolioSettings = s;
  sched();
  renderPortfolio();
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
  $('asset-ticker').value = a.ticker;
  $('asset-name').value = a.name || '';
  $('asset-qty').value = a.qty;
  $('asset-buy').value = a.buyPrice;
  $('asset-cur').value = a.currentPrice || a.buyPrice;
  _fillAssetTypeSelect(i);
  document.getElementById('modal-asset').classList.add('open');
};

// ФИКС: пересоздаём поля при каждом открытии, вставляем перед кнопкой «Сохранить»
function _fillAssetTypeSelect(assetIdx) {
  const modal = document.getElementById('modal-asset');
  if (!modal) return;
  const modalBody = modal.querySelector('.modal');

  // Удаляем старые динамические поля (без дублей)
  modal.querySelector('#asset-type-wrap')?.remove();
  modal.querySelector('#asset-yield-wrap')?.remove();

  const typeWrap = document.createElement('div');
  typeWrap.id = 'asset-type-wrap';
  typeWrap.className = 'fg';
  typeWrap.innerHTML = `
    <label>ТИП АКТИВА</label>
    <select class="fi" id="asset-type">
      ${ASSET_TYPES.map(t => `<option value="${t.value}">${t.label}</option>`).join('')}
    </select>`;

  const yieldWrap = document.createElement('div');
  yieldWrap.id = 'asset-yield-wrap';
  yieldWrap.className = 'fg';
  yieldWrap.innerHTML = `
    <label>КУПОННАЯ / ДИВИДЕНДНАЯ ДОХОДНОСТЬ % (необяз.)</label>
    <input class="fi" type="number" id="asset-yield"
      placeholder="напр. 14.67 для ОФЗ26248" step="0.01" min="0" max="100">`;

  // Вставляем перед кнопкой «Сохранить»
  const saveBtn = modalBody?.querySelector('.btn-primary');
  if (saveBtn) {
    modalBody.insertBefore(yieldWrap, saveBtn);
    modalBody.insertBefore(typeWrap, yieldWrap);
  } else {
    modalBody?.appendChild(typeWrap);
    modalBody?.appendChild(yieldWrap);
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
  sched();
  renderPortfolio();
};
// Обратная совместимость
window.updatePrice = window.updateAssetPrice;

// ФИКС: toNum() нормализует запятую и пробелы
window.saveAsset = function() {
  if (!state.D.portfolio) state.D.portfolio = [];
  const idx = +($('asset-idx').value || '-1');

  const tickerRaw = ($('asset-ticker').value || '').trim().toUpperCase();
  const qty       = toNum($('asset-qty').value);
  const buyPrice  = toNum($('asset-buy').value);
  const curPrice  = toNum($('asset-cur').value) || buyPrice;

  if (!tickerRaw) {
    alert('Введите тикер (например: OFZ26248 или SBER)');
    return;
  }
  if (qty <= 0) {
    alert(`Неверное количество: "${$('asset-qty').value}"\nВведите число (используйте точку вместо запятой)`);
    return;
  }
  if (buyPrice <= 0) {
    alert(`Неверная цена покупки: "${$('asset-buy').value}"\nВведите число (используйте точку вместо запятой)`);
    return;
  }

  const asset = {
    id:           idx >= 0 ? state.D.portfolio[idx].id : ('ast' + Date.now()),
    ticker:       tickerRaw,
    name:         ($('asset-name').value || '').trim(),
    qty,
    buyPrice,
    currentPrice: curPrice,
    assetType:    $('asset-type')?.value || 'bond_fixed',
    yieldPct:     toNum($('asset-yield')?.value) || null,
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
  state.D.portfolio.splice(i, 1);
  sched();
  renderPortfolio();
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
  resultEl.innerHTML = '<div style="color:var(--text2);font-size:12px;padding:8px 0">YandexGPT анализирует портфель...</div>';

  const s      = getSettings();
  const assets = state.D.portfolio;
  const calc   = calcPortfolio(assets, s);
  const recs   = _buildRecs(calc, s);

  const systemPrompt = `Ты дружелюбный финансовый советник. Объясни простым языком без терминов.
Формат (без markdown, без звёздочек):
1. Ситуация на рынке — 1 предложение.
2. Главная проблема портфеля — 1 предложение.
3. Что сделать прямо сейчас — 2-3 конкретных шага с тикерами.
4. Как это приближает к цели — 1 предложение.
5. Главный риск — 1 предложение.
До 180 слов. Только русский язык.`;

  const userText = `Ставка ЦБ: ${Math.round(s.keyRate * 100)}%.
Стратегия: ${(STRATEGIES[s.strategy] || STRATEGIES.moderate).label}.
Портфель: ₽${Math.round(calc.total).toLocaleString('ru-RU')}, ожид. доходность ${calc.expYield}%, балансировка ${calc.score}/100.
Активы: ${assets.map(a => `${a.ticker} x${a.qty} (${TYPE_MAP[a.assetType]?.label || a.assetType})`).join('; ') || 'пусто'}.
Отклонения от цели: ${Object.entries(calc.deviations).filter(([, v]) => Math.abs(v) > 0.05).map(([k, v]) => `${k} ${v > 0 ? '+' : ''}${Math.round(v * 100)}п.п.`).join(', ') || 'нет'}.
Рекомендации: ${recs.map(r => `${r.action === 'buy' ? 'купить' : 'продать'} ${r.ticker} на ₽${r.amount}`).join('; ') || 'ребалансировка не нужна'}.
${s.goalAmount > 0 ? `Цель: накопить ₽${s.goalAmount.toLocaleString('ru-RU')}.` : ''}`;

  try {
    const endpoint = workerUrl.replace(/\/?$/, '') + '/gpt';
    const headers  = { 'Content-Type': 'application/json' };
    if (appConfig?.appSecret) headers['X-App-Secret'] = appConfig.appSecret;

    const resp = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        completionOptions: { stream: false, temperature: 0.3, maxTokens: 400 },
        messages: [
          { role: 'system', text: systemPrompt },
          { role: 'user',   text: userText },
        ],
      }),
    });
    if (!resp.ok) throw new Error('Сервер ответил ' + resp.status);

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

// ── Алерт дашборда ────────────────────────────────────────────────────────
export function checkPortfolioAlert() {
  if (!state.D?.portfolio?.length) return null;
  const lu = state.D.portfolioUpdated?.lastUpdate;
  if (!lu) return 'Обновите цены в портфеле инвестиций';
  const d = Math.floor((new Date(today()) - new Date(lu)) / (1000 * 60 * 60 * 24));
  if (d >= 7) return `Цены в портфеле не обновлялись ${d} дн.`;
  return null;
}
