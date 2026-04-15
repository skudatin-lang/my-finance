/**
 * portfolio.js — Вкладка «Портфель»
 *
 * Блоки:
 * 1. Шапка: стоимость, П/У, прогресс к цели
 * 2. Стратегия (консервативная/умеренная/агрессивная) + параметры
 * 3. Анализ движка: распределение (диаграмма + полосы) + секторы
 * 4. Рекомендации: продать / купить / план пополнения
 * 5. Список активов с карточками
 * 6. LLM-объяснение по кнопке
 */

import { $, fmt, state, sched, today, appConfig } from './core.js';
import {
  runEngine, STRATEGIES, REGIME_LABELS, GROUP_LABELS, ASSET_TYPES, SECTORS,
} from './investment-engine.js';

const esc = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ── Получение настроек ────────────────────────────────────────────────────
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

  const settings = getSettings();
  const assets = state.D.portfolio;
  const result = runEngine(assets, settings.keyRate, settings.monthlyCash, settings.strategy, settings.goalAmount, settings.goalYears);

  _ensureEngineContainers();
  _renderSummary(result, assets);
  _renderStrategy(settings, result);
  _renderAnalysis(result);
  _renderRecommendations(result);
  _renderAssetList(assets, result.total || 0);
}

// ── Создаём контейнеры, если их нет ──────────────────────────────────────
function _ensureEngineContainers() {
  const anchor = $('portfolio-list'); if (!anchor) return;
  const parent = anchor.parentNode;
  const ids = ['port-summary-ext', 'port-strategy', 'port-analysis', 'port-recommendations'];
  ids.forEach(id => {
    if (!$(id)) {
      const div = document.createElement('div');
      div.id = id;
      parent.insertBefore(div, anchor);
    }
  });
}

// ── 1. Шапка ─────────────────────────────────────────────────────────────
function _renderSummary(result, assets) {
  const summaryEl = $('portfolio-summary');
  const extEl = $('port-summary-ext');
  if (!summaryEl) return;

  const total = result.total || 0;
  const totalCost = assets.reduce((s, a) => s + a.qty * a.buyPrice, 0);
  const totalPnl = total - totalCost;
  const pnlPct = totalCost > 0 ? Math.round(totalPnl / totalCost * 1000) / 10 : 0;
  const ri = REGIME_LABELS[result.regime || 'neutral'];

  summaryEl.innerHTML = `
    <div class="bal-grid">
      <div class="bal-item">
        <div class="bal-lbl">СТОИМОСТЬ</div>
        <div class="bal-val">${fmt(Math.round(total))}</div>
      </div>
      <div class="bal-item">
        <div class="bal-lbl">ВЛОЖЕНО</div>
        <div class="bal-val">${fmt(Math.round(totalCost))}</div>
      </div>
      <div class="bal-item ${totalPnl >= 0 ? 'green' : 'red'}">
        <div class="bal-lbl">ПРИБЫЛЬ / УБЫТОК</div>
        <div class="bal-val ${totalPnl >= 0 ? 'pos' : 'neg'}">${totalPnl >= 0 ? '+' : ''}${fmt(Math.round(totalPnl))}</div>
      </div>
      <div class="bal-item ${totalPnl >= 0 ? 'green' : 'red'}">
        <div class="bal-lbl">ДОХОДНОСТЬ</div>
        <div class="bal-val ${totalPnl >= 0 ? 'pos' : 'neg'}">${pnlPct >= 0 ? '+' : ''}${pnlPct}%</div>
      </div>
    </div>`;

  if (!extEl) return;
  const gp = result.goalProgress;
  const goalBlock = gp ? `
    <div style="background:var(--card);border:1.5px solid var(--border2);border-radius:10px;padding:12px 14px;flex:1;min-width:200px">
      <div style="font-size:10px;font-weight:700;color:var(--text2);letter-spacing:.5px;margin-bottom:6px">🎯 ПРОГРЕСС К ЦЕЛИ</div>
      <div style="font-size:18px;font-weight:700;color:var(--topbar)">${gp.progressPct}%</div>
      <div style="font-size:11px;color:var(--text2);margin:4px 0">${fmt(Math.round(total))} из ${fmt(gp.goalAmount)}</div>
      <div style="background:var(--g50);border-radius:3px;height:6px;margin:5px 0">
        <div style="height:6px;border-radius:3px;background:var(--amber);width:${gp.progressPct}%"></div>
      </div>
      ${gp.requiredYield !== null ? `<div style="font-size:10px;color:var(--text2)">Нужная доходность: <b style="color:${gp.requiredYield > result.expectedYield ? 'var(--red)' : 'var(--green-dark)'}">${gp.requiredYield}% / год</b></div>` : ''}
    </div>` : '';

  extEl.innerHTML = `
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px">
      <div style="background:var(--card);border:1.5px solid var(--border2);border-radius:10px;padding:12px 14px;display:flex;align-items:center;gap:10px;flex:1;min-width:200px">
        <span style="font-size:22px">${ri.icon}</span>
        <div>
          <div style="font-size:10px;font-weight:700;color:var(--text2);letter-spacing:.5px">РЕЖИМ РЫНКА</div>
          <div style="font-size:13px;font-weight:700;color:${ri.color}">${ri.label}</div>
          <div style="font-size:10px;color:var(--text2);line-height:1.4;max-width:220px">${ri.desc}</div>
        </div>
      </div>
      ${!result.empty ? `
      <div style="background:var(--card);border:1.5px solid var(--border2);border-radius:10px;padding:12px 14px;flex:1;min-width:120px">
        <div style="font-size:10px;font-weight:700;color:var(--text2);letter-spacing:.5px;margin-bottom:4px">БАЛАНСИРОВКА</div>
        <div style="font-size:24px;font-weight:700;color:${result.strategyScore >= 70 ? 'var(--green-dark)' : result.strategyScore >= 40 ? 'var(--amber-dark)' : 'var(--red)'}">
          ${result.strategyScore}<span style="font-size:12px;color:var(--text2)">/100</span>
        </div>
        <div style="font-size:10px;color:var(--text2);margin-top:2px">${result.strategyScore >= 70 ? 'Сбалансирован' : result.strategyScore >= 40 ? 'Требует внимания' : 'Дисбаланс'}</div>
      </div>
      <div style="background:var(--card);border:1.5px solid var(--border2);border-radius:10px;padding:12px 14px;flex:1;min-width:120px">
        <div style="font-size:10px;font-weight:700;color:var(--text2);letter-spacing:.5px;margin-bottom:4px">ОЖ. ДОХОДНОСТЬ</div>
        <div style="font-size:24px;font-weight:700;color:var(--green-dark)">${result.expectedYield}%</div>
        <div style="font-size:10px;color:var(--text2);margin-top:2px">годовых</div>
      </div>
      <div style="background:var(--card);border:1.5px solid var(--border2);border-radius:10px;padding:12px 14px;flex:1;min-width:120px">
        <div style="font-size:10px;font-weight:700;color:var(--text2);letter-spacing:.5px;margin-bottom:4px">ВОЛАТИЛЬНОСТЬ</div>
        <div style="font-size:24px;font-weight:700;color:${result.volatilityOk ? 'var(--green-dark)' : 'var(--red)'}">~${result.approxVolatility}%</div>
        <div style="font-size:10px;color:${result.volatilityOk ? 'var(--green-dark)' : 'var(--red)'};margin-top:2px">${result.volatilityOk ? '✓ В норме' : '⚠ Выше нормы'}</div>
      </div>` : ''}
      ${goalBlock}
    </div>`;
}

