import { $, fmt, fmtS, state, MONTHS, getMOps, planById, catPlanId, isPlanned, planSpent, wName } from './core.js';

export function renderDDS() {
  if (!state.D) return;

  // --- Обёртка для таблицы с прокруткой ---
  const tableEl = $('dds-table');
  let tableWrapper = document.getElementById('dds-table-wrapper');
  if (!tableWrapper && tableEl) {
    tableWrapper = document.createElement('div');
    tableWrapper.id = 'dds-table-wrapper';
    tableWrapper.style.overflowY = 'auto';
    tableWrapper.style.maxHeight = '60vh';
    tableEl.parentNode.insertBefore(tableWrapper, tableEl);
    tableWrapper.appendChild(tableEl);
  }
  // -----------------------------------------

  const dt = new Date(new Date().getFullYear(), new Date().getMonth() + state.ddsOff, 1);
  $('dds-month-lbl').textContent = MONTHS[dt.getMonth()] + ' ' + dt.getFullYear();
  const ops = getMOps(state.ddsOff).filter(o => !isPlanned(o.type));
  const totalInc = ops.filter(o => o.type === 'income').reduce((s, o) => s + o.amount, 0);
  const totalExp = ops.filter(o => o.type === 'expense').reduce((s, o) => s + o.amount, 0);

  const iEl = $('dds-plan-inc'), eEl = $('dds-plan-exp');
  if (!totalInc) {
    iEl.innerHTML = '<div style="text-align:center;padding:16px;color:var(--text2)">Добавьте доходы</div>';
    eEl.innerHTML = '<div style="text-align:center;padding:16px;color:var(--text2)">Нет данных</div>';
  } else {
    let ih = '', eh = '';
    state.D.plan.forEach(p => {
      const alloc = Math.round(totalInc * p.pct / 100);
      if (p.type === 'income') {
        const linkedWIds = state.D.wallets.filter(w => w.planId === p.id).map(w => w.id);
        const transfers = ops.filter(o => o.type === 'transfer' && (
          o.planId === p.id || o.planLabel === p.label || linkedWIds.includes(o.walletTo)
        )).reduce((s, o) => s + o.amount, 0);
        const expenses = ops.filter(o => o.type === 'expense' && (o.category === p.label || o.planId === p.id)).reduce((s, o) => s + o.amount, 0);
        const used = transfers + expenses;
        const tLeft = alloc - used;
        const tPct = alloc > 0 ? Math.min(Math.round(used / alloc * 100), 100) : 0;
        ih += `<div class="plan-card inc" style="margin-bottom:8px">
          <div class="plan-card-name inc">${p.label.toUpperCase()} (${p.pct}%)</div>
          <div class="plan-card-val inc">${fmt(used)} / ${fmt(alloc)}</div>
          <div class="plan-card-bar"><div class="plan-card-fill${tPct >= 100 ? ' over' : ''}" style="width:${tPct}%"></div></div>
          <div class="plan-card-status ${tLeft <= 0 ? 'ok' : 'bad'}">${tLeft <= 0 ? 'использовано: ' + fmt(used) : 'осталось: ' + fmt(tLeft)}</div>
        </div>`;
      } else {
        const cats = state.D.expenseCats.filter(c => c.planId === p.id).map(c => c.name);
        const spent = planSpent(p, ops);
        const left = alloc - spent, pct = alloc > 0 ? Math.min(Math.round(spent / alloc * 100), 100) : 0;
        eh += `<div class="plan-card exp" style="margin-bottom:8px">
          <div class="plan-card-name exp">${p.label.toUpperCase()} (${p.pct}%)</div>
          <div style="font-size:10px;color:var(--orange-dark);text-align:center;margin-bottom:3px">${cats.length ? cats.join(', ') : '—'}</div>
          <div class="plan-card-val exp">${fmt(spent)} / ${fmt(alloc)}</div>
          <div class="plan-card-bar"><div class="plan-card-fill exp${pct >= 100 ? ' over' : ''}" style="width:${pct}%"></div></div>
          <div class="plan-card-status ${left >= 0 ? 'ok' : 'bad'}">${left >= 0 ? 'остаток: ' + fmt(left) : 'перерасход: ' + fmt(-left)}</div>
        </div>`;
      }
    });
    iEl.innerHTML = ih || '<div style="text-align:center;padding:16px;color:var(--text2)">Нет статей</div>';
    eEl.innerHTML = eh || '<div style="text-align:center;padding:16px;color:var(--text2)">Нет статей</div>';
  }

  const table = $('dds-table');
  if (!ops.length) {
    table.innerHTML = `<table><td colspan="4" style="padding:20px;text-align:center;color:var(--text2)">Нет операций</td></tr>`;
    return;
  }
  const sorted = [...ops].sort((a, b) => a.date < b.date ? 1 : -1);
  let html = '<thead><tr><th>ДАТА</th><th>КАТЕГОРИЯ</th><th>КОШЕЛЁК</th><th style="text-align:right">СУММА</th></tr></thead><tbody>';
  sorted.forEach(o => {
    const isIn = o.type === 'income', isOut = o.type === 'expense';
    const cls = isIn ? 'pos' : (isOut ? 'neg' : '');
    const pfx = isIn ? '+' : (isOut ? '\u2212' : '');
    const cat = o.type === 'transfer' ? `Перевод \u2192 ${wName(o.walletTo)}` : (o.category || '—');
    const pid = o.type === 'transfer' ? o.planId : catPlanId(o.category);
    const plbl = pid ? ` <span class="op-badge">${planById(pid)?.label || ''}</span>` : '';
    html += `<tr>
      <td>${o.date ? o.date.split('-').reverse().join('.') : '—'}</td>
      <td>${cat}${plbl}${o.note ? '<br><span style="font-size:10px;color:var(--text2)">' + o.note + '</span>' : ''}</td>
      <td>${wName(o.wallet || '')}</td>
      <td class="${cls}" style="text-align:right">${pfx} ${fmt(o.amount)}</td>
    </tr>`;
  });
  html += `<tr class="total"><td colspan="2">ИТОГО ДОХОДОВ</td><td colspan="2" class="pos" style="text-align:right">+ ${fmt(totalInc)}</td></tr>`;
  html += `<tr class="total"><td colspan="2">ИТОГО РАСХОДОВ</td><td colspan="2" class="neg" style="text-align:right">\u2212 ${fmt(totalExp)}</td></tr>`;
  html += `<tr class="total"><td colspan="2">ЧИСТЫЙ ПОТОК</td><td colspan="2" class="${totalInc - totalExp >= 0 ? 'pos' : 'neg'}" style="text-align:right">${fmtS(totalInc - totalExp)}</td></tr>`;
  table.innerHTML = html;

  renderDDSChart();

  // --- Увеличение расстояния между таблицей и графиком ---
  const chartCanvas = document.getElementById('dds-chart');
  if (chartCanvas && chartCanvas.parentNode) {
    let chartWrapper = document.getElementById('dds-chart-wrapper');
    if (!chartWrapper) {
      chartWrapper = document.createElement('div');
      chartWrapper.id = 'dds-chart-wrapper';
      chartWrapper.style.marginTop = '24px';     // увеличенный отступ
      chartWrapper.style.overflowY = 'auto';
      chartWrapper.style.maxHeight = '50vh';     // чтобы график не обрезался
      chartCanvas.parentNode.insertBefore(chartWrapper, chartCanvas);
      chartWrapper.appendChild(chartCanvas);
    }

    // Выравнивание высоты графика с левым блоком плановых расходов
    const leftPlans = document.querySelector('#dds-plan-inc, #dds-plan-exp')?.parentElement;
    if (leftPlans && chartWrapper) {
      chartWrapper.style.minHeight = leftPlans.offsetHeight + 'px';
    }
  }
}

