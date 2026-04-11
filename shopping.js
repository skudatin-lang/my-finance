import{$,state,sched,fmt,today}from'./core.js';

const esc=s=>String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

// shoppingLists: { [date: string]: [{id,name,qty,price,done}] }
// Миграция: если старый формат (массив), переносим в сегодняшнюю дату

function migrate(){
  if(!state.D)return;
  if(Array.isArray(state.D.shoppingList)&&state.D.shoppingList.length>0){
    if(!state.D.shoppingLists)state.D.shoppingLists={};
    state.D.shoppingLists[today()]=state.D.shoppingList;
    state.D.shoppingList=null;
    sched();
  }
  if(!state.D.shoppingLists)state.D.shoppingLists={};
}

export function getActiveDate(){
  return state.calDay||today();
}

function getListForDate(date){
  migrate();
  if(!state.D.shoppingLists[date])state.D.shoppingLists[date]=[];
  return state.D.shoppingLists[date];
}

export function renderShoppingList(){
  if(!state.D)return;
  migrate();
  const el=$('shopping-list-items');if(!el)return;
  const date=getActiveDate();
  const items=getListForDate(date);
  const pending=items.filter(i=>!i.done);
  const done=items.filter(i=>i.done);
  const totalEst=items.filter(i=>i.price>0).reduce((s,i)=>s+i.price*(i.qty||1),0);

  // Update header with date
  const countEl=$('shopping-count');
  const d=new Date(date+'T12:00:00');
  const dateStr=d.toLocaleDateString('ru-RU',{day:'numeric',month:'long'});
  if(countEl)countEl.textContent=dateStr+' · '+pending.length+' позиций'+(totalEst>0?' · ~'+fmt(totalEst):'');

  if(!items.length){
    el.innerHTML=`<div style="color:var(--text2);font-size:12px;padding:8px 0;text-align:center">
      Список на ${dateStr} пуст — добавьте товары ниже
    </div>`;
    return;
  }

  function itemHtml(item){
    const total=item.price>0?(item.price*(item.qty||1)):0;
    return`<div class="shop-item${item.done?' done':''}">
      <label class="shop-check" style="cursor:pointer">
        <input type="checkbox" ${item.done?'checked':''} onchange="window.toggleShopItem('${item.id}',this.checked,'${date}')" style="width:16px;height:16px;accent-color:var(--green);cursor:pointer;flex-shrink:0">
      </label>
      <div class="shop-info">
        <div class="shop-name">${esc(item.name)}</div>
        ${(item.qty>1||item.price>0)?`<div class="shop-meta">${item.qty>1?item.qty+' шт.':''}${item.price>0?' · '+fmt(item.price)+'/шт':''}${total>0?' = '+fmt(total):''}</div>`:''}
      </div>
      <div class="shop-actions">
        <button class="op-btn edit" onclick="window.editShopItem('${item.id}','${date}')" title="Изменить">✎</button>
        <button class="op-btn del" onclick="window.deleteShopItem('${item.id}','${date}')" title="Удалить">✕</button>
      </div>
    </div>`;
  }

  let html='';
  if(pending.length)html+=pending.map(itemHtml).join('');
  if(done.length){
    html+=`<div style="font-size:10px;font-weight:700;color:var(--text2);letter-spacing:.6px;padding:10px 0 4px;border-top:1px solid var(--border);margin-top:4px">КУПЛЕНО (${done.length})</div>`;
    html+=done.map(itemHtml).join('');
  }
  el.innerHTML=html;
}

export function getShoppingStats(date){
  if(!state.D)return{total:0,done:0,pending:0,estimate:0};
  migrate();
  const d=date||today();
  const items=getListForDate(d);
  const done=items.filter(i=>i.done).length;
  const estimate=items.filter(i=>i.price>0).reduce((s,i)=>s+(i.price*(i.qty||1)),0);
  return{total:items.length,done,pending:items.length-done,estimate,date:d};
}

// Get all lists that have pending items (for dashboard)
export function getAllPendingStats(){
  if(!state.D)return[];
  migrate();
  const result=[];
  Object.entries(state.D.shoppingLists||{}).forEach(([date,items])=>{
    const pending=items.filter(i=>!i.done);
    if(pending.length>0)result.push({date,items,pending:pending.length});
  });
  return result.sort((a,b)=>a.date<b.date?-1:1);
}

window.toggleShopItem=function(id,checked,date){
  if(!state.D)return;
  migrate();
  const d=date||getActiveDate();
  const item=getListForDate(d).find(i=>i.id===id);
  if(item){item.done=checked;sched();renderShoppingList();}
  if(window._renderShopWidget)window._renderShopWidget();
};

window.deleteShopItem=function(id,date){
  if(!state.D)return;
  migrate();
  const d=date||getActiveDate();
  state.D.shoppingLists[d]=getListForDate(d).filter(i=>i.id!==id);
  sched();renderShoppingList();
  if(window._renderShopWidget)window._renderShopWidget();
};

window.editShopItem=function(id,date){
  if(!state.D)return;
  migrate();
  const d=date||getActiveDate();
  const item=getListForDate(d).find(i=>i.id===id);
  if(!item)return;
  $('shop-item-id').value=id;
  $('shop-item-date').value=d;
  $('shop-item-name').value=item.name;
  $('shop-item-qty').value=item.qty||1;
  $('shop-item-price').value=item.price||'';
  document.getElementById('modal-shop-item').classList.add('open');
};

window.openAddShopItem=function(){
  if(!state.D)return;
  $('shop-item-id').value='';
  $('shop-item-date').value=getActiveDate();
  $('shop-item-name').value='';
  $('shop-item-qty').value=1;
  $('shop-item-price').value='';
  document.getElementById('modal-shop-item').classList.add('open');
  setTimeout(()=>$('shop-item-name')?.focus(),100);
};

window.saveShopItem=function(){
  if(!state.D)return;
  migrate();
  const id=$('shop-item-id').value;
  const date=$('shop-item-date').value||getActiveDate();
  const name=$('shop-item-name').value.trim();
  if(!name){alert('Введите название');return;}
  const qty=parseFloat($('shop-item-qty').value)||1;
  const price=parseFloat($('shop-item-price').value)||0;
  const list=getListForDate(date);
  if(id){
    const item=list.find(i=>i.id===id);
    if(item){item.name=name;item.qty=qty;item.price=price;}
  }else{
    list.push({id:'sh'+Date.now(),name,qty,price,done:false});
  }
  sched();
  document.getElementById('modal-shop-item').classList.remove('open');
  renderShoppingList();
  if(window._renderShopWidget)window._renderShopWidget();
};

window.clearDoneShopItems=function(){
  if(!state.D)return;
  migrate();
  const d=getActiveDate();
  const list=getListForDate(d);
  const before=list.length;
  const filtered=list.filter(i=>!i.done);
  if(filtered.length===before){alert('Нет выполненных позиций');return;}
  state.D.shoppingLists[d]=filtered;
  sched();renderShoppingList();
  if(window._renderShopWidget)window._renderShopWidget();
};

// Called when calendar day changes
export function onCalendarDayChange(){
  renderShoppingList();
}
