import{$,fmt,state,MONTHS,isPlanned,opHtml,today,fmtD,wName}from'./core.js';

export function renderCalendar(){
  if(!state.D)return;
  const dt=new Date(new Date().getFullYear(),new Date().getMonth()+state.calOff,1);
  $('cal-month-lbl').textContent=MONTHS[dt.getMonth()]+' '+dt.getFullYear();
  const y=dt.getFullYear(),m=dt.getMonth();
  const dim=new Date(y,m+1,0).getDate(),first=(new Date(y,m,1).getDay()+6)%7;
  const todayStr=today(),ym=y+'-'+String(m+1).padStart(2,'0');
  const allM=state.D.operations.filter(o=>o.date&&o.date.startsWith(ym));

  $('cs-fi').textContent=fmt(allM.filter(o=>o.type==='income').reduce((s,o)=>s+o.amount,0));
  $('cs-fo').textContent=fmt(allM.filter(o=>o.type==='expense').reduce((s,o)=>s+o.amount,0));
  $('cs-pi').textContent=fmt(allM.filter(o=>o.type==='planned_income').reduce((s,o)=>s+o.amount,0));
  // Deduplicate recurring planned ops (keep only one per recurringId per month)
  const planExp=allM.filter(o=>o.type==='planned_expense');
  const seenRec=new Set();
  const dedupPlanExp=planExp.filter(o=>{
    if(!o.recurringId)return true;
    if(seenRec.has(o.recurringId))return false;
    seenRec.add(o.recurringId);return true;
  });
  $('cs-po').textContent=fmt(dedupPlanExp.reduce((s,o)=>s+o.amount,0));

  const fD=new Set(allM.filter(o=>!isPlanned(o.type)).map(o=>+o.date.split('-')[2]));
  const pD=new Set(allM.filter(o=>isPlanned(o.type)).map(o=>+o.date.split('-')[2]));

  let html=['ПН','ВТ','СР','ЧТ','ПТ','СБ','ВС'].map(d=>`<div class="cal-dlbl">${d}</div>`).join('');
  for(let i=0;i<first;i++)html+='<div class="cal-d empty">0</div>';
  for(let d=1;d<=dim;d++){
    const ds=ym+'-'+String(d).padStart(2,'0');
    const isTod=ds===todayStr,hF=fD.has(d),hP=pD.has(d);
    const cls=isTod?'today':(hF&&hP?'both':(hF?'fact':(hP?'plan':'')));
    html+=`<div class="cal-d ${cls}" onclick="window.selCalDay('${ds}')">${d}</div>`;
  }
  $('cal-grid').innerHTML=html;
  const selDay=state.calDay||todayStr;
  showCalDay(selDay);
  // Mark selected day
  markSelected(selDay);
  // Render shopping list
  renderShoppingList();
}

function markSelected(ds){
  document.querySelectorAll('.cal-d.selected').forEach(el=>el.classList.remove('selected'));
  // Find day by onclick attr
  const d=document.querySelector(`.cal-d[onclick="window.selCalDay('${ds}')"]`);
  if(d)d.classList.add('selected');
}

