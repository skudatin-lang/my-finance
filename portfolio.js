/**
 * portfolio.js — Инвестиционный портфель
 *
 * Интеграция:
 * 1. При сохранении / открытии → runEngine() → результат
 * 2. Результат рисуется в UI сразу (без LLM)
 * 3. По кнопке «Объяснить» → запрос к Cloudflare Worker /gpt → YandexGPT
 * 4. Ответ LLM вставляется в блок рекомендаций (не блокирует UI)
 */

import { $, fmt, state, sched, today, appConfig } from './core.js';
import { runEngine, REGIME_LABELS, GROUP_LABELS, ASSET_TYPES } from './investment-engine.js';

const esc = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ── Настройки по умолчанию ────────────────────────────────────────────────
function getSettings() {
  if (!state.D.portfolioSettings) {
    state.D.portfolioSettings = { keyRate: 0.21, monthlyCash: 10000 };
  }
  return state.D.portfolioSettings;
}

// ── Главный рендер ────────────────────────────────────────────────────────
export function renderPortfolio() {
  if (!state.D) return;
  if (!state.D.portfolio) state.D.portfolio = [];

  const el = $('portfolio-list'); if (!el) return;
  const settings = getSettings();
  const assets = state.D.portfolio;

  // Запускаем движок
  const result = runEngine(assets, settings.keyRate, settings.monthlyCash);

  // 1. Шапка с итогами
  _renderSummary(result, settings);

  // 2. Блок настроек движка (ставка, взнос)
  _renderEngineSettings(settings);

  // 3. Рекомендации движка
  _renderEngineResult(result);

  // 4. Список активов
  if (!assets.length) {
    el.innerHTML = '<div style="color:var(--text2);font-size:13px;padding:8px 0">Нет активов. Добавьте первую ценную бумагу кнопкой выше.</div>';
    return;
  }
  const total = result.total || 0;
  el.innerHTML = assets.map((a, i) => _assetCard(a, i, total)).join('');
}

// ── Шапка ──────────────────────────────────────────────────────────────────
function _renderSummary(result, settings) {
  const summaryEl = $('portfolio-summary'); if (!summaryEl) return;
  const assets = state.D.portfolio;
  const total = result.total || 0;
  const totalCost = assets.reduce((s, a) => s + a.qty * a.buyPrice, 0);
  const totalPnl = total - totalCost;
  const pnlPct = totalCost > 0 ? Math.round(totalPnl / totalCost * 1000) / 10 : 0;
  const regime = result.regime || 'neutral';
  const ri = REGIME_LABELS[regime];

  summaryEl.innerHTML = `
    <div class="bal-grid" style="margin-bottom:10px">
      <div class="bal-item"><div class="bal-lbl">СТОИМОСТЬ</div><div class="bal-val">${fmt(Math.round(total))}</div></div>
      <div class="bal-item"><div class="bal-lbl">ВЛОЖЕНО</div><div class="bal-val">${fmt(Math.round(totalCost))}</div></div>
      <div class="bal-item ${totalPnl >= 0 ? 'green' : 'red'}">
        <div class="bal-lbl">ПРИБЫЛЬ / УБЫТОК</div>
        <div class="bal-val ${totalPnl >= 0 ? 'pos' : 'neg'}">${totalPnl >= 0 ? '+' : ''}${fmt(Math.round(totalPnl))}</div>
      </div>
      <div class="bal-item ${totalPnl >= 0 ? 'green' : 'red'}">
        <div class="bal-lbl">ДОХОДНОСТЬ</div>
        <div class="bal-val ${totalPnl >= 0 ? 'pos' : 'neg'}">${pnlPct >= 0 ? '+' : ''}${pnlPct}%</div>
      </div>
    </div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
      <div style="background:var(--card);border:1.5px solid var(--border2);border-radius:8px;padding:8px 14px;display:flex;align-items:center;gap:8px">
        <span style="font-size:20px">${ri.icon}</span>
        <div>
          <div style="font-size:10px;font-weight:700;color:var(--text2);letter-spacing:.5px">РЕЖИМ РЫНКА</div>
          <div style="font-size:13px;font-weight:700;color:${ri.color}">${ri.label}</div>
          <div style="font-size:10px;color:var(--text2);max-width:240px;line-height:1.4">${ri.desc}</div>
        </div>
      </div>
      ${!result.empty ? `
      <div style="background:var(--card);border:1.5px solid var(--border2);border-radius:8px;padding:8px 14px">
        <div style="font-size:10px;font-weight:700;color:var(--text2);letter-spacing:.5px">БАЛАНС ПОРТФЕЛЯ</div>
        <div style="font-size:20px;font-weight:700;color:${result.balanceScore >= 70 ? 'var(--green-dark)' : result.balanceScore >= 40 ? 'var(--amber-dark)' : 'var(--red)'}">
          ${result.balanceScore}<span style="font-size:12px;color:var(--text2)">/100</span>
        </div>
      </div>
      <div style="background:var(--card);border:1.5px solid var(--border2);border-radius:8px;padding:8px 14px">
        <div style="font-size:10px;font-weight:700;color:var(--text2);letter-spacing:.5px">ОЖ. ДОХОДНОСТЬ</div>
        <div style="font-size:20px;font-weight:700;color:var(--green-dark)">${result.expectedYield}%</div>
      </div>` : ''}
    </div>`;
}

