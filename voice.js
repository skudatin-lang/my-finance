// voice.js — Web Speech API (бесплатно, без серверов, работает прямо в браузере)
// Fallback: если Web Speech API недоступен — показывает сообщение
// parseIntent — локально, через регулярные выражения (не нужен GPT)
import{state,sched,fmt,today}from'./core.js';

// ── Состояние ─────────────────────────────────────────────────────
let _recognition=null;
let _isRecording=false;

// ── Settings (оставляем совместимость со старым кодом) ────────────
export function loadVoiceSettings(){
  // Web Speech API не требует настройки — ничего не делаем
}
export function saveVoiceSettings(sttUrl,gptUrl,appSecret){
  // Совместимость со старым кодом — ничего не сохраняем
  if(!state.D)return;
  if(!state.D.voiceSettings)state.D.voiceSettings={};
  state.D.voiceSettings={proxyUrl:sttUrl,gptProxyUrl:gptUrl||sttUrl,appSecret};
  sched();
}

// Web Speech API доступен везде где есть браузер с поддержкой
export function isVoiceConfigured(){
  return!!(window.SpeechRecognition||window.webkitSpeechRecognition);
}
export function isRecording(){return _isRecording;}

// ── STT через Web Speech API ──────────────────────────────────────
export async function startRecording(onResult,onError,onStateChange){
  if(_isRecording){stopRecording();return;}

  const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(!SR){
    onError&&onError('Голосовой ввод не поддерживается вашим браузером. Используйте Chrome или Safari.');
    return;
  }

  try{
    _recognition=new SR();
    _recognition.lang='ru-RU';
    _recognition.continuous=false;
    _recognition.interimResults=false;
    _recognition.maxAlternatives=1;

    _recognition.onstart=()=>{
      _isRecording=true;
      onStateChange&&onStateChange(true);
    };

    _recognition.onresult=e=>{
      // Берём последний финальный результат
      let text='';
      for(let i=e.resultIndex;i<e.results.length;i++){
        if(e.results[i].isFinal)text+=e.results[i][0].transcript;
      }
      text=text.trim();
      _isRecording=false;
      onStateChange&&onStateChange(false);
      if(text)onResult&&onResult(text);
      else onError&&onError('Речь не распознана — попробуйте говорить чётче');
    };

    _recognition.onnomatch=()=>{
      _isRecording=false;
      onStateChange&&onStateChange(false);
      onError&&onError('Речь не распознана — попробуйте ещё раз');
    };

    _recognition.onerror=e=>{
      // 'aborted' часто приходит вместе с onresult — не показываем ошибку
      if(e.error==='aborted')return;
      _isRecording=false;
      onStateChange&&onStateChange(false);
      const msgs={
        'not-allowed':'Нет доступа к микрофону. Разрешите его в настройках браузера.',
        'no-speech':'Ничего не услышано — говорите сразу после нажатия кнопки.',
        'network':'Нет интернета. Голосовой ввод требует подключения к сети.',
        'audio-capture':'Микрофон не найден или заблокирован.',
        'service-not-allowed':'Браузер заблокировал голосовой ввод. Требуется HTTPS.',
      };
      onError&&onError(msgs[e.error]||'Ошибка: '+e.error);
    };

    _recognition.onend=()=>{
      _isRecording=false;
      onStateChange&&onStateChange(false);
    };

    _recognition.start();
  }catch(e){
    _isRecording=false;
    onError&&onError('Не удалось запустить запись: '+e.message);
  }
}

export function stopRecording(){
  if(_recognition){
    try{_recognition.stop();}catch(e){}
    _recognition=null;
  }
  _isRecording=false;
}

