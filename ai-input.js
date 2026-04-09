import{$,state,today,sched,isPlanned}from'./core.js';

// Яндекс GPT API
// Ключ хранится в localStorage (не в Firebase — не синхронизируется между устройствами)
const getApiKey=()=>localStorage.getItem('ygpt_key')||'';
const getFolderId=()=>localStorage.getItem('ygpt_folder')||'';

export function initAI(){
  // Show AI input button if key is set
  const key=getApiKey();
  const btn=document.getElementById('ai-input-btn');
  if(btn)btn.style.display=key?'':'none';
}

export function openAISettings(){
  const modal=document.getElementById('modal-ai-settings');
  if(!modal)return;
  const keyEl=document.getElementById('ai-key-input');
  const folderEl=document.getElementById('ai-folder-input');
  if(keyEl)keyEl.value=getApiKey();
  if(folderEl)folderEl.value=getFolderId();
  modal.classList.add('open');
}

window.saveAISettings=function(){
  const key=document.getElementById('ai-key-input').value.trim();
  const folder=document.getElementById('ai-folder-input').value.trim();
  if(key)localStorage.setItem('ygpt_key',key);
  else localStorage.removeItem('ygpt_key');
  if(folder)localStorage.setItem('ygpt_folder',folder);
  else localStorage.removeItem('ygpt_folder');
  document.getElementById('modal-ai-settings').classList.remove('open');
  initAI();
};

window.openAIInput=function(){
  document.getElementById('modal-ai-input').classList.add('open');
  document.getElementById('ai-text-input').value='';
  document.getElementById('ai-result').innerHTML='';
  document.getElementById('ai-confirm-btn').style.display='none';
  setTimeout(()=>document.getElementById('ai-text-input').focus(),100);
};

window.processAIInput=async function(){
  const text=document.getElementById('ai-text-input').value.trim();
  if(!text)return;
  const key=getApiKey();
  const folder=getFolderId();
  if(!key){
    alert('Укажите API ключ Яндекс GPT в Настройках → ИИ');
    return;
  }

  const resultEl=document.getElementById('ai-result');
  const btn=document.getElementById('ai-process-btn');
  resultEl.innerHTML='<div style="color:var(--text2);font-size:13px">⏳ Анализирую...</div>';
  btn.disabled=true;

  // Build context for GPT
  const cats=[...state.D.incomeCats,...state.D.expenseCats.map(c=>c.name)].join(', ');
  const wallets=state.D.wallets.map(w=>w.name).join(', ');

  const prompt=`Ты помощник для учёта личных финансов. Разбери фразу пользователя и верни JSON.

Доступные категории: ${cats}
Доступные кошельки: ${wallets}
Сегодня: ${today()}

Фраза: "${text}"

Верни ТОЛЬКО JSON без пояснений:
{
  "type": "income" | "expense" | "transfer",
  "amount": число,
  "category": "название из списка категорий",
  "wallet": "название из списка кошельков",
  "walletTo": "название (только для transfer)",
  "date": "YYYY-MM-DD",
  "note": "краткое описание или пустая строка",
  "confidence": 0..1
}

Правила:
- Если кошелёк не указан явно — выбери наиболее логичный
- Категорию выбирай из списка, не придумывай новые
- Если не уверен — поставь confidence ниже 0.7`;

  try{
    const response=await fetch('https://llm.api.cloud.yandex.net/foundationModels/v1/completion',{
      method:'POST',
      headers:{
        'Content-Type':'application/json',
        'Authorization':'Api-Key '+key,
        'x-folder-id':folder
      },
      body:JSON.stringify({
        modelUri:`gpt://${folder}/yandexgpt-lite/latest`,
        completionOptions:{stream:false,temperature:0.1,maxTokens:300},
        messages:[{role:'user',text:prompt}]
      })
    });

    if(!response.ok){
      const err=await response.text();
      throw new Error('API error '+response.status+': '+err);
    }

    const data=await response.json();
    const rawText=data.result?.alternatives?.[0]?.message?.text||'';

    // Extract JSON from response
    const jsonMatch=rawText.match(/\{[\s\S]*\}/);
    if(!jsonMatch)throw new Error('Не удалось разобрать ответ ИИ');
    const parsed=JSON.parse(jsonMatch[0]);

    // Find wallet IDs
    const wallet=state.D.wallets.find(w=>w.name===parsed.wallet)||state.D.wallets[0];
    const walletTo=parsed.walletTo?state.D.wallets.find(w=>w.name===parsed.walletTo):null;

    // Store parsed op for confirmation
    window._aiParsedOp={
      type:parsed.type||'expense',
      amount:parsed.amount||0,
      category:parsed.category||'Прочее',
      wallet:wallet?.id||state.D.wallets[0]?.id,
      walletTo:walletTo?.id||null,
      date:parsed.date||today(),
      note:parsed.note||text,
      confidence:parsed.confidence||1
    };

    const op=window._aiParsedOp;
    const isInc=op.type==='income';
    const isTr=op.type==='transfer';
    const color=isInc?'var(--green-dark)':isTr?'var(--blue)':'var(--orange-dark)';
    const confColor=op.confidence>=0.8?'var(--green-dark)':op.confidence>=0.6?'var(--amber)':'var(--red)';

    resultEl.innerHTML=`
      <div style="background:var(--card);border:1.5px solid var(--border2);border-radius:10px;padding:14px;margin-top:10px">
        <div style="font-size:11px;font-weight:700;color:var(--text2);letter-spacing:.5px;margin-bottom:8px">РАСПОЗНАНО</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px">
          <div class="bal-item"><div class="bal-lbl">ТИП</div><div style="font-size:13px;font-weight:700;color:${color}">${isInc?'Доход':isTr?'Перевод':'Расход'}</div></div>
          <div class="bal-item"><div class="bal-lbl">СУММА</div><div style="font-size:16px;font-weight:700;color:${color}">${isInc?'+':isTr?'→':'−'} ₽${op.amount.toLocaleString('ru-RU')}</div></div>
          <div class="bal-item"><div class="bal-lbl">КАТЕГОРИЯ</div><div style="font-size:13px;font-weight:700">${op.category}</div></div>
          <div class="bal-item"><div class="bal-lbl">КОШЕЛЁК</div><div style="font-size:13px;font-weight:700">${wallet?.name||'?'}${walletTo?' → '+walletTo.name:''}</div></div>
          <div class="bal-item"><div class="bal-lbl">ДАТА</div><div style="font-size:13px;font-weight:700">${op.date.split('-').reverse().join('.')}</div></div>
          <div class="bal-item" style="background:var(--card)"><div class="bal-lbl">УВЕРЕННОСТЬ</div><div style="font-size:13px;font-weight:700;color:${confColor}">${Math.round(op.confidence*100)}%</div></div>
        </div>
        ${op.note?`<div style="font-size:11px;color:var(--text2)">Заметка: ${op.note}</div>`:''}
        ${op.confidence<0.7?'<div style="font-size:11px;color:var(--orange-dark);margin-top:6px">⚠ Низкая уверенность — проверьте данные</div>':''}
      </div>`;

    document.getElementById('ai-confirm-btn').style.display='';

  }catch(err){
    resultEl.innerHTML=`<div style="color:var(--red);font-size:13px;padding:10px 0">Ошибка: ${err.message}</div>`;
  }finally{
    btn.disabled=false;
  }
};