// ── Блок настроек движка ──────────────────────────────────────────────────
function _renderEngineSettings(settings) {
  const id = 'portfolio-engine-settings';
  let el = $(id);
  if (!el) {
    // Вставляем сразу после summary, перед списком
    const listEl = $('portfolio-list'); if (!listEl) return;
    el = document.createElement('div');
    el.id = id;
    listEl.parentNode.insertBefore(el, listEl);
  }

  el.innerHTML = `
    <div style="background:var(--card);border:1.5px solid var(--border2);border-radius:10px;padding:12px 16px;margin-bottom:12px">
      <div style="font-size:11px;font-weight:700;color:var(--text2);letter-spacing:.5px;margin-bottom:10px">⚙️ ПАРАМЕТРЫ ДВИЖКА</div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end">
        <div class="fg" style="margin:0;flex:1;min-width:140px">
          <label style="font-size:10px">КЛЮЧЕВАЯ СТАВКА ЦБ %</label>
          <input class="fi" type="number" id="eng-key-rate" value="${Math.round(settings.keyRate * 100)}" min="1" max="50" step="0.25" style="padding:6px 8px">
        </div>
        <div class="fg" style="margin:0;flex:1;min-width:140px">
          <label style="font-size:10px">ЕЖЕМЕСЯЧНЫЙ ВЗНОС ₽</label>
          <input class="fi" type="number" id="eng-monthly" value="${settings.monthlyCash}" min="0" step="1000" style="padding:6px 8px">
        </div>
        <button class="sbtn amber" onclick="window.saveEngineSettings()" style="padding:8px 14px;height:36px">Пересчитать</button>
      </div>
    </div>`;
}

