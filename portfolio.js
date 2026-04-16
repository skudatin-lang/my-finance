/**
 * portfolio.js — Инвестиционный портфель
 *
 * АРХИТЕКТУРА:
 * Левая колонка:  сводка + параметры + список активов + структура
 * Правая колонка: AI-анализ + конкретные рекомендации по бумагам + "простым языком"
 *
 * НОВОЕ:
 * 1. Автоматическое получение ставки ЦБ через YandexGPT (кэш 24ч)
 * 2. Типы активов (bond_fixed, bond_floating, etf, stock, cash)
 * 3. Таблица рекомендаций: Купить/Продать/Держать + кол-во + обоснование
 * 4. Целевая доходность в % → автовыбор стратегии
 * 5. AI анализ: сильные/слабые стороны, риски, прогноз
 */
import{$,fmt,state,sched,today,appConfig}from'./core.js';

const esc=s=>String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const toNum=v=>{if(v==null)return 0;const n=parseFloat(String(v).replace(/\s/g,'').replace(',','.'));return isNaN(n)?0:n;};

// ── Типы активов ──────────────────────────────────────────────────────────
const ASSET_TYPES=[
  {value:'bond_fixed',    label:'ОФЗ / фикс. купон',     color:'#4A7C3F', yieldFn:r=>14+r*0},
  {value:'bond_floating', label:'Флоатер (перем. купон)', color:'#5B9BD5', yieldFn:r=>r*100},
  {value:'etf',           label:'ETF / БПИФ (денежный)', color:'#C9A96E', yieldFn:r=>r*100},
  {value:'stock',         label:'Акция',                  color:'#C0392B', yieldFn:r=>15},
  {value:'cash',          label:'Кэш / депозит',          color:'#95a5a6', yieldFn:r=>r*100},
  {value:'currency',      label:'Валюта',                 color:'#8e44ad', yieldFn:r=>3},
];
const TYPE_MAP=Object.fromEntries(ASSET_TYPES.map(t=>[t.value,t]));

// Инструменты для рекомендаций (рекомендуемые аналоги по типу)
const INSTRUMENTS={
  bond_fixed:    {ticker:'ОФЗ 26248', name:'ОФЗ 26248 (фикс. 14.67% YTM)', price:884},
  bond_floating: {ticker:'ОФЗ 29019', name:'ОФЗ 29019 (RUONIA флоатер)',    price:990},
  etf:           {ticker:'LQDT',      name:'ВТБ Ликвидность (денежный ETF)',  price:1},
  stock:         {ticker:'TMOS',      name:'Индекс МосБиржи (TMOS)',          price:6},
  cash:          {ticker:'LQDT',      name:'ВТБ Ликвидность (кэш → ETF)',     price:1},
};

// ── Стратегии ─────────────────────────────────────────────────────────────
const STRATEGIES={
  conservative:{
    label:'Консервативная',icon:'🛡️',
    desc:'Сохранение капитала, доходность чуть выше инфляции, минимальный риск',
    weights:(high)=>high
      ?{bond_fixed:.20,bond_floating:.15,etf:.55,stock:.05,cash:.05,currency:0}
      :{bond_fixed:.45,bond_floating:.10,etf:.30,stock:.10,cash:.05,currency:0},
  },
  moderate:{
    label:'Умеренная',icon:'⚖️',
    desc:'Баланс роста и защиты. Риск умеренный',
    weights:(high)=>high
      ?{bond_fixed:.20,bond_floating:.10,etf:.40,stock:.25,cash:.05,currency:0}
      :{bond_fixed:.30,bond_floating:.05,etf:.20,stock:.40,cash:.05,currency:0},
  },
  aggressive:{
    label:'Агрессивная',icon:'🚀',
    desc:'Максимизация роста. Высокий риск',
    weights:(high)=>high
      ?{bond_fixed:.10,bond_floating:.05,etf:.20,stock:.60,cash:.05,currency:0}
      :{bond_fixed:.15,bond_floating:.00,etf:.10,stock:.70,cash:.05,currency:0},
  },
};

// ── Настройки ─────────────────────────────────────────────────────────────
function getSettings(){
  if(!state.D.portfolioSettings){
    state.D.portfolioSettings={keyRate:.21,monthlyCash:10000,targetYield:10,strategy:null,keyRateUpdated:null};
  }
  const s=state.D.portfolioSettings;
  if(s.targetYield===undefined)s.targetYield=10;
  if(s.strategy===undefined)s.strategy=null;
  return s;
}

// ── Авторасчёт стратегии по targetYield + ставке ─────────────────────────
function calcAutoStrategy(targetYield,keyRate,monthlyCash,total){
  const r=keyRate*100;
  const high=keyRate>=.18;
  // Ожидаемая доходность каждой стратегии при текущей ставке
  const yields={
    conservative: high ? .55*r+.20*14.67+.15*r+.05*15+.05*r : .30*r+.45*13+.10*r+.10*15+.05*r,
    moderate:      high ? .40*r+.20*14.67+.10*r+.25*15+.05*r : .20*r+.30*13+.05*r+.40*15+.05*r,
    aggressive:    high ? .20*r+.10*14.67+.05*r+.60*15+.05*r : .10*r+.15*13+.00*r+.70*15+.05*r,
  };
  const monthlyBonus=total>0?(monthlyCash*12/total)*100:0;
  const effective=Math.max(0,targetYield-monthlyBonus*.5);
  let auto='conservative';
  if(yields.conservative>=effective)auto='conservative';
  else if(yields.moderate>=effective)auto='moderate';
  else auto='aggressive';
  return{auto,yields:Object.fromEntries(Object.entries(yields).map(([k,v])=>[k,Math.round(v*10)/10])),monthlyBonus:Math.round(monthlyBonus*10)/10};
}

