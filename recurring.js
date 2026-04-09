import{$,state,sched,fmt,today,isPlanned}from'./core.js';

export function renderRecurring(){
  if(!state.D)return;
  if(!state.D.recurring)state.D.recurring=[];
  const el=$('recurring-list');if(!el)return;
  if(!state.D.recurring.length){
    el.innerHTML='<div style="color:var(--text2);font-size:13px;padding:8px 0">Нет регулярных операций</div>';
    return;
  }
  el.innerHTML=state.D.recurring.map((r,i)=>`<div class="s-row">
    <div>
      <div class="s-name">${r.name}</div>
      <div class="s-meta">${r.type==='income'?'Доход':'Расход'} · ${r.category} · ${r.day}-е число · ${fmt(r.amount)}</div>
    </div>
    <div style="display:flex;gap:5px">
      <button class="sbtn blue" onclick="window.editRecurring(${i})">Изм.</button>
      <button class="sbtn red" onclick="window.deleteRecurring(${i})">Удал.</button>
    </div>
  </div>`).join('');
}

export function applyRecurring(){
  if(!state.D||!state.D.recurring||!state.D.recurring.length)return;
  const now=new Date();
  const ym=now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0');
  let added=0;
  state.D.recurring.forEach(r=>{
    const ds=ym+'-'+String(r.day).padStart(2,'0');
    // Check if already exists this month
    const exists=state.D.operations.some(o=>o.recurringId===r.id&&o.date&&o.date.startsWith(ym));
    if(!exists){
      // Add as planned operation
      state.D.operations.push({
        id:'op'+Date.now()+'_'+Math.random().toString(36).slice(2),
        type:r.type==='income'?'planned_income':'planned_expense',
        amount:r.amount,date:ds,
        category:r.category,
        note:r.name+' (авто)',
        recurringId:r.id
      });
      added++;
    }
  });
  if(added>0){sched();return true;}
  return false;
}

window.saveRecurring=function(){
  if(!state.D.recurring)state.D.recurring=[];
  const idx=+($('rec-idx')?.value||'-1');
  const rec={
    id:idx>=0?state.D.recurring[idx].id:('rec'+Date.now()),
    name:$('rec-name').value.trim(),
    type:$('rec-type').value,
    category:$('rec-cat').value,
    amount:parseFloat($('rec-amount').value)||0,
    day:parseInt($('rec-day').value)||1,
    wallet:$('rec-wallet')?.value||''
  };
  if(!rec.name||!rec.amount){alert('Заполните название и сумму');return;}
  if(idx>=0)state.D.recurring[idx]=rec;else state.D.recurring.push(rec);
  sched();
  document.getElementById('modal-recurring').classList.remove('open');
  renderRecurring();
};

window.deleteRecurring=function(i){
  if(!confirm('Удалить регулярную операцию?'))return;
  state.D.recurring.splice(i,1);sched();renderRecurring();
};

window.editRecurring=function(i){
  const r=state.D.recurring[i];
  $('rec-idx').value=i;
  $('rec-name').value=r.name;
  $('rec-type').value=r.type;
  $('rec-amount').value=r.amount;
  $('rec-day').value=r.day;
  fillRecCats(r.type);
  setTimeout(()=>{$('rec-cat').value=r.category;},10);
  document.getElementById('modal-recurring').classList.add('open');
};

window.openAddRecurring=function(){
  $('rec-idx').value=-1;
  $('rec-name').value='';$('rec-amount').value='';$('rec-day').value=1;
  $('rec-type').value='expense';fillRecCats('expense');
  document.getElementById('modal-recurring').classList.add('open');
};

window.fillRecCats=function(type){
  const cats=type==='income'?state.D.incomeCats:state.D.expenseCats.map(c=>c.name);
  $('rec-cat').innerHTML=cats.map(c=>`<option value="${c}">${c}</option>`).join('');
};
