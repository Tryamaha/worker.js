export default {
  async fetch(request) {

    const url = new URL(request.url);
    const number = (url.searchParams.get("number") || "").replace(/\D/g,'');

    if(!number){
      return new Response(JSON.stringify({error:"number param missing"}),{
        headers:{
          "content-type":"application/json;charset=UTF-8",
          "Access-Control-Allow-Origin":"*"
        }
      });
    }

    async function webScan(q){
      try{
        const r = await fetch("https://duckduckgo.com/html/?q="+encodeURIComponent(q),{
          headers:{ "user-agent":"Mozilla/5.0" }
        });
        return await r.text();
      }catch(e){
        return "";
      }
    }

    function clean(txt){
      return txt
        .replace(/<[^>]+>/g,' ')
        .replace(/\s+/g,' ')
        .trim();
    }

    function extractResults(html){
      const arr = [];
      const regex = /result__a[^>]*>(.*?)<\/a>[\s\S]*?result__snippet[^>]*>(.*?)<\/a>|result__snippet[^>]*>(.*?)<\/a>/gi;
      let m;
      while((m = regex.exec(html)) !== null){
        const title = clean(m[1] || "Web Sonuç");
        const snippet = clean(m[2] || m[3] || "");
        if(title.length > 5 || snippet.length > 10){
          arr.push({
            title,
            snippet
          });
        }
        if(arr.length >= 8) break;
      }
      return arr;
    }

    function aiRiskEngine(number, webResults){

      let risk = "Düşük";
      let score = 15;
      let complaints = [];
      let osint = [];
      let webSignals = [];
      let keywords = [];

      const merged = JSON.stringify(webResults).toLowerCase();

      const riskWords = [
        "şikayet","spam","dolandır","rahatsız","sessiz",
        "çağrı merkezi","borç","kredi","tele satış","anket",
        "robot arama","tahsilat","reklam"
      ];

      let hitCount = 0;

      riskWords.forEach(k=>{
        if(merged.includes(k)){
          hitCount++;
          keywords.push(k);
        }
      });

      if(hitCount >= 1){
        score += hitCount * 12;
        osint.push(hitCount+" risk kelimesi eşleşti");
      }

      if(merged.includes("şikayet")){
        complaints.push("Web sonuçlarında şikayet ifadesi bulundu.");
      }

      if(merged.includes("spam")){
        complaints.push("Web sonuçlarında spam sinyali bulundu.");
      }

      if(merged.includes("sessiz")){
        complaints.push("Sessiz çağrı / cevapsız arama sinyali bulundu.");
      }

      if(merged.includes("çağrı merkezi") || merged.includes("tele satış") || merged.includes("anket")){
        complaints.push("Çağrı merkezi / tele satış benzeri sinyal bulundu.");
      }

      const prefix7 = number.substring(0,7);

      const suspiciousClusters = {
        "0312624":"Ankara toplu outbound arama kümesi",
        "0212945":"İstanbul satış havuzu",
        "0850484":"VoIP çağrı merkezi ağı",
        "0312524":"Ankara şikayet kümelenmesi",
        "0850303":"Robot arama ağı"
      };

      let owner = "Belirsiz";
      let company = "Bilinmiyor";
      let city = "Türkiye";
      let operator = "Sabit Hat";

      if(number.startsWith("0312")) city = "Ankara";
      if(number.startsWith("0212")) city = "İstanbul Avrupa";
      if(number.startsWith("0216")) city = "İstanbul Anadolu";
      if(number.startsWith("0850")) operator = "VoIP Kurumsal";

      if(suspiciousClusters[prefix7]){
        score += 20;
        owner = suspiciousClusters[prefix7];
        company = "Küme eşleşmesine göre çağrı merkezi olasılığı";
        complaints.push("Şüpheli numara kümesi ile eşleşti.");
      }

      if(score >= 75) risk = "Yüksek";
      else if(score >= 45) risk = "Orta";
      else risk = "Düşük";

      osint.push("Numara format analizi tamamlandı");
      osint.push("Operatör prefix eşleşmesi yapıldı");
      osint.push(webResults.length+" web sonucu işlendi");

      let aiComment = "";

      if(risk === "Yüksek"){
        aiComment = "AI motoru bu numaranın açık web şikayetleri, spam kelime yoğunluğu ve şüpheli arama kümeleri nedeniyle yüksek risk taşıdığını düşünüyor. Geri arama önerilmez.";
      }else if(risk === "Orta"){
        aiComment = "AI motoru bu numarada doğrudan dolandırıcılık kanıtı görmese de spam/rahatsız arama sinyalleri tespit etti. Temkinli yaklaşılmalı.";
      }else{
        aiComment = "AI motoru açık kaynaklarda ciddi negatif yoğunluk bulmadı. Yine de kimlik doğrulaması yapılmadan bilgi paylaşılmamalı.";
      }

      return {
        number:number,
        normalized:number,
        operator,
        city,
        risk,
        score,
        owner,
        company,
        complaints,
        osint,
        keywords,
        aiComment,
        webResults
      };
    }

    const html = await webScan(number+" şikayet spam kimin numarası");
    const webResults = extractResults(html);
    const result = aiRiskEngine(number, webResults);

    return new Response(JSON.stringify(result),{
      headers:{
        "content-type":"application/json;charset=UTF-8",
        "Access-Control-Allow-Origin":"*"
      }
    });

  }
}
