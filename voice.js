// voice.js — Yandex SpeechKit STT + Yandex GPT intent parsing
// Architecture: Cloudflare Worker holds the API key — users enter nothing
// OR users can provide their own key in Settings (overrides shared key)
import{state,sched,fmt,today,wName}from'./core.js';

// Config
let _sttProxyUrl=''; // STT proxy (worker.../stt)
let _gptProxyUrl=''; // GPT proxy (worker.../gpt)
let _iamToken='';    // optional user override
let _folderId='';    // optional user override

let _mediaRecorder=null,_audioChunks=[],_isRecording=false;

// ── Settings ────────────────────────────────────────────────────
export function loadVoiceSettings(){
  if(!state.D)return;
  if(!state.D.voiceSettings)state.D.voiceSettings={proxyUrl:'',iamToken:'',folderId:''};
  const vs=state.D.voiceSettings;
  _sttProxyUrl=vs.proxyUrl||'';
  _gptProxyUrl=vs.gptProxyUrl||vs.proxyUrl||''; // same worker, different path
  _iamToken=vs.iamToken||'';
  _folderId=vs.folderId||'';
}

export function saveVoiceSettings(proxyUrl,gptProxyUrl,iamToken,folderId){
  if(!state.D)return;
  state.D.voiceSettings={proxyUrl,gptProxyUrl:gptProxyUrl||proxyUrl,iamToken,folderId};
  loadVoiceSettings();
  sched();
}

export function isVoiceConfigured(){
  return!!(_sttProxyUrl.trim());
}

export function isRecording(){return _isRecording;}

// ── STT Recording ────────────────────────────────────────────────
export async function startRecording(onResult,onError,onStateChange){
  if(_isRecording)return;
  if(!isVoiceConfigured()){
    onError&&onError('Голосовой ввод не настроен. Укажите Прокси URL в Настройках.');
    return;
  }
  try{
    const stream=await navigator.mediaDevices.getUserMedia({audio:true});
    _audioChunks=[];
    const mime=MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')
      ?'audio/ogg;codecs=opus'
      :(MediaRecorder.isTypeSupported('audio/webm;codecs=opus')?'audio/webm;codecs=opus':'audio/webm');
    _mediaRecorder=new MediaRecorder(stream,{mimeType:mime});
    _mediaRecorder.ondataavailable=e=>{if(e.data&&e.data.size>0)_audioChunks.push(e.data);};
    _mediaRecorder.onstop=async()=>{
      stream.getTracks().forEach(t=>t.stop());
      const text=await _sendSTT();
      if(text)onResult&&onResult(text);
    };
    _mediaRecorder.start(250);
    _isRecording=true;
    onStateChange&&onStateChange(true);
  }catch(e){
    onError&&onError('Нет доступа к микрофону: '+e.message);
  }
}

export function stopRecording(onStateChange){
  if(!_isRecording||!_mediaRecorder)return;
  _isRecording=false;
  onStateChange&&onStateChange(false);
  try{_mediaRecorder.stop();}catch(e){}
}

async function _sendSTT(){
  if(!_audioChunks.length)return null;
  const mime=_mediaRecorder?.mimeType||'audio/webm';
  const blob=new Blob(_audioChunks,{type:mime});
  const ab=await blob.arrayBuffer();
  const bytes=new Uint8Array(ab);
  let bin='';for(let i=0;i<bytes.byteLength;i++)bin+=String.fromCharCode(bytes[i]);
  const base64=btoa(bin);
  const format=mime.includes('ogg')?'OGG_OPUS':'WEBM_OPUS';
  const body={
    config:{specification:{languageCode:'ru-RU',audioEncoding:format,sampleRateHertz:48000}},
    audio:{content:base64}
  };
  const headers={'Content-Type':'application/json'};
  if(_iamToken)headers['Authorization']='Api-Key '+_iamToken;
  if(_folderId)headers['x-folder-id']=_folderId;
  try{
    const resp=await fetch(_sttProxyUrl,{method:'POST',headers,body:JSON.stringify(body)});
    if(!resp.ok){const t=await resp.text();_showToast('STT ошибка '+resp.status+': '+t.slice(0,100));return null;}
    const data=await resp.json();
    let text='';
    if(data.result)text=data.result;
    else if(data.chunks)text=data.chunks.map(c=>c.alternatives?.[0]?.text||'').join(' ');
    return text.trim()||null;
  }catch(e){_showToast('Ошибка: '+e.message);return null;}
}