// ── 2. Стратегия и параметры ──────────────────────────────────────────────
function _renderStrategy(settings, result) {
  const el = $('port-strategy'); if (!el) return;

  const stratBtns = Object.entries(STRATEGIES).map(([key, s]) => {
    const active = key === settings.strategy;
    return `<button onclick="window.setPortfolioStrategy('${key}')" style="
      flex:1;padding:8px 6px;border:2px solid ${active ? s.color : 'var(--border)'};
      border-radius:8px;background:${active ? 'var(--amber-light)' : 'var(--bg)'};
      cursor:pointer;font-size:11px;font-weight:700;color:${active ? s.color : 'var(--text2)'};
      transition:.15s">${s.icon} ${s.label}</button>`;
  }).join('');

  el.innerHTML = `
    <div style="background:var(--card);border:1.5px solid var(--border2);border-radius:10px;padding:14px 16px;margin-bottom:12px">
      <div style="font-size:11px;font-weight:700;color:var(--text2);letter-spacing:.5px;margin-bottom:10px">⚙️ ПАРАМЕТРЫ АНАЛИЗА</div>
      <div style="display:flex;gap:8px;margin-bottom:12px">${stratBtns}</div>
      <div style="font-size:11px;color:var(--text2);margin-bottom:10px;padding:7px 10px;background:var(--amber-light);border-radius:6px">
        ${(STRATEGIES[settings.strategy] || STRATEGIES.moderate).desc}
        ${result.strategyData ? ` Допустимая волатильность: <b>до ${result.strategyData.maxVolatility * 100}% / год</b>.` : ''}
      </div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end">
        <div class="fg" style="margin:0;flex:1;min-width:130px">
          <label style="font-size:10px">КЛЮЧЕВАЯ СТАВКА ЦБ %</label>
          <input class="fi" type="number" id="eng-key-rate" value="${Math.round(settings.keyRate * 100)}" min="1" max="50" step="0.25" style="padding:6px 8px">
        </div>
        <div class="fg" style="margin:0;flex:1;min-width:130px">
          <label style="font-size:10px">ЕЖЕМЕСЯЧНЫЙ ВЗНОС ₽</label>
          <input class="fi" type="number" id="eng-monthly" value="${settings.monthlyCash}" min="0" step="1000" style="padding:6px 8px">
        </div>
        <div class="fg" style="margin:0;flex:1;min-width:130px">
          <label style="font-size:10px">ЦЕЛЬ ₽ (0 = не задана)</label>
          <input class="fi" type="number" id="eng-goal-amount" value="${settings.goalAmount || 0}" min="0" step="100000" style="padding:6px 8px">
        </div>
        <div class="fg" style="margin:0;flex:1;min-width:100px">
          <label style="font-size:10px">СРОК (ЛЕТ)</label>
          <input class="fi" type="number" id="eng-goal-years" value="${settings.goalYears || 5}" min="1" max="50" style="padding:6px 8px">
        </div>
        <button class="sbtn amber" onclick="window.saveEngineSettings()" style="padding:8px 14px;height:36px;align-self:flex-end">Пересчитать</button>
      </div>
    </div>`;
}

