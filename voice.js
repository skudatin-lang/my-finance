/**
 * voice.js — Yandex SpeechKit STT + GPT intent parsing
 *
 * Цепочка:
 * 1. Нажать 🎤 → запись аудио
 * 2. Аудио → конвертация в PCM 16-bit 16kHz
 * 3. PCM → Яндекс STT → текст
 * 4. Текст → YandexGPT → разбор намерения (intent)
 * 5. Intent → модалка подтверждения (показывает что распознано)
 * 6. Подтверждение → executeIntent → добавляет операцию/покупку/цель
 */
import{state,sched,fmt,today}from'./core.js';

let _sttUrl='',_gptUrl='',_appSecret='',_userId='';
let _mediaRecorder=null,_audioChunks=[],_isRecording=false;

const PCM_RATE = 16000; // Hz — Яндекс STT lpcm

// ── Настройки ─────────────────────────────────────────────────────────────
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
  loadVoiceSettings();sched();
}
export function isVoiceConfigured(){return!!(_sttUrl.trim());}
export function isRecording(){return _isRecording;}

// ── Конвертация аудио → PCM 16-bit 16kHz mono ────────────────────────────
// Работает с любым форматом браузера: webm, mp4, ogg
async function _toPCM(blob){
  const ab=await blob.arrayBuffer();
  const Ctx=window.AudioContext||window.webkitAudioContext;
  if(!Ctx)throw new Error('AudioContext не поддерживается');
  const ctx=new Ctx({sampleRate:PCM_RATE});
  let dec;
  try{dec=await ctx.decodeAudioData(ab);}
  catch(e){await ctx.close();throw new Error('Ошибка декодирования аудио: '+e.message);}
  await ctx.close();
  let s=dec.getChannelData(0);
  if(dec.sampleRate!==PCM_RATE){
    const r=dec.sampleRate/PCM_RATE,nl=Math.ceil(s.length/r),rs=new Float32Array(nl);
    for(let i=0;i<nl;i++)rs[i]=s[Math.min(Math.floor(i*r),s.length-1)];
    s=rs;
  }
  const p=new Int16Array(s.length);
  for(let i=0;i<s.length;i++){const c=Math.max(-1,Math.min(1,s[i]));p[i]=c<0?c*0x8000:c*0x7FFF;}
  return p.buffer;
}

// ── Выбор mime для записи ─────────────────────────────────────────────────
function _pickMime(){
  const c=['audio/webm;codecs=opus','audio/ogg;codecs=opus','audio/webm','audio/mp4;codecs=mp4a.40.2','audio/mp4'];
  for(const f of c)if(MediaRecorder.isTypeSupported(f))return f;
  return null;
}

// ── Запись ────────────────────────────────────────────────────────────────
export async function startRecording(onResult,onError,onStateChange){
  if(_isRecording)return;
  if(!isVoiceConfigured()){
    onError&&onError('Голосовой ввод не настроен.\nПерейдите: Администратор → введите URL воркера.');
    return;
  }
  const mime=_pickMime();
  if(!mime){onError&&onError('Браузер не поддерживает запись. Используйте Chrome/Firefox/Safari 14.1+.');return;}
  let stream;
  try{
    stream=await navigator.mediaDevices.getUserMedia({
      audio:{channelCount:1,echoCancellation:true,noiseSuppression:true,autoGainControl:true}
    });
  }catch(e){
    onError&&onError(e.name==='NotAllowedError'
      ?'Нет доступа к микрофону.\nРазрешите в настройках браузера.'
      :'Микрофон недоступен: '+e.message);
    return;
  }
  _audioChunks=[];
  let rec;
  try{rec=new MediaRecorder(stream,{mimeType:mime});}
  catch(e){stream.getTracks().forEach(t=>t.stop());onError&&onError('Ошибка записи: '+e.message);return;}
  _mediaRecorder=rec;_isRecording=true;
  onStateChange&&onStateChange(true);
  rec.ondataavailable=e=>{if(e.data&&e.data.size>0)_audioChunks.push(e.data);};
  rec.onstop=async()=>{
    stream.getTracks().forEach(t=>t.stop());
    onStateChange&&onStateChange(false);
    if(!_audioChunks.length){onError&&onError('Нет аудио. Попробуйте ещё раз.');return;}
    try{
      _showToast('⏳ Обработка...');
      const raw=new Blob(_audioChunks,{type:mime});
      const pcm=await _toPCM(raw);
      const text=await _sendPCM(pcm);
      if(text)onResult&&onResult(text);
      else onError&&onError('Речь не распознана. Говорите чётче.');
    }catch(e){onError&&onError('Ошибка: '+e.message);}
  };
  rec.onerror=e=>{
    stream.getTracks().forEach(t=>t.stop());
    _isRecording=false;onStateChange&&onStateChange(false);
    onError&&onError('Ошибка записи: '+(e.error?.message||'неизвестная'));
  };
  rec.start(250);
}
export function stopRecording(){
  if(!_isRecording||!_mediaRecorder)return;
  _isRecording=false;
  try{_mediaRecorder.stop();}catch(_){}
}

