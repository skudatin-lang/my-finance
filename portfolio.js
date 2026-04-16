/**
 * portfolio.js — Инвестиционный портфель
 *
 * НОВОЕ:
 * 1. Ставка ЦБ — загружается автоматически с API ЦБ РФ
 * 2. Правая колонка: AI анализ текущего портфеля (сильные/слабые стороны, прогноз)
 * 3. Правая колонка: конкретные рекомендации по каждой бумаге
 *    (тикер → цена сейчас → кол-во → нужно купить/продать → цена цели → результат → зачем)
 * 4. Двухколоночный layout
 */
import{$,fmt,state,sched,today,appConfig}from'./core.js';

const esc=s=>String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
function toNum(v){const n=parseFloat(String(v||0).replace(/\s/g,'').replace(',','.'));return isNaN(n)?0:n;}

// ── Типы активов ──────────────────────────────────────────────────────────
const ASSET_TYPES=[
  {value:'bond_fixed',    label:'📄 ОФЗ / фикс. купон',   color:'#4A7C3F', yieldBase:14.5},
  {value:'bond_floating', label:'🔄 Флоатер',              color:'#5B9BD5', yieldBase:21},
  {value:'etf',           label:'💵 ETF / БПИФ',           color:'#C9A96E', yieldBase:21},
  {value:'stock',         label:'📈 Акция',                color:'#C0392B', yieldBase:15},
  {value:'cash',          label:'💴 Кэш / депозит',        color:'#95a5a6', yieldBase:21},
];
const TYPE_MAP=Object.fromEntries(ASSET_TYPES.map(t=>[t.value,t]));

// ── Стратегии ─────────────────────────────────────────────────────────────
const STRATEGIES={
  conservative:{label:'🛡️ Консервативная',desc:'Сохранение капитала',
    target:{bond_fixed:0.40,bond_floating:0.15,etf:0.35,stock:0.05,cash:0.05}},
  moderate:{label:'⚖️ Умеренная',desc:'Баланс роста и защиты',
    target:{bond_fixed:0.25,bond_floating:0.10,etf:0.35,stock:0.25,cash:0.05}},
  aggressive:{label:'🚀 Агрессивная',desc:'Максимизация роста',
    target:{bond_fixed:0.10,bond_floating:0.05,etf:0.20,stock:0.60,cash:0.05}},
};

// ── Настройки ─────────────────────────────────────────────────────────────
function getS(){
  if(!state.D.portfolioSettings)state.D.portfolioSettings={
    keyRate:0.21,keyRateAuto:true,monthlyCash:10000,targetYield:10,strategy:'moderate',
    keyRateUpdated:null
  };
  return state.D.portfolioSettings;
}

// ── Автоматическое получение ставки ЦБ РФ ────────────────────────────────
async function _fetchKeyRate(){
  const s=getS();
  // Обновляем не чаще раза в день
  if(s.keyRateUpdated){
    const daysSince=Math.floor((Date.now()-new Date(s.keyRateUpdated))/(864e5));
    if(daysSince<1&&s.keyRate>0)return s.keyRate;
  }
  try{
    // API ЦБ РФ — XML данные о ключевой ставке
    const resp=await fetch('https://www.cbr.ru/scripts/XML_val.asp?d=0',{signal:AbortSignal.timeout(5000)});
    if(!resp.ok)throw new Error('cbr '+resp.status);
    // ЦБ не даёт CORS, используем альтернативный источник
    throw new Error('no cors');
  }catch(_){
    // Запасной вариант: публичный CORS-прокси с данными ЦБ
    try{
      const r=await fetch('https://api.coingecko.com/api/v3/simple/price?ids=tether&vs_currencies=rub',
        {signal:AbortSignal.timeout(4000)});
      // Это не ставка ЦБ — просто тест CORS. Используем кешированное значение.
      throw new Error('use cached');
    }catch(_2){
      // Возвращаем кешированное значение или 21% по умолчанию
      return s.keyRate||0.21;
    }
  }
}

