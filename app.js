const P = {both:"Important + Urgent", important:"Important", urgent:"Urgent", general:"General"};
const DAY = 864e5, ARCHIVE_AFTER = 14*DAY;
let state = {tasks:{}, lists:{}, recurs:{}};
let tab = "today", sf = "all";
try{ sf=localStorage.getItem("pb_sf")||"all"; }catch(e){}
const vis = t => sf==="all" || (sf==="school" ? !!t.school : !t.school);
let store = null; // {save(kind,obj), remove(kind,id)}
try { tab = localStorage.getItem("pb_tab") || "today"; } catch(e){}

const $ = s => document.querySelector(s);
const uid = () => Math.random().toString(36).slice(2,10)+Date.now().toString(36);
const esc = s => String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const prio = t => t.important && t.urgent ? "both" : t.important ? "important" : t.urgent ? "urgent" : "general";
const dkey = d => { const x=new Date(d); return x.getFullYear()+"-"+String(x.getMonth()+1).padStart(2,"0")+"-"+String(x.getDate()).padStart(2,"0"); };
const DN=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"], WEEK=[1,2,3,4,5,6,0];
const daysLabel = ds => ds.length===7?"Every day":(ds.length===5&&[1,2,3,4,5].every(d=>ds.includes(d)))?"Weekdays":WEEK.filter(d=>ds.includes(d)).map(d=>DN[d]).join(", ");
const fmtDate = ms => new Date(ms).toLocaleDateString([], {day:"numeric",month:"short"});
const startOfDay = d => { const x=new Date(d); x.setHours(0,0,0,0); return +x; };

/* ---------- storage: Supabase ---------- */
const sb = supabase.createClient(window.APP_CONFIG.SUPABASE_URL, window.APP_CONFIG.SUPABASE_ANON_KEY);
let me = null, channel = null;
const allObjs = () => [...Object.values(state.lists), ...Object.values(state.tasks), ...Object.values(state.recurs||{})];
function ingest(objs){
  state={tasks:{},lists:{},recurs:{}};
  objs.forEach(o=>{ if(o.kind==="list") state.lists[o.id]=o; else if(o.kind==="task") state.tasks[o.id]=o; else if(o.kind==="recur") state.recurs[o.id]=o; });
  if(!state.lists.inbox){ const ib={id:"inbox",kind:"list",name:"Inbox",order:0}; state.lists.inbox=ib; store&&store.save(ib); }
}
function makeStore(){
  return {
    save(o){ sb.from("items").upsert({user_id:me,id:o.id,kind:o.kind,data:o,updated_at:new Date().toISOString()})
      .then(({error})=>{ if(error) setSync("Couldn't save. Check your connection."); }); },
    remove(o){ sb.from("items").delete().eq("user_id",me).eq("id",o.id).then(()=>{}); },
    async saveMany(objs){ for(let i=0;i<objs.length;i+=200){
      const {error}=await sb.from("items").upsert(objs.slice(i,i+200).map(o=>({user_id:me,id:o.id,kind:o.kind,data:o,updated_at:new Date().toISOString()})));
      if(error) throw error; } }
  };
}
async function loadAll(){
  const {data,error}=await sb.from("items").select("data").eq("user_id",me).limit(10000);
  if(error){ setSync("Couldn't load your tasks. Check your connection."); return; }
  ingest(data.map(r=>r.data)); setSync("Synced"); generate(); render(); checkReminders(); handleLaunchAction();
}
function applyChange(p){
  if(p.eventType==="DELETE"){ const id=p.old&&p.old.id; if(id){ delete state.tasks[id]; delete state.lists[id]; delete state.recurs[id]; } }
  else if(p.new&&p.new.data&&p.new.data.kind!=="settings"){ const o=p.new.data; bucket(o)[o.id]=o; }
  clearTimeout(applyChange.t); applyChange.t=setTimeout(render,80);
}
async function startSession(user){
  me=user.id; store=makeStore();
  $("#auth").hidden=true; $("#app").hidden=false;
  await loadAll();
  sb.from("items").upsert({user_id:me,id:"settings",kind:"settings",data:{id:"settings",kind:"settings",tz:Intl.DateTimeFormat().resolvedOptions().timeZone},updated_at:new Date().toISOString()}).then(()=>{});
  if(channel) sb.removeChannel(channel);
  channel=sb.channel("items-"+me).on("postgres_changes",{event:"*",schema:"public",table:"items",filter:"user_id=eq."+me},applyChange).subscribe();
}
document.addEventListener("visibilitychange",()=>{ if(!document.hidden&&me) loadAll(); });
function setSync(t){ $("#sync").textContent=t; }
const bucket=o=>o.kind==="list"?state.lists:o.kind==="recur"?state.recurs:state.tasks;
function put(o){ bucket(o)[o.id]=o; store&&store.save(o); render(); }
function del(o){ delete bucket(o)[o.id]; store&&store.remove(o); render(); }

