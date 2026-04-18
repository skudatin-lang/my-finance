/**
 * eventBus.js — Шина событий для связи между модулями
 *
 * Модули не знают друг о друге напрямую.
 * Они общаются через события: один emit'ит, другой on'ит.
 *
 * Использование:
 *   import { eventBus } from './eventBus.js';
 *   eventBus.on('finance.operation.added', handler);
 *   eventBus.emit('investments.trade.done', { amount: 5000 });
 */

class EventBus {
  constructor(){
    this._listeners = {};  // { 'event.name': [fn, fn, ...] }
    this._history   = []; // последние 50 событий для отладки
  }

  // Подписаться на событие
  on(event, handler){
    if(!this._listeners[event]) this._listeners[event] = [];
    this._listeners[event].push(handler);
    return () => this.off(event, handler); // возвращает функцию отписки
  }

  // Подписаться один раз
  once(event, handler){
    const wrapper = (data) => {
      handler(data);
      this.off(event, wrapper);
    };
    return this.on(event, wrapper);
  }

  // Отписаться
  off(event, handler){
    if(!this._listeners[event]) return;
    this._listeners[event] = this._listeners[event].filter(fn => fn !== handler);
  }

  // Отправить событие
  emit(event, data = {}){
    // Пишем в историю (для отладки)
    this._history.push({ event, data, time: Date.now() });
    if(this._history.length > 50) this._history.shift();

    const handlers = this._listeners[event] || [];
    handlers.forEach(fn => {
      try { fn(data); }
      catch(e){ console.error(`EventBus: handler error for "${event}":`, e); }
    });
  }

  // Список всех подписок (для отладки)
  debug(){
    console.table(
      Object.entries(this._listeners).map(([event, handlers]) => ({
        event, handlers: handlers.length
      }))
    );
  }
}

// Синглтон — один EventBus на всё приложение
export const eventBus = new EventBus();

// ── Стандартные события приложения ───────────────────────────────────────
// Финансовый модуль emit'ит эти события — внешние модули могут подписаться

export const EVENTS = {
  // Финансы
  OPERATION_ADDED:    'finance.operation.added',    // { op: OperationObject }
  OPERATION_DELETED:  'finance.operation.deleted',  // { id: string }
  BALANCE_CHANGED:    'finance.balance.changed',    // { wallets: [] }
  MONTH_CHANGED:      'finance.month.changed',      // { offset: number }

  // Приложение
  USER_LOGGED_IN:     'app.user.login',             // { uid, email }
  USER_LOGGED_OUT:    'app.user.logout',            // {}
  DATA_LOADED:        'app.data.loaded',            // { data: state.D }
  SCREEN_CHANGED:     'app.screen.changed',         // { screen: string }

  // Внешние модули могут добавлять свои события
  // например: 'investments.trade.done', 'tracker.session.ended'
};