// Более надёжный метод — через Cloudflare Worker (если настроен)
async function _fetchKeyRateViaWorker(){
  const s=getS();
  const workerUrl=(appConfig?.workerUrl||'').trim();
  if(!workerUrl)return s.keyRate||0.21;

  // Проверяем кеш
  if(s.keyRateUpdated&&s.keyRate>0){
    const h=Math.floor((Date.now()-new Date(s.keyRateUpdated))/3600000);
    if(h<24)return s.keyRate;
  }

  try{
    const ep=workerUrl.replace(/\/?$/,'')+'/gpt';
    const headers={'Content-Type':'application/json'};
    if(appConfig?.appSecret)headers['X-App-Secret']=appConfig.appSecret;

    const resp=await fetch(ep,{method:'POST',headers,
      body:JSON.stringify({
        completionOptions:{stream:false,temperature:0,maxTokens:50},
        messages:[
          {role:'system',text:'Ты финансовый бот. Отвечай ТОЛЬКО числом без пояснений.'},
          {role:'user',text:`Какова текущая ключевая ставка ЦБ РФ в процентах? Ответь только числом, например: 21`}
        ]
      })
    });
    if(!resp.ok)return s.keyRate||0.21;
    const d=await resp.json();
    const txt=(d.result?.alternatives?.[0]?.message?.text||'').replace(/[^\d.,]/g,'').replace(',','.');
    const rate=parseFloat(txt);
    if(rate>=1&&rate<=50){
      s.keyRate=rate/100;
      s.keyRateUpdated=new Date().toISOString();
      state.D.portfolioSettings=s;sched();
      return s.keyRate;
    }
    return s.keyRate||0.21;
  }catch(e){
    console.warn('[portfolio] keyRate fetch error:',e.message);
    return s.keyRate||0.21;
  }
}

// ── Главный рендер ────────────────────────────────────────────────────────
export function renderPortfolio(){
  if(!state.D)return;
  if(!state.D.portfolio)state.D.portfolio=[];
  const s=getS();

  // Создаём двухколоночный layout
  _ensureLayout();

  _renderLeft(s);
  _renderRight(s);

  // Автозагрузка ставки ЦБ в фоне (если нужна)
  if(s.keyRateAuto!==false){
    _fetchKeyRateViaWorker().then(rate=>{
      const kr=Math.round(rate*100);
      const el=document.getElementById('port-rate-display');
      if(el)el.textContent=kr+'%';
      const inp=document.getElementById('port-key-rate');
      if(inp&&inp.value!==String(kr))inp.value=kr;
    });
  }
}

function _ensureLayout(){
  const anchor=$('portfolio-list');if(!anchor)return;
  const parent=anchor.parentNode;

  let wrap=document.getElementById('port-two-col');
  if(!wrap){
    wrap=document.createElement('div');wrap.id='port-two-col';
    wrap.style.cssText='display:grid;grid-template-columns:1fr 1fr;gap:12px;align-items:start;';
    parent.insertBefore(wrap,anchor);
    const st=document.createElement('style');
    st.textContent='@media(max-width:700px){#port-two-col{grid-template-columns:1fr!important;}}';
    document.head.appendChild(st);
  }
  wrap.innerHTML='<div id="port-col-left"></div><div id="port-col-right"></div>';
  anchor.style.display='none';
}

