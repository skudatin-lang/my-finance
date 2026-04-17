import{$,state,sched,fmt,today}from'./core.js';

// ── Helpers ───────────────────────────────────────────────────────────────
const esc=s=>String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

// ── renderSettings ────────────────────────────────────────────────────────
export function renderSettings(){
  if(!state.D)return;
  _renderWallets();
  _renderPlan();
  _renderIncomeCats();
  _renderExpenseCats();
  updPT();
}

function _renderWallets(){
  const el=$('wallets-settings');if(!el)return;
  if(!state.D.wallets.length){el.innerHTML='<div style="color:var(--text2);font-size:13px">Нет кошельков</div>';return;}
  el.innerHTML=state.D.wallets.map((w,i)=>{
    const typeLabel={debit:'💳',cash:'💵',savings:'🏦',credit:'🔴',loan:'📋',debt:'🤝',debt_in:'🤝',invest:'📈',other:'📁'}[w.type||'debit']||'💳';
    const debtInfo=w.rate?` · ${w.rate}% · ${fmt(w.payment||0)}/мес`:'';
    return`<div class="s-row">
      <div>
        <div class="s-name">${typeLabel} ${esc(w.name)}</div>
        <div class="s-meta">${w.balance<0?'Долг: ':''}<span style="color:${w.balance<0?'var(--red)':'var(--green-dark)'}">${fmt(w.balance)}</span>${debtInfo}</div>
      </div>
      <div style="display:flex;gap:5px">
        <button class="sbtn blue" onclick="window.openEditWallet(${i})">Изм.</button>
        <button class="sbtn red" onclick="window.delWallet(${i})">Удал.</button>
      </div>
    </div>`;
  }).join('');
}

function _renderPlan(){
  const el=$('plan-settings');if(!el)return;
  if(!state.D.plan.length){el.innerHTML='<div style="color:var(--text2);font-size:13px">Нет статей</div>';return;}
  el.innerHTML=state.D.plan.map((p,i)=>`<div class="s-row">
    <div>
      <div class="s-name">${esc(p.label)}</div>
      <div class="s-meta">${p.pct}% · ${p.type==='income'?'Накопление':'Расход'}</div>
    </div>
    <div style="display:flex;gap:5px">
      <button class="sbtn blue" onclick="window.openEditPlanItem(${i})">Изм.</button>
      <button class="sbtn red" onclick="window.deletePlanItem(${i})">Удал.</button>
    </div>
  </div>`).join('');
  updPT();
}

function _renderIncomeCats(){
  const el=$('income-cats-list');if(!el)return;
  el.innerHTML=state.D.incomeCats.map((c,i)=>`<div class="s-row">
    <span class="s-name">${esc(c)}</span>
    <button class="sbtn red" onclick="window.delIncomeCat(${i})">Удал.</button>
  </div>`).join('');
}

function _renderExpenseCats(){
  const el=$('expense-cats-list');if(!el)return;
  el.innerHTML=state.D.expenseCats.map((c,i)=>{
    const p=state.D.plan.find(p=>p.id===c.planId);
    return`<div class="s-row">
      <div>
        <div class="s-name">${esc(c.name)}</div>
        <div class="s-meta">${p?p.label:'—'}</div>
      </div>
      <div style="display:flex;gap:5px">
        <button class="sbtn blue" onclick="window.openEditExpCat(${i})">Изм.</button>
        <button class="sbtn red" onclick="window.delExpCat(${i})">Удал.</button>
      </div>
    </div>`;
  }).join('');
}

// ── Plan total % ──────────────────────────────────────────────────────────
export function updPT(){
  const el=$('plan-total-pct');if(!el||!state.D)return;
  const total=state.D.plan.reduce((s,p)=>s+p.pct,0);
  el.textContent=total+'%';
  el.style.color=total===100?'var(--green-dark)':total>100?'var(--red)':'var(--orange-dark)';
}

// ── Plan settings (save all at once via inputs) ───────────────────────────
export function savePlanSettings(){
  if(!state.D)return;
  sched();
  alert('Финансовый план сохранён');
}

