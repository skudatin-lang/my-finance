// voice.js — Web Speech API, без серверов, без настройки
import{state,sched,fmt,today}from'./core.js';

let _recognition=null;
let _isRecording=false;

// ── Совместимость со старым кодом ────────────────────────────────
export function loadVoiceSettings(){
  // Web Speech API не требует настройки
}
export function saveVoiceSettings(sttUrl,gptUrl,appSecret){
  if(!state.D)return;
  if(!state.D.voiceSettings)state.D.voiceSettings={};
  state.D.voiceSettings.proxyUrl=sttUrl||'';
  state.D.voiceSettings.appSecret=appSecret||'';
  // НЕ вызываем sched() здесь — это вызывается при инициализации
}
export function isVoiceConfigured(){
  return!!(window.SpeechRecognition||window.webkitSpeechRecognition);
}
export function isRecording(){return _isRecording;}

// ── Запись через Web Speech API ───────────────────────────────────
export async function startRecording(onResult,onError,onStateChange){
  if(_isRecording){stopRecording();return;}

  const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(!SR){
    onError&&onError('Голосовой ввод не поддерживается. Используйте Chrome или Safari.');
    return;
  }

  try{
    if(_recognition){try{_recognition.abort();}catch(e){}_recognition=null;}
    _recognition=new SR();
    _recognition.lang='ru-RU';
    _recognition.continuous=false;
    _recognition.interimResults=true;
    _recognition.maxAlternatives=1;

    let gotResult=false;

    _recognition.onstart=()=>{
      _isRecording=true;
      gotResult=false;
      onStateChange&&onStateChange(true);
    };

    _recognition.onresult=e=>{
      let finalText='';
      for(let i=0;i<e.results.length;i++){
        if(e.results[i].isFinal)finalText+=e.results[i][0].transcript;
      }
      if(finalText.trim()){
        gotResult=true;
        _isRecording=false;
        onStateChange&&onStateChange(false);
        onResult&&onResult(finalText.trim());
      }
    };

    _recognition.onerror=e=>{
      if(e.error==='aborted'||e.error==='no-speech'&&gotResult)return;
      _isRecording=false;
      onStateChange&&onStateChange(false);
      const msgs={
        'not-allowed':'Нет доступа к микрофону — разрешите в настройках браузера',
        'no-speech':'Ничего не услышано — говорите сразу после нажатия',
        'network':'Требуется интернет для голосового ввода',
        'audio-capture':'Микрофон не найден',
        'service-not-allowed':'Требуется HTTPS',
      };
      if(!gotResult)onError&&onError(msgs[e.error]||'Ошибка: '+e.error);
    };

    _recognition.onend=()=>{
      if(_isRecording){
        _isRecording=false;
        onStateChange&&onStateChange(false);
        if(!gotResult)onError&&onError('Речь не распознана — попробуйте ещё раз');
      }
    };

    _recognition.start();
  }catch(e){
    _isRecording=false;
    onError&&onError('Ошибка запуска: '+e.message);
  }
}

export function stopRecording(){
  if(_recognition){try{_recognition.stop();}catch(e){}_recognition=null;}
  _isRecording=false;
}

// ── Локальный разбор намерений ────────────────────────────────────
export async function parseIntent(text){
  if(!state.D||!text)return{intent:'unknown',raw_text:text||''};
  const t=text.toLowerCase().trim();

  // Список покупок
  if(/купить|купи|куплю|добавь в список|нужно купить/.test(t)){
    const items=_parseShoppingItems(t);
    if(items.length)return{intent:'add_shopping',items};
  }
  // Баланс
  if(/баланс|сколько.*(?:осталось|на счёт|на карт)|остаток/.test(t)){
    const w=_findWallet(t);
    return{intent:'check_balance',wallet:w?.name||''};
  }
  // Перевод
  if(/перевёл|перевел|перевести|перевод/.test(t)){
    const amount=_extractAmount(t);
    const wallets=_extractTransferWallets(t);
    return{intent:'add_transfer',amount,from_wallet:wallets.from,to_wallet:wallets.to};
  }
  // Доход
  if(/получил|получила|заработал|заработала|пришло|пришла|пришли|зарплата|аванс|начислили|внёс на счёт/.test(t)){
    const amount=_extractAmount(t);
    const cat=_findCategory(t,'income');
    const w=_findWallet(t);
    return{intent:'add_income',amount,category:cat,wallet:w?.name||'',note:''};
  }
  // Расход (по умолчанию, если есть сумма)
  const amount=_extractAmount(t);
  if(amount>0){
    const cat=_findCategory(t,'expense');
    const w=_findWallet(t);
    return{intent:'add_expense',amount,category:cat,wallet:w?.name||'',note:''};
  }
  return{intent:'unknown',raw_text:text};
}

