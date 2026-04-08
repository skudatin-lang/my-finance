import{$,fmt,state,getMOps,isPlanned,sched}from'./core.js';

export function renderHealth(){
  if(!state.D)return;
  const el=$('health-content');if(!el)return;

  // Settings: которые кошельки считать подушкой
  if(!state.D.healthSettings)state.D.healthSettings={emergencyWalletIds:[]};
  const hs=state.D.healthSettings;

  // Avg monthly data (last 3 months)
  let totalExp=0,totalInc=0;
  for(let i=1;i<=3;i++){
    const ops=getMOps(-i).filter(o=>!isPlanned(o.type));
    totalExp+=ops.filter(o=>o.type==='expense').reduce((s,o)=>s+o.amount,0);
    totalInc+=ops.filter(o=>o.type==='income').reduce((s,o)=>s+o.amount,0);
  }
  const avgExp=totalExp/3, avgInc=totalInc/3;

  // Подушка = выбранные кошельки (только положительный баланс)
  const emergencyWallets=hs.emergencyWalletIds.length>0
    ?state.D.wallets.filter(w=>hs.emergencyWalletIds.includes(w.id)&&w.balance>0)
    :state.D.wallets.filter(w=>w.balance>0);
  const totalSavings=emergencyWallets.reduce((s,w)=>s+w.balance,0);

  // Долги = все кошельки с отрицательным балансом
  const debtWallets=state.D.wallets.filter(w=>w.balance<0);
  const totalDebt=debtWallets.reduce((s,w)=>s+Math.abs(w.balance),0);

  const emergencyMonths=avgExp>0?Math.round(totalSavings/avgExp*10)/10:0;
  const savingsRate=avgInc>0?Math.round((avgInc-avgExp)/avgInc*100):0;
  const monthlyDebtPayment=totalDebt>0?Math.round(totalDebt*0.05):0; // ~5% мин платёж
  const dtiPct=avgInc>0?Math.round(monthlyDebtPayment/avgInc*100):0;

  // Обязательные расходы текущего месяца
  const curOps=getMOps(0).filter(o=>!isPlanned(o.type));
  const curExp=curOps.filter(o=>o.type==='expense').reduce((s,o)=>s+o.amount,0);
  const obligPlanIds=state.D.plan.filter(p=>p.type==='expense'&&
    (p.label.toLowerCase().includes('постоянн')||p.label.toLowerCase().includes('кредит')||p.label.toLowerCase().includes('обязател'))
  ).map(p=>p.id);
  const obligCats=state.D.expenseCats.filter(c=>obligPlanIds.includes(c.planId)).map(c=>c.name);
  const obligExp=curOps.filter(o=>o.type==='expense'&&obligCats.includes(o.category)).reduce((s,o)=>s+o.amount,0);
  const obligRatio=curExp>0?Math.round(obligExp/curExp*100):0;
  const investable=Math.max(Math.round(avgInc-avgExp-avgInc*0.1),0);

  // Wallet selector HTML
  const walletCheckboxes=state.D.wallets.filter(w=>w.balance>=0).map(w=>`
    <label style="display:flex;align-items:center;gap:8px;padding:5px 0;font-size:13px;cursor:pointer">
      <input type="checkbox" ${hs.emergencyWalletIds.includes(w.id)?'checked':''} onchange="window.toggleEmergencyWallet('${w.id}',this.checked)" style="accent-color:var(--amber)">
      ${w.name} — ${fmt(w.balance)}
    </label>`).join('');

  const indicators=[
    {
      label:'Подушка безопасности',
      desc:`${emergencyMonths} мес. расходов`,
      target:'Цель: 3–6 месяцев',
      score:emergencyMonths>=6?100:emergencyMonths>=3?Math.round(emergencyMonths/6*100):Math.round(emergencyMonths/3*50),
      detail:`Накоплено: ${fmt(totalSavings)} · Ср. расход: ${fmt(Math.round(avgExp))}/мес`
    },
    {
      label:'Норма сбережений',
      desc:`${savingsRate}% дохода остаётся`,
      target:'Цель: 20%+',
      score:savingsRate>=20?100:savingsRate>=10?Math.round(savingsRate/20*100):Math.max(0,savingsRate*5),
      detail:`Ср. доход: ${fmt(Math.round(avgInc))}/мес · Ср. расход: ${fmt(Math.round(avgExp))}/мес`
    },
    {
      label:'Долговая нагрузка',
      desc:totalDebt===0?'Долгов нет':`${fmt(totalDebt)} долга · ~${dtiPct}% дохода/мес`,
      target:'Цель: <30% дохода',
      score:totalDebt===0?100:dtiPct<=10?90:dtiPct<=20?70:dtiPct<=30?50:Math.max(0,30-dtiPct),
      detail:totalDebt===0?'Отличный показатель':`Кошельки с долгом: ${debtWallets.map(w=>w.name).join(', ')}`
    },
    {
      label:'Обязательные расходы',
      desc:`${obligRatio}% трат — обязательные`,
      target:'Цель: <50%',
      score:obligRatio<=50?100:obligRatio<=70?Math.round((70-obligRatio)/20*50+50):Math.max(0,(100-obligRatio)*2),
      detail:`Обязательные: ${fmt(obligExp)} · Всего расходов: ${fmt(curExp)}`
    },
    {
      label:'Потенциал инвестиций',
      desc:investable>0?`${fmt(investable)}/мес доступно`:'Нет свободных средств',
      target:'Цель: 10–15% дохода',
      score:avgInc>0?Math.min(100,Math.round(investable/avgInc*100*5)):0,
      detail:`После расходов и 10% резерва`
    }
  ];

  const totalScore=Math.round(indicators.reduce((s,i)=>s+i.score,0)/indicators.length);
  const scoreColor=totalScore>=80?'var(--green)':totalScore>=60?'var(--amber)':'var(--red)';
  const scoreLabel=totalScore>=80?'Отлично':totalScore>=60?'Хорошо':totalScore>=40?'Есть над чем работать':'Требует внимания';

  const recs=[];
  if(emergencyMonths<3)recs.push(`Нарастить подушку безопасности. Цель: ${fmt(Math.round(avgExp*3))}. Сейчас: ${fmt(totalSavings)}.`);
  if(savingsRate<10)recs.push(`Норма сбережений ниже 10%. Правило 50/30/20: 50% нужды, 30% желания, 20% сбережения.`);
  if(totalDebt>avgInc*3)recs.push(`Высокая долговая нагрузка. Рассмотри рефинансирование или стратегию «снежного кома».`);
  if(investable>0&&savingsRate>=15)recs.push(`Можно инвестировать ${fmt(investable)}/мес. При 10% годовых за 10 лет: ~${fmt(Math.round(investable*12*17.5))}.`);

  el.innerHTML=`
    <div style="text-align:center;padding:14px 0 18px;border-bottom:1px solid var(--border);margin-bottom:14px">
      <div style="font-size:11px;font-weight:700;color:var(--text2);letter-spacing:.7px;margin-bottom:6px">ИНДЕКС ФИНАНСОВОГО ЗДОРОВЬЯ</div>
      <div style="font-size:48px;font-weight:700;color:${scoreColor};line-height:1">${totalScore}</div>
      <div style="font-size:13px;font-weight:700;color:${scoreColor};margin-top:4px">${scoreLabel}</div>
      <div style="background:var(--g50);border-radius:5px;height:8px;margin:10px 0 0"><div style="height:8px;border-radius:5px;background:${scoreColor};width:${totalScore}%"></div></div>
    </div>

    <div style="background:var(--amber-light);border:1px solid var(--border);border-radius:8px;padding:10px 12px;margin-bottom:14px">
      <div style="font-size:11px;font-weight:700;color:var(--text2);margin-bottom:6px;letter-spacing:.5px">КОШЕЛЬКИ ДЛЯ ПОДУШКИ БЕЗОПАСНОСТИ</div>
      ${walletCheckboxes||'<div style="color:var(--text2);font-size:12px">Нет кошельков с положительным балансом</div>'}
    </div>

    ${indicators.map(ind=>{
      const col=ind.score>=80?'var(--green)':ind.score>=60?'var(--amber)':'var(--red)';
      return`<div style="padding:11px 0;border-bottom:1px solid var(--border)">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:5px">
          <div><div style="font-size:13px;font-weight:700;color:var(--topbar)">${ind.label}</div>
          <div style="font-size:11px;color:var(--text2);margin-top:1px">${ind.desc} · ${ind.target}</div></div>
          <span style="font-size:13px;font-weight:700;color:${col}">${ind.score}%</span>
        </div>
        <div style="background:var(--g50);border-radius:3px;height:5px;margin-bottom:3px">
          <div style="height:5px;border-radius:3px;background:${col};width:${ind.score}%"></div>
        </div>
        <div style="font-size:10px;color:var(--text2)">${ind.detail}</div>
      </div>`;
    }).join('')}

    ${recs.length?`<div style="margin-top:14px">
      <div style="font-size:11px;font-weight:700;color:var(--text2);letter-spacing:.7px;margin-bottom:8px">РЕКОМЕНДАЦИИ</div>
      ${recs.map(r=>`<div style="background:var(--amber-light);border:1px solid var(--border);border-radius:7px;padding:9px 12px;margin-bottom:7px;font-size:12px;color:var(--topbar);line-height:1.5">${r}</div>`).join('')}
    </div>`:''}
  `;
}

window.toggleEmergencyWallet=function(id,checked){
  if(!state.D.healthSettings)state.D.healthSettings={emergencyWalletIds:[]};
  const ids=state.D.healthSettings.emergencyWalletIds;
  if(checked){if(!ids.includes(id))ids.push(id);}
  else{const i=ids.indexOf(id);if(i>=0)ids.splice(i,1);}
  sched();renderHealth();
};
