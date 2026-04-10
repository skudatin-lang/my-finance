// voice.js — Yandex SpeechKit STT via Cloudflare Worker proxy
// Fully isolated — does not break anything if not configured
import{state,sched}from'./core.js';

let _proxyUrl='',_iamToken='',_folderId='';
let _mediaRecorder=null,_audioChunks=[],_isRecording=false;
let _onResult=null,_onError=null,_onStateChange=null;

export function loadVoiceSettings(){
  if(!state.D)return;
  if(!state.D.voiceSettings)state.D.voiceSettings={proxyUrl:'',iamToken:'',folderId:''};
  const vs=state.D.voiceSettings;
  _proxyUrl=vs.proxyUrl||'';_iamToken=vs.iamToken||'';_folderId=vs.folderId||'';
}

export function saveVoiceSettings(proxyUrl,iamToken,folderId){
  if(!state.D)return;
  if(!state.D.voiceSettings)state.D.voiceSettings={};
  state.D.voiceSettings={proxyUrl,iamToken,folderId};
  _proxyUrl=proxyUrl;_iamToken=iamToken;_folderId=folderId;
  sched();
}

export function isVoiceConfigured(){
  return!!((_proxyUrl||'').trim()&&(_iamToken||'').trim()&&(_folderId||'').trim());
}

export function isRecording(){return _isRecording;}

export async function startRecording(onResult,onError,onStateChange){
  if(_isRecording)return;
  _onResult=onResult;_onError=onError;_onStateChange=onStateChange;
  if(!isVoiceConfigured()){
    onError&&onError('Голосовой ввод не настроен. Укажите данные API в Настройках → Голосовой ввод.');
    return;
  }
  try{
    const stream=await navigator.mediaDevices.getUserMedia({audio:true});
    _audioChunks=[];
    const mimeType=MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')
      ?'audio/ogg;codecs=opus'
      :(MediaRecorder.isTypeSupported('audio/webm;codecs=opus')?'audio/webm;codecs=opus':'audio/webm');
    _mediaRecorder=new MediaRecorder(stream,{mimeType});
    _mediaRecorder.ondataavailable=e=>{if(e.data&&e.data.size>0)_audioChunks.push(e.data);};
    _mediaRecorder.onstop=async()=>{stream.getTracks().forEach(t=>t.stop());await _sendAudio();};
    _mediaRecorder.start(250);
    _isRecording=true;
    onStateChange&&onStateChange(true);
  }catch(e){
    onError&&onError('Нет доступа к микрофону: '+e.message);
  }
}

export function stopRecording(){
  if(!_isRecording||!_mediaRecorder)return;
  _isRecording=false;
  _onStateChange&&_onStateChange(false);
  try{_mediaRecorder.stop();}catch(e){}
}

async function _sendAudio(){
  if(!_audioChunks.length){_onError&&_onError('Запись пустая — попробуйте ещё раз');return;}
  const mimeType=_mediaRecorder?.mimeType||'audio/webm';
  const blob=new Blob(_audioChunks,{type:mimeType});
  try{
    const ab=await blob.arrayBuffer();
    const bytes=new Uint8Array(ab);
    let bin='';for(let i=0;i<bytes.byteLength;i++)bin+=String.fromCharCode(bytes[i]);
    const base64=btoa(bin);
    const format=mimeType.includes('ogg')?'OGG_OPUS':'WEBM_OPUS';
    const body={
      config:{specification:{languageCode:'ru-RU',audioEncoding:format,sampleRateHertz:48000}},
      audio:{content:base64}
    };
    const resp=await fetch(_proxyUrl,{
      method:'POST',
      headers:{
        'Content-Type':'application/json',
        'Authorization':'Api-Key '+_iamToken,
        'x-folder-id':_folderId
      },
      body:JSON.stringify(body)
    });
    if(!resp.ok){
      const txt=await resp.text();
      _onError&&_onError('Ошибка API ('+resp.status+'): '+txt.slice(0,200));
      return;
    }
    const data=await resp.json();
    let text='';
    if(data.result)text=data.result;
    else if(data.chunks)text=data.chunks.map(c=>c.alternatives?.[0]?.text||'').join(' ');
    text=text.trim();
    if(!text){_onError&&_onError('Речь не распознана — говорите чётче и ближе к микрофону');return;}
    _onResult&&_onResult(text);
  }catch(e){
    _onError&&_onError('Ошибка отправки: '+e.message);
  }
}

// Creates a standalone mic toggle button for any text input
export function createVoiceButton(targetInputId,extraStyle=''){
  const btn=document.createElement('button');
  btn.type='button';
  btn.title='Голосовой ввод';
  btn.style.cssText='background:var(--amber-light);border:1.5px solid var(--amber);border-radius:7px;padding:7px 9px;cursor:pointer;font-size:15px;flex-shrink:0;transition:background .15s;line-height:1;'+extraStyle;
  btn.textContent='🎤';
  let active=false;
  btn.onclick=async()=>{
    if(!isVoiceConfigured()){
      alert('Голосовой ввод не настроен.\nПерейдите: Настройки → Голосовой ввод\nЗаполните Прокси URL, IAM токен и Folder ID.');
      return;
    }
    if(active){stopRecording();return;}
    await startRecording(
      text=>{
        active=false;btn.textContent='🎤';btn.style.background='var(--amber-light)';
        const el=document.getElementById(targetInputId);
        if(el){el.value=text;el.dispatchEvent(new Event('input',{bubbles:true}));}
      },
      msg=>{
        active=false;btn.textContent='🎤';btn.style.background='var(--amber-light)';
        // Show brief toast instead of alert
        _showVoiceError(msg);
      },
      isRec=>{
        active=isRec;
        if(isRec){btn.textContent='⏹';btn.style.background='var(--red-bg);border-color:var(--red)';}
        else{btn.textContent='🎤';btn.style.background='var(--amber-light)';}
      }
    );
  };
  return btn;
}

function _showVoiceError(msg){
  let toast=document.getElementById('voice-toast');
  if(!toast){
    toast=document.createElement('div');
    toast.id='voice-toast';
    toast.style.cssText='position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:#3D2B1A;color:#fff;padding:10px 18px;border-radius:8px;font-size:12px;font-weight:600;z-index:999;max-width:320px;text-align:center;opacity:0;transition:opacity .3s;pointer-events:none;';
    document.body.appendChild(toast);
  }
  if(toast._timer)clearTimeout(toast._timer);
  toast.textContent='🎤 '+msg;
  toast.style.opacity='1';
  toast._timer=setTimeout(()=>{toast.style.opacity='0';},3500);
}