/* ---------- helpers ---------- */
const lists = () => Object.values(state.lists).sort((a,b)=>(a.order||0)-(b.order||0));
const open = () => Object.values(state.tasks).filter(t=>!t.done);
const byDue = (a,b)=>(a.due||Infinity)-(b.due||Infinity) || a.created-b.created;
function dueLabel(t){
  if(!t.due) return "";
  const d=new Date(t.due), now=Date.now(), sod=startOfDay(now);
  const time=t.hasTime===false?"":d.toLocaleTimeString([], {hour:"numeric",minute:"2-digit"});
  let txt, cls="";
  if(t.due<now){ cls="over"; txt="Overdue · "+(t.due>=sod?time:d.toLocaleDateString([], {day:"numeric",month:"short"})); }
  else if(t.due<sod+DAY){ cls="soon"; txt="Today "+time; }
  else if(t.due<sod+2*DAY) txt="Tomorrow "+time;
  else txt=d.toLocaleDateString([], {weekday:"short",day:"numeric",month:"short"})+" "+time;
  return `<span class="chip ${cls}">${t.remind?"🔔 ":""}${txt}</span>`;
}
function tagChips(t){ const p=prio(t); return (t.school?`<span class="chip school">🏫 School</span>`:"")+(p==="both"?`<span class="chip both">Important + Urgent</span>`:(t.important?`<span class="chip important">Important</span>`:"")+(t.urgent?`<span class="chip urgent">Urgent</span>`:"")); }
function card(t,{showList=true,drag=false}={}){
  const p=prio(t), l=state.lists[t.list];
  const tags = p==="both"?`<span class="chip both">Important + Urgent</span>`:
    (t.important?`<span class="chip important">Important</span>`:"")+(t.urgent?`<span class="chip urgent">Urgent</span>`:"");
  return `<div class="task p-${p}${t.done?" done":""}" data-id="${t.id}" ${drag?'draggable="true"':""}>
    <button class="check" data-act="toggle" aria-label="${t.done?"Mark not done":"Mark done"}"></button>
    <div class="body" data-act="edit"><div class="title">${esc(t.title)}</div>
    <div class="meta">${t.school?`<span class="chip school">🏫 School</span>`:""}${tags}${dueLabel(t)}${t.repeat&&t.repeat!=="none"?`<span class="chip">Repeats ${t.repeat}</span>`:""}${showList&&l?`<span class="chip">${esc(l.name)}</span>`:""}</div></div></div>`;
}
const group=(title,items,opts,emptyText)=>`<div><h2>${title}</h2><div class="group">${items.length?items.map(t=>card(t,opts)).join(""):`<div class="empty">${emptyText}</div>`}</div></div>`;

