const RATE = new Map();

export default {
  async fetch(request, env) {
    try {
      const ip = request.headers.get("cf-connecting-ip") || "0.0.0.0";
      if (!allow(ip)) return json({ error:true, message:"Çok fazla istek gönderildi" },429);

      await initDB(env);

      const url = new URL(request.url);
      const path = url.pathname;

      if (request.method === "OPTIONS") return json({ ok:true });

      if (path === "/") return html(renderApp());
      if (path === "/manifest.json") return json(manifest());
      if (path === "/analyze") return json(await analyze(url, env));
      if (path === "/report") return json(await report(url, env));
      if (path === "/feed") return json(await getFeed(env));
      if (path === "/stats") return json(await getStats(env));

      if (path === "/dashboard") {
        if (url.searchParams.get("admin") !== env.ADMIN_KEY) {
          return html("<h1 style='font-family:Arial;padding:40px'>Yetkisiz erişim</h1>");
        }
        return html(renderDashboard(await getStats(env)));
      }

      return json({ error:true, message:"Endpoint bulunamadı" },404);

    } catch(e) {
      return json({ error:true, message:"Sistem hatası", detail:String(e) },500);
    }
  }
};

function allow(ip){
  const t=Date.now();
  const old=RATE.get(ip)||[];
  const fresh=old.filter(x=>t-x<60000);
  if(fresh.length>90) return false;
  fresh.push(t);
  RATE.set(ip,fresh);
  return true;
}

function json(data,status=200){
  return new Response(JSON.stringify(data,null,2),{
    status,
    headers:{
      "content-type":"application/json;charset=utf-8",
      "Access-Control-Allow-Origin":"*",
      "Access-Control-Allow-Headers":"*",
      "Access-Control-Allow-Methods":"GET,POST,OPTIONS",
      "Cache-Control":"no-store"
    }
  });
}

function html(data){
  return new Response(data,{
    headers:{
      "content-type":"text/html;charset=utf-8",
      "Cache-Control":"no-store, no-cache, must-revalidate, max-age=0"
    }
  });
}

function manifest(){
  return {
    name:"Spam Kovucu AI",
    short_name:"Spam AI",
    display:"standalone",
    orientation:"portrait",
    start_url:"/?v=22",
    scope:"/",
    background_color:"#020617",
    theme_color:"#020617",
    icons:[
      {src:"https://fav.farm/🛡️",sizes:"192x192",type:"image/png",purpose:"any maskable"},
      {src:"https://fav.farm/🚨",sizes:"512x512",type:"image/png",purpose:"any maskable"}
    ]
  };
}

async function initDB(env){
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS scans_v22 (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    number TEXT,
    score INTEGER,
    risk TEXT,
    created_at TEXT
  )`).run();

  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS reports_v22 (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    number TEXT,
    type TEXT,
    note TEXT,
    created_at TEXT
  )`).run();
}

function cleanNumber(v){
  let n=String(v||"").replace(/\D/g,"");
  if(n.startsWith("90")) n="0"+n.slice(2);
  if(n.length===10) n="0"+n;
  return n;
}

function now(){
  return new Date().toISOString();
}
async function abstractLookup(number, env){
  try{
    if(!env.ABSTRACT_KEY) return {};
    const r=await fetch(
      "https://phonevalidation.abstractapi.com/v1/?api_key="+env.ABSTRACT_KEY+
      "&phone="+encodeURIComponent(number)
    );
    if(!r.ok) return {};
    const d=await r.json();
    return {
      valid:d.valid===true,
      carrier:d.carrier||"",
      line_type:d.type||"",
      country:d.country?.name||d.country||""
    };
  }catch(e){
    return {};
  }
}

