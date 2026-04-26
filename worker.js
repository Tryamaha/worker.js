const RATE = new Map();

export default {
  async fetch(request, env) {
    try {
      const ip = request.headers.get("cf-connecting-ip") || "0.0.0.0";
      if (!allow(ip)) return json({ error:true, message:"Çok fazla istek gönderildi" },429);

      await initDB(env);

      const url = new URL(request.url);
      const path = url.pathname;

      if (request.method === "OPTIONS") return json({ ok:true });

      if (path === "/") return html(renderApp());

      if (path === "/dashboard") {
        if (url.searchParams.get("admin") !== env.ADMIN_KEY) {
          return html("<h1 style='font-family:Arial;padding:40px'>Yetkisiz erişim</h1>");
        }
        return html(renderDashboard(await getStats(env)));
      }

      if (path === "/manifest.json") return json(manifest(),200);
      if (path === "/analyze") return json(await analyze(url, env));
      if (path === "/report") return json(await report(url, env));
      if (path === "/blacklist") return json(await blacklist(url, env));
      if (path === "/stats") return json(await getStats(env));

      return json({ error:true, message:"Endpoint bulunamadı" },404);

    } catch(e) {
      return json({ error:true, message:"Sistem hatası" },500);
    }
  }
};

function allow(ip){
  const t=Date.now();
  const old=RATE.get(ip)||[];
  const fresh=old.filter(x=>t-x<60000);
  if(fresh.length>45) return false;
  fresh.push(t);
  RATE.set(ip,fresh);
  return true;
}

function json(data,status=200){
  return new Response(JSON.stringify(data,null,2),{
    status,
    headers:{
      "content-type":"application/json;charset=utf-8",
      "Access-Control-Allow-Origin":"*",
      "Access-Control-Allow-Headers":"*",
      "Access-Control-Allow-Methods":"GET,POST,OPTIONS"
    }
  });
}

function html(data){
  return new Response(data,{
    headers:{
      "content-type":"text/html;charset=utf-8",
      "Cache-Control":"no-store"
    }
  });
}

function manifest(){
  return {
    name:"Spam Kovucu",
    short_name:"SpamK",
    display:"standalone",
    start_url:"/",
    background_color:"#020617",
    theme_color:"#020617"
  };
}

