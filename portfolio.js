/**
 * portfolio.js — Инвестиционный портфель
 *
 * Двухколоночный layout:
 *   Левая:  шапка + параметры стратегии + список активов + текущая структура
 *   Правая: 🔍 Анализ портфеля + 💡 Рекомендации + 📊 Итоговая структура + 💬 Простым языком
 *
 * Все AI-блоки — через YandexGPT (тот же воркер /gpt)
 * Ставка ЦБ — автоматически через GPT, кэш 24ч
 */
import{$,fmt,state,sched,today,appConfig}from'./core.js';

const esc=s=>String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const toNum=v=>{if(v==null)return 0;const n=parseFloat(String(v).replace(/\s/g,'').replace(',','.'));return isNaN(n)?0:n;};

// ── Типы активов ──────────────────────────────────────────────────────────
const TYPES=[
  {v:'bond_fixed',   l:'📄 ОФЗ / фикс. купон',    color:'#4A7C3F', yld:14.67},
  {v:'bond_floating',l:'🔄 Флоатер (перем. купон)',color:'#5B9BD5', yld:21},
  {v:'etf',          l:'💵 ETF / БПИФ',            color:'#C9A96E', yld:21},
  {v:'stock',        l:'📈 Акция',                  color:'#C0392B', yld:15},
  {v:'cash',         l:'💴 Кэш / депозит',          color:'#95a5a6', yld:21},
  {v:'currency',     l:'💶 Валюта',                  color:'#8e44ad', yld:3},
];
const TM=Object.fromEntries(TYPES.map(t=>[t.v,t]));

// ── Стратегии ─────────────────────────────────────────────────────────────
const STRATS={
  conservative:{l:'Консервативная',icon:'🛡️',desc:'Сохранение капитала, доходность чуть выше инфляции',
    hi:{bond_fixed:.20,bond_floating:.15,etf:.55,stock:.05,cash:.05,currency:0},
    lo:{bond_fixed:.45,bond_floating:.10,etf:.30,stock:.10,cash:.05,currency:0}},
  moderate:{l:'Умеренная',icon:'⚖️',desc:'Баланс роста и защиты',
    hi:{bond_fixed:.20,bond_floating:.10,etf:.40,stock:.25,cash:.05,currency:0},
    lo:{bond_fixed:.30,bond_floating:.05,etf:.20,stock:.40,cash:.05,currency:0}},
  aggressive:{l:'Агрессивная',icon:'🚀',desc:'Максимизация роста, высокий риск',
    hi:{bond_fixed:.10,bond_floating:.05,etf:.20,stock:.60,cash:.05,currency:0},
    lo:{bond_fixed:.15,bond_floating:.00,etf:.10,stock:.70,cash:.05,currency:0}},
};

// ── Настройки ─────────────────────────────────────────────────────────────
function getS(){
  if(!state.D.portfolioSettings)state.D.portfolioSettings={keyRate:.21,targetYield:10,monthlyCash:10000,strategy:null};
  const s=state.D.portfolioSettings;
  if(!s.keyRate)s.keyRate=.21;if(!s.targetYield)s.targetYield=10;if(!s.monthlyCash)s.monthlyCash=10000;
  return s;
}

// ── Целевые веса ──────────────────────────────────────────────────────────
function getTarget(strat,keyRate){
  const S=STRATS[strat]||STRATS.moderate;
  return keyRate>=.18?S.hi:S.lo;
}

// ── Авторасчёт стратегии по целевой доходности ────────────────────────────
function autoStrategy(targetYield,keyRate,monthlyCash,total){
  const r=keyRate*100;
  const high=keyRate>=.18;
  const ylds={
    conservative: high?.55*r+.20*14.67+.15*r+.05*15+.05*r : .30*r+.45*13+.10*r+.10*15+.05*r,
    moderate:     high?.40*r+.20*14.67+.10*r+.25*15+.05*r : .20*r+.30*13+.05*r+.40*15+.05*r,
    aggressive:   high?.20*r+.10*14.67+.05*r+.60*15+.05*r : .10*r+.15*13+.00*r+.70*15+.05*r,
  };
  const bonus=total>0?(monthlyCash*12/total)*100:0;
  const eff=Math.max(0,targetYield-bonus*.5);
  let auto='conservative';
  if(ylds.conservative>=eff)auto='conservative';
  else if(ylds.moderate>=eff)auto='moderate';
  else auto='aggressive';
  return{auto,ylds:Object.fromEntries(Object.entries(ylds).map(([k,v])=>[k,Math.round(v*10)/10])),bonus:Math.round(bonus*10)/10};
}

// ── Расчёт портфеля ───────────────────────────────────────────────────────
function calc(assets,s){
  const total=assets.reduce((sum,a)=>sum+a.qty*(a.currentPrice||a.buyPrice),0);
  const invested=assets.reduce((sum,a)=>sum+a.qty*a.buyPrice,0);
  const pnl=total-invested;
  const pnlPct=invested>0?Math.round(pnl/invested*1000)/10:0;
  const wPct={};
  for(const a of assets){const v=a.qty*(a.currentPrice||a.buyPrice);const k=a.assetType||'stock';wPct[k]=(wPct[k]||0)+(total>0?v/total:0);}
  let curYield=0;
  for(const a of assets){const v=a.qty*(a.currentPrice||a.buyPrice);const w=total>0?v/total:0;const y=a.yieldPct&&a.yieldPct>0?a.yieldPct:(TM[a.assetType||'stock']?.yld||10);curYield+=w*y;}
  curYield=Math.round(curYield*10)/10;
  const autoC=autoStrategy(s.targetYield,s.keyRate,s.monthlyCash,total);
  const strat=s.strategy||autoC.auto;
  const target=getTarget(strat,s.keyRate);
  const deviations={};
  for(const k of Object.keys(target))deviations[k]=(wPct[k]||0)-target[k];
  const totalDev=Object.values(deviations).reduce((s,v)=>s+Math.abs(v),0);
  const score=Math.max(0,Math.round(100-totalDev*200));
  return{total,invested,pnl,pnlPct,wPct,target,deviations,score,curYield,strat,isAuto:!s.strategy,autoC};
}