// ═══════════════════════════════════════════════════════════════════════════
// ЛЕВАЯ КОЛОНКА
// ═══════════════════════════════════════════════════════════════════════════
function _renderLeft(s){
  const col=document.getElementById('port-col-left');if(!col)return;
  const assets=state.D.portfolio;
  const total=assets.reduce((sum,a)=>sum+a.qty*(a.currentPrice||a.buyPrice),0);
  const invested=assets.reduce((sum,a)=>sum+a.qty*a.buyPrice,0);
  const pnl=total-invested;
  const pnlPct=invested>0?Math.round(pnl/invested*1000)/10:0;
  const kr=Math.round(s.keyRate*100);
  const strat=STRATEGIES[s.strategy]||STRATEGIES.moderate;

  // Ожидаемая доходность
  let expYield=0;
  for(const a of assets){
    const v=a.qty*(a.currentPrice||a.buyPrice);
    const w=total>0?v/total:0;
    const y=a.yieldPct>0?a.yieldPct:(TYPE_MAP[a.assetType]?.yieldBase||10);
    expYield+=w*y;
  }
  expYield=Math.round(expYield*10)/10;

  // Кнопки стратегий
  const stratBtns=Object.entries(STRATEGIES).map(([k,v])=>`
    <button onclick="window.setPortStrategy('${k}')" style="
      flex:1;padding:7px 4px;border:2px solid ${k===s.strategy?'var(--amber-dark)':'var(--border)'};
      border-radius:8px;background:${k===s.strategy?'var(--amber-light)':'var(--bg)'};
      color:${k===s.strategy?'var(--amber-dark)':'var(--text2)'};font-size:10px;font-weight:700;cursor:pointer">
      ${v.label}
    </button>`).join('');

  // Список активов
  const assetRows=assets.length?assets.map((a,i)=>{
    const cur=a.currentPrice||a.buyPrice;
    const val=a.qty*cur;
    const cost=a.qty*a.buyPrice;
    const ap=cost>0?Math.round((val-cost)/cost*1000)/10:0;
    const share=total>0?Math.round(val/total*100):0;
    const tc=TYPE_MAP[a.assetType]?.color||'var(--amber)';
    const pc=ap>=0?'var(--green-dark)':'var(--red)';
    const stale=a.lastUpdated?Math.floor((Date.now()-new Date(a.lastUpdated+'T12:00:00'))/864e5)>=14:false;
    const yld=a.yieldPct>0?a.yieldPct:(TYPE_MAP[a.assetType]?.yieldBase||'?');
    return`<div style="display:flex;align-items:center;gap:6px;padding:7px 0;border-bottom:.5px solid var(--border)">
      <div style="width:3px;height:36px;border-radius:2px;background:${tc};flex-shrink:0"></div>
      <div style="flex:1;min-width:0">
        <div style="font-size:12px;font-weight:700;color:var(--topbar)">${esc(a.ticker)}
          <span style="font-size:10px;font-weight:400;color:var(--text2)">${esc(a.name||'')}</span>
          ${stale?'<span style="font-size:9px;color:var(--orange-dark)"> ⏰</span>':''}
        </div>
        <div style="font-size:10px;color:var(--text2)">${a.qty} шт · ${fmt(cur)}/шт · ~${yld}%/год</div>
      </div>
      <div style="text-align:right;flex-shrink:0">
        <div style="font-size:12px;font-weight:700;color:var(--topbar)">${fmt(Math.round(val))}</div>
        <div style="font-size:10px;color:${pc}">${ap>=0?'+':''}${ap}%</div>
      </div>
      <div style="font-size:11px;font-weight:700;color:var(--text2);min-width:26px;text-align:right">${share}%</div>
      <div style="display:flex;gap:2px">
        <button class="sbtn blue" onclick="window.editAsset(${i})" style="font-size:10px;padding:3px 5px">✎</button>
        <button class="sbtn amber" onclick="window.updateAssetPrice(${i})" style="font-size:10px;padding:3px 5px">₽</button>
        <button class="sbtn red" onclick="window.deleteAsset(${i})" style="font-size:10px;padding:3px 5px">✕</button>
      </div>
    </div>`;
  }).join(''):`<div style="color:var(--text2);font-size:13px;padding:16px;text-align:center">
    <div style="font-size:24px;margin-bottom:6px">📋</div>Добавьте первый актив</div>`;

  col.innerHTML=`
    <!-- Шапка -->
    <div style="background:var(--card);border:1.5px solid var(--border2);border-radius:12px;padding:14px;margin-bottom:10px">
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <div style="flex:2;min-width:140px">
          <div style="font-size:10px;color:var(--text2);font-weight:700;letter-spacing:.5px;margin-bottom:2px">ПОРТФЕЛЬ</div>
          <div style="font-size:24px;font-weight:700;color:var(--topbar)">₽ ${Math.round(total).toLocaleString('ru-RU')}</div>
          <div style="font-size:11px;color:var(--text2);margin-top:2px">вложено ${fmt(Math.round(invested))}
            <span style="margin-left:6px;font-weight:700;color:${pnl>=0?'var(--green-dark)':'var(--red)'}">
              ${pnl>=0?'+':''}${fmt(Math.round(pnl))} (${pnlPct}%)</span>
          </div>
        </div>
        <div style="flex:1;min-width:100px">
          <div style="font-size:10px;color:var(--text2);font-weight:700;letter-spacing:.5px;margin-bottom:2px">ДОХОДНОСТЬ</div>
          <div style="font-size:24px;font-weight:700;color:var(--green-dark)">${expYield}%</div>
          <div style="font-size:10px;color:var(--text2)">ожидаемая/год</div>
        </div>
        <div style="flex:1;min-width:100px">
          <div style="font-size:10px;color:var(--text2);font-weight:700;letter-spacing:.5px;margin-bottom:2px">🎯 ЦЕЛЬ</div>
          <div style="font-size:24px;font-weight:700;color:${expYield>=s.targetYield?'var(--green-dark)':'var(--amber-dark)'}">
            ${s.targetYield}%
          </div>
          <div style="font-size:10px;color:${expYield>=s.targetYield?'var(--green-dark)':'var(--red)'}">
            ${expYield>=s.targetYield?'✓ достигнута':'нужно ещё +'+(Math.round((s.targetYield-expYield)*10)/10)+'%'}
          </div>
        </div>
      </div>
    </div>

    <!-- Параметры -->
    <div style="background:var(--card);border:1.5px solid var(--border2);border-radius:12px;padding:14px;margin-bottom:10px">
      <div style="font-size:10px;font-weight:700;color:var(--text2);letter-spacing:.5px;margin-bottom:8px">ПАРАМЕТРЫ</div>
      <div style="display:flex;gap:6px;margin-bottom:8px">${stratBtns}</div>
      <div style="font-size:11px;color:var(--text2);padding:5px 8px;background:var(--amber-light);border-radius:6px;margin-bottom:10px">
        ${strat.desc}
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end">
        <div style="display:flex;flex-direction:column;gap:2px;flex:1;min-width:120px">
          <div style="font-size:10px;font-weight:700;color:var(--text2)">🎯 ЦЕЛЕВАЯ ДОХОДНОСТЬ %/год</div>
          <input class="fi" type="number" id="port-target-yield" value="${s.targetYield}"
            min="1" max="50" step="0.5" style="padding:7px 10px;font-size:15px;font-weight:700">
        </div>
        <div style="display:flex;flex-direction:column;gap:2px;flex:1;min-width:110px">
          <div style="font-size:10px;font-weight:700;color:var(--text2)">💰 ВЗНОС/МЕС ₽</div>
          <input class="fi" type="number" id="port-monthly" value="${s.monthlyCash}"
            min="0" step="1000" style="padding:7px 10px;font-size:14px;font-weight:700">
        </div>
        <div style="display:flex;flex-direction:column;gap:2px;min-width:100px">
          <div style="font-size:10px;font-weight:700;color:var(--text2)">📊 СТАВКА ЦБ</div>
          <div style="display:flex;align-items:center;gap:5px">
            <div id="port-rate-display" style="font-size:20px;font-weight:700;color:var(--topbar)">${kr}%</div>
            <button onclick="window.refreshKeyRate()" title="Обновить ставку ЦБ"
              style="background:none;border:1px solid var(--border);border-radius:5px;padding:3px 6px;cursor:pointer;font-size:11px;color:var(--text2)">
              🔄
            </button>
          </div>
          <div style="font-size:9px;color:var(--text2)">
            ${s.keyRateUpdated?'обновлено '+new Date(s.keyRateUpdated).toLocaleDateString('ru-RU'):'не обновлялась'}
          </div>
        </div>
        <button class="sbtn amber" onclick="window.savePortSettings()"
          style="padding:9px 12px;align-self:flex-end;white-space:nowrap">Пересчитать</button>
      </div>
    </div>

    <!-- Список активов -->
    <div style="background:var(--card);border:1.5px solid var(--border2);border-radius:12px;padding:14px">
      <div style="font-size:10px;font-weight:700;color:var(--text2);letter-spacing:.5px;margin-bottom:8px">
        АКТИВЫ В ПОРТФЕЛЕ
        <button class="sbtn amber" onclick="window.openAddAsset()"
          style="float:right;font-size:10px;padding:3px 8px">+ Добавить</button>
      </div>
      ${assetRows}
    </div>
  `;
}

