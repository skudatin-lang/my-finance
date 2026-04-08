import{$,fmt,state,sched,today}from'./core.js';

export function renderLoans(){
  if(!state.D)return;
  if(!state.D.loans)state.D.loans=[];
  const el=$('loans-list');if(!el)return;
  const debtWallets=state.D.wallets.filter(w=>w.balance<0);
  let html='';
  if(debtWallets.length&&!state.D.loans.length){
    html+=`<div style="background:var(--blue-bg);border:1px solid var(--blue);border-radius:8px;padding:10px 12px;margin-bottom:12px;font-size:12px;color:var(--blue)">
      Найдены кошельки с долгом: ${debtWallets.map(w=>`<b>${w.name}</b> (${fmt(Math.abs(w.balance))})`).join(', ')}.
      Нажмите «+ Добавить» и привяжите кошелёк для автозаполнения.
    </div>`;
  }
  if(!state.D.loans.length){
    el.innerHTML=html+'<div style="color:var(--text2);font-size:13px;padding:8px 0">Нет займов. Добавьте кредит или кредитную карту.</div>';
    return;
  }
  html+=state.D.loans.map((loan,i)=>{
    const isCard=loan.loanType==='card';
    const schedule=isCard?calcCardSchedule(loan):calcSchedule(loan);
    const paid=schedule.filter(p=>p.date<=today());
    const paidAmount=paid.reduce((s,p)=>s+p.principal,0);
    // For credit card, use wallet balance as remaining debt
    const wallet=state.D.wallets.find(w=>w.id===loan.walletId);
    const remaining=isCard?(wallet?Math.abs(Math.min(wallet.balance,0)):loan.amount-paidAmount):loan.amount-paidAmount;
    const totalInterest=schedule.reduce((s,p)=>s+p.interest,0);
    const nextPayment=schedule.find(p=>p.date>today());
    const pct=loan.amount>0?Math.min(Math.round((loan.amount-remaining)/loan.amount*100),100):0;
    const daysToNext=nextPayment?Math.ceil((new Date(nextPayment.date)-new Date(today()))/(1000*60*60*24)):null;
    const alert=daysToNext!==null&&daysToNext<=7;
    return`<div style="background:var(--card);border:1.5px solid ${alert?'var(--orange)':'var(--border2)'};border-radius:10px;padding:14px 16px;margin-bottom:12px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px">
        <div>
          <div style="font-size:15px;font-weight:700;color:var(--topbar)">${loan.name} ${isCard?'<span style="font-size:10px;background:var(--blue-bg);color:var(--blue);padding:2px 7px;border-radius:5px;margin-left:5px">КРЕДИТКА</span>':''}</div>
          <div style="font-size:11px;color:var(--text2);margin-top:2px">
            ${isCard?`Ставка ${loan.rate}% · мин. ${loan.minPayPct||8}% (мин ${fmt(loan.minPayFixed||600)}) · платёж ~${fmt(loan.payment||0)}/мес`:
            `${loan.rate}% год. · ${loan.months} мес. · с ${fmtD(loan.startDate)}`}
            ${wallet?' · кошелёк: '+wallet.name:''}
          </div>
        </div>
        <div style="display:flex;gap:5px">
          <button class="sbtn blue" onclick="window.editLoan(${i})">Изм.</button>
          <button class="sbtn red" onclick="window.deleteLoan(${i})">Удал.</button>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:10px">
        <div class="bal-item"><div class="bal-lbl">ОСТАТОК ДОЛГА</div><div class="bal-val sm neg">${fmt(remaining)}</div></div>
        <div class="bal-item"><div class="bal-lbl">ПЛАТЁЖ/МЕС</div><div class="bal-val sm">${fmt(loan.payment||0)}</div></div>
        <div class="bal-item red"><div class="bal-lbl">${isCard?'МИН. ПЕРЕПЛАТА':'ПЕРЕПЛАТА'}</div><div class="bal-val sm neg">${fmt(Math.round(totalInterest))}</div></div>
      </div>
      <div style="background:var(--g50);border-radius:4px;height:8px;margin-bottom:6px">
        <div style="height:8px;border-radius:4px;background:var(--green);width:${pct}%"></div>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text2)">
        <span>Погашено ${pct}%</span>
        ${nextPayment?`<span style="color:${alert?'var(--orange-dark)':'var(--text2)'};font-weight:${alert?'700':'400'}">${alert?'⚠ ':''}Платёж ${fmtD(nextPayment.date)}${daysToNext===0?' (сегодня)':daysToNext===1?' (завтра)':' через '+daysToNext+' дн.'}</span>`:'<span style="color:var(--green-dark);font-weight:700">✓ Погашен</span>'}
      </div>
      <button onclick="window.toggleSchedule(${i})" style="margin-top:10px;background:var(--a50);border:1px solid var(--border);border-radius:6px;padding:5px 12px;font-size:11px;color:var(--amber-dark);cursor:pointer;font-weight:700">График погашения</button>
      <div id="schedule-${i}" style="display:none;margin-top:10px;overflow-x:auto">
        <table style="width:100%;border-collapse:collapse;font-size:11px;min-width:400px">
          <tr style="border-bottom:1px solid var(--border)">
            <th style="text-align:left;padding:5px;color:var(--text2)">Дата</th>
            <th style="text-align:right;padding:5px;color:var(--text2)">Платёж</th>
            <th style="text-align:right;padding:5px;color:var(--text2)">Осн. долг</th>
            <th style="text-align:right;padding:5px;color:var(--text2)">%</th>
            <th style="text-align:right;padding:5px;color:var(--text2)">Остаток</th>
          </tr>
          ${schedule.slice(0,24).map(p=>`<tr style="border-bottom:.5px solid var(--border);${p.date<=today()?'opacity:.45':''}">
            <td style="padding:5px">${fmtD(p.date)}</td>
            <td style="text-align:right;padding:5px;font-weight:700">${fmt(p.total)}</td>
            <td style="text-align:right;padding:5px;color:var(--green-dark)">${fmt(p.principal)}</td>
            <td style="text-align:right;padding:5px;color:var(--red)">${fmt(p.interest)}</td>
            <td style="text-align:right;padding:5px">${fmt(p.balance)}</td>
          </tr>`).join('')}
          ${schedule.length>24?`<tr><td colspan="5" style="padding:6px;text-align:center;color:var(--text2);font-size:10px">ещё ${schedule.length-24} платежей...</td></tr>`:''}
        </table>
      </div>
    </div>`;
  }).join('');
  el.innerHTML=html;
}

