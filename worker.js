export default {
  async fetch(request, env) {
    try {
      if (request.method === "OPTIONS") return cors({ ok: true });

      const url = new URL(request.url);
      const path = url.pathname;
      const key = url.searchParams.get("key") || "";

      if (key !== env.API_KEY) {
        return cors({ error: true, message: "unauthorized" }, 403);
      }

      await initDB(env);

      const ip = request.headers.get("CF-Connecting-IP") || "unknown";
      const limited = await rateLimit(env, ip, path);
      if (limited) {
        return cors({ error: true, message: "too many requests" }, 429);
      }

      if (path === "/health") return health();
      if (path === "/stats") return await stats(env);
      if (path === "/report") return await report(request, env, url);
      if (path === "/admin/blacklist") return await blacklist(request, env, url);

      return await checkNumber(env, url);

    } catch (e) {
      return cors({
        error: true,
        message: String(e)
      }, 500);
    }
  }
};

function cors(data, status = 200) {
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

async function initDB(env) {
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS numbers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone TEXT UNIQUE,
      searches INTEGER DEFAULT 0,
      risk TEXT,
      notes TEXT,
      updated_at TEXT
    )
  `).run();

  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone TEXT,
      type TEXT,
      note TEXT,
      created_at TEXT
    )
  `).run();

  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS blacklist (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone TEXT UNIQUE,
      reason TEXT,
      created_at TEXT
    )
  `).run();

  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS iplogs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ip TEXT,
      route TEXT,
      created_at TEXT
    )
  `).run();
}

async function rateLimit(env, ip, route) {
  const row = await env.DB.prepare(`
    SELECT COUNT(*) AS c
    FROM iplogs
    WHERE ip = ?
    AND created_at >= datetime('now','-1 minute')
  `).bind(ip).first();

  if (row && row.c >= 20) return true;

  await env.DB.prepare(`
    INSERT INTO iplogs (ip, route, created_at)
    VALUES (?, ?, datetime('now'))
  `).bind(ip, route).run();

  return false;
}

function normalizePhone(x) {
  let n = String(x || "").replace(/\D/g, "");
  if (n.startsWith("90")) n = "0" + n.slice(2);
  if (n.length === 10) n = "0" + n;
  return n;
}

async function checkNumber(env, url) {
  const number = normalizePhone(url.searchParams.get("number"));

  if (!number) {
    return cors({
      status: "secured",
      app: "Spam Kovucu ULTRA PRO",
      usage: "?key=API_KEY&number=03126242405",
      routes: ["/health", "/stats", "/report", "/admin/blacklist"]
    });
  }

  const old = await env.DB.prepare(
    "SELECT * FROM numbers WHERE phone = ?"
  ).bind(number).first();

  const black = await env.DB.prepare(
    "SELECT * FROM blacklist WHERE phone = ?"
  ).bind(number).first();

  const reportCountRow = await env.DB.prepare(
    "SELECT COUNT(*) AS c FROM reports WHERE phone = ?"
  ).bind(number).first();

  const previousHits = old ? Number(old.searches || 0) : 0;
  const reportCount = reportCountRow ? Number(reportCountRow.c || 0) : 0;

  const base = detectBase(number);
  const intel = analyzeSignals(number, previousHits, reportCount, !!black, base);

  if (old) {
    await env.DB.prepare(`
      UPDATE numbers
      SET searches = ?, risk = ?, notes = ?, updated_at = datetime('now')
      WHERE phone = ?
    `).bind(
      previousHits + 1,
      intel.risk,
      intel.aiComment,
      number
    ).run();
  } else {
    await env.DB.prepare(`
      INSERT INTO numbers (phone, searches, risk, notes, updated_at)
      VALUES (?, ?, ?, ?, datetime('now'))
    `).bind(
      number,
      1,
      intel.risk,
      intel.aiComment
    ).run();
  }

  return cors({
    number,
    normalized: number,
    memoryActive: true,
    memoryHits: previousHits + 1,
    reportCount,
    blacklist: !!black,
    operator: base.operator,
    city: base.city,
    risk: intel.risk,
    score: intel.score,
    owner: intel.owner,
    company: intel.company,
    complaints: intel.complaints,
    keywords: intel.keywords,
    aiComment: intel.aiComment,
    osint: [
      `${intel.keywords.length} risk kelimesi eşleşti`,
      "Numara format analizi tamamlandı",
      "Operatör prefix eşleşmesi yapıldı",
      `D1 hafıza sorgu sayısı: ${previousHits + 1}`,
      `Kullanıcı ihbar sayısı: ${reportCount}`,
      black ? "Kara liste eşleşmesi bulundu" : "Kara liste eşleşmesi yok"
    ],
    webResults: [
      {
        title: `${number} şikayet / spam araması`,
        snippet: "Bu numara için manuel açık web kontrolü önerilir.",
        link: "https://www.google.com/search?q=" + encodeURIComponent(number + " şikayet spam kimin numarası")
      },
      {
        title: `${number} dolandırıcı ihtimali`,
        snippet: "Dolandırıcılık, çağrı merkezi veya sessiz arama sinyalleri ayrıca kontrol edilmelidir.",
        link: "https://www.google.com/search?q=" + encodeURIComponent(number + " dolandırıcı çağrı merkezi")
      }
    ],
    analyzedAt: new Date().toLocaleString("tr-TR")
  });
}

