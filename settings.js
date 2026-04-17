import{$,fmt,state,planById,sched,exportData,importData,clearAllOps,today,isPlanned}from'./core.js';

const esc=s=>String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

const WALLET_TYPES={
  debit:  {icon:'💳',label:'Дебетовая карта',   isDebt:false},
  cash:   {icon:'💵',label:'Наличные',           isDebt:false},
  savings:{icon:'🏦',label:'Накопительный счёт', isDebt:false},
  credit: {icon:'🔴',label:'Кредитная карта',    isDebt:true},
  loan:   {icon:'📋',label:'Кредит / ипотека',   isDebt:true},
  debt:   {icon:'🤝',label:'Долг (я должен)',     isDebt:true},
  debt_in:{icon:'🤝',label:'Долг (мне должны)',   isDebt:false}, // мне должны — не кредит
  invest: {icon:'📈',label:'Инвестиционный',      isDebt:false},
  other:  {icon:'📁',label:'Другое',              isDebt:false},
};

// Типы которые показывают блок параметров долга
const DEBT_TYPES=new Set(['credit','loan','debt']);

function walletTypeIcon(w){
  if(w.walletType)return(WALLET_TYPES[w.walletType]?.icon||'💰')+' ';
  return w.balance<0?'🔴 ':'💳 ';
}
function walletTypeLabel(w){
  if(w.walletType)return WALLET_TYPES[w.walletType]?.label||'';
  return w.balance<0?'Кредит/долг':'';
}

// Показать/скрыть блок параметров долга при смене типа
window.onWalletTypeChange=function(type){
  const block=document.getElementById('ew-debt-fields');
  if(block)block.style.display=DEBT_TYPES.has(type)?'block':'none';
};