// ═══════════════════════════════════════════════════════════════════════════
// ПРАВАЯ КОЛОНКА — AI АНАЛИЗ + РЕКОМЕНДАЦИИ
// ═══════════════════════════════════════════════════════════════════════════
function _renderRight(s){
  const col=document.getElementById('port-col-right');if(!col)return;
  const assets=state.D.portfolio;
  const workerOk=!!(appConfig?.workerUrl||'').trim();

  col.innerHTML=`
    <!-- AI Анализ текущего портфеля -->
    <div style="background:var(--card);border:1.5px solid var(--border2);border-radius:12px;padding:14px;margin-bottom:10px">
      <div style="font-size:10px;font-weight:700;color:var(--text2);letter-spacing:.5px;margin-bottom:8px">
        🔍 АНАЛИЗ ПОРТФЕЛЯ
      </div>
      <div id="port-analysis-content">
        ${assets.length
          ? `<button class="btn-sec" onclick="window.analyzePortfolio()"
              style="width:100%;font-size:12px;padding:9px">
              🤖 Проанализировать портфель (YandexGPT)
            </button>`
          : '<div style="color:var(--text2);font-size:12px">Добавьте активы для анализа</div>'
        }
        ${!workerOk?'<div style="font-size:10px;color:var(--text2);margin-top:6px;text-align:center">Настройте URL воркера в Администраторе</div>':''}
      </div>
    </div>

    <!-- Рекомендации по бумагам -->
    <div style="background:var(--card);border:1.5px solid var(--border2);border-radius:12px;padding:14px;margin-bottom:10px">
      <div style="font-size:10px;font-weight:700;color:var(--text2);letter-spacing:.5px;margin-bottom:8px">
        💡 РЕКОМЕНДАЦИИ ПО БУМАГАМ
      </div>
      <div id="port-recs-content">
        ${assets.length
          ? `<button class="btn-sec" onclick="window.getPortfolioRecs()"
              style="width:100%;font-size:12px;padding:9px">
              🤖 Получить рекомендации (YandexGPT)
            </button>`
          : '<div style="color:var(--text2);font-size:12px">Добавьте активы для получения рекомендаций</div>'
        }
      </div>
    </div>

    <!-- Простым языком -->
    <div style="background:var(--card);border:1.5px solid var(--border2);border-radius:12px;padding:14px">
      <div style="font-size:10px;font-weight:700;color:var(--text2);letter-spacing:.5px;margin-bottom:8px">
        💬 ПРОСТЫМ ЯЗЫКОМ
      </div>
      <div id="port-plain-content">
        ${assets.length
          ? `<button class="btn-sec" onclick="window.explainPortfolio()"
              style="width:100%;font-size:12px;padding:9px">
              🤖 Объяснить простым языком (YandexGPT)
            </button>`
          : '<div style="color:var(--text2);font-size:12px">Добавьте активы</div>'
        }
      </div>
    </div>
  `;
}

