import{$,fmt,state,MONTHS,getMOps,isPlanned,planSpent,planById,today,sched}from'./core.js';

let chartInstance=null;

export function renderDashboard(){
  if(!state.D)return;
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
  // Find most frequent operations (last 3 months)
  const now=new Date();
  const recentOps=[];
  for(let i=0;i<3;i++){
    const dt=new Date(now.getFullYear(),now.getMonth()-i,1);
    const ym=dt.getFullYear()+'-'+String(dt.getMonth()+1).padStart(2,'0');
    state.D.operations.filter(o=>!isPlanned(o.type)&&o.date&&o.date.startsWith(ym)).forEach(o=>recentOps.push(o));
  }
  // Count category+amount combos
  const freq={};
  recentOps.forEach(o=>{
    if(!o.category)return;
    const key=o.type+'|'+o.category+'|'+Math.round(o.amount/100)*100;
    freq[key]=(freq[key]||0)+1;
  });
  const top=Object.entries(freq).sort((a,b)=>b[1]-a[1]).slice(0,4);
  if(!top.length){el.innerHTML='<div style="color:var(--text2);font-size:12px">Добавьте операции для быстрого доступа</div>';return;}
  el.innerHTML=top.map(([key])=>{
    const[type,cat,amt]=key.split('|');
    const isInc=type==='income';
    return`<button onclick="window.openQuickOp('${type}','${cat}',${amt})" style="background:${isInc?'var(--green-bg)':'var(--orange-bg)'};border:1.5px solid ${isInc?'var(--green)':'var(--orange)'};border-radius:8px;padding:8px 12px;cursor:pointer;text-align:left;font-size:12px;color:${isInc?'var(--green-dark)':'var(--orange-dark)'};font-weight:700;">
      <div>${cat}</div>
      <div style="font-size:11px;opacity:.8">${isInc?'+ ':'\u2212 '}${fmt(+amt)}</div>
    </button>`;
  }).join('');
}

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
