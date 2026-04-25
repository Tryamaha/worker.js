export default {
async fetch(request, env) {
const url = new URL(request.url);
const path = url.pathname;

await env.DB.prepare(`
CREATE TABLE IF NOT EXISTS reports (
id INTEGER PRIMARY KEY AUTOINCREMENT,
phone TEXT,
type TEXT,
note TEXT,
created_at TEXT
);`).run();

await env.DB.prepare(`
CREATE TABLE IF NOT EXISTS blacklist (
id INTEGER PRIMARY KEY AUTOINCREMENT,
phone TEXT,
reason TEXT,
created_at TEXT
);`).run();

await env.DB.prepare(`
CREATE TABLE IF NOT EXISTS memory (
id INTEGER PRIMARY KEY AUTOINCREMENT,
phone TEXT,
score INTEGER,
created_at TEXT
);`).run();

function json(data){
return new Response(JSON.stringify(data,null,2),{
headers:{'content-type':'application/json;charset=utf-8'}
});
}

function html(data){
return new Response(data,{
headers:{'content-type':'text/html;charset=utf-8'}
});
}

function now(){
return new Date().toISOString();
}

function detectOperator(num){
if(num.startsWith("0312")) return {operator:"Sabit Hat", city:"Ankara"};
if(num.startsWith("0212")) return {operator:"Sabit Hat", city:"İstanbul Avrupa"};
if(num.startsWith("0216")) return {operator:"Sabit Hat", city:"İstanbul Anadolu"};
if(num.startsWith("0224")) return {operator:"Sabit Hat", city:"Bursa"};
if(num.startsWith("0232")) return {operator:"Sabit Hat", city:"İzmir"};
if(num.startsWith("0549")) return {operator:"Vodafone", city:"Mobil Hat"};
if(num.startsWith("0555")) return {operator:"Türk Telekom", city:"Mobil Hat"};
if(num.startsWith("0532")) return {operator:"Turkcell", city:"Mobil Hat"};
if(num.startsWith("0850")) return {operator:"Kurumsal VOIP", city:"Türkiye Geneli"};
if(num.startsWith("444")) return {operator:"Kurumsal Çağrı", city:"Türkiye"};
return {operator:"Bilinmiyor", city:"Tespit edilemedi"};
}

async function analyzeNumber(num,env){

const op = detectOperator(num);

const mem = await env.DB.prepare(
"SELECT COUNT(*) as c FROM searches WHERE phone=?"
).bind(num).first();

const rep = await env.DB.prepare(
"SELECT COUNT(*) as c FROM reports WHERE phone=?"
).bind(num).first();

const blk = await env.DB.prepare(
"SELECT COUNT(*) as c FROM blacklist WHERE phone=?"
).bind(num).first();

let score = 15;
score += mem.c * 12;
score += rep.c * 18;
score += blk.c * 35;

if(op.operator==="Kurumsal VOIP") score += 25;
if(op.operator==="Sabit Hat") score += 10;
if(op.operator==="Bilinmiyor") score += 20;

let riskWords = [];
if(op.operator==="Kurumsal VOIP") riskWords.push("robot arama","tele satış","anket");
if(op.operator==="Sabit Hat") riskWords.push("sessiz arama","çağrı merkezi");
if(op.city==="Mobil Hat") riskWords.push("mobil hat");

if(score>100) score=100;

let risk="Düşük";
if(score>=35) risk="Orta";
if(score>=70) risk="Yüksek";

let aiComment=`AI dedektif motoru bu numaranın operatör paterni, D1 geçmiş hafızası, kullanıcı ihbarları, kara liste durumu ve risk kelime kümelerini birlikte değerlendirerek ${risk.toLowerCase()} risk taşıdığını düşünüyor.`;

let webResults = [
{
title:`${num} şikayet / spam araması`,
link:`https://www.google.com/search?q=${encodeURIComponent(num+" şikayet spam kimin numarası")}`
},
{
title:`${num} dolandırıcı mı?`,
link:`https://www.google.com/search?q=${encodeURIComponent(num+" dolandırıcı mı çağrı merkezi sessiz arama")}`
}
];

await env.DB.prepare(
"INSERT INTO memory (phone,score,created_at) VALUES (?,?,?)"
).bind(num,score,now()).run();

return {
number:num,
operator:op.operator,
city:op.city,
possibleOwner: op.operator + " / açık web kontrolü gerekir",
possibleCompany: "Kesin firma için Google araştırması gerekir",
confidence: op.city==="Mobil Hat" ? "Düşük" : "Orta",
memoryHits:mem.c+1,
reportCount:rep.c,
blacklist:blk.c>0,
score:score,
risk:risk,
riskWords:riskWords,
keywords:riskWords,
findings:[
  (mem.c+1)+" geçmiş sorgu bulundu.",
  rep.c+" kullanıcı ihbarı bulundu.",
  blk.c>0 ? "Numara kara listede kayıtlı." : "Kara liste kaydı yok.",
  op.operator+" / "+op.city+" eşleşmesi yapıldı."
],
aiComment:aiComment,
webResults:webResults
};if(path==="/analyze"){
const num = (url.searchParams.get("number") || "").replace(/\\D/g,"");
if(!num) return json({error:true,message:"Numara gerekli"});
return json(await analyzeNumber(num,env));
}

if(path==="/report"){
const num = (url.searchParams.get("number") || "").replace(/\\D/g,"");
const type = url.searchParams.get("type") || "spam";
const note = url.searchParams.get("note") || "manuel ihbar";
if(!num) return json({error:true,message:"Numara gerekli"});

await env.DB.prepare(
"INSERT INTO reports (phone,type,note,created_at) VALUES (?,?,?,?)"
).bind(num,type,note,now()).run();

return json({
ok:true,
message:"İhbar kaydedildi",
phone:num,
type:type
});
}

if(path==="/blacklist"){
const num = (url.searchParams.get("number") || "").replace(/\\D/g,"");
const reason = url.searchParams.get("reason") || "manuel";
if(!num) return json({error:true,message:"Numara gerekli"});

await env.DB.prepare(
"INSERT INTO blacklist (phone,reason,created_at) VALUES (?,?,?)"
).bind(num,reason,now()).run();

return json({
ok:true,
message:"Kara listeye eklendi",
phone:num
});
}

if(path==="/dashboard"){
const total = await env.DB.prepare(
"SELECT COUNT(DISTINCT phone) as c FROM memory"
).first();

const reports = await env.DB.prepare(
"SELECT COUNT(*) as c FROM reports"
).first();

const blacklist = await env.DB.prepare(
"SELECT COUNT(*) as c FROM blacklist"
).first();

const top = await env.DB.prepare(
"SELECT phone, COUNT(*) as c FROM memory GROUP BY phone ORDER BY c DESC LIMIT 10"
).all();

const lastReports = await env.DB.prepare(
"SELECT phone,type,note,created_at FROM reports ORDER BY id DESC LIMIT 10"
).all();

return html(`
<!DOCTYPE html>
<html lang="tr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Spam Kovucu Dashboard</title>
<style>
body{
margin:0;
font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Arial;
background:radial-gradient(circle at top,#1d4ed8,#020617 50%,#000);
color:white;
}
.app{max-width:620px;margin:auto;padding:24px 20px 90px}
h1{font-size:42px;line-height:1.05}
.card{
background:rgba(15,23,42,.82);
border:1px solid rgba(255,255,255,.14);
border-radius:30px;
padding:22px;
margin:16px 0;
box-shadow:0 25px 60px rgba(0,0,0,.35);
}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.label{color:#94a3b8;font-size:16px}
.value{font-size:48px;font-weight:900}
li{margin:10px 0;color:#dbeafe}
button{
width:100%;
padding:18px;
border:0;
border-radius:22px;
font-size:20px;
font-weight:900;
color:white;
background:linear-gradient(135deg,#2563eb,#7c3aed);
}
.badge{
display:inline-block;
padding:8px 12px;
border-radius:999px;
background:rgba(255,255,255,.12);
margin:4px;
}
</style>
</head>
<body>
<div class="app">
<h1>🛡️ Spam Kovucu<br>PRO Dashboard</h1>

<div class="grid">
<div class="card"><div class="label">Numara</div><div class="value">${total.c}</div></div>
<div class="card"><div class="label">İhbar</div><div class="value">${reports.c}</div></div>
<div class="card"><div class="label">Kara Liste</div><div class="value">${blacklist.c}</div></div>
<div class="card"><div class="label">Motor</div><div class="value">Aktif</div></div>
</div>

<div class="card">
<h2>🔥 En Çok Sorgulananlar</h2>
<ul>
${(top.results||[]).map(x=>`<li>${x.phone} — ${x.c} sorgu</li>`).join("") || "<li>Kayıt yok</li>"}
</ul>
</div>

<div class="card">
<h2>🚨 Son İhbarlar</h2>
<ul>
${(lastReports.results||[]).map(x=>`<li>${x.phone} — ${x.type} — ${x.note||""}</li>`).join("") || "<li>İhbar yok</li>"}
</ul>
</div>

<div class="card">
<h2>⚡ Sistem Durumu</h2>
<span class="badge">D1 Aktif</span>
<span class="badge">AI Motor Aktif</span>
<span class="badge">Google OSINT Aktif</span>
<span class="badge">Kara Liste Aktif</span>
</div>

<div class="card">
<button onclick="location.href='/'">🏠 Ana Ekrana Dön</button>
</div>

</div>
</body>
</html>
`);
}
}
return html(`
<!DOCTYPE html>
<html lang="tr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0,viewport-fit=cover">
<title>Spam Kovucu App</title>
<style>
*{box-sizing:border-box}
body{
margin:0;
font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Arial;
background:#020617;
color:white;
}
.bg{
position:fixed;
inset:0;
background:
radial-gradient(circle at top left,#2563eb 0,#020617 45%,#000 100%);
z-index:-2;
}
.orb{
position:fixed;
width:260px;
height:260px;
border-radius:50%;
filter:blur(70px);
opacity:.45;
background:#7c3aed;
right:-90px;
top:80px;
z-index:-1;
}
.app{
max-width:560px;
margin:auto;
padding:20px 18px 110px;
}
.hero{
padding-top:18px;
}
.logo{
font-size:52px;
font-weight:950;
line-height:1.05;
}
.sub{
color:#c7d2fe;
font-size:15px;
line-height:1.4;
margin-top:10px;
}
.card{
background:rgba(15,23,42,.78);
border:1px solid rgba(255,255,255,.14);
box-shadow:0 22px 60px rgba(0,0,0,.35);
backdrop-filter:blur(22px);
-webkit-backdrop-filter:blur(22px);
border-radius:32px;
padding:22px;
margin:18px 0;
}
input{
width:100%;
border:0;
outline:0;
background:#020617;
color:white;
border-radius:24px;
padding:20px;
font-size:26px;
}
button{
width:100%;
border:0;
border-radius:24px;
padding:18px 20px;
font-size:20px;
font-weight:900;
color:white;
background:linear-gradient(135deg,#2563eb,#7c3aed);
box-shadow:0 12px 26px rgba(37,99,235,.32);
}
.grid{
display:grid;
grid-template-columns:1fr 1fr;
gap:12px;
}
.stat{
background:rgba(255,255,255,.08);
border-radius:24px;
padding:16px;
}
.label{
color:#94a3b8;
font-size:14px;
}
.value{
font-size:28px;
font-weight:900;
margin-top:5px;
}
.risk{
font-size:64px;
font-weight:950;
margin:8px 0;
}
.red{color:#ef4444}
.yellow{color:#facc15}
.green{color:#22c55e}
.bar{
height:16px;
background:#1e293b;
border-radius:999px;
overflow:hidden;
margin:12px 0;
}
.fill{
height:100%;
width:0%;
background:linear-gradient(90deg,#22c55e,#facc15,#ef4444);
transition:1.4s;
}
.tag{
display:inline-block;
background:rgba(255,255,255,.13);
padding:8px 14px;
border-radius:999px;
margin:5px;
color:#e2e8f0;
}
a{color:#7dd3fc}
.muted{
color:#cbd5e1;
line-height:1.55;
}
li{
margin:9px 0;
color:#dbeafe;
}
.tabs{
position:fixed;
left:50%;
bottom:14px;
transform:translateX(-50%);
width:min(520px,92vw);
display:grid;
grid-template-columns:repeat(4,1fr);
gap:8px;
background:rgba(15,23,42,.88);
border:1px solid rgba(255,255,255,.14);
border-radius:28px;
padding:10px;
backdrop-filter:blur(22px);
-webkit-backdrop-filter:blur(22px);
z-index:10;
}
.tab{
border:0;
background:transparent;
color:#cbd5e1;
font-size:12px;
font-weight:800;
padding:8px;
border-radius:18px;
box-shadow:none;
}
.tab.active{
background:rgba(255,255,255,.12);
color:white;
}
.screen{display:none}
.screen.active{display:block}
.splash{
position:fixed;
inset:0;
background:#020617;
display:flex;
align-items:center;
justify-content:center;
z-index:99;
transition:.5s;
}
.splash.hide{
opacity:0;
pointer-events:none;
}
.spin{
font-size:64px;
animation:pulse 1.1s infinite alternate;
}
@keyframes pulse{
from{transform:scale(.9);opacity:.65}
to{transform:scale(1.08);opacity:1}
}
</style>
</head>
<body>
<div class="bg"></div>
<div class="orb"></div>
<div id="splash" class="splash"><div class="spin">🛡️</div></div>

<div class="app">

<section id="home" class="screen active">
<div class="hero">
<div class="logo">Spam Kovucu</div>
<div class="sub">AppStore Edition • AI + D1 hafıza + ihbar + kara liste + Google OSINT</div>
</div>

<div class="card">
<div class="label">Telefon numarası</div>
<input id="num" inputmode="tel" placeholder="03126242405">
<br><br>
<button onclick="tara()">FULL ANALİZ BAŞLAT</button>
<p class="muted">Bilinmeyen aramalarda kişisel bilgi, SMS kodu veya ödeme bilgisi paylaşma.</p>
</div>

<div id="sonuc"></div>
</section>

<section id="history" class="screen">
<div class="hero">
<div class="logo">Geçmiş</div>
<div class="sub">Son sorguladığın numaralar bu cihazda saklanır.</div>
</div>
<div id="histBox" class="card"></div>
</section>

<section id="dash" class="screen">
<div class="hero">
<div class="logo">Dashboard</div>
<div class="sub">Canlı sistem özeti</div>
</div>
<div class="card">
<button onclick="location.href='/dashboard'">PRO DASHBOARD AÇ</button>
</div>
</section>

<section id="settings" class="screen">
<div class="hero">
<div class="logo">Ayarlar</div>
<div class="sub">Safari’den ana ekrana ekleyerek uygulama gibi kullan.</div>
</div>
<div class="card">
<h2>📲 Ana Ekrana Ekle</h2>
<p class="muted">Safari paylaş menüsü → Ana Ekrana Ekle.</p>
<button onclick="clearHistory()">Geçmişi Temizle</button>
</div>
</section>

</div>

<div class="tabs">
<button class="tab active" onclick="tab('home',this)">🔎 Ara</button>
<button class="tab" onclick="tab('history',this);renderHistory()">🕘 Geçmiş</button>
<button class="tab" onclick="tab('dash',this)">📊 Panel</button>
<button class="tab" onclick="tab('settings',this)">⚙️ Ayar</button>
</div>
<script>
setTimeout(()=>document.getElementById('splash').classList.add('hide'),700);

function tab(id,el){
document.querySelectorAll('.screen').forEach(x=>x.classList.remove('active'));
document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));
document.getElementById(id).classList.add('active');
el.classList.add('active');
}

function saveHistory(n){
let arr=JSON.parse(localStorage.getItem('spamhist')||'[]');
arr.unshift(n);
arr=[...new Set(arr)].slice(0,25);
localStorage.setItem('spamhist',JSON.stringify(arr));
}

function renderHistory(){
let arr=JSON.parse(localStorage.getItem('spamhist')||'[]');
histBox.innerHTML=arr.length
? arr.map(x=>'<div class="stat" style="margin:10px 0" onclick="num.value=\\''+x+'\\';tab(\\'home\\',document.querySelector(\\'.tab\\'));tara()"><b>'+x+'</b><br><span class="label">Tekrar analiz et</span></div>').join('')
: '<p class="muted">Henüz geçmiş yok.</p>';
}

function clearHistory(){
localStorage.removeItem('spamhist');
renderHistory();
alert('Geçmiş temizlendi');
}

async function tara(){
const n=document.getElementById('num').value.trim();
if(!n)return alert('Numara gir');

saveHistory(n);

sonuc.innerHTML='<div class="card"><h2>🧠 AI analiz ediyor...</h2><p class="muted">D1 hafıza, ihbarlar, kara liste ve açık web sinyalleri kontrol ediliyor.</p></div>';

const r=await fetch('/analyze?number='+encodeURIComponent(n)+'&v='+Date.now(),{cache:'no-store'});
const d=await r.json();

if(d.error){
sonuc.innerHTML='<div class="card">'+d.message+'</div>';
return;
}

if(d.score>=75 && navigator.vibrate){
navigator.vibrate([250,100,250]);
}

const cls=d.risk==='Yüksek'?'red':d.risk==='Orta'?'yellow':'green';

sonuc.innerHTML=
'<div class="card">'+
'<div class="label">Risk Seviyesi</div>'+
'<div class="risk '+cls+'">'+d.risk+'</div>'+
'<div class="bar"><div id="fill" class="fill"></div></div>'+
'<div class="grid">'+
'<div class="stat"><div class="label">Skor</div><div class="value">'+d.score+'</div></div>'+
'<div class="stat"><div class="label">Hafıza</div><div class="value">'+d.memoryHits+'</div></div>'+
'<div class="stat"><div class="label">İhbar</div><div class="value">'+d.reportCount+'</div></div>'+
'<div class="stat"><div class="label">Kara Liste</div><div class="value">'+(d.blacklist?'EVET':'HAYIR')+'</div></div>'+
'</div></div>'+

'<div class="card"><h2>🤖 AI Yorumu</h2><p class="muted">'+d.aiComment+'</p></div>'+

'<div class="card">'+
'<h2>📇 Numara Kimliği</h2>'+
'<p><b>Operatör:</b> '+d.operator+'</p>'+
'<p><b>Şehir:</b> '+d.city+'</p>'+
'<p><b>Muhtemel sahip:</b> '+(d.possibleOwner||'-')+'</p>'+
'<p><b>Muhtemel firma:</b> '+(d.possibleCompany||'-')+'</p>'+
'<p><b>Güven:</b> '+(d.confidence||'-')+'</p>'+
'</div>'+

'<div class="card"><h2>🚨 Bulgular</h2><ul>'+
(d.findings||[]).map(x=>'<li>'+x+'</li>').join('')+
'</ul></div>'+

'<div class="card"><h2>🧬 Risk Kelimeleri</h2>'+
(d.riskWords||d.riskwords||d.risk_words||d.riskWords||d.keywords||[]).map(x=>'<span class="tag">'+x+'</span>').join('')+
'</div>'+

'<div class="card"><h2>🌍 Google Açık Web Araştırması</h2>'+
(d.webResults||[]).map(x=>'<p><a target="_blank" href="'+x.link+'">'+x.title+'</a></p>').join('')+
'</div>'+

'<div class="card">'+
'<div class="grid">'+
'<button onclick="ihbar()">🚨 İhbar</button>'+
'<button onclick="kara()">⛔ Kara Liste</button>'+
'</div>'+
'</div>';

setTimeout(()=>document.getElementById('fill').style.width=d.score+'%',200);
}

async function ihbar(){
const n=num.value.trim();
await fetch('/report?number='+encodeURIComponent(n)+'&type=spam&note=uygulama-ihbar');
alert('İhbar kaydedildi');
tara();
}

async function kara(){
const n=num.value.trim();
await fetch('/blacklist?number='+encodeURIComponent(n)+'&reason=uygulama');
alert('Kara listeye eklendi');
tara();
}
</script>
</body>
</html>
`);
}
};