// ── Рекомендации по бумагам ───────────────────────────────────────────────
function buildRecs(c,s){
  const recs=[];
  const cash=s.monthlyCash||0;
  // Продать при избытке >10%
  for(const[k,dev]of Object.entries(c.deviations)){
    if(dev<=.10)continue;
    const amount=Math.round(c.total*(c.wPct[k]||0)*Math.min(dev*1.5,.30));
    if(amount<500)continue;
    recs.push({action:'sell',group:k,amount});
  }
  // Купить при дефиците
  const defs=Object.entries(c.deviations).filter(([,v])=>v<-.05);
  const totalDef=defs.reduce((s,[,v])=>s+Math.abs(v),0);
  const avail=cash+recs.filter(r=>r.action==='sell').reduce((s,r)=>s+r.amount,0);
  if(totalDef>0&&avail>=500){
    for(const[k,dev]of defs){
      const amount=Math.round(avail*Math.abs(dev)/totalDef);
      if(amount<500)continue;
      recs.push({action:'buy',group:k,amount});
    }
  }
  return recs.slice(0,5);
}

// ── Инструменты для рекомендаций ──────────────────────────────────────────
const INSTR={
  bond_fixed:   {ticker:'ОФЗ 26248',name:'ОФЗ 26248 (май 2040)',price:884},
  bond_floating:{ticker:'ОФЗ 29019',name:'ОФЗ 29019 (RUONIA)',  price:990},
  etf:          {ticker:'LQDT',     name:'ВТБ Ликвидность',     price:1},
  stock:        {ticker:'TMOS',     name:'Индекс МосБиржи',     price:6},
  cash:         {ticker:'LQDT',     name:'ВТБ Ликвидность',     price:1},
};

// ── ГЛАВНЫЙ РЕНДЕР ────────────────────────────────────────────────────────
export function renderPortfolio(){
  if(!state.D)return;
  if(!state.D.portfolio)state.D.portfolio=[];
  const assets=state.D.portfolio;
  const s=getS();
  const c=calc(assets,s);

  // Двухколоночный wrapper
  let wrap=$('port-two-col');
  if(!wrap){
    const anchor=$('portfolio-list');if(!anchor)return;
    wrap=document.createElement('div');wrap.id='port-two-col';
    wrap.style.cssText='display:grid;grid-template-columns:1fr 1fr;gap:12px;align-items:start;';
    anchor.parentNode.insertBefore(wrap,anchor);
    const style=document.createElement('style');
    style.textContent='@media(max-width:700px){#port-two-col{grid-template-columns:1fr!important;}}';
    document.head.appendChild(style);
  }
  wrap.innerHTML='<div id="p-left"></div><div id="p-right"></div>';
  const pl=$('portfolio-list');if(pl)pl.style.display='none';

  _renderLeft(assets,c,s);
  _renderRight(assets,c,s);

  // Автообновление ставки ЦБ если нужно
  _autoKeyRate(s);
}

