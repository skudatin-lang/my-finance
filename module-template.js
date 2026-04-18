/**
 * ШАБЛОН ВНЕШНЕГО МОДУЛЯ
 * Скопируйте этот файл, переименуйте и реализуйте методы.
 *
 * Как подключить:
 * 1. Положите файл рядом с index.html (или в папку /modules/my-module/)
 * 2. Создайте или обновите plugins.json:
 *    [{ "url": "./modules/my-module/index.js", "enabled": true }]
 * 3. Приложение загрузит модуль автоматически при старте
 *
 * Пример готового модуля: investments-module.js (ниже как комментарий)
 */

const myModule = {
  // ── Обязательные поля ────────────────────────────────────────────────
  id:       'my-module',        // уникальный id, латиница без пробелов
  name:     'Мой модуль',       // отображаемое название в навигации
  version:  '1.0.0',
  icon:     '📦',               // эмодзи для навигации
  navItem:  true,               // true = добавить кнопку в топбар
  screenId: 'screen-my-module', // id DOM-элемента экрана

  // ── Внутреннее состояние ─────────────────────────────────────────────
  _eventBus: null,
  _financeData: null,           // данные из финансового модуля

  // ── register: вызывается один раз при подключении ────────────────────
  // Здесь настраиваются подписки на события финансового модуля
  register(eventBus){
    this._eventBus = eventBus;

    // Пример: реагировать на новые операции
    eventBus.on('finance.operation.added', (data) => {
      console.log('Новая операция:', data.op);
      // обновите свой UI если нужно
    });

    // Пример: реагировать на изменение баланса
    eventBus.on('finance.balance.changed', (data) => {
      this._render(); // перерисовать
    });
  },

  // ── onDataLoaded: вызывается когда загрузились данные Firebase ───────
  onDataLoaded(financeData){
    this._financeData = financeData;
    // financeData содержит: wallets, operations, plan, expenseCats, incomeCats
  },

  // ── mount: вызывается при первом открытии экрана ─────────────────────
  mount(container){
    this._container = container;
    this._render();
  },

  // ── unmount: вызывается при уходе с экрана ───────────────────────────
  unmount(){
    // очищайте таймеры, WebSocket-соединения и т.д.
  },

  // ── Ваша логика ──────────────────────────────────────────────────────
  _render(){
    if(!this._container) return;
    const wallets = this._financeData?.wallets || [];
    const totalBalance = wallets.reduce((s, w) => s + w.balance, 0);

    this._container.innerHTML = `
      <div style="padding:var(--gap)">
        <div style="font-size:18px;font-weight:700;color:var(--topbar);margin-bottom:16px">
          ${this.icon} ${this.name}
        </div>
        <div style="background:var(--card);border:1.5px solid var(--border2);border-radius:10px;padding:16px;margin-bottom:12px">
          <div style="font-size:11px;color:var(--text2);margin-bottom:4px">ОБЩИЙ БАЛАНС (из финансов)</div>
          <div style="font-size:24px;font-weight:700;color:var(--topbar)">
            ₽ ${Math.round(totalBalance).toLocaleString('ru-RU')}
          </div>
        </div>
        <div style="color:var(--text2);font-size:13px">
          Реализуйте логику вашего модуля в методе _render()
        </div>
      </div>
    `;
  },

  // Пример: отправить событие в финансовый модуль
  _emitToFinance(amount, description){
    this._eventBus?.emit('finance.operation.added', {
      op: {
        id: 'ext-' + Date.now(),
        type: 'expense',
        amount,
        category: description,
        date: new Date().toISOString().split('T')[0],
        note: `Из модуля ${this.name}`,
      }
    });
  }
};

export default myModule;


/*
──────────────────────────────────────────────────────────────
ПРИМЕР: Модуль "Инвестиции" (минимальная реализация)
──────────────────────────────────────────────────────────────

import { eventBus } from '../eventBus.js';

const investmentsModule = {
  id: 'investments',
  name: 'Инвестиции',
  version: '1.0.0',
  icon: '📈',
  navItem: true,
  screenId: 'screen-investments',
  _portfolio: [],
  _financeData: null,

  register(eventBus){
    // Когда финансы обновились — обновляем дашборд портфеля
    eventBus.on('finance.balance.changed', () => this._render());
  },

  onDataLoaded(data){
    this._financeData = data;
    // Загружаем свои данные портфеля из localStorage или отдельного Firebase-документа
    const saved = localStorage.getItem('mf_portfolio');
    this._portfolio = saved ? JSON.parse(saved) : [];
  },

  mount(container){
    this._container = container;
    this._render();
  },

  unmount(){},

  _render(){
    if(!this._container) return;
    const total = this._portfolio.reduce((s, a) => s + a.qty * (a.currentPrice || a.buyPrice), 0);
    this._container.innerHTML = `
      <div style="padding:var(--gap)">
        <h2 style="color:var(--topbar)">📈 Инвестиционный портфель</h2>
        <div style="font-size:28px;font-weight:700;color:var(--green-dark)">
          ₽ ${Math.round(total).toLocaleString('ru-RU')}
        </div>
        <!-- остальной UI -->
      </div>
    `;
  }
};

export default investmentsModule;
*/