// ── Расчёт портфеля ───────────────────────────────────────────────────────
function calcPortfolio(assets,s){
  const total=assets.reduce((sum,a)=>sum+a.qty*(a.currentPrice||a.buyPrice),0);
  const invested=assets.reduce((sum,a)=>sum+a.qty*a.buyPrice,0);
  const pnl=total-invested;
  const pnlPct=invested>0?Math.round(pnl/invested*1000)/10:0;
  // Веса по типу
  const wPct={};
  for(const a of assets){
    const v=a.qty*(a.currentPrice||a.buyPrice);
    const k=a.assetType||'stock';
    wPct[k]=(wPct[k]||0)+(total>0?v/total:0);
  }
  const autoCalc=calcAutoStrategy(s.targetYield,s.keyRate,s.monthlyCash,total);
  const strategy=s.strategy||autoCalc.auto;
  const isAuto=!s.strategy;
  const target=STRATEGIES[strategy].weights(s.keyRate>=.18);
  const deviations={};
  for(const k of Object.keys(target))deviations[k]=(wPct[k]||0)-target[k];
  const totalDev=Object.values(deviations).reduce((s,v)=>s+Math.abs(v),0);
  const score=Math.max(0,Math.round(100-totalDev*200));
  // Текущая взвешенная доходность
  let curYield=0;
  for(const a of assets){
    const v=a.qty*(a.currentPrice||a.buyPrice);
    const w=total>0?v/total:0;
    const t=TYPE_MAP[a.assetType||'stock'];
    const y=a.yieldPct&&a.yieldPct>0?a.yieldPct:t?t.yieldFn(s.keyRate):10;
    curYield+=w*y;
  }
  curYield=Math.round(curYield*10)/10;
  return{total,invested,pnl,pnlPct,wPct,target,deviations,score,curYield,strategy,isAuto,autoCalc};
}

// ── Рекомендации по ребалансировке ────────────────────────────────────────
function buildRecs(assets,calc,s){
  const recs=[];
  const available=s.monthlyCash||0;
  // Продать при избытке > 10%
  for(const[k,dev]of Object.entries(calc.deviations)){
    if(dev<=.10)continue;
    const instr=INSTRUMENTS[k]||INSTRUMENTS.etf;
    const groupVal=calc.total*(calc.wPct[k]||0);
    const amount=Math.round(groupVal*Math.min(dev*1.5,.30));
    if(amount<500)continue;
    const qty=instr.price>0?Math.floor(amount/instr.price):0;
    recs.push({action:'sell',ticker:instr.ticker,name:instr.name,amount,qty,group:k});
  }
  // Купить при дефиците
  const deficits=Object.entries(calc.deviations).filter(([,v])=>v<-.05);
  const totalDef=deficits.reduce((s,[,v])=>s+Math.abs(v),0);
  const cash=available+recs.reduce((s,r)=>r.action==='sell'?s+r.amount:s,0);
  if(totalDef>0&&cash>=500){
    for(const[k,dev]of deficits){
      const amount=Math.round(cash*Math.abs(dev)/totalDef);
      if(amount<500)continue;
      const instr=INSTRUMENTS[k]||INSTRUMENTS.etf;
      const qty=instr.price>0?Math.floor(amount/instr.price):0;
      recs.push({action:'buy',ticker:instr.ticker,name:instr.name,amount,qty,group:k});
    }
  }
  return recs.slice(0,6);
}

// ── Обоснование ───────────────────────────────────────────────────────────
function buildJustification(calc,s,recs){
  const rate=Math.round(s.keyRate*100);
  const high=s.keyRate>=.18;
  const sl=STRATEGIES[calc.strategy];
  const parts=[];
  parts.push(`Цель: ${s.targetYield}% годовых. Текущая ожид. доходность — ${calc.curYield}%.`);
  if(calc.isAuto)parts.push(`При ставке ЦБ ${rate}% система выбрала ${sl.label.toLowerCase()} стратегию (~${calc.autoCalc.yields[calc.strategy]}% ожидаемой доходности).`);
  if(high){
    parts.push(`Высокая ставка ${rate}% делает денежные инструменты (LQDT, флоатеры) очень выгодными: ~${rate}% без риска.`);
    parts.push(`ОФЗ 26248 торгуется с дисконтом (~88% номинала): YTM 14.67% + потенциал роста при снижении ставки до 13%.`);
  }
  if(calc.autoCalc.monthlyBonus>0)parts.push(`Ежемесячный взнос ₽${s.monthlyCash.toLocaleString('ru-RU')} добавляет ~${calc.autoCalc.monthlyBonus}% к эффективной доходности.`);
  if(recs.some(r=>r.action==='sell'))parts.push(`Рекомендуем зафиксировать часть прибыли в перевесе и перераспределить в недовес.`);
  return parts.join(' ');
}

// ── SVG пончик ────────────────────────────────────────────────────────────
function donutSvg(wPct){
  const R=44,r=28,cx=54,cy=54;
  const data=ASSET_TYPES.map(t=>({val:wPct[t.value]||0,color:t.color})).filter(d=>d.val>.01);
  if(!data.length)return'';
  let a=-Math.PI/2;
  const paths=data.map(d=>{
    const end=a+d.val*2*Math.PI;
    const lg=d.val>.5?1:0;
    const p=`M${cx+R*Math.cos(a)},${cy+R*Math.sin(a)} A${R},${R} 0 ${lg},1 ${cx+R*Math.cos(end)},${cy+R*Math.sin(end)} L${cx+r*Math.cos(end)},${cy+r*Math.sin(end)} A${r},${r} 0 ${lg},0 ${cx+r*Math.cos(a)},${cy+r*Math.sin(a)} Z`;
    const res=`<path d="${p}" fill="${d.color}" opacity=".85" stroke="var(--bg)" stroke-width="1.5"/>`;
    a=end;return res;
  }).join('');
  return`<svg width="108" height="108" viewBox="0 0 108 108">${paths}</svg>`;
}