// ── ЛЕВАЯ КОЛОНКА ─────────────────────────────────────────────────────────
function _renderLeft(assets,c,s){
  const col=$('p-left');if(!col)return;
  const rate=Math.round(s.keyRate*100);
  const rl=s.keyRate>=.18?'🔴 Высокая ставка':s.keyRate>=.14?'🟡 Нейтральная':'🟢 Низкая ставка';
  const sl=STRATS[c.strat];
  const autoC=c.autoC;

  // Кнопки стратегий
  const stratBtns=Object.entries(STRATS).map(([k,v])=>{
    const act=k===c.strat;
    return`<button onclick="window.setPortStrategy('${k}')" style="flex:1;padding:7px 4px;border:2px solid ${act?v.icon.includes('🚀')?'#C0392B':v.icon.includes('⚖️')?'#BA7517':'#4A7C3F':'var(--border)'};border-radius:8px;background:var(--bg);color:${act?'var(--topbar)':'var(--text2)'};font-size:10px;font-weight:700;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:2px"><span>${v.icon} ${v.l}</span><span style="font-size:9px;opacity:.7">~${autoC.ylds[k]}%</span></button>`;
  }).join('');

  // Список активов
  const total=c.total;
  const assetRows=assets.length?assets.map((a,i)=>{
    const cur=a.currentPrice||a.buyPrice;
    const val=a.qty*cur;
    const cost=a.qty*a.buyPrice;
    const pnl=val-cost;
    const pnlP=cost>0?Math.round(pnl/cost*1000)/10:0;
    const share=total>0?Math.round(val/total*100):0;
    const tc=TM[a.assetType]?.color||'var(--amber)';
    const pc=pnl>=0?'var(--green-dark)':'var(--red)';
    const yld=a.yieldPct&&a.yieldPct>0?a.yieldPct:(TM[a.assetType||'stock']?.yld||10);
    const stale=a.lastUpdated?Math.floor((Date.now()-new Date(a.lastUpdated+'T12:00:00'))/864e5)>=14:false;
    return`<div style="display:flex;align-items:center;gap:7px;padding:8px 0;border-bottom:.5px solid var(--border)">
      <div style="width:3px;height:38px;border-radius:2px;background:${tc};flex-shrink:0"></div>
      <div style="flex:1;min-width:0">
        <div style="font-size:12px;font-weight:700;color:var(--topbar)">${esc(a.ticker)}<span style="font-size:10px;font-weight:400;color:var(--text2)"> ${esc(a.name||'')}</span>${stale?' <span style="font-size:9px;color:var(--orange-dark)">⏰</span>':''}</div>
        <div style="font-size:10px;color:var(--text2)">${a.qty} шт · ${fmt(a.buyPrice)}/шт · ~${yld}%/год</div>
      </div>
      <div style="text-align:right;flex-shrink:0">
        <div style="font-size:12px;font-weight:700;color:var(--topbar)">${fmt(Math.round(val))}</div>
        <div style="font-size:10px;color:${pc}">${pnl>=0?'+':''}${fmt(Math.round(pnl))} (${pnlP}%)</div>
      </div>
      <div style="font-size:11px;font-weight:700;color:var(--text2);min-width:26px;text-align:right">${share}%</div>
      <div style="display:flex;gap:2px;flex-shrink:0">
        <button class="sbtn blue"  onclick="window.editAsset(${i})"           style="font-size:10px;padding:3px 5px">✎</button>
        <button class="sbtn amber" onclick="window.updateAssetPrice(${i})"    style="font-size:10px;padding:3px 5px">₽</button>
        <button class="sbtn red"   onclick="window.deleteAsset(${i})"         style="font-size:10px;padding:3px 5px">✕</button>
      </div>
    </div>`;
  }).join(''):`<div style="color:var(--text2);font-size:13px;padding:16px;text-align:center"><div style="font-size:24px;margin-bottom:6px">📋</div>Добавьте первый актив</div>`;

  // Структура портфеля — полосы
  const structRows=TYPES.map(t=>{
    const cur=Math.round((c.wPct[t.v]||0)*100);
    const tgt=Math.round((c.target[t.v]||0)*100);
    const dev=cur-tgt;
    const dc=Math.abs(dev)<=5?'var(--green-dark)':Math.abs(dev)<=15?'var(--amber-dark)':'var(--red)';
    return`<div style="margin-bottom:8px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:2px">
        <div style="display:flex;align-items:center;gap:4px"><div style="width:8px;height:8px;border-radius:2px;background:${t.color}"></div><span style="font-size:11px;color:var(--topbar)">${t.l}</span></div>
        <div style="font-size:10px;display:flex;gap:6px"><span style="color:var(--text2)">факт <b style="color:var(--topbar)">${cur}%</b></span><span style="color:var(--text2)">цель <b>${tgt}%</b></span><span style="font-weight:700;color:${dc};min-width:26px;text-align:right">${dev>0?'+':''}${dev}п.</span></div>
      </div>
      <div style="position:relative;background:var(--g50);border-radius:3px;height:6px">
        <div style="position:absolute;height:6px;border-radius:3px;background:${t.color};opacity:.2;width:${tgt}%"></div>
        <div style="position:absolute;height:6px;border-radius:3px;background:${t.color};width:${Math.min(cur,100)}%;transition:width .3s"></div>
      </div>
    </div>`;
  }).join('');

  const goalStatus=c.curYield>=s.targetYield
    ?`<span style="color:var(--green-dark)">✓ Цель достигнута (${c.curYield}% ≥ ${s.targetYield}%)</span>`
    :`<span style="color:${c.curYield<s.targetYield-5?'var(--red)':'var(--amber-dark)'}">Сейчас ${c.curYield}% · нужно ещё +${Math.round((s.targetYield-c.curYield)*10)/10}%</span>`;

  const isAutoBadge=c.isAuto
    ?`<span style="font-size:9px;background:var(--green-bg);color:var(--green-dark);border:1px solid rgba(74,124,63,.3);padding:1px 6px;border-radius:10px;margin-left:6px">АВТО</span>`
    :`<span style="font-size:9px;background:var(--amber-light);color:var(--amber-dark);border:1px solid var(--border);padding:1px 6px;border-radius:10px;margin-left:6px">РУЧНАЯ</span>`;

  col.innerHTML=`
  <!-- Шапка -->
  <div style="background:var(--card);border:1.5px solid var(--border2);border-radius:12px;padding:16px;margin-bottom:10px">
    <div style="display:flex;gap:10px;flex-wrap:wrap">
      <div style="flex:2;min-width:150px">
        <div style="font-size:10px;color:var(--text2);font-weight:700;letter-spacing:.5px;margin-bottom:2px">ПОРТФЕЛЬ</div>
        <div style="font-size:26px;font-weight:700;color:var(--topbar)">₽ ${Math.round(c.total).toLocaleString('ru-RU')}</div>
        <div style="font-size:11px;color:var(--text2);margin-top:2px">Вложено ₽ ${Math.round(c.invested).toLocaleString('ru-RU')} <span style="margin-left:6px;font-weight:700;color:${c.pnl>=0?'var(--green-dark)':'var(--red)'}"> ${c.pnl>=0?'+':''}₽${Math.round(c.pnl).toLocaleString('ru-RU')} (${c.pnlPct}%)</span></div>
      </div>
      <div style="flex:1;min-width:130px">
        <div style="font-size:10px;color:var(--text2);font-weight:700;letter-spacing:.5px;margin-bottom:2px">ЦЕЛЕВАЯ ДОХОДНОСТЬ</div>
        <div style="font-size:26px;font-weight:700;color:var(--topbar)">${s.targetYield}%<span style="font-size:13px;color:var(--text2)"> /год</span></div>
        <div style="font-size:11px;margin-top:2px">${goalStatus}</div>
      </div>
      <div style="flex:1;min-width:90px">
        <div style="font-size:10px;color:var(--text2);font-weight:700;letter-spacing:.5px;margin-bottom:2px">СТАВКА ЦБ</div>
        <div style="font-size:26px;font-weight:700;color:var(--topbar)">${rate}%</div>
        <div style="font-size:10px;color:var(--text2)">${rl} <button onclick="window.refreshKeyRate()" style="background:none;border:none;cursor:pointer;font-size:12px;color:var(--amber-dark)" title="Обновить">🔄</button></div>
        ${s.keyRateUpdated?`<div style="font-size:9px;color:var(--text2)">${s.keyRateUpdated}</div>`:''}
      </div>
    </div>
  </div>

  <!-- Параметры -->
  <div style="background:var(--card);border:1.5px solid var(--border2);border-radius:12px;padding:14px;margin-bottom:10px">
    <div style="font-size:10px;font-weight:700;color:var(--text2);letter-spacing:.5px;margin-bottom:8px">ПАРАМЕТРЫ</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">
      <div style="flex:1;min-width:100px">
        <div style="font-size:10px;font-weight:700;color:var(--text2);margin-bottom:3px">🎯 ХОЧУ ДОХОДНОСТЬ %/ГОД</div>
        <input class="fi" type="number" id="port-target" value="${s.targetYield}" min="1" max="50" step=".5" style="padding:7px 10px;font-size:15px;font-weight:700">
        <div style="font-size:9px;color:var(--text2);margin-top:2px">Стратегия подбирается автоматически</div>
      </div>
      <div style="flex:1;min-width:100px">
        <div style="font-size:10px;font-weight:700;color:var(--text2);margin-bottom:3px">💰 ВЗНОС В МЕС. ₽</div>
        <input class="fi" type="number" id="port-monthly" value="${s.monthlyCash}" min="0" step="1000" style="padding:7px 10px;font-size:14px;font-weight:700">
      </div>
      <button class="sbtn amber" onclick="window.savePortSettings()" style="padding:9px 14px;align-self:flex-end;white-space:nowrap">Пересчитать</button>
    </div>
    <div style="font-size:10px;font-weight:700;color:var(--text2);letter-spacing:.5px;margin-bottom:6px">СТРАТЕГИЯ ${isAutoBadge}</div>
    <div style="display:flex;gap:6px;margin-bottom:8px">${stratBtns}</div>
    <div style="font-size:11px;padding:6px 8px;background:var(--amber-light);border-radius:6px">${sl.icon} <b>${sl.l}:</b> ${sl.desc}</div>
    ${c.isAuto?`<div style="font-size:10px;color:var(--text2);padding:5px 8px;background:var(--green-bg);border-radius:6px;margin-top:6px">✓ Авторасчёт: для ${s.targetYield}% при ставке ${rate}% нужна ${sl.l.toLowerCase()} (~${autoC.ylds[c.strat]}%). Взнос добавляет ~${autoC.bonus}% эфф. доходности. <a href="#" onclick="window.resetPortStrategy();return false" style="color:var(--amber-dark);font-weight:700">Задать вручную →</a></div>`
    :`<div style="font-size:10px;padding:5px 8px;background:var(--amber-light);border-radius:6px;margin-top:6px">⚙️ Стратегия задана вручную. <a href="#" onclick="window.resetPortStrategy();return false" style="color:var(--amber-dark);font-weight:700">Вернуть авторасчёт →</a></div>`}
  </div>

  <!-- Активы -->
  <div style="background:var(--card);border:1.5px solid var(--border2);border-radius:12px;padding:14px;margin-bottom:10px">
    <div style="font-size:10px;font-weight:700;color:var(--text2);letter-spacing:.5px;margin-bottom:8px">АКТИВЫ В ПОРТФЕЛЕ</div>
    ${assetRows}
  </div>

  <!-- Текущая структура -->
  <div style="background:var(--card);border:1.5px solid var(--border2);border-radius:12px;padding:14px">
    <div style="font-size:10px;font-weight:700;color:var(--text2);letter-spacing:.5px;margin-bottom:10px">ТЕКУЩАЯ СТРУКТУРА · баланс <span style="color:${c.score>=70?'var(--green-dark)':c.score>=40?'var(--amber-dark)':'var(--red)'}">${c.score}/100</span></div>
    <div style="display:flex;gap:12px;align-items:flex-start;flex-wrap:wrap">
      ${c.total>0?`<div style="flex-shrink:0">${_donut(c.wPct)}</div>`:''}
      <div style="flex:1;min-width:160px">${structRows}</div>
    </div>
  </div>`;
}