// ── 3. Анализ: распределение + сектора ────────────────────────────────────
function _renderAnalysis(result) {
  const el = $('port-analysis'); if (!el) return;
  if (result.empty) { el.innerHTML = ''; return; }

  const { weights, target, deviations, sectorWeights, sectorWarnings } = result;

  // SVG диаграмма пончик
  const donutSvg = _buildDonut(weights);

  // Полосы распределения
  const allocBars = Object.entries(GROUP_LABELS).map(([k, g]) => {
    const cur = Math.round((weights[k] || 0) * 100);
    const tgt = Math.round((target[k] || 0) * 100);
    const dev = deviations[k] || 0;
    const devSign = dev > 0 ? '+' : '';
    const devColor = Math.abs(dev) < 0.05 ? 'var(--green-dark)' : Math.abs(dev) < 0.10 ? 'var(--amber-dark)' : 'var(--red)';
    return `
      <div style="margin-bottom:9px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:3px">
          <span style="font-size:12px;font-weight:700;color:var(--topbar)">${g.icon} ${g.label}</span>
          <div style="display:flex;gap:8px;font-size:11px;align-items:center">
            <span style="color:var(--text2)">факт <b style="color:var(--topbar)">${cur}%</b></span>
            <span style="color:var(--text2)">цель <b>${tgt}%</b></span>
            <span style="font-weight:700;color:${devColor};min-width:32px;text-align:right">${devSign}${Math.round(dev * 100)}п.п.</span>
          </div>
        </div>
        <div style="position:relative;background:var(--g50);border-radius:4px;height:8px">
          <div style="position:absolute;height:8px;border-radius:4px;background:${g.color};opacity:.25;width:${tgt}%"></div>
          <div style="position:absolute;height:8px;border-radius:4px;background:${devColor};width:${Math.min(cur, 100)}%;transition:width .3s"></div>
        </div>
      </div>`;
  }).join('');

  // Сектора
  const sectorBars = Object.entries(sectorWeights).slice(0, 8).map(([sector, v]) => {
    const warn = v.pct > 35;
    return `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;border-bottom:.5px solid var(--border)">
        <span style="font-size:12px;color:var(--topbar)">${sector}</span>
        <div style="display:flex;align-items:center;gap:8px">
          <div style="width:80px;background:var(--g50);border-radius:3px;height:5px">
            <div style="height:5px;border-radius:3px;background:${warn ? 'var(--red)' : 'var(--amber)'};width:${Math.min(v.pct, 100)}%"></div>
          </div>
          <span style="font-size:12px;font-weight:700;color:${warn ? 'var(--red)' : 'var(--topbar)'};min-width:28px;text-align:right">${v.pct}%</span>
        </div>
      </div>`;
  }).join('');

  const warningsHtml = sectorWarnings.length
    ? sectorWarnings.map(w => `<div class="notice amber" style="font-size:11px;margin-bottom:5px">⚠ ${esc(w)}</div>`).join('')
    : '';

  el.innerHTML = `
    <div style="background:var(--card);border:1.5px solid var(--border2);border-radius:10px;padding:14px 16px;margin-bottom:12px">
      <div style="font-size:11px;font-weight:700;color:var(--text2);letter-spacing:.5px;margin-bottom:12px">📊 АНАЛИЗ РАСПРЕДЕЛЕНИЯ</div>
      ${warningsHtml}
      <div style="display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start">
        <div style="flex-shrink:0">${donutSvg}</div>
        <div style="flex:1;min-width:200px">${allocBars}</div>
      </div>
      <div style="margin-top:14px">
        <div style="font-size:11px;font-weight:700;color:var(--text2);letter-spacing:.5px;margin-bottom:8px">РАСПРЕДЕЛЕНИЕ ПО СЕКТОРАМ</div>
        ${sectorBars || '<div style="font-size:12px;color:var(--text2)">Добавьте активы с известными тикерами</div>'}
      </div>
    </div>`;
}