// ── Отправка PCM на воркер /stt ───────────────────────────────────────────
async function _sendPCM(pcmBuf){
  if(!pcmBuf||pcmBuf.byteLength<500)return null;
  const base=_sttUrl.replace(/\/?$/,'');
  const url=base.endsWith('/stt')?base:base+'/stt';
  const h={'Content-Type':'audio/x-pcm','X-Audio-Format':'LPCM','X-Sample-Rate':String(PCM_RATE)};
  if(_appSecret)h['X-App-Secret']=_appSecret;
  if(_userId)h['X-User-Id']=_userId;
  try{
    const resp=await fetch(url,{method:'POST',headers:h,body:pcmBuf});
    const data=await resp.json();
    if(!resp.ok){
      const msg=data.error_message||data.error||JSON.stringify(data).slice(0,100);
      if(resp.status===401)_showToast('⚠ Ошибка авторизации. Проверьте YANDEX_API_KEY.');
      else if(resp.status===402)_showToast('⚠ Нет средств на балансе Яндекс Cloud.');
      else _showToast('STT ошибка ('+resp.status+'): '+msg);
      return null;
    }
    return(data.result||'').trim()||null;
  }catch(e){_showToast('Нет связи с воркером: '+e.message);return null;}
}

// ── GPT: разбор намерения ─────────────────────────────────────────────────
export async function parseIntent(spokenText){
  if(!state.D)return{intent:'unknown',raw_text:spokenText};
  const cats=[...state.D.incomeCats,...state.D.expenseCats.map(c=>c.name)].slice(0,20);
  const wallets=state.D.wallets.map(w=>w.name);

  const sys=`Ты ассистент по личным финансам. Пользователь надиктовал команду голосом.
Определи намерение и верни ТОЛЬКО JSON (без markdown, без пояснений).

Намерения:
- "add_expense": трата/расход. Поля: amount(число), category(из списка), wallet(из списка), note
- "add_income": доход/поступление. Поля: amount(число), category(из списка), wallet(из списка), note
- "add_transfer": перевод между кошельками. Поля: amount, from_wallet, to_wallet
- "add_shopping": список покупок/нужно купить. Поля: items([{name,qty,price}])
- "check_balance": узнать баланс. Поля: wallet(опц.)
- "add_goal": финансовая цель. Поля: name, target_amount, deadline(YYYY-MM-DD, опц.)
- "add_category": новая категория. Поля: name, type("income"/"expense")
- "unknown": непонятно. Поля: raw_text

Категории расходов/доходов: ${cats.join(', ')||'Продукты, Транспорт, Кафе, Зарплата'}
Кошельки: ${wallets.join(', ')||'Наличные, Карта'}
Сегодня: ${today()}

Примеры:
"потратил 500 рублей на продукты" → {"intent":"add_expense","amount":500,"category":"Продукты","wallet":"","note":""}
"купить молоко 2 штуки и хлеб" → {"intent":"add_shopping","items":[{"name":"молоко","qty":2,"price":0},{"name":"хлеб","qty":1,"price":0}]}
"пришла зарплата 80000" → {"intent":"add_income","amount":80000,"category":"Зарплата","wallet":"","note":""}
"заправил машину на 3000" → {"intent":"add_expense","amount":3000,"category":"Транспорт","wallet":"","note":"заправка"}
"переведи 5000 с карты на наличные" → {"intent":"add_transfer","amount":5000,"from_wallet":"Карта","to_wallet":"Наличные"}`;

  const base=(_gptUrl||_sttUrl).replace(/\/?$/,'');
  const ep=base.endsWith('/gpt')?base:base+'/gpt';
  const h={'Content-Type':'application/json'};
  if(_appSecret)h['X-App-Secret']=_appSecret;
  if(_userId)h['X-User-Id']=_userId;

  try{
    const resp=await fetch(ep,{method:'POST',headers:h,body:JSON.stringify({
      completionOptions:{stream:false,temperature:0.1,maxTokens:400},
      messages:[{role:'system',text:sys},{role:'user',text:spokenText}]
    })});
    if(!resp.ok){
      console.warn('[GPT] failed:',resp.status);
      return _fallback(spokenText);
    }
    const d=await resp.json();
    const t=(d.result?.alternatives?.[0]?.message?.text||'').replace(/```json|```|\n/g,'').trim();
    if(!t)return _fallback(spokenText);
    try{return JSON.parse(t);}
    catch(_){return _fallback(spokenText);}
  }catch(e){
    console.warn('[GPT]',e.message);
    return _fallback(spokenText);
  }
}

