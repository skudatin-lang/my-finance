/**
 * tour.js — Интерактивный тур с подсветкой элементов
 * Показывается новым пользователям, можно перезапустить из Настроек
 */

// ── Шаги тура ─────────────────────────────────────────────────────────────
const TOUR_STEPS = [
  {
    targetId: null, // нет таргета — приветственный экран по центру
    title: '👋 Добро пожаловать в Мои Финансы!',
    text: 'Этот краткий тур покажет основные возможности приложения. Займёт меньше минуты.',
    position: 'center',
    action: null,
  },
  {
    targetId: 'tour-btn-add',
    title: '➕ Добавить операцию',
    text: 'Главная кнопка — записывайте доходы, расходы и переводы. Голосовой ввод — через кнопку 🎤 в правом углу.',
    position: 'bottom',
    action: null,
  },
  {
    targetId: 'tnav-dashboard',
    title: '📊 Дашборд',
    text: 'Главная страница: баланс месяца, прогноз, алерты о превышениях, финансовый план и график cashflow.',
    position: 'bottom',
    action: () => window.showScreen('dashboard'),
  },
  {
    targetId: 'tnav-reports',
    title: '📋 Отчёты',
    text: 'Баланс кошельков, операции по каждому кошельку и расходы по категориям за любой месяц.',
    position: 'bottom',
    action: () => window.showScreen('reports'),
  },
  {
    targetId: 'tnav-dds',
    title: '💰 ДДС',
    text: 'Движение денежных средств — выполнение финансового плана. Видно сколько потрачено по каждой статье.',
    position: 'bottom',
    action: () => window.showScreen('dds'),
  },
  {
    targetId: 'tnav-calendar',
    title: '📅 Календарь',
    text: 'Операции по дням. Зелёные дни — есть фактические операции, синие — плановые. Здесь же список покупок.',
    position: 'bottom',
    action: () => window.showScreen('calendar'),
  },
  {
    targetId: 'tnav-loans',
    title: '💳 Кредиты',
    text: 'Все долги и кредиты с расчётом переплаты. ИИ-советник поможет выбрать стратегию погашения.',
    position: 'bottom',
    action: () => window.showScreen('loans'),
  },
  {
    targetId: 'tnav-health',
    title: '❤️ Здоровье',
    text: 'Индекс финансового здоровья: подушка безопасности, норма сбережений, долговая нагрузка. Конкретные советы что улучшить.',
    position: 'bottom',
    action: () => window.showScreen('health'),
  },
  {
    targetId: 'tour-btn-settings',
    title: '⚙️ Настройки',
    text: 'Здесь настраиваются кошельки, категории и финансовый план. Начните с добавления кошельков с реальными балансами.',
    position: 'bottom',
    action: () => window.showScreen('settings'),
  },
  {
    targetId: null,
    title: '🎉 Готово! Начните прямо сейчас',
    text: 'Добавьте кошельки в Настройках, затем внесите первую операцию. Приложение сразу начнёт строить аналитику.',
    position: 'center',
    action: null,
    isLast: true,
  },
];

let _tourStep = 0;
let _tourActive = false;

// ── DOM элементы тура ─────────────────────────────────────────────────────
function _createTourDOM() {
  if (document.getElementById('tour-overlay')) return;

  // Оверлей с вырезом под подсветку
  const overlay = document.createElement('div');
  overlay.id = 'tour-overlay';
  overlay.style.cssText = `
    position:fixed;inset:0;z-index:9000;pointer-events:none;
    transition:opacity .25s;
  `;

  // 4 полупрозрачных прямоугольника вокруг цели (top/bottom/left/right)
  ['tour-shade-top','tour-shade-bottom','tour-shade-left','tour-shade-right'].forEach(id => {
    const d = document.createElement('div');
    d.id = id;
    d.style.cssText = 'position:absolute;background:rgba(30,18,8,.72);transition:all .25s ease;pointer-events:all;';
    overlay.appendChild(d);
  });

  // Карточка подсказки
  const card = document.createElement('div');
  card.id = 'tour-card';
  card.style.cssText = `
    position:fixed;z-index:9001;
    background:var(--card);border:2px solid var(--amber);border-radius:14px;
    padding:18px 20px;max-width:320px;min-width:260px;
    box-shadow:0 8px 32px rgba(0,0,0,.35);
    transition:all .25s ease;
  `;
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

  // Клик по затемнению — следующий шаг
  ['tour-shade-top','tour-shade-bottom','tour-shade-left','tour-shade-right'].forEach(id => {
    document.getElementById(id).onclick = () => tourNext();
  });
}

