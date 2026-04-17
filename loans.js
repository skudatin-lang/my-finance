import{$,fmt,state,sched,today,fmtD,getMOps,isPlanned,planSpent,appConfig}from'./core.js';

const esc=s=>String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const EXPENSIVE_RATE=20;

const WALLET_TYPE_LABELS={
  debit:'Дебетовая карта',cash:'Наличные',savings:'Накопительный счёт',
  credit:'Кредитная карта',loan:'Кредит / ипотека',
  debt:'Долг (я должен)',debt_in:'Долг (мне должны)',
  invest:'Инвестиционный',other:'Другое'
};

function getLoanSettings(walletId){
  // Инициализируем если поле отсутствует (старые данные из Firebase)
  if(!state.D.loanSettings)state.D.loanSettings={};
  const ls=state.D.loanSettings[walletId];
  if(!ls)return{rate:0,payment:0,payDay:25,graceDays:0};
  return{
    rate:    parseFloat(ls.rate)    ||0,
    payment: parseFloat(ls.payment) ||0,
    payDay:  parseInt(ls.payDay)    ||25,
    graceDays:parseInt(ls.graceDays)||0
  };
}

// ── Свободный остаток ─────────────────────────────────────────────
function calcFreeBalance(){
  const ops=getMOps(0).filter(o=>!isPlanned(o.type));
  const totalInc=ops.filter(o=>o.type==='income').reduce((s,o)=>s+o.amount,0);
  const savingsPlans=state.D.plan.filter(p=>p.type==='income');
  const totalAllocated=savingsPlans.reduce((s,p)=>s+planSpent(p,ops),0);
  const totalExp=ops.filter(o=>o.type==='expense').reduce((s,o)=>s+o.amount,0);
  return{totalInc,totalAllocated,totalExp,free:Math.max(totalInc-totalAllocated-totalExp,0)};
}

// ── График погашения ──────────────────────────────────────────────
function calcCardSchedule(debt,rate,payment,payDay,graceDays){
  const mr=rate/100/12;
  if(!payment||!rate||payment<=Math.round(debt*mr))return[];
  const rows=[];let bal=debt;const now=new Date();
  const pd=payDay||25;
  // Если день платежа в этом месяце ещё не наступил — начинаем с этого месяца
  // Иначе — со следующего
  const startOffset=now.getDate()<=pd?0:1;
  for(let i=0;i<360&&bal>0.5;i++){
    const d=new Date(now.getFullYear(),now.getMonth()+startOffset+i,pd);
    const ds=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
    const interest=(graceDays>0&&i===0)?0:Math.round(bal*mr);
    const pay=Math.min(payment,bal+interest);
    const principal=Math.max(pay-interest,0);
    bal=Math.max(bal-principal,0);
    rows.push({date:ds,total:Math.round(pay),principal:Math.round(principal),interest:Math.round(interest),balance:Math.round(bal)});
    if(bal<1)break;
  }
  return rows;
}

function calcTotalInterest(debt,rate,payment,payDay,graceDays){
  return calcCardSchedule(debt,rate,payment,payDay,graceDays).reduce((s,p)=>s+p.interest,0);
}

function calcMonthsToClose(debt,rate,extraPayment,basePayment){
  const totalPay=(basePayment||0)+extraPayment;
  const mr=rate/100/12;
  if(!mr||totalPay<=0)return null;
  const interest=Math.round(debt*mr);
  if(totalPay<=interest)return null;
  return Math.ceil(-Math.log(1-(mr*debt/totalPay))/Math.log(1+mr));
}