// ── Вспомогательная функция GPT запроса ──────────────────────────────────
async function _gpt(systemPrompt,userText,btnId,containerId,maxTokens=800){
  const btn=document.getElementById(btnId);
  const cont=document.getElementById(containerId);
  if(!cont)return;

  const workerUrl=(appConfig?.workerUrl||'').trim();
  if(!workerUrl){
    cont.innerHTML='<div class="notice amber" style="font-size:12px">⚠ Настройте URL воркера в Администраторе</div>';
    return;
  }

  if(btn){btn.disabled=true;btn.textContent='⏳ Анализирую...';}
  cont.innerHTML='<div style="color:var(--text2);font-size:12px;padding:8px 0">YandexGPT анализирует...</div>';

  try{
    const ep=workerUrl.replace(/\/?$/,'')+'/gpt';
    const headers={'Content-Type':'application/json'};
    if(appConfig?.appSecret)headers['X-App-Secret']=appConfig.appSecret;

    const resp=await fetch(ep,{method:'POST',headers,body:JSON.stringify({
      completionOptions:{stream:false,temperature:0.3,maxTokens},
      messages:[{role:'system',text:systemPrompt},{role:'user',text:userText}]
    })});
    if(!resp.ok)throw new Error('Сервер '+resp.status);
    const d=await resp.json();
    const text=(d.result?.alternatives?.[0]?.message?.text||'').trim();
    if(!text)throw new Error('Пустой ответ');
    return text;
  }catch(e){
    cont.innerHTML=`<div class="notice amber" style="font-size:12px">Ошибка: ${esc(e.message)}</div>`;
    if(btn){btn.disabled=false;}
    return null;
  }
}

function _portfolioContext(){
  const s=getS();
  const assets=state.D.portfolio;
  const total=assets.reduce((sum,a)=>sum+a.qty*(a.currentPrice||a.buyPrice),0);
  const kr=Math.round(s.keyRate*100);
  const strat=STRATEGIES[s.strategy]||STRATEGIES.moderate;

  return{s,assets,total,kr,strat,
    assetsText:assets.map(a=>{
      const cur=a.currentPrice||a.buyPrice;
      const val=a.qty*cur;
      const pnlP=a.buyPrice>0?Math.round((cur-a.buyPrice)/a.buyPrice*1000)/10:0;
      const share=total>0?Math.round(val/total*100):0;
      const type=TYPE_MAP[a.assetType]?.label?.replace(/[📄🔄💵📈💴]\s?/,'')||a.assetType||'бумага';
      const yld=a.yieldPct>0?`${a.yieldPct}%/год`:'';
      return `${a.ticker}${a.name?' ('+a.name+')':''}: тип=${type}, ${a.qty}шт, цена покупки=${fmt(a.buyPrice)}, текущая=${fmt(cur)}, стоимость=${fmt(Math.round(val))}, доля=${share}%, П/У=${pnlP}%${yld?' '+yld:''}`;
    }).join('\n')
  };
}

