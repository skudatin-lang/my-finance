import{$,fmt,state,MONTHS,getMOps,isPlanned,planSpent,today}from'./core.js';

export function renderAnalytics(){
  if(!state.D)return;
  renderComparison();
  renderAnomalies();
  renderYearForecast();
}

function renderComparison(){
  const el=$('analytics-compare');if(!el)return;
  const cur=getMOps(0).filter(o=>!isPlanned(o.type));
  const prev=getMOps(-1).filter(o=>!isPlanned(o.type));
  const curInc=cur.filter(o=>o.type==='income').reduce((s,o)=>s+o.amount,0);
  const curExp=cur.filter(o=>o.type==='expense').reduce((s,o)=>s+o.amount,0);
  const prevInc=prev.filter(o=>o.type==='income').reduce((s,o)=>s+o.amount,0);
  const prevExp=prev.filter(o=>o.type==='expense').reduce((s,o)=>s+o.amount,0);

  const now=new Date();
  const prevMonth=new Date(now.getFullYear(),now.getMonth()-1,1);
  const pLabel=MONTHS[prevMonth.getMonth()];

  const rows=[
    {label:'Доходы',cur:curInc,prev:prevInc},
    {label:'Расходы',cur:curExp,prev:prevExp},
    {label:'Баланс',cur:curInc-curExp,prev:prevInc-prevExp}
  ];

  // Category comparison
  const catRows=state.D.expenseCats.map(c=>{
    const curAmt=cur.filter(o=>o.type==='expense'&&o.category===c.name).reduce((s,o)=>s+o.amount,0);
    const prevAmt=prev.filter(o=>o.type==='expense'&&o.category===c.name).reduce((s,o)=>s+o.amount,0);
    return{label:c.name,cur:curAmt,prev:prevAmt};
  }).filter(r=>r.cur>0||r.prev>0).sort((a,b)=>b.cur-a.cur);

  el.innerHTML=`
    <div style="font-size:11px;font-weight:700;color:var(--text2);margin-bottom:8px;letter-spacing:.5px">СРАВНЕНИЕ С ${pLabel}</div>
    ${rows.map(r=>{
      const delta=r.prev>0?Math.round((r.cur-r.prev)/r.prev*100):null;
      const color=r.label==='Расходы'?(delta>0?'var(--red)':'var(--green)'):(delta>0?'var(--green)':'var(--red)');
      return`<div style="display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid var(--border)">
        <span style="font-size:13px;font-weight:700;color:var(--topbar)">${r.label}</span>
        <div style="text-align:right">
          <div style="font-size:13px;font-weight:700">${fmt(r.cur)}</div>
          ${delta!==null?`<div style="font-size:10px;color:${color}">${delta>0?'▲':'▼'} ${Math.abs(delta)}% vs ${pLabel}</div>`:''}
        </div>
      </div>`;
    }).join('')}
    <div style="font-size:11px;font-weight:700;color:var(--text2);margin:12px 0 6px;letter-spacing:.5px">ПО КАТЕГОРИЯМ</div>
    ${catRows.slice(0,6).map(r=>{
      const delta=r.prev>0?Math.round((r.cur-r.prev)/r.prev*100):null;
      const color=delta>0?'var(--red)':'var(--green)';
      return`<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border)">
        <span style="font-size:12px;color:var(--topbar)">${r.label}</span>
        <div style="text-align:right">
          <span style="font-size:12px;font-weight:700;color:var(--orange-dark)">${fmt(r.cur)}</span>
          ${delta!==null?`<span style="font-size:10px;color:${color};margin-left:6px">${delta>0?'▲':'▼'}${Math.abs(delta)}%</span>`:''}
        </div>
      </div>`;
    }).join('')}
  `;
}

