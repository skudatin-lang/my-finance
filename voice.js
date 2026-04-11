// voice.js — Yandex SpeechKit STT (binary) + Yandex GPT intent parsing
// The Cloudflare Worker handles auth — users only need the Worker URL
import{state,sched,fmt,today}from'./core.js';

let _sttUrl='',_gptUrl='',_appSecret='',_userId='';
let _mediaRecorder=null,_audioChunks=[],_isRecording=false;

// ── Settings ─────────────────────────────────────────────────────
export function loadVoiceSettings(){
  if(!state.D)return;
  if(!state.D.voiceSettings)state.D.voiceSettings={proxyUrl:'',gptProxyUrl:'',appSecret:''};
  const vs=state.D.voiceSettings;
  _sttUrl=vs.proxyUrl||'';
  _gptUrl=vs.gptProxyUrl||vs.proxyUrl||'';
  _appSecret=vs.appSecret||'';
  _userId=state.CU?.uid||'anonymous';
}

export function saveVoiceSettings(sttUrl,gptUrl,appSecret){
  if(!state.D)return;
  state.D.voiceSettings={proxyUrl:sttUrl,gptProxyUrl:gptUrl||sttUrl,appSecret};
  loadVoiceSettings();
  sched();
}

export function isVoiceConfigured(){
  return!!(_sttUrl.trim());
}

export function isRecording(){return _isRecording;}

// ── Recording ────────────────────────────────────────────────────
export async function startRecording(onResult,onError,onStateChange){
  if(_isRecording)return;
  if(!isVoiceConfigured()){
    onError&&onError('Голосовой ввод не настроен. Настройки → Голосовой ввод → укажите URL воркера.');
    return;
  }
  try{
    const stream=await navigator.mediaDevices.getUserMedia({audio:{sampleRate:16000,channelCount:1,echoCancellation:true}});
    _audioChunks=[];
    // Prefer OGG/OPUS (Yandex STT supports it natively), fallback to WebM
    const mime=MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ?'audio/webm;codecs=opus'
      :'audio/webm';
    _mediaRecorder=new MediaRecorder(stream,{mimeType:mime});
    _mediaRecorder.ondataavailable=e=>{if(e.data&&e.data.size>0)_audioChunks.push(e.data);};
    _mediaRecorder.onstop=async()=>{
      stream.getTracks().forEach(t=>t.stop());
      onStateChange&&onStateChange(false);
      const text=await _sendSTT(mime);
      if(text)onResult&&onResult(text);
      else onError&&onError('Речь не распознана — попробуйте ещё раз');
    };
    _mediaRecorder.onerror=e=>{onError&&onError('Ошибка записи: '+e.error?.message);};
    _mediaRecorder.start(100);
    _isRecording=true;
    onStateChange&&onStateChange(true);
  }catch(e){
    onError&&onError(e.name==='NotAllowedError'?'Нет доступа к микрофону. Разрешите его в настройках браузера.':'Микрофон недоступен: '+e.message);
  }
}

export function stopRecording(){
  if(!_isRecording||!_mediaRecorder)return;
  _isRecording=false;
  try{_mediaRecorder.stop();}catch(e){}
}

// ── STT: send binary audio to worker /stt endpoint ────────────────
async function _sendSTT(mimeType){
  if(!_audioChunks.length)return null;
  const blob=new Blob(_audioChunks,{type:mimeType});
  // Yandex STT REST v1 expects raw binary audio
  // Format: webm-opus or ogg-opus, 16kHz mono
  const format=mimeType.includes('ogg')?'OGG_OPUS':'WEBM_OPUS';

  // Ensure URL ends without trailing slash
  const url=_sttUrl.replace(/\/?$/,'')+(_sttUrl.endsWith('/stt')?'':'/stt');

  const headers={
    'Content-Type':mimeType,
    'X-Audio-Format':format,
    'X-Sample-Rate':'48000',
  };
  if(_appSecret)headers['X-App-Secret']=_appSecret;
  if(_userId)headers['X-User-Id']=_userId;

  try{
    const resp=await fetch(url,{method:'POST',headers,body:blob});
    const data=await resp.json();
    if(!resp.ok){
      const msg=data.error_message||data.error||JSON.stringify(data).slice(0,120);
      _showToast('STT ошибка ('+resp.status+'): '+msg);
      return null;
    }
    // Yandex STT v1 returns: {"result": "recognized text"}
    return(data.result||'').trim()||null;
  }catch(e){
    _showToast('Ошибка соединения: '+e.message);
    return null;
  }
}