function calcSchedule(loan){
  const mr=loan.rate/100/12,n=loan.months;
  const pmt=mr>0?Math.round(loan.amount*mr*Math.pow(1+mr,n)/(Math.pow(1+mr,n)-1)):Math.round(loan.amount/n);
  const rows=[];let bal=loan.amount;
  const start=new Date(loan.startDate);
  for(let i=0;i<n&&bal>0;i++){
    const d=new Date(start.getFullYear(),start.getMonth()+i+1,loan.payDay||1);
    const ds=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(loan.payDay||1).padStart(2,'0');
    const interest=Math.round(bal*mr);
    const principal=Math.min(pmt-interest,bal);
    bal=Math.max(bal-principal,0);
    rows.push({date:ds,total:principal+interest,principal,interest,balance:bal});
  }
  return rows;
}

function calcCardSchedule(loan){
  // Кредитка: фиксированный платёж заданный вручную
  // Прогноз до полного погашения
  const mr=loan.rate/100/12;
  const graceDays=loan.graceDays||0;
  const payment=loan.payment||0;
  if(!payment)return[]; // без платежа нет прогноза
  const rows=[];
  let bal=loan.amount;
  const now=new Date();
  const payDay=loan.payDay||25;
  for(let i=0;i<360&&bal>0.5;i++){
    const d=new Date(now.getFullYear(),now.getMonth()+i+1,payDay);
    const ds=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(payDay).padStart(2,'0');
    const interest=graceDays>0&&i===0?0:Math.round(bal*mr);
    const pay=Math.min(payment,bal+interest);
    const principal=Math.min(pay-interest,bal);
    bal=Math.max(bal-principal,0);
    rows.push({date:ds,total:Math.round(pay),principal:Math.round(principal),interest:Math.round(interest),balance:Math.round(bal)});
    if(bal<1)break;
  }
  return rows;
}

function fmtD(ds){if(!ds)return'—';const[y,m,d]=ds.split('-');return d+'.'+m+'.'+y;}

window.toggleSchedule=function(i){
  const el=document.getElementById('schedule-'+i);
  if(el)el.style.display=el.style.display==='none'?'block':'none';
};

window.openAddLoan=function(){
  if(!state.D)return;
  resetLoanModal();
  document.getElementById('modal-loan').classList.add('open');
};

window.editLoan=function(i){
  const l=state.D.loans[i];
  $('loan-idx').value=i;
  $('loan-name').value=l.name;
  $('loan-type').value=l.loanType||'credit';
  toggleLoanType(l.loanType||'credit');
  $('loan-amount').value=l.amount;
  $('loan-rate').value=l.rate;
  $('loan-months').value=l.months||'';
  $('loan-start').value=l.startDate||today();
  const pdEl=$('loan-payday');if(pdEl)pdEl.value=l.payDay||25;
  $('loan-payment').value=l.payment||'';
  const grEl=$('loan-grace');if(grEl)grEl.value=l.graceDays||0;
  const opts='<option value="">— не привязывать —</option>'+
    state.D.wallets.map(w=>`<option value="${w.id}"${w.id===l.walletId?' selected':''}>${w.name} (${w.balance<0?'-':''}${fmt(Math.abs(w.balance))})</option>`).join('');
  $('loan-wallet').innerHTML=opts;
  document.getElementById('modal-loan').classList.add('open');
};

