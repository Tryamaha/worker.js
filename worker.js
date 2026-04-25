export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      const path = url.pathname;

      await initDB(env);

      if (path === "/" || path === "/health") {
        return json({
          ok: true,
          app: "Spam Kovucu ULTRA PRO MAX",
          status: "healthy",
          time: new Date().toISOString()
        });
      }

      if (path === "/dashboard") {
        const stats = await getStats(env);
        return html(renderDashboard(stats));
      }

      if (path === "/analyze") {
        const number = (url.searchParams.get("number") || "").replace(/\D/g, "");
        if (!number) return json({ error: true, message: "Numara gerekli" });

        const result = await analyzeNumber(number, env, request);
        return json(result);
      }

      if (path === "/report") {
        const number = (url.searchParams.get("number") || "").replace(/\D/g, "");
        const type = url.searchParams.get("type") || "spam";
        const note = url.searchParams.get("note") || "";
        if (!number) return json({ error: true, message: "Numara gerekli" });

        await env.DB.prepare(
          "INSERT INTO reports (phone,type,note,created_at) VALUES (?,?,?,?)"
        ).bind(number, type, note, now()).run();

        return json({ ok: true, message: "İhbar kaydedildi", phone: number, type });
      }

      if (path === "/blacklist") {
        const number = (url.searchParams.get("number") || "").replace(/\D/g, "");
        const reason = url.searchParams.get("reason") || "manuel";
        if (!number) return json({ error: true, message: "Numara gerekli" });

        await env.DB.prepare(
          "INSERT OR REPLACE INTO blacklist (phone,reason,created_at) VALUES (?,?,?)"
        ).bind(number, reason, now()).run();

        return json({ ok: true, message: "Kara listeye eklendi", phone: number, reason });
      }

      if (path === "/stats") {
        const stats = await getStats(env);
        return json(stats);
      }

      return json({ error: true, message: "Endpoint bulunamadı" });

    } catch (e) {
      return json({ error: true, message: e.toString() });
    }
  }
};

