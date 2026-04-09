import{state,sched,today,isPlanned}from'./core.js';

// Known category mappings: bank category → user category name
const TINKOFF_CAT_MAP={
  'Рестораны':'Кафе и рестораны','Кафе':'Кафе и рестораны',
  'Супермаркеты':'Продукты','Продукты':'Продукты','Гипермаркеты':'Продукты',
  'АЗС':'Бензин','Топливо':'Бензин',
  'Транспорт':'Транспорт','Такси':'Транспорт',
  'Аптеки':'Здоровье','Здоровье и красота':'Здоровье',
  'Одежда и обувь':'Одежда',
  'Развлечения':'Развлечения','Кино':'Развлечения',
  'Связь':'Связь','Интернет':'Связь',
  'ЖКХ':'Квартплата','Коммунальные услуги':'Квартплата',
  'Переводы':'Прочее','Прочее':'Прочее',
};

export function parseCSV(text,bankType='tinkoff'){
  if(bankType==='tinkoff')return parseTinkoff(text);
  if(bankType==='sber')return parseSber(text);
  return[];
}

function parseTinkoff(text){
  const lines=text.split('\n').filter(l=>l.trim());
  if(!lines.length)return[];
  // Find header row
  const headerIdx=lines.findIndex(l=>l.includes('Дата операции')||l.includes('Дата платежа'));
  if(headerIdx<0)return[];
  const header=splitCSVLine(lines[headerIdx]);
  const cols={
    date:findCol(header,['Дата операции','Дата платежа']),
    amount:findCol(header,['Сумма операции','Сумма']),
    currency:findCol(header,['Валюта операции','Валюта']),
    desc:findCol(header,['Описание','Название']),
    category:findCol(header,['Категория']),
    status:findCol(header,['Статус']),
  };
  const ops=[];
  for(let i=headerIdx+1;i<lines.length;i++){
    const row=splitCSVLine(lines[i]);
    if(row.length<3)continue;
    const status=cols.status>=0?row[cols.status]?.trim():'';
    if(status==='FAILED'||status==='Не исполнен')continue;
    const amtRaw=(row[cols.amount]||'').replace(/\s/g,'').replace(',','.');
    const amount=parseFloat(amtRaw);
    if(isNaN(amount)||amount===0)continue;
    const currency=(row[cols.currency]||'RUB').trim();
    if(currency!=='RUB'&&currency!=='643')continue; // skip non-RUB
    const dateRaw=(row[cols.date]||'').trim();
    const date=parseDateStr(dateRaw);
    if(!date)continue;
    const desc=(row[cols.desc]||'').trim();
    const bankCat=(row[cols.category]||'').trim();
    const userCat=TINKOFF_CAT_MAP[bankCat]||bankCat||'Прочее';
    ops.push({
      date,amount:Math.abs(amount),
      type:amount<0?'expense':'income',
      category:amount<0?userCat:'Прочее',
      note:desc,bankCategory:bankCat,
      _id:'tcsv_'+date+'_'+Math.abs(amount)+'_'+desc.slice(0,10)
    });
  }
  return ops;
}

function parseSber(text){
  const lines=text.split('\n').filter(l=>l.trim());
  const ops=[];
  for(const line of lines){
    // Sber format: date;desc;amount;currency
    const parts=line.split(';').map(s=>s.trim().replace(/"/g,''));
    if(parts.length<3)continue;
    const date=parseDateStr(parts[0]);
    if(!date)continue;
    const amount=parseFloat((parts[2]||'').replace(',','.').replace(/\s/g,''));
    if(isNaN(amount)||amount===0)continue;
    const desc=parts[1]||'';
    ops.push({
      date,amount:Math.abs(amount),
      type:amount<0?'expense':'income',
      category:'Прочее',note:desc,
      _id:'scsv_'+date+'_'+Math.abs(amount)
    });
  }
  return ops;
}

function splitCSVLine(line){
  // Handle quoted fields
  const result=[];let cur='';let inQuote=false;
  for(let i=0;i<line.length;i++){
    if(line[i]==='"'){inQuote=!inQuote;}
    else if(line[i]===';'&&!inQuote){result.push(cur);cur='';}
    else cur+=line[i];
  }
  result.push(cur);
  return result;
}

function findCol(header,names){
  for(const n of names){
    const idx=header.findIndex(h=>h.trim().includes(n));
    if(idx>=0)return idx;
  }
  return-1;
}

function parseDateStr(s){
  if(!s)return null;
  // DD.MM.YYYY or DD.MM.YYYY HH:MM:SS
  const m=s.match(/(\d{2})\.(\d{2})\.(\d{4})/);
  if(m)return`${m[3]}-${m[2]}-${m[1]}`;
  // YYYY-MM-DD
  if(/^\d{4}-\d{2}-\d{2}/.test(s))return s.slice(0,10);
  return null;
}

// Deduplicate against existing operations
export function deduplicateOps(parsed){
  const existing=new Set(
    state.D.operations
      .filter(o=>!isPlanned(o.type))
      .map(o=>`${o.date}_${o.amount}_${(o.note||'').slice(0,10)}`)
  );
  return parsed.map(op=>({
    ...op,
    isDuplicate:existing.has(`${op.date}_${op.amount}_${(op.note||'').slice(0,10)}`)
  }));
}

// Import confirmed ops into state
export function importOps(ops,walletId){
  let added=0;
  ops.forEach(op=>{
    if(op.skip||op.isDuplicate)return;
    const newOp={
      id:'op'+Date.now()+'_'+Math.random().toString(36).slice(2,6),
      type:op.type,amount:op.amount,date:op.date,
      wallet:walletId,category:op.category,note:op.note,
    };
    const w=state.D.wallets.find(w=>w.id===walletId);
    if(w){if(op.type==='income')w.balance+=op.amount;else w.balance-=op.amount;}
    state.D.operations.push(newOp);
    added++;
  });
  sched();
  return added;
}
