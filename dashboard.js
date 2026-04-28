import{$,fmt,state,MONTHS,getMOps,isPlanned,planSpent,planById,today,sched,calcHealthScore,detectAnomalies,appConfig}from'./core.js';

let chartInstance=null;

const WIDGETS=[
  {id:'ai',label:'AI Советник',right:true},
  {id:'plan',label:'Финансовый план',right:true},
  {id:'limits',label:'Лимиты по категориям',right:true},
  {id:'forecast',label:'Прогноз на конец года',right:true},
  {id:'anomalies',label:'Аномальные траты',right:true},
  {id:'today',label:'Сегодня (баланс дня)',right:true},
  {id:'catdetail',label:'Расходы по категориям',right:true},
  {id:'debts',label:'Кредиты и долги',right:true},
  {id:'health',label:'Финансовое здоровье',right:true},
  {id:'goals',label:'Цели',right:true},
  {id:'chart',label:'График cashflow',right:true},
  {id:'portfolio',label:'Инвестиционный портфель',right:true},
  {id:'physassets',label:'Физические активы',right:true},
];

function getWidgetVis(){
  if(!state.D.dashWidgets)state.D.dashWidgets={ai:true,plan:true,limits:true,forecast:true,anomalies:true,today:true,catdetail:true,debts:true,health:true,goals:true,chart:true};
  const dw=state.D.dashWidgets;
  ['ai','plan','limits','forecast','anomalies','today','catdetail','debts','health','goals','chart','portfolio','physassets'].forEach(k=>{if(dw[k]===undefined)dw[k]=true;});
  return dw;
}

function showWidget(id){const el=document.getElementById('dash-widget-'+id);if(el)el.style.display='';}
function hideWidget(id){const el=document.getElementById('dash-widget-'+id);if(el)el.style.display='none';}

export function renderDashboard(){
  if(!state.D)return;
  const vis=getWidgetVis();
  WIDGETS.forEach(w=>{vis[w.id]!==false?showWidget(w.id):hideWidget(w.id);});
  const now=new Date();
  const daysInMonth=new Date(now.getFullYear(),now.getMonth()+1,0).getDate();
  const dayOfMonth=now.getDate();
  const daysLeft=daysInMonth-dayOfMonth;

  const ops=getMOps(0),factOps=ops.filter(o=>!isPlanned(o.type));
  const mInc=factOps.filter(o=>o.type==='income').reduce((s,o)=>s+o.amount,0);
  const mExp=factOps.filter(o=>o.type==='expense').reduce((s,o)=>s+o.amount,0);
  const mBal=mInc-mExp;
  const dailyRate=dayOfMonth>0?mBal/dayOfMonth:0;
  const projectedEnd=mBal+dailyRate*daysLeft;

  $('dash-bal').textContent=(mBal<0?'−':'')+fmt(mBal);
  $('dash-bal').className='dash-kpi-val'+(mBal<0?' neg':' pos');
  $('dash-daily').textContent=(dailyRate<0?'−':'')+fmt(Math.abs(dailyRate));
  $('dash-daily').className='dash-kpi-val'+(dailyRate<0?' neg':' pos');
  $('dash-projected').textContent=(projectedEnd<0?'−':'')+fmt(Math.abs(projectedEnd));
  $('dash-projected').className='dash-kpi-val'+(projectedEnd<0?' neg':' pos');
  $('dash-days-left').textContent=daysLeft+' дн.';

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
  renderPlanDash(factOps,mInc);
  renderPortfolioDash();
  renderAssetsDash();
  renderLimitsDash(factOps);
  renderForecastDash();
  renderAnomaliesDash(factOps);
  renderTodayDash();
  renderCatDetailDash(factOps);
  renderAiDash();
}

