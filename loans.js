import{$,fmt,state,sched,today,fmtD,getMOps,isPlanned,planSpent,appConfig}from'./core.js';

const esc=s=>String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const EXPENSIVE_RATE=20;

// ── loanSettings: доп. параметры кредита, хранятся по walletId ───
// state.D.loanSettings = { [walletId]: { rate, payment, payDay, graceDays } }
function getLoanSettings(walletId){
  if(!state.D.loanSettings)state.D.loanSettings={};
  return state.D.loanSettings[walletId]||{rate:0,payment:0,payDay:25,graceDays:0};
}
function setLoanSettings(walletId,settings){
  if(!state.D.loanSettings)state.D.loanSettings={};
  state.D.loanSettings[walletId]={...getLoanSettings(walletId),...settings};
  sched();
}

// ── Свободный остаток: доход − отчисления по финплану − расходы ──
function calcFreeBalance(){
  const ops=getMOps(0).filter(o=>!isPlanned(o.type));
  const totalInc=ops.filter(o=>o.type==='income').reduce((s,o)=>s+o.amount,0);
  const savingsPlans=state.D.plan.filter(p=>p.type==='income');
  const totalAllocated=savingsPlans.reduce((s,p)=>s+planSpent(p,ops),0);
  const totalExp=ops.filter(o=>o.type==='expense').reduce((s,o)=>s+o.amount,0);
  return{totalInc,totalAllocated,totalExp,free:Math.max(totalInc-totalAllocated-totalExp,0)};
}

// ── График кредитной карты ────────────────────────────────────────
function calcCardSchedule(debt,rate,payment,payDay,graceDays){
  const mr=rate/100/12;
  if(!payment||payment<=Math.round(debt*mr))return[];
  const rows=[];let bal=debt;
  const now=new Date();
  for(let i=0;i<360&&bal>0.5;i++){
    const d=new Date(now.getFullYear(),now.getMonth()+i+1,payDay||25);
    const ds=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(payDay||25).padStart(2,'0');
    const interest=(graceDays>0&&i===0)?0:Math.round(bal*mr);
    const pay=Math.min(payment,bal+interest);
    const principal=Math.max(pay-interest,0);
    bal=Math.max(bal-principal,0);
    rows.push({date:ds,total:Math.round(pay),principal:Math.round(principal),interest:Math.round(interest),balance:Math.round(bal)});
    if(bal<1)break;
  }
  return rows;
}

// ── Рассчитать переплату ──────────────────────────────────────────
function calcTotalInterest(debt,rate,payment,payDay,graceDays){
  const schedule=calcCardSchedule(debt,rate,payment,payDay,graceDays);
  return schedule.reduce((s,p)=>s+p.interest,0);
}

// ── Месяцев до погашения при доп. платеже ───────────────────────
function calcMonthsToClose(debt,rate,extraPayment,basePayment){
  const totalPay=(basePayment||0)+extraPayment;
  const mr=rate/100/12;
  if(!mr||totalPay<=0)return null;
  const interest=Math.round(debt*mr);
  if(totalPay<=interest)return null;
  return Math.ceil(-Math.log(1-(mr*debt/totalPay))/Math.log(1+mr));
}