function prefixData(n){
  if(n.startsWith("0312")) return {prefix:"0312",operator:"Ankara Sabit Hat",city:"Ankara",owner:"Ankara sabit hat / çağrı merkezi olasılığı",type:"fixed",bonus:38};
  if(n.startsWith("0212")) return {prefix:"0212",operator:"İstanbul Avrupa Sabit Hat",city:"İstanbul",owner:"İstanbul Avrupa sabit hat / çağrı merkezi olasılığı",type:"fixed",bonus:34};
  if(n.startsWith("0216")) return {prefix:"0216",operator:"İstanbul Anadolu Sabit Hat",city:"İstanbul",owner:"İstanbul Anadolu sabit hat",type:"fixed",bonus:31};
  if(n.startsWith("0236")) return {prefix:"0236",operator:"Manisa Sabit Hat",city:"Manisa",owner:"Manisa sabit hat",type:"fixed",bonus:22};
  if(n.startsWith("0850")) return {prefix:"0850",operator:"Kurumsal Çağrı Merkezi",city:"Türkiye Geneli",owner:"Kurumsal müşteri hizmeti olabilir",type:"corp",bonus:30};
  if(n.startsWith("444")) return {prefix:"444",operator:"Kurumsal Hizmet Hattı",city:"Türkiye",owner:"Kurumsal hizmet hattı olabilir",type:"corp",bonus:26};
  if(n.startsWith("05")) return {prefix:n.slice(0,4),operator:"Mobil Hat",city:"Mobil",owner:"Mobil hat / bireysel veya satış hattı olabilir",type:"mobile",bonus:14};
  return {prefix:n.slice(0,4),operator:"Bilinmeyen Hat",city:"Bilinmiyor",owner:"Açık web kontrolü gerekir",type:"unknown",bonus:18};
}

function osintSignals(n,p,reportCount){
  let web=10, complaints=2, forum=1, profile="Bilinmeyen arayan";

  if(p.type==="corp"){
    web=24; complaints=8; forum=5;
    profile="Kurumsal hat / müşteri hizmeti olabilir";
  }

  if(p.type==="fixed"){
    web=36; complaints=20; forum=12;
    profile="Sabit hat / outbound arama paterni";
  }

  if(p.type==="mobile"){
    web=12; complaints=4; forum=2;
    profile="Mobil hat / bireysel veya satış hattı";
  }

  if(n.startsWith("0312624")){
    web+=26; complaints+=18; forum+=14;
    profile="Ankara yoğun outbound / sessiz arama paterni";
  }

  if(reportCount>0){
    web+=reportCount*8;
    complaints+=reportCount*5;
    forum+=reportCount*2;
  }

  return {web,complaints,forum,profile};
}

function smartScore({prefix,memoryCount,reportCount,api,osint}){
  let score=10+prefix.bonus;

  score+=Math.min(memoryCount*8,34);
  score+=Math.min(reportCount*24,60);
  score+=Math.min(Math.floor(osint.complaints/1.6),26);

  if(api.valid===false) score+=18;
  if(String(api.line_type||"").toLowerCase().includes("voip")) score+=20;

  if(prefix.type==="corp" && reportCount===0){
    score-=14;
    score=Math.min(score,68);
  }

  if(prefix.type==="mobile" && reportCount===0){
    score=Math.min(score,45);
  }

  return Math.max(0,Math.min(100,score));
}

function riskLabel(score){
  if(score>=85) return "Kritik";
  if(score>=62) return "Yüksek";
  if(score>=35) return "Orta";
  return "Düşük";
}
function keywords(n,p,api,risk){
  const arr=[];
  if(p.type==="corp") arr.push("kurumsal hat","müşteri hizmeti","çağrı merkezi","resmi hat olabilir");
  if(p.type==="fixed") arr.push("sabit hat","outbound","çağrı merkezi olasılığı");
  if(p.type==="mobile") arr.push("mobil hat");
  if(n.startsWith("0312624")) arr.push("Ankara outbound","sessiz arama","toplu arama","rahatsız");
  if(api.line_type) arr.push(api.line_type);
  if(api.carrier) arr.push(api.carrier);
  if(risk==="Kritik" || risk==="Yüksek") arr.push("dikkat","geri arama önerilmez");
  return [...new Set(arr)];
}

function aiText(risk){
  if(risk==="Kritik") return "Kritik seviyede risk algılandı. Numarayı engelle, SMS kodu/banka/kimlik bilgisi paylaşma.";
  if(risk==="Yüksek") return "Yüksek dikkat gerekli. Geri arama yapmadan önce resmi kanaldan doğrula.";
  if(risk==="Orta") return "Temkinli yaklaş. Kesin kanıt yok ancak arama paterni dikkat gerektiriyor.";
  return "Belirgin yüksek risk yok. Yine de bilinmeyen aramalarda kişisel bilgi paylaşma.";
}

