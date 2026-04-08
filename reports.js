import{$,fmt,fmtS,state,MONTHS,getMOps,planById,catPlanId,isPlanned,opHtml,planSpent,sched,wName}from'./core.js';

let curCatTab='income';

export function renderReports(){
  if(!state.D)return;
  const dt=new Date(new Date().getFullYear(),new Date().getMonth()+state.repOff,1);
  $('rep-month-lbl').textContent=MONTHS[dt.getMonth()]+' '+dt.getFullYear();
  const ops=getMOps(state.repOff),factOps=ops.filter(o=>!isPlanned(o.type));
  const mInc=factOps.filter(o=>o.type==='income').reduce((s,o)=>s+o.amount,0);
  const mExp=factOps.filter(o=>o.type==='expense').reduce((s,o)=>s+o.amount,0);
  const mBal=mInc-mExp;
  const totalBal=state.D.wallets.reduce((s,w)=>s+w.balance,0);
  const yr=dt.getFullYear();
  const yrOps=state.D.operations.filter(o=>!isPlanned(o.type)&&o.date&&o.date.startsWith(String(yr)));
  const yBal=yrOps.filter(o=>o.type==='income').reduce((s,o)=>s+o.amount,0)-yrOps.filter(o=>o.type==='expense').reduce((s,o)=>s+o.amount,0);

  const setVal=(id,val)=>{
    const el=$(id);if(!el)return;
    el.textContent=(val<0?'\u2212 ':'')+fmt(val);
    el.className=el.className.replace(/\s*(pos|neg)/g,'')+(val<0?' neg':(val>0?' pos':''));
  };
  setVal('r-total-bal',totalBal);setVal('r-month-bal',mBal);setVal('r-year-bal',yBal);
  $('r-month-inc').textContent=fmt(mInc);
  $('r-month-exp').textContent=fmt(mExp);

  const expInc=ops.filter(o=>o.type==='planned_income').reduce((s,o)=>s+o.amount,0);
  const expExp=ops.filter(o=>o.type==='planned_expense').reduce((s,o)=>s+o.amount,0);
  $('m-inc-cur').textContent=fmt(mInc);$('m-inc-exp').textContent=fmt(expInc);
  $('m-exp-cur').textContent=fmt(mExp);$('m-exp-exp').textContent=fmt(expExp);

  $('r-wallets').innerHTML=state.D.wallets.map(w=>`<div class="wallet-row">
    <div><span class="wname">${w.name}</span>${w.balance<0?'<span class="w-badge">долг</span>':''}</div>
    <span class="wamt${w.balance<0?' neg':''}">${w.balance<0?'\u2212 ':''}${fmt(w.balance)}</span>
  </div>`).join('');

  const rp=$('r-plan');
  if(state.D.plan.length&&mInc>0){
    rp.innerHTML=state.D.plan.map(p=>{
      const alloc=Math.round(mInc*p.pct/100);
      if(p.type==='income'){
        // Учитываем и переводы с planId, и расходы с category===p.label (напр. "Бизнес")
        const transfers=factOps.filter(o=>o.type==='transfer'&&o.planId===p.id).reduce((s,o)=>s+o.amount,0);
        const expenses=factOps.filter(o=>o.type==='expense'&&o.category===p.label).reduce((s,o)=>s+o.amount,0);
        const used=transfers+expenses;
        const left=alloc-used;
        const pct=alloc>0?Math.min(Math.round(used/alloc*100),100):0;
        return`<div class="plan-card inc">
          <div class="plan-card-name inc">${p.label.toUpperCase()}</div>
          <div class="plan-card-val inc">${fmt(used)} / ${fmt(alloc)}</div>
          <div class="plan-card-bar"><div class="plan-card-fill${pct>=100?' over':''}" style="width:${Math.max(pct,0)}%"></div></div>
          <div class="plan-card-status ${left<=0?'ok':'bad'}">${left<=0?'использовано: '+fmt(used):'осталось: '+fmt(left)}</div>
        </div>`;
      }else{
        const cats=state.D.expenseCats.filter(c=>c.planId===p.id).map(c=>c.name);
        const spent=planSpent(p,factOps);
        const left=alloc-spent,pct=alloc>0?Math.min(Math.round(spent/alloc*100),100):0;
        return`<div class="plan-card exp">
          <div class="plan-card-name exp">${p.label.toUpperCase()}</div>
          <div style="font-size:9px;color:var(--orange-dark);text-align:center;margin-bottom:3px">${cats.length?cats.join(', '):'—'}</div>
          <div class="plan-card-val exp">${fmt(spent)} / ${fmt(alloc)}</div>
          <div class="plan-card-bar"><div class="plan-card-fill exp${pct>=100?' over':''}" style="width:${pct}%"></div></div>
          <div class="plan-card-status ${left>=0?'ok':'bad'}">${left>=0?'остаток: '+fmt(left):'перерасход: '+fmt(-left)}</div>
        </div>`;
      }
    }).join('');
  }else{
    rp.innerHTML=`<div style="grid-column:1/-1;text-align:center;padding:16px;color:var(--text2);font-size:13px">${mInc===0?'Добавьте доходы':'Настройте финплан'}</div>`;
  }

  if(state.walletIdx>=state.D.wallets.length)state.walletIdx=0;
  $('wnav-lbl').textContent=state.D.wallets[state.walletIdx]?.name||'—';
  renderWalletOps();
  renderCatList(factOps);
}

