import{$,state,sched,fmt}from'./core.js';

export function renderShoppingList(){
  if(!state.D)return;
  if(!state.D.shoppingList)state.D.shoppingList=[];
  const el=$('shopping-list-items');if(!el)return;
  const items=state.D.shoppingList;
  const pending=items.filter(i=>!i.done);
  const done=items.filter(i=>i.done);
  const totalEst=items.filter(i=>i.price>0).reduce((s,i)=>s+i.price*(i.qty||1),0);
  const countEl=$('shopping-count');
  if(countEl)countEl.textContent=pending.length+' позиций'+(totalEst>0?' · ~'+fmt(totalEst):'');
  if(!items.length){
    el.innerHTML='<div style="color:var(--text2);font-size:12px;padding:8px 0;text-align:center">Список пуст — добавьте товары ниже</div>';
    return;
  }
  function itemHtml(item){
    const total=item.price>0?(item.price*(item.qty||1)):0;
    return`<div class="shop-item${item.done?' done':''}">
      <label class="shop-check" style="cursor:pointer">
        <input type="checkbox" ${item.done?'checked':''} onchange="window.toggleShopItem('${item.id}',this.checked)" style="width:16px;height:16px;accent-color:var(--green);cursor:pointer;flex-shrink:0">
      </label>
      <div class="shop-info">
        <div class="shop-name">${item.name}</div>
        ${(item.qty>1||item.price>0)?`<div class="shop-meta">${item.qty>1?item.qty+' шт.':''}${item.price>0?' · '+fmt(item.price)+'/шт':''}${total>0?' = '+fmt(total):''}</div>`:''}
      </div>
      <div class="shop-actions">
        <button class="op-btn edit" onclick="window.editShopItem('${item.id}')" title="Изменить">✎</button>
        <button class="op-btn del" onclick="window.deleteShopItem('${item.id}')" title="Удалить">✕</button>
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

export function getShoppingStats(){
  if(!state.D||!state.D.shoppingList)return{total:0,done:0,pending:0,estimate:0};
  const items=state.D.shoppingList;
  const done=items.filter(i=>i.done).length;
  const estimate=items.filter(i=>i.price>0).reduce((s,i)=>s+(i.price*(i.qty||1)),0);
  return{total:items.length,done,pending:items.length-done,estimate};
}

window.toggleShopItem=function(id,checked){
  if(!state.D||!state.D.shoppingList)return;
  const item=state.D.shoppingList.find(i=>i.id===id);
  if(item){item.done=checked;sched();renderShoppingList();}
  if(window._renderShopWidget)window._renderShopWidget();
};

window.deleteShopItem=function(id){
  if(!state.D||!state.D.shoppingList)return;
  state.D.shoppingList=state.D.shoppingList.filter(i=>i.id!==id);
  sched();renderShoppingList();
  if(window._renderShopWidget)window._renderShopWidget();
};

window.editShopItem=function(id){
  if(!state.D||!state.D.shoppingList)return;
  const item=state.D.shoppingList.find(i=>i.id===id);
  if(!item)return;
  $('shop-item-id').value=id;
  $('shop-item-name').value=item.name;
  $('shop-item-qty').value=item.qty||1;
  $('shop-item-price').value=item.price||'';
  document.getElementById('modal-shop-item').classList.add('open');
};

window.openAddShopItem=function(){
  if(!state.D)return;
  $('shop-item-id').value='';
  $('shop-item-name').value='';
  $('shop-item-qty').value=1;
  $('shop-item-price').value='';
  document.getElementById('modal-shop-item').classList.add('open');
  setTimeout(()=>$('shop-item-name')?.focus(),100);
};

window.saveShopItem=function(){
  if(!state.D)return;
  if(!state.D.shoppingList)state.D.shoppingList=[];
  const id=$('shop-item-id').value;
  const name=$('shop-item-name').value.trim();
  if(!name){alert('Введите название');return;}
  const qty=parseFloat($('shop-item-qty').value)||1;
  const price=parseFloat($('shop-item-price').value)||0;
  if(id){
    const item=state.D.shoppingList.find(i=>i.id===id);
    if(item){item.name=name;item.qty=qty;item.price=price;}
  }else{
    state.D.shoppingList.push({id:'sh'+Date.now(),name,qty,price,done:false});
  }
  sched();
  document.getElementById('modal-shop-item').classList.remove('open');
  renderShoppingList();
  if(window._renderShopWidget)window._renderShopWidget();
};

window.clearDoneShopItems=function(){
  if(!state.D||!state.D.shoppingList)return;
  const before=state.D.shoppingList.length;
  state.D.shoppingList=state.D.shoppingList.filter(i=>!i.done);
  if(state.D.shoppingList.length===before){alert('Нет выполненных позиций');return;}
  sched();renderShoppingList();
  if(window._renderShopWidget)window._renderShopWidget();
};
