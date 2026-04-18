/**
 * moduleRegistry.js — Реестр внешних модулей
 *
 * Позволяет подключать независимые модули (инвестиции, трекер времени и др.)
 * без изменения основного кода приложения.
 *
 * Контракт модуля (AppModule):
 * {
 *   id:       string,           // уникальный идентификатор: 'investments'
 *   name:     string,           // отображаемое имя: 'Инвестиции'
 *   version:  string,           // '1.0.0'
 *   icon:     string,           // эмодзи или символ: '📈'
 *   navItem:  boolean,          // добавить в навигацию?
 *   screenId: string,           // id экрана: 'screen-investments'
 *
 *   register(eventBus):  void,  // вызывается при регистрации — настройте подписки
 *   mount(container):    void,  // вызывается при первом показе — рендерите UI
 *   unmount():           void,  // вызывается при скрытии — очищайте ресурсы
 *   onDataLoaded(data):  void,  // вызывается когда загрузились данные из Firebase
 * }
 */

import { eventBus, EVENTS } from './eventBus.js';

const _registry = new Map(); // id → module instance

// ── Зарегистрировать модуль ───────────────────────────────────────────────
export function registerModule(mod){
  if(!mod.id || !mod.name){
    console.error('moduleRegistry: module must have id and name', mod);
    return false;
  }
  if(_registry.has(mod.id)){
    console.warn(`moduleRegistry: module "${mod.id}" already registered`);
    return false;
  }

  // Регистрируем
  _registry.set(mod.id, { ...mod, _mounted: false });

  // Вызываем register() — модуль настраивает подписки на EventBus
  try{
    mod.register?.(eventBus);
  }catch(e){
    console.error(`moduleRegistry: register() failed for "${mod.id}":`, e);
    return false;
  }

  console.info(`moduleRegistry: "${mod.id}" v${mod.version||'?'} registered`);

  // Добавляем пункт в навигацию если нужно
  if(mod.navItem && mod.screenId){
    _addNavItem(mod);
    _addScreenPlaceholder(mod);
  }

  return true;
}

// ── Смонтировать модуль (показать UI) ────────────────────────────────────
export function mountModule(id){
  const mod = _registry.get(id);
  if(!mod){ console.warn(`moduleRegistry: "${id}" not found`); return; }

  const containerId = mod.screenId || `screen-${id}`;
  let container = document.getElementById(containerId);

  if(!container){
    container = document.createElement('div');
    container.id = containerId;
    container.className = 'screen';
    document.getElementById('app-screen')?.appendChild(container);
  }

  if(!mod._mounted){
    try{
      mod.mount?.(container);
      mod._mounted = true;
    }catch(e){
      console.error(`moduleRegistry: mount() failed for "${id}":`, e);
    }
  }
}

// ── Размонтировать модуль ─────────────────────────────────────────────────
export function unmountModule(id){
  const mod = _registry.get(id);
  if(!mod || !mod._mounted) return;
  try{
    mod.unmount?.();
    mod._mounted = false;
  }catch(e){
    console.error(`moduleRegistry: unmount() failed for "${id}":`, e);
  }
}

// ── Получить все зарегистрированные модули ────────────────────────────────
export function getModules(){
  return [..._registry.values()];
}

export function getModule(id){
  return _registry.get(id) || null;
}

// ── Уведомить все модули о загрузке данных ────────────────────────────────
export function notifyDataLoaded(data){
  _registry.forEach(mod => {
    try{ mod.onDataLoaded?.(data); }
    catch(e){ console.error(`moduleRegistry: onDataLoaded failed for "${mod.id}":`, e); }
  });
}

// ── Динамическая загрузка модуля по URL ──────────────────────────────────
// Позволяет загружать модули без перекомпиляции основного приложения
export async function loadModuleFromUrl(url){
  try{
    const module = await import(url);
    if(!module.default){
      console.error(`moduleRegistry: module at "${url}" has no default export`);
      return false;
    }
    return registerModule(module.default);
  }catch(e){
    console.error(`moduleRegistry: failed to load module from "${url}":`, e);
    return false;
  }
}

// ── Загрузка модулей из конфига ───────────────────────────────────────────
// plugins.json: [{ "url": "./investments/index.js", "enabled": true }]
export async function loadPluginsFromConfig(configUrl = './plugins.json'){
  try{
    const resp = await fetch(configUrl);
    if(!resp.ok) return; // нет файла — нет плагинов, это нормально
    const plugins = await resp.json();
    for(const p of plugins){
      if(p.enabled !== false && p.url){
        await loadModuleFromUrl(p.url);
      }
    }
  }catch(e){
    // plugins.json не обязателен
    console.info('moduleRegistry: no plugins.json found — skipping external modules');
  }
}

// ── Добавить пункт в навигацию ────────────────────────────────────────────
function _addNavItem(mod){
  // Десктоп навигация
  const nav = document.querySelector('.topbar-nav');
  if(nav && !document.getElementById(`tnav-${mod.id}`)){
    const btn = document.createElement('button');
    btn.className = 'tnav-btn';
    btn.id = `tnav-${mod.id}`;
    btn.textContent = `${mod.icon || ''} ${mod.name}`.trim();
    btn.onclick = () => window.showScreen?.(mod.id);
    nav.appendChild(btn);
  }

  // Мобильное меню
  const mobileMenu = document.getElementById('mobile-more-menu');
  if(mobileMenu && !document.getElementById(`mobile-nav-${mod.id}`)){
    const btn = document.createElement('button');
    btn.id = `mobile-nav-${mod.id}`;
    btn.style.cssText = 'display:block;width:100%;padding:12px 16px;text-align:left;background:none;border:none;font-size:14px;font-weight:700;color:var(--topbar);cursor:pointer;border-bottom:1px solid var(--border)';
    btn.textContent = `${mod.icon || ''} ${mod.name}`.trim();
    btn.onclick = () => { window.showScreen?.(mod.id); window.hideMobileMenu?.(); };
    mobileMenu.appendChild(btn);
  }
}

// ── Создать placeholder для экрана модуля ─────────────────────────────────
function _addScreenPlaceholder(mod){
  const id = mod.screenId || `screen-${mod.id}`;
  if(document.getElementById(id)) return;
  const screen = document.createElement('div');
  screen.id = id;
  screen.className = 'screen';
  screen.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text2);font-size:14px">
    ${mod.icon || '📦'} ${mod.name} — загрузка...
  </div>`;
  document.getElementById('app-screen')?.appendChild(screen);
}