// ── Блок рекомендаций движка ──────────────────────────────────────────────
function _renderEngineResult(result) {
  const id = 'portfolio-engine-result';
  let el = $(id);
  if (!el) {
    const listEl = $('portfolio-list'); if (!listEl) return;
    el = document.createElement('div');
    el.id = id;
    listEl.parentNode.insertBefore(el, listEl);
  }

  if (result.empty) {
    el.innerHTML = '';
    return;
  }

  const { weights, target, deviations, actions, monthlyPlan, concentration } = result;

  // ── Текущее vs целевое распределение ────────────────────────────────────
  const allocHtml = Object.entries(GROUP_LABELS).map(([k, g]) => {
    const cur = Math.round((weights[k] || 0) * 100);
    const tgt = Math.round((target[k] || 0) * 100);
    const dev = deviations[k] || 0;
    const devSign = dev > 0 ? '+' : '';
    const devColor = Math.abs(dev) < 0.05 ? 'var(--green-dark)' : Math.abs(dev) < 0.10 ? 'var(--amber-dark)' : 'var(--red)';
    return `
      <div style="margin-bottom:10px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:3px">
          <span style="font-size:12px;font-weight:700;color:var(--topbar)">${g.icon} ${g.label}</span>
          <div style="display:flex;gap:8px;font-size:11px;align-items:center">
            <span style="color:var(--text2)">факт: <b style="color:var(--topbar)">${cur}%</b></span>
            <span style="color:var(--text2)">цель: <b>${tgt}%</b></span>
            <span style="font-weight:700;color:${devColor}">${devSign}${Math.round(dev * 100)} п.п.</span>
          </div>
        </div>
        <div style="position:relative;background:var(--g50);border-radius:3px;height:7px">
          <div style="position:absolute;height:7px;border-radius:3px;background:var(--amber);opacity:.4;width:${tgt}%"></div>
          <div style="position:absolute;height:7px;border-radius:3px;background:${devColor};width:${Math.min(cur, 100)}%"></div>
        </div>
      </div>`;
  }).join('');

  // ── Действия: продать ──────────────────────────────────────────────────
  const sellHtml = actions.sell.length
    ? `<div style="margin-bottom:10px">
        <div style="font-size:11px;font-weight:700;color:var(--red);letter-spacing:.5px;margin-bottom:6px">📉 РЕКОМЕНДАЦИИ К ПРОДАЖЕ</div>
        ${actions.sell.map(s => `
          <div style="display:flex;justify-content:space-between;padding:7px 10px;background:var(--red-bg);border-radius:7px;margin-bottom:5px;align-items:center">
            <div>
              <span style="font-size:13px;font-weight:700;color:var(--topbar)">${esc(s.ticker)}</span>
              <div style="font-size:10px;color:var(--text2);margin-top:1px">${esc(s.reason)}</div>
            </div>
            <span style="font-size:13px;font-weight:700;color:var(--red)">−${fmt(s.amount_rub)}</span>
          </div>`).join('')}
      </div>`
    : '';

  // ── Действия: купить ───────────────────────────────────────────────────
  const buyHtml = actions.buy.length
    ? `<div style="margin-bottom:10px">
        <div style="font-size:11px;font-weight:700;color:var(--green-dark);letter-spacing:.5px;margin-bottom:6px">📈 РЕКОМЕНДАЦИИ К ПОКУПКЕ</div>
        ${actions.buy.map(b => `
          <div style="display:flex;justify-content:space-between;padding:7px 10px;background:var(--green-bg);border-radius:7px;margin-bottom:5px;align-items:center">
            <div>
              <span style="font-size:13px;font-weight:700;color:var(--topbar)">${esc(b.ticker)}</span>
              <div style="font-size:10px;color:var(--text2);margin-top:1px">${esc(b.reason)}</div>
            </div>
            <span style="font-size:13px;font-weight:700;color:var(--green-dark)">+${fmt(b.amount_rub)}</span>
          </div>`).join('')}
      </div>`
    : '';

  // ── Ежемесячный план ───────────────────────────────────────────────────
  const planHtml = monthlyPlan.length
    ? `<div style="margin-bottom:10px">
        <div style="font-size:11px;font-weight:700;color:var(--blue);letter-spacing:.5px;margin-bottom:6px">📅 ПЛАН ПОПОЛНЕНИЯ В ЭТОМ МЕСЯЦЕ</div>
        ${monthlyPlan.map(p => `
          <div style="display:flex;justify-content:space-between;padding:7px 10px;background:var(--blue-bg, #E8F0FA);border-radius:7px;margin-bottom:5px;align-items:center">
            <div>
              <span style="font-size:13px;font-weight:700;color:var(--topbar)">${esc(p.ticker)}</span>
              <div style="font-size:10px;color:var(--text2);margin-top:1px">${esc(p.reason)}</div>
            </div>
            <span style="font-size:13px;font-weight:700;color:var(--blue)">${fmt(p.amount_rub)}</span>
          </div>`).join('')}
        <div style="font-size:10px;color:var(--text2);margin-top:4px">* Тикеры — ориентиры инструментов для данной группы активов</div>
      </div>`
    : '<div style="font-size:12px;color:var(--green-dark);padding:8px 0">✅ Портфель сбалансирован — ребалансировка не нужна</div>';

  // ── Концентрация ───────────────────────────────────────────────────────
  const concHtml = concentration.length
    ? concentration.map(c => `
        <div class="notice amber" style="margin-bottom:6px;font-size:11px">⚠ ${esc(c.message)}</div>`
      ).join('')
    : '';

  // ── Кнопка LLM ────────────────────────────────────────────────────────
  const llmBlock = `
    <div style="margin-top:12px">
      <button class="btn-sec" onclick="window.explainPortfolio()" id="btn-explain-portfolio" style="font-size:12px;padding:8px 16px">
        🤖 Объяснить рекомендации (YandexGPT)
      </button>
      <div id="portfolio-llm-result" style="margin-top:10px"></div>
    </div>`;

  el.innerHTML = `
    <div style="background:var(--card);border:1.5px solid var(--border2);border-radius:10px;padding:14px 16px;margin-bottom:12px">
      <div style="font-size:13px;font-weight:700;color:var(--topbar);margin-bottom:12px">📊 АНАЛИЗ ПОРТФЕЛЯ — ИНВЕСТ-ДВИЖОК</div>

      <div style="margin-bottom:12px">
        <div style="font-size:11px;font-weight:700;color:var(--text2);letter-spacing:.5px;margin-bottom:8px">ТЕКУЩЕЕ VS ЦЕЛЕВОЕ РАСПРЕДЕЛЕНИЕ</div>
        ${allocHtml}
      </div>

      ${concHtml}
      ${sellHtml}
      ${buyHtml}
      ${planHtml}
      ${llmBlock}
    </div>`;
}