export function renderWalletOps(){
  if(!state.D)return;
  const wid=state.D.wallets[state.walletIdx]?.id;
  const factOps=getMOps(state.repOff).filter(o=>!isPlanned(o.type));
  const wOps=factOps.filter(o=>o.wallet===wid||o.walletTo===wid);
  const el=$('r-wallet-ops');if(!el)return;
  if(!wOps.length){el.innerHTML='<div style="padding:16px;text-align:center;color:var(--text2);font-size:13px">Нет операций за этот месяц</div>';return;}
  el.innerHTML=[...wOps].sort((a,b)=>a.date<b.date?1:-1).map(o=>opHtml(o,true)).join('');
}

export function setCatTab(tab){
  curCatTab=tab;
  $('cattab-income').className='cat-tab'+(tab==='income'?' active':'');
  $('cattab-expense').className='cat-tab'+(tab==='expense'?' active':'');
  renderCatList(getMOps(state.repOff).filter(o=>!isPlanned(o.type)));
}

function renderCatList(factOps){
  const el=$('r-cat-list');if(!el)return;
  const isInc=curCatTab==='income';
  const cats=isInc?state.D.incomeCats:state.D.expenseCats.map(c=>c.name);
  const rows=cats.map(cat=>{
    const catOps=factOps.filter(o=>o.type===(isInc?'income':'expense')&&o.category===cat);
    return{cat,total:catOps.reduce((s,o)=>s+o.amount,0),count:catOps.length};
  }).filter(r=>r.total>0).sort((a,b)=>b.total-a.total);
  const maxVal=rows.length?rows[0].total:1;
  if(!rows.length){el.innerHTML='<div style="padding:16px;text-align:center;color:var(--text2);font-size:13px">Нет операций</div>';return;}
  el.innerHTML=rows.map(r=>{
    const pct=Math.round(r.total/maxVal*100);
    return`<div class="cat-row">
      <div class="cat-left">
        <div class="cat-name">${r.cat}</div>
        <div class="cat-cnt">${r.count} опер.</div>
        <div class="cat-bar${isInc?'':' exp'}" style="width:${pct}%"></div>
      </div>
      <div class="cat-amt${isInc?' pos':' neg'}">${isInc?'+ ':'\u2212 '}${fmt(r.total)}</div>
    </div>`;
  }).join('');
}
