export default {
  async fetch(req, env) {
    try {
      await initDB(env);

      const url = new URL(req.url);
      const path = url.pathname;

      if (path === "/dashboard") {
        return html(renderDashboard(await getDashboardStats(env)));
      }

      if (path === "/analyze") {
        const number = clean(url.searchParams.get("number") || url.searchParams.get("phone"));
        if (!number) return json({ error: true, message: "Numara yok" });
        return json(await analyzeNumber(number, env));
      }

      if (path === "/report") {
        const number = clean(url.searchParams.get("number") || url.searchParams.get("phone"));
        const type = url.searchParams.get("type") || "spam";
        const note = url.searchParams.get("note") || "manuel ihbar";
        if (!number) return json({ error: true, message: "Numara yok" });

        await env.DB.prepare(
          "INSERT INTO reports (phone,type,note,created_at) VALUES (?,?,?,?)"
        ).bind(number, type, note, now()).run();

        return json({ ok: true, message: "İhbar kaydedildi", phone: number });
      }

      if (path === "/blacklist") {
        const number = clean(url.searchParams.get("number") || url.searchParams.get("phone"));
        const reason = url.searchParams.get("reason") || "manuel";
        if (!number) return json({ error: true, message: "Numara yok" });

        await env.DB.prepare(
          "INSERT OR REPLACE INTO blacklist (phone,reason,created_at) VALUES (?,?,?)"
        ).bind(number, reason, now()).run();

        return json({ ok: true, message: "Kara listeye eklendi", phone: number });
      }

      if (path === "/health") {
        return json({ ok: true, app: "Spam Kovucu Ultra V3 Fixed", status: "healthy" });
      }

      return html(renderHome());
    } catch (e) {
      return json({ error: true, message: String(e) }, 500);
    }
  }
};