// ── GPT Intent Parsing ────────────────────────────────────────────
export async function parseIntent(spokenText){
  if(!state.D)return{intent:'unknown',raw_text:spokenText};

  const cats=[...state.D.incomeCats,...state.D.expenseCats.map(c=>c.name)].slice(0,20);
  const wallets=state.D.wallets.map(w=>w.name);

  const systemPrompt=`Ты ассистент по личным финансам. Пользователь надиктовал команду.
Определи намерение и верни ТОЛЬКО JSON (без markdown, без пояснений).

Возможные намерения:
- "add_expense": расход. Поля: amount(число), category, wallet, note
- "add_income": доход. Поля: amount(число), category, wallet, note
- "add_transfer": перевод. Поля: amount, from_wallet, to_wallet
- "add_shopping": список покупок. Поля: items([{name,qty,price}])
- "check_balance": баланс. Поля: wallet(опционально)
- "add_goal": цель. Поля: name, target_amount, deadline(YYYY-MM-DD, опц.)
- "add_category": категория. Поля: name, type("income"/"expense")
- "unknown": непонятно. Поля: raw_text

Категории: ${cats.join(', ')}
Кошельки: ${wallets.join(', ')}
Дата: ${today()}

Примеры:
"потратил 500 на продукты" → {"intent":"add_expense","amount":500,"category":"Продукты","wallet":"","note":""}
"купить молоко 2 штуки и хлеб" → {"intent":"add_shopping","items":[{"name":"молоко","qty":2,"price":0},{"name":"хлеб","qty":1,"price":0}]}
"пришла зарплата 50000" → {"intent":"add_income","amount":50000,"category":"Зарплата","wallet":"","note":""}`;

  const gptUrl=(_gptUrl||_sttUrl).replace(/\/?$/,'');
  const endpoint=gptUrl.endsWith('/gpt')?gptUrl:gptUrl+'/gpt';

  const headers={'Content-Type':'application/json'};
  if(_appSecret)headers['X-App-Secret']=_appSecret;
  if(_userId)headers['X-User-Id']=_userId;

  const body={
    completionOptions:{stream:false,temperature:0.1,maxTokens:400},
    messages:[
      {role:'system',text:systemPrompt},
      {role:'user',text:spokenText}
    ]
  };

  try{
    const resp=await fetch(endpoint,{method:'POST',headers,body:JSON.stringify(body)});
    if(!resp.ok){
      console.warn('GPT parse failed:',resp.status);
      return _fallbackParse(spokenText);
    }
    const data=await resp.json();
    const text=data.result?.alternatives?.[0]?.message?.text||'';
    const clean=text.replace(/```json|```|\n/g,'').trim();
    if(!clean)return _fallbackParse(spokenText);
    return JSON.parse(clean);
  }catch(e){
    console.warn('GPT parse error:',e.message);
    return _fallbackParse(spokenText);
  }
}

function _fallbackParse(text){
  const t=text.toLowerCase();
  const amtMatch=text.match(/\b(\d[\d\s]*)\b/);
  const amount=amtMatch?parseFloat(amtMatch[1].replace(/\s/g,'')):0;
  if(t.match(/купи|список|магазин|продукт/))return{intent:'add_shopping',items:[{name:text.replace(/\d+/g,'').trim()||text,qty:1,price:0}]};
  if(t.match(/трат|расход|купил|заплатил|потратил/))return{intent:'add_expense',amount,category:'Прочее',note:text};
  if(t.match(/доход|зарплат|получил|пришл/))return{intent:'add_income',amount,category:'Прочее',note:text};
  if(t.match(/перевод|перевел/))return{intent:'add_transfer',amount,from_wallet:'',to_wallet:''};
  return{intent:'unknown',raw_text:text};
}

