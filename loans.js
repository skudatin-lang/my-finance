import{$,state,sched,fmt,today}from'./core.js';

// Кредиты и долги — данные берутся из кошельков с отрицательным балансом
// плюс ручной массив state.D.loans (name, payment, payDay, rate)

export function renderLoans(){
  if(!state.D)return;
  const el=$('loans-list');if(!el)return;
  if(!state.D.loans)state.D.loans=[];

  const debtWallets=state.D.wallets.filter(w=>w.balance<0);
  const manualLoans=state.D.loans;

  if(!debtWallets.length&&!manualLoans.length){
    el.innerHTML='<div style="color:var(--green-dark);font-size:13px;padding:12px 0">✓ Долгов нет</div>';
    return;
  }

  let html='';

  debtWallets.forEach((w,i)=>{
    const debt=Math.abs(w.balance);
    const rate=w.rate||0;
    const payment=w.payment||0;
    const payDay=w.payDay||1;
    const monthsLeft=payment>0?Math.ceil(debt/payment):null;
    const interest=rate>0?Math.round(debt*rate/100/12):0;
    const now=new Date();
    let nextDate='';
    if(payDay){
      let d=new Date(now.getFullYear(),now.getMonth(),payDay);
      if(d<=new Date(today()))d=new Date(now.getFullYear(),now.getMonth()+1,payDay);
      nextDate=d.toLocaleDateString('ru-RU',{day:'numeric',month:'long'});
    }
    html+=`<div style="background:var(--card);border:1.5px solid var(--border2);border-radius:10px;padding:14px;margin-bottom:10px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">
        <div style="font-size:14px;font-weight:700;color:var(--topbar)">${w.name}</div>
        <div style="font-size:16px;font-weight:700;color:var(--red)">− ${fmt(debt)}</div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:11px;color:var(--text2)">
        ${rate?`<div>Ставка: <b style="color:var(--topbar)">${rate}%</b></div>`:''}
        ${payment?`<div>Платёж: <b style="color:var(--topbar)">${fmt(payment)}/мес</b></div>`:''}
        ${interest?`<div>% в мес: <b style="color:var(--orange-dark)">${fmt(interest)}</b></div>`:''}
        ${monthsLeft?`<div>Осталось: <b style="color:var(--topbar)">~${monthsLeft} мес</b></div>`:''}
        ${nextDate?`<div style="grid-column:1/-1">Следующий платёж: <b style="color:var(--topbar)">${nextDate}</b></div>`:''}
      </div>
      ${payment?`<div style="background:var(--g50);border-radius:4px;height:6px;margin-top:10px">
        <div style="height:6px;border-radius:4px;background:var(--red);width:100%"></div>
      </div>`:''}
      <div style="margin-top:8px">
        <button class="sbtn blue" onclick="window.openEditWallet(${state.D.wallets.indexOf(w)})" style="font-size:11px">Редактировать</button>
      </div>
    </div>`;
  });

  el.innerHTML=html||'<div style="color:var(--text2);font-size:13px">Нет долговых кошельков</div>';
}

export function renderLoansSummary(){
  if(!state.D)return;
  const el=$('loans-summary');if(!el)return;
  if(!state.D.loans)state.D.loans=[];

  const debtWallets=state.D.wallets.filter(w=>w.balance<0);
  if(!debtWallets.length){
    el.innerHTML='<div style="color:var(--green-dark);font-size:13px;padding:12px 0">✓ Долгов нет</div>';
    return;
  }

  const totalDebt=debtWallets.reduce((s,w)=>s+Math.abs(w.balance),0);
  const totalPayment=debtWallets.reduce((s,w)=>s+(w.payment||0),0);
  const totalInterest=debtWallets.reduce((s,w)=>s+(w.rate?Math.round(Math.abs(w.balance)*w.rate/100/12):0),0);

  // Fastest payoff: highest rate first (avalanche)
  const sorted=[...debtWallets].filter(w=>w.rate).sort((a,b)=>(b.rate||0)-(a.rate||0));

  el.innerHTML=`
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px">
      <div style="background:var(--red-bg);border-radius:8px;padding:10px;border:1px solid var(--r200)">
        <div style="font-size:9px;font-weight:700;color:var(--text2);letter-spacing:.6px">ОБЩИЙ ДОЛГ</div>
        <div style="font-size:18px;font-weight:700;color:var(--red)">${fmt(totalDebt)}</div>
      </div>
      <div style="background:var(--amber-light);border-radius:8px;padding:10px;border:1px solid var(--border)">
        <div style="font-size:9px;font-weight:700;color:var(--text2);letter-spacing:.6px">ПЛАТЕЖЕЙ/МЕС</div>
        <div style="font-size:18px;font-weight:700;color:var(--topbar)">${fmt(totalPayment)}</div>
      </div>
    </div>
    ${totalInterest?`<div style="background:var(--orange-bg);border:1px solid var(--orange);border-radius:7px;padding:8px 12px;font-size:12px;color:var(--orange-dark);margin-bottom:12px">
      💸 Переплата процентами: <b>${fmt(totalInterest)}/мес</b>
    </div>`:''}
    ${sorted.length?`<div style="font-size:11px;font-weight:700;color:var(--text2);letter-spacing:.5px;margin-bottom:6px">СТРАТЕГИЯ «ЛАВИНА» (сначала гасите высокую ставку):</div>`:''}
    ${sorted.map((w,i)=>`<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:.5px solid var(--border);font-size:12px">
      <span style="color:var(--topbar);font-weight:600">${i+1}. ${w.name}</span>
      <span style="color:var(--orange-dark)">${w.rate}% · ${fmt(Math.abs(w.balance))}</span>
    </div>`).join('')}
    <div style="font-size:11px;color:var(--text2);margin-top:10px">
      Параметры кредита (ставку, платёж, дату) редактируйте через кошелёк в разделе Настройки.
    </div>
  `;
}
