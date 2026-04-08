import{$,fmt,state,MONTHS,getMOps,isPlanned,planSpent,planById,today,sched}from'./core.js';

let chartInstance=null;

const WIDGETS=[
  {id:'kpi',label:'Ключевые метрики'},
  {id:'alerts',label:'Алерты и предупреждения'},
  {id:'quick',label:'Быстрые операции / шаблоны'},
  {id:'goals',label:'Цели'},
  {id:'debts',label:'Кредиты и долги'},
  {id:'health',label:'Финансовое здоровье'},
  {id:'top3',label:'Топ-3 расходов'},
  {id:'chart',label:'График cashflow'},
];

function getWidgetVis(){
  if(!state.D.dashWidgets)state.D.dashWidgets={kpi:true,alerts:true,quick:true,goals:true,debts:true,health:true,top3:true,chart:true};
  return state.D.dashWidgets;
}

function showWidget(id){
  const el=document.getElementById('dash-widget-'+id);
  if(el)el.style.display='';
}
function hideWidget(id){
  const el=document.getElementById('dash-widget-'+id);
  if(el)el.style.display='none';
}

export function renderDashboard(){
  if(!state.D)return;
  // Apply widget visibility
  const vis=getWidgetVis();
  WIDGETS.forEach(w=>{vis[w.id]!==false?showWidget(w.id):hideWidget(w.id);});
  const now=new Date();
  const daysInMonth=new Date(now.getFullYear(),now.getMonth()+1,0).getDate();
  const dayOfMonth=now.getDate();
  const daysLeft=daysInMonth-dayOfMonth;

  // Current month ops
  const ops=getMOps(0),factOps=ops.filter(o=>!isPlanned(o.type));
  const mInc=factOps.filter(o=>o.type==='income').reduce((s,o)=>s+o.amount,0);
  const mExp=factOps.filter(o=>o.type==='expense').reduce((s,o)=>s+o.amount,0);
  const mBal=mInc-mExp;
  const dailyRate=dayOfMonth>0?mBal/dayOfMonth:0;
  const projectedEnd=mBal+dailyRate*daysLeft;

  // KPI cards
  $('dash-bal').textContent=(mBal<0?'−':'')+fmt(mBal);
  $('dash-bal').className='dash-kpi-val'+(mBal<0?' neg':' pos');
  $('dash-daily').textContent=(dailyRate<0?'−':'')+fmt(Math.abs(dailyRate));
  $('dash-daily').className='dash-kpi-val'+(dailyRate<0?' neg':' pos');
  $('dash-projected').textContent=(projectedEnd<0?'−':'')+fmt(Math.abs(projectedEnd));
  $('dash-projected').className='dash-kpi-val'+(projectedEnd<0?' neg':' pos');
  $('dash-days-left').textContent=daysLeft+' дн.';

  // Days left progress bar
  const monthPct=Math.round(dayOfMonth/daysInMonth*100);
  const pb=$('dash-month-progress');if(pb)pb.style.width=monthPct+'%';
  const pl=$('dash-month-label');if(pl)pl.textContent=MONTHS[now.getMonth()]+': прошло '+dayOfMonth+' из '+daysInMonth+' дней';

  renderCashflowChart();
  renderTop3();
  renderAlerts(factOps,mInc);
  renderQuickOps();
  renderGoalsDash();
  renderDebtsDash();
  renderHealthScore();
}

function renderCashflowChart(){
  const canvas=$('dash-chart');if(!canvas)return;
  const ctx=canvas.getContext('2d');
  const now=new Date();
  const labels=[];const incData=[];const expData=[];
  for(let i=5;i>=0;i--){
    const dt=new Date(now.getFullYear(),now.getMonth()-i,1);
    labels.push(MONTHS[dt.getMonth()].slice(0,3));
    const ym=dt.getFullYear()+'-'+String(dt.getMonth()+1).padStart(2,'0');
    const ops=state.D.operations.filter(o=>!isPlanned(o.type)&&o.date&&o.date.startsWith(ym));
    incData.push(ops.filter(o=>o.type==='income').reduce((s,o)=>s+o.amount,0));
    expData.push(ops.filter(o=>o.type==='expense').reduce((s,o)=>s+o.amount,0));
  }
  if(chartInstance){chartInstance.destroy();chartInstance=null;}
  if(typeof Chart==='undefined')return;
  // Fix height for mobile
  const isMobile=window.innerWidth<=700;
  canvas.style.height=(isMobile?'220px':'100%');
  canvas.style.maxHeight=(isMobile?'220px':'none');
  chartInstance=new Chart(ctx,{
    type:'bar',
    data:{
      labels,
      datasets:[
        {label:'Доходы',data:incData,backgroundColor:'rgba(74,124,63,0.7)',borderColor:'#4A7C3F',borderWidth:1,borderRadius:4},
        {label:'Расходы',data:expData,backgroundColor:'rgba(194,91,26,0.7)',borderColor:'#C25B1A',borderWidth:1,borderRadius:4}
      ]
    },
    options:{
      responsive:true,
      maintainAspectRatio:isMobile,
      aspectRatio:isMobile?2:undefined,
      plugins:{legend:{position:'top',labels:{font:{size:11},color:'#7A5C30'}},tooltip:{callbacks:{label:ctx=>'₽ '+Math.round(ctx.raw).toLocaleString('ru-RU')}}},
      scales:{
        x:{ticks:{color:'#7A5C30',font:{size:11}},grid:{display:false}},
        y:{ticks:{color:'#7A5C30',font:{size:11},callback:v=>'₽'+Math.round(v/1000)+'k'},grid:{color:'rgba(212,180,131,0.3)'}}
      }
    }
  });
}

