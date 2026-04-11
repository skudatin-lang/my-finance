import{$,fmt,state,sched,today,getMOps,isPlanned}from'./core.js';

const esc=s=>String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

export function renderAssets(){
  if(!state.D)return;
  if(!state.D.physAssets)state.D.physAssets=[];
  const el=$('assets-list');if(!el)return;

  renderAssetsSummary();

  if(!state.D.physAssets.length){
    el.innerHTML='<div style="color:var(--text2);font-size:13px;padding:8px 0">Нет активов. Добавьте квартиру, автомобиль или другой физический актив.</div>';
    return;
  }
  el.innerHTML=state.D.physAssets.map((a,i)=>renderAssetCard(a,i)).join('');
}

function renderAssetCard(a,i){
  const ownershipCost=calcOwnershipCost(a);
  const altReturn=calcAltReturn(a);
  const appreciation=calcAppreciation(a);
  const realReturn=appreciation-ownershipCost.annual;
  const realReturnPct=a.value>0?Math.round(realReturn/a.value*100*10)/10:0;
  const altReturnPct=a.altRate||18;
  const lastUpd=a.lastUpdated?new Date(a.lastUpdated).toLocaleDateString('ru-RU'):'не обновлялся';
  const daysSince=a.lastUpdated?Math.floor((new Date(today())-new Date(a.lastUpdated))/(1000*60*60*24)):999;
  const needsUpdate=daysSince>=30;

  // Scenarios
  const scenarios=[
    {
      label:'Держать как есть',
      icon:'🏠',
      annualReturn:realReturn,
      pct:realReturnPct,
      desc:`Рост стоимости ${fmt(appreciation)}/год минус содержание ${fmt(ownershipCost.annual)}/год`,
      color:realReturn>=0?'var(--green-dark)':'var(--red)'
    },
    {
      label:'Продать → депозит '+altReturnPct+'%',
      icon:'🏦',
      annualReturn:Math.round(a.value*altReturnPct/100),
      pct:altReturnPct,
      desc:`${fmt(Math.round(a.value*altReturnPct/100))}/год без расходов на содержание`,
      color:'var(--blue)'
    },
    {
      label:'Продать → облигации/ОФЗ',
      icon:'📈',
      annualReturn:Math.round(a.value*(altReturnPct-2)/100),
      pct:altReturnPct-2,
      desc:`${fmt(Math.round(a.value*(altReturnPct-2)/100))}/год + ликвидность`,
      color:'var(--green-dark)'
    },
  ];
  if(a.assetType==='apartment'){
    scenarios.push({
      label:'Сдать в аренду',
      icon:'🔑',
      annualReturn:Math.round((a.rentalIncome||0)*12-ownershipCost.annual),
      pct:a.value>0?Math.round(((a.rentalIncome||0)*12-ownershipCost.annual)/a.value*100*10)/10:0,
      desc:`Аренда ${fmt(a.rentalIncome||0)}/мес минус содержание ${fmt(Math.round(ownershipCost.annual/12))}/мес`,
      color:'var(--amber)'
    });
  }
  const bestScenario=scenarios.reduce((best,s)=>s.annualReturn>best.annualReturn?s:best,scenarios[0]);

  return`<div style="background:var(--card);border:1.5px solid ${needsUpdate?'var(--orange)':'var(--border2)'};border-radius:12px;padding:16px;margin-bottom:14px">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px">
      <div>
        <div style="font-size:16px;font-weight:700;color:var(--topbar)">${esc(a.icon||'🏠')} ${esc(a.name)}</div>
        <div style="font-size:11px;color:var(--text2);margin-top:2px">${a.assetType==='apartment'?'Квартира':a.assetType==='car'?'Автомобиль':'Актив'} · обновлён: ${lastUpd}</div>
        ${needsUpdate?`<div style="font-size:11px;color:var(--orange-dark);font-weight:600;margin-top:3px">⚠ Обновите стоимость (${daysSince} дн.)</div>`:''}
      </div>
      <div style="display:flex;gap:5px">
        <button class="sbtn blue" onclick="window.editPhysAsset(${i})">Изм.</button>
        <button class="sbtn amber" onclick="window.updateAssetValue(${i})">Цена</button>
        <button class="sbtn red" onclick="window.deletePhysAsset(${i})">✕</button>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:14px">
      <div class="bal-item"><div class="bal-lbl">СТОИМОСТЬ</div><div class="bal-val sm">${fmt(a.value)}</div></div>
      <div class="bal-item ${realReturn>=0?'green':'red'}">
        <div class="bal-lbl">РЕАЛ. ДОХОД/ГОД</div>
        <div class="bal-val sm ${realReturn>=0?'pos':'neg'}">${realReturn>=0?'+':''}${fmt(Math.round(realReturn))}</div>
      </div>
      <div class="bal-item"><div class="bal-lbl">РАСХОДЫ/МЕС</div><div class="bal-val sm neg">${fmt(Math.round(ownershipCost.monthly))}</div></div>
      <div class="bal-item blue" style="background:var(--blue-bg)">
        <div class="bal-lbl">ДОХОДНОСТЬ</div>
        <div class="bal-val sm" style="color:${realReturn>=0?'var(--green-dark)':'var(--red)'}">${realReturnPct>=0?'+':''}${realReturnPct}%</div>
      </div>
    </div>

    <div style="font-size:11px;font-weight:700;color:var(--text2);letter-spacing:.5px;margin-bottom:8px">СЦЕНАРИИ ИСПОЛЬЗОВАНИЯ КАПИТАЛА</div>
    <div style="display:grid;grid-template-columns:repeat(${scenarios.length},1fr);gap:8px;margin-bottom:12px">
      ${scenarios.map(s=>{
        const isBest=s===bestScenario;
        return`<div style="background:${isBest?'var(--amber-light)':'var(--card)'};border:${isBest?'2px solid var(--amber)':'1.5px solid var(--border)'};border-radius:8px;padding:10px;text-align:center;position:relative">
          ${isBest?'<div style="position:absolute;top:-8px;left:50%;transform:translateX(-50%);background:var(--amber);color:#fff;font-size:9px;font-weight:700;padding:2px 7px;border-radius:10px;white-space:nowrap">ВЫГОДНЕЕ</div>':''}
          <div style="font-size:14px;margin-bottom:3px">${s.icon}</div>
          <div style="font-size:10px;font-weight:700;color:var(--topbar);margin-bottom:4px;line-height:1.3">${s.label}</div>
          <div style="font-size:14px;font-weight:700;color:${s.color}">${s.annualReturn>=0?'+':''}${fmt(Math.round(s.annualReturn))}</div>
          <div style="font-size:9px;color:var(--text2);margin-top:3px">${s.pct>=0?'+':''}${s.pct}%/год</div>
          <div style="font-size:9px;color:var(--text2);margin-top:3px;line-height:1.4">${s.desc}</div>
        </div>`;
      }).join('')}
    </div>

    <div style="background:${bestScenario===scenarios[0]?'var(--green-bg)':'var(--blue-bg)'};border-radius:8px;padding:10px 12px;font-size:12px;line-height:1.5">
      ${bestScenario===scenarios[0]
        ?`✓ Держать выгодно. Актив приносит ${realReturnPct}%/год с учётом расходов.`
        :`💡 Рассмотри вариант «${bestScenario.label}» — он приносит на ${fmt(Math.round(bestScenario.annualReturn-realReturn))} больше в год.`
      }
    </div>

    <div style="margin-top:12px;padding-top:10px;border-top:1px solid var(--border)">
      <div style="font-size:11px;font-weight:700;color:var(--text2);letter-spacing:.5px;margin-bottom:6px">РАСХОДЫ НА СОДЕРЖАНИЕ (из операций)</div>
      ${ownershipCost.breakdown.map(b=>`<div style="display:flex;justify-content:space-between;font-size:11px;padding:3px 0">
        <span style="color:var(--topbar)">${esc(b.cat)}</span>
        <span style="color:var(--orange-dark)">−${fmt(b.monthly)}/мес</span>
      </div>`).join('')||'<div style="font-size:11px;color:var(--text2)">Привяжите категории расходов в настройках актива</div>'}
    </div>
  </div>`;
}

