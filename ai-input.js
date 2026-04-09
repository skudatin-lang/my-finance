import{$,state,sched,today,wName}from'./core.js';
import{saveOperation}from'./operations.js';

// ── Settings ────────────────────────────────────────────────────
export function initAI(){
  // Load saved settings
  const key=localStorage.getItem('yagpt_key')||'';
  const folder=localStorage.getItem('yagpt_folder')||'';
  const proxy=localStorage.getItem('yagpt_proxy')||'';
  if($('yagpt-key'))$('yagpt-key').value=key;
  if($('yagpt-folder'))$('yagpt-folder').value=folder;
  if($('yagpt-proxy'))$('yagpt-proxy').value=proxy;
  updateAIButton();
}

export function openAISettings(){
  document.getElementById('modal-ai-settings')?.classList.add('open');
}

window.saveAISettings=function(){
  localStorage.setItem('yagpt_key',$('yagpt-key').value.trim());
  localStorage.setItem('yagpt_folder',$('yagpt-folder').value.trim());
  localStorage.setItem('yagpt_proxy',$('yagpt-proxy').value.trim());
  document.getElementById('modal-ai-settings')?.classList.remove('open');
  updateAIButton();
};

function updateAIButton(){
  const hasKey=localStorage.getItem('yagpt_key')&&localStorage.getItem('yagpt_folder');
  const btn=$('ai-voice-btn');
  if(btn)btn.style.display=hasKey?'':'none';
}

// ── Voice recording state ───────────────────────────────────────
let recognition=null;
let isListening=false;

export function initVoice(){
  updateAIButton();
  // Check Web Speech API support
  const SpeechRecognition=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(!SpeechRecognition){
    console.log('Web Speech API not supported');
    return;
  }
  recognition=new SpeechRecognition();
  recognition.lang='ru-RU';
  recognition.continuous=false;
  recognition.interimResults=true;
  recognition.maxAlternatives=1;

  recognition.onstart=()=>{
    isListening=true;
    showVoiceUI('listening','Говорите...');
  };

  recognition.onresult=(event)=>{
    const transcript=Array.from(event.results)
      .map(r=>r[0].transcript).join('');
    const isFinal=event.results[event.results.length-1].isFinal;
    showVoiceUI('listening', isFinal?`"${transcript}"`:transcript, transcript);
    if(isFinal){
      stopListening();
      processVoiceInput(transcript);
    }
  };

  recognition.onerror=(event)=>{
    isListening=false;
    if(event.error==='not-allowed'){
      showVoiceUI('error','Нет доступа к микрофону. Разрешите в настройках браузера.');
    }else if(event.error==='no-speech'){
      showVoiceUI('error','Ничего не услышал. Попробуйте ещё раз.');
    }else{
      showVoiceUI('error','Ошибка: '+event.error);
    }
    setTimeout(hideVoiceUI, 2500);
  };

  recognition.onend=()=>{isListening=false;};
}

window.toggleVoiceInput=function(){
  if(isListening){stopListening();return;}
  if(!recognition){
    // Fallback: text input
    showTextInputFallback();
    return;
  }
  try{
    recognition.start();
  }catch(e){
    showTextInputFallback();
  }
};

function stopListening(){
  if(recognition&&isListening){
    try{recognition.stop();}catch(e){}
    isListening=false;
  }
}

// ── Text fallback (if no mic) ───────────────────────────────────
function showTextInputFallback(){
  showVoiceUI('text','Введите операцию текстом:');
}

window.submitTextInput=function(){
  const text=$('voice-text-input')?.value?.trim();
  if(!text)return;
  hideTextInput();
  processVoiceInput(text);
};

