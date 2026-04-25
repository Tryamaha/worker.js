export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      const path = url.pathname;

      await initDB(env);

      if (request.method === "OPTIONS") return json({ ok: true });

      if (path === "/") return html(APP_HTML);
      if (path === "/health") return json({ ok: true, app: "Spam Kovucu ULTRA MAX", status: "healthy", time: new Date().toISOString() });
      if (path === "/dashboard") return html(renderDashboard(await getStats(env)));
      if (path === "/stats") return json(await getStats(env));
      if (path === "/analyze") return json(await analyze(url, env, request));
      if (path === "/report") return json(await report(request, env, url));
      if (path === "/blacklist") return json(await blacklist(request, env, url));

      return json({ error: true, message: "Endpoint bulunamadı" }, 404);
    } catch (e) {
      return json({ error: true, message: String(e) }, 500);
    }
  }
};

async function initDB(env) {
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS memory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone TEXT UNIQUE,
    searches INTEGER DEFAULT 0,
    updated_at TEXT
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

  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS iplogs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ip TEXT,
    created_at TEXT
  )`).run();
}

function normalizePhone(v) {
  let n = String(v || "").replace(/\D/g, "");
  if (n.startsWith("90")) n = "0" + n.slice(2);
  if (n.length === 10) n = "0" + n;
  return n;
}

async function analyze(url, env, request) {
  const number = normalizePhone(url.searchParams.get("number") || url.searchParams.get("phone"));
  if (!number) return { error: true, message: "Numara gerekli" };

  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  await env.DB.prepare("INSERT INTO iplogs (ip, created_at) VALUES (?, ?)").bind(ip, now()).run();

  const old = await env.DB.prepare("SELECT * FROM memory WHERE phone=?").bind(number).first();
  const oldHits = old ? Number(old.searches || 0) : 0;
  const newHits = oldHits + 1;

  if (old) {
    await env.DB.prepare("UPDATE memory SET searches=?, updated_at=? WHERE phone=?").bind(newHits, now(), number).run();
  } else {
    await env.DB.prepare("INSERT INTO memory (phone, searches, updated_at) VALUES (?, ?, ?)").bind(number, 1, now()).run();
  }

  const reports = await env.DB.prepare("SELECT COUNT(*) AS c FROM reports WHERE phone=?").bind(number).first();
  const black = await env.DB.prepare("SELECT * FROM blacklist WHERE phone=?").bind(number).first();

  const id = identify(number);
  const reportCount = Number(reports?.c || 0);
  const blacklisted = !!black;

  const keywords = [];
  const complaints = [];

  if (number.startsWith("0312624")) {
    keywords.push("çağrı merkezi", "rahatsız", "sessiz", "sabit hat");
    complaints.push("Ankara toplu outbound arama kümesi ile eşleşti.");
  }

  if (number.startsWith("0850") || number.startsWith("444")) {
    keywords.push("çağrı merkezi", "robot", "spam");
    complaints.push("Kurumsal / çağrı merkezi paterni bulundu.");
  }

  if (number.startsWith("05")) {
    keywords.push("mobil hat");
  }

  if (reportCount > 0) complaints.push(`${reportCount} kullanıcı ihbarı bulundu.`);
  if (blacklisted) complaints.push("Numara kara listede kayıtlı.");
  if (!complaints.length) complaints.push("Belirgin yüksek risk sinyali bulunamadı.");

  let score = id.base + keywords.length * 7 + Math.min(newHits * 5, 25) + Math.min(reportCount * 15, 30);
  if (blacklisted) score += 35;
  if (score > 100) score = 100;

  let risk = "Düşük";
  if (score >= 45) risk = "Orta";
  if (score >= 75) risk = "Yüksek";

  return {
    number,
    normalized: number,
    memoryActive: true,
    memoryHits: newHits,
    reportCount,
    blacklist: blacklisted,
    operator: id.operator,
    city: id.city,
    risk,
    score,
    owner: id.owner,
    company: id.company,
    keywords: [...new Set(keywords)],
    complaints,
    aiComment: `AI dedektif motoru bu numaranın operatör paterni, D1 geçmiş hafızası, kullanıcı ihbarları, kara liste durumu ve risk kelime kümelerini birlikte değerlendirerek ${risk.toLowerCase()} risk taşıdığını düşünüyor.`,
    osint: [
      `${keywords.length} risk kelimesi eşleşti`,
      "Operatör prefix eşleşmesi yapıldı",
      `D1 hafıza sorgu sayısı: ${newHits}`,
      `Kullanıcı ihbar sayısı: ${reportCount}`,
      blacklisted ? "Kara liste eşleşmesi bulundu" : "Kara liste eşleşmesi yok"
    ],
    webResults: [
      {
        title: `${number} şikayet / spam araması`,
        snippet: "Bu numara hakkında açık web üzerinde şikayet/spam kontrolü yapılabilir.",
        link: "https://www.google.com/search?q=" + encodeURIComponent(number + " şikayet spam kimin numarası")
      },
      {
        title: `${number} dolandırıcı mı?`,
        snippet: "Dolandırıcılık, çağrı merkezi ve sessiz arama kayıtları için hazır Google araması.",
        link: "https://www.google.com/search?q=" + encodeURIComponent(number + " dolandırıcı çağrı merkezi")
      }
    ],
    analyzedAt: new Date().toLocaleString("tr-TR")
  };
}

function identify(n) {
  if (n.startsWith("0312")) return { operator: "Sabit Hat", city: "Ankara", base: 25, owner: "Ankara toplu outbound arama kümesi", company: "Küme eşleşmesine göre çağrı merkezi olasılığı" };
  if (n.startsWith("0212")) return { operator: "Sabit Hat", city: "İstanbul Avrupa", base: 25, owner: "İstanbul Avrupa sabit hat", company: "Bilinmiyor" };
  if (n.startsWith("0216")) return { operator: "Sabit Hat", city: "İstanbul Anadolu", base: 25, owner: "İstanbul Anadolu sabit hat", company: "Bilinmiyor" };
  if (n.startsWith("0232")) return { operator: "Sabit Hat", city: "İzmir", base: 20, owner: "İzmir sabit hat", company: "Bilinmiyor" };
  if (n.startsWith("0236")) return { operator: "Sabit Hat", city: "Manisa", base: 20, owner: "Manisa sabit hat", company: "Bilinmiyor" };
  if (n.startsWith("0850")) return { operator: "Kurumsal / Çağrı Merkezi", city: "Türkiye Geneli", base: 45, owner: "Kurumsal çağrı merkezi", company: "Çağrı merkezi olasılığı" };
  if (n.startsWith("444")) return { operator: "Kurumsal / Çağrı Merkezi", city: "Türkiye Geneli", base: 45, owner: "Kurumsal çağrı merkezi", company: "Çağrı merkezi olasılığı" };
  if (n.startsWith("05")) return { operator: "Mobil Hat", city: "Mobil", base: 10, owner: "Mobil hat", company: "Kesin firma için web kontrolü gerekir" };
  return { operator: "Bilinmiyor", city: "-", base: 10, owner: "Belirsiz", company: "Bilinmiyor" };
}

async function report(request, env, url) {
  let body = {};
  if (request.method === "POST") {
    try { body = await request.json(); } catch {}
  }

  const phone = normalizePhone(body.phone || url.searchParams.get("phone") || url.searchParams.get("number"));
  const type = String(body.type || url.searchParams.get("type") || "spam").slice(0, 80);
  const note = String(body.note || url.searchParams.get("note") || "").slice(0, 300);

  if (!phone) return { error: true, message: "Numara gerekli" };

  await env.DB.prepare("INSERT INTO reports (phone,type,note,created_at) VALUES (?,?,?,?)")
    .bind(phone, type, note, now()).run();

  return { ok: true, message: "İhbar kaydedildi", phone, type };
}

async function blacklist(request, env, url) {
  let body = {};
  if (request.method === "POST") {
    try { body = await request.json(); } catch {}
  }

  const phone = normalizePhone(body.phone || url.searchParams.get("phone") || url.searchParams.get("number"));
  const reason = String(body.reason || url.searchParams.get("reason") || "manuel").slice(0, 200);
  const remove = url.searchParams.get("remove") === "1";

  if (!phone) return { error: true, message: "Numara gerekli" };

  if (remove) {
    await env.DB.prepare("DELETE FROM blacklist WHERE phone=?").bind(phone).run();
    return { ok: true, message: "Kara listeden çıkarıldı", phone };
  }

  await env.DB.prepare("INSERT OR REPLACE INTO blacklist (phone,reason,created_at) VALUES (?,?,?)")
    .bind(phone, reason, now()).run();

  return { ok: true, message: "Kara listeye eklendi", phone, reason };
}

async function getStats(env) {
  const numbers = await env.DB.prepare("SELECT COUNT(*) AS c FROM memory").first();
  const reports = await env.DB.prepare("SELECT COUNT(*) AS c FROM reports").first();
  const black = await env.DB.prepare("SELECT COUNT(*) AS c FROM blacklist").first();

  const top = await env.DB.prepare(`
    SELECT phone, searches, updated_at
    FROM memory
    ORDER BY searches DESC
    LIMIT 10
  `).all();

  return {
    ok: true,
    totalNumbers: numbers?.c || 0,
    totalReports: reports?.c || 0,
    totalBlacklist: black?.c || 0,
    topNumbers: top.results || []
  };
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

function html(content) {
  return new Response(content, {
    headers: {
      "content-type": "text/html;charset=utf-8",
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0"
    }
  });
}

function now() {
  return new Date().toISOString();
}

function renderDashboard(stats) {
  return `