function renderTop3(){
  const el=$('dash-top3');if(!el)return;
  const factOps=getMOps(0).filter(o=>o.type==='expense');
  // Compare with previous month
  const prevOps=getMOps(-1).filter(o=>o.type==='expense');
  const cats=state.D.expenseCats.map(c=>c.name);
  const rows=cats.map(cat=>{
    const cur=factOps.filter(o=>o.category===cat).reduce((s,o)=>s+o.amount,0);
    const prev=prevOps.filter(o=>o.category===cat).reduce((s,o)=>s+o.amount,0);
    const delta=prev>0?Math.round((cur-prev)/prev*100):null;
    return{cat,cur,prev,delta};
  }).filter(r=>r.cur>0).sort((a,b)=>b.cur-a.cur).slice(0,3);

  if(!rows.length){el.innerHTML='<div style="color:var(--text2);font-size:13px;padding:8px 0">Нет расходов за этот месяц</div>';return;}
  el.innerHTML=rows.map((r,i)=>{
    const arrow=r.delta===null?'':(r.delta>0?`<span style="color:var(--red);font-size:11px">▲ ${r.delta}%</span>`:(r.delta<0?`<span style="color:var(--green);font-size:11px">▼ ${Math.abs(r.delta)}%</span>`:''));
    const tip=r.delta!==null&&r.delta>20?`<div style="font-size:10px;color:var(--orange-dark);margin-top:2px">+${r.delta}% vs прошлый месяц</div>`:'';
    return`<div style="display:flex;justify-content:space-between;align-items:flex-start;padding:8px 0;border-bottom:1px solid var(--border);">
      <div><div style="font-size:13px;font-weight:700;color:var(--topbar)">${i+1}. ${r.cat}</div>${tip}</div>
      <div style="text-align:right"><div style="font-size:13px;font-weight:700;color:var(--orange-dark)">− ${fmt(r.cur)}</div>${arrow}</div>
    </div>`;
  }).join('');
}