/* ---------- views ---------- */
function todayItems(){ const end=startOfDay(Date.now())+DAY, tk=dkey(Date.now()); return open().filter(vis).filter(t=>t.today||t.appearDate===tk||(t.due&&t.due<end)); }
/* ---------- recurring generation ---------- */
function generate(){
  if(!state.recurs) state.recurs={};
  const today=startOfDay(Date.now()), tk=dkey(today);
  Object.values(state.recurs).forEach(r=>{
    if(r.paused||r.lastGen===tk||(r.end&&r.end<today)) return;
    let found=null;
    for(let i=0;i<7;i++){ const d=new Date(today); d.setDate(d.getDate()-i); const k=dkey(d);
      if(r.lastGen&&k<=r.lastGen) break; if(+d<startOfDay(r.created)) break;
      if(r.days.includes(d.getDay())){ found=k; break; } }
    if(found){ const id="r_"+r.id+"_"+found;
      open().filter(t=>t.recurId===r.id&&t.id!==id).forEach(t=>del(t));
      if(!state.tasks[id]){ const due=r.time?+new Date(found+"T"+r.time):null;
        put({id,kind:"task",title:r.title,list:state.lists[r.list]?r.list:"inbox",important:r.important,urgent:r.urgent,school:!!r.school,due,hasTime:!!due,remind:!!due,today:false,appearDate:found,recurId:r.id,repeat:"none",done:null,created:Date.now()}); } }
    put({...r,lastGen:tk});
  });
}
function renderTabs(){
  const doneCount=Object.values(state.tasks).filter(t=>t.done&&Date.now()-t.done<ARCHIVE_AFTER).length;
  const tabs=[["today","Today",todayItems().length],["priorities","Prioritised",open().filter(vis).length],["lists","All lists",lists().length],["done","Done",doneCount]];
  $("#tabs").innerHTML=tabs.map(([k,n,c])=>`<button role="tab" data-tab="${k}" aria-selected="${tab===k}">${n}<span class="count">${c}</span></button>`).join("");
  $("#addList").innerHTML=lists().map(l=>`<option value="${l.id}">${esc(l.name)}</option>`).join("");
}
function render(){
  renderTabs();
  const m=$("#main");
  if(tab==="recurring"){
    const today=startOfDay(Date.now()), rs=Object.values(state.recurs||{}).sort((a,b)=>a.title.localeCompare(b.title));
    const act=rs.filter(r=>!(r.end&&r.end<today)), ended=rs.filter(r=>r.end&&r.end<today);
    const rc=(r,isEnded)=>{ const l=state.lists[r.list];
      return `<div class="task p-${prio(r)}" data-rid="${r.id}"><div class="body" data-act="editrecur"><div class="title">${esc(r.title)}</div>
      <div class="meta">${tagChips(r)}<span class="chip">${daysLabel(r.days)}</span>${r.time?`<span class="chip">🔔 ${r.time}</span>`:""}${l?`<span class="chip">${esc(l.name)}</span>`:""}<span class="chip">${isEnded?"Ended":"Until"} ${r.end?fmtDate(r.end):"no end"}</span>${r.paused?'<span class="chip soon">Paused</span>':""}</div></div>
      ${isEnded?`<button class="btn" data-act="renew">Renew 10 wks</button>`:`<button class="btn ghost" data-act="pause">${r.paused?"Resume":"Pause"}</button>`}</div>`; };
    m.innerHTML=`<section class="view"><div class="row"><button class="btn ghost" data-act="back">← Back</button><button class="btn primary" data-act="newrecur">+ New recurring task</button></div>
      <div><h2>Recurring tasks</h2><div class="group">${act.map(r=>rc(r,false)).join("")||`<div class="empty">Nothing set up yet. Each task appears automatically on the days you pick.</div>`}</div></div>
      ${ended.length?`<div><h2>Ended</h2><div class="group">${ended.map(r=>rc(r,true)).join("")}</div></div>`:""}</section>`;
  } else if(tab==="today"){
    const now=Date.now(), items=todayItems().sort(byDue);
    const over=items.filter(t=>t.due&&t.due<now), rest=items.filter(t=>!(t.due&&t.due<now));
    m.innerHTML=`<section class="view">${over.length?group("Overdue",over,{}, ""):""}
      ${group("Today",rest,{},"Nothing else due today. Use “Flag for today” on any task to pin it here.")}</section>`;
  } else if(tab==="priorities"){
    const cols=["both","important","urgent","general"];
    m.innerHTML=`<section class="view"><div class="board" id="board">${cols.map(p=>{
      const items=open().filter(vis).filter(t=>prio(t)===p).sort(byDue);
      const hide = p==="both"&&!items.length;
      return `<div class="col" data-p="${p}" ${hide?"hidden":""}><h3><span>${P[p]}</span><span>${items.length}</span></h3>
        ${items.map(t=>card(t,{drag:true})).join("")||`<div class="empty">Drop tasks here</div>`}</div>`;}).join("")}</div>
      <p class="sync">Drag cards between columns. On a phone, press and hold a card to move it.</p></section>`;
    wireBoard();
  } else if(tab==="lists"){
    m.innerHTML=`<section class="view">${lists().map(l=>{
      const items=open().filter(vis).filter(t=>t.list===l.id).sort(byDue);
      return `<div><div class="listhead"><input id="ln_${l.id}" data-list="${l.id}" value="${esc(l.name)}" aria-label="List name">
        ${l.id!=="inbox"?`<button class="btn ghost" data-act="dellist" data-list="${l.id}">Delete list</button>`:""}</div>
        <div class="group">${items.map(t=>card(t,{showList:false})).join("")||`<div class="empty">No open tasks</div>`}</div></div>`;}).join("")}
      <div><button class="btn" data-act="newlist">+ New list</button></div></section>`;
  } else {
    const done=Object.values(state.tasks).filter(t=>t.done&&vis(t)).sort((a,b)=>b.done-a.done);
    const recent=done.filter(t=>Date.now()-t.done<ARCHIVE_AFTER), arch=done.filter(t=>Date.now()-t.done>=ARCHIVE_AFTER);
    m.innerHTML=`<section class="view">${group("Done in the last 14 days",recent,{},"Ticked-off tasks show here for two weeks.")}
      <details class="archive"><summary>Archive (${arch.length})</summary><div class="group">${arch.map(t=>card(t)).join("")||`<div class="empty">Tasks move here 14 days after you finish them.</div>`}</div></details></section>`;
  }
  if(tab!=="recurring") m.insertAdjacentHTML("afterbegin",`<div class="filters" role="group" aria-label="Filter by place">${[["all","All tasks"],["school","🏫 School only"],["notschool","Not school"]].map(([k,n])=>`<button data-filter="${k}" aria-pressed="${sf===k}">${n}</button>`).join("")}</div>`);
}

