/**
 * voice.js — Yandex SpeechKit STT + GPT intent parsing
 *
 * КЛЮЧЕВЫЕ УЛУЧШЕНИЯ:
 * 1. З/П ЖЕНЫ: специальная логика — «зарплата жены», «з/п жены» → add_expense
 *    (категория «З/П жены»), а НЕ add_income и НЕ add_transfer
 * 2. GPT получает ВСЕ данные системы + fuzzy-match инструкции
 * 3. Редактируемая модалка подтверждения — поля можно исправить прямо там
 * 4. PCM конвертация — работает в Safari и Chrome
 * 5. Зависание исправлено — _isRecording сбрасывается в любом случае
 */
import{state,sched,fmt,today}from'./core.js';

let _sttUrl='',_gptUrl='',_appSecret='',_userId='';
let _mediaRecorder=null,_audioChunks=[],_isRecording=false;

const PCM_RATE=16000;

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

// ── PCM конвертация ───────────────────────────────────────────────────────
async function _toPCM(blob){
  const ab=await blob.arrayBuffer();
  const Ctx=window.AudioContext||window.webkitAudioContext;
  if(!Ctx)throw new Error('AudioContext не поддерживается');
  const ctx=new Ctx({sampleRate:PCM_RATE});
  let dec;
  try{dec=await ctx.decodeAudioData(ab);}
  catch(e){await ctx.close();throw new Error('Декодирование: '+e.message);}
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
function _pickMime(){
  const c=['audio/webm;codecs=opus','audio/ogg;codecs=opus','audio/webm','audio/mp4;codecs=mp4a.40.2','audio/mp4'];
  for(const f of c)if(MediaRecorder.isTypeSupported(f))return f;
  return null;
}

// ── Запись ────────────────────────────────────────────────────────────────
export async function startRecording(onResult,onError,onStateChange){
  if(_isRecording){stopRecording();await new Promise(r=>setTimeout(r,300));}
  if(!isVoiceConfigured()){onError&&onError('Голосовой ввод не настроен.\nАдминистратор → введите URL воркера.');return;}
  const mime=_pickMime();
  if(!mime){onError&&onError('Браузер не поддерживает запись. Используйте Chrome/Firefox/Safari 14+.');return;}
  let stream;
  try{stream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true,autoGainControl:true}});}
  catch(e){onError&&onError(e.name==='NotAllowedError'?'Нет доступа к микрофону.':'Микрофон: '+e.message);return;}
  _audioChunks=[];
  let rec;
  try{rec=new MediaRecorder(stream,{mimeType:mime});}
  catch(e){stream.getTracks().forEach(t=>t.stop());onError&&onError('Ошибка: '+e.message);return;}
  _mediaRecorder=rec;_isRecording=true;
  onStateChange&&onStateChange(true);
  rec.ondataavailable=e=>{if(e.data&&e.data.size>0)_audioChunks.push(e.data);};
  rec.onstop=async()=>{
    stream.getTracks().forEach(t=>t.stop());
    _isRecording=false;
    onStateChange&&onStateChange(false);
    if(!_audioChunks.length){onError&&onError('Нет аудио. Попробуйте ещё раз.');return;}
    try{
      _showToast('⏳ Обработка...');
      const raw=new Blob(_audioChunks,{type:mime});
      const pcm=await _toPCM(raw);
      const text=await _sendPCM(pcm);
      if(text)onResult&&onResult(text);
      else onError&&onError('Речь не распознана. Говорите чётче.');
    }catch(e){console.error('[voice]',e);onError&&onError('Ошибка: '+e.message);}
  };
  rec.onerror=e=>{stream.getTracks().forEach(t=>t.stop());_isRecording=false;onStateChange&&onStateChange(false);onError&&onError('Ошибка записи: '+(e.error?.message||''));};
  rec.start(250);
}
export function stopRecording(){
  _isRecording=false;
  try{if(_mediaRecorder&&_mediaRecorder.state==='recording')_mediaRecorder.stop();}catch(_){}
}

