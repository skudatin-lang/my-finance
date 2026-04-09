// ── AI Input: Yandex GPT + Web Speech API voice ──────────────────
import{state,sched,saveNow}from'./core.js';

// ── Settings (localStorage, not Firebase) ────────────────────────
function getS(){try{return JSON.parse(localStorage.getItem('aiSettings')||'{}');}catch{return{};}}
function putS(s){localStorage.setItem('aiSettings',JSON.stringify(s));}

// ── Init ─────────────────────────────────────────────────────────
export function initAI(){
  const s=getS();
  if(s.apiKey||s.proxyUrl){
    const btn=document.getElementById('ai-voice-btn');
    if(btn)btn.style.display='';
  }
  // Pre-fill settings form if values exist
  const key=document.getElementById('yagpt-key');
  const folder=document.getElementById('yagpt-folder');
  const proxy=document.getElementById('yagpt-proxy');
  if(key)key.value=s.apiKey||'';
  if(folder)folder.value=s.folderId||'';
  if(proxy)proxy.value=s.proxyUrl||'';
}

export function initVoice(){
  const supported='webkitSpeechRecognition' in window||'SpeechRecognition' in window;
  const btn=document.getElementById('ai-voice-btn');
  if(btn&&supported)btn.style.display='';
}

export function openAISettings(){
  const s=getS();
  const key=document.getElementById('yagpt-key');
  const folder=document.getElementById('yagpt-folder');
  const proxy=document.getElementById('yagpt-proxy');
  if(key)key.value=s.apiKey||'';
  if(folder)folder.value=s.folderId||'';
  if(proxy)proxy.value=s.proxyUrl||'';
  document.getElementById('modal-ai-settings')?.classList.add('open');
}

window.saveAISettings=function(){
  const s={
    apiKey:document.getElementById('yagpt-key')?.value.trim()||'',
    folderId:document.getElementById('yagpt-folder')?.value.trim()||'',
    proxyUrl:(document.getElementById('yagpt-proxy')?.value.trim()||'').replace(/\/$/,''),
  };
  putS(s);
  document.getElementById('modal-ai-settings')?.classList.remove('open');
  const btn=document.getElementById('ai-voice-btn');
  if(btn&&(s.apiKey||s.proxyUrl))btn.style.display='';
};

// ── Voice toggle ─────────────────────────────────────────────────
let recognition=null;
let isListening=false;

window.toggleVoiceInput=function(){
  // If AI settings configured - use voice → GPT flow
  // Otherwise open text input modal
  const s=getS();
  const hasVoice='webkitSpeechRecognition' in window||'SpeechRecognition' in window;
  if(hasVoice){
    isListening?stopVoice():startVoice();
  } else {
    document.getElementById('modal-ai-input')?.classList.add('open');
  }
};

function startVoice(){
  const SpeechRecognition=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(!SpeechRecognition)return;
  recognition=new SpeechRecognition();
  recognition.lang='ru-RU';
  recognition.interimResults=false;
  recognition.maxAlternatives=1;

  const btn=document.getElementById('ai-voice-btn');
  recognition.onstart=()=>{
    isListening=true;
    if(btn){btn.style.background='var(--red)';btn.style.color='#fff';btn.textContent='🔴 Слушаю...';}
  };
  recognition.onresult=(e)=>{
    const text=e.results[0][0].transcript;
    resetVoiceBtn();
    // Put text into AI input modal and process
    const inp=document.getElementById('ai-text-input');
    if(inp)inp.value=text;
    document.getElementById('modal-ai-input')?.classList.add('open');
    processText(text);
  };
  recognition.onerror=(e)=>{
    resetVoiceBtn();
    if(e.error==='not-allowed')alert('Разрешите доступ к микрофону в браузере');
    else if(e.error!=='aborted')alert('Ошибка голоса: '+e.error);
  };
  recognition.onend=()=>resetVoiceBtn();
  recognition.start();
}

function stopVoice(){recognition?.stop();}

function resetVoiceBtn(){
  isListening=false;
  const btn=document.getElementById('ai-voice-btn');
  if(btn){btn.style.background='rgba(186,117,23,.3)';btn.style.color='var(--amber)';btn.textContent='🎤';}
}

// ── Text process button ───────────────────────────────────────────
window.processAIInput=function(){
  const text=document.getElementById('ai-text-input')?.value.trim();
  if(!text)return;
  processText(text);
};

async function processText(text){
  const resultEl=document.getElementById('ai-result');
  const confirmBtn=document.getElementById('ai-confirm-btn');
  if(resultEl)resultEl.innerHTML='<div style="color:var(--text2);font-size:12px;padding:8px 0">⏳ Обрабатываю...</div>';
  if(confirmBtn)confirmBtn.style.display='none';

  const s=getS();
  let parsed=null;
  if((s.apiKey||s.proxyUrl)&&s.folderId){
    parsed=await parseWithGPT(text,s);
  }
  if(!parsed)parsed=parseSimple(text);

  showAIResult(parsed);
}

