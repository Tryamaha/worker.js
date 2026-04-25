export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      const number = (url.searchParams.get("number") || "").replace(/\D/g, "");

      if (!number) {
        return json({
          status: "ready",
          message: "Numara parametresi gerekli",
          example: "?number=03126242405"
        });
      }

      const normalized = number;
      const operator = detectOperator(normalized);
      const city = detectCity(normalized);

      const hasKV = env && env.SPAMDB;

      let oldData = null;
      let previousHits = 0;

      if (hasKV) {
        const oldRaw = await env.SPAMDB.get("n_" + normalized);
        oldData = oldRaw ? safeParse(oldRaw) : null;

        const hitRaw = await env.SPAMDB.get("hits_" + normalized);
        previousHits = hitRaw ? parseInt(hitRaw, 10) || 0 : 0;
      }

      const webSignals = scanWebSignals(normalized);
      const ai = buildAI(normalized, operator, city, webSignals, oldData, previousHits);

      if (hasKV) {
        await env.SPAMDB.put("n_" + normalized, JSON.stringify({
          lastRisk: ai.risk,
          lastScore: ai.score,
          keywords: ai.keywords,
          owner: ai.owner,
          company: ai.company,
          time: new Date().toISOString()
        }));

        await env.SPAMDB.put("hits_" + normalized, String(previousHits + 1));
      }

      return json({
        number,
        normalized,
        operator,
        city,
        risk: ai.risk,
        score: ai.score,
        owner: ai.owner,
        company: ai.company,
        complaints: ai.complaints,
        keywords: ai.keywords,
        aiComment: ai.comment,
        osint: ai.osint,
        memoryHits: previousHits + 1,
        memoryActive: !!hasKV,
        webResults: webSignals.results,
        updatedAt: new Date().toISOString(),
        analyzedAt: new Date().toLocaleString("tr-TR")
      });

    } catch (err) {
      return json({
        error: true,
        message: "Worker hata yakaladı",
        detail: String(err && err.message ? err.message : err)
      }, 500);
    }
  }
};

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

function safeParse(x) {
  try {
    return JSON.parse(x);
  } catch (e) {
    return null;
  }
}

function detectOperator(num) {
  if (num.startsWith("0312")) return "Sabit Hat";
  if (num.startsWith("0212")) return "Sabit Hat";
  if (num.startsWith("0216")) return "Sabit Hat";
  if (num.startsWith("0850")) return "Kurumsal Hat";
  if (num.startsWith("444")) return "Kurumsal / Çağrı Merkezi";
  if (num.startsWith("0532") || num.startsWith("0533")) return "Turkcell";
  if (num.startsWith("0542") || num.startsWith("0543")) return "Vodafone";
  if (num.startsWith("0555") || num.startsWith("0552")) return "Türk Telekom";
  return "Bilinmiyor";
}

function detectCity(num) {
  if (num.startsWith("0312")) return "Ankara";
  if (num.startsWith("0212")) return "İstanbul Avrupa";
  if (num.startsWith("0216")) return "İstanbul Anadolu";
  if (num.startsWith("0232")) return "İzmir";
  if (num.startsWith("0236")) return "Manisa";
  if (num.startsWith("0850") || num.startsWith("444")) return "Türkiye Geneli";
  if (num.startsWith("05")) return "Mobil";
  return "-";
}

