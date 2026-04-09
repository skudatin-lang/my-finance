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
  if(!state.D)return;
  if(!state.D.shoppingList)state.D.shoppingList=[];
  const el=document.getElementById('shop-list');
  const totalEl=document.getElementById('shop-total');
  if(!el)return;

  const items=state.D.shoppingList;
  if(!items.length){
    el.innerHTML='<div style="color:var(--text2);font-size:12px;padding:4px 0">Список пуст</div>';
    if(totalEl)totalEl.style.display='none';
    return;
  }

  el.innerHTML=items.map((item,i)=>`
    <div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:.5px solid var(--border);${item.done?'opacity:.5':''}">
      <input type="checkbox" ${item.done?'checked':''} onchange="window.toggleShopItem(${i})" style="accent-color:var(--amber);width:16px;height:16px;flex-shrink:0">
      <span style="flex:1;font-size:13px;${item.done?'text-decoration:line-through':''};color:var(--topbar)">${item.name}</span>
      ${item.price?`<span style="font-size:12px;color:var(--text2);flex-shrink:0">₽${item.price.toLocaleString('ru-RU')}</span>`:''}
      <button onclick="window.deleteShopItem(${i})" style="background:none;border:none;color:var(--text2);cursor:pointer;font-size:14px;padding:0 2px;flex-shrink:0">×</button>
    </div>`).join('');

  // Total
  const total=items.filter(i=>!i.done).reduce((s,i)=>s+(i.price||0),0);
  const bought=items.filter(i=>i.done).reduce((s,i)=>s+(i.price||0),0);
  if(totalEl&&(total||bought)){
    totalEl.style.display='';
    totalEl.innerHTML=`${total?`Осталось купить: <b>₽${total.toLocaleString('ru-RU')}</b>`:''}${total&&bought?' · ':''}${bought?`Куплено: ₽${bought.toLocaleString('ru-RU')}`:''}`;
  }
}

window.addShopItem=function(){
  if(!state.D)return;
  if(!state.D.shoppingList)state.D.shoppingList=[];
  const nameEl=document.getElementById('shop-item-input');
  const priceEl=document.getElementById('shop-price-input');
  const name=(nameEl?.value||'').trim();
  if(!name)return;
  const price=parseFloat(priceEl?.value)||0;
  state.D.shoppingList.push({id:'sh'+Date.now(),name,price,done:false});
  if(nameEl)nameEl.value='';
  if(priceEl)priceEl.value='';
  nameEl?.focus();
  sched();
  renderShoppingList();
  renderShoppingDash();
};

window.toggleShopItem=function(i){
  if(!state.D?.shoppingList)return;
  state.D.shoppingList[i].done=!state.D.shoppingList[i].done;
  sched();renderShoppingList();renderShoppingDash();
};

window.deleteShopItem=function(i){
  if(!state.D?.shoppingList)return;
  state.D.shoppingList.splice(i,1);
  sched();renderShoppingList();renderShoppingDash();
};

window.clearBoughtItems=function(){
  if(!state.D?.shoppingList)return;
  state.D.shoppingList=state.D.shoppingList.filter(i=>!i.done);
  sched();renderShoppingList();renderShoppingDash();
};

function renderShoppingDash(){
  const el=document.getElementById('dash-shopping');if(!el)return;
  const items=state.D?.shoppingList||[];
  if(!items.length){
    el.innerHTML='<div style="color:var(--text2);font-size:12px">Список пуст</div>';return;
  }
  const remaining=items.filter(i=>!i.done);
  const total=remaining.reduce((s,i)=>s+(i.price||0),0);
  el.innerHTML=`<div style="font-size:12px;color:var(--text2);margin-bottom:6px">${remaining.length} позиций${total?` · ₽${total.toLocaleString('ru-RU')}`:''}</div>`+
    remaining.slice(0,4).map(item=>`<div style="font-size:12px;padding:3px 0;border-bottom:.5px solid var(--border);display:flex;justify-content:space-between">
      <span style="color:var(--topbar)">${item.name}</span>
      ${item.price?`<span style="color:var(--text2)">₽${item.price.toLocaleString('ru-RU')}</span>`:''}
    </div>`).join('')+
    (remaining.length>4?`<div style="font-size:10px;color:var(--text2);margin-top:4px">ещё ${remaining.length-4}...</div>`:'');
}

// Export for dashboard
window._renderShoppingDash=renderShoppingDash;