// ── ПРАВАЯ КОЛОНКА ─────────────────────────────────────────────────────────
function _renderRight(assets,c,s){
  const col=$('p-right');if(!col)return;
  const recs=buildRecs(c,s);

  // Таблица рекомендаций
  const recRows=recs.length?recs.map(r=>{
    const isBuy=r.action==='buy';
    const bg=isBuy?'#E8F5E9':'#FFEBEE';
    const color=isBuy?'var(--green-dark)':'var(--red)';
    const instr=INSTR[r.group]||INSTR.etf;
    const qty=instr.price>0?Math.floor(r.amount/instr.price):0;
    return`<div style="display:grid;grid-template-columns:72px 1fr 88px 60px;gap:6px;align-items:center;padding:9px 10px;background:${bg};border-radius:8px;margin-bottom:5px">
      <div style="font-size:10px;font-weight:700;color:${color};text-align:center;padding:2px 4px;background:${isBuy?'rgba(74,124,63,.15)':'rgba(192,57,43,.15)'};border-radius:5px">${isBuy?'Купить':'Продать'}</div>
      <div><div style="font-size:12px;font-weight:700;color:var(--topbar)">${esc(instr.ticker)}</div><div style="font-size:10px;color:var(--text2)">${esc(instr.name)}</div></div>
      <div style="font-size:12px;font-weight:700;color:var(--topbar);text-align:right">${fmt(r.amount)}</div>
      <div style="font-size:11px;color:var(--text2);text-align:right">${qty?qty+' шт':'—'}</div>
    </div>`;
  }).join(''):`<div style="background:var(--green-bg);border:1px solid rgba(74,124,63,.2);border-radius:8px;padding:12px;font-size:12px;color:var(--green-dark);font-weight:700">✅ Ребалансировка не нужна</div>`;

  // Итоговая структура (целевые веса)
  const tgtRows=TYPES.filter(t=>(c.target[t.v]||0)>0).map(t=>{
    const tgt=Math.round((c.target[t.v]||0)*100);
    return`<div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:.5px solid var(--border)">
      <div style="display:flex;align-items:center;gap:5px"><div style="width:8px;height:8px;border-radius:2px;background:${t.color}"></div><span style="font-size:12px;color:var(--topbar)">${t.l}</span></div>
      <div style="display:flex;align-items:center;gap:8px">
        <div style="width:70px;background:var(--g50);border-radius:3px;height:5px"><div style="height:5px;border-radius:3px;background:${t.color};width:${tgt}%"></div></div>
        <span style="font-size:12px;font-weight:700;color:var(--topbar);min-width:26px;text-align:right">${tgt}%</span>
      </div>
    </div>`;
  }).join('');

  const wOk=!!(appConfig?.workerUrl||'').trim();

  col.innerHTML=`
  <!-- Рекомендации по структуре -->
  <div style="background:var(--card);border:1.5px solid var(--border2);border-radius:12px;padding:14px;margin-bottom:10px">
    <div style="font-size:10px;font-weight:700;color:var(--text2);letter-spacing:.5px;margin-bottom:8px">💡 РЕКОМЕНДАЦИИ ПО ИНСТРУМЕНТАМ</div>
    <div style="display:grid;grid-template-columns:72px 1fr 88px 60px;gap:6px;padding:0 10px 6px;border-bottom:1px solid var(--border)">
      <div style="font-size:9px;font-weight:700;color:var(--text2)">ДЕЙСТВИЕ</div>
      <div style="font-size:9px;font-weight:700;color:var(--text2)">ИНСТРУМЕНТ</div>
      <div style="font-size:9px;font-weight:700;color:var(--text2);text-align:right">СУММА</div>
      <div style="font-size:9px;font-weight:700;color:var(--text2);text-align:right">КОЛ-ВО</div>
    </div>
    <div style="margin-top:6px">${recRows}</div>
  </div>

  <!-- Итоговая структура -->
  <div style="background:var(--card);border:1.5px solid var(--border2);border-radius:12px;padding:14px;margin-bottom:10px">
    <div style="font-size:10px;font-weight:700;color:var(--text2);letter-spacing:.5px;margin-bottom:10px">📊 ИТОГОВАЯ СТРУКТУРА ПОРТФЕЛЯ</div>
    ${tgtRows||'<div style="color:var(--text2);font-size:12px">Добавьте активы для расчёта</div>'}
  </div>

  <!-- AI Анализ -->
  <div style="background:var(--card);border:1.5px solid var(--border2);border-radius:12px;padding:14px;margin-bottom:10px">
    <div style="font-size:10px;font-weight:700;color:var(--text2);letter-spacing:.5px;margin-bottom:10px">🔍 АНАЛИЗ ПОРТФЕЛЯ (AI)</div>
    <button id="btn-analyze" onclick="window.analyzePortfolio()" style="width:100%;padding:10px;border:1.5px solid var(--amber);border-radius:8px;background:var(--amber-light);color:var(--topbar);font-size:12px;font-weight:700;cursor:pointer;margin-bottom:6px">🤖 Запустить анализ</button>
    ${!wOk?'<div style="font-size:10px;color:var(--text2);text-align:center">Настройте URL воркера в Администраторе</div>':''}
    <div id="p-analysis" style="margin-top:8px"></div>
  </div>

  <!-- Рекомендации AI -->
  <div style="background:var(--card);border:1.5px solid var(--border2);border-radius:12px;padding:14px;margin-bottom:10px">
    <div style="font-size:10px;font-weight:700;color:var(--text2);letter-spacing:.5px;margin-bottom:10px">📋 КОНКРЕТНЫЕ ДЕЙСТВИЯ (AI)</div>
    <button id="btn-recs" onclick="window.getPortfolioRecs()" style="width:100%;padding:10px;border:1.5px solid var(--green-dark);border-radius:8px;background:var(--green-bg);color:var(--topbar);font-size:12px;font-weight:700;cursor:pointer;margin-bottom:6px">📋 Получить рекомендации по каждой бумаге</button>
    <div id="p-recs" style="margin-top:8px"></div>
  </div>

  <!-- Простым языком -->
  <div style="background:var(--card);border:1.5px solid var(--border2);border-radius:12px;padding:14px">
    <div style="font-size:10px;font-weight:700;color:var(--text2);letter-spacing:.5px;margin-bottom:10px">💬 ПРОСТЫМ ЯЗЫКОМ</div>
    <button id="btn-explain" onclick="window.explainPortfolio()" style="width:100%;padding:10px;border:1.5px solid var(--border);border-radius:8px;background:var(--bg);color:var(--topbar);font-size:12px;font-weight:700;cursor:pointer;margin-bottom:6px">💬 Объяснить как другу</button>
    <div id="p-explain" style="margin-top:8px"></div>
  </div>`;
}

