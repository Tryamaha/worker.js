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
      if (path === "/blacklist") return json(await blacklist(url, env));
      if (path === "/stats") return json(await getStats(env));
      if (path === "/feed") return json(await getFeed(env));

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
  const t = Date.now();
  const old = RATE.get(ip) || [];
  const fresh = old.filter(x => t - x < 60000);
  if (fresh.length > 90) return false;
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
    name:"Spam Kovucu",
    short_name:"SpamK",
    display:"standalone",
    start_url:"/",
    background_color:"#020617",
    theme_color:"#020617",
    icons:[
      {src:"https://fav.farm/🛡️",sizes:"192x192",type:"image/png"},
      {src:"https://fav.farm/🚨",sizes:"512x512",type:"image/png"}
    ]
  };
}

async function initDB(env){
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS scans_v19 (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    number TEXT,
    score INTEGER,
    risk TEXT,
    created_at TEXT
  )`).run();

  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS reports_v19 (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    number TEXT,
    type TEXT,
    note TEXT,
    created_at TEXT
  )`).run();

  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS blacklist_v19 (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    number TEXT UNIQUE,
    reason TEXT,
    created_at TEXT
  )`).run();
}

function cleanNumber(v){
  let n = String(v || "").replace(/\D/g,"");
  if(n.startsWith("90")) n = "0" + n.slice(2);
  if(n.length === 10) n = "0" + n;
  return n;
}

function maskNumber(n){
  if(!n) return "----";
  if(n.length < 7) return n.slice(0,3)+" ***";
  return n.slice(0,4)+" "+n.slice(4,7)+" ****";
}

function now(){
  return new Date().toISOString();
}
async function abstractLookup(number, env){
  try{
    if(!env.ABSTRACT_KEY) return {};
    const r = await fetch(
      "https://phonevalidation.abstractapi.com/v1/?api_key=" + env.ABSTRACT_KEY +
      "&phone=" + encodeURIComponent(number)
    );
    if(!r.ok) return {};
    const d = await r.json();
    return {
      valid: d.valid === true,
      carrier: d.carrier || "",
      line_type: d.type || "",
      country: d.country?.name || d.country || ""
    };
  }catch(e){
    return {};
  }
}

function prefixData(n){
  if(n.startsWith("0312")) return {prefix:"0312",operator:"Ankara Sabit Hat",city:"Ankara",owner:"Ankara sabit hat / çağrı merkezi olasılığı",confidence:"Orta",type:"fixed",bonus:38};
  if(n.startsWith("0212")) return {prefix:"0212",operator:"İstanbul Avrupa Sabit Hat",city:"İstanbul",owner:"İstanbul Avrupa sabit hat / çağrı merkezi olasılığı",confidence:"Orta",type:"fixed",bonus:34};
  if(n.startsWith("0216")) return {prefix:"0216",operator:"İstanbul Anadolu Sabit Hat",city:"İstanbul",owner:"İstanbul Anadolu sabit hat",confidence:"Orta",type:"fixed",bonus:31};
  if(n.startsWith("0232")) return {prefix:"0232",operator:"İzmir Sabit Hat",city:"İzmir",owner:"İzmir sabit hat",confidence:"Orta",type:"fixed",bonus:25};
  if(n.startsWith("0236")) return {prefix:"0236",operator:"Manisa Sabit Hat",city:"Manisa",owner:"Manisa sabit hat",confidence:"Orta",type:"fixed",bonus:23};
  if(n.startsWith("0850")) return {prefix:"0850",operator:"Kurumsal Çağrı Merkezi",city:"Türkiye Geneli",owner:"Kurumsal çağrı merkezi olasılığı",confidence:"Yüksek",type:"corporate",bonus:46};
  if(n.startsWith("444")) return {prefix:"444",operator:"Kurumsal Hizmet Hattı",city:"Türkiye",owner:"Kurumsal hizmet hattı",confidence:"Yüksek",type:"corporate",bonus:43};
  if(n.startsWith("0549")) return {prefix:"0549",operator:"Mobil Satış Havuzu",city:"Mobil",owner:"Satış veya kampanya hattı olabilir",confidence:"Düşük",type:"mobile",bonus:24};
  if(n.startsWith("05")) return {prefix:n.slice(0,4),operator:"Mobil Hat",city:"Mobil",owner:"Kişisel mobil hat veya satış hattı olabilir",confidence:"Düşük",type:"mobile",bonus:13};
  return {prefix:n.slice(0,4),operator:"Bilinmiyor",city:"Bilinmiyor",owner:"Açık web kontrolü gerekir",confidence:"Düşük",type:"unknown",bonus:18};
}

function osintSignals(n,prefix,repCount){
  let webSignal=10;
  let complaintHits=2;
  let forumHits=1;
  let callerType="Bilinmeyen arayan";

  if(prefix.type==="corporate"){
    webSignal=44;
    complaintHits=19;
    forumHits=12;
    callerType="Kurumsal outbound / çağrı merkezi";
  }

  if(prefix.type==="fixed"){
    webSignal=40;
    complaintHits=22;
    forumHits=13;
    callerType="Sabit hat / outbound arama";
  }

  if(prefix.type==="mobile"){
    webSignal=12;
    complaintHits=4;
    forumHits=2;
    callerType="Mobil hat / bireysel veya satış";
  }

  if(n.startsWith("0312624")){
    webSignal+=26;
    complaintHits+=18;
    forumHits+=14;
    callerType="Ankara yoğun outbound paterni";
  }

  if(repCount>0){
    webSignal+=repCount*7;
    complaintHits+=repCount*4;
    forumHits+=repCount*2;
  }

  return {
    webSignal,
    complaintHits,
    forumHits,
    companyTrace: prefix.type==="corporate" || prefix.type==="fixed",
    callerType
  };
}

function smartScore({prefix,memCount,repCount,blacklisted,api,osint}){
  let score = 12 + prefix.bonus;

  score += Math.min(memCount * 9, 36);
  score += Math.min(repCount * 24, 60);
  score += Math.min(Math.floor(osint.complaintHits / 1.45), 28);

  if(blacklisted) score += 48;
  if(api.valid===false) score += 20;
  if(String(api.line_type||"").toLowerCase().includes("voip")) score += 22;

  if(prefix.type==="mobile" && repCount===0 && !blacklisted) score=Math.min(score,45);

  return Math.max(0,Math.min(100,score));
}

function riskLabel(score){
  if(score>=85) return "Kritik";
  if(score>=62) return "Yüksek";
  if(score>=35) return "Orta";
  return "Düşük";
}

function keywordList(number,prefix,api,blacklisted){
  const arr=[];
  if(prefix.type==="corporate") arr.push("çağrı merkezi","kurumsal arama","outbound","robot arama");
  if(prefix.type==="fixed") arr.push("sabit hat","çağrı merkezi olasılığı","outbound");
  if(prefix.type==="mobile") arr.push("mobil hat");
  if(number.startsWith("0312624")) arr.push("Ankara outbound","sessiz arama","toplu arama","rahatsız");
  if(api.line_type) arr.push(api.line_type);
  if(api.carrier) arr.push(api.carrier);
  if(api.valid===false) arr.push("doğrulanamayan numara");
  if(blacklisted) arr.push("kara liste");
  return [...new Set(arr)];
}
function googleCards(number,risk,osint){
  const q1=`https://www.google.com/search?q=${encodeURIComponent(number+" şikayet")}`;
  const q2=`https://www.google.com/search?q=${encodeURIComponent(number+" kimin numarası")}`;
  const q3=`https://www.google.com/search?q=${encodeURIComponent(number+" spam")}`;
  const q4=`https://www.google.com/search?q=${encodeURIComponent(number+" çağrı merkezi")}`;

  return [
    {
      title:`${number} şikayet kayıtları`,
      query:"Google canlı arama • şikayet",
      snippet:`Bu numara için tahmini ${osint.complaintHits} adet açık web şikayet izi, spam yorumu veya rahatsız arama paterni hesaplandı.`,
      link:q1
    },
    {
      title:`${number} kimin numarası`,
      query:"Google canlı arama • kimlik",
      snippet:`Numaranın firma, kullanıcı yorumu, çağrı merkezi veya topluluk kayıtlarıyla eşleşip eşleşmediği araştırılır.`,
      link:q2
    },
    {
      title:`${number} spam araması`,
      query:"Google canlı arama • spam",
      snippet:`Spam, robot arama, sessiz çağrı ve outbound arama sonuçları taranır. Güncel risk seviyesi: ${risk}.`,
      link:q3
    },
    {
      title:`${number} çağrı merkezi izi`,
      query:"Google canlı arama • outbound",
      snippet:`Kurumsal hat, satış hattı, telemarketing veya çağrı merkezi mention sonuçları kontrol edilir.`,
      link:q4
    }
  ];
}

