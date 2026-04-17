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

export const state={
  D:null, CU:null, saveTimer:null,
  repOff:0, ddsOff:0, calOff:0,
  calDay:null, walletIdx:0, curCatTab:'income', curType:'income'
};

export const $=id=>document.getElementById(id);
export const fmt=n=>'₽ '+Math.abs(Math.round(n)).toLocaleString('ru-RU');
export const fmtS=n=>(n>=0?'+ ':'\u2212 ')+'₽ '+Math.abs(Math.round(n)).toLocaleString('ru-RU');
export const today=()=>new Date().toISOString().split('T')[0];
export const wName=id=>{const w=state.D.wallets.find(w=>w.id===id);return w?w.name:id||'?';};
export const fmtD=ds=>{if(!ds)return'';const[y,m,d]=ds.split('-');return d+'.'+m+'.'+y;};
// XSS-защита: экранирование пользовательского текста перед вставкой в HTML
export const esc=s=>String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
export const getMOps=off=>{
  const dt=new Date(new Date().getFullYear(),new Date().getMonth()+off,1);
  const ym=dt.getFullYear()+'-'+String(dt.getMonth()+1).padStart(2,'0');
  return state.D.operations.filter(o=>o.date&&o.date.startsWith(ym));
};
export const planById=id=>state.D.plan.find(p=>p.id===id);
export const catPlanId=name=>{const c=state.D.expenseCats.find(c=>c.name===name);return c?c.planId:null;};
export const isPlanned=t=>t==='planned_income'||t==='planned_expense';

export function opHtml(o,showDel){
  const isIn=o.type==='income',isOut=o.type==='expense',isTr=o.type==='transfer';
  const sc=isIn?'pos':(isOut?'neg':'');
  const pfx=isIn?'+':(isOut?'\u2212':'');
  const label=isTr?`Перевод \u2192 ${esc(wName(o.walletTo))}`:(esc(o.category)||'—');
  const pid=isTr?o.planId:catPlanId(o.category);
  const badge=pid?`<span class="op-badge">${esc(planById(pid)?.label||'')}</span>`:'';
  const editBtn=showDel&&!isTr&&!isPlanned(o.type)?`<button class="op-btn edit" onclick="window.openEditOp('${esc(o.id)}')" title="Редактировать">&#9998;</button>`:'';
  const delBtn=showDel?`<button class="op-btn del" onclick="window.deleteOp('${esc(o.id)}')" title="Удалить">&#10005;</button>`:'';
  const noteTxt=o.note?`<div class="op-note">${esc(o.note)}</div>`:'';
  return`<div class="op-item">
    <div class="op-top">
      <div style="flex:1;min-width:0"><div class="op-title">${label}</div><div class="op-meta">${esc(wName(o.wallet||''))} &nbsp;${fmtD(o.date)}</div>${noteTxt}${badge}</div>
      <div class="op-actions"><div class="op-amt ${sc}">${pfx} ${fmt(o.amount)}</div>${editBtn}${delBtn}</div>
    </div>
  </div>`;
}

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
  if(!state.CU||!state.D)return;
  // ЗАЩИТА: не перезаписываем Firestore пустыми данными
  // если в памяти 0 операций но флаг _dataLoadedFromFirestore не стоит — пропускаем
  if(!state._dataLoadedFromFirestore&&state.D.operations.length===0){
    console.warn('saveNow blocked: no data loaded from Firestore yet, skip to prevent overwrite');
    return;
  }
  try{
    await setDoc(doc(db,'users',state.CU.uid,'data','main'),state.D);
  }catch(e){
    console.error('saveNow failed:',e.message);
  }
}

export function sched(){
  if(state.saveTimer)clearTimeout(state.saveTimer);
  state.saveTimer=setTimeout(saveNow,1500);
}

// ── Автоматический локальный бэкап ───────────────────────────────────────
function _autoBackup(data){
  try{
    // Сохраняем в localStorage как страховку
    const key='mf_backup_'+today();
    localStorage.setItem(key,JSON.stringify(data));
    // Чистим бэкапы старше 7 дней
    const cutoff=new Date();cutoff.setDate(cutoff.getDate()-7);
    Object.keys(localStorage).forEach(k=>{
      if(k.startsWith('mf_backup_')){
        const d=new Date(k.replace('mf_backup_',''));
        if(d<cutoff)localStorage.removeItem(k);
      }
    });
    console.info('Auto-backup saved to localStorage:',key,'ops:',data.operations?.length||0);
  }catch(e){
    console.warn('Auto-backup failed:',e.message);
  }
}

export function getLocalBackup(){
  // Вернуть самый свежий локальный бэкап
  const keys=Object.keys(localStorage).filter(k=>k.startsWith('mf_backup_')).sort().reverse();
  if(!keys.length)return null;
  try{return{key:keys[0],data:JSON.parse(localStorage.getItem(keys[0]))};}catch(e){return null;}
}

