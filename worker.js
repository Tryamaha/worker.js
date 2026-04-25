export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const path = url.pathname;

    if (path === "/dashboard") {
      const stats = await getDashboardStats(env);
      return html(renderDashboard(stats));
    }

    if (path === "/analyze") {
      const number = (url.searchParams.get("number") || "").trim();
      if (!number) return json({ error: true, message: "Numara yok" });

      const result = await analyzeNumber(number, env);
      return json(result);
    }

    if (path === "/report") {
      const number = (url.searchParams.get("number") || "").trim();
      const type = url.searchParams.get("type") || "spam";
      const note = url.searchParams.get("note") || "";
      if (number) {
        await env.DB.prepare(
          "INSERT INTO reports (phone,type,note,created_at) VALUES (?,?,?,?)"
        ).bind(number, type, note, now()).run();
      }
      return json({ ok: true, message: "İhbar kaydedildi" });
    }

    if (path === "/blacklist") {
      const number = (url.searchParams.get("number") || "").trim();
      const reason = url.searchParams.get("reason") || "manuel";
      if (number) {
        await env.DB.prepare(
          "INSERT INTO blacklist (phone,reason,created_at) VALUES (?,?,?)"
        ).bind(number, reason, now()).run();
      }
      return json({ ok: true, message: "Kara listeye eklendi" });
    }

    return html(renderHome());
  }
};

function now() {
  return new Date().toISOString();
}

function json(d) {
  return new Response(JSON.stringify(d, null, 2), {
    headers: { "content-type": "application/json;charset=UTF-8" }
  });
}

function html(str) {
  return new Response(str, {
    headers: { "content-type": "text/html;charset=UTF-8" }
  });
}

async function analyzeNumber(number, env) {
  const mem = await env.DB.prepare(
    "SELECT COUNT(*) c FROM searches WHERE phone=?"
  ).bind(number).first();

  await env.DB.prepare(
    "INSERT INTO searches (phone,created_at) VALUES (?,?)"
  ).bind(number, now()).run();

  const rep = await env.DB.prepare(
    "SELECT COUNT(*) c FROM reports WHERE phone=?"
  ).bind(number).first();

  const blk = await env.DB.prepare(
    "SELECT COUNT(*) c FROM blacklist WHERE phone=?"
  ).bind(number).first();

  const operator = detectOperator(number);
  const city = detectCity(number);
  const keywords = detectKeywords(number, operator);

  let score = 20 + (mem.c * 12) + (rep.c * 20) + (blk.c * 25) + (keywords.length * 7);
  if (score > 100) score = 100;

  const risk =
    score >= 75 ? "Yüksek" :
    score >= 45 ? "Orta" : "Düşük";

  return {
    number,
    operator,
    city,
    memoryHits: mem.c + 1,
    reportCount: rep.c,
    blacklist: blk.c > 0,
    score,
    risk,
    aiComment:
      `AI dedektif motoru bu numaranın operatör paterni, D1 geçmiş hafızası, kullanıcı ihbarları, kara liste durumu ve risk kelime kümelerini birlikte değerlendirerek ${risk.toLowerCase()} risk taşıdığını düşünüyor.`,
    complaints: [
      `${mem.c + 1} geçmiş sorgu bulundu.`,
      `${rep.c} kullanıcı ihbarı bulundu.`,
      blk.c > 0 ? "Numara kara listede kayıtlı." : "Kara liste kaydı yok."
    ],
    keywords,
    webResults: [
      {
        title: `${number} şikayet / spam araması`,
        link: `https://www.google.com/search?q=${number}+şikayet+spam`
      },
      {
        title: `${number} dolandırıcı mı?`,
        link: `https://www.google.com/search?q=${number}+dolandırıcı+mı`
      }
    ]
  };
}

function detectOperator(n) {
  if (n.startsWith("0312")) return "Sabit Hat";
  if (n.startsWith("0549")) return "Vodafone";
  if (n.startsWith("0532")) return "Turkcell";
  if (n.startsWith("0555")) return "Türk Telekom";
  return "Bilinmeyen Hat";
}

function detectCity(n) {
  if (n.startsWith("0312")) return "Ankara";
  return "Mobil Hatlarda şehir kesin bilinmez";
}

function detectKeywords(n, op) {
  let arr = [];
  if (op === "Sabit Hat") arr.push("sabit hat");
  if (n.startsWith("0312")) arr.push("çağrı merkezi","rahatsız","sessiz");
  return arr;
}

async function getDashboardStats(env) {
  const total = await env.DB.prepare("SELECT COUNT(DISTINCT phone) c FROM searches").first();
  const reports = await env.DB.prepare("SELECT COUNT(*) c FROM reports").first();
  const black = await env.DB.prepare("SELECT COUNT(*) c FROM blacklist").first();

  const top = await env.DB.prepare(
    "SELECT phone,COUNT(*) c FROM searches GROUP BY phone ORDER BY c DESC LIMIT 5"
  ).all();

  return {
    total: total.c,
    reports: reports.c,
    black: black.c,
    top: top.results || []
  };
}

