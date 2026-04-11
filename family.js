// family.js — Family sharing via Firebase shared document
import{state,sched,db,today,fmt}from'./core.js';
import{doc,getDoc,setDoc,onSnapshot,collection,query,where,orderBy,limit}from'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

// Family mode: owner creates a "family room", members get read-only access
// Data model:
//   /families/{familyId}/  — shared doc (calendar, shopping, planned ops)
//   /families/{familyId}/members/{uid} — member info
//   /users/{uid}/data/main — private (full data, stays private)

let _familyId=null;
let _unsubscribe=null;
export let familyData={shoppingLists:{},operations:[],walletsSummary:[]};

export function getFamilyId(){return _familyId;}
export function isInFamily(){return!!_familyId;}

export function loadFamilySettings(){
  if(!state.D)return;
  _familyId=state.D.familyId||null;
  if(_familyId)subscribeFamily();
}

// ── Create or join family ────────────────────────────────────────
export async function createFamily(familyName){
  if(!state.D||!state.CU)return{error:'Нет авторизации'};
  const id='fam_'+Date.now()+'_'+Math.random().toString(36).slice(2,8);
  const ref=doc(db,'families',id);
  await setDoc(ref,{
    name:familyName,
    ownerId:state.CU.uid,
    ownerName:state.CU.displayName||'Владелец',
    createdAt:today(),
    members:{[state.CU.uid]:{name:state.CU.displayName||'Владелец',role:'owner',joinedAt:today()}},
    shoppingLists:{},
    plannedOps:[],
    walletsSummary:[]
  });
  state.D.familyId=id;
  state.D.familyRole='owner';
  sched();
  _familyId=id;
  subscribeFamily();
  return{ok:true,familyId:id};
}

export async function joinFamily(familyId){
  if(!state.D||!state.CU)return{error:'Нет авторизации'};
  const ref=doc(db,'families',familyId);
  const snap=await getDoc(ref);
  if(!snap.exists())return{error:'Семья не найдена. Проверьте код.'};
  const data=snap.data();
  // Add member
  const members=data.members||{};
  members[state.CU.uid]={name:state.CU.displayName||'Участник',role:'member',joinedAt:today()};
  await setDoc(ref,{members},{merge:true});
  state.D.familyId=familyId;
  state.D.familyRole='member';
  sched();
  _familyId=familyId;
  subscribeFamily();
  return{ok:true,familyName:data.name};
}

export async function leaveFamily(){
  if(!_familyId||!state.CU)return;
  const ref=doc(db,'families',_familyId);
  const snap=await getDoc(ref);
  if(snap.exists()){
    const data=snap.data();
    const members=data.members||{};
    delete members[state.CU.uid];
    await setDoc(ref,{members},{merge:true});
  }
  if(_unsubscribe){_unsubscribe();_unsubscribe=null;}
  _familyId=null;
  delete state.D.familyId;
  delete state.D.familyRole;
  sched();
  renderFamily();
}

// ── Subscribe to family real-time updates ────────────────────────
function subscribeFamily(){
  if(!_familyId)return;
  if(_unsubscribe){_unsubscribe();_unsubscribe=null;}
  const ref=doc(db,'families',_familyId);
  _unsubscribe=onSnapshot(ref,snap=>{
    if(!snap.exists())return;
    familyData=snap.data();
    renderFamily();
    if(window._renderShopWidget)window._renderShopWidget();
  },err=>console.warn('Family sync error:',err));
}

