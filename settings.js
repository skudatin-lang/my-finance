import{$,fmt,state,planById,sched,exportData,importData,clearAllOps}from'./core.js';

export function renderSettings(){
  if(!state.D)return;
  $('wallets-settings').innerHTML=state.D.wallets.map((w,i)=>{
    const linkedPlan=state.D.plan.find(p=>p.id===w.planId);
    return`<div class="s-row">
      <div>
        <div class="s-name">${w.name}${w.balance<0?'<span class="w-badge" style="margin-left:5px">долг</span>':''}</div>
        <div class="s-meta">${w.balance<0?'\u2212 ':''}${fmt(w.balance)}${linkedPlan?' · <span style="color:var(--amber-dark)">→ '+linkedPlan.label+'</span>':''}</div>
      </div>
      <div style="display:flex;gap:5px"><button class="sbtn blue" onclick="window.openEditWallet(${i})">Изм.</button><button class="sbtn red" onclick="window.delWallet(${i})">Удал.</button></div>
    </div>`;
  }).join('');

  $('plan-settings').innerHTML=state.D.plan.map((p,i)=>`<div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;padding-bottom:8px;border-bottom:1px solid var(--border)">
    <div style="flex:1;min-width:0">
      <div style="font-size:12px;font-weight:700;color:var(--topbar)">${p.label}</div>
      <div style="font-size:10px;color:var(--text2)">${p.type==='income'?'Накопление':'Расход'}</div>
    </div>
    <input type="number" min="0" max="100" value="${p.pct}" id="pp-${i}" oninput="window.updPT()" style="width:52px;padding:5px;border:1.5px solid var(--border);border-radius:5px;font-size:13px;color:var(--topbar);background:#fff;text-align:right">
    <span style="font-size:13px;color:var(--text2)">%</span>
    <button class="sbtn blue" onclick="window.openEditPlanItem(${i})" style="padding:4px 7px;font-size:11px" title="Изменить">✎</button>
    <button class="sbtn red" onclick="window.deletePlanItem(${i})" style="padding:4px 7px;font-size:11px" title="Удалить">✕</button>
  </div>`).join('');
  updPT();

  $('income-cats-list').innerHTML=state.D.incomeCats.map((c,i)=>`<div class="s-row">
    <span class="s-name">${c}</span>
    <button class="sbtn red" onclick="window.delIncomeCat(${i})">Удалить</button>
  </div>`).join('');

  $('expense-cats-list').innerHTML=state.D.expenseCats.map((c,i)=>{
    const pl=planById(c.planId);
    return`<div class="s-row">
      <div><div class="s-name">${c.name}</div><div class="s-meta">\u2192 ${pl?pl.label:'не привязано'}</div></div>
      <div style="display:flex;gap:5px"><button class="sbtn blue" onclick="window.openEditExpCat(${i})">Изм.</button><button class="sbtn red" onclick="window.delExpCat(${i})">Удал.</button></div>
    </div>`;
  }).join('');
}

export function updPT(){
  let t=0;
  state.D.plan.forEach((_,i)=>{const e=$('pp-'+i);if(e)t+=parseFloat(e.value)||0;});
  const e=$('plan-total-pct');
  if(e){e.textContent=Math.round(t)+'%';e.style.color=Math.round(t)===100?'var(--green)':'var(--red)';}
}

export function savePlanSettings(){
  let t=0;
  state.D.plan.forEach((p,i)=>{const e=$('pp-'+i);const v=parseFloat(e?.value)||0;p.pct=v;t+=v;});
  if(Math.round(t)!==100){alert('Сумма должна быть 100%. Сейчас: '+Math.round(t)+'%');return;}
  sched();alert('План сохранён');
}

export function addWallet(){
  const n=$('nw-name').value.trim(),b=parseFloat($('nw-bal').value)||0;
  if(!n)return;
  state.D.wallets.push({id:'w'+Date.now(),name:n,balance:b});
  sched();$('nw-name').value='';$('nw-bal').value='';renderSettings();
}

export function delWallet(i){
  if(state.D.wallets.length<=1){alert('Нужен хотя бы один кошелёк');return;}
  const wallet=state.D.wallets[i];
  // FIX: warn if wallet has linked operations
  const opCount=state.D.operations.filter(o=>o.wallet===wallet.id||o.walletTo===wallet.id).length;
  const msg=opCount>0
    ?`Удалить кошелёк "${wallet.name}"? К нему привязаны ${opCount} операций — они останутся в истории, но кошелёк будет отображаться как "?".\n\nПродолжить?`
    :`Удалить кошелёк "${wallet.name}"?`;
  if(!confirm(msg))return;
  state.D.wallets.splice(i,1);
  if(state.walletIdx>=state.D.wallets.length)state.walletIdx=0;
  sched();renderSettings();
}