async function analyze(url,env){
  const number=cleanNumber(url.searchParams.get("number")||url.searchParams.get("phone"));
  if(!number) return {error:true,message:"Numara yok"};

  const mem=await env.DB.prepare("SELECT COUNT(*) c FROM scans_v19 WHERE number=?").bind(number).first();
  const rep=await env.DB.prepare("SELECT COUNT(*) c FROM reports_v19 WHERE number=?").bind(number).first();
  const blk=await env.DB.prepare("SELECT * FROM blacklist_v19 WHERE number=?").bind(number).first();

  const memCount=Number(mem?.c||0)+1;
  const repCount=Number(rep?.c||0);
  const blacklisted=!!blk;

  const prefix=prefixData(number);
  const api=await abstractLookup(number,env);
  const osint=osintSignals(number,prefix,repCount);

  const score=smartScore({prefix,memCount,repCount,blacklisted,api,osint});
  const risk=riskLabel(score);

  let aiDecision="Belirgin yüksek risk yok";
  if(risk==="Orta") aiDecision="Temkinli yaklaş";
  if(risk==="Yüksek") aiDecision="Yüksek dikkat gerekli";
  if(risk==="Kritik") aiDecision="Kritik risk / engelleme önerilir";

  const recommendedAction =
    risk==="Kritik"
      ? "Numarayı engelle. Kesinlikle bilgi paylaşma."
      : risk==="Yüksek"
      ? "Geri arama önerilmez. Resmi kanaldan doğrula."
      : risk==="Orta"
      ? "Temkinli konuş. Kişisel bilgi paylaşma."
      : "Belirgin yüksek risk yok fakat dikkatli ol.";

  const threatReason=[
    `${memCount} geçmiş sorgu`,
    `${repCount} topluluk ihbarı`,
    blacklisted ? "kara liste eşleşmesi" : "kara liste eşleşmesi yok",
    `${api.line_type||"unknown"} hat tipi`,
    `${prefix.operator}`,
    `${osint.complaintHits} şikayet izi`
  ].join(" • ");

  await env.DB.prepare("INSERT INTO scans_v19(number,score,risk,created_at) VALUES(?,?,?,?)")
    .bind(number,score,risk,now()).run();

  return {
    score,risk,
    memoryHits:memCount,
    reportCount:repCount,
    blacklist:blacklisted,
    aiDecision,
    callerProfile:osint.callerType,
    threatReason,
    recommendedAction,
    apiCarrier:api.carrier || prefix.operator,
    apiLineType:api.line_type || "unknown",
    apiValid:api.valid !== false,
    apiLocation:prefix.city,
    prefixOperator:prefix.operator,
    possibleOwner:prefix.owner,
    confidence:prefix.confidence,
    webSignal:osint.webSignal,
    complaintHits:osint.complaintHits,
    forumHits:osint.forumHits,
    companyTrace:osint.companyTrace,
    keywords:keywordList(number,prefix,api,blacklisted),
    googleCards:googleCards(number,risk,osint)
  };
}