// ── STT ───────────────────────────────────────────────────────────────────
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
      if(resp.status===401)_showToast('⚠ Ошибка авторизации. Проверьте YANDEX_API_KEY.');
      else if(resp.status===402)_showToast('⚠ Нет средств Яндекс Cloud.');
      else _showToast('STT ошибка ('+resp.status+'): '+(data.error_message||''));
      return null;
    }
    return(data.result||'').trim()||null;
  }catch(e){_showToast('Нет связи: '+e.message);return null;}
}

// ── КЛЮЧЕВАЯ ФУНКЦИЯ: определение З/П жены ────────────────────────────────
// З/П жены — это РАСХОД (деньги уходят из семейного бюджета на жену)
// Признаки: «зарплата жены», «з/п жены», «жене зарплата», «жена получила»
function _isWifeSalary(text){
  const t=text.toLowerCase();
  return t.match(/(?:зарплат|з\/п|жалованье|зп)\s*(?:жен|супруг)|(?:жен|супруг)[ыеа]\s*(?:зарплат|з\/п|жалованье|получила|начислили)/);
}

// ── Fuzzy match строки со списком ─────────────────────────────────────────
function _bestMatch(query,list){
  if(!query||!list||!list.length)return'';
  const q=query.toLowerCase().trim();
  const exact=list.find(x=>x.toLowerCase()===q);if(exact)return exact;
  const contains=list.find(x=>x.toLowerCase().includes(q));if(contains)return contains;
  const contained=list.find(x=>q.includes(x.toLowerCase()));if(contained)return contained;
  const qw=q.split(/\s+/).filter(w=>w.length>2);
  let best='',score=0;
  for(const item of list){
    const iL=item.toLowerCase();
    let sc=0;
    for(const w of qw){if(iL.includes(w))sc+=w.length;}
    if(sc>score){score=sc;best=item;}
  }
  return score>=2?best:'';
}