export async function loadData(uid){
  try{
    const s=await getDoc(doc(db,'users',uid,'data','main'));
    if(s.exists()){
      state.D=s.data();
      migrate();
      // Данные успешно загружены из Firestore — разрешаем сохранение
      state._dataLoadedFromFirestore=true;
      // Автобэкап при каждом успешном входе
      _autoBackup(state.D);
    }else{
      // Документ не существует — первый вход пользователя
      state.D=JSON.parse(JSON.stringify(DEFAULT_DATA));
      state._dataLoadedFromFirestore=true;
      await saveNow();
    }
  }catch(e){
    // СЕТЕВАЯ ОШИБКА — НЕ перезаписываем Firestore
    // Пробуем восстановить из локального бэкапа
    console.error('loadData failed (network/auth error):',e.message);
    const backup=getLocalBackup();
    if(backup&&backup.data.operations?.length>0){
      state.D=backup.data;
      console.info('Restored from local backup:',backup.key,'ops:',state.D.operations.length);
      // НЕ ставим _dataLoadedFromFirestore — не будем перезаписывать Firestore
      // пока не убедимся что соединение восстановлено
    }else{
      state.D=JSON.parse(JSON.stringify(DEFAULT_DATA));
      // НЕ вызываем saveNow() — не затираем Firestore при ошибке подключения
    }
  }
}

export function planSpent(p,ops){
  const cats=state.D.expenseCats.filter(c=>c.planId===p.id).map(c=>c.name);
  const planLabel=p.label;
  const linkedWalletIds=state.D.wallets.filter(w=>w.planId===p.id).map(w=>w.id);
  return ops.filter(o=>
    (o.type==='expense'&&cats.includes(o.category))||
    (o.type==='expense'&&(o.category===planLabel||o.planId===p.id))||
    (o.type==='transfer'&&(o.planId===p.id||o.planLabel===planLabel))||
    (o.type==='transfer'&&linkedWalletIds.includes(o.walletTo))
  ).reduce((s,o)=>s+o.amount,0);
}

// ── Health score calculation ──────────────────────────────────────────────
export function calcHealthScore(){
  if(!state.D)return null;
  let totalExp=0,totalInc=0,filledMonths=0;
  for(let i=0;i<=3;i++){
    const ops=getMOps(-i).filter(o=>!isPlanned(o.type));
    const mExp=ops.filter(o=>o.type==='expense').reduce((s,o)=>s+o.amount,0);
    const mInc=ops.filter(o=>o.type==='income').reduce((s,o)=>s+o.amount,0);
    if(mInc>0||mExp>0){totalExp+=mExp;totalInc+=mInc;filledMonths++;}
  }
  const avgExp=filledMonths>0?totalExp/filledMonths:0;
  const avgInc=filledMonths>0?totalInc/filledMonths:0;
  const hs=state.D.healthSettings||{emergencyWalletIds:[]};
  const emergencyWallets=hs.emergencyWalletIds.length>0
    ?state.D.wallets.filter(w=>hs.emergencyWalletIds.includes(w.id)&&w.balance>0)
    :state.D.wallets.filter(w=>w.balance>0);
  const totalSavings=emergencyWallets.reduce((s,w)=>s+w.balance,0);
  const totalDebt=state.D.wallets.filter(w=>w.balance<0).reduce((s,w)=>s+Math.abs(w.balance),0);
  const curOps=getMOps(0).filter(o=>!isPlanned(o.type));
  const curInc=curOps.filter(o=>o.type==='income').reduce((s,o)=>s+o.amount,0);
  const curExp=curOps.filter(o=>o.type==='expense').reduce((s,o)=>s+o.amount,0);
  const savingsPlanIds=state.D.plan.filter(p=>p.type==='income').map(p=>p.id);
  const savingsWalletIds=state.D.wallets.filter(w=>savingsPlanIds.includes(w.planId)).map(w=>w.id);
  const actualSaved=curOps.filter(o=>
    o.type==='transfer'&&(savingsWalletIds.includes(o.walletTo)||savingsPlanIds.includes(o.planId)||
    state.D.plan.filter(p=>p.type==='income').some(p=>p.label===o.planLabel))
  ).reduce((s,o)=>s+o.amount,0);
  const savingsRate=curInc>0?Math.round(actualSaved/curInc*100):0;
  const emergencyMonths=avgExp>0?Math.round(totalSavings/avgExp*10)/10:0;
  const creditPlan=state.D.plan.find(p=>p.label.toLowerCase().includes('кредит'));
  const creditSpent=totalDebt===0?0:(creditPlan?planSpent(creditPlan,curOps):Math.round(totalDebt*0.03));
  const dtiPct=avgInc>0?Math.round(creditSpent/avgInc*100):0;
  const obligPlanIds=state.D.plan.filter(p=>p.type==='expense'&&
    (p.label.toLowerCase().includes('постоянн')||p.label.toLowerCase().includes('кредит'))
  ).map(p=>p.id);
  const obligCats=state.D.expenseCats.filter(c=>obligPlanIds.includes(c.planId)).map(c=>c.name);
  const obligExp=curOps.filter(o=>o.type==='expense'&&obligCats.includes(o.category)).reduce((s,o)=>s+o.amount,0);
  const obligRatio=curExp>0?Math.round(obligExp/curExp*100):0;
  const investable=Math.max(Math.round(avgInc-avgExp-avgInc*0.1),0);
  const s1=emergencyMonths>=6?100:emergencyMonths>=3?Math.round(emergencyMonths/6*100):Math.round(emergencyMonths/3*50);
  const s2=savingsRate>=20?100:savingsRate>=10?Math.round(savingsRate/20*100):Math.max(0,savingsRate*5);
  const s3=totalDebt===0?100:dtiPct<=10?90:dtiPct<=20?70:dtiPct<=30?50:Math.max(0,30-dtiPct);
  const s4=obligRatio<=50?100:obligRatio<=70?Math.round((70-obligRatio)/20*50+50):Math.max(0,(100-obligRatio)*2);
  const s5=avgInc>0?Math.min(100,Math.round(investable/avgInc*100*5)):0;
  const score=Math.round((s1+s2+s3+s4+s5)/5);
  return{score,s1,s2,s3,s4,s5,emergencyMonths,savingsRate,dtiPct,obligRatio,filledMonths,
    avgExp,avgInc,curInc,totalSavings,totalDebt,creditPlan,creditSpent,investable};
}

