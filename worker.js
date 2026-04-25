export default {
  async fetch(request) {
    const url = new URL(request.url);
    const number = url.searchParams.get("number");

    if (!number) {
      return json({ status:"ready", app:"Spam Kovucu PRO MAX AI", use:"?number=03126242405" });
    }

    const clean = normalize(number);
    const base = baseInfo(clean);
    const web = await webIntel(clean);
    const ai = aiEngine(clean, base, web);

    return json({
      number,
      normalized: clean,
      operator: base.operator,
      city: base.city,
      risk: ai.risk,
      score: ai.score,
      owner: ai.owner,
      company: ai.company,
      aiComment: ai.comment,
      complaints: ai.complaints,
      keywords: web.keywords,
      osint: ai.osint,
      webResults: web.results,
      updatedAt: new Date().toISOString()
    });
  }
};

function json(data){
  return new Response(JSON.stringify(data),{
    headers:{
      "content-type":"application/json;charset=UTF-8",
      "Access-Control-Allow-Origin":"*"
    }
  });
}

function normalize(n){
  let x = String(n || "").replace(/\D/g,"");
  if(x.startsWith("90")) x = "0" + x.slice(2);
  if(x.length === 10) x = "0" + x;
  return x;
}

function baseInfo(n){
  let r = {operator:"Bilinmiyor",city:"Bilinmiyor",base:10};

  if(n.startsWith("0312")){r.operator="Sabit Hat";r.city="Ankara";r.base+=18;}
  if(n.startsWith("0212")){r.operator="Sabit Hat";r.city="İstanbul Avrupa";r.base+=18;}
  if(n.startsWith("0216")){r.operator="Sabit Hat";r.city="İstanbul Anadolu";r.base+=18;}
  if(n.startsWith("0232")){r.operator="Sabit Hat";r.city="İzmir";r.base+=15;}
  if(n.startsWith("0236")){r.operator="Sabit Hat";r.city="Manisa";r.base+=15;}
  if(n.startsWith("0850") || n.startsWith("444")){r.operator="Kurumsal / Çağrı Merkezi";r.city="Türkiye Geneli";r.base+=32;}
  if(n.startsWith("05")){r.operator="Mobil Hat";r.city="Mobil";r.base+=8;}

  return r;
}

async function webIntel(n){
  let results = [];
  let text = "";

  const queries = [
    `${n} şikayet spam kimin numarası`,
    `${n} sessiz çağrı rahatsız`,
    `${n} çağrı merkezi tahsilat`
  ];

  for(const q of queries){
    const found = await duck(q);
    results.push(...found);
    if(results.length >= 8) break;
  }

  results = dedupe(results).slice(0,8);
  text = results.map(x=>`${x.title} ${x.snippet}`).join(" ").toLowerCase();

  const words = [
    "şikayet","spam","rahatsız","sessiz","dolandırıcı","dolandırıcılık",
    "tahsilat","borç","icra","çağrı merkezi","robot","otomatik arama",
    "anket","kredi","sigorta","reklam","kampanya","satış"
  ];

  let keywords = [];
  for(const w of words){
    if(text.includes(w)) keywords.push(w);
  }

  if(!results.length){
    results.push({
      title:"Manuel doğrulama gerekli",
      snippet:"Arama motoru sonuçları otomatik okunamadı. Bu numarayı Google, Şikayetvar ve numara sorgulama sitelerinde manuel kontrol edin.",
      link:`https://www.google.com/search?q=${encodeURIComponent(n+" şikayet spam kimin numarası")}`
    });
  }

  return {results,keywords,text};
}

async function duck(q){
  try{
    const res = await fetch("https://html.duckduckgo.com/html/?q="+encodeURIComponent(q),{
      headers:{"user-agent":"Mozilla/5.0"}
    });

    const html = await res.text();
    const out = [];
    const re = /<a rel="nofollow" class="result__a" href="([^"]+)">([\s\S]*?)<\/a>[\s\S]*?<a class="result__snippet"[\s\S]*?>([\s\S]*?)<\/a>/g;

    let m;
    while((m = re.exec(html)) && out.length < 5){
      out.push({
        title:strip(m[2]),
        snippet:strip(m[3]),
        link:decode(m[1])
      });
    }
    return out;
  }catch(e){
    return [];
  }
}