// ── GPT Intent Parsing ────────────────────────────────────────────
export async function parseIntent(spokenText){
  if(!state.D)return null;
  const cats=[...state.D.incomeCats,...state.D.expenseCats.map(c=>c.name)];
  const wallets=state.D.wallets.map(w=>w.name);
  const planItems=state.D.plan.map(p=>p.label);

  const systemPrompt=`Ты помощник по личным финансам. Пользователь надиктовал команду голосом.
Определи намерение и верни JSON с полем "intent" и необходимыми данными.
Доступные намерения:
- "add_expense" — добавить расход. Поля: amount(число), category(строка), note(строка), wallet(строка)
- "add_income" — добавить доход. Поля: amount(число), category(строка), note(строка), wallet(строка)
- "add_transfer" — перевод между кошельками. Поля: amount, from_wallet, to_wallet
- "add_shopping" — добавить в список покупок. Поля: items([{name,qty,price}])
- "check_balance" — узнать баланс. Поля: wallet(строка, опционально)
- "add_goal" — создать финансовую цель. Поля: name, target_amount, deadline(YYYY-MM-DD опционально)
- "add_category" — добавить категорию. Поля: name, type(income/expense)
- "set_limit" — установить лимит по категории. Поля: category, amount
- "unknown" — непонятная команда. Поля: raw_text

Категории расходов: ${cats.slice(0,15).join(', ')}
Кошельки: ${wallets.join(', ')}
Статьи финплана: ${planItems.join(', ')}
Сегодня: ${today()}

Отвечай ТОЛЬКО JSON, без пояснений.`;

  const gptUrl=_gptProxyUrl||_sttProxyUrl;
  if(!gptUrl)return{intent:'unknown',raw_text:spokenText};

  const headers={'Content-Type':'application/json'};
  if(_iamToken)headers['Authorization']='Api-Key '+_iamToken;
  if(_folderId)headers['x-folder-id']=_folderId;

  const gptBody={
    modelUri:_folderId?`gpt://${_folderId}/yandexgpt-lite/latest`:'yandexgpt-lite',
    completionOptions:{stream:false,temperature:0.1,maxTokens:300},
    messages:[
      {role:'system',text:systemPrompt},
      {role:'user',text:spokenText}
    ]
  };

  try{
    const resp=await fetch(gptUrl.replace('/stt','/gpt').replace('/speech','/gpt'),{
      method:'POST',headers,body:JSON.stringify(gptBody)
    });
    if(!resp.ok)return{intent:'unknown',raw_text:spokenText};
    const data=await resp.json();
    const text=data.result?.alternatives?.[0]?.message?.text||data.result?.text||'';
    const clean=text.replace(/```json|```/g,'').trim();
    return JSON.parse(clean);
  }catch(e){
    // Fallback: simple regex parsing if GPT unavailable
    return _fallbackParse(spokenText);
  }
}