// ── Publish family data (owner pushes their calendar/shopping) ───
export async function publishFamilyData(){
  if(!_familyId||!state.D||!state.CU)return;
  const role=state.D.familyRole;
  const ref=doc(db,'families',_familyId);

  // Get upcoming planned operations (next 30 days)
  const now=new Date();
  const in30=new Date(now.getTime()+30*864e5);
  const planned=state.D.operations.filter(o=>{
    if(o.type!=='planned_income'&&o.type!=='planned_expense')return false;
    const d=new Date(o.date+'T12:00:00');
    return d>=now&&d<=in30;
  }).map(o=>({
    id:o.id,type:o.type,amount:o.amount,date:o.date,
    category:o.category,note:o.note,
    addedBy:state.CU.displayName||'Владелец'
  }));

  // Today's transactions (anonymized — only totals per member)
  const todayStr=today();
  const todayOps=state.D.operations.filter(o=>o.date===todayStr&&(o.type==='income'||o.type==='expense'));
  const todayInc=todayOps.filter(o=>o.type==='income').reduce((s,o)=>s+o.amount,0);
  const todayExp=todayOps.filter(o=>o.type==='expense').reduce((s,o)=>s+o.amount,0);

  // Wallet summary (totals only, no transaction history)
  const walletsSummary=state.D.wallets.map(w=>({
    name:w.name,
    balance:w.balance,
    isDebt:w.balance<0
  }));

  const update={
    [`members.${state.CU.uid}.todayIncome`]:todayInc,
    [`members.${state.CU.uid}.todayExpense`]:todayExp,
    [`members.${state.CU.uid}.lastSync`]:todayStr,
    walletsSummary,
    plannedOps:planned,
    // Shopping is merged per member
    [`shoppingByMember.${state.CU.uid}`]:state.D.shoppingLists||{}
  };

  // Shared shopping lists (merged from owner)
  if(role==='owner'&&state.D.shoppingLists){
    update.shoppingLists=state.D.shoppingLists;
  }

  await setDoc(ref,update,{merge:true});
}

// Member adds to shared shopping list
export async function addToFamilyShoppingList(date,items){
  if(!_familyId)return;
  const ref=doc(db,'families',_familyId);
  const snap=await getDoc(ref);
  const data=snap.exists()?snap.data():{};
  const lists=data.shoppingLists||{};
  if(!lists[date])lists[date]=[];
  items.forEach(item=>lists[date].push({...item,addedBy:state.CU?.displayName||'Участник',id:'sh'+Date.now()+Math.random()}));
  await setDoc(ref,{shoppingLists:lists},{merge:true});
}