// ── Карточка актива ───────────────────────────────────────────────────────
function _assetCard(a, i, total) {
  const curVal = a.qty * (a.currentPrice || a.buyPrice);
  const cost = a.qty * a.buyPrice;
  const pnl = curVal - cost;
  const pnlP = cost > 0 ? Math.round(pnl / cost * 1000) / 10 : 0;
  const share = total > 0 ? Math.round(curVal / total * 100) : 0;
  const color = pnl >= 0 ? 'var(--green-dark)' : 'var(--red)';
  const lastUpd = a.lastUpdated ? new Date(a.lastUpdated + 'T12:00:00').toLocaleDateString('ru-RU') : 'не обновлялась';
  const typeLbl = ASSET_TYPES.find(t => t.value === a.assetType)?.label || 'Тип не задан';

  return `<div style="background:var(--card);border:1.5px solid var(--border2);border-radius:10px;padding:12px 14px;margin-bottom:10px">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">
      <div>
        <div style="font-size:15px;font-weight:700;color:var(--topbar)">${esc(a.ticker)} <span style="font-size:12px;font-weight:400;color:var(--text2)">${esc(a.name || '')}</span></div>
        <div style="font-size:11px;color:var(--text2);margin-top:2px">${a.qty} шт. · покупка ${fmt(a.buyPrice)}/шт · цена ${fmt(a.currentPrice || a.buyPrice)}/шт</div>
        <div style="font-size:10px;color:var(--amber-dark);margin-top:2px">${esc(typeLbl)}</div>
      </div>
      <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;justify-content:flex-end">
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
        <div style="font-size:9px;color:var(--text2);font-weight:700">ДОХОДНОСТЬ</div>
        <div style="font-size:13px;font-weight:700;color:${color}">${pnlP >= 0 ? '+' : ''}${pnlP}%</div>
      </div>
      <div style="background:var(--amber-light);border-radius:6px;padding:7px 9px">
        <div style="font-size:9px;color:var(--text2);font-weight:700">ДОЛЯ</div>
        <div style="font-size:13px;font-weight:700;color:var(--topbar)">${share}%</div>
      </div>
    </div>
    <div style="background:var(--g50);border-radius:3px;height:5px;margin-bottom:4px">
      <div style="height:5px;border-radius:3px;background:var(--amber);width:${share}%"></div>
    </div>
    <div style="font-size:10px;color:var(--text2)">Цена обновлена: ${lastUpd}</div>
    ${_assetQuickRec(a, pnlP, share)}
  </div>`;
}