function _fallback(text){
  const t=text.toLowerCase();
  const m=text.match(/\b(\d[\d\s]*)\b/);
  const amount=m?parseFloat(m[1].replace(/\s/g,'')):0;
  if(t.match(/купи|список|магазин|нужно/))return{intent:'add_shopping',items:[{name:text.replace(/\d+/g,'').trim()||text,qty:1,price:0}]};
  if(t.match(/трат|расход|купил|заплатил|потратил/))return{intent:'add_expense',amount,category:'Прочее',note:text};
  if(t.match(/доход|зарплат|получил|пришл/))return{intent:'add_income',amount,category:'Прочее',note:text};
  if(t.match(/перевод|перевел|переведи/))return{intent:'add_transfer',amount,from_wallet:'',to_wallet:''};
  return{intent:'unknown',raw_text:text};
}

// ── Модалка подтверждения ─────────────────────────────────────────────────
export function handleVoiceIntent(intent,onConfirm){
  const modal=document.getElementById('modal-voice-intent');
  if(!modal){
    // Если модалки нет — выполняем сразу без подтверждения
    console.warn('modal-voice-intent not found, executing directly');
    onConfirm&&onConfirm(intent);
    return;
  }
  const titleEl=modal.querySelector('.vi-title');
  const bodyEl=modal.querySelector('.vi-body');
  const confirmBtn=modal.querySelector('.vi-confirm');
  const editBtn=modal.querySelector('.vi-edit');

  const E={add_expense:'💸',add_income:'💰',add_shopping:'🛒',add_transfer:'🔄',check_balance:'📊',add_goal:'🎯',add_category:'📂',unknown:'🤔'};
  const T={add_expense:'Расход',add_income:'Доход',add_shopping:'Список покупок',add_transfer:'Перевод',check_balance:'Баланс',add_goal:'Новая цель',add_category:'Категория',unknown:'Не распознано'};
  titleEl.textContent=(E[intent.intent]||'🎤')+' '+(T[intent.intent]||'Команда');

  let body='';
  switch(intent.intent){
    case'add_expense':case'add_income':
      body=`<b>${intent.amount?fmt(intent.amount):'(сумма не указана)'}</b>`
        +(intent.category?` · ${intent.category}`:'')
        +(intent.wallet?` · ${intent.wallet}`:'')
        +(intent.note?`<br><span style="color:var(--text2);font-size:11px">${intent.note}</span>`:'');
      break;
    case'add_shopping':
      body=(intent.items||[]).map(i=>`• <b>${i.name}</b>${i.qty>1?' × '+i.qty:''}${i.price?' — '+fmt(i.price):''}`).join('<br>')||'(нет позиций)';
      break;
    case'add_transfer':
      body=`<b>${intent.amount?fmt(intent.amount):'?'}</b>${intent.from_wallet?' из «'+intent.from_wallet+'»':''}${intent.to_wallet?' → «'+intent.to_wallet+'»':''}`;
      break;
    case'check_balance':
      if(state.D){
        const w=intent.wallet?state.D.wallets.find(w=>w.name.toLowerCase().includes(intent.wallet.toLowerCase())):null;
        body=w?`${w.name}: <b>${fmt(w.balance)}</b>`:`Общий баланс: <b>${fmt(state.D.wallets.reduce((s,w)=>s+w.balance,0))}</b><br>`+state.D.wallets.map(w=>`${w.name}: ${fmt(w.balance)}`).join('<br>');
      }
      break;
    case'add_goal':
      body=`<b>${intent.name||'?'}</b>${intent.target_amount?' — '+fmt(intent.target_amount):''}${intent.deadline?`<br>Срок: ${intent.deadline}`:''}`;
      break;
    case'add_category':
      body=`<b>${intent.name||'?'}</b> (${intent.type==='income'?'доход':'расход'})`;
      break;
    default:
      body=`"${intent.raw_text||''}"<br><span style="color:var(--text2);font-size:11px">Попробуйте переформулировать или введите вручную</span>`;
  }
  bodyEl.innerHTML=body;

  const L={
    add_expense:'✅ Добавить расход',
    add_income:'✅ Добавить доход',
    add_shopping:'✅ Добавить в список',
    add_transfer:'✅ Выполнить перевод',
    check_balance:'Понятно',
    add_goal:'✅ Создать цель',
    add_category:'✅ Добавить категорию',
    unknown:'Ввести вручную',
  };
  confirmBtn.textContent=L[intent.intent]||'Подтвердить';
  confirmBtn.onclick=()=>{modal.classList.remove('open');onConfirm&&onConfirm(intent);};
  editBtn.onclick=()=>{modal.classList.remove('open');_openManual(intent);};
  modal.classList.add('open');
}

