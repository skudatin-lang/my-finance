import{$,fmt,state,sched,today,isPlanned,wName}from'./core.js';

export function renderTemplates(){
  if(!state.D)return;
  if(!state.D.templates)state.D.templates=[];
  const el=$('templates-list');if(!el)return;

  if(!state.D.templates.length){
    el.innerHTML='<div style="color:var(--text2);font-size:13px;padding:8px 0">Нет шаблонов. Создайте шаблон для быстрого добавления частых операций.</div>';
    return;
  }

  el.innerHTML=state.D.templates.map((t,i)=>{
    const isInc=t.type==='income';
    const color=isInc?'var(--green-dark)':'var(--orange-dark)';
    const bg=isInc?'var(--green-bg)':'var(--orange-bg)';
    const border=isInc?'var(--green)':'var(--orange)';
    // FIX: use imported wName from core.js
    const walletName=t.wallet?wName(t.wallet):'';
    return`<div style="background:${bg};border:1.5px solid ${border};border-radius:10px;padding:12px 14px;margin-bottom:10px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start">
        <div style="flex:1">
          <div style="font-size:14px;font-weight:700;color:${color}">${t.name}</div>
          <div style="font-size:11px;color:var(--text2);margin-top:2px">${t.type==='income'?'Доход':'Расход'} · ${t.category} · ${walletName}</div>
          ${t.items&&t.items.length>1?`<div style="font-size:10px;color:var(--text2);margin-top:2px">${t.items.length} позиций · итого ${fmt(t.items.reduce((s,it)=>s+it.amount,0))}</div>`:`<div style="font-size:13px;font-weight:700;color:${color};margin-top:2px">${fmt(t.amount)}</div>`}
        </div>
        <div style="display:flex;gap:5px;align-items:center">
          <button onclick="window.applyTemplate(${i})" style="background:${color};border:none;color:#fff;border-radius:7px;padding:7px 14px;font-size:12px;font-weight:700;cursor:pointer">Применить</button>
          <button class="sbtn blue" onclick="window.editTemplate(${i})">Изм.</button>
          <button class="sbtn red" onclick="window.deleteTemplate(${i})">✕</button>
        </div>
      </div>
    </div>`;
  }).join('');
}

window.applyTemplate=function(i){
  const t=state.D.templates[i];
  if(t.items&&t.items.length>1){applyBulk(t);}
  else{applySingle(t);}
};

function applySingle(t){
  const amount=t.amount;
  const op={
    id:'op'+Date.now(),type:t.type,amount,
    date:today(),wallet:t.wallet,category:t.category,
    note:t.name+' (шаблон)'
  };
  const w=state.D.wallets.find(w=>w.id===t.wallet);
  if(w){if(t.type==='income')w.balance+=amount;else w.balance-=amount;}
  state.D.operations.push(op);
  sched();
  showToast(`Добавлено: ${t.name} · ${fmt(amount)}`);
  const cur=document.querySelector('.screen.active')?.id?.replace('screen-','');
  if(cur&&window['render'+capitalize(cur)])window['render'+capitalize(cur)]();
}

function applyBulk(t){openBulkModal(t);}

function capitalize(s){return s?s.charAt(0).toUpperCase()+s.slice(1):'';}

function showToast(msg){
  // FIX: reuse existing toast element if already present (don't create duplicates)
  let toast=document.getElementById('app-toast');
  if(!toast){
    toast=document.createElement('div');
    toast.id='app-toast';
    toast.style.cssText='position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:var(--topbar);color:#fff;padding:10px 20px;border-radius:8px;font-size:13px;font-weight:600;z-index:999;opacity:0;transition:opacity .3s;pointer-events:none;white-space:nowrap;';
    document.body.appendChild(toast);
  }
  // Clear any pending hide timer
  if(toast._hideTimer)clearTimeout(toast._hideTimer);
  toast.textContent=msg;
  toast.style.opacity='1';
  toast._hideTimer=setTimeout(()=>{toast.style.opacity='0';},2500);
}

function openBulkModal(template){
  if(!template&&!state.D)return;
  const modal=document.getElementById('modal-bulk');if(!modal)return;
  $('bulk-name').value=template?template.name:'Групповая операция';
  $('bulk-type').value=template?template.type:'expense';
  $('bulk-wallet').innerHTML=state.D.wallets.map(w=>`<option value="${w.id}"${template&&w.id===template.wallet?' selected':''}>${w.name}</option>`).join('');
  $('bulk-date').value=today();
  const items=template&&template.items?template.items:[{category:'',amount:''}];
  renderBulkItems(items);
  modal.classList.add('open');
}

function renderBulkItems(items){
  const el=$('bulk-items');if(!el)return;
  el.innerHTML=items.map((it,i)=>`<div style="display:flex;gap:8px;margin-bottom:8px;align-items:center">
    <select class="fi bulk-item-cat" style="flex:1">
      ${state.D.expenseCats.map(c=>`<option value="${c.name}"${c.name===it.category?' selected':''}>${c.name}</option>`).join('')}
    </select>
    <input class="fi bulk-item-amt" type="number" value="${it.amount||''}" placeholder="Сумма" style="width:100px">
    <button onclick="this.parentElement.remove()" style="background:var(--red-bg);border:1px solid var(--red);color:var(--red);border-radius:6px;padding:5px 8px;cursor:pointer;font-weight:700">✕</button>
  </div>`).join('');
}

