<!DOCTYPE html>
<html lang="tr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Spam Kovucu PRO</title>
<style>
body{
  margin:0;
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif;
  background:radial-gradient(circle at top,#1e40af,#020617 45%);
  color:white;
}
.app{
  max-width:520px;
  margin:auto;
  padding:18px;
}
.card{
  background:rgba(255,255,255,.09);
  border:1px solid rgba(255,255,255,.15);
  border-radius:24px;
  padding:18px;
  margin:14px 0;
  backdrop-filter:blur(20px);
}
h1{font-size:31px;margin-bottom:4px}
p{color:#cbd5e1}
input{
  width:100%;
  padding:16px;
  border:none;
  border-radius:18px;
  background:#020617;
  color:white;
  font-size:22px;
  box-sizing:border-box;
}
button{
  width:100%;
  padding:15px;
  margin-top:12px;
  border:none;
  border-radius:18px;
  font-size:17px;
  font-weight:800;
  color:white;
  background:linear-gradient(135deg,#2563eb,#7c3aed);
}
.score{
  text-align:center;
  font-size:66px;
  font-weight:900;
}
.safe{color:#22c55e}
.warn{color:#facc15}
.danger{color:#ef4444}
.row{
  display:flex;
  justify-content:space-between;
  gap:12px;
  padding:12px 0;
  border-bottom:1px solid rgba(255,255,255,.12);
}
.row:last-child{border-bottom:none}
.label{color:#94a3b8}
.value{text-align:right;font-weight:700}
.tag{
  display:inline-block;
  padding:7px 12px;
  margin:4px;
  border-radius:999px;
  background:rgba(255,255,255,.12);
  font-size:13px;
}
.loading{text-align:center;color:#93c5fd}
ul{padding-left:20px}
li{margin:7px 0;color:#e2e8f0}
a{
  display:block;
  color:#bfdbfe;
  text-decoration:none;
  background:rgba(255,255,255,.08);
  padding:12px;
  border-radius:14px;
  margin-top:8px;
}
.small{font-size:13px;color:#94a3b8}
</style>
</head>
<body>

<div class="app">

  <h1>🛡️ Spam Kovucu PRO</h1>
  <p>Arayan numaranın spam, dolandırıcı, makine araması veya çağrı merkezi olma riskini analiz eder.</p>

  <div class="card">
    <h2>📞 Numara Sorgula</h2>
    <input id="phone" placeholder="Örn: 03126242405">
    <button onclick="analyze()">FULL AUTO OSINT ANALİZ</button>
  </div>

  <div id="out"></div>

</div>

<script>
const API = "https://spam-kovucu-api.tryamaneha.workers.dev";

function riskScore(risk){
  if(risk === "Yüksek") return 92;
  if(risk === "Orta") return 58;
  if(risk === "Şüpheli") return 72;
  return 22;
}

function riskClass(score){
  if(score >= 70) return "danger";
  if(score >= 40) return "warn";
  return "safe";
}

async function analyze(){
  const phone = document.getElementById("phone").value.trim();
  const out = document.getElementById("out");

  if(!phone){
    out.innerHTML = `<div class="card">Numara gir.</div>`;
    return;
  }

  out.innerHTML = `<div class="card loading">🔍 Numara analiz ediliyor...</div>`;

  try{
    const res = await fetch(API + "?number=" + encodeURIComponent(phone));
    const data = await res.json();

    const score = riskScore(data.risk);
    const cls = riskClass(score);
    const q = encodeURIComponent(data.normalized || phone);

    out.innerHTML = `
      <div class="card">
        <h2 style="text-align:center">PRO Risk Skoru</h2>
        <div class="score ${cls}">${score}</div>
        <h2 class="${cls}" style="text-align:center">${data.risk} Risk</h2>
        <div style="text-align:center">
          <span class="tag">${data.operator}</span>
          <span class="tag">${data.city}</span>
          <span class="tag">${data.company}</span>
        </div>
      </div>

      <div class="card">
        <h2>🧾 Numara Kimliği</h2>
        <div class="row"><div class="label">Numara</div><div class="value">${data.number}</div></div>
        <div class="row"><div class="label">Normalize</div><div class="value">${data.normalized}</div></div>
        <div class="row"><div class="label">Operatör / Hat</div><div class="value">${data.operator}</div></div>
        <div class="row"><div class="label">Şehir / Bölge</div><div class="value">${data.city}</div></div>
        <div class="row"><div class="label">Sahip Tahmini</div><div class="value">${data.owner}</div></div>
        <div class="row"><div class="label">Firma Tahmini</div><div class="value">${data.company}</div></div>
      </div>

      <div class="card">
        <h2>🚩 Şikayet / Spam Bulguları</h2>
        ${
          data.complaints && data.complaints.length
          ? `<ul>${data.complaints.map(x=>`<li>${x}</li>`).join("")}</ul>`
          : `<p class="small">Kayıtlı şikayet sinyali bulunmadı.</p>`
        }
      </div>

      <div class="card">
        <h2>🌐 OSINT İzleri</h2>
        <ul>${data.osint.map(x=>`<li>${x}</li>`).join("")}</ul>
      </div>

      <div class="card">
        <h2>🔎 Canlı Web Araştırması</h2>
        <a target="_blank" href="https://www.google.com/search?q=${q}+şikayet+spam+kimin+numarası">Google’da araştır</a>
        <a target="_blank" href="https://www.google.com/search?q=${q}+dolandırıcı">Dolandırıcı ihtimali ara</a>
        <a target="_blank" href="https://www.google.com/search?q=${q}+çağrı+merkezi+anket">Çağrı merkezi / anket ara</a>
      </div>

      <div class="card">
        <h2>🛡️ Tavsiye</h2>
        <ul>
          <li>SMS kodu, banka bilgisi, TC kimlik ve adres verme.</li>
          <li>“Evet / onaylıyorum” deme.</li>
          <li>Banka veya kurum diyorsa kapatıp resmî numarayı ara.</li>
          <li>Yüksek riskte engelle.</li>
        </ul>
      </div>
    `;

  }catch(e){
    out.innerHTML = `
      <div class="card">
        ❌ API bağlantısı kurulamadı.
        <p class="small">Worker linkini kontrol et.</p>
      </div>
    `;
  }
}
</script>

</body>
</html>
