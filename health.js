import{$,fmt,state,getMOps,isPlanned}from'./core.js';

export function renderHealth(){
  if(!state.D)return;
  const el=$('health-content');if(!el)return;

  // Gather data
  const now=new Date();
  // Average monthly expense over last 3 months
  let totalExp=0,totalInc=0,months=0;
  for(let i=1;i<=3;i++){
    const ops=getMOps(-i).filter(o=>!isPlanned(o.type));
    totalExp+=ops.filter(o=>o.type==='expense').reduce((s,o)=>s+o.amount,0);
    totalInc+=ops.filter(o=>o.type==='income').reduce((s,o)=>s+o.amount,0);
    months++;
  }
  const avgExp=months>0?totalExp/months:0;
  const avgInc=months>0?totalInc/months:0;

  // Current month
  const curOps=getMOps(0).filter(o=>!isPlanned(o.type));
  const curInc=curOps.filter(o=>o.type==='income').reduce((s,o)=>s+o.amount,0);
  const curExp=curOps.filter(o=>o.type==='expense').reduce((s,o)=>s+o.amount,0);

  // Total savings (positive wallets)
  const totalSavings=state.D.wallets.reduce((s,w)=>s+(w.balance>0?w.balance:0),0);
  // Total debt (negative wallets)
  const totalDebt=state.D.wallets.reduce((s,w)=>s+(w.balance<0?Math.abs(w.balance):0),0);
  // Net worth
  const netWorth=state.D.wallets.reduce((s,w)=>s+w.balance,0);

  // Savings rate
  const savingsRate=avgInc>0?Math.round((avgInc-avgExp)/avgInc*100):0;

  // Emergency fund months
  const emergencyMonths=avgExp>0?Math.round(totalSavings/avgExp*10)/10:0;

  // Debt-to-income ratio (monthly)
  const dti=avgInc>0?Math.round(totalDebt/avgInc*100)/100:0;

  // Obligatory vs discretionary
  const obligatoryPlanIds=state.D.plan.filter(p=>p.type==='expense'&&
    (p.label.toLowerCase().includes('постоянн')||p.label.toLowerCase().includes('кредит')||p.label.toLowerCase().includes('обязател'))
  ).map(p=>p.id);
  const obligCats=state.D.expenseCats.filter(c=>obligatoryPlanIds.includes(c.planId)).map(c=>c.name);
  const obligExp=curOps.filter(o=>o.type==='expense'&&obligCats.includes(o.category)).reduce((s,o)=>s+o.amount,0);
  const obligRatio=curExp>0?Math.round(obligExp/curExp*100):0;

  // Investable amount (income - expenses - 10% reserve)
  const investable=Math.max(Math.round(avgInc-avgExp-avgInc*0.1),0);

  // Build indicators
  const indicators=[
    {
      id:'emergency',
      label:'Подушка безопасности',
      desc:`${emergencyMonths} мес. расходов накоплено`,
      target:'3–6 месяцев',
      value:emergencyMonths,
      min:3,good:6,
      score:emergencyMonths>=6?100:emergencyMonths>=3?Math.round(emergencyMonths/6*100):Math.round(emergencyMonths/3*50),
      detail:`Накоплено: ${fmt(totalSavings)} · Средний расход: ${fmt(avgExp)}/мес`
    },
    {
      id:'savings_rate',
      label:'Норма сбережений',
      desc:`${savingsRate}% дохода остаётся`,
      target:'не менее 20%',
      value:savingsRate,
      min:10,good:20,
      score:savingsRate>=20?100:savingsRate>=10?Math.round(savingsRate/20*100):Math.round(savingsRate/10*50),
      detail:`Доход: ${fmt(avgInc)}/мес · Расход: ${fmt(avgExp)}/мес`
    },
    {
      id:'debt',
      label:'Долговая нагрузка',
      desc:`${dti<=0?'Нет долгов':Math.round(totalDebt/avgInc*100)+'% от мес. дохода'}`,
      target:'не более 30% дохода',
      value:totalDebt,
      min:0,good:0,
      score:totalDebt===0?100:dti<=0.3?Math.round((1-dti/0.3)*70+30):Math.round(Math.max(0,30-dti*10)),
      detail:`Общий долг: ${fmt(totalDebt)} · Доход: ${fmt(avgInc)}/мес`,
      invert:true
    },
    {
      id:'oblig',
      label:'Обязательные расходы',
      desc:`${obligRatio}% трат — обязательные`,
      target:'не более 50%',
      value:obligRatio,
      min:0,good:50,
      score:obligRatio<=50?100:obligRatio<=70?Math.round((70-obligRatio)/20*50+50):Math.round(Math.max(0,(100-obligRatio)*2)),
      detail:`Обязательные: ${fmt(obligExp)} · Всего расходов: ${fmt(curExp)}`,
      invert:true
    },
    {
      id:'invest',
      label:'Потенциал инвестиций',
      desc:`до ${fmt(investable)}/мес можно инвестировать`,
      target:'10–15% дохода',
      value:investable,
      min:0,good:avgInc*0.1,
      score:investable>=avgInc*0.15?100:investable>=avgInc*0.1?80:investable>0?50:20,
      detail:`После расходов и 10% резерва остаётся ${fmt(investable)}`
    }
  ];

  const totalScore=Math.round(indicators.reduce((s,i)=>s+i.score,0)/indicators.length);
  const scoreColor=totalScore>=80?'var(--green)':totalScore>=60?'var(--amber)':'var(--red)';
  const scoreLabel=totalScore>=80?'Отлично':totalScore>=60?'Хорошо':totalScore>=40?'Есть над чем работать':'Требует внимания';

  let html=`
    <div style="text-align:center;padding:16px 0 20px;border-bottom:1px solid var(--border);margin-bottom:16px">
      <div style="font-size:11px;font-weight:700;color:var(--text2);letter-spacing:.7px;margin-bottom:8px">ИНДЕКС ФИНАНСОВОГО ЗДОРОВЬЯ</div>
      <div style="font-size:52px;font-weight:700;color:${scoreColor};line-height:1">${totalScore}</div>
      <div style="font-size:14px;font-weight:700;color:${scoreColor};margin-top:4px">${scoreLabel}</div>
      <div style="background:var(--g50);border-radius:6px;height:10px;margin:12px 0 0;overflow:hidden">
        <div style="height:10px;border-radius:6px;background:${scoreColor};width:${totalScore}%;transition:width .5s"></div>
      </div>
    </div>
    ${indicators.map(ind=>{
      const c=ind.score>=80?'var(--green)':ind.score>=60?'var(--amber)':'var(--red)';
      const icon=ind.score>=80?'✓':ind.score>=60?'!':'⚠';
      return`<div style="padding:12px 0;border-bottom:1px solid var(--border)">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px">
          <div style="flex:1">
            <div style="font-size:13px;font-weight:700;color:var(--topbar)">${ind.label}</div>
            <div style="font-size:11px;color:var(--text2);margin-top:1px">${ind.desc} · цель: ${ind.target}</div>
          </div>
          <span style="font-size:16px;color:${c};margin-left:8px;font-weight:700">${icon}</span>
        </div>
        <div style="background:var(--g50);border-radius:3px;height:6px;margin-bottom:4px">
          <div style="height:6px;border-radius:3px;background:${c};width:${ind.score}%"></div>
        </div>
        <div style="font-size:10px;color:var(--text2)">${ind.detail}</div>
      </div>`;
    }).join('')}
  `;

  // Recommendations
  const recs=[];
  if(emergencyMonths<3)recs.push({icon:'💰',text:`Нарастить подушку безопасности. Цель: ${fmt(avgExp*3)}. Сейчас: ${fmt(totalSavings)}.`});
  if(savingsRate<10)recs.push({icon:'📊',text:`Норма сбережений ниже 10%. Попробуй правило 50/30/20: 50% — нужды, 30% — желания, 20% — сбережения.`});
  if(totalDebt>avgInc*3)recs.push({icon:'🏦',text:`Высокая долговая нагрузка. Рассмотри рефинансирование или стратегию «снежного кома» для погашения.`});
  if(investable>0&&savingsRate>=15)recs.push({icon:'📈',text:`Можно начать инвестировать ${fmt(investable)}/мес. При 10% годовых за 10 лет это даст ~${fmt(investable*12*17.5)}.`});
  if(obligRatio>60)recs.push({icon:'✂️',text:`Обязательные расходы превышают 60%. Проанализируй статью «Постоянные расходы» — есть ли что оптимизировать?`});

  if(recs.length){
    html+=`<div style="margin-top:16px">
      <div style="font-size:11px;font-weight:700;color:var(--text2);letter-spacing:.7px;margin-bottom:10px">РЕКОМЕНДАЦИИ</div>
      ${recs.map(r=>`<div style="background:var(--amber-light);border:1px solid var(--border);border-radius:8px;padding:10px 12px;margin-bottom:8px;font-size:12px;color:var(--topbar);line-height:1.5">
        ${r.text}
      </div>`).join('')}
    </div>`;
  }

  el.innerHTML=html;
}