// ── SVG пончик ────────────────────────────────────────────────────────────
function _donut(wPct){
  const R=44,r=28,cx=54,cy=54;
  const data=TYPES.map(t=>({val:wPct[t.v]||0,color:t.color})).filter(d=>d.val>.01);
  if(!data.length)return'';
  let a=-Math.PI/2;
  const paths=data.map(d=>{
    const end=a+d.val*2*Math.PI,lg=d.val>.5?1:0;
    const p=`M${cx+R*Math.cos(a)},${cy+R*Math.sin(a)} A${R},${R} 0 ${lg},1 ${cx+R*Math.cos(end)},${cy+R*Math.sin(end)} L${cx+r*Math.cos(end)},${cy+r*Math.sin(end)} A${r},${r} 0 ${lg},0 ${cx+r*Math.cos(a)},${cy+r*Math.sin(a)} Z`;
    const res=`<path d="${p}" fill="${d.color}" opacity=".85" stroke="var(--bg)" stroke-width="1.5"/>`;
    a=end;return res;
  }).join('');
  return`<svg width="108" height="108" viewBox="0 0 108 108">${paths}</svg>`;
}

// ── GPT запрос ────────────────────────────────────────────────────────────
async function _gpt(systemPrompt,userText,maxTokens=600){
  const workerUrl=(appConfig?.workerUrl||'').trim();
  if(!workerUrl)throw new Error('Воркер не настроен');
  const ep=workerUrl.replace(/\/?$/,'')+'/gpt';
  const h={'Content-Type':'application/json'};
  if(appConfig?.appSecret)h['X-App-Secret']=appConfig.appSecret;
  const resp=await fetch(ep,{method:'POST',headers:h,body:JSON.stringify({
    completionOptions:{stream:false,temperature:.3,maxTokens},
    messages:[{role:'system',text:systemPrompt},{role:'user',text:userText}],
  })});
  if(!resp.ok)throw new Error('GPT: '+resp.status);
  const d=await resp.json();
  const t=d.result?.alternatives?.[0]?.message?.text||'';
  if(!t)throw new Error('Пустой ответ GPT');
  return t.trim();
}

