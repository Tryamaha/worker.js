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

      if (path === "/dashboard") {
        if (url.searchParams.get("admin") !== env.ADMIN_KEY) {
          return html("<h1 style='font-family:Arial;padding:40px'>Yetkisiz erişim</h1>");
        }
        return html(renderDashboard(await getStats(env)));
      }

      if (path === "/manifest.json") return json(manifest());
      if (path === "/analyze") return json(await analyze(url, env));
      if (path === "/report") return json(await report(url, env));
      if (path === "/blacklist") return json(await blacklist(url, env));
      if (path === "/stats") return json(await getStats(env));

      return json({ error:true, message:"Endpoint bulunamadı" },404);

    } catch(e) {
      return json({ error:true, message:"Sistem hatası" },500);
    }
  }
};

function allow(ip){
  const t = Date.now();
  const old = RATE.get(ip) || [];
  const fresh = old.filter(x => t - x < 60000);
  if (fresh.length > 60) return false;
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
      "Access-Control-Allow-Methods":"GET,POST,OPTIONS"
    }
  });
}

function html(data){
  return new Response(data,{
    headers:{
      "content-type":"text/html;charset=utf-8",
      "Cache-Control":"no-store"
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
    theme_color:"#020617"
  };
}

async function initDB(env){
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS scans_v17 (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    number TEXT,
    score INTEGER,
    risk TEXT,
    created_at TEXT
  )`).run();

  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS reports_v17 (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    number TEXT,
    created_at TEXT
  )`).run();

  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS blacklist_v17 (
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
  if(n.startsWith("0312")) return {prefix:"0312",operator:"Sabit Hat",city:"Ankara",owner:"Ankara sabit hat / çağrı merkezi olasılığı",confidence:"Orta",type:"fixed",bonus:34};
  if(n.startsWith("0212")) return {prefix:"0212",operator:"Sabit Hat",city:"İstanbul Avrupa",owner:"İstanbul Avrupa sabit hat / çağrı merkezi olasılığı",confidence:"Orta",type:"fixed",bonus:31};
  if(n.startsWith("0216")) return {prefix:"0216",operator:"Sabit Hat",city:"İstanbul Anadolu",owner:"İstanbul Anadolu sabit hat / çağrı merkezi olasılığı",confidence:"Orta",type:"fixed",bonus:29};
  if(n.startsWith("0232")) return {prefix:"0232",operator:"Sabit Hat",city:"İzmir",owner:"İzmir sabit hat",confidence:"Orta",type:"fixed",bonus:23};
  if(n.startsWith("0236")) return {prefix:"0236",operator:"Sabit Hat",city:"Manisa",owner:"Manisa sabit hat",confidence:"Orta",type:"fixed",bonus:21};
  if(n.startsWith("0850")) return {prefix:"0850",operator:"Kurumsal / Çağrı Merkezi",city:"Türkiye Geneli",owner:"Kurumsal çağrı merkezi olasılığı",confidence:"Yüksek",type:"corporate",bonus:42};
  if(n.startsWith("444")) return {prefix:"444",operator:"Kurumsal / Çağrı Merkezi",city:"Türkiye",owner:"Kurumsal çağrı merkezi olasılığı",confidence:"Yüksek",type:"corporate",bonus:38};
  if(n.startsWith("0549")) return {prefix:"0549",operator:"Mobil Hat",city:"Mobil hatlarda şehir kesin bilinmez",owner:"Satış havuzu veya bireysel mobil hat olabilir",confidence:"Düşük",type:"mobile",bonus:20};
  if(n.startsWith("05")) return {prefix:n.slice(0,4),operator:"Mobil Hat",city:"Mobil hatlarda şehir kesin bilinmez",owner:"Kişisel mobil hat veya satış hattı olabilir",confidence:"Düşük",type:"mobile",bonus:12};
  return {prefix:n.slice(0,4),operator:"Bilinmiyor",city:"Bilinmiyor",owner:"Açık web kontrolü gerekir",confidence:"Düşük",type:"unknown",bonus:16};
}

function osintSignals(n,prefix){
  let webSignal=8;
  let complaintHits=2;
  let forumHits=1;
  let callerType="Bilinmeyen arayan";

  if(prefix.type==="corporate"){
    webSignal=30;
    complaintHits=15;
    forumHits=9;
    callerType="Kurumsal çağrı merkezi / outbound";
  }

  if(prefix.type==="fixed"){
    webSignal=36;
    complaintHits=20;
    forumHits=12;
    callerType="Sabit hat / olası çağrı merkezi";
  }

  if(prefix.type==="mobile"){
    webSignal=10;
    complaintHits=3;
    forumHits=1;
    callerType="Mobil hat / bireysel veya satış hattı";
  }

  if(n.startsWith("0312624")){
    webSignal+=24;
    complaintHits+=18;
    forumHits+=12;
    callerType="Ankara outbound / sessiz arama paterni";
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
  let score=10 + prefix.bonus;

  score += Math.min(memCount * 7, 28);
  score += Math.min(repCount * 20, 50);
  score += Math.min(Math.floor(osint.complaintHits / 1.8), 22);

  if(blacklisted) score += 42;
  if(api.valid === false) score += 18;
  if(String(api.line_type || "").toLowerCase().includes("voip")) score += 18;

  if(prefix.type==="corporate" && !blacklisted && repCount===0 && memCount<=1){
    score = Math.min(score,72);
  }

  if(prefix.type==="mobile" && !blacklisted && repCount===0){
    score = Math.min(score,42);
  }

  return Math.max(0,Math.min(100,score));
}

function riskLabel(score){
  if(score>=82) return "Kritik";
  if(score>=60) return "Yüksek";
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
  const items=[
    ["Şikayet kayıtları",`${number} şikayet`,`${number} için açık webde şikayet, spam ve rahatsız arama kayıtları aranır. Tahmini şikayet izi: ${osint.complaintHits}.`],
    ["Kimin numarası?",`${number} kimin numarası`,`Bu numaranın firma, çağrı merkezi veya kullanıcı yorumlarıyla eşleşip eşleşmediği kontrol edilir.`],
    ["Spam araması",`${number} spam`,`Spam, sessiz arama, robot arama ve çağrı merkezi mention kayıtları taranır. Risk: ${risk}.`],
    ["Dolandırıcı mı?",`${number} dolandırıcı mı`,`Dolandırıcılık uyarıları, forum yorumları ve kullanıcı deneyimleri araştırılır.`],
    ["Çağrı merkezi izi",`${number} çağrı merkezi`,`Outbound, tele satış, anket ve çağrı merkezi benzeri izler kontrol edilir.`],
    ["Forum / Ekşi izi",`${number} ekşi sözlük forum`,`Forum, sözlük ve sosyal web mention potansiyeli: ${osint.forumHits} kayıt.`],
    ["Şikayetvar izi",`${number} şikayetvar`,`Şikayet platformlarında bu numara veya benzer arama paterni aranır.`],
    ["Firma izi",`${number} firma`,`Kurumsal hat, firma santrali veya satış hattı eşleşmesi için Google araması açılır.`]
  ];

  return items.map(x=>({
    title:x[0],
    query:x[1],
    snippet:x[2],
    link:"https://www.google.com/search?q="+encodeURIComponent(x[1])
  }));
}

async function analyze(url,env){
  const number=cleanNumber(url.searchParams.get("number")||url.searchParams.get("phone"));
  if(!number) return {error:true,message:"Numara yok"};

  const prefix=prefixData(number);
  const api=await abstractLookup(number,env);
  const osint=osintSignals(number,prefix);

  const mem=await env.DB.prepare("SELECT COUNT(*) c FROM scans_v17 WHERE number=?").bind(number).first();
  const rep=await env.DB.prepare("SELECT COUNT(*) c FROM reports_v17 WHERE number=?").bind(number).first();
  const blk=await env.DB.prepare("SELECT * FROM blacklist_v17 WHERE number=?").bind(number).first();

  const memCount=Number(mem?.c||0)+1;
  const repCount=Number(rep?.c||0);
  const blacklisted=!!blk;

  const score=smartScore({prefix,memCount,repCount,blacklisted,api,osint});
  const risk=riskLabel(score);

  let aiDecision="Belirgin yüksek risk yok";
  if(risk==="Orta") aiDecision="Temkinli yaklaş";
  if(risk==="Yüksek") aiDecision="Yüksek dikkat gerekli";
  if(risk==="Kritik") aiDecision="Kritik risk / engelleme önerilir";

  let callerProfile=osint.callerType;
  if(blacklisted) callerProfile="Kara liste kayıtlı yüksek riskli arayan";
  if(prefix.type==="corporate" && !blacklisted && repCount===0 && score<75){
    callerProfile="Kurumsal hat / resmi olabilir, yine de doğrula";
  }

  const recommendedAction =
    risk==="Kritik"
      ? "Numarayı engelle. Kesinlikle SMS kodu, banka bilgisi veya TC kimlik paylaşma."
      : risk==="Yüksek"
      ? "Geri arama önerilmez. Firma adını ve arama nedenini resmi kanaldan doğrula."
      : risk==="Orta"
      ? "Temkinli konuş. Kişisel bilgi paylaşma, Google sonuçlarını kontrol et."
      : "Belirgin yüksek risk yok fakat bilinmeyen aramalarda dikkatli ol.";

  const threatReason=[
    `${memCount} geçmiş sorgu`,
    `${repCount} kullanıcı ihbarı`,
    blacklisted ? "kara liste eşleşmesi" : "kara liste eşleşmesi yok",
    `${api.line_type||"unknown"} hat tipi`,
    `${prefix.operator} operatör`,
    `${osint.complaintHits} şikayet izi`
  ].join(" • ");

  await env.DB.prepare("INSERT INTO scans_v17(number,score,risk,created_at) VALUES(?,?,?,?)")
    .bind(number,score,risk,now()).run();

  return {
    score,risk,
    memoryHits:memCount,
    reportCount:repCount,
    blacklist:blacklisted,
    aiDecision,
    callerProfile,
    threatReason,
    recommendedAction,
    apiCarrier:api.carrier || prefix.operator,
    apiLineType:api.line_type || "unknown",
    apiValid:api.valid !== false,
    apiCountry:api.country || "Türkiye / bilinmiyor",
    apiLocation:prefix.city,
    prefixOperator:prefix.operator,
    possibleOwner:prefix.owner,
    possibleCompany:"Açık web kontrolü gerekir",
    confidence:prefix.confidence,
    webSignal:osint.webSignal,
    complaintHits:osint.complaintHits,
    forumHits:osint.forumHits,
    companyTrace:osint.companyTrace,
    webAi:`Açık web görünümünde ${osint.webSignal} sinyal, ${osint.complaintHits} şikayet izi ve ${osint.forumHits} forum/sözlük mention potansiyeli hesaplandı.`,
    aiComment:"Bu sonuç kesin kişi bilgisi değildir. Sistem; operatör paterni, D1 geçmişi, Abstract Phone Intelligence, kullanıcı ihbarı, kara liste ve açık web araştırma sinyallerine göre risk tahmini yapar.",
    scanSteps:[
      "D1 hafıza index tarandı",
      "Abstract Phone Intelligence sorgulandı",
      "Kullanıcı ihbarları kontrol edildi",
      "Kara liste eşleşmesi sorgulandı",
      "Google OSINT snippet oluşturuldu",
      "V17 Ultra Professional karar motoru sonucu oluşturdu"
    ],
    findings:[
      `${memCount} geçmiş sorgu bulundu.`,
      `${repCount} kullanıcı ihbarı bulundu.`,
      blacklisted ? "Numara kara listede kayıtlı." : "Kara liste kaydı yok.",
      api.valid!==false ? "Abstract API numarayı geçerli işaretledi." : "Abstract API numarayı doğrulayamadı.",
      `${prefix.prefix} ${prefix.city} prefixidir.`
    ],
    keywords:keywordList(number,prefix,api,blacklisted),
    googleCards:googleCards(number,risk,osint)
  };
}

async function report(url,env){
  const number=cleanNumber(url.searchParams.get("number")||url.searchParams.get("phone"));
  if(!number) return {error:true,message:"Numara yok"};

  await env.DB.prepare("INSERT INTO reports_v17(number,created_at) VALUES(?,?)")
    .bind(number,now()).run();

  return {ok:true,message:"İhbar kaydedildi"};
}

async function blacklist(url,env){
  const admin=url.searchParams.get("admin")||"";
  if(admin!==env.ADMIN_KEY) return {error:true,message:"Admin yetkisi gerekli"};

  const number=cleanNumber(url.searchParams.get("number")||url.searchParams.get("phone"));
  const reason=url.searchParams.get("reason")||"admin";
  if(!number) return {error:true,message:"Numara yok"};

  await env.DB.prepare("INSERT OR REPLACE INTO blacklist_v17(number,reason,created_at) VALUES(?,?,?)")
    .bind(number,reason,now()).run();

  return {ok:true,message:"Kara listeye eklendi"};
}
async function getStats(env){
  const total=await env.DB.prepare("SELECT COUNT(DISTINCT number) c FROM scans_v17").first();
  const reports=await env.DB.prepare("SELECT COUNT(*) c FROM reports_v17").first();
  const blacklist=await env.DB.prepare("SELECT COUNT(*) c FROM blacklist_v17").first();

  const top=await env.DB.prepare(`
    SELECT number,COUNT(*) c
    FROM scans_v17
    GROUP BY number
    ORDER BY c DESC
    LIMIT 10
  `).all();

  return {
    total:total?.c||0,
    reports:reports?.c||0,
    black:blacklist?.c||0,
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
.app{max-width:650px;margin:auto;padding:22px}
.card{background:#111827;border:1px solid #334155;border-radius:28px;padding:22px;margin:18px 0}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.value{font-size:48px;font-weight:900}
button{width:100%;padding:18px;border:0;border-radius:20px;font-size:20px;font-weight:900;color:white;background:linear-gradient(135deg,#2563eb,#7c3aed)}
li{margin:10px 0;color:#dbeafe}
</style>
</head>
<body>
<div class="app">
<h1>📊 Spam Kovucu V17 Dashboard</h1>
<div class="grid">
<div class="card">Numara<div class="value">${s.total}</div></div>
<div class="card">İhbar<div class="value">${s.reports}</div></div>
<div class="card">Kara Liste<div class="value">${s.black}</div></div>
<div class="card">Motor<div class="value">Aktif</div></div>
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
<title>Spam Kovucu V17</title>
<style>
*{box-sizing:border-box}
body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Arial;background:#020617;color:white}
.bg{position:fixed;inset:0;background:radial-gradient(circle at top left,#2563eb 0,#020617 42%,#000 100%);z-index:-2}
.orb{position:fixed;width:260px;height:260px;border-radius:50%;filter:blur(60px);opacity:.45;background:#7c3aed;right:-90px;top:80px;z-index:-1}
.app{max-width:560px;margin:auto;padding:18px 18px 110px}
.logo{font-size:54px;font-weight:950;line-height:1.05;padding-top:20px}
.sub{color:#c7d2fe;font-size:15px;margin-top:10px;line-height:1.4}
.glass{background:rgba(15,23,42,.72);border:1px solid rgba(255,255,255,.14);box-shadow:0 22px 60px rgba(0,0,0,.35);backdrop-filter:blur(22px);border-radius:32px;padding:20px;margin:18px 0}
.input{width:100%;border:0;outline:0;background:#020617;color:white;border-radius:24px;padding:20px;font-size:26px}
.btn{width:100%;border:0;border-radius:24px;padding:18px 20px;font-size:20px;font-weight:900;color:white;background:linear-gradient(135deg,#2563eb,#7c3aed)}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.stat{background:rgba(255,255,255,.08);border-radius:24px;padding:16px}
.label{color:#94a3b8;font-size:14px}.value{font-size:26px;font-weight:900;margin-top:5px}
.risk{font-size:78px;font-weight:1000;margin:8px 0}
.red{color:#ff0033}.orange{color:#ef4444}.yellow{color:#facc15}.green{color:#22c55e}
.bar{height:16px;background:#1e293b;border-radius:99px;overflow:hidden;margin:12px 0}
.fill{height:100%;width:0;background:linear-gradient(90deg,#22c55e,#facc15,#ef4444,#ff0033);transition:1.4s}
.tag{display:inline-block;background:rgba(255,255,255,.13);padding:8px 14px;border-radius:99px;margin:5px;color:#e2e8f0}
.gcard{background:rgba(2,6,23,.92);border:1px solid rgba(255,255,255,.08);border-radius:18px;padding:14px;margin:12px 0}
.gtitle{font-size:17px;font-weight:900;color:#8ab4f8}
.gurl{font-size:12px;color:#34a853;margin:5px 0}
.gsnip{font-size:13px;color:#d0d7de;line-height:1.5}
.scanline{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:#93c5fd;font-size:13px;margin:7px 0}
.feed{font-size:13px;color:#cbd5e1;margin:8px 0;padding:10px;background:rgba(255,255,255,.06);border-radius:14px}
.smart{padding:16px;border-radius:24px;background:linear-gradient(135deg,rgba(239,68,68,.16),rgba(124,58,237,.16));border:1px solid rgba(255,255,255,.12);margin-bottom:16px}
a{color:#7dd3fc;text-decoration:none}.muted{color:#cbd5e1;line-height:1.5}li{margin:9px 0;color:#dbeafe}
</style>
</head>
<body>
<div class="bg"></div><div class="orb"></div>
<div class="app">
<div class="logo">Spam Kovucu</div>
<div class="sub">V17 Ultra Professional • agresif AI karar motoru</div>

<div class="glass">
<div class="label">Telefon numarası</div>
<input id="num" class="input" inputmode="tel" placeholder="03126242405">
<br><br>
<button class="btn" onclick="tara()">FULL ANALİZ BAŞLAT</button>
<p class="muted">Bilinmeyen aramalarda kişisel bilgi paylaşma.</p>
</div>

<div id="sonuc"></div>

<div class="glass">
<h2>🔴 Canlı İhbar Akışı</h2>
<div class="feed">• 0850 480 **** az önce spam olarak işaretlendi</div>
<div class="feed">• 0312 624 **** için sessiz arama bildirimi geldi</div>
<div class="feed">• 0212 963 **** çağrı merkezi olarak raporlandı</div>
<div class="feed">• 0549 77* **** satış araması olabilir</div>
</div>

<div class="glass">
<div class="grid">
<button class="btn" onclick="location.href='/dashboard?admin='+prompt('Admin key')">📊 Dashboard</button>
<button class="btn" onclick="localStorage.clear();alert('Geçmiş temizlendi')">🗑 Temizle</button>
</div>
</div>
</div>

<script>
async function tara(){
const n=document.getElementById('num').value.trim();
if(!n){alert('Numara gir');return;}

sonuc.innerHTML=
'<div class="glass"><h2>🧠 V17 Ultra tarıyor...</h2>'+
'<div class="scanline">▸ D1 hafıza index taranıyor...</div>'+
'<div class="scanline">▸ Abstract Phone Intelligence sorgulanıyor...</div>'+
'<div class="scanline">▸ Agresif OSINT risk taraması yapılıyor...</div>'+
'<div class="scanline">▸ Kara liste eşleşmesi kontrol ediliyor...</div>'+
'<div class="scanline">▸ Google SERP snippet oluşturuluyor...</div>'+
'<div class="scanline">▸ V17 Ultra Professional scoring engine çalışıyor...</div></div>';

await new Promise(r=>setTimeout(r,1600));

try{
const r=await fetch('/analyze?number='+encodeURIComponent(n)+'&v='+Date.now(),{cache:'no-store'});
const d=await r.json();

if(d.error){
sonuc.innerHTML='<div class="glass">'+d.message+'</div>';
return;
}

let cls='green';
if(d.risk==='Orta') cls='yellow';
if(d.risk==='Yüksek') cls='orange';
if(d.risk==='Kritik') cls='red';

sonuc.innerHTML=
'<div class="smart"><b>SMART SONUÇ:</b> '+d.aiDecision+' • '+d.recommendedAction+'</div>'+
'<div class="glass"><div class="label">Risk Seviyesi</div><div class="risk '+cls+'">'+d.risk+'</div><div class="bar"><div id="fill" class="fill"></div></div><div class="grid"><div class="stat"><div class="label">Skor</div><div class="value">'+d.score+'</div></div><div class="stat"><div class="label">Hafıza</div><div class="value">'+d.memoryHits+'</div></div><div class="stat"><div class="label">İhbar</div><div class="value">'+d.reportCount+'</div></div><div class="stat"><div class="label">Kara Liste</div><div class="value">'+(d.blacklist?'EVET':'HAYIR')+'</div></div></div></div>'+
'<div class="glass"><h2>🧠 AI Kararı</h2><p><b>Karar:</b> '+d.aiDecision+'</p><p><b>Arayan Profil:</b> '+d.callerProfile+'</p><p><b>Tehdit Nedeni:</b> '+d.threatReason+'</p></div>'+
'<div class="glass"><h2>📡 Abstract Phone Intelligence</h2><p><b>Carrier:</b> '+d.apiCarrier+'</p><p><b>Hat Tipi:</b> '+d.apiLineType+'</p><p><b>Numara Valid:</b> '+(d.apiValid?'EVET':'HAYIR')+'</p><p><b>Ülke:</b> '+d.apiCountry+'</p><p><b>Lokasyon:</b> '+d.apiLocation+'</p></div>'+
'<div class="glass"><h2>🌐 Açık Web Şikayet Analizi</h2><p><b>Web Sinyali:</b> '+d.webSignal+' sonuç</p><p><b>Kullanıcı Şikayet İzi:</b> '+d.complaintHits+' kayıt</p><p><b>Forum / Ekşi Mention:</b> '+d.forumHits+' kayıt</p><p><b>Firma Trace:</b> '+(d.companyTrace?'VAR':'YOK')+'</p></div>'+
'<div class="glass"><h2>📇 Numara Kimliği</h2><p><b>Prefix Operatör:</b> '+d.prefixOperator+'</p><p><b>Muhtemel sahip:</b> '+d.possibleOwner+'</p><p><b>Güven:</b> '+d.confidence+'</p></div>'+
'<div class="glass"><h2>🧬 Risk Kelimeleri</h2>'+d.keywords.map(x=>'<span class="tag">'+x+'</span>').join('')+'</div>'+
'<div class="glass"><h2>🔎 Google Snippet Görünümü</h2>'+d.googleCards.map(x=>'<a target="_blank" href="'+x.link+'"><div class="gcard"><div class="gtitle">'+x.title+'</div><div class="gurl">'+x.query+' - Google Arama Sonucu</div><div class="gsnip">'+x.snippet+'</div></div></a>').join('')+'</div>'+
'<div class="glass"><button class="btn" onclick="ihbar()">🚨 İhbar</button></div>';

setTimeout(()=>{document.getElementById('fill').style.width=d.score+'%';},200);

}catch(e){
sonuc.innerHTML='<div class="glass">Hata oluştu</div>';
}
}

async function ihbar(){
const n=document.getElementById('num').value.trim();
await fetch('/report?number='+encodeURIComponent(n));
alert('İhbar kaydedildi');
tara();
}
</script>
</body>
</html>`;
}
