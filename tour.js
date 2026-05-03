// tour.js — исправленное позиционирование для мобильных устройств
import { $ } from './core.js';

const TOUR_STEPS = [
  { targetId: null, title: '👋 Добро пожаловать в Мои Финансы!', text: 'Быстрый тур по приложению — 8 шагов, меньше минуты. Покажем главное.', position: 'center', action: null },
  { targetId: 'tour-btn-add', title: '➕ Добавить операцию', text: 'Главная кнопка. Записывайте доходы, расходы и переводы. Или просто скажите голосом — кнопка 🎤 справа внизу.', position: 'bottom', action: null },
  { targetId: 'simple-main-amount', title: '💰 Главная цифра', text: 'Здесь всегда видно сколько можно потратить до конца месяца. Кольцо показывает процент использованного бюджета.', position: 'bottom', action: () => window.showScreen('dashboard') },
  { targetId: 'tnav-reports', title: '📋 Отчёты', text: 'Баланс всех кошельков, операции по каждому кошельку и расходы по категориям за любой месяц.', position: 'bottom', action: () => window.showScreen('reports') },
  { targetId: 'tnav-calendar', title: '📅 Календарь', text: 'Операции по дням. Зелёные дни — есть записи. Здесь же список покупок.', position: 'bottom', action: () => window.showScreen('calendar') },
  { targetId: 'tnav-dds', title: '💵 ДДС', text: 'Движение денежных средств — выполнение финансового плана. Видно сколько потрачено по каждой статье бюджета.', position: 'bottom', action: () => window.showScreen('dds') },
  { targetId: 'tour-btn-settings', title: '⚙️ Настройки', text: 'Добавьте кошельки с реальными балансами и настройте финансовый план. Там же FAQ и поддержка.', position: 'bottom', action: () => window.showScreen('settings') },
  { targetId: null, title: '🎉 Готово! Начните прямо сейчас', text: 'Добавьте кошельки → внесите первую операцию → приложение начнёт строить аналитику. Если что-то непонятно — FAQ в Настройках или напишите нам.', position: 'center', action: null, isLast: true },
];

let _tourStep = 0, _tourActive = false;