// ── GPT разбор с РЕАЛЬНЫМИ данными системы ───────────────────────────────
export async function parseIntent(spokenText){
  if(!state.D)return _fallback(spokenText);

  // ПРОВЕРКА З/П ЖЕНЫ ДО GPT
  if(_isWifeSalary(spokenText)){
    const wifeCat=state.D.expenseCats.find(c=>c.name&&c.name.toLowerCase().includes('ж'));
    const amtM=spokenText.match(/(\d[\d\s]*(?:[.,]\d{1,2})?)/);
    const amount=amtM?parseFloat(amtM[1].replace(/\s/g,'').replace(',','.')):0;
    const wallets=state.D.wallets.map(w=>w.name);
    const wallet=_bestMatch(spokenText.toLowerCase(),wallets);
    return{
      intent:'add_expense',
      amount,
      category:wifeCat?wifeCat.name:'З/П жены',
      wallet,
      note:'зарплата жены',
    };
  }

  const wallets=state.D.wallets.map(w=>w.name);
  const expCats=state.D.expenseCats.map(c=>c.name);
  const incCats=state.D.incomeCats;

  const sys=`Ты ассистент финансового приложения. Пользователь говорит голосом — он НЕ обязан называть точные названия.
Подбери наилучшее совпадение из списков системы. Верни ТОЛЬКО JSON без markdown.

КОШЕЛЬКИ:
${wallets.map((w,i)=>`${i+1}. "${w}"`).join('\n')}

КАТЕГОРИИ РАСХОДОВ:
${expCats.map((c,i)=>`${i+1}. "${c}"`).join('\n')}

КАТЕГОРИИ ДОХОДОВ:
${incCats.map((c,i)=>`${i+1}. "${c}"`).join('\n')}

ПРАВИЛА:
- add_expense: потратил/заплатил/купил/списал/снял
- add_income: получил/пришло/зарплата МОЯ/аванс/заработал
- add_transfer: перевел/отдал/скинул [кому-то]
- add_shopping: купить/список/нужно
- check_balance: баланс/сколько
- ВАЖНО: "зарплата жены/супруги" = add_expense категория "З/П жены" (это РАСХОД семейного бюджета)
- ВАЖНО: "перевел жене/маме/другу" = add_transfer (деньги уходят)
- ВАЖНО: fuzzy-match кошельков: "тинькофф/тинк/блэк/black" → подходящий кошелёк из списка

Примеры:
"потратил 500 бензин тинькофф" → {"intent":"add_expense","amount":500,"category":"${_bestMatch('бензин',expCats)}","wallet":"${_bestMatch('тинькофф',wallets)}","note":""}
"зп жены 50000 блэк" → {"intent":"add_expense","amount":50000,"category":"${expCats.find(c=>c.toLowerCase().includes('жен'))||'З/П жены'}","wallet":"${_bestMatch('блэк',wallets)}","note":"зарплата жены"}
"перевел маме 5000 наличными" → {"intent":"add_transfer","amount":5000,"from_wallet":"${_bestMatch('наличные',wallets)}","to_wallet":""}
"пришла зп 80000 тинькофф" → {"intent":"add_income","amount":80000,"category":"Зарплата","wallet":"${_bestMatch('тинькофф',wallets)}","note":""}

JSON поля: intent, amount, category, wallet, note, from_wallet, to_wallet, items`;

  const base=(_gptUrl||_sttUrl).replace(/\/?$/,'');
  const ep=base.endsWith('/gpt')?base:base+'/gpt';
  const h={'Content-Type':'application/json'};
  if(_appSecret)h['X-App-Secret']=_appSecret;
  if(_userId)h['X-User-Id']=_userId;

  try{
    const resp=await fetch(ep,{method:'POST',headers:h,body:JSON.stringify({
      completionOptions:{stream:false,temperature:0.1,maxTokens:300},
      messages:[{role:'system',text:sys},{role:'user',text:spokenText}]
    })});
    if(!resp.ok){console.warn('[GPT]',resp.status);return _fallback(spokenText);}
    const d=await resp.json();
    const t=(d.result?.alternatives?.[0]?.message?.text||'').replace(/```json|```/g,'').trim();
    if(!t)return _fallback(spokenText);
    try{
      const parsed=JSON.parse(t);
      // Нормализуем результат GPT через bestMatch
      if(parsed.wallet)parsed.wallet=_bestMatch(parsed.wallet,wallets)||parsed.wallet;
      if(parsed.category&&parsed.intent==='add_expense')parsed.category=_bestMatch(parsed.category,expCats)||parsed.category;
      if(parsed.category&&parsed.intent==='add_income')parsed.category=_bestMatch(parsed.category,incCats)||parsed.category;
      if(parsed.from_wallet)parsed.from_wallet=_bestMatch(parsed.from_wallet,wallets)||parsed.from_wallet;
      if(parsed.to_wallet)parsed.to_wallet=_bestMatch(parsed.to_wallet,wallets)||parsed.to_wallet;
      return parsed;
    }catch(_){return _fallback(spokenText);}
  }catch(e){console.warn('[GPT]',e.message);return _fallback(spokenText);}
}

