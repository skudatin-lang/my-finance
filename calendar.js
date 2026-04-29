import { $, fmt, state, MONTHS, isPlanned, opHtml, today, fmtD, wName } from './core.js';

export function renderCalendar() {
  if (!state.D) return;
  const dt = new Date(new Date().getFullYear(), new Date().getMonth() + state.calOff, 1);
  $('cal-month-lbl').textContent = MONTHS[dt.getMonth()] + ' ' + dt.getFullYear();
  const y = dt.getFullYear(), m = dt.getMonth();
  const dim = new Date(y, m + 1, 0).getDate(), first = (new Date(y, m, 1).getDay() + 6) % 7;
  const todayStr = today(), ym = y + '-' + String(m + 1).padStart(2, '0');
  const allM = state.D.operations.filter(o => o.date && o.date.startsWith(ym));

  // Месячные суммы (будут показаны при загрузке)
  const monthIncFact = allM.filter(o => o.type === 'income').reduce((s, o) => s + o.amount, 0);
  const monthExpFact = allM.filter(o => o.type === 'expense').reduce((s, o) => s + o.amount, 0);
  const monthIncPlan = allM.filter(o => o.type === 'planned_income').reduce((s, o) => s + o.amount, 0);
  const monthExpPlanRaw = allM.filter(o => o.type === 'planned_expense');
  const seenRec = new Set();
  const monthExpPlan = monthExpPlanRaw.filter(o => {
    if (!o.recurringId) return true;
    if (seenRec.has(o.recurringId)) return false;
    seenRec.add(o.recurringId);
    return true;
  }).reduce((s, o) => s + o.amount, 0);

  $('cs-fi').textContent = fmt(monthIncFact);
  $('cs-fo').textContent = fmt(monthExpFact);
  $('cs-pi').textContent = fmt(monthIncPlan);
  $('cs-po').textContent = fmt(monthExpPlan);

  const fD = new Set(allM.filter(o => !isPlanned(o.type)).map(o => +o.date.split('-')[2]));
  const pD = new Set(allM.filter(o => isPlanned(o.type)).map(o => +o.date.split('-')[2]));

  let html = ['ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ', 'ВС'].map(d => `<div class="cal-dlbl">${d}</div>`).join('');
  for (let i = 0; i < first; i++) html += '<div class="cal-d empty">0</div>';
  for (let d = 1; d <= dim; d++) {
    const ds = ym + '-' + String(d).padStart(2, '0');
    const isTod = ds === todayStr, hF = fD.has(d), hP = pD.has(d);
    const cls = isTod ? 'today' : (hF && hP ? 'both' : (hF ? 'fact' : (hP ? 'plan' : '')));
    html += `<div class="cal-d ${cls}" onclick="window.selCalDay('${ds}')">${d}</div>`;
  }
  $('cal-grid').innerHTML = html;
  const selDay = state.calDay || todayStr;
  showCalDay(selDay);
  markSelected(selDay);
}

function markSelected(ds) {
  document.querySelectorAll('.cal-d.selected').forEach(el => el.classList.remove('selected'));
  const d = document.querySelector(`.cal-d[onclick="window.selCalDay('${ds}')"]`);
  if (d) d.classList.add('selected');
}

export function showCalDay(ds) {
  state.calDay = ds;
  markSelected(ds);
  const d = new Date(ds + 'T12:00:00');
  $('cal-day-title').textContent = d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }).toUpperCase();

  const ops = state.D.operations.filter(o => o.date === ds);
  const fact = ops.filter(o => !isPlanned(o.type));
  const plan = ops.filter(o => isPlanned(o.type));

  // Факт за день
  const factInc = fact.filter(o => o.type === 'income').reduce((s, o) => s + o.amount, 0);
  const factExp = fact.filter(o => o.type === 'expense').reduce((s, o) => s + o.amount, 0);
  const factBal = factInc - factExp;

  // План за день
  const planInc = plan.filter(o => o.type === 'planned_income').reduce((s, o) => s + o.amount, 0);
  const planExp = plan.filter(o => o.type === 'planned_expense').reduce((s, o) => s + o.amount, 0);
  const planBal = planInc - planExp;

  // Обновляем верхние окошки сводки (доходы, расходы, план доходов, план расходов) для выбранного дня
  $('cs-fi').textContent = fmt(factInc);
  $('cs-fo').textContent = fmt(factExp);
  $('cs-pi').textContent = fmt(planInc);
  $('cs-po').textContent = fmt(planExp);

  // Обновляем блоки дневного баланса (ФАКТ ЗА ДЕНЬ и ОЖИДАЕМЫЙ)
  const dbr = $('day-bal-row');
  if (ops.length) {
    dbr.style.display = 'grid';
    const fv = $('day-fact-bal');
    fv.textContent = (factBal < 0 ? '\u2212 ' : '') + fmt(factBal);
    fv.style.color = factBal < 0 ? 'var(--red)' : (factBal > 0 ? 'var(--green)' : 'var(--topbar)');
    const pv = $('day-plan-bal');
    pv.textContent = (planBal < 0 ? '\u2212 ' : '') + fmt(planBal);
    pv.style.color = planBal < 0 ? 'var(--red)' : (planBal > 0 ? 'var(--green)' : 'var(--text2)');
  } else {
    dbr.style.display = 'none';
  }

  // Список операций за день
  const el = $('cal-day-ops');
  if (!ops.length) {
    el.innerHTML = '<div style="padding:12px 0;font-size:13px;color:var(--text2)">Нет операций</div>';
    return;
  }
  let html = '';
  if (fact.length) {
    html += '<div class="sec-div">ФАКТ</div>' + fact.map(o => opHtml(o, true)).join('');
  }
  if (plan.length) {
    html += '<div class="sec-div">ПЛАНОВЫЕ</div>';
    html += plan.map(o => {
      const isPI = o.type === 'planned_income';
      return `<div class="op-item"><div class="op-top">
        <div style="flex:1"><div class="op-title">${o.category || o.note || '—'} <span class="op-badge">${isPI ? 'план +' : 'план \u2212'}</span></div><div class="op-meta">${fmtD(o.date)}${o.note ? ' &nbsp;' + o.note : ''}</div></div>
        <div class="op-actions"><div class="op-amt" style="color:var(--blue)">${isPI ? '+ ' : '\u2212 '}${fmt(o.amount)}</div><button class="op-btn del" onclick="window.deleteOp('${o.id}')">&#10005;</button></div>
      </div></div>`;
    }).join('');
  }
  el.innerHTML = html;
}