/* ---------- actions ---------- */
function complete(t){
  if(t.done){ put({...t,done:null}); return; }
  if(t.repeat&&t.repeat!=="none"){
    const step={daily:DAY,weekly:7*DAY,monthly:0}[t.repeat];
    let next=t.due||Date.now();
    if(t.repeat==="monthly"){ const d=new Date(next); d.setMonth(d.getMonth()+1); next=+d; } else next+=step;
    put({...t,id:uid(),due:next,done:null,today:false,fired:false,created:Date.now()});
  }
  put({...t,done:Date.now(),today:false});
}
document.addEventListener("click",e=>{
  const tb=e.target.closest("[data-tab]"); if(tb){ tab=tb.dataset.tab; try{localStorage.setItem("pb_tab",tab)}catch(_){} render(); return; }
  const fb=e.target.closest("[data-filter]"); if(fb){ sf=fb.dataset.filter; try{localStorage.setItem("pb_sf",sf)}catch(_){} render(); return; }
  const a=e.target.closest("[data-act]"); if(!a) return;
  const rr=a.closest("[data-rid]"), rec=rr&&state.recurs[rr.dataset.rid];
  if(a.dataset.act==="recurring"){ tab="recurring"; render(); window.scrollTo(0,0); return; }
  if(a.dataset.act==="back"){ tab="today"; render(); return; }
  if(a.dataset.act==="newrecur"){ recurEditor(null); return; }
  if(rec){ if(a.dataset.act==="editrecur") recurEditor(rec);
    else if(a.dataset.act==="pause") put({...rec,paused:!rec.paused});
    else if(a.dataset.act==="renew"){ put({...rec,end:startOfDay(Date.now())+70*DAY+DAY-6e4,paused:false}); generate(); }
    return; }
  const id=a.closest(".task")?.dataset.id, t=id&&state.tasks[id];
  if(a.dataset.act==="toggle"&&t) complete(t);
  else if(a.dataset.act==="edit"&&t){ if(Date.now()-lastPress<600) return; editor(t); }
  else if(a.dataset.act==="newlist"){ const l={id:uid(),kind:"list",name:"New list",order:lists().length}; put(l); setTimeout(()=>{const i=$("#ln_"+l.id); i&&(i.focus(),i.select());},50); }
  else if(a.dataset.act==="dellist") confirmDeleteList(state.lists[a.dataset.list]);
});
document.addEventListener("change",e=>{
  const l=e.target.dataset.list&&state.lists[e.target.dataset.list];
  if(l&&e.target.tagName==="INPUT"){ const name=e.target.value.trim()||l.name; put({...l,name}); }
});
$("#add").addEventListener("submit",e=>{
  e.preventDefault(); const title=$("#addTitle").value.trim(); if(!title){ $("#addTitle").focus(); return; }
  const date=$("#addDate").value, rem=$("#addRem").checked, time=$("#addTime").value||"09:00";
  const due=date?+new Date(date+"T"+(rem?time:"23:59")):null;
  put({id:uid(),kind:"task",title,list:$("#addList").value||"inbox",important:$("#addImp").checked,urgent:$("#addUrg").checked,school:$("#addSch").checked,due,hasTime:!!(due&&rem),remind:!!(due&&rem),today:false,repeat:"none",done:null,created:Date.now()});
  $("#addTitle").value=""; $("#addImp").checked=$("#addUrg").checked=$("#addSch").checked=$("#addRem").checked=false; $("#addDate").value=""; $("#addTime").value="09:00"; $("#addTime").hidden=true; $("#addTitle").blur();
});

