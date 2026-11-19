'use strict';
const $=id=>document.getElementById(id),num=n=>String(n).padStart(3,'0');
async function api(route,body){let r=await fetch('/api/'+route,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',...(body===undefined?{}:{body:JSON.stringify(body)})});let v=await r.json();if(!r.ok)throw Error(v.error||'Σφάλμα');return v}
function error(e){if($('error'))$('error').textContent=e?.message||''}
let count=1;document.querySelectorAll('[data-n]').forEach(b=>b.onclick=()=>{count=Number(b.dataset.n);document.querySelectorAll('[data-n]').forEach(x=>x.classList.toggle('selected',x===b))});
async function publicPage(){let ticket=null,alerted=false;const show=t=>{ticket=t;$('form').classList.add('hidden');$('ticket').classList.remove('hidden');$('numbers').textContent=t.numbers.map(num).join(' · ')};
try{let d=await api('my-ticket');if(d.ticket)show(d.ticket)}catch(e){error(e)}
$('issue').onclick=async()=>{if(ticket)return;$('issue').disabled=true;try{let d=await api('issue',{count});show(d.ticket)}catch(e){error(e);$('issue').disabled=false;try{let d=await api('my-ticket');if(d.ticket)show(d.ticket)}catch{}}};
async function poll(){if(!ticket)return;try{let d=await api('status');if(d.day!==ticket.day)return;let active=ticket.numbers.includes(d.current);if(active&&!alerted){alerted=true;$('ticket').classList.add('flash');$('alert').classList.remove('hidden');$('alert').scrollIntoView({behavior:'smooth',block:'nearest'})}else if(!active&&alerted){alerted=false;$('ticket').classList.remove('flash');$('alert').classList.add('hidden')}}catch{}}
setInterval(poll,2500);poll()}
async function staffPage(role){let authorized=false,paused=false;
const toggle=on=>{$('login').classList.toggle('hidden',on);$('work').classList.toggle('hidden',!on);authorized=on};
async function login(){try{await api('login',{role,password:$('password').value});$('password').value='';toggle(true);refresh()}catch(e){error(e)}}
$('loginBtn').onclick=login;$('password').addEventListener('keydown',e=>{if(e.key==='Enter')login()});$('logout').onclick=async()=>{await api('logout',{});toggle(false)};
async function refresh(){if(!authorized)return;try{let d=await api('staff');paused=d.paused;if(role==='promoter'){$('next').textContent=num(d.next);$('manual').disabled=paused}else{renderAdmin(d)}}catch(e){if(e.message==='Απαιτείται σύνδεση')toggle(false);else error(e)}}
if(role==='promoter'){$('manual').onclick=async()=>{let b=$('manual');b.disabled=true;try{let d=await api('manual',{count});$('ticket').classList.remove('hidden');$('numbers').textContent=d.ticket.numbers.map(num).join(' · ');await refresh()}catch(e){error(e)}finally{b.disabled=paused}}}
else{var renderAdmin = function(d){$('current').textContent=d.current===null?'—':num(d.current);$('waiting').textContent=d.waiting;$('served').textContent=d.tickets.filter(t=>t.status==='served').length;$('expired').textContent=d.tickets.filter(t=>t.status==='expired'||t.status==='skipped').length;$('pauseBtn').textContent=d.paused?'Άνοιγμα ουράς':'Παύση νέων αριθμών';let q=$('queue');q.replaceChildren();d.tickets.slice(-100).forEach(t=>{let el=document.createElement('div');el.className='row';let a=document.createElement('b');a.textContent=num(t.number);let b=document.createElement('span');b.textContent=({waiting:'Αναμονή',called:'Τώρα',served:'Ολοκληρώθηκε',expired:'Έληξε',skipped:'Παράλειψη'})[t.status]+' · '+(t.source==='manual'?'Χειρόγραφο':'QR');el.append(a,b);q.append(el)})}
for(let [id,route] of [['nextBtn','next'],['finishBtn','finish'],['skipBtn','skip']])$(id).onclick=async()=>{try{await api(route,{});refresh()}catch(e){error(e)}};
$('pauseBtn').onclick=async()=>{try{await api('pause',{paused:!paused});refresh()}catch(e){error(e)}};
$('resetBtn').onclick=async()=>{if(!confirm('Να ακυρωθούν ΟΛΟΙ οι αριθμοί και να ξεκινήσει η ουρά από 001;'))return;try{await api('reset',{confirm:'RESET'});refresh()}catch(e){error(e)}}}
try{let d=await api('me');if(d.role===role){toggle(true);refresh()}}catch{}
setInterval(refresh,2500)}
if($('issue'))publicPage();else if($('manual'))staffPage('promoter');else if($('nextBtn'))staffPage('admin');