function _createTourDOM() {
  if (document.getElementById('tour-overlay')) return;
  const overlay = document.createElement('div');
  overlay.id = 'tour-overlay';
  overlay.style.cssText = `position:fixed;inset:0;z-index:9000;pointer-events:none;transition:opacity .25s;`;
  ['tour-shade-top','tour-shade-bottom','tour-shade-left','tour-shade-right'].forEach(id => {
    const d = document.createElement('div');
    d.id = id;
    d.style.cssText = 'position:absolute;background:rgba(30,18,8,.72);transition:all .25s ease;pointer-events:all;';
    overlay.appendChild(d);
  });
  const card = document.createElement('div');
  card.id = 'tour-card';
  card.style.cssText = `position:fixed;z-index:9001;background:var(--card);border:2px solid var(--amber);border-radius:14px;padding:14px 16px;max-width:360px;min-width:240px;box-shadow:0 8px 32px rgba(0,0,0,.45);`;
  card.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px">
      <div id="tour-title" style="font-size:14px;font-weight:700;color:var(--topbar);line-height:1.3;flex:1;padding-right:8px"></div>
      <button id="tour-close" style="background:none;border:none;font-size:18px;color:var(--text2);cursor:pointer;line-height:1;flex-shrink:0;padding:0" title="Закрыть тур">✕</button>
    </div>
    <div id="tour-text" style="font-size:12px;color:var(--text2);line-height:1.6;margin-bottom:14px"></div>
    <div style="display:flex;align-items:center;gap:8px">
      <div id="tour-dots" style="flex:1;display:flex;gap:4px;align-items:center"></div>
      <button id="tour-prev" style="background:var(--amber-light);border:1.5px solid var(--amber);border-radius:7px;padding:6px 12px;font-size:11px;font-weight:700;color:var(--amber-dark);cursor:pointer">← Назад</button>
      <button id="tour-next" style="background:var(--amber);border:none;border-radius:7px;padding:6px 14px;font-size:11px;font-weight:700;color:#fff;cursor:pointer">Далее →</button>
    </div>
  `;
  document.body.appendChild(overlay);
  document.body.appendChild(card);
  document.getElementById('tour-close').onclick = () => tourFinish(true);
  document.getElementById('tour-next').onclick = () => tourNext();
  document.getElementById('tour-prev').onclick = () => tourPrev();
  ['tour-shade-top','tour-shade-bottom','tour-shade-left','tour-shade-right'].forEach(id => {
    document.getElementById(id).onclick = () => tourNext();
  });
}

function _positionSpotlight(el) {
  const pad = 6;
  const r = el.getBoundingClientRect();
  const T = Math.max(0, r.top - pad);
  const B = Math.min(window.innerHeight, r.bottom + pad);
  const L = Math.max(0, r.left - pad);
  const R = Math.min(window.innerWidth, r.right + pad);
  const set = (id, top, left, width, height) => {
    const d = document.getElementById(id);
    if (d) { d.style.top = top+'px'; d.style.left = left+'px'; d.style.width = width+'px'; d.style.height = height+'px'; }
  };
  set('tour-shade-top', 0, 0, window.innerWidth, T);
  set('tour-shade-bottom', B, 0, window.innerWidth, window.innerHeight - B);
  set('tour-shade-left', T, 0, L, B - T);
  set('tour-shade-right', T, R, window.innerWidth - R, B - T);
}

function _clearSpotlight() {
  const set = (id, top, left, width, height) => {
    const d = document.getElementById(id);
    if (d) { d.style.top = top+'px'; d.style.left = left+'px'; d.style.width = width+'px'; d.style.height = height+'px'; }
  };
  set('tour-shade-top', 0, 0, window.innerWidth, window.innerHeight);
  set('tour-shade-bottom', 0, 0, 0, 0);
  set('tour-shade-left', 0, 0, 0, 0);
  set('tour-shade-right', 0, 0, 0, 0);
}

function _positionCard(el, position) {
  const card = document.getElementById('tour-card');
  if (!card) return;
  const isMobile = window.innerWidth <= 700;
  if (isMobile) {
    // bottom-nav = 60px. Ставим карточку выше с зазором 8px.
    // top:'auto' обязателен — иначе конфликтует с bottom при CSS.
    card.style.top = 'auto';
    card.style.right = 'auto';
    card.style.transform = 'none';
    card.style.left = '10px';
    card.style.width = 'calc(100% - 20px)';
    card.style.maxWidth = 'none';
    card.style.bottom = '68px';
    return;
  }
  card.style.bottom = 'auto';
  card.style.width = '';
  card.style.maxWidth = '360px';
  if (position === 'center' || !el) {
    card.style.top = '50%';
    card.style.left = '50%';
    card.style.transform = 'translate(-50%,-50%)';
    card.style.right = 'auto';
    return;
  }
  card.style.transform = '';
  const r = el.getBoundingClientRect();
  const cw = card.offsetWidth || 320;
  const ch = card.offsetHeight || 160;
  const pad = 12;
  let top, left;
  if (position === 'bottom') {
    top = r.bottom + pad;
    left = r.left + r.width / 2 - cw / 2;
    if (top + ch > window.innerHeight - 20) top = r.top - ch - pad;
  } else {
    top = r.top - ch - pad;
    left = r.left + r.width / 2 - cw / 2;
    if (top < 10) top = r.bottom + pad;
  }
  left = Math.max(12, Math.min(left, window.innerWidth - cw - 12));
  top  = Math.max(12, Math.min(top, window.innerHeight - ch - 12));
  card.style.top = top + 'px';
  card.style.left = left + 'px';
  card.style.right = 'auto';
  card.style.bottom = 'auto';
}

function _renderStep(idx) {
  const step = TOUR_STEPS[idx];
  if (!step) return;
  document.getElementById('tour-title').textContent = step.title;
  document.getElementById('tour-text').textContent = step.text;
  document.getElementById('tour-next').textContent = step.isLast ? '✓ Начать' : 'Далее →';
  document.getElementById('tour-prev').style.display = idx === 0 ? 'none' : '';
  const dots = document.getElementById('tour-dots');
  if (dots) {
    dots.innerHTML = TOUR_STEPS.map((_, i) => `<div style="width:${i===idx?14:6}px;height:6px;border-radius:3px;background:${i===idx?'var(--amber)':i<idx?'var(--green)':'var(--border)'};transition:all .2s"></div>`).join('');
  }
  if (step.action) step.action();

  // Проверяем реальную видимость элемента через getBoundingClientRect.
  // Если элемент скрыт (например tnav-* в topbar-row2 которая display:none на мобиле),
  // его размеры будут 0×0. Передавать такой элемент в _positionSpotlight нельзя:
  // shade-bottom получит top=6px height=всё_окно и закроет весь экран чёрным.
  const rawEl = step.targetId ? document.getElementById(step.targetId) : null;
  let targetEl = null;
  if (rawEl) {
    const r = rawEl.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) targetEl = rawEl;
  }

  setTimeout(() => {
    if (targetEl) {
      targetEl.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
      _positionSpotlight(targetEl);
    } else {
      _clearSpotlight();
    }
    _positionCard(targetEl, targetEl ? step.position : 'center');
  }, 120);
}

export function tourStart() {
  _createTourDOM();
  _tourStep = 0;
  _tourActive = true;
  const overlay = document.getElementById('tour-overlay');
  const card = document.getElementById('tour-card');
  if (overlay) overlay.style.display = '';
  if (card) card.style.display = '';
  window._tourNext = tourNext;
  window._tourPrev = tourPrev;
  window._tourClose = () => tourFinish(true);
  _renderStep(0);
}

export function tourNext() {
  if (!_tourActive) return;
  if (_tourStep >= TOUR_STEPS.length - 1) {
    tourFinish(false);
    return;
  }
  _tourStep++;
  _renderStep(_tourStep);
}

export function tourPrev() {
  if (!_tourActive || _tourStep === 0) return;
  _tourStep--;
  _renderStep(_tourStep);
}

export function tourFinish(skipped = false) {
  _tourActive = false;
  const overlay = document.getElementById('tour-overlay');
  const card = document.getElementById('tour-card');
  if (overlay) overlay.style.display = 'none';
  if (card) card.style.display = 'none';
  window._tourNext = null;
  window._tourPrev = null;
  window._tourClose = null;
  if (window._tourSaveDone) window._tourSaveDone();
  if (!skipped) setTimeout(() => window.showScreen?.('dashboard'), 100);
}

export function isTourDone(data) { return !!(data?.tourDone); }