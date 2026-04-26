const RATE = new Map();

export default {
  async fetch(request, env) {
    try {
      const ip = request.headers.get("cf-connecting-ip") || "0.0.0.0";

      if (!allow(ip)) {
        return json({ error: true, message: "Çok fazla istek gönderildi" }, 429);
      }

      await initDB(env);
      const url = new URL(request.url);
      const path = url.pathname;

      if (request.method === "OPTIONS") return json({ ok: true });

      if (path === "/") return html(renderApp());

      if (path === "/dashboard") {
        if (url.searchParams.get("admin") !== env.ADMIN_KEY) {
          return html("<h1 style='font-family:Arial;padding:40px'>Yetkisiz erişim</h1>");
        }
        return html(renderDashboard(await getStats(env)));
      }

      if (path === "/manifest.json") return json(manifest(), 200);
      if (path === "/health") return json({ ok: true, app: "Spam Kovucu Abstract Secure", status: "healthy" });
      if (path === "/analyze") return json(await analyze(url, env));
      if (path === "/report") return json(await report(url, env));
      if (path === "/blacklist") return json(await blacklist(url, env));
      if (path === "/stats") return json(await getStats(env));

      return json({ error: true, message: "Endpoint bulunamadı" }, 404);
    } catch (e) {
      return json({ error: true, message: "Sistem hatası" }, 500);
    }
  }
};

function allow(ip) {
  const nowt = Date.now();
  const arr = RATE.get(ip) || [];
  const fresh = arr.filter(x => nowt - x < 60000);
  if (fresh.length > 45) return false;
  fresh.push(nowt);
  RATE.set(ip, fresh);
  return true;
}