function aiEngine(n, base, web){
  let score = base.base;
  let complaints = [];
  let osint = [
    "Numara format analizi tamamlandı",
    "Operatör prefix eşleşmesi yapıldı",
    `${web.results.length} web sonucu işlendi`,
    `${web.keywords.length} risk kelimesi eşleşti`
  ];

  const cluster = {
    "0312624":"Ankara toplu outbound arama kümesi",
    "0312524":"Ankara şikayet kümelenmesi",
    "0850484":"VoIP çağrı merkezi ağı",
    "0850303":"Robot arama ağı",
    "0212945":"İstanbul satış havuzu"
  };

  const p7 = n.slice(0,7);
  let owner = "Bilinmiyor";
  let company = "Bilinmiyor";

  if(cluster[p7]){
    score += 18;
    owner = cluster[p7];
    company = "Küme eşleşmesine göre çağrı merkezi olasılığı";
    complaints.push("Şüpheli numara kümesi ile eşleşti.");
    osint.push("Prefix intelligence motoru küme eşleşmesi buldu");
  }

  const severe = ["dolandırıcı","dolandırıcılık","spam","sessiz","rahatsız","tahsilat","borç","icra"];
  const medium = ["şikayet","çağrı merkezi","robot","anket","kredi","sigorta","reklam","kampanya","satış"];

  for(const k of web.keywords){
    if(severe.includes(k)) score += 11;
    else if(medium.includes(k)) score += 7;
    else score += 4;
  }

  if(web.results.length >= 6) score += 8;
  if(web.results.length >= 3) score += 5;
  if(base.operator.includes("Çağrı")) score += 12;
  if(base.operator.includes("Sabit")) score += 7;

  if(web.keywords.includes("şikayet")) complaints.push("Web sonuçlarında şikayet ifadesi bulundu.");
  if(web.keywords.includes("spam")) complaints.push("Web sonuçlarında spam sinyali bulundu.");
  if(web.keywords.includes("sessiz")) complaints.push("Sessiz çağrı / cevapsız arama sinyali bulundu.");
  if(web.keywords.includes("rahatsız")) complaints.push("Rahatsız edici arama ifadesi bulundu.");
  if(web.keywords.includes("tahsilat")) complaints.push("Tahsilat / alacak araması sinyali bulundu.");
  if(web.keywords.includes("dolandırıcı") || web.keywords.includes("dolandırıcılık")) complaints.push("Dolandırıcılık bağlantılı ifade tespit edildi.");
  if(web.keywords.includes("çağrı merkezi")) complaints.push("Çağrı merkezi bağlantısı olabilir.");

  if(!complaints.length) complaints.push("Belirgin açık web şikayet sinyali bulunamadı.");

  if(company==="Bilinmiyor"){
    if(web.keywords.includes("tahsilat")) company="Tahsilat / alacak takip arama hattı olabilir";
    else if(web.keywords.includes("çağrı merkezi")) company="Çağrı merkezi olabilir";
    else if(web.keywords.length>=2) company="Web izlerinde spam / arama merkezi sinyali var";
  }

  if(owner==="Bilinmiyor" && web.keywords.length>=2){
    owner="Açık web sinyallerine göre toplu arama hattı olabilir";
  }

  score = Math.min(score,99);

  let risk = "Düşük";
  if(score>=75) risk="Yüksek";
  else if(score>=50) risk="Orta";
  else if(score>=30) risk="Şüpheli";

  let comment =
    risk==="Yüksek"
    ? "AI Dedektif Yorumu: Bu numara açık web şikayetleri, spam kelime yoğunluğu, sessiz arama/tahsilat sinyalleri ve numara kümesi eşleşmeleri nedeniyle yüksek riskli görünüyor. Geri arama önerilmez; kişisel bilgi paylaşmayın ve numarayı engelleyin."
    : risk==="Orta"
    ? "AI Dedektif Yorumu: Bu numarada ticari spam, çağrı merkezi veya rahatsız arama sinyalleri mevcut. Resmî kurum numarasından doğrulamadan işlem yapmayın."
    : risk==="Şüpheli"
    ? "AI Dedektif Yorumu: Numara yapısı ve sınırlı açık web sinyalleri dikkat gerektiriyor. Bilgi paylaşmadan önce bağımsız kaynaklardan doğrulayın."
    : "AI Dedektif Yorumu: Açık kaynaklarda güçlü negatif yoğunluk bulunmadı. Yine de bilinmeyen aramalarda SMS kodu, banka bilgisi veya kimlik bilgisi paylaşılmamalı.";

  return {score,risk,owner,company,complaints,osint,comment};
}

function dedupe(arr){
  const seen = new Set();
  return arr.filter(x=>{
    const k = (x.title+x.snippet).slice(0,80);
    if(seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function strip(s){
  return String(s||"")
    .replace(/<[^>]*>/g,"")
    .replace(/&quot;/g,'"')
    .replace(/&#x27;/g,"'")
    .replace(/&amp;/g,"&")
    .replace(/\s+/g," ")
    .trim();
}

function decode(s){
  return String(s||"").replace(/&amp;/g,"&");
}