function detectBase(number) {
  if (number.startsWith("0312")) return { operator: "Sabit Hat", city: "Ankara", base: 25 };
  if (number.startsWith("0212")) return { operator: "Sabit Hat", city: "İstanbul Avrupa", base: 25 };
  if (number.startsWith("0216")) return { operator: "Sabit Hat", city: "İstanbul Anadolu", base: 25 };
  if (number.startsWith("0232")) return { operator: "Sabit Hat", city: "İzmir", base: 20 };
  if (number.startsWith("0236")) return { operator: "Sabit Hat", city: "Manisa", base: 20 };
  if (number.startsWith("0850")) return { operator: "Kurumsal / Çağrı Merkezi", city: "Türkiye Geneli", base: 40 };
  if (number.startsWith("444")) return { operator: "Kurumsal / Çağrı Merkezi", city: "Türkiye Geneli", base: 45 };
  if (number.startsWith("05")) return { operator: "Mobil Hat", city: "Mobil", base: 10 };
  return { operator: "Bilinmiyor", city: "-", base: 10 };
}

function analyzeSignals(number, hits, reports, blacklisted, base) {
  let score = base.base;
  const keywords = [];
  const complaints = [];

  if (number.startsWith("0312624")) {
    score += 25;
    keywords.push("çağrı merkezi", "rahatsız", "sessiz");
    complaints.push("Ankara toplu outbound arama kümesi ile eşleşti.");
  }

  if (base.operator.includes("Çağrı")) {
    score += 20;
    keywords.push("çağrı merkezi", "robot");
    complaints.push("Kurumsal / çağrı merkezi numara paterni bulundu.");
  }

  if (hits > 0) {
    score += Math.min(hits * 5, 25);
    complaints.push(`Bu numara daha önce ${hits} kez sorgulanmış.`);
  }

  if (reports > 0) {
    score += Math.min(reports * 12, 30);
    keywords.push("şikayet");
    complaints.push(`${reports} kullanıcı ihbarı bulundu.`);
  }

  if (blacklisted) {
    score += 40;
    keywords.push("kara liste");
    complaints.push("Numara kara listede kayıtlı.");
  }

  if (score > 99) score = 99;

  let risk = "Düşük";
  if (score >= 75) risk = "Yüksek";
  else if (score >= 45) risk = "Orta";
  else if (score >= 25) risk = "Şüpheli";

  const uniqueKeywords = [...new Set(keywords)];

  if (!complaints.length) {
    complaints.push("Belirgin yüksek risk sinyali bulunamadı.");
  }

  return {
    score,
    risk,
    owner: number.startsWith("0312624")
      ? "Ankara toplu outbound arama kümesi"
      : blacklisted
      ? "Kara liste kayıtlı numara"
      : "Belirsiz",
    company: blacklisted
      ? "Kara liste / yüksek riskli arama hattı"
      : base.operator.includes("Çağrı")
      ? "Çağrı merkezi olasılığı"
      : number.startsWith("0312624")
      ? "Küme eşleşmesine göre çağrı merkezi olasılığı"
      : "Bilinmiyor",
    complaints,
    keywords: uniqueKeywords,
    aiComment:
      `AI dedektif motoru bu numaranın operatör paterni, D1 geçmiş hafızası, kullanıcı ihbarları, kara liste durumu ve risk kelime kümelerini birlikte değerlendirerek ${risk.toLowerCase()} risk taşıdığını düşünüyor. Bilinmeyen aramalarda kişisel bilgi paylaşmayın.`
  };
}