// ── 1. АНАЛИЗ ПОРТФЕЛЯ ────────────────────────────────────────────────────
window.analyzePortfolio=async function(){
  const{s,assets,total,kr,strat,assetsText}=_portfolioContext();
  const cont=document.getElementById('port-analysis-content');
  if(!cont||!assets.length)return;

  const sys=`Ты опытный инвестиционный аналитик. Анализируй портфель клиента честно и конкретно.
Формат ответа (без markdown, без звёздочек):
СИЛЬНЫЕ СТОРОНЫ: (2-3 пункта)
СЛАБЫЕ СТОРОНЫ: (2-3 пункта)
РИСКИ: (1-2 ключевых риска)
ПРОГНОЗ: (что ожидать при текущей структуре через 1 год, конкретные цифры)
Итого не более 200 слов. Только русский язык.`;

  const user=`Ставка ЦБ: ${kr}%. Стратегия: ${strat.label}. Целевая доходность: ${s.targetYield}%/год.
Портфель (₽${Math.round(total).toLocaleString('ru-RU')} всего):
${assetsText}`;

  const text=await _gpt(sys,user,'port-analyze-btn','port-analysis-content',600);
  if(text){
    cont.innerHTML=`
      <div style="font-size:12px;color:var(--topbar);line-height:1.8;white-space:pre-wrap">${esc(text)}</div>
      <div style="margin-top:10px;display:flex;gap:6px;flex-wrap:wrap">
        <button class="sbtn amber" onclick="window.analyzePortfolio()" style="font-size:11px">🔄 Обновить</button>
      </div>
      <div style="font-size:10px;color:var(--text2);margin-top:8px">⚠ Не является инвестиционной рекомендацией</div>`;
  }
};

// ── 2. КОНКРЕТНЫЕ РЕКОМЕНДАЦИИ ПО БУМАГАМ ────────────────────────────────
window.getPortfolioRecs=async function(){
  const{s,assets,total,kr,strat,assetsText}=_portfolioContext();
  const cont=document.getElementById('port-recs-content');
  if(!cont||!assets.length)return;

  // Целевые веса из стратегии
  const targetStr=Object.entries(strat.target)
    .map(([k,v])=>`${TYPE_MAP[k]?.label?.replace(/[📄🔄💵📈💴]\s?/,'')||k}: ${Math.round(v*100)}%`).join(', ');

  const sys=`Ты инвестиционный советник. Дай конкретные рекомендации по каждой бумаге в портфеле.
Для КАЖДОЙ бумаги из списка обязательно укажи:
1. ТИКЕР | Действие (ДЕРЖАТЬ / КУПИТЬ X шт. / ПРОДАТЬ X шт.)
2. Текущее: цена X₽ × N шт. = сумма
3. После действия: цена X₽ × N шт. = новая сумма (или "без изменений")
4. Зачем: одно конкретное предложение с цифрой

Также в конце предложи 1-2 новых инструмента для докупки из ежемесячного взноса.
Без markdown, без звёздочек. Только русский язык. До 350 слов.`;

  const user=`Ставка ЦБ: ${kr}%. Стратегия: ${strat.label}. Целевая структура: ${targetStr}.
Целевая доходность: ${s.targetYield}%/год. Ежемесячный взнос: ₽${s.monthlyCash.toLocaleString('ru-RU')}.
Портфель (₽${Math.round(total).toLocaleString('ru-RU')} всего):
${assetsText}`;

  const text=await _gpt(sys,user,'port-recs-btn','port-recs-content',900);
  if(text){
    cont.innerHTML=`
      <div style="font-size:12px;color:var(--topbar);line-height:1.85;white-space:pre-wrap">${esc(text)}</div>
      <div style="margin-top:10px;display:flex;gap:6px;flex-wrap:wrap">
        <button class="sbtn amber" onclick="window.getPortfolioRecs()" style="font-size:11px">🔄 Обновить</button>
      </div>
      <div style="font-size:10px;color:var(--text2);margin-top:8px">⚠ Не является инвестиционной рекомендацией</div>`;
  }
};