window.showCalSummary = function(type) {
  const el = document.getElementById('cal-summary-detail');
  if (!el || !state.D) return;

  if (el.dataset.type === type && el.style.display !== 'none') {
    el.style.display = 'none';
    el.dataset.type = '';
    return;
  }
  el.dataset.type = type;
  el.style.display = 'block';

  const now = new Date(new Date().getFullYear(), new Date().getMonth() + state.calOff, 1);
  const ym = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
  const allM = state.D.operations.filter(o => o.date && o.date.startsWith(ym));

  let ops = [], title = '', colorCls = '';
  if (type === 'fact-inc') {
    ops = allM.filter(o => o.type === 'income');
    title = 'Фактические доходы';
    colorCls = 'pos';
  } else if (type === 'fact-exp') {
    ops = allM.filter(o => o.type === 'expense');
    title = 'Фактические расходы';
    colorCls = 'neg';
  } else if (type === 'plan-inc') {
    ops = allM.filter(o => o.type === 'planned_income');
    title = 'Плановые доходы';
    colorCls = 'blue';
  } else if (type === 'plan-exp') {
    const all = allM.filter(o => o.type === 'planned_expense');
    const seen = new Set();
    ops = all.filter(o => {
      if (!o.recurringId) return true;
      if (seen.has(o.recurringId)) return false;
      seen.add(o.recurringId);
      return true;
    });
    title = 'Плановые расходы';
    colorCls = 'neg';
  }

  if (!ops.length) {
    el.innerHTML = `<div style="color:var(--text2);font-size:12px;padding:4px 0">Нет операций</div>`;
    return;
  }

  const groups = {};
  ops.forEach(o => {
    const cat = o.category || o.note || '—';
    if (!groups[cat]) groups[cat] = { total: 0, count: 0, items: [] };
    groups[cat].total += o.amount;
    groups[cat].count++;
    groups[cat].items.push(o);
  });

  const total = ops.reduce((s, o) => s + o.amount, 0);
  const colorVar = colorCls === 'pos' ? 'var(--green-dark)' : (colorCls === 'neg' ? 'var(--red)' : 'var(--blue)');

  let html = `<div style="font-size:11px;font-weight:700;color:var(--text2);letter-spacing:.5px;margin-bottom:8px;display:flex;justify-content:space-between">
    <span>${title}</span>
    <span style="color:var(--topbar)">Итого: ₽ ${Math.round(total).toLocaleString('ru-RU')}</span>
  </div>`;

  Object.entries(groups).sort((a, b) => b[1].total - a[1].total).forEach(([cat, g]) => {
    html += `<div style="padding:5px 0;border-bottom:.5px solid var(--border)">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <span style="font-size:12px;font-weight:700;color:var(--topbar)">${cat}</span>
        <span style="font-size:12px;font-weight:700;color:${colorVar}">
          ₽ ${Math.round(g.total).toLocaleString('ru-RU')}
        </span>
      </div>
      ${g.items.map(o => `<div style="font-size:11px;color:var(--text2);margin-top:2px;display:flex;justify-content:space-between">
        <span>${wName(o.wallet || '')}${o.note ? ' · ' + o.note : ''} · ${fmtD(o.date)}</span>
        <span>₽ ${Math.round(o.amount).toLocaleString('ru-RU')}</span>
      </div>`).join('')}
    </div>`;
  });

  el.innerHTML = html;
};