function renderDDSChart() {
  const canvas = document.getElementById('dds-chart');
  if (!canvas || typeof Chart === 'undefined') return;
  const now = new Date();
  const labels = [], incData = [], expData = [];
  for (let i = 5; i >= 0; i--) {
    const dt = new Date(now.getFullYear(), now.getMonth() - i, 1);
    labels.push(MONTHS[dt.getMonth()].slice(0, 3));
    const ym = dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0');
    const ops = state.D.operations.filter(o => !isPlanned(o.type) && o.date && o.date.startsWith(ym));
    incData.push(ops.filter(o => o.type === 'income').reduce((s, o) => s + o.amount, 0));
    expData.push(ops.filter(o => o.type === 'expense').reduce((s, o) => s + o.amount, 0));
  }
  if (canvas._chartInst) { canvas._chartInst.destroy(); }
  canvas._chartInst = new Chart(canvas.getContext('2d'), {
    type: 'bar',
    data: {
      labels, datasets: [
        { label: 'Доходы', data: incData, backgroundColor: 'rgba(74,124,63,0.7)', borderColor: '#4A7C3F', borderWidth: 1, borderRadius: 3 },
        { label: 'Расходы', data: expData, backgroundColor: 'rgba(194,91,26,0.7)', borderColor: '#C25B1A', borderWidth: 1, borderRadius: 3 }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: 'top', labels: { font: { size: 11 }, color: '#7A5C30' } },
        tooltip: { callbacks: { label: ctx => '₽ ' + Math.round(ctx.raw).toLocaleString('ru-RU') } }
      },
      scales: {
        x: { ticks: { color: '#7A5C30', font: { size: 10 } }, grid: { display: false } },
        y: { ticks: { color: '#7A5C30', font: { size: 10 }, callback: v => '₽' + Math.round(v / 1000) + 'k' }, grid: { color: 'rgba(212,180,131,0.3)' } }
      }
    }
  });
}