// ── Ручное редактирование ─────────────────────────────────────────────────
function _openManual(intent){
  switch(intent.intent){
    case'add_expense':case'add_income':{
      const m=document.getElementById('modal');if(!m)return;
      m.classList.add('open');
      setTimeout(()=>{
        window.setOpType&&window.setOpType(intent.intent==='add_expense'?'expense':'income');
        const a=document.getElementById('op-amount');if(a&&intent.amount)a.value=intent.amount;
        const n=document.getElementById('op-note');if(n&&intent.note)n.value=intent.note;
        const cs=document.getElementById('op-cat');
        if(cs&&intent.category){
          for(let i=0;i<cs.options.length;i++){
            if(cs.options[i].value.toLowerCase().includes(intent.category.toLowerCase())){cs.selectedIndex=i;break;}
          }
        }
      },100);
      break;
    }
    case'add_shopping':window.openAddShopItem&&window.openAddShopItem();break;
    default:document.getElementById('modal')?.classList.add('open');
  }
}

// ── Выполнение подтверждённого намерения ──────────────────────────────────
export function executeIntent(intent){
  if(!state.D)return;
  const activeDate=window._getCalActiveDate?window._getCalActiveDate():today();

  switch(intent.intent){
    case'add_expense':case'add_income':{
      const type=intent.intent==='add_expense'?'expense':'income';
      if(!intent.amount){_openManual(intent);return;}
      const w=state.D.wallets.find(w=>w.name.toLowerCase().includes((intent.wallet||'').toLowerCase()))||state.D.wallets[0];
      const op={
        id:'op'+Date.now()+'_'+Math.random().toString(36).slice(2,6),
        type,amount:intent.amount,date:today(),
        wallet:w?.id,category:intent.category||'Прочее',note:intent.note||'',
      };
      if(w){if(type==='income')w.balance+=intent.amount;else w.balance-=intent.amount;}
      state.D.operations.push(op);sched();
      _showToast(`✓ ${type==='income'?'Доход':'Расход'} ${fmt(intent.amount)} добавлен`);
      window._refreshCurrentScreen&&window._refreshCurrentScreen();
      break;
    }
    case'add_shopping':{
      if(!state.D.shoppingLists)state.D.shoppingLists={};
      if(!state.D.shoppingLists[activeDate])state.D.shoppingLists[activeDate]=[];
      (intent.items||[]).forEach(item=>{
        state.D.shoppingLists[activeDate].push({id:'sh'+Date.now()+Math.random(),name:item.name,qty:item.qty||1,price:item.price||0,done:false});
      });
      sched();
      _showToast(`✓ ${(intent.items||[]).length} позиций добавлено в список`);
      window.renderShoppingList&&window.renderShoppingList();
      window._renderShopWidget&&window._renderShopWidget();
      break;
    }
    case'add_transfer':{
      if(!intent.amount){_openManual(intent);return;}
      const wf=state.D.wallets.find(w=>w.name.toLowerCase().includes((intent.from_wallet||'').toLowerCase()))||state.D.wallets[0];
      const wt=state.D.wallets.find(w=>w.name.toLowerCase().includes((intent.to_wallet||'').toLowerCase()))||state.D.wallets[1]||state.D.wallets[0];
      const op={id:'op'+Date.now()+'_'+Math.random().toString(36).slice(2,6),type:'transfer',amount:intent.amount,date:today(),wallet:wf?.id,walletTo:wt?.id};
      if(wf)wf.balance-=intent.amount;
      if(wt&&wt!==wf)wt.balance+=intent.amount;
      state.D.operations.push(op);sched();
      _showToast(`✓ Перевод ${fmt(intent.amount)} выполнен`);
      window._refreshCurrentScreen&&window._refreshCurrentScreen();
      break;
    }
    case'add_goal':{
      if(!intent.name){_openManual(intent);return;}
      if(!state.D.goals)state.D.goals=[];
      const w=state.D.wallets.find(w=>w.name.toLowerCase().includes('сбереж'))||state.D.wallets[0];
      state.D.goals.push({id:'goal'+Date.now(),name:intent.name,target:intent.target_amount||0,walletId:w?.id,deadline:intent.deadline||null});
      sched();_showToast('✓ Цель «'+intent.name+'» создана');
      break;
    }
    case'add_category':{
      if(!intent.name){return;}
      if(intent.type==='income'){
        if(!state.D.incomeCats.includes(intent.name))state.D.incomeCats.push(intent.name);
      }else{
        const pid=state.D.plan.find(p=>p.type==='expense')?.id||'';
        if(!state.D.expenseCats.find(c=>c.name===intent.name))state.D.expenseCats.push({name:intent.name,planId:pid});
      }
      sched();_showToast('✓ Категория «'+intent.name+'» добавлена');
      break;
    }
    case'check_balance':
      // Уже показано в модалке — ничего не делаем
      break;
    default:
      _openManual(intent);
  }
}