function _gptBlock(id,html){
  const el=document.getElementById(id);if(el)el.innerHTML=html;
}

// ── Автообновление ставки ЦБ ──────────────────────────────────────────────
async function _autoKeyRate(s){
  // Обновляем если прошло >24 часов или нет данных
  const now=new Date();
  const updated=s.keyRateUpdated?new Date(s.keyRateUpdated):null;
  const hoursSince=updated?Math.floor((now-updated)/3600000):9999;
  if(hoursSince<24)return; // кэш актуален

  try{
    const text=await _gpt(
      'Ты финансовый ассистент. Отвечай ТОЛЬКО числом — текущая ключевая ставка ЦБ РФ в процентах (например: 21 или 16.5). Без слов, без знака %, только число.',
      'Какова текущая ключевая ставка ЦБ РФ?',
      50
    );
    const rate=parseFloat(text.replace(/[^\d.]/g,''));
    if(rate>=1&&rate<=50){
      s.keyRate=rate/100;
      s.keyRateUpdated=now.toLocaleDateString('ru-RU');
      state.D.portfolioSettings=s;
      sched();
      renderPortfolio(); // перерисовываем с новой ставкой
      console.log('[portfolio] ставка ЦБ обновлена:',rate+'%');
    }
  }catch(e){console.warn('[portfolio] не удалось получить ставку ЦБ:',e.message);}
}

// ── Принудительное обновление ставки ЦБ ──────────────────────────────────
window.refreshKeyRate=async function(){
  const s=getS();
  s.keyRateUpdated=null; // сбрасываем кэш
  state.D.portfolioSettings=s;
  _showPortMsg('Обновляю ставку ЦБ...');
  await _autoKeyRate(s);
};

// ── 🔍 АНАЛИЗ ПОРТФЕЛЯ ───────────────────────────────────────────────────
window.analyzePortfolio=async function(){
  const btn=document.getElementById('btn-analyze');
  if(btn){btn.disabled=true;btn.textContent='⏳ Анализирую...';}
  _gptBlock('p-analysis','<div style="color:var(--text2);font-size:12px;padding:8px 0">Анализирую портфель...</div>');
  const s=getS();const assets=state.D.portfolio;const c=calc(assets,s);
  const rate=Math.round(s.keyRate*100);
  try{
    const sys=`Ты опытный финансовый советник. Анализируй портфель простым языком без сложных терминов.
Формат ответа (строго без markdown, без звёздочек, обычным текстом):
СИЛЬНЫЕ СТОРОНЫ:
• [пункт]
• [пункт]

СЛАБЫЕ СТОРОНЫ:
• [пункт]
• [пункт]

РИСКИ:
• [пункт]

ПРОГНОЗ НА ГОД:
[1-2 предложения]

До 200 слов. Только русский язык.`;
    const user=`Ставка ЦБ: ${rate}%. Стратегия: ${STRATS[c.strat]?.l}. Цель: ${s.targetYield}%/год.
Портфель ₽${Math.round(c.total).toLocaleString('ru-RU')}, текущая доходность ~${c.curYield}%, баланс ${c.score}/100.
Структура: ${TYPES.filter(t=>(c.wPct[t.v]||0)>.01).map(t=>`${t.l.replace(/[📄🔄💵📈💴💶]\s?/,'')} ${Math.round((c.wPct[t.v]||0)*100)}%`).join(', ')}.
Активы: ${assets.map(a=>`${a.ticker} ${a.qty}шт по ${a.buyPrice}₽ (тек. ${a.currentPrice||a.buyPrice}₽)`).join('; ')||'нет'}.`;
    const text=await _gpt(sys,user,600);
    _gptBlock('p-analysis',`<div style="background:var(--amber-light);border-radius:10px;padding:14px">
      <div style="font-size:10px;font-weight:700;color:var(--text2);margin-bottom:8px">🤖 YANDEXGPT · АНАЛИЗ</div>
      <div style="font-size:12px;color:var(--topbar);line-height:1.75;white-space:pre-wrap">${esc(text)}</div>
      <div style="font-size:10px;color:var(--text2);margin-top:10px;padding-top:6px;border-top:1px solid var(--border)">⚠ Не является инвестиционной рекомендацией</div>
    </div>`);
  }catch(e){_gptBlock('p-analysis',`<div class="notice amber" style="font-size:12px">Ошибка: ${esc(e.message)}</div>`);}
  finally{if(btn){btn.disabled=false;btn.textContent='🤖 Запустить анализ';}}
};