// ── SVG-диаграмма пончик ──────────────────────────────────────────────────
function _buildDonut(weights) {
  const R = 50, r = 30, cx = 60, cy = 60;
  const colors = {
    safe: '#C9A96E', floating: '#5B9BD5', fixed: '#4A7C3F',
    stocks: '#C0392B', cash: '#95a5a6',
  };
  const data = Object.entries(GROUP_LABELS)
    .map(([k]) => ({ key: k, val: weights[k] || 0 }))
    .filter(d => d.val > 0.005);
  if (!data.length) return '';

  let startAngle = -Math.PI / 2;
  const slices = data.map(d => {
    const angle = d.val * 2 * Math.PI;
    const endAngle = startAngle + angle;
    const x1 = cx + R * Math.cos(startAngle);
    const y1 = cy + R * Math.sin(startAngle);
    const x2 = cx + R * Math.cos(endAngle);
    const y2 = cy + R * Math.sin(endAngle);
    const ix1 = cx + r * Math.cos(startAngle);
    const iy1 = cy + r * Math.sin(startAngle);
    const ix2 = cx + r * Math.cos(endAngle);
    const iy2 = cy + r * Math.sin(endAngle);
    const large = angle > Math.PI ? 1 : 0;
    const path = `M${x1},${y1} A${R},${R} 0 ${large},1 ${x2},${y2} L${ix2},${iy2} A${r},${r} 0 ${large},0 ${ix1},${iy1} Z`;
    const result = { key: d.key, path, color: colors[d.key] || '#aaa', pct: Math.round(d.val * 100) };
    startAngle = endAngle;
    return result;
  });

  const pathsHtml = slices.map(s =>
    `<path d="${s.path}" fill="${s.color}" opacity=".85" stroke="var(--bg)" stroke-width="1.5"/>`
  ).join('');

  const legendHtml = slices.map(s =>
    `<div style="display:flex;align-items:center;gap:4px;font-size:10px;color:var(--topbar)">
      <div style="width:8px;height:8px;border-radius:2px;background:${s.color};flex-shrink:0"></div>
      ${GROUP_LABELS[s.key].icon} ${s.pct}%
    </div>`
  ).join('');

  return `
    <div style="display:flex;flex-direction:column;align-items:center;gap:6px">
      <svg width="120" height="120" viewBox="0 0 120 120">${pathsHtml}</svg>
      <div style="display:flex;flex-direction:column;gap:3px">${legendHtml}</div>
    </div>`;
}