// ── Wallets ───────────────────────────────────────────────────────────────
export function addWallet(){
  if(!state.D)return;
  const name=$('nw-name')?.value.trim();
  if(!name){alert('Введите название кошелька');return;}
  const bal=parseFloat($('nw-bal')?.value)||0;
  state.D.wallets.push({id:'w'+Date.now(),name,balance:bal,type:'debit'});
  sched();
  if($('nw-name'))$('nw-name').value='';
  if($('nw-bal'))$('nw-bal').value='';
  _renderWallets();
}

export function delWallet(i){
  if(!state.D)return;
  const w=state.D.wallets[i];if(!w)return;
  if(!confirm(`Удалить кошелёк «${w.name}»?`))return;
  state.D.wallets.splice(i,1);
  sched();_renderWallets();
}

export function openEditWallet(i){
  if(!state.D)return;
  const w=state.D.wallets[i];if(!w)return;
  $('ew-name').value=w.name;
  $('ew-bal').value=w.balance;
  $('ew-idx').value=i;
  const typeEl=$('ew-type');if(typeEl)typeEl.value=w.type||'debit';
  const rateEl=$('ew-rate');if(rateEl)rateEl.value=w.rate||'';
  const payEl=$('ew-payment');if(payEl)payEl.value=w.payment||'';
  const pdEl=$('ew-payday');if(pdEl)pdEl.value=w.payDay||'';
  const grEl=$('ew-grace');if(grEl)grEl.value=w.gracePeriod||'';
  // Fill plan selector
  const planSel=$('ew-plan');
  if(planSel){
    planSel.innerHTML='<option value="">— не привязывать —</option>'+
      state.D.plan.filter(p=>p.type==='income').map(p=>`<option value="${p.id}"${w.planId===p.id?' selected':''}>${esc(p.label)}</option>`).join('');
  }
  window.onWalletTypeChange&&window.onWalletTypeChange(w.type||'debit');
  document.getElementById('modal-wallet').classList.add('open');
}

export function saveWalletEdit(){
  if(!state.D)return;
  const i=parseInt($('ew-idx')?.value);
  if(isNaN(i)||!state.D.wallets[i])return;
  const w=state.D.wallets[i];
  const oldBal=w.balance;
  const newBal=parseFloat($('ew-bal')?.value)||0;
  w.name=$('ew-name')?.value.trim()||w.name;
  w.balance=newBal;
  w.type=$('ew-type')?.value||'debit';
  const rate=parseFloat($('ew-rate')?.value)||0;
  if(rate)w.rate=rate; else delete w.rate;
  const pay=parseFloat($('ew-payment')?.value)||0;
  if(pay)w.payment=pay; else delete w.payment;
  const pd=parseInt($('ew-payday')?.value)||0;
  if(pd)w.payDay=pd; else delete w.payDay;
  const gr=parseInt($('ew-grace')?.value)||0;
  if(gr)w.gracePeriod=gr; else delete w.gracePeriod;
  const planId=$('ew-plan')?.value||'';
  if(planId)w.planId=planId; else delete w.planId;
  sched();
  document.getElementById('modal-wallet').classList.remove('open');
  renderSettings();
}

// Expose for HTML onchange
window.onWalletTypeChange=function(type){
  const debtTypes=['credit','loan','debt'];
  const fields=$('ew-debt-fields');
  if(fields)fields.style.display=''; // always visible per HTML
};

// ── Income categories ─────────────────────────────────────────────────────
export function addIncomeCat(){
  if(!state.D)return;
  const el=$('new-inc-cat');
  const name=el?.value.trim();
  if(!name){alert('Введите название');return;}
  if(state.D.incomeCats.includes(name)){alert('Категория уже существует');return;}
  state.D.incomeCats.push(name);
  sched();if(el)el.value='';
  _renderIncomeCats();
}

export function delIncomeCat(i){
  if(!state.D)return;
  if(!confirm(`Удалить категорию «${state.D.incomeCats[i]}»?`))return;
  state.D.incomeCats.splice(i,1);
  sched();_renderIncomeCats();
}

// ── Expense categories ────────────────────────────────────────────────────
export function fillExpPlanSel(selId){
  const sel=$(selId);if(!sel||!state.D)return;
  sel.innerHTML=state.D.plan.map(p=>`<option value="${p.id}">${esc(p.label)}</option>`).join('');
}