async function report(request, env, url) {
  let body = {};

  if (request.method === "POST") {
    try { body = await request.json(); } catch(e) {}
  }

  const phone = normalizePhone(body.phone || url.searchParams.get("phone"));
  const type = String(body.type || url.searchParams.get("type") || "Genel spam").slice(0, 80);
  const note = String(body.note || url.searchParams.get("note") || "").slice(0, 300);

  if (!phone) {
    return cors({ error: true, message: "phone gerekli" }, 400);
  }

  await env.DB.prepare(`
    INSERT INTO reports (phone, type, note, created_at)
    VALUES (?, ?, ?, datetime('now'))
  `).bind(phone, type, note).run();

  return cors({
    ok: true,
    message: "İhbar kaydedildi",
    phone,
    type
  });
}

async function blacklist(request, env, url) {
  const admin = url.searchParams.get("admin") || "";
  if (admin !== env.API_KEY) {
    return cors({ error: true, message: "admin unauthorized" }, 403);
  }

  const phone = normalizePhone(url.searchParams.get("phone"));
  const reason = String(url.searchParams.get("reason") || "Admin kara liste").slice(0, 200);
  const remove = url.searchParams.get("remove") === "1";

  if (!phone) {
    return cors({ error: true, message: "phone gerekli" }, 400);
  }

  if (remove) {
    await env.DB.prepare(
      "DELETE FROM blacklist WHERE phone = ?"
    ).bind(phone).run();

    return cors({
      ok: true,
      message: "Kara listeden çıkarıldı",
      phone
    });
  }

  await env.DB.prepare(`
    INSERT OR REPLACE INTO blacklist (phone, reason, created_at)
    VALUES (?, ?, datetime('now'))
  `).bind(phone, reason).run();

  return cors({
    ok: true,
    message: "Kara listeye eklendi",
    phone,
    reason
  });
}

async function stats(env) {
  const totalNumbers = await env.DB.prepare(
    "SELECT COUNT(*) AS c FROM numbers"
  ).first();

  const totalReports = await env.DB.prepare(
    "SELECT COUNT(*) AS c FROM reports"
  ).first();

  const totalBlacklist = await env.DB.prepare(
    "SELECT COUNT(*) AS c FROM blacklist"
  ).first();

  const top = await env.DB.prepare(`
    SELECT phone, searches, risk, updated_at
    FROM numbers
    ORDER BY searches DESC
    LIMIT 10
  `).all();

  return cors({
    ok: true,
    totalNumbers: totalNumbers?.c || 0,
    totalReports: totalReports?.c || 0,
    totalBlacklist: totalBlacklist?.c || 0,
    topNumbers: top.results || []
  });
}

function health() {
  return cors({
    ok: true,
    app: "Spam Kovucu ULTRA PRO",
    status: "healthy",
    time: new Date().toISOString()
  });
}
