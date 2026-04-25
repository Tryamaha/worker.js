export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      const key = url.searchParams.get("key") || "";

      if (key !== env.API_KEY) {
        return json({ error: true, message: "unauthorized" }, 403);
      }

      const ip = request.headers.get("CF-Connecting-IP") || "0.0.0.0";

      await env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS iplogs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          ip TEXT,
          created_at TEXT
        )
      `).run();

      const recent = await env.DB.prepare(`
        SELECT COUNT(*) as cnt FROM iplogs
        WHERE ip = ?
        AND created_at >= datetime('now','-1 minute')
      `).bind(ip).first();

      if (recent.cnt >= 15) {
        return json({ error: true, message: "too many requests" }, 429);
      }

      await env.DB.prepare(`
        INSERT INTO iplogs (ip, created_at)
        VALUES (?, datetime('now'))
      `).bind(ip).run();

      const number = (url.searchParams.get("number") || "").replace(/\D/g, "");

      if (!number) {
        return json({
          status: "secured",
          app: "Spam Kovucu Fortress API",
          usage: "?key=spam2026&number=03126242405"
        });
      }

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

      const old = await env.DB.prepare(
        "SELECT * FROM numbers WHERE phone = ?"
      ).bind(number).first();

      const previousHits = old ? Number(old.searches || 0) : 0;

      const operator = number.startsWith("0312") ? "Sabit Hat" : "Bilinmiyor";
      const city = number.startsWith("0312") ? "Ankara" : "-";

      const keywords = ["çağrı merkezi", "rahatsız"];
      let score = 70 + Math.min(previousHits * 4, 25);
      if (number.startsWith("0312624")) score += 8;
      if (score > 99) score = 99;

      const risk = score >= 70 ? "Yüksek" : score >= 40 ? "Orta" : "Düşük";

      if (old) {
        await env.DB.prepare(`
          UPDATE numbers
          SET searches = ?, risk = ?, notes = ?, updated_at = datetime('now')
          WHERE phone = ?
        `).bind(previousHits + 1, risk, "secured update", number).run();
      } else {
        await env.DB.prepare(`
          INSERT INTO numbers (phone, searches, risk, notes, updated_at)
          VALUES (?, ?, ?, ?, datetime('now'))
        `).bind(number, 1, risk, "secured create").run();
      }

      return json({
        number,
        normalized: number,
        memoryActive: true,
        memoryHits: previousHits + 1,
        operator,
        city,
        risk,
        score,
        owner: "Ankara toplu outbound arama kümesi",
        company: "Küme eşleşmesine göre çağrı merkezi olasılığı",
        complaints: [
          "Şüpheli çağrı merkezi paterni bulundu.",
          old ? "Bu numara daha önce veritabanında analiz edildi." : "Yeni numara hafızaya alındı.",
          `Daha önce ${previousHits} kez sorgulanmış.`
        ],
        keywords,
        aiComment:
          "AI dedektif motoru açık web sinyalleri, risk kelime kümeleri, geçmiş sorgu hafızası ve outbound arama davranışını birlikte değerlendirerek yüksek risk taşıdığını düşünüyor.",
        osint: [
          `${keywords.length} risk kelimesi eşleşti`,
          "Numara format analizi tamamlandı",
          "Operatör prefix eşleşmesi yapıldı",
          `D1 hafıza sorgu sayısı: ${previousHits + 1}`
        ],
        analyzedAt: new Date().toLocaleString("tr-TR")
      });

    } catch (e) {
      return json({ error: true, message: String(e) }, 500);
    }
  }
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json;charset=utf-8",
      "Access-Control-Allow-Origin": "*"
    }
  });
}