$("#addRem").addEventListener("change",e=>{ $("#addTime").hidden=!e.target.checked; if(e.target.checked&&!$("#addDate").value){ const d=new Date(); d.setMinutes(d.getMinutes()-d.getTimezoneOffset()); $("#addDate").value=d.toISOString().slice(0,10); } });
function setAddOpen(open){ $("#add").hidden=!open; $("#addToggle").setAttribute("aria-expanded",open); $("#addToggleTxt").textContent=open?"Hide add task":"+ Show add task"; try{localStorage.setItem("pb_add",open?"1":"0")}catch(_){} }
$("#addToggle").addEventListener("click",()=>setAddOpen($("#add").hidden));
try{ if(localStorage.getItem("pb_add")==="0") setAddOpen(false); }catch(_){}
/* ---------- editor sheet ---------- */
const toLocalInput=ms=>{ if(!ms) return ""; const d=new Date(ms); d.setMinutes(d.getMinutes()-d.getTimezoneOffset()); return d.toISOString().slice(0,16); };
function closeModal(){ $("#modal").innerHTML=""; }
function editor(t){
  $("#modal").innerHTML=`<div class="scrim" id="scrim"><form class="sheet" id="ed">
    <label>Task<input type="text" id="edTitle" value="${esc(t.title)}"></label>
    <div class="toggles">
      <button type="button" class="toggle imp" id="edImp" aria-pressed="${!!t.important}">Important</button>
      <button type="button" class="toggle urg" id="edUrg" aria-pressed="${!!t.urgent}">Urgent</button>
      <button type="button" class="toggle tod" id="edSch" aria-pressed="${!!t.school}">🏫 School only</button>
      <button type="button" class="toggle tod" id="edTod" aria-pressed="${!!t.today}">Flag for today</button>
    </div>
    <label>List<select id="edList">${lists().map(l=>`<option value="${l.id}" ${l.id===t.list?"selected":""}>${esc(l.name)}</option>`).join("")}</select></label>
    <label>Due date and time<input type="datetime-local" id="edDue" value="${toLocalInput(t.due)}"></label>
    <label style="display:flex;align-items:center;gap:8px;color:var(--fg)"><input type="checkbox" id="edRem" ${t.remind?"checked":""}> Remind me at this time</label>
    <label>Repeat<select id="edRep">${["none","daily","weekly","monthly"].map(r=>`<option value="${r}" ${t.repeat===r?"selected":""}>${r==="none"?"Doesn't repeat":r[0].toUpperCase()+r.slice(1)}</option>`).join("")}</select></label>
    <div class="row"><button type="button" class="btn danger" id="edDel">Delete task</button>
      <span><button type="button" class="btn ghost" id="edCancel">Cancel</button> <button class="btn primary">Save</button></span></div>
  </form></div>`;
  ["edImp","edUrg","edTod","edSch"].forEach(i=>$("#"+i).onclick=e=>e.target.setAttribute("aria-pressed",e.target.getAttribute("aria-pressed")!=="true"));
  $("#scrim").onclick=e=>{ if(e.target.id==="scrim") closeModal(); };
  $("#edCancel").onclick=closeModal;
  $("#edDel").onclick=()=>{ closeModal(); del(t); };
  $("#ed").onsubmit=e=>{ e.preventDefault();
    const due=$("#edDue").value?+new Date($("#edDue").value):null;
    put({...t,title:$("#edTitle").value.trim()||t.title,important:$("#edImp").getAttribute("aria-pressed")==="true",
      urgent:$("#edUrg").getAttribute("aria-pressed")==="true",school:$("#edSch").getAttribute("aria-pressed")==="true",today:$("#edTod").getAttribute("aria-pressed")==="true",
      list:$("#edList").value,due,remind:!!due&&$("#edRem").checked,hasTime:!!due&&($("#edRem").checked||!$("#edDue").value.endsWith("23:59")),repeat:$("#edRep").value,fired:due!==t.due?false:t.fired});
    const saved=state.tasks[t.id];
    if(saved&&(saved.repeat==="daily"||saved.repeat==="weekly")&&!saved.recurId){
      const base=saved.due?new Date(saved.due):new Date(), rid=uid();
      put({id:rid,kind:"recur",title:saved.title,list:saved.list,important:saved.important,urgent:saved.urgent,school:!!saved.school,
        days:saved.repeat==="daily"?[0,1,2,3,4,5,6]:[base.getDay()],time:saved.remind&&saved.due?base.toTimeString().slice(0,5):"",
        end:startOfDay(Date.now())+70*DAY+DAY-6e4,paused:false,created:Date.now(),lastGen:dkey(base)});
      put({...saved,recurId:rid,repeat:"none",appearDate:dkey(base)});
    }
    closeModal(); };
}
function recurEditor(r){
  const isNew=!r;
  r=r||{id:uid(),kind:"recur",title:"",list:"inbox",important:false,urgent:false,days:[new Date().getDay()],time:"",end:startOfDay(Date.now())+70*DAY+DAY-6e4,paused:false,created:Date.now(),lastGen:null};
  $("#modal").innerHTML=`<div class="scrim" id="scrim"><form class="sheet" id="re">
    <strong>${isNew?"New recurring task":"Edit recurring task"}</strong>
    <label>Task<input type="text" id="reTitle" value="${esc(r.title)}" placeholder="e.g. Plan weekly phonics"></label>
    <div class="toggles"><button type="button" class="toggle imp" id="reImp" aria-pressed="${!!r.important}">❗ Important</button>
      <button type="button" class="toggle urg" id="reUrg" aria-pressed="${!!r.urgent}">🕐 Urgent</button>
      <button type="button" class="toggle tod" id="reSch" aria-pressed="${!!r.school}">🏫 School only</button></div>
    <label>Appears on<div class="daypick">${WEEK.map(d=>`<button type="button" class="toggle tod" data-day="${d}" aria-pressed="${r.days.includes(d)}" aria-label="${DN[d]}">${DN[d][0]}</button>`).join("")}</div></label>
    <label>List<select id="reList">${lists().map(l=>`<option value="${l.id}" ${l.id===r.list?"selected":""}>${esc(l.name)}</option>`).join("")}</select></label>
    <label>Reminder time (optional)<input type="time" id="reTime" value="${r.time||""}"></label>
    <label>Ends on<input type="date" id="reEnd" value="${r.end?dkey(r.end):""}"></label>
    <p class="sync" id="reMsg" style="margin:0"></p>
    <div class="row">${isNew?"<span></span>":`<button type="button" class="btn danger" id="reDel">Delete</button>`}
      <span><button type="button" class="btn ghost" id="reCancel">Cancel</button> <button class="btn primary">Save</button></span></div>
  </form></div>`;
  document.querySelectorAll("#re .toggle").forEach(b=>b.onclick=()=>b.setAttribute("aria-pressed",b.getAttribute("aria-pressed")!=="true"));
  $("#scrim").onclick=e=>{ if(e.target.id==="scrim") closeModal(); };
  $("#reCancel").onclick=closeModal;
  if(!isNew) $("#reDel").onclick=()=>{ closeModal(); del(r); };
  $("#re").onsubmit=e=>{ e.preventDefault();
    const title=$("#reTitle").value.trim(), days=[...document.querySelectorAll("[data-day][aria-pressed=true]")].map(b=>+b.dataset.day);
    if(!title){ $("#reMsg").textContent="Give the task a name."; return; }
    if(!days.length){ $("#reMsg").textContent="Pick at least one day."; return; }
    const end=$("#reEnd").value?+new Date($("#reEnd").value+"T23:59"):null;
    put({...r,title,days,important:$("#reImp").getAttribute("aria-pressed")==="true",urgent:$("#reUrg").getAttribute("aria-pressed")==="true",school:$("#reSch").getAttribute("aria-pressed")==="true",
      list:$("#reList").value,time:$("#reTime").value,end});
    closeModal(); generate(); };
}
function confirmDeleteList(l){
  const n=open().filter(t=>t.list===l.id).length;
  $("#modal").innerHTML=`<div class="scrim" id="scrim"><div class="sheet"><strong>Delete “${esc(l.name)}”?</strong>
    <p style="margin:0;color:var(--muted)">${n?`Its ${n} open task${n>1?"s":""} will move to Inbox.`:"It has no open tasks."}</p>
    <div class="row"><span></span><span><button class="btn ghost" id="c1">Cancel</button> <button class="btn danger" id="c2">Delete list</button></span></div></div></div>`;
  $("#c1").onclick=closeModal; $("#scrim").onclick=e=>{ if(e.target.id==="scrim") closeModal(); };
  $("#c2").onclick=()=>{ Object.values(state.tasks).filter(t=>t.list===l.id).forEach(t=>put({...t,list:"inbox"})); del(l); closeModal(); };
}
const setPrio=(t,p)=>put({...t,important:p==="both"||p==="important",urgent:p==="both"||p==="urgent"});
function moveMenu(t){
  $("#modal").innerHTML=`<div class="scrim" id="scrim"><div class="sheet"><strong>Move “${esc(t.title)}” to</strong>
    <div class="movegrid">${Object.keys(P).map(p=>`<button class="col" style="min-height:0" data-p="${p}" data-move="${p}">${P[p]}</button>`).join("")}</div>
    <button class="btn ghost" id="mc">Cancel</button></div></div>`;
  $("#mc").onclick=closeModal; $("#scrim").onclick=e=>{ if(e.target.id==="scrim") closeModal(); };
  document.querySelectorAll("[data-move]").forEach(b=>b.onclick=()=>{ setPrio(t,b.dataset.move); closeModal(); });
}