function renderHome() {
return `<!DOCTYPE html>
<html lang="tr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Spam Kovucu Ultra V3</title>
<style>
body{margin:0;font-family:-apple-system;background:radial-gradient(circle at top,#1d4ed8,#020617);color:#fff}
.app{max-width:650px;margin:auto;padding:22px}
.card{background:#111827;border:1px solid #334155;border-radius:30px;padding:22px;margin:18px 0}
input{width:100%;padding:20px;font-size:22px;border-radius:20px;border:0;background:#020617;color:#fff}
button{width:100%;padding:20px;border:0;border-radius:20px;font-size:24px;font-weight:800;background:linear-gradient(90deg,#2563eb,#7c3aed);color:#fff}
.bar{height:16px;background:#1e293b;border-radius:20px;overflow:hidden}
.fill{height:100%;width:0%;background:linear-gradient(90deg,#22c55e,#eab308,#ef4444);transition:2s}
.tag{display:inline-block;background:#2b3445;padding:8px 14px;border-radius:20px;margin:4px}
.hist{padding:10px;border-bottom:1px solid #334155;color:#cbd5e1}
</style>
</head>
<body>
<div class="app">
<h1>🛡 Spam Kovucu Ultra V3</h1>

<div class="card">
<input id="num" placeholder="Telefon numarası">
<br><br>
<button onclick="tara()">Tara</button>
</div>

<div id="sonuc" style="display:none"></div>

<div class="card">
<button onclick="location.href='/dashboard'">📊 Dashboard</button>
</div>
</div>

<script>
function saveHistory(n){
 let arr=JSON.parse(localStorage.getItem("spamhist")||"[]");
 arr.unshift(n);
 arr=[...new Set(arr)].slice(0,20);
 localStorage.setItem("spamhist",JSON.stringify(arr));
}
function renderHistory(){
 let arr=JSON.parse(localStorage.getItem("spamhist")||"[]");
 if(!arr.length) return "";
 return '<div class="card"><h2>🕘 Geçmiş Sorgular</h2>'+arr.map(x=>'<div class="hist">'+x+'</div>').join('')+'</div>';
}
async function tara(){
 const n=document.getElementById("num").value.trim();
 if(!n) return;
 saveHistory(n);
 document.getElementById("sonuc").style.display="block";
 document.getElementById("sonuc").innerHTML='<div class="card"><h2>🧠 AI analiz ediyor...</h2></div>';
 const r=await fetch('/analyze?number='+encodeURIComponent(n));
 const d=await r.json();

 if(d.score>=75 && navigator.vibrate){ navigator.vibrate([300,100,300]); }

 document.getElementById("sonuc").innerHTML=
 '<div class="card"><h2>Risk Seviyesi</h2><div style="font-size:72px;font-weight:900">'+d.risk+'</div><div class="bar"><div id="fill" class="fill"></div></div><br><b>Skor:</b> '+d.score+'<br><b>Hafıza:</b> '+d.memoryHits+'<br><b>İhbar:</b> '+d.reportCount+'<br><b>Kara Liste:</b> '+(d.blacklist?'EVET':'HAYIR')+'</div>'+
 '<div class="card"><h2>🤖 AI Dedektif Yorumu</h2><p>'+d.aiComment+'</p></div>'+
 '<div class="card"><h2>🧾 Numara Kimliği</h2><p><b>Operatör:</b> '+d.operator+'</p><p><b>Şehir:</b> '+d.city+'</p></div>'+
 '<div class="card"><h2>🚨 Bulgular</h2><ul>'+d.complaints.map(x=>'<li>'+x+'</li>').join('')+'</ul></div>'+
 '<div class="card"><h2>🧬 Risk Kelimeleri</h2>'+d.keywords.map(x=>'<span class="tag">'+x+'</span>').join('')+'</div>'+
 '<div class="card"><h2>🌍 Google Açık Web</h2>'+d.webResults.map(x=>'<p><a style="color:#60a5fa" href="'+x.link+'" target="_blank">'+x.title+'</a></p>').join('')+'</div>'+
 '<div class="card"><button onclick="fetch(\\'/report?number='+n+'&type=spam&note=manuel\\').then(()=>alert(\\'İhbar kaydedildi\\'))">🚨 Spam İhbar</button><br><br><button onclick="fetch(\\'/blacklist?number='+n+'&reason=manuel\\').then(()=>alert(\\'Kara listeye eklendi\\'))">⛔ Kara Liste</button></div>'+
 renderHistory();

 setTimeout(()=>{document.getElementById("fill").style.width=d.score+"%";},200);
}
</script>
</body>
</html>`;
}

function renderDashboard(stats){
return `<!DOCTYPE html>
<html lang="tr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Dashboard</title>
<style>
body{margin:0;font-family:-apple-system;background:radial-gradient(circle at top,#1d4ed8,#020617);color:#fff}
.app{max-width:650px;margin:auto;padding:22px}
.card{background:#111827;border:1px solid #334155;border-radius:30px;padding:22px;margin:18px 0}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:18px}
.value{font-size:52px;font-weight:900}
button{width:100%;padding:20px;border:0;border-radius:20px;font-size:24px;font-weight:800;background:linear-gradient(90deg,#2563eb,#7c3aed);color:#fff}
</style>
</head>
<body>
<div class="app">
<h1>📊 Spam Kovucu PRO Dashboard</h1>
<div class="grid">
<div class="card"><div>Numara</div><div class="value">${stats.total}</div></div>
<div class="card"><div>İhbar</div><div class="value">${stats.reports}</div></div>
<div class="card"><div>Kara Liste</div><div class="value">${stats.black}</div></div>
<div class="card"><div>Motor</div><div class="value">Aktif</div></div>
</div>

<div class="card"><h2>🔥 En Çok Sorgulananlar</h2><ul>${stats.top.map(x=>`<li>${x.phone} — ${x.c} sorgu</li>`).join("")}</ul></div>

<div class="card"><button onclick="location.href='/'">🏠 Ana Ekrana Dön</button></div>
</div>
</body>
</html>`;
}