function _extractAmount(text){
  // Ищем все числа, берём первое подходящее (не год)
  const matches=[...text.matchAll(/\b(\d[\d\s]{0,5}\d|\d+)(?:[,\.](\d{1,2}))?\b/g)];
  for(const m of matches){
    const raw=m[0].replace(/\s/g,'').replace(',','.');
    const n=parseFloat(raw);
    if(!isNaN(n)&&n>0&&!(n>=2000&&n<=2035))return n;
  }
  // Числа словами
  const wordNums={ноль:0,один:1,одна:1,два:2,две:2,три:3,четыре:4,пять:5,шесть:6,семь:7,восемь:8,девять:9,десять:10,двадцать:20,тридцать:30,сорок:40,пятьдесят:50,шестьдесят:60,семьдесят:70,восемьдесят:80,девяносто:90,сто:100,двести:200,триста:300,четыреста:400,пятьсот:500,шестьсот:600,семьсот:700,восемьсот:800,девятьсот:900,тысяча:1000,тысячи:1000,тысяч:1000,тыщ:1000,миллион:1000000,миллиона:1000000};
  const words=text.split(/\s+/);
  let total=0,cur=0;
  for(const w of words){
    const v=wordNums[w];
    if(v!==undefined){if(v>=1000){total=(total+cur)*v;cur=0;}else cur+=v;}
  }
  return total+cur>0?total+cur:0;
}

function _findCategory(text,type){
  if(!state.D)return'Прочее';
  const t=text.toLowerCase();
  const cats=type==='income'?state.D.incomeCats:state.D.expenseCats.map(c=>c.name);
  // Точное совпадение с категорией пользователя
  for(const cat of cats){if(t.includes(cat.toLowerCase()))return cat;}
  // Ключевые слова
  const keys=[
    [/продукт|еда|магазин|супермаркет|пятёрочк|магнит|ашан|перекрёсток/,'Продукты'],
    [/транспорт|метро|такси|автобус|маршрутк/,'Транспорт'],
    [/кафе|ресторан|кофе|обед|ужин|завтрак|пицц|суши/,'Кафе и рестораны'],
    [/аптек|лекарств|врач|больниц/,'Здоровье'],
    [/одежд|обувь|куртк|джинс/,'Одежда'],
    [/зарплат|аванс|оклад/,'Зарплата'],
    [/фриланс|заказ|проект/,'Фриланс'],
    [/кредит|ипотек/,'Кредит'],
    [/связь|интернет|телефон|мобильн/,'Связь'],
    [/квартплат|коммунал|жкх|аренда/,'Квартплата'],
    [/бензин|заправк/,'Транспорт'],
    [/развлечен|кино|театр|игр/,'Развлечения'],
  ];
  for(const[re,name]of keys){
    if(re.test(t)){const found=cats.find(c=>c.toLowerCase()===name.toLowerCase());if(found)return found;}
  }
  return'Прочее';
}

function _findWallet(text){
  if(!state.D)return null;
  const t=text.toLowerCase();
  for(const w of state.D.wallets){if(t.includes(w.name.toLowerCase()))return w;}
  if(/карт|безнал|тинькофф|сбер/.test(t))return state.D.wallets.find(w=>/карт|bank|тинькофф|сбер/i.test(w.name))||null;
  if(/налич|кэш/.test(t))return state.D.wallets.find(w=>/налич/i.test(w.name))||null;
  return null;
}

function _extractTransferWallets(text){
  const t=text.toLowerCase();
  const wallets=state.D?.wallets||[];
  let from='',to='';
  const m=t.match(/(?:с|из)\s+(.+?)\s+(?:на|в|во)\s+(.+?)(?:\s|$)/);
  if(m){
    for(const w of wallets){
      const n=w.name.toLowerCase();
      if(m[1].includes(n))from=w.name;
      if(m[2].includes(n))to=w.name;
    }
  }
  return{from,to};
}