// ── Локальный разбор намерений (без GPT, без сервера) ─────────────
// Понимает команды вида:
// "потратил 500 на продукты с карты"
// "заработал 50000 зарплата"
// "перевёл 10000 с карты на наличные"
// "купить молоко 2 штуки и хлеб"
// "баланс карты"
export async function parseIntent(text){
  if(!state.D||!text)return{intent:'unknown',raw_text:text};
  const t=text.toLowerCase().trim();

  // ── Список покупок ──────────────────────────────────────────────
  const shopVerbs=['купить','купи','куплю','добавь в список','нужно купить','закупить'];
  if(shopVerbs.some(v=>t.startsWith(v)||t.includes(v))){
    const items=_parseShoppingItems(t);
    if(items.length)return{intent:'add_shopping',items};
  }

  // ── Баланс ──────────────────────────────────────────────────────
  if(/баланс|сколько|остаток/.test(t)){
    const wallet=_findWalletInText(t);
    return{intent:'check_balance',wallet:wallet?.name||''};
  }

  // ── Перевод ─────────────────────────────────────────────────────
  if(/перевёл|перевел|перевести|перевод/.test(t)){
    const amount=_extractAmount(t);
    const wallets=_extractTransferWallets(t);
    return{intent:'add_transfer',amount,from_wallet:wallets.from,to_wallet:wallets.to};
  }

  // ── Доход ───────────────────────────────────────────────────────
  const incomeVerbs=['получил','получила','заработал','заработала','пришло','пришла','зачислили','зарплата','доход','начислили','пополнил','внёс'];
  if(incomeVerbs.some(v=>t.includes(v))){
    const amount=_extractAmount(t);
    const category=_findCategory(t,'income');
    const wallet=_findWalletInText(t);
    const note=_extractNote(t);
    return{intent:'add_income',amount,category,wallet:wallet?.name||'',note};
  }

  // ── Расход (по умолчанию если есть сумма) ───────────────────────
  const amount=_extractAmount(t);
  if(amount>0){
    const category=_findCategory(t,'expense');
    const wallet=_findWalletInText(t);
    const note=_extractNote(t);
    return{intent:'add_expense',amount,category,wallet:wallet?.name||'',note};
  }

  return{intent:'unknown',raw_text:text};
}

// ── Вспомогательные функции разбора ───────────────────────────────

function _extractAmount(text){
  const wordNums={'ноль':0,'один':1,'одна':1,'два':2,'две':2,'три':3,'четыре':4,'пять':5,'шесть':6,'семь':7,'восемь':8,'девять':9,'десять':10,'одиннадцать':11,'двенадцать':12,'тринадцать':13,'четырнадцать':14,'пятнадцать':15,'шестнадцать':16,'семнадцать':17,'восемнадцать':18,'девятнадцать':19,'двадцать':20,'тридцать':30,'сорок':40,'пятьдесят':50,'шестьдесят':60,'семьдесят':70,'восемьдесят':80,'девяносто':90,'сто':100,'двести':200,'триста':300,'четыреста':400,'пятьсот':500,'шестьсот':600,'семьсот':700,'восемьсот':800,'девятьсот':900,'тысяча':1000,'тысячи':1000,'тысяч':1000,'тыщ':1000,'тыщи':1000,'миллион':1000000,'миллиона':1000000,'миллионов':1000000};

  // Ищем все числа в тексте, берём первое подходящее (не год)
  const allNums=[...text.matchAll(/\b(\d[\d\s]{0,5}\d|\d+)(?:[,\.](\d{1,2}))?\b/g)];
  for(const m of allNums){
    const raw=m[0].replace(/\s/g,'').replace(',','.');
    const n=parseFloat(raw);
    // Пропускаем похожие на год (2000-2035) и нулевые
    if(!isNaN(n)&&n>0&&!(n>=2000&&n<=2035))return n;
  }

  // Числа словами
  const words=text.split(/\s+/);
  let total=0,current=0;
  for(const w of words){
    const v=wordNums[w];
    if(v!==undefined){
      if(v>=1000){total=(total+current)*v;current=0;}
      else current+=v;
    }
  }
  const wordTotal=total+current;
  return wordTotal>0?wordTotal:0;
}

function _findCategory(text,type){
  if(!state.D)return'Прочее';
  const cats=type==='income'
    ?state.D.incomeCats
    :state.D.expenseCats.map(c=>c.name);
  // Ищем точное совпадение или частичное
  const t=text.toLowerCase();
  for(const cat of cats){
    if(t.includes(cat.toLowerCase()))return cat;
  }
  // Ключевые слова → категории
  const keyMap=[
    [/продукт|еда|магазин|супермаркет|пятёрочк|пятерочк|магнит|лента|ашан|перекрёсток/,'Продукты'],
    [/транспорт|метро|автобус|такси|убер|яндекс такси|маршрутк/,'Транспорт'],
    [/кафе|ресторан|пицц|суши|кофе|обед|ужин|завтрак/,'Кафе и рестораны'],
    [/аптек|лекарств|врач|больниц|здоров/,'Здоровье'],
    [/одежд|обувь|джинс|куртк/,'Одежда'],
    [/зарплат|аванс|оклад/,'Зарплата'],
    [/фриланс|проект|заказ/,'Фриланс'],
    [/кредит|ипотек|займ/,'Кредит'],
    [/связь|интернет|телефон|мобильн/,'Связь'],
    [/квартплат|коммунал|жкх|аренда/,'Квартплата'],
    [/развлечен|кино|театр|концерт|игр/,'Развлечения'],
  ];
  for(const [re,cat] of keyMap){
    if(re.test(text)){
      // Проверяем есть ли такая категория у пользователя
      const found=cats.find(c=>c.toLowerCase()===cat.toLowerCase());
      if(found)return found;
    }
  }
  return type==='income'?'Прочее':'Прочее';
}