// ── Главный рендер ────────────────────────────────────────────────────────
export function renderPortfolio(){
  if(!state.D)return;
  if(!state.D.portfolio)state.D.portfolio=[];

  const s=getSettings();
  const assets=state.D.portfolio;
  const calc=assets.length?calcPortfolio(assets,s):{total:0,invested:0,pnl:0,pnlPct:0,wPct:{},target:{},deviations:{},score:0,curYield:0,strategy:s.strategy||'moderate',isAuto:!s.strategy,autoCalc:{auto:'moderate',yields:{},monthlyBonus:0}};
  const recs=buildRecs(assets,calc,s);

  // Двухколоночный wrapper
  const pl=$('portfolio-list');if(!pl)return;
  let wrap=document.getElementById('port-two-col');
  if(!wrap){
    wrap=document.createElement('div');
    wrap.id='port-two-col';
    wrap.style.cssText='display:grid;grid-template-columns:1fr 1fr;gap:12px;align-items:start;';
    pl.parentNode.insertBefore(wrap,pl);
    const style=document.createElement('style');
    style.textContent='@media(max-width:700px){#port-two-col{grid-template-columns:1fr!important;}}';
    document.head.appendChild(style);
  }
  wrap.innerHTML='<div id="port-left"></div><div id="port-right"></div>';
  pl.style.display='none';

  // Summary
  const sumEl=$('portfolio-summary');
  if(sumEl)sumEl.style.display='none';

  _renderLeft(assets,calc,s,recs);
  _renderRight(assets,calc,s,recs);

  // Автополучение ставки ЦБ (раз в 24ч)
  _maybeUpdateKeyRate(s);
}