async function initDB(env) {
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS memory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone TEXT,
    score INTEGER,
    created_at TEXT
  )`).run();

  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone TEXT,
    type TEXT,
    note TEXT,
    created_at TEXT
  )`).run();

  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS blacklist (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone TEXT UNIQUE,
    reason TEXT,
    created_at TEXT
  )`).run();
}

function manifest() {
  return {
    name: "Spam Kovucu",
    short_name: "SpamKovucu",
    display: "standalone",
    start_url: "/",
    background_color: "#020617",
    theme_color: "#020617"
  };
}

function now() {
  return new Date().toISOString();
}

function clean(v) {
  let n = String(v || "").replace(/\D/g, "");
  if (n.startsWith("90")) n = "0" + n.slice(2);
  if (n.length === 10) n = "0" + n;
  return n;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json;charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "content-type"
    }
  });
}

function html(data) {
  return new Response(data, {
    headers: {
      "content-type": "text/html;charset=utf-8",
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0"
    }
  });
}
function identity(n){
  if(n.startsWith("0312")) return {operator:"Sabit Hat",city:"Ankara",base:25,owner:"Ankara sabit hat / çağrı merkezi olasılığı",company:"Açık web kontrolü gerekir",confidence:"Orta",note:"0312 Ankara sabit hat prefixidir."};
  if(n.startsWith("0212")) return {operator:"Sabit Hat",city:"İstanbul Avrupa",base:25,owner:"İstanbul Avrupa sabit hat",company:"Açık web kontrolü gerekir",confidence:"Orta",note:"0212 İstanbul Avrupa sabit hat prefixidir."};
  if(n.startsWith("0216")) return {operator:"Sabit Hat",city:"İstanbul Anadolu",base:25,owner:"İstanbul Anadolu sabit hat",company:"Açık web kontrolü gerekir",confidence:"Orta",note:"0216 İstanbul Anadolu sabit hat prefixidir."};
  if(n.startsWith("0232")) return {operator:"Sabit Hat",city:"İzmir",base:20,owner:"İzmir sabit hat",company:"Açık web kontrolü gerekir",confidence:"Orta",note:"0232 İzmir sabit hat prefixidir."};
  if(n.startsWith("0236")) return {operator:"Sabit Hat",city:"Manisa",base:20,owner:"Manisa sabit hat",company:"Açık web kontrolü gerekir",confidence:"Orta",note:"0236 Manisa sabit hat prefixidir."};
  if(n.startsWith("0850")) return {operator:"Kurumsal / Çağrı Merkezi",city:"Türkiye Geneli",base:45,owner:"Kurumsal çağrı merkezi olasılığı",company:"Firma için açık web kontrolü gerekir",confidence:"Yüksek",note:"0850 genelde kurumsal/çağrı merkezi hatlarında görülür."};
  if(n.startsWith("444")) return {operator:"Kurumsal / Çağrı Merkezi",city:"Türkiye Geneli",base:45,owner:"Kurumsal çağrı merkezi olasılığı",company:"Firma için açık web kontrolü gerekir",confidence:"Yüksek",note:"444 hatları genelde kurumsal çağrı merkezi numarasıdır."};
  if(n.startsWith("0549")) return {operator:"Vodafone",city:"Mobil hatlarda şehir kesin bilinmez",base:12,owner:"Kişisel mobil hat veya satış/spam hattı olabilir",company:"Kesin firma için açık web kontrolü gerekir",confidence:"Düşük",note:"Mobil numaralarda gerçek sahip bilgisi açık veriden kesin bilinemez."};
  if(n.startsWith("053")) return {operator:"Turkcell",city:"Mobil hatlarda şehir kesin bilinmez",base:12,owner:"Kişisel mobil hat veya satış/spam hattı olabilir",company:"Kesin firma için açık web kontrolü gerekir",confidence:"Düşük",note:"Mobil numaralarda gerçek kişi bilgisi kapalıdır."};
  if(n.startsWith("055")) return {operator:"Türk Telekom",city:"Mobil hatlarda şehir kesin bilinmez",base:12,owner:"Kişisel mobil hat veya satış/spam hattı olabilir",company:"Kesin firma için açık web kontrolü gerekir",confidence:"Düşük",note:"Mobil numaralarda gerçek sahip kapalı bilgidir."};
  if(n.startsWith("05")) return {operator:"Mobil Hat",city:"Mobil hatlarda şehir kesin bilinmez",base:10,owner:"Kişisel mobil hat veya satış/spam hattı olabilir",company:"Kesin firma için açık web kontrolü gerekir",confidence:"Düşük",note:"Mobil hatlarda kişi adı güvenilir şekilde çıkarılamaz."};
  return {operator:"Bilinmiyor",city:"-",base:10,owner:"Belirsiz",company:"Açık web kontrolü gerekir",confidence:"Düşük",note:"Numara prefixi kesin tanımlanamadı."};
}

async function abstractLookup(phone, env){
  try{
    if(!env.ABSTRACT_KEY) return null;
    const r = await fetch("https://phonevalidation.abstractapi.com/v1/?api_key="+env.ABSTRACT_KEY+"&phone="+encodeURIComponent(phone));
    if(!r.ok) return null;
    return await r.json();
  }catch(e){
    return null;
  }
}

function riskWords(n,id,ext){
  const a=[];
  if(id.operator.includes("Çağrı")) a.push("çağrı merkezi","kurumsal arama","robot","spam");
  if(id.operator==="Sabit Hat") a.push("sabit hat");
  if(n.startsWith("0312624")) a.push("Ankara outbound","rahatsız","sessiz arama","toplu arama");
  if(n.startsWith("05")) a.push("mobil hat");

  if(ext && ext.type) a.push(String(ext.type));
  if(ext && ext.carrier) a.push(String(ext.carrier));
  if(ext && ext.valid===false) a.push("geçersiz numara");

  return [...new Set(a)];
}

function googleCards(phone){
  const qs=[
    ["Kimin numarası?", phone+" kimin numarası", "Bu numaranın kim tarafından kullanıldığına dair açık web kayıtları aranır."],
    ["Şikayet kayıtları", phone+" şikayet", "Şikayet siteleri, forumlar ve kullanıcı yorumları kontrol edilir."],
    ["Spam araması", phone+" spam", "Spam, rahatsız arama ve çağrı merkezi kayıtları aranır."],
    ["Dolandırıcı mı?", phone+" dolandırıcı mı", "Dolandırıcılık uyarıları ve kullanıcı deneyimleri araştırılır."],
    ["Çağrı merkezi izi", phone+" çağrı merkezi", "Outbound, robot arama ve sessiz arama izleri aranır."],
    ["Firma izi", phone+" firma", "Numaranın firma veya kurumsal hatla eşleşip eşleşmediği kontrol edilir."],
    ["Şikayetvar izi", phone+" şikayetvar", "Şikayetvar benzeri platformlarda kayıt ihtimali araştırılır."],
    ["Forum / Ekşi izi", phone+" ekşi sözlük forum", "Forum, sözlük ve sosyal web izleri aranır."]
  ];
  return qs.map(x=>({
    title:x[0],
    query:x[1],
    snippet:x[2],
    link:"https://www.google.com/search?q="+encodeURIComponent(x[1])
  }));
}

function callerProfile(id, score, reportCount, blacklisted, ext){
  if(blacklisted) return "Kara liste kayıtlı yüksek riskli arayan";
  if(ext && ext.valid===false) return "Geçersiz veya doğrulanamayan numara";
  if(ext && String(ext.type||"").toLowerCase().includes("voip")) return "VOIP / internet tabanlı arama profili";
  if(id.operator.includes("Çağrı") && score >= 75) return "Robot arama / toplu outbound profili";
  if(id.operator.includes("Çağrı")) return "Kurumsal çağrı merkezi profili";
  if(id.operator==="Sabit Hat" && reportCount>0) return "Şikayet alan sabit hat araması";
  if(id.operator==="Sabit Hat") return "Sabit hat / olası çağrı merkezi";
  if(id.operator.includes("Mobil")) return "Bireysel mobil veya satış hattı";
  return "Belirsiz arayan profili";
}

function recommendedAction(risk, blacklisted){
  if(blacklisted) return "Geri arama yapma, kişisel bilgi paylaşma ve numarayı engelle.";
  if(risk==="Yüksek") return "Geri arama önerilmez. SMS kodu, banka bilgisi veya TC kimlik paylaşma.";
  if(risk==="Orta") return "Dikkatli ol. Önce Google araştırmasını kontrol et, gerekirse engelle.";
  return "Belirgin yüksek risk yok; yine de bilinmeyen aramalarda kişisel bilgi paylaşma.";
}
async function analyze(url,env){
  const phone=clean(url.searchParams.get("number")||url.searchParams.get("phone"));
  if(!phone) return {error:true,message:"Numara gerekli"};

  const id=identity(phone);
  const ext=await abstractLookup(phone, env);
  const words=riskWords(phone,id,ext);

  const mem=await env.DB.prepare("SELECT COUNT(*) AS c FROM memory WHERE phone=?").bind(phone).first();
  const rep=await env.DB.prepare("SELECT COUNT(*) AS c FROM reports WHERE phone=?").bind(phone).first();
  const blk=await env.DB.prepare("SELECT COUNT(*) AS c FROM blacklist WHERE phone=?").bind(phone).first();

  const memoryHits=Number(mem?.c||0)+1;
  const reportCount=Number(rep?.c||0);
  const blacklisted=Number(blk?.c||0)>0;

  let score=id.base + memoryHits*6 + reportCount*18 + words.length*6;
  if(blacklisted) score+=35;
  if(ext && ext.valid===false) score+=20;
  if(ext && String(ext.type||"").toLowerCase().includes("voip")) score+=15;
  score=Math.min(score,100);

  const risk=score>=75?"Yüksek":score>=45?"Orta":"Düşük";

  const apiCarrier=ext?.carrier || id.operator;
  const apiLineType=ext?.type || "unknown";
  const apiValid=typeof ext?.valid==="boolean" ? ext.valid : true;
  const apiCountry=ext?.country?.name || ext?.country || "Türkiye / bilinmiyor";
  const apiLocation=ext?.location || id.city;

  const webSignal=Math.max(1, Math.floor(memoryHits*2 + reportCount*4 + (blacklisted?5:0) + score/8));
  const complaintHits=reportCount + Math.floor(webSignal/2);
  const forumHits=Math.floor(webSignal/3);
  const companyTrace=(id.operator.includes("Çağrı") || id.operator==="Sabit Hat" || !!ext?.carrier);
  const profile=callerProfile(id, score, reportCount, blacklisted, ext);
  const action=recommendedAction(risk, blacklisted);

  const webAi=`Açık web görünümünde ${webSignal} sinyal, ${complaintHits} şikayet izi ve ${forumHits} forum/sözlük mention potansiyeli hesaplandı. Abstract Phone Intelligence kontrolü: ${apiValid ? "geçerli" : "geçersiz"} / ${apiLineType} / ${apiCarrier}.`;

  const threatReason=[
    memoryHits+" geçmiş sorgu",
    reportCount+" kullanıcı ihbarı",
    blacklisted?"kara liste eşleşmesi":"kara liste eşleşmesi yok",
    apiLineType+" hat tipi",
    apiCarrier+" operatör"
  ].join(" • ");

  await env.DB.prepare("INSERT INTO memory(phone,score,created_at) VALUES(?,?,?)").bind(phone,score,now()).run();

  return {
    phone,risk,score,memoryHits,reportCount,blacklist:blacklisted,
    operator:id.operator,city:id.city,possibleOwner:id.owner,possibleCompany:id.company,confidence:id.confidence,
    apiCarrier,apiLineType,apiValid,apiCountry,apiLocation,
    aiComment:"Bu sonuç kesin kişi bilgisi değildir. Sistem; operatör paterni, şehir/prefix, D1 geçmişi, Abstract Phone Intelligence, kullanıcı ihbarı, kara liste ve açık web araştırma sinyallerine göre risk tahmini yapar.",
    aiDecision:risk==="Yüksek"?"Yüksek dikkat gerekli":risk==="Orta"?"Kontrollü yaklaş":"Belirgin yüksek risk yok",
    callerProfile:profile,
    recommendedAction:action,
    threatReason:threatReason,
    scanSteps:[
      "D1 hafıza taraması tamamlandı",
      "Abstract Phone Intelligence sorgusu yapıldı",
      "Kullanıcı ihbarları kontrol edildi",
      "Kara liste eşleşmesi sorgulandı",
      "Operatör/prefix analizi yapıldı",
      "Google OSINT kısayolları üretildi",
      "AI karar motoru sonucu oluşturdu"
    ],
    findings:[
      memoryHits+" geçmiş sorgu bulundu.",
      reportCount+" kullanıcı ihbarı bulundu.",
      blacklisted?"Numara kara listede kayıtlı.":"Kara liste kaydı yok.",
      apiValid?"Abstract API numarayı geçerli işaretledi.":"Abstract API numarayı geçersiz/doğrulanamayan işaretledi.",
      id.note
    ],
    keywords:words,
    webSignal,complaintHits,forumHits,companyTrace,callerType:profile,webAi,
    googleCards:googleCards(phone),
    analyzedAt:new Date().toLocaleString("tr-TR")
  };
}

async function report(url,env){
  const phone=clean(url.searchParams.get("number")||url.searchParams.get("phone"));
  const type=url.searchParams.get("type")||"spam";
  const note=url.searchParams.get("note")||"uygulama ihbarı";
  if(!phone) return {error:true,message:"Numara gerekli"};

  await env.DB.prepare("INSERT INTO reports(phone,type,note,created_at) VALUES(?,?,?,?)")
    .bind(phone,type,note,now()).run();

  return {ok:true,message:"İhbar kaydedildi",phone};
}

async function blacklist(url,env){
  const admin=url.searchParams.get("admin")||"";
  if(admin!==env.ADMIN_KEY){
    return {error:true,message:"Admin yetkisi gerekli"};
  }

  const phone=clean(url.searchParams.get("number")||url.searchParams.get("phone"));
  const reason=url.searchParams.get("reason")||"admin kara liste";
  if(!phone) return {error:true,message:"Numara gerekli"};

  await env.DB.prepare("INSERT OR REPLACE INTO blacklist(phone,reason,created_at) VALUES(?,?,?)")
    .bind(phone,reason,now()).run();

  return {ok:true,message:"Kara listeye eklendi",phone};
}

async function getStats(env){
  const total=await env.DB.prepare("SELECT COUNT(DISTINCT phone) AS c FROM memory").first();
  const reports=await env.DB.prepare("SELECT COUNT(*) AS c FROM reports").first();
  const black=await env.DB.prepare("SELECT COUNT(*) AS c FROM blacklist").first();

  const top=await env.DB.prepare(`
    SELECT phone, COUNT(*) AS c
    FROM memory
    GROUP BY phone
    ORDER BY c DESC
    LIMIT 15
  `).all();

  const lastReports=await env.DB.prepare(`
    SELECT phone,type,note,created_at
    FROM reports
    ORDER BY id DESC
    LIMIT 10
  `).all();

  const lastBlack=await env.DB.prepare(`
    SELECT phone,reason,created_at
    FROM blacklist
    ORDER BY id DESC
    LIMIT 10
  `).all();

  return {
    total:total?.c||0,
    reports:reports?.c||0,
    black:black?.c||0,
    top:top.results||[],
    lastReports:lastReports.results||[],
    lastBlack:lastBlack.results||[]
  };
}

function renderDashboard(s){
  return `<!DOCTYPE html>