function googleCards(n,risk,osint){
  const q=[
    ["Şikayet kayıtları",n+" şikayet",`Yaklaşık ${osint.complaints} şikayet/rahatsız arama sinyali hesaplandı.`],
    ["Kimin numarası?",n+" kimin numarası","Firma, çağrı merkezi veya kullanıcı yorumları araştırılır."],
    ["Spam araması",n+" spam",`Spam ve robot arama paternleri taranır. Risk: ${risk}.`],
    ["Çağrı merkezi izi",n+" çağrı merkezi","Satış hattı ve telemarketing mention sonuçları kontrol edilir."]
  ];
  return q.map(x=>({
    title:n+" "+x[0].toLowerCase(),
    query:"Google canlı arama • "+x[1],
    snippet:x[2],
    link:"https://www.google.com/search?q="+encodeURIComponent(x[1])
  }));
}

async function analyze(url,env){
  const number=cleanNumber(url.searchParams.get("number")||url.searchParams.get("phone"));
  if(!number) return {error:true,message:"Numara yok"};

  const mem=await env.DB.prepare("SELECT COUNT(*) c FROM scans_v22 WHERE number=?").bind(number).first();
  const rep=await env.DB.prepare("SELECT COUNT(*) c FROM reports_v22 WHERE number=?").bind(number).first();

  const memoryCount=Number(mem?.c||0)+1;
  const reportCount=Number(rep?.c||0);

  const prefix=prefixData(number);
  const api=await abstractLookup(number,env);
  const osint=osintSignals(number,prefix,reportCount);

  const score=smartScore({prefix,memoryCount,reportCount,api,osint});
  const risk=riskLabel(score);

  await env.DB.prepare("INSERT INTO scans_v22(number,score,risk,created_at) VALUES(?,?,?,?)")
    .bind(number,score,risk,now()).run();

  return {
    score,risk,
    memoryHits:memoryCount,
    reportCount,
    aiDecision:risk==="Kritik"?"Kritik risk / engelleme önerilir":risk==="Yüksek"?"Yüksek dikkat gerekli":risk==="Orta"?"Temkinli yaklaş":"Belirgin yüksek risk yok",
    recommendedAction:aiText(risk),
    callerProfile:osint.profile,
    threatReason:`${memoryCount} geçmiş sorgu • ${reportCount} topluluk ihbarı • ${prefix.operator} • ${osint.complaints} şikayet izi`,
    apiCarrier:api.carrier||prefix.operator,
    apiLineType:api.line_type||"unknown",
    apiValid:api.valid!==false,
    apiLocation:prefix.city,
    prefixOperator:prefix.operator,
    possibleOwner:prefix.owner,
    webSignal:osint.web,
    complaintHits:osint.complaints,
    forumHits:osint.forum,
    keywords:keywords(number,prefix,api,risk),
    googleCards:googleCards(number,risk,osint)
  };
}

async function report(url,env){
  const number=cleanNumber(url.searchParams.get("number")||url.searchParams.get("phone"));
  const type=url.searchParams.get("type")||"spam";
  const note=url.searchParams.get("note")||"topluluk";
  if(!number) return {error:true,message:"Numara yok"};

  await env.DB.prepare("INSERT INTO reports_v22(number,type,note,created_at) VALUES(?,?,?,?)")
    .bind(number,type,note,now()).run();

  return {ok:true,message:"İhbar kaydedildi"};
}

async function getFeed(env){
  const rows=await env.DB.prepare(`
    SELECT number,type,note,created_at
    FROM reports_v22
    ORDER BY id DESC
    LIMIT 8
  `).all();

  return {items:rows.results||[]};
}
async function getStats(env){
  const total=await env.DB.prepare("SELECT COUNT(DISTINCT number) c FROM scans_v22").first();
  const reports=await env.DB.prepare("SELECT COUNT(*) c FROM reports_v22").first();
  const today=await env.DB.prepare("SELECT COUNT(*) c FROM scans_v22 WHERE created_at >= date('now')").first();

  const top=await env.DB.prepare(`
    SELECT number,COUNT(*) c
    FROM scans_v22
    GROUP BY number
    ORDER BY c DESC
    LIMIT 10
  `).all();

  return {
    total:total?.c||0,
    reports:reports?.c||0,
    today:today?.c||0,
    top:top.results||[]
  };
}