// ── ЛЕВАЯ КОЛОНКА ─────────────────────────────────────────────────────────
function _renderLeft(assets,calc,s,recs){
  const col=document.getElementById('port-left');if(!col)return;
  const high=s.keyRate>=.18;
  const rate=Math.round(s.keyRate*100);
  const sl=STRATEGIES[calc.strategy];

  // Кнопки стратегий
  const stratBtns=Object.entries(STRATEGIES).map(([k,v])=>{
    const active=k===calc.strategy;
    const ey=calc.autoCalc.yields[k]||0;
    return`<button onclick="window.setPortStrategy('${k}')" style="flex:1;padding:7px 4px;border:2px solid ${active?'var(--amber-dark)':'var(--border)'};border-radius:8px;background:${active?'var(--amber-light)':'var(--bg)'};color:${active?'var(--amber-dark)':'var(--text2)'};font-size:10px;font-weight:700;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:2px">
      <span>${v.icon} ${v.label}</span><span style="font-size:9px;opacity:.7">~${ey}%</span></button>`;
  }).join('');

  const isAutoLabel=calc.isAuto
    ?`<span style="font-size:9px;background:var(--green-bg);color:var(--green-dark);padding:1px 6px;border-radius:10px;margin-left:4px">АВТО</span>`
    :`<span style="font-size:9px;background:var(--amber-light);color:var(--amber-dark);padding:1px 6px;border-radius:10px;margin-left:4px">РУЧНАЯ</span>`;

  const goalStatus=calc.curYield>=s.targetYield
    ?`<span style="color:var(--green-dark)">✓ Цель достигнута (${calc.curYield}%)</span>`
    :`<span style="color:${calc.curYield<s.targetYield*.7?'var(--red)':'var(--amber-dark)'}">Сейчас ${calc.curYield}% · нужно ещё +${Math.round((s.targetYield-calc.curYield)*10)/10}%</span>`;

  // Список активов
  const assetRows=assets.length?assets.map((a,i)=>{
    const cur=a.currentPrice||a.buyPrice;
    const val=a.qty*cur;
    const cost=a.qty*a.buyPrice;
    const pnl=val-cost;
    const pnlP=cost>0?Math.round(pnl/cost*1000)/10:0;
    const share=calc.total>0?Math.round(val/calc.total*100):0;
    const tc=TYPE_MAP[a.assetType]?.color||'var(--amber)';
    const pc=pnl>=0?'var(--green-dark)':'var(--red)';
    const stale=a.lastUpdated?Math.floor((Date.now()-new Date(a.lastUpdated+'T12:00:00'))/864e5)>=14:false;
    const aYld=a.yieldPct&&a.yieldPct>0?a.yieldPct:(TYPE_MAP[a.assetType]?.yieldFn(s.keyRate)||10);
    return`<div style="display:flex;align-items:center;gap:7px;padding:8px 0;border-bottom:.5px solid var(--border)">
      <div style="width:3px;height:38px;border-radius:2px;background:${tc};flex-shrink:0"></div>
      <div style="flex:1;min-width:0">
        <div style="font-size:12px;font-weight:700;color:var(--topbar)">${esc(a.ticker)} <span style="font-size:10px;font-weight:400;color:var(--text2)">${esc(a.name||'')}</span>${stale?' <span style="font-size:9px;color:var(--orange-dark)">⏰</span>':''}</div>
        <div style="font-size:10px;color:var(--text2)">${a.qty} шт · ${fmt(a.buyPrice)}/шт · ~${Math.round(aYld*10)/10}%/год</div>
      </div>
      <div style="text-align:right;flex-shrink:0">
        <div style="font-size:12px;font-weight:700;color:var(--topbar)">${fmt(Math.round(val))}</div>
        <div style="font-size:10px;color:${pc}">${pnl>=0?'+':''}${fmt(Math.round(pnl))} (${pnlP}%)</div>
      </div>
      <div style="font-size:11px;font-weight:700;color:var(--text2);min-width:26px;text-align:right">${share}%</div>
      <div style="display:flex;gap:2px;flex-shrink:0">
        <button class="sbtn blue"  onclick="window.editAsset(${i})"        style="font-size:10px;padding:3px 5px">✎</button>
        <button class="sbtn amber" onclick="window.updateAssetPrice(${i})" style="font-size:10px;padding:3px 5px">₽</button>
        <button class="sbtn red"   onclick="window.deleteAsset(${i})"      style="font-size:10px;padding:3px 5px">✕</button>
      </div>
    </div>`;
  }).join(''):`<div style="color:var(--text2);font-size:13px;padding:16px;text-align:center"><div style="font-size:24px;margin-bottom:6px">📋</div>Добавьте первый актив</div>`;

  // Структура
  const structRows=ASSET_TYPES.map(t=>{
    const cur=Math.round((calc.wPct[t.value]||0)*100);
    const tgt=Math.round((calc.target[t.value]||0)*100);
    const dev=cur-tgt;
    const dc=Math.abs(dev)<=5?'var(--green-dark)':Math.abs(dev)<=15?'var(--amber-dark)':'var(--red)';
    return`<div style="margin-bottom:7px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:2px">
        <div style="display:flex;align-items:center;gap:4px">
          <div style="width:8px;height:8px;border-radius:2px;background:${t.color}"></div>
          <span style="font-size:11px;color:var(--topbar)">${t.label}</span>
        </div>
        <div style="font-size:10px;display:flex;gap:5px">
          <span style="color:var(--text2)">факт <b style="color:var(--topbar)">${cur}%</b></span>
          <span style="color:var(--text2)">цель <b>${tgt}%</b></span>
          <span style="font-weight:700;color:${dc};min-width:26px;text-align:right">${dev>0?'+':''}${dev}п.</span>
        </div>
      </div>
      <div style="position:relative;background:var(--g50);border-radius:3px;height:6px">
        <div style="position:absolute;height:6px;border-radius:3px;background:${t.color};opacity:.2;width:${tgt}%"></div>
        <div style="position:absolute;height:6px;border-radius:3px;background:${t.color};width:${Math.min(cur,100)}%;transition:width .3s"></div>
      </div>
    </div>`;
  }).join('');

  col.innerHTML=`
    <!-- Шапка -->
    <div style="background:var(--card);border:1.5px solid var(--border2);border-radius:12px;padding:16px;margin-bottom:10px">
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <div style="flex:2;min-width:150px">
          <div style="font-size:10px;color:var(--text2);font-weight:700;letter-spacing:.5px;margin-bottom:2px">ПОРТФЕЛЬ</div>
          <div style="font-size:26px;font-weight:700;color:var(--topbar)">₽ ${Math.round(calc.total).toLocaleString('ru-RU')}</div>
          <div style="font-size:11px;color:var(--text2);margin-top:2px">
            Вложено ₽ ${Math.round(calc.invested).toLocaleString('ru-RU')}
            <span style="margin-left:6px;font-weight:700;color:${calc.pnl>=0?'var(--green-dark)':'var(--red)'}">
              ${calc.pnl>=0?'+':''}₽${Math.round(calc.pnl).toLocaleString('ru-RU')} (${calc.pnlPct}%)
            </span>
          </div>
        </div>
        <div style="flex:1;min-width:130px">
          <div style="font-size:10px;color:var(--text2);font-weight:700;letter-spacing:.5px;margin-bottom:2px">ЦЕЛЬ / СЕЙЧАС</div>
          <div style="font-size:24px;font-weight:700;color:var(--topbar)">${s.targetYield}%<span style="font-size:12px;color:var(--text2)">/год</span></div>
          <div style="font-size:11px;margin-top:2px">${goalStatus}</div>
        </div>
      </div>
    </div>

    <!-- Параметры -->
    <div style="background:var(--card);border:1.5px solid var(--border2);border-radius:12px;padding:14px;margin-bottom:10px">
      <div style="font-size:10px;font-weight:700;color:var(--text2);letter-spacing:.5px;margin-bottom:8px">ПАРАМЕТРЫ</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">
        <div style="flex:1;min-width:110px">
          <div style="font-size:10px;font-weight:700;color:var(--text2);margin-bottom:3px">🎯 ЦЕЛЕВАЯ ДОХОДНОСТЬ %</div>
          <input class="fi" type="number" id="port-target-yield" value="${s.targetYield}" min="1" max="50" step="0.5" style="padding:7px 10px;font-size:16px;font-weight:700">
        </div>
        <div style="flex:1;min-width:110px">
          <div style="font-size:10px;font-weight:700;color:var(--text2);margin-bottom:3px">💰 ВЗНОС В МЕС. ₽</div>
          <input class="fi" type="number" id="port-monthly" value="${s.monthlyCash}" min="0" step="1000" style="padding:7px 10px;font-size:14px;font-weight:700">
        </div>
        <div style="flex:1;min-width:90px">
          <div style="font-size:10px;font-weight:700;color:var(--text2);margin-bottom:3px">📊 СТАВКА ЦБ %
            <button onclick="window.refreshKeyRate()" style="background:none;border:none;cursor:pointer;font-size:11px;color:var(--amber-dark);padding:0 2px" title="Обновить">🔄</button>
          </div>
          <div style="display:flex;align-items:center;gap:6px">
            <input class="fi" type="number" id="port-key-rate" value="${rate}" min="1" max="50" step="0.25" style="padding:7px 10px;font-size:14px;font-weight:700;max-width:80px">
            <span style="font-size:18px;font-weight:700;color:var(--topbar)">%</span>
            ${high?'<span style="font-size:9px;background:#ffebee;color:var(--red);padding:1px 5px;border-radius:8px">ВЫСОКАЯ</span>':'<span style="font-size:9px;background:var(--green-bg);color:var(--green-dark);padding:1px 5px;border-radius:8px">УМЕРЕННАЯ</span>'}
          </div>
          ${s.keyRateUpdated?`<div style="font-size:9px;color:var(--text2);margin-top:2px">Обновлено: ${s.keyRateUpdated}</div>`:''}
        </div>
        <button class="sbtn amber" onclick="window.savePortSettings()" style="padding:9px 14px;align-self:flex-end;white-space:nowrap">Пересчитать</button>
      </div>
      <div style="font-size:10px;font-weight:700;color:var(--text2);letter-spacing:.5px;margin-bottom:6px">СТРАТЕГИЯ ${isAutoLabel}</div>
      <div style="display:flex;gap:6px;margin-bottom:8px">${stratBtns}</div>
      <div style="font-size:11px;color:var(--text2);padding:6px 8px;background:var(--amber-light);border-radius:6px">
        <b>${sl.icon} ${sl.label}:</b> ${sl.desc}
      </div>
      ${calc.isAuto?`<div style="font-size:10px;color:var(--text2);padding:5px 8px;background:var(--green-bg);border-radius:6px;margin-top:5px">
        ✓ Авторасчёт: для ${s.targetYield}% при ставке ${rate}% выбрана ${sl.label.toLowerCase()} (~${calc.autoCalc.yields[calc.strategy]}%/год).
        <a href="#" onclick="window.setPortStrategy(window._lastPortStrategy||'moderate');return false" style="color:var(--amber-dark);font-weight:700;margin-left:4px">Задать вручную →</a>
      </div>`:
      `<div style="font-size:10px;color:var(--text2);padding:5px 8px;background:var(--amber-light);border-radius:6px;margin-top:5px">
        ⚙️ Стратегия задана вручную.
        <a href="#" onclick="window.resetPortStrategy();return false" style="color:var(--amber-dark);font-weight:700;margin-left:4px">Сбросить на авто →</a>
      </div>`}
    </div>

    <!-- Активы -->
    <div style="background:var(--card);border:1.5px solid var(--border2);border-radius:12px;padding:14px;margin-bottom:10px">
      <div style="font-size:10px;font-weight:700;color:var(--text2);letter-spacing:.5px;margin-bottom:8px">АКТИВЫ В ПОРТФЕЛЕ</div>
      ${assetRows}
    </div>

    <!-- Структура -->
    <div style="background:var(--card);border:1.5px solid var(--border2);border-radius:12px;padding:14px">
      <div style="font-size:10px;font-weight:700;color:var(--text2);letter-spacing:.5px;margin-bottom:10px">ТЕКУЩАЯ СТРУКТУРА · баланс <span style="font-weight:700;color:${calc.score>=70?'var(--green-dark)':calc.score>=40?'var(--amber-dark)':'var(--red)'}">${calc.score}/100</span></div>
      <div style="display:flex;gap:12px;align-items:flex-start;flex-wrap:wrap">
        ${calc.total>0?`<div style="flex-shrink:0">${donutSvg(calc.wPct)}</div>`:''}
        <div style="flex:1;min-width:160px">${structRows}</div>
      </div>
    </div>
  `;
}