// ── Быстрая подсказка по активу ───────────────────────────────────────────
function _assetQuickRec(a, pnlP, share) {
  const daysSinceUpdate = a.lastUpdated
    ? Math.floor((Date.now() - new Date(a.lastUpdated + 'T12:00:00').getTime()) / 864e5)
    : 999;
  let icon = '', msg = '', color = 'var(--text2)';

  if (daysSinceUpdate >= 14) {
    icon = '⏰'; msg = `Цена не обновлялась ${daysSinceUpdate} дн. — обновите для точных расчётов`; color = 'var(--orange-dark)';
  } else if (pnlP >= 50) {
    icon = '🚀'; msg = `Отличный результат +${pnlP}%. Рассмотрите фиксацию части прибыли.`; color = 'var(--green-dark)';
  } else if (pnlP >= 20) {
    icon = '📈'; msg = `Хорошая доходность +${pnlP}%. Держите позицию, следите за новостями.`; color = 'var(--green-dark)';
  } else if (pnlP >= 5) {
    icon = '✅'; msg = `Позиция в плюсе +${pnlP}%. Продолжайте следить за динамикой.`; color = 'var(--green-dark)';
  } else if (pnlP >= -5) {
    icon = '➡'; msg = `Доходность около нуля (${pnlP}%). Оцените перспективы актива.`; color = 'var(--amber-dark)';
  } else if (pnlP >= -20) {
    icon = '⚠'; msg = `Убыток ${pnlP}%. Проверьте фундаментальные показатели.`; color = 'var(--orange-dark)';
  } else {
    icon = '🔴'; msg = `Значительный убыток ${pnlP}%. Рассмотрите стоп-лосс или усреднение.`; color = 'var(--red)';
  }
  if (share > 40) msg += ` Доля ${share}% — высокая концентрация, диверсифицируйте.`;

  return `<div style="background:var(--card);border:1px solid var(--border);border-radius:6px;padding:8px 10px;margin-top:8px;display:flex;gap:8px;align-items:flex-start">
    <span style="font-size:16px;flex-shrink:0">${icon}</span>
    <div style="font-size:11px;color:${color};line-height:1.5">${msg}</div>
  </div>`;
}

// ── Открытие модалки добавления актива ────────────────────────────────────
window.openAddAsset = function() {
  $('asset-idx').value = -1;
  $('asset-ticker').value = ''; $('asset-name').value = '';
  $('asset-qty').value = ''; $('asset-buy').value = ''; $('asset-cur').value = '';
  // Заполняем select типа актива
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
  // Проверяем наличие select типа — если нет, добавляем
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
    // Вставляем после поля asset-cur
    const curField = modal.querySelector('#asset-cur')?.closest('.fg');
    if (curField) curField.after(typeWrap);
    else modal.querySelector('.modal').appendChild(typeWrap);
  }
  const sel = $('asset-type'); if (!sel) return;
  const curType = assetIdx >= 0 ? (state.D.portfolio[assetIdx]?.assetType || 'stock') : 'stock';
  sel.value = curType;

  // Поле доходности
  let yieldWrap = modal.querySelector('#asset-yield-wrap');
  if (!yieldWrap) {
    yieldWrap = document.createElement('div');
    yieldWrap.id = 'asset-yield-wrap';
    yieldWrap.className = 'fg';
    yieldWrap.innerHTML = `<label>КУПОННАЯ / ДИВИДЕНДНАЯ ДОХОДНОСТЬ % (необяз.)</label><input class="fi" type="number" id="asset-yield" placeholder="например 19 для флоатера" step="0.1" min="0" max="100">`;
    typeWrap.after(yieldWrap);
  }
  const yieldInput = $('asset-yield');
  if (yieldInput) yieldInput.value = assetIdx >= 0 ? (state.D.portfolio[assetIdx]?.yieldPct ?? '') : '';
}