function _findWalletInText(text){
  if(!state.D)return null;
  const t=text.toLowerCase();
  // Ищем по имени кошелька
  for(const w of state.D.wallets){
    if(t.includes(w.name.toLowerCase()))return w;
  }
  // Ключевые слова
  if(/карт|безнал/.test(t))return state.D.wallets.find(w=>/карт|bank|тинькофф|сбер/i.test(w.name))||null;
  if(/налич|кэш|cash/.test(t))return state.D.wallets.find(w=>/налич/i.test(w.name))||null;
  return null;
}

function _extractTransferWallets(text){
  const t=text.toLowerCase();
  const wallets=state.D?.wallets||[];
  let from=null,to=null;
  // "с X на Y" или "из X в Y"
  const fromMatch=t.match(/(?:с|из)\s+(.+?)(?:\s+(?:на|в|во)\s+(.+))?$/);
  if(fromMatch){
    const fromText=fromMatch[1]||'';
    const toText=fromMatch[2]||'';
    for(const w of wallets){
      const n=w.name.toLowerCase();
      if(fromText.includes(n))from=w.name;
      if(toText.includes(n))to=w.name;
    }
  }
  return{from:from||'',to:to||''};
}

function _parseShoppingItems(text){
  // "купить молоко 2 штуки хлеб и масло 3 пачки"
  const clean=text.replace(/купить|купи|куплю|добавь в список|нужно купить|и\b/g,' ').trim();
  const parts=clean.split(/,|\bи\b/).map(s=>s.trim()).filter(Boolean);
  const items=[];
  for(const part of parts){
    if(!part)continue;
    const qtyMatch=part.match(/(\d+)\s*(?:шт|штук|пачк|литр|кг|грамм|упак)?/);
    const qty=qtyMatch?parseInt(qtyMatch[1]):1;
    const name=part.replace(/\d+\s*(?:шт|штук|пачк|литр|кг|грамм|упак)?/g,'').trim();
    if(name.length>1)items.push({name,qty,price:0});
  }
  return items;
}

function _extractNote(text){
  // Убираем сумму, категорию, кошелёк — остаток = заметка
  // Упрощённо: берём всё что после "на" кроме кошелька
  const match=text.match(/(?:на|за)\s+([а-яё\s]+?)(?:\s+(?:с|из|картой|налич)|\s*$)/i);
  return match?match[1].trim():'';
}

// ── handleVoiceIntent — показывает модал подтверждения ────────────
export function handleVoiceIntent(intent,onConfirm){
  const modal=document.getElementById('modal-voice-intent');
  if(!modal)return;
  const titleEl=modal.querySelector('.vi-title');
  const bodyEl=modal.querySelector('.vi-body');
  const confirmBtn=modal.querySelector('.vi-confirm');
  const editBtn=modal.querySelector('.vi-edit');
  if(!bodyEl||!confirmBtn)return;

  if(titleEl){
    const titles={add_expense:'РАСХОД',add_income:'ДОХОД',add_transfer:'ПЕРЕВОД',add_shopping:'СПИСОК ПОКУПОК',check_balance:'БАЛАНС',add_goal:'ЦЕЛЬ',add_category:'КАТЕГОРИЯ',unknown:'НЕ ПОНЯЛ'};
    titleEl.textContent=titles[intent.intent]||'КОМАНДА';
  }

  let body='';
  switch(intent.intent){
    case'add_expense':case'add_income':
      body=`<b>${intent.amount?fmt(intent.amount):'?'}</b>`
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
          body=`Общий баланс: <b>${fmt(total)}</b><br>`+state.D.wallets.map(w=>`${w.name}: ${fmt(w.balance)}`).join('<br>');
        }
      }
      break;
    default:
      body=`"${intent.raw_text||''}"<br><span style="color:var(--text2);font-size:11px">Попробуйте переформулировать</span>`;
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
        window.setOpType&&window.setOpType(intent.intent==='add_expense'?'expense':'income');
        const a=document.getElementById('op-amount');if(a&&intent.amount)a.value=intent.amount;
        const n=document.getElementById('op-note');if(n&&intent.note)n.value=intent.note;
        const cs=document.getElementById('op-cat');
        if(cs&&intent.category)for(let i=0;i<cs.options.length;i++)if(cs.options[i].value.toLowerCase().includes(intent.category.toLowerCase())){cs.selectedIndex=i;break;}
      },100);break;
    }
    case'add_shopping':window.openAddShopItem&&window.openAddShopItem();break;
    default:document.getElementById('modal')?.classList.add('open');
  }
}

