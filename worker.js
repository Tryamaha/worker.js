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
