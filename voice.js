/**
 * voice.js — Yandex SpeechKit STT + GPT intent parsing
 *
 * ЛОГИКА З/П ЖЕНЫ:
 * «зарплата жены», «з/п жены», «жена получила» → add_expense, category="З/П жены"
 * НЕ перевод, НЕ доход — это запланированный расход бюджета
 *
 * GPT получает все данные системы + явные правила
 * Модалка — редактируемые поля прямо внутри (без открытия доп. формы)
 * PCM конвертация — работает в Safari и Chrome
 * Зависание исправлено
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
  _sttUrl=vs.proxyUrl||'';_gptUrl=vs.gptProxyUrl||vs.proxyUrl||'';
  _appSecret=vs.appSecret||'';_userId=state.CU?.uid||'anonymous';
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
    stream.getTracks().forEach(t=>t.stop());_isRecording=false;
    onStateChange&&onStateChange(false);
    if(!_audioChunks.length){onError&&onError('Нет аудио.');return;}
    try{
      _showToast('⏳ Обработка...');
      const raw=new Blob(_audioChunks,{type:mime});
      const pcm=await _toPCM(raw);
      const text=await _sendPCM(pcm);
      if(text)onResult&&onResult(text);
      else onError&&onError('Речь не распознана. Говорите чётче.');
    }catch(e){onError&&onError('Ошибка: '+e.message);}
  };
  rec.onerror=e=>{stream.getTracks().forEach(t=>t.stop());_isRecording=false;onStateChange&&onStateChange(false);onError&&onError('Ошибка: '+(e.error?.message||''));};
  rec.start(250);
}
export function stopRecording(){
  _isRecording=false;
  try{if(_mediaRecorder&&_mediaRecorder.state==='recording')_mediaRecorder.stop();}catch(_){}
}

// ── STT ───────────────────────────────────────────────────────────────────
async function _sendPCM(buf){
  if(!buf||buf.byteLength<500)return null;
  const base=_sttUrl.replace(/\/?$/,'');
  const url=base.endsWith('/stt')?base:base+'/stt';
  const h={'Content-Type':'audio/x-pcm','X-Audio-Format':'LPCM','X-Sample-Rate':String(PCM_RATE)};
  if(_appSecret)h['X-App-Secret']=_appSecret;if(_userId)h['X-User-Id']=_userId;
  try{
    const resp=await fetch(url,{method:'POST',headers:h,body:buf});
    const data=await resp.json();
    if(!resp.ok){
      if(resp.status===401)_showToast('⚠ Ошибка авторизации YANDEX_API_KEY');
      else if(resp.status===402)_showToast('⚠ Нет средств Яндекс Cloud');
      else _showToast('STT '+resp.status+': '+(data.error_message||''));
      return null;
    }
    return(data.result||'').trim()||null;
  }catch(e){_showToast('Нет связи: '+e.message);return null;}
}

// ── Нечёткое совпадение ───────────────────────────────────────────────────
function _bestMatch(query,list){
  if(!query||!list?.length)return'';
  const q=query.toLowerCase().trim();
  const exact=list.find(x=>x.toLowerCase()===q);if(exact)return exact;
  const contains=list.find(x=>x.toLowerCase().includes(q));if(contains)return contains;
  const contained=list.find(x=>q.includes(x.toLowerCase()));if(contained)return contained;
  const qw=q.split(/\s+/).filter(w=>w.length>2);
  let best='',bs=0;
  for(const item of list){
    const il=item.toLowerCase();
    let score=qw.reduce((s,w)=>s+(il.includes(w)?w.length*2:0),0);
    if(score>bs){bs=score;best=item;}
  }
  return bs>=4?best:'';
}

// ── GPT с полными данными системы ────────────────────────────────────────
export async function parseIntent(spokenText){
  if(!state.D)return _fallback(spokenText);
  const wallets=state.D.wallets.map(w=>w.name);
  const expCats=state.D.expenseCats.map(c=>c.name);
  const incCats=state.D.incomeCats;
  // Находим категорию З/П жены если есть
  const wifePayCat=expCats.find(c=>c.toLowerCase().includes('жен')||c.toLowerCase().includes('з/п'))||null;

  const sys=`Ты ассистент финансового приложения. Пользователь говорит голосом — он НЕ обязан называть точные названия.
Твоя задача: понять смысл и подобрать наилучшее совпадение из списков системы (fuzzy matching).
Верни ТОЛЬКО JSON без markdown.

КОШЕЛЬКИ В СИСТЕМЕ:
${wallets.map((w,i)=>`${i+1}. "${w}"`).join('\n')}

КАТЕГОРИИ РАСХОДОВ:
${expCats.map((c,i)=>`${i+1}. "${c}"`).join('\n')}

КАТЕГОРИИ ДОХОДОВ:
${incCats.map((c,i)=>`${i+1}. "${c}"`).join('\n')}

КРИТИЧЕСКИ ВАЖНЫЕ ПРАВИЛА:

1. З/П ЖЕНЫ — это РАСХОД (add_expense), НЕ доход и НЕ перевод:
   - "зарплата жены", "з/п жены", "жене зарплату", "зарплата супруги"
   - category = "${wifePayCat||'З/П жены'}", intent = "add_expense"
   - Логика: это плановый расход бюджета семьи

2. ПЕРЕВОД (add_transfer) — деньги уходят с моего кошелька:
   - "перевел жене 10000", "скинул маме", "отдал другу"
   - НО "зарплата жены 50000" — это НЕ перевод, это add_expense!

3. МОЙ ДОХОД (add_income) — деньги пришли МНЕ:
   - "пришла моя зарплата", "получил аванс", "мне начислили"

4. FUZZY MATCHING кошельков:
   - "тинькофф", "тинк", "блэк", "black" → ищи кошелёк с этими словами
   - "наличка", "кэш", "нал" → кошелёк "Наличные"
   - "карта" (без уточнения) → первый кошелёк-карта

Сегодня: ${today()}

JSON формат:
{"intent":"add_expense|add_income|add_transfer|add_shopping|check_balance|unknown",
 "amount":число, "category":"из списка", "wallet":"из списка",
 "note":"", "from_wallet":"", "to_wallet":"",
 "items":[{"name":"","qty":1,"price":0}]}

Примеры:
"зарплата жены 50000 на тинькофф блэк" → {"intent":"add_expense","amount":50000,"category":"${wifePayCat||'З/П жены'}","wallet":"${_bestMatch('тинькофф',wallets)||wallets[0]||''}","note":""}
"потратил 500 на бензин с тинькофф блэк" → {"intent":"add_expense","amount":500,"category":"${_bestMatch('бензин',expCats)||expCats[0]||'Прочее'}","wallet":"${_bestMatch('тинькофф',wallets)||''}","note":""}
"перевел жене 10000 с наличных" → {"intent":"add_transfer","amount":10000,"from_wallet":"${_bestMatch('наличные',wallets)||''}","to_wallet":""}
"пришла моя зарплата 80000 на карту" → {"intent":"add_income","amount":80000,"category":"${_bestMatch('зарплата',incCats)||incCats[0]||'Зарплата'}","wallet":"${_bestMatch('карта',wallets)||''}","note":""}`;

  const base=(_gptUrl||_sttUrl).replace(/\/?$/,'');
  const ep=base.endsWith('/gpt')?base:base+'/gpt';
  const h={'Content-Type':'application/json'};
  if(_appSecret)h['X-App-Secret']=_appSecret;if(_userId)h['X-User-Id']=_userId;
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
      // Нормализуем через bestMatch
      if(parsed.wallet)parsed.wallet=_bestMatch(parsed.wallet,wallets)||parsed.wallet;
      if(parsed.category&&parsed.intent==='add_expense')parsed.category=_bestMatch(parsed.category,expCats)||parsed.category;
      if(parsed.category&&parsed.intent==='add_income')parsed.category=_bestMatch(parsed.category,incCats)||parsed.category;
      if(parsed.from_wallet)parsed.from_wallet=_bestMatch(parsed.from_wallet,wallets)||parsed.from_wallet;
      if(parsed.to_wallet)parsed.to_wallet=_bestMatch(parsed.to_wallet,wallets)||parsed.to_wallet;
      if(parsed.intent==='unknown')return _fallback(spokenText);
      return parsed;
    }catch(_){return _fallback(spokenText);}
  }catch(e){return _fallback(spokenText);}
}

// ── Умный fallback без GPT ────────────────────────────────────────────────
function _fallback(text){
  if(!text)return{intent:'unknown',raw_text:''};
  const t=text.toLowerCase();
  const wallets=state.D?.wallets?.map(w=>w.name)||[];
  const expCats=state.D?.expenseCats?.map(c=>c.name)||[];
  const incCats=state.D?.incomeCats||[];

  // Сумма
  const amtM=text.match(/(\d[\d\s]*(?:[.,]\d{1,2})?)\s*(?:руб|р\b|₽)?/i);
  const amount=amtM?parseFloat(amtM[1].replace(/\s/g,'').replace(',','.')):0;

  // Кошелёк — сначала прямое совпадение, потом синонимы
  let wallet=_bestMatch(t,wallets);
  if(!wallet){
    if(t.match(/налич|кэш|кеш|нал\b/))wallet=_bestMatch('наличные',wallets);
    else if(t.match(/тинькофф|тинк|тиньк|блэк|black|platinum|платинум|капитал/))
      wallet=wallets.find(w=>/тинькофф|тинк|блэк|black|t-|т-банк/i.test(w))||'';
    else if(t.match(/сбер/))wallet=wallets.find(w=>/сбер/i.test(w))||'';
  }

  // ── З/П ЖЕНЫ — СПЕЦИАЛЬНОЕ ПРАВИЛО ──
  // Ключевые паттерны: «зарплата жены», «з/п жены», «жена получила», «жене зарплату»
  // Всегда add_expense, категория = находим в expCats
  if(t.match(/зарплат[ау]\s+жен|з\/?п\s+жен|жен[ыае]\s+зарплат|жена\s+получил|жене\s+зарплат|жены\s+зарплат/)){
    const wifecat=_bestMatch('жен',expCats)||_bestMatch('з/п',expCats)||expCats[0]||'З/П жены';
    return{intent:'add_expense',amount,category:wifecat,wallet,note:'зарплата жены'};
  }

  // Перевод — проверяем ДО дохода/расхода
  if(t.match(/перевод|перевел|перекинул|скинул|отдал\s+(?:жен|маме|папе|другу|брату|сестре)/))
    return{intent:'add_transfer',amount,from_wallet:wallet,to_wallet:''};

  // Список покупок
  if(t.match(/купи(ть)?|список|нужно\s+купить/))
    return{intent:'add_shopping',items:[{name:text.replace(/\d+[.,]?\d*/g,'').trim()||text,qty:1,price:0}]};

  // Категория расхода
  let category=_bestMatch(t,expCats);
  if(!category){
    const synMap=[
      {k:/бензин|заправк|азс|топливо/,c:'бензин'},
      {k:/продукт|еда|магазин|пятёрочк|перекрёст|ашан|лента|дикси/,c:'продукты'},
      {k:/кафе|кофе|ресторан|обед|ужин|пицца|суши/,c:'кафе'},
      {k:/транспорт|метро|автобус|такси|убер/,c:'транспорт'},
      {k:/аптек|лекарств|таблетк|врач/,c:'здоровье'},
      {k:/одежд|обувь/,c:'одежда'},
      {k:/коммунал|квартплат|жкх|свет|газ/,c:'квартплата'},
      {k:/связь|телефон|интернет/,c:'связь'},
      {k:/кредит/,c:'кредит'},
    ];
    for(const{k,c}of synMap){if(t.match(k)){category=_bestMatch(c,expCats)||c;break;}}
  }

  // Мой доход
  if(t.match(/(?:мо[яя]|мне|я)?\s*зарплат|аванс|получил|пришл[оа]|начислил|бонус/))
    return{intent:'add_income',amount,category:_bestMatch(t,incCats)||incCats[0]||'Прочее',wallet,note:''};

  // Расход
  if(t.match(/потратил|трат|расход|заплатил|купил|оплатил|снял|списал/)||amount>0)
    return{intent:'add_expense',amount,category:category||expCats[1]||'Прочее',wallet,note:''};

  return{intent:'unknown',raw_text:text};
}

