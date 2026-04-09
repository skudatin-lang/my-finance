import{initializeApp}from'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import{getAuth,GoogleAuthProvider,signInWithPopup,signOut as fbOut,onAuthStateChanged}from'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import{getFirestore,doc,getDoc,setDoc}from'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

const fbApp=initializeApp({
  apiKey:"AIzaSyDZUAeJU97_ZhrsqAQVDCiwBe7yHMz68xM",
  authDomain:"my-finance-25c36.firebaseapp.com",
  projectId:"my-finance-25c36",
  storageBucket:"my-finance-25c36.firebasestorage.app",
  messagingSenderId:"529108431297",
  appId:"1:529108431297:web:bf43f0e6765c6ce958bf40"
});

export const auth=getAuth(fbApp);
export const db=getFirestore(fbApp);
export const prov=new GoogleAuthProvider();

export const MONTHS=['ЯНВАРЬ','ФЕВРАЛЬ','МАРТ','АПРЕЛЬ','МАЙ','ИЮНЬ','ИЮЛЬ','АВГУСТ','СЕНТЯБРЬ','ОКТЯБРЬ','НОЯБРЬ','ДЕКАБРЬ'];

export const DEFAULT_DATA={
  wallets:[{id:'w1',name:'Карта',balance:0},{id:'w2',name:'Наличные',balance:0},{id:'w3',name:'Сбережения',balance:0}],
  incomeCats:['Зарплата','Фриланс','Подработка','Прочее'],
  expenseCats:[
    {name:'З/П жены',planId:'p1'},{name:'Продукты',planId:'p4'},{name:'Квартплата',planId:'p4'},
    {name:'Транспорт',planId:'p4'},{name:'Связь',planId:'p4'},{name:'Кафе и рестораны',planId:'p5'},
    {name:'Одежда',planId:'p5'},{name:'Развлечения',planId:'p5'},{name:'Здоровье',planId:'p5'},
    {name:'Кредит',planId:'p6'},{name:'Кредитная карта',planId:'p6'},{name:'Крупные покупки',planId:'p7'}
  ],
  plan:[
    {id:'p1',label:'З/П жены',pct:10,type:'expense'},
    {id:'p2',label:'Накопления',pct:10,type:'income'},
    {id:'p3',label:'Бизнес',pct:10,type:'income'},
    {id:'p4',label:'Постоянные расходы',pct:35,type:'expense'},
    {id:'p5',label:'Переменные расходы',pct:10,type:'expense'},
    {id:'p6',label:'Кредиты',pct:15,type:'expense'},
    {id:'p7',label:'Покупки',pct:10,type:'expense'}
  ],
  operations:[],
  version:10
};

// Shared mutable state
export const state={
  D:null, CU:null, saveTimer:null,
  repOff:0, ddsOff:0, calOff:0,
  calDay:null, walletIdx:0, curCatTab:'income', curType:'income'
};

// ── Utilities ──────────────────────────────────────
export const $=id=>document.getElementById(id);
export const fmt=n=>'₽ '+Math.abs(Math.round(n)).toLocaleString('ru-RU');
export const fmtS=n=>(n>=0?'+ ':'\u2212 ')+'₽ '+Math.abs(Math.round(n)).toLocaleString('ru-RU');
export const today=()=>new Date().toISOString().split('T')[0];
export const wName=id=>{const w=state.D.wallets.find(w=>w.id===id);return w?w.name:id||'?';};
export const fmtD=ds=>{if(!ds)return'';const[y,m,d]=ds.split('-');return d+'.'+m+'.'+y;};
export const getMOps=off=>{
  const dt=new Date(new Date().getFullYear(),new Date().getMonth()+off,1);
  const ym=dt.getFullYear()+'-'+String(dt.getMonth()+1).padStart(2,'0');
  return state.D.operations.filter(o=>o.date&&o.date.startsWith(ym));
};
export const planById=id=>state.D.plan.find(p=>p.id===id);
export const catPlanId=name=>{const c=state.D.expenseCats.find(c=>c.name===name);return c?c.planId:null;};
export const isPlanned=t=>t==='planned_income'||t==='planned_expense';