// ── ПРАВАЯ КОЛОНКА ────────────────────────────────────────────────────────
function _renderRight(assets,calc,s,recs){
  const col=document.getElementById('port-right');if(!col)return;
  const workerUrl=(appConfig?.workerUrl||'').trim();

  // Таблица рекомендаций
  const recRows=recs.length?recs.map(r=>{
    const isBuy=r.action==='buy';
    const bg=isBuy?'#E8F5E9':'#FFEBEE';
    const color=isBuy?'var(--green-dark)':'var(--red)';
    const label=isBuy?'Купить':'Продать';
    const instr=INSTRUMENTS[r.group];
    const curQty=assets.filter(a=>(a.assetType||'stock')===r.group).reduce((s,a)=>s+a.qty,0);
    const afterQty=isBuy?curQty+r.qty:Math.max(0,curQty-r.qty);
    return`<div style="display:grid;grid-template-columns:60px 1fr 80px 60px;gap:6px;align-items:center;padding:9px 10px;background:${bg};border-radius:8px;margin-bottom:5px">
      <div style="font-size:10px;font-weight:700;color:${color};text-align:center;padding:2px 4px;background:${isBuy?'rgba(74,124,63,.15)':'rgba(192,57,43,.15)'};border-radius:5px">${label}</div>
      <div>
        <div style="font-size:12px;font-weight:700;color:var(--topbar)">${esc(r.ticker)}</div>
        <div style="font-size:10px;color:var(--text2)">${esc(r.name)}</div>
      </div>
      <div style="font-size:11px;font-weight:700;color:var(--topbar);text-align:right">${fmt(r.amount)}</div>
      <div style="font-size:10px;color:var(--text2);text-align:right">${r.qty>0?r.qty+' шт':'—'}</div>
    </div>`;
  }).join(''):
  `<div style="background:var(--green-bg);border:1px solid rgba(74,124,63,.2);border-radius:8px;padding:12px;font-size:12px;color:var(--green-dark);font-weight:700">✅ Ребалансировка не нужна — портфель соответствует стратегии</div>`;

  // Итоговая целевая структура
  const targetRows=ASSET_TYPES.filter(t=>(calc.target[t.value]||0)>0).map(t=>{
    const tgt=Math.round((calc.target[t.value]||0)*100);
    return`<div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:.5px solid var(--border)">
      <div style="display:flex;align-items:center;gap:5px">
        <div style="width:8px;height:8px;border-radius:2px;background:${t.color}"></div>
        <span style="font-size:12px;color:var(--topbar)">${t.label}</span>
      </div>
      <div style="display:flex;align-items:center;gap:8px">
        <div style="width:70px;background:var(--g50);border-radius:3px;height:5px">
          <div style="height:5px;border-radius:3px;background:${t.color};width:${tgt}%"></div>
        </div>
        <span style="font-size:12px;font-weight:700;color:var(--topbar);min-width:26px;text-align:right">${tgt}%</span>
      </div>
    </div>`;
  }).join('');

  // Обоснование
  const just=buildJustification(calc,s,recs);

  col.innerHTML=`
    <!-- Рекомендации -->
    <div style="background:var(--card);border:1.5px solid var(--border2);border-radius:12px;padding:14px;margin-bottom:10px">
      <div style="font-size:10px;font-weight:700;color:var(--text2);letter-spacing:.5px;margin-bottom:8px">РЕКОМЕНДАЦИИ</div>
      <div style="display:grid;grid-template-columns:60px 1fr 80px 60px;gap:6px;padding:0 10px 6px;border-bottom:1px solid var(--border)">
        <div style="font-size:9px;font-weight:700;color:var(--text2)">ДЕЙСТВИЕ</div>
        <div style="font-size:9px;font-weight:700;color:var(--text2)">НАИМЕНОВАНИЕ</div>
        <div style="font-size:9px;font-weight:700;color:var(--text2);text-align:right">СУММА</div>
        <div style="font-size:9px;font-weight:700;color:var(--text2);text-align:right">КОЛ-ВО</div>
      </div>
      <div style="margin-top:6px">${recRows}</div>
    </div>

    <!-- Обоснование -->
    <div style="background:#E8F4FD;border:1.5px solid #B3D9F0;border-radius:12px;padding:14px;margin-bottom:10px">
      <div style="font-size:10px;font-weight:700;color:#1A6B9A;letter-spacing:.5px;margin-bottom:8px">ОБОСНОВАНИЕ</div>
      <div style="font-size:12px;color:var(--topbar);line-height:1.7">${just}</div>
    </div>

    <!-- Итоговая структура -->
    <div style="background:var(--card);border:1.5px solid var(--border2);border-radius:12px;padding:14px;margin-bottom:10px">
      <div style="font-size:10px;font-weight:700;color:var(--text2);letter-spacing:.5px;margin-bottom:10px">ЦЕЛЕВАЯ СТРУКТУРА ПОРТФЕЛЯ</div>
      ${targetRows}
    </div>

    <!-- AI анализ -->
    <div style="background:var(--card);border:1.5px solid var(--border2);border-radius:12px;padding:14px;margin-bottom:10px" id="port-analysis-block">
      <div style="font-size:10px;font-weight:700;color:var(--text2);letter-spacing:.5px;margin-bottom:10px">🔍 АНАЛИЗ ПОРТФЕЛЯ</div>
      <button id="btn-portfolio-analysis" onclick="window.runPortfolioAnalysis()" style="width:100%;padding:10px;border:1.5px solid var(--amber);border-radius:8px;background:var(--amber-light);color:var(--topbar);font-size:12px;font-weight:700;cursor:pointer">
        🤖 Запустить AI-анализ (YandexGPT)
      </button>
      ${!workerUrl?'<div style="font-size:10px;color:var(--text2);margin-top:6px;text-align:center">Настройте URL воркера в Администраторе</div>':''}
      <div id="port-analysis-result" style="margin-top:10px"></div>
    </div>

    <!-- Простым языком -->
    <div style="background:var(--card);border:1.5px solid var(--border2);border-radius:12px;padding:14px">
      <div style="font-size:10px;font-weight:700;color:var(--text2);letter-spacing:.5px;margin-bottom:10px">💬 ПРОСТЫМ ЯЗЫКОМ</div>
      <button id="btn-portfolio-explain" onclick="window.explainPortfolio()" style="width:100%;padding:10px;border:1.5px solid var(--border);border-radius:8px;background:var(--bg);color:var(--topbar);font-size:12px;font-weight:700;cursor:pointer">
        🗣️ Объяснить как советник другу
      </button>
      <div id="portfolio-llm-result" style="margin-top:10px"></div>
    </div>
  `;
}