// ── Process input through Yandex GPT ───────────────────────────
async function processVoiceInput(text){
  showVoiceUI('thinking','Обрабатываю...');

  const key=localStorage.getItem('yagpt_key');
  const folder=localStorage.getItem('yagpt_folder');
  const proxy=localStorage.getItem('yagpt_proxy');

  if(!key||!folder){
    showVoiceUI('error','Настройте Яндекс GPT в настройках');
    setTimeout(hideVoiceUI,2500);
    return;
  }

  const cats=[...state.D.incomeCats,...state.D.expenseCats.map(c=>c.name)];
  const wallets=state.D.wallets.map(w=>w.name);
  const today_=today();

  const prompt=`Ты помощник для учёта личных финансов. Разбери фразу пользователя и верни JSON.

Доступные категории: ${cats.join(', ')}
Доступные кошельки: ${wallets.join(', ')}
Сегодня: ${today_}

Фраза: "${text}"

Верни ТОЛЬКО JSON без пояснений:
{
  "type": "expense"|"income"|"transfer",
  "amount": число,
  "category": "название категории из списка или придумай похожую",
  "wallet": "название кошелька из списка",
  "walletTo": "название кошелька (только для transfer)",
  "note": "краткое описание",
  "date": "YYYY-MM-DD"
}`;

  try{
    const url=proxy||'https://llm.api.cloud.yandex.net/foundationModels/v1/completion';
    const resp=await fetch(url,{
      method:'POST',
      headers:{
        'Content-Type':'application/json',
        'Authorization':`Api-Key ${key}`,
        'x-folder-id':folder
      },
      body:JSON.stringify({
        modelUri:`gpt://${folder}/yandexgpt-lite/latest`,
        completionOptions:{stream:false,temperature:0.1,maxTokens:256},
        messages:[{role:'user',text:prompt}]
      })
    });

    const data=await resp.json();
    const raw=data?.result?.alternatives?.[0]?.message?.text||'';
    // Parse JSON from response
    const jsonMatch=raw.match(/\{[\s\S]*\}/);
    if(!jsonMatch)throw new Error('Не удалось разобрать ответ');
    const op=JSON.parse(jsonMatch[0]);

    // Find wallet IDs by name
    const wallet=state.D.wallets.find(w=>w.name===op.wallet||w.name.toLowerCase()===op.wallet?.toLowerCase());
    const walletTo=state.D.wallets.find(w=>w.name===op.walletTo||w.name.toLowerCase()===op.walletTo?.toLowerCase());

    showPreview({
      type:op.type||'expense',
      amount:op.amount||0,
      category:op.category||'Прочее',
      wallet:wallet?.id||state.D.wallets[0]?.id,
      walletTo:walletTo?.id||null,
      note:op.note||text,
      date:op.date||today_,
      _walletName:wallet?.name||op.wallet||'',
      _walletToName:walletTo?.name||op.walletTo||''
    });

  }catch(err){
    showVoiceUI('error','Ошибка: '+err.message);
    setTimeout(hideVoiceUI,3000);
  }
}

// ── Preview & confirm ───────────────────────────────────────────
function showPreview(op){
  const overlay=$('voice-overlay');
  if(!overlay)return;

  const typeLabels={expense:'Расход',income:'Доход',transfer:'Перевод'};
  const typeColors={expense:'var(--red)',income:'var(--green-dark)',transfer:'var(--blue)'};
  const sign={expense:'−',income:'+',transfer:'→'};

  overlay.innerHTML=`
    <div style="background:var(--card);border-radius:16px;padding:20px;max-width:360px;width:100%;box-shadow:0 8px 32px rgba(0,0,0,.25)">
      <div style="font-size:12px;font-weight:700;color:var(--text2);letter-spacing:.6px;margin-bottom:12px">РАСПОЗНАНО</div>

      <div style="background:var(--amber-light);border-radius:10px;padding:14px;margin-bottom:14px">
        <div style="font-size:28px;font-weight:700;color:${typeColors[op.type]||'var(--topbar)'};margin-bottom:4px">
          ${sign[op.type]||''} ₽${op.amount?.toLocaleString('ru-RU')||'0'}
        </div>
        <div style="font-size:13px;color:var(--topbar);font-weight:600">${op.category||'—'}</div>
        <div style="font-size:11px;color:var(--text2);margin-top:3px">
          ${typeLabels[op.type]||''} · ${op._walletName||'—'}${op.type==='transfer'?' → '+(op._walletToName||'—'):''}
        </div>
        ${op.note?`<div style="font-size:11px;color:var(--text2);margin-top:2px">${op.note}</div>`:''}
        <div style="font-size:11px;color:var(--text2);margin-top:2px">${op.date||today()}</div>
      </div>

      <div style="display:flex;gap:10px">
        <button onclick="window.confirmVoiceOp()" style="flex:1;background:var(--amber);color:#fff;border:none;border-radius:10px;padding:12px;font-size:14px;font-weight:700;cursor:pointer">✓ Добавить</button>
        <button onclick="window.editVoiceOp()" style="flex:1;background:var(--card);color:var(--topbar);border:1.5px solid var(--border2);border-radius:10px;padding:12px;font-size:14px;font-weight:700;cursor:pointer">✎ Изменить</button>
        <button onclick="window.cancelVoiceOp()" style="background:var(--card);color:var(--text2);border:1.5px solid var(--border2);border-radius:10px;padding:12px;font-size:20px;cursor:pointer">✕</button>
      </div>

      <div style="text-align:center;margin-top:12px">
        <button onclick="window.toggleVoiceInput()" style="background:none;border:none;color:var(--amber);font-size:12px;cursor:pointer;font-weight:700">🎤 Сказать ещё раз</button>
      </div>
    </div>`;

  overlay.style.display='flex';
  window._pendingVoiceOp=op;
}