// ── AI Советник ──────────────────────────────────────────────────────────
function buildAiContext(){
  if(!state.D)return'';
  const h=calcHealthScore();
  const ops=getMOps(0).filter(o=>!isPlanned(o.type));
  const income=ops.filter(o=>o.type==='income').reduce((s,o)=>s+o.amount,0);
  const expense=ops.filter(o=>o.type==='expense').reduce((s,o)=>s+o.amount,0);
  const byCategory={};
  ops.filter(o=>o.type==='expense').forEach(o=>{byCategory[o.category]=(byCategory[o.category]||0)+o.amount;});
  const topCats=Object.entries(byCategory).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([cat,amt])=>cat+': '+Math.round(amt)+' ₽').join(', ');
  const debtWallets=state.D.wallets.filter(w=>w.balance<0);
  const totalDebt=debtWallets.reduce((s,w)=>s+Math.abs(w.balance),0);
  const debtDetails=debtWallets.map(w=>w.name+': '+Math.round(Math.abs(w.balance))+' ₽'+(w.rate?' ('+w.rate+'%)':'')).join('; ');
  return[
    'Текущий месяц: доход '+Math.round(income)+' ₽, расход '+Math.round(expense)+' ₽',
    topCats?'Топ расходов: '+topCats:'',
    h?'Индекс здоровья: '+h.score+'/100 (подушка '+h.s1+'%, сбережения '+h.s2+'%, долги '+h.s3+'%)':'',
    totalDebt?'Общий долг: '+Math.round(totalDebt)+' ₽ ('+debtDetails+')':'Долгов нет',
    'Кошельки: '+state.D.wallets.filter(w=>w.balance>0).map(w=>w.name+' '+Math.round(w.balance)+' ₽').join(', '),
  ].filter(Boolean).join('\n');
}

async function fetchAiAdvice(){
  const key=appConfig.deepseekKey;
  if(!key)throw new Error('Добавьте DeepSeek API ключ в Панели администратора');
  const resp=await fetch('https://api.proxyapi.ru/openrouter/v1/chat/completions',{
    method:'POST',
    headers:{'Content-Type':'application/json','Authorization':'Bearer '+key},
    body:JSON.stringify({
      model:'deepseek/deepseek-chat',
      max_tokens:300,
      temperature:0.4,
      messages:[
        {role:'system',content:'Ты личный финансовый советник. Отвечай только на русском. Давай 1-2 конкретных совета на основе реальных данных. Без воды. Максимум 80 слов.'},
        {role:'user',content:'Мои финансы:\n'+buildAiContext()+'\n\nДай краткий анализ и главный совет на сейчас.'},
      ],
    }),
  });
  if(!resp.ok){const e=await resp.json().catch(()=>({}));throw new Error(e.error?.message||'Ошибка API '+resp.status);}
  const data=await resp.json();
  return data.choices?.[0]?.message?.content?.trim()||'';
}

function renderAiDash(){
  const el=document.getElementById('dash-ai');if(!el)return;
  // Не обновляем если уже есть текст (обновляется только по кнопке или при первом рендере)
  if(el.dataset.loaded==='1')return;
  if(!appConfig.deepseekKey){
    el.innerHTML='<div style="font-size:11px;color:var(--text2)">Добавьте DeepSeek API ключ в Панели администратора для получения AI советов.</div>';
    return;
  }
  _loadAiAdvice(el);
}

function _loadAiAdvice(el){
  el.dataset.loaded='0';
  el.innerHTML=`<div style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--text2)">
    <div style="width:12px;height:12px;border:2px solid var(--border);border-top-color:var(--amber);border-radius:50%;animation:_aispin .7s linear infinite;flex-shrink:0"></div>
    Анализирую данные...
  </div>
  <style>@keyframes _aispin{to{transform:rotate(360deg)}}</style>`;
  fetchAiAdvice().then(text=>{
    el.dataset.loaded='1';
    el.innerHTML=`
      <div style="font-size:11px;line-height:1.7;color:var(--text)">${text.replace(/\n/g,'<br>')}</div>
      <div style="margin-top:8px;text-align:right">
        <button onclick="window._refreshAiAdvice()" style="background:none;border:1px solid var(--border);border-radius:5px;padding:3px 10px;font-size:10px;color:var(--text2);cursor:pointer">↻ Обновить</button>
      </div>`;
  }).catch(err=>{
    el.dataset.loaded='1';
    el.innerHTML=`<div style="font-size:11px;color:var(--red)">⚠ ${err.message}</div>
      <div style="margin-top:6px;text-align:right">
        <button onclick="window._refreshAiAdvice()" style="background:none;border:1px solid var(--border);border-radius:5px;padding:3px 10px;font-size:10px;color:var(--text2);cursor:pointer">↻ Повторить</button>
      </div>`;
  });
}