// ── Позиционирование подсветки ────────────────────────────────────────────
function _positionSpotlight(el) {
  const pad = 6;
  const r = el.getBoundingClientRect();
  const T = Math.max(0, r.top - pad);
  const B = Math.min(window.innerHeight, r.bottom + pad);
  const L = Math.max(0, r.left - pad);
  const R = Math.min(window.innerWidth, r.right + pad);

  const set = (id, top, left, width, height) => {
    const d = document.getElementById(id);
    if (d) { d.style.top=top+'px'; d.style.left=left+'px'; d.style.width=width+'px'; d.style.height=height+'px'; }
  };

  set('tour-shade-top',    0,           0,           window.innerWidth,  T);
  set('tour-shade-bottom', B,           0,           window.innerWidth,  window.innerHeight - B);
  set('tour-shade-left',   T,           0,           L,                  B - T);
  set('tour-shade-right',  T,           R,           window.innerWidth - R, B - T);
}

function _clearSpotlight() {
  const set = (id, top, left, width, height) => {
    const d = document.getElementById(id);
    if (d) { d.style.top=top+'px'; d.style.left=left+'px'; d.style.width=width+'px'; d.style.height=height+'px'; }
  };
  // Весь экран затемнён
  set('tour-shade-top',    0, 0, window.innerWidth, window.innerHeight);
  set('tour-shade-bottom', 0, 0, 0, 0);
  set('tour-shade-left',   0, 0, 0, 0);
  set('tour-shade-right',  0, 0, 0, 0);
}

// ── Позиционирование карточки ─────────────────────────────────────────────
function _positionCard(el, position) {
  const card = document.getElementById('tour-card');
  if (!card) return;

  if (position === 'center' || !el) {
    card.style.top = '50%';
    card.style.left = '50%';
    card.style.transform = 'translate(-50%,-50%)';
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
    // Если выходит снизу — показываем сверху
    if (top + ch > window.innerHeight - 20) top = r.top - ch - pad;
  } else if (position === 'top') {
    top = r.top - ch - pad;
    left = r.left + r.width / 2 - cw / 2;
    if (top < 10) top = r.bottom + pad;
  }

  // Не выходим за края экрана
  left = Math.max(12, Math.min(left, window.innerWidth - cw - 12));
  top  = Math.max(12, Math.min(top,  window.innerHeight - ch - 12));

  card.style.top  = top + 'px';
  card.style.left = left + 'px';
}

// ── Рендер шага ───────────────────────────────────────────────────────────
function _renderStep(idx) {
  const step = TOUR_STEPS[idx];
  if (!step) return;

  const titleEl = document.getElementById('tour-title');
  const textEl  = document.getElementById('tour-text');
  const nextBtn = document.getElementById('tour-next');
  const prevBtn = document.getElementById('tour-prev');
  const dotsEl  = document.getElementById('tour-dots');

  if (titleEl) titleEl.textContent = step.title;
  if (textEl)  textEl.textContent  = step.text;
  if (nextBtn) nextBtn.textContent = step.isLast ? '✓ Начать' : 'Далее →';
  if (prevBtn) prevBtn.style.display = idx === 0 ? 'none' : '';

  // Точки прогресса
  if (dotsEl) {
    dotsEl.innerHTML = TOUR_STEPS.map((_, i) =>
      `<div style="width:${i===idx?14:6}px;height:6px;border-radius:3px;background:${i===idx?'var(--amber)':i<idx?'var(--green)':'var(--border)'};transition:all .2s"></div>`
    ).join('');
  }

  // Выполняем action шага (переключить экран)
  if (step.action) step.action();

  // Позиционируем spotlight и карточку
  const targetEl = step.targetId ? document.getElementById(step.targetId) : null;

  // Небольшая задержка чтобы экран успел переключиться
  setTimeout(() => {
    if (targetEl) {
      _positionSpotlight(targetEl);
      // Скроллим элемент в видимость если нужно
      targetEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    } else {
      _clearSpotlight();
    }
    _positionCard(targetEl, step.position);
  }, 120);
}

// ── Публичные функции ─────────────────────────────────────────────────────
export function tourStart() {
  _createTourDOM();
  _tourStep = 0;
  _tourActive = true;

  const overlay = document.getElementById('tour-overlay');
  const card    = document.getElementById('tour-card');
  if (overlay) overlay.style.display = '';
  if (card)    card.style.display    = '';

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
  const card    = document.getElementById('tour-card');
  if (overlay) overlay.style.display = 'none';
  if (card)    card.style.display    = 'none';

  // Сохраняем что тур пройден
  if (window._tourSaveDone) window._tourSaveDone();

  // Возвращаемся на дашборд после тура
  if (!skipped) {
    setTimeout(() => window.showScreen?.('dashboard'), 100);
  }
}

export function isTourDone(data) {
  return !!(data?.tourDone);
}