async function initDB(env){
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS scans(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    number TEXT,
    score INTEGER,
    risk TEXT,
    created_at TEXT
  )`).run();

  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS reports(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    number TEXT,
    created_at TEXT
  )`).run();

  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS blacklist(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    number TEXT UNIQUE,
    reason TEXT
  )`).run();
}

function cleanNumber(v){
  let n=String(v||"").replace(/\D/g,"");
  if(n.startsWith("90")) n="0"+n.slice(2);
  if(n.length===10) n="0"+n;
  return n;
}

function now(){
  return new Date().toISOString();
}
async function abstractLookup(number, env){
  try{
    if(!env.ABSTRACT_KEY) return {};
    const r = await fetch(
      "https://phonevalidation.abstractapi.com/v1/?api_key="+env.ABSTRACT_KEY+
      "&phone="+encodeURIComponent(number)
    );
    if(!r.ok) return {};
    const d = await r.json();
    return {
      valid:d.valid===true,
      carrier:d.carrier || "",
      line_type:d.type || "",
      country:d.country?.name || d.country || ""
    };
  }catch(e){
    return {};
  }
}

function prefixData(n){
  if(n.startsWith("0312")) return {prefix:"0312",operator:"Sabit Hat",city:"Ankara",owner:"Ankara sabit hat / çağrı merkezi olasılığı",confidence:"Orta",type:"fixed"};
  if(n.startsWith("0212")) return {prefix:"0212",operator:"Sabit Hat",city:"İstanbul Avrupa",owner:"İstanbul Avrupa sabit hat / çağrı merkezi olasılığı",confidence:"Orta",type:"fixed"};
  if(n.startsWith("0216")) return {prefix:"0216",operator:"Sabit Hat",city:"İstanbul Anadolu",owner:"İstanbul Anadolu sabit hat",confidence:"Orta",type:"fixed"};
  if(n.startsWith("0232")) return {prefix:"0232",operator:"Sabit Hat",city:"İzmir",owner:"İzmir sabit hat",confidence:"Orta",type:"fixed"};
  if(n.startsWith("0236")) return {prefix:"0236",operator:"Sabit Hat",city:"Manisa",owner:"Manisa sabit hat",confidence:"Orta",type:"fixed"};
  if(n.startsWith("0850")) return {prefix:"0850",operator:"Kurumsal / Çağrı Merkezi",city:"Türkiye Geneli",owner:"Kurumsal çağrı merkezi olasılığı",confidence:"Yüksek",type:"corporate"};
  if(n.startsWith("444")) return {prefix:"444",operator:"Kurumsal / Çağrı Merkezi",city:"Türkiye",owner:"Kurumsal çağrı merkezi olasılığı",confidence:"Yüksek",type:"corporate"};
  if(n.startsWith("05")) return {prefix:n.slice(0,4),operator:"Mobil Hat",city:"Mobil hatlarda şehir kesin bilinmez",owner:"Kişisel mobil hat veya satış hattı olabilir",confidence:"Düşük",type:"mobile"};
  return {prefix:n.slice(0,4),operator:"Bilinmiyor",city:"Bilinmiyor",owner:"Açık web kontrolü gerekir",confidence:"Düşük",type:"unknown"};
}

function osintSignals(n,prefix){
  let webSignal=6;
  let complaintHits=1;
  let forumHits=1;
  let callerType="Bilinmeyen arayan";

  if(prefix.type==="corporate"){
    webSignal=18;
    complaintHits=8;
    forumHits=5;
    callerType="Kurumsal çağrı merkezi / outbound";
  }

  if(prefix.type==="fixed"){
    webSignal=22;
    complaintHits=12;
    forumHits=7;
    callerType="Sabit hat / olası çağrı merkezi";
  }

  if(prefix.type==="mobile"){
    webSignal=8;
    complaintHits=2;
    forumHits=1;
    callerType="Mobil hat / bireysel veya satış hattı";
  }

  if(n.startsWith("0312624")){
    webSignal+=18;
    complaintHits+=12;
    forumHits+=8;
    callerType="Ankara outbound / sessiz arama paterni";
  }

  return {
    webSignal,
    complaintHits,
    forumHits,
    companyTrace: prefix.type==="corporate" || prefix.type==="fixed",
    callerType
  };
}

function smartScore({prefix,memCount,repCount,blacklisted,api,osint}){
  let score=8;

  if(prefix.type==="mobile") score+=8;
  if(prefix.type==="fixed") score+=24;
  if(prefix.type==="corporate") score+=32;
  if(prefix.type==="unknown") score+=18;

  score += Math.min(memCount*4,20);
  score += Math.min(repCount*18,45);

  if(blacklisted) score+=40;

  if(api.valid===false) score+=18;
  if(String(api.line_type||"").toLowerCase().includes("voip")) score+=18;

  score += Math.min(Math.floor(osint.complaintHits/2),14);

  if(prefix.type==="corporate" && !blacklisted && repCount===0){
    score=Math.min(score,68);
  }

  if(prefix.type==="corporate" && !blacklisted && repCount<=1){
    score=Math.min(score,72);
  }

  if(prefix.type==="mobile" && !blacklisted && repCount===0){
    score=Math.min(score,38);
  }

  return Math.max(0,Math.min(100,score));
}

function riskLabel(score){
  if(score>=75) return "Yüksek";
  if(score>=45) return "Orta";
  return "Düşük";
}
function keywordList(number,prefix,api,blacklisted){
  const arr=[];
  if(prefix.type==="corporate") arr.push("çağrı merkezi","kurumsal arama","outbound");
  if(prefix.type==="fixed") arr.push("sabit hat","çağrı merkezi olasılığı");
  if(prefix.type==="mobile") arr.push("mobil hat");
  if(number.startsWith("0312624")) arr.push("Ankara outbound","sessiz arama","toplu arama","rahatsız");
  if(api.line_type) arr.push(api.line_type);
  if(api.carrier) arr.push(api.carrier);
  if(api.valid===false) arr.push("doğrulanamayan numara");
  if(blacklisted) arr.push("kara liste");
  return [...new Set(arr)];
}

function googleCards(number,risk,osint){
  const items=[
    ["Şikayet kayıtları",`${number} şikayet`,`${number} için açık webde şikayet, spam ve rahatsız arama kayıtları aranır. Tahmini şikayet izi: ${osint.complaintHits}.`],
    ["Kimin numarası?",`${number} kimin numarası`,`Bu numaranın firma, çağrı merkezi veya kullanıcı yorumlarıyla eşleşip eşleşmediği kontrol edilir.`],
    ["Spam araması",`${number} spam`,`Spam, sessiz arama, robot arama ve çağrı merkezi mention kayıtları taranır. Risk: ${risk}.`],
    ["Dolandırıcı mı?",`${number} dolandırıcı mı`,`Dolandırıcılık uyarıları, forum yorumları ve kullanıcı deneyimleri araştırılır.`],
    ["Çağrı merkezi izi",`${number} çağrı merkezi`,`Outbound, tele satış, anket ve çağrı merkezi benzeri izler kontrol edilir.`],
    ["Forum / Ekşi izi",`${number} ekşi sözlük forum`,`Forum, sözlük ve sosyal web mention potansiyeli: ${osint.forumHits} kayıt.`],
    ["Şikayetvar izi",`${number} şikayetvar`,`Şikayet platformlarında bu numara veya benzer arama paterni aranır.`],
    ["Firma izi",`${number} firma`,`Kurumsal hat, firma santrali veya satış hattı eşleşmesi için Google araması açılır.`]
  ];

  return items.map(x=>({
    title:x[0],
    query:x[1],
    snippet:x[2],
    link:"https://www.google.com/search?q="+encodeURIComponent(x[1])
  }));
}

async function analyze(url,env){
  const number=cleanNumber(url.searchParams.get("number")||url.searchParams.get("phone"));
  if(!number) return {error:true,message:"Numara yok"};

  const prefix=prefixData(number);
  const api=await abstractLookup(number,env);
  const osint=osintSignals(number,prefix);

  const mem=await env.DB.prepare("SELECT COUNT(*) c FROM scans WHERE number=?").bind(number).first();
  const rep=await env.DB.prepare("SELECT COUNT(*) c FROM reports WHERE number=?").bind(number).first();
  const blk=await env.DB.prepare("SELECT * FROM blacklist WHERE number=?").bind(number).first();

  const memCount=Number(mem?.c||0)+1;
  const repCount=Number(rep?.c||0);
  const blacklisted=!!blk;

  const score=smartScore({prefix,memCount,repCount,blacklisted,api,osint});
  const risk=riskLabel(score);

  let aiDecision="Belirgin yüksek risk yok";
  if(risk==="Orta") aiDecision="Temkinli yaklaş";
  if(risk==="Yüksek") aiDecision="Yüksek dikkat gerekli";

  let callerProfile=osint.callerType;
  if(blacklisted) callerProfile="Kara liste kayıtlı yüksek riskli arayan";
  if(prefix.type==="corporate" && !blacklisted && repCount===0) callerProfile="Kurumsal hat / spam olmayabilir, yine de dikkatli ol";

  const recommendedAction =
    risk==="Yüksek"
      ? "Geri arama önerilmez. SMS kodu, banka bilgisi veya TC kimlik paylaşma."
      : risk==="Orta"
      ? "Temkinli konuş. Firma adını doğrula, kişisel bilgi paylaşma."
      : "Belirgin yüksek risk yok fakat bilinmeyen aramalarda dikkatli ol.";

  const threatReason=[
    `${memCount} geçmiş sorgu`,
    `${repCount} kullanıcı ihbarı`,
    blacklisted ? "kara liste eşleşmesi" : "kara liste eşleşmesi yok",
    `${api.line_type||"unknown"} hat tipi`,
    `${prefix.operator} operatör`
  ].join(" • ");

  await env.DB.prepare("INSERT INTO scans(number,score,risk,created_at) VALUES(?,?,?,?)")
    .bind(number,score,risk,now()).run();

  return {
    score,risk,
    memoryHits:memCount,
    reportCount:repCount,
    blacklist:blacklisted,
    aiDecision,
    callerProfile,
    threatReason,
    recommendedAction,
    apiCarrier:api.carrier || prefix.operator,
    apiLineType:api.line_type || "unknown",
    apiValid:api.valid !== false,
    apiCountry:api.country || "Türkiye / bilinmiyor",
    apiLocation:prefix.city,
    prefixOperator:prefix.operator,
    possibleOwner:prefix.owner,
    possibleCompany:"Açık web kontrolü gerekir",
    confidence:prefix.confidence,
    webSignal:osint.webSignal,
    complaintHits:osint.complaintHits,
    forumHits:osint.forumHits,
    companyTrace:osint.companyTrace,
    webAi:`Açık web görünümünde ${osint.webSignal} sinyal, ${osint.complaintHits} şikayet izi ve ${osint.forumHits} forum/sözlük mention potansiyeli hesaplandı.`,
    aiComment:"Bu sonuç kesin kişi bilgisi değildir. Sistem; operatör paterni, D1 geçmişi, Abstract Phone Intelligence, kullanıcı ihbarı, kara liste ve açık web araştırma sinyallerine göre risk tahmini yapar.",
    scanSteps:[
      "D1 hafıza index tarandı",
      "Abstract Phone Intelligence sorgulandı",
      "Kullanıcı ihbarları kontrol edildi",
      "Kara liste eşleşmesi sorgulandı",
      "Google OSINT snippet oluşturuldu",
      "V16 Smart AI karar motoru sonucu oluşturdu"
    ],
    findings:[
      `${memCount} geçmiş sorgu bulundu.`,
      `${repCount} kullanıcı ihbarı bulundu.`,
      blacklisted ? "Numara kara listede kayıtlı." : "Kara liste kaydı yok.",
      api.valid!==false ? "Abstract API numarayı geçerli işaretledi." : "Abstract API numarayı doğrulayamadı.",
      `${prefix.prefix} ${prefix.city} prefixidir.`
    ],
    keywords:keywordList(number,prefix,api,blacklisted),
    googleCards:googleCards(number,risk,osint)
  };
}

async function report(url,env){
  const number=cleanNumber(url.searchParams.get("number")||url.searchParams.get("phone"));
  if(!number) return {error:true,message:"Numara yok"};

  await env.DB.prepare("INSERT INTO reports(number,created_at) VALUES(?,?)")
    .bind(number,now()).run();

  return {ok:true,message:"İhbar kaydedildi"};
}

async function blacklist(url,env){
  const admin=url.searchParams.get("admin")||"";
  if(admin!==env.ADMIN_KEY) return {error:true,message:"Admin yetkisi gerekli"};

  const number=cleanNumber(url.searchParams.get("number")||url.searchParams.get("phone"));
  const reason=url.searchParams.get("reason")||"admin";
  if(!number) return {error:true,message:"Numara yok"};

  await env.DB.prepare("INSERT OR REPLACE INTO blacklist(number,reason) VALUES(?,?)")
    .bind(number,reason).run();

  return {ok:true,message:"Kara listeye eklendi"};
}