// ── 4. Рекомендации ───────────────────────────────────────────────────────
function _renderRecommendations(result) {
  const el = $('port-recommendations'); if (!el) return;
  if (result.empty) { el.innerHTML = ''; return; }

  const { actions, monthlyPlan, concentration } = result;

  const concHtml = concentration.map(c =>
    `<div class="notice amber" style="font-size:11px;margin-bottom:6px">⚠ ${esc(c.message)}</div>`
  ).join('');

  // Карточки «Продать»
  const sellHtml = actions.sell.length ? `
    <div style="margin-bottom:12px">
      <div style="font-size:11px;font-weight:700;color:var(--red);letter-spacing:.5px;margin-bottom:8px">📉 СОКРАТИТЬ ПОЗИЦИИ</div>
      ${actions.sell.map(s => `
        <div style="display:flex;justify-content:space-between;padding:9px 12px;background:var(--red-bg);border:1px solid rgba(192,57,43,.2);border-radius:8px;margin-bottom:6px;align-items:center">
          <div>
            <span style="font-size:13px;font-weight:700;color:var(--topbar)">${esc(s.ticker)}</span>
            <div style="font-size:10px;color:var(--text2);margin-top:2px">${esc(s.reason)}</div>
          </div>
          <div style="text-align:right">
            <div style="font-size:13px;font-weight:700;color:var(--red)">−${fmt(s.amount_rub)}</div>
            <div style="font-size:9px;color:var(--text2)">25% позиции</div>
          </div>
        </div>`).join('')}
    </div>` : '';

  // Карточки «Купить»
  const buyHtml = actions.buy.length ? `
    <div style="margin-bottom:12px">
      <div style="font-size:11px;font-weight:700;color:var(--green-dark);letter-spacing:.5px;margin-bottom:8px">📈 ДОКУПИТЬ</div>
      ${actions.buy.map(b => `
        <div style="background:var(--green-bg);border:1px solid rgba(74,124,63,.2);border-radius:8px;margin-bottom:8px;overflow:hidden">
          <div style="display:flex;justify-content:space-between;padding:9px 12px;align-items:center">
            <div>
              <div style="font-size:13px;font-weight:700;color:var(--topbar)">${esc(b.ticker)} <span style="font-size:11px;font-weight:400;color:var(--text2)">${esc(b.name)}</span></div>
              <div style="font-size:10px;color:var(--text2);margin-top:2px">${esc(b.reason)}</div>
            </div>
            <div style="text-align:right;flex-shrink:0;margin-left:8px">
              <div style="font-size:13px;font-weight:700;color:var(--green-dark)">+${fmt(b.amount_rub)}</div>
              <div style="font-size:9px;color:var(--green-dark)">✓ ${esc(b.confidence)}</div>
            </div>
          </div>
          ${b.alternatives?.length ? `
          <div style="padding:6px 12px 8px;border-top:1px solid rgba(74,124,63,.15)">
            <div style="font-size:10px;color:var(--text2);margin-bottom:4px">АЛЬТЕРНАТИВЫ:</div>
            <div style="display:flex;gap:6px;flex-wrap:wrap">
              ${b.alternatives.map(alt => `
                <div style="font-size:10px;background:var(--card);border:1px solid var(--border);border-radius:5px;padding:3px 7px;color:var(--topbar)">
                  <b>${esc(alt.ticker)}</b> ${alt.name ? esc(alt.name) : ''}${alt.yield_pct ? ` ~${alt.yield_pct}%` : ''}
                </div>`).join('')}
            </div>
          </div>` : ''}
        </div>`).join('')}
    </div>` : '';

  // Ежемесячный план
  const planHtml = monthlyPlan.length ? `
    <div style="margin-bottom:12px">
      <div style="font-size:11px;font-weight:700;color:var(--blue);letter-spacing:.5px;margin-bottom:8px">📅 ПЛАН ПОПОЛНЕНИЯ (ЭТОТ МЕСЯЦ)</div>
      ${monthlyPlan.map(p => `
        <div style="display:flex;justify-content:space-between;padding:8px 12px;background:#E8F0FA;border-radius:8px;margin-bottom:5px;align-items:center">
          <div>
            <span style="font-size:13px;font-weight:700;color:var(--topbar)">${esc(p.ticker)}</span>
            <span style="font-size:11px;color:var(--text2);margin-left:6px">${esc(p.name)}</span>
            <div style="font-size:10px;color:var(--text2);margin-top:2px">${esc(p.reason)}</div>
          </div>
          <span style="font-size:13px;font-weight:700;color:var(--blue)">${fmt(p.amount_rub)}</span>
        </div>`).join('')}
      <div style="font-size:10px;color:var(--text2);margin-top:4px">* Тикеры — ориентиры по классу актива, не инвестиционная рекомендация</div>
    </div>` : `<div style="font-size:12px;color:var(--green-dark);padding:8px 0;margin-bottom:12px">✅ Портфель сбалансирован — ребалансировка не нужна</div>`;

  const llmBlock = `
    <div style="border-top:1px solid var(--border);padding-top:12px;margin-top:4px">
      <button class="btn-sec" onclick="window.explainPortfolio()" id="btn-explain-portfolio" style="font-size:12px;padding:8px 16px">
        🤖 Объяснить простым языком (YandexGPT)
      </button>
      <div id="portfolio-llm-result" style="margin-top:10px"></div>
    </div>`;

  el.innerHTML = `
    <div style="background:var(--card);border:1.5px solid var(--border2);border-radius:10px;padding:14px 16px;margin-bottom:12px">
      <div style="font-size:11px;font-weight:700;color:var(--text2);letter-spacing:.5px;margin-bottom:12px">💡 РЕКОМЕНДАЦИИ ДВИЖКА</div>
      ${concHtml}
      ${sellHtml}
      ${buyHtml}
      ${planHtml}
      ${llmBlock}
    </div>`;
}

// ── 5. Список активов ─────────────────────────────────────────────────────
function _renderAssetList(assets, total) {
  const el = $('portfolio-list'); if (!el) return;
  if (!assets.length) {
    el.innerHTML = '<div style="color:var(--text2);font-size:13px;padding:8px 0">Нет активов. Добавьте первую ценную бумагу.</div>';
    return;
  }
  el.innerHTML = assets.map((a, i) => _assetCard(a, i, total)).join('');
}