// ── ЛЕВАЯ КОЛОНКА: чистые карточки из кошельков ───────────────────
export function renderLoans(){
  if(!state.D)return;
  if(!state.D.loanSettings)state.D.loanSettings={};
  const el=$('loans-list');if(!el)return;

  const debtWallets=state.D.wallets.filter(w=>w.balance<0);

  if(!debtWallets.length){
    el.innerHTML=`<div style="background:var(--blue-bg);border:1px solid var(--blue);border-radius:8px;padding:16px;font-size:13px;color:var(--blue);line-height:2">
      <b>Нет долговых кошельков</b><br>
      <span style="font-size:12px">Чтобы добавить кредит:<br>
      1. Перейдите в <b>Настройки → Кошельки</b><br>
      2. Нажмите <b>Изм.</b> рядом с кошельком<br>
      3. Выберите тип <b>Кредитная карта / Кредит / Долг</b><br>
      4. Укажите отрицательный баланс и параметры кредита</span>
    </div>`;
    return;
  }

  const allRates=debtWallets.map(w=>getLoanSettings(w.id).rate||0);
  const maxRate=allRates.length?Math.max(...allRates):0;

  el.innerHTML=debtWallets.map((wallet)=>{
    const debt=Math.abs(wallet.balance);
    const ls=getLoanSettings(wallet.id);
    const{rate,payment,payDay,graceDays}=ls;
    const isExpensive=rate>=EXPENSIVE_RATE;
    const isMostExpensive=rate>0&&rate===maxRate&&maxRate>=EXPENSIVE_RATE;
    const schedule=calcCardSchedule(debt,rate,payment,payDay,graceDays);
    const nextPayment=schedule.find(p=>p.date>today());
    const totalInterest=schedule.reduce((s,p)=>s+p.interest,0);
    const daysToNext=nextPayment?Math.ceil((new Date(nextPayment.date+'T12:00:00')-new Date(today()+'T12:00:00'))/(1000*60*60*24)):null;
    const alertPay=daysToNext!==null&&daysToNext<=7;
    const borderColor=isMostExpensive?'var(--red)':isExpensive?'var(--orange)':alertPay?'var(--orange)':'var(--border2)';
    const typeLabel=wallet.walletType?WALLET_TYPE_LABELS[wallet.walletType]||'':'';
    const wid=wallet.id;

    // Статус платежа
    let nextPayHtml='';
    if(nextPayment){
      nextPayHtml=`<div style="font-size:11px;margin-top:8px;color:${alertPay?'var(--orange-dark)':'var(--text2)'};font-weight:${alertPay?'700':'400'}">${alertPay?'⚠ ':'📅 '}Следующий платёж: ${fmtD(nextPayment.date)}${daysToNext===0?' (сегодня)':daysToNext===1?' (завтра)':' через '+daysToNext+' дн.'}</div>`;
    }else if(rate>0&&payment>0){
      nextPayHtml=`<div style="font-size:11px;margin-top:8px;color:var(--red)">⚠ Платёж ≤ начисляемым процентам — измените параметры в Настройках</div>`;
    }

    // Подсказка если нет ставки
    const noSettingsHint=!rate||!payment
      ?`<div style="font-size:11px;color:var(--text2);margin-top:8px;background:var(--amber-light);border-radius:6px;padding:6px 8px">⚙ Укажите ставку и платёж в <b>Настройках → Кошельки → Изм.</b> для расчёта переплаты</div>`
      :'';

    // График
    let schedHtml='';
    if(schedule.length>0){
      const rows=schedule.slice(0,24).map(p=>`<tr style="border-bottom:.5px solid var(--border);${p.date<=today()?'opacity:.45':''}">
        <td style="padding:5px">${fmtD(p.date)}</td>
        <td style="text-align:right;padding:5px;font-weight:700">${fmt(p.total)}</td>
        <td style="text-align:right;padding:5px;color:var(--green-dark)">${fmt(p.principal)}</td>
        <td style="text-align:right;padding:5px;color:var(--red)">${fmt(p.interest)}</td>
        <td style="text-align:right;padding:5px">${fmt(p.balance)}</td>
      </tr>`).join('')+(schedule.length>24?`<tr><td colspan="5" style="padding:6px;text-align:center;color:var(--text2);font-size:10px">ещё ${schedule.length-24} платежей...</td></tr>`:'');
      schedHtml=`<button onclick="window.toggleLoanSchedule('${wid}')" style="margin-top:10px;background:var(--amber-light);border:1px solid var(--border);border-radius:6px;padding:5px 12px;font-size:11px;color:var(--amber-dark);cursor:pointer;font-weight:700">▶ График погашения (${schedule.length} платежей)</button>
      <div id="lsched-${wid}" style="display:none;margin-top:10px;overflow-x:auto">
        <table style="width:100%;border-collapse:collapse;font-size:11px;min-width:360px">
          <tr style="border-bottom:1px solid var(--border)">
            <th style="text-align:left;padding:5px;color:var(--text2)">Дата</th>
            <th style="text-align:right;padding:5px;color:var(--text2)">Платёж</th>
            <th style="text-align:right;padding:5px;color:var(--text2)">Осн.</th>
            <th style="text-align:right;padding:5px;color:var(--text2)">%</th>
            <th style="text-align:right;padding:5px;color:var(--text2)">Остаток</th>
          </tr>
          ${rows}
        </table>
      </div>`;
    }

    return`<div style="background:var(--card);border:2px solid ${borderColor};border-radius:10px;padding:14px 16px;margin-bottom:12px">
      <!-- Заголовок: название + тип + бейджи -->
      <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:10px">
        <div>
          <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
            <span style="font-size:15px;font-weight:700;color:var(--topbar)">${esc(wallet.name)}</span>
            ${isMostExpensive?'<span style="font-size:10px;background:var(--red-bg);color:var(--red);padding:2px 7px;border-radius:5px;font-weight:700">⚠ САМЫЙ ДОРОГОЙ</span>':''}
            ${isExpensive&&!isMostExpensive?'<span style="font-size:10px;background:var(--orange-bg);color:var(--orange-dark);padding:2px 7px;border-radius:5px;font-weight:700">! ДОРОГОЙ</span>':''}
          </div>
          ${typeLabel?`<div style="font-size:11px;color:var(--text2);margin-top:3px">${typeLabel}${rate>0?` · <b style="color:${isExpensive?'var(--red)':'var(--text2)'}">${rate}% год.</b>`:''}</div>`:''}
        </div>
        <button onclick="window.goToWalletSettings('${wid}')" style="background:var(--amber-light);border:1px solid var(--border);border-radius:6px;padding:4px 10px;font-size:10px;color:var(--amber-dark);cursor:pointer;font-weight:700;flex-shrink:0;margin-left:8px">⚙ Изм.</button>
      </div>

      <!-- Три цифры: остаток, платёж, переплата -->
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px">
        <div class="bal-item ${isMostExpensive?'red':''}"><div class="bal-lbl">ОСТАТОК ДОЛГА</div><div class="bal-val sm neg">${fmt(debt)}</div></div>
        <div class="bal-item"><div class="bal-lbl">ПЛАТЁЖ/МЕС</div><div class="bal-val sm">${payment>0?fmt(payment):'—'}</div></div>
        <div class="bal-item red"><div class="bal-lbl">ПЕРЕПЛАТА</div><div class="bal-val sm neg">${totalInterest>0?fmt(Math.round(totalInterest)):'—'}</div></div>
      </div>

      ${nextPayHtml}
      ${noSettingsHint}
      ${schedHtml}
    </div>`;
  }).join('');
}