export function showCalDay(ds){
  state.calDay=ds;
  markSelected(ds);
  const d=new Date(ds+'T12:00:00');
  $('cal-day-title').textContent=d.toLocaleDateString('ru-RU',{day:'numeric',month:'long',year:'numeric'}).toUpperCase();
  const ops=state.D.operations.filter(o=>o.date===ds);
  const fact=ops.filter(o=>!isPlanned(o.type));
  const plan=ops.filter(o=>isPlanned(o.type));
  const fb=fact.filter(o=>o.type==='income').reduce((s,o)=>s+o.amount,0)-fact.filter(o=>o.type==='expense').reduce((s,o)=>s+o.amount,0);
  const pb=plan.filter(o=>o.type==='planned_income').reduce((s,o)=>s+o.amount,0)-plan.filter(o=>o.type==='planned_expense').reduce((s,o)=>s+o.amount,0);

  const dbr=$('day-bal-row');
  if(ops.length){
    dbr.style.display='grid';
    const fv=$('day-fact-bal');fv.textContent=(fb<0?'\u2212 ':'')+fmt(fb);fv.style.color=fb<0?'var(--red)':(fb>0?'var(--green)':'var(--topbar)');
    const pv=$('day-plan-bal');pv.textContent=(pb<0?'\u2212 ':'')+fmt(pb);pv.style.color=pb<0?'var(--red)':(pb>0?'var(--green)':'var(--text2)');
  }else dbr.style.display='none';

  const el=$('cal-day-ops');
  if(!ops.length){el.innerHTML='<div style="padding:12px 0;font-size:13px;color:var(--text2)">Нет операций</div>';return;}
  let html='';
  if(fact.length){html+='<div class="sec-div">ФАКТ</div>'+fact.map(o=>opHtml(o,true)).join('');}
  if(plan.length){
    html+='<div class="sec-div">ПЛАНОВЫЕ</div>';
    html+=plan.map(o=>{
      const isPI=o.type==='planned_income';
      return`<div class="op-item"><div class="op-top">
        <div style="flex:1"><div class="op-title">${o.category||o.note||'—'} <span class="op-badge">${isPI?'план +':'план \u2212'}</span></div><div class="op-meta">${fmtD(o.date)}${o.note?' &nbsp;'+o.note:''}</div></div>
        <div class="op-actions"><div class="op-amt" style="color:var(--blue)">${isPI?'+ ':'\u2212 '}${fmt(o.amount)}</div><button class="op-btn del" onclick="window.deleteOp('${o.id}')">&#10005;</button></div>
      </div></div>`;
    }).join('');
  }
  el.innerHTML=html;
}

// ── Summary detail on click ─────────────────────────────────────
window.showCalSummary=function(type){
  const el=document.getElementById('cal-summary-detail');
  if(!el||!state.D)return;

  // Toggle if same type clicked again
  if(el.dataset.type===type&&el.style.display!=='none'){
    el.style.display='none'; el.dataset.type=''; return;
  }
  el.dataset.type=type;
  el.style.display='block';

  const now=new Date(new Date().getFullYear(),new Date().getMonth()+state.calOff,1);
  const ym=now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0');
  const allM=state.D.operations.filter(o=>o.date&&o.date.startsWith(ym));

  let ops=[], title='', colorCls='';
  if(type==='fact-inc'){
    ops=allM.filter(o=>o.type==='income');
    title='Фактические доходы'; colorCls='pos';
  }else if(type==='fact-exp'){
    ops=allM.filter(o=>o.type==='expense');
    title='Фактические расходы'; colorCls='neg';
  }else if(type==='plan-inc'){
    ops=allM.filter(o=>o.type==='planned_income');
    title='Плановые доходы'; colorCls='blue';
  }else if(type==='plan-exp'){
    // Deduplicate recurring
    const all=allM.filter(o=>o.type==='planned_expense');
    const seen=new Set();
    ops=all.filter(o=>{
      if(!o.recurringId)return true;
      if(seen.has(o.recurringId))return false;
      seen.add(o.recurringId);return true;
    });
    title='Плановые расходы'; colorCls='neg';
  }

  if(!ops.length){
    el.innerHTML=`<div style="color:var(--text2);font-size:12px;padding:4px 0">Нет операций</div>`;
    return;
  }

  // Group by category
  const groups={};
  ops.forEach(o=>{
    const cat=o.category||o.note||'—';
    if(!groups[cat])groups[cat]={total:0,count:0,items:[]};
    groups[cat].total+=o.amount;
    groups[cat].count++;
    groups[cat].items.push(o);
  });

  const total=ops.reduce((s,o)=>s+o.amount,0);
  const wName=id=>{const w=state.D.wallets.find(w=>w.id===id);return w?w.name:'';};
  const fmtD=ds=>{if(!ds)return'';const[y,m,d]=ds.split('-');return d+'.'+m;};

  let html=`<div style="font-size:11px;font-weight:700;color:var(--text2);letter-spacing:.5px;margin-bottom:8px;display:flex;justify-content:space-between">
    <span>${title}</span>
    <span style="color:var(--topbar)">Итого: ₽ ${Math.round(total).toLocaleString('ru-RU')}</span>
  </div>`;

  // By category
  Object.entries(groups).sort((a,b)=>b[1].total-a[1].total).forEach(([cat,g])=>{
    html+=`<div style="padding:5px 0;border-bottom:.5px solid var(--border)">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <span style="font-size:12px;font-weight:700;color:var(--topbar)">${cat}</span>
        <span style="font-size:12px;font-weight:700;color:var(--${colorCls==='pos'?'green-dark':colorCls==='neg'?'red':'blue'})">
          ₽ ${Math.round(g.total).toLocaleString('ru-RU')}
        </span>
      </div>
      ${g.items.map(o=>`<div style="font-size:11px;color:var(--text2);margin-top:2px;display:flex;justify-content:space-between">
        <span>${wName(o.wallet||'')}${o.note?' · '+o.note:''} · ${fmtD(o.date)}</span>
        <span>₽ ${Math.round(o.amount).toLocaleString('ru-RU')}</span>
      </div>`).join('')}
    </div>`;
  });

  el.innerHTML=html;
};