// ── Умный fallback без GPT ────────────────────────────────────────────────
function _fallback(text){
  if(!text)return{intent:'unknown',raw_text:''};
  const t=text.toLowerCase();
  const wallets=state.D?.wallets?.map(w=>w.name)||[];
  const expCats=state.D?.expenseCats?.map(c=>c.name)||[];
  const incCats=state.D?.incomeCats||[];

  const amtM=text.match(/(\d[\d\s]*(?:[.,]\d{1,2})?)\s*(?:руб|р\b|₽)?/i);
  const amount=amtM?parseFloat(amtM[1].replace(/\s/g,'').replace(',','.')):0;

  // ПЕРВЫЙ ПРИОРИТЕТ: З/П жены
  if(_isWifeSalary(text)){
    const wifeCat=expCats.find(c=>c.toLowerCase().includes('жен'))||expCats[0]||'З/П жены';
    return{intent:'add_expense',amount,category:wifeCat,wallet:_bestMatch(t,wallets),note:'зарплата жены'};
  }

  // Кошелёк
  let wallet=_bestMatch(t,wallets);
  if(!wallet){
    if(t.match(/налич|кэш|нал\b/))wallet=_bestMatch('наличные',wallets);
    else if(t.match(/тинькофф|тинк|блэк|black|platinum|платинум|капитал/))wallet=_bestMatch('тинькофф',wallets)||_bestMatch('black',wallets)||_bestMatch('т-банк',wallets);
    else if(t.match(/сбер/))wallet=_bestMatch('сбер',wallets);
    else if(t.match(/альфа/))wallet=_bestMatch('альфа',wallets);
  }

  // ПЕРЕВОД — второй приоритет
  if(t.match(/перевод|перевел|перекинул|скинул/)){
    return{intent:'add_transfer',amount,from_wallet:wallet||'',to_wallet:''};
  }

  // Список покупок
  if(t.match(/купи(ть)?|список|нужно\s+купить/)){
    return{intent:'add_shopping',items:[{name:text.replace(/\d+[.,]?\d*/g,'').trim()||text,qty:1,price:0}]};
  }

  // Категория расхода
  let category=_bestMatch(t,expCats);
  if(!category){
    const synMap=[
      {k:/бензин|заправк|азс|топливо/,c:'бензин'},
      {k:/продукт|еда|магазин|пятёрочк/,c:'продукты'},
      {k:/кафе|кофе|ресторан|обед|ужин/,c:'кафе'},
      {k:/транспорт|метро|автобус|такси/,c:'транспорт'},
      {k:/аптек|лекарств|врач/,c:'здоровье'},
      {k:/коммунал|квартплат|жкх/,c:'квартплата'},
      {k:/связь|телефон|интернет/,c:'связь'},
      {k:/кредит|долг|займ/,c:'кредит'},
    ];
    for(const{k,c}of synMap){if(t.match(k)){category=_bestMatch(c,expCats)||expCats.find(ec=>ec.toLowerCase().includes(c));if(category)break;}}
  }

  // Доход
  if(t.match(/зарплат|аванс|получил|пришл[оа]|начислили|бонус/)){
    return{intent:'add_income',amount,category:_bestMatch(t,incCats)||incCats[0]||'Прочее',wallet,note:''};
  }

  // Расход (или просто сумма)
  if(t.match(/потратил|трат|расход|заплатил|купил|оплатил|снял|списал/)||amount>0){
    return{intent:'add_expense',amount,category:category||expCats[1]||'Прочее',wallet,note:''};
  }

  return{intent:'unknown',raw_text:text};
}

// ── МОДАЛКА С РЕДАКТИРУЕМЫМИ ПОЛЯМИ ──────────────────────────────────────
export function handleVoiceIntent(intent,onConfirm){
  const modal=document.getElementById('modal-voice-intent');
  if(!modal){onConfirm&&onConfirm(intent);return;}
  const titleEl=modal.querySelector('.vi-title');
  const bodyEl=modal.querySelector('.vi-body');
  const confirmBtn=modal.querySelector('.vi-confirm');
  const editBtn=modal.querySelector('.vi-edit');

  const icons={add_expense:'💸',add_income:'💰',add_shopping:'🛒',add_transfer:'🔄',check_balance:'📊',add_goal:'🎯',unknown:'🤔'};
  const titles={add_expense:'Расход',add_income:'Доход',add_shopping:'Покупки',add_transfer:'Перевод',check_balance:'Баланс',add_goal:'Цель',unknown:'Не распознано'};
  titleEl.textContent=(icons[intent.intent]||'🎤')+' '+(titles[intent.intent]||'Команда');

  bodyEl.innerHTML=_buildEditableBody(intent);

  const L={add_expense:'✅ Добавить расход',add_income:'✅ Добавить доход',add_shopping:'✅ Добавить в список',add_transfer:'✅ Выполнить перевод',check_balance:'Закрыть',add_goal:'✅ Создать цель',unknown:'Ввести вручную'};
  confirmBtn.textContent=L[intent.intent]||'Подтвердить';

  confirmBtn.onclick=()=>{
    const updated=_readModalValues(intent);
    modal.classList.remove('open');
    onConfirm&&onConfirm(updated);
  };
  editBtn.onclick=()=>{
    const updated=_readModalValues(intent);
    modal.classList.remove('open');
    _openFullForm(updated);
  };
  modal.classList.add('open');
}