// ── Плавающая кнопка 🎤 ──────────────────────────────────────────────────
export function createSmartVoiceButton(){
  if(!document.getElementById('_vsb_css')){
    const s=document.createElement('style');s.id='_vsb_css';
    s.textContent=`#smart-voice-btn{position:fixed;bottom:80px;right:20px;z-index:200;width:52px;height:52px;border-radius:50%;background:var(--amber);border:none;box-shadow:0 4px 16px rgba(0,0,0,.3);font-size:22px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background .2s,transform .15s;-webkit-tap-highlight-color:transparent;}#smart-voice-btn:active{transform:scale(.93);}@media(min-width:700px){#smart-voice-btn{bottom:28px;right:28px;}}`;
    document.head.appendChild(s);
  }
  const btn=document.createElement('button');
  btn.id='smart-voice-btn';btn.title='Голосовая команда';
  btn.setAttribute('aria-label','Голосовой ввод');btn.textContent='🎤';
  let active=false;

  btn.onclick=async()=>{
    if(!isVoiceConfigured()){
      alert('Голосовой ввод не настроен.\n\nПерейдите: Администратор → введите URL воркера → Сохранить.');
      return;
    }
    if(active){stopRecording();return;}

    await startRecording(
      async text=>{
        active=false;btn.textContent='🎤';btn.style.background='';btn.style.transform='';
        _showToast('🔍 Анализирую: «'+text+'»...');
        // GPT разбирает намерение
        const intent=await parseIntent(text);
        // Показываем модалку подтверждения
        handleVoiceIntent(intent,executeIntent);
      },
      msg=>{
        active=false;btn.textContent='🎤';btn.style.background='';btn.style.transform='';
        _showToast('⚠ '+msg);
      },
      isRec=>{
        active=isRec;
        if(isRec){btn.textContent='⏹';btn.style.background='#c0392b';btn.style.transform='scale(1.12)';}
        else{btn.textContent='⏳';btn.style.background='var(--amber)';btn.style.transform='';}
      }
    );
  };
  return btn;
}

