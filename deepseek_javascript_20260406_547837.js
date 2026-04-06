import{$,state,today,isPlanned,sched,planById}from'./core.js';

export function openModal(id,isNew,deps){
  if(id!=='modal'){
    if(id==='modal-exp-cat'&&isNew){
      $('exp-cat-modal-title').textContent='НОВАЯ КАТЕГОРИЯ РАСХОДОВ';
      $('ec-name').value='';$('ec-idx').value=-1;
      deps?.fillExpPlanSel('ec-plan');
    }
    $(id).classList.add('open');return;
  }
  $(id).classList.add('open');
  $('op-date').value=today();
  setType('income');
  
  // Заполняем оба селекта кошельков при открытии модалки
  const opts = state.D.wallets.map(w=>`<option value="${w.id}">${w.name}</option>`).join('');
  $('op-wallet').innerHTML = opts;
  $('op-wallet2').innerHTML = opts;
  
  $('op-amount').value='';
  $('op-note').value='';
}

export function closeModal(id){
  $(id).classList.remove('open');
}

export function setType(type){
  state.curType = type;
  const map = {income:'ai', expense:'ae', transfer:'at', planned_income:'api', planned_expense:'ape'};
  ['income','expense','transfer','planned_income','planned_expense'].forEach(t=>{
    const e = $('type-'+t);
    if(e) e.className = 'type-btn' + (t===type ? ' '+map[t] : '');
  });
  
  const isPlan = isPlanned(type);
  const isTr = type === 'transfer';
  
  $('planned-notice').style.display = isPlan ? '' : 'none';
  $('wallet-group').style.display = (isTr || isPlan) ? 'none' : '';
  $('wallet2-group').style.display = isTr ? '' : 'none';
  $('transfer-cat-group').style.display = isTr ? '' : 'none';
  $('cat-group').style.display = isTr ? 'none' : '';
  $('wallet-label').textContent = isTr ? 'КОШЕЛЁК (ОТКУДА)' : 'КОШЕЛЁК';
  $('cat-label').textContent = isPlan ? 'НАЗВАНИЕ / КАТЕГОРИЯ' : 'КАТЕГОРИЯ';
  
  // Для перевода: заполняем оба селекта кошельков актуальными данными
  if(isTr){
    const opts = state.D.wallets.map(w=>`<option value="${w.id}">${w.name}</option>`).join('');
    // Обновляем оба селекта (на случай, если кошельки изменились)
    $('op-wallet').innerHTML = opts;
    $('op-wallet2').innerHTML = opts;
    
    // Если есть хотя бы 2 кошелька, для второго выбираем второй по счёту (не тот же, что первый)
    if(state.D.wallets.length >= 2){
      // Устанавливаем второй кошелёк отличным от первого, если они одинаковы
      if($('op-wallet').value === $('op-wallet2').value){
        $('op-wallet2').value = state.D.wallets[1].id;
      }
    }
    
    $('op-transfer-cat').innerHTML = '<option value="">— не указывать —</option>' +
      state.D.plan.map(p=>`<option value="${p.id}">${p.label}</option>`).join('');
    return;
  }
  
  // Для остальных типов операций
  let cats = [];
  if(type === 'income') cats = state.D.incomeCats;
  else if(type === 'expense') cats = state.D.expenseCats.map(c=>c.name);
  else if(isPlan) cats = [...new Set([...state.D.incomeCats, ...state.D.expenseCats.map(c=>c.name)])];
  $('op-cat').innerHTML = cats.map(c=>`<option value="${c}">${c}</option>`).join('');
}