function renderAlerts(factOps,mInc){
  const el=$('dash-alerts');if(!el)return;
  const alerts=[];
  const now=new Date();
  const daysInMonth=new Date(now.getFullYear(),now.getMonth()+1,0).getDate();

  // Check plan limits
  state.D.plan.forEach(p=>{
    if(p.type!=='expense')return;
    const alloc=Math.round(mInc*p.pct/100);
    if(!alloc)return;
    const spent=planSpent(p,factOps);
    const pct=Math.round(spent/alloc*100);
    if(pct>=100){
      alerts.push({level:'danger',msg:`Перерасход по «${p.label}»: потрачено ${fmt(spent)} из ${fmt(alloc)} (${pct}%)`});
    }else if(pct>=80){
      alerts.push({level:'warn',msg:`«${p.label}» — использовано ${pct}% бюджета (${fmt(spent)} из ${fmt(alloc)})`});
    }
  });

  // Category limits
  (state.D.categoryLimits||[]).forEach(lim=>{
    const spent=factOps.filter(o=>o.type==='expense'&&o.category===lim.cat).reduce((s,o)=>s+o.amount,0);
    const pct=Math.round(spent/lim.limit*100);
    if(pct>=100){
      alerts.push({level:'danger',msg:`Лимит по «${lim.cat}» превышен: ${fmt(spent)} из ${fmt(lim.limit)}`});
    }else if(pct>=80){
      alerts.push({level:'warn',msg:`«${lim.cat}» — ${pct}% лимита (${fmt(spent)} из ${fmt(lim.limit)})`});
    }
  });

  // Upcoming recurring
  const today2=today();
  (state.D.recurring||[]).forEach(r=>{
    const ds=now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0')+'-'+String(r.day).padStart(2,'0');
    const diff=Math.ceil((new Date(ds)-new Date(today2))/(1000*60*60*24));
    if(diff>=0&&diff<=3){
      alerts.push({level:'info',msg:`Через ${diff===0?'сегодня':diff+' дн.'}: регулярный платёж «${r.name}» — ${fmt(r.amount)}`});
    }
  });

  if(!alerts.length){
    el.innerHTML='<div style="color:var(--green-dark);font-size:13px;padding:6px 0">✓ Всё в порядке, нет превышений</div>';
    return;
  }
  el.innerHTML=alerts.map(a=>`<div style="padding:7px 10px;border-radius:6px;margin-bottom:6px;font-size:12px;font-weight:500;${
    a.level==='danger'?'background:var(--red-bg);color:var(--red);border:1px solid var(--red)':
    a.level==='warn'?'background:var(--orange-bg);color:var(--orange-dark);border:1px solid var(--orange)':
    'background:var(--blue-bg);color:var(--blue);border:1px solid var(--blue)'
  }">${a.level==='danger'?'⚠ ':a.level==='warn'?'! ':'\u2139 '}${a.msg}</div>`).join('');
}

function renderQuickOps(){
  const el=$('dash-quick-ops');if(!el)return;
  let html='';
  // 1. User-defined templates first
  const templates=state.D.templates||[];
  if(templates.length){
    html+=`<div style="font-size:10px;font-weight:700;color:var(--text2);letter-spacing:.6px;margin-bottom:6px;grid-column:1/-1">ШАБЛОНЫ</div>`;
    html+=templates.slice(0,4).map((t,i)=>{
      const isInc=t.type==='income';
      return`<button onclick="window.applyTemplateById(${i})" style="background:${isInc?'var(--green-bg)':'var(--orange-bg)'};border:1.5px solid ${isInc?'var(--green)':'var(--orange)'};border-radius:8px;padding:8px 12px;cursor:pointer;text-align:left;font-size:12px;color:${isInc?'var(--green-dark)':'var(--orange-dark)'};font-weight:700">
        <div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${t.name}</div>
        <div style="font-size:11px;opacity:.8">${isInc?'+ ':'− '}${fmt(t.amount)}</div>
      </button>`;
    }).join('');
  }
  // 2. Frequent ops
  const recentOps=[];
  const now=new Date();
  for(let i=0;i<3;i++){
    const dt=new Date(now.getFullYear(),now.getMonth()-i,1);
    const ym=dt.getFullYear()+'-'+String(dt.getMonth()+1).padStart(2,'0');
    state.D.operations.filter(o=>!isPlanned(o.type)&&o.date&&o.date.startsWith(ym)).forEach(o=>recentOps.push(o));
  }
  const freq={};
  recentOps.forEach(o=>{if(!o.category)return;const key=o.type+'|'+o.category+'|'+Math.round(o.amount/100)*100;freq[key]=(freq[key]||0)+1;});
  const top=Object.entries(freq).sort((a,b)=>b[1]-a[1]).slice(0,4);
  if(top.length){
    if(templates.length)html+=`<div style="font-size:10px;font-weight:700;color:var(--text2);letter-spacing:.6px;margin:8px 0 6px;grid-column:1/-1">ЧАСТЫЕ</div>`;
    html+=top.map(([key])=>{
      const[type,cat,amt]=key.split('|');const isInc=type==='income';
      return`<button onclick="window.openQuickOp('${type}','${cat}',${amt})" style="background:${isInc?'var(--green-bg)':'var(--orange-bg)'};border:1.5px solid ${isInc?'var(--green)':'var(--orange)'};border-radius:8px;padding:8px 12px;cursor:pointer;text-align:left;font-size:12px;color:${isInc?'var(--green-dark)':'var(--orange-dark)'};font-weight:700">
        <div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${cat}</div>
        <div style="font-size:11px;opacity:.8">${isInc?'+ ':'− '}${fmt(+amt)}</div>
      </button>`;
    }).join('');
  }
  if(!html){el.innerHTML='<div style="color:var(--text2);font-size:12px;grid-column:1/-1">Добавьте шаблоны или операции</div>';return;}
  el.innerHTML=html;
}