function _assetCard(a, i, total) {
  const curVal = a.qty * (a.currentPrice || a.buyPrice);
  const cost = a.qty * a.buyPrice;
  const pnl = curVal - cost;
  const pnlP = cost > 0 ? Math.round(pnl / cost * 1000) / 10 : 0;
  const share = total > 0 ? Math.round(curVal / total * 100) : 0;
  const color = pnl >= 0 ? 'var(--green-dark)' : 'var(--red)';
  const lastUpd = a.lastUpdated ? new Date(a.lastUpdated + 'T12:00:00').toLocaleDateString('ru-RU') : 'не обновлялась';
  const typeLbl = ASSET_TYPES.find(t => t.value === a.assetType)?.label || '⚠ Тип не задан';
  const sector = (SECTORS || {})[a.ticker?.toUpperCase()] || 'Прочее';
  const daysSince = a.lastUpdated ? Math.floor((Date.now() - new Date(a.lastUpdated + 'T12:00:00')) / 864e5) : 999;

  let rec = ''; let recColor = 'var(--text2)';
  if (daysSince >= 14) { rec = `⏰ Цена не обновлялась ${daysSince} дн.`; recColor = 'var(--orange-dark)'; }
  else if (pnlP >= 50) { rec = `🚀 +${pnlP}% — рассмотрите фиксацию части прибыли`; recColor = 'var(--green-dark)'; }
  else if (pnlP >= 20) { rec = `📈 +${pnlP}% — хорошая доходность, держите позицию`; recColor = 'var(--green-dark)'; }
  else if (pnlP >= 5)  { rec = `✅ +${pnlP}% — позиция в плюсе`; recColor = 'var(--green-dark)'; }
  else if (pnlP >= -5) { rec = `➡ ${pnlP}% — около нуля, оцените перспективы`; recColor = 'var(--amber-dark)'; }
  else if (pnlP >= -20){ rec = `⚠ ${pnlP}% — убыток, проверьте показатели компании`; recColor = 'var(--orange-dark)'; }
  else                  { rec = `🔴 ${pnlP}% — значительный убыток, рассмотрите стоп-лосс`; recColor = 'var(--red)'; }
  if (share > 40) rec += `. Доля ${share}% — диверсифицируйте.`;

  return `
    <div style="background:var(--card);border:1.5px solid var(--border2);border-radius:10px;padding:12px 14px;margin-bottom:10px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">
        <div>
          <div style="font-size:15px;font-weight:700;color:var(--topbar)">${esc(a.ticker)} <span style="font-size:12px;font-weight:400;color:var(--text2)">${esc(a.name || '')}</span></div>
          <div style="font-size:11px;color:var(--text2);margin-top:2px">${a.qty} шт. · покупка ${fmt(a.buyPrice)}/шт · цена ${fmt(a.currentPrice || a.buyPrice)}/шт</div>
          <div style="font-size:10px;margin-top:2px">
            <span style="color:var(--amber-dark)">${esc(typeLbl)}</span>
            <span style="color:var(--text2);margin-left:8px">📁 ${sector}</span>
          </div>
        </div>
        <div style="display:flex;gap:5px;flex-wrap:wrap;justify-content:flex-end">
          <button class="sbtn blue" onclick="window.editAsset(${i})">Изм.</button>
          <button class="sbtn amber" onclick="window.updatePrice(${i})">Цена</button>
          <button class="sbtn red" onclick="window.deleteAsset(${i})">✕</button>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:8px">
        <div style="background:var(--amber-light);border-radius:6px;padding:7px 9px">
          <div style="font-size:9px;color:var(--text2);font-weight:700">СТОИМОСТЬ</div>
          <div style="font-size:13px;font-weight:700;color:var(--topbar)">${fmt(Math.round(curVal))}</div>
        </div>
        <div style="background:${pnl >= 0 ? 'var(--green-bg)' : 'var(--red-bg)'};border-radius:6px;padding:7px 9px">
          <div style="font-size:9px;color:var(--text2);font-weight:700">П/У</div>
          <div style="font-size:13px;font-weight:700;color:${color}">${pnl >= 0 ? '+' : ''}${fmt(Math.round(pnl))}</div>
        </div>
        <div style="background:${pnl >= 0 ? 'var(--green-bg)' : 'var(--red-bg)'};border-radius:6px;padding:7px 9px">
          <div style="font-size:9px;color:var(--text2);font-weight:700">%</div>
          <div style="font-size:13px;font-weight:700;color:${color}">${pnlP >= 0 ? '+' : ''}${pnlP}%</div>
        </div>
        <div style="background:var(--amber-light);border-radius:6px;padding:7px 9px">
          <div style="font-size:9px;color:var(--text2);font-weight:700">ДОЛЯ</div>
          <div style="font-size:13px;font-weight:700;color:var(--topbar)">${share}%</div>
        </div>
      </div>
      <div style="background:var(--g50);border-radius:3px;height:5px;margin-bottom:6px">
        <div style="height:5px;border-radius:3px;background:var(--amber);width:${share}%"></div>
      </div>
      <div style="font-size:10px;color:var(--text2);margin-bottom:5px">Цена обновлена: ${lastUpd}</div>
      <div style="background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:7px 10px;display:flex;gap:8px;align-items:flex-start">
        <div style="font-size:11px;color:${recColor};line-height:1.5">${rec}</div>
      </div>
    </div>`;
}

// ── Обработчики кнопок ────────────────────────────────────────────────────
window.setPortfolioStrategy = function(key) {
  const s = getSettings();
  s.strategy = key;
  state.D.portfolioSettings = s;
  sched();
  renderPortfolio();
};