function _parseShoppingItems(text){
  const clean=text.replace(/купить|купи|куплю|добавь в список|нужно|пожалуйста/g,' ');
  const parts=clean.split(/,|\bи\b/).map(s=>s.trim()).filter(s=>s.length>1);
  return parts.map(p=>{
    const qm=p.match(/(\d+)\s*(?:шт|штук|пачк|литр|кг|грамм)?/);
    const qty=qm?parseInt(qm[1]):1;
    const name=p.replace(/\d+\s*(?:шт|штук|пачк|литр|кг|грамм)?/g,'').trim();
    return name.length>1?{name,qty,price:0}:null;
  }).filter(Boolean);
}

// ── Модал подтверждения намерения ─────────────────────────────────
export function handleVoiceIntent(intent,onConfirm){
  const modal=document.getElementById('modal-voice-intent');
  if(!modal){console.error('modal-voice-intent не найден');return;}
  const titleEl=modal.querySelector('.vi-title');
  const bodyEl=modal.querySelector('.vi-body');
  const confirmBtn=modal.querySelector('.vi-confirm');
  const editBtn=modal.querySelector('.vi-edit');
  if(!bodyEl||!confirmBtn)return;

  const titles={add_expense:'РАСХОД',add_income:'ДОХОД',add_transfer:'ПЕРЕВОД',add_shopping:'СПИСОК ПОКУПОК',check_balance:'БАЛАНС',unknown:'НЕ ПОНЯЛ'};
  if(titleEl)titleEl.textContent=titles[intent.intent]||'КОМАНДА';

  let body='';
  switch(intent.intent){
    case'add_expense':case'add_income':
      body=`<b>${intent.amount?fmt(intent.amount):'?'}</b>`
        +(intent.category?` · ${intent.category}`:'')
        +(intent.wallet?` · ${intent.wallet}`:'');
      break;
    case'add_shopping':
      body=(intent.items||[]).map(i=>`• <b>${i.name}</b>${i.qty>1?' × '+i.qty:''}`).join('<br>')||'(нет позиций)';
      break;
    case'add_transfer':
      body=`<b>${intent.amount?fmt(intent.amount):'?'}</b>${intent.from_wallet?' из '+intent.from_wallet:''}${intent.to_wallet?' → '+intent.to_wallet:''}`;
      break;
    case'check_balance':
      if(state.D){
        const total=state.D.wallets.reduce((s,w)=>s+w.balance,0);
        body=`Общий: <b>${fmt(total)}</b><br>`+state.D.wallets.map(w=>`${w.name}: ${fmt(w.balance)}`).join('<br>');
      }
      break;
    default:
      body=`"${intent.raw_text||''}"<br><small>Попробуйте переформулировать</small>`;
  }
  bodyEl.innerHTML=body;

  const labels={add_expense:'Добавить расход',add_income:'Добавить доход',add_shopping:'Добавить в список',add_transfer:'Выполнить перевод',check_balance:'Понятно',unknown:'Ввести вручную'};
  confirmBtn.textContent=labels[intent.intent]||'Подтвердить';
  confirmBtn.onclick=()=>{modal.classList.remove('open');onConfirm&&onConfirm(intent);};
  if(editBtn)editBtn.onclick=()=>{modal.classList.remove('open');_openEdit(intent);};
  modal.classList.add('open');
}

function _openEdit(intent){
  switch(intent.intent){
    case'add_expense':case'add_income':{
      const m=document.getElementById('modal');if(!m)return;
      m.classList.add('open');
      setTimeout(()=>{
        window.setOpType&&window.setOpType(intent.intent==='add_expense'?'expense':'income');
        const a=document.getElementById('op-amount');if(a&&intent.amount)a.value=intent.amount;
        const cs=document.getElementById('op-cat');
        if(cs&&intent.category)for(let i=0;i<cs.options.length;i++)if(cs.options[i].value.toLowerCase().includes(intent.category.toLowerCase())){cs.selectedIndex=i;break;}
      },100);break;
    }
    default:document.getElementById('modal')?.classList.add('open');
  }
}