// Кнопка «Изм.» в карточке — открывает настройки кошелька
window.goToWalletSettings=function(walletId){
  const idx=state.D.wallets.findIndex(w=>w.id===walletId);
  if(idx<0)return;
  window.showScreen('settings');
  // Небольшая задержка чтобы экран успел отрисоваться
  setTimeout(()=>window.openEditWallet(idx),150);
};

window.toggleLoanSchedule=function(walletId){
  const el=document.getElementById('lsched-'+walletId);
  if(!el)return;
  const open=el.style.display!=='none';
  el.style.display=open?'none':'block';
};

// ── ПРАВАЯ КОЛОНКА: сводка ────────────────────────────────────────
function renderLoansSummaryInternal(){
  const el=$('loans-summary');if(!el||!state.D)return;
  if(!state.D.loanSettings)state.D.loanSettings={};

  const debtWallets=state.D.wallets.filter(w=>w.balance<0);
  if(!debtWallets.length){
    el.innerHTML='<div style="color:var(--text2);font-size:13px;padding:12px 0">Добавьте кошельки с отрицательным балансом в Настройках.</div>';
    return;
  }

  const totalWalletDebt=debtWallets.reduce((s,w)=>s+Math.abs(w.balance),0);
  let totalInterest=0,monthlyPayments=0;
  debtWallets.forEach(w=>{
    const ls=getLoanSettings(w.id);
    monthlyPayments+=ls.payment||0;
    if(ls.rate>0&&ls.payment>0)
      totalInterest+=calcTotalInterest(Math.abs(w.balance),ls.rate,ls.payment,ls.payDay,ls.graceDays);
  });

  const{totalInc,totalAllocated,totalExp,free}=calcFreeBalance();
  const debtRatio=totalInc>0?Math.round(monthlyPayments/totalInc*100):0;
  const debtRatioOk=debtRatio<=40;
  const safeIncome=monthlyPayments>0?Math.round(monthlyPayments/0.40):0;

  const maxRate=Math.max(...debtWallets.map(w=>getLoanSettings(w.id).rate||0));
  const expensive=(maxRate>=EXPENSIVE_RATE&&maxRate>0)
    ?debtWallets.filter(w=>getLoanSettings(w.id).rate===maxRate).sort((a,b)=>Math.abs(b.balance)-Math.abs(a.balance))[0]
    :null;
  let avalancheMonths=null;
  if(expensive&&free>0){
    const ls=getLoanSettings(expensive.id);
    avalancheMonths=calcMonthsToClose(Math.abs(expensive.balance),ls.rate,free,ls.payment);
  }

  let html=`<div class="bal-grid" style="margin-bottom:14px">
    <div class="bal-item full red"><div class="bal-lbl">ОБЩИЙ ДОЛГ</div><div class="bal-val neg">${fmt(totalWalletDebt)}</div></div>
    <div class="bal-item"><div class="bal-lbl">ПЛАТЕЖЕЙ/МЕС</div><div class="bal-val sm">${monthlyPayments>0?fmt(monthlyPayments):'—'}</div></div>
    <div class="bal-item red"><div class="bal-lbl">ПЕРЕПЛАТА ВСЕГО</div><div class="bal-val sm neg">${totalInterest>0?fmt(Math.round(totalInterest)):'—'}</div></div>
  </div>`;

  if(totalInc>0){
    html+=`<div style="background:var(--amber-light);border:1px solid var(--border);border-radius:8px;padding:10px 12px;margin-bottom:14px">
      <div style="font-size:10px;font-weight:700;color:var(--text2);letter-spacing:.5px;margin-bottom:6px">РАСЧЁТ СВОБОДНОГО ОСТАТКА</div>
      <div style="display:grid;grid-template-columns:1fr auto;gap:3px 12px;font-size:12px">
        <span style="color:var(--text2)">Доход за месяц</span><span style="font-weight:700;color:var(--green-dark)">+ ${fmt(totalInc)}</span>
        <span style="color:var(--text2)">Отчисления по финплану</span><span style="font-weight:700;color:var(--blue)">− ${fmt(Math.round(totalAllocated))}</span>
        <span style="color:var(--text2)">Расходы за месяц</span><span style="font-weight:700;color:var(--orange-dark)">− ${fmt(Math.round(totalExp))}</span>
        <span style="font-weight:700;color:var(--topbar);padding-top:5px;border-top:1.5px solid var(--border)">Свободный остаток</span>
        <span style="font-weight:700;color:${free>0?'var(--green-dark)':'var(--red)'};padding-top:5px;border-top:1.5px solid var(--border)">${free>0?'+ ':''}${fmt(Math.round(free))}</span>
      </div>
    </div>`;
  }

  html+=`<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px">
    <div style="background:${debtRatioOk?'var(--green-bg)':'var(--red-bg)'};border:1.5px solid ${debtRatioOk?'var(--green)':'var(--red)'};border-radius:8px;padding:10px 12px">
      <div style="font-size:9px;font-weight:700;color:var(--text2);letter-spacing:.6px;margin-bottom:4px">ДОЛГОВАЯ НАГРУЗКА</div>
      <div style="font-size:20px;font-weight:700;color:${debtRatioOk?'var(--green-dark)':'var(--red)'}">${totalInc>0?debtRatio+'%':'—'}</div>
      <div style="font-size:10px;color:${debtRatioOk?'var(--green-dark)':'var(--red)'};margin-top:3px">${totalInc>0?(debtRatioOk?'✓ В норме (≤40%)':'⚠ Превышает 40%'):'Добавьте доходы в ДДС'}</div>
    </div>
    <div style="background:var(--card);border:1.5px solid var(--border2);border-radius:8px;padding:10px 12px">
      <div style="font-size:9px;font-weight:700;color:var(--text2);letter-spacing:.6px;margin-bottom:4px">МИН. БЕЗОПАСНЫЙ ДОХОД</div>
      <div style="font-size:20px;font-weight:700;color:var(--topbar)">${safeIncome>0?fmt(safeIncome):'—'}</div>
      <div style="font-size:10px;color:var(--text2);margin-top:3px">Чтобы платежи ≤ 40%</div>
    </div>
  </div>`;

  if(expensive){
    const ls=getLoanSettings(expensive.id);
    const debt=Math.abs(expensive.balance);
    html+=`<div style="background:var(--red-bg);border:1.5px solid var(--red);border-radius:8px;padding:12px 14px;margin-bottom:14px">
      <div style="font-size:11px;font-weight:700;color:var(--red);letter-spacing:.5px;margin-bottom:6px">⚔ ПЛАН «ЛАВИНА»</div>
      <div style="font-size:13px;font-weight:700;color:var(--topbar)">${esc(expensive.name)} · ${ls.rate}% год.</div>
      <div style="font-size:12px;color:var(--text2);margin-top:2px">Остаток: ${fmt(Math.round(debt))} · Платёж: ${fmt(ls.payment||0)}/мес</div>
      ${free>0
        ?`<div style="font-size:12px;color:var(--green-dark);font-weight:700;margin-top:6px">+ ${fmt(Math.round(free))}/мес из свободного остатка</div>
           ${avalancheMonths?`<div style="font-size:12px;color:var(--topbar);margin-top:3px">Закрытие за <b>${avalancheMonths} мес.</b></div>`:''}`
        :'<div style="font-size:12px;color:var(--text2);margin-top:6px">Свободный остаток = 0 — внесите доходы в ДДС</div>'}
    </div>`;
  }else{
    const allHaveRate=debtWallets.every(w=>getLoanSettings(w.id).rate>0);
    html+=allHaveRate
      ?`<div style="background:var(--green-bg);border:1.5px solid var(--green);border-radius:8px;padding:10px 14px;margin-bottom:14px"><div style="font-size:11px;font-weight:700;color:var(--green-dark)">✓ Нет кредитов с высокой ставкой (>20%)</div></div>`
      :`<div style="background:var(--blue-bg);border:1px solid var(--blue);border-radius:8px;padding:10px 14px;margin-bottom:14px;font-size:12px;color:var(--blue)">Укажите ставку % в Настройках кошельков — появится план «Лавина»</div>`;
  }

  html+=`<div style="border:1.5px solid var(--border2);border-radius:8px;overflow:hidden">
    <div style="background:var(--topbar);color:#C9A96E;font-size:11px;font-weight:700;letter-spacing:.8px;padding:7px 12px;display:flex;justify-content:space-between;align-items:center">
      <span>🤖 ИИ-АНАЛИЗ ДОЛГОВОЙ НАГРУЗКИ</span>
      <button onclick="window.runLoansAI()" style="background:var(--amber);border:none;color:#fff;padding:4px 12px;border-radius:5px;font-size:10px;font-weight:700;cursor:pointer">Получить анализ</button>
    </div>
    <div id="loans-ai-result" style="padding:12px;font-size:12px;color:var(--text2);line-height:1.7">
      Нажмите кнопку — ИИ изучит ваши кредиты и данные из ДДС.
    </div>
  </div>`;

  el.innerHTML=html;
}

