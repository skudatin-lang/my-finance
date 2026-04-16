import{$,fmt,state,sched,today,fmtD,getMOps,isPlanned}from'./core.js';

const esc=s=>String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

// ── Порог «дорогого» кредита ──────────────────────────────────────
const EXPENSIVE_RATE=20; // % годовых

// ── Рассчитать остаток долга по кредиту ──────────────────────────
function calcRemaining(loan){
  if(loan.loanType==='card'){
    const wallet=state.D.wallets.find(w=>w.id===loan.walletId);
    return wallet?Math.abs(Math.min(wallet.balance,0)):loan.amount;
  }
  const schedule=calcSchedule(loan);
  const paid=schedule.filter(p=>p.date<=today());
  const paidAmount=paid.reduce((s,p)=>s+p.principal,0);
  return Math.max(loan.amount-paidAmount,0);
}

export function renderLoans(){
  if(!state.D)return;
  if(!state.D.loans)state.D.loans=[];
  const el=$('loans-list');if(!el)return;
  const loans=state.D.loans;
  const debtWallets=state.D.wallets.filter(w=>w.balance<0);

  let html='';
  if(debtWallets.length&&!loans.length){
    html+=`<div style="background:var(--blue-bg);border:1px solid var(--blue);border-radius:8px;padding:10px 12px;margin-bottom:12px;font-size:12px;color:var(--blue)">
      Найдены кошельки с долгом: ${debtWallets.map(w=>`<b>${esc(w.name)}</b> (${fmt(Math.abs(w.balance))})`).join(', ')}.
      Нажмите «+ Добавить» и привяжите кошелёк.
    </div>`;
  }
  if(!loans.length){
    el.innerHTML=html+'<div style="color:var(--text2);font-size:13px;padding:8px 0">Нет займов. Добавьте кредит или кредитную карту.</div>';
    return;
  }

  // Найти самый дорогой кредит
  const maxRate=Math.max(...loans.map(l=>l.rate||0));

  html+=loans.map((loan,i)=>{
    const isCard=loan.loanType==='card';
    const schedule=isCard?calcCardSchedule(loan):calcSchedule(loan);
    const wallet=state.D.wallets.find(w=>w.id===loan.walletId);
    const remaining=calcRemaining(loan);
    const totalInterest=schedule.reduce((s,p)=>s+p.interest,0);
    const nextPayment=schedule.find(p=>p.date>today());
    const pct=loan.amount>0?Math.min(Math.round((loan.amount-remaining)/loan.amount*100),100):0;
    const daysToNext=nextPayment?Math.ceil((new Date(nextPayment.date+'T12:00:00')-new Date(today()+'T12:00:00'))/(1000*60*60*24)):null;
    const alertPay=daysToNext!==null&&daysToNext<=7;
    const isExpensive=loan.rate>=EXPENSIVE_RATE;
    const isMostExpensive=loan.rate===maxRate&&maxRate>=EXPENSIVE_RATE;

    // Цвет рамки: красный для самого дорогого, оранжевый для просто дорогих, обычный иначе
    const borderColor=isMostExpensive?'var(--red)':isExpensive?'var(--orange)':alertPay?'var(--orange)':'var(--border2)';
    const bgColor=isMostExpensive?'rgba(192,57,43,.04)':isExpensive?'rgba(194,91,26,.03)':'';

    return`<div style="background:var(--card);${bgColor?'background:'+bgColor+';':''}border:2px solid ${borderColor};border-radius:10px;padding:14px 16px;margin-bottom:12px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px">
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
            <span style="font-size:15px;font-weight:700;color:var(--topbar)">${esc(loan.name)}</span>
            ${isCard?'<span style="font-size:10px;background:var(--blue-bg);color:var(--blue);padding:2px 7px;border-radius:5px">КРЕДИТКА</span>':''}
            ${isMostExpensive?'<span style="font-size:10px;background:var(--red-bg);color:var(--red);padding:2px 7px;border-radius:5px;font-weight:700">⚠ САМЫЙ ДОРОГОЙ</span>':''}
            ${isExpensive&&!isMostExpensive?'<span style="font-size:10px;background:var(--orange-bg);color:var(--orange-dark);padding:2px 7px;border-radius:5px;font-weight:700">! ДОРОГОЙ</span>':''}
          </div>
          <div style="font-size:11px;color:var(--text2);margin-top:4px">
            ${isCard
              ?`Ставка <b style="color:${isExpensive?'var(--red)':'inherit'}">${loan.rate}%</b> год. · платёж ~${fmt(loan.payment||0)}/мес`
              :`<b style="color:${isExpensive?'var(--red)':'inherit'}">${loan.rate}%</b> год. · ${loan.months} мес. · с ${fmtD(loan.startDate)}`}
            ${wallet?' · '+esc(wallet.name):''}
          </div>
        </div>
        <div style="display:flex;gap:5px;flex-shrink:0;margin-left:10px">
          <button class="sbtn blue" onclick="window.editLoan(${i})">Изм.</button>
          <button class="sbtn red" onclick="window.deleteLoan(${i})">Удал.</button>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:10px">
        <div class="bal-item ${isMostExpensive?'red':''}"><div class="bal-lbl">ОСТАТОК ДОЛГА</div><div class="bal-val sm neg">${fmt(Math.round(remaining))}</div></div>
        <div class="bal-item"><div class="bal-lbl">ПЛАТЁЖ/МЕС</div><div class="bal-val sm">${fmt(loan.payment||0)}</div></div>
        <div class="bal-item red"><div class="bal-lbl">${isCard?'МИН. ПЕРЕПЛАТА':'ПЕРЕПЛАТА'}</div><div class="bal-val sm neg">${fmt(Math.round(totalInterest))}</div></div>
      </div>
      <div style="background:var(--g50);border-radius:4px;height:8px;margin-bottom:6px">
        <div style="height:8px;border-radius:4px;background:${isMostExpensive?'var(--red)':'var(--green)'};width:${pct}%"></div>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text2)">
        <span>Погашено ${pct}%</span>
        ${nextPayment
          ?`<span style="color:${alertPay?'var(--orange-dark)':'var(--text2)'};font-weight:${alertPay?'700':'400'}">${alertPay?'⚠ ':''}Платёж ${fmtD(nextPayment.date)}${daysToNext===0?' (сегодня)':daysToNext===1?' (завтра)':' через '+daysToNext+' дн.'}</span>`
          :'<span style="color:var(--green-dark);font-weight:700">✓ Погашен</span>'}
      </div>
      <button onclick="window.toggleSchedule(${i})" style="margin-top:10px;background:var(--amber-light);border:1px solid var(--border);border-radius:6px;padding:5px 12px;font-size:11px;color:var(--amber-dark);cursor:pointer;font-weight:700">График погашения</button>
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

// ── Расчёт графика аннуитетного кредита ──────────────────────────
function calcSchedule(loan){
  const mr=loan.rate/100/12,n=loan.months;
  const pmt=mr>0?Math.round(loan.amount*mr*Math.pow(1+mr,n)/(Math.pow(1+mr,n)-1)):Math.round(loan.amount/n);
  const rows=[];let bal=loan.amount;
  const start=new Date(loan.startDate+'T12:00:00');
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

// ── Расчёт графика кредитной карты ───────────────────────────────
function calcCardSchedule(loan){
  const mr=loan.rate/100/12;
  const payment=loan.payment||0;
  if(!payment)return[];
  const firstInterest=Math.round(loan.amount*mr);
  if(payment<=firstInterest)return[];
  const rows=[];
  let bal=loan.amount;
  const now=new Date();
  const payDay=loan.payDay||25;
  for(let i=0;i<360&&bal>0.5;i++){
    const d=new Date(now.getFullYear(),now.getMonth()+i+1,payDay);
    const ds=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(payDay).padStart(2,'0');
    const interest=(loan.graceDays>0&&i===0)?0:Math.round(bal*mr);
    const pay=Math.min(payment,bal+interest);
    const principal=Math.max(pay-interest,0);
    bal=Math.max(bal-principal,0);
    rows.push({date:ds,total:Math.round(pay),principal:Math.round(principal),interest:Math.round(interest),balance:Math.round(bal)});
    if(bal<1)break;
  }
  return rows;
}

// ── Получить данные ДДС: доход и свободный остаток ───────────────
function getDDSData(){
  const ops=getMOps(0).filter(o=>!isPlanned(o.type));
  const totalInc=ops.filter(o=>o.type==='income').reduce((s,o)=>s+o.amount,0);
  const totalExp=ops.filter(o=>o.type==='expense').reduce((s,o)=>s+o.amount,0);
  const monthlyPayments=(state.D.loans||[]).reduce((s,l)=>s+(l.payment||0),0);
  // Свободный остаток = доходы − все расходы (включает платежи по кредитам)
  const free=totalInc-totalExp;
  return{totalInc,totalExp,monthlyPayments,free};
}

// ── Главная сводка ────────────────────────────────────────────────
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
  const monthlyPayments=loans.reduce((s,l)=>s+(l.payment||0),0);

  // ── Данные из ДДС ────────────────────────────────────────────
  const {totalInc,free}=getDDSData();

  // ── Долговая нагрузка ────────────────────────────────────────
  const debtRatio=totalInc>0?Math.round(monthlyPayments/totalInc*100):0;
  const debtRatioOk=debtRatio<=40;

  // ── Минимальный безопасный доход ─────────────────────────────
  const safeIncome=monthlyPayments>0?Math.round(monthlyPayments/0.40):0;

  // ── Самый дорогой кредит (план «Лавина») ────────────────────
  const maxRate=loans.length?Math.max(...loans.map(l=>l.rate||0)):0;
  const expensive=loans.filter(l=>l.rate===maxRate&&maxRate>=EXPENSIVE_RATE).sort((a,b)=>calcRemaining(b)-calcRemaining(a))[0]||null;
  const extraPayment=Math.max(free,0);
  let avalancheMonths=null;
  if(expensive&&extraPayment>0){
    const rem=calcRemaining(expensive);
    const mr=expensive.rate/100/12;
    const totalPay=(expensive.payment||0)+extraPayment;
    const interest=Math.round(rem*mr);
    if(totalPay>interest){
      // Примерный расчёт через логарифм
      avalancheMonths=Math.ceil(-Math.log(1-(mr*rem/totalPay))/Math.log(1+mr));
    }
  }

  let html=`
  <!-- Базовая сводка -->
  <div class="bal-grid" style="margin-bottom:14px">
    <div class="bal-item full red"><div class="bal-lbl">ОБЩИЙ ДОЛГ (кошельки)</div><div class="bal-val neg">${fmt(totalWalletDebt)}</div></div>
    <div class="bal-item"><div class="bal-lbl">ПЛАТЕЖЕЙ/МЕС</div><div class="bal-val sm">${fmt(monthlyPayments)}</div></div>
    <div class="bal-item red"><div class="bal-lbl">ПЕРЕПЛАТА ВСЕГО</div><div class="bal-val sm neg">${fmt(Math.round(totalInterest))}</div></div>
  </div>`;

  // ── Строка 4+5: нагрузка + мин. доход ────────────────────────
  html+=`<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px">
    <div style="background:${debtRatioOk?'var(--green-bg)':'var(--red-bg)'};border:1.5px solid ${debtRatioOk?'var(--green)':'var(--red)'};border-radius:8px;padding:10px 12px">
      <div style="font-size:9px;font-weight:700;color:var(--text2);letter-spacing:.6px;margin-bottom:4px">ДОЛГОВАЯ НАГРУЗКА</div>
      <div style="font-size:18px;font-weight:700;color:${debtRatioOk?'var(--green-dark)':'var(--red)'}">${debtRatio}%</div>
      <div style="font-size:10px;color:${debtRatioOk?'var(--green-dark)':'var(--red)'};margin-top:3px">${debtRatioOk?'✓ В норме (≤40%)':'⚠ Превышает 40% дохода'}</div>
      ${totalInc===0?'<div style="font-size:10px;color:var(--text2);margin-top:2px">Добавьте доходы в ДДС</div>':''}
    </div>
    <div style="background:var(--card);border:1.5px solid var(--border2);border-radius:8px;padding:10px 12px">
      <div style="font-size:9px;font-weight:700;color:var(--text2);letter-spacing:.6px;margin-bottom:4px">МИН. ДОХОД ДЛЯ БЕЗОПАСНОСТИ</div>
      <div style="font-size:18px;font-weight:700;color:var(--topbar)">${safeIncome>0?fmt(safeIncome):'—'}</div>
      <div style="font-size:10px;color:var(--text2);margin-top:3px">Чтобы платежи ≤ 40% дохода</div>
    </div>
  </div>`;

  // ── План «Лавина» ─────────────────────────────────────────────
  if(expensive){
    const rem=calcRemaining(expensive);
    const extraHtml=extraPayment>0
      ?`<div style="font-size:12px;color:var(--green-dark);font-weight:700;margin-top:4px">Доп. платёж из свободного остатка: +${fmt(Math.round(extraPayment))}/мес</div>
       ${avalancheMonths?`<div style="font-size:12px;color:var(--topbar);margin-top:3px">Закрытие за <b>${avalancheMonths} мес.</b> (вместо ${expensive.months||'?'} мес. по плану)</div>`:''}` 
      :'<div style="font-size:12px;color:var(--text2);margin-top:4px">Нет свободного остатка — добавьте доходы в ДДС для расчёта</div>';
    html+=`<div style="background:var(--red-bg);border:1.5px solid var(--red);border-radius:8px;padding:12px 14px;margin-bottom:14px">
      <div style="font-size:11px;font-weight:700;color:var(--red);letter-spacing:.5px;margin-bottom:6px">⚔ ПЛАН «ЛАВИНА» — АТАКА НА ДОРОГОЙ КРЕДИТ</div>
      <div style="font-size:13px;font-weight:700;color:var(--topbar)">${esc(expensive.name)} · ${expensive.rate}% год.</div>
      <div style="font-size:12px;color:var(--text2);margin-top:2px">Остаток долга: ${fmt(Math.round(rem))} · Обычный платёж: ${fmt(expensive.payment||0)}/мес</div>
      ${extraHtml}
    </div>`;
  }else if(loans.length>0){
    html+=`<div style="background:var(--green-bg);border:1.5px solid var(--green);border-radius:8px;padding:10px 14px;margin-bottom:14px">
      <div style="font-size:11px;font-weight:700;color:var(--green-dark)">✓ Нет кредитов с высокой ставкой (>20%)</div>
      <div style="font-size:12px;color:var(--text2);margin-top:3px">Все ваши обязательства в разумных пределах</div>
    </div>`;
  }

  // ── ИИ-анализ ────────────────────────────────────────────────
  html+=`<div style="border:1.5px solid var(--border2);border-radius:8px;overflow:hidden;margin-bottom:4px">
    <div style="background:var(--topbar);color:#C9A96E;font-size:11px;font-weight:700;letter-spacing:.8px;padding:7px 12px;display:flex;justify-content:space-between;align-items:center">
      <span>🤖 ИИ-АНАЛИЗ ДОЛГОВОЙ НАГРУЗКИ</span>
      <button onclick="window.runLoansAI()" style="background:var(--amber);border:none;color:#fff;padding:4px 12px;border-radius:5px;font-size:10px;font-weight:700;cursor:pointer;letter-spacing:.3px">Получить анализ</button>
    </div>
    <div id="loans-ai-result" style="padding:12px;font-size:12px;color:var(--text2);line-height:1.7">
      Нажмите кнопку — ИИ изучит ваши кредиты, долговую нагрузку и данные из ДДС, затем даст персонализированные рекомендации.
    </div>
  </div>`;

  if(loans.length===0&&debtWallets.length>0){
    html+=`<div style="margin-top:10px;font-size:12px;color:var(--text2)">Добавьте займы для расчёта переплаты и плана погашения</div>`;
  }

  el.innerHTML=html;
}

// ── ИИ-анализ через Anthropic API ────────────────────────────────
window.runLoansAI=async function(){
  const el=$('loans-ai-result');if(!el||!state.D)return;
  const loans=state.D.loans||[];
  if(!loans.length){el.innerHTML='<div style="color:var(--text2)">Добавьте хотя бы один кредит для анализа.</div>';return;}

  el.innerHTML='<div style="color:var(--text2)">⏳ Анализирую данные...</div>';

  const {totalInc,totalExp,monthlyPayments,free}=getDDSData();
  const debtWallets=state.D.wallets.filter(w=>w.balance<0);
  const totalWalletDebt=debtWallets.reduce((s,w)=>s+Math.abs(w.balance),0);
  const debtRatio=totalInc>0?Math.round(monthlyPayments/totalInc*100):0;

  let totalInterest=0;
  loans.forEach(l=>{
    const schedule=l.loanType==='card'?calcCardSchedule(l):calcSchedule(l);
    totalInterest+=schedule.reduce((s,p)=>s+p.interest,0);
  });

  const loansInfo=loans.map(l=>{
    const rem=calcRemaining(l);
    return`- ${l.name}: ${l.loanType==='card'?'кредитка':'кредит'}, ставка ${l.rate}% год., остаток ${Math.round(rem).toLocaleString('ru-RU')} ₽, платёж ${(l.payment||0).toLocaleString('ru-RU')} ₽/мес`;
  }).join('\n');

  const prompt=`Ты — финансовый советник. Вот данные пользователя:

КРЕДИТЫ И ДОЛГИ:
${loansInfo}

ФИНАНСОВАЯ КАРТИНА (текущий месяц):
- Доход за месяц: ${Math.round(totalInc).toLocaleString('ru-RU')} ₽
- Расходы за месяц: ${Math.round(totalExp).toLocaleString('ru-RU')} ₽
- Суммарные платежи по кредитам: ${Math.round(monthlyPayments).toLocaleString('ru-RU')} ₽/мес
- Свободный остаток после всех трат: ${Math.round(free).toLocaleString('ru-RU')} ₽
- Долговая нагрузка: ${debtRatio}% от дохода (норма ≤40%)
- Общий долг: ${Math.round(totalWalletDebt).toLocaleString('ru-RU')} ₽
- Суммарная переплата по всем кредитам: ${Math.round(totalInterest).toLocaleString('ru-RU')} ₽

Дай персонализированные рекомендации по следующим пунктам (отвечай по-русски, кратко и конкретно):
1. Реальная долговая нагрузка: оцени, критична ли ситуация
2. Очерёдность погашения: в каком порядке гасить кредиты (метод лавины — сначала самый дорогой)
3. Сколько месяцев займёт закрытие самого дорогого кредита при текущем свободном остатке
4. Стоит ли рефинансировать или брать кредитные каникулы (если ставка высокая)
5. Скрытые резервы для ускорения погашения

Будь конкретным: называй суммы, сроки. Формат: нумерованный список, каждый пункт 1-2 предложения.`;

  try{
    const response=await fetch('https://api.anthropic.com/v1/messages',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        model:'claude-sonnet-4-20250514',
        max_tokens:1000,
        messages:[{role:'user',content:prompt}]
      })
    });
    const data=await response.json();
    const text=data.content?.filter(b=>b.type==='text').map(b=>b.text).join('')||'';
    if(!text){el.innerHTML='<div style="color:var(--red)">Не удалось получить ответ. Проверьте соединение.</div>';return;}
    // Форматируем текст: нумерованный список → красивые блоки
    const lines=text.split('\n').filter(l=>l.trim());
    let htmlResult='';
    lines.forEach(line=>{
      const trimmed=line.trim();
      if(/^\d+\./.test(trimmed)){
        const num=trimmed.match(/^\d+/)[0];
        const rest=trimmed.replace(/^\d+\.\s*/,'');
        htmlResult+=`<div style="display:flex;gap:8px;margin-bottom:8px;padding-bottom:8px;border-bottom:.5px solid var(--border)">
          <div style="width:20px;height:20px;border-radius:50%;background:var(--amber);color:#fff;font-size:10px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:1px">${num}</div>
          <div style="font-size:12px;color:var(--topbar);line-height:1.6">${esc(rest)}</div>
        </div>`;
      }else if(trimmed){
        htmlResult+=`<div style="font-size:12px;color:var(--text2);margin-bottom:4px;line-height:1.6">${esc(trimmed)}</div>`;
      }
    });
    el.innerHTML=htmlResult||`<div style="font-size:12px;color:var(--topbar);line-height:1.7">${esc(text)}</div>`;
  }catch(err){
    el.innerHTML=`<div style="color:var(--red);font-size:12px">Ошибка запроса: ${esc(err.message)}</div>`;
  }
};

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
    state.D.wallets.map(w=>`<option value="${w.id}"${w.id===l.walletId?' selected':''}>${esc(w.name)} (${w.balance<0?'-':''}${fmt(Math.abs(w.balance))})</option>`).join('');
  $('loan-wallet').innerHTML=opts;
  document.getElementById('modal-loan').classList.add('open');
};

function resetLoanModal(){
  $('loan-idx').value=-1;
  $('loan-name').value='';$('loan-amount').value='';$('loan-rate').value='';
  $('loan-months').value='';$('loan-start').value=today();
  const pdEl=$('loan-payday');if(pdEl)pdEl.value=1;
  $('loan-payment').value='';
  const grEl=$('loan-grace');if(grEl)grEl.value=0;
  $('loan-type').value='credit';toggleLoanType('credit');
  const opts='<option value="">— не привязывать —</option>'+
    state.D.wallets.map(w=>`<option value="${w.id}">${esc(w.name)} (${w.balance<0?'долг '+fmt(Math.abs(w.balance)):fmt(w.balance)})</option>`).join('');
  $('loan-wallet').innerHTML=opts;
}

function toggleLoanType(type){
  const isCard=type==='card';
  const cf=$('loan-credit-fields');const cf2=$('loan-card-fields');
  if(cf)cf.style.display=isCard?'none':'';
  if(cf2)cf2.style.display=isCard?'':'none';
}
window.toggleLoanType=toggleLoanType;

window.onLoanWalletChange=function(walletId){
  if(!walletId)return;
  const w=state.D.wallets.find(w=>w.id===walletId);
  if(!w)return;
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
  if(!calcPayment&&!isCard&&months>0){
    calcPayment=mr>0?Math.round(amount*mr*Math.pow(1+mr,months)/(Math.pow(1+mr,months)-1)):Math.round(amount/months);
  }
  const loan={
    id:idx>=0?state.D.loans[idx].id:('loan'+Date.now()),
    loanType,name:$('loan-name').value.trim(),
    amount,rate,months:isCard?0:months,
    startDate:$('loan-start').value||today(),
    payDay:parseInt($('loan-payday')?.value||25)||25,
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
  if(!confirm('Удалить кредит?'))return;
  state.D.loans.splice(i,1);sched();renderLoans();renderLoansSummaryInternal();
};

export{renderLoansSummaryInternal as renderLoansSummary};