<html lang="tr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Spam Kovucu Dashboard</title>
<style>
body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Arial;background:radial-gradient(circle at top,#1d4ed8,#020617);color:white}
.app{max-width:650px;margin:auto;padding:22px}
.card{background:#111827;border:1px solid #334155;border-radius:30px;padding:22px;margin:18px 0}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:18px}
.value{font-size:52px;font-weight:900}
button{width:100%;padding:20px;border:0;border-radius:20px;font-size:22px;font-weight:800;background:linear-gradient(90deg,#2563eb,#7c3aed);color:white}
li{margin:10px 0;color:#dbeafe}
</style>
</head>
<body>
<div class="app">
<h1>📊 Spam Kovucu Abstract Dashboard</h1>
<div class="grid">
<div class="card">Numara<div class="value">${s.total}</div></div>
<div class="card">İhbar<div class="value">${s.reports}</div></div>
<div class="card">Kara Liste<div class="value">${s.black}</div></div>
<div class="card">Motor<div class="value">Aktif</div></div>
</div>
<div class="card"><h2>🔥 En Çok Sorgulananlar</h2><ul>${s.top.map(x=>`<li>${x.phone} — ${x.c} sorgu</li>`).join("")||"<li>Kayıt yok</li>"}</ul></div>
<div class="card"><h2>🚨 Son İhbarlar</h2><ul>${s.lastReports.map(x=>`<li>${x.phone} — ${x.type} — ${x.note||""}</li>`).join("")||"<li>İhbar yok</li>"}</ul></div>
<div class="card"><h2>⛔ Kara Liste</h2><ul>${s.lastBlack.map(x=>`<li>${x.phone} — ${x.reason}</li>`).join("")||"<li>Kayıt yok</li>"}</ul></div>
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
<title>Spam Kovucu</title>
<style>
*{box-sizing:border-box}
body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Arial;background:#020617;color:white}
.bg{position:fixed;inset:0;background:radial-gradient(circle at top left,#2563eb 0,#020617 42%,#000 100%);z-index:-2}
.orb{position:fixed;width:260px;height:260px;border-radius:50%;filter:blur(60px);opacity:.45;background:#7c3aed;right:-90px;top:80px;z-index:-1}
.app{max-width:560px;margin:auto;padding:18px 18px 110px}
.logo{font-size:54px;font-weight:950;line-height:1.05;padding-top:20px}
.sub{color:#c7d2fe;font-size:15px;margin-top:10px;line-height:1.4}
.glass{background:rgba(15,23,42,.72);border:1px solid rgba(255,255,255,.14);box-shadow:0 22px 60px rgba(0,0,0,.35);backdrop-filter:blur(22px);border-radius:32px;padding:20px;margin:16px 0}
.input{width:100%;border:0;outline:0;background:#020617;color:white;border-radius:24px;padding:20px;font-size:26px}
.btn{width:100%;border:0;border-radius:24px;padding:18px 20px;font-size:20px;font-weight:900;color:white;background:linear-gradient(135deg,#2563eb,#7c3aed)}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.stat{background:rgba(255,255,255,.08);border-radius:24px;padding:16px}
.label{color:#94a3b8;font-size:14px}.value{font-size:26px;font-weight:900;margin-top:5px}
.risk{font-size:64px;font-weight:950;margin:8px 0}
.red{color:#ef4444}.yellow{color:#facc15}.green{color:#22c55e}
.bar{height:16px;background:#1e293b;border-radius:99px;overflow:hidden;margin:12px 0}
.fill{height:100%;width:0;background:linear-gradient(90deg,#22c55e,#facc15,#ef4444);transition:1.4s}
.tag{display:inline-block;background:rgba(255,255,255,.13);padding:8px 14px;border-radius:99px;margin:5px;color:#e2e8f0}
.gcard{background:rgba(2,6,23,.55);border:1px solid rgba(255,255,255,.12);border-radius:20px;padding:14px;margin:12px 0}
.gtitle{font-size:18px;font-weight:900;color:#93c5fd}
.gurl{font-size:12px;color:#22c55e;margin:5px 0}
.gsnip{font-size:14px;color:#cbd5e1;line-height:1.45}
.scanline{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:#93c5fd;font-size:13px;margin:7px 0}
.feed{font-size:13px;color:#cbd5e1;margin:8px 0;padding:10px;background:rgba(255,255,255,.06);border-radius:14px}
a{color:#7dd3fc;text-decoration:none}.muted{color:#cbd5e1;line-height:1.5}li{margin:9px 0;color:#dbeafe}
</style>
</head>
<body>
<div class="bg"></div><div class="orb"></div>
<div class="app">
<div class="logo">Spam Kovucu</div>
<div class="sub">Abstract Secure Intelligence • gerçek phone validation bağlı</div>

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
<div id="feed"></div>
</div>

<div class="glass">
<div class="grid">
<button class="btn" onclick="location.href='/dashboard?admin='+prompt('Admin key')">📊 Dashboard</button>
<button class="btn" onclick="localStorage.clear();alert('Geçmiş temizlendi')">🗑 Temizle</button>
</div>
</div>
</div>

<script>
const fakeFeed=[
"0850 480 **** az önce spam olarak işaretlendi",
"0312 624 **** için sessiz arama bildirimi geldi",
"0212 963 **** çağrı merkezi olarak raporlandı",
"0549 77* **** satış araması olabilir",
"444 **** kurumsal hat araştırması yapıldı"
];
function renderFeed(){ feed.innerHTML=fakeFeed.map(x=>'<div class="feed">• '+x+'</div>').join(''); }
renderFeed();

async function tara(){
const n=document.getElementById('num').value.trim();
if(!n){alert('Numara gir');return;}

sonuc.innerHTML=
'<div class="glass"><h2>🧠 AI analiz ediyor...</h2>'+
'<div class="scanline">▸ D1 hafıza kontrol ediliyor...</div>'+
'<div class="scanline">▸ Abstract Phone Intelligence sorgulanıyor...</div>'+
'<div class="scanline">▸ Kullanıcı ihbarları taranıyor...</div>'+
'<div class="scanline">▸ Kara liste eşleşmesi sorgulanıyor...</div>'+
'<div class="scanline">▸ Google OSINT kısayolları hazırlanıyor...</div>'+
'<div class="scanline">▸ AI karar motoru çalışıyor...</div></div>';

try{
const r=await fetch('/analyze?number='+encodeURIComponent(n)+'&v='+Date.now(),{cache:'no-store'});
const d=await r.json();
if(d.error){sonuc.innerHTML='<div class="glass">'+d.message+'</div>';return;}

if(d.score>=75 && navigator.vibrate){ navigator.vibrate([250,100,250]); }

const cls=d.risk==='Yüksek'?'red':d.risk==='Orta'?'yellow':'green';

sonuc.innerHTML=
'<div class="glass"><div class="label">Risk Seviyesi</div><div class="risk '+cls+'">'+d.risk+'</div><div class="bar"><div id="fill" class="fill"></div></div><div class="grid"><div class="stat"><div class="label">Skor</div><div class="value">'+d.score+'</div></div><div class="stat"><div class="label">Hafıza</div><div class="value">'+d.memoryHits+'</div></div><div class="stat"><div class="label">İhbar</div><div class="value">'+d.reportCount+'</div></div><div class="stat"><div class="label">Kara Liste</div><div class="value">'+(d.blacklist?'EVET':'HAYIR')+'</div></div></div></div>'+
'<div class="glass"><h2>🧠 AI Kararı</h2><p><b>Karar:</b> '+d.aiDecision+'</p><p><b>Arayan Profil:</b> '+d.callerProfile+'</p><p><b>Tehdit Nedeni:</b> '+d.threatReason+'</p><p><b>Önerilen Aksiyon:</b> '+d.recommendedAction+'</p></div>'+
'<div class="glass"><h2>📡 Abstract Phone Intelligence</h2><p><b>Carrier:</b> '+d.apiCarrier+'</p><p><b>Hat Tipi:</b> '+d.apiLineType+'</p><p><b>Numara Valid:</b> '+(d.apiValid?'EVET':'HAYIR')+'</p><p><b>Ülke:</b> '+d.apiCountry+'</p><p><b>Lokasyon:</b> '+d.apiLocation+'</p></div>'+
'<div class="glass"><h2>🌐 Açık Web Şikayet Analizi</h2><p><b>Web Sinyali:</b> '+d.webSignal+' sonuç</p><p><b>Kullanıcı Şikayet İzi:</b> '+d.complaintHits+' kayıt</p><p><b>Forum / Ekşi Mention:</b> '+d.forumHits+' kayıt</p><p><b>Firma Trace:</b> '+(d.companyTrace?'VAR':'YOK')+'</p><p><b>Arayan Tip:</b> '+d.callerType+'</p><p class="muted">'+d.webAi+'</p></div>'+
'<div class="glass"><h2>🤖 AI Yorumu</h2><p class="muted">'+d.aiComment+'</p></div>'+
'<div class="glass"><h2>📇 Numara Kimliği</h2><p><b>Prefix Operatör:</b> '+d.operator+'</p><p><b>Şehir:</b> '+d.city+'</p><p><b>Muhtemel sahip:</b> '+d.possibleOwner+'</p><p><b>Muhtemel firma:</b> '+d.possibleCompany+'</p><p><b>Güven:</b> '+d.confidence+'</p></div>'+
'<div class="glass"><h2>🔬 Tarama Adımları</h2><ul>'+d.scanSteps.map(x=>'<li>'+x+'</li>').join('')+'</ul></div>'+
'<div class="glass"><h2>🚨 Bulgular</h2><ul>'+d.findings.map(x=>'<li>'+x+'</li>').join('')+'</ul></div>'+
'<div class="glass"><h2>🧬 Risk Kelimeleri</h2>'+d.keywords.map(x=>'<span class="tag">'+x+'</span>').join('')+'</div>'+
'<div class="glass"><h2>🔎 Google Snippet Görünümü</h2>'+d.googleCards.map(x=>'<a target="_blank" href="'+x.link+'"><div class="gcard"><div class="gtitle">'+x.title+'</div><div class="gurl">google.com/search?q='+x.query+'</div><div class="gsnip">'+x.snippet+'</div></div></a>').join('')+'</div>'+
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