// ── МОДАЛКА С РЕДАКТИРУЕМЫМИ ПОЛЯМИ ──────────────────────────────────────
const esc=s=>String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

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
  bodyEl.innerHTML=_buildBody(intent);

  const L={add_expense:'✅ Добавить расход',add_income:'✅ Добавить доход',add_shopping:'✅ Добавить в список',add_transfer:'✅ Выполнить перевод',check_balance:'Закрыть',add_goal:'✅ Создать цель',unknown:'Ввести вручную'};
  confirmBtn.textContent=L[intent.intent]||'Подтвердить';
  confirmBtn.onclick=()=>{modal.classList.remove('open');onConfirm&&onConfirm(_readVals(intent));};
  editBtn.onclick=()=>{modal.classList.remove('open');_openForm(_readVals(intent));};
  modal.classList.add('open');
}

function _buildBody(intent){
  if(!state.D)return'';
  const wallets=state.D.wallets;
  const expCats=state.D.expenseCats.map(c=>c.name);
  const incCats=state.D.incomeCats;
  const fld=(label,html)=>`<div style="margin-bottom:10px"><div style="font-size:10px;font-weight:700;color:var(--text2);letter-spacing:.5px;margin-bottom:4px">${label}</div>${html}</div>`;
  const inp=(id,val,type='text')=>`<input id="vi-${esc(id)}" type="${type}" value="${esc(String(val||''))}" style="width:100%;padding:8px 10px;border:1.5px solid var(--border);border-radius:7px;background:var(--bg);color:var(--topbar);font-size:14px;font-weight:600;box-sizing:border-box">`;
  const sel=(id,opts)=>`<select id="vi-${esc(id)}" style="width:100%;padding:8px 10px;border:1.5px solid var(--border);border-radius:7px;background:var(--bg);color:var(--topbar);font-size:13px;box-sizing:border-box">${opts}</select>`;
  const wOpts=(curName)=>wallets.map(w=>`<option value="${esc(w.id)}" ${w.name===curName?'selected':''}>${esc(w.name)}</option>`).join('');

  switch(intent.intent){
    case'add_expense':case'add_income':{
      const cats=intent.intent==='add_expense'?expCats:incCats;
      const catOpts=cats.map(c=>`<option ${c===intent.category?'selected':''}>${esc(c)}</option>`).join('');
      return fld('СУММА ₽',inp('amount',intent.amount,'number'))
        +fld(intent.intent==='add_expense'?'КАТЕГОРИЯ':'ИСТОЧНИК',sel('category',catOpts))
        +fld('КОШЕЛЁК',sel('wallet',wOpts(intent.wallet)))
        +fld('ЗАМЕТКА',inp('note',intent.note||''));
    }
    case'add_transfer':{
      return fld('СУММА ₽',inp('amount',intent.amount,'number'))
        +fld('ОТКУДА',sel('from_wallet',wOpts(intent.from_wallet)))
        +fld('КУДА',sel('to_wallet',wOpts(intent.to_wallet)));
    }
    case'add_shopping':{
      return fld('ПОЗИЦИИ (через запятую)',inp('items',(intent.items||[]).map(i=>i.name).join(', ')));
    }
    case'check_balance':{
      const total=state.D.wallets.reduce((s,w)=>s+w.balance,0);
      return`<div style="font-size:16px;font-weight:700;margin-bottom:8px">Итого: ${fmt(total)}</div>`
        +state.D.wallets.map(w=>`<div style="display:flex;justify-content:space-between;padding:4px 0;font-size:13px"><span>${esc(w.name)}</span><b>${fmt(w.balance)}</b></div>`).join('');
    }
    default:
      return`<div style="font-size:13px;color:var(--text2)">"${esc(intent.raw_text||'')}"</div><div style="font-size:11px;color:var(--text2);margin-top:6px">Не удалось определить. Введите вручную.</div>`;
  }
}