export function openEditExpCat(i){
  if(!state.D)return;
  const c=state.D.expenseCats[i];if(!c)return;
  $('exp-cat-modal-title').textContent='РЕДАКТИРОВАТЬ КАТЕГОРИЮ';
  $('ec-name').value=c.name;
  $('ec-idx').value=i;
  fillExpPlanSel('ec-plan');
  setTimeout(()=>{if($('ec-plan'))$('ec-plan').value=c.planId||'';},10);
  document.getElementById('modal-exp-cat').classList.add('open');
}

export function saveExpCat(){
  if(!state.D)return;
  const name=$('ec-name')?.value.trim();
  if(!name){alert('Введите название');return;}
  const planId=$('ec-plan')?.value||'';
  const idx=parseInt($('ec-idx')?.value);
  if(idx>=0&&state.D.expenseCats[idx]){
    state.D.expenseCats[idx].name=name;
    state.D.expenseCats[idx].planId=planId;
  }else{
    state.D.expenseCats.push({name,planId});
  }
  sched();
  document.getElementById('modal-exp-cat').classList.remove('open');
  _renderExpenseCats();
}

export function delExpCat(i){
  if(!state.D)return;
  if(!confirm(`Удалить категорию «${state.D.expenseCats[i]?.name}»?`))return;
  state.D.expenseCats.splice(i,1);
  sched();_renderExpenseCats();
}

// ── Plan items ────────────────────────────────────────────────────────────
export function openAddPlanItem(){
  $('plan-item-modal-title').textContent='НОВАЯ СТАТЬЯ';
  $('pi-label').value='';$('pi-pct').value='';$('pi-type').value='expense';$('pi-idx').value=-1;
  document.getElementById('modal-plan-item').classList.add('open');
}

export function openEditPlanItem(i){
  if(!state.D||!state.D.plan[i])return;
  const p=state.D.plan[i];
  $('plan-item-modal-title').textContent='РЕДАКТИРОВАТЬ СТАТЬЮ';
  $('pi-label').value=p.label;$('pi-pct').value=p.pct;$('pi-type').value=p.type||'expense';$('pi-idx').value=i;
  document.getElementById('modal-plan-item').classList.add('open');
}

export function savePlanItem(){
  if(!state.D)return;
  const label=$('pi-label')?.value.trim();
  if(!label){alert('Введите название');return;}
  const pct=parseFloat($('pi-pct')?.value)||0;
  const type=$('pi-type')?.value||'expense';
  const idx=parseInt($('pi-idx')?.value);
  if(idx>=0&&state.D.plan[idx]){
    state.D.plan[idx].label=label;state.D.plan[idx].pct=pct;state.D.plan[idx].type=type;
  }else{
    state.D.plan.push({id:'p'+Date.now(),label,pct,type});
  }
  sched();
  document.getElementById('modal-plan-item').classList.remove('open');
  _renderPlan();updPT();
}

export function deletePlanItem(i){
  if(!state.D)return;
  if(!confirm(`Удалить статью «${state.D.plan[i]?.label}»?`))return;
  state.D.plan.splice(i,1);
  sched();_renderPlan();updPT();
}

// ── CSV Export ────────────────────────────────────────────────────────────
export function exportCSV(off){
  if(!state.D)return;
  const dt=new Date(new Date().getFullYear(),new Date().getMonth()+(off||0),1);
  const ym=dt.getFullYear()+'-'+String(dt.getMonth()+1).padStart(2,'0');
  const ops=state.D.operations.filter(o=>o.date&&o.date.startsWith(ym));
  _downloadCSV(ops,'finances-'+ym+'.csv');
}

export function exportAllCSV(){
  if(!state.D)return;
  _downloadCSV(state.D.operations,'finances-all-'+today()+'.csv');
}

function _downloadCSV(ops,filename){
  const rows=[['Дата','Тип','Категория','Сумма','Кошелёк','Заметка']];
  ops.forEach(o=>{
    const w=state.D.wallets.find(w=>w.id===o.wallet);
    rows.push([o.date||'',o.type,o.category||'',o.amount,w?w.name:'',o.note||'']);
  });
  const csv=rows.map(r=>r.map(v=>'"'+String(v).replace(/"/g,'""')+'"').join(',')).join('\n');
  const b=new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'});
  const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download=filename;a.click();
}