async function initDB(env) {
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS iplogs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ip TEXT,
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

  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS memory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone TEXT UNIQUE,
    searches INTEGER,
    updated_at TEXT
  )`).run();
}

async function analyzeNumber(number, env, request) {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";

  await env.DB.prepare(
    "INSERT INTO iplogs (ip,created_at) VALUES (?,?)"
  ).bind(ip, now()).run();

  const mem = await env.DB.prepare(
    "SELECT * FROM memory WHERE phone=?"
  ).bind(number).first();

  if (mem) {
    await env.DB.prepare(
      "UPDATE memory SET searches=?, updated_at=? WHERE phone=?"
    ).bind((mem.searches || 0) + 1, now(), number).run();
  } else {
    await env.DB.prepare(
      "INSERT INTO memory (phone,searches,updated_at) VALUES (?,?,?)"
    ).bind(number, 1, now()).run();
  }

  const reports = await env.DB.prepare(
    "SELECT COUNT(*) as c FROM reports WHERE phone=?"
  ).bind(number).first();

  const black = await env.DB.prepare(
    "SELECT * FROM blacklist WHERE phone=?"
  ).bind(number).first();

  const memory = await env.DB.prepare(
    "SELECT * FROM memory WHERE phone=?"
  ).bind(number).first();

  const operator = detectOperator(number);
  const city = detectCity(number);
  const keywords = detectKeywords(number);

  let score = 20;
  score += (memory?.searches || 0) * 8;
  score += (reports?.c || 0) * 15;
  score += keywords.length * 6;
  if (black) score += 25;
  if (score > 100) score = 100;

  let risk = "Düşük";
  if (score >= 70) risk = "Orta";
  if (score >= 85) risk = "Yüksek";

  return {
    number,
    normalized: number,
    memoryActive: true,
    memoryHits: memory?.searches || 1,
    reportCount: reports?.c || 0,
    blacklist: !!black,
    operator,
    city,
    risk,
    score,
    owner: city + " toplu outbound arama kümesi",
    company: "Küme eşleşmesine göre çağrı merkezi olasılığı",
    keywords,
    aiComment: `AI dedektif motoru bu numaranın operatör paterni, D1 geçmiş hafızası, kullanıcı ihbarları, kara liste durumu ve risk kelime kümelerini birlikte değerlendirerek ${risk.toLowerCase()} risk taşıdığını düşünüyor.`,
    complaints: [
      "Numara format analizi tamamlandı.",
      "D1 hafıza kontrolü yapıldı.",
      reports?.c ? `${reports.c} kullanıcı ihbarı bulundu.` : "Kullanıcı ihbarı bulunmadı.",
      black ? "Numara kara listede kayıtlı." : "Kara liste eşleşmesi yok."
    ],
    osint: [
      `${keywords.length} risk kelimesi eşleşti`,
      "Operatör prefix eşleşmesi yapıldı",
      `D1 hafıza sorgu sayısı: ${memory?.searches || 1}`,
      `Kullanıcı ihbar sayısı: ${reports?.c || 0}`
    ],
    webResults: [
      {
        title: `${number} şikayet / spam araması`,
        snippet: "Bu numara için manuel açık web kontrolü önerilir.",
        link: "https://www.google.com/search?q=" + encodeURIComponent(number + " şikayet spam kimin numarası")
      }
    ],
    analyzedAt: new Date().toLocaleString("tr-TR")
  };
}

function detectOperator(n) {
  if (n.startsWith("0312")) return "Sabit Hat";
  if (n.startsWith("0212")) return "Sabit Hat";
  if (n.startsWith("0216")) return "Sabit Hat";
  if (n.startsWith("0850")) return "Kurumsal / Çağrı Merkezi";
  if (n.startsWith("444")) return "Kurumsal / Çağrı Merkezi";
  if (n.startsWith("05")) return "Mobil Hat";
  return "Bilinmiyor";
}

function detectCity(n) {
  if (n.startsWith("0312")) return "Ankara";
  if (n.startsWith("0212")) return "İstanbul Avrupa";
  if (n.startsWith("0216")) return "İstanbul Anadolu";
  if (n.startsWith("0232")) return "İzmir";
  if (n.startsWith("0236")) return "Manisa";
  if (n.startsWith("0850") || n.startsWith("444")) return "Türkiye Geneli";
  if (n.startsWith("05")) return "Mobil";
  return "-";
}

function detectKeywords(n) {
  const arr = [];

  if (n.startsWith("0312624")) {
    arr.push("çağrı merkezi", "rahatsız", "sessiz");
  }

  if (n.startsWith("0850") || n.startsWith("444")) {
    arr.push("çağrı merkezi", "robot", "spam");
  }

  if (n.startsWith("0312")) {
    arr.push("sabit hat");
  }

  return [...new Set(arr)];
}

async function getStats(env) {
  const numbers = await env.DB.prepare("SELECT COUNT(*) as c FROM memory").first();
  const reports = await env.DB.prepare("SELECT COUNT(*) as c FROM reports").first();
  const black = await env.DB.prepare("SELECT COUNT(*) as c FROM blacklist").first();

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

function now() {
  return new Date().toISOString();
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json;charset=utf-8",
      "Access-Control-Allow-Origin": "*"
    }
  });
}

function html(content) {
  return new Response(content, {
    headers: {
      "content-type": "text/html;charset=utf-8"
    }
  });
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
body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif;background:#020617;color:white}
.app{max-width:520px;margin:auto;padding:18px}
.card{background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.14);border-radius:22px;padding:18px;margin:14px 0}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.value{font-size:32px;font-weight:900}
.label{color:#94a3b8}
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

<div class="card">
<h2>En Çok Sorgulananlar</h2>
<ul>
${(stats.topNumbers || []).map(x => `<li>${x.phone} — ${x.searches} sorgu</li>`).join("")}
</ul>
</div>

</div>
</body>
</html>`;
}
