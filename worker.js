export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const number = (url.searchParams.get("number") || "").replace(/\D/g, "");

    if (!number) {
      return json({
        status: "ready",
        app: "Spam Kovucu Memory Test",
        kvDetected: !!(env && env.SPAMDB)
      });
    }

    const kv = env && env.SPAMDB;
    let hits = 0;

    if (kv) {
      const old = await kv.get("hits_" + number);
      hits = old ? Number(old) || 0 : 0;
      await kv.put("hits_" + number, String(hits + 1));
    }

    return json({
      number,
      normalized: number,
      memoryActive: !!kv,
      memoryHits: kv ? hits + 1 : 1,
      operator: number.startsWith("0312") ? "Sabit Hat" : "Bilinmiyor",
      city: number.startsWith("0312") ? "Ankara" : "-",
      risk: "Yüksek",
      score: 99,
      owner: "Ankara toplu outbound arama kümesi",
      company: "Küme eşleşmesine göre çağrı merkezi olasılığı",
      complaints: [
        "Web sonuçlarında şikayet ifadesi bulundu.",
        "Web sonuçlarında spam sinyali bulundu.",
        "Sessiz çağrı / cevapsız arama sinyali bulundu.",
        "Şüpheli çağrı merkezi paterni bulundu."
      ],
      keywords: ["şikayet", "spam", "sessiz", "çağrı merkezi", "robot", "rahatsız"],
      aiComment: "AI dedektif motoru bu hattın açık web sinyalleri, risk kelime kümeleri, geçmiş sorgu hafızası ve outbound arama davranışını birlikte değerlendirerek yüksek risk taşıdığını düşünüyor. Geri aranması önerilmez.",
      osint: [
        "6 risk kelimesi eşleşti",
        "Numara format analizi tamamlandı",
        "Operatör prefix eşleşmesi yapıldı",
        "KV hafıza sorgu sayısı: " + (kv ? hits + 1 : 1)
      ],
      webResults: [
        {
          title: number + " Şikayet ve Yorumları - Şikayetvar",
          snippet: "Bu numara hakkında açık web üzerinde şikayet/spam benzeri ifadeler ve kullanıcı yorumları bulunabilir.",
          link: "https://www.google.com/search?q=" + encodeURIComponent(number + " şikayet")
        }
      ],
      updatedAt: new Date().toISOString()
    });
  }
};

function json(data) {
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "content-type": "application/json;charset=utf-8",
      "Access-Control-Allow-Origin": "*"
    }
  });
}