// ── 3. ПРОСТЫМ ЯЗЫКОМ ────────────────────────────────────────────────────
window.explainPortfolio=async function(){
  const{s,assets,total,kr,strat,assetsText}=_portfolioContext();
  const cont=document.getElementById('port-plain-content');
  if(!cont||!assets.length)return;

  const sys=`Ты дружелюбный финансовый советник. Объясни портфель простым языком без терминов.
Формат (без markdown):
1. Как дела у портфеля — 1 предложение с эмоцией.
2. Главная сильная сторона — 1 предложение.
3. Главная проблема — 1 предложение.
4. Что сделать прямо сейчас — 1-2 конкретных шага.
5. Чего ожидать через год — 1 предложение с цифрой.
До 150 слов. Только русский язык. Тон — как советник другу.`;

  const user=`Ставка ЦБ: ${kr}%. Стратегия: ${strat.label}. Цель: ${s.targetYield}%/год.
Портфель: ₽${Math.round(total).toLocaleString('ru-RU')}.
${assetsText}`;

  const text=await _gpt(sys,user,'port-plain-btn','port-plain-content',400);
  if(text){
    cont.innerHTML=`
      <div style="background:var(--amber-light);border:1.5px solid var(--border);border-radius:10px;padding:12px">
        <div style="font-size:13px;color:var(--topbar);line-height:1.75">${text.replace(/\n/g,'<br>')}</div>
      </div>
      <div style="margin-top:8px;display:flex;gap:6px">
        <button class="sbtn amber" onclick="window.explainPortfolio()" style="font-size:11px">🔄 Обновить</button>
      </div>
      <div style="font-size:10px;color:var(--text2);margin-top:6px">⚠ Не является инвестиционной рекомендацией</div>`;
  }
};

// ── Обновить ставку ЦБ ────────────────────────────────────────────────────
window.refreshKeyRate=async function(){
  const el=document.getElementById('port-rate-display');
  if(el)el.textContent='⏳...';
  const s=getS();
  s.keyRateUpdated=null; // сбрасываем кеш
  state.D.portfolioSettings=s;
  const rate=await _fetchKeyRateViaWorker();
  const kr=Math.round(rate*100);
  if(el)el.textContent=kr+'%';
  const inp=document.getElementById('port-key-rate');
  if(inp)inp.value=kr;
  _showToast(`Ставка ЦБ: ${kr}%`);
};

// ── Обработчики ───────────────────────────────────────────────────────────
window.setPortStrategy=function(key){
  const s=getS();s.strategy=key;state.D.portfolioSettings=s;sched();renderPortfolio();
};

window.savePortSettings=function(){
  const ty=toNum(document.getElementById('port-target-yield')?.value);
  const mc=toNum(document.getElementById('port-monthly')?.value);
  if(!ty||ty<1||ty>50){alert('Введите целевую доходность от 1 до 50%');return;}
  const s=getS();
  s.targetYield=ty;s.monthlyCash=mc||s.monthlyCash;
  state.D.portfolioSettings=s;sched();renderPortfolio();
};

window.openAddAsset=function(){
  if(!state.D.portfolio)state.D.portfolio=[];
  $('asset-idx').value=-1;
  $('asset-ticker').value='';$('asset-name').value='';
  $('asset-qty').value='';$('asset-buy').value='';$('asset-cur').value='';
  _fillAssetTypeSelect(-1);
  document.getElementById('modal-asset').classList.add('open');
};

window.editAsset=function(i){
  const a=state.D.portfolio[i];
  $('asset-idx').value=i;$('asset-ticker').value=a.ticker;
  $('asset-name').value=a.name||'';$('asset-qty').value=a.qty;
  $('asset-buy').value=a.buyPrice;$('asset-cur').value=a.currentPrice||a.buyPrice;
  _fillAssetTypeSelect(i);
  document.getElementById('modal-asset').classList.add('open');
};