window.confirmAIOp=function(){
  const op=window._aiParsedOp;
  if(!op)return;
  // Save operation
  const newOp={
    id:'op'+Date.now(),
    type:op.type,amount:op.amount,
    date:op.date,wallet:op.wallet,
    category:op.category,note:op.note
  };
  if(op.type==='transfer')newOp.walletTo=op.walletTo;
  // Update wallet balances
  const wf=state.D.wallets.find(w=>w.id===op.wallet);
  if(op.type==='income'&&wf)wf.balance+=op.amount;
  else if(op.type==='expense'&&wf)wf.balance-=op.amount;
  else if(op.type==='transfer'){
    if(wf)wf.balance-=op.amount;
    const wt=state.D.wallets.find(w=>w.id===op.walletTo);
    if(wt)wt.balance+=op.amount;
  }
  state.D.operations.push(newOp);
  sched();
  document.getElementById('modal-ai-input').classList.remove('open');
  window._aiParsedOp=null;
  // Refresh
  const cur=document.querySelector('.screen.active')?.id?.replace('screen-','');
  if(cur==='reports'&&window.renderReports)window.renderReports();
  else if(cur==='dds'&&window.renderDDS)window.renderDDS();
  else if(cur==='dashboard'&&window.renderDashboard)window.renderDashboard();
  // Show success toast
  showAIToast(`Добавлено: ${op.type==='income'?'+':'−'}₽${op.amount.toLocaleString('ru-RU')} · ${op.category}`);
};

function showAIToast(msg){
  let t=document.getElementById('ai-toast');
  if(!t){
    t=document.createElement('div');t.id='ai-toast';
    t.style.cssText='position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:var(--topbar);color:#C9A96E;padding:10px 20px;border-radius:8px;font-size:13px;font-weight:600;z-index:999;opacity:0;transition:opacity .3s;pointer-events:none;white-space:nowrap;border:1px solid var(--border2)';
    document.body.appendChild(t);
  }
  t.textContent=msg;t.style.opacity='1';
  setTimeout(()=>t.style.opacity='0',2500);
}