// ── 📋 КОНКРЕТНЫЕ РЕКОМЕНДАЦИИ ПО КАЖДОЙ БУМАГЕ ──────────────────────────
window.getPortfolioRecs=async function(){
  const btn=document.getElementById('btn-recs');
  if(btn){btn.disabled=true;btn.textContent='⏳ Генерирую рекомендации...';}
  _gptBlock('p-recs','<div style="color:var(--text2);font-size:12px;padding:8px 0">Подбираю рекомендации...</div>');
  const s=getS();const assets=state.D.portfolio;const c=calc(assets,s);
  const rate=Math.round(s.keyRate*100);
  const recs=buildRecs(c,s);
  try{
    const sys=`Ты финансовый советник. Дай конкретные рекомендации по каждому активу портфеля.
Для каждого актива используй формат:
[ТИКЕР] [ДЕЙСТВИЕ: КУПИТЬ +X шт / ПРОДАТЬ -X шт / ДЕРЖАТЬ]
Текущая позиция: X шт по Y ₽ = Z ₽
После действия: X шт = Z ₽
Почему: [1 предложение простым языком]

Затем:
РЕКОМЕНДУЮ ДОБАВИТЬ:
[Инструмент] — [сумма из ежемесячного взноса] — [почему]

ИТОГ:
[Как изменится ожидаемая доходность]

Без markdown. Только русский. До 300 слов.`;
    const user=`Ставка ЦБ: ${rate}%. Цель: ${s.targetYield}%/год. Стратегия: ${STRATS[c.strat]?.l}.
Взнос: ₽${s.monthlyCash}/мес. Баланс портфеля: ${c.score}/100.
Текущие активы: ${assets.map(a=>`${a.ticker} (${a.qty} шт, куплено по ${a.buyPrice}₽, сейчас ${a.currentPrice||a.buyPrice}₽, тип: ${TM[a.assetType||'stock']?.l.replace(/[📄🔄💵📈💴💶]\s?/,'')||a.assetType||'акция'})`).join('; ')||'нет активов'}.
Отклонения от цели: ${Object.entries(c.deviations).filter(([,v])=>Math.abs(v)>.05).map(([k,v])=>`${k} ${v>0?'+':''}${Math.round(v*100)}п.п.`).join(', ')||'нет значимых'}.
Системные рекомендации (для справки): ${recs.map(r=>`${r.action==='buy'?'купить':'продать'} ${INSTR[r.group]?.ticker||r.group} на ₽${r.amount}`).join('; ')||'ребалансировка не нужна'}.`;
    const text=await _gpt(sys,user,700);
    _gptBlock('p-recs',`<div style="background:var(--green-bg);border:1px solid rgba(74,124,63,.2);border-radius:10px;padding:14px">
      <div style="font-size:10px;font-weight:700;color:var(--text2);margin-bottom:8px">🤖 YANDEXGPT · РЕКОМЕНДАЦИИ</div>
      <div style="font-size:12px;color:var(--topbar);line-height:1.75;white-space:pre-wrap">${esc(text)}</div>
      <div style="font-size:10px;color:var(--text2);margin-top:10px;padding-top:6px;border-top:1px solid rgba(74,124,63,.2)">⚠ Не является инвестиционной рекомендацией</div>
    </div>`);
  }catch(e){_gptBlock('p-recs',`<div class="notice amber" style="font-size:12px">Ошибка: ${esc(e.message)}</div>`);}
  finally{if(btn){btn.disabled=false;btn.textContent='📋 Получить рекомендации по каждой бумаге';}}
};

// ── 💬 ПРОСТЫМ ЯЗЫКОМ ─────────────────────────────────────────────────────
window.explainPortfolio=async function(){
  const btn=document.getElementById('btn-explain');
  if(btn){btn.disabled=true;btn.textContent='⏳ Думаю...';}
  _gptBlock('p-explain','<div style="color:var(--text2);font-size:12px;padding:8px 0">Формулирую объяснение...</div>');
  const s=getS();const assets=state.D.portfolio;const c=calc(assets,s);
  const rate=Math.round(s.keyRate*100);
  const recs=buildRecs(c,s);
  try{
    const sys=`Ты дружелюбный финансовый советник, объясняешь как другу за чашкой кофе.
Без терминов. Без сложных слов. Коротко и по делу.
Структура:
1. Рынок сейчас (1 предложение)
2. Твой портфель (сильные и слабые стороны, 2-3 предложения)
3. Что сделать прямо сейчас (2-3 конкретных шага с суммами)
4. К чему это приведёт (1 предложение о доходности)
5. Главный риск (1 предложение)
До 180 слов.`;
    const user=`Ставка ЦБ: ${rate}%. Цель: ${s.targetYield}%/год.
Портфель: ₽${Math.round(c.total).toLocaleString('ru-RU')}, доходность ~${c.curYield}%.
Активы: ${assets.map(a=>`${a.ticker} ${a.qty}шт`).join(', ')||'нет'}.
Рекомендации: ${recs.map(r=>`${r.action==='buy'?'купить':'продать'} ${INSTR[r.group]?.ticker||r.group} на ₽${r.amount}`).join('; ')||'ребалансировка не нужна'}.`;
    const text=await _gpt(sys,user,450);
    _gptBlock('p-explain',`<div style="background:var(--amber-light);border-radius:10px;padding:14px">
      <div style="font-size:10px;font-weight:700;color:var(--text2);margin-bottom:8px">🤖 YANDEXGPT</div>
      <div style="font-size:13px;color:var(--topbar);line-height:1.8;white-space:pre-wrap">${esc(text)}</div>
      <div style="font-size:10px;color:var(--text2);margin-top:10px;padding-top:6px;border-top:1px solid var(--border)">⚠ Не является инвестиционной рекомендацией</div>
    </div>`);
  }catch(e){_gptBlock('p-explain',`<div class="notice amber" style="font-size:12px">Ошибка: ${esc(e.message)}</div>`);}
  finally{if(btn){btn.disabled=false;btn.textContent='💬 Объяснить как другу';}}
};