// ── Редактируемые поля в модалке ──────────────────────────────────────────
function _buildEditableBody(intent){
  if(!state.D)return'';
  const wallets=state.D.wallets;
  const expCats=state.D.expenseCats.map(c=>c.name);
  const incCats=state.D.incomeCats;

  const fld=(label,html)=>`<div style="margin-bottom:10px"><div style="font-size:10px;font-weight:700;color:var(--text2);letter-spacing:.5px;margin-bottom:4px">${label}</div>${html}</div>`;
  const inp=(id,val,type='text')=>`<input id="vi-${id}" type="${type}" value="${String(val||'').replace(/"/g,'&quot;')}" style="width:100%;padding:8px 10px;border:1.5px solid var(--border);border-radius:7px;background:var(--bg);color:var(--topbar);font-size:14px;font-weight:600;box-sizing:border-box">`;
  const sel=(id,opts)=>`<select id="vi-${id}" style="width:100%;padding:8px 10px;border:1.5px solid var(--border);border-radius:7px;background:var(--bg);color:var(--topbar);font-size:13px;box-sizing:border-box">${opts}</select>`;
  const wOpts=(selName)=>wallets.map(w=>`<option value="${w.id}" ${w.name===selName?'selected':''}>${w.name}</option>`).join('');

  switch(intent.intent){
    case'add_expense':case'add_income':{
      const cats=intent.intent==='add_expense'?expCats:incCats;
      const catOpts=cats.map(c=>`<option value="${c}" ${c===intent.category?'selected':''}>${c}</option>`).join('');
      const wObj=wallets.find(w=>w.name===intent.wallet);
      const walletOpts=wallets.map(w=>`<option value="${w.id}" ${wObj?.id===w.id?'selected':''}>${w.name}</option>`).join('');
      return fld('СУММА ₽',inp('amount',intent.amount,'number'))
        +fld(intent.intent==='add_expense'?'КАТЕГОРИЯ РАСХОДА':'КАТЕГОРИЯ ДОХОДА',sel('category',catOpts))
        +fld('КОШЕЛЁК',sel('wallet',walletOpts))
        +fld('ЗАМЕТКА',inp('note',intent.note||''));
    }
    case'add_transfer':{
      const fromObj=wallets.find(w=>w.name===intent.from_wallet);
      const toObj=wallets.find(w=>w.name===intent.to_wallet);
      const fromOpts=wallets.map(w=>`<option value="${w.id}" ${fromObj?.id===w.id?'selected':''}>${w.name}</option>`).join('');
      const toOpts=wallets.map(w=>`<option value="${w.id}" ${toObj?.id===w.id?'selected':''}>${w.name}</option>`).join('');
      return fld('СУММА ₽',inp('amount',intent.amount,'number'))
        +fld('ОТКУДА',sel('from_wallet',fromOpts))
        +fld('КУДА',sel('to_wallet',toOpts));
    }
    case'add_shopping':
      return fld('ПОЗИЦИИ (через запятую)',inp('items',(intent.items||[]).map(i=>i.name).join(', ')));
    case'check_balance':{
      const total=state.D.wallets.reduce((s,w)=>s+w.balance,0);
      return`<div style="font-size:16px;font-weight:700;color:var(--topbar);margin-bottom:8px">Общий: ${fmt(total)}</div>`
        +state.D.wallets.map(w=>`<div style="display:flex;justify-content:space-between;padding:4px 0;font-size:13px;border-bottom:.5px solid var(--border)"><span>${w.name}</span><b>${fmt(w.balance)}</b></div>`).join('');
    }
    default:
      return`<div style="font-size:13px;color:var(--text2);padding:8px 0">"${intent.raw_text||''}"</div><div style="font-size:11px;color:var(--text2)">Не удалось определить. Введите вручную.</div>`;
  }
}