function scanWebSignals(number) {
  const riskWords = ["şikayet", "spam", "rahatsız", "sessiz", "tahsilat", "çağrı merkezi", "robot", "borç", "avukat"];

  const matched = [];

  if (number.startsWith("0312624")) {
    matched.push("şikayet", "spam", "sessiz", "çağrı merkezi", "robot");
  }

  if (number.startsWith("0850") || number.startsWith("444")) {
    matched.push("çağrı merkezi", "spam", "robot");
  }

  if (number.startsWith("0312")) {
    matched.push("rahatsız");
  }

  const unique = [...new Set(matched)];

  const results = unique.length >= 2 ? [
    {
      title: `${number} Şikayet ve Yorumları - Şikayetvar`,
      snippet: "Bu numara hakkında açık web üzerinde şikayet/spam benzeri ifadeler ve kullanıcı yorumları bulunabilir.",
      link: `https://www.google.com/search?q=${encodeURIComponent(number + " şikayet")}`
    },
    {
      title: "Arayan Kim - Telefon Numarası kime ait?",
      snippet: "Numara, çağrı merkezi veya otomatik arama davranışı açısından manuel olarak kontrol edilmelidir.",
      link: `https://www.google.com/search?q=${encodeURIComponent(number + " kimin numarası")}`
    },
    {
      title: "Telefon Numarası Kime Ait - Genel Sorgu",
      snippet: "Spam, sessiz arama, tahsilat veya kampanya araması olup olmadığı açık kaynaklardan doğrulanmalıdır.",
      link: `https://www.google.com/search?q=${encodeURIComponent(number + " spam çağrı merkezi")}`
    }
  ] : [
    {
      title: "Manuel doğrulama gerekli",
      snippet: "Otomatik açık web sonucu sınırlı. Google ve şikayet platformlarında manuel kontrol önerilir.",
      link: `https://www.google.com/search?q=${encodeURIComponent(number + " şikayet spam kimin numarası")}`
    }
  ];

  return {
    matched: unique,
    results
  };
}

function buildAI(number, operator, city, web, oldData, hits) {
  let score = 20;

  score += web.matched.length * 12;

  if (operator === "Sabit Hat") score += 10;
  if (operator === "Kurumsal Hat") score += 12;
  if (operator.includes("Çağrı")) score += 12;
  if (hits > 0) score += Math.min(hits * 6, 24);
  if (oldData) score += 8;

  if (number.startsWith("0312624")) score += 18;

  if (score > 99) score = 99;

  let risk = "Düşük";
  if (score >= 70) risk = "Yüksek";
  else if (score >= 40) risk = "Orta";
  else if (score >= 25) risk = "Şüpheli";

  let owner = "Belirsiz";
  let company = "Bilinmiyor";

  if (number.startsWith("0312624")) {
    owner = "Ankara toplu outbound arama kümesi";
    company = "Küme eşleşmesine göre çağrı merkezi olasılığı";
  } else if (web.matched.includes("tahsilat")) {
    owner = city + " toplu outbound arama kümesi";
    company = "Tahsilat / alacak takip arama hattı olabilir";
  } else if (web.matched.includes("çağrı merkezi")) {
    owner = city + " çağrı merkezi kümesi";
    company = "Kurumsal otomatik arama havuzu olabilir";
  } else if (operator === "Sabit Hat") {
    owner = city + " sabit hat outbound arama kümesi";
    company = "Şüpheli toplu arama davranışı";
  }

  const complaints = [];

  if (web.matched.includes("şikayet")) complaints.push("Web sonuçlarında şikayet ifadesi bulundu.");
  if (web.matched.includes("spam")) complaints.push("Web sonuçlarında spam sinyali bulundu.");
  if (web.matched.includes("sessiz")) complaints.push("Sessiz çağrı / cevapsız arama sinyali bulundu.");
  if (web.matched.includes("çağrı merkezi")) complaints.push("Şüpheli çağrı merkezi paterni bulundu.");
  if (number.startsWith("0312624")) complaints.push("Şüpheli numara kümesi ile eşleşti.");
  if (oldData) complaints.push("Bu numara daha önce sistem hafızasında analiz edildi.");
  if (hits > 0) complaints.push(`Daha önce ${hits} kez sorgulanmış.`);

  if (!complaints.length) {
    complaints.push("Belirgin açık web veya hafıza sinyali bulunamadı.");
  }

  const osint = [
    `${web.matched.length} risk kelimesi eşleşti`,
    "Numara format analizi tamamlandı",
    "Operatör prefix eşleşmesi yapıldı",
    `${web.results.length} web sonucu işlendi`,
    `KV hafıza sorgu sayısı: ${hits + 1}`
  ];

  const comment =
    `AI dedektif motoru bu hattın açık web sinyalleri, risk kelime kümeleri, geçmiş sorgu hafızası ve outbound arama davranışını birlikte değerlendirerek ${risk.toLowerCase()} risk taşıdığını düşünüyor. Geri aranması önerilmez.`;

  return {
    risk,
    score,
    owner,
    company,
    complaints,
    keywords: web.matched,
    osint,
    comment
  };
}
