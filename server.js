'use strict';
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {PORT=3000,ADMIN_PASSWORD,PROMOTER_PASSWORD,SESSION_SECRET,SUPABASE_URL,SUPABASE_SERVICE_ROLE_KEY}=process.env;
if(!ADMIN_PASSWORD||!PROMOTER_PASSWORD||!SESSION_SECRET||SESSION_SECRET.length<24||!SUPABASE_URL||!SUPABASE_SERVICE_ROLE_KEY){console.error('Missing required environment variables');process.exit(1)}
const sign=s=>crypto.createHmac('sha256',SESSION_SECRET).update(s).digest('hex');
const eq=(a,b)=>{let x=Buffer.from(String(a)),y=Buffer.from(String(b));return x.length===y.length&&crypto.timingSafeEqual(x,y)};
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Athens',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const cookies=req=>Object.fromEntries((req.headers.cookie||'').split(';').map(x=>x.trim().split('=').map(decodeURIComponent)).filter(x=>x.length===2));
const auth=req=>{let [r,e,s]=(cookies(req).staff||'').split('.');return ['admin','promoter'].includes(r)&&+e>Date.now()&&eq(s,sign(r+'.'+e))?r:null};
const setCookie=(res,k,v,age)=>res.setHeader('Set-Cookie',`${k}=${encodeURIComponent(v)}; Path=/; Max-Age=${age}; HttpOnly; SameSite=Lax${process.env.NODE_ENV==='production'?'; Secure':''}`);
const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data))};
const fail=(res,status,error)=>json(res,status,{error});
async function body(req){let chunks=[],length=0;for await(const c of req){length+=c.length;if(length>10000)throw Error('Request too large');chunks.push(c)}return JSON.parse(Buffer.concat(chunks).toString()||'{}')}
async function sb(route,method='GET',payload){let url=SUPABASE_URL.replace(/\/$/,'')+'/rest/v1/'+route;let r=await fetch(url,{method,headers:{apikey:SUPABASE_SERVICE_ROLE_KEY,Authorization:'Bearer '+SUPABASE_SERVICE_ROLE_KEY,'Content-Type':'application/json',Prefer:'return=representation'},...(payload===undefined?{}:{body:JSON.stringify(payload)})});let raw=await r.text();let data;try{data=JSON.parse(raw)}catch{data=raw}if(!r.ok){console.error('Supabase',r.status,typeof data==='object'?data.code:data);throw Error('Database operation failed')}return data}
const rpc=(name,args={})=>sb('rpc/'+name,'POST',args);
const ticketCookie=req=>{let [d,g,s]=(cookies(req).ticket||'').split('.');return d===today()&&/^[0-9a-f-]{36}$/.test(g||'')&&eq(s,sign(d+'.'+g))?{day:d,group:g}:null};
async function myTicket(req){let c=ticketCookie(req);if(!c)return null;let ts=await sb('queue_tickets?select=number,status&queue_date=eq.'+c.day+'&group_id=eq.'+c.group+'&order=number.asc');return ts.length?{day:c.day,group:c.group,numbers:ts.map(t=>t.number),statuses:ts.map(t=>t.status)}:null}
async function state(){return rpc('queue_staff_state')}
async function status(){let rows=await sb('queue_days?select=queue_date,current_number,paused&queue_date=eq.'+today());return {day:today(),current:rows[0]?.current_number??null,paused:rows[0]?.paused??false}}
async function issue(count,source){if(!Number.isInteger(count)||count<1||count>4)throw Error('Επιλέξτε 1–4 παιδιά');let rows=await rpc('issue_queue_numbers',{p_count:count,p_source:source});if(!Array.isArray(rows)||!rows.length)throw Error('Η έκδοση απέτυχε');return {day:rows[0].ticket_day,group:rows[0].ticket_group,numbers:rows.map(r=>r.ticket_number)}}
const root=path.join(__dirname,'public');const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8'};
http.createServer(async(req,res)=>{try{let u=new URL(req.url,'http://localhost'),p=u.pathname,role=auth(req);if(p==='/health')return json(res,200,{ok:true});
if(p==='/api/status'&&req.method==='GET')return json(res,200,await status());
if(p==='/api/my-ticket'&&req.method==='GET')return json(res,200,{ticket:await myTicket(req)});
if(p==='/api/issue'&&req.method==='POST'){if(await myTicket(req))return fail(res,409,'Έχει ήδη εκδοθεί αριθμός σε αυτή τη συσκευή σήμερα');let data=await body(req),t=await issue(Number(data.count),'qr');setCookie(res,'ticket',`${t.day}.${t.group}.${sign(t.day+'.'+t.group)}`,86400);return json(res,200,{ticket:t})}
if(p==='/api/login'&&req.method==='POST'){let d=await body(req),r=d.role;if(!['admin','promoter'].includes(r)||!eq(d.password||'',r==='admin'?ADMIN_PASSWORD:PROMOTER_PASSWORD))return fail(res,401,'Λάθος κωδικός');let e=Date.now()+43200000;setCookie(res,'staff',`${r}.${e}.${sign(r+'.'+e)}`,43200);return json(res,200,{role:r})}
if(p==='/api/logout'&&req.method==='POST'){setCookie(res,'staff','',0);return json(res,200,{ok:true})}
if(p==='/api/me'&&req.method==='GET')return json(res,200,{role});
if(p==='/api/staff'&&req.method==='GET'){if(!role)return fail(res,401,'Απαιτείται σύνδεση');return json(res,200,await state())}
if(p==='/api/manual'&&req.method==='POST'){if(role!=='promoter')return fail(res,403,'Μόνο promoter');let d=await body(req);return json(res,200,{ticket:await issue(Number(d.count),'manual')})}
const actions={next:'next',finish:'finish',skip:'skip',pause:'pause',reset:'reset'};
if(p.startsWith('/api/')&&req.method==='POST'&&actions[p.slice(5)]){if(role!=='admin')return fail(res,403,'Μόνο Admin');let action=p.slice(5),d=await body(req);if(action==='reset'&&d.confirm!=='RESET')return fail(res,400,'Απαιτείται επιβεβαίωση');await rpc('queue_admin_action',{p_action:action,p_paused:action==='pause'?!!d.paused:null});return json(res,200,await state())}
if(p.startsWith('/api/'))return fail(res,404,'Δεν βρέθηκε');
let file=p==='/'?'index.html':p==='/admin'?'admin.html':p==='/promoter'?'promoter.html':p.slice(1);if(!['index.html','admin.html','promoter.html','app.js','style.css'].includes(file))return fail(res,404,'Δεν βρέθηκε');res.writeHead(200,{'Content-Type':mime[path.extname(file)],'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return fs.createReadStream(path.join(root,file)).pipe(res)
}catch(e){console.error(e);if(!res.headersSent)fail(res,500,'Προσωρινό πρόβλημα. Δοκιμάστε ξανά.')}}).listen(Number(PORT),'0.0.0.0',()=>console.log('Ξωτικουργείο listening'));
