import{$,fmt,state,sched,today}from'./core.js';

export function renderLoans(){
  if(!state.D)return;
  if(!state.D.loans)state.D.loans=[];
  const el=$('loans-list');if(!el)return;

  // Also show negative wallets as potential loans
  const debtWallets=state.D.wallets.filter(w=>w.balance<0);

  if(!state.D.loans.length&&!debtWallets.length){
    el.innerHTML='<div style="color:var(--text2);font-size:13px;padding:8px 0">Нет займов. Добавьте или заведите кошелёк с отрицательным балансом.</div>';
    return;
  }

  let html='';

  // Negative wallet hints
  if(debtWallets.length){
    html+=`<div style="background:var(--blue-bg);border:1px solid var(--blue);border-radius:8px;padding:10px 12px;margin-bottom:12px;font-size:12px;color:var(--blue)">
      Кошельки с долгом: ${debtWallets.map(w=>w.name+' ('+fmt(Math.abs(w.balance))+')').join(', ')}. Добавьте их как займы ниже для расчёта графика погашения.
    </div>`;
  }

  html+=state.D.loans.map((loan,i)=>{
    const schedule=calcSchedule(loan);
    const paid=schedule.filter(p=>p.date<=today());
    const paidAmount=paid.reduce((s,p)=>s+p.principal,0);
    const remaining=loan.amount-paidAmount;
    const totalInterest=schedule.reduce((s,p)=>s+p.interest,0);
    const nextPayment=schedule.find(p=>p.date>today());
    const pct=Math.round(paidAmount/loan.amount*100);
    const daysToNext=nextPayment?Math.ceil((new Date(nextPayment.date)-new Date(today()))/(1000*60*60*24)):null;
    const alert=daysToNext!==null&&daysToNext<=7;

    return`<div style="background:var(--card);border:1.5px solid ${alert?'var(--orange)':'var(--border2)'};border-radius:10px;padding:14px 16px;margin-bottom:12px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px">
        <div>
          <div style="font-size:15px;font-weight:700;color:var(--topbar)">${loan.name}</div>
          <div style="font-size:11px;color:var(--text2);margin-top:2px">${loan.rate}% годовых · ${loan.months} мес. · с ${fmtDate(loan.startDate)}</div>
        </div>
        <div style="display:flex;gap:5px">
          <button class="sbtn blue" onclick="window.editLoan(${i})">Изм.</button>
          <button class="sbtn red" onclick="window.deleteLoan(${i})">Удал.</button>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:10px">
        <div class="bal-item"><div class="bal-lbl">ОСТАЛОСЬ</div><div class="bal-val sm neg">${fmt(remaining)}</div></div>
        <div class="bal-item"><div class="bal-lbl">ПЛАТЁЖ/МЕС</div><div class="bal-val sm">${fmt(loan.payment||schedule[0]?.total||0)}</div></div>
        <div class="bal-item red"><div class="bal-lbl">ПЕРЕПЛАТА</div><div class="bal-val sm neg">${fmt(totalInterest)}</div></div>
      </div>
      <div style="background:var(--g50);border-radius:4px;height:8px;margin-bottom:6px">
        <div style="height:8px;border-radius:4px;background:var(--green);width:${pct}%"></div>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text2)">
        <span>Погашено ${pct}% · ${fmt(paidAmount)} из ${fmt(loan.amount)}</span>
        ${nextPayment?`<span style="color:${alert?'var(--orange-dark)':'var(--text2)'};font-weight:${alert?'700':'400'}">${alert?'⚠ ':''}Следующий платёж ${fmtDate(nextPayment.date)}${daysToNext===0?' (сегодня)':daysToNext===1?' (завтра)':' через '+daysToNext+' дн.'}</span>`:'<span style="color:var(--green-dark);font-weight:700">✓ Погашен</span>'}
      </div>
      <button onclick="window.toggleSchedule(${i})" style="margin-top:10px;background:var(--a50);border:1px solid var(--border);border-radius:6px;padding:5px 12px;font-size:11px;color:var(--amber-dark);cursor:pointer;font-weight:700">График погашения</button>
      <div id="schedule-${i}" style="display:none;margin-top:10px">
        <table style="width:100%;border-collapse:collapse;font-size:11px">
          <tr style="border-bottom:1px solid var(--border)"><th style="text-align:left;padding:4px;color:var(--text2)">Дата</th><th style="text-align:right;padding:4px;color:var(--text2)">Платёж</th><th style="text-align:right;padding:4px;color:var(--text2)">Основной долг</th><th style="text-align:right;padding:4px;color:var(--text2)">Проценты</th><th style="text-align:right;padding:4px;color:var(--text2)">Остаток</th></tr>
          ${schedule.slice(0,24).map(p=>`<tr style="border-bottom:.5px solid var(--border);${p.date<=today()?'opacity:.5':''}">
            <td style="padding:4px">${fmtDate(p.date)}</td>
            <td style="text-align:right;padding:4px;font-weight:700">${fmt(p.total)}</td>
            <td style="text-align:right;padding:4px;color:var(--green-dark)">${fmt(p.principal)}</td>
            <td style="text-align:right;padding:4px;color:var(--red)">${fmt(p.interest)}</td>
            <td style="text-align:right;padding:4px">${fmt(p.balance)}</td>
          </tr>`).join('')}
          ${schedule.length>24?`<tr><td colspan="5" style="padding:6px;text-align:center;color:var(--text2);font-size:10px">...ещё ${schedule.length-24} платежей</td></tr>`:''}
        </table>
      </div>
    </div>`;
  }).join('');

  el.innerHTML=html;
}