function calcOwnershipCost(a){
  // Average monthly spending on linked categories (last 3 months)
  let total=0,months=0;
  for(let i=0;i<3;i++){
    const ops=getMOps(-i).filter(o=>!isPlanned(o.type));
    const spent=ops.filter(o=>o.type==='expense'&&(a.categories||[]).includes(o.category))
      .reduce((s,o)=>s+o.amount,0);
    if(spent>0){total+=spent;months++;}
  }
  const monthly=months>0?Math.round(total/months):0;
  // Breakdown by category
  const catTotals={};
  for(let i=0;i<3;i++){
    const ops=getMOps(-i).filter(o=>!isPlanned(o.type));
    ops.filter(o=>o.type==='expense'&&(a.categories||[]).includes(o.category))
      .forEach(o=>{catTotals[o.category]=(catTotals[o.category]||0)+o.amount;});
  }
  const breakdown=Object.entries(catTotals).map(([cat,total])=>({cat,monthly:Math.round(total/(months||1))}))
    .sort((a,b)=>b.monthly-a.monthly);
  return{monthly,annual:monthly*12,breakdown};
}

function calcAltReturn(a){
  return Math.round(a.value*(a.altRate||18)/100);
}

function calcAppreciation(a){
  if(!a.prevValue||!a.value)return Math.round(a.value*(a.growthRate||5)/100);
  return a.value-a.prevValue;
}

