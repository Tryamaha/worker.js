export default {
  async fetch(request) {
    const url = new URL(request.url);
    const number = (url.searchParams.get("number") || "").replace(/\D/g,'');

    if (!number) {
      return json({error:"number param missing"});
    }

    // -----------------------------
    // BASIC TEL ANALYSIS
    // -----------------------------
    let operator = "Bilinmiyor";
    let city = "Bilinmiyor";

    if(number.startsWith("0312")){
      operator = "Sabit Hat";
      city = "Ankara";
    }
    if(number.startsWith("0212")){
      operator = "Sabit Hat";
      city = "İstanbul Avrupa";
    }
    if(number.startsWith("0224")){
      operator = "Sabit Hat";
      city = "Bursa";
    }
    if(number.startsWith("0532") || number.startsWith("0533") || number.startsWith("0542") || number.startsWith("0555")){
      operator = "GSM Hat";
      city = "Mobil";
    }

    // -----------------------------
    // LIVE WEB SEARCH ENGINE
    // -----------------------------
    const query = `"${number}" spam OR şikayet OR kime ait OR çağrı merkezi OR tahsilat OR sessiz arama`;

    let rawText = "";
    let webResults = [];

    try{
      const r = await fetch("https://html.duckduckgo.com/html/?q=" + encodeURIComponent(query),{
        headers:{
          "user-agent":"Mozilla/5.0"
        }
      });
      rawText = await r.text();

      const regex = /result__a[^>]*>(.*?)<\/a>[\s\S]*?result__snippet[^>]*>(.*?)<\/a>/gi;
      let m;
      while((m = regex.exec(rawText)) !== null && webResults.length < 8){
        const title = clean(m[1]);
        const snippet = clean(m[2]);
        webResults.push({
          title,
          snippet,
          link:"#"
        });
      }
    }catch(e){}

    // -----------------------------
    // KEYWORD RADAR
    // -----------------------------
    const keywordBank = [
      "şikayet","spam","rahatsız","sessiz","dolandırıcı","tahsilat",
      "çağrı merkezi","borç","icra","robot","otomatik arama","anket"
    ];

    let hitKeywords = [];
    let keywordHits = 0;

    const scanText = (rawText + JSON.stringify(webResults)).toLowerCase();

    keywordBank.forEach(k=>{
      if(scanText.includes(k)){
        hitKeywords.push(k);
        keywordHits++;
      }
    });

    // -----------------------------
    // CLUSTER ENGINE
    // -----------------------------
    let clusterFlag = false;
    let owner = "Belirsiz";
    let company = "Belirsiz";

    if(number.startsWith("0312624")){
      clusterFlag = true;
      owner = "Ankara toplu outbound arama kümesi";
      company = "Küme eşleşmesine göre çağrı merkezi olasılığı";
    }

    if(scanText.includes("tahsilat")){
      company = "Tahsilat / alacak takip arama hattı olabilir";
    }

    // -----------------------------
    // COMPLAINT ENGINE
    // -----------------------------
    let complaints = [];

    if(scanText.includes("şikayet")) complaints.push("Web sonuçlarında şikayet ifadesi bulundu.");
    if(scanText.includes("spam")) complaints.push("Web sonuçlarında spam sinyali bulundu.");
    if(scanText.includes("sessiz")) complaints.push("Sessiz çağrı / cevapsız arama sinyali bulundu.");
    if(clusterFlag) complaints.push("Şüpheli numara kümesi ile eşleşti.");

    // -----------------------------
    // AI RISK SCORE ENGINE
    // -----------------------------
    let score = 18;

    score += webResults.length * 5;
    score += keywordHits * 9;
    if(clusterFlag) score += 18;
    if(operator === "Sabit Hat") score += 8;
    if(scanText.includes("tahsilat")) score += 12;
    if(scanText.includes("sessiz")) score += 10;

    if(score > 99) score = 99;

    let risk = "Düşük";
    if(score >= 75) risk = "Yüksek";
    else if(score >= 45) risk = "Orta";
    else if(score >= 25) risk = "Şüpheli";

    // -----------------------------
    // AI COMMENT ENGINE
    // -----------------------------
    let aiComment = "AI motoru bu numarada düşük tehdit gördü.";

    if(risk === "Yüksek"){
      aiComment = "AI dedektif motoru bu hattın açık web şikayet yoğunluğu, spam kelime kümeleri, sabit hat outbound davranışı ve şüpheli arama paterni nedeniyle yüksek risk taşıdığını düşünüyor. Geri aranması önerilmez.";
    }else if(risk === "Orta"){
      aiComment = "AI motoru numarada ticari spam veya çağrı merkezi davranışları tespit etti. Dikkatli olunmalıdır.";
    }else if(risk === "Şüpheli"){
      aiComment = "AI motoru numarada sınırlı şüpheli sinyal buldu ancak net güven vermiyor.";
    }

    // -----------------------------
    // RESPONSE
    // -----------------------------
    return json({
      number,
      normalized:number,
      operator,
      city,
      risk,
      score,
      owner,
      company,
      lastAnalysis:new Date().toISOString(),
      complaints,
      keywords:hitKeywords,
      aiComment,
      osint:[
        `${keywordHits} risk kelimesi eşleşti`,
        "Numara format analizi tamamlandı",
        "Operatör prefix eşleşmesi yapıldı",
        `${webResults.length} web sonucu işlendi`
      ],
      webResults
    });
  }
}

function clean(str){
  return str
    .replace(/<[^>]+>/g,'')
    .replace(/&quot;/g,'"')
    .replace(/&#x27;/g,"'")
    .replace(/&amp;/g,"&")
    .trim();
}

function json(data){
  return new Response(JSON.stringify(data),{
    headers:{
      "content-type":"application/json;charset=UTF-8",
      "Access-Control-Allow-Origin":"*"
    }
  });
}