// ── Intent Handler (shows confirmation modal) ────────────────────
export function handleVoiceIntent(intent,onConfirm){
  const modal=document.getElementById('modal-voice-intent');
  if(!modal){onConfirm&&onConfirm(intent);return;}
  const titleEl=modal.querySelector('.vi-title');
  const bodyEl=modal.querySelector('.vi-body');
  const confirmBtn=modal.querySelector('.vi-confirm');
  const editBtn=modal.querySelector('.vi-edit');

  const emojis={add_expense:'💸',add_income:'💰',add_shopping:'🛒',add_transfer:'🔄',check_balance:'📊',add_goal:'🎯',add_category:'📂',unknown:'🤔'};
  const titles={add_expense:'Расход',add_income:'Доход',add_shopping:'Список покупок',add_transfer:'Перевод',check_balance:'Проверка баланса',add_goal:'Новая цель',add_category:'Новая категория',unknown:'Не распознано'};

  titleEl.textContent=(emojis[intent.intent]||'🎤')+' '+(titles[intent.intent]||'Команда');

  let body='';
  switch(intent.intent){
    case'add_expense':case'add_income':
      body=`<b>${intent.amount?fmt(intent.amount):'(сумма?)'}</b>`
        +(intent.category?` · ${intent.category}`:'')
        +(intent.wallet?` · ${intent.wallet}`:'')
        +(intent.note?`<br><span style="color:var(--text2);font-size:11px">${intent.note}</span>`:'');
      break;
    case'add_shopping':
      body=(intent.items||[]).map(i=>`• <b>${i.name}</b>${i.qty>1?' × '+i.qty:''}${i.price?' — '+fmt(i.price):''}`).join('<br>')||'(нет позиций)';
      break;
    case'add_transfer':
      body=`<b>${intent.amount?fmt(intent.amount):'?'}</b>${intent.from_wallet?' из '+intent.from_wallet:''}${intent.to_wallet?' → '+intent.to_wallet:''}`;
      break;
    case'check_balance':
      if(state.D){
        if(intent.wallet){
          const w=state.D.wallets.find(w=>w.name.toLowerCase().includes((intent.wallet||'').toLowerCase()));
          body=w?`${w.name}: <b>${fmt(w.balance)}</b>`:'Кошелёк не найден';
        }else{
          const total=state.D.wallets.reduce((s,w)=>s+w.balance,0);
          body=`Общий баланс: <b>${fmt(total)}</b><br>`
            +state.D.wallets.map(w=>`${w.name}: ${fmt(w.balance)}`).join('<br>');
        }
      }
      break;
    case'add_goal':
      body=`<b>${intent.name||'?'}</b>${intent.target_amount?' — '+fmt(intent.target_amount):''}${intent.deadline?`<br>Срок: ${intent.deadline}`:''}`;
      break;
    case'add_category':
      body=`<b>${intent.name||'?'}</b> (${intent.type==='income'?'доход':'расход'})`;
      break;
    default:
      body=`"${intent.raw_text||text}"<br><span style="color:var(--text2);font-size:11px">Попробуйте переформулировать</span>`;
  }
  bodyEl.innerHTML=body;

  const labels={add_expense:'Добавить расход',add_income:'Добавить доход',add_shopping:'Добавить в список',add_transfer:'Выполнить перевод',check_balance:'Понятно',add_goal:'Создать цель',add_category:'Добавить категорию',unknown:'Ввести вручную'};
  confirmBtn.textContent=labels[intent.intent]||'Подтвердить';
  confirmBtn.onclick=()=>{modal.classList.remove('open');onConfirm&&onConfirm(intent);};
  editBtn.onclick=()=>{modal.classList.remove('open');_openEdit(intent);};
  modal.classList.add('open');
}