export function saveOperation(onDone){
  const amount = parseFloat($('op-amount').value);
  if(!amount || amount <= 0){ alert('Введите сумму'); return; }
  const date = $('op-date').value;
  const note = $('op-note').value.trim();
  const type = state.curType;
  const op = {
    id: 'op' + Date.now(),
    type,
    amount,
    date,
    note,
    category: $('op-cat')?.value || note
  };
  
  if(!isPlanned(type)){
    if(type !== 'transfer') op.wallet = $('op-wallet').value;
    
    if(type === 'income'){
      const w = state.D.wallets.find(w=>w.id === op.wallet);
      if(w) w.balance += amount;
    }
    else if(type === 'expense'){
      const w = state.D.wallets.find(w=>w.id === op.wallet);
      if(w) w.balance -= amount;
    }
    else if(type === 'transfer'){
      op.wallet = $('op-wallet').value;
      op.walletTo = $('op-wallet2').value;
      op.planId = $('op-transfer-cat').value || '';
      
      // Проверка: нельзя переводить в тот же кошелёк
      if(op.wallet === op.walletTo){
        alert('Нельзя перевести средства в тот же кошелёк');
        return;
      }
      
      const wf = state.D.wallets.find(w=>w.id === op.wallet);
      const wt = state.D.wallets.find(w=>w.id === op.walletTo);
      if(wf) wf.balance -= amount;
      if(wt) wt.balance += amount;
    }
  }
  
  state.D.operations.push(op);
  sched();
  closeModal('modal');
  onDone();
}

export function openEditOp(id){
  const o = state.D.operations.find(op=>op.id === id);
  if(!o) return;
  if(isPlanned(o.type) || o.type === 'transfer'){
    alert('Редактирование доступно только для доходов и расходов');
    return;
  }
  
  $('edit-op-id').value = id;
  $('edit-op-amount').value = o.amount;
  $('edit-op-date').value = o.date;
  $('edit-op-note').value = o.note || '';
  
  const opts = state.D.wallets.map(w=>`<option value="${w.id}">${w.name}</option>`).join('');
  $('edit-op-wallet').innerHTML = opts;
  $('edit-op-wallet').value = o.wallet;
  
  const cats = o.type === 'income' ? state.D.incomeCats : state.D.expenseCats.map(c=>c.name);
  $('edit-op-cat').innerHTML = cats.map(c=>`<option value="${c}">${c}</option>`).join('');
  $('edit-op-cat').value = o.category || '';
  
  document.getElementById('modal-edit-op').classList.add('open');
}

export function saveEditOp(onDone){
  const id = $('edit-op-id').value;
  const idx = state.D.operations.findIndex(o=>o.id === id);
  if(idx === -1) return;
  
  const o = state.D.operations[idx];
  const newAmt = parseFloat($('edit-op-amount').value);
  if(!newAmt || newAmt <= 0){ alert('Введите сумму'); return; }
  
  const newW = $('edit-op-wallet').value;
  const wOld = state.D.wallets.find(w=>w.id === o.wallet);
  
  if(wOld){
    if(o.type === 'income') wOld.balance -= o.amount;
    else wOld.balance += o.amount;
  }
  
  const wNew = state.D.wallets.find(w=>w.id === newW);
  if(wNew){
    if(o.type === 'income') wNew.balance += newAmt;
    else wNew.balance -= newAmt;
  }
  
  state.D.operations[idx] = {
    ...o,
    amount: newAmt,
    date: $('edit-op-date').value,
    wallet: newW,
    category: $('edit-op-cat').value,
    note: $('edit-op-note').value.trim()
  };
  
  sched();
  document.getElementById('modal-edit-op').classList.remove('open');
  onDone();
}

export function deleteOp(id, onDone){
  const idx = state.D.operations.findIndex(o=>o.id === id);
  if(idx === -1) return;
  
  const o = state.D.operations[idx];
  if(!confirm('Удалить операцию?')) return;
  
  if(o.type === 'income'){
    const w = state.D.wallets.find(w=>w.id === o.wallet);
    if(w) w.balance -= o.amount;
  }
  else if(o.type === 'expense'){
    const w = state.D.wallets.find(w=>w.id === o.wallet);
    if(w) w.balance += o.amount;
  }
  else if(o.type === 'transfer'){
    const wf = state.D.wallets.find(w=>w.id === o.wallet);
    const wt = state.D.wallets.find(w=>w.id === o.walletTo);
    if(wf) wf.balance += o.amount;
    if(wt) wt.balance -= o.amount;
  }
  
  state.D.operations.splice(idx, 1);
  sched();
  onDone();
}