function _readVals(intent){
  const g=id=>{const el=document.getElementById('vi-'+id);return el?el.value:null;};
  const u={...intent};
  switch(intent.intent){
    case'add_expense':case'add_income':{
      const amt=parseFloat(g('amount'));if(!isNaN(amt)&&amt>0)u.amount=amt;
      const cat=g('category');if(cat)u.category=cat;
      const wId=g('wallet');if(wId&&state.D){const w=state.D.wallets.find(w=>w.id===wId);u.wallet=w?w.name:'';u.walletId=wId;}
      const note=g('note');if(note!==null)u.note=note;
      break;
    }
    case'add_transfer':{
      const amt=parseFloat(g('amount'));if(!isNaN(amt)&&amt>0)u.amount=amt;
      const fId=g('from_wallet');if(fId&&state.D){const w=state.D.wallets.find(w=>w.id===fId);u.from_wallet=w?w.name:'';u.fromWalletId=fId;}
      const tId=g('to_wallet');if(tId&&state.D){const w=state.D.wallets.find(w=>w.id===tId);u.to_wallet=w?w.name:'';u.toWalletId=tId;}
      break;
    }
    case'add_shopping':{
      const raw=g('items')||'';u.items=raw.split(',').map(s=>({name:s.trim(),qty:1,price:0})).filter(i=>i.name);break;
    }
  }
  return u;
}

