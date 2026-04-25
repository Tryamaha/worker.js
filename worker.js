export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const num = url.searchParams.get("number") || "";
    const clean = normalize(num);

    const base = analyzeNumber(clean, num);
    const web = await webIntel(clean, env);

    const result = {
      number: num,
      normalized: clean,
      operator: base.operator,
      city: base.city,
      risk: finalRisk(base, web),
      owner: web.owner || base.owner,
      company: web.company || base.company,
      complaints: web.complaints.length ? web.complaints : base.complaints,
      osint: web.osint,
      webResults: web.results,
      keywords: web.keywords,
      updatedAt: new Date().toISOString()
    };

    return new Response(JSON.stringify(result), {
      headers: {
        "content-type": "application/json;charset=UTF-8",
        "Access-Control-Allow-Origin": "*"
      }
    });
  }
};

function normalize(n) {
  let x = String(n || "").replace(/\D/g, "");
  if (x.startsWith("90")) x = "0" + x.slice(2);
  if (x.length === 10) x = "0" + x;
  return x;
}

function analyzeNumber(clean, original) {
  let r = {
    operator: "Bilinmiyor",
    city: "Bilinmiyor",
    risk: "Düşük",
    owner: "Bilinmiyor",
    company: "Bilinmiyor",
    complaints: []
  };

  if (clean.startsWith("0312")) {
    r.city = "Ankara";
    r.operator = "Sabit Hat";
  }

  if (clean.startsWith("0212")) {
    r.city = "İstanbul Avrupa";
    r.operator = "Sabit Hat";
  }

  if (clean.startsWith("0216")) {
    r.city = "İstanbul Anadolu";
    r.operator = "Sabit Hat";
  }

  if (clean.startsWith("0850") || clean.startsWith("444")) {
    r.operator = "Kurumsal / Çağrı Merkezi";
    r.city = "Türkiye Geneli";
    r.risk = "Orta";
    r.complaints.push("0850/444 hatları çağrı merkezi ve otomatik aramalarda sık görülür.");
  }

  if (clean.startsWith("05")) {
    r.operator = "Mobil Hat";
    r.city = "Mobil hatlarda şehir kesin bilinmez";
  }

  if (clean.length < 10) {
    r.risk = "Şüpheli";
    r.complaints.push("Numara formatı eksik veya olağan dışı görünüyor.");
  }

  return r;
}