<!DOCTYPE html>
<html lang="tr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Spam Kovucu Dashboard</title>
<style>
body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Arial;background:#020617;color:white}
.app{max-width:520px;margin:auto;padding:22px}
.card{background:#111827;border:1px solid #334155;border-radius:24px;padding:20px;margin:16px 0}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.value{font-size:44px;font-weight:900}.label{color:#94a3b8;font-size:20px}h1{font-size:42px}
</style>
</head>
<body>
<div class="app">
<h1>🛡️ Spam Kovucu Dashboard</h1>
<div class="grid">
<div class="card"><div class="label">Numara</div><div class="value">${stats.totalNumbers}</div></div>
<div class="card"><div class="label">İhbar</div><div class="value">${stats.totalReports}</div></div>
<div class="card"><div class="label">Kara Liste</div><div class="value">${stats.totalBlacklist}</div></div>
<div class="card"><div class="label">Durum</div><div class="value">Aktif</div></div>
</div>
<div class="card"><h2>En Çok Sorgulananlar</h2><ul>${(stats.topNumbers||[]).map(x=>`<li>${x.phone} — ${x.searches} sorgu</li>`).join("")}</ul></div>
</div>
</body>
</html>`;
}

const APP_HTML = `
<!DOCTYPE html>
<html lang="tr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0,viewport-fit=cover">
<title>Spam Kovucu Ultra Max</title>
<style>
*{box-sizing:border-box}
body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif;background:radial-gradient(circle at top,#1e3a8a,#020617 45%,#000);color:white}
.app{max-width:520px;margin:auto;padding:18px 18px 45px}
h1{font-size:34px;margin:18px 0 6px}.sub{color:#a5b4fc;margin-bottom:14px}
.card{background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.14);border-radius:26px;padding:18px;margin:14px 0;box-shadow:0 18px 40px rgba(0,0,0,.25)}
input{width:100%;padding:17px;border-radius:18px;border:1px solid rgba(255,255,255,.18);background:#020617;color:white;font-size:20px}
button{border:0;border-radius:18px;padding:15px;color:white;font-weight:900;background:linear-gradient(135deg,#2563eb,#7c3aed);font-size:16px;width:100%}
.row{display:flex;gap:10px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.stat{background:rgba(255,255,255,.07);border-radius:18px;padding:14px}.label{color:#94a3b8;font-size:13px}.value{font-size:22px;font-weight:900}
.risk{font-size:44px;font-weight:950}.bar{height:15px;background:rgba(255,255,255,.12);border-radius:999px;overflow:hidden}.fill{height:100%;width:0;background:linear-gradient(90deg,#22c55e,#facc15,#ef4444)}
.hidden{display:none}.red{color:#ef4444}.yellow{color:#facc15}.green{color:#22c55e}
.badge{display:inline-block;margin:5px 5px 0 0;padding:8px 12px;border-radius:999px;background:rgba(255,255,255,.12)}
li{margin:8px 0;color:#dbeafe}.small{color:#94a3b8;font-size:13px}a{color:#38bdf8}
</style>
</head>
<body>
<div class="app">
<h1>🛡️ Spam Kovucu Ultra Max</h1>
<div class="sub">AI + D1 Hafıza + İhbar + Kara Liste + Google OSINT</div>

<div class="card">
<div class="label">Telefon numarası</div>
<div class="row" style="margin-top:10px">
<input id="num" inputmode="tel" placeholder="03126242405">
<button onclick="check()">Tara</button>
</div>
<p class="small">Bilinmeyen aramalarda kişisel bilgi paylaşma.</p>
</div>

<div id="load" class="card hidden"><h2>🧠 AI analiz ediyor...</h2></div>

<div id="res" class="hidden">
<div class="card">
<div class="label">Risk Seviyesi</div>
<div id="risk" class="risk">-</div>
<div class="bar"><div id="fill" class="fill"></div></div>
<div class="grid" style="margin-top:14px">
<div class="stat"><div class="label">Skor</div><div id="score" class="value">-</div></div>
<div class="stat"><div class="label">Hafıza</div><div id="hits" class="value">-</div></div>
<div class="stat"><div class="label">İhbar</div><div id="reports" class="value">-</div></div>
<div class="stat"><div class="label">Kara Liste</div><div id="black" class="value">-</div></div>
</div>
</div>

<div class="card">
<h2>📇 Numara Kimliği</h2>
<p><b>Operatör:</b> <span id="operator">-</span></p>
<p><b>Şehir:</b> <span id="city">-</span></p>
<p><b>Sahip:</b> <span id="owner">-</span></p>
<p><b>Firma:</b> <span id="company">-</span></p>
</div>

<div class="card"><h2>🤖 AI Dedektif Yorumu</h2><p id="ai" style="line-height:1.6;color:#dbeafe">-</p></div>
<div class="card"><h2>🚨 Bulgular</h2><ul id="complaints"></ul></div>
<div class="card"><h2>🧬 Risk Kelimeleri</h2><div id="keywords"></div></div>
<div class="card"><h2>🌐 Google Açık Web Bulguları</h2><div id="web"></div></div>

<div class="card">
<div class="grid">
<button onclick="spamIhbar()">🚨 Spam İhbar</button>
<button onclick="karaListe()">⛔ Kara Liste</button>
</div>
</div>

<div class="card"><button onclick="location.href='/dashboard'">📊 Dashboard</button></div>
</div>
</div>

<script>
let lastPhone="";

async function check(){
  const n=document.getElementById("num").value.trim();
  if(!n){alert("Numara gir");return}
  lastPhone=n;
  document.getElementById("res").classList.add("hidden");
  document.getElementById("load").classList.remove("hidden");

  try{
    const r=await fetch("/analyze?number="+encodeURIComponent(n)+"&t="+Date.now(),{cache:"no-store"});
    const d=await r.json();

    document.getElementById("load").classList.add("hidden");
    document.getElementById("res").classList.remove("hidden");

    document.getElementById("risk").innerText=d.risk || "-";
    document.getElementById("risk").className="risk "+(d.risk==="Yüksek"?"red":d.risk==="Orta"?"yellow":"green");
    document.getElementById("score").innerText=d.score ?? "-";
    document.getElementById("hits").innerText=d.memoryHits ?? "-";
    document.getElementById("reports").innerText=d.reportCount ?? "-";
    document.getElementById("black").innerText=d.blacklist ? "EVET" : "HAYIR";
    document.getElementById("operator").innerText=d.operator || "-";
    document.getElementById("city").innerText=d.city || "-";
    document.getElementById("owner").innerText=d.owner || "-";
    document.getElementById("company").innerText=d.company || "-";
    document.getElementById("ai").innerText=d.aiComment || "-";

    let width=Number(d.score||0); if(width>100) width=100;
    document.getElementById("fill").style.width=width+"%";

    document.getElementById("complaints").innerHTML=(d.complaints||[]).map(x=>"<li>"+x+"</li>").join("") || "<li>Şikayet kaydı yok</li>";
    document.getElementById("keywords").innerHTML=(d.keywords||[]).map(x=>'<span class="badge">'+x+"</span>").join("") || "Yok";
    document.getElementById("web").innerHTML=(d.webResults||[]).map(x=>'<p><b>'+x.title+'</b><br><span class="small">'+x.snippet+'</span><br><a href="'+x.link+'" target="_blank">Google Aç</a></p>').join("") || "Açık web sonucu yok";
  }catch(e){
    document.getElementById("load").classList.add("hidden");
    alert("Analiz hatası: "+e.message);
  }
}

async function spamIhbar(){
  if(!lastPhone)return;
  await fetch("/report",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({phone:lastPhone,type:"spam",note:"Safari kullanıcı spam ihbarı"})});
  alert("Spam ihbar kaydedildi");
  check();
}

async function karaListe(){
  if(!lastPhone)return;
  await fetch("/blacklist",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({phone:lastPhone,reason:"Safari manuel kara liste"})});
  alert("Kara listeye eklendi");
  check();
}
</script>
</body>
</html>
`;
