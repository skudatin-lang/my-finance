import{$,state,sched,fmt,today}from'./core.js';

export function renderGoals(){
  if(!state.D)return;
  if(!state.D.goals)state.D.goals=[];
  const el=$('goals-list');if(!el)return;
  if(!state.D.goals.length){
    el.innerHTML='<div style="color:var(--text2);font-size:13px;padding:8px 0">Нет целей. Добавьте первую цель!</div>';
    return;
  }
  el.innerHTML=state.D.goals.map((g,i)=>{
    const wallet=state.D.wallets.find(w=>w.id===g.walletId);
    const saved=Math.max(wallet?.balance||0,0);
    const pct=g.target>0?Math.min(Math.round(saved/g.target*100),100):0;
    const left=Math.max(g.target-saved,0);
    // Monthly average contributions
    const now=new Date();
    let total=0,months=0;
    for(let mo=1;mo<=3;mo++){
      const dt=new Date(now.getFullYear(),now.getMonth()-mo,1);
      const ym=dt.getFullYear()+'-'+String(dt.getMonth()+1).padStart(2,'0');
      const ops=state.D.operations.filter(o=>o.type==='transfer'&&o.walletTo===g.walletId&&o.date&&o.date.startsWith(ym));
      if(ops.length){total+=ops.reduce((s,o)=>s+o.amount,0);months++;}
    }
    const avg=months>0?total/months:0;
    const monthsLeft=avg>0?Math.ceil(left/avg):null;
    const deadline=g.deadline?new Date(g.deadline):null;
    const daysLeft=deadline?Math.ceil((deadline-new Date())/(1000*60*60*24)):null;
    const onTrack=monthsLeft&&deadline?monthsLeft*30<=daysLeft:null;

    return`<div style="background:var(--card);border:1.5px solid var(--border2);border-radius:10px;padding:14px 16px;margin-bottom:10px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">
        <div>
          <div style="font-size:14px;font-weight:700;color:var(--topbar)">${g.name}</div>
          <div style="font-size:11px;color:var(--text2);margin-top:2px">${wallet?'Кошелёк: '+wallet.name:''}${g.deadline?' · Срок: '+new Date(g.deadline).toLocaleDateString('ru-RU'):''}</div>
        </div>
        <div style="display:flex;gap:5px">
          <button class="sbtn blue" onclick="window.editGoal(${i})">Изм.</button>
          <button class="sbtn red" onclick="window.deleteGoal(${i})">Удал.</button>
        </div>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:6px">
        <span style="font-weight:700;color:var(--green-dark)">${fmt(saved)}</span>
        <span style="color:var(--text2)">из ${fmt(g.target)}</span>
      </div>
      <div style="background:var(--g50);border-radius:4px;height:10px;margin-bottom:6px">
        <div style="height:10px;border-radius:4px;background:${pct>=100?'var(--green)':'var(--amber)'};width:${pct}%;transition:width .3s"></div>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text2)">
        <span>${pct}% · осталось ${fmt(left)}</span>
        <span>${monthsLeft?'~'+monthsLeft+' мес.':''}${onTrack!==null?' · '+(onTrack?'✓ В срок':'⚠ Не успеть'):''}</span>
      </div>
    </div>`;
  }).join('');
}

window.saveGoal=function(){
  if(!state.D.goals)state.D.goals=[];
  const idx=+($('goal-idx')?.value||'-1');
  const goal={
    id:idx>=0?state.D.goals[idx].id:('goal'+Date.now()),
    name:$('goal-name').value.trim(),
    target:parseFloat($('goal-target').value)||0,
    walletId:$('goal-wallet').value,
    deadline:$('goal-deadline').value||null
  };
  if(!goal.name||!goal.target){alert('Заполните название и сумму');return;}
  if(idx>=0)state.D.goals[idx]=goal;else state.D.goals.push(goal);
  sched();
  document.getElementById('modal-goal').classList.remove('open');
  renderGoals();
};

window.deleteGoal=function(i){
  if(!confirm('Удалить цель?'))return;
  state.D.goals.splice(i,1);sched();renderGoals();
};

window.editGoal=function(i){
  const g=state.D.goals[i];
  $('goal-idx').value=i;$('goal-name').value=g.name;
  $('goal-target').value=g.target;$('goal-wallet').value=g.walletId;
  $('goal-deadline').value=g.deadline||'';
  document.getElementById('modal-goal').classList.add('open');
};

window.openAddGoal=function(){
  $('goal-idx').value=-1;$('goal-name').value='';
  $('goal-target').value='';$('goal-deadline').value='';
  $('goal-wallet').innerHTML=state.D.wallets.map(w=>`<option value="${w.id}">${w.name}</option>`).join('');
  document.getElementById('modal-goal').classList.add('open');
};
