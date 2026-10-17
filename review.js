'use strict';
const $ = id => document.getElementById(id);
const categoryNames = {alert:'Повітряна тривога',clear:'Відбій тривоги',other:'Інше',uncertain:'Потрібно уточнити'};
const stateNames = {pending:'На перевірці',approved:'Підтверджено',rejected:'Відхилено'};
const routingNames = {automatic:'Автоматично',review:'Потрібно уточнити',archive:'Архів',manual:'Рішення користувача'};
let csrfToken = '';
let selected = null;
let dirty = false;
let loading = false;
let listRequest = 0;
let detailRequest = 0;
let sourceNames = new Map();
let sourceOptionsSignature = '';
let lastListSignature = '';
let refreshFailed = false;
const dateFormat = new Intl.DateTimeFormat('uk-UA',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',timeZone:'Europe/Kyiv'});
const time = value => value && Number.isFinite(Date.parse(value)) ? dateFormat.format(new Date(value)) : 'Ще немає';
function node(tag, cls, text) {const el=document.createElement(tag); if(cls) el.className=cls; if(text!=null) el.textContent=text; return el;}
function notice(message, success=false) {const el=$('notice'); el.textContent=message; el.classList.toggle('success',success); el.hidden=!message;}
async function api(path, options={}) {
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),20000);
  try {
    const response=await fetch('/api/review/'+path,{cache:'no-store',...options,signal:controller.signal});
    if (!(response.headers.get('content-type')||'').includes('application/json')) throw new Error('Запусти «Запустити Обрій.command»: звичайний файловий сервер не підтримує журнал.');
    const data=await response.json();
    if(!response.ok) throw new Error(data.error||'Не вдалося виконати запит.');
    return data;
  } finally {clearTimeout(timeout);}
}
async function post(path, data={}) {
  // A page can remain open while the local server restarts and rotates its token.
  const status=await api('status');csrfToken=status.csrfToken;
  return api(path,{method:'POST',headers:{'Content-Type':'application/json','X-Review-Token':csrfToken},body:JSON.stringify(data)});
}
async function loadStatus() {
  const data=await api('status'); csrfToken=data.csrfToken;
  sourceNames=new Map(data.sources.map(s=>[s.username,s.name]));
  const cards=data.sources.map(source=>{
    const card=node('article','source-card'); const top=node('div','source-top');
    const link=node('a','source-name','@'+source.username); link.href=source.url;link.target='_blank';link.rel='noopener noreferrer';
    const fresh=source.last_success&&Date.now()-Date.parse(source.last_success)<data.pollIntervalSeconds*3000;
    const ok=fresh&&!source.error;
    top.append(link,node('span','source-state'+(ok?' ok':''),source.error?'Немає зв’язку':ok?'Доступний':source.last_success?'Давно не оновлено':'Перша перевірка'));
    card.append(top,node('p','',source.error||'Остання успішна перевірка: '+time(source.last_success)),node('p','',source.name+' · '+(source.message_count||0)+' дописів у поточному вебперегляді'));
    return card;
  });
  $('sources').replaceChildren(...cards);$('coverage').textContent=data.coverage;
  $('counts').textContent=(data.routingCounts.review||0)+' потребують уточнення · '+(data.routingCounts.automatic||0)+' автоматично';
  $('automation').textContent=(data.collectorRunning?'Автоматичний збір кожні '+data.pollIntervalSeconds+' с. ':'Фоновий збір зупинений. Запусти карту стандартним ярликом. ')+data.automation;
  const sourceSelect=$('sourceFilter');const old=sourceSelect.value;
  const signature=data.sources.map(s=>s.username).join(',');
  if(signature!==sourceOptionsSignature) {
    sourceSelect.replaceChildren(new Option('Усі канали',''),...data.sources.map(s=>new Option('@'+s.username,s.username)));sourceSelect.value=old;
    sourceOptionsSignature=signature;
  }
  if(!$('regionChoices').children.length) {
    for(const region of data.regions) {const label=node('label');const box=document.createElement('input');box.type='checkbox';box.value=region;box.name='region';label.append(box,document.createTextNode(region));$('regionChoices').append(label);}
  }
  $('refreshSources').disabled=data.collecting;
  $('refreshSources').textContent=data.collecting?'Перевірка каналів…':'Перевірити канали ↻';
}
async function loadList() {
  const request=++listRequest;
  const filter=$('stateFilter').value;
  const params=new URLSearchParams({state:filter.startsWith('route:')?'':filter,routing:filter.startsWith('route:')?filter.slice(6):'',source:$('sourceFilter').value,q:$('queryFilter').value});
  const data=await api('messages?'+params);
  if(request!==listRequest) return;
  $('messageCount').textContent=data.total>150?'150 із '+data.total:String(data.total);
  const signature=JSON.stringify([selected?.channel,selected?.id,data.messages.map(item=>[item.channel,item.id,item.revision,item.category,item.regions,item.review_state,item.routing])]);
  if(signature===lastListSignature) return;
  lastListSignature=signature;
  const list=$('messageList');const scroll=list.scrollTop;
  const entries=data.messages.map(item=>{
    const button=node('button','message-item'+(selected&&selected.channel===item.channel&&selected.id===item.id?' selected':''));button.type='button';
    const meta=node('span','message-meta');meta.append(node('span','','@'+item.channel),node('span','',time(item.published_at)));
    const tags=node('span','tags');tags.append(node('span','tag '+item.category,categoryNames[item.category]),node('span','tag',item.review_state==='pending'?routingNames[item.routing]:stateNames[item.review_state]));
    if(item.revision>1) tags.append(node('span','tag','Версія '+item.revision));
    if(item.regions.length) tags.append(node('span','tag',item.regions.join(', ')));
    button.append(meta,node('span','message-preview',item.text||'Медіадопис без тексту'),tags);
    button.onclick=()=>selectMessage(item.channel,item.id);
    if(selected&&selected.channel===item.channel&&selected.id===item.id&&selected.revision!==item.revision) $('newRevision').hidden=false;
    return button;
  });
  list.replaceChildren(...(entries.length?entries:[node('p','empty-list',filter==='route:review'?'Уточнень не потрібно. Нові дописи оброблятимуться автоматично.':'Дописів за цим фільтром поки немає.')]));list.scrollTop=scroll;
}
async function selectMessage(channel,id,force=false) {
  if(dirty&&!force&&!window.confirm('Є незбережені зміни перевірки. Перейти до іншого допису?')) return;
  const request=++detailRequest;
  try {
    const item=await api('messages/'+encodeURIComponent(channel)+'/'+id);
    if(request!==detailRequest) return;
    selected=item;dirty=false;
    $('emptyDetail').hidden=true;$('detailContent').hidden=false;$('newRevision').hidden=true;
    $('detailSource').textContent=(sourceNames.get(channel)||channel)+' / '+id+' / '+(item.review_state==='pending'?routingNames[item.routing]:stateNames[item.review_state]);
    $('originalLink').href=item.url;
    const times=[['Опубліковано · час Києва',item.published_at],['Уперше отримано',item.first_seen_at],['Цю версію отримано',item.revisions[0].received_at],['Остання перевірка',item.reviewed_at]];
    $('messageTimes').replaceChildren(...times.map(([title,value])=>{const box=node('div');box.append(node('dt','',title),node('dd','',time(value)));return box;}));
    $('originalText').textContent=item.text||'Допис містить медіа без тексту. Переглянь його в Telegram.';
    $('suggestionReason').textContent=item.routing_reason+(item.routing==='review'?' '+item.reason:'');
    $('category').value=item.category;$('reviewNote').value=item.note;
    document.querySelectorAll('input[name=region]').forEach(box=>box.checked=item.regions.includes(box.value));
    $('revisionCount').textContent=String(item.revisions.length);
    $('revisionList').replaceChildren(...item.revisions.map(revision=>{const entry=node('div','history-entry');entry.append(node('strong','','Версія '+revision.revision+' · отримано '+time(revision.received_at)),node('pre','',revision.text||'Без тексту'));return entry;}));
    $('reviewCount').textContent=String(item.reviews.length);
    $('reviewHistory').replaceChildren(...item.reviews.map(review=>{const entry=node('div','history-entry');entry.append(node('strong','',stateNames[review.state]+' · '+time(review.created_at)),node('p','',categoryNames[review.category]+' · версія '+review.revision),node('p','',JSON.parse(review.regions).join(', ')),node('p','',review.note));return entry;}));
    await loadList();
  } catch(error) {notice(error.message);}
}
$('reviewForm').addEventListener('input',()=>dirty=true);
$('reviewForm').addEventListener('submit',async event=>{
  event.preventDefault();if(!selected) return;
  const buttons=[...document.querySelectorAll('.review-actions button')];buttons.forEach(b=>b.disabled=true);
  try {
    const decision=event.submitter?.value||'pending';
    const payload={revision:selected.revision,state:decision,category:$('category').value,regions:[...document.querySelectorAll('input[name=region]:checked')].map(box=>box.value),note:$('reviewNote').value};
    await post('messages/'+encodeURIComponent(selected.channel)+'/'+selected.id,payload);
    dirty=false;notice('Збережено: '+stateNames[decision].toLocaleLowerCase('uk')+'.',true);
    await selectMessage(selected.channel,selected.id,true);await loadStatus();
  } catch(error) {notice(error.message);}finally{buttons.forEach(b=>b.disabled=false);}
});
$('reloadDetail').onclick=()=>{if(selected&&(!dirty||window.confirm('Замінити незбережені зміни новою версією допису?'))) selectMessage(selected.channel,selected.id,true);};
$('refreshSources').onclick=async()=>{
  $('refreshSources').disabled=true;
  try {await post('refresh');notice('Перевірка каналів запущена. Список оновиться автоматично.',true);await loadStatus();}
  catch(error){notice(error.message);$('refreshSources').disabled=false;}
};
for(const id of ['stateFilter','sourceFilter']) $(id).onchange=()=>loadList().catch(error=>notice(error.message));
let queryTimer;$('queryFilter').oninput=()=>{clearTimeout(queryTimer);queryTimer=setTimeout(()=>loadList().catch(error=>notice(error.message)),200);};
window.addEventListener('beforeunload',event=>{if(dirty){event.preventDefault();event.returnValue='';}});
async function refresh(){if(loading||document.hidden) return;loading=true;try{await loadStatus();await loadList();if(refreshFailed) notice('');refreshFailed=false;}catch(error){notice(error.message);refreshFailed=true;}finally{loading=false;}}
document.addEventListener('visibilitychange',()=>{if(!document.hidden) refresh();});
refresh();setInterval(refresh,15000);