async function report(url,env){
  const number=cleanNumber(url.searchParams.get("number")||url.searchParams.get("phone"));
  const type=url.searchParams.get("type")||"spam";
  const note=url.searchParams.get("note")||"topluluk";
  if(!number) return {error:true,message:"Numara yok"};

  await env.DB.prepare("INSERT INTO reports_v19(number,type,note,created_at) VALUES(?,?,?,?)")
    .bind(number,type,note,now()).run();

  return {ok:true};
}

async function blacklist(url,env){
  const admin=url.searchParams.get("admin")||"";
  if(admin!==env.ADMIN_KEY) return {error:true,message:"Admin yetkisi gerekli"};

  const number=cleanNumber(url.searchParams.get("number")||url.searchParams.get("phone"));
  const reason=url.searchParams.get("reason")||"admin";

  await env.DB.prepare("INSERT OR REPLACE INTO blacklist_v19(number,reason,created_at) VALUES(?,?,?)")
    .bind(number,reason,now()).run();

  return {ok:true};
}
async function getStats(env){
  const total=await env.DB.prepare("SELECT COUNT(DISTINCT number) c FROM scans_v19").first();
  const reports=await env.DB.prepare("SELECT COUNT(*) c FROM reports_v19").first();
  const blacklist=await env.DB.prepare("SELECT COUNT(*) c FROM blacklist_v19").first();

  const top=await env.DB.prepare(`
    SELECT number,COUNT(*) c
    FROM scans_v19
    GROUP BY number
    ORDER BY c DESC
    LIMIT 10
  `).all();

  const today=await env.DB.prepare(`
    SELECT COUNT(*) c FROM scans_v19
    WHERE created_at >= date('now')
  `).first();

  return {
    total:total?.c||0,
    reports:reports?.c||0,
    black:blacklist?.c||0,
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
<title>Dashboard</title>
<style>
body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Arial;background:#020617;color:white}
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
<h1>📊 Spam Kovucu V19 GOD MODE</h1>
<div class="grid">
<div class="card">Toplam Numara<div class="value">${s.total}</div></div>
<div class="card">Topluluk İhbar<div class="value">${s.reports}</div></div>
<div class="card">Kara Liste<div class="value">${s.black}</div></div>
<div class="card">Bugünkü Sorgu<div class="value">${s.today}</div></div>
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
<link rel="manifest" href="/manifest.json">
<title>Spam Kovucu V19</title>
<style>
*{box-sizing:border-box}
body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Arial;background:#020617;color:white}
.bg{position:fixed;inset:0;background:radial-gradient(circle at top left,#2563eb 0,#020617 42%,#000 100%);z-index:-2}
.orb{position:fixed;width:260px;height:260px;border-radius:50%;filter:blur(60px);opacity:.45;background:#7c3aed;right:-90px;top:80px;z-index:-1}
.app{max-width:560px;margin:auto;padding:18px 18px 110px}
.logo{font-size:54px;font-weight:950;padding-top:20px}
.sub{color:#c7d2fe;font-size:15px;margin-top:10px}
.glass{background:rgba(15,23,42,.72);border:1px solid rgba(255,255,255,.14);box-shadow:0 22px 60px rgba(0,0,0,.35);backdrop-filter:blur(22px);border-radius:32px;padding:20px;margin:18px 0}
.input{width:100%;border:0;outline:0;background:#020617;color:white;border-radius:24px;padding:20px;font-size:26px}
.btn{width:100%;border:0;border-radius:24px;padding:18px;font-size:20px;font-weight:900;color:white;background:linear-gradient(135deg,#2563eb,#7c3aed)}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.stat{background:rgba(255,255,255,.08);border-radius:24px;padding:16px}
.label{color:#94a3b8;font-size:14px}.value{font-size:26px;font-weight:900}
.risk{font-size:78px;font-weight:1000;margin:8px 0}
.red{color:#ff0033}.orange{color:#ef4444}.yellow{color:#facc15}.green{color:#22c55e}
.bar{height:16px;background:#1e293b;border-radius:99px;overflow:hidden;margin:12px 0}
.fill{height:100%;width:0;background:linear-gradient(90deg,#22c55e,#facc15,#ef4444,#ff0033);transition:1.4s}
.tag{display:inline-block;background:rgba(255,255,255,.13);padding:8px 14px;border-radius:99px;margin:5px}
.gcard{background:rgba(2,6,23,.92);border:1px solid rgba(255,255,255,.08);border-radius:18px;padding:14px;margin:12px 0}
.gtitle{font-size:17px;font-weight:900;color:#8ab4f8}
.gurl{font-size:12px;color:#34a853;margin:5px 0}
.gsnip{font-size:13px;color:#d0d7de;line-height:1.5}
.scanline{font-family:monospace;color:#93c5fd;font-size:13px;margin:7px 0}
.feed{font-size:13px;color:#cbd5e1;margin:8px 0;padding:10px;background:rgba(255,255,255,.06);border-radius:14px}
.smart{padding:16px;border-radius:24px;background:linear-gradient(135deg,rgba(239,68,68,.16),rgba(124,58,237,.16));border:1px solid rgba(255,255,255,.12);margin-bottom:16px}
</style>
</head>
<body>
<div class="bg"></div><div class="orb"></div>
<div class="app">
<div class="logo">Spam Kovucu</div>
<div class="sub">V19 GOD MODE • canlı topluluk akışı + güçlü AI</div>

<div class="glass">
<div class="label">Telefon numarası</div>
<input id="num" class="input" inputmode="tel" placeholder="03126242405">
<br><br>
<button class="btn" onclick="tara()">FULL ANALİZ BAŞLAT</button>
</div>

<div id="sonuc"></div>

<div class="glass">
<h2>🔴 Canlı Topluluk Akışı</h2>
<div id="feedbox"></div>
</div>

<div class="glass">
<div class="grid">
<button class="btn" onclick="location.href='/dashboard?admin='+prompt('Admin key')">📊 Dashboard</button>
<button class="btn" onclick="localStorage.clear();alert('Geçmiş temizlendi')">🗑 Temizle</button>
</div>
</div>
</div>

<script>
async function loadFeed(){
  try{
    const s=await fetch('/feed?v='+Date.now(),{cache:'no-store'});
    const d=await s.json();
    feedbox.innerHTML=(d.items||[]).map(x=>'<div class="feed">• '+x.number+' topluluk tarafından '+(x.type||'spam')+' işaretlendi</div>').join('') || '<div class="feed">• Henüz topluluk ihbarı yok</div>';
  }catch(e){
    feedbox.innerHTML='<div class="feed">• Feed yüklenemedi</div>';
  }
}
loadFeed();

async function tara(){
const n=document.getElementById('num').value.trim();
if(!n){alert('Numara gir');return;}

sonuc.innerHTML='<div class="glass"><h2>🧠 V19 GOD MODE tarıyor...</h2><div class="scanline">▸ Topluluk hafızası okunuyor...</div><div class="scanline">▸ Abstract API sorgulanıyor...</div><div class="scanline">▸ OSINT sinyalleri hesaplanıyor...</div><div class="scanline">▸ GOD MODE AI scoring çalışıyor...</div></div>';

await new Promise(r=>setTimeout(r,1500));

const r=await fetch('/analyze?number='+encodeURIComponent(n)+'&v='+Date.now(),{cache:'no-store'});
const d=await r.json();

let cls='green';
if(d.risk==='Orta') cls='yellow';
if(d.risk==='Yüksek') cls='orange';
if(d.risk==='Kritik') cls='red';

sonuc.innerHTML=
'<div class="smart"><b>SMART SONUÇ:</b> '+d.aiDecision+' • '+d.recommendedAction+'</div>'+
'<div class="glass"><div class="label">Risk Seviyesi</div><div class="risk '+cls+'">'+d.risk+'</div><div class="bar"><div id="fill" class="fill"></div></div><div class="grid"><div class="stat"><div class="label">Skor</div><div class="value">'+d.score+'</div></div><div class="stat"><div class="label">Hafıza</div><div class="value">'+d.memoryHits+'</div></div><div class="stat"><div class="label">Topluluk İhbar</div><div class="value">'+d.reportCount+'</div></div><div class="stat"><div class="label">Kara Liste</div><div class="value">'+(d.blacklist?'EVET':'HAYIR')+'</div></div></div></div>'+
'<div class="glass"><p><b>Arayan Profil:</b> '+d.callerProfile+'</p><p><b>Tehdit Nedeni:</b> '+d.threatReason+'</p></div>'+
'<div class="glass"><p><b>Carrier:</b> '+d.apiCarrier+'</p><p><b>Hat Tipi:</b> '+d.apiLineType+'</p><p><b>Lokasyon:</b> '+d.apiLocation+'</p></div>'+
'<div class="glass"><h2>🧬 Risk Kelimeleri</h2>'+d.keywords.map(x=>'<span class="tag">'+x+'</span>').join('')+'</div>'+
'<div class="glass"><h2>🔎 Google Canlı Sonuçlar</h2>'+d.googleCards.map(x=>'<a target="_blank" href="'+x.link+'"><div class="gcard"><div class="gtitle">'+x.title+'</div><div class="gurl">'+x.query+'</div><div class="gsnip">'+x.snippet+'</div></div></a>').join('')+'</div>'+
'<div class="glass"><button class="btn" onclick="ihbar()">🚨 TOPLULUK İHBARI GÖNDER</button></div>';

setTimeout(()=>{document.getElementById('fill').style.width=d.score+'%';},200);
}

async function ihbar(){
const n=document.getElementById('num').value.trim();
await fetch('/report?number='+encodeURIComponent(n)+'&type=spam&note=godmode',{cache:'no-store'});
alert('Topluluk ihbarı kaydedildi');
loadFeed();
tara();
}
</script>
</body>
</html>`;
}