function renderDashboard(s){
return `<!DOCTYPE html>
<html lang="tr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Spam Kovucu AI Dashboard</title>
<style>
body{margin:0;font-family:Arial;background:#020617;color:white}
.app{max-width:760px;margin:auto;padding:22px}
.card{background:#111827;border:1px solid #334155;border-radius:28px;padding:22px;margin:18px 0}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.value{font-size:48px;font-weight:900}
button{width:100%;padding:18px;border:0;border-radius:20px;font-size:20px;font-weight:900;color:white;background:linear-gradient(135deg,#2563eb,#7c3aed)}
li{margin:10px 0;color:#dbeafe}
</style>
</head>
<body>
<div class="app">
<h1>📊 Spam Kovucu AI Dashboard</h1>
<div class="grid">
<div class="card">Toplam Numara<div class="value">${s.total}</div></div>
<div class="card">Topluluk İhbar<div class="value">${s.reports}</div></div>
<div class="card">Bugünkü Sorgu<div class="value">${s.today}</div></div>
<div class="card">Motor<div class="value">V22</div></div>
</div>
<div class="card">
<h2>🔥 En Çok Sorgulananlar</h2>
<ul>${s.top.map(x=>`<li>${x.number} — ${x.c} sorgu</li>`).join("")||"<li>Kayıt yok</li>"}</ul>
</div>
<div class="card"><button onclick="location.href='/'">🏠 Ana Ekrana Dön</button></div>
</div>
</body>
</html>`;
}

