import{$,fmt,state,sched,today}from'./core.js';

export function renderPortfolio(){
  if(!state.D)return;
  if(!state.D.portfolio)state.D.portfolio=[];
  const el=$('portfolio-list');if(!el)return;

  const total=state.D.portfolio.reduce((s,a)=>s+a.qty*(a.currentPrice||a.buyPrice),0);
  const totalCost=state.D.portfolio.reduce((s,a)=>s+a.qty*a.buyPrice,0);
  const totalPnl=total-totalCost;
  const pnlPct=totalCost>0?Math.round(totalPnl/totalCost*1000)/10:0;

  // Summary
  const summaryEl=$('portfolio-summary');
  if(summaryEl){
    summaryEl.innerHTML=`
      <div class="bal-grid">
        <div class="bal-item"><div class="bal-lbl">СТОИМОСТЬ</div><div class="bal-val">${fmt(Math.round(total))}</div></div>
        <div class="bal-item"><div class="bal-lbl">ВЛОЖЕНО</div><div class="bal-val">${fmt(Math.round(totalCost))}</div></div>
        <div class="bal-item ${totalPnl>=0?'green':'red'}">
          <div class="bal-lbl">ПРИБЫЛЬ/УБЫТОК</div>
          <div class="bal-val ${totalPnl>=0?'pos':'neg'}">${totalPnl>=0?'+':''}${fmt(Math.round(totalPnl))}</div>
        </div>
        <div class="bal-item ${totalPnl>=0?'green':'red'}">
          <div class="bal-lbl">ДОХОДНОСТЬ</div>
          <div class="bal-val ${totalPnl>=0?'pos':'neg'}">${pnlPct>=0?'+':''}${pnlPct}%</div>
        </div>
      </div>`;
  }

  if(!state.D.portfolio.length){
    el.innerHTML='<div style="color:var(--text2);font-size:13px;padding:8px 0">Нет активов. Добавьте первую ценную бумагу.</div>';
    return;
  }

  // Allocation bars
  el.innerHTML=state.D.portfolio.map((a,i)=>{
    const curVal=a.qty*(a.currentPrice||a.buyPrice);
    const cost=a.qty*a.buyPrice;
    const pnl=curVal-cost;
    const pnlP=cost>0?Math.round(pnl/cost*1000)/10:0;
    const share=total>0?Math.round(curVal/total*100):0;
    const color=pnl>=0?'var(--green-dark)':'var(--red)';
    const lastUpd=a.lastUpdated?new Date(a.lastUpdated).toLocaleDateString('ru-RU'):'не обновлялась';
    return`<div style="background:var(--card);border:1.5px solid var(--border2);border-radius:10px;padding:12px 14px;margin-bottom:10px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">
        <div>
          <div style="font-size:15px;font-weight:700;color:var(--topbar)">${a.ticker} <span style="font-size:12px;font-weight:400;color:var(--text2)">${a.name||''}</span></div>
          <div style="font-size:11px;color:var(--text2);margin-top:2px">${a.qty} шт. · покупка ${fmt(a.buyPrice)}/шт · цена ${fmt(a.currentPrice||a.buyPrice)}/шт</div>
        </div>
        <div style="text-align:right;display:flex;gap:6px;align-items:center">
          <button class="sbtn blue" onclick="window.editAsset(${i})">Изм.</button>
          <button class="sbtn amber" onclick="window.updatePrice(${i})">Цена</button>
          <button class="sbtn red" onclick="window.deleteAsset(${i})">✕</button>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:8px">
        <div style="background:var(--amber-light);border-radius:6px;padding:7px 9px">
          <div style="font-size:9px;color:var(--text2);font-weight:700">СТОИМОСТЬ</div>
          <div style="font-size:13px;font-weight:700;color:var(--topbar)">${fmt(Math.round(curVal))}</div>
        </div>
        <div style="background:${pnl>=0?'var(--green-bg)':'var(--red-bg)'};border-radius:6px;padding:7px 9px">
          <div style="font-size:9px;color:var(--text2);font-weight:700">П/У</div>
          <div style="font-size:13px;font-weight:700;color:${color}">${pnl>=0?'+':''}${fmt(Math.round(pnl))}</div>
        </div>
        <div style="background:${pnl>=0?'var(--green-bg)':'var(--red-bg)'};border-radius:6px;padding:7px 9px">
          <div style="font-size:9px;color:var(--text2);font-weight:700">ДОХОДНОСТЬ</div>
          <div style="font-size:13px;font-weight:700;color:${color}">${pnlP>=0?'+':''}${pnlP}%</div>
        </div>
        <div style="background:var(--amber-light);border-radius:6px;padding:7px 9px">
          <div style="font-size:9px;color:var(--text2);font-weight:700">ДОЛЯ</div>
          <div style="font-size:13px;font-weight:700;color:var(--topbar)">${share}%</div>
        </div>
      </div>
      <div style="background:var(--g50);border-radius:3px;height:5px;margin-bottom:4px">
        <div style="height:5px;border-radius:3px;background:var(--amber);width:${share}%"></div>
      </div>
      <div style="font-size:10px;color:var(--text2)">Цена обновлена: ${lastUpd}</div>
      ${_portfolioRec(a,curVal,pnlP,share,total)}
    </div>`;
  }).join('');
}