async function webIntel(clean, env) {
  let results = [];
  let text = "";
  let osint = [];
  let complaints = [];
  let keywords = [];
  let company = "";
  let owner = "";

  osint.push("Numara format analizi tamamlandı");
  osint.push("Operatör prefix eşleşmesi yapıldı");

  if (!clean) {
    return { results, osint, complaints, keywords, company, owner };
  }

  if (env && env.SERPAPI_KEY) {
    const serp = await serpApiSearch(clean, env.SERPAPI_KEY);
    results = serp;
    text = serp.map(x => `${x.title} ${x.snippet}`).join(" ").toLowerCase();
    osint.push("SerpAPI ile gerçek web sonucu tarandı");
  } else {
    const ddg = await duckSearch(clean);
    results = ddg;
    text = ddg.map(x => `${x.title} ${x.snippet}`).join(" ").toLowerCase();

    if (ddg.length) {
      osint.push("Açık web sonuçlarından sinyal toplandı");
    } else {
      osint.push("Harici arama API anahtarı yok; sonuçlar sınırlı olabilir");
    }
  }

  const signals = [
    "şikayet",
    "spam",
    "dolandırıcı",
    "dolandırıcılık",
    "rahatsız",
    "sürekli arıyor",
    "sessiz çağrı",
    "robot",
    "anket",
    "çağrı merkezi",
    "kredi",
    "sigorta",
    "bahis",
    "reklam",
    "kampanya",
    "satış",
    "borç",
    "icra",
    "banka"
  ];

  for (const s of signals) {
    if (text.includes(s)) keywords.push(s);
  }

  if (keywords.includes("şikayet")) complaints.push("Web sonuçlarında şikayet ifadesi bulundu.");
  if (keywords.includes("spam")) complaints.push("Web sonuçlarında spam sinyali bulundu.");
  if (keywords.includes("dolandırıcı") || keywords.includes("dolandırıcılık")) complaints.push("Dolandırıcılık bağlantılı kelime tespit edildi.");
  if (keywords.includes("sessiz çağrı")) complaints.push("Sessiz çağrı şikayeti sinyali bulundu.");
  if (keywords.includes("anket")) complaints.push("Anket / araştırma araması olabilir.");
  if (keywords.includes("çağrı merkezi")) complaints.push("Çağrı merkezi bağlantısı olabilir.");
  if (keywords.includes("kredi")) complaints.push("Kredi / finans pazarlama araması olabilir.");
  if (keywords.includes("sigorta")) complaints.push("Sigorta satış araması olabilir.");
  if (keywords.includes("bahis")) complaints.push("Bahis / yasa dışı reklam riski olabilir.");

  if (text.includes("anket")) company = "Anket / araştırma şirketi olabilir";
  if (text.includes("çağrı merkezi")) company = "Çağrı merkezi olabilir";
  if (text.includes("banka")) company = "Banka adı kullanılıyor olabilir; resmî numaradan doğrula";
  if (text.includes("kargo")) company = "Kargo / teslimat bağlantısı olabilir";
  if (text.includes("sigorta")) company = "Sigorta satış hattı olabilir";

  if (!company && keywords.length >= 2) company = "Web izlerinde spam/arama merkezi sinyali var";
  if (!owner && keywords.length >= 2) owner = "Açık web sinyallerine göre toplu arama hattı olabilir";

  if (results.length) osint.push(`${results.length} web sonucu işlendi`);
  if (keywords.length) osint.push(`${keywords.length} risk kelimesi eşleşti`);
  if (!complaints.length) complaints.push("Belirgin açık web şikayet sinyali bulunamadı.");

  return {
    results,
    osint,
    complaints,
    keywords,
    company,
    owner
  };
}

function finalRisk(base, web) {
  let score = 0;

  if (base.risk === "Şüpheli") score += 50;
  if (base.risk === "Orta") score += 35;
  if (base.operator.includes("Çağrı")) score += 25;
  if (base.operator.includes("Sabit")) score += 15;

  score += web.keywords.length * 12;

  const severe = ["dolandırıcı", "dolandırıcılık", "bahis", "sessiz çağrı", "spam"];
  for (const k of severe) {
    if (web.keywords.includes(k)) score += 15;
  }

  if (score >= 70) return "Yüksek";
  if (score >= 40) return "Orta";
  if (score >= 25) return "Şüpheli";
  return "Düşük";
}

async function serpApiSearch(clean, key) {
  try {
    const q = encodeURIComponent(`${clean} şikayet spam kimin numarası`);
    const api = `https://serpapi.com/search.json?engine=google&q=${q}&hl=tr&gl=tr&api_key=${key}`;
    const res = await fetch(api);
    const data = await res.json();

    return (data.organic_results || []).slice(0, 8).map(x => ({
      title: x.title || "",
      snippet: x.snippet || "",
      link: x.link || ""
    }));
  } catch (e) {
    return [];
  }
}

async function duckSearch(clean) {
  try {
    const q = encodeURIComponent(`${clean} şikayet spam kimin numarası`);
    const url = `https://duckduckgo.com/html/?q=${q}`;
    const res = await fetch(url, {
      headers: {
        "user-agent": "Mozilla/5.0"
      }
    });

    const html = await res.text();
    const items = [];

    const regex = /<a rel="nofollow" class="result__a" href="([^"]+)">([\s\S]*?)<\/a>[\s\S]*?<a class="result__snippet"[\s\S]*?>([\s\S]*?)<\/a>/g;

    let m;
    while ((m = regex.exec(html)) && items.length < 6) {
      items.push({
        title: strip(m[2]),
        snippet: strip(m[3]),
        link: decodeHtml(m[1])
      });
    }

    return items;
  } catch (e) {
    return [];
  }
}

function strip(s) {
  return String(s || "")
    .replace(/<[^>]*>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeHtml(s) {
  return String(s || "").replace(/&amp;/g, "&");
}