async function parseWithGPT(text,s){
  const cats=[...state.D.incomeCats,...state.D.expenseCats.map(c=>c.name)].join(', ');
  const wallets=state.D.wallets.map(w=>w.name).join(', ');
  const prompt=`Разбери финансовую операцию: "${text}"
Верни только JSON без markdown: {"type":"expense"|"income","amount":число,"category":"категория из списка","wallet":"кошелёк из списка","note":"краткое описание"}
Категории: ${cats}
Кошельки: ${wallets}`;

  const endpoint=(s.proxyUrl||'https://llm.api.cloud.yandex.net/foundationModels/v1/completion');
  try{
    const headers={'Content-Type':'application/json','Authorization':'Api-Key '+s.apiKey};
    if(s.folderId)headers['x-folder-id']=s.folderId;
    const res=await fetch(endpoint,{
      method:'POST',headers,
      body:JSON.stringify({
        modelUri:`gpt://${s.folderId}/yandexgpt-lite/latest`,
        completionOptions:{stream:false,temperature:.1,maxTokens:200},
        messages:[{role:'user',text:prompt}]
      })
    });
    const data=await res.json();
    const raw=data?.result?.alternatives?.[0]?.message?.text||'';
    return JSON.parse(raw.replace(/```json|```/g,'').trim());
  }catch{return null;}
}

function parseSimple(text){
  const m=text.match(/[\d\s]+/);
  const amount=m?parseFloat(m[0].replace(/\s/g,'')):0;
  const isIncome=/получил|зарплата|доход|пришло|аванс|выплат/i.test(text);
  const cats=isIncome?state.D.incomeCats:state.D.expenseCats.map(c=>c.name);
  let category=cats[0]||'Прочее';
  cats.forEach(cat=>{if(text.toLowerCase().includes(cat.toLowerCase()))category=cat;});
  return{type:isIncome?'income':'expense',amount,category,
    wallet:state.D.wallets[0]?.name||'',note:text.slice(0,60)};
}

function showAIResult(data){
  const resultEl=document.getElementById('ai-result');
  const confirmBtn=document.getElementById('ai-confirm-btn');
  if(!resultEl)return;

  const cats=data.type==='income'?state.D.incomeCats:state.D.expenseCats.map(c=>c.name);
  const walletOpts=state.D.wallets.map(w=>`<option ${w.name===data.wallet?'selected':''}>${w.name}</option>`).join('');
  const catOpts=cats.map(c=>`<option ${c===data.category?'selected':''}>${c}</option>`).join('');

  resultEl.innerHTML=`
    <div style="background:var(--amber-light);border:1px solid var(--border);border-radius:8px;padding:12px;margin-top:10px">
      <div style="font-size:11px;font-weight:700;color:var(--text2);margin-bottom:8px;letter-spacing:.5px">РЕЗУЛЬТАТ — ПРОВЕРЬТЕ И ИСПРАВЬТЕ</div>
      <div class="rf">
        <div class="fg"><label style="font-size:10px">ТИП</label>
          <select class="fi" id="ai-res-type" style="font-size:12px" onchange="window.aiTypeChange(this.value)">
            <option value="expense" ${data.type==='expense'?'selected':''}>Расход</option>
            <option value="income" ${data.type==='income'?'selected':''}>Доход</option>
          </select>
        </div>
        <div class="fg"><label style="font-size:10px">СУММА</label>
          <input class="fi" type="number" id="ai-res-amount" value="${data.amount||''}" style="font-size:14px;font-weight:700">
        </div>
      </div>
      <div class="rf">
        <div class="fg"><label style="font-size:10px">КАТЕГОРИЯ</label>
          <select class="fi" id="ai-res-cat" style="font-size:12px">${catOpts}</select>
        </div>
        <div class="fg"><label style="font-size:10px">КОШЕЛЁК</label>
          <select class="fi" id="ai-res-wallet" style="font-size:12px">${walletOpts}</select>
        </div>
      </div>
      <div class="fg"><label style="font-size:10px">ЗАМЕТКА</label>
        <input class="fi" id="ai-res-note" value="${data.note||''}" style="font-size:12px">
      </div>
    </div>`;

  if(confirmBtn)confirmBtn.style.display='';
}

window.aiTypeChange=function(type){
  const catSel=document.getElementById('ai-res-cat');
  if(!catSel)return;
  const cats=type==='income'?state.D.incomeCats:state.D.expenseCats.map(c=>c.name);
  catSel.innerHTML=cats.map(c=>`<option>${c}</option>`).join('');
};

window.confirmAIOp=function(){
  const type=document.getElementById('ai-res-type')?.value||'expense';
  const amount=parseFloat(document.getElementById('ai-res-amount')?.value)||0;
  const category=document.getElementById('ai-res-cat')?.value||'';
  const walletName=document.getElementById('ai-res-wallet')?.value||'';
  const note=document.getElementById('ai-res-note')?.value||'';
  if(!amount){alert('Укажите сумму');return;}
  const wallet=state.D.wallets.find(w=>w.name===walletName);
  if(!wallet){alert('Кошелёк не найден');return;}
  const op={id:'op'+Date.now(),type,amount,
    date:new Date().toISOString().split('T')[0],
    wallet:wallet.id,category,note};
  if(type==='income')wallet.balance+=amount;
  else wallet.balance-=amount;
  state.D.operations.push(op);
  sched();saveNow();
  document.getElementById('modal-ai-input')?.classList.remove('open');
  const res=document.getElementById('ai-result');if(res)res.innerHTML='';
  const cb=document.getElementById('ai-confirm-btn');if(cb)cb.style.display='none';
  const inp=document.getElementById('ai-text-input');if(inp)inp.value='';
  // Refresh dashboard if active
  if(document.getElementById('screen-dashboard')?.classList.contains('active')){
    window.showScreen&&window.showScreen('dashboard');
  }
};