// ── Автообновление ставки ЦБ через YandexGPT ─────────────────────────────
async function _maybeUpdateKeyRate(s){
  const workerUrl=(appConfig?.workerUrl||'').trim();
  if(!workerUrl)return;
  // Кэш 24 часа
  if(s.keyRateUpdated){
    const updated=new Date(s.keyRateUpdated+'T12:00:00');
    const diffH=(Date.now()-updated.getTime())/3600000;
    if(diffH<24)return;
  }
  try{
    const ep=workerUrl.replace(/\/?$/,'')+'/gpt';
    const h={'Content-Type':'application/json'};
    if(appConfig?.appSecret)h['X-App-Secret']=appConfig.appSecret;
    const resp=await fetch(ep,{method:'POST',headers:h,body:JSON.stringify({
      completionOptions:{stream:false,temperature:0,maxTokens:50},
      messages:[
        {role:'system',text:'Отвечай ТОЛЬКО числом без символов и пояснений.'},
        {role:'user',text:'Какова ключевая ставка Банка России прямо сейчас в процентах? Только число, например: 21'}
      ]
    })});
    if(!resp.ok)return;
    const d=await resp.json();
    const t=(d.result?.alternatives?.[0]?.message?.text||'').trim();
    const rate=parseFloat(t);
    if(!isNaN(rate)&&rate>=1&&rate<=50){
      s.keyRate=rate/100;
      s.keyRateUpdated=today();
      state.D.portfolioSettings=s;
      sched();
      // Обновляем поле на экране
      const el=document.getElementById('port-key-rate');
      if(el)el.value=rate;
      console.log('[portfolio] ставка ЦБ обновлена:',rate+'%');
    }
  }catch(e){console.warn('[portfolio] keyRate update:',e.message);}
}

window.refreshKeyRate=async function(){
  const s=getSettings();
  s.keyRateUpdated=null; // сбрасываем кэш
  state.D.portfolioSettings=s;
  await _maybeUpdateKeyRate(s);
  renderPortfolio();
};

// ── Обработчики ───────────────────────────────────────────────────────────
window.setPortStrategy=function(key){
  window._lastPortStrategy=key;
  const s=getSettings();s.strategy=key;
  state.D.portfolioSettings=s;sched();renderPortfolio();
};
window.resetPortStrategy=function(){
  const s=getSettings();s.strategy=null;
  state.D.portfolioSettings=s;sched();renderPortfolio();
};
window.savePortSettings=function(){
  const kr=toNum(document.getElementById('port-key-rate')?.value)/100;
  const mc=toNum(document.getElementById('port-monthly')?.value);
  const ty=toNum(document.getElementById('port-target-yield')?.value);
  if(!kr||kr<.01||kr>.5){alert('Введите ставку от 1 до 50');return;}
  if(!ty||ty<1||ty>50){alert('Введите целевую доходность от 1 до 50%');return;}
  const s=getSettings();
  s.keyRate=kr;s.monthlyCash=mc;s.targetYield=ty;
  state.D.portfolioSettings=s;sched();renderPortfolio();
};