// ── Открытие полной формы операции ───────────────────────────────────────
function _openForm(intent){
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
          if(intent.walletId){for(let i=0;i<ws.options.length;i++){if(ws.options[i].value===intent.walletId){ws.selectedIndex=i;ws.dispatchEvent(new Event('change',{bubbles:true}));break;}}}
          else if(intent.wallet){const wl=intent.wallet.toLowerCase();for(let i=0;i<ws.options.length;i++){if(ws.options[i].text.toLowerCase().includes(wl)){ws.selectedIndex=i;break;}}}
        }
        const cs=document.getElementById('op-cat');
        if(cs&&intent.category){const cl=intent.category.toLowerCase();for(let i=0;i<cs.options.length;i++){if(cs.options[i].text.toLowerCase().includes(cl)||cs.options[i].value.toLowerCase().includes(cl)){cs.selectedIndex=i;break;}}}
        const n=document.getElementById('op-note');if(n&&intent.note)n.value=intent.note;
      },150);break;
    }
    case'add_transfer':{
      const m=document.getElementById('modal');if(!m)return;
      m.classList.add('open');
      setTimeout(()=>{
        window.setOpType&&window.setOpType('transfer');
        const a=document.getElementById('op-amount');if(a&&intent.amount){a.value=intent.amount;a.dispatchEvent(new Event('input',{bubbles:true}));}
        const wf=document.getElementById('op-wallet');
        if(wf){const id=intent.fromWalletId||'';const nm=(intent.from_wallet||'').toLowerCase();for(let i=0;i<wf.options.length;i++){if((id&&wf.options[i].value===id)||(nm&&wf.options[i].text.toLowerCase().includes(nm))){wf.selectedIndex=i;break;}}}
      },150);break;
    }
    case'add_shopping':window.openAddShopItem&&window.openAddShopItem();break;
    default:document.getElementById('modal')?.classList.add('open');
  }
}