window.applyTemplateById=function(i){
  if(!state.D.templates||!state.D.templates[i])return;
  window.applyTemplate&&window.applyTemplate(i);
};


function renderGoalsDash(){
  const el=$('dash-goals');if(!el)return;
  const goals=state.D.goals||[];
  if(!goals.length){el.innerHTML='<div style="color:var(--text2);font-size:12px">Нет активных целей. Добавьте в разделе Цели.</div>';return;}
  el.innerHTML=goals.slice(0,3).map(g=>{
    const saved=state.D.wallets.find(w=>w.id===g.walletId)?.balance||0;
    const pct=g.target>0?Math.min(Math.round(Math.max(saved,0)/g.target*100),100):0;
    const left=Math.max(g.target-saved,0);
    // Forecast: based on average monthly savings
    const now=new Date();
    let totalSaved=0,months=0;
    for(let i=1;i<=3;i++){
      const dt=new Date(now.getFullYear(),now.getMonth()-i,1);
      const ym=dt.getFullYear()+'-'+String(dt.getMonth()+1).padStart(2,'0');
      const mo=state.D.operations.filter(o=>o.type==='transfer'&&o.walletTo===g.walletId&&o.date&&o.date.startsWith(ym));
      if(mo.length){totalSaved+=mo.reduce((s,o)=>s+o.amount,0);months++;}
    }
    const avgMonthly=months>0?totalSaved/months:0;
    const monthsLeft=avgMonthly>0?Math.ceil(left/avgMonthly):null;
    const forecast=monthsLeft?`~${monthsLeft} мес.`:'—';
    return`<div style="margin-bottom:12px;padding-bottom:12px;border-bottom:1px solid var(--border)">
      <div style="display:flex;justify-content:space-between;margin-bottom:4px">
        <span style="font-size:13px;font-weight:700;color:var(--topbar)">${g.name}</span>
        <span style="font-size:12px;color:var(--text2)">${fmt(Math.max(saved,0))} / ${fmt(g.target)}</span>
      </div>
      <div style="background:var(--g50);border-radius:4px;height:8px;margin-bottom:4px">
        <div style="height:8px;border-radius:4px;background:var(--green);width:${pct}%"></div>
      </div>
      <div style="font-size:10px;color:var(--text2)">${pct}% · осталось ${fmt(left)} · прогноз: ${forecast}</div>
    </div>`;
  }).join('');
}

window.openQuickOp=function(type,cat,amt){
  // Pre-fill modal with quick op data
  document.getElementById('modal').classList.add('open');
  setTimeout(()=>{
    window.setOpType(type);
    document.getElementById('op-amount').value=amt;
    document.getElementById('op-date').value=today();
    const catSel=document.getElementById('op-cat');
    if(catSel){for(let i=0;i<catSel.options.length;i++){if(catSel.options[i].value===cat){catSel.selectedIndex=i;break;}}}
  },50);
};


function renderDebtsDash(){
  const el=$('dash-debts');if(!el||!state.D)return;
  const debtWallets=state.D.wallets.filter(w=>w.balance<0);
  const loans=state.D.loans||[];
  if(!debtWallets.length&&!loans.length){
    el.innerHTML='<div style="color:var(--green-dark);font-size:13px;padding:4px 0">✓ Долгов нет</div>';
    return;
  }
  const totalDebt=debtWallets.reduce((s,w)=>s+Math.abs(w.balance),0);
  const monthlyPayments=loans.reduce((s,l)=>s+(l.payment||0),0);
  const now=new Date();
  const upcoming=loans.map(l=>{
    const payDay=l.payDay||1;
    const ds=now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0')+'-'+String(payDay).padStart(2,'0');
    const diff=Math.ceil((new Date(ds)-new Date(today()))/(1000*60*60*24));
    return{...l,daysLeft:diff};
  }).filter(l=>l.daysLeft>=0&&l.daysLeft<=10).sort((a,b)=>a.daysLeft-b.daysLeft);

  el.innerHTML=`
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px">
      <div style="background:var(--red-bg);border-radius:7px;padding:8px 10px;border:1px solid var(--r200)">
        <div style="font-size:9px;font-weight:700;color:var(--text2);letter-spacing:.6px">ОБЩИЙ ДОЛГ</div>
        <div style="font-size:16px;font-weight:700;color:var(--red)">${fmt(totalDebt)}</div>
      </div>
      <div style="background:var(--amber-light);border-radius:7px;padding:8px 10px;border:1px solid var(--border)">
        <div style="font-size:9px;font-weight:700;color:var(--text2);letter-spacing:.6px">ПЛАТЕЖЕЙ/МЕС</div>
        <div style="font-size:16px;font-weight:700;color:var(--topbar)">${fmt(monthlyPayments)}</div>
      </div>
    </div>
    ${upcoming.map(l=>`<div style="padding:6px 0;border-bottom:.5px solid var(--border);display:flex;justify-content:space-between;font-size:12px">
      <span style="color:var(--topbar);font-weight:600">${l.name}</span>
      <span style="color:${l.daysLeft<=3?'var(--orange-dark)':'var(--text2)'}">
        ${fmt(l.payment||0)} · ${l.daysLeft===0?'сегодня':l.daysLeft===1?'завтра':'через '+l.daysLeft+' дн.'}
      </span>
    </div>`).join('')}
    ${!upcoming.length&&loans.length?'<div style="font-size:11px;color:var(--text2)">Ближайших платежей нет</div>':''}
  `;
}