// ── Инлайн кнопка 🎤 ─────────────────────────────────────────────────────
export function createVoiceButton(targetInputId,extraStyle=''){
  const btn=document.createElement('button');
  btn.type='button';btn.title='Голосовой ввод';
  btn.style.cssText='background:var(--amber-light);border:1.5px solid var(--amber);border-radius:7px;padding:7px 9px;cursor:pointer;font-size:15px;flex-shrink:0;line-height:1;'+extraStyle;
  btn.textContent='🎤';
  let active=false;
  btn.onclick=async()=>{
    if(!isVoiceConfigured()){alert('Голосовой ввод не настроен.\nПерейдите в Администратор → введите URL воркера.');return;}
    if(active){stopRecording();return;}
    await startRecording(
      text=>{
        active=false;btn.textContent='🎤';btn.style.background='var(--amber-light)';
        const el=document.getElementById(targetInputId);
        if(el){el.value=text;el.dispatchEvent(new Event('input',{bubbles:true}));el.focus();}
      },
      msg=>{active=false;btn.textContent='🎤';btn.style.background='var(--amber-light)';_showToast('⚠ '+msg);},
      isRec=>{active=isRec;btn.textContent=isRec?'⏹':'⏳';btn.style.background=isRec?'#fdd':'var(--amber-light)';}
    );
  };
  return btn;
}

// ── Toast ─────────────────────────────────────────────────────────────────
export function _showToast(msg){
  let t=document.getElementById('voice-toast');
  if(!t){
    t=document.createElement('div');t.id='voice-toast';
    t.style.cssText='position:fixed;bottom:88px;right:24px;background:var(--topbar);color:#C9A96E;padding:10px 16px;border-radius:8px;font-size:12px;font-weight:600;z-index:999;max-width:290px;word-break:break-word;opacity:0;transition:opacity .3s;pointer-events:none;line-height:1.5;';
    document.body.appendChild(t);
  }
  if(t._tm)clearTimeout(t._tm);
  t.textContent=msg;t.style.opacity='1';
  t._tm=setTimeout(()=>{t.style.opacity='0';},4000);
}