function _fallbackParse(text){
  const t=text.toLowerCase();
  // Amount detection
  const amtMatch=text.match(/(\d[\d\s]*[\d])/);
  const amount=amtMatch?parseFloat(amtMatch[1].replace(/\s/g,'')):0;
  // Intent detection
  if(t.includes('куп')||t.includes('трат')||t.includes('потрат')||t.includes('заплат')||t.includes('расход'))
    return{intent:'add_expense',amount,category:'Прочее',note:text};
  if(t.includes('доход')||t.includes('зарплат')||t.includes('получ')||t.includes('прихо'))
    return{intent:'add_income',amount,category:'Прочее',note:text};
  if(t.includes('список')||t.includes('купить')||t.includes('магазин'))
    return{intent:'add_shopping',items:[{name:text,qty:1,price:0}]};
  if(t.includes('перевод')||t.includes('перевес')||t.includes('перенес'))
    return{intent:'add_transfer',amount,from_wallet:'',to_wallet:''};
  return{intent:'unknown',raw_text:text};
}

// ── Voice Intent Handler ────────────────────────────────────────────
// Called after full recognition+parsing, shows confirmation UI
export function handleVoiceIntent(intent,onConfirm){
  const modal=document.getElementById('modal-voice-intent');
  if(!modal){onConfirm&&onConfirm(intent);return;}

  const titleEl=modal.querySelector('.vi-title');
  const bodyEl=modal.querySelector('.vi-body');
  const confirmBtn=modal.querySelector('.vi-confirm');
  const editBtn=modal.querySelector('.vi-edit');

  let title='',body='',confirmLabel='';

  switch(intent.intent){
    case'add_expense':
    case'add_income':{
      const type=intent.intent==='add_expense'?'Расход':'Доход';
      title='💰 '+type;
      body=`<b>${intent.amount?fmt(intent.amount):'?'}</b>`
        +(intent.category?` · ${intent.category}`:'')
        +(intent.wallet?` · ${intent.wallet}`:'')
        +(intent.note?`<br><span style="color:var(--text2);font-size:11px">${intent.note}</span>`:'');
      confirmLabel='Добавить операцию';
      break;
    }
    case'add_shopping':{
      title='🛒 Список покупок';
      body=(intent.items||[]).map(i=>`<b>${i.name}</b>${i.qty>1?' × '+i.qty:''}${i.price?' — '+fmt(i.price):''}`).join('<br>');
      confirmLabel='Добавить в список';
      break;
    }
    case'check_balance':{
      title='📊 Баланс';
      if(intent.wallet&&state.D){
        const w=state.D.wallets.find(w=>w.name.toLowerCase().includes((intent.wallet||'').toLowerCase()));
        body=w?`${w.name}: <b>${fmt(w.balance)}</b>`:'Кошелёк не найден';
      }else if(state.D){
        const total=state.D.wallets.reduce((s,w)=>s+w.balance,0);
        body=`Общий баланс: <b>${fmt(total)}</b>`;
      }
      confirmLabel='Понятно';
      break;
    }
    case'add_goal':{
      title='🎯 Новая цель';
      body=`<b>${intent.name}</b>${intent.target_amount?' — '+fmt(intent.target_amount):''}${intent.deadline?`<br>Срок: ${intent.deadline}`:''}`;
      confirmLabel='Создать цель';
      break;
    }
    case'add_category':{
      title='📂 Новая категория';
      body=`<b>${intent.name}</b> (${intent.type==='income'?'доход':'расход'})`;
      confirmLabel='Добавить категорию';
      break;
    }
    default:{
      title='🎤 Не распознано';
      body=`"${intent.raw_text||''}"<br><span style="color:var(--text2);font-size:11px">Уточните команду</span>`;
      confirmLabel='Попробовать снова';
      break;
    }
  }

  titleEl.textContent=title;
  bodyEl.innerHTML=body;
  confirmBtn.textContent=confirmLabel;
  confirmBtn.onclick=()=>{modal.classList.remove('open');onConfirm&&onConfirm(intent);};
  editBtn.onclick=()=>{modal.classList.remove('open');_openEditForIntent(intent);};
  modal.classList.add('open');
}