// ── Shopping List ────────────────────────────────────────────────
// Stored in Firebase: state.D.shoppingList = [{id,name,price,done}]

export function renderShoppingList(){
  const el=document.getElementById('shop-list');
  if(!el||!state.D)return;
  if(!state.D.shoppingList)state.D.shoppingList=[];

  // Fill category selector
  const catSel=document.getElementById('shop-item-cat');
  if(catSel&&catSel.children.length<=1){
    state.D.expenseCats.forEach(c=>{
      const o=document.createElement('option');o.value=c.name;o.textContent=c.name;catSel.appendChild(o);
    });
  }

  const items=state.D.shoppingList;
  if(!items.length){
    el.innerHTML='<div style="color:var(--text2);font-size:13px;padding:6px 0">Список пуст. Нажмите «+ Добавить».</div>';
    return;
  }

  const done=items.filter(i=>i.done).length;
  const total=items.length;

  let html=`<div style="font-size:11px;color:var(--text2);margin-bottom:8px;display:flex;justify-content:space-between;align-items:center">
    <span>${done}/${total} куплено</span>
    ${done>0?`<button onclick="window.clearDoneItems()" style="background:none;border:1px solid var(--border);border-radius:5px;padding:3px 9px;font-size:10px;color:var(--text2);cursor:pointer">Убрать купленные</button>`:''}
  </div>
  <div style="background:var(--g50);border-radius:3px;height:4px;margin-bottom:10px">
    <div style="height:4px;border-radius:3px;background:var(--green);width:${total>0?Math.round(done/total*100):0}%"></div>
  </div>`;

  // Group by category
  const groups={};
  items.forEach((item,i)=>{
    const cat=item.cat||'Без категории';
    if(!groups[cat])groups[cat]=[];
    groups[cat].push({...item,_idx:i});
  });

  Object.entries(groups).forEach(([cat,gitems])=>{
    html+=`<div style="margin-bottom:10px">
      <div style="font-size:10px;font-weight:700;color:var(--text2);letter-spacing:.5px;margin-bottom:5px">${cat.toUpperCase()}</div>
      ${gitems.map(item=>`
        <div style="display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:7px;margin-bottom:3px;background:${item.done?'var(--g50)':'var(--card)'};border:1px solid var(--border)">
          <input type="checkbox" ${item.done?'checked':''} onchange="window.toggleShopItem(${item._idx},this.checked)"
            style="accent-color:var(--amber);width:16px;height:16px;flex-shrink:0;cursor:pointer">
          <span style="flex:1;font-size:13px;${item.done?'text-decoration:line-through;color:var(--text2)':'color:var(--topbar);font-weight:500'}">${item.text}${item.qty>1?` × ${item.qty}`:''}</span>
          <button onclick="window.editShopItem(${item._idx})" style="background:none;border:none;color:var(--text2);cursor:pointer;font-size:14px;padding:2px 4px">✎</button>
          <button onclick="window.deleteShopItem(${item._idx})" style="background:none;border:none;color:var(--text2);cursor:pointer;font-size:14px;padding:2px 4px">✕</button>
        </div>`).join('')}
    </div>`;
  });

  el.innerHTML=html;

  // Also update dashboard widget
  renderShoppingDash();
}