export function renderSettings(){
  if(!state.D)return;
  $('wallets-settings').innerHTML=state.D.wallets.map((w,i)=>{
    const linkedPlan=state.D.plan.find(p=>p.id===w.planId);
    const typeLabel=walletTypeLabel(w);
    const isDebt=w.balance<0;
    const ls=(state.D.loanSettings||{})[w.id];
    // Показать ставку если есть
    const rateBadge=ls&&ls.rate>0?`<span style="font-size:10px;background:${ls.rate>=20?'var(--red-bg)':'var(--amber-light)'};color:${ls.rate>=20?'var(--red)':'var(--amber-dark)'};padding:1px 6px;border-radius:4px;margin-left:4px;font-weight:700">${ls.rate}%</span>`:'';
    return`<div class="s-row">
      <div style="min-width:0;flex:1">
        <div class="s-name">${walletTypeIcon(w)}${esc(w.name)}${isDebt?'<span class="w-badge" style="margin-left:5px;background:var(--red-bg);color:var(--red);border:1px solid var(--red)">долг</span>':''}${rateBadge}</div>
        <div class="s-meta">${isDebt?'\u2212 ':''}${fmt(Math.abs(w.balance))}${typeLabel?' · '+typeLabel:''}${linkedPlan?' · <span style="color:var(--amber-dark)">→ '+esc(linkedPlan.label)+'</span>':''}</div>
      </div>
      <div style="display:flex;gap:5px;flex-shrink:0"><button class="sbtn blue" onclick="window.openEditWallet(${i})">Изм.</button><button class="sbtn red" onclick="window.delWallet(${i})">Удал.</button></div>
    </div>`;
  }).join('');

  $('plan-settings').innerHTML=state.D.plan.map((p,i)=>`<div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;padding-bottom:8px;border-bottom:1px solid var(--border)">
    <div style="flex:1;min-width:0">
      <div style="font-size:12px;font-weight:700;color:var(--topbar)">${esc(p.label)}</div>
      <div style="font-size:10px;color:var(--text2)">${p.type==='income'?'Накопление':'Расход'}</div>
    </div>
    <input type="number" min="0" max="100" value="${p.pct}" id="pp-${i}" oninput="window.updPT()" style="width:52px;padding:5px;border:1.5px solid var(--border);border-radius:5px;font-size:13px;color:var(--topbar);background:#fff;text-align:right">
    <span style="font-size:13px;color:var(--text2)">%</span>
    <button class="sbtn blue" onclick="window.openEditPlanItem(${i})" style="padding:4px 7px;font-size:11px">✎</button>
    <button class="sbtn red" onclick="window.deletePlanItem(${i})" style="padding:4px 7px;font-size:11px">✕</button>
  </div>`).join('');
  updPT();

  $('income-cats-list').innerHTML=state.D.incomeCats.map((c,i)=>`<div class="s-row">
    <span class="s-name">${esc(c)}</span>
    <button class="sbtn red" onclick="window.delIncomeCat(${i})">Удалить</button>
  </div>`).join('');

  $('expense-cats-list').innerHTML=state.D.expenseCats.map((c,i)=>{
    const pl=planById(c.planId);
    return`<div class="s-row">
      <div><div class="s-name">${esc(c.name)}</div><div class="s-meta">\u2192 ${pl?esc(pl.label):'не привязано'}</div></div>
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
  const opCount=state.D.operations.filter(o=>o.wallet===wallet.id||o.walletTo===wallet.id).length;
  const msg=opCount>0
    ?`Удалить кошелёк "${wallet.name}"? К нему привязаны ${opCount} операций.\n\nПродолжить?`
    :`Удалить кошелёк "${wallet.name}"?`;
  if(!confirm(msg))return;
  state.D.wallets.splice(i,1);
  if(state.walletIdx>=state.D.wallets.length)state.walletIdx=0;
  sched();renderSettings();
}

export function openEditWallet(i){
  const w=state.D.wallets[i];
  $('ew-name').value=w.name;
  $('ew-bal').value=w.balance;
  $('ew-idx').value=i;

  // Тип кошелька
  const typeSel=$('ew-type');
  const wType=w.walletType||'debit';
  if(typeSel)typeSel.value=wType;

  // Показать/скрыть блок параметров долга
  window.onWalletTypeChange(wType);

  // Заполнить параметры долга если есть
  const ls=(state.D.loanSettings||{})[w.id]||{rate:0,payment:0,payDay:25,graceDays:0};
  const rateEl=$('ew-rate');const payEl=$('ew-payment');
  const pdEl=$('ew-payday');const grEl=$('ew-grace');
  if(rateEl)rateEl.value=ls.rate||'';
  if(payEl)payEl.value=ls.payment||'';
  if(pdEl)pdEl.value=ls.payDay||25;
  if(grEl)grEl.value=ls.graceDays||0;

  // Статья финплана
  const planSel=$('ew-plan');
  if(planSel){
    planSel.innerHTML='<option value="">— не привязывать —</option>'+
      state.D.plan.map(p=>`<option value="${p.id}"${p.id===w.planId?' selected':''}>${esc(p.label)} (${p.type==='income'?'откладываем':'расход'})</option>`).join('');
  }
  document.getElementById('modal-wallet').classList.add('open');
}

export function saveWalletEdit(){
  const i=+$('ew-idx').value;
  const w=state.D.wallets[i];
  w.name=$('ew-name').value.trim()||w.name;
  w.balance=parseFloat($('ew-bal').value)||0;

  // Тип кошелька
  const typeSel=$('ew-type');
  const wType=typeSel?typeSel.value:'debit';
  w.walletType=wType;

  // Сохранить параметры долга если долговой тип
  if(DEBT_TYPES.has(wType)){
    if(!state.D.loanSettings)state.D.loanSettings={};
    state.D.loanSettings[w.id]={
      rate:   parseFloat($('ew-rate')?.value)||0,
      payment:parseFloat($('ew-payment')?.value)||0,
      payDay: parseInt($('ew-payday')?.value)||25,
      graceDays:parseInt($('ew-grace')?.value)||0
    };
  }

  // Статья финплана
  const planSel=$('ew-plan');
  if(planSel)w.planId=planSel.value||null;

  sched();
  document.getElementById('modal-wallet').classList.remove('open');
  renderSettings();

  // Перерисовать кредиты если они открыты
  const loansScreen=document.getElementById('screen-loans');
  if(loansScreen&&loansScreen.classList.contains('active')){
    // Импорт через динамический вызов — функции зарегистрированы глобально
    window._refreshCurrentScreen&&window._refreshCurrentScreen();
  }
}

export function addIncomeCat(){
  const v=$('new-inc-cat').value.trim();if(!v)return;
  state.D.incomeCats.push(v);sched();$('new-inc-cat').value='';renderSettings();
}
export function delIncomeCat(i){state.D.incomeCats.splice(i,1);sched();renderSettings();}

export function fillExpPlanSel(id){
  $(id).innerHTML=state.D.plan.filter(p=>p.type==='expense').map(p=>`<option value="${p.id}">${esc(p.label)}</option>`).join('');
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

window.openEditWallet=openEditWallet;
window.delWallet=delWallet;
window.delIncomeCat=delIncomeCat;
window.openEditExpCat=openEditExpCat;

export{exportData,importData,clearAllOps};

// ── Plan item CRUD ─────────────────────────────────────────────────
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
  if(idx>=0){state.D.plan[idx]={...state.D.plan[idx],label,pct,type};}
  else{state.D.plan.push({id:'p'+Date.now(),label,pct,type});}
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

// ── CSV Экспорт ────────────────────────────────────────────────────
export function exportCSV(monthOffset=0){
  if(!state.D)return;
  const now=new Date();
  const dt=new Date(now.getFullYear(),now.getMonth()+monthOffset,1);
  const ym=dt.getFullYear()+'-'+String(dt.getMonth()+1).padStart(2,'0');
  const ops=state.D.operations.filter(o=>o.date&&o.date.startsWith(ym)&&!isPlanned(o.type));
  const lines=['Дата;Тип;Категория;Кошелёк;Сумма;Заметка'];
  ops.sort((a,b)=>a.date>b.date?1:-1).forEach(o=>{
    const type=o.type==='income'?'Доход':o.type==='expense'?'Расход':'Перевод';
    const cat=o.type==='transfer'?`Перевод → ${state.D.wallets.find(w=>w.id===o.walletTo)?.name||'?'}`:o.category||'';
    const wallet=state.D.wallets.find(w=>w.id===o.wallet)?.name||'';
    const amt=o.type==='expense'?-o.amount:o.amount;
    lines.push(`${o.date};${type};${cat};${wallet};${amt};${(o.note||'').replace(/;/g,',')}`);
  });
  const bom='\uFEFF';
  const blob=new Blob([bom+lines.join('\n')],{type:'text/csv;charset=utf-8'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`finance-${ym}.csv`;a.click();
}

export function exportAllCSV(){
  if(!state.D)return;
  const lines=['Дата;Тип;Категория;Кошелёк;Сумма;Заметка'];
  const ops=state.D.operations.filter(o=>!isPlanned(o.type));
  ops.sort((a,b)=>a.date>b.date?1:-1).forEach(o=>{
    const type=o.type==='income'?'Доход':o.type==='expense'?'Расход':'Перевод';
    const cat=o.type==='transfer'?`Перевод → ${state.D.wallets.find(w=>w.id===o.walletTo)?.name||'?'}`:o.category||'';
    const wallet=state.D.wallets.find(w=>w.id===o.wallet)?.name||'';
    const amt=o.type==='expense'?-o.amount:o.amount;
    lines.push(`${o.date||''};${type};${cat};${wallet};${amt};${(o.note||'').replace(/;/g,',')}`);
  });
  const bom='\uFEFF';
  const blob=new Blob([bom+lines.join('\n')],{type:'text/csv;charset=utf-8'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`finance-all-${today()}.csv`;a.click();
}