// ── Выполнение намерения ──────────────────────────────────────────────────
export function executeIntent(intent){
  if(!state.D)return;
  const activeDate=window._getCalActiveDate?window._getCalActiveDate():today();
  switch(intent.intent){
    case'add_expense':case'add_income':{
      const type=intent.intent==='add_expense'?'expense':'income';
      if(!intent.amount){_openForm(intent);return;}
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
      (intent.items||[]).forEach(item=>{state.D.shoppingLists[activeDate].push({id:'sh'+Date.now()+Math.random(),name:item.name,qty:item.qty||1,price:item.price||0,done:false});});
      sched();_showToast(`✓ ${(intent.items||[]).length} позиций добавлено`);
      window.renderShoppingList&&window.renderShoppingList();window._renderShopWidget&&window._renderShopWidget();break;
    }
    case'add_transfer':{
      if(!intent.amount){_openForm(intent);return;}
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
      if(!intent.name){_openForm(intent);return;}
      if(!state.D.goals)state.D.goals=[];
      const w=state.D.wallets.find(w=>w.name.toLowerCase().includes('сбереж'))||state.D.wallets[0];
      state.D.goals.push({id:'goal'+Date.now(),name:intent.name,target:intent.target_amount||0,walletId:w?.id,deadline:intent.deadline||null});
      sched();_showToast('✓ Цель «'+intent.name+'» создана');break;
    }
    case'add_category':{
      if(!intent.name)return;
      if(intent.type==='income'){if(!state.D.incomeCats.includes(intent.name))state.D.incomeCats.push(intent.name);}
      else{const pid=state.D.plan?.find(p=>p.type==='expense')?.id||'';if(!state.D.expenseCats.find(c=>c.name===intent.name))state.D.expenseCats.push({name:intent.name,planId:pid});}
      sched();_showToast('✓ Категория «'+intent.name+'» добавлена');break;
    }
    case'check_balance':break;
    default:_openForm(intent);
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
  btn.id='smart-voice-btn';btn.title='Голосовая команда';btn.setAttribute('aria-label','Голосовой ввод');btn.textContent='🎤';
  let active=false;
  btn.onclick=async()=>{
    if(!isVoiceConfigured()){alert('Голосовой ввод не настроен.\n\nАдминистратор → введите URL воркера → Сохранить.');return;}
    if(active){active=false;btn.textContent='🎤';btn.style.background='';btn.style.transform='';stopRecording();return;}
    await startRecording(
      async text=>{active=false;btn.textContent='🎤';btn.style.background='';btn.style.transform='';
        _showToast('🔍 «'+text+'» — анализирую...');
        const intent=await parseIntent(text);handleVoiceIntent(intent,executeIntent);},
      msg=>{active=false;btn.textContent='🎤';btn.style.background='';btn.style.transform='';_showToast('⚠ '+msg);},
      isRec=>{active=isRec;if(isRec){btn.textContent='⏹';btn.style.background='#c0392b';btn.style.transform='scale(1.12)';}else{btn.textContent='⏳';btn.style.background='var(--amber)';btn.style.transform='';}}
    );
  };
  return btn;
}
export function createVoiceButton(targetInputId,extraStyle=''){
  const btn=document.createElement('button');btn.type='button';btn.title='Голосовой ввод';
  btn.style.cssText='background:var(--amber-light);border:1.5px solid var(--amber);border-radius:7px;padding:7px 9px;cursor:pointer;font-size:15px;flex-shrink:0;line-height:1;'+extraStyle;
  btn.textContent='🎤';let active=false;
  btn.onclick=async()=>{
    if(!isVoiceConfigured()){alert('Голосовой ввод не настроен.');return;}
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