// ── Выполнить намерение ───────────────────────────────────────────
export function executeIntent(intent){
  if(!state.D)return;
  switch(intent.intent){
    case'add_expense':case'add_income':{
      const type=intent.intent==='add_expense'?'expense':'income';
      if(!intent.amount){_openEdit(intent);return;}
      const w=state.D.wallets.find(w=>intent.wallet&&w.name.toLowerCase().includes(intent.wallet.toLowerCase()))||state.D.wallets[0];
      const op={id:'op'+Date.now()+'_'+Math.random().toString(36).slice(2,6),type,amount:intent.amount,date:today(),wallet:w?.id,category:intent.category||'Прочее',note:''};
      if(w){if(type==='income')w.balance+=intent.amount;else w.balance-=intent.amount;}
      state.D.operations.push(op);sched();
      _showToast(`✓ ${type==='income'?'Доход':'Расход'} ${fmt(intent.amount)} добавлен`);
      window._refreshCurrentScreen&&window._refreshCurrentScreen();
      break;
    }
    case'add_shopping':{
      if(!state.D.shoppingLists)state.D.shoppingLists={};
      const date=(window.state?.calDay)||today();
      if(!state.D.shoppingLists[date])state.D.shoppingLists[date]=[];
      (intent.items||[]).forEach(item=>{
        state.D.shoppingLists[date].push({id:'sh'+Date.now()+Math.random(),name:item.name,qty:item.qty||1,price:item.price||0,done:false});
      });
      sched();
      _showToast(`✓ ${(intent.items||[]).length} позиций добавлено в список`);
      window._renderShopWidget&&window._renderShopWidget();
      break;
    }
    case'add_transfer':{
      if(!intent.amount){_openEdit(intent);return;}
      const wf=state.D.wallets.find(w=>intent.from_wallet&&w.name.toLowerCase().includes(intent.from_wallet.toLowerCase()))||state.D.wallets[0];
      const wt=state.D.wallets.find(w=>intent.to_wallet&&w.name.toLowerCase().includes(intent.to_wallet.toLowerCase()))||state.D.wallets[1]||state.D.wallets[0];
      state.D.operations.push({id:'op'+Date.now(),type:'transfer',amount:intent.amount,date:today(),wallet:wf?.id,walletTo:wt?.id});
      if(wf)wf.balance-=intent.amount;if(wt&&wt!==wf)wt.balance+=intent.amount;
      sched();
      _showToast(`✓ Перевод ${fmt(intent.amount)} выполнен`);
      window._refreshCurrentScreen&&window._refreshCurrentScreen();
      break;
    }
    case'check_balance':break;
    default:_openEdit(intent);
  }
}

// ── Плавающая кнопка ─────────────────────────────────────────────
export function createSmartVoiceButton(){
  const btn=document.createElement('button');
  btn.id='smart-voice-btn';
  btn.title='Голосовая команда (нажмите и говорите)';
  btn.textContent='🎤';

  const supported=!!(window.SpeechRecognition||window.webkitSpeechRecognition);
  if(!supported){btn.style.display='none';return btn;}

  const reset=()=>{
    btn.textContent='🎤';
    btn.style.background='var(--amber)';
    btn.style.transform='scale(1)';
  };

  btn.onclick=async()=>{
    if(_isRecording){stopRecording();reset();return;}
    await startRecording(
      async text=>{
        reset();
        _showToast('🔍 «'+text+'»');
        try{
          const intent=await parseIntent(text);
          handleVoiceIntent(intent,executeIntent);
        }catch(e){
          console.error('parseIntent error:',e);
          _showToast('⚠ Не удалось разобрать команду');
        }
      },
      msg=>{reset();_showToast('⚠ '+msg);},
      isRec=>{
        if(isRec){btn.textContent='⏹';btn.style.background='#c0392b';btn.style.transform='scale(1.1)';}
        else reset();
      }
    );
  };
  return btn;
}

// ── Встроенная кнопка для полей ввода ────────────────────────────
export function createVoiceButton(targetInputId,extraStyle=''){
  const btn=document.createElement('button');
  btn.type='button';btn.title='Голосовой ввод';
  btn.style.cssText='background:var(--amber-light);border:1.5px solid var(--amber);border-radius:7px;padding:7px 9px;cursor:pointer;font-size:15px;flex-shrink:0;line-height:1;'+extraStyle;
  btn.textContent='🎤';

  if(!(window.SpeechRecognition||window.webkitSpeechRecognition)){btn.style.display='none';}

  const reset=()=>{btn.textContent='🎤';btn.style.background='var(--amber-light)';};

  btn.onclick=async()=>{
    if(_isRecording){stopRecording();reset();return;}
    await startRecording(
      text=>{
        reset();
        const el=document.getElementById(targetInputId);
        if(el){el.value=text;el.dispatchEvent(new Event('input',{bubbles:true}));}
      },
      msg=>{reset();_showToast('⚠ '+msg);},
      isRec=>{
        if(isRec){btn.textContent='⏹';btn.style.background='#fdd';}
        else reset();
      }
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