async function initDB(env) {
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS searches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone TEXT,
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

function clean(v) {
  let n = String(v || "").replace(/\D/g, "");
  if (n.startsWith("90")) n = "0" + n.slice(2);
  if (n.length === 10) n = "0" + n;
  return n;
}

function now() {
  return new Date().toISOString();
}

function json(d, status = 200) {
  return new Response(JSON.stringify(d, null, 2), {
    status,
    headers: {
      "content-type": "application/json;charset=UTF-8",
      "Access-Control-Allow-Origin": "*"
    }
  });
}

function html(str) {
  return new Response(str, {
    headers: {
      "content-type": "text/html;charset=UTF-8",
      "Cache-Control": "no-store"
    }
  });
}

async function analyzeNumber(number, env) {
  await env.DB.prepare(
    "INSERT INTO searches (phone,created_at) VALUES (?,?)"
  ).bind(number, now()).run();

  const mem = await env.DB.prepare(
    "SELECT COUNT(*) AS c FROM searches WHERE phone=?"
  ).bind(number).first();

  const rep = await env.DB.prepare(
    "SELECT COUNT(*) AS c FROM reports WHERE phone=?"
  ).bind(number).first();

  const blk = await env.DB.prepare(
    "SELECT COUNT(*) AS c FROM blacklist WHERE phone=?"
  ).bind(number).first();

  const operator = detectOperator(number);
  const city = detectCity(number);
  const keywords = detectKeywords(number, operator);

  let score = 15 + mem.c * 8 + rep.c * 18 + blk.c * 35 + keywords.length * 7;
  if (score > 100) score = 100;

  const risk = score >= 75 ? "Yüksek" : score >= 45 ? "Orta" : "Düşük";

  return {
    number,
    normalized: number,
    operator,
    city,
    memoryHits: mem.c,
    reportCount: rep.c,
    blacklist: blk.c > 0,
    score,
    risk,
    aiComment: `AI dedektif motoru bu numaranın operatör paterni, D1 geçmiş hafızası, kullanıcı ihbarları, kara liste durumu ve risk kelime kümelerini birlikte değerlendirerek ${risk.toLowerCase()} risk taşıdığını düşünüyor.`,
    complaints: [
      `${mem.c} geçmiş sorgu bulundu.`,
      `${rep.c} kullanıcı ihbarı bulundu.`,
      blk.c > 0 ? "Numara kara listede kayıtlı." : "Kara liste kaydı yok."
    ],
    keywords,
    webResults: [
      {
        title: `${number} şikayet / spam araması`,
        link: `https://www.google.com/search?q=${encodeURIComponent(number + " şikayet spam")}`
      },
      {
        title: `${number} dolandırıcı mı?`,
        link: `https://www.google.com/search?q=${encodeURIComponent(number + " dolandırıcı mı")}`
      }
    ]
  };
}

function detectOperator(n) {
  if (n.startsWith("0312")) return "Sabit Hat";
  if (n.startsWith("0850") || n.startsWith("444")) return "Çağrı Merkezi";
  if (n.startsWith("0549")) return "Vodafone";
  if (n.startsWith("0532")) return "Turkcell";
  if (n.startsWith("0555")) return "Türk Telekom";
  if (n.startsWith("05")) return "Mobil Hat";
  return "Bilinmeyen Hat";
}

function detectCity(n) {
  if (n.startsWith("0312")) return "Ankara";
  if (n.startsWith("0212")) return "İstanbul Avrupa";
  if (n.startsWith("0216")) return "İstanbul Anadolu";
  if (n.startsWith("0232")) return "İzmir";
  if (n.startsWith("0236")) return "Manisa";
  if (n.startsWith("05")) return "Mobil hatlarda şehir kesin bilinmez";
  return "-";
}

function detectKeywords(n, op) {
  const arr = [];
  if (op === "Sabit Hat") arr.push("sabit hat");
  if (op === "Çağrı Merkezi") arr.push("çağrı merkezi", "robot", "spam");
  if (n.startsWith("0312624")) arr.push("çağrı merkezi", "rahatsız", "sessiz", "outbound");
  if (n.startsWith("05")) arr.push("mobil hat");
  return [...new Set(arr)];
}

async function getDashboardStats(env) {
  const total = await env.DB.prepare("SELECT COUNT(DISTINCT phone) AS c FROM searches").first();
  const reports = await env.DB.prepare("SELECT COUNT(*) AS c FROM reports").first();
  const black = await env.DB.prepare("SELECT COUNT(*) AS c FROM blacklist").first();

  const top = await env.DB.prepare(
    "SELECT phone, COUNT(*) AS c FROM searches GROUP BY phone ORDER BY c DESC LIMIT 10"
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
body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Arial;background:radial-gradient(circle at top,#1d4ed8,#020617);color:#fff}
.app{max-width:650px;margin:auto;padding:22px}
.card{background:#111827;border:1px solid #334155;border-radius:30px;padding:22px;margin:18px 0}
input{width:100%;padding:20px;font-size:22px;border-radius:20px;border:0;background:#020617;color:#fff;box-sizing:border-box}
button{width:100%;padding:20px;border:0;border-radius:20px;font-size:22px;font-weight:800;background:linear-gradient(90deg,#2563eb,#7c3aed);color:#fff}
.bar{height:16px;background:#1e293b;border-radius:20px;overflow:hidden}
.fill{height:100%;width:0%;background:linear-gradient(90deg,#22c55e,#eab308,#ef4444);transition:1.5s}
.tag{display:inline-block;background:#2b3445;padding:8px 14px;border-radius:20px;margin:4px}
a{color:#60a5fa}
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

<div id="sonuc"></div>

<div class="card">
<button onclick="location.href='/dashboard'">📊 Dashboard</button>
</div>
</div>

<script>
async function tara(){
  const n=document.getElementById("num").value.trim();
  if(!n) return alert("Numara gir");

  sonuc.innerHTML='<div class="card"><h2>🧠 AI analiz ediyor...</h2></div>';

  const r=await fetch('/analyze?number='+encodeURIComponent(n)+'&v='+Date.now());
  const d=await r.json();

  if(d.error){
    sonuc.innerHTML='<div class="card"><h2>Hata</h2><p>'+d.message+'</p></div>';
    return;
  }

  if(d.score>=75 && navigator.vibrate){navigator.vibrate([300,100,300]);}

  sonuc.innerHTML =
  '<div class="card"><h2>Risk Seviyesi</h2><div style="font-size:64px;font-weight:900">'+d.risk+'</div><div class="bar"><div id="fill" class="fill"></div></div><br><b>Skor:</b> '+d.score+'<br><b>Hafıza:</b> '+d.memoryHits+'<br><b>İhbar:</b> '+d.reportCount+'<br><b>Kara Liste:</b> '+(d.blacklist?'EVET':'HAYIR')+'</div>'+
  '<div class="card"><h2>🤖 AI Yorumu</h2><p>'+d.aiComment+'</p></div>'+
  '<div class="card"><h2>📇 Numara Kimliği</h2><p><b>Operatör:</b> '+d.operator+'</p><p><b>Şehir:</b> '+d.city+'</p></div>'+
  '<div class="card"><h2>🚨 Bulgular</h2><ul>'+d.complaints.map(x=>'<li>'+x+'</li>').join('')+'</ul></div>'+
  '<div class="card"><h2>🧬 Risk Kelimeleri</h2>'+d.keywords.map(x=>'<span class="tag">'+x+'</span>').join('')+'</div>'+
  '<div class="card"><h2>🌍 Google Açık Web</h2>'+d.webResults.map(x=>'<p><a target="_blank" href="'+x.link+'">'+x.title+'</a></p>').join('')+'</div>'+
  '<div class="card"><button onclick="spamIhbar()">🚨 Spam İhbar</button><br><br><button onclick="karaListe()">⛔ Kara Liste</button></div>';

  setTimeout(()=>{document.getElementById("fill").style.width=d.score+"%";},200);
}

async function spamIhbar(){
  const n=document.getElementById("num").value.trim();
  if(!n) return;
  await fetch('/report?number='+encodeURIComponent(n)+'&type=spam&note=manuel');
  alert("İhbar kaydedildi");
  tara();
}

async function karaListe(){
  const n=document.getElementById("num").value.trim();
  if(!n) return;
  await fetch('/blacklist?number='+encodeURIComponent(n)+'&reason=manuel');
  alert("Kara listeye eklendi");
  tara();
}
</script>
</body>
</html>`;
}

function renderDashboard(stats) {
  return `<!DOCTYPE html>
<html lang="tr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Dashboard</title>
<style>
body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Arial;background:radial-gradient(circle at top,#1d4ed8,#020617);color:#fff}
.app{max-width:650px;margin:auto;padding:22px}
.card{background:#111827;border:1px solid #334155;border-radius:30px;padding:22px;margin:18px 0}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:18px}
.value{font-size:52px;font-weight:900}
button{width:100%;padding:20px;border:0;border-radius:20px;font-size:22px;font-weight:800;background:linear-gradient(90deg,#2563eb,#7c3aed);color:#fff}
li{margin:10px 0}
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

<div class="card">
<h2>🔥 En Çok Sorgulananlar</h2>
<ul>${stats.top.map(x=>`<li>${x.phone} — ${x.c} sorgu</li>`).join("") || "<li>Kayıt yok</li>"}</ul>
</div>

<div class="card">
<button onclick="location.href='/'">🏠 Ana Ekrana Dön</button>
</div>

</div>
</body>
</html>`;
}