/* ---------- board drag (mouse) + long-press (touch) ---------- */
let lastPress=0;
function wireBoard(){
  const board=$("#board"); let dragId=null;
  board.addEventListener("dragstart",e=>{ const c=e.target.closest(".task"); if(!c) return; dragId=c.dataset.id; c.classList.add("dragging");
    e.dataTransfer.setData("text/plain",dragId); const b=board.querySelector('[data-p="both"]'); b.hidden=false; });
  board.addEventListener("dragend",()=>{ dragId=null; render(); });
  board.querySelectorAll(".col").forEach(col=>{
    col.addEventListener("dragover",e=>{ e.preventDefault(); col.classList.add("over"); });
    col.addEventListener("dragleave",()=>col.classList.remove("over"));
    col.addEventListener("drop",e=>{ e.preventDefault(); const t=state.tasks[e.dataTransfer.getData("text/plain")]; if(t) setPrio(t,col.dataset.p); });
  });
  let timer=null;
  board.addEventListener("touchstart",e=>{ const c=e.target.closest(".task"); if(!c||e.target.closest(".check")) return;
    timer=setTimeout(()=>{ lastPress=Date.now(); navigator.vibrate&&navigator.vibrate(20); moveMenu(state.tasks[c.dataset.id]); },500); },{passive:true});
  ["touchend","touchmove","touchcancel"].forEach(ev=>board.addEventListener(ev,()=>clearTimeout(timer),{passive:true}));
  board.addEventListener("contextmenu",e=>{ if(e.target.closest(".task")) e.preventDefault(); });
}