export function opHtml(o,showDel){
  const D=state.D;
  const isIn=o.type==='income',isOut=o.type==='expense',isTr=o.type==='transfer';
  const sc=isIn?'pos':(isOut?'neg':'');
  const pfx=isIn?'+':(isOut?'\u2212':'');
  const label=isTr?`Перевод \u2192 ${wName(o.walletTo)}`:(o.category||'—');
  const pid=isTr?o.planId:catPlanId(o.category);
  const badge=pid?`<span class="op-badge">${planById(pid)?.label||''}</span>`:'';
  const editBtn=showDel&&!isTr&&!isPlanned(o.type)?`<button class="op-btn edit" onclick="window.openEditOp('${o.id}')" title="Редактировать">&#9998;</button>`:'';
  const delBtn=showDel?`<button class="op-btn del" onclick="window.deleteOp('${o.id}')" title="Удалить">&#10005;</button>`:'';
  return`<div class="op-item">
    <div class="op-top">
      <div style="flex:1;min-width:0"><div class="op-title">${label}</div><div class="op-meta">${wName(o.wallet||'')} &nbsp;${fmtD(o.date)}</div>${badge}</div>
      <div class="op-actions"><div class="op-amt ${sc}">${pfx} ${fmt(o.amount)}</div>${editBtn}${delBtn}</div>
    </div>
  </div>`;
}

// ── Persistence ────────────────────────────────────
export function migrate(){
  const D=state.D;
  if(!D.version||D.version<10){
    if(D.expenseCats&&typeof D.expenseCats[0]==='string')
      D.expenseCats=D.expenseCats.map(n=>({name:n,planId:D.plan.find(p=>p.type==='expense')?.id||''}));
    D.operations=D.operations.map(o=>o.type==='planned'?{...o,type:'planned_income'}:o);
    const p1=D.plan.find(p=>p.id==='p1');if(p1)p1.type='expense';
    D.version=10;
  }
}

export async function saveNow(){
  if(!state.CU)return;
  try{await setDoc(doc(db,'users',state.CU.uid,'data','main'),state.D);}catch(e){}
}

export function sched(){
  if(state.saveTimer)clearTimeout(state.saveTimer);
  state.saveTimer=setTimeout(saveNow,1500);
}

export async function loadData(uid){
  try{
    const s=await getDoc(doc(db,'users',uid,'data','main'));
    if(s.exists()){state.D=s.data();migrate();}
    else{state.D=JSON.parse(JSON.stringify(DEFAULT_DATA));await saveNow();}
  }catch(e){state.D=JSON.parse(JSON.stringify(DEFAULT_DATA));}
}

// ── Plan spending helper ───────────────────────────
export function planSpent(p,ops){
  const cats=state.D.expenseCats.filter(c=>c.planId===p.id).map(c=>c.name);
  const planLabel=p.label;
  // Кошельки привязанные к этой статье плана (например "т-банк Капитал" → "Накопления")
  const linkedWalletIds=state.D.wallets.filter(w=>w.planId===p.id).map(w=>w.id);
  return ops.filter(o=>
    // Расход с категорией из этой статьи
    (o.type==='expense'&&cats.includes(o.category))||
    // Расход с категорией = название статьи (напр. "Бизнес")
    (o.type==='expense'&&(o.category===planLabel||o.planId===p.id))||
    // Перевод с явной привязкой (planId или planLabel)
    (o.type==='transfer'&&(o.planId===p.id||o.planLabel===planLabel))||
    // Перевод НА кошелёк привязанный к этой статье — ключевое новое правило
    (o.type==='transfer'&&linkedWalletIds.includes(o.walletTo))
  ).reduce((s,o)=>s+o.amount,0);
}

// ── Auth ───────────────────────────────────────────
export function initAuth(onLogin,onLogout){
  onAuthStateChanged(auth,async user=>{
    if(user){state.CU=user;await loadData(user.uid);onLogin(user);}
    else{state.CU=null;state.D=null;onLogout();}
  });
}

export async function signInGoogle(){
  try{await signInWithPopup(auth,prov);}catch(e){alert('Ошибка: '+e.message);}
}
export async function doSignOut(){
  if(!confirm('Выйти?'))return;
  await fbOut(auth);
}

// ── Export / Import ────────────────────────────────
export function exportData(){
  const b=new Blob([JSON.stringify(state.D,null,2)],{type:'application/json'});
  const a=document.createElement('a');a.href=URL.createObjectURL(b);
  a.download='my-finance-backup-'+today()+'.json';a.click();
}
export function importData(e,onDone){
  const f=e.target.files[0];if(!f)return;
  const r=new FileReader();
  r.onload=ev=>{
    try{
      const imp=JSON.parse(ev.target.result);
      if(!imp.wallets||!imp.operations)throw new Error('Неверный формат');
      if(!confirm('Заменить все данные?'))return;
      state.D=imp;migrate();saveNow();onDone();alert('Данные импортированы');
    }catch(err){alert('Ошибка: '+err.message);}
  };
  r.readAsText(f);e.target.value='';
}
export function clearAllOps(onDone){
  if(!confirm('Удалить ВСЕ операции?'))return;
  state.D.operations=[];sched();onDone();alert('Операции удалены');
}