function renderHealthScore(){
  const el=$('dash-health-score');if(!el||!state.D)return;
  let totalExp=0,totalInc=0;
  for(let i=1;i<=3;i++){
    const ops=getMOps(-i).filter(o=>!isPlanned(o.type));
    totalExp+=ops.filter(o=>o.type==='expense').reduce((s,o)=>s+o.amount,0);
    totalInc+=ops.filter(o=>o.type==='income').reduce((s,o)=>s+o.amount,0);
  }
  const avgExp=totalExp/3,avgInc=totalInc/3;
  const hs=state.D.healthSettings||{emergencyWalletIds:[]};
  const emergencyWallets=hs.emergencyWalletIds.length>0
    ?state.D.wallets.filter(w=>hs.emergencyWalletIds.includes(w.id)&&w.balance>0)
    :state.D.wallets.filter(w=>w.balance>0);
  const totalSavings=emergencyWallets.reduce((s,w)=>s+w.balance,0);
  const totalDebt=state.D.wallets.filter(w=>w.balance<0).reduce((s,w)=>s+Math.abs(w.balance),0);
  const emergencyMonths=avgExp>0?totalSavings/avgExp:0;
  const savingsRate=avgInc>0?(avgInc-avgExp)/avgInc*100:0;
  const dtiPct=avgInc>0?Math.min(totalDebt/avgInc*100/12,100):0;
  const score=Math.round(
    (Math.min(emergencyMonths/6,1)*100*0.25)+
    (Math.min(Math.max(savingsRate,0)/20,1)*100*0.25)+
    (Math.max(1-dtiPct/30,0)*100*0.25)+
    (50*0.25) // base
  );
  const color=score>=80?'var(--green)':score>=60?'var(--amber)':'var(--red)';
  el.innerHTML=`
    <div style="display:flex;align-items:center;gap:12px">
      <div style="font-size:36px;font-weight:700;color:${color}">${score}</div>
      <div>
        <div style="font-size:13px;font-weight:700;color:${color}">${score>=80?'Отлично':score>=60?'Хорошо':'Требует внимания'}</div>
        <div style="font-size:11px;color:var(--text2);margin-top:2px">подушка ${emergencyMonths.toFixed(1)} мес · сбережения ${Math.round(savingsRate)}%</div>
      </div>
    </div>
    <div style="background:var(--g50);border-radius:4px;height:6px;margin-top:8px">
      <div style="height:6px;border-radius:4px;background:${color};width:${score}%"></div>
    </div>
    <div style="text-align:right;margin-top:4px"><a href="#" onclick="window.showScreen('health');return false" style="font-size:11px;color:var(--amber);text-decoration:none;font-weight:700">Подробнее →</a></div>
  `;
}

window.openWidgetSettings=function(){
  if(!state.D)return;
  const vis=getWidgetVis();
  document.getElementById('widget-checkboxes').innerHTML=WIDGETS.map(w=>`
    <label style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border);cursor:pointer;font-size:13px;color:var(--topbar)">
      <input type="checkbox" ${vis[w.id]!==false?'checked':''} id="wchk-${w.id}" style="accent-color:var(--amber);width:16px;height:16px">
      ${w.label}
    </label>`).join('');
  document.getElementById('modal-widgets').classList.add('open');
};

window.saveWidgetSettings=function(){
  if(!state.D.dashWidgets)state.D.dashWidgets={};
  WIDGETS.forEach(w=>{
    const el=document.getElementById('wchk-'+w.id);
    if(el)state.D.dashWidgets[w.id]=el.checked;
  });
  sched();
  document.getElementById('modal-widgets').classList.remove('open');
  renderDashboard();
};