export function openEditWallet(i){
  const w=state.D.wallets[i];
  $('ew-name').value=w.name;$('ew-bal').value=w.balance;$('ew-idx').value=i;
  const planSel=$('ew-plan');
  if(planSel){
    planSel.innerHTML='<option value="">— не привязывать —</option>'+
      state.D.plan.map(p=>`<option value="${p.id}"${p.id===w.planId?' selected':''}>${p.label} (${p.type==='income'?'откладываем':'расход'})</option>`).join('');
  }
  document.getElementById('modal-wallet').classList.add('open');
}

export function saveWalletEdit(){
  const i=+$('ew-idx').value;
  state.D.wallets[i].name=$('ew-name').value.trim()||state.D.wallets[i].name;
  state.D.wallets[i].balance=parseFloat($('ew-bal').value)||0;
  const planSel=$('ew-plan');
  if(planSel)state.D.wallets[i].planId=planSel.value||null;
  sched();document.getElementById('modal-wallet').classList.remove('open');renderSettings();
}

export function addIncomeCat(){
  const v=$('new-inc-cat').value.trim();if(!v)return;
  state.D.incomeCats.push(v);sched();$('new-inc-cat').value='';renderSettings();
}
export function delIncomeCat(i){state.D.incomeCats.splice(i,1);sched();renderSettings();}

export function fillExpPlanSel(id){
  $(id).innerHTML=state.D.plan.filter(p=>p.type==='expense').map(p=>`<option value="${p.id}">${p.label}</option>`).join('');
}
export function openEditExpCat(i){
  const c=state.D.expenseCats[i];
  $('exp-cat-modal-title').textContent='ИЗМЕНИТЬ КАТЕГОРИЮ';
  $('ec-name').value=c.name;$('ec-idx').value=i;
  fillExpPlanSel('ec-plan');$('ec-plan').value=c.planId;
  document.getElementById('modal-exp-cat').classList.add('open');
}
export function saveExpCat(){
  const name=$('ec-name').value.trim(),planId=$('ec-plan').value,idx=+$('ec-idx').value;
  if(!name)return;
  if(idx>=0)state.D.expenseCats[idx]={name,planId};else state.D.expenseCats.push({name,planId});
  sched();document.getElementById('modal-exp-cat').classList.remove('open');renderSettings();
}
export function delExpCat(i){state.D.expenseCats.splice(i,1);sched();renderSettings();}

// expose for window.* calls from HTML
window.openEditWallet=openEditWallet;
window.delWallet=delWallet;
window.delIncomeCat=delIncomeCat;
window.openEditExpCat=openEditExpCat;

export{exportData,importData,clearAllOps};

// ── Plan item CRUD ─────────────────────────────────────────
export function openAddPlanItem(){
  const modal=document.getElementById('modal-plan-item');if(!modal)return;
  document.getElementById('plan-item-modal-title').textContent='НОВАЯ СТАТЬЯ ФИНПЛАНА';
  document.getElementById('pi-idx').value=-1;
  document.getElementById('pi-label').value='';
  document.getElementById('pi-pct').value='';
  document.getElementById('pi-type').value='expense';
  modal.classList.add('open');
}
export function openEditPlanItem(i){
  const p=state.D.plan[i];if(!p)return;
  const modal=document.getElementById('modal-plan-item');if(!modal)return;
  document.getElementById('plan-item-modal-title').textContent='ИЗМЕНИТЬ СТАТЬЮ';
  document.getElementById('pi-idx').value=i;
  document.getElementById('pi-label').value=p.label;
  document.getElementById('pi-pct').value=p.pct;
  document.getElementById('pi-type').value=p.type;
  modal.classList.add('open');
}
export function savePlanItem(){
  const label=document.getElementById('pi-label')?.value.trim();
  const pct=parseFloat(document.getElementById('pi-pct')?.value)||0;
  const type=document.getElementById('pi-type')?.value||'expense';
  if(!label){alert('Введите название статьи');return;}
  const idx=+(document.getElementById('pi-idx')?.value??'-1');
  if(idx>=0){
    state.D.plan[idx]={...state.D.plan[idx],label,pct,type};
  }else{
    state.D.plan.push({id:'p'+Date.now(),label,pct,type});
  }
  sched();
  document.getElementById('modal-plan-item').classList.remove('open');
  renderSettings();
}
export function deletePlanItem(i){
  if(!confirm('Удалить статью «'+state.D.plan[i]?.label+'»?\nКатегории потеряют привязку.'))return;
  state.D.plan.splice(i,1);sched();renderSettings();
}
window.openEditPlanItem=openEditPlanItem;
window.deletePlanItem=deletePlanItem;
window.openAddPlanItem=openAddPlanItem;
window.savePlanItem=savePlanItem;