function _openEdit(intent){
  switch(intent.intent){
    case'add_expense':case'add_income':{
      const m=document.getElementById('modal');if(!m)return;
      m.classList.add('open');
      setTimeout(()=>{
        window.setOpType&&window.setOpType(intent.intent);
        const a=document.getElementById('op-amount');if(a&&intent.amount)a.value=intent.amount;
        const n=document.getElementById('op-note');if(n&&intent.note)n.value=intent.note;
        const cs=document.getElementById('op-cat');
        if(cs&&intent.category)for(let i=0;i<cs.options.length;i++)if(cs.options[i].value.includes(intent.category)){cs.selectedIndex=i;break;}
      },100);break;
    }
    case'add_shopping':window.openAddShopItem&&window.openAddShopItem();break;
    default:document.getElementById('modal')?.classList.add('open');
  }
}

// ── Execute confirmed intent ──────────────────────────────────────
export function executeIntent(intent){
  if(!state.D)return;
  switch(intent.intent){
    case'add_expense':case'add_income':{
      const type=intent.intent==='add_expense'?'expense':'income';
      if(!intent.amount){_openEdit(intent);return;}
      const w=state.D.wallets.find(w=>w.name.toLowerCase().includes((intent.wallet||'').toLowerCase()))||state.D.wallets[0];
      const op={id:'op'+Date.now(),type,amount:intent.amount,date:today(),wallet:w?.id,category:intent.category||'Прочее',note:intent.note||''};
      if(w){if(type==='income')w.balance+=intent.amount;else w.balance-=intent.amount;}
      state.D.operations.push(op);sched();
      _showToast(`✓ ${type==='income'?'Доход':'Расход'} ${fmt(intent.amount)} добавлен`);
      window._refreshCurrentScreen&&window._refreshCurrentScreen();break;
    }
    case'add_shopping':{
      if(!state.D.shoppingLists)state.D.shoppingLists={};
      const date=state.calDay||today();
      if(!state.D.shoppingLists[date])state.D.shoppingLists[date]=[];
      (intent.items||[]).forEach(item=>{
        state.D.shoppingLists[date].push({id:'sh'+Date.now()+Math.random(),name:item.name,qty:item.qty||1,price:item.price||0,done:false});
      });
      sched();
      _showToast(`✓ ${(intent.items||[]).length} позиций добавлено в список`);
      window.renderShoppingList&&window.renderShoppingList();
      window._renderShopWidget&&window._renderShopWidget();break;
    }
    case'add_transfer':{
      if(!intent.amount){_openEdit(intent);return;}
      const wf=state.D.wallets.find(w=>w.name.toLowerCase().includes((intent.from_wallet||'').toLowerCase()))||state.D.wallets[0];
      const wt=state.D.wallets.find(w=>w.name.toLowerCase().includes((intent.to_wallet||'').toLowerCase()))||state.D.wallets[1]||state.D.wallets[0];
      const op={id:'op'+Date.now(),type:'transfer',amount:intent.amount,date:today(),wallet:wf?.id,walletTo:wt?.id};
      if(wf)wf.balance-=intent.amount;if(wt&&wt!==wf)wt.balance+=intent.amount;
      state.D.operations.push(op);sched();
      _showToast(`✓ Перевод ${fmt(intent.amount)} выполнен`);
      window._refreshCurrentScreen&&window._refreshCurrentScreen();break;
    }
    case'add_goal':{
      if(!intent.name){_openEdit(intent);return;}
      if(!state.D.goals)state.D.goals=[];
      const w=state.D.wallets.find(w=>w.name.toLowerCase().includes('сбереж'))||state.D.wallets[0];
      state.D.goals.push({id:'goal'+Date.now(),name:intent.name,target:intent.target_amount||0,walletId:w?.id,deadline:intent.deadline||null});
      sched();_showToast('✓ Цель «'+intent.name+'» создана');break;
    }
    case'add_category':{
      if(intent.type==='income'){
        if(!state.D.incomeCats.includes(intent.name))state.D.incomeCats.push(intent.name);
      }else{
        const pid=state.D.plan.find(p=>p.type==='expense')?.id||'';
        if(!state.D.expenseCats.find(c=>c.name===intent.name))state.D.expenseCats.push({name:intent.name,planId:pid});
      }
      sched();_showToast('✓ Категория «'+intent.name+'» добавлена');break;
    }
    case'check_balance':break; // shown in modal
    default:_openEdit(intent);
  }
}