// ── Render family panel ──────────────────────────────────────────
export function renderFamily(){
  const el=document.getElementById('family-content');if(!el)return;
  if(!_familyId){
    el.innerHTML=`
      <div style="text-align:center;padding:24px">
        <div style="font-size:32px;margin-bottom:12px">👨‍👩‍👧‍👦</div>
        <div style="font-size:15px;font-weight:700;color:var(--topbar);margin-bottom:8px">Семейный доступ</div>
        <div style="font-size:13px;color:var(--text2);margin-bottom:20px;line-height:1.6">
          Объедините финансы семьи: общий список покупок,<br>
          синхронизация календаря и сводка за день
        </div>
        <button class="btn-primary" style="max-width:280px" onclick="window.openCreateFamily()">Создать семейную группу</button>
        <div style="margin-top:12px">
          <button class="btn-sec" style="max-width:280px;margin-top:0" onclick="window.openJoinFamily()">Вступить в группу по коду</button>
        </div>
      </div>`;
    return;
  }

  const myRole=state.D?.familyRole||'member';
  const members=familyData.members||{};
  const planned=familyData.plannedOps||[];
  const shopLists=familyData.shoppingLists||{};

  // Planned ops next 7 days
  const next7=new Date();next7.setDate(next7.getDate()+7);
  const upcoming=planned.filter(o=>{const d=new Date(o.date+'T12:00:00');return d>=new Date()&&d<=next7;})
    .sort((a,b)=>a.date>b.date?1:-1);

  // Today shopping across all dates
  const todayList=(shopLists[today()]||[]).filter(i=>!i.done);

  el.innerHTML=`
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
      <div>
        <div style="font-size:15px;font-weight:700;color:var(--topbar)">${familyData.name||'Семейная группа'}</div>
        <div style="font-size:11px;color:var(--text2)">Код группы: <b style="color:var(--amber-dark);letter-spacing:1px">${_familyId.split('_').pop()}</b> · поделитесь с членами семьи</div>
      </div>
      ${myRole==='owner'?`<button class="sbtn amber" onclick="window.publishFamilyData()" style="font-size:11px">↑ Синхронизировать</button>`:''}
    </div>

    <!-- Members today summary -->
    <div style="font-size:11px;font-weight:700;color:var(--text2);letter-spacing:.5px;margin-bottom:8px">УЧАСТНИКИ — СЕГОДНЯ</div>
    <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px">
      ${Object.entries(members).map(([uid,m])=>`
        <div style="background:var(--amber-light);border:1px solid var(--border);border-radius:8px;padding:8px 12px;min-width:130px">
          <div style="font-size:12px;font-weight:700;color:var(--topbar)">${m.name||'Участник'}${m.role==='owner'?' 👑':''}</div>
          ${m.todayIncome||m.todayExpense?`
            <div style="font-size:11px;color:var(--green-dark);margin-top:3px">+ ${fmt(m.todayIncome||0)}</div>
            <div style="font-size:11px;color:var(--orange-dark)">− ${fmt(m.todayExpense||0)}</div>
          `:'<div style="font-size:10px;color:var(--text2);margin-top:3px">нет операций</div>'}
        </div>`).join('')}
    </div>

    <!-- Upcoming planned -->
    ${upcoming.length?`
      <div style="font-size:11px;font-weight:700;color:var(--text2);letter-spacing:.5px;margin-bottom:8px">БЛИЖАЙШИЕ ПЛАТЕЖИ (7 дней)</div>
      ${upcoming.slice(0,6).map(o=>{
        const d=new Date(o.date+'T12:00:00');
        const ds=d.toLocaleDateString('ru-RU',{day:'numeric',month:'short'});
        const isInc=o.type==='planned_income';
        return`<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:.5px solid var(--border);font-size:12px">
          <span><span style="color:var(--text2)">${ds}</span> · <span style="color:var(--topbar)">${o.category||o.note||'—'}</span></span>
          <span style="font-weight:700;color:${isInc?'var(--green-dark)':'var(--orange-dark)'}">${isInc?'+ ':'− '}${fmt(o.amount)}</span>
        </div>`;
      }).join('')}
    `:''}

    <!-- Shared shopping list today -->
    ${todayList.length?`
      <div style="font-size:11px;font-weight:700;color:var(--text2);letter-spacing:.5px;margin-top:14px;margin-bottom:8px">ОБЩИЙ СПИСОК ПОКУПОК — СЕГОДНЯ</div>
      ${todayList.map(i=>`<div style="font-size:12px;padding:5px 0;border-bottom:.5px solid var(--border);display:flex;justify-content:space-between">
        <span>🛒 ${i.name}${i.qty>1?' × '+i.qty:''}</span>
        ${i.addedBy?`<span style="color:var(--text2);font-size:10px">${i.addedBy}</span>`:''}
      </div>`).join('')}
    `:''}

    <div style="margin-top:16px;display:flex;gap:8px">
      <button class="btn-sec" style="flex:1;margin-top:0;font-size:12px" onclick="window.leaveFamily()" style="color:var(--red)">Покинуть группу</button>
    </div>`;
}

// ── Window bindings ──────────────────────────────────────────────
window.openCreateFamily=function(){
  const name=prompt('Название семейной группы (например: Семья Ивановых)');
  if(!name)return;
  createFamily(name).then(r=>{
    if(r.error){alert('Ошибка: '+r.error);return;}
    alert(`Группа создана!\n\nКод для вступления: ${r.familyId.split('_').pop()}\nПоделитесь кодом с членами семьи.`);
    renderFamily();
  });
};

window.openJoinFamily=function(){
  const code=prompt('Введите код группы (6 символов):');
  if(!code)return;
  // Find full family ID by suffix
  const fullId=`fam_${code}`;
  joinFamily(fullId).then(r=>{
    if(r.error){alert('Ошибка: '+r.error);return;}
    alert('Вы вступили в группу «'+r.familyName+'»!');
    renderFamily();
  }).catch(()=>{
    // Try to find by partial match — need Firestore query
    alert('Группа не найдена. Убедитесь что код правильный.\nПопросите владельца поделиться полным кодом из раздела Семья.');
  });
};

window.publishFamilyData=async function(){
  await publishFamilyData();
  alert('Данные синхронизированы с семейной группой');
};

window.leaveFamily=function(){
  if(!confirm('Покинуть семейную группу?'))return;
  leaveFamily().then(()=>{alert('Вы покинули группу');});
};