// ── Anomaly detection ─────────────────────────────────────────────────────
export function detectAnomalies(factOps){
  const anomalies=[];
  state.D.expenseCats.forEach(cat=>{
    const monthly=[];
    for(let i=1;i<=6;i++){
      const ops=getMOps(-i).filter(o=>!isPlanned(o.type));
      monthly.push(ops.filter(o=>o.type==='expense'&&o.category===cat.name).reduce((s,o)=>s+o.amount,0));
    }
    const filled=monthly.filter(v=>v>0);
    if(filled.length<2)return;
    const mean=filled.reduce((s,v)=>s+v,0)/filled.length;
    const variance=filled.reduce((s,v)=>s+(v-mean)**2,0)/filled.length;
    const std=Math.sqrt(variance);
    const cur=factOps.filter(o=>o.type==='expense'&&o.category===cat.name).reduce((s,o)=>s+o.amount,0);
    if(std>0&&cur>mean+2*std){
      const pct=Math.round((cur-mean)/mean*100);
      anomalies.push({cat:cat.name,cur,mean,pct});
    }
  });
  return anomalies.sort((a,b)=>b.pct-a.pct);
}

// ── Owner UID — единственный источник истины для admin-доступа ───────────
// Используется ТОЛЬКО для показа/скрытия UI панели Админ.
// Реальная защита данных — Firestore Rules на сервере Firebase,
// которые не зависят от этой переменной и не могут быть обойдены клиентом.
const _OWNER_UID='TmexoZZxotgY7c3oBLpdAP3TG8s1';
export function isOwner(uid){return uid===_OWNER_UID;}

// ── App config (workerUrl, appSecret, deepseekKey — только для владельца) ─
// Хранится в Firestore /config/app — доступен только владельцу по Rules
export const appConfig={
  workerUrl:'',
  appSecret:'',
  deepseekKey:'', // API-ключ DeepSeek — НЕ хранится в данных пользователя
  loaded:false,
};

export async function loadAppConfig(){
  try{
    const snap=await getDoc(doc(db,'config','app'));
    if(snap.exists()){
      const d=snap.data();
      appConfig.workerUrl=d.workerUrl||'';
      appConfig.appSecret=d.appSecret||'';
      appConfig.deepseekKey=d.deepseekKey||'';
      appConfig.loaded=true;
    }
  }catch(e){
    console.info('App config not found in Firestore — using defaults');
  }
}

export async function saveAppConfig(data){
  try{
    await setDoc(doc(db,'config','app'),data,{merge:true});
    appConfig.workerUrl=data.workerUrl??appConfig.workerUrl;
    appConfig.appSecret=data.appSecret??appConfig.appSecret;
    appConfig.deepseekKey=data.deepseekKey??appConfig.deepseekKey;
    return true;
  }catch(e){
    console.error('saveAppConfig failed:',e.message);
    return false;
  }
}

export function initAuth(onLogin,onLogout){
  onAuthStateChanged(auth,async user=>{
    if(user){state.CU=user;await loadData(user.uid);onLogin(user);}
    else{state.CU=null;state.D=null;state._dataLoadedFromFirestore=false;onLogout();}
  });
}

export async function signInGoogle(){
  try{await signInWithPopup(auth,prov);}catch(e){alert('Ошибка: '+e.message);}
}

export async function doSignOut(){
  if(!confirm('Выйти?'))return;
  if(state.saveTimer){clearTimeout(state.saveTimer);state.saveTimer=null;}
  await fbOut(auth);
}

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
      state.D=imp;
      state._dataLoadedFromFirestore=true; // разрешаем запись после импорта
      migrate();saveNow();onDone();alert('Данные импортированы');
    }catch(err){alert('Ошибка: '+err.message);}
  };
  r.readAsText(f);e.target.value='';
}

export function clearAllOps(onDone){
  if(!confirm('Удалить ВСЕ операции?'))return;
  state.D.operations=[];sched();onDone();alert('Операции удалены');
}