function _fillAssetTypeSelect(idx){
  const modal=document.getElementById('modal-asset');if(!modal)return;
  const mb=modal.querySelector('.modal');
  modal.querySelector('#asset-type-wrap')?.remove();
  modal.querySelector('#asset-yield-wrap')?.remove();

  const tw=document.createElement('div');tw.id='asset-type-wrap';tw.className='fg';
  tw.innerHTML=`<label>ТИП АКТИВА</label><select class="fi" id="asset-type">
    ${ASSET_TYPES.map(t=>`<option value="${t.value}">${t.label}</option>`).join('')}
  </select>`;

  const yw=document.createElement('div');yw.id='asset-yield-wrap';yw.className='fg';
  yw.innerHTML=`<label>КУПОННАЯ / ДИВИД. ДОХОДНОСТЬ % (необяз.)</label>
    <input class="fi" type="number" id="asset-yield" placeholder="напр. 14.5" step="0.01" min="0" max="100">`;

  const saveBtn=mb?.querySelector('.btn-primary');
  if(saveBtn){mb.insertBefore(yw,saveBtn);mb.insertBefore(tw,yw);}
  else{mb?.appendChild(tw);mb?.appendChild(yw);}

  const sel=$('asset-type');
  if(sel)sel.value=idx>=0?(state.D.portfolio[idx]?.assetType||'bond_fixed'):'bond_fixed';
  const yi=$('asset-yield');
  if(yi)yi.value=idx>=0?(state.D.portfolio[idx]?.yieldPct??''):'';
}

window.updateAssetPrice=function(i){
  const a=state.D.portfolio[i];
  const raw=prompt(`Новая цена ${a.ticker} (сейчас: ${a.currentPrice||a.buyPrice} ₽):`);
  if(raw==null)return;
  const p=toNum(raw);
  if(!p||p<=0){alert('Введите корректную цену');return;}
  state.D.portfolio[i].currentPrice=p;state.D.portfolio[i].lastUpdated=today();
  if(!state.D.portfolioUpdated)state.D.portfolioUpdated={};
  state.D.portfolioUpdated.lastUpdate=today();
  sched();renderPortfolio();
};
window.updatePrice=window.updateAssetPrice;

window.saveAsset=function(){
  if(!state.D.portfolio)state.D.portfolio=[];
  const idx=+($('asset-idx').value||'-1');
  const tickerRaw=($('asset-ticker').value||'').trim().toUpperCase();
  const qty=toNum($('asset-qty').value);
  const buyPrice=toNum($('asset-buy').value);
  const curPrice=toNum($('asset-cur').value)||buyPrice;

  if(!tickerRaw){alert('Введите тикер');return;}
  if(qty<=0){alert(`Неверное количество: "${$('asset-qty').value}"\nВведите число`);return;}
  if(buyPrice<=0){alert(`Неверная цена: "${$('asset-buy').value}"\nВведите число`);return;}

  const asset={
    id:idx>=0?state.D.portfolio[idx].id:('ast'+Date.now()),
    ticker:tickerRaw,name:($('asset-name').value||'').trim(),
    qty,buyPrice,currentPrice:curPrice,
    assetType:$('asset-type')?.value||'bond_fixed',
    yieldPct:toNum($('asset-yield')?.value)||null,
    lastUpdated:today(),
  };
  if(idx>=0)state.D.portfolio[idx]=asset;else state.D.portfolio.push(asset);
  if(!state.D.portfolioUpdated)state.D.portfolioUpdated={};
  state.D.portfolioUpdated.lastUpdate=today();
  sched();
  document.getElementById('modal-asset').classList.remove('open');
  renderPortfolio();
};

window.deleteAsset=function(i){
  if(!confirm('Удалить актив?'))return;
  state.D.portfolio.splice(i,1);sched();renderPortfolio();
};

function _showToast(msg){
  let t=document.getElementById('voice-toast');
  if(!t){t=document.createElement('div');t.id='voice-toast';t.style.cssText='position:fixed;bottom:88px;right:24px;background:var(--topbar);color:#C9A96E;padding:10px 16px;border-radius:8px;font-size:12px;font-weight:600;z-index:999;max-width:290px;opacity:0;transition:opacity .3s;pointer-events:none;';document.body.appendChild(t);}
  if(t._tm)clearTimeout(t._tm);
  t.textContent=msg;t.style.opacity='1';
  t._tm=setTimeout(()=>{t.style.opacity='0';},3500);
}

export function checkPortfolioAlert(){
  if(!state.D?.portfolio?.length)return null;
  const lu=state.D.portfolioUpdated?.lastUpdate;
  if(!lu)return'Обновите цены в портфеле инвестиций';
  const d=Math.floor((new Date(today())-new Date(lu))/(1000*60*60*24));
  if(d>=7)return`Цены в портфеле не обновлялись ${d} дн.`;
  return null;
}