function _portfolioRec(a,curVal,pnlP,share,total){
  const daysSinceUpdate=a.lastUpdated?Math.floor((new Date()-new Date(a.lastUpdated))/(864e5)):999;
  let icon='',msg='',color='var(--text2)';
  if(daysSinceUpdate>=14){icon='⏰';msg='Цена не обновлялась '+daysSinceUpdate+' дн. — обновите для точных расчётов';color='var(--orange-dark)';}
  else if(pnlP>=50){icon='🚀';msg='Отличный результат +'+pnlP+'%. Рассмотрите фиксацию части прибыли.';color='var(--green-dark)';}
  else if(pnlP>=20){icon='📈';msg='Хорошая доходность +'+pnlP+'%. Держите позицию, следите за новостями.';color='var(--green-dark)';}
  else if(pnlP>=5){icon='✅';msg='Позиция в плюсе +'+pnlP+'%. Продолжайте следить за динамикой.';color='var(--green-dark)';}
  else if(pnlP>=-5){icon='➡';msg='Доходность около нуля ('+pnlP+'%). Оцените перспективы актива.';color='var(--amber-dark)';}
  else if(pnlP>=-20){icon='⚠';msg='Убыток '+pnlP+'%. Проверьте фундаментальные показатели компании.';color='var(--orange-dark)';}
  else{icon='🔴';msg='Значительный убыток '+pnlP+'%. Рассмотрите стоп-лосс или усреднение.';color='var(--red)';}
  // Concentration warning
  if(share>40&&!msg.includes('концентрац')){msg+=' Доля '+share+'% — высокая концентрация, диверсифицируйте портфель.';}
  return`<div style="background:var(--card);border:1px solid var(--border);border-radius:6px;padding:8px 10px;margin-top:8px;display:flex;gap:8px;align-items:flex-start">
    <span style="font-size:16px;flex-shrink:0">${icon}</span>
    <div style="font-size:11px;color:${color};line-height:1.5">${msg}</div>
  </div>`;
}

window.openAddAsset=function(){
  $('asset-idx').value=-1;
  $('asset-ticker').value='';$('asset-name').value='';
  $('asset-qty').value='';$('asset-buy').value='';$('asset-cur').value='';
  document.getElementById('modal-asset').classList.add('open');
};
window.editAsset=function(i){
  const a=state.D.portfolio[i];
  $('asset-idx').value=i;$('asset-ticker').value=a.ticker;
  $('asset-name').value=a.name||'';$('asset-qty').value=a.qty;
  $('asset-buy').value=a.buyPrice;$('asset-cur').value=a.currentPrice||a.buyPrice;
  document.getElementById('modal-asset').classList.add('open');
};
window.updatePrice=function(i){
  const a=state.D.portfolio[i];
  const newPrice=parseFloat(prompt(`Текущая цена ${a.ticker} (сейчас: ${a.currentPrice||a.buyPrice} ₽):`));
  if(!newPrice||isNaN(newPrice))return;
  state.D.portfolio[i].currentPrice=newPrice;
  state.D.portfolio[i].lastUpdated=today();
  // Update weekly alert timestamp
  if(!state.D.portfolioUpdated)state.D.portfolioUpdated={};
  state.D.portfolioUpdated.lastUpdate=today();
  sched();renderPortfolio();
};
window.saveAsset=function(){
  if(!state.D.portfolio)state.D.portfolio=[];
  const idx=+$('asset-idx').value;
  const asset={
    id:idx>=0?state.D.portfolio[idx].id:('ast'+Date.now()),
    ticker:$('asset-ticker').value.trim().toUpperCase(),
    name:$('asset-name').value.trim(),
    qty:parseFloat($('asset-qty').value)||0,
    buyPrice:parseFloat($('asset-buy').value)||0,
    currentPrice:parseFloat($('asset-cur').value)||parseFloat($('asset-buy').value)||0,
    lastUpdated:today()
  };
  if(!asset.ticker||!asset.qty||!asset.buyPrice){alert('Заполните тикер, кол-во и цену покупки');return;}
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

// Weekly update check
export function checkPortfolioAlert(){
  if(!state.D||!state.D.portfolio||!state.D.portfolio.length)return null;
  const lastUpdate=state.D.portfolioUpdated?.lastUpdate;
  if(!lastUpdate)return'Обновите цены в портфеле инвестиций';
  const daysSince=Math.floor((new Date(today())-new Date(lastUpdate))/(1000*60*60*24));
  if(daysSince>=7)return`Цены в портфеле не обновлялись ${daysSince} дн.`;
  return null;
}