function renderAnomalies(){
  const el=$('analytics-anomalies');if(!el)return;
  // Calculate mean and stddev per category over last 6 months
  const now=new Date();
  const anomalies=[];

  state.D.expenseCats.forEach(c=>{
    const monthly=[];
    for(let i=1;i<=6;i++){
      const dt=new Date(now.getFullYear(),now.getMonth()-i,1);
      const ym=dt.getFullYear()+'-'+String(dt.getMonth()+1).padStart(2,'0');
      const ops=state.D.operations.filter(o=>!isPlanned(o.type)&&o.type==='expense'&&o.category===c.name&&o.date&&o.date.startsWith(ym));
      monthly.push(ops.reduce((s,o)=>s+o.amount,0));
    }
    const filled=monthly.filter(v=>v>0);
    if(filled.length<2)return;
    const mean=filled.reduce((s,v)=>s+v,0)/filled.length;
    const variance=filled.reduce((s,v)=>s+(v-mean)**2,0)/filled.length;
    const std=Math.sqrt(variance);
    const curOps=getMOps(0).filter(o=>!isPlanned(o.type)&&o.type==='expense'&&o.category===c.name);
    const cur=curOps.reduce((s,o)=>s+o.amount,0);
    if(std>0&&cur>mean+2*std){
      const pct=Math.round((cur-mean)/mean*100);
      anomalies.push({cat:c.name,cur,mean,pct});
    }
  });

  if(!anomalies.length){
    el.innerHTML='<div style="color:var(--green-dark);font-size:13px;padding:6px 0">✓ Аномальных трат не обнаружено</div>';
    return;
  }
  el.innerHTML=anomalies.sort((a,b)=>b.pct-a.pct).map(a=>
    `<div style="background:var(--red-bg);border:1px solid var(--red);border-radius:7px;padding:8px 11px;margin-bottom:7px">
      <div style="font-size:13px;font-weight:700;color:var(--red)">⚠ ${a.cat}</div>
      <div style="font-size:11px;color:var(--red);margin-top:2px">Потрачено ${fmt(a.cur)} — на ${a.pct}% больше среднего (${fmt(Math.round(a.mean))})</div>
    </div>`
  ).join('');
}

function renderYearForecast(){
  const el=$('analytics-forecast');if(!el)return;
  const now=new Date();
  // Average income/expense over last 3 months
  let sumInc=0,sumExp=0,cnt=0;
  for(let i=1;i<=3;i++){
    const ops=getMOps(-i).filter(o=>!isPlanned(o.type));
    sumInc+=ops.filter(o=>o.type==='income').reduce((s,o)=>s+o.amount,0);
    sumExp+=ops.filter(o=>o.type==='expense').reduce((s,o)=>s+o.amount,0);
    cnt++;
  }
  const avgInc=cnt>0?sumInc/cnt:0;
  const avgExp=cnt>0?sumExp/cnt:0;
  const monthsLeft=12-now.getMonth()-1;
  // Current year so far
  const yr=now.getFullYear();
  const yrOps=state.D.operations.filter(o=>!isPlanned(o.type)&&o.date&&o.date.startsWith(String(yr)));
  const yrInc=yrOps.filter(o=>o.type==='income').reduce((s,o)=>s+o.amount,0);
  const yrExp=yrOps.filter(o=>o.type==='expense').reduce((s,o)=>s+o.amount,0);
  const projInc=yrInc+avgInc*monthsLeft;
  const projExp=yrExp+avgExp*monthsLeft;
  const projBal=projInc-projExp;

  el.innerHTML=`
    <div style="font-size:11px;color:var(--text2);margin-bottom:8px">На основе среднего за последние 3 месяца. Осталось ${monthsLeft} мес. до конца года.</div>
    <div class="bal-grid">
      <div class="bal-item"><div class="bal-lbl">ПРОГНОЗ ДОХОД</div><div class="bal-val sm pos">${fmt(projInc)}</div></div>
      <div class="bal-item red"><div class="bal-lbl">ПРОГНОЗ РАСХОД</div><div class="bal-val sm neg">${fmt(projExp)}</div></div>
      <div class="bal-item full" style="background:${projBal>=0?'var(--green-bg)':'var(--red-bg)'}">
        <div class="bal-lbl">ПРОГНОЗ БАЛАНС НА КОНЕЦ ГОДА</div>
        <div class="bal-val ${projBal>=0?'pos':'neg'}">${projBal<0?'−':''}${fmt(projBal)}</div>
      </div>
    </div>
  `;
}

// ── CSV Export ──────────────────────────────────────────────────────────────
export function exportCSV(monthOffset=0){
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
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download=`finance-${ym}.csv`;
  a.click();
}

export function exportAllCSV(){
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
