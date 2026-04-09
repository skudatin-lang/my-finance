import{$,fmt,state,getMOps,isPlanned,sched,planSpent,calcHealthScore}from'./core.js';

export function renderHealth(){
  if(!state.D)return;
  const el=$('health-content');if(!el)return;

  if(!state.D.healthSettings)state.D.healthSettings={emergencyWalletIds:[]};
  const hs=state.D.healthSettings;

  const h=calcHealthScore();
  if(!h){el.innerHTML='<div style="color:var(--text2)">Нет данных</div>';return;}

  const {score,s1,s2,s3,s4,s5,emergencyMonths,savingsRate,dtiPct,obligRatio,filledMonths,
    avgExp,curInc,totalSavings,totalDebt,creditPlan,creditSpent,investable}=h;

  const scoreColor=score>=80?'var(--green)':score>=60?'var(--amber)':'var(--red)';
  const scoreLabel=score>=80?'Отлично':score>=60?'Хорошо':score>=40?'Есть над чем работать':'Требует внимания';

  const curOps=getMOps(0).filter(o=>!isPlanned(o.type));
  const curExp=curOps.filter(o=>o.type==='expense').reduce((s,o)=>s+o.amount,0);
  const obligPlanIds=state.D.plan.filter(p=>p.type==='expense'&&
    (p.label.toLowerCase().includes('постоянн')||p.label.toLowerCase().includes('кредит'))
  ).map(p=>p.id);
  const obligCats=state.D.expenseCats.filter(c=>obligPlanIds.includes(c.planId)).map(c=>c.name);
  const obligExp=curOps.filter(o=>o.type==='expense'&&obligCats.includes(o.category)).reduce((s,o)=>s+o.amount,0);

  const creditAllocPct=creditPlan?creditPlan.pct:0;
  const creditAllocAmt=curInc>0?Math.round(curInc*creditAllocPct/100):0;

  const emergencyWallets=hs.emergencyWalletIds.length>0
    ?state.D.wallets.filter(w=>hs.emergencyWalletIds.includes(w.id)&&w.balance>0)
    :state.D.wallets.filter(w=>w.balance>0);

  const indicators=[
    {
      id:'emergency',label:'Подушка безопасности',
      hint:'Сумма на выбранных кошельках / средний расход в месяц',
      desc:`${emergencyMonths} мес. расходов · Цель: 3–6 месяцев`,
      score:s1,
      detail:`Накоплено: ${fmt(totalSavings)} · Ср. расход: ${avgExp>0?fmt(Math.round(avgExp)):'-'}/мес`,
      steps:[
        `Автоматически откладывай ${fmt(Math.round(avgExp*0.1))}/мес — 10% расходов`,
        `Цель накопить: ${fmt(Math.round(avgExp*3))} (3 мес) → ${fmt(Math.round(avgExp*6))} (6 мес)`,
        `Используй кошелёк "${emergencyWallets[0]?.name||'Сбережения'}" — он уже выбран`
      ]
    },
    {
      id:'savings',label:'Норма сбережений',
      hint:'Переводы на накопительные кошельки / доход текущего месяца',
      desc:`${savingsRate}% дохода отложено · Цель: 20%+`,
      score:s2,
      detail:`Норма сбережений: ${savingsRate}% · Доход: ${curInc>0?fmt(curInc):'-'}`,
      steps:[
        `По финплану на накопления: ${state.D.plan.filter(p=>p.type==='income').map(p=>p.label+' '+p.pct+'%').join(', ')}`,
        `Каждый месяц переводи на накопительный счёт сразу после получения дохода`,
        `Привяжи кошелёк к статье финплана в Настройках — переводы считаются автоматически`
      ]
    },
    {
      id:'debt',label:'Долговая нагрузка',
      hint:'Ежемесячные платежи по кредитам / доход',
      desc:totalDebt===0?'Долгов нет':`${fmt(totalDebt)} долга · платежи ~${dtiPct}% дохода`,
      score:s3,
      detail:totalDebt===0?'Отлично':`По финплану на кредиты: ${creditAllocPct}% (${fmt(creditAllocAmt)}) · потрачено: ${fmt(creditSpent)}`,
      steps:[
        `По финплану выделено ${creditAllocPct}% на кредиты — ${fmt(creditAllocAmt)}/мес`,
        totalDebt>h.avgInc*3?`Долг > 3 мес. дохода. Рассмотри рефинансирование`:`Долговая нагрузка в норме — продолжай плановые платежи`,
        `Стратегия "снежного кома": сначала закрывай кредит с наибольшей ставкой`
      ]
    },
    {
      id:'oblig',label:'Обязательные расходы',
      hint:'Постоянные расходы + кредиты / все расходы',
      desc:`${obligRatio}% трат — обязательные · Цель: <50%`,
      score:s4,
      detail:`Обязательные: ${fmt(obligExp)} · Всего расходов: ${fmt(curExp)}`,
      steps:[
        `Проанализируй постоянные расходы — есть ли подписки которые можно отменить?`,
        `Оптимизируй связь, коммуналку, страховки`,
        `Цель: обязательные расходы не более 50% от всех трат`
      ]
    },
    {
      id:'invest',label:'Потенциал инвестиций',
      hint:'Свободные средства после расходов и 10% резерва',
      desc:investable>0?`${fmt(investable)}/мес · Цель: 10–15% дохода`:'Нет свободных средств',
      score:s5,
      detail:`После расходов и 10% резерва · Ср. доход: ${h.avgInc>0?fmt(Math.round(h.avgInc)):'-'}/мес`,
      steps:[
        investable>0?`Можно инвестировать ${fmt(investable)}/мес`:`Сначала сократи расходы или увеличь доход`,
        `При 10% годовых ${fmt(investable)}/мес за 10 лет = ~${fmt(Math.round(investable*12*17.5))}`,
        `Начни с ИИС или накопительного счёта с высокой ставкой`
      ]
    }
  ];

  const walletCheckboxes=state.D.wallets.filter(w=>w.balance>=0).map(w=>`
    <label style="display:flex;align-items:center;gap:8px;padding:5px 0;font-size:13px;cursor:pointer">
      <input type="checkbox" ${hs.emergencyWalletIds.includes(w.id)?'checked':''} onchange="window.toggleEmergencyWallet('${w.id}',this.checked)" style="accent-color:var(--amber)">
      ${w.name} — ${fmt(w.balance)}
    </label>`).join('');

  let html=`
    <div style="text-align:center;padding:14px 0 18px;border-bottom:1px solid var(--border);margin-bottom:14px">
      <div style="font-size:11px;font-weight:700;color:var(--text2);letter-spacing:.7px;margin-bottom:6px">ИНДЕКС ФИНАНСОВОГО ЗДОРОВЬЯ</div>
      <div style="font-size:48px;font-weight:700;color:${scoreColor};line-height:1">${score}</div>
      <div style="font-size:13px;font-weight:700;color:${scoreColor};margin-top:4px">${scoreLabel}</div>
      <div style="background:var(--g50);border-radius:5px;height:8px;margin:10px 0 0"><div style="height:8px;border-radius:5px;background:${scoreColor};width:${score}%;transition:width .5s"></div></div>
      ${filledMonths>0?`<div style="font-size:10px;color:var(--text2);margin-top:6px">На основе данных за ${filledMonths} мес.</div>`:'<div style="font-size:10px;color:var(--orange-dark);margin-top:6px">⚠ Добавьте операции для точного расчёта</div>'}
    </div>

    <div style="background:var(--amber-light);border:1px solid var(--border);border-radius:8px;padding:10px 12px;margin-bottom:14px">
      <div style="font-size:11px;font-weight:700;color:var(--text2);margin-bottom:6px;letter-spacing:.5px">КОШЕЛЬКИ ДЛЯ ПОДУШКИ БЕЗОПАСНОСТИ</div>
      <div style="font-size:11px;color:var(--text2);margin-bottom:8px">Выберите кошельки которые считать подушкой (сбережения, накопления):</div>
      ${walletCheckboxes||'<div style="color:var(--text2);font-size:12px">Нет кошельков с положительным балансом</div>'}
    </div>

    ${indicators.map(ind=>{
      const col=ind.score>=80?'var(--green)':ind.score>=60?'var(--amber)':'var(--red)';
      const icon=ind.score>=80?'✓':ind.score>=60?'!':'⚠';
      return`<div style="padding:12px 0;border-bottom:1px solid var(--border)">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:5px">
          <div>
            <div style="font-size:13px;font-weight:700;color:var(--topbar)">${ind.label}</div>
            <div style="font-size:10px;color:var(--text2);margin-top:1px">${ind.hint}</div>
            <div style="font-size:11px;color:var(--text2);margin-top:2px">${ind.desc}</div>
          </div>
          <span style="font-size:14px;font-weight:700;color:${col};margin-left:10px">${icon} ${ind.score}%</span>
        </div>
        <div style="background:var(--g50);border-radius:3px;height:5px;margin-bottom:6px">
          <div style="height:5px;border-radius:3px;background:${col};width:${ind.score}%"></div>
        </div>
        <div style="font-size:11px;color:var(--text2);margin-bottom:6px">${ind.detail}</div>
        <div style="background:var(--card);border:1px solid var(--border);border-radius:6px;padding:8px 10px">
          <div style="font-size:10px;font-weight:700;color:var(--text2);letter-spacing:.5px;margin-bottom:5px">ЧТО СДЕЛАТЬ:</div>
          ${ind.steps.map((s,i)=>`<div style="font-size:11px;color:var(--topbar);padding:2px 0;display:flex;gap:6px"><span style="color:${col};font-weight:700;flex-shrink:0">${i+1}.</span>${s}</div>`).join('')}
        </div>
      </div>`;
    }).join('')}
  `;

  el.innerHTML=html;
}

window.toggleEmergencyWallet=function(id,checked){
  if(!state.D.healthSettings)state.D.healthSettings={emergencyWalletIds:[]};
  const ids=state.D.healthSettings.emergencyWalletIds;
  if(checked){if(!ids.includes(id))ids.push(id);}
  else{const i=ids.indexOf(id);if(i>=0)ids.splice(i,1);}
  sched();renderHealth();
};
