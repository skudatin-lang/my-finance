/**
 * ui.js — связующий UI-модуль
 * Отвечает за: инициализацию приложения, навигацию между экранами,
 * быструю операцию, поиск, онбординг, мобильное меню,
 * лимиты, импорт CSV, виджеты дашборда, голос, семью, план.
 *
 * Правила архитектуры:
 * - Только этот файл вызывает initAuth и orchestrates экраны.
 * - Все изменения state.D заканчиваются вызовом sched().
 * - Все функции, вызываемые из HTML onclick, регистрируются как window.xxx.
 */

import {
  state, initAuth, signInGoogle, doSignOut,
  exportData, importData, clearAllOps,
  sched, today, fmt, getMOps,
  appConfig, loadAppConfig, saveAppConfig, isAdminUser,
} from './core.js';

import { renderReports, renderWalletOps, setCatTab } from './reports.js';
import { renderDDS } from './dds.js';
import { renderCalendar, showCalDay } from './calendar.js';
import {
  renderSettings, updPT, savePlanSettings,
  addWallet, delWallet, openEditWallet, saveWalletEdit,
  addIncomeCat, delIncomeCat, fillExpPlanSel,
  openEditExpCat, saveExpCat, delExpCat,
  openAddPlanItem, openEditPlanItem, savePlanItem, deletePlanItem,
} from './settings.js';
import { openModal, closeModal, setType, saveOperation, openEditOp, saveEditOp, deleteOp } from './operations.js';
import { renderDashboard } from './dashboard.js';
import { renderAnalytics, exportCSV, exportAllCSV } from './analytics.js';
import { renderGoals } from './goals.js';
import { renderRecurring, applyRecurring } from './recurring.js';
import { renderHealth } from './health.js';
import { renderLoans, renderLoansSummary } from './loans.js';
import { renderTemplates } from './templates.js';
import { renderPortfolio, checkPortfolioAlert } from './portfolio.js';
import { renderAssets, checkAssetsAlert } from './assets.js';
import { parseCSV, deduplicateOps, importOps } from './import-csv.js';
import {
  renderShoppingList, onCalendarDayChange,
} from './shopping.js';
import {
  loadVoiceSettings, saveVoiceSettings, isVoiceConfigured,
  createVoiceButton, createSmartVoiceButton,
} from './voice.js';
import { renderFamily, loadFamilySettings, unsubscribeFamilyOnLogout } from './family.js';

// ── Helpers ───────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const OWNER_UID = 'TmexoZZxotgY7c3oBLpdAP3TG8s1';
function isAdmin() {
  return !!(state.CU && (state.CU.uid === OWNER_UID || isAdminUser(state.CU.uid)));
}

// ── Навигация между экранами ──────────────────────────────────────────────
const _bottomNavScreens = ['dashboard', 'reports', 'calendar', 'extras'];

function updateBottomNav(name) {
  _bottomNavScreens.forEach(s => {
    const btn = $('bnav-' + s);
    if (btn) btn.classList.toggle('active', s === name);
  });
  const moreBtn = $('bnav-more');
  if (moreBtn) moreBtn.classList.toggle('active', !_bottomNavScreens.includes(name));
}

function refreshCurrent() {
  const cur = document.querySelector('.screen.active')?.id?.replace('screen-', '');
  if (cur === 'dashboard') { renderDashboard(); _renderDashMain(); }
  else if (cur === 'reports') renderReports();
  else if (cur === 'dds') renderDDS();
  else if (cur === 'calendar') { renderCalendar(); renderShoppingList(); _renderCalRecurring(); }
  else if (cur === 'settings') { renderSettings(); _loadVoiceToSettings(); }
  else if (cur === 'analytics') { renderAnalytics(); renderLimits(); }
  else if (cur === 'extras') { renderGoals(); _renderPlanInGoals(); }
  else if (cur === 'loans') { renderLoans(); renderLoansSummary(); }
  else if (cur === 'templates') { renderTemplates(); initBulk(); }
  else if (cur === 'health') renderHealth();
  else if (cur === 'portfolio') renderPortfolio();
  else if (cur === 'family') renderFamily();
  else if (cur === 'import') initImportScreen();
  else if (cur === 'physassets') renderAssets();
  else if (cur === 'admin') {
    updateAdminVisibility();
    const uidsInput = $('admin-uids-input');
    if (uidsInput && appConfig.adminUids.length) uidsInput.value = appConfig.adminUids.join(', ');
  }
  // Дашборд-виджеты всегда актуальны
  if (cur !== 'dashboard') _renderDashMain();
}