function renderAssetsSummary(){
  const el=$('assets-summary');if(!el||!state.D.physAssets.length)return;
  const totalValue=state.D.physAssets.reduce((s,a)=>s+a.value,0);
  const totalCost=state.D.physAssets.reduce((s,a)=>{
    const c=calcOwnershipCost(a);return s+c.monthly;
  },0);
  el.innerHTML=`<div class="bal-grid" style="margin-bottom:var(--gap)">
    <div class="bal-item full"><div class="bal-lbl">ФИЗИЧЕСКИЙ КАПИТАЛ</div><div class="bal-val lg">${fmt(totalValue)}</div></div>
    <div class="bal-item red"><div class="bal-lbl">РАСХОДЫ НА СОДЕРЖАНИЕ</div><div class="bal-val sm neg">${fmt(totalCost)}/мес</div></div>
    <div class="bal-item blue" style="background:var(--blue-bg)"><div class="bal-lbl">АЛЬТ. ДОХОД В ГОД</div><div class="bal-val sm" style="color:var(--blue)">${fmt(state.D.physAssets.reduce((s,a)=>s+calcAltReturn(a),0))}</div></div>
  </div>`;
}

// ── CRUD ────────────────────────────────────────────────────────
window.openAddPhysAsset=function(){
  $('pa-idx').value=-1;$('pa-name').value='';$('pa-type').value='apartment';
  $('pa-value').value='';$('pa-prev-value').value='';
  $('pa-alt-rate').value=18;$('pa-growth-rate').value=5;
  $('pa-rental').value='';
  fillPACats([]);
  document.getElementById('modal-phys-asset').classList.add('open');
};

window.editPhysAsset=function(i){
  const a=state.D.physAssets[i];
  $('pa-idx').value=i;$('pa-name').value=a.name;$('pa-type').value=a.assetType||'apartment';
  $('pa-value').value=a.value;$('pa-prev-value').value=a.prevValue||'';
  $('pa-alt-rate').value=a.altRate||18;$('pa-growth-rate').value=a.growthRate||5;
  $('pa-rental').value=a.rentalIncome||'';
  fillPACats(a.categories||[]);
  document.getElementById('modal-phys-asset').classList.add('open');
};

window.updateAssetValue=function(i){
  const a=state.D.physAssets[i];
  const newVal=parseFloat(prompt(`Текущая стоимость "${a.name}" (сейчас: ${fmt(a.value)}):`));
  if(!newVal||isNaN(newVal))return;
  state.D.physAssets[i].prevValue=a.value;
  state.D.physAssets[i].value=newVal;
  state.D.physAssets[i].lastUpdated=today();
  if(!state.D.assetsUpdated)state.D.assetsUpdated={};
  state.D.assetsUpdated[a.id]=today();
  sched();renderAssets();
};

function fillPACats(selected){
  const all=[...state.D.incomeCats,...state.D.expenseCats.map(c=>c.name)];
  $('pa-cats').innerHTML=all.map(cat=>`
    <label style="display:flex;align-items:center;gap:6px;padding:3px 0;font-size:12px;cursor:pointer">
      <input type="checkbox" ${selected.includes(cat)?'checked':''} value="${cat}" style="accent-color:var(--amber)">
      ${cat}
    </label>`).join('');
}

window.savePhysAsset=function(){
  if(!state.D.physAssets)state.D.physAssets=[];
  const idx=+$('pa-idx').value;
  const cats=[...$('pa-cats').querySelectorAll('input:checked')].map(i=>i.value);
  const asset={
    id:idx>=0?state.D.physAssets[idx].id:('pa'+Date.now()),
    name:$('pa-name').value.trim(),
    assetType:$('pa-type').value,
    icon:$('pa-type').value==='apartment'?'🏠':$('pa-type').value==='car'?'🚗':'💎',
    value:parseFloat($('pa-value').value)||0,
    prevValue:parseFloat($('pa-prev-value').value)||0,
    altRate:parseFloat($('pa-alt-rate').value)||18,
    growthRate:parseFloat($('pa-growth-rate').value)||5,
    rentalIncome:parseFloat($('pa-rental').value)||0,
    categories:cats,
    lastUpdated:today()
  };
  if(!asset.name||!asset.value){alert('Заполните название и стоимость');return;}
  if(idx>=0)state.D.physAssets[idx]=asset;else state.D.physAssets.push(asset);
  if(!state.D.assetsUpdated)state.D.assetsUpdated={};
  state.D.assetsUpdated[asset.id]=today();
  sched();
  document.getElementById('modal-phys-asset').classList.remove('open');
  renderAssets();
};

window.deletePhysAsset=function(i){
  if(!confirm('Удалить актив?'))return;
  state.D.physAssets.splice(i,1);sched();renderAssets();
};

// ── Alert check ─────────────────────────────────────────────────
export function checkAssetsAlert(){
  if(!state.D||!state.D.physAssets||!state.D.physAssets.length)return null;
  const outdated=state.D.physAssets.filter(a=>{
    if(!a.lastUpdated)return true;
    const days=Math.floor((new Date(today())-new Date(a.lastUpdated))/(1000*60*60*24));
    return days>=30;
  });
  if(outdated.length)return`Обновите стоимость: ${outdated.map(a=>a.name).join(', ')}`;
  return null;
}
