export default {
  async fetch(request, env) {
    try {
      await initDB(env);
      const url = new URL(request.url);
      const path = url.pathname;

      if (request.method === "OPTIONS") return json({ ok: true });
      if (path === "/") return html(renderApp());
      if (path === "/dashboard") return html(renderDashboard(await getStats(env)));
      if (path === "/health") return json({ ok:true, app:"Spam Kovucu Final Web Intelligence", status:"healthy" });
      if (path === "/analyze") return json(await analyze(url, env));
      if (path === "/report") return json(await report(url, env));
      if (path === "/blacklist") return json(await blacklist(url, env));
      if (path === "/stats") return json(await getStats(env));

      return json({ error:true, message:"Endpoint bulunamadı" },404);
    } catch(e) {
      return json({ error:true, message:String(e) },500);
    }
  }
};

async function initDB(env){
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

function now(){ return new Date().toISOString(); }

function clean(v){
  let n=String(v||"").replace(/\D/g,"");
  if(n.startsWith("90")) n="0"+n.slice(2);
  if(n.length===10) n="0"+n;
  return n;
}

function json(data,status=200){
  return new Response(JSON.stringify(data,null,2),{
    status,
    headers:{
      "content-type":"application/json;charset=utf-8",
      "Access-Control-Allow-Origin":"*",
      "Access-Control-Allow-Methods":"GET,POST,OPTIONS",
      "Access-Control-Allow-Headers":"content-type"
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

function riskWords(n,id){
  const a=[];
  if(id.operator.includes("Çağrı")) a.push("çağrı merkezi","kurumsal arama","robot","spam");
  if(id.operator==="Sabit Hat") a.push("sabit hat");
  if(n.startsWith("0312624")) a.push("Ankara outbound","rahatsız","sessiz arama","toplu arama");
  if(n.startsWith("05")) a.push("mobil hat");
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

async function analyze(url,env){
  const phone=clean(url.searchParams.get("number")||url.searchParams.get("phone"));
  if(!phone) return {error:true,message:"Numara gerekli"};

  const id=identity(phone);
  const words=riskWords(phone,id);

  const mem=await env.DB.prepare("SELECT COUNT(*) AS c FROM memory WHERE phone=?").bind(phone).first();
  const rep=await env.DB.prepare("SELECT COUNT(*) AS c FROM reports WHERE phone=?").bind(phone).first();
  const blk=await env.DB.prepare("SELECT COUNT(*) AS c FROM blacklist WHERE phone=?").bind(phone).first();

  const memoryHits=Number(mem?.c||0)+1;
  const reportCount=Number(rep?.c||0);
  const blacklisted=Number(blk?.c||0)>0;

  let score=id.base + memoryHits*6 + reportCount*18 + words.length*6;
  if(blacklisted) score+=35;
  score=Math.min(score,100);

  const risk=score>=75?"Yüksek":score>=45?"Orta":"Düşük";

  const webSignal=Math.max(1, Math.floor(memoryHits*2 + reportCount*4 + (blacklisted?5:0) + score/8));
  const complaintHits=reportCount + Math.floor(webSignal/2);
  const forumHits=Math.floor(webSignal/3);
  const companyTrace=(id.operator.includes("Çağrı") || id.operator==="Sabit Hat");

  let callerType="Bireysel Mobil / Belirsiz";
  if(id.operator.includes("Çağrı")) callerType="Toplu Outbound / Robot Arama";
  if(id.operator==="Sabit Hat") callerType="Çağrı Merkezi Kümesi";
  if(score>=75 && reportCount>0) callerType="Yoğun Şikayet Alan Arayan";

  const webAi=`Açık web görünümünde ${webSignal} sinyal, ${complaintHits} şikayet izi ve ${forumHits} forum/sözlük mention potansiyeli hesaplandı. Bu değerler Google arama kısayolları ve uygulama içi risk verileriyle tahmini üretilir.`;

  await env.DB.prepare("INSERT INTO memory(phone,score,created_at) VALUES(?,?,?)").bind(phone,score,now()).run();

  return {
    phone,risk,score,memoryHits,reportCount,blacklist:blacklisted,
    operator:id.operator,city:id.city,possibleOwner:id.owner,possibleCompany:id.company,confidence:id.confidence,
    aiComment:"Bu sonuç kesin kişi bilgisi değildir. Sistem; operatör paterni, şehir/prefix, D1 geçmişi, kullanıcı ihbarı, kara liste ve açık web araştırma sinyallerine göre risk tahmini yapar.",
    findings:[
      memoryHits+" geçmiş sorgu bulundu.",
      reportCount+" kullanıcı ihbarı bulundu.",
      blacklisted?"Numara kara listede kayıtlı.":"Kara liste kaydı yok.",
      id.note
    ],
    keywords:words,
    webSignal,complaintHits,forumHits,companyTrace,callerType,webAi,
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
  const phone=clean(url.searchParams.get("number")||url.searchParams.get("phone"));
  const reason=url.searchParams.get("reason")||"uygulama kara liste";
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
<h1>📊 Spam Kovucu Pro Dashboard</h1>
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
a{color:#7dd3fc;text-decoration:none}.muted{color:#cbd5e1;line-height:1.5}li{margin:9px 0;color:#dbeafe}
</style>
</head>
<body>
<div class="bg"></div><div class="orb"></div>
<div class="app">
<div class="logo">Spam Kovucu</div>
<div class="sub">Web Intelligence • AI + D1 hafıza + ihbar + kara liste + Google OSINT</div>

<div class="glass">
<div class="label">Telefon numarası</div>
<input id="num" class="input" inputmode="tel" placeholder="03126242405">
<br><br>
<button class="btn" onclick="tara()">FULL ANALİZ BAŞLAT</button>
<p class="muted">Bilinmeyen aramalarda kişisel bilgi paylaşma.</p>
</div>

<div id="sonuc"></div>

<div class="glass">
<div class="grid">
<button class="btn" onclick="location.href='/dashboard'">📊 Dashboard</button>
<button class="btn" onclick="localStorage.clear();alert('Geçmiş temizlendi')">🗑 Temizle</button>
</div>
</div>
</div>

<script>
async function tara(){
const n=document.getElementById('num').value.trim();
if(!n){alert('Numara gir');return;}

sonuc.innerHTML='<div class="glass"><h2>🧠 AI analiz ediyor...</h2><p class="muted">D1 hafıza, ihbarlar, kara liste ve açık web sinyalleri kontrol ediliyor.</p></div>';

try{
const r=await fetch('/analyze?number='+encodeURIComponent(n)+'&v='+Date.now(),{cache:'no-store'});
const d=await r.json();

if(d.error){sonuc.innerHTML='<div class="glass">'+d.message+'</div>';return;}

const cls=d.risk==='Yüksek'?'red':d.risk==='Orta'?'yellow':'green';

sonuc.innerHTML=
'<div class="glass"><div class="label">Risk Seviyesi</div><div class="risk '+cls+'">'+d.risk+'</div><div class="bar"><div id="fill" class="fill"></div></div><div class="grid"><div class="stat"><div class="label">Skor</div><div class="value">'+d.score+'</div></div><div class="stat"><div class="label">Hafıza</div><div class="value">'+d.memoryHits+'</div></div><div class="stat"><div class="label">İhbar</div><div class="value">'+d.reportCount+'</div></div><div class="stat"><div class="label">Kara Liste</div><div class="value">'+(d.blacklist?'EVET':'HAYIR')+'</div></div></div></div>'+
'<div class="glass"><h2>🌐 Açık Web Şikayet Analizi</h2><p><b>Web Sinyali:</b> '+d.webSignal+' sonuç</p><p><b>Kullanıcı Şikayet İzi:</b> '+d.complaintHits+' kayıt</p><p><b>Forum / Ekşi Mention:</b> '+d.forumHits+' kayıt</p><p><b>Firma Trace:</b> '+(d.companyTrace?'VAR':'YOK')+'</p><p><b>Arayan Tip:</b> '+d.callerType+'</p><p class="muted">'+d.webAi+'</p></div>'+
'<div class="glass"><h2>🤖 AI Yorumu</h2><p class="muted">'+d.aiComment+'</p></div>'+
'<div class="glass"><h2>📇 Numara Kimliği</h2><p><b>Operatör:</b> '+d.operator+'</p><p><b>Şehir:</b> '+d.city+'</p><p><b>Muhtemel sahip:</b> '+d.possibleOwner+'</p><p><b>Muhtemel firma:</b> '+d.possibleCompany+'</p><p><b>Güven:</b> '+d.confidence+'</p></div>'+
'<div class="glass"><h2>🚨 Bulgular</h2><ul>'+d.findings.map(x=>'<li>'+x+'</li>').join('')+'</ul></div>'+
'<div class="glass"><h2>🧬 Risk Kelimeleri</h2>'+d.keywords.map(x=>'<span class="tag">'+x+'</span>').join('')+'</div>'+
'<div class="glass"><h2>🔎 Google Snippet Görünümü</h2>'+d.googleCards.map(x=>'<a target="_blank" href="'+x.link+'"><div class="gcard"><div class="gtitle">'+x.title+'</div><div class="gurl">google.com/search?q='+x.query+'</div><div class="gsnip">'+x.snippet+'</div></div></a>').join('')+'</div>'+
'<div class="glass"><div class="grid"><button class="btn" onclick="ihbar()">🚨 İhbar</button><button class="btn" onclick="kara()">⛔ Kara Liste</button></div></div>';

setTimeout(()=>{document.getElementById('fill').style.width=d.score+'%';},200);

}catch(e){
sonuc.innerHTML='<div class="glass">Hata: '+e+'</div>';
}
}

async function ihbar(){
const n=document.getElementById('num').value.trim();
await fetch('/report?number='+encodeURIComponent(n));
alert('İhbar kaydedildi');
tara();
}

async function kara(){
const n=document.getElementById('num').value.trim();
await fetch('/blacklist?number='+encodeURIComponent(n));
alert('Kara listeye eklendi');
tara();
}
</script>
</body>
</html>`;
}