window._refreshAiAdvice=function(){
  const el=document.getElementById('dash-ai');if(!el)return;
  el.dataset.loaded='0';
  _loadAiAdvice(el);
};

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
    const tip=r.delta!==null&&r.delta>20?`<div style="font-size:10px;color:var(--orange-dark);margin-top:2px">+${r.delta}% vs прошлый месяц</div>`:''
    return`<div style="display:flex;justify-content:space-between;align-items:flex-start;padding:8px 0;border-bottom:1px solid var(--border);">
      <div><div style="font-size:13px;font-weight:700;color:var(--text)">${i+1}. ${r.cat}</div>${tip}</div>
      <div style="text-align:right"><div style="font-size:13px;font-weight:700;color:var(--orange-dark)">− ${fmt(r.cur)}</div>${arrow}</div>
    </div>`;
  }).join('');
}

function renderAlerts(factOps,mInc){
  const el=$('dash-alerts');if(!el)return;
  const alerts=[];

  state.D.plan.forEach(p=>{
    if(p.type!=='expense')return;
    const alloc=Math.round(mInc*p.pct/100);
    if(!alloc)return;
    const spent=planSpent(p,factOps);
    const pct=Math.round(spent/alloc*100);
    if(pct>=100)alerts.push({level:'danger',msg:`Перерасход по «${p.label}»: потрачено ${fmt(spent)} из ${fmt(alloc)} (${pct}%)`});
    else if(pct>=80)alerts.push({level:'warn',msg:`«${p.label}» — использовано ${pct}% бюджета (${fmt(spent)} из ${fmt(alloc)})`});
  });

  (state.D.categoryLimits||[]).forEach(lim=>{
    const spent=factOps.filter(o=>o.type==='expense'&&o.category===lim.cat).reduce((s,o)=>s+o.amount,0);
    const pct=Math.round(spent/lim.limit*100);
    if(pct>=100)alerts.push({level:'danger',msg:`Лимит по «${lim.cat}» превышен: ${fmt(spent)} из ${fmt(lim.limit)}`});
    else if(pct>=80)alerts.push({level:'warn',msg:`«${lim.cat}» — ${pct}% лимита (${fmt(spent)} из ${fmt(lim.limit)})`});
  });

  const portAlert=window._checkPortfolioAlert&&window._checkPortfolioAlert();
  if(portAlert)alerts.push({level:'info',msg:`📈 ${portAlert} — <a href="#" onclick="window.showScreen('portfolio');return false" style="color:var(--blue);font-weight:700">Обновить →</a>`});
  const assetsAlert=window._checkAssetsAlert&&window._checkAssetsAlert();
  if(assetsAlert)alerts.push({level:'warn',msg:`🏠 ${assetsAlert} — <a href="#" onclick="window.showScreen('physassets');return false" style="color:var(--blue);font-weight:700">Обновить →</a>`});

  const todayStr=today();
  const now=new Date();
  (state.D.recurring||[]).forEach(r=>{
    const ds=now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0')+'-'+String(r.day).padStart(2,'0');
    const diff=Math.ceil((new Date(ds)-new Date(todayStr))/(1000*60*60*24));
    if(diff>=0&&diff<=3)alerts.push({level:'info',msg:`${diff===0?'Сегодня':diff===1?'Завтра':'Через '+diff+' дн.'}: регулярный платёж «${r.name}» — ${fmt(r.amount)}`});
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
  const recentOps=[];
  const now=new Date();
  for(let i=0;i<3;i++){
    const dt=new Date(now.getFullYear(),now.getMonth()-i,1);
    const ym=dt.getFullYear()+'-'+String(dt.getMonth()+1).padStart(2,'0');
    state.D.operations.filter(o=>!isPlanned(o.type)&&o.date&&o.date.startsWith(ym)).forEach(o=>recentOps.push(o));
  }
  const freq={};
  recentOps.forEach(o=>{
    if(!o.category)return;
    const roundAmt=Math.round(o.amount/50)*50;
    const key=o.type+'|'+o.category+'|'+roundAmt;
    freq[key]=(freq[key]||0)+1;
  });
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
        <span style="font-size:13px;font-weight:700;color:var(--text)">${g.name}</span>
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
  const monthlyPayments=debtWallets.reduce((s,w)=>s+(w.payment||0),0);
  const now=new Date();
  const upcoming=debtWallets.filter(w=>w.payment&&w.payDay).map(w=>{
    const payDay=w.payDay;
    let d=new Date(now.getFullYear(),now.getMonth(),payDay);
    if(d<new Date(today()))d=new Date(now.getFullYear(),now.getMonth()+1,payDay);
    const diff=Math.ceil((d-new Date(today()))/(1000*60*60*24));
    return{name:w.name,payment:w.payment,payDay,daysLeft:diff};
  }).filter(l=>l.daysLeft>=0&&l.daysLeft<=10).sort((a,b)=>a.daysLeft-b.daysLeft);

  el.innerHTML=`
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px">
      <div style="background:var(--red-bg);border-radius:7px;padding:8px 10px;border:1px solid var(--r200)">
        <div style="font-size:9px;font-weight:700;color:var(--text2);letter-spacing:.6px">ОБЩИЙ ДОЛГ</div>
        <div style="font-size:16px;font-weight:700;color:var(--red)">${fmt(totalDebt)}</div>
      </div>
      <div style="background:var(--amber-light);border-radius:7px;padding:8px 10px;border:1px solid var(--border)">
        <div style="font-size:9px;font-weight:700;color:var(--text2);letter-spacing:.6px">ПЛАТЕЖЕЙ/МЕС</div>
        <div style="font-size:16px;font-weight:700;color:var(--text)">${fmt(monthlyPayments)}</div>
      </div>
    </div>
    ${upcoming.map(l=>`<div style="padding:6px 0;border-bottom:.5px solid var(--border);display:flex;justify-content:space-between;font-size:12px">
      <span style="color:var(--text);font-weight:600">${l.name}</span>
      <span style="color:${l.daysLeft<=3?'var(--orange-dark)':'var(--text2)'}">
        ${fmt(l.payment||0)} · ${l.daysLeft===0?'сегодня':l.daysLeft===1?'завтра':'через '+l.daysLeft+' дн.'}
      </span>
    </div>`).join('')}
    ${!upcoming.length&&debtWallets.some(w=>w.payment)?'<div style="font-size:11px;color:var(--text2)">Ближайших платежей нет</div>':''}
  `;
}

function renderHealthScore(){
  const el=$('dash-health-score');if(!el||!state.D)return;
  const h=calcHealthScore();
  if(!h){el.innerHTML='<div style="color:var(--text2);font-size:12px">Нет данных</div>';return;}
  const{score,s1,s2,s3,s4,s5,emergencyMonths,savingsRate,dtiPct,obligRatio}=h;
  const color=score>=80?'var(--green)':score>=60?'var(--amber)':'var(--red)';
  const label=score>=80?'Отлично':score>=60?'Хорошо':score>=40?'Есть над чем работать':'Требует внимания';
  el.innerHTML=`
    <div style="display:flex;align-items:center;gap:12px">
      <div style="font-size:36px;font-weight:700;color:${color};line-height:1">${score}</div>
      <div style="flex:1">
        <div style="font-size:13px;font-weight:700;color:${color}">${label}</div>
        <div style="font-size:11px;color:var(--text2);margin-top:3px">подушка ${emergencyMonths} мес · сбережения ${savingsRate}%</div>
        <div style="font-size:11px;color:var(--text2)">долг ${dtiPct}% дохода · обяз. ${obligRatio}%</div>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:3px;margin-top:8px">
      ${[['Подушка',s1],['Сбереж.',s2],['Долг',s3],['Обяз.',s4],['Инвест.',s5]].map(([lbl,sc])=>{
        const c2=sc>=80?'var(--green)':sc>=60?'var(--amber)':'var(--red)';
        return '<div style="text-align:center">'+
          '<div style="font-size:9px;color:var(--text2)">'+lbl+'</div>'+
          '<div style="font-size:12px;font-weight:700;color:'+c2+'">'+sc+'%</div>'+
        '</div>';
      }).join('')}
    </div>
    <div style="background:var(--g50);border-radius:4px;height:5px;margin-top:8px">
      <div style="height:5px;border-radius:4px;background:${color};width:${score}%;transition:width .3s"></div>
    </div>
    <div style="text-align:right;margin-top:5px">
      <a href="#" onclick="window.showScreen('health');return false" style="font-size:11px;color:var(--amber);text-decoration:none;font-weight:700">Подробнее →</a>
    </div>
  `;
}

function renderPortfolioDash(){
  const el=document.getElementById('dash-portfolio');if(!el||!state.D)return;
  const portfolio=state.D.portfolio||[];
  if(!portfolio.length){
    el.innerHTML=`<div style="color:var(--text2);font-size:12px">Нет активов. <a href="#" onclick="window.showScreen('portfolio');return false" style="color:var(--amber);font-weight:700">Добавить →</a></div>`;
    return;
  }
  const total=portfolio.reduce((s,a)=>s+a.qty*(a.currentPrice||a.buyPrice),0);
  const cost=portfolio.reduce((s,a)=>s+a.qty*a.buyPrice,0);
  const pnl=total-cost;
  const pnlPct=cost>0?Math.round(pnl/cost*1000)/10:0;
  const color=pnl>=0?'var(--green-dark)':'var(--red)';
  const lastUpd=state.D.portfolioUpdated?.lastUpdate;
  const daysSince=lastUpd?Math.floor((new Date(today())-new Date(lastUpd))/(1000*60*60*24)):999;
  el.innerHTML=`
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
      <div>
        <div style="font-size:14px;font-weight:700;color:var(--text)">${fmt(Math.round(total))}</div>
        <div style="font-size:11px;color:var(--text2)">${portfolio.length} активов · вложено ${fmt(Math.round(cost))}</div>
      </div>
      <div style="text-align:right">
        <div style="font-size:14px;font-weight:700;color:${color}">${pnl>=0?'+':''}${fmt(Math.round(pnl))}</div>
        <div style="font-size:11px;color:${color}">${pnlPct>=0?'+':''}${pnlPct}%</div>
      </div>
    </div>
    ${daysSince>=7?`<div style="background:var(--blue-bg);border:1px solid var(--blue);border-radius:5px;padding:5px 8px;font-size:11px;color:var(--blue)">⏰ Обновите цены (${daysSince} дн. назад)</div>`:''}
    ${portfolio.slice(0,3).map(a=>{
      const v=a.qty*(a.currentPrice||a.buyPrice);
      const share=total>0?Math.round(v/total*100):0;
      return '<div style="display:flex;justify-content:space-between;font-size:11px;padding:3px 0;border-top:.5px solid var(--border)">'+
        '<span style="font-weight:600;color:var(--text)">'+a.ticker+'</span>'+
        '<span style="color:var(--text2)">'+share+'% · '+fmt(Math.round(v))+'</span>'+
      '</div>';
    }).join('')}
  `;
}

function renderAssetsDash(){
  const el=document.getElementById('dash-physassets');if(!el||!state.D)return;
  const assets=state.D.physAssets||[];
  if(!assets.length){
    el.innerHTML=`<div style="color:var(--text2);font-size:12px">Нет активов. <a href="#" onclick="window.showScreen('physassets');return false" style="color:var(--amber);font-weight:700">Добавить →</a></div>`;
    return;
  }
  const totalValue=assets.reduce((s,a)=>s+a.value,0);
  let html=`<div style="font-size:14px;font-weight:700;color:var(--text);margin-bottom:6px">${fmt(totalValue)}</div>`;
  html+=assets.map(a=>{
    let totalCost=0,filledM=0;
    for(let i=0;i<3;i++){
      const ops=getMOps(-i).filter(o=>!isPlanned(o.type));
      const spent=ops.filter(o=>o.type==='expense'&&(a.categories||[]).includes(o.category)).reduce((s,o)=>s+o.amount,0);
      if(spent>0){totalCost+=spent;filledM++;}
    }
    const monthly=filledM>0?Math.round(totalCost/filledM):0;
    const altAnnual=Math.round(a.value*(a.altRate||18)/100);
    const appreciation=a.prevValue&&a.value?a.value-a.prevValue:Math.round(a.value*(a.growthRate||5)/100);
    const realAnnual=appreciation-monthly*12;
    const better=altAnnual>realAnnual;
    const daysSince=a.lastUpdated?Math.floor((new Date(today())-new Date(a.lastUpdated))/(1000*60*60*24)):999;
    return`<div style="padding:5px 0;border-top:.5px solid var(--border);font-size:11px">
      <div style="display:flex;justify-content:space-between">
        <span style="font-weight:600;color:var(--text)">${a.icon||'🏠'} ${a.name}</span>
        <span style="color:var(--text2)">${fmt(a.value)}</span>
      </div>
      <div style="display:flex;justify-content:space-between;margin-top:2px">
        <span style="color:var(--text2)">содержание: ${fmt(monthly)}/мес</span>
        ${better?`<span style="color:var(--orange-dark);font-weight:600">альт. ${fmt(altAnnual)}/год</span>`:`<span style="color:var(--green-dark)">держать выгодно</span>`}
      </div>
      ${daysSince>=30?`<div style="color:var(--orange-dark);font-size:10px">⚠ обновите стоимость</div>`:''}
    </div>`;
  }).join('');
  el.innerHTML=html;
}

window.openWidgetSettings=function(){
  if(!state.D)return;
  const vis=getWidgetVis();
  const rightWidgets=WIDGETS.filter(w=>w.right);
  document.getElementById('widget-checkboxes').innerHTML=
    '<div style="font-size:11px;color:var(--text2);margin-bottom:10px">Выберите виджеты для правой колонки дашборда:</div>'+
    rightWidgets.map(w=>`
      <label style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border);cursor:pointer;font-size:13px;color:var(--text);">
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

function renderPlanDash(factOps,mInc){
  const el=document.getElementById('dash-plan');if(!el||!state.D)return;
  if(!mInc){el.innerHTML='<div style="color:var(--text2);font-size:12px">Добавьте доходы за этот месяц</div>';return;}
  const rows=state.D.plan.slice(0,5).map(p=>{
    const alloc=Math.round(mInc*p.pct/100);
    const spent=planSpent(p,factOps);
    const pct=alloc>0?Math.min(Math.round(spent/alloc*100),100):0;
    const over=spent>alloc;
    const color=p.type==='income'?'var(--green)':over?'var(--red)':'var(--orange)';
    return`<div style="margin-bottom:7px">
      <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:2px">
        <span style="font-weight:600;color:var(--text)">${p.label}</span>
        <span style="color:${color}">${fmt(spent)} / ${fmt(alloc)}</span>
      </div>
      <div style="background:var(--g50);border-radius:3px;height:4px">
        <div style="height:4px;border-radius:3px;background:${color};width:${pct}%"></div>
      </div>
    </div>`;
  }).join('');
  el.innerHTML=rows+(state.D.plan.length>5?`<div style="font-size:10px;color:var(--text2);margin-top:4px">и ещё ${state.D.plan.length-5} статей →</div>`:'');
}

function renderLimitsDash(factOps){
  const el=document.getElementById('dash-limits');if(!el||!state.D)return;
  const limits=state.D.categoryLimits||[];
  if(!limits.length){el.innerHTML='<div style="color:var(--text2);font-size:12px">Нет лимитов. Настройте в Аналитике →</div>';return;}
  const now=new Date();const ym=now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0');
  const mOps=state.D.operations.filter(o=>!isPlanned(o.type)&&o.date&&o.date.startsWith(ym));
  el.innerHTML=limits.map(lim=>{
    const spent=mOps.filter(o=>o.type==='expense'&&o.category===lim.cat).reduce((s,o)=>s+o.amount,0);
    const pct=Math.min(Math.round(spent/lim.limit*100),100);
    const color=pct>=100?'var(--red)':pct>=80?'var(--orange)':'var(--amber)';
    return`<div style="margin-bottom:7px">
      <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:2px">
        <span style="font-weight:600;color:var(--text)">${lim.cat}</span>
        <span style="color:${color}">${pct}% · ${fmt(spent)} / ${fmt(lim.limit)}</span>
      </div>
      <div style="background:var(--g50);border-radius:3px;height:4px">
        <div style="height:4px;border-radius:3px;background:${color};width:${pct}%"></div>
      </div>
    </div>`;
  }).join('');
}

function renderForecastDash(){
  const el=document.getElementById('dash-forecast');if(!el||!state.D)return;
  const now=new Date();
  let sInc=0,sExp=0,cnt=0;
  for(let i=1;i<=3;i++){
    const ops=getMOps(-i).filter(o=>!isPlanned(o.type));
    const inc=ops.filter(o=>o.type==='income').reduce((s,o)=>s+o.amount,0);
    const exp=ops.filter(o=>o.type==='expense').reduce((s,o)=>s+o.amount,0);
    if(inc>0||exp>0){sInc+=inc;sExp+=exp;cnt++;}
  }
  if(!cnt){el.innerHTML='<div style="color:var(--text2);font-size:12px">Недостаточно данных</div>';return;}
  const avg=(sInc-sExp)/cnt;
  const monthsLeft=12-now.getMonth()-1;
  const yr=now.getFullYear();
  const yrOps=state.D.operations.filter(o=>!isPlanned(o.type)&&o.date&&o.date.startsWith(String(yr)));
  const yrBal=yrOps.filter(o=>o.type==='income').reduce((s,o)=>s+o.amount,0)-yrOps.filter(o=>o.type==='expense').reduce((s,o)=>s+o.amount,0);
  const proj=yrBal+avg*monthsLeft;
  const color=proj>=0?'var(--green-dark)':'var(--red)';
  el.innerHTML=`<div style="display:flex;justify-content:space-between;align-items:center">
    <div><div style="font-size:11px;color:var(--text2)">За год накоплено</div><div style="font-size:14px;font-weight:700;color:var(--text)">${fmt(yrBal)}</div></div>
    <div style="text-align:right"><div style="font-size:11px;color:var(--text2)">Прогноз к декабрю</div><div style="font-size:14px;font-weight:700;color:${color}">${proj<0?'−':''}${fmt(proj)}</div></div>
  </div>
  <div style="font-size:10px;color:var(--text2);margin-top:5px">Ср. баланс/мес: ${avg>=0?'+':''}${fmt(Math.round(avg))} · осталось ${monthsLeft} мес.</div>`;
}

function renderAnomaliesDash(factOps){
  const el=document.getElementById('dash-anomalies');if(!el||!state.D)return;
  const anomalies=detectAnomalies(factOps);
  if(!anomalies.length){el.innerHTML='<div style="color:var(--green-dark);font-size:12px">✓ Аномальных трат нет</div>';return;}
  el.innerHTML=anomalies.slice(0,3).map(a=>
    `<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:.5px solid var(--border);font-size:12px">
      <span style="color:var(--text);font-weight:600">${a.cat}</span>
      <span style="color:var(--red)">+${a.pct}% vs среднего</span>
    </div>`
  ).join('');
}

function renderTodayDash(){
  const el=document.getElementById('dash-today');if(!el||!state.D)return;
  const ds=new Date().toISOString().split('T')[0];
  const ops=state.D.operations.filter(o=>o.date===ds&&!isPlanned(o.type));
  const inc=ops.filter(o=>o.type==='income').reduce((s,o)=>s+o.amount,0);
  const exp=ops.filter(o=>o.type==='expense').reduce((s,o)=>s+o.amount,0);
  const bal=inc-exp;
  if(!ops.length){el.innerHTML='<div style="color:var(--text2);font-size:12px">Сегодня операций нет</div>';return;}
  el.innerHTML=`<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px">
    <div><div style="font-size:9px;color:var(--text2);font-weight:700">ДОХОД</div><div style="font-size:14px;font-weight:700;color:var(--green-dark)">${fmt(inc)}</div></div>
    <div><div style="font-size:9px;color:var(--text2);font-weight:700">РАСХОД</div><div style="font-size:14px;font-weight:700;color:var(--red)">${fmt(exp)}</div></div>
    <div><div style="font-size:9px;color:var(--text2);font-weight:700">ИТОГО</div><div style="font-size:14px;font-weight:700;color:${bal>=0?'var(--green-dark)':'var(--red)'}">${bal<0?'−':''}${fmt(bal)}</div></div>
  </div>
  ${ops.slice(0,3).map(o=>`<div style="font-size:11px;color:var(--text2);padding:3px 0;border-top:.5px solid var(--border);margin-top:5px">${o.category||'—'} · ${o.type==='income'?'+':'−'}${fmt(o.amount)}</div>`).join('')}
  ${ops.length>3?`<div style="font-size:10px;color:var(--text2)">+${ops.length-3} операций</div>`:''}`;
}

function renderCatDetailDash(factOps){
  const el=document.getElementById('dash-catdetail');if(!el||!state.D)return;
  const cats={};
  factOps.filter(o=>o.type==='expense').forEach(o=>{
    const c=o.category||'—';cats[c]=(cats[c]||0)+o.amount;
  });
  const rows=Object.entries(cats).sort((a,b)=>b[1]-a[1]).slice(0,5);
  if(!rows.length){el.innerHTML='<div style="color:var(--text2);font-size:12px">Нет расходов за этот месяц</div>';return;}
  const max=rows[0][1];
  el.innerHTML=rows.map(([cat,amt])=>`<div style="margin-bottom:6px">
    <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:2px">
      <span style="color:var(--text);font-weight:600">${cat}</span>
      <span style="color:var(--orange-dark)">− ${fmt(amt)}</span>
    </div>
    <div style="background:var(--g50);border-radius:3px;height:3px">
      <div style="height:3px;border-radius:3px;background:var(--orange);width:${Math.round(amt/max*100)}%"></div>
    </div>
  </div>`).join('');
}
