import{state,sched,today}from'./core.js';

export function renderShoppingList(){
  const el=document.getElementById('shopping-content');
  if(!el||!state.D)return;
  if(!state.D.shoppingList)state.D.shoppingList=[];

  const items=state.D.shoppingList;
  const active=items.filter(i=>!i.done);
  const done=items.filter(i=>i.done);

  el.innerHTML=`
    <div style="display:flex;gap:8px;margin-bottom:14px">
      <input class="fi" id="shop-input" placeholder="Добавить товар..." style="flex:1"
        onkeydown="if(event.key==='Enter')window.addShopItem()">
      <input class="fi" id="shop-amount" type="number" placeholder="₽" style="width:80px"
        onkeydown="if(event.key==='Enter')window.addShopItem()">
      <button class="sbtn amber" onclick="window.addShopItem()" style="padding:0 14px">+</button>
    </div>

    ${active.length===0&&done.length===0?`<div style="color:var(--text2);font-size:13px;text-align:center;padding:20px 0">Список пуст. Добавьте товары выше.</div>`:''}

    ${active.length?`
      <div style="font-size:11px;font-weight:700;color:var(--text2);letter-spacing:.6px;margin-bottom:8px">
        НУЖНО КУПИТЬ (${active.length})
        ${active.filter(i=>i.amount).reduce((s,i)=>s+i.amount,0)>0?
          ` · <span style="color:var(--topbar)">≈ ₽${active.filter(i=>i.amount).reduce((s,i)=>s+i.amount,0).toLocaleString('ru-RU')}</span>`:''}
      </div>
      ${active.map((item,idx)=>shopItemHtml(item,idx,false)).join('')}`:''}

    ${done.length?`
      <div style="font-size:11px;font-weight:700;color:var(--text2);letter-spacing:.6px;margin:14px 0 8px;display:flex;justify-content:space-between">
        <span>КУПЛЕНО (${done.length})</span>
        <button onclick="window.clearDoneItems()" style="background:none;border:none;color:var(--red);font-size:11px;cursor:pointer;font-weight:700">Очистить</button>
      </div>
      ${done.map((item,idx)=>shopItemHtml(item,items.indexOf(item),true)).join('')}`:''}
  `;
}

function shopItemHtml(item,idx,done){
  return`<div style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:var(--card);border:1.5px solid var(--border2);border-radius:8px;margin-bottom:6px;${done?'opacity:.6':''}">
    <input type="checkbox" ${done?'checked':''} onchange="window.toggleShopItem(${idx})"
      style="width:18px;height:18px;accent-color:var(--amber);flex-shrink:0;cursor:pointer">
    <span style="flex:1;font-size:13px;color:var(--topbar);${done?'text-decoration:line-through':''}">${item.name}</span>
    ${item.amount?`<span style="font-size:12px;font-weight:700;color:var(--text2)">₽${item.amount.toLocaleString('ru-RU')}</span>`:''}
    <button onclick="window.deleteShopItem(${idx})" style="background:none;border:none;color:var(--text2);cursor:pointer;font-size:16px;line-height:1;padding:0 4px">×</button>
  </div>`;
}

window.addShopItem=function(){
  const input=document.getElementById('shop-input');
  const amtInput=document.getElementById('shop-amount');
  const name=input?.value.trim();
  if(!name||!state.D)return;
  if(!state.D.shoppingList)state.D.shoppingList=[];
  state.D.shoppingList.unshift({
    id:'sh'+Date.now(),name,
    amount:parseFloat(amtInput?.value)||0,
    done:false,addedDate:today()
  });
  input.value='';if(amtInput)amtInput.value='';
  sched();renderShoppingList();renderShoppingWidget();
};

window.toggleShopItem=function(idx){
  if(!state.D.shoppingList[idx])return;
  state.D.shoppingList[idx].done=!state.D.shoppingList[idx].done;
  state.D.shoppingList[idx].doneDate=state.D.shoppingList[idx].done?today():null;
  sched();renderShoppingList();renderShoppingWidget();
};

window.deleteShopItem=function(idx){
  state.D.shoppingList.splice(idx,1);
  sched();renderShoppingList();renderShoppingWidget();
};

window.clearDoneItems=function(){
  state.D.shoppingList=state.D.shoppingList.filter(i=>!i.done);
  sched();renderShoppingList();renderShoppingWidget();
};

window.dashAddShopItem=function(){
  const input=document.getElementById('dash-shop-input');
  const name=input?.value?.trim();
  if(!name||!state.D)return;
  if(!state.D.shoppingList)state.D.shoppingList=[];
  state.D.shoppingList.unshift({id:'sh'+Date.now(),name,amount:0,done:false,addedDate:today()});
  input.value='';
  sched();renderShoppingWidget();
};

// ── Dashboard widget ─────────────────────────────────────────────
export function renderShoppingWidget(){
  const el=document.getElementById('dash-shopping');
  if(!el||!state.D)return;
  const items=state.D.shoppingList||[];
  const active=items.filter(i=>!i.done);
  const total=active.filter(i=>i.amount).reduce((s,i)=>s+i.amount,0);
  el.innerHTML=`
    <div style="display:flex;gap:6px;margin-bottom:8px">
      <input id="dash-shop-input" class="fi" placeholder="Добавить..." style="flex:1;height:30px;font-size:12px;padding:4px 8px"
        onkeydown="if(event.key==='Enter')window.dashAddShopItem()">
      <button onclick="window.dashAddShopItem()" style="background:var(--amber);border:none;color:#fff;border-radius:6px;padding:4px 10px;font-size:12px;cursor:pointer;font-weight:700">+</button>
    </div>
    ${!active.length?'<div style="color:var(--text2);font-size:12px;text-align:center;padding:4px 0">Список пуст</div>':''}
    ${active.slice(0,4).map(i=>`
      <div style="display:flex;align-items:center;gap:6px;padding:4px 0;border-bottom:.5px solid var(--border)">
        <input type="checkbox" onchange="window.toggleShopItem(${items.indexOf(i)})"
          style="accent-color:var(--amber);cursor:pointer;flex-shrink:0;width:16px;height:16px">
        <span style="font-size:12px;color:var(--topbar);flex:1">${i.name}</span>
        ${i.amount?`<span style="font-size:11px;color:var(--text2)">₽${i.amount.toLocaleString('ru-RU')}</span>`:''}
      </div>`).join('')}
    ${active.length>4?`<div style="font-size:10px;color:var(--amber);margin-top:4px;cursor:pointer" onclick="window.showScreen('shopping')">+${active.length-4} ещё →</div>`:''}
    ${total?`<div style="font-size:11px;color:var(--text2);margin-top:4px;text-align:right">Итого ≈ ₽${total.toLocaleString('ru-RU')}</div>`:''}
  `;
}
