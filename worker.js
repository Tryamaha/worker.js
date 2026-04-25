export default {
  async fetch(req, env) {
    try {
      await initDB(env);
      const url = new URL(req.url);
      const path = url.pathname;

      if (path === "/") return html(renderHome());
      if (path === "/dashboard") return html(renderDashboard(await stats(env)));
      if (path === "/health") return json({ ok:true, app:"Spam Kovucu Final Pro", status:"healthy" });
      if (path === "/analyze") return json(await analyze(url, env));
      if (path === "/report") return json(await report(url, env));
      if (path === "/blacklist") return json(await blacklist(url, env));
      if (path === "/stats") return json(await stats(env));

      return json({ error:true, message:"Endpoint yok" },404);
    } catch(e) {
      return json({ error:true, message:String(e) },500);
    }
  }
};

async function initDB(env){
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS searches(
    id INTEGER PRIMARY KEY AUTOINCREMENT, phone TEXT, created_at TEXT
  )`).run();

  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS reports(
    id INTEGER PRIMARY KEY AUTOINCREMENT, phone TEXT, type TEXT, note TEXT, created_at TEXT
  )`).run();

  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS blacklist(
    id INTEGER PRIMARY KEY AUTOINCREMENT, phone TEXT UNIQUE, reason TEXT, created_at TEXT
  )`).run();
}

function clean(v){
  let n=String(v||"").replace(/\D/g,"");
  if(n.startsWith("90")) n="0"+n.slice(2);
  if(n.length===10) n="0"+n;
  return n;
}
function now(){return new Date().toISOString()}
function json(d,s=200){return new Response(JSON.stringify(d,null,2),{status:s,headers:{"content-type":"application/json;charset=utf-8","Access-Control-Allow-Origin":"*"}})}
function html(x){return new Response(x,{headers:{"content-type":"text/html;charset=utf-8","Cache-Control":"no-store"}})}

async function analyze(url,env){
  const phone=clean(url.searchParams.get("number")||url.searchParams.get("phone"));
  if(!phone) return {error:true,message:"Numara gerekli"};

  await env.DB.prepare("INSERT INTO searches(phone,created_at) VALUES(?,?)").bind(phone,now()).run();

  const mem=await env.DB.prepare("SELECT COUNT(*) c FROM searches WHERE phone=?").bind(phone).first();
  const rep=await env.DB.prepare("SELECT COUNT(*) c FROM reports WHERE phone=?").bind(phone).first();
  const blk=await env.DB.prepare("SELECT COUNT(*) c FROM blacklist WHERE phone=?").bind(phone).first();

  const id=identity(phone);
  const words=riskWords(phone,id);
  let score=id.base + mem.c*7 + rep.c*18 + blk.c*35 + words.length*6;
  score=Math.min(score,100);

  const risk=score>=75?"Yüksek":score>=45?"Orta":"Düşük";

  const google=[
    `${phone} kimin numarası`,
    `${phone} şikayet`,
    `${phone} spam`,
    `${phone} dolandırıcı mı`,
    `${phone} çağrı merkezi`,
    `${phone} firma`,
    `${phone} sikayetvar`,
    `${phone} ekşi`,
    `${phone} forum`
  ].map(q=>({title:q,link:"https://www.google.com/search?q="+encodeURIComponent(q)}));

  return {
    phone, risk, score,
    memoryHits:mem.c,
    reportCount:rep.c,
    blacklist:blk.c>0,
    operator:id.operator,
    city:id.city,
    possibleOwner:id.owner,
    possibleCompany:id.company,
    confidence:id.confidence,
    aiComment:`Bu sonuç kesin kişi bilgisi değildir. AI motoru prefix, operatör, şehir, geçmiş sorgu, kullanıcı ihbarı, kara liste ve açık web arama sinyallerine göre ${risk.toLowerCase()} risk tahmini yapıyor.`,
    findings:[
      `${mem.c} geçmiş sorgu kaydı bulundu.`,
      `${rep.c} kullanıcı ihbarı bulundu.`,
      blk.c>0 ? "Numara kara listede kayıtlı." : "Kara liste kaydı yok.",
      id.note
    ],
    keywords:words,
    webResults:google,
    analyzedAt:new Date().toLocaleString("tr-TR")
  };
}

function identity(n){
  if(n.startsWith("0312")) return {operator:"Sabit Hat",city:"Ankara",base:25,owner:"Ankara sabit hat / çağrı merkezi olasılığı",company:"Açık web kontrolü gerekir",confidence:"Orta",note:"0312 Ankara sabit hat prefixidir."};
  if(n.startsWith("0212")) return {operator:"Sabit Hat",city:"İstanbul Avrupa",base:25,owner:"İstanbul Avrupa sabit hat",company:"Açık web kontrolü gerekir",confidence:"Orta",note:"0212 İstanbul Avrupa sabit hat prefixidir."};
  if(n.startsWith("0216")) return {operator:"Sabit Hat",city:"İstanbul Anadolu",base:25,owner:"İstanbul Anadolu sabit hat",company:"Açık web kontrolü gerekir",confidence:"Orta",note:"0216 İstanbul Anadolu sabit hat prefixidir."};
  if(n.startsWith("0232")) return {operator:"Sabit Hat",city:"İzmir",base:20,owner:"İzmir sabit hat",company:"Açık web kontrolü gerekir",confidence:"Orta",note:"0232 İzmir sabit hat prefixidir."};
  if(n.startsWith("0236")) return {operator:"Sabit Hat",city:"Manisa",base:20,owner:"Manisa sabit hat",company:"Açık web kontrolü gerekir",confidence:"Orta",note:"0236 Manisa sabit hat prefixidir."};
  if(n.startsWith("0850")) return {operator:"Kurumsal / Çağrı Merkezi",city:"Türkiye Geneli",base:45,owner:"Kurumsal çağrı merkezi olasılığı",company:"Firma tespiti için Google/Sikayetvar kontrolü gerekir",confidence:"Yüksek",note:"0850 genelde kurumsal/çağrı merkezi hatlarında görülür."};
  if(n.startsWith("444")) return {operator:"Kurumsal / Çağrı Merkezi",city:"Türkiye Geneli",base:45,owner:"Kurumsal çağrı merkezi olasılığı",company:"Firma tespiti için açık web kontrolü gerekir",confidence:"Yüksek",note:"444 hatları genelde kurumsal çağrı merkezi numarasıdır."};
  if(n.startsWith("0549")) return {operator:"Vodafone",city:"Mobil hatlarda şehir kesin bilinmez",base:12,owner:"Kişisel mobil hat veya satış/spam hattı olabilir",company:"Kesin firma için açık web kontrolü gerekir",confidence:"Düşük",note:"Mobil numaralarda gerçek kişi/firma bilgisi açık veriden kesin bilinemez."};
  if(n.startsWith("053")) return {operator:"Turkcell",city:"Mobil hatlarda şehir kesin bilinmez",base:12,owner:"Kişisel mobil hat veya satış/spam hattı olabilir",company:"Kesin firma için açık web kontrolü gerekir",confidence:"Düşük",note:"Mobil numaralarda şehir/kişi bilgisi kesin çıkarılamaz."};
  if(n.startsWith("055")) return {operator:"Türk Telekom",city:"Mobil hatlarda şehir kesin bilinmez",base:12,owner:"Kişisel mobil hat veya satış/spam hattı olabilir",company:"Kesin firma için açık web kontrolü gerekir",confidence:"Düşük",note:"Mobil numaralarda gerçek sahip kapalı bilgidir."};
  if(n.startsWith("05")) return {operator:"Mobil Hat",city:"Mobil hatlarda şehir kesin bilinmez",base:10,owner:"Kişisel mobil hat veya satış/spam hattı olabilir",company:"Kesin firma için açık web kontrolü gerekir",confidence:"Düşük",note:"Mobil hatlarda gerçek kişi adı güvenilir şekilde bilinemez."};
  return {operator:"Bilinmiyor",city:"-",base:10,owner:"Belirsiz",company:"Açık web kontrolü gerekir",confidence:"Düşük",note:"Numara prefixi kesin tanımlanamadı."};
}

function riskWords(n,id){
  const a=[];
  if(id.operator.includes("Çağrı")) a.push("çağrı merkezi","kurumsal arama","robot","spam");
  if(id.operator==="Sabit Hat") a.push("sabit hat");
  if(n.startsWith("0312624")) a.push("Ankara outbound","rahatsız","sessiz arama","toplu arama");
  if(n.startsWith("05")) a.push("mobil hat");
  return [...new Set(a)];
}

async function report(url,env){
  const phone=clean(url.searchParams.get("number")||url.searchParams.get("phone"));
  const type=url.searchParams.get("type")||"spam";
  const note=url.searchParams.get("note")||"manuel ihbar";
  if(!phone)return {error:true,message:"Numara gerekli"};
  await env.DB.prepare("INSERT INTO reports(phone,type,note,created_at) VALUES(?,?,?,?)").bind(phone,type,note,now()).run();
  return {ok:true,message:"İhbar kaydedildi",phone};
}

async function blacklist(url,env){
  const phone=clean(url.searchParams.get("number")||url.searchParams.get("phone"));
  const reason=url.searchParams.get("reason")||"manuel";
  if(!phone)return {error:true,message:"Numara gerekli"};
  await env.DB.prepare("INSERT OR REPLACE INTO blacklist(phone,reason,created_at) VALUES(?,?,?)").bind(phone,reason,now()).run();
  return {ok:true,message:"Kara listeye eklendi",phone};
}

async function stats(env){
  const total=await env.DB.prepare("SELECT COUNT(DISTINCT phone) c FROM searches").first();
  const reports=await env.DB.prepare("SELECT COUNT(*) c FROM reports").first();
  const black=await env.DB.prepare("SELECT COUNT(*) c FROM blacklist").first();
  const top=await env.DB.prepare("SELECT phone,COUNT(*) c FROM searches GROUP BY phone ORDER BY c DESC LIMIT 15").all();
  const lastReports=await env.DB.prepare("SELECT phone,type,note,created_at FROM reports ORDER BY id DESC LIMIT 10").all();
  const lastBlack=await env.DB.prepare("SELECT phone,reason,created_at FROM blacklist ORDER BY id DESC LIMIT 10").all();
  return {total:total.c,reports:reports.c,black:black.c,top:top.results||[],lastReports:lastReports.results||[],lastBlack:lastBlack.results||[]};
}

function renderHome(){
return `<!DOCTYPE html><html lang="tr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Spam Kovucu Final Pro</title>
<style>
body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Arial;background:radial-gradient(circle at top,#1d4ed8,#020617);color:#fff}.app{max-width:650px;margin:auto;padding:22px}.card{background:#111827;border:1px solid #334155;border-radius:30px;padding:22px;margin:18px 0}input{width:100%;padding:20px;font-size:22px;border-radius:20px;border:0;background:#020617;color:#fff;box-sizing:border-box}button{width:100%;padding:18px;border:0;border-radius:20px;font-size:22px;font-weight:800;background:linear-gradient(90deg,#2563eb,#7c3aed);color:#fff}.bar{height:16px;background:#1e293b;border-radius:20px;overflow:hidden}.fill{height:100%;width:0;background:linear-gradient(90deg,#22c55e,#eab308,#ef4444);transition:1.4s}.tag{display:inline-block;background:#2b3445;padding:8px 14px;border-radius:20px;margin:4px}a{color:#60a5fa}li{margin:8px 0}.muted{color:#cbd5e1}
</style></head><body><div class="app">
<h1>🛡 Spam Kovucu Final Pro</h1>
<p class="muted">Bilinmeyen numara analizi: AI + D1 hafıza + ihbar + kara liste + Google OSINT.</p>
<div class="card"><input id="num" placeholder="Telefon numarası"><br><br><button onclick="tara()">FULL ANALİZ BAŞLAT</button></div>
<div id="sonuc"></div>
<div class="card"><button onclick="location.href='/dashboard'">📊 Pro Dashboard</button></div>
</div>
<script>
async function tara(){
 const n=document.getElementById("num").value.trim();
 if(!n)return alert("Numara gir");
 sonuc.innerHTML='<div class="card"><h2>🧠 AI analiz ediyor...</h2></div>';
 const r=await fetch('/analyze?number='+encodeURIComponent(n)+'&v='+Date.now());
 const d=await r.json();
 if(d.error){sonuc.innerHTML='<div class="card">'+d.message+'</div>';return}
 if(d.score>=75&&navigator.vibrate)navigator.vibrate([250,100,250]);
 sonuc.innerHTML=
 '<div class="card"><h2>Risk Seviyesi</h2><div style="font-size:64px;font-weight:900">'+d.risk+'</div><div class="bar"><div id="fill" class="fill"></div></div><br><b>Skor:</b> '+d.score+'<br><b>Hafıza:</b> '+d.memoryHits+'<br><b>İhbar:</b> '+d.reportCount+'<br><b>Kara Liste:</b> '+(d.blacklist?'EVET':'HAYIR')+'</div>'+
 '<div class="card"><h2>🤖 AI Yorumu</h2><p>'+d.aiComment+'</p></div>'+
 '<div class="card"><h2>📇 Numara Kimliği</h2><p><b>Operatör:</b> '+d.operator+'</p><p><b>Şehir:</b> '+d.city+'</p><p><b>Muhtemel Sahip:</b> '+d.possibleOwner+'</p><p><b>Muhtemel Firma:</b> '+d.possibleCompany+'</p><p><b>Güven:</b> '+d.confidence+'</p></div>'+
 '<div class="card"><h2>🚨 Bulgular</h2><ul>'+d.findings.map(x=>'<li>'+x+'</li>').join('')+'</ul></div>'+
 '<div class="card"><h2>🧬 Risk Kelimeleri</h2>'+d.keywords.map(x=>'<span class="tag">'+x+'</span>').join('')+'</div>'+
 '<div class="card"><h2>🌍 Google Açık Web Araştırması</h2>'+d.webResults.map(x=>'<p><a target="_blank" href="'+x.link+'">'+x.title+'</a></p>').join('')+'</div>'+
 '<div class="card"><button onclick="ihbar()">🚨 Spam İhbar</button><br><br><button onclick="kara()">⛔ Kara Liste</button></div>';
 setTimeout(()=>document.getElementById("fill").style.width=d.score+"%",200);
}
async function ihbar(){const n=num.value.trim();await fetch('/report?number='+encodeURIComponent(n)+'&type=spam&note=manuel');alert('İhbar kaydedildi');tara()}
async function kara(){const n=num.value.trim();await fetch('/blacklist?number='+encodeURIComponent(n)+'&reason=manuel');alert('Kara listeye eklendi');tara()}
</script></body></html>`;
}

function renderDashboard(s){
return `<!DOCTYPE html><html lang="tr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Dashboard</title>
<style>body{margin:0;font-family:-apple-system;background:radial-gradient(circle at top,#1d4ed8,#020617);color:#fff}.app{max-width:650px;margin:auto;padding:22px}.card{background:#111827;border:1px solid #334155;border-radius:30px;padding:22px;margin:18px 0}.grid{display:grid;grid-template-columns:1fr 1fr;gap:18px}.value{font-size:52px;font-weight:900}button{width:100%;padding:20px;border:0;border-radius:20px;font-size:22px;font-weight:800;background:linear-gradient(90deg,#2563eb,#7c3aed);color:#fff}li{margin:10px 0}</style></head><body><div class="app">
<h1>📊 Spam Kovucu Pro Dashboard</h1>
<div class="grid"><div class="card">Numara<div class="value">${s.total}</div></div><div class="card">İhbar<div class="value">${s.reports}</div></div><div class="card">Kara Liste<div class="value">${s.black}</div></div><div class="card">Motor<div class="value">Aktif</div></div></div>
<div class="card"><h2>🔥 En Çok Sorgulananlar</h2><ul>${s.top.map(x=>`<li>${x.phone} — ${x.c} sorgu</li>`).join("")||"<li>Kayıt yok</li>"}</ul></div>
<div class="card"><h2>🚨 Son İhbarlar</h2><ul>${s.lastReports.map(x=>`<li>${x.phone} — ${x.type} — ${x.note||""}</li>`).join("")||"<li>İhbar yok</li>"}</ul></div>
<div class="card"><h2>⛔ Kara Liste</h2><ul>${s.lastBlack.map(x=>`<li>${x.phone} — ${x.reason}</li>`).join("")||"<li>Kayıt yok</li>"}</ul></div>
<div class="card"><button onclick="location.href='/'">🏠 Ana Ekrana Dön</button></div>
</div></body></html>`;
}