window.showScreen = function(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.tnav-btn').forEach(b => b.classList.remove('active'));
  $('screen-' + name).classList.add('active');
  const tb = $('tnav-' + name);
  if (tb) { tb.classList.add('active'); setTimeout(() => tb.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' }), 50); }
  updateBottomNav(name);
  hideMobileMenu();
  refreshCurrent();
};

window.showMobileMenu = function() {
  const m = $('mobile-more-menu');
  if (m) m.style.display = m.style.display === 'none' ? 'block' : 'none';
};

function hideMobileMenu() {
  const m = $('mobile-more-menu');
  if (m) m.style.display = 'none';
}
window.hideMobileMenu = hideMobileMenu;

// Закрытие мобильного меню по клику вне
document.addEventListener('click', e => {
  const menu = $('mobile-more-menu');
  const btn = $('bnav-more');
  if (menu && !menu.contains(e.target) && !btn?.contains(e.target)) menu.style.display = 'none';
});

// Drag-to-scroll в десктопном топбаре
(function() {
  const nav = document.querySelector('.topbar-row2 .topbar-nav');
  if (!nav) return;
  let isDown = false, startX, scrollLeft;
  nav.addEventListener('mousedown', e => {
    isDown = true; nav.style.cursor = 'grabbing';
    startX = e.pageX - nav.offsetLeft; scrollLeft = nav.scrollLeft;
  });
  nav.addEventListener('mouseleave', () => { isDown = false; nav.style.cursor = 'grab'; });
  nav.addEventListener('mouseup', () => { isDown = false; nav.style.cursor = 'grab'; });
  nav.addEventListener('mousemove', e => {
    if (!isDown) return; e.preventDefault();
    nav.scrollLeft = scrollLeft - (e.pageX - nav.offsetLeft - startX);
  });
  window._scrollActiveTab = function() {
    const active = nav.querySelector('.tnav-btn.active');
    if (active) active.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  };
})();

// ── Экспорт/импорт данных ─────────────────────────────────────────────────
window.exportData = exportData;
window.importDataFile = e => importData(e, refreshCurrent);
window.clearOps = () => clearAllOps(refreshCurrent);
window.exportCSVCurrent = () => exportCSV(state.repOff || 0);
window.exportAllCSV = exportAllCSV;

// ── Навигация по месяцам и кошелькам ─────────────────────────────────────
window.chMonth = d => { state.repOff += d; renderReports(); };
window.ddsChM = d => { state.ddsOff += d; renderDDS(); };
window.calChM = d => { state.calOff += d; renderCalendar(); };
window.selCalDay = ds => { showCalDay(ds); state.calDay = ds; onCalendarDayChange(); };
window._getCalActiveDate = () => state.calDay || today();
window.chWallet = d => {
  state.walletIdx = (state.walletIdx + d + state.D.wallets.length) % state.D.wallets.length;
  renderWalletOps();
  $('wnav-lbl').textContent = state.D.wallets[state.walletIdx]?.name || '—';
};
window.setCatTab = tab => setCatTab(tab);

// ── Авторизация ───────────────────────────────────────────────────────────
window.signInGoogle = signInGoogle;
window.doSignOut = doSignOut;

// ── Операции ─────────────────────────────────────────────────────────────
window.openNewOp = () => openModal('modal', true);
window.closeModal = id => closeModal(id);
window.setOpType = type => setType(type);
window.saveOp = () => saveOperation(refreshCurrent);
window.openEditOp = id => openEditOp(id);
window.saveEdit = () => saveEditOp(refreshCurrent);
window.deleteOp = id => deleteOp(id, refreshCurrent);

// ── Настройки ─────────────────────────────────────────────────────────────
window.updPT = updPT;
window.savePlanSettings = savePlanSettings;
window.addWallet = addWallet;
window.delWallet = delWallet;
window.openEditWallet = openEditWallet;
window.saveWalletEdit = saveWalletEdit;
window.addIncomeCat = addIncomeCat;
window.delIncomeCat = delIncomeCat;
window.openExpCat = () => {
  $('exp-cat-modal-title').textContent = 'НОВАЯ КАТЕГОРИЯ РАСХОДОВ';
  $('ec-name').value = '';
  $('ec-idx').value = -1;
  fillExpPlanSel('ec-plan');
  $('modal-exp-cat').classList.add('open');
};
window.openEditExpCat = openEditExpCat;
window.saveExpCat = saveExpCat;
window.delExpCat = delExpCat;
window.openAddPlanItem = openAddPlanItem;
window.openEditPlanItem = openEditPlanItem;
window.savePlanItem = savePlanItem;
window.deletePlanItem = deletePlanItem;

// ── Быстрая операция ──────────────────────────────────────────────────────
let _qaType = 'expense';

window.qaSetType = function(type) {
  _qaType = type;
  ['expense', 'income'].forEach(t => {
    const el = $('qa-type-' + t); if (!el) return;
    el.className = 'type-btn' + (t === 'expense' ? ' ae' : ' ai');
    el.style.opacity = t !== type ? '.5' : '1';
  });
  const catBtns = $('qa-cat-btns'); if (!catBtns || !state.D) return;
  const cats = type === 'income'
    ? state.D.incomeCats
    : state.D.expenseCats.slice(0, 8).map(c => c.name);
  catBtns.innerHTML = cats.map(c =>
    `<button onclick="window.qaSelectCat(this,'${c}')" class="sbtn amber" style="font-size:11px;padding:5px 10px;border-radius:5px">${c}</button>`
  ).join('');
};

window.qaSelectCat = function(btn, cat) {
  document.querySelectorAll('#qa-cat-btns .sbtn').forEach(b => {
    b.style.background = 'var(--amber-light)';
    delete b.dataset.selected;
  });
  btn.style.background = 'var(--amber)';
  btn.style.color = '#fff';
  btn.dataset.selected = '1';
};

window.openQuickAdd = function() {
  if (!state.D) return;
  _qaType = 'expense';
  $('qa-amount').value = '';
  $('qa-note').value = '';
  $('qa-wallet').innerHTML = state.D.wallets.map(w => `<option value="${w.id}">${w.name}</option>`).join('');
  window.qaSetType('expense');
  $('modal-quick-add').classList.add('open');
  setTimeout(() => $('qa-amount')?.focus(), 100);
  const wrap = $('voice-qa-amount-wrap');
  if (wrap && !wrap.children.length) wrap.appendChild(createVoiceButton('qa-amount'));
};

window.saveQuickOp = function() {
  const amount = parseFloat($('qa-amount')?.value);
  if (!amount || amount <= 0) { $('qa-amount')?.focus(); return; }
  const wallet = $('qa-wallet')?.value;
  const note = $('qa-note')?.value || '';
  const selectedCat = document.querySelector('#qa-cat-btns [data-selected]');
  const category = selectedCat?.textContent || 'Прочее';
  const op = {
    id: 'op' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    type: _qaType, amount, date: today(), wallet, category, note,
  };
  const w = state.D.wallets.find(w => w.id === wallet);
  if (w) { if (_qaType === 'income') w.balance += amount; else w.balance -= amount; }
  state.D.operations.push(op);
  sched();
  $('modal-quick-add').classList.remove('open');
  refreshCurrent();
};

// ── Поиск ─────────────────────────────────────────────────────────────────
window.openSearch = function() {
  $('search-query').value = '';
  $('search-results').innerHTML = '<div style="color:var(--text2);font-size:13px;padding:12px 0">Введите запрос для поиска по операциям</div>';
  $('modal-search').classList.add('open');
  setTimeout(() => $('search-query')?.focus(), 100);
};

window.doSearch = function(q) {
  const el = $('search-results'); if (!el || !state.D) return;
  if (!q.trim()) {
    el.innerHTML = '<div style="color:var(--text2);font-size:13px;padding:12px 0">Введите запрос</div>';
    return;
  }
  const qL = q.toLowerCase();
  const ops = state.D.operations.filter(o => {
    if (o.type === 'planned_income' || o.type === 'planned_expense') return false;
    return (o.category || '').toLowerCase().includes(qL) ||
      (o.note || '').toLowerCase().includes(qL) ||
      String(o.amount).includes(qL) ||
      (o.date || '').includes(qL) ||
      (o.type === 'income' && 'доход'.includes(qL)) ||
      (o.type === 'expense' && 'расход'.includes(qL));
  }).sort((a, b) => a.date < b.date ? 1 : -1).slice(0, 50);
  if (!ops.length) {
    el.innerHTML = '<div style="color:var(--text2);font-size:13px;padding:12px 0">Ничего не найдено</div>';
    return;
  }
  el.innerHTML = `<div style="font-size:11px;color:var(--text2);margin-bottom:10px">Найдено: ${ops.length} операций</div>` +
    ops.map(o => {
      const isIn = o.type === 'income', isOut = o.type === 'expense';
      const col = isIn ? 'var(--green-dark)' : isOut ? 'var(--orange-dark)' : 'var(--blue)';
      const pfx = isIn ? '+ ' : isOut ? '− ' : '';
      const w = state.D.wallets.find(w => w.id === o.wallet);
      return `<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:.5px solid var(--border)">
        <div>
          <div style="font-size:13px;font-weight:700;color:var(--topbar)">${o.category || '—'}</div>
          <div style="font-size:11px;color:var(--text2)">${o.date || ''}${w ? ' · ' + w.name : ''}${o.note ? ' · ' + o.note : ''}</div>
        </div>
        <div style="font-size:14px;font-weight:700;color:${col}">${pfx}${fmt(o.amount)}</div>
      </div>`;
    }).join('');
};

// ── Онбординг ─────────────────────────────────────────────────────────────
function checkOnboarding() {
  if (!state.D) return;
  if (state.D.onboardingDone) return;
  if (state.D.operations.length > 0) { state.D.onboardingDone = true; sched(); return; }
  showOnboarding();
}
let _obStep = 0;
const _obSteps = [
  {
    title: 'Добавьте кошельки 👛',
    desc: 'Карта, наличные, накопительный счёт — укажите текущий баланс каждого.',
    action: 'Открыть настройки кошельков',
    fn: () => { $('modal-onboarding').classList.remove('open'); window.showScreen('settings'); },
  },
  {
    title: 'Настройте финансовый план 📊',
    desc: 'Разделите доход на статьи: обязательные расходы, накопления, кредиты. Итого должно быть 100%.',
    action: 'Открыть план',
    fn: () => { $('modal-onboarding').classList.remove('open'); window.showScreen('settings'); },
  },
  {
    title: 'Добавьте первую операцию ✅',
    desc: 'Запишите любой доход или расход — приложение начнёт строить аналитику.',
    action: 'Добавить операцию',
    fn: () => { $('modal-onboarding').classList.remove('open'); openModal('modal', true); },
  },
];
function showOnboarding() {
  _obStep = 0; renderOnboarding();
  $('modal-onboarding').classList.add('open');
}
function renderOnboarding() {
  const el = $('onboarding-steps'); if (!el) return;
  el.innerHTML = _obSteps.map((s, i) => `
    <div style="display:flex;gap:14px;padding:14px 0;border-bottom:1px solid var(--border)${i === _obStep ? ';background:var(--amber-light);margin:0 -8px;padding:14px 8px;border-radius:8px' : ''}">
      <div style="width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:14px;font-weight:700;background:${i < _obStep ? 'var(--green)' : i === _obStep ? 'var(--amber)' : 'var(--border)'};color:${i <= _obStep ? '#fff' : 'var(--text2)'}">
        ${i < _obStep ? '✓' : i + 1}
      </div>
      <div style="flex:1">
        <div style="font-size:14px;font-weight:700;color:var(--topbar);margin-bottom:4px">${s.title}</div>
        <div style="font-size:12px;color:var(--text2);line-height:1.5">${s.desc}</div>
        ${i === _obStep ? `<button class="btn-primary" style="margin-top:10px;width:auto;padding:8px 20px" onclick="window._obAction(${i})">${s.action}</button>` : ''}
      </div>
    </div>`).join('') + `
  <div style="display:flex;gap:8px;margin-top:16px">
    <button class="btn-sec" style="flex:1;margin-top:0" onclick="window._obNext()">Пропустить шаг →</button>
    <button class="btn-sec" style="flex:1;margin-top:0" onclick="window._obSkipAll()">Пропустить всё</button>
  </div>`;
}
window._obAction = function(i) { _obSteps[i].fn(); };
window._obNext = function() {
  _obStep = Math.min(_obStep + 1, _obSteps.length - 1);
  if (_obStep >= _obSteps.length - 1 && state.D) { state.D.onboardingDone = true; sched(); }
  renderOnboarding();
};
window._obSkipAll = function() {
  if (state.D) { state.D.onboardingDone = true; sched(); }
  $('modal-onboarding').classList.remove('open');
};

// ── Лимиты по категориям ──────────────────────────────────────────────────
function renderLimits() {
  if (!state.D) return;
  if (!state.D.categoryLimits) state.D.categoryLimits = [];
  const el = $('limits-list'); if (!el) return;
  const factOps = state.D.operations.filter(o => !['planned_income', 'planned_expense'].includes(o.type));
  const now = new Date();
  const ym = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
  const mOps = factOps.filter(o => o.date && o.date.startsWith(ym));
  if (!state.D.categoryLimits.length) {
    el.innerHTML = '<div style="color:var(--text2);font-size:13px;padding:6px 0">Нет лимитов</div>';
    return;
  }
  el.innerHTML = state.D.categoryLimits.map((lim, i) => {
    const spent = mOps.filter(o => o.type === 'expense' && o.category === lim.cat).reduce((s, o) => s + o.amount, 0);
    const pct = Math.min(Math.round(spent / lim.limit * 100), 100);
    const over = spent > lim.limit;
    const warn = pct >= 80 && !over;
    return `<div style="padding:10px 0;border-bottom:1px solid var(--border)">
      <div style="display:flex;justify-content:space-between;margin-bottom:5px">
        <span style="font-size:13px;font-weight:700;color:var(--topbar)">${lim.cat}</span>
        <div style="display:flex;align-items:center;gap:8px">
          <span style="font-size:12px;color:${over ? 'var(--red)' : warn ? 'var(--orange-dark)' : 'var(--text2)'}">₽${Math.round(spent).toLocaleString('ru-RU')} / ₽${Math.round(lim.limit).toLocaleString('ru-RU')}</span>
          <button class="sbtn red" onclick="window.deleteLimit(${i})">✕</button>
        </div>
      </div>
      <div style="background:var(--g50);border-radius:3px;height:6px">
        <div style="height:6px;border-radius:3px;width:${pct}%;background:${over ? 'var(--red)' : warn ? 'var(--orange)' : 'var(--amber)'}"></div>
      </div>
    </div>`;
  }).join('');
}

window.openAddLimit = () => {
  if (!state.D) return;
  $('lim-cat').innerHTML = state.D.expenseCats.map(c => `<option value="${c.name}">${c.name}</option>`).join('');
  $('lim-amount').value = '';
  $('lim-idx').value = -1;
  $('modal-limit').classList.add('open');
};
window.saveLimit = () => {
  if (!state.D.categoryLimits) state.D.categoryLimits = [];
  const cat = $('lim-cat').value, limit = parseFloat($('lim-amount').value) || 0;
  if (!cat || !limit) { alert('Заполните все поля'); return; }
  const idx = +$('lim-idx').value;
  if (idx >= 0) state.D.categoryLimits[idx] = { cat, limit };
  else {
    const exists = state.D.categoryLimits.findIndex(l => l.cat === cat);
    if (exists >= 0) state.D.categoryLimits[exists].limit = limit;
    else state.D.categoryLimits.push({ cat, limit });
  }
  sched();
  $('modal-limit').classList.remove('open');
  renderLimits();
};
window.deleteLimit = i => { state.D.categoryLimits.splice(i, 1); sched(); renderLimits(); };

// ── Импорт CSV ────────────────────────────────────────────────────────────
function initImportScreen() {
  if (!state.D) return;
  const ws = $('import-wallet');
  if (ws) ws.innerHTML = state.D.wallets.map(w => `<option value="${w.id}">${w.name}</option>`).join('');
}

let _csvParsed = [];

window.handleCSVFile = function(e) {
  const file = e.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    const bank = $('import-bank').value;
    const parsed = parseCSV(ev.target.result, bank);
    if (!parsed.length) { alert('Операций не найдено. Проверьте формат файла.'); return; }
    _csvParsed = deduplicateOps(parsed);
    renderImportPreview();
  };
  reader.readAsText(file, 'UTF-8');
  e.target.value = '';
};

function renderImportPreview() {
  const el = $('import-preview'); if (!el) return;
  el.style.display = '';
  const total = _csvParsed.length;
  const dups = _csvParsed.filter(o => o.isDuplicate).length;
  $('import-stats').innerHTML = `Найдено: ${total} · Новых: <b>${total - dups}</b> · Дублей (скрыты): ${dups}`;
  const table = $('import-table');
  const fresh = _csvParsed.filter(o => !o.isDuplicate);
  if (!fresh.length) { table.innerHTML = '<div style="color:var(--text2);padding:12px">Все операции уже есть в базе</div>'; return; }
  const userCats = [...state.D.incomeCats, ...state.D.expenseCats.map(c => c.name)];
  table.innerHTML = `<table style="width:100%;border-collapse:collapse;font-size:12px">
    <thead><tr style="border-bottom:2px solid var(--border2)">
      <th style="padding:6px;text-align:left;width:30px"><input type="checkbox" checked onchange="window.selectAllImport(this.checked)"></th>
      <th style="padding:6px;text-align:left">Дата</th>
      <th style="padding:6px;text-align:left">Описание</th>
      <th style="padding:6px;text-align:left">Категория</th>
      <th style="padding:6px;text-align:right">Сумма</th>
    </tr></thead>
    <tbody>
    ${fresh.map((op, i) => `<tr style="border-bottom:.5px solid var(--border);${op.type === 'income' ? 'background:rgba(74,124,63,.05)' : ''}">
      <td style="padding:5px"><input type="checkbox" checked id="imp-chk-${i}"></td>
      <td style="padding:5px;color:var(--text2)">${op.date.split('-').reverse().join('.')}</td>
      <td style="padding:5px;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${op.note}">${op.note || '—'}</td>
      <td style="padding:5px">
        <select style="font-size:11px;border:1px solid var(--border);border-radius:4px;padding:2px 4px;background:#fff" id="imp-cat-${i}">
          ${userCats.map(cat => `<option value="${cat}" ${cat === op.category ? 'selected' : ''}>${cat}</option>`).join('')}
        </select>
      </td>
      <td style="padding:5px;text-align:right;font-weight:700;color:${op.type === 'income' ? 'var(--green-dark)' : 'var(--orange-dark)'}">
        ${op.type === 'income' ? '+' : '−'}₽${op.amount.toLocaleString('ru-RU')}
      </td>
    </tr>`).join('')}
    </tbody>
  </table>`;
}

window.selectAllImport = function(v) {
  document.querySelectorAll('[id^="imp-chk-"]').forEach(cb => cb.checked = v);
};

window.confirmImport = function() {
  if (!state.D) return;
  const fresh = _csvParsed.filter(o => !o.isDuplicate);
  fresh.forEach((op, i) => {
    const chk = $('imp-chk-' + i);
    const catSel = $('imp-cat-' + i);
    op.skip = !chk?.checked;
    if (catSel) op.category = catSel.value;
  });
  const walletId = $('import-wallet').value;
  const count = importOps(fresh, walletId);
  _csvParsed = [];
  $('import-preview').style.display = 'none';
  alert('Импортировано ' + count + ' операций!');
  refreshCurrent();
};

// ── Виджет «Сегодня» на дашборде ─────────────────────────────────────────
function _renderDashMain() {
  const el = $('dash-today-main');
  if (el && state.D) {
    const ds = today();
    const allOps = state.D.operations.filter(o => o.date === ds && !['planned_income', 'planned_expense'].includes(o.type));
    const inc = allOps.filter(o => o.type === 'income').reduce((s, o) => s + o.amount, 0);
    const exp = allOps.filter(o => o.type === 'expense').reduce((s, o) => s + o.amount, 0);
    const bal = inc - exp;
    const wName = id => { const w = state.D.wallets.find(w => w.id === id); return w ? w.name : id || '?'; };
    const fmtD = ds => { if (!ds) return ''; const [y, m, d] = ds.split('-'); return d + '.' + m + '.' + y; };
    if (!allOps.length) {
      el.innerHTML = '<div style="color:var(--text2);font-size:12px;padding:4px 0">Операций нет — <a href="#" onclick="window.showScreen(\'calendar\');return false" style="color:var(--amber-dark);font-weight:700">открыть календарь →</a></div>';
    } else {
      const balColor = bal < 0 ? 'var(--red)' : bal > 0 ? 'var(--green-dark)' : 'var(--topbar)';
      let html = `<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;margin-bottom:8px">
        <div style="background:var(--green-bg);border-radius:6px;padding:6px 8px"><div style="font-size:9px;color:var(--text2);font-weight:700">ДОХОД</div><div style="font-size:13px;font-weight:700;color:var(--green-dark)">${inc > 0 ? '+ ' : ''}${fmt(inc)}</div></div>
        <div style="background:var(--red-bg);border-radius:6px;padding:6px 8px"><div style="font-size:9px;color:var(--text2);font-weight:700">РАСХОД</div><div style="font-size:13px;font-weight:700;color:var(--red)">${exp > 0 ? '− ' : ''}${fmt(exp)}</div></div>
        <div style="background:var(--amber-light);border-radius:6px;padding:6px 8px"><div style="font-size:9px;color:var(--text2);font-weight:700">ИТОГО</div><div style="font-size:13px;font-weight:700;color:${balColor}">${bal < 0 ? '− ' : ''}${fmt(Math.abs(bal))}</div></div>
      </div>`;
      allOps.slice(0, 5).forEach(o => {
        const isIn = o.type === 'income', isOut = o.type === 'expense', isTr = o.type === 'transfer';
        const label = isTr ? `Перевод → ${wName(o.walletTo)}` : (o.category || o.note || '—');
        const amtColor = isIn ? 'var(--green-dark)' : isOut ? 'var(--orange-dark)' : 'var(--blue)';
        const amtSign = isIn ? '+ ' : isTr ? '' : '− ';
        html += `<div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-top:.5px solid var(--border)">
          <div style="min-width:0;flex:1">
            <div style="font-size:12px;font-weight:700;color:var(--topbar);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${label}</div>
            <div style="font-size:10px;color:var(--text2)">${wName(o.wallet || '')} · ${fmtD(o.date)}</div>
          </div>
          <div style="font-size:12px;font-weight:700;color:${amtColor};white-space:nowrap;margin-left:8px">${amtSign}${fmt(o.amount)}</div>
        </div>`;
      });
      if (allOps.length > 5) html += `<div style="font-size:10px;color:var(--text2);padding-top:4px">ещё ${allOps.length - 5} операций</div>`;
      html += `<div style="margin-top:6px"><a href="#" onclick="window.showScreen('calendar');return false" style="font-size:11px;color:var(--amber-dark);font-weight:700;text-decoration:none">Открыть в календаре →</a></div>`;
      el.innerHTML = html;
    }
  }
  // Виджет списка покупок на дашборде
  const shopEl = $('dash-shopping-main');
  if (shopEl) window._renderShopWidget && window._renderShopWidget();
}
window._renderDashMain = _renderDashMain;

// ── Виджет списка покупок ─────────────────────────────────────────────────
window._renderShopWidget = function() {
  if (!state.D) return;
  const lists = state.D.shoppingLists || {};
  const allPending = [];
  Object.keys(lists).sort().forEach(date => {
    (lists[date] || []).filter(i => !i.done).forEach(i => allPending.push({ ...i, date }));
  });
  const totalAll = Object.values(lists).reduce((s, arr) => s + (arr || []).length, 0);
  const pendingAll = allPending.length;

  const render = (el) => {
    if (!el) return;
    if (!pendingAll && !totalAll) {
      el.innerHTML = '<div style="color:var(--text2);font-size:12px">Список пуст. <a href="#" onclick="window.showScreen(\'calendar\');return false" style="color:var(--amber);font-weight:700">Добавить →</a></div>';
      return;
    }
    let html = `<div style="font-size:11px;color:var(--text2);margin-bottom:5px">${pendingAll} не куплено из ${totalAll}</div>`;
    const shown = {};
    allPending.slice(0, 6).forEach(i => {
      if (!shown[i.date]) shown[i.date] = [];
      shown[i.date].push(i);
    });
    Object.keys(shown).sort().forEach(date => {
      const d = new Date(date + 'T12:00:00');
      const ds = d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
      html += `<div style="font-size:10px;color:var(--text2);margin-top:5px;margin-bottom:2px">${ds}</div>`;
      shown[date].forEach(i => {
        html += `<div style="font-size:12px;padding:2px 0;display:flex;align-items:center;gap:5px"><span>🛒</span><span style="color:var(--topbar)">${i.name}</span>${i.qty > 1 ? `<span style="color:var(--text2);font-size:11px">×${i.qty}</span>` : ''}</div>`;
      });
    });
    if (pendingAll > 6) html += `<div style="font-size:10px;color:var(--text2);margin-top:3px">и ещё ${pendingAll - 6} позиций...</div>`;
    el.innerHTML = html;
  };
  render($('dash-shopping'));
  render($('dash-shopping-main'));
};

// ── Быстрое добавление в список покупок из панели календаря ───────────────
window.quickAddShopItem = function() {
  if (!state.D) return;
  if (!state.D.shoppingLists) state.D.shoppingLists = {};
  const nameEl = $('shop-quick-name');
  const name = nameEl?.value.trim();
  if (!name) { nameEl?.focus(); return; }
  const qty = parseFloat($('shop-quick-qty')?.value) || 1;
  const price = parseFloat($('shop-quick-price')?.value) || 0;
  const date = state.calDay || today();
  if (!state.D.shoppingLists[date]) state.D.shoppingLists[date] = [];
  state.D.shoppingLists[date].push({ id: 'sh' + Date.now() + Math.random(), name, qty, price, done: false });
  sched();
  nameEl.value = '';
  if ($('shop-quick-qty')) $('shop-quick-qty').value = 1;
  if ($('shop-quick-price')) $('shop-quick-price').value = '';
  nameEl.focus();
  renderShoppingList();
  window._renderShopWidget();
};

// ── Регулярные операции (отображение в календаре) ─────────────────────────
function _renderCalRecurring() {
  const el = $('cal-recurring-list');
  if (!el || !state.D) return;
  if (!state.D.recurring || !state.D.recurring.length) {
    el.innerHTML = '<div style="color:var(--text2);font-size:12px">Нет регулярных операций</div>';
    return;
  }
  el.innerHTML = state.D.recurring.map((r, i) => `
    <div style="display:flex;justify-content:space-between;padding:7px 0;border-bottom:.5px solid var(--border);align-items:center">
      <div>
        <div style="font-size:13px;font-weight:700;color:var(--topbar)">${r.name}</div>
        <div style="font-size:11px;color:var(--text2)">${r.type === 'income' ? 'Доход' : 'Расход'} · ${r.category} · ${r.day}-е число</div>
      </div>
      <span style="font-size:13px;font-weight:700;color:${r.type === 'income' ? 'var(--green-dark)' : 'var(--orange-dark)'}">
        ${r.type === 'income' ? '+' : '−'}${fmt(r.amount)}
      </span>
    </div>`).join('');
}
window._renderCalRecurring = _renderCalRecurring;

// ── Исполнение финплана на экране «Цели» ──────────────────────────────────
function _renderPlanInGoals() {
  if (!state.D) return;
  const ops = getMOps(0).filter(o => !['planned_income', 'planned_expense'].includes(o.type));
  const totalInc = ops.filter(o => o.type === 'income').reduce((s, o) => s + o.amount, 0);
  const incEl = $('goals-plan-income');
  const expEl = $('goals-plan-expense');
  if (!incEl || !expEl) return;
  if (!totalInc) {
    incEl.innerHTML = '<div style="color:var(--text2);font-size:13px">Добавьте доходы для расчёта плана</div>';
    expEl.innerHTML = '';
    return;
  }
  let ih = '', eh = '';
  state.D.plan.forEach((p, i) => {
    const alloc = Math.round(totalInc * p.pct / 100);
    const spent = state.D.operations
      .filter(o => o.date && o.date.startsWith(new Date().toISOString().slice(0, 7)))
      .filter(o => o.planId === p.id || (state.D.expenseCats.find(c => c.name === o.category)?.planId === p.id))
      .reduce((s, o) => s + o.amount, 0);
    const pct = alloc > 0 ? Math.min(Math.round(spent / alloc * 100), 100) : 0;
    const over = spent > alloc;
    const color = p.type === 'income'
      ? (pct >= 100 ? 'var(--green-dark)' : 'var(--green)')
      : (over ? 'var(--red)' : 'var(--orange)');
    const row = `<div style="margin-bottom:10px">
      <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px;align-items:center">
        <span style="font-weight:700;color:var(--topbar)">${p.label} <span style="font-size:10px;color:var(--text2)">(${p.pct}%)</span></span>
        <div style="display:flex;gap:4px;align-items:center">
          <span style="color:${color}">${fmt(spent)} / ${fmt(alloc)}</span>
          <button class="sbtn blue" onclick="window.openEditPlanItem(${i})" style="padding:2px 5px;font-size:10px">✎</button>
          <button class="sbtn red" onclick="window.deletePlanItem(${i})" style="padding:2px 5px;font-size:10px">✕</button>
        </div>
      </div>
      <div style="background:var(--g50);border-radius:3px;height:5px">
        <div style="height:5px;border-radius:3px;background:${color};width:${pct}%"></div>
      </div>
      <div style="font-size:10px;color:${over ? 'var(--red)' : 'var(--text2)'};margin-top:2px">${over ? 'Перерасход: ' + fmt(spent - alloc) : 'Остаток: ' + fmt(alloc - spent)}</div>
    </div>`;
    if (p.type === 'income') ih += row; else eh += row;
  });
  incEl.innerHTML = ih ? `<div style="font-size:10px;font-weight:700;color:var(--text2);letter-spacing:.5px;margin-bottom:6px">НАКОПЛЕНИЯ / ИНВЕСТИЦИИ</div>` + ih : '';
  expEl.innerHTML = eh ? `<div style="font-size:10px;font-weight:700;color:var(--text2);letter-spacing:.5px;margin-bottom:6px">РАСХОДЫ ПО СТАТЬЯМ</div>` + eh : '';
}
window._renderPlanInGoals = _renderPlanInGoals;

// ── Финплан на экране «Цели» — отдельный вариант с полями ввода % ─────────
window._renderPlanSettingsGoals = function() {
  const el = $('plan-settings-goals'); if (!el || !state.D) return;
  el.innerHTML = state.D.plan.map((p, i) => `
    <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;padding-bottom:8px;border-bottom:1px solid var(--border)">
      <div style="flex:1;min-width:0">
        <div style="font-size:12px;font-weight:700;color:var(--topbar)">${p.label}</div>
        <div style="font-size:10px;color:var(--text2)">${p.type === 'income' ? 'Накопление' : 'Расход'}</div>
      </div>
      <input type="number" min="0" max="100" value="${p.pct}" id="ppg-${i}" oninput="window.updPTGoals()" style="width:52px;padding:5px;border:1.5px solid var(--border);border-radius:5px;font-size:13px;color:var(--topbar);background:#fff;text-align:right">
      <span style="font-size:13px;color:var(--text2)">%</span>
      <button class="sbtn blue" onclick="window.openEditPlanItem(${i})" style="padding:4px 7px;font-size:11px">✎</button>
      <button class="sbtn red" onclick="window.deletePlanItem(${i})" style="padding:4px 7px;font-size:11px">✕</button>
    </div>`).join('');
  window.updPTGoals();
};

window.updPTGoals = function() {
  let t = 0;
  state.D.plan.forEach((_, i) => { const e = $('ppg-' + i); if (e) t += parseFloat(e.value) || 0; });
  const e = $('plan-total-pct-goals');
  if (e) { e.textContent = Math.round(t) + '%'; e.style.color = Math.round(t) === 100 ? 'var(--green)' : 'var(--red)'; }
};

window.savePlanSettingsGoals = function() {
  let t = 0;
  state.D.plan.forEach((p, i) => { const e = $('ppg-' + i); const v = parseFloat(e?.value) || 0; p.pct = v; t += v; });
  if (Math.round(t) !== 100) { alert('Сумма должна быть 100%. Сейчас: ' + Math.round(t) + '%'); return; }
  sched(); alert('План сохранён');
};

// ── Групповая операция (Bulk) ─────────────────────────────────────────────
function initBulk() {
  if (!state.D) return;
  const bw = $('bulk-wallet');
  if (bw) bw.innerHTML = state.D.wallets.map(w => `<option value="${w.id}">${w.name}</option>`).join('');
  const bd = $('bulk-date');
  if (bd && !bd.value) bd.value = today();
}

// ── Голос: UI-настройки ───────────────────────────────────────────────────
function setupVoiceButtons() {
  [
    ['voice-op-amount-wrap', 'op-amount'],
    ['voice-op-note-wrap', 'op-note'],
    ['voice-shop-name-wrap', 'shop-item-name'],
  ].forEach(([wrapId, targetId]) => {
    const wrap = $(wrapId); if (!wrap) return;
    wrap.innerHTML = '';
    wrap.appendChild(createVoiceButton(targetId));
  });
}

function updateVoiceStatus() {
  const el = $('voice-status'); if (!el) return;
  if (isVoiceConfigured()) {
    el.textContent = '✓ Голосовой ввод настроен и готов к работе';
    el.style.color = 'var(--green-dark)'; el.style.background = 'var(--green-bg)';
  } else {
    el.textContent = '⚠ Заполните Прокси URL и App Secret для активации';
    el.style.color = 'var(--orange-dark)'; el.style.background = 'var(--amber-light)';
  }
}

function _loadVoiceToSettings() {
  if (!state.D || !state.D.voiceSettings) return;
  const vs = state.D.voiceSettings;
  if ($('voice-proxy-url')) $('voice-proxy-url').value = vs.proxyUrl || '';
  if ($('voice-app-secret')) $('voice-app-secret').value = vs.appSecret || '';
  updateVoiceStatus();
}

window.saveVoiceSettingsUI = async function() {
  const proxyUrl = $('voice-proxy-url')?.value.trim() || '';
  const appSecretVal = $('voice-app-secret')?.value.trim() || '';
  const adminUidsRaw = $('admin-uids-input')?.value.trim() || '';
  const newAdminUids = adminUidsRaw
    ? adminUidsRaw.split(',').map(s => s.trim()).filter(Boolean)
    : appConfig.adminUids;
  try {
    const ok = await saveAppConfig({ workerUrl: proxyUrl, appSecret: appSecretVal, adminUids: newAdminUids });
    if (ok) {
      saveVoiceSettings(proxyUrl, proxyUrl, appSecretVal);
      alert('Настройки сохранены в базе данных. При следующем запуске загрузятся автоматически.');
    } else {
      alert('Ошибка сохранения. Проверьте правила Firestore: /config/app — разрешите write для adminUids.');
    }
  } catch (e) {
    alert('Ошибка: ' + e.message);
  }
  updateVoiceStatus();
};

window.testVoiceWorker = async function() {
  const url = $('voice-proxy-url')?.value.trim();
  const secret = $('voice-app-secret')?.value.trim();
  if (!url) { alert('Введите URL воркера'); return; }
  const el = $('voice-status');
  if (el) { el.textContent = 'Проверяю...'; el.style.color = 'var(--text2)'; }
  try {
    const resp = await fetch(url.replace(/\/?$/, ''), { method: 'GET', headers: { 'X-App-Secret': secret || '' } });
    const data = await resp.json();
    if (el) {
      if (data.ok) { el.textContent = '✓ Воркер работает: ' + JSON.stringify(data); el.style.color = 'var(--green-dark)'; el.style.background = 'var(--green-bg)'; }
      else { el.textContent = '⚠ Воркер ответил: ' + JSON.stringify(data); el.style.color = 'var(--orange-dark)'; }
    }
  } catch (e) {
    if (el) { el.textContent = '✗ Ошибка: ' + e.message; el.style.color = 'var(--red)'; el.style.background = 'var(--red-bg)'; }
  }
};

// ── Видимость кнопки «Админ» ──────────────────────────────────────────────
function updateAdminVisibility() {
  const show = isAdmin();
  const adminBtn = $('tnav-admin');
  const adminBnav = $('bnav-admin');
  if (adminBtn) adminBtn.style.display = show ? '' : 'none';
  if (adminBnav) adminBnav.style.display = show ? '' : 'none';
  const uidEl = $('admin-uid-display');
  if (uidEl && state.CU) uidEl.textContent = state.CU.uid;
  if ($('voice-proxy-url')) $('voice-proxy-url').value = appConfig.workerUrl || '';
  if ($('voice-app-secret')) $('voice-app-secret').value = appConfig.appSecret || '';
}

// ── Семья: инлайн-обработчики ─────────────────────────────────────────────
window._familyCreate = function() {
  const name = prompt('Название семейной группы (например: Семья Ивановых):');
  if (!name || !name.trim()) return;
  import('./family.js').then(m => {
    m.createFamily(name.trim()).then(r => {
      if (r.error) { alert('Ошибка: ' + r.error); return; }
      alert('Группа создана!\n\nКод для вступления:\n' + r.familyId + '\n\nПоделитесь кодом с членами семьи.');
      $('family-fallback').style.display = 'none';
      m.renderFamily();
    });
  }).catch(e => alert('Ошибка: ' + e.message));
};

window._familyJoin = function() {
  const code = prompt('Введите код группы (скопируйте у владельца):');
  if (!code || !code.trim()) return;
  import('./family.js').then(m => {
    m.joinFamily(code.trim()).then(r => {
      if (r.error) { alert('Ошибка: ' + r.error); return; }
      alert('Вы вступили в группу «' + r.familyName + '»!');
      $('family-fallback').style.display = 'none';
      m.renderFamily();
    });
  }).catch(e => alert('Ошибка: ' + e.message));
};

// ── Инициализация приложения ──────────────────────────────────────────────
initAuth(
  async user => {
    $('loading-screen').style.display = 'none';
    $('auth-screen').style.display = 'none';
    $('app-screen').style.display = 'flex';
    const av = $('user-avatar');
    if (av && user.photoURL) { av.src = user.photoURL; av.style.display = ''; }
    state.walletIdx = 0;
    applyRecurring();

    window._checkPortfolioAlert = checkPortfolioAlert;
    window._checkAssetsAlert = checkAssetsAlert;
    window._refreshCurrentScreen = refreshCurrent;
    window.state = state;
    window._myUID = state.CU.uid;

    try { await loadAppConfig(); } catch (e) { console.warn('loadAppConfig:', e.message); }
    loadVoiceSettings();
    if (appConfig.workerUrl) saveVoiceSettings(appConfig.workerUrl, appConfig.workerUrl, appConfig.appSecret);
    setupVoiceButtons();
    updateVoiceStatus();

    loadFamilySettings();
    renderFamily();

    document.body.appendChild(createSmartVoiceButton());

    checkOnboarding();
    updateAdminVisibility();

    // Показываем начальный экран (отчёты)
    window.showScreen('reports');
  },
  () => {
    unsubscribeFamilyOnLogout();
    $('app-screen').style.display = 'none';
    $('loading-screen').style.display = 'none';
    $('auth-screen').style.display = 'flex';
  }
);

$('auth-screen').style.display = 'none';
$('loading-screen').style.display = 'flex';

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(e => console.warn('SW:', e));
}