window.saveEngineSettings = function() {
  const keyRate = parseFloat($('eng-key-rate')?.value) / 100;
  const monthlyCash = parseFloat($('eng-monthly')?.value) || 0;
  const goalAmount = parseFloat($('eng-goal-amount')?.value) || 0;
  const goalYears = parseFloat($('eng-goal-years')?.value) || 5;
  if (!keyRate || keyRate < 0.01 || keyRate > 0.5) { alert('Введите корректную ставку (1–50%)'); return; }
  const s = getSettings();
  s.keyRate = keyRate; s.monthlyCash = monthlyCash; s.goalAmount = goalAmount; s.goalYears = goalYears;
  state.D.portfolioSettings = s;
  sched();
  renderPortfolio();
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

function _fillAssetTypeSelect(assetIdx) {
  const modal = document.getElementById('modal-asset'); if (!modal) return;
  let typeWrap = modal.querySelector('#asset-type-wrap');
  if (!typeWrap) {
    typeWrap = document.createElement('div');
    typeWrap.id = 'asset-type-wrap';
    typeWrap.className = 'fg';
    typeWrap.innerHTML = `
      <label>ТИП АКТИВА</label>
      <select class="fi" id="asset-type">
        ${ASSET_TYPES.map(t => `<option value="${t.value}">${t.label}</option>`).join('')}
      </select>`;
    const curField = modal.querySelector('#asset-cur')?.closest('.fg');
    if (curField) curField.after(typeWrap); else modal.querySelector('.modal').appendChild(typeWrap);
  }
  const sel = $('asset-type'); if (!sel) return;
  sel.value = assetIdx >= 0 ? (state.D.portfolio[assetIdx]?.assetType || 'stock') : 'stock';

  let yieldWrap = modal.querySelector('#asset-yield-wrap');
  if (!yieldWrap) {
    yieldWrap = document.createElement('div');
    yieldWrap.id = 'asset-yield-wrap';
    yieldWrap.className = 'fg';
    yieldWrap.innerHTML = `<label>КУПОННАЯ / ДИВИД. ДОХОДНОСТЬ % (необяз.)</label><input class="fi" type="number" id="asset-yield" placeholder="напр. 19 для флоатера" step="0.1" min="0" max="100">`;
    typeWrap.after(yieldWrap);
  }
  const yi = $('asset-yield');
  if (yi) yi.value = assetIdx >= 0 ? (state.D.portfolio[assetIdx]?.yieldPct ?? '') : '';
}

window.updatePrice = function(i) {
  const a = state.D.portfolio[i];
  const newPrice = parseFloat(prompt(`Текущая цена ${a.ticker} (сейчас: ${a.currentPrice || a.buyPrice} ₽):`));
  if (!newPrice || isNaN(newPrice)) return;
  state.D.portfolio[i].currentPrice = newPrice;
  state.D.portfolio[i].lastUpdated = today();
  if (!state.D.portfolioUpdated) state.D.portfolioUpdated = {};
  state.D.portfolioUpdated.lastUpdate = today();
  sched(); renderPortfolio();
};

window.saveAsset = function() {
  if (!state.D.portfolio) state.D.portfolio = [];
  const idx = +$('asset-idx').value;
  const asset = {
    id: idx >= 0 ? state.D.portfolio[idx].id : ('ast' + Date.now()),
    ticker: ($('asset-ticker').value || '').trim().toUpperCase(),
    name: ($('asset-name').value || '').trim(),
    qty: parseFloat($('asset-qty').value) || 0,
    buyPrice: parseFloat($('asset-buy').value) || 0,
    currentPrice: parseFloat($('asset-cur').value) || parseFloat($('asset-buy').value) || 0,
    assetType: $('asset-type')?.value || 'stock',
    yieldPct: parseFloat($('asset-yield')?.value) || null,
    lastUpdated: today(),
  };
  if (!asset.ticker || !asset.qty || !asset.buyPrice) { alert('Заполните тикер, количество и цену покупки'); return; }
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

// ── LLM: объяснение простым языком ───────────────────────────────────────
window.explainPortfolio = async function() {
  const resultEl = $('portfolio-llm-result');
  const btn = $('btn-explain-portfolio');
  if (!resultEl) return;

  const workerUrl = (appConfig.workerUrl || '').trim();
  if (!workerUrl) {
    resultEl.innerHTML = '<div class="notice amber" style="font-size:12px">⚠ Для работы YandexGPT настройте URL воркера в разделе «Администратор»</div>';
    return;
  }

  const settings = getSettings();
  const engineResult = runEngine(state.D.portfolio, settings.keyRate, settings.monthlyCash, settings.strategy, settings.goalAmount, settings.goalYears);
  if (engineResult.empty) { resultEl.innerHTML = '<div class="notice amber">Добавьте активы для анализа</div>'; return; }

  if (btn) { btn.disabled = true; btn.textContent = '⏳ YandexGPT анализирует...'; }
  resultEl.innerHTML = '<div style="color:var(--text2);font-size:12px;padding:8px 0">Анализирую портфель...</div>';

  const ri = REGIME_LABELS[engineResult.regime];
  const strat = STRATEGIES[settings.strategy] || STRATEGIES.moderate;
  const lmi = engineResult.llmInput;

  const systemPrompt = `Ты дружелюбный финансовый советник. Объясни рекомендации по портфелю простым языком без терминов.
Структура ответа (строго):
1) Ситуация на рынке — 1 предложение.
2) Главная проблема портфеля — 1 предложение.
3) Что рекомендуем сделать прямо сейчас — 2–3 конкретных действия с тикерами.
4) Как это поможет достичь цели — 1 предложение.
5) Главный риск — 1 предложение.
Итого не более 200 слов. Только русский язык. Без markdown, без звёздочек.`;

  const goalText = lmi.goalProgress
    ? `Цель: накопить ${fmt(lmi.goalProgress.goalAmount)} за ${lmi.goalProgress.goalYears} лет. Накоплено ${lmi.goalProgress.progressPct}%. Нужная доходность: ${lmi.goalProgress.requiredYield}% / год.`
    : 'Цель не задана.';

  const userText = `Режим рынка: ${ri.label}. Ставка ЦБ: ${Math.round(settings.keyRate * 100)}%.
Стратегия пользователя: ${strat.label}. Баланс портфеля: ${engineResult.strategyScore}/100.
Ожидаемая доходность: ${engineResult.expectedYield}%. Волатильность: ~${engineResult.approxVolatility}% (норма для стратегии: ${strat.maxVolatility * 100}%).
${goalText}

Распределение (факт → цель):
${Object.entries(GROUP_LABELS).map(([k, g]) => {
  const cur = Math.round((engineResult.weights[k] || 0) * 100);
  const tgt = Math.round((engineResult.target[k] || 0) * 100);
  return `${g.label}: ${cur}% → цель ${tgt}%`;
}).join('\n')}

${lmi.actions.sell.length ? 'Рекомендуется продать: ' + lmi.actions.sell.map(s => `${s.ticker} (${fmt(s.amount_rub)})`).join(', ') : 'Продавать ничего не нужно.'}
${lmi.actions.buy.length ? 'Рекомендуется купить: ' + lmi.actions.buy.map(b => `${b.ticker} "${b.name}" (${fmt(b.amount_rub)})`).join(', ') : ''}
${lmi.monthlyPlan.length ? 'Пополнить в этом месяце: ' + lmi.monthlyPlan.map(p => `${p.ticker} ${fmt(p.amount_rub)}`).join(', ') : ''}
${lmi.sectorWarnings.length ? 'Предупреждения: ' + lmi.sectorWarnings.join('; ') : ''}
${lmi.concentration.length ? 'Концентрация: ' + lmi.concentration.join('; ') : ''}`;

  try {
    const endpoint = workerUrl.replace(/\/?$/, '') + '/gpt';
    const headers = { 'Content-Type': 'application/json' };
    if (appConfig.appSecret) headers['X-App-Secret'] = appConfig.appSecret;

    const resp = await fetch(endpoint, {
      method: 'POST', headers,
      body: JSON.stringify({
        completionOptions: { stream: false, temperature: 0.3, maxTokens: 500 },
        messages: [{ role: 'system', text: systemPrompt }, { role: 'user', text: userText }],
      }),
    });
    if (!resp.ok) throw new Error('Сервер ответил ' + resp.status);

    const data = await resp.json();
    const text = (data.result?.alternatives?.[0]?.message?.text || '').trim();
    if (!text) throw new Error('Пустой ответ от GPT');

    resultEl.innerHTML = `
      <div style="background:var(--amber-light);border:1.5px solid var(--border);border-radius:10px;padding:14px 16px;font-size:13px;line-height:1.75;color:var(--topbar)">
        <div style="font-size:10px;font-weight:700;color:var(--text2);letter-spacing:.5px;margin-bottom:8px">🤖 ОБЪЯСНЕНИЕ YANDEXGPT</div>
        <p style="margin:0">${text.replace(/\n\n/g, '</p><p style="margin-top:8px">').replace(/\n/g, '<br>')}</p>
        <div style="font-size:10px;color:var(--text2);margin-top:10px;border-top:1px solid var(--border);padding-top:6px">
          ⚠ Это не инвестиционная рекомендация. Все решения принимайте самостоятельно.
        </div>
      </div>`;
  } catch (e) {
    resultEl.innerHTML = `<div class="notice amber" style="font-size:12px">Ошибка GPT: ${esc(e.message)}</div>`;
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🤖 Объяснить простым языком (YandexGPT)'; }
  }
};

// ── Алерт для дашборда ────────────────────────────────────────────────────
export function checkPortfolioAlert() {
  if (!state.D?.portfolio?.length) return null;
  const lastUpdate = state.D.portfolioUpdated?.lastUpdate;
  if (!lastUpdate) return 'Обновите цены в портфеле инвестиций';
  const daysSince = Math.floor((new Date(today()) - new Date(lastUpdate)) / (1000 * 60 * 60 * 24));
  if (daysSince >= 7) return `Цены в портфеле не обновлялись ${daysSince} дн.`;
  if (state.D.portfolio.length > 0) {
    const s = getSettings();
    const result = runEngine(state.D.portfolio, s.keyRate, s.monthlyCash, s.strategy, s.goalAmount, s.goalYears);
    if (!result.empty && result.strategyScore < 50) {
      return `Портфель разбалансирован (${result.strategyScore}/100) — откройте раздел «Портфель»`;
    }
  }
  return null;
}