function _openEditForIntent(intent){
  switch(intent.intent){
    case'add_expense':
    case'add_income':{
      const modal=document.getElementById('modal');if(!modal)return;
      modal.classList.add('open');
      setTimeout(()=>{
        window.setOpType&&window.setOpType(intent.intent);
        const amtEl=document.getElementById('op-amount');if(amtEl&&intent.amount)amtEl.value=intent.amount;
        const noteEl=document.getElementById('op-note');if(noteEl&&intent.note)noteEl.value=intent.note;
        const catSel=document.getElementById('op-cat');
        if(catSel&&intent.category){
          for(let i=0;i<catSel.options.length;i++){
            if(catSel.options[i].value.toLowerCase().includes(intent.category.toLowerCase())){catSel.selectedIndex=i;break;}
          }
        }
      },100);
      break;
    }
    case'add_shopping':
      window.openAddShopItem&&window.openAddShopItem();
      break;
    default:
      document.getElementById('modal')?.classList.add('open');
  }
}

// ── Execute confirmed intent ────────────────────────────────────────
export function executeIntent(intent){
  if(!state.D)return;
  switch(intent.intent){
    case'add_expense':
    case'add_income':{
      const type=intent.intent==='add_expense'?'expense':'income';
      const w=state.D.wallets.find(w=>w.name.toLowerCase().includes((intent.wallet||'').toLowerCase()))
            ||state.D.wallets[0];
      const amount=intent.amount||0;
      if(!amount){_openEditForIntent(intent);return;}
      const cat=intent.category||'Прочее';
      const op={id:'op'+Date.now(),type,amount,date:today(),wallet:w?.id,category:cat,note:intent.note||''};
      if(w){if(type==='income')w.balance+=amount;else w.balance-=amount;}
      state.D.operations.push(op);
      sched();
      _showToast(`✓ ${type==='income'?'Доход':'Расход'} ${fmt(amount)} добавлен`);
      window._refreshCurrentScreen&&window._refreshCurrentScreen();
      break;
    }
    case'add_shopping':{
      if(!state.D.shoppingLists)state.D.shoppingLists={};
      const date=window._getCalActiveDate?window._getCalActiveDate():today();
      if(!state.D.shoppingLists[date])state.D.shoppingLists[date]=[];
      (intent.items||[]).forEach(item=>{
        state.D.shoppingLists[date].push({id:'sh'+Date.now()+Math.random(),name:item.name,qty:item.qty||1,price:item.price||0,done:false});
      });
      sched();
      const n=(intent.items||[]).length;
      _showToast(`✓ Добавлено ${n} позиц. в список покупок`);
      if(window.renderShoppingList)window.renderShoppingList();
      if(window._renderShopWidget)window._renderShopWidget();
      break;
    }
    case'check_balance':{
      // Already shown in confirmation
      break;
    }
    case'add_goal':{
      if(!state.D.goals)state.D.goals=[];
      const wallet=state.D.wallets.find(w=>w.name.toLowerCase().includes('сбереж'))||state.D.wallets[0];
      state.D.goals.push({id:'goal'+Date.now(),name:intent.name,target:intent.target_amount||0,walletId:wallet?.id,deadline:intent.deadline||null});
      sched();
      _showToast('✓ Цель «'+intent.name+'» создана');
      break;
    }
    case'add_category':{
      if(intent.type==='income'){
        if(!state.D.incomeCats.includes(intent.name))state.D.incomeCats.push(intent.name);
      }else{
        const planId=state.D.plan.find(p=>p.type==='expense')?.id||'';
        if(!state.D.expenseCats.find(c=>c.name===intent.name))state.D.expenseCats.push({name:intent.name,planId});
      }
      sched();
      _showToast('✓ Категория «'+intent.name+'» добавлена');
      break;
    }
    default:
      _openEditForIntent(intent);
  }
}