// ── Smart floating voice button ───────────────────────────────────
export function createSmartVoiceButton(){
  const btn=document.createElement('button');
  btn.id='smart-voice-btn';
  btn.title='Голосовая команда';
  btn.setAttribute('aria-label','Голосовой ввод');
  btn.textContent='🎤';
  let active=false;

  btn.onclick=async()=>{
    if(!isVoiceConfigured()){
      alert('Голосовой ввод не настроен.\n\nПерейдите: Настройки → Голосовой ввод\nВведите URL вашего Cloudflare Worker.');
      return;
    }
    if(active){stopRecording();return;}

    await startRecording(
      async text=>{
        active=false;btn.textContent='🎤';btn.style.background='var(--amber)';btn.style.transform='scale(1)';
        _showToast('🔍 «'+text+'» — анализирую...');
        const intent=await parseIntent(text);
        handleVoiceIntent(intent,executeIntent);
      },
      msg=>{active=false;btn.textContent='🎤';btn.style.background='var(--amber)';btn.style.transform='scale(1)';_showToast('⚠ '+msg);},
      isRec=>{
        active=isRec;
        if(isRec){btn.textContent='⏹';btn.style.background='#c0392b';btn.style.transform='scale(1.12)';}
        else{btn.textContent='⏳';} // waiting for STT
      }
    );
  };
  return btn;
}

// ── Simple inline mic for text inputs ────────────────────────────
export function createVoiceButton(targetInputId,extraStyle=''){
  const btn=document.createElement('button');
  btn.type='button';btn.title='Голосовой ввод';
  btn.style.cssText='background:var(--amber-light);border:1.5px solid var(--amber);border-radius:7px;padding:7px 9px;cursor:pointer;font-size:15px;flex-shrink:0;line-height:1;'+extraStyle;
  btn.textContent='🎤';
  let active=false;
  btn.onclick=async()=>{
    if(!isVoiceConfigured()){alert('Настройки → Голосовой ввод → укажите URL воркера');return;}
    if(active){stopRecording();return;}
    await startRecording(
      text=>{active=false;btn.textContent='🎤';btn.style.background='var(--amber-light)';
        const el=document.getElementById(targetInputId);
        if(el){el.value=text;el.dispatchEvent(new Event('input',{bubbles:true}));}},
      msg=>{active=false;btn.textContent='🎤';btn.style.background='var(--amber-light)';_showToast('⚠ '+msg);},
      isRec=>{active=isRec;btn.textContent=isRec?'⏹':'⏳';btn.style.background=isRec?'#fdd':'var(--amber-light)';}
    );
  };
  return btn;
}

export function _showToast(msg){
  let t=document.getElementById('voice-toast');
  if(!t){
    t=document.createElement('div');t.id='voice-toast';
    t.style.cssText='position:fixed;bottom:88px;right:24px;background:var(--topbar);color:#C9A96E;padding:10px 16px;border-radius:8px;font-size:12px;font-weight:600;z-index:999;max-width:290px;word-break:break-word;opacity:0;transition:opacity .3s;pointer-events:none;line-height:1.5;';
    document.body.appendChild(t);
  }
  if(t._tm)clearTimeout(t._tm);
  t.textContent=msg;t.style.opacity='1';
  t._tm=setTimeout(()=>{t.style.opacity='0';},3500);
}