// ── Читаем значения из полей модалки ─────────────────────────────────────
function _readModalValues(intent){
  const g=id=>{const el=document.getElementById('vi-'+id);return el?el.value:null;};
  const updated={...intent};
  switch(intent.intent){
    case'add_expense':case'add_income':{
      const amt=parseFloat(g('amount'));
      if(!isNaN(amt)&&amt>0)updated.amount=amt;
      const cat=g('category');if(cat)updated.category=cat;
      const wId=g('wallet');
      if(wId&&state.D){const w=state.D.wallets.find(w=>w.id===wId);updated.wallet=w?w.name:'';updated.walletId=wId;}
      const note=g('note');if(note!==null)updated.note=note;
      break;
    }
    case'add_transfer':{
      const amt=parseFloat(g('amount'));if(!isNaN(amt)&&amt>0)updated.amount=amt;
      const fId=g('from_wallet'),tId=g('to_wallet');
      if(fId&&state.D){const w=state.D.wallets.find(w=>w.id===fId);updated.from_wallet=w?w.name:'';updated.fromWalletId=fId;}
      if(tId&&state.D){const w=state.D.wallets.find(w=>w.id===tId);updated.to_wallet=w?w.name:'';updated.toWalletId=tId;}
      break;
    }
    case'add_shopping':{
      const raw=g('items')||'';
      updated.items=raw.split(',').map(s=>({name:s.trim(),qty:1,price:0})).filter(i=>i.name);
      break;
    }
  }
  return updated;
}

// ── Открыть полную форму операции ─────────────────────────────────────────
function _openFullForm(intent){
  switch(intent.intent){
    case'add_expense':case'add_income':{
      const m=document.getElementById('modal');if(!m)return;
      m.classList.add('open');
      setTimeout(()=>{
        window.setOpType&&window.setOpType(intent.intent==='add_expense'?'expense':'income');
        const a=document.getElementById('op-amount');
        if(a&&intent.amount){a.value=intent.amount;a.dispatchEvent(new Event('input',{bubbles:true}));}
        const ws=document.getElementById('op-wallet');
        if(ws){
          if(intent.walletId){for(let i=0;i<ws.options.length;i++)if(ws.options[i].value===intent.walletId){ws.selectedIndex=i;ws.dispatchEvent(new Event('change',{bubbles:true}));break;}}
          else if(intent.wallet){const wl=intent.wallet.toLowerCase();for(let i=0;i<ws.options.length;i++)if(ws.options[i].text.toLowerCase().includes(wl)){ws.selectedIndex=i;ws.dispatchEvent(new Event('change',{bubbles:true}));break;}}
        }
        const cs=document.getElementById('op-cat');
        if(cs&&intent.category){const cl=intent.category.toLowerCase();for(let i=0;i<cs.options.length;i++)if(cs.options[i].text.toLowerCase().includes(cl)||cs.options[i].value.toLowerCase().includes(cl)){cs.selectedIndex=i;break;}}
        const n=document.getElementById('op-note');if(n&&intent.note)n.value=intent.note;
      },150);break;
    }
    case'add_transfer':{
      const m=document.getElementById('modal');if(!m)return;
      m.classList.add('open');
      setTimeout(()=>{
        window.setOpType&&window.setOpType('transfer');
        const a=document.getElementById('op-amount');
        if(a&&intent.amount){a.value=intent.amount;a.dispatchEvent(new Event('input',{bubbles:true}));}
        const wf=document.getElementById('op-wallet');
        if(wf&&(intent.fromWalletId||intent.from_wallet)){
          const id=intent.fromWalletId||'';const nm=(intent.from_wallet||'').toLowerCase();
          for(let i=0;i<wf.options.length;i++)if((id&&wf.options[i].value===id)||(nm&&wf.options[i].text.toLowerCase().includes(nm))){wf.selectedIndex=i;break;}
        }
      },150);break;
    }
    case'add_shopping':window.openAddShopItem&&window.openAddShopItem();break;
    default:document.getElementById('modal')?.classList.add('open');
  }
}