window.openBulkOp=function(){openBulkModal(null);};

window.addBulkItem=function(){
  const el=$('bulk-items');if(!el)return;
  const div=document.createElement('div');
  div.style.cssText='display:flex;gap:8px;margin-bottom:8px;align-items:center';
  div.innerHTML=`<select class="fi bulk-item-cat" style="flex:1">
    ${state.D.expenseCats.map(c=>`<option value="${c.name}">${c.name}</option>`).join('')}
  </select>
  <input class="fi bulk-item-amt" type="number" placeholder="Сумма" style="width:100px">
  <button onclick="this.parentElement.remove()" style="background:var(--red-bg);border:1px solid var(--red);color:var(--red);border-radius:6px;padding:5px 8px;cursor:pointer;font-weight:700">✕</button>`;
  el.appendChild(div);
};

window.saveBulkOp=function(){
  const type=$('bulk-type').value;
  const wallet=$('bulk-wallet').value;
  const date=$('bulk-date').value;
  const note=$('bulk-name').value;
  const cats=[...document.querySelectorAll('.bulk-item-cat')].map(s=>s.value);
  const amts=[...document.querySelectorAll('.bulk-item-amt')].map(i=>parseFloat(i.value)||0);
  let anyAdded=false;
  cats.forEach((cat,i)=>{
    const amount=amts[i];if(!amount)return;
    const op={id:'op'+Date.now()+i,type,amount,date,wallet,category:cat,note};
    const w=state.D.wallets.find(w=>w.id===wallet);
    if(w){if(type==='income')w.balance+=amount;else w.balance-=amount;}
    state.D.operations.push(op);
    anyAdded=true;
  });
  if(!anyAdded){alert('Добавьте хотя бы одну позицию с суммой');return;}
  sched();
  document.getElementById('modal-bulk').classList.remove('open');
  const total=amts.reduce((s,a)=>s+a,0);
  showToast(`Добавлено ${cats.filter((_,i)=>amts[i]>0).length} операций · ${fmt(total)}`);
  const cur=document.querySelector('.screen.active')?.id?.replace('screen-','');
  if(cur==='reports'&&window.renderReports)window.renderReports();
  else if(cur==='dds'&&window.renderDDS)window.renderDDS();
  else if(cur==='dashboard'&&window.renderDashboard)window.renderDashboard();
};

window.openAddTemplate=function(){
  $('tpl-idx').value=-1;$('tpl-name').value='';
  $('tpl-type').value='expense';$('tpl-amount').value='';
  $('tpl-wallet').innerHTML=state.D.wallets.map(w=>`<option value="${w.id}">${w.name}</option>`).join('');
  $('tpl-cat').innerHTML=(state.D.expenseCats.map(c=>`<option value="${c.name}">${c.name}</option>`)).join('');
  document.getElementById('modal-template').classList.add('open');
};

window.editTemplate=function(i){
  const t=state.D.templates[i];
  $('tpl-idx').value=i;$('tpl-name').value=t.name;
  $('tpl-type').value=t.type;$('tpl-amount').value=t.amount||'';
  $('tpl-wallet').innerHTML=state.D.wallets.map(w=>`<option value="${w.id}"${w.id===t.wallet?' selected':''}>${w.name}</option>`).join('');
  const expCats=state.D.expenseCats.map(c=>c.name);
  const allCats=t.type==='income'?state.D.incomeCats:[...expCats,...state.D.plan.filter(p=>p.type==='income').map(p=>p.label)];
  $('tpl-cat').innerHTML=allCats.map(c=>`<option value="${c}"${c===t.category?' selected':''}>${c}</option>`).join('');
  document.getElementById('modal-template').classList.add('open');
};

window.saveTemplate=function(){
  if(!state.D.templates)state.D.templates=[];
  const idx=+$('tpl-idx').value;
  const tpl={
    id:idx>=0?state.D.templates[idx].id:('tpl'+Date.now()),
    name:$('tpl-name').value.trim(),
    type:$('tpl-type').value,
    amount:parseFloat($('tpl-amount').value)||0,
    category:$('tpl-cat').value,
    wallet:$('tpl-wallet').value
  };
  if(!tpl.name){alert('Введите название');return;}
  if(idx>=0)state.D.templates[idx]=tpl;else state.D.templates.push(tpl);
  sched();
  document.getElementById('modal-template').classList.remove('open');
  renderTemplates();
};

window.deleteTemplate=function(i){
  state.D.templates.splice(i,1);sched();renderTemplates();
};

window.onTplTypeChange=function(val){
  const cats=val==='income'?state.D.incomeCats:
    [...state.D.expenseCats.map(c=>c.name),...state.D.plan.filter(p=>p.type==='income').map(p=>p.label)];
  $('tpl-cat').innerHTML=cats.map(c=>`<option value="${c}">${c}</option>`).join('');
};