/* ---------- reminders (while the page is open) ---------- */
const shown=new Set();
function checkReminders(){
  const now=Date.now();
  open().forEach(t=>{
    if(t.remind&&t.due&&t.due<=now&&!t.fired&&!shown.has(t.id)){ shown.add(t.id); toast(t); }
  });
}
function toast(t){
  const el=document.createElement("div"); el.className="toast";
  el.innerHTML=`<div class="t">🔔 ${esc(t.title)}</div><div class="acts">
    <button data-s="10">10 min</button><button data-s="60">1 hour</button><button data-s="tm">Tomorrow 9am</button>
    <button data-s="done">Done</button><button data-s="x">Dismiss</button></div>`;
  el.onclick=e=>{ const s=e.target.dataset.s; if(!s) return; const cur=state.tasks[t.id]; el.remove(); shown.delete(t.id); if(!cur) return;
    if(s==="done") complete(cur);
    else if(s==="x") put({...cur,fired:true});
    else { let due; if(s==="tm"){ const d=new Date(); d.setDate(d.getDate()+1); d.setHours(9,0,0,0); due=+d; } else due=Date.now()+(+s)*6e4;
      put({...cur,due,fired:false}); } };
  $("#toasts").appendChild(el);
}
setInterval(()=>{ if(store) generate(); checkReminders(); if(tab==="today") renderTabs(); },20000);



/* ---------- sign in ---------- */
const authMsg=t=>{ $("#authMsg").textContent=t; };
$("#authForm").addEventListener("submit",async e=>{
  e.preventDefault(); const mode=e.submitter&&e.submitter.value||"in";
  const email=$("#authEmail").value.trim(), password=$("#authPass").value;
  if(mode==="reset"){ if(!email) return authMsg("Enter your email first.");
    const {error}=await sb.auth.resetPasswordForEmail(email,{redirectTo:location.origin+location.pathname});
    return authMsg(error?error.message:"Check your email for a link to set a new password."); }
  if(password.length<8) return authMsg("Use a password of at least 8 characters.");
  authMsg(mode==="up"?"Creating your account…":"Signing in…");
  const {data,error}= mode==="up" ? await sb.auth.signUp({email,password,options:{emailRedirectTo:location.origin+location.pathname}})
                                  : await sb.auth.signInWithPassword({email,password});
  if(error) return authMsg(error.message);
  if(mode==="up"&&!data.session) authMsg("Account created. Open the confirmation email, then sign in here.");
});
sb.auth.onAuthStateChange((ev,session)=>{
  if(ev==="PASSWORD_RECOVERY"){ showNewPassword(); return; }
  if(session&&session.user&&session.user.id!==me) startSession(session.user);
  if(!session){ me=null; $("#auth").hidden=false; $("#app").hidden=true; }
});
function showNewPassword(){
  $("#modal").innerHTML=`<div class="scrim"><form class="sheet" id="np"><strong>Set a new password</strong>
    <label>New password<input type="text" id="npPass" autocomplete="new-password"></label><p class="sync" id="npMsg" style="margin:0"></p>
    <div class="row"><span></span><button class="btn primary">Save password</button></div></form></div>`;
  $("#np").onsubmit=async e=>{ e.preventDefault(); const p=$("#npPass").value; if(p.length<8){ $("#npMsg").textContent="At least 8 characters."; return; }
    const {error}=await sb.auth.updateUser({password:p}); if(error){ $("#npMsg").textContent=error.message; return; } closeModal(); };
}