window.confirmVoiceOp=function(){
  const op=window._pendingVoiceOp;
  if(!op||!state.D)return;
  const newOp={
    id:'op'+Date.now(),
    type:op.type,amount:op.amount,
    date:op.date||today(),
    wallet:op.wallet,
    walletTo:op.walletTo||null,
    category:op.category,
    note:op.note,
    planId:op.planId||null
  };
  // Update wallet balance
  const w=state.D.wallets.find(w=>w.id===op.wallet);
  if(w){
    if(op.type==='income')w.balance+=op.amount;
    else if(op.type==='expense')w.balance-=op.amount;
    else if(op.type==='transfer'){w.balance-=op.amount;}
  }
  if(op.type==='transfer'&&op.walletTo){
    const wt=state.D.wallets.find(w=>w.id===op.walletTo);
    if(wt)wt.balance+=op.amount;
  }
  state.D.operations.push(newOp);
  sched();
  hideVoiceUI();
  window._pendingVoiceOp=null;
  // Refresh current screen
  if(window.refreshCurrent)window.refreshCurrent();
  // Show brief success
  showToast(`✓ Добавлено: ${op.category} ₽${op.amount?.toLocaleString('ru-RU')}`);
};

window.editVoiceOp=function(){
  const op=window._pendingVoiceOp;
  if(!op)return;
  hideVoiceUI();
  // Open standard operation modal with pre-filled data
  if(window.openModal){
    window.openModal();
    setTimeout(()=>{
      if($('op-type'))$('op-type').value=op.type;
      if(window.setType)window.setType(op.type);
      if($('op-amount'))$('op-amount').value=op.amount;
      if($('op-cat'))$('op-cat').value=op.category;
      if($('op-note'))$('op-note').value=op.note||'';
      if($('op-date'))$('op-date').value=op.date||today();
      // Select wallet
      const walletSel=$('op-wallet');
      if(walletSel)walletSel.value=op.wallet||'';
    },100);
  }
};

window.cancelVoiceOp=function(){
  hideVoiceUI();
  window._pendingVoiceOp=null;
};

// ── UI helpers ──────────────────────────────────────────────────
function showVoiceUI(state_,text,transcript){
  const overlay=$('voice-overlay');
  if(!overlay)return;
  const icons={listening:'🎤',thinking:'⏳',error:'❌',text:'⌨️'};
  const colors={listening:'var(--amber)',thinking:'var(--blue)',error:'var(--red)',text:'var(--topbar)'};
  overlay.style.display='flex';
  overlay.innerHTML=`
    <div style="background:var(--card);border-radius:16px;padding:24px;max-width:320px;width:100%;text-align:center;box-shadow:0 8px 32px rgba(0,0,0,.25)">
      <div style="font-size:48px;margin-bottom:12px${state_==='listening'?';animation:pulse 1s infinite':''}">${icons[state_]||'🎤'}</div>
      <div style="font-size:14px;font-weight:700;color:${colors[state_]||'var(--topbar)'};margin-bottom:8px">${text}</div>
      ${transcript?`<div style="font-size:12px;color:var(--text2);font-style:italic">"${transcript}"</div>`:''}
      ${state_==='text'?`
        <input class="fi" id="voice-text-input" placeholder="потратил 500 на продукты" style="margin:12px 0;text-align:center"
          onkeydown="if(event.key==='Enter')window.submitTextInput()">
        <div style="display:flex;gap:8px">
          <button onclick="window.submitTextInput()" style="flex:1;background:var(--amber);color:#fff;border:none;border-radius:8px;padding:10px;font-weight:700;cursor:pointer">Разобрать</button>
          <button onclick="window.cancelVoiceOp()" style="background:var(--card);border:1.5px solid var(--border2);border-radius:8px;padding:10px;color:var(--text2);cursor:pointer">✕</button>
        </div>`:''}
      ${state_==='listening'?`<button onclick="window.toggleVoiceInput()" style="margin-top:12px;background:var(--red-bg);border:1.5px solid var(--r200);border-radius:8px;padding:8px 20px;color:var(--red);font-weight:700;cursor:pointer">■ Стоп</button>`:''}
    </div>`;
}

function hideVoiceUI(){
  const overlay=$('voice-overlay');
  if(overlay)overlay.style.display='none';
}

function hideTextInput(){
  hideVoiceUI();
}

function showToast(msg){
  const toast=document.createElement('div');
  toast.style.cssText='position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:var(--topbar);color:#C9A96E;padding:10px 20px;border-radius:10px;font-size:13px;font-weight:700;z-index:9999;pointer-events:none;opacity:1;transition:opacity .5s';
  toast.textContent=msg;
  document.body.appendChild(toast);
  setTimeout(()=>{toast.style.opacity='0';setTimeout(()=>toast.remove(),500);},2000);
}