function resetLoanModal(){
  $('loan-idx').value=-1;
  $('loan-name').value='';$('loan-amount').value='';$('loan-rate').value='';
  $('loan-months').value='';$('loan-start').value=today();
  $('loan-payday').value=1;$('loan-payment').value='';$('loan-minpay').value=5;
  $('loan-type').value='credit';toggleLoanType('credit');
  const opts='<option value="">— не привязывать —</option>'+
    state.D.wallets.map(w=>`<option value="${w.id}">${w.name} (${w.balance<0?'долг '+fmt(Math.abs(w.balance)):fmt(w.balance)})</option>`).join('');
  $('loan-wallet').innerHTML=opts;
}

window.toggleLoanType=function(type){
  const isCard=type==='card';
  $('loan-credit-fields').style.display=isCard?'none':'';
  $('loan-card-fields').style.display=isCard?'':'none';
};

window.onLoanWalletChange=function(walletId){
  if(!walletId)return;
  const w=state.D.wallets.find(w=>w.id===walletId);
  if(!w)return;
  const isCard=$('loan-type').value==='card';
  const balance=Math.abs(Math.min(w.balance,0));
  if(balance>0){
    $('loan-amount').value=balance;
    if(!$('loan-name').value)$('loan-name').value=w.name;
  }
};

window.saveLoan=function(){
  if(!state.D.loans)state.D.loans=[];
  const idx=+$('loan-idx').value;
  const loanType=$('loan-type').value;
  const isCard=loanType==='card';
  const amount=parseFloat($('loan-amount').value)||0;
  const rate=parseFloat($('loan-rate').value)||0;
  const months=parseInt($('loan-months').value)||0;
  const payment=parseFloat($('loan-payment').value)||0;
  if(!$('loan-name').value||!amount){alert('Заполните название и сумму');return;}
  if(!isCard&&!months){alert('Укажите срок кредита');return;}
  const mr=rate/100/12;
  let calcPayment=payment;
  if(!calcPayment){
    if(isCard){
      calcPayment=0; // пользователь вводит вручную
    }else if(months>0){
      calcPayment=mr>0?Math.round(amount*mr*Math.pow(1+mr,months)/(Math.pow(1+mr,months)-1)):Math.round(amount/months);
    }
  }
  const loan={
    id:idx>=0?state.D.loans[idx].id:('loan'+Date.now()),
    loanType,name:$('loan-name').value.trim(),
    amount,rate,months:isCard?0:months,
    startDate:$('loan-start').value,
    payDay:parseInt($('loan-payday').value)||25,
    payment:calcPayment,
    graceDays:isCard?parseInt($('loan-grace')?.value||0):undefined,
    walletId:$('loan-wallet').value||null
  };
  if(idx>=0)state.D.loans[idx]=loan;else state.D.loans.push(loan);
  sched();
  document.getElementById('modal-loan').classList.remove('open');
  renderLoans();renderLoansSummaryInternal();
};

window.deleteLoan=function(i){
  if(!confirm('Удалить?'))return;
  state.D.loans.splice(i,1);sched();renderLoans();renderLoansSummaryInternal();
};

function renderLoansSummaryInternal(){
  const el=$('loans-summary');if(!el||!state.D)return;
  const loans=state.D.loans||[];
  const debtWallets=state.D.wallets.filter(w=>w.balance<0);
  const totalWalletDebt=debtWallets.reduce((s,w)=>s+Math.abs(w.balance),0);
  let totalInterest=0;
  loans.forEach(l=>{
    const schedule=l.loanType==='card'?calcCardSchedule(l):calcSchedule(l);
    totalInterest+=schedule.reduce((s,p)=>s+p.interest,0);
  });
  const monthlyPayments=loans.reduce((s,l)=>s+l.payment,0);
  el.innerHTML=`<div class="bal-grid">
    <div class="bal-item full red"><div class="bal-lbl">ОБЩИЙ ДОЛГ (кошельки)</div><div class="bal-val neg">${fmt(totalWalletDebt)}</div></div>
    <div class="bal-item"><div class="bal-lbl">ПЛАТЕЖЕЙ/МЕС</div><div class="bal-val sm">${fmt(monthlyPayments)}</div></div>
    <div class="bal-item red"><div class="bal-lbl">ПЕРЕПЛАТА ВСЕГО</div><div class="bal-val sm neg">${fmt(Math.round(totalInterest))}</div></div>
  </div>
  ${loans.length===0&&debtWallets.length>0?`<div style="margin-top:10px;font-size:12px;color:var(--text2)">Добавьте займы для расчёта переплаты и графика погашения</div>`:''}`;
}
export{renderLoansSummaryInternal as renderLoansSummary};