// ── executeIntent — выполнить подтверждённую команду ─────────────
export function executeIntent(intent){
  if(!state.D)return;
  switch(intent.intent){
    case'add_expense':case'add_income':{
      const type=intent.intent==='add_expense'?'expense':'income';
      if(!intent.amount){_openEdit(intent);return;}
      const w=state.D.wallets.find(w=>w.name.toLowerCase().includes((intent.wallet||'').toLowerCase()))||state.D.wallets[0];
      const op={id:'op'+Date.now()+'_'+Math.random().toString(36).slice(2,6),type,amount:intent.amount,date:today(),wallet:w?.id,category:intent.category||'Прочее',note:intent.note||''};
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
    case'check_balance':break;
    default:_openEdit(intent);
  }
}

// ── Кнопка голосового ввода (плавающая) ──────────────────────────
export function createSmartVoiceButton(){
  const btn=document.createElement('button');
  btn.id='smart-voice-btn';
  btn.title='Голосовая команда';
  btn.setAttribute('aria-label','Голосовой ввод');
  btn.textContent='🎤';
  let active=false;

  // Проверяем поддержку при создании
  const supported=!!(window.SpeechRecognition||window.webkitSpeechRecognition);
  if(!supported){
    btn.style.display='none'; // Скрываем если не поддерживается
    return btn;
  }

  const resetBtn=()=>{active=false;btn.textContent='🎤';btn.style.background='var(--amber)';btn.style.transform='scale(1)';};

  btn.onclick=async()=>{
    if(active){stopRecording();resetBtn();return;}
    await startRecording(
      async text=>{
        resetBtn();
        _showToast('🔍 «'+text+'» — анализирую...');
        try{
          const intent=await parseIntent(text);
          handleVoiceIntent(intent,executeIntent);
        }catch(e){
          _showToast('⚠ Ошибка разбора команды');
        }
      },
      msg=>{resetBtn();_showToast('⚠ '+msg);},
      isRec=>{
        active=isRec;
        if(isRec){btn.textContent='⏹';btn.style.background='#c0392b';btn.style.transform='scale(1.12)';}
        else{
          // Запись закончена — сразу сбрасываем кнопку, не ждём parseIntent
          resetBtn();
        }
      }
    );
  };
  return btn;
}

// ── Кнопка голосового ввода (встроенная в поле) ───────────────────
export function createVoiceButton(targetInputId,extraStyle=''){
  const btn=document.createElement('button');
  btn.type='button';btn.title='Голосовой ввод';
  btn.style.cssText='background:var(--amber-light);border:1.5px solid var(--amber);border-radius:7px;padding:7px 9px;cursor:pointer;font-size:15px;flex-shrink:0;line-height:1;'+extraStyle;
  btn.textContent='🎤';

  const supported=!!(window.SpeechRecognition||window.webkitSpeechRecognition);
  if(!supported)btn.style.display='none';

  let active=false;
  const resetVBtn=()=>{active=false;btn.textContent='🎤';btn.style.background='var(--amber-light)';};

  btn.onclick=async()=>{
    if(active){stopRecording();resetVBtn();return;}
    await startRecording(
      text=>{
        resetVBtn();
        const el=document.getElementById(targetInputId);
        if(el){el.value=text;el.dispatchEvent(new Event('input',{bubbles:true}));}
      },
      msg=>{resetVBtn();_showToast('⚠ '+msg);},
      isRec=>{
        active=isRec;
        if(isRec){btn.textContent='⏹';btn.style.background='#fdd';}
        else{resetVBtn();}
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