// ── ЛЕВАЯ КОЛОНКА: карточки из кошельков ─────────────────────────
export function renderLoans(){
  if(!state.D)return;
  if(!state.D.loanSettings)state.D.loanSettings={};
  const el=$('loans-list');if(!el)return;

  // Все кошельки с отрицательным балансом = долговые обязательства
  const debtWallets=state.D.wallets.filter(w=>w.balance<0);

  if(!debtWallets.length){
    el.innerHTML=`<div style="color:var(--text2);font-size:13px;padding:16px 0;text-align:center;line-height:1.8">
      Нет долговых кошельков.<br>
      <span style="font-size:12px">Чтобы добавить кредит — перейдите в <b>Настройки → Кошельки</b> и создайте кошелёк с <b>отрицательным балансом</b> (например: −150 000).</span>
    </div>`;
    return;
  }

  // Самая высокая ставка для подсветки
  const maxRate=Math.max(...debtWallets.map(w=>{const ls=getLoanSettings(w.id);return ls.rate||0;}));

  const html=debtWallets.map((wallet,i)=>{
    const debt=Math.abs(wallet.balance);
    const ls=getLoanSettings(wallet.id);
    const{rate,payment,payDay,graceDays}=ls;
    const isExpensive=rate>=EXPENSIVE_RATE;
    const isMostExpensive=rate===maxRate&&maxRate>=EXPENSIVE_RATE;
    const schedule=rate>0&&payment>0?calcCardSchedule(debt,rate,payment,payDay,graceDays):[];
    const nextPayment=schedule.find(p=>p.date>today());
    const totalInterest=schedule.reduce((s,p)=>s+p.interest,0);
    const daysToNext=nextPayment?Math.ceil((new Date(nextPayment.date+'T12:00:00')-new Date(today()+'T12:00:00'))/(1000*60*60*24)):null;
    const alertPay=daysToNext!==null&&daysToNext<=7;
    const borderColor=isMostExpensive?'var(--red)':isExpensive?'var(--orange)':alertPay?'var(--orange)':'var(--border2)';

    return`<div style="background:var(--card);border:2px solid ${borderColor};border-radius:10px;padding:14px 16px;margin-bottom:12px">
      <!-- Заголовок карточки -->
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:8px">
        <span style="font-size:15px;font-weight:700;color:var(--topbar)">${esc(wallet.name)}</span>
        ${isMostExpensive?'<span style="font-size:10px;background:var(--red-bg);color:var(--red);padding:2px 7px;border-radius:5px;font-weight:700">⚠ САМЫЙ ДОРОГОЙ</span>':''}
        ${isExpensive&&!isMostExpensive?'<span style="font-size:10px;background:var(--orange-bg);color:var(--orange-dark);padding:2px 7px;border-radius:5px;font-weight:700">! ДОРОГОЙ</span>':''}
      </div>

      <!-- Ключевые цифры -->
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:12px">
        <div class="bal-item red"><div class="bal-lbl">ОСТАТОК ДОЛГА</div><div class="bal-val sm neg">${fmt(debt)}</div></div>
        <div class="bal-item"><div class="bal-lbl">ПЛАТЁЖ/МЕС</div><div class="bal-val sm">${payment>0?fmt(payment):'—'}</div></div>
        <div class="bal-item red"><div class="bal-lbl">ПЕРЕПЛАТА</div><div class="bal-val sm neg">${totalInterest>0?fmt(Math.round(totalInterest)):'—'}</div></div>
      </div>

      <!-- Пользовательские поля -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px">
        <div>
          <label style="font-size:10px;font-weight:700;color:var(--text2);letter-spacing:.4px;display:block;margin-bottom:4px">СТАВКА % ГОД.</label>
          <div style="display:flex;align-items:center;gap:4px">
            <input class="fi" type="number" step="0.1" placeholder="0" value="${rate||''}"
              id="ls-rate-${wallet.id}"
              style="padding:7px 10px;font-size:13px;${isExpensive?'border-color:var(--red);background:var(--red-bg);color:var(--red);font-weight:700':''}"
              onchange="window.saveLoanSetting('${wallet.id}')">
            ${isExpensive?`<span style="font-size:11px;color:var(--red);font-weight:700">${rate}%</span>`:''}
          </div>
        </div>
        <div>
          <label style="font-size:10px;font-weight:700;color:var(--text2);letter-spacing:.4px;display:block;margin-bottom:4px">ПЛАТЁЖ/МЕС ₽</label>
          <input class="fi" type="number" placeholder="0" value="${payment||''}"
            id="ls-payment-${wallet.id}"
            style="padding:7px 10px;font-size:13px"
            onchange="window.saveLoanSetting('${wallet.id}')">
        </div>
        <div>
          <label style="font-size:10px;font-weight:700;color:var(--text2);letter-spacing:.4px;display:block;margin-bottom:4px">ДЕНЬ СЧЁТА</label>
          <input class="fi" type="number" min="1" max="28" placeholder="25" value="${payDay||''}"
            id="ls-payday-${wallet.id}"
            style="padding:7px 10px;font-size:13px"
            onchange="window.saveLoanSetting('${wallet.id}')">
        </div>
        <div>
          <label style="font-size:10px;font-weight:700;color:var(--text2);letter-spacing:.4px;display:block;margin-bottom:4px">БЕСПРОЦ. ПЕРИОД (дн.)</label>
          <input class="fi" type="number" min="0" placeholder="0" value="${graceDays||''}"
            id="ls-grace-${wallet.id}"
            style="padding:7px 10px;font-size:13px"
            onchange="window.saveLoanSetting('${wallet.id}')">
        </div>
      </div>

      <!-- Следующий платёж -->
      ${nextPayment
        ?`<div style="font-size:11px;color:${alertPay?'var(--orange-dark)':'var(--text2)'};font-weight:${alertPay?'700':'400'};margin-bottom:6px">${alertPay?'⚠ ':''}Следующий платёж: ${fmtD(nextPayment.date)}${daysToNext===0?' (сегодня)':daysToNext===1?' (завтра)':' через '+daysToNext+' дн.'}</div>`
        :''}

      <!-- График -->
      ${schedule.length>0?`<button onclick="window.toggleLoanSchedule('${wallet.id}')" style="background:var(--amber-light);border:1px solid var(--border);border-radius:6px;padding:5px 12px;font-size:11px;color:var(--amber-dark);cursor:pointer;font-weight:700">График погашения</button>
      <div id="lsched-${wallet.id}" style="display:none;margin-top:10px;overflow-x:auto">
        <table style="width:100%;border-collapse:collapse;font-size:11px;min-width:380px">
          <tr style="border-bottom:1px solid var(--border)">
            <th style="text-align:left;padding:5px;color:var(--text2)">Дата</th>
            <th style="text-align:right;padding:5px;color:var(--text2)">Платёж</th>
            <th style="text-align:right;padding:5px;color:var(--text2)">Осн.</th>
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
      </div>`
      :'<div style="font-size:11px;color:var(--text2)">Укажите ставку и платёж для расчёта графика</div>'}
    </div>`;
  }).join('');

  el.innerHTML=html;
}