function calcSchedule(loan){
  const monthlyRate=loan.rate/100/12;
  const n=loan.months;
  const pmt=monthlyRate>0
    ?Math.round(loan.amount*monthlyRate*Math.pow(1+monthlyRate,n)/(Math.pow(1+monthlyRate,n)-1))
    :Math.round(loan.amount/n);
  const schedule=[];
  let balance=loan.amount;
  const start=new Date(loan.startDate);
  for(let i=0;i<n;i++){
    const date=new Date(start.getFullYear(),start.getMonth()+i+1,loan.payDay||1);
    const ds=date.getFullYear()+'-'+String(date.getMonth()+1).padStart(2,'0')+'-'+String(loan.payDay||1).padStart(2,'0');
    const interest=Math.round(balance*monthlyRate);
    const principal=Math.min(pmt-interest,balance);
    balance=Math.max(balance-principal,0);
    schedule.push({date:ds,total:principal+interest,principal,interest,balance});
    if(balance===0)break;
  }
  return schedule;
}

function fmtDate(ds){
  if(!ds)return'—';
  const[y,m,d]=ds.split('-');return d+'.'+m+'.'+y;
}

window.toggleSchedule=function(i){
  const el=document.getElementById('schedule-'+i);
  if(el)el.style.display=el.style.display==='none'?'block':'none';
};

window.openAddLoan=function(){
  if(!state.D)return;
  $('loan-idx').value=-1;
  $('loan-name').value='';$('loan-amount').value='';
  $('loan-rate').value='';$('loan-months').value='';
  $('loan-start').value=today();$('loan-payday').value=1;
  // Fill wallet options
  $('loan-wallet').innerHTML='<option value="">— не привязывать —</option>'+
    state.D.wallets.filter(w=>w.balance<0).map(w=>`<option value="${w.id}">${w.name} (${fmt(Math.abs(w.balance))})</option>`).join('');
  document.getElementById('modal-loan').classList.add('open');
};

window.editLoan=function(i){
  const l=state.D.loans[i];
  $('loan-idx').value=i;$('loan-name').value=l.name;
  $('loan-amount').value=l.amount;$('loan-rate').value=l.rate;
  $('loan-months').value=l.months;$('loan-start').value=l.startDate;
  $('loan-payday').value=l.payDay||1;
  $('loan-wallet').innerHTML='<option value="">— не привязывать —</option>'+
    state.D.wallets.map(w=>`<option value="${w.id}"${w.id===l.walletId?' selected':''}>${w.name}</option>`).join('');
  document.getElementById('modal-loan').classList.add('open');
};

window.saveLoan=function(){
  if(!state.D.loans)state.D.loans=[];
  const idx=+$('loan-idx').value;
  const amount=parseFloat($('loan-amount').value)||0;
  const rate=parseFloat($('loan-rate').value)||0;
  const months=parseInt($('loan-months').value)||0;
  if(!$('loan-name').value||!amount||!months){alert('Заполните название, сумму и срок');return;}
  const loan={
    id:idx>=0?state.D.loans[idx].id:('loan'+Date.now()),
    name:$('loan-name').value.trim(),
    amount,rate,months,
    startDate:$('loan-start').value,
    payDay:parseInt($('loan-payday').value)||1,
    walletId:$('loan-wallet').value||null
  };
  // Auto-calc payment
  const mr=rate/100/12;
  loan.payment=mr>0?Math.round(amount*mr*Math.pow(1+mr,months)/(Math.pow(1+mr,months)-1)):Math.round(amount/months);
  if(idx>=0)state.D.loans[idx]=loan;else state.D.loans.push(loan);
  sched();
  document.getElementById('modal-loan').classList.remove('open');
  renderLoans();
};

window.deleteLoan=function(i){
  if(!confirm('Удалить займ?'))return;
  state.D.loans.splice(i,1);sched();renderLoans();
};