function renderShoppingDash(){
  const el=document.getElementById('dash-shopping');if(!el||!state.D)return;
  const items=state.D.shoppingList||[];
  const pending=items.filter(i=>!i.done);
  const done=items.filter(i=>i.done).length;
  if(!items.length){
    el.innerHTML='<div style="color:var(--text2);font-size:12px">Список пуст</div>';return;
  }
  const pct=items.length>0?Math.round(done/items.length*100):0;
  el.innerHTML=`
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
      <span style="font-size:12px;color:var(--text2)">${done}/${items.length} куплено</span>
      <span style="font-size:12px;font-weight:700;color:var(--topbar)">${pct}%</span>
    </div>
    <div style="background:var(--g50);border-radius:3px;height:4px;margin-bottom:8px">
      <div style="height:4px;border-radius:3px;background:var(--green);width:${pct}%"></div>
    </div>
    ${pending.slice(0,4).map(i=>`<div style="font-size:12px;padding:3px 0;color:var(--topbar);border-top:.5px solid var(--border);display:flex;align-items:center;gap:6px">
      <span style="color:var(--border2)">○</span>${i.text}${i.qty>1?` × ${i.qty}`:''}
    </div>`).join('')}
    ${pending.length>4?`<div style="font-size:11px;color:var(--text2);padding-top:3px">+${pending.length-4} ещё</div>`:''}
  `;
}

// ── Window functions ─────────────────────────────────────────────
window.openAddShopItem=function(){
  const inp=document.getElementById('shop-list-input');
  if(!inp)return;
  document.getElementById('shop-item-text').value='';
  document.getElementById('shop-item-qty').value='1';
  document.getElementById('shop-item-cat').value='';
  inp.style.display='';
  document.getElementById('shop-item-text').focus();
  inp.dataset.editIdx=-1;
};

window.closeShopInput=function(){
  const inp=document.getElementById('shop-list-input');
  if(inp)inp.style.display='none';
};

window.saveShopItem=function(){
  if(!state.D)return;
  if(!state.D.shoppingList)state.D.shoppingList=[];
  const text=document.getElementById('shop-item-text').value.trim();
  if(!text)return;
  const qty=parseFloat(document.getElementById('shop-item-qty').value)||1;
  const cat=document.getElementById('shop-item-cat').value||'';
  const editIdx=+document.getElementById('shop-list-input').dataset.editIdx;
  const item={id:editIdx>=0?state.D.shoppingList[editIdx].id:'si'+Date.now(),text,qty,cat,done:false};
  if(editIdx>=0)state.D.shoppingList[editIdx]=item;
  else state.D.shoppingList.push(item);
  sched();
  window.closeShopInput();
  renderShoppingList();
};

window.editShopItem=function(i){
  if(!state.D.shoppingList[i])return;
  const item=state.D.shoppingList[i];
  const inp=document.getElementById('shop-list-input');
  document.getElementById('shop-item-text').value=item.text;
  document.getElementById('shop-item-qty').value=item.qty||1;
  document.getElementById('shop-item-cat').value=item.cat||'';
  inp.dataset.editIdx=i;
  inp.style.display='';
  document.getElementById('shop-item-text').focus();
};

window.toggleShopItem=function(i,checked){
  if(!state.D.shoppingList[i])return;
  state.D.shoppingList[i].done=checked;
  sched();renderShoppingList();
};

window.deleteShopItem=function(i){
  state.D.shoppingList.splice(i,1);
  sched();renderShoppingList();
};

window.clearDoneItems=function(){
  if(!state.D.shoppingList)return;
  state.D.shoppingList=state.D.shoppingList.filter(i=>!i.done);
  sched();renderShoppingList();
};