// ── ИИ-анализ через Cloudflare Worker → Anthropic ─────────────────
window.runLoansAI=async function(){
  const el=$('loans-ai-result');if(!el||!state.D)return;
  const debtWallets=state.D.wallets.filter(w=>w.balance<0);
  if(!debtWallets.length){el.innerHTML='<div style="color:var(--text2)">Добавьте долговые кошельки.</div>';return;}
  const workerUrl=appConfig.workerUrl;
  if(!workerUrl){
    el.innerHTML=`<div style="color:var(--red);font-size:12px">⚠ Не настроен Cloudflare Worker.<br>Перейдите в <b>Настройки → Админ</b>, укажите URL воркера.<br>В переменных воркера добавьте <b>ANTHROPIC_KEY</b>.</div>`;
    return;
  }
  el.innerHTML='<div style="color:var(--text2)">⏳ Анализирую...</div>';
  const{totalInc,totalAllocated,totalExp,free}=calcFreeBalance();
  const monthlyPayments=debtWallets.reduce((s,w)=>s+(getLoanSettings(w.id).payment||0),0);
  const totalWalletDebt=debtWallets.reduce((s,w)=>s+Math.abs(w.balance),0);
  const debtRatio=totalInc>0?Math.round(monthlyPayments/totalInc*100):0;
  let totalInterest=0;
  debtWallets.forEach(w=>{
    const ls=getLoanSettings(w.id);
    if(ls.rate>0&&ls.payment>0)totalInterest+=calcTotalInterest(Math.abs(w.balance),ls.rate,ls.payment,ls.payDay,ls.graceDays);
  });
  const loansInfo=debtWallets.map(w=>{
    const ls=getLoanSettings(w.id);
    const tl=w.walletType?(WALLET_TYPE_LABELS[w.walletType]||''):'';
    return`- ${w.name}${tl?' ('+tl+')':''}: остаток ${Math.round(Math.abs(w.balance)).toLocaleString('ru-RU')} ₽, ставка ${ls.rate||'не указана'}%, платёж ${(ls.payment||0).toLocaleString('ru-RU')} ₽/мес`;
  }).join('\n');
  const prompt=`Ты — финансовый советник. Данные пользователя:\n\nКРЕДИТЫ И ДОЛГИ:\n${loansInfo}\n\nФИНАНСЫ (текущий месяц):\n- Доход: ${Math.round(totalInc).toLocaleString('ru-RU')} ₽\n- Отчисления по финплану: ${Math.round(totalAllocated).toLocaleString('ru-RU')} ₽\n- Расходы: ${Math.round(totalExp).toLocaleString('ru-RU')} ₽\n- Свободный остаток: ${Math.round(free).toLocaleString('ru-RU')} ₽\n- Платежи/мес: ${Math.round(monthlyPayments).toLocaleString('ru-RU')} ₽\n- Долговая нагрузка: ${debtRatio}%\n- Общий долг: ${Math.round(totalWalletDebt).toLocaleString('ru-RU')} ₽\n- Суммарная переплата: ${Math.round(totalInterest).toLocaleString('ru-RU')} ₽\n\nДай рекомендации (по-русски, кратко):\n1. Оценка долговой нагрузки\n2. Очерёдность погашения (метод лавины)\n3. Сроки закрытия самого дорогого кредита\n4. Стоит ли рефинансировать\n5. Скрытые резервы\n\nФормат: нумерованный список, 1-2 предложения, конкретные суммы и сроки.`;
  try{
    const secret=appConfig.appSecret||'';
    const uid=state.CU?.uid||'anon';
    const response=await fetch(workerUrl.replace(/\/$/,'')+'/claude',{
      method:'POST',
      headers:{'Content-Type':'application/json','X-App-Secret':secret,'X-User-Id':uid},
      body:JSON.stringify({model:'claude-sonnet-4-20250514',max_tokens:1000,messages:[{role:'user',content:prompt}]})
    });
    const data=await response.json();
    if(!response.ok){
      el.innerHTML=`<div style="color:var(--red);font-size:12px">Ошибка (${response.status}): ${esc(data.error||'')}<br>Убедитесь что в воркере добавлена переменная <b>ANTHROPIC_KEY</b>.</div>`;
      return;
    }
    const text=data.content?.filter(b=>b.type==='text').map(b=>b.text).join('')||'';
    if(!text){el.innerHTML='<div style="color:var(--red)">Нет ответа от ИИ.</div>';return;}
    const lines=text.split('\n').filter(l=>l.trim());
    let htmlResult='';
    lines.forEach(line=>{
      const t=line.trim();
      if(/^\d+\./.test(t)){
        const num=t.match(/^\d+/)[0];const rest=t.replace(/^\d+\.\s*/,'');
        htmlResult+=`<div style="display:flex;gap:8px;margin-bottom:8px;padding-bottom:8px;border-bottom:.5px solid var(--border)"><div style="width:20px;height:20px;border-radius:50%;background:var(--amber);color:#fff;font-size:10px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:1px">${num}</div><div style="font-size:12px;color:var(--topbar);line-height:1.6">${esc(rest)}</div></div>`;
      }else if(t){htmlResult+=`<div style="font-size:12px;color:var(--text2);margin-bottom:4px;line-height:1.6">${esc(t)}</div>`;}
    });
    el.innerHTML=htmlResult||`<div style="font-size:12px;color:var(--topbar);line-height:1.7">${esc(text)}</div>`;
  }catch(err){
    el.innerHTML=`<div style="color:var(--red);font-size:12px">Ошибка: ${esc(err.message)}</div>`;
  }
};

export{renderLoansSummaryInternal as renderLoansSummary};