// ── Global Voice Button ────────────────────────────────────────────
// The big floating mic that does FULL flow: record → STT → GPT → confirm → execute
export function createSmartVoiceButton(){
  const btn=document.createElement('button');
  btn.id='smart-voice-btn';
  btn.title='Голосовая команда (нажмите и говорите)';
  btn.style.cssText=`
    position:fixed;bottom:24px;right:24px;
    width:52px;height:52px;border-radius:50%;
    background:var(--amber);border:none;color:#fff;
    font-size:22px;cursor:pointer;z-index:200;
    box-shadow:0 2px 8px rgba(0,0,0,.25);
    transition:background .2s,transform .15s;
    display:flex;align-items:center;justify-content:center;`;
  btn.textContent='🎤';
  btn.setAttribute('aria-label','Голосовой ввод');

  let active=false;
  btn.addEventListener('click',async()=>{
    if(!isVoiceConfigured()){
      alert('Голосовой ввод не настроен.\nПерейдите: Настройки → Голосовой ввод\nУкажите Прокси URL вашего Cloudflare Worker.');
      return;
    }
    if(active){
      stopRecording(isRec=>{
        if(!isRec){active=false;btn.textContent='🎤';btn.style.background='var(--amber)';}
      });
      return;
    }
    await startRecording(
      async text=>{
        active=false;btn.textContent='🎤';btn.style.background='var(--amber)';
        if(!text)return;
        _showToast('🔍 Распознано: «'+text+'»\nАнализирую команду...');
        const intent=await parseIntent(text);
        handleVoiceIntent(intent,executeIntent);
      },
      msg=>{active=false;btn.textContent='🎤';btn.style.background='var(--amber)';_showToast('⚠ '+msg);},
      isRec=>{
        active=isRec;
        if(isRec){btn.textContent='⏹';btn.style.background='#c0392b';btn.style.transform='scale(1.1)';}
        else{btn.textContent='🎤';btn.style.background='var(--amber)';btn.style.transform='scale(1)';}
      }
    );
  });
  return btn;
}

// Simple inline mic button for text inputs (just fills field with text)
export function createVoiceButton(targetInputId,extraStyle=''){
  const btn=document.createElement('button');
  btn.type='button';
  btn.title='Голосовой ввод';
  btn.style.cssText='background:var(--amber-light);border:1.5px solid var(--amber);border-radius:7px;padding:7px 9px;cursor:pointer;font-size:15px;flex-shrink:0;transition:background .15s;line-height:1;'+extraStyle;
  btn.textContent='🎤';
  let active=false;
  btn.onclick=async()=>{
    if(!isVoiceConfigured()){alert('Голосовой ввод не настроен. Настройки → Голосовой ввод.');return;}
    if(active){stopRecording(isRec=>{if(!isRec){active=false;btn.textContent='🎤';btn.style.background='var(--amber-light)';}});return;}
    await startRecording(
      text=>{active=false;btn.textContent='🎤';btn.style.background='var(--amber-light)';
        const el=document.getElementById(targetInputId);
        if(el){el.value=text;el.dispatchEvent(new Event('input',{bubbles:true}));}
      },
      msg=>{active=false;btn.textContent='🎤';btn.style.background='var(--amber-light)';_showToast('⚠ '+msg);},
      isRec=>{active=isRec;
        if(isRec){btn.textContent='⏹';btn.style.background='#fdd';}
        else{btn.textContent='🎤';btn.style.background='var(--amber-light)';}
      }
    );
  };
  return btn;
}

export function _showToast(msg){
  let t=document.getElementById('voice-toast');
  if(!t){
    t=document.createElement('div');
    t.id='voice-toast';
    t.style.cssText='position:fixed;bottom:88px;right:24px;background:var(--topbar);color:#C9A96E;padding:10px 16px;border-radius:8px;font-size:12px;font-weight:600;z-index:999;max-width:280px;word-break:break-word;opacity:0;transition:opacity .3s;pointer-events:none;line-height:1.5;';
    document.body.appendChild(t);
  }
  if(t._tm)clearTimeout(t._tm);
  t.textContent=msg;
  t.style.opacity='1';
  t._tm=setTimeout(()=>{t.style.opacity='0';},3500);
}