// ── Сохранить параметры кредита при изменении поля ───────────────
window.saveLoanSetting=function(walletId){
  const rate=parseFloat(document.getElementById('ls-rate-'+walletId)?.value)||0;
  const payment=parseFloat(document.getElementById('ls-payment-'+walletId)?.value)||0;
  const payDay=parseInt(document.getElementById('ls-payday-'+walletId)?.value)||25;
  const graceDays=parseInt(document.getElementById('ls-grace-'+walletId)?.value)||0;
  setLoanSettings(walletId,{rate,payment,payDay,graceDays});
  // Перерисовать только сводку (не перерисовываем всю левую колонку — сбросит фокус)
  renderLoansSummaryInternal();
};

window.toggleLoanSchedule=function(walletId){
  const el=document.getElementById('lsched-'+walletId);
  if(el)el.style.display=el.style.display==='none'?'block':'none';
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
  let totalInterest=0;
  let monthlyPayments=0;
  debtWallets.forEach(w=>{
    const ls=getLoanSettings(w.id);
    const debt=Math.abs(w.balance);
    monthlyPayments+=ls.payment||0;
    if(ls.rate>0&&ls.payment>0){
      totalInterest+=calcTotalInterest(debt,ls.rate,ls.payment,ls.payDay,ls.graceDays);
    }
  });

  const{totalInc,totalAllocated,totalExp,free}=calcFreeBalance();
  const debtRatio=totalInc>0?Math.round(monthlyPayments/totalInc*100):0;
  const debtRatioOk=debtRatio<=40;
  const safeIncome=monthlyPayments>0?Math.round(monthlyPayments/0.40):0;

  // Самый дорогой кредит
  const maxRate=Math.max(...debtWallets.map(w=>getLoanSettings(w.id).rate||0));
  const expensive=maxRate>=EXPENSIVE_RATE
    ?debtWallets.filter(w=>(getLoanSettings(w.id).rate||0)===maxRate)
      .sort((a,b)=>Math.abs(b.balance)-Math.abs(a.balance))[0]
    :null;

  let avalancheMonths=null;
  if(expensive&&free>0){
    const ls=getLoanSettings(expensive.id);
    const debt=Math.abs(expensive.balance);
    avalancheMonths=calcMonthsToClose(debt,ls.rate,free,ls.payment);
  }

  let html=`
  <!-- Базовая сводка -->
  <div class="bal-grid" style="margin-bottom:14px">
    <div class="bal-item full red"><div class="bal-lbl">ОБЩИЙ ДОЛГ</div><div class="bal-val neg">${fmt(totalWalletDebt)}</div></div>
    <div class="bal-item"><div class="bal-lbl">ПЛАТЕЖЕЙ/МЕС</div><div class="bal-val sm">${monthlyPayments>0?fmt(monthlyPayments):'—'}</div></div>
    <div class="bal-item red"><div class="bal-lbl">ПЕРЕПЛАТА ВСЕГО</div><div class="bal-val sm neg">${totalInterest>0?fmt(Math.round(totalInterest)):'—'}</div></div>
  </div>`;

  // Расчёт свободного остатка
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

  // Нагрузка + мин. доход
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

  // План «Лавина»
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
        :'<div style="font-size:12px;color:var(--text2);margin-top:6px">Свободный остаток = 0 — добавьте доходы в ДДС</div>'}
    </div>`;
  }else if(debtWallets.length>0){
    const allHaveRate=debtWallets.every(w=>(getLoanSettings(w.id).rate||0)>0);
    if(!allHaveRate){
      html+=`<div style="background:var(--blue-bg);border:1px solid var(--blue);border-radius:8px;padding:10px 14px;margin-bottom:14px;font-size:12px;color:var(--blue)">
        Укажите ставку % для каждого кредита слева — тогда появится план «Лавина»
      </div>`;
    }else{
      html+=`<div style="background:var(--green-bg);border:1.5px solid var(--green);border-radius:8px;padding:10px 14px;margin-bottom:14px">
        <div style="font-size:11px;font-weight:700;color:var(--green-dark)">✓ Нет кредитов с высокой ставкой (>20%)</div>
      </div>`;
    }
  }

  // ИИ-анализ
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

// ── ИИ-анализ через Cloudflare Worker → Anthropic ────────────────
window.runLoansAI=async function(){
  const el=$('loans-ai-result');if(!el||!state.D)return;
  const debtWallets=state.D.wallets.filter(w=>w.balance<0);
  if(!debtWallets.length){el.innerHTML='<div style="color:var(--text2)">Добавьте долговые кошельки.</div>';return;}

  const workerUrl=appConfig.workerUrl;
  if(!workerUrl){
    el.innerHTML='<div style="color:var(--red);font-size:12px">⚠ Не настроен Cloudflare Worker.<br>Перейдите в <b>Настройки → Админ</b>, укажите URL воркера.<br>Убедитесь что в воркере добавлена переменная <b>ANTHROPIC_KEY</b>.</div>';
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
    return`- ${w.name}: остаток ${Math.round(Math.abs(w.balance)).toLocaleString('ru-RU')} ₽, ставка ${ls.rate||'не указана'}% год., платёж ${(ls.payment||0).toLocaleString('ru-RU')} ₽/мес`;
  }).join('\n');

  const prompt=`Ты — финансовый советник. Данные пользователя:

КРЕДИТЫ И ДОЛГИ:
${loansInfo}

ФИНАНСЫ (текущий месяц):
- Доход: ${Math.round(totalInc).toLocaleString('ru-RU')} ₽
- Отчисления по финплану (накопления): ${Math.round(totalAllocated).toLocaleString('ru-RU')} ₽
- Расходы: ${Math.round(totalExp).toLocaleString('ru-RU')} ₽
- Свободный остаток: ${Math.round(free).toLocaleString('ru-RU')} ₽
- Суммарные платежи/мес: ${Math.round(monthlyPayments).toLocaleString('ru-RU')} ₽
- Долговая нагрузка: ${debtRatio}% от дохода (норма ≤40%)
- Общий долг: ${Math.round(totalWalletDebt).toLocaleString('ru-RU')} ₽
- Суммарная переплата: ${Math.round(totalInterest).toLocaleString('ru-RU')} ₽

Дай персонализированные рекомендации (по-русски, кратко и конкретно):
1. Оценка долговой нагрузки — критична ли ситуация
2. Очерёдность погашения (метод лавины — сначала самый дорогой)
3. Сколько месяцев займёт закрытие самого дорогого кредита при текущем свободном остатке
4. Стоит ли рефинансировать (если ставка >20%)
5. Скрытые резервы для ускорения погашения

Формат: нумерованный список, каждый пункт 1-2 предложения, называй суммы и сроки.`;

  try{
    const secret=appConfig.appSecret||'';
    const uid=state.CU?.uid||'anon';
    const response=await fetch(workerUrl.replace(/\/$/,'')+'/claude',{
      method:'POST',
      headers:{'Content-Type':'application/json','X-App-Secret':secret,'X-User-Id':uid},
      body:JSON.stringify({
        model:'claude-sonnet-4-20250514',
        max_tokens:1000,
        messages:[{role:'user',content:prompt}]
      })
    });
    const data=await response.json();
    if(!response.ok){
      el.innerHTML=`<div style="color:var(--red);font-size:12px">Ошибка воркера (${response.status}): ${esc(data.error||JSON.stringify(data))}<br><br>Проверьте что в Variables воркера добавлена переменная <b>ANTHROPIC_KEY</b>.</div>`;
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
        htmlResult+=`<div style="display:flex;gap:8px;margin-bottom:8px;padding-bottom:8px;border-bottom:.5px solid var(--border)">
          <div style="width:20px;height:20px;border-radius:50%;background:var(--amber);color:#fff;font-size:10px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:1px">${num}</div>
          <div style="font-size:12px;color:var(--topbar);line-height:1.6">${esc(rest)}</div>
        </div>`;
      }else if(t){
        htmlResult+=`<div style="font-size:12px;color:var(--text2);margin-bottom:4px;line-height:1.6">${esc(t)}</div>`;
      }
    });
    el.innerHTML=htmlResult||`<div style="font-size:12px;color:var(--topbar);line-height:1.7">${esc(text)}</div>`;
  }catch(err){
    el.innerHTML=`<div style="color:var(--red);font-size:12px">Ошибка соединения: ${esc(err.message)}<br>Проверьте URL воркера в настройках.</div>`;
  }
};

export{renderLoansSummaryInternal as renderLoansSummary};
