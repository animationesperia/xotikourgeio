'use strict';
const http=require('node:http'), fs=require('node:fs'), path=require('node:path'), crypto=require('node:crypto');
const PORT=Number(process.env.PORT||3000), HOST=process.env.HOST||'0.0.0.0';
const ADMIN_PASSWORD=process.env.ADMIN_PASSWORD, PROMOTER_PASSWORD=process.env.PROMOTER_PASSWORD, SECRET=process.env.SESSION_SECRET;
if(!ADMIN_PASSWORD||!PROMOTER_PASSWORD||!SECRET||SECRET.length<24){console.error('Set ADMIN_PASSWORD, PROMOTER_PASSWORD and SESSION_SECRET (24+ characters).');process.exit(1)}
const DATA_FILE=process.env.DATA_FILE||path.join(__dirname,'queue-data.json');
const TZ='Europe/Athens';
const day=()=>new Intl.DateTimeFormat('en-CA',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
let db;try{db=JSON.parse(fs.readFileSync(DATA_FILE,'utf8'))}catch{db={day:day(),next:1,current:null,tickets:[],paused:false}}
const token=()=>crypto.randomBytes(24).toString('hex');
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const sign=s=>crypto.createHmac('sha256',SECRET).update(s).digest('hex');
const safeEq=(a,b)=>{const aa=Buffer.from(String(a)),bb=Buffer.from(String(b));return aa.length===bb.length&&crypto.timingSafeEqual(aa,bb)};
const cookie=req=>Object.fromEntries((req.headers.cookie||'').split(';').map(x=>x.trim().split('=').map(decodeURIComponent)).filter(x=>x.length===2));
function auth(req){let v=cookie(req).staff||'';let [role,exp,sig]=v.split('.');if(!['admin','promoter'].includes(role)||!exp||!sig||+exp<Date.now()||!safeEq(sig,sign(role+'.'+exp)))return null;return role}
function setCookie(res,name,value,age){res.setHeader('Set-Cookie',`${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${age}; HttpOnly; SameSite=Lax${process.env.NODE_ENV==='production'?'; Secure':''}`)}
function save(){let tmp=DATA_FILE+'.tmp';fs.writeFileSync(tmp,JSON.stringify(db));fs.renameSync(tmp,DATA_FILE)}
function normalize(){let changed=false,now=Date.now(),d=day();if(db.day!==d){db={day:d,next:1,current:null,tickets:[],paused:false};changed=true}
for(let t of db.tickets){if(t.status==='waiting'&&now-t.created>=3600000){t.status='expired';changed=true}}
if(changed)save()}
function json(res,status,obj){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(obj))}
function fail(res,status,message){json(res,status,{error:message})}
function body(req){return new Promise((resolve,reject)=>{let s='';req.on('data',b=>{s+=b;if(s.length>10000){reject(Error('Too large'));req.destroy()}});req.on('end',()=>{try{resolve(JSON.parse(s||'{}'))}catch{reject(Error('Invalid JSON'))}});req.on('error',reject)})}
const getGroup=(id)=>db.tickets.filter(t=>t.group===id);
function issue(count,source){let first=db.next,group=token(),created=Date.now();let tickets=[];for(let i=0;i<count;i++){let t={number:db.next++,group,created,status:'waiting',source};db.tickets.push(t);tickets.push(t.number)}save();return{group,numbers:tickets,day:db.day}}
function publicTicket(req){const c=cookie(req),v=c.ticket||'',parts=v.split('.');if(parts.length!==3)return null;let [d,g,sig]=parts;if(!safeEq(sig,sign(d+'.'+g)))return null;if(d!==db.day)return null;let t=getGroup(g);return t.length?{group:g,numbers:t.map(x=>x.number),statuses:t.map(x=>x.status),day:d}:null}
function staffState(){return{day:db.day,next:db.next,current:db.current,paused:db.paused,tickets:db.tickets,waiting:db.tickets.filter(t=>t.status==='waiting').length}}
const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml'};
const staticRoot=path.join(__dirname,'public');
const server=http.createServer(async(req,res)=>{try{normalize();const url=new URL(req.url,'http://localhost'),route=url.pathname,role=auth(req);
if(route==='/api/status'&&req.method==='GET')return json(res,200,{day:db.day,current:db.current,paused:db.paused});
if(route==='/api/my-ticket'&&req.method==='GET')return json(res,200,{ticket:publicTicket(req)});
if(route==='/api/issue'&&req.method==='POST'){if(db.paused)return fail(res,409,'Η ουρά είναι προσωρινά κλειστή');let old=publicTicket(req);if(old)return fail(res,409,'Έχει ήδη εκδοθεί αριθμός σε αυτή τη συσκευή σήμερα');let data=await body(req),count=Number(data.count);if(!Number.isInteger(count)||count<1||count>4)return fail(res,400,'Επιλέξτε 1–4 παιδιά');let issued=issue(count,'qr');setCookie(res,'ticket',`${issued.day}.${issued.group}.${sign(issued.day+'.'+issued.group)}`,86400);return json(res,200,{ticket:issued})}
if(route==='/api/login'&&req.method==='POST'){let data=await body(req),r=data.role,p=String(data.password||'');if(!(['admin','promoter'].includes(r))||!safeEq(p,r==='admin'?ADMIN_PASSWORD:PROMOTER_PASSWORD))return fail(res,401,'Λάθος κωδικός');let exp=Date.now()+12*3600000;setCookie(res,'staff',`${r}.${exp}.${sign(r+'.'+exp)}`,43200);return json(res,200,{role:r})}
if(route==='/api/logout'&&req.method==='POST'){setCookie(res,'staff','',0);return json(res,200,{ok:true})}
if(route==='/api/me'&&req.method==='GET')return json(res,200,{role});
if(route==='/api/staff'&&req.method==='GET'){if(!role)return fail(res,401,'Απαιτείται σύνδεση');return json(res,200,staffState())}
if(route==='/api/manual'&&req.method==='POST'){if(!role||role!=='promoter')return fail(res,403,'Μόνο ο promoter εκδίδει χειρόγραφους αριθμούς');if(db.paused)return fail(res,409,'Η ουρά είναι προσωρινά κλειστή');let data=await body(req),count=Number(data.count);if(!Number.isInteger(count)||count<1||count>4)return fail(res,400,'Επιλέξτε 1–4 παιδιά');return json(res,200,{ticket:issue(count,'manual')})}
if(route==='/api/next'&&req.method==='POST'){if(role!=='admin')return fail(res,403,'Μόνο Admin');let cur=db.tickets.find(t=>t.number===db.current);if(cur&&cur.status==='called')cur.status='served';let next=db.tickets.find(t=>t.status==='waiting');db.current=next?next.number:null;if(next)next.status='called';save();return json(res,200,staffState())}
if(route==='/api/skip'&&req.method==='POST'){if(role!=='admin')return fail(res,403,'Μόνο Admin');let cur=db.tickets.find(t=>t.number===db.current);if(cur&&cur.status==='called')cur.status='skipped';db.current=null;save();return json(res,200,staffState())}
if(route==='/api/finish'&&req.method==='POST'){if(role!=='admin')return fail(res,403,'Μόνο Admin');let cur=db.tickets.find(t=>t.number===db.current);if(cur&&cur.status==='called')cur.status='served';db.current=null;save();return json(res,200,staffState())}
if(route==='/api/pause'&&req.method==='POST'){if(role!=='admin')return fail(res,403,'Μόνο Admin');db.paused=!!(await body(req)).paused;save();return json(res,200,staffState())}
if(route==='/api/reset'&&req.method==='POST'){if(role!=='admin')return fail(res,403,'Μόνο Admin');let data=await body(req);if(data.confirm!=='RESET')return fail(res,400,'Επιβεβαίωση απαιτείται');db={day:day(),next:1,current:null,tickets:[],paused:false};save();return json(res,200,staffState())}
if(route.startsWith('/api/'))return fail(res,404,'Δεν βρέθηκε');
let file=route==='/'?'index.html':route==='/promoter'?'promoter.html':route==='/admin'?'admin.html':route.slice(1);if(!['index.html','promoter.html','admin.html','style.css','app.js'].includes(file))return fail(res,404,'Δεν βρέθηκε');let full=path.join(staticRoot,file);res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return fs.createReadStream(full).pipe(res)
}catch(e){console.error(e);if(!res.headersSent)fail(res,500,'Σφάλμα διακομιστή')}});
server.listen(PORT,HOST,()=>console.log(`Ξωτικουργείο: http://localhost:${PORT}`));