window.updatePrice = function(i) {
  const a = state.D.portfolio[i];
  const newPrice = parseFloat(prompt(`Текущая цена ${a.ticker} (сейчас: ${a.currentPrice || a.buyPrice} ₽):`));
  if (!newPrice || isNaN(newPrice)) return;
  state.D.portfolio[i].currentPrice = newPrice;
  state.D.portfolio[i].lastUpdated = today();
  if (!state.D.portfolioUpdated) state.D.portfolioUpdated = {};
  state.D.portfolioUpdated.lastUpdate = today();
  sched();
  renderPortfolio();
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
  if (!asset.ticker || !asset.qty || !asset.buyPrice) {
    alert('Заполните тикер, количество и цену покупки');
    return;
  }
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

// ── Сохранение настроек движка ────────────────────────────────────────────
window.saveEngineSettings = function() {
  const keyRateInput = $('eng-key-rate');
  const monthlyInput = $('eng-monthly');
  if (!keyRateInput || !monthlyInput) return;
  const keyRate = parseFloat(keyRateInput.value) / 100;
  const monthlyCash = parseFloat(monthlyInput.value) || 0;
  if (!keyRate || keyRate < 0.01 || keyRate > 0.5) { alert('Введите корректную ставку (1–50%)'); return; }
  if (!state.D.portfolioSettings) state.D.portfolioSettings = {};
  state.D.portfolioSettings.keyRate = keyRate;
  state.D.portfolioSettings.monthlyCash = monthlyCash;
  sched();
  renderPortfolio();
};

// ── LLM: объяснение рекомендаций через YandexGPT ─────────────────────────
window.explainPortfolio = async function() {
  const resultEl = $('portfolio-llm-result');
  const btn = $('btn-explain-portfolio');
  if (!resultEl) return;

  // Проверяем наличие воркера
  const workerUrl = (appConfig.workerUrl || '').trim();
  if (!workerUrl) {
    resultEl.innerHTML = '<div class="notice amber" style="font-size:12px">⚠ Для работы YandexGPT настройте URL воркера в разделе «Администратор»</div>';
    return;
  }

  // Берём последний результат движка
  const settings = getSettings();
  const engineResult = runEngine(state.D.portfolio, settings.keyRate, settings.monthlyCash);
  if (engineResult.empty) {
    resultEl.innerHTML = '<div class="notice amber">Добавьте активы для анализа</div>';
    return;
  }

  if (btn) { btn.disabled = true; btn.textContent = '⏳ Анализирую...'; }
  resultEl.innerHTML = '<div style="color:var(--text2);font-size:12px;padding:8px 0">YandexGPT анализирует ваш портфель...</div>';

  const regimeLabel = REGIME_LABELS[engineResult.regime]?.label || engineResult.regime;
  const systemPrompt = `Ты опытный финансовый советник. Объясни рекомендации инвестиционного движка простым языком.
Будь конкретным, кратким (не более 250 слов). Структурируй: 1) Режим рынка 2) Главные проблемы 3) Что делать прямо сейчас.
Не придумывай данных — используй только то, что получишь в запросе. Отвечай только на русском языке.`;

  const userText = `Режим рынка: ${regimeLabel} (ставка ЦБ ${Math.round(settings.keyRate * 100)}%).
Баланс портфеля: ${engineResult.balanceScore}/100.
Ожидаемая доходность: ${engineResult.expectedYield}%.

Текущее распределение (факт → цель):
${Object.entries(GROUP_LABELS).map(([k, g]) => {
  const cur = Math.round((engineResult.weights[k] || 0) * 100);
  const tgt = Math.round((engineResult.target[k] || 0) * 100);
  const dev = Math.round((engineResult.deviations[k] || 0) * 100);
  return `- ${g.label}: ${cur}% → цель ${tgt}% (отклонение ${dev > 0 ? '+' : ''}${dev} п.п.)`;
}).join('\n')}

${engineResult.actions.sell.length ? 'Рекомендации продать: ' + engineResult.actions.sell.map(s => `${s.ticker} на ${s.amount_rub}₽`).join(', ') : 'Продавать ничего не нужно.'}
${engineResult.actions.buy.length ? 'Рекомендации купить: ' + engineResult.actions.buy.map(b => `${b.ticker} на ${b.amount_rub}₽`).join(', ') : ''}
${engineResult.monthlyPlan.length ? 'Ежемесячный план: ' + engineResult.monthlyPlan.map(p => `${p.ticker} ${p.amount_rub}₽`).join(', ') : ''}
${engineResult.concentration.length ? 'Предупреждения о концентрации: ' + engineResult.concentration.map(c => c.message).join('; ') : ''}`;

  try {
    const endpoint = workerUrl.replace(/\/?$/, '') + '/gpt';
    const headers = { 'Content-Type': 'application/json' };
    if (appConfig.appSecret) headers['X-App-Secret'] = appConfig.appSecret;

    const resp = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        completionOptions: { stream: false, temperature: 0.3, maxTokens: 600 },
        messages: [
          { role: 'system', text: systemPrompt },
          { role: 'user', text: userText },
        ],
      }),
    });

    if (!resp.ok) {
      throw new Error('Сервер ответил ' + resp.status);
    }

    const data = await resp.json();
    const text = (data.result?.alternatives?.[0]?.message?.text || '').trim();

    if (!text) throw new Error('Пустой ответ от GPT');

    // Форматируем: переносы → абзацы, нумерованный список → красивее
    const formatted = text
      .replace(/\n\n/g, '</p><p style="margin-top:8px">')
      .replace(/\n/g, '<br>')
      .replace(/(\d+\))/g, '<b>$1</b>');

    resultEl.innerHTML = `
      <div style="background:var(--amber-light);border:1.5px solid var(--border);border-radius:8px;padding:14px 16px;font-size:13px;line-height:1.7;color:var(--topbar)">
        <div style="font-size:10px;font-weight:700;color:var(--text2);letter-spacing:.5px;margin-bottom:8px">🤖 АНАЛИЗ YANDEXGPT</div>
        <p style="margin:0">${formatted}</p>
        <div style="font-size:10px;color:var(--text2);margin-top:10px;border-top:1px solid var(--border);padding-top:6px">
          ⚠ Это не инвестиционная рекомендация. Принимайте решения самостоятельно.
        </div>
      </div>`;
  } catch (e) {
    resultEl.innerHTML = `<div class="notice amber" style="font-size:12px">Ошибка GPT: ${e.message}. Проверьте URL воркера в разделе «Администратор».</div>`;
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🤖 Объяснить рекомендации (YandexGPT)'; }
  }
};

// ── Алерт для дашборда ────────────────────────────────────────────────────
export function checkPortfolioAlert() {
  if (!state.D || !state.D.portfolio || !state.D.portfolio.length) return null;
  const lastUpdate = state.D.portfolioUpdated?.lastUpdate;
  if (!lastUpdate) return 'Обновите цены в портфеле инвестиций';
  const daysSince = Math.floor((new Date(today()) - new Date(lastUpdate)) / (1000 * 60 * 60 * 24));
  if (daysSince >= 7) return `Цены в портфеле не обновлялись ${daysSince} дн.`;

  // Проверяем баланс портфеля
  if (state.D.portfolio.length > 0) {
    const settings = getSettings();
    const result = runEngine(state.D.portfolio, settings.keyRate, settings.monthlyCash);
    if (!result.empty && result.balanceScore < 50) {
      return `Портфель разбалансирован (${result.balanceScore}/100) — зайдите в раздел «Портфель»`;
    }
  }
  return null;
}
