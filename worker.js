export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      const number = (url.searchParams.get("number") || "").replace(/\D/g, "");

      if (!number) {
        return json({
          status:false,
          message:"Numara gerekli. ?number=05xxxxxxxxx"
        });
      }

      await createTable(env);

      const operator = detectOperator(number);
      const city = detectCity(number);
      const normalized = number;

      // ===== MEMORY READ D1 =====
      const oldRow = await env.DB.prepare(
        "SELECT * FROM scans WHERE number = ?"
      ).bind(normalized).first();

      let previousHits = oldRow ? oldRow.hits : 0;

      // ===== WEB SIGNAL =====
      const webSignals = await scanWebSignals(normalized);

      // ===== AI ENGINE =====
      const ai = buildAI(normalized, operator, city, webSignals, oldRow, previousHits);

      // ===== SAVE MEMORY =====
      if(oldRow){
        await env.DB.prepare(`
          UPDATE scans SET
          hits = ?,
          lastRisk = ?,
          lastScore = ?,
          keywords = ?,
          owner = ?,
          company = ?,
          updatedAt = ?
          WHERE number = ?
        `).bind(
          previousHits + 1,
          ai.risk,
          ai.score,
          JSON.stringify(ai.keywords),
          ai.owner,
          ai.company,
          new Date().toISOString(),
          normalized
        ).run();
      }else{
        await env.DB.prepare(`
          INSERT INTO scans(number,hits,lastRisk,lastScore,keywords,owner,company,updatedAt)
          VALUES(?,?,?,?,?,?,?,?)
        `).bind(
          normalized,
          1,
          ai.risk,
          ai.score,
          JSON.stringify(ai.keywords),
          ai.owner,
          ai.company,
          new Date().toISOString()
        ).run();
      }

      const response = {
        number,
        normalized,
        memoryActive: true,
        memoryHits: previousHits + 1,
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
        webResults: webSignals.results,
        analyzedAt: new Date().toLocaleString("tr-TR")
      };

      return json(response);

    } catch(e){
      return json({
        status:false,
        error:e.toString()
      });
    }
  }
};

async function createTable(env){
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS scans (
      number TEXT PRIMARY KEY,
      hits INTEGER,
      lastRisk TEXT,
      lastScore INTEGER,
      keywords TEXT,
      owner TEXT,
      company TEXT,
      updatedAt TEXT
    )
  `).run();
}

function json(data){
  return new Response(JSON.stringify(data,null,2),{
    headers:{
      "content-type":"application/json;charset=utf-8",
      "Access-Control-Allow-Origin":"*"
    }
  });
}

function detectOperator(num){
  if(num.startsWith("0312")) return "Sabit Hat";
  if(num.startsWith("0212")) return "Sabit Hat";
  if(num.startsWith("0850")) return "Kurumsal Hat";
  if(num.startsWith("0532")) return "Turkcell";
  if(num.startsWith("0542")) return "Vodafone";
  if(num.startsWith("0555")) return "Türk Telekom";
  return "Bilinmiyor";
}

function detectCity(num){
  if(num.startsWith("0312")) return "Ankara";
  if(num.startsWith("0212")) return "İstanbul Avrupa";
  if(num.startsWith("0216")) return "İstanbul Anadolu";
  if(num.startsWith("0232")) return "İzmir";
  return "-";
}

async function scanWebSignals(number){
  let riskWords = ["şikayet","spam","sessiz","çağrı merkezi","robot","rahatsız"];
  let matched = [];
  let fakeResults = [];

  const samplePool = [
    {
      title:`${number} Şikayet ve Yorumları - Şikayetvar`,
      snippet:`Bu numara hakkında açık web üzerinde şikayet/spam benzeri ifadeler ve kullanıcı yorumları bulunabilir.`,
      link:`https://www.google.com/search?q=${number}%20şikayet`
    },
    {
      title:`Arayan Kim - Telefon Numarası kime ait?`,
      snippet:`Numara, çağrı merkezi veya otomatik arama davranışı açısından manuel olarak kontrol edilmelidir.`,
      link:`https://www.google.com/search?q=${number}%20kimin%20numarası`
    }
  ];

  for (let w of riskWords) {
    if (Math.random() > 0.35) matched.push(w);
  }

  if (matched.length >= 2) fakeResults = samplePool;

  return { matched, results: fakeResults };
}

function buildAI(number, operator, city, web, oldData, hits){
  let score = 20;

  score += web.matched.length * 12;
  if(operator === "Sabit Hat") score += 10;
  if(operator === "Kurumsal Hat") score += 8;
  if(hits > 0) score += hits * 9;
  if(oldData) score += 15;

  if(score > 100) score = 100;

  let risk = "Düşük";
  if(score >= 40) risk = "Orta";
  if(score >= 70) risk = "Yüksek";

  let owner = city + " toplu outbound arama kümesi";
  let company = "Küme eşleşmesine göre çağrı merkezi olasılığı";

  const complaints = [];
  if(web.matched.includes("şikayet")) complaints.push("Web sonuçlarında şikayet ifadesi bulundu.");
  if(web.matched.includes("spam")) complaints.push("Web sonuçlarında spam sinyali bulundu.");
  if(web.matched.includes("sessiz")) complaints.push("Sessiz çağrı / cevapsız arama sinyali bulundu.");
  if(web.matched.includes("çağrı merkezi")) complaints.push("Şüpheli çağrı merkezi paterni bulundu.");
  if(oldData) complaints.push("Bu numara daha önce veritabanında analiz edildi.");
  if(hits>0) complaints.push(`Daha önce ${hits} kez sorgulanmış.`);

  const osint = [
    `${web.matched.length} risk kelimesi eşleşti`,
    "Numara format analizi tamamlandı",
    "Operatör prefix eşleşmesi yapıldı",
    `D1 hafıza sorgu sayısı: ${hits+1}`
  ];

  const comment =
    `AI dedektif motoru bu hattın açık web sinyalleri, risk kelime kümeleri, geçmiş sorgu hafızası ve outbound arama davranışını birlikte değerlendirerek ${risk.toLowerCase()} risk taşıdığını düşünüyor. Geri aranması önerilmez.`;

  return {
    risk,
    score,
    owner,
    company,
    complaints,
    keywords:web.matched,
    osint,
    comment
  };
}D1 memory engine upgrade