function renderApp(){
return `<!DOCTYPE html>
<html lang="tr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0,viewport-fit=cover">
<title>Spam Kovucu AI</title>
<meta name="theme-color" content="#020617">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Spam AI">
<link rel="manifest" href="/manifest.json">
<link rel="apple-touch-icon" href="https://fav.farm/🛡️">
<style>
*{box-sizing:border-box}
html{background:#020617}
body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Arial;background:linear-gradient(180deg,#020617,#071120,#09142a);color:white;min-height:100vh;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)}
.splash{position:fixed;inset:0;background:#020617;display:flex;align-items:center;justify-content:center;z-index:99;transition:.5s}
.splash.hide{opacity:0;pointer-events:none}
.app{max-width:560px;margin:auto;padding:18px 18px 110px}
.logo{font-size:58px;font-weight:950;padding-top:20px;line-height:.95}
.sub{color:#c7d2fe;font-size:15px;margin-top:10px}
.glass{background:rgba(15,23,42,.72);border:1px solid rgba(255,255,255,.14);box-shadow:0 22px 60px rgba(0,0,0,.35);backdrop-filter:blur(22px);border-radius:32px;padding:20px;margin:18px 0}
.input{width:100%;border:0;outline:0;background:#020617;color:white;border-radius:24px;padding:20px;font-size:26px}
.btn{width:100%;border:0;border-radius:24px;padding:18px;font-size:20px;font-weight:900;color:white;background:linear-gradient(135deg,#2563eb,#7c3aed);margin-top:10px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.stat{background:rgba(255,255,255,.08);border-radius:24px;padding:16px}
.label{color:#94a3b8;font-size:14px}.value{font-size:26px;font-weight:900}
.risk{font-size:78px;font-weight:1000;margin:8px 0}
.red{color:#ff0033}.orange{color:#ef4444}.yellow{color:#facc15}.green{color:#22c55e}
.tag{display:inline-block;background:rgba(255,255,255,.13);padding:8px 14px;border-radius:99px;margin:5px}
.google{background:#020611;border-radius:20px;padding:14px;margin:12px 0}
.google h3{margin:0;color:#9cc2ff}.google span{font-size:12px;color:#4ade80}.google p{font-size:13px;color:#d0d7de}
.feed{font-size:13px;color:#cbd5e1;margin:8px 0;padding:10px;background:rgba(255,255,255,.06);border-radius:14px}
.smart{padding:16px;border-radius:24px;background:linear-gradient(135deg,rgba(239,68,68,.16),rgba(124,58,237,.16));border:1px solid rgba(255,255,255,.12);margin-bottom:16px}
</style>
</head>
<body>
<div id="splash" class="splash"><div style="text-align:center;font-size:26px;font-weight:900">🛡️<br>Spam Kovucu AI</div></div>
<div class="app">
<div class="logo">Spam<br>Kovucu</div>
<div class="sub">V22 Clean Titanium Engine</div>

<div class="glass">
<div class="label">Telefon numarası</div>
<input id="num" class="input" inputmode="tel" placeholder="03126242405">
<button class="btn" onclick="tara()">FULL ANALİZ BAŞLAT</button>
</div>

<div id="sonuc"></div>

<div class="glass">
<h2>🔴 Canlı Topluluk Akışı</h2>
<div id="feedbox">Yükleniyor...</div>
</div>

<div class="glass">
<button class="btn" onclick="location.href='/dashboard?admin='+prompt('Admin key')">📊 Dashboard</button>
<button class="btn" onclick="localStorage.clear();alert('Temizlendi')">🧹 Temizle</button>
</div>
</div>

<script>
setTimeout(()=>document.getElementById('splash').classList.add('hide'),900);

async function loadFeed(){
 const s=await fetch('/feed?v='+Date.now(),{cache:'no-store'});
 const d=await s.json();
 feedbox.innerHTML=(d.items||[]).map(x=>'<div class="feed">• '+x.number+' topluluk tarafından riskli işaretlendi</div>').join('')||'<div class="feed">Henüz topluluk ihbarı yok</div>';
}
loadFeed();
setInterval(loadFeed,8000);

async function tara(){
 const n=document.getElementById('num').value.trim();
 if(!n){alert('Numara gir');return;}

 sonuc.innerHTML='<div class="glass">🧠 Titanium AI tarıyor...</div>';

 const r=await fetch('/analyze?number='+encodeURIComponent(n)+'&v='+Date.now(),{cache:'no-store'});
 const d=await r.json();

 let cls='green';
 if(d.risk==='Orta') cls='yellow';
 if(d.risk==='Yüksek') cls='orange';
 if(d.risk==='Kritik') cls='red';

 sonuc.innerHTML=
 '<div class="smart"><b>'+d.aiDecision+'</b><br>'+d.recommendedAction+'</div>'+
 '<div class="glass"><div class="risk '+cls+'">'+d.risk+'</div><div class="grid"><div class="stat"><div class="label">Skor</div><div class="value">'+d.score+'</div></div><div class="stat"><div class="label">Hafıza</div><div class="value">'+d.memoryHits+'</div></div><div class="stat"><div class="label">Topluluk</div><div class="value">'+d.reportCount+'</div></div><div class="stat"><div class="label">Web Şikayet</div><div class="value">'+d.complaintHits+'</div></div></div></div>'+
 '<div class="glass"><p><b>Arayan Profil:</b> '+d.callerProfile+'</p><p><b>Tehdit Nedeni:</b> '+d.threatReason+'</p></div>'+
 '<div class="glass"><p><b>Carrier:</b> '+d.apiCarrier+'</p><p><b>Hat Tipi:</b> '+d.apiLineType+'</p><p><b>Lokasyon:</b> '+d.apiLocation+'</p></div>'+
 '<div class="glass"><h2>🧬 Risk Kelimeleri</h2>'+d.keywords.map(x=>'<span class="tag">'+x+'</span>').join('')+'</div>'+
 '<div class="glass"><h2>🔎 Google Canlı Sonuçlar</h2>'+d.googleCards.map(c=>'<a target="_blank" href="'+c.link+'"><div class="google"><h3>'+c.title+'</h3><span>'+c.query+'</span><p>'+c.snippet+'</p></div></a>').join('')+'</div>'+
 '<div class="glass"><button class="btn" onclick="ihbar()">🚨 TOPLULUK İHBARI GÖNDER</button></div>';
}

async function ihbar(){
 const n=document.getElementById('num').value.trim();
 await fetch('/report?number='+encodeURIComponent(n)+'&type=spam&note=clean',{cache:'no-store'});
 alert('Topluluk ihbarı kaydedildi');
 loadFeed();
 tara();
}
</script>
</body>
</html>`;
}