// ── Выполнение интента ────────────────────────────────────────────────────
export function executeIntent(intent){
  if(!state.D)return;
  const activeDate=window._getCalActiveDate?window._getCalActiveDate():today();
  switch(intent.intent){
    case'add_expense':case'add_income':{
      const type=intent.intent==='add_expense'?'expense':'income';
      if(!intent.amount){_openFullForm(intent);return;}
      let w=null;
      if(intent.walletId)w=state.D.wallets.find(ww=>ww.id===intent.walletId);
      if(!w&&intent.wallet)w=state.D.wallets.find(ww=>ww.name.toLowerCase().includes(intent.wallet.toLowerCase()));
      if(!w)w=state.D.wallets[0];
      const op={id:'op'+Date.now()+'_'+Math.random().toString(36).slice(2,6),type,amount:intent.amount,date:today(),wallet:w?.id,category:intent.category||'Прочее',note:intent.note||''};
      if(w){if(type==='income')w.balance+=intent.amount;else w.balance-=intent.amount;}
      state.D.operations.push(op);sched();
      _showToast(`✓ ${type==='income'?'Доход':'Расход'} ${fmt(intent.amount)}${w?' · '+w.name:''}`);
      window._refreshCurrentScreen&&window._refreshCurrentScreen();break;
    }
    case'add_shopping':{
      if(!state.D.shoppingLists)state.D.shoppingLists={};
      if(!state.D.shoppingLists[activeDate])state.D.shoppingLists[activeDate]=[];
      (intent.items||[]).forEach(item=>state.D.shoppingLists[activeDate].push({id:'sh'+Date.now()+Math.random(),name:item.name,qty:item.qty||1,price:item.price||0,done:false}));
      sched();_showToast(`✓ ${(intent.items||[]).length} позиций добавлено`);
      window.renderShoppingList&&window.renderShoppingList();window._renderShopWidget&&window._renderShopWidget();break;
    }
    case'add_transfer':{
      if(!intent.amount){_openFullForm(intent);return;}
      let wf=null,wt=null;
      if(intent.fromWalletId)wf=state.D.wallets.find(w=>w.id===intent.fromWalletId);
      if(!wf&&intent.from_wallet)wf=state.D.wallets.find(w=>w.name.toLowerCase().includes(intent.from_wallet.toLowerCase()));
      if(!wf)wf=state.D.wallets[0];
      if(intent.toWalletId)wt=state.D.wallets.find(w=>w.id===intent.toWalletId);
      if(!wt&&intent.to_wallet)wt=state.D.wallets.find(w=>w.name.toLowerCase().includes(intent.to_wallet.toLowerCase()));
      if(!wt)wt=state.D.wallets[1]||state.D.wallets[0];
      const op={id:'op'+Date.now()+'_'+Math.random().toString(36).slice(2,6),type:'transfer',amount:intent.amount,date:today(),wallet:wf?.id,walletTo:wt?.id};
      if(wf)wf.balance-=intent.amount;if(wt&&wt!==wf)wt.balance+=intent.amount;
      state.D.operations.push(op);sched();
      _showToast(`✓ Перевод ${fmt(intent.amount)} · ${wf?.name||''}→${wt?.name||''}`);
      window._refreshCurrentScreen&&window._refreshCurrentScreen();break;
    }
    case'add_goal':{
      if(!intent.name){_openFullForm(intent);return;}
      if(!state.D.goals)state.D.goals=[];
      const w=state.D.wallets.find(w=>w.name.toLowerCase().includes('сбереж'))||state.D.wallets[0];
      state.D.goals.push({id:'goal'+Date.now(),name:intent.name,target:intent.target_amount||0,walletId:w?.id,deadline:intent.deadline||null});
      sched();_showToast('✓ Цель «'+intent.name+'» создана');break;
    }
    case'add_category':{
      if(!intent.name)return;
      if(intent.type==='income'){if(!state.D.incomeCats.includes(intent.name))state.D.incomeCats.push(intent.name);}
      else{const pid=state.D.plan.find(p=>p.type==='expense')?.id||'';if(!state.D.expenseCats.find(c=>c.name===intent.name))state.D.expenseCats.push({name:intent.name,planId:pid});}
      sched();_showToast('✓ Категория «'+intent.name+'» добавлена');break;
    }
    case'check_balance':break;
    default:_openFullForm(intent);
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
    if(!isVoiceConfigured()){alert('Голосовой ввод не настроен.\n\nАдминистратор → введите URL воркера → Сохранить.');return;}
    if(active){active=false;btn.textContent='🎤';btn.style.background='';btn.style.transform='';stopRecording();return;}
    await startRecording(
      async text=>{active=false;btn.textContent='🎤';btn.style.background='';btn.style.transform='';_showToast('🔍 Анализирую: «'+text+'»...');const intent=await parseIntent(text);handleVoiceIntent(intent,executeIntent);},
      msg=>{active=false;btn.textContent='🎤';btn.style.background='';btn.style.transform='';_showToast('⚠ '+msg);},
      isRec=>{active=isRec;if(isRec){btn.textContent='⏹';btn.style.background='#c0392b';btn.style.transform='scale(1.12)';}else{btn.textContent='⏳';btn.style.background='var(--amber)';btn.style.transform='';}}
    );
  };
  return btn;
}
export function createVoiceButton(targetInputId,extraStyle=''){
  const btn=document.createElement('button');
  btn.type='button';btn.title='Голосовой ввод';
  btn.style.cssText='background:var(--amber-light);border:1.5px solid var(--amber);border-radius:7px;padding:7px 9px;cursor:pointer;font-size:15px;flex-shrink:0;line-height:1;'+extraStyle;
  btn.textContent='🎤';
  let active=false;
  btn.onclick=async()=>{
    if(!isVoiceConfigured()){alert('Голосовой ввод не настроен.\nАдминистратор → введите URL воркера.');return;}
    if(active){active=false;btn.textContent='🎤';btn.style.background='var(--amber-light)';stopRecording();return;}
    await startRecording(
      text=>{active=false;btn.textContent='🎤';btn.style.background='var(--amber-light)';const el=document.getElementById(targetInputId);if(el){el.value=text;el.dispatchEvent(new Event('input',{bubbles:true}));el.focus();}},
      msg=>{active=false;btn.textContent='🎤';btn.style.background='var(--amber-light)';_showToast('⚠ '+msg);},
      isRec=>{active=isRec;btn.textContent=isRec?'⏹':'⏳';btn.style.background=isRec?'#fdd':'var(--amber-light)';}
    );
  };
  return btn;
}
export function _showToast(msg){
  let t=document.getElementById('voice-toast');
  if(!t){t=document.createElement('div');t.id='voice-toast';t.style.cssText='position:fixed;bottom:88px;right:24px;background:var(--topbar);color:#C9A96E;padding:10px 16px;border-radius:8px;font-size:12px;font-weight:600;z-index:999;max-width:290px;word-break:break-word;opacity:0;transition:opacity .3s;pointer-events:none;line-height:1.5;';document.body.appendChild(t);}
  if(t._tm)clearTimeout(t._tm);
  t.textContent=msg;t.style.opacity='1';
  t._tm=setTimeout(()=>{t.style.opacity='0';},4000);
}
