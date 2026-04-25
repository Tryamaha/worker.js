export default {
  async fetch(request) {
    const url = new URL(request.url);
    const number = url.searchParams.get("number");

    if (!number) {
      return new Response(html(), {
        headers: { "content-type": "text/html;charset=UTF-8" }
      });
    }

    const clean = normalize(number);
    const base = analyze(clean, number);
    const web = await webIntel(clean);

    const result = {
      number,
      normalized: clean,
      operator: base.operator,
      city: base.city,
      risk: finalRisk(base, web),
      owner: web.owner || base.owner,
      company: web.company || base.company,
      complaints: web.complaints,
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

function normalize(n){
  let x = String(n || "").replace(/\D/g,"");
  if(x.startsWith("90")) x = "0" + x.slice(2);
  if(x.length === 10) x = "0" + x;
  return x;
}

function analyze(clean, original){
  let r = {
    operator:"Bilinmiyor",
    city:"Bilinmiyor",
    risk:"Düşük",
    owner:"Bilinmiyor",
    company:"Bilinmiyor"
  };

  if(clean.startsWith("0312")){r.city="Ankara";r.operator="Sabit Hat";}
  if(clean.startsWith("0212")){r.city="İstanbul Avrupa";r.operator="Sabit Hat";}
  if(clean.startsWith("0216")){r.city="İstanbul Anadolu";r.operator="Sabit Hat";}
  if(clean.startsWith("0850") || clean.startsWith("444")){
    r.operator="Kurumsal / Çağrı Merkezi";
    r.city="Türkiye Geneli";
    r.risk="Orta";
  }
  if(clean.startsWith("05")){
    r.operator="Mobil Hat";
    r.city="Mobil hatlarda şehir kesin bilinmez";
  }
  if(clean.length < 10) r.risk="Şüpheli";

  return r;
}

async function webIntel(clean){
  let results = [];
  let text = "";
  let complaints = [];
  let keywords = [];
  let osint = [
    "Numara format analizi tamamlandı",
    "Operatör prefix eşleşmesi yapıldı"
  ];

  try{
    const q = encodeURIComponent(`${clean} şikayet spam kimin numarası`);
    const res = await fetch(`https://duckduckgo.com/html/?q=${q}`, {
      headers: {"user-agent":"Mozilla/5.0"}
    });
    const html = await res.text();

    const regex = /<a rel="nofollow" class="result__a" href="([^"]+)">([\s\S]*?)<\/a>[\s\S]*?<a class="result__snippet"[\s\S]*?>([\s\S]*?)<\/a>/g;
    let m;

    while((m = regex.exec(html)) && results.length < 6){
      results.push({
        title: strip(m[2]),
        snippet: strip(m[3]),
        link: decodeHtml(m[1])
      });
    }
  }catch(e){}

  text = results.map(x => `${x.title} ${x.snippet}`).join(" ").toLowerCase();

  const signals = ["şikayet","spam","dolandırıcı","dolandırıcılık","rahatsız","sessiz","robot","anket","çağrı merkezi","kredi","sigorta","bahis","reklam","kampanya","satış","banka"];

  for(const s of signals){
    if(text.includes(s)) keywords.push(s);
  }

  if(results.length) osint.push(`${results.length} web sonucu işlendi`);
  else osint.push("Web sonucu bulunamadı veya arama motoru sonuç vermedi");

  if(keywords.length) osint.push(`${keywords.length} risk kelimesi eşleşti`);

  if(keywords.includes("şikayet")) complaints.push("Web sonuçlarında şikayet ifadesi bulundu.");
  if(keywords.includes("spam")) complaints.push("Web sonuçlarında spam sinyali bulundu.");
  if(keywords.includes("sessiz")) complaints.push("Sessiz çağrı / cevapsız arama sinyali bulundu.");
  if(keywords.includes("dolandırıcı") || keywords.includes("dolandırıcılık")) complaints.push("Dolandırıcılık bağlantılı ifade tespit edildi.");
  if(keywords.includes("anket")) complaints.push("Anket / araştırma araması olabilir.");
  if(keywords.includes("çağrı merkezi")) complaints.push("Çağrı merkezi bağlantısı olabilir.");

  if(!complaints.length) complaints.push("Belirgin açık web şikayet sinyali bulunamadı.");

  let company = "";
  let owner = "";

  if(keywords.length >= 2){
    company = "Web izlerinde spam / arama merkezi sinyali var";
    owner = "Açık web sinyallerine göre toplu arama hattı olabilir";
  }

  return {results, complaints, keywords, osint, company, owner};
}

function finalRisk(base, web){
  let score = 0;
  if(base.risk === "Şüpheli") score += 50;
  if(base.risk === "Orta") score += 35;
  if(base.operator.includes("Çağrı")) score += 25;
  if(base.operator.includes("Sabit")) score += 15;
  score += web.keywords.length * 12;
  if(score >= 70) return "Yüksek";
  if(score >= 40) return "Orta";
  if(score >= 25) return "Şüpheli";
  return "Düşük";
}

function strip(s){
  return String(s || "")
    .replace(/<[^>]*>/g,"")
    .replace(/&quot;/g,'"')
    .replace(/&#x27;/g,"'")
    .replace(/&amp;/g,"&")
    .replace(/\s+/g," ")
    .trim();
}

function decodeHtml(s){
  return String(s || "").replace(/&amp;/g,"&");
}

function html(){
return `<!DOCTYPE html>
<html lang="tr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Spam Kovucu Ultra</title>
<style>
body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Arial;background:radial-gradient(circle at top,#1e40af,#020617 45%);color:white}
.app{max-width:540px;margin:auto;padding:18px}
.card{background:rgba(255,255,255,.09);border:1px solid rgba(255,255,255,.16);border-radius:26px;padding:18px;margin:14px 0;backdrop-filter:blur(22px)}
h1{font-size:32px;margin:8px 0}
p{color:#cbd5e1}
input{width:100%;padding:16px;border:none;border-radius:18px;background:#020617;color:white;font-size:22px;box-sizing:border-box}
button{width:100%;padding:15px;margin-top:12px;border:none;border-radius:18px;font-size:17px;font-weight:900;color:white;background:linear-gradient(135deg,#2563eb,#7c3aed)}
.score{text-align:center;font-size:72px;font-weight:950}
.safe{color:#22c55e}.warn{color:#facc15}.danger{color:#ef4444}
.row{display:flex;justify-content:space-between;gap:12px;padding:12px 0;border-bottom:1px solid rgba(255,255,255,.12)}
.row:last-child{border-bottom:none}
.label{color:#94a3b8}.value{text-align:right;font-weight:800}
.tag{display:inline-block;padding:8px 12px;margin:5px;border-radius:999px;background:rgba(255,255,255,.13);font-size:13px}
.alert{background:rgba(239,68,68,.16);border:1px solid rgba(239,68,68,.45)}
.result{background:rgba(255,255,255,.08);padding:13px;border-radius:16px;margin-top:10px}
a{color:#bfdbfe;text-decoration:none}.small{font-size:13px;color:#94a3b8}
ul{padding-left:20px}li{margin:8px 0;color:#e2e8f0}
.loading{text-align:center;color:#93c5fd}
</style>
</head>
<body>
<div class="app">
<h1>🛡️ Spam Kovucu Ultra</h1>
<p>Tek link çalışan gerçek web sinyalli numara analiz motoru.</p>

<div class="card">
<h2>📞 Numara Sorgula</h2>
<input id="phone" placeholder="Örn: 03126242405">
<button onclick="analyze()">ULTRA ENGINE ANALİZ</button>
</div>

<div id="out"></div>
</div>

<script>
const API = location.origin;

function scoreFromRisk(risk, keywords=[]){
 let s=20;
 if(risk==="Şüpheli")s=55;
 if(risk==="Orta")s=68;
 if(risk==="Yüksek")s=92;
 s += Math.min((keywords||[]).length*3,8);
 return Math.min(s,100);
}
function cls(score){return score>=70?"danger":score>=40?"warn":"safe"}

async function analyze(){
 const phone=document.getElementById("phone").value.trim();
 const out=document.getElementById("out");
 if(!phone){out.innerHTML='<div class="card">Numara gir.</div>';return;}
 out.innerHTML='<div class="card loading">🔍 Ultra OSINT taraması yapılıyor...</div>';

 try{
  const res=await fetch(API+"?number="+encodeURIComponent(phone));
  const data=await res.json();
  const keywords=data.keywords||[];
  const webResults=data.webResults||[];
  const score=scoreFromRisk(data.risk,keywords);
  const color=cls(score);
  const q=encodeURIComponent(data.normalized||phone);

  out.innerHTML=\`
  <div class="card \${score>=70?"alert":""}">
    <h2 style="text-align:center">PRO Risk Skoru</h2>
    <div class="score \${color}">\${score}</div>
    <h2 class="\${color}" style="text-align:center">\${data.risk} Risk</h2>
    <div style="text-align:center">
      <span class="tag">\${data.operator}</span>
      <span class="tag">\${data.city}</span>
      <span class="tag">\${webResults.length} web sonucu</span>
      <span class="tag">\${keywords.length} risk kelimesi</span>
    </div>
  </div>

  <div class="card">
    <h2>🧾 Numara Kimliği</h2>
    <div class="row"><div class="label">Numara</div><div class="value">\${data.number}</div></div>
    <div class="row"><div class="label">Normalize</div><div class="value">\${data.normalized}</div></div>
    <div class="row"><div class="label">Hat / Operatör</div><div class="value">\${data.operator}</div></div>
    <div class="row"><div class="label">Şehir</div><div class="value">\${data.city}</div></div>
    <div class="row"><div class="label">Sahip Tahmini</div><div class="value">\${data.owner}</div></div>
    <div class="row"><div class="label">Firma Tahmini</div><div class="value">\${data.company}</div></div>
    <div class="row"><div class="label">Son Analiz</div><div class="value">\${new Date(data.updatedAt).toLocaleString("tr-TR")}</div></div>
  </div>

  <div class="card">
    <h2>🚩 Şikayet / Spam Bulguları</h2>
    <ul>\${(data.complaints||[]).map(x=>\`<li>\${x}</li>\`).join("")}</ul>
  </div>

  <div class="card">
    <h2>🧠 Risk Keyword Radar</h2>
    \${keywords.length ? keywords.map(k=>\`<span class="tag">\${k}</span>\`).join("") : '<p class="small">Risk kelimesi eşleşmedi.</p>'}
  </div>

  <div class="card">
    <h2>🌐 OSINT İzleri</h2>
    <ul>\${(data.osint||[]).map(x=>\`<li>\${x}</li>\`).join("")}</ul>
  </div>

  <div class="card">
    <h2>📡 Canlı Web Kaynakları</h2>
    \${webResults.length ? webResults.map(r=>\`
      <div class="result">
        <b>\${r.title}</b>
        <p class="small">\${r.snippet}</p>
        <a target="_blank" href="\${r.link}">Kaynağı aç →</a>
      </div>\`).join("") : '<p class="small">Web sonucu bulunamadı.</p>'}
  </div>

  <div class="card">
    <h2>🔎 Manuel Derin Arama</h2>
    <a target="_blank" href="https://www.google.com/search?q=\${q}+şikayet+spam+kimin+numarası">Google’da araştır →</a><br><br>
    <a target="_blank" href="https://www.google.com/search?q=\${q}+dolandırıcı">Dolandırıcı ihtimali ara →</a>
  </div>
  \`;
 }catch(e){
  out.innerHTML='<div class="card alert">❌ API bağlantısı kurulamadı.</div>';
 }
}
</script>
</body>
</html>`;
}