/* ---------- settings: notifications, import, export, sign out ---------- */
const b64ToU8=b=>{ const p="=".repeat((4-b.length%4)%4), s=atob((b+p).replace(/-/g,"+").replace(/_/g,"/")); return Uint8Array.from(s,c=>c.charCodeAt(0)); };
async function notifStatus(){
  if(!("serviceWorker" in navigator)||!("PushManager" in window)) return "This browser can't receive notifications. On iPad, add the app to your home screen first.";
  if(Notification.permission==="denied") return "Notifications are blocked for this site. Allow them in your browser's site settings.";
  const reg=await navigator.serviceWorker.ready, sub=await reg.pushManager.getSubscription();
  return sub?"Notifications are on for this device.":"Notifications are off for this device.";
}
async function enableNotifications(){
  const perm=await Notification.requestPermission(); if(perm!=="granted") throw new Error("Notifications weren't allowed.");
  const reg=await navigator.serviceWorker.ready;
  const sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:b64ToU8(window.APP_CONFIG.VAPID_PUBLIC_KEY)});
  const j=sub.toJSON();
  const {error}=await sb.from("push_subscriptions").upsert({user_id:me,endpoint:j.endpoint,p256dh:j.keys.p256dh,auth:j.keys.auth,device:navigator.userAgent.slice(0,200)},{onConflict:"endpoint"});
  if(error) throw error;
}
async function sendTest(){
  const {data:{session}}=await sb.auth.getSession();
  let r; try{ r=await fetch(window.APP_CONFIG.SUPABASE_URL+"/functions/v1/tick",{method:"POST",headers:{"Content-Type":"application/json",apikey:window.APP_CONFIG.SUPABASE_ANON_KEY,Authorization:"Bearer "+session.access_token},body:JSON.stringify({test:true})}); }catch(_){ throw new Error("Couldn't reach the reminder sender. Check it's deployed as \"tick\" with JWT verification off (setup step 6)."); }
  const j=await r.json().catch(()=>({})); if(!r.ok) throw new Error(j.error||"The test couldn't be sent.");
  return j.sent?`Sent to ${j.sent} device${j.sent>1?"s":""}. It should arrive within a few seconds.`:"No devices have notifications on yet.";
}
function settings(){
  $("#modal").innerHTML=`<div class="scrim" id="scrim"><div class="sheet"><strong>Settings</strong>
    <div><div style="font-weight:600">Notifications</div><p class="sync" id="nStat" style="margin:4px 0 8px">Checking…</p>
      <div class="toggles"><button class="btn primary" id="nOn">Turn on for this device</button><button class="btn" id="nTest">Send test</button></div></div>
    <div><div style="font-weight:600">Your data</div><p class="sync" style="margin:4px 0 8px">Import tasks from a file, or save a backup copy.</p>
      <div class="toggles"><label class="btn" style="display:inline-block">Import file<input type="file" id="imp" accept=".json,application/json" hidden></label><button class="btn" id="exp">Save backup</button></div></div>
    <p class="sync" id="sMsg" style="margin:0"></p>
    <div class="row"><button class="btn danger" id="out">Sign out</button><button class="btn ghost" id="sClose">Close</button></div></div></div>`;
  const msg=t=>{ $("#sMsg").textContent=t; };
  notifStatus().then(t=>$("#nStat").textContent=t);
  $("#scrim").onclick=e=>{ if(e.target.id==="scrim") closeModal(); }; $("#sClose").onclick=closeModal;
  $("#nOn").onclick=async()=>{ msg("Turning on…"); try{ await enableNotifications(); msg("Done."); $("#nStat").textContent=await notifStatus(); }catch(e){ msg(e.message||String(e)); } };
  $("#nTest").onclick=async()=>{ msg("Sending…"); try{ msg(await sendTest()); }catch(e){ msg(e.message); } };
  $("#out").onclick=async()=>{ closeModal(); await sb.auth.signOut(); };
  $("#exp").onclick=()=>{ const blob=new Blob([JSON.stringify(allObjs(),null,1)],{type:"application/json"}); const a=document.createElement("a");
    a.href=URL.createObjectURL(blob); a.download="todo-backup-"+dkey(Date.now())+".json"; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),2000); };
  $("#imp").onchange=async e=>{ const f=e.target.files[0]; if(!f) return; msg("Importing…");
    try{ const arr=JSON.parse(await f.text()); if(!Array.isArray(arr)) throw new Error("That file isn't a task backup.");
      const objs=arr.filter(o=>o&&o.id&&["task","list","recur"].includes(o.kind));
      await store.saveMany(objs); await loadAll(); msg(`Imported ${objs.length} items.`); }
    catch(err){ msg("Import failed: "+(err.message||err)); } };
}
$("#gear").addEventListener("click",settings);

/* ---------- actions from notification buttons ---------- */
function handleLaunchAction(){
  const q=new URLSearchParams(location.search), act=q.get("act"), id=q.get("task"); if(!act||!id) return;
  history.replaceState(null,"",location.pathname);
  const t=state.tasks[id]; if(!t) return;
  if(act==="done") complete(t);
  else if(act==="snooze") put({...t,due:Date.now()+10*6e4,fired:false});
  else editor(t);
}
if("serviceWorker" in navigator){
  navigator.serviceWorker.register("sw.js");
  navigator.serviceWorker.addEventListener("message",e=>{ if(e.data&&e.data.url){ history.replaceState(null,"",e.data.url); handleLaunchAction(); } });
}
sb.auth.getSession().then(({data})=>{ if(!data.session){ $("#auth").hidden=false; $("#app").hidden=true; } });