// ── Управление активами ───────────────────────────────────────────────────
window.openAddAsset=function(){
  if(!state.D.portfolio)state.D.portfolio=[];
  $('asset-idx').value=-1;
  $('asset-ticker').value='';$('asset-name').value='';
  $('asset-qty').value='';$('asset-buy').value='';$('asset-cur').value='';
  _fillTypeSelect(-1);
  document.getElementById('modal-asset').classList.add('open');
};
window.editAsset=function(i){
  const a=state.D.portfolio[i];
  $('asset-idx').value=i;$('asset-ticker').value=a.ticker;
  $('asset-name').value=a.name||'';$('asset-qty').value=a.qty;
  $('asset-buy').value=a.buyPrice;$('asset-cur').value=a.currentPrice||a.buyPrice;
  _fillTypeSelect(i);
  document.getElementById('modal-asset').classList.add('open');
};

function _fillTypeSelect(idx){
  const modal=document.getElementById('modal-asset');if(!modal)return;
  modal.querySelector('#asset-type-wrap')?.remove();
  modal.querySelector('#asset-yield-wrap')?.remove();
  const typeWrap=document.createElement('div');typeWrap.id='asset-type-wrap';typeWrap.className='fg';
  typeWrap.innerHTML=`<label>ТИП АКТИВА</label><select class="fi" id="asset-type">
    ${ASSET_TYPES.map(t=>`<option value="${t.value}">${t.label}</option>`).join('')}
  </select>`;
  const yieldWrap=document.createElement('div');yieldWrap.id='asset-yield-wrap';yieldWrap.className='fg';
  yieldWrap.innerHTML=`<label>КУПОННАЯ / ДИВИД. ДОХОДНОСТЬ % (необяз.)</label>
    <input class="fi" type="number" id="asset-yield" placeholder="напр. 14.67" step="0.01" min="0" max="100">`;
  const saveBtn=modal.querySelector('.btn-primary');
  if(saveBtn){modal.querySelector('.modal').insertBefore(yieldWrap,saveBtn);modal.querySelector('.modal').insertBefore(typeWrap,yieldWrap);}
  const sel=document.getElementById('asset-type');
  if(sel)sel.value=idx>=0?(state.D.portfolio[idx]?.assetType||'bond_fixed'):'bond_fixed';
  const yi=document.getElementById('asset-yield');
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
  const ticker=($('asset-ticker').value||'').trim().toUpperCase();
  const qty=toNum($('asset-qty').value);
  const buyPrice=toNum($('asset-buy').value);
  const curPrice=toNum($('asset-cur').value)||buyPrice;
  if(!ticker){alert('Введите тикер');return;}
  if(qty<=0){alert('Введите количество');return;}
  if(buyPrice<=0){alert('Введите цену покупки');return;}
  const asset={
    id:idx>=0?state.D.portfolio[idx].id:('ast'+Date.now()),
    ticker,name:($('asset-name').value||'').trim(),
    qty,buyPrice,currentPrice:curPrice,
    assetType:document.getElementById('asset-type')?.value||'bond_fixed',
    yieldPct:toNum(document.getElementById('asset-yield')?.value)||null,
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

// ── AI Анализ портфеля ────────────────────────────────────────────────────
window.runPortfolioAnalysis=async function(){
  const resultEl=document.getElementById('port-analysis-result');
  const btn=document.getElementById('btn-portfolio-analysis');
  if(!resultEl)return;
  const workerUrl=(appConfig?.workerUrl||'').trim();
  if(!workerUrl){resultEl.innerHTML='<div class="notice amber" style="font-size:12px">⚠ Настройте URL воркера в Администраторе</div>';return;}
  if(btn){btn.disabled=true;btn.textContent='⏳ Анализирую портфель...';}
  resultEl.innerHTML='<div style="color:var(--text2);font-size:12px;padding:8px 0">Анализирую...</div>';

  const s=getSettings();
  const assets=state.D.portfolio||[];
  const calc=calcPortfolio(assets,s);
  const recs=buildRecs(assets,calc,s);
  const rate=Math.round(s.keyRate*100);
  const sl=STRATEGIES[calc.strategy];

  const sys=`Ты опытный финансовый аналитик. Отвечай кратко, структурированно, без сложных терминов.
Используй маркеры ✅ (хорошо) и ⚠ (риск) для пунктов.
Структура ответа (строго):
**СИЛЬНЫЕ СТОРОНЫ**
✅ пункт
✅ пункт

**СЛАБЫЕ СТОРОНЫ**
⚠ пункт
⚠ пункт

**ГЛАВНЫЕ РИСКИ**
⚠ риск 1
⚠ риск 2

**ПРОГНОЗ НА ГОД**
Один абзац простыми словами.

Максимум 200 слов. Только русский язык.`;

  const user=`Ставка ЦБ: ${rate}%. Стратегия: ${sl.label}. Цель: ${s.targetYield}%/год. Сейчас: ${calc.curYield}%/год.
Портфель: ₽${Math.round(calc.total).toLocaleString('ru-RU')}, вложено ₽${Math.round(calc.invested).toLocaleString('ru-RU')}, П/У ${calc.pnlPct}%.
Баланс портфеля: ${calc.score}/100.
Структура: ${ASSET_TYPES.filter(t=>(calc.wPct[t.value]||0)>.01).map(t=>`${t.label} ${Math.round((calc.wPct[t.value]||0)*100)}%`).join(', ')||'нет активов'}.
Активы: ${assets.map(a=>`${a.ticker} (${TYPE_MAP[a.assetType]?.label||a.assetType}, ${a.qty}шт, П/У ${a.qty>0?Math.round(((a.currentPrice||a.buyPrice)-a.buyPrice)/a.buyPrice*100):0}%)`).join('; ')||'нет'}.
Отклонения от цели: ${Object.entries(calc.deviations).filter(([,v])=>Math.abs(v)>.05).map(([k,v])=>`${k} ${v>0?'+':''}${Math.round(v*100)}п.п.`).join(', ')||'нет'}.`;

  try{
    const ep=workerUrl.replace(/\/?$/,'')+'/gpt';
    const h={'Content-Type':'application/json'};
    if(appConfig?.appSecret)h['X-App-Secret']=appConfig.appSecret;
    const resp=await fetch(ep,{method:'POST',headers:h,body:JSON.stringify({
      completionOptions:{stream:false,temperature:0.3,maxTokens:600},
      messages:[{role:'system',text:sys},{role:'user',text:user}]
    })});
    if(!resp.ok)throw new Error('Сервер '+resp.status);
    const d=await resp.json();
    const text=(d.result?.alternatives?.[0]?.message?.text||'').trim();
    if(!text)throw new Error('Пустой ответ');
    // Рендерим маркдаун-подобный текст
    const html=text
      .replace(/\*\*(.+?)\*\*/g,'<div style="font-size:11px;font-weight:700;color:var(--topbar);letter-spacing:.5px;margin:10px 0 5px">$1</div>')
      .replace(/✅/g,'<span style="color:var(--green-dark)">✅</span>')
      .replace(/⚠/g,'<span style="color:var(--orange-dark)">⚠️</span>')
      .replace(/\n/g,'<br>');
    resultEl.innerHTML=`
      <div style="background:var(--amber-light);border:1.5px solid var(--border);border-radius:10px;padding:14px;margin-top:8px">
        <div style="font-size:10px;font-weight:700;color:var(--text2);margin-bottom:8px">🤖 YANDEXGPT</div>
        <div style="font-size:12px;color:var(--topbar);line-height:1.7">${html}</div>
        <div style="font-size:10px;color:var(--text2);margin-top:10px;border-top:1px solid var(--border);padding-top:6px">⚠ Не является инвестиционной рекомендацией</div>
      </div>`;
  }catch(e){
    resultEl.innerHTML=`<div class="notice amber" style="font-size:12px">Ошибка: ${e.message}</div>`;
  }finally{
    if(btn){btn.disabled=false;btn.textContent='🤖 Запустить AI-анализ (YandexGPT)';}
  }
};

// ── Объяснение простым языком ─────────────────────────────────────────────
window.explainPortfolio=async function(){
  const resultEl=document.getElementById('portfolio-llm-result');
  const btn=document.getElementById('btn-portfolio-explain');
  if(!resultEl)return;
  const workerUrl=(appConfig?.workerUrl||'').trim();
  if(!workerUrl){resultEl.innerHTML='<div class="notice amber" style="font-size:12px">⚠ Настройте URL воркера</div>';return;}
  if(btn){btn.disabled=true;btn.textContent='⏳ Думаю...';}
  resultEl.innerHTML='<div style="color:var(--text2);font-size:12px">...</div>';

  const s=getSettings();
  const assets=state.D.portfolio||[];
  const calc=assets.length?calcPortfolio(assets,s):{total:0,curYield:0,score:0,strategy:'moderate',pnlPct:0};
  const recs=assets.length?buildRecs(assets,calc,s):[];
  const rate=Math.round(s.keyRate*100);

  const sys=`Ты дружелюбный финансовый советник. Объясни инвестиции как другу — просто, без терминов.
Структура (без заголовков):
1. Рынок сейчас — 1 предложение.
2. Главная проблема или достижение портфеля — 1 предложение.
3. Что сделать прямо сейчас — 2-3 конкретных шага с тикерами.
4. Как это приближает к цели ${s.targetYield}% — 1 предложение.
5. Главный риск — 1 предложение.
До 150 слов. Только русский.`;

  const user=`Цель: ${s.targetYield}%/год. Портфель сейчас даёт ${calc.curYield}%. Ставка ЦБ ${rate}%.
Активы: ${assets.map(a=>`${a.ticker} x${a.qty}`).join(', ')||'нет'}.
Рекомендации системы: ${recs.map(r=>`${r.action==='buy'?'купить':'продать'} ${r.ticker} на ₽${r.amount}`).join('; ')||'ребалансировка не нужна'}.`;

  try{
    const ep=workerUrl.replace(/\/?$/,'')+'/gpt';
    const h={'Content-Type':'application/json'};
    if(appConfig?.appSecret)h['X-App-Secret']=appConfig.appSecret;
    const resp=await fetch(ep,{method:'POST',headers:h,body:JSON.stringify({
      completionOptions:{stream:false,temperature:0.4,maxTokens:300},
      messages:[{role:'system',text:sys},{role:'user',text:user}]
    })});
    if(!resp.ok)throw new Error('Сервер '+resp.status);
    const d=await resp.json();
    const text=(d.result?.alternatives?.[0]?.message?.text||'').trim();
    if(!text)throw new Error('Пустой ответ');
    resultEl.innerHTML=`
      <div style="background:var(--card);border:1.5px solid var(--border);border-radius:10px;padding:14px;margin-top:8px">
        <div style="font-size:10px;font-weight:700;color:var(--text2);margin-bottom:8px">💬 СОВЕТНИК ГОВОРИТ</div>
        <div style="font-size:13px;color:var(--topbar);line-height:1.8">${text.replace(/\n/g,'<br>')}</div>
        <div style="font-size:10px;color:var(--text2);margin-top:8px">⚠ Не является инвестиционной рекомендацией</div>
      </div>`;
  }catch(e){
    resultEl.innerHTML=`<div class="notice amber" style="font-size:12px">Ошибка: ${e.message}</div>`;
  }finally{
    if(btn){btn.disabled=false;btn.textContent='🗣️ Объяснить как советник другу';}
  }
};

// ── Алерт дашборда ────────────────────────────────────────────────────────
export function checkPortfolioAlert(){
  if(!state.D?.portfolio?.length)return null;
  const lu=state.D.portfolioUpdated?.lastUpdate;
  if(!lu)return'Обновите цены в портфеле инвестиций';
  const d=Math.floor((new Date(today())-new Date(lu))/(1000*60*60*24));
  if(d>=7)return`Цены в портфеле не обновлялись ${d} дн.`;
  const s=getSettings();
  if(state.D.portfolio.length>0){
    const calc=calcPortfolio(state.D.portfolio,s);
    if(!calc||calc.curYield<s.targetYield&&calc.curYield<s.targetYield*.7)
      return`Портфель не достигает цели ${s.targetYield}% — откройте «Портфель»`;
  }
  return null;
}