function _showPortMsg(msg){const el=$('port-msg');if(el)el.textContent=msg;}

// ── Обработчики ───────────────────────────────────────────────────────────
window.setPortStrategy=function(k){const s=getS();s.strategy=k;state.D.portfolioSettings=s;sched();renderPortfolio();};
window.resetPortStrategy=function(){const s=getS();s.strategy=null;state.D.portfolioSettings=s;sched();renderPortfolio();};
window.savePortSettings=function(){
  const t=toNum(document.getElementById('port-target')?.value);
  const m=toNum(document.getElementById('port-monthly')?.value);
  if(!t||t<1||t>50){alert('Введите целевую доходность от 1 до 50%');return;}
  const s=getS();s.targetYield=t;s.monthlyCash=m;
  state.D.portfolioSettings=s;sched();renderPortfolio();
};
window.openAddAsset=function(){
  if(!state.D.portfolio)state.D.portfolio=[];
  $('asset-idx').value=-1;
  ['asset-ticker','asset-name','asset-qty','asset-buy','asset-cur'].forEach(id=>{const e=$(id);if(e)e.value='';});
  _fillAssetTypeSelect(-1);
  document.getElementById('modal-asset').classList.add('open');
};
window.editAsset=function(i){
  const a=state.D.portfolio[i];
  $('asset-idx').value=i;
  $('asset-ticker').value=a.ticker;$('asset-name').value=a.name||'';
  $('asset-qty').value=a.qty;$('asset-buy').value=a.buyPrice;
  $('asset-cur').value=a.currentPrice||a.buyPrice;
  _fillAssetTypeSelect(i);
  document.getElementById('modal-asset').classList.add('open');
};
function _fillAssetTypeSelect(assetIdx){
  const modal=document.getElementById('modal-asset');if(!modal)return;
  const body=modal.querySelector('.modal');
  modal.querySelector('#asset-type-wrap')?.remove();
  modal.querySelector('#asset-yield-wrap')?.remove();
  const tw=document.createElement('div');tw.id='asset-type-wrap';tw.className='fg';
  tw.innerHTML=`<label>ТИП АКТИВА</label><select class="fi" id="asset-type">${TYPES.map(t=>`<option value="${t.v}">${t.l}</option>`).join('')}</select>`;
  const yw=document.createElement('div');yw.id='asset-yield-wrap';yw.className='fg';
  yw.innerHTML=`<label>КУПОННАЯ / ДИВИДЕНДНАЯ ДОХОДНОСТЬ % (необяз.)</label><input class="fi" type="number" id="asset-yield" placeholder="напр. 14.67" step=".01" min="0" max="100">`;
  const saveBtn=body?.querySelector('.btn-primary');
  if(saveBtn){body.insertBefore(yw,saveBtn);body.insertBefore(tw,yw);}
  else{body?.appendChild(tw);body?.appendChild(yw);}
  const sel=$('asset-type');
  if(sel)sel.value=assetIdx>=0?(state.D.portfolio[assetIdx]?.assetType||'bond_fixed'):'bond_fixed';
  const yi=$('asset-yield');
  if(yi)yi.value=assetIdx>=0?(state.D.portfolio[assetIdx]?.yieldPct??''):'';
}
window.updateAssetPrice=window.updatePrice=function(i){
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
window.saveAsset=function(){
  if(!state.D.portfolio)state.D.portfolio=[];
  const idx=+($('asset-idx').value||'-1');
  const ticker=($('asset-ticker').value||'').trim().toUpperCase();
  const qty=toNum($('asset-qty').value);
  const buy=toNum($('asset-buy').value);
  const cur=toNum($('asset-cur').value)||buy;
  if(!ticker){alert('Введите тикер');return;}
  if(qty<=0){alert('Введите количество');return;}
  if(buy<=0){alert('Введите цену покупки');return;}
  const asset={
    id:idx>=0?state.D.portfolio[idx].id:'ast'+Date.now(),
    ticker,name:($('asset-name').value||'').trim(),
    qty,buyPrice:buy,currentPrice:cur,
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
export function checkPortfolioAlert(){
  if(!state.D?.portfolio?.length)return null;
  const lu=state.D.portfolioUpdated?.lastUpdate;
  if(!lu)return'Обновите цены в портфеле инвестиций';
  const d=Math.floor((new Date(today())-new Date(lu))/86400000);
  if(d>=7)return`Цены в портфеле не обновлялись ${d} дн.`;
  const s=getS();
  if(state.D.portfolio.length>0){const c=calc(state.D.portfolio,s);if(!c.curYield||c.curYield<s.targetYield-5)return`Портфель не достигает цели ${s.targetYield}%`;}
  return null;
}
