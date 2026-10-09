// ==UserScript==
// @name         Sinyal Botu
// @namespace    sinyalbotu
// @version      2.0
// @description  Bilyoner futbol maçlarını tarar; her maç için 10 üzerinden puanlı bir ana sinyal ve barajı geçen diğer sinyalleri gerekçesiyle verir
// @match        https://www.bilyoner.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_setClipboard
// @connect      statshub.com
// @connect      www.statshub.com
// @connect      www.bilyoner.com
// @run-at       document-end
// @downloadURL  https://raw.githubusercontent.com/citomuhammet00/mac-arsivi/main/SinyalBotu.user.js
// @updateURL    https://raw.githubusercontent.com/citomuhammet00/mac-arsivi/main/SinyalBotu.user.js
// ==/UserScript==
(function () {
  'use strict';

  const SURUM = '2.0';
  const ayar = Object.assign({ pencere: 3, macSayisi: 10 }, GM_getValue('sb_ayar', {}));
  const ayarKaydet = () => GM_setValue('sb_ayar', Object.assign({}, ayar));
  const lim0 = () => Number(ayar.macSayisi) || 10;

  // Sinyal kuralları
  const ESIK = {
    puan: 6,             // 10 üzerinden en az bu puan → sinyal
    minGetiri: 0.05,     // bot hesabına göre en az %5 beklenen getiri
    minIhtimal: 0.30,    // çok düşük ihtimalli seçime sinyal yok
    minMac: 5,           // oyuncu en az 5 maçta süre almış olmalı
    farkSuphe: 0.40,     // Bilyoner diğer siteden %40+ yüksekse → eşleşme şüpheli, sinyal yok
    modelPiyasa: 0.22,   // hesabım piyasanın ihtimalinden 22 puandan fazla yüksekse → hesap şüpheli
    getiriSuphe: 0.80    // %80+ beklenen getiri → büyük ihtimalle veri hatası
  };
  const DIGER_MAX = 3;   // ana sinyalin altında en fazla kaç sinyal

  // ---------- Pazar tanımları ----------
  // Oyuncu pazarları: şut, kaleyi bulan şut, top çalma, kart
  const OTIP = {
    sut: { ad: 'Şut', birim: 'şut', market: 'PLAYER_SHOTS', deger: st => +st.shots || 0, yon: 1, takimKey: 'totalShotsOnGoal' },
    isabetli: { ad: 'Kaleyi Bulan Şut', birim: 'kaleyi bulan şut', market: 'PLAYER_SHOTS_ON_TARGET', deger: st => +st.onTargetScoringAttempt || 0, yon: 1, takimKey: 'shotsOnGoal' },
    topcalma: { ad: 'Top Çalma', birim: 'top çalma', market: 'PLAYER_TACKLES', deger: st => +st.totalTackle || 0, yon: -1 },
    kart: { ad: 'Oyuncu Kart', birim: 'kart', market: 'PLAYER_CARDS', deger: st => (+st.yellowCard || 0) + (+st.redCard || 0), yon: 0 }
  };
  // 1.0'dan kalan kayıtların sonucunu kontrol edebilmek için
  const ESKI_TIP = {
    faul: { birim: 'faul', deger: st => +st.fouls || 0 },
    maruz: { birim: 'faule maruz kalma', deger: st => +st.wasFouled || 0 }
  };
  const TPAZAR = [
    ['kale vurusu', 'goalKicks', 'Kale Vuruşu', 'kale vuruşu'],
    ['kurtaris', 'goalkeeperSaves', 'Kurtarış', 'kurtarış'],
    ['isabetli', 'shotsOnGoal', 'İsabetli Şut', 'isabetli şut'],
    ['korner', 'cornerKicks', 'Korner', 'korner'],
    ['faul', 'fouls', 'Faul', 'faul'],
    ['ofsayt', 'offsides', 'Ofsayt', 'ofsayt'],
    ['tac', 'throwIns', 'Taç', 'taç'],
    ['kart', 'cards', 'Kart', 'kart'],
    ['sut', 'totalShotsOnGoal', 'Şut', 'şut']
  ];
  const PAZAR_GUC = { totalShotsOnGoal: 0.25, shotsOnGoal: 0.28, cornerKicks: 0.22, offsides: 0.10, fouls: -0.05, throwIns: 0, goalKicks: -0.15, goalkeeperSaves: -0.25, cards: -0.05 };
  const ACIKLIK = { totalShotsOnGoal: 1, shotsOnGoal: 1, cornerKicks: 0.6 };
  const LIG_STAT = { totalShotsOnGoal: 'shots', shotsOnGoal: 'onTargetScoringAttempt', fouls: 'fouls', cards: 'yellowCard' };
  const YASAK = /(^| )(fark|farki|farkla|handikap|handikapli|hnd|daha fazla|daha cok|hangi|hangisi|kim|ilk|son|yaris|once|tek|cift|dakika|marj|kombo|kombine|birlikte|aralik|araligi|puan|puani|maruz|kazanir|kapma|mudahale)( |$)/;
  const yariTemizle = s => s.replace(/ilk yari|ikinci yari|1\.? ?yari|2\.? ?yari/g, ' ');
  const ETIKET_BOS = ['toplam', 'ust', 'alt', 'evet', 'hayir', 'var', 'yok', 'mac', 'takim', 'oyuncu', 'tek', 'cift', 'yari', 'ilk', 'ikinci',
    'sahibi', 'evsahibi', 'deplasman', 'dep', 'misafir'];

  // Mevki: [hücum seviyesi, Türkçe adı]
  const POZ = {
    GK: [0, 'kaleci'], G: [0, 'kaleci'], CB: [1, 'stoper'], LB: [2, 'sol bek'], RB: [2, 'sağ bek'],
    LWB: [3, 'sol kanat bek'], RWB: [3, 'sağ kanat bek'], CDM: [3, 'ön libero'], CM: [4, 'merkez orta saha'],
    LM: [5, 'sol orta saha'], RM: [5, 'sağ orta saha'], CAM: [6, 'on numara'], LW: [7, 'sol kanat'], RW: [7, 'sağ kanat'],
    LF: [7.5, 'sol forvet'], RF: [7.5, 'sağ forvet'], ST: [8, 'santrfor'],
    D: [1.5, 'defans'], M: [4, 'orta saha'], F: [7.5, 'forvet']
  };
  const POZ_ES = { LCB: 'CB', RCB: 'CB', LCDM: 'CDM', RCDM: 'CDM', DM: 'CDM', LDM: 'CDM', RDM: 'CDM', LCM: 'CM', RCM: 'CM', LCAM: 'CAM', RCAM: 'CAM', AM: 'CAM', LS: 'ST', RS: 'ST', CF: 'ST' };
  const GENEL_POZ = ['D', 'M', 'F', 'G'];
  const pozKod = p => { const k = String(p || '').toUpperCase().trim(); return POZ_ES[k] || k; };

  const ULKE = {};
  ('turkiye:turkey|almanya:germany|fransa:france|ingiltere:england|ispanya:spain|italya:italy|portekiz:portugal|hollanda:netherlands|belcika:belgium|hirvatistan:croatia|sirbistan:serbia|norvec:norway|isvec:sweden|danimarka:denmark|finlandiya:finland|izlanda:iceland|iskocya:scotland|galler:wales|kuzey irlanda:northern ireland|irlanda:ireland|avusturya:austria|isvicre:switzerland|polonya:poland|cekya:czech republic|cek cumhuriyeti:czech republic|slovakya:slovakia|macaristan:hungary|romanya:romania|bulgaristan:bulgaria|yunanistan:greece|arnavutluk:albania|kosova:kosovo|karadag:montenegro|bosna hersek:bosnia herzegovina|kuzey makedonya:north macedonia|slovenya:slovenia|ukrayna:ukraine|rusya:russia|beyaz rusya:belarus|belarus:belarus|gurcistan:georgia|ermenistan:armenia|azerbaycan:azerbaijan|kazakistan:kazakhstan|litvanya:lithuania|letonya:latvia|estonya:estonia|moldova:moldova|malta:malta|kibris:cyprus|luksemburg:luxembourg|andorra:andorra|san marino:san marino|lihtenstayn:liechtenstein|faroe adalari:faroe islands|cebelitarik:gibraltar|israil:israel|brezilya:brazil|arjantin:argentina|abd:usa|meksika:mexico|japonya:japan|guney kore:south korea|fas:morocco|misir:egypt')
    .split('|').forEach(p => { const x = p.split(':'); ULKE[x[0]] = x[1]; });
  const ULKE_ANAHTAR = Object.keys(ULKE).sort((a, b) => b.length - a.length);

  // ---------- Yardımcılar ----------
  function norm(s) {
    return String(s || '').replace(/İ/g, 'i').replace(/I/g, 'ı').toLowerCase().replace(/ı/g, 'i')
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9+,. ]/g, ' ').replace(/\s+/g, ' ').trim();
  }
  function cevir(ad) {
    const n = norm(ad);
    for (const k of ULKE_ANAHTAR) if (n === k || n.startsWith(k + ' ')) return ULKE[k] + n.slice(k.length);
    return n;
  }
  const BOS = ['fk', 'fc', 'sk', 'afc', 'club', 'spor', 'kulubu', 'cf', 'sc'];
  const tokenlar = s => norm(s).replace(/[+,.]/g, ' ').split(' ').filter(t => t.length >= 3 && BOS.indexOf(t) < 0);
  function benzerlik(a, b, gencKontrol) {
    if (gencKontrol) {
      const genc = x => x.some(t => /^u\d\d$/.test(t));
      if (genc(a) !== genc(b)) return 0;
    }
    let p = 0;
    a.forEach(t => { if (b.some(s => s === t || (t.length >= 4 && s.length >= 4 && s.slice(0, 4) === t.slice(0, 4)))) p++; });
    return p;
  }
  function isimPuan(a, b) {
    const A = tokenlar(a), B = tokenlar(b);
    let p = 0;
    A.forEach(t => {
      if (B.some(s => s === t)) p += 2;
      else if (B.some(s => t.length >= 4 && s.length >= 4 && s.slice(0, 4) === t.slice(0, 4))) p += 1.5;
    });
    return p;
  }
  // Oyuncu adı kelimeleri; "Jr", "Junior" gibi ekler soyad sayılmaz
  const EKLER = ['jr', 'junior', 'sr', 'ii', 'iii', 'filho', 'neto'];
  function adKelime(s) {
    const t = norm(s).replace(/[+,.]/g, ' ').split(' ').filter(x => x.length >= 2);
    while (t.length > 1 && EKLER.indexOf(t[t.length - 1]) >= 0) t.pop();
    return t;
  }
  // Sıkı kural: Bilyoner'deki soyad (son kelime) adayın adında birebir geçmeli.
  // Sadece aynı ön adı taşıyan başka oyuncu ("Aleksey ...") artık eşleşmez.
  function soyadTutar(ad, aday) {
    const A = adKelime(ad), B = adKelime(aday);
    if (!A.length || !B.length) return false;
    const soyad = A[A.length - 1];
    return soyad.length >= 3 && B.indexOf(soyad) >= 0;
  }
  function enIyiAday(ad, liste, adF, idF) {
    let iyi = null, puan = 0, belirsiz = false;
    liste.forEach(x => {
      if (!soyadTutar(ad, adF(x))) return;
      const p = isimPuan(ad, adF(x)) + 0.1;
      if (p > puan) { puan = p; iyi = x; belirsiz = false; }
      else if (p === puan && iyi && String(idF(x)) !== String(idF(iyi))) belirsiz = true;
    });
    return iyi && !belirsiz ? iyi : null;
  }
  const h = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const v1 = x => (Math.round(x * 10) / 10).toFixed(1).replace('.', ',');
  const v2 = x => Number(x).toFixed(2).replace('.', ',');
  const yuzde = x => '%' + Math.round(x * 100);
  const isaretli = x => (x >= 0 ? '+' : '') + Math.round(x * 100) + '%';
  const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN;
  const sinirla = (x, a, b) => Math.min(b, Math.max(a, x));

  function dagilimOrani(degerler) {
    const n = degerler.length;
    if (n < 3) return 1;
    const m = degerler.reduce((a, b) => a + b, 0) / n;
    if (m <= 0) return 1;
    const v = degerler.reduce((a, b) => a + (b - m) * (b - m), 0) / (n - 1);
    const kucuk = 1 + (v / m - 1) * n / (n + 10);
    return Math.min(2, Math.max(1, 1 + (kucuk - 1) * 0.7));
  }
  function pmfDizi(l, d, maxK) {
    const a = [];
    if (!(l > 0)) { a.push(1); for (let k = 1; k <= maxK; k++) a.push(0); return a; }
    if (!d || d <= 1.01) {
      let t = Math.exp(-l); a.push(t);
      for (let k = 1; k <= maxK; k++) { t *= l / k; a.push(t); }
    } else {
      const r = l / (d - 1), q = l / (r + l);
      let t = Math.pow(r / (r + l), r); a.push(t);
      for (let k = 1; k <= maxK; k++) { t *= (k - 1 + r) / k * q; a.push(t); }
    }
    return a;
  }
  function olasilik(l, esik, yon, d) {
    const a = pmfDizi(l, d, Math.max(esik, 0));
    const sinir = yon === 'ust' ? esik - 1 : esik;
    let top = 0;
    for (let k = 0; k <= sinir; k++) top += a[k];
    top = sinirla(top, 0, 1);
    return yon === 'ust' ? 1 - top : top;
  }
  function sinirlar(arr) {
    const s = arr.slice().sort((a, b) => a - b);
    const q = p => s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))];
    const q1 = q(0.25), q3 = q(0.75), iqr = Math.max(q3 - q1, 1);
    return [Math.max(0, q1 - 1.5 * iqr), q3 + 1.5 * iqr];
  }
  function kirp(rows) {
    if (rows.length < 4) return rows;
    const [kl, kh] = sinirlar(rows.map(r => r.kendi)), [rl, rh] = sinirlar(rows.map(r => r.rakip));
    return rows.map(r => Object.assign({}, r, { kendi: sinirla(r.kendi, kl, kh), rakip: sinirla(r.rakip, rl, rh) }));
  }
  function aort(dizi, f) {
    if (!dizi.length) return NaN;
    let s = 0, ws = 0;
    dizi.forEach((r, i) => { const w = Math.pow(0.85, i); s += w * f(r); ws += w; });
    return s / ws;
  }

  function al(url) {
    return new Promise((coz, red) => {
      GM_xmlhttpRequest({
        method: 'GET', url, timeout: 25000,
        headers: { Accept: 'application/json' },
        onload: r => {
          if (r.status !== 200) return red(new Error('Sunucu cevabı ' + r.status));
          try { coz(JSON.parse(r.responseText)); } catch (e) { red(new Error('Veri okunamadı')); }
        },
        onerror: () => red(new Error('Bağlantı hatası')),
        ontimeout: () => red(new Error('Zaman aşımı'))
      });
    });
  }
  let C = {};
  async function onbellekli(k, f) {
    if (!(k in C)) C[k] = f();
    return C[k];
  }
  const SH = 'https://www.statshub.com/api';

  // ---------- Bilyoner ----------
  async function bulten() {
    const v = await al('https://www.bilyoner.com/api/v3/mobile/aggregator/gamelist/all/v1?tabType=1&bulletinType=2');
    const ev = (v && v.events) || {};
    return Object.values(ev).map(e => {
      const uzun = String(e.en || e.n || '').split(' - ');
      return {
        bid: String(e.id), ev: e.htn || uzun[0], dep: e.atn || uzun[1], evU: uzun[0] || '', depU: uzun[1] || '',
        ts: Math.floor(Number(e.esdl) / 1000) || 0, lig: e.lgn || ''
      };
    }).filter(x => x.bid && x.ev && x.dep && x.ts > 0);
  }
  // Maç kartı cevabında başlama saatini arar (alan adı kesin bilinmediği için genel tarama)
  function baslamaZamani(v) {
    let bulunan = null;
    const gez = (x, d) => {
      if (!x || typeof x !== 'object' || bulunan || d > 3) return;
      Object.keys(x).forEach(k => {
        if (bulunan) return;
        const y = x[k];
        if (/date|time|start|esd|kickoff/i.test(k) && !/update|server|now|live|minute/i.test(k)) {
          let t = null;
          if (typeof y === 'number') t = y > 1e12 ? y / 1000 : y > 1e9 ? y : null;
          else if (typeof y === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(y)) { const z = Date.parse(y); if (!isNaN(z)) t = z / 1000; }
          else if (typeof y === 'string' && /^\d{10,13}$/.test(y)) { const z = Number(y); t = z > 1e12 ? z / 1000 : z; }
          if (t && Math.abs(t - Date.now() / 1000) < 10 * 86400) bulunan = t;
        }
        if (y && typeof y === 'object' && !Array.isArray(y)) gez(y, d + 1);
      });
    };
    gez(v, 0);
    return bulunan;
  }
  async function bilyonerOranlar(bid) {
    const v = await al('https://www.bilyoner.com/api/v3/mobile/aggregator/match-card/' + bid + '/odds?isLiveEvent=false&isPopular=false');
    const oranlar = [];
    const gez = x => {
      if (!x || typeof x !== 'object') return;
      if (Array.isArray(x)) { x.forEach(gez); return; }
      if (Array.isArray(x.oddList)) {
        x.oddList.forEach(o => {
          if (o && o.n !== undefined && o.val !== undefined) {
            const val = parseFloat(String(o.val).replace(',', '.'));
            if (val > 1) oranlar.push({ pazar: String(x.name || o.mrn || ''), n: String(o.n), val });
          }
        });
      }
      Object.keys(x).forEach(k => { if (k !== 'oddList' && x[k] && typeof x[k] === 'object') gez(x[k]); });
    };
    gez(v);
    return { ev: v && v.homeTeam, dep: v && v.awayTeam, oranlar, ts: v ? baslamaZamani(v) : null };
  }
  function gucDengesi(oranlar) {
    const bul = (nAd, pz) => {
      let x = oranlar.find(q => norm(q.n) === nAd && pz(norm(q.pazar)));
      if (!x) x = oranlar.find(q => norm(q.n) === nAd);
      return x ? x.val : null;
    };
    const msP = p => /mac sonucu/.test(p) && !/yari|handikap|periyot|kombo/.test(p);
    const o1 = bul('ms 1', msP), oX = bul('ms x', msP), o2 = bul('ms 2', msP);
    if (!(o1 && oX && o2)) return null;
    const t = 1 / o1 + 1 / oX + 1 / o2;
    const g = { o1, oX, o2, p1: 1 / o1 / t, pX: 1 / oX / t, p2: 1 / o2 / t };
    const ouP = p => /2,5 gol/.test(p) && !/yari|takim|ev sahibi|deplasman|kombo/.test(p);
    const ua = bul('2,5 alt', ouP), uu = bul('2,5 ust', ouP);
    if (ua && uu) { const t2 = 1 / ua + 1 / uu; g.pUst = 1 / uu / t2; }
    return g;
  }

  // ---------- Statshub ----------
  async function gunListesi(s) {
    return onbellekli('g|' + s, async () => {
      try { const v = await al(SH + '/event/by-date?startOfDay=' + s + '&endOfDay=' + (s + 86399)); return v.data || []; }
      catch (e) { return []; }
    });
  }
  // Sıkı maç eşleşmesi: iki takımın da adının en az yarısı tutmalı, saat biliniyorsa en fazla 3 saat fark
  async function statshubMac(evAdlar, depAdlar, ts) {
    const evL = evAdlar.filter(Boolean).map(a => tokenlar(cevir(a))).filter(t => t.length);
    const depL = depAdlar.filter(Boolean).map(a => tokenlar(cevir(a))).filter(t => t.length);
    if (!evL.length || !depL.length) return null;
    const oran = (L, T) => Math.max(0, ...L.map(a => benzerlik(a, T, true) / a.length));
    const gunBas = t => { const d = new Date(t * 1000); d.setHours(0, 0, 0, 0); return Math.floor(d.getTime() / 1000); };
    let gunler;
    if (ts) { const g = gunBas(ts); gunler = [g, g - 86400, g + 86400]; }
    else { const g = gunBas(Date.now() / 1000); gunler = [g, g + 86400, g + 2 * 86400, g - 86400]; }
    for (const s of gunler) {
      const liste = await gunListesi(s);
      let iyi = null, puan = 0;
      liste.forEach(x => {
        const e = x.events || {};
        if (!e.id) return;
        const ets = Number(e.timeStartTimestamp) || 0;
        if (ts && ets && Math.abs(ets - ts) > 3 * 3600) return;
        const hAd = (x.homeTeam && x.homeTeam.name) || '', aAd = (x.awayTeam && x.awayTeam.name) || '';
        let hT = tokenlar(hAd), aT = tokenlar(aAd);
        if (e.slug) {
          const p = e.slug.replace(/-[a-z0-9]+$/, '').split('-vs-');
          if (p.length === 2) { hT = hT.concat(p[0].split('-')); aT = aT.concat(p[1].split('-')); }
        }
        const p1 = oran(evL, hT), p2 = oran(depL, aT);
        if (p1 < 0.5 || p2 < 0.5) return;
        const skor = p1 + p2 - (ts && ets ? Math.abs(ets - ts) / 86400 : 0);
        if (skor > puan) {
          puan = skor;
          iyi = {
            id: e.id, homeTeamId: e.homeTeamId, awayTeamId: e.awayTeamId, ts: ets || ts || 0,
            evAd: hAd, depAd: aAd, durum: e.status, kadroResmi: e.lineupConfirmed === true,
            hakem: x.refereeName || '', hakemOrt: Number(x.refereeAvgCards) || 0, hakemMac: Number(x.refereeGames) || 0
          };
        }
      });
      if (iyi) return iyi;
    }
    return null;
  }
  async function takimSatirlar(tid, key, yari, limit) {
    return onbellekli('t|' + [tid, key, yari, limit].join('|'), async () => {
      const v = await al(SH + '/team/' + tid + '/event-statistics?eventType=all&statisticKey=' + key + '&eventHalf=' + yari + '&limit=' + limit);
      return (v.data || []).map(r => {
        const evde = String(r.home_team_id) === String(tid);
        return {
          id: String(r.event_id), evde, ts: Number(r.time_start_timestamp),
          kendi: parseFloat(evde ? r.home_value : r.away_value), rakip: parseFloat(evde ? r.away_value : r.home_value)
        };
      }).filter(r => !isNaN(r.kendi) && !isNaN(r.rakip)).sort((a, b) => b.ts - a.ts);
    });
  }
  async function ligOrtalamasi(mac, key, yari) {
    const st = LIG_STAT[key];
    if (!st) return null;
    const x = await onbellekli('lig|' + mac.id + '|' + st, async () => {
      try {
        const v = await al(SH + '/events/opponent-rankings?eventIds=' + mac.id + '&statType=' + st + '&teamId=' + mac.homeTeamId);
        const d = (v.data || [])[0];
        return d && Number(d.leagueAverage) > 0 ? Number(d.leagueAverage) : null;
      } catch (e) { return null; }
    });
    return x ? x * (yari === '1ST' ? 0.45 : yari === '2ND' ? 0.55 : 1) : null;
  }
  // Takımın oyuncuları ve son 10 maçtaki istatistikleri (eksik oyuncu hesabı için hep 10 maç çekilir)
  async function oyuncuListesi(tid) {
    return onbellekli('o|' + tid, async () => {
      const temel = SH + '/team/' + tid + '/players/performance?limit=10&location=both';
      let v = null;
      try { v = await al(temel); } catch (e) {}
      if (!v || !v.data || !v.data.length) { try { v = await al(temel + '&tournamentId=1,11,16,27,851,10783'); } catch (e) {} }
      return (v && v.data) || [];
    });
  }
  async function piyasa(macId, market) {
    return onbellekli('p|' + macId + '|' + market, async () => {
      try { const v = await al(SH + '/event/' + macId + '/odds-movements?market=' + market); return v.series || []; }
      catch (e) { return []; }
    });
  }
  async function mlOranlar(macId) {
    return onbellekli('ml|' + macId, async () => {
      try {
        const v = await al(SH + '/event/bulk-team-odds?eventIds=' + macId);
        const d = v.data && v.data[macId];
        return (d && d.teamOdds && d.teamOdds.ML) || [];
      } catch (e) { return []; }
    });
  }
  // Kadroyu (resmi ya da muhtemel 11) okur → { durum, o: { oyuncuId: { poz, yedek } } }
  function oyunculariTopla(v, hedef) {
    const idOf = o => o.playerId != null ? o.playerId : o.player && o.player.id != null ? o.player.id : o.id;
    const kapsayici = o => Object.keys(o).some(a => Array.isArray(o[a]) && o[a].some(y => y && typeof y === 'object'));
    const gez = (x, yol) => {
      if (!x || typeof x !== 'object') return;
      if (Array.isArray(x)) { x.forEach(y => gez(y, yol)); return; }
      const id = idOf(x);
      if (id != null && !kapsayici(x) && (x.position != null || x.name || x.player || x.jerseyNo != null || 'isSubstitute' in x || 'substitute' in x)) {
        const yolY = yol.join(' ').toLowerCase();
        const yedek = x.isSubstitute === true || x.substitute === true || /sub|bench|yedek|reserve/.test(yolY);
        hedef[String(id)] = { poz: x.position || (x.player && x.player.position) || '', yedek };
        return;
      }
      Object.keys(x).forEach(a => gez(x[a], yol.concat(a)));
    };
    gez(v, []);
  }
  async function kadroBilgisi(mac) {
    return onbellekli('ku|' + mac.id, async () => {
      const sonuc = { durum: 'yok', o: {} };
      let st = 'none';
      try { const v = await al(SH + '/event/lineup-status?ids=' + mac.id); st = String(((v && v.data) || {})[mac.id] || 'none'); } catch (e) {}
      if (st !== 'none' || mac.kadroResmi) {
        const o = {};
        for (const tid of [mac.homeTeamId, mac.awayTeamId]) {
          try { oyunculariTopla(await al(SH + '/event/' + mac.id + '/team-lineup?teamId=' + tid + '&heatmap=false'), o); } catch (e) {}
        }
        if (Object.values(o).filter(x => !x.yedek).length >= 20) { sonuc.o = o; sonuc.durum = /predict|probab|muhtemel/i.test(st) ? 'muhtemel' : 'resmi'; }
      }
      if (sonuc.durum === 'yok') {
        try {
          const o = {};
          oyunculariTopla(await al(SH + '/event/' + mac.id + '/predicted-teams-lineup'), o);
          if (Object.values(o).filter(x => !x.yedek).length >= 20) { sonuc.o = o; sonuc.durum = 'muhtemel'; }
        } catch (e) {}
      }
      return sonuc;
    });
  }

  // ---------- Seçim çözme ----------
  function oyuncuPazarTipi(baslik) {
    const b = norm(baslik);
    if (!/oyuncu/.test(b)) return null;
    if (/isabet|kaleyi bul|kaleye|kale icine|cerceve/.test(b)) return 'isabetli';
    if (/sut/.test(b)) return 'sut';
    if (/top cal|top kap|mudahale|tackle/.test(b)) return 'topcalma';
    if (/faul/.test(b)) return null;
    if (/kart/.test(b)) return 'kart';
    return null;
  }
  function oyuncuSecim(etiket) {
    const t = String(etiket || '').replace(/\s+/g, ' ').trim();
    const m = t.match(/^(.+?)\s*(\d+)\s*\+$/);
    if (m) return { ad: m[1].trim(), esik: parseInt(m[2], 10) };
    if (t && !/\d/.test(t) && t.length < 40 && !/^(evet|hayir|hayır|ust|üst|alt|var|yok)$/i.test(t)) return { ad: t, esik: 1 };
    return null;
  }
  function takimSecim(baslik, etiket, ev, dep) {
    const b = norm(baslik), e = norm(etiket), hep = b + ' ' + e;
    if (/oyuncu/.test(b)) return null;
    const pz = TPAZAR.find(p => hep.includes(p[0]));
    if (!pz) return null;
    if (YASAK.test(yariTemizle(b)) || YASAK.test(yariTemizle(e))) return null;
    let yari = 'ALL';
    if (/(^| )(iy|1y|ilk yari|1\.? ?yari)( |$)/.test(hep)) yari = '1ST';
    else if (/(^| )(2y|ikinci yari|2\.? ?yari)( |$)/.test(hep)) yari = '2ND';
    const m = e.match(/(\d+)[,.]5/) || b.match(/(\d+)[,.]5/);
    if (!m) return null;
    let yon, esik;
    if (/(^| )alt( |$)/.test(e)) { yon = 'alt'; esik = +m[1]; }
    else if (/(^| )ust( |$)/.test(e)) { yon = 'ust'; esik = +m[1] + 1; }
    else return null;
    const etTok = tokenlar(etiket).filter(t => ETIKET_BOS.indexOf(t) < 0 && !/^\d/.test(t));
    let pe = benzerlik(tokenlar(cevir(ev)), etTok), pd = benzerlik(tokenlar(cevir(dep)), etTok);
    const evE = /(^| )(ev|ev sahibi|evsahibi)( |$)/.test(e), depE = /(^| )(dep|deplasman|misafir)( |$)/.test(e);
    const evB = /ev sahibi|evsahibi/.test(b), depB = /deplasman/.test(b);
    let taraf;
    if (pe !== pd) taraf = pe > pd ? 'ev' : 'dep';
    else if (evE && !depE) taraf = 'ev';
    else if (depE && !evE) taraf = 'dep';
    else if (evB && !depB) taraf = 'ev';
    else if (depB && !evB) taraf = 'dep';
    else if (pe === 0 && etTok.length && !/toplam/.test(e)) return null;
    else {
      pe = benzerlik(tokenlar(cevir(ev)), tokenlar(baslik)); pd = benzerlik(tokenlar(cevir(dep)), tokenlar(baslik));
      taraf = pe > pd ? 'ev' : pd > pe ? 'dep' : 'toplam';
    }
    return { key: pz[1], ad: pz[2], birim: pz[3], yari, yon, esik, cizgi: +m[1] + 0.5, taraf };
  }

  // ---------- Puan (10 üzerinden) ----------
  // değer 3 · ihtimal 2 · piyasa 2 · kadro 1,5 · veri 1,5
  function puanHesapla(x) {
    const deger = 3 * sinirla(x.getiri / 0.35, 0, 1);
    const ihtimal = 2 * sinirla((x.p - 0.30) / 0.50, 0, 1);
    let piyasaP;
    if (x.ref) {
      const fark = x.bil / x.ref.en - 1;
      piyasaP = fark > 0 ? 1 + sinirla(fark / 0.20, 0, 1) : 0.5 * sinirla(1 + fark / 0.10, 0, 1);
    } else piyasaP = 0.6;
    const kadro = x.kadro === 'resmi' ? 1.5 : x.kadro === 'takim' ? 1.0 : x.kadro === 'muhtemel' ? 0.6 : 0;
    const uyum = x.tutOran == null ? 0.5 : 1 - Math.min(1, Math.abs(x.tutOran - x.p) / 0.30);
    const veri = 1.5 * (0.6 * sinirla((x.n - 4) / 6, 0, 1) + 0.4 * uyum);
    const toplam = Math.round((deger + ihtimal + piyasaP + kadro + veri) * 10) / 10;
    return { toplam, deger, ihtimal, piyasa: piyasaP, kadro, veri };
  }
  function supheliMi(p, getiri, ref, bil) {
    if (getiri >= ESIK.getiriSuphe) return true;
    if (ref && bil / ref.en - 1 > ESIK.farkSuphe) return true;
    if (ref && p - 1 / ref.en > ESIK.modelPiyasa) return true;
    return false;
  }
  function refHesapla(sirket) {
    const refs = Object.entries(sirket);
    if (!refs.length) return null;
    const en = refs.reduce((a, r) => r[1] > a[1] ? r : a), kotu = refs.reduce((a, r) => r[1] < a[1] ? r : a);
    return { en: en[1], enSirket: en[0], kotu: kotu[1], kotuSirket: kotu[0], say: refs.length };
  }
  function refYazi(ref, bil, kim) {
    if (!ref) return 'Diğer sitelerde ' + kim + ' için oran yok.';
    const fark = bil / ref.en - 1;
    const bas = ref.say > 1 ? 'Diğer siteler: en iyi ' + v2(ref.en) + ' (' + ref.enSirket + ') · en kötü ' + v2(ref.kotu) + ' (' + ref.kotuSirket + ')'
      : 'Tek site: ' + v2(ref.en) + ' (' + ref.enSirket + ')';
    return bas + ' · Bilyoner en iyi siteden %' + Math.abs(Math.round(fark * 100)) + (fark > 0 ? ' fazla.' : ' az.');
  }

  // ---------- Oyuncu modeli ----------
  const mins = st => +(st && st.minutesPlayed) || 0;
  // Oyuncunun süre aldığı maçlar (yeniden eskiye)
  function oynadiklari(o, tsHarita) {
    return Object.keys(o.stats || {}).map(eid => ({ eid, st: o.stats[eid], dk: mins(o.stats[eid]), ts: tsHarita[eid] || 0 }))
      .filter(r => r.dk > 0).sort((a, b) => b.ts - a.ts);
  }
  // 90 dakikaya düşen değer; yakın maçlar biraz daha ağır
  function hiz90(dizi, deg) {
    let v = 0, d = 0;
    dizi.forEach((r, i) => { const w = Math.pow(0.92, i); v += w * deg(r); d += w * r.dk; });
    return d > 0 ? v / d * 90 : 0;
  }
  const detayPoz = st => { const k = pozKod(st && st.position); return GENEL_POZ.includes(k) ? null : (POZ[k] ? k : null); };
  // Oyuncunun en sık oynadığı mevkinin hücum seviyesi
  function pozSeviye(o) {
    const say = {}, genel = {};
    Object.values(o.stats || {}).forEach(st => {
      if (!(mins(st) > 0)) return;
      const k = detayPoz(st);
      if (k) say[k] = (say[k] || 0) + 1;
      else { const g = pozKod(st.position); if (POZ[g]) genel[g] = (genel[g] || 0) + 1; }
    });
    const enSik = s => Object.keys(s).sort((a, b) => s[b] - s[a])[0];
    const k = enSik(say) || enSik(genel);
    return k ? POZ[k][0] : null;
  }

  // Bugün takımında olmayan düzenli oyuncuların bu oyuncuya etkisi
  function eksikEtkisi(o, tip, oran, ctx, tid) {
    const sonuc = { carpan: 1, notlar: [] };
    if (ctx.kb.durum === 'yok' || tip === 'kart') return sonuc;
    const takim = ctx.oyuncular[tid] || [];
    const maclar = (ctx.takimMac[tid] || []).slice(0, 10);
    if (maclar.length < 5) return sonuc;
    const deg = st => OTIP[tip].deger(st);
    const pSev = pozSeviye(o);
    const sahada = takim.filter(x => { const k = ctx.kb.o[String(x.id)]; return k && !k.yedek; });
    const muhtemel = ctx.kb.durum === 'muhtemel' ? ' (muhtemel 11\'e göre)' : '';
    takim.forEach(X => {
      if (String(X.id) === String(o.id)) return;
      const kx = ctx.kb.o[String(X.id)];
      if (kx && !kx.yedek) return;                                   // bugün oynuyor
      const st = id => X.stats && X.stats[id];
      const basladi = maclar.filter(id => mins(st(id)) >= 60).length;
      if (basladi < Math.max(4, Math.ceil(maclar.length * 0.5))) return;   // düzenli ilk 11 değil
      if (!maclar.slice(0, 3).some(id => mins(st(id)) > 0)) return;       // uzun süredir yok, zaten hesapta
      const xMac = maclar.filter(id => mins(st(id)) > 0).map((id, i) => ({ dk: mins(st(id)), st: st(id), i }));
      const xOran = hiz90(xMac, r => deg(r.st));
      if (!(xOran > 0) || (xOran < 0.5 * oran && xOran < 0.6)) return;     // bu pazarda önemli değil
      const xSev = pozSeviye(X);
      if (pSev != null && xSev != null && Math.abs(pSev - xSev) > 2.5) return; // farklı bölge
      // O yokken bu oyuncunun oynadığı maçlar
      const onsuz = (ctx.takimMac[tid] || []).filter(id => !(mins(st(id)) > 0) && mins(o.stats && o.stats[id]) > 0);
      let f, not;
      if (onsuz.length >= 2) {
        const r0 = hiz90(onsuz.map(id => ({ dk: mins(o.stats[id]), st: o.stats[id] })), r => deg(r.st));
        const w = onsuz.length / (onsuz.length + 3);
        f = sinirla(1 + w * (oran > 0 ? r0 / oran - 1 : 0), 0.85, 1.4);
        not = X.name + ' yok' + muhtemel + ': o yokken oynadığı ' + onsuz.length + ' maçta 90 dk\'da ' + v1(r0) + ' ' + OTIP[tip].birim + ' (normalde ' + v1(oran) + ').';
      } else {
        // Onsuz maç yok: payını aynı bölgedeki ilk 11 oyuncularına üretimleri oranında dağıt (yarısı yerine girene gider)
        const bolge = sahada.filter(Y => { const s = pozSeviye(Y); return s != null && (xSev == null || Math.abs(s - xSev) <= 2.5); });
        if (!bolge.some(Y => String(Y.id) === String(o.id))) bolge.push(o);
        const toplam = bolge.reduce((a, Y) => {
          const m = maclar.filter(id => mins(Y.stats && Y.stats[id]) > 0).map(id => ({ dk: mins(Y.stats[id]), st: Y.stats[id] }));
          return a + hiz90(m, r => deg(r.st));
        }, 0);
        if (!(toplam > 0)) return;
        f = sinirla(1 + 0.5 * xOran / toplam, 1, 1.3);
        if (f < 1.03) return;
        not = X.name + ' yok' + muhtemel + ' (90 dk\'da ' + v1(xOran) + ' ' + OTIP[tip].birim + '). Onsuz maç olmadığı için payı bölgedeki oyunculara dağıtıldı, tahmini.';
      }
      if (Math.abs(f - 1) < 0.03) return;
      sonuc.carpan *= f;
      sonuc.notlar.push(not);
    });
    sonuc.carpan = sinirla(sonuc.carpan, 0.8, 1.5);
    return sonuc;
  }

  // Rakip ve maçın gücü
  function macBaglami(tip, taraf, ctx) {
    let f = 1;
    const notlar = [];
    const key = OTIP[tip].takimKey;
    const ad = taraf === 'ev' ? ctx.adEv : ctx.adDep, rakipAd = taraf === 'ev' ? ctx.adDep : ctx.adEv;
    if (key && ctx.satir[key]) {
      const B = ctx.satir[key][taraf === 'ev' ? 'dep' : 'ev'] || [];
      const A = ctx.satir[key][taraf] || [];
      if (B.length >= 5 && A.length >= 5) {
        const izin = aort(B.slice(0, 10), r => r.rakip), kendi = aort(A.slice(0, 10), r => r.kendi);
        const lig = ctx.lig[key];
        const oranR = lig ? izin / lig : (kendi + izin) / 2 / kendi;
        if (oranR > 0 && isFinite(oranR)) {
          const fr = sinirla(1 + 0.6 * (oranR - 1), 0.75, 1.3);
          f *= fr;
          if (Math.abs(fr - 1) >= 0.05) notlar.push(rakipAd + ' rakiplerine maç başı ' + v1(izin) + ' ' + (key === 'shotsOnGoal' ? 'isabetli şut' : 'şut') + ' attırıyor' +
            (lig ? ' (lig ort. ' + v1(lig) + ')' : '') + ' → ' + (fr > 1 ? 'lehine' : 'aleyhine') + '.');
        }
      }
    }
    if (ctx.g) {
      const pK = taraf === 'ev' ? ctx.g.p1 : ctx.g.p2, pR = taraf === 'ev' ? ctx.g.p2 : ctx.g.p1;
      const katsayi = tip === 'sut' || tip === 'isabetli' ? 0.15 : tip === 'topcalma' ? -0.25 : -0.15;
      const fg = 1 + katsayi * (pK - pR);
      f *= fg;
      if (Math.abs(pK - pR) > 0.2) notlar.push((pK > pR ? ad + ' favori' : ad + ' maçın zayıf tarafı') + ' (' + yuzde(pK) + ' kazanma)' +
        (tip === 'topcalma' ? (pK > pR ? ', daha az savunma yapar.' : ', daha çok savunma yapar.') : tip === 'kart' ? '.' : (pK > pR ? ', daha çok atak beklenir.' : ', daha az atak beklenir.')));
    }
    return { carpan: sinirla(f, 0.7, 1.4), notlar };
  }

  function oyuncuSinyali(sec, ctx) {
    const tip = OTIP[sec.tip];
    const bul = enIyiAday(sec.ad, ctx.kadro, x => x.o.name || '', x => x.o.id);
    if (!bul) return { yok: true, ad: sec.ad };
    const o = bul.o, tid = bul.tid, taraf = String(tid) === String(ctx.mac.homeTeamId) ? 'ev' : 'dep';
    const kb = ctx.kb;
    const deg = r => tip.deger(r.st);
    const tumu = oynadiklari(o, ctx.tsHarita);
    const oyn = tumu.slice(0, lim0());
    if (oyn.length < ESIK.minMac) return null;

    // Kadro: ilk 11'de değilse bahis iade olur → sinyal yok
    const kd = kb.o[String(o.id)];
    if (kb.durum !== 'yok' && (!kd || kd.yedek)) return null;
    const gerekce = [];
    gerekce.push(kb.durum === 'resmi' ? '✅ Resmi 11\'de.' : kb.durum === 'muhtemel' ? '⏳ Muhtemel 11\'de, resmi kadro bekleniyor.' : '⏳ Kadro henüz yok.');

    // Mevki: bugünkü mevkisi normalinden farklıysa o mevkideki maçları ağırlıklı kullan
    let ornek = oyn, pozEtki = 0;
    const sayac = {};
    oyn.forEach(r => { const k = detayPoz(r.st); if (k) sayac[k] = (sayac[k] || 0) + 1; });
    const normalKod = Object.keys(sayac).sort((a, b) => sayac[b] - sayac[a])[0];
    const bugunKod = kd ? pozKod(kd.poz) : null;
    if (normalKod && bugunKod && POZ[bugunKod] && !GENEL_POZ.includes(bugunKod) && Math.abs(POZ[bugunKod][0] - POZ[normalKod][0]) >= 2) {
      const ileri = POZ[bugunKod][0] > POZ[normalKod][0];
      pozEtki = tip.yon === 0 ? 0 : (ileri ? tip.yon : -tip.yon);
      let not = 'Mevki: normalde ' + POZ[normalKod][1] + ', bugün ' + POZ[bugunKod][1] + (kb.durum === 'muhtemel' ? ' (muhtemel 11)' : '') + '.';
      const benzer = oyn.filter(r => { const k = detayPoz(r.st); return k && Math.abs(POZ[k][0] - POZ[bugunKod][0]) <= 1; });
      if (benzer.length >= 3) { ornek = benzer; not += ' Bu mevkide oynadığı ' + benzer.length + ' maç ağırlıklı kullanıldı.'; }
      else if (pozEtki < 0) return null;   // aleyhine değişiklik ve örnek yok → riskli
      else if (pozEtki > 0) not += ' ' + tip.birim.charAt(0).toUpperCase() + tip.birim.slice(1) + ' için lehine.';
      gerekce.push(not);
    } else if (normalKod && POZ[normalKod]) {
      gerekce.push('Mevki: ' + POZ[normalKod][1] + (bugunKod && POZ[bugunKod] && !GENEL_POZ.includes(bugunKod) ? ' (bugün de aynı bölgede)' : '') + '.');
    }

    const topDk = ornek.reduce((a, r) => a + r.dk, 0);
    if (topDk < 180) return null;
    let oran90 = ornek === oyn ? hiz90(oyn, deg) : (ornek.length * hiz90(ornek, deg) + 5 * hiz90(oyn, deg)) / (ornek.length + 5);
    const temel90 = oran90;

    // Ev / deplasman
    const evdeMi = r => ctx.evdeHarita[tid] && ctx.evdeHarita[tid][r.eid];
    const yer = oyn.filter(r => { const e = evdeMi(r); return e !== undefined && e === (taraf === 'ev'); });
    if (yer.length >= 3) {
      const ry = hiz90(yer, deg), w = yer.length / (yer.length + 10);
      const yeni = (1 - w) * oran90 + w * ry;
      if (oran90 > 0 && Math.abs(yeni / oran90 - 1) >= 0.08)
        gerekce.push((taraf === 'ev' ? 'Evinde' : 'Deplasmanda') + ' 90 dk\'da ' + v1(ry) + ' ' + tip.birim + ' (' + yer.length + ' maç), genel ' + v1(oran90) + '.');
      oran90 = yeni;
    }

    // Eksik takım arkadaşları
    const eks = eksikEtkisi(o, sec.tip, oran90, ctx, tid);
    oran90 *= eks.carpan;
    eks.notlar.forEach(n => gerekce.push('🚑 ' + n));

    // Rakip / maç gücü
    const bag = macBaglami(sec.tip, taraf, ctx);
    oran90 *= bag.carpan;
    bag.notlar.forEach(n => gerekce.push(n));

    // Tüm düzeltmelerin toplamı abartmasın: temel hızın %70'i ile %140'ı arası
    if (temel90 > 0) oran90 = sinirla(oran90, 0.7 * temel90, 1.4 * temel90);

    // Beklenen dakika
    const baslar = oyn.filter(r => r.dk >= 60);
    const dk = kd && !kd.yedek ? (baslar.length ? Math.min(90, mean(baslar.slice(0, 5).map(r => r.dk))) : 80) : Math.min(90, mean(oyn.slice(0, 3).map(r => r.dk)));
    let l = oran90 * dk / 90;
    if (sec.tip === 'kart' && ctx.mac.hakemOrt > 0 && ctx.mac.hakemMac >= 10 && ctx.ligKart > 0) {
      const oranH = sinirla(ctx.mac.hakemOrt / ctx.ligKart, 0.7, 1.4);
      l *= 1 + 0.5 * (oranH - 1);
      gerekce.push('Hakem ' + ctx.mac.hakem + ' maç başı ' + v1(ctx.mac.hakemOrt) + ' kart gösteriyor (lig ort. ' + v1(ctx.ligKart) + ').');
    }
    const pModel = olasilik(l, sec.esik, 'ust', dagilimOrani(ornek.map(deg)));
    const vals = oyn.map(deg), tut = vals.filter(v => v >= sec.esik).length;
    if (sec.tip === 'kart') gerekce.push('Son ' + vals.length + ' maçta ' + tut + ' kez kart gördü.');
    else gerekce.push('Son ' + vals.length + ' maç: ' + vals.slice(0, 5).join('-') + (vals.length > 5 ? '…' : '') + ' · ' + tut + ' kez ' + sec.esik + '+ · 90 dk\'da ' + v1(temel90) +
      (Math.abs(oran90 / (temel90 || 1) - 1) >= 0.05 ? ', bugün için ' + v1(oran90) : '') + ' · beklenen ' + Math.round(dk) + ' dk.');

    // Diğer siteler: sadece aynı oyuncu kimliği
    const sirket = {};
    ctx.seri(sec.tip).filter(x => String(x.selection).toUpperCase() === 'OVER' && Math.abs(Number(x.line) - (sec.esik - 0.5)) < 0.01 && Number(x.currentOdds) > 1 && String(x.playerId) === String(o.id))
      .forEach(x => { sirket[x.bookmaker || ('Site #' + x.bookmakerId)] = Number(x.currentOdds); });
    const ref = refHesapla(sirket);

    // Diğer siteler varsa: hesabım %60 + piyasanın ihtimali %40 (tek başına modele güvenmemek için)
    const bil = sec.bil;
    let p = pModel, pPiyasa = null;
    if (ref) {
      const ihts = Object.values(sirket).map(o => 1 / o);
      pPiyasa = sinirla(mean(ihts) * 0.94, 0.01, 0.99);
      if (pModel - pPiyasa > ESIK.modelPiyasa) return null;   // hesabım piyasadan çok uzak → şüpheli
      p = 0.6 * pModel + 0.4 * pPiyasa;
    }
    const getiri = p * bil - 1;
    if (getiri < ESIK.minGetiri || p < ESIK.minIhtimal) return null;
    if (supheliMi(p, getiri, ref, bil)) return null;
    const puan = puanHesapla({ p, getiri, ref, bil, kadro: kb.durum, n: oyn.length, tutOran: tut / vals.length });
    if (puan.toplam < ESIK.puan) return null;

    gerekce.push(pPiyasa != null
      ? 'Hesabım ' + yuzde(pModel) + ', piyasa ' + yuzde(pPiyasa) + ' → birleşik ' + yuzde(p) + ' (adil oran ' + v2(1 / p) + ') · Bilyoner ' + v2(bil) + ' → beklenen getiri ' + isaretli(getiri) + '.'
      : 'Hesabım ' + yuzde(p) + ' (adil oran ' + v2(1 / p) + ') · Bilyoner ' + v2(bil) + ' → beklenen getiri ' + isaretli(getiri) + '.');
    gerekce.push(refYazi(ref, bil, 'bu oyuncu'));
    const isimFarkli = norm(o.name) !== norm(sec.ad);
    return {
      tur: 'oyuncu', tip: sec.tip, k: 'o|' + sec.tip + '|' + norm(sec.ad) + '|' + sec.esik,
      secim: sec.tip === 'kart' ? sec.ad + ' kart görür' : sec.ad + ' ' + sec.esik + '+ ' + tip.birim,
      altBaslik: (isimFarkli ? 'Statshub: ' + o.name + ' · ' : '') + (taraf === 'ev' ? ctx.adEv : ctx.adDep),
      pazarAd: tip.ad, bil, p, getiri, ref, puan, gerekce, esik: sec.esik, kesin: kb.durum === 'resmi',
      oyuncu: o.name, oyuncuId: o.id, takimId: tid, kadroDurum: kb.durum
    };
  }

  // ---------- Takım istatistik sinyali ----------
  function takimModeli(A, B, taraf, lig) {
    const n = Math.min(A.length, B.length), w = n / (n + 4);
    const aK = aort(A, r => r.kendi), aR = aort(A, r => r.rakip), bK = aort(B, r => r.kendi), bR = aort(B, r => r.rakip);
    const havuzIc = (aK + aR + bK + bR) / 4;
    const havuz = lig ? 0.5 * havuzIc + 0.5 * lig : havuzIc;
    const cek = x => w * x + (1 - w) * havuz;
    const lA = (cek(aK) + cek(bR)) / 2, lB = (cek(bK) + cek(aR)) / 2;
    let d;
    if (taraf === 'ev') d = (dagilimOrani(A.map(r => r.kendi)) + dagilimOrani(B.map(r => r.rakip))) / 2;
    else if (taraf === 'dep') d = (dagilimOrani(B.map(r => r.kendi)) + dagilimOrani(A.map(r => r.rakip))) / 2;
    else d = (dagilimOrani(A.map(r => r.kendi + r.rakip)) + dagilimOrani(B.map(r => r.kendi + r.rakip))) / 2;
    return { lA, lB, d, n };
  }
  async function takimSinyalleri(secimler, mac, g, adEv, adDep) {
    const sonuc = [];
    const gruplar = {};
    secimler.forEach(s => { const k = s.key + '|' + s.yari; (gruplar[k] = gruplar[k] || []).push(s); });
    for (const gk of Object.keys(gruplar)) {
      const [key, yari] = gk.split('|');
      let A, B;
      try {
        [A, B] = await Promise.all([takimSatirlar(mac.homeTeamId, key, yari, 15), takimSatirlar(mac.awayTeamId, key, yari, 15)]);
      } catch (e) { continue; }
      A = A.slice(0, lim0()); B = B.slice(0, lim0());
      if (A.length < 6 || B.length < 6) continue;
      const lig = await ligOrtalamasi(mac, key, yari);
      const Ak = kirp(A), Bk = kirp(B);
      const enIyi = {};
      for (const s of gruplar[gk]) {
        const Mo = takimModeli(Ak, Bk, s.taraf, lig);
        let lA = Mo.lA, lB = Mo.lB;
        let gucNot = '';
        if (g && PAZAR_GUC[key] !== undefined && lA + lB > 0) {
          const top = lA + lB, payPiyasa = sinirla(0.5 + PAZAR_GUC[key] * (g.p1 - g.p2), 0.15, 0.85);
          const pay = 0.5 * (lA / top) + 0.5 * payPiyasa;
          const yeniTop = ACIKLIK[key] && g.pUst !== undefined ? top * (1 + 0.3 * ACIKLIK[key] * (g.pUst - 0.5)) : top;
          lA = yeniTop * pay; lB = yeniTop * (1 - pay);
          if (Math.abs(g.p1 - g.p2) > 0.15) gucNot = (g.p1 >= g.p2 ? adEv : adDep) + ' favori (' + yuzde(Math.max(g.p1, g.p2)) + '), hesaba katıldı.';
        }
        let l = s.taraf === 'ev' ? lA : s.taraf === 'dep' ? lB : lA + lB;
        let hakemNot = '';
        if (key === 'cards' && mac.hakemOrt > 0 && mac.hakemMac >= 5 && lA + lB > 0 && yari === 'ALL') {
          l *= (0.5 * (lA + lB) + 0.5 * mac.hakemOrt) / (lA + lB);
          hakemNot = 'Hakem ' + mac.hakem + ' maç başı ' + v1(mac.hakemOrt) + ' kart gösteriyor (' + mac.hakemMac + ' maç).';
        }
        const p = olasilik(l, s.esik, s.yon, Mo.d);
        const getiri = p * s.bil - 1;
        const tutF = v => s.yon === 'ust' ? v >= s.esik : v <= s.esik;
        let tA, tB;
        if (s.taraf === 'ev') { tA = A.filter(r => tutF(r.kendi)).length; tB = B.filter(r => tutF(r.rakip)).length; }
        else if (s.taraf === 'dep') { tA = A.filter(r => tutF(r.rakip)).length; tB = B.filter(r => tutF(r.kendi)).length; }
        else { tA = A.filter(r => tutF(r.kendi + r.rakip)).length; tB = B.filter(r => tutF(r.kendi + r.rakip)).length; }
        const rA = tA / A.length, rB = tB / B.length;
        if (getiri < ESIK.minGetiri || p < 0.40 || rA < 0.5 || rB < 0.5) continue;
        if (supheliMi(p, getiri, null, s.bil)) continue;
        const puan = puanHesapla({ p, getiri, ref: null, bil: s.bil, kadro: 'takim', n: Mo.n, tutOran: (rA + rB) / 2 });
        if (puan.toplam < ESIK.puan) continue;
        const yariYazi = yari === '1ST' ? 'İlk yarı ' : yari === '2ND' ? 'İkinci yarı ' : '';
        const kim = s.taraf === 'ev' ? adEv : s.taraf === 'dep' ? adDep : 'Toplam';
        const yonYazi = s.yon === 'ust' ? 'Üst' : 'Alt';
        const gerekce = [];
        const ort = (dizi, f) => v1(mean(dizi.map(f)));
        if (s.taraf === 'toplam') {
          gerekce.push(adEv + ' son ' + A.length + ' maçta maç başı ' + ort(A, r => r.kendi) + ' ' + s.birim + ' yapıyor, ' + ort(A, r => r.rakip) + ' görüyor; ' +
            adDep + ' ' + ort(B, r => r.kendi) + ' yapıyor, ' + ort(B, r => r.rakip) + ' görüyor.');
        } else {
          const [X, Xs, Y, Ys] = s.taraf === 'ev' ? [adEv, A, adDep, B] : [adDep, B, adEv, A];
          gerekce.push(X + ' son ' + Xs.length + ' maçta maç başı ' + ort(Xs, r => r.kendi) + ' ' + s.birim + ' yapıyor; ' + Y + ' rakiplerine maç başı ' + ort(Ys, r => r.rakip) + ' yaptırıyor.');
        }
        gerekce.push('Son maçlarda ' + v1(s.cizgi) + ' ' + yonYazi + ' tuttu: ' + adEv + ' ' + tA + '/' + A.length + ', ' + adDep + ' ' + tB + '/' + B.length + '.');
        if (gucNot) gerekce.push(gucNot);
        if (hakemNot) gerekce.push(hakemNot);
        gerekce.push('Hesabım ' + yuzde(p) + ' (adil oran ' + v2(1 / p) + ') · Bilyoner ' + v2(s.bil) + ' → beklenen getiri ' + isaretli(getiri) + '.');
        gerekce.push('Diğer siteler bu pazara oran vermiyor, sadece kendi hesabım.');
        const sinyal = {
          tur: 'takim', k: 't|' + key + '|' + yari + '|' + s.taraf + '|' + s.yon + '|' + s.cizgi,
          secim: yariYazi + kim + ' ' + s.ad + ' ' + v1(s.cizgi) + ' ' + yonYazi, altBaslik: 'Takım pazarı', pazarAd: s.ad,
          bil: s.bil, p, getiri, ref: null, puan, gerekce, kesin: true, takimPazari: true,
          key, yari, taraf: s.taraf, yon: s.yon, esik: s.esik, cizgi: s.cizgi
        };
        // Aynı pazarda (taraf + yön) sadece puanı en yüksek çizgi kalsın
        const gr = key + '|' + yari + '|' + s.taraf + '|' + s.yon;
        if (!enIyi[gr] || sinyal.puan.toplam > enIyi[gr].puan.toplam) enIyi[gr] = sinyal;
      }
      Object.values(enIyi).forEach(x => sonuc.push(x));
    }
    return sonuc;
  }

  // ---------- Ana pazar fiyat notu (puanlamaya girmez) ----------
  function anaFiyatNotu(g, ml, adEv, adDep) {
    if (!g || !ml.length) return null;
    const satirlar = ml.map(x => ({ s: x.bookmaker || ('Site #' + x.bookmakerId), o: { '1': +x.home, 'X': +x.draw, '2': +x.away } }))
      .filter(x => x.o['1'] > 1 && x.o.X > 1 && x.o['2'] > 1);
    if (!satirlar.length) return null;
    const adil = { '1': 0, 'X': 0, '2': 0 };
    satirlar.forEach(x => { const t = 1 / x.o['1'] + 1 / x.o.X + 1 / x.o['2']; ['1', 'X', '2'].forEach(k => { adil[k] += 1 / x.o[k] / t / satirlar.length; }); });
    const adaylar = [];
    [['1', g.o1, 'MS 1 (' + adEv + ')'], ['X', g.oX, 'MS X (beraberlik)'], ['2', g.o2, 'MS 2 (' + adDep + ')']].forEach(([k, bil, ad]) => {
      const sirket = {};
      satirlar.forEach(x => { sirket[x.s] = x.o[k]; });
      const ref = refHesapla(sirket);
      const p = adil[k], getiri = p * bil - 1;
      if (!(bil > ref.en) || getiri < 0.03) return;
      adaylar.push({ tur: 'ana', k: 'a|' + k, secim: ad, pazarAd: 'Maç Sonucu', bil, p, getiri, ref, sonucKod: k, kesin: true,
        gerekce: [refYazi(ref, bil, 'bu seçim'), 'Sitelerin ortak ihtimali ' + yuzde(p) + ' · Bilyoner ' + v2(bil) + ' → beklenen getiri ' + isaretli(getiri) + '. İstatistik tahmini değil, sadece fiyat farkı.'] });
    });
    return adaylar.sort((a, b) => b.getiri - a.getiri)[0] || null;
  }

  // ---------- Maç analizi ----------
  async function macAnaliz(bm) {
    const bo = await bilyonerOranlar(bm.bid);
    const ev = bm.ev || bo.ev, dep = bm.dep || bo.dep;
    if (!ev || !dep) return { durum: 'isim' };
    const ts0 = bm.ts || bo.ts || 0;
    const mac = await statshubMac([ev, bm.evU], [dep, bm.depU], ts0);
    if (!mac) return { durum: 'eslesmedi', macAd: ev + ' - ' + dep };
    const adEv = ev, adDep = dep;
    const g = gucDengesi(bo.oranlar);
    const sinyaller = [];
    let kb = { durum: 'yok', o: {} };
    const eslesmeyenOyuncu = [];

    // Oyuncu pazarları
    const oSecim = [], gor = {};
    bo.oranlar.forEach(o => {
      const tip = oyuncuPazarTipi(o.pazar);
      if (!tip) return;
      const s = oyuncuSecim(o.n);
      if (!s) return;
      const k = tip + '|' + norm(s.ad) + '|' + s.esik;
      if (gor[k]) return;
      gor[k] = 1;
      oSecim.push({ tip, ad: s.ad, esik: s.esik, bil: o.val });
    });
    if (oSecim.length) {
      const tipler = [...new Set(oSecim.map(s => s.tip))];
      const keyler = [...new Set(['totalShotsOnGoal'].concat(tipler.map(t => OTIP[t].takimKey).filter(Boolean)))];
      const [evK, depK, kb0] = await Promise.all([oyuncuListesi(mac.homeTeamId), oyuncuListesi(mac.awayTeamId), kadroBilgisi(mac)]);
      kb = kb0;
      const satir = {};
      for (const key of keyler) {
        const [A, B] = await Promise.all([
          takimSatirlar(mac.homeTeamId, key, 'ALL', 15).catch(() => []),
          takimSatirlar(mac.awayTeamId, key, 'ALL', 15).catch(() => [])
        ]);
        satir[key] = { ev: A, dep: B };
      }
      const tsHarita = {}, evdeHarita = { [mac.homeTeamId]: {}, [mac.awayTeamId]: {} }, takimMac = {};
      [['ev', mac.homeTeamId], ['dep', mac.awayTeamId]].forEach(([t, tid]) => {
        const rows = satir.totalShotsOnGoal[t];
        rows.forEach(r => { tsHarita[r.id] = r.ts; evdeHarita[tid][r.id] = r.evde; });
        takimMac[tid] = rows.map(r => r.id);
      });
      const lig = {};
      for (const key of keyler) lig[key] = await ligOrtalamasi(mac, key, 'ALL');
      const seriler = {};
      for (const tip of tipler) seriler[tip] = await piyasa(mac.id, OTIP[tip].market);
      let ligKart = null;
      if (tipler.includes('kart')) { const x = await ligOrtalamasi(mac, 'cards', 'ALL'); ligKart = x ? 2 * x : null; }
      const ctx = {
        mac, kb, tsHarita, evdeHarita, takimMac, satir, lig, g, ligKart, adEv, adDep,
        oyuncular: { [mac.homeTeamId]: evK, [mac.awayTeamId]: depK },
        kadro: evK.map(o => ({ o, tid: mac.homeTeamId })).concat(depK.map(o => ({ o, tid: mac.awayTeamId }))),
        seri: tip => seriler[tip] || []
      };
      // Aynı oyuncunun aynı pazarında sadece puanı en yüksek eşik kalsın
      const enIyi = {};
      oSecim.forEach(s => {
        try {
          const x = oyuncuSinyali(s, ctx);
          if (!x) return;
          if (x.yok) { if (eslesmeyenOyuncu.indexOf(s.ad) < 0) eslesmeyenOyuncu.push(s.ad); return; }
          const gk = s.tip + '|' + x.oyuncuId;
          if (!enIyi[gk] || x.puan.toplam > enIyi[gk].puan.toplam) enIyi[gk] = x;
        } catch (e) {}
      });
      Object.values(enIyi).forEach(x => sinyaller.push(x));
    }

    // Takım istatistik pazarları
    const tSecim = [], gorT = {};
    bo.oranlar.forEach(o => {
      const s = takimSecim(o.pazar, o.n, ev, dep);
      if (!s) return;
      const k = [s.key, s.yari, s.taraf, s.yon, s.cizgi].join('|');
      if (gorT[k]) return;
      gorT[k] = 1;
      s.bil = o.val;
      tSecim.push(s);
    });
    if (tSecim.length) { try { (await takimSinyalleri(tSecim, mac, g, adEv, adDep)).forEach(x => sinyaller.push(x)); } catch (e) {} }

    let fiyat = null;
    try { fiyat = anaFiyatNotu(g, await mlOranlar(mac.id), adEv, adDep); } catch (e) {}

    // Sıralama: puan. Aynı oyuncu bir kez görünsün (en yüksek puanlı pazarıyla).
    sinyaller.sort((a, b) => b.puan.toplam - a.puan.toplam || b.getiri - a.getiri);
    const oyuncuGor = {}, secilen = [];
    sinyaller.forEach(x => {
      if (x.tur === 'oyuncu') { if (oyuncuGor[x.oyuncuId]) return; oyuncuGor[x.oyuncuId] = 1; }
      if (secilen.length < 1 + DIGER_MAX) secilen.push(x);
    });
    const ts = mac.ts || ts0;
    const ortak = { macId: mac.id, bid: bm.bid, macAd: adEv + ' - ' + adDep, ts, lig: bm.lig || '', evId: mac.homeTeamId, depId: mac.awayTeamId, ayarYazi: 'son ' + lim0() + ' maç' };
    secilen.forEach((x, i) => Object.assign(x, ortak, { id: mac.id + '|' + x.k, ana: i === 0 }));
    if (fiyat) Object.assign(fiyat, ortak, { id: mac.id + '|' + fiyat.k });
    return {
      durum: 'tamam', bm: { bid: bm.bid, ev: bm.ev || ev, dep: bm.dep || dep, evU: bm.evU || '', depU: bm.depU || '', ts, lig: bm.lig || '' },
      macAd: adEv + ' - ' + adDep, shAd: mac.evAd && mac.depAd ? mac.evAd + ' - ' + mac.depAd : '', ts, lig: bm.lig || '',
      kadro: kb.durum, sinyaller: secilen, fiyat, eslesmeyenOyuncu, oyuncuSecimSay: oSecim.length
    };
  }

  // ---------- Tarama ----------
  let taraniyor = false, durdur = false;
  const sonAl = () => GM_getValue('sb_son2', null);
  const sonYaz = x => GM_setValue('sb_son2', x);
  const macSayfasiId = () => /\/mac-karti\/futbol\//.test(location.pathname) ? ((location.pathname.match(/mac-karti\/[^/]+\/(\d+)/) || [])[1] || null) : null;
  const pencereYazi = () => Number(ayar.pencere) >= 24 ? 'bütün gün' : ayar.pencere + ' saat';

  async function maclariIsle(liste, onceki) {
    const sonuclar = [], eslesmeyen = [];
    let hata = 0;
    for (let i = 0; i < liste.length; i++) {
      if (durdur) break;
      const m = liste[i];
      ilerleme((i + 1) + '/' + liste.length + ' · ' + h(m.ev ? m.ev + ' - ' + m.dep : 'maç okunuyor') + '<br>Şimdiye kadar ' + sonuclar.filter(r => r.sinyaller.length).length + ' maçta sinyal');
      try {
        const r = await macAnaliz(m);
        if (r.durum === 'tamam') sonuclar.push(r);
        else if (r.durum === 'eslesmedi') eslesmeyen.push(r.macAd);
      } catch (e) { hata++; }
    }
    return { sonuclar, eslesmeyen, hata, mac: liste.length };
  }

  async function tara(sadeceBu) {
    if (taraniyor) return;
    taraniyor = true; durdur = false; C = {};
    try {
      let liste;
      if (sadeceBu) {
        liste = [{ bid: sadeceBu, ev: '', dep: '', evU: '', depU: '', ts: 0, lig: '' }];
      } else {
        ilerleme('Bilyoner bülteni okunuyor…');
        let b;
        try { b = await bulten(); } catch (e) { throw new Error('Bilyoner maç listesi okunamadı (' + e.message + '). Bir maçın sayfasını açıp "Sadece bu maçı tara" ile deneyebilirsin.'); }
        const simdi = Date.now() / 1000, son = simdi + Number(ayar.pencere) * 3600;
        liste = b.filter(x => x.ts > simdi + 60 && x.ts <= son).sort((a, b) => a.ts - b.ts);
        if (!liste.length) throw new Error('Önümüzdeki ' + pencereYazi() + ' içinde başlayacak maç bulunamadı.');
      }
      const r = await maclariIsle(liste);
      sonYaz({ zaman: Date.now(), mac: r.mac, hata: r.hata, maclar: r.sonuclar, eslesmeyen: r.eslesmeyen, durduruldu: durdur, sadeceBu: !!sadeceBu });
      sinyalSekmesi();
    } catch (e) {
      panelIcerik(sekmeHtml('sinyal') + '<div class="sb-hata">❌ ' + h(e.message) + '</div>' + ayarHtml());
    } finally {
      taraniyor = false;
    }
  }

  // Kadro bekleyen (ön sinyalli ya da kadrosu henüz resmi olmayan) maçları yeniden tarar
  const yenilenecek = son => (son && son.maclar || []).filter(m => m.ts > Date.now() / 1000 && m.kadro !== 'resmi' && (m.oyuncuSecimSay || 0) > 0);
  async function kadroYenile() {
    if (taraniyor) return;
    const son = sonAl(), liste = yenilenecek(son);
    if (!liste.length) { sinyalSekmesi(); return; }
    taraniyor = true; durdur = false; C = {};
    try {
      const r = await maclariIsle(liste.map(m => m.bm));
      const yeni = {};
      r.sonuclar.forEach(m => { yeni[m.bm.bid] = m; });
      son.maclar = son.maclar.map(m => yeni[m.bm.bid] || m);
      son.yenileme = Date.now();
      sonYaz(son);
      sinyalSekmesi();
    } catch (e) {
      panelIcerik(sekmeHtml('sinyal') + '<div class="sb-hata">❌ ' + h(e.message) + '</div>' + ayarHtml());
    } finally {
      taraniyor = false;
    }
  }

  // ---------- Kayıtlar ----------
  const kayitAl = () => GM_getValue('sb_kayitlar', []);
  const kayitYaz = k => GM_setValue('sb_kayitlar', k);
  const kayitliMi = id => kayitAl().some(x => x.id === id);
  function kaydet(s) {
    const k = kayitAl();
    if (k.some(x => x.id === s.id)) return false;
    const kopya = JSON.parse(JSON.stringify(s));
    kopya.kayitZaman = Date.now(); kopya.sonuc = null; kopya.surum = SURUM;
    k.unshift(kopya);
    kayitYaz(k);
    return true;
  }
  const kayitSil = id => kayitYaz(kayitAl().filter(x => x.id !== id));
  function sonucYaz(id, sonuc) {
    const k = kayitAl(), x = k.find(y => y.id === id);
    if (x) { x.sonuc = sonuc; kayitYaz(k); }
  }
  async function ilk11(macId, tid, oyuncuId) {
    try {
      const o = {};
      oyunculariTopla(await al(SH + '/event/' + macId + '/team-lineup?teamId=' + tid + '&heatmap=false'), o);
      const x = o[String(oyuncuId)];
      if (!x) return Object.keys(o).length >= 11 ? false : null;
      return !x.yedek;
    } catch (e) { return null; }
  }
  async function macSatiri(tid, key, yari, macId) {
    const v = await al(SH + '/team/' + tid + '/event-statistics?eventType=all&statisticKey=' + key + '&eventHalf=' + yari + '&limit=5');
    return (v.data || []).find(r => String(r.event_id) === String(macId)) || null;
  }
  async function sonuclariKontrol() {
    const simdi = Date.now() / 1000;
    const bekleyen = kayitAl().filter(x => !x.sonuc && x.macId && x.ts && simdi > x.ts + 2.5 * 3600);
    const perf = {};
    let yeni = 0;
    for (const x of bekleyen) {
      try {
        let sonuc = null;
        if (x.tur === 'oyuncu') {
          const tipT = OTIP[x.tip] || ESKI_TIP[x.tip];
          if (!x.oyuncuId || !x.takimId || !tipT) continue;
          if (!perf[x.takimId]) {
            const v = await al(SH + '/team/' + x.takimId + '/players/performance?limit=10&location=both').catch(() => null);
            perf[x.takimId] = (v && v.data) || [];
          }
          const liste = perf[x.takimId], eid = String(x.macId);
          if (!liste.some(o => o.stats && o.stats[eid])) continue;
          const o = liste.find(y => String(y.id) === String(x.oyuncuId));
          const st = o && o.stats && o.stats[eid];
          const oynadi = st && +st.minutesPlayed > 0;
          let basladi = false;
          if (oynadi) basladi = x.kadroDurum === 'resmi' || +st.minutesPlayed >= 88 ? true : await ilk11(x.macId, x.takimId, x.oyuncuId);
          if (!oynadi || basladi === false) sonuc = { durum: 'iade', neden: oynadi ? 'yedek' : 'oynamadi', dk: oynadi ? +st.minutesPlayed : 0 };
          else { const deger = tipT.deger(st); sonuc = { durum: deger >= x.esik ? 'tuttu' : 'tutmadi', deger, dk: +st.minutesPlayed, ilk11: basladi }; }
        } else if (x.tur === 'takim') {
          const r = await macSatiri(x.evId, x.key, x.yari, x.macId);
          if (!r) continue;
          const hv = parseFloat(r.home_value), av = parseFloat(r.away_value);
          if (isNaN(hv) || isNaN(av)) continue;
          const v = x.taraf === 'ev' ? hv : x.taraf === 'dep' ? av : hv + av;
          sonuc = { durum: (x.yon === 'ust' ? v >= x.esik : v <= x.esik) ? 'tuttu' : 'tutmadi', deger: v };
        } else if (x.tur === 'ana') {
          const r = await macSatiri(x.evId, 'cornerKicks', 'ALL', x.macId);
          if (!r || r.home_score == null || r.away_score == null) continue;
          const hs = +r.home_score, as = +r.away_score;
          sonuc = { durum: (hs > as ? '1' : hs < as ? '2' : 'X') === x.sonucKod ? 'tuttu' : 'tutmadi', skor: hs + '-' + as };
        }
        if (sonuc) { sonuc.zaman = Date.now(); sonucYaz(x.id, sonuc); yeni++; }
      } catch (e) {}
    }
    return yeni;
  }

  // ---------- Görünüm ----------
  function saatYaz(ts) {
    const d = new Date(ts * 1000), b = new Date();
    const saat = d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
    return d.toDateString() === b.toDateString() ? saat : d.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit' }) + ' ' + saat;
  }
  const zamanYaz = ms => new Date(ms).toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit' }) + ' ' + new Date(ms).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
  const puanYazi = x => v1(x).replace(',0', '');
  const puanSinif = x => x >= 8 ? 'p8' : x >= 7 ? 'p7' : 'p6';
  const KADRO_YAZI = { resmi: '✅ Resmi kadro', muhtemel: '⏳ Muhtemel kadro', yok: '⏳ Kadro yok' };

  function durumRozet(s) {
    if (s.tur === 'ana') return '<span class="sb-rozet sb-r-fiyat">Fiyat notu</span>';
    if (s.takimPazari) return '<span class="sb-rozet sb-r-takim">Takım pazarı</span>';
    return s.kesin ? '<span class="sb-rozet sb-r-kesin">Kesin</span>' : '<span class="sb-rozet sb-r-on">Ön sinyal · kadro bekleniyor</span>';
  }
  function dokum(pu) {
    return 'Puan dökümü: değer ' + v1(pu.deger) + '/3 · ihtimal ' + v1(pu.ihtimal) + '/2 · piyasa ' + v1(pu.piyasa) + '/2 · kadro ' + v1(pu.kadro) + '/1,5 · veri ' + v1(pu.veri) + '/1,5';
  }
  function kaydetBtn(s) {
    const var_ = kayitliMi(s.id);
    return '<button class="sb-kbtn" data-kaydet="' + h(s.id) + '"' + (var_ ? ' disabled' : '') + '>' + (var_ ? '✔ Kaydedildi' : '💾 Kaydet') + '</button>';
  }
  function gerekceHtml(s) {
    return '<ul class="sb-gerekce">' + s.gerekce.map(g => '<li>' + h(g) + '</li>').join('') + '</ul>' + (s.puan ? '<div class="sb-k sb-dokum">' + dokum(s.puan) + '</div>' : '');
  }
  // Ana sinyal: büyük kart
  function anaHtml(s) {
    let html = '<div class="sb-anakart' + (s.kesin ? '' : ' sb-onkart') + '">';
    html += '<div class="sb-ust"><span class="sb-etiket">🥇 ANA SİNYAL</span><span class="sb-puan ' + puanSinif(s.puan.toplam) + '">' + puanYazi(s.puan.toplam) + '<small>/10</small></span></div>';
    html += '<div class="sb-secim"><b>' + h(s.secim) + '</b> · Bilyoner <b>' + v2(s.bil) + '</b></div>';
    html += '<div class="sb-k">' + h(s.altBaslik || '') + ' ' + durumRozet(s) + '</div>';
    html += gerekceHtml(s) + kaydetBtn(s) + '</div>';
    return html;
  }
  // Diğer sinyaller: tek satır, dokununca gerekçe açılır
  function digerHtml(s) {
    return '<details class="sb-diger' + (s.kesin ? '' : ' sb-onkart') + '"><summary><span class="sb-puan kucuk ' + puanSinif(s.puan.toplam) + '">' + puanYazi(s.puan.toplam) + '</span> <b>' + h(s.secim) + '</b> · ' + v2(s.bil) +
      (s.kesin || s.takimPazari ? '' : ' <span class="sb-k">⏳</span>') + '</summary><div class="sb-k">' + h(s.altBaslik || '') + ' ' + durumRozet(s) + '</div>' + gerekceHtml(s) + kaydetBtn(s) + '</details>';
  }
  function macHtml(m) {
    let html = '<div class="sb-mackart">';
    html += '<div class="sb-mac">⚽ <b>' + h(m.macAd) + '</b> · ' + saatYaz(m.ts) + (m.lig ? ' · ' + h(m.lig) : '') + '</div>';
    html += '<div class="sb-k">' + (KADRO_YAZI[m.kadro] || '') + (m.shAd ? ' · Statshub: ' + h(m.shAd) : '') + '</div>';
    const [ana, ...diger] = m.sinyaller;
    html += anaHtml(ana);
    if (diger.length) html += '<div class="sb-alt">Diğer sinyaller (' + diger.length + ')</div>' + diger.map(digerHtml).join('');
    if (m.fiyat) html += '<details class="sb-diger"><summary>💰 Fiyat notu: <b>' + h(m.fiyat.secim) + '</b> · ' + v2(m.fiyat.bil) + '</summary>' + gerekceHtml(m.fiyat) + kaydetBtn(m.fiyat) + '</details>';
    if (m.eslesmeyenOyuncu && m.eslesmeyenOyuncu.length) html += '<div class="sb-k" style="margin-top:6px">⚪ Statshub\'da olmayan oyuncular (sinyal verilmedi): ' + h(m.eslesmeyenOyuncu.slice(0, 6).join(', ')) + (m.eslesmeyenOyuncu.length > 6 ? '…' : '') + '</div>';
    return html + '</div>';
  }

  function sonucYazisi(r) {
    const s = r.sonuc;
    if (!s) return '⏳ Sonuç bekleniyor';
    if (s.durum === 'iade') {
      if (s.elle) return '↩️ İade (elle işaretlendi)';
      return s.neden === 'yedek' ? '↩️ İade · ilk 11\'de başlamadı, sonradan girdi (' + s.dk + ' dk)' : '↩️ İade · oynamadı';
    }
    const ok = s.durum === 'tuttu' ? '✅ ' : '❌ ';
    if (s.elle) return ok + (s.durum === 'tuttu' ? 'Tuttu' : 'Tutmadı') + ' (elle işaretlendi)';
    if (r.tur === 'ana') return ok + 'Skor ' + s.skor;
    if (r.tur === 'takim') return ok + (r.taraf === 'toplam' ? 'Toplam ' : '') + s.deger + ' ' + (TPAZAR.find(p => p[1] === r.key) || [, , , ''])[3];
    const birim = (OTIP[r.tip] || ESKI_TIP[r.tip] || {}).birim || '';
    let y = r.tip === 'kart' ? (s.deger > 0 ? 'Kart gördü' : 'Kart görmedi') : s.deger + ' ' + birim;
    if (s.dk) y += ' · ' + s.dk + ' dk';
    return ok + y;
  }
  function kayitKartHtml(r) {
    let html = '<div class="sb-kart">';
    html += '<div class="sb-mac">⚽ ' + h(r.macAd) + ' · ' + saatYaz(r.ts) + (r.lig ? ' · ' + h(r.lig) : '') + '</div>';
    const pz = r.puan ? '<span class="sb-puan kucuk ' + puanSinif(r.puan.toplam) + '">' + puanYazi(r.puan.toplam) + '</span> ' : '';
    html += '<div class="sb-secim">' + pz + '<b>' + h(r.secim) + '</b> · Bilyoner <b>' + v2(r.bil) + '</b>' + (r.ana ? ' <span class="sb-rozet sb-r-kesin">Ana</span>' : '') + '</div>';
    html += '<details><summary class="sb-k">Gerekçe</summary>' + '<ul class="sb-gerekce">' + (r.gerekce || []).map(g => '<li>' + h(g) + '</li>').join('') + '</ul>' + (r.puan ? '<div class="sb-k">' + dokum(r.puan) + '</div>' : '') + '</details>';
    html += '<div class="sb-k">Kaydedildi ' + zamanYaz(r.kayitZaman) + (r.ayarYazi ? ' · ' + h(r.ayarYazi) : '') + (r.surum ? ' · v' + h(r.surum) : ' · v1') + '</div>';
    const s = r.sonuc;
    const renk = !s ? '#fde047' : s.durum === 'tuttu' ? '#4ade80' : s.durum === 'tutmadi' ? '#f87171' : '#cbd5e1';
    html += '<div style="margin-top:3px;font-weight:bold;color:' + renk + '">Sonuç: ' + sonucYazisi(r) + '</div><div style="margin-top:5px">';
    const b = (d, y) => '<button class="sb-kbtn" data-elle="' + d + '" data-id="' + h(r.id) + '">' + y + '</button> ';
    if (!s) html += b('tuttu', '✅ Tuttu') + b('tutmadi', '❌ Tutmadı') + (r.tur === 'oyuncu' ? b('iade', '↩️ İade') : '');
    else if (r.tur === 'oyuncu' && !s.elle && s.ilk11 == null && (s.durum === 'tuttu' || s.durum === 'tutmadi'))
      html += '<div class="sb-k">⚠️ İlk 11 bilgisi alınamadı. Oyuncu yedekten girdiyse bahis iade olur:</div>' + b('iade', '↩️ İade olarak işaretle');
    return html + '<button class="sb-kbtn" data-sil="' + h(r.id) + '">🗑️ Sil</button></div></div>';
  }

  function ozet(liste) {
    const biten = liste.filter(r => r.sonuc && (r.sonuc.durum === 'tuttu' || r.sonuc.durum === 'tutmadi'));
    const tut = biten.filter(r => r.sonuc.durum === 'tuttu').length;
    const kar = biten.reduce((a, r) => a + (r.sonuc.durum === 'tuttu' ? r.bil - 1 : -1), 0);
    return { n: biten.length, tut, kar, roi: biten.length ? kar / biten.length : 0 };
  }
  function ozetSatir(ad, o) {
    if (!o.n) return '<div class="sb-k">' + ad + ': henüz sonuçlanan yok</div>';
    return '<div>' + ad + ': <b>' + o.tut + '/' + o.n + '</b> tuttu (' + yuzde(o.tut / o.n) + ') · <span class="' + (o.kar >= 0 ? 'sb-iyi' : 'sb-kotu') + '">' +
      (o.kar >= 0 ? '+' : '') + v2(o.kar) + ' birim (' + isaretli(o.roi) + ')</span></div>';
  }
  function raporHtml(k) {
    const bekleyen = k.filter(r => !r.sonuc).length, iade = k.filter(r => r.sonuc && r.sonuc.durum === 'iade').length;
    let html = '<div class="sb-grup">📈 Genel</div>' + ozetSatir('Hepsi', ozet(k)) +
      '<div class="sb-k">' + k.length + ' kayıt · ' + bekleyen + ' bekliyor · ' + iade + ' iade · her sinyale 1 birim basılmış gibi</div>';
    const yeni = k.filter(r => r.puan);
    if (yeni.length) {
      html += '<div class="sb-grup">Puana göre</div>';
      [[8, 11, '8 ve üstü'], [7, 8, '7 – 8'], [6, 7, '6 – 7']].forEach(([a, b, ad]) => {
        const gr = yeni.filter(r => r.puan.toplam >= a && r.puan.toplam < b);
        if (gr.length) html += ozetSatir('Puan ' + ad, ozet(gr));
      });
      if (yeni.some(r => r.ana)) html += ozetSatir('🥇 Ana sinyaller', ozet(yeni.filter(r => r.ana))) + ozetSatir('Diğer sinyaller', ozet(yeni.filter(r => !r.ana && r.tur !== 'ana')));
    }
    const eski = k.filter(r => !r.puan && r.guven);
    if (eski.length) html += '<div class="sb-grup">Eski sürüm (1.0) kayıtları</div>' + ozetSatir('v1 sinyalleri', ozet(eski));
    html += '<div class="sb-grup">Pazara göre</div>';
    const pazarAd = r => (r.tur === 'oyuncu' ? 'Oyuncu · ' : r.tur === 'takim' ? 'Takım · ' : '') + r.pazarAd;
    [...new Set(k.map(pazarAd))].forEach(ad => { html += ozetSatir(h(ad), ozet(k.filter(r => pazarAd(r) === ad))); });
    html += '<div class="sb-grup">Dediğim ihtimal doğru mu?</div>';
    let yazildi = false;
    [[0, 0.5, '%50 altı'], [0.5, 0.6, '%50–60'], [0.6, 0.7, '%60–70'], [0.7, 1.01, '%70 ve üstü']].forEach(([a, b, ad]) => {
      const gr = k.filter(r => r.p >= a && r.p < b && r.sonuc && (r.sonuc.durum === 'tuttu' || r.sonuc.durum === 'tutmadi'));
      if (!gr.length) return;
      yazildi = true;
      html += '<div>' + ad + ': dedim <b>' + yuzde(mean(gr.map(r => r.p))) + '</b> · gerçekte <b>' + yuzde(gr.filter(r => r.sonuc.durum === 'tuttu').length / gr.length) + '</b> <span class="sb-k">(' + gr.length + ' kayıt)</span></div>';
    });
    if (!yazildi) html += '<div class="sb-k">Sonuçlanan kayıt oldukça dolacak. Güvenilir olması için her aralıkta 20–30 kayıt gerekir.</div>';
    return html;
  }

  function css() {
    if (document.getElementById('sb-css')) return;
    const st = document.createElement('style');
    st.id = 'sb-css';
    st.textContent =
      '#sb-btn{position:fixed;right:12px;bottom:300px;z-index:2147483646;width:52px;height:52px;border-radius:50%;border:none;font-size:24px;padding:0;background:#6366f1;box-shadow:0 2px 10px #0009}' +
      '#sb-panel{position:fixed;left:8px;right:8px;bottom:8px;max-height:84vh;overflow:auto;z-index:2147483647;background:#151826;color:#e8eaf6;border-radius:14px;padding:14px;font:14px/1.45 sans-serif;box-shadow:0 6px 24px #000c;box-sizing:border-box;display:none}' +
      '#sb-panel h3{margin:0 0 6px;font-size:16px}' +
      '#sb-panel .sb-kapat{position:absolute;right:10px;top:8px;background:none;border:none;color:#ccc;font-size:22px}' +
      '#sb-panel .sb-sekme{display:flex;gap:6px;margin:4px 0 8px}' +
      '#sb-panel .sb-sekme button{flex:1;padding:9px 4px;border-radius:9px;border:1px solid #3b3f63;background:#1e2238;color:#dde;font-size:14px;font-weight:bold}' +
      '#sb-panel .sb-sekme button.sec{background:#a5b4fc;color:#111;border-color:#a5b4fc}' +
      '#sb-panel .sb-ayar{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0}' +
      '#sb-panel .sb-ayar button{flex:1;min-width:28%;padding:8px 4px;border-radius:8px;border:1px solid #3b3f63;background:#1e2238;color:#dde;font-size:13px}' +
      '#sb-panel .sb-ayar button.sec{background:#6366f1;color:#fff;border-color:#6366f1}' +
      '#sb-panel .sb-ana{width:100%;padding:11px;border:none;border-radius:10px;background:#818cf8;color:#0b0d1a;font-weight:bold;font-size:15px;margin-top:6px}' +
      '#sb-panel .sb-grup{margin-top:14px;font-weight:bold;color:#c7d2fe;border-bottom:1px solid #2c3050;padding-bottom:3px}' +
      '#sb-panel .sb-mackart{margin-top:12px;padding:10px;border-radius:12px;background:#1a1e31;border:1px solid #2c3050}' +
      '#sb-panel .sb-mac{font-size:13px;color:#c7cdf0}' +
      '#sb-panel .sb-anakart{margin-top:8px;padding:10px;border-radius:10px;background:#20253d;border-left:4px solid #f97316}' +
      '#sb-panel .sb-onkart{opacity:.72;border-left-color:#64748b !important;border-left-style:dashed !important}' +
      '#sb-panel .sb-ust{display:flex;justify-content:space-between;align-items:center;margin-bottom:4px}' +
      '#sb-panel .sb-etiket{font-size:12px;font-weight:bold;letter-spacing:.5px;color:#fdba74}' +
      '#sb-panel .sb-puan{font-weight:bold;font-size:20px;padding:2px 9px;border-radius:9px;color:#111}' +
      '#sb-panel .sb-puan small{font-size:11px;font-weight:normal}' +
      '#sb-panel .sb-puan.kucuk{font-size:12px;padding:1px 6px;border-radius:6px}' +
      '#sb-panel .p8{background:#f97316}#sb-panel .p7{background:#4ade80}#sb-panel .p6{background:#5eead4}' +
      '#sb-panel .sb-secim{font-size:15px;margin:2px 0}' +
      '#sb-panel .sb-alt{margin-top:10px;font-size:12px;font-weight:bold;color:#a5adcf}' +
      '#sb-panel .sb-diger{margin-top:5px;padding:7px 8px;border-radius:8px;background:#1e2238;border-left:3px solid #22c55e}' +
      '#sb-panel .sb-diger summary{cursor:pointer;font-size:13.5px}' +
      '#sb-panel .sb-kart{margin-top:8px;padding:9px;border-radius:10px;background:#1c2034;border-left:4px solid #64748b}' +
      '#sb-panel .sb-rozet{font-size:11px;padding:1px 6px;border-radius:6px;white-space:nowrap}' +
      '#sb-panel .sb-r-kesin{background:#22c55e;color:#052}#sb-panel .sb-r-on{background:#475569;color:#e2e8f0}#sb-panel .sb-r-takim{background:#38bdf8;color:#082f49}#sb-panel .sb-r-fiyat{background:#eab308;color:#111}' +
      '#sb-panel .sb-gerekce{margin:5px 0 4px 0;padding-left:18px;font-size:12.5px;color:#cfd4ee}' +
      '#sb-panel .sb-gerekce li{margin:2px 0}' +
      '#sb-panel .sb-dokum{margin:0 0 5px;font-size:11px}' +
      '#sb-panel .sb-k{font-size:12px;color:#a5adcf}' +
      '#sb-panel .sb-kbtn{padding:5px 10px;border-radius:7px;border:1px solid #3b3f63;background:#262b47;color:#e8eaf6;font-size:12px;margin-top:3px}' +
      '#sb-panel .sb-kbtn[disabled]{opacity:.6}' +
      '#sb-panel .sb-iyi{color:#4ade80;font-weight:bold}#sb-panel .sb-kotu{color:#f87171;font-weight:bold}' +
      '#sb-panel .sb-hata{background:#3b1414;color:#fecaca;padding:8px;border-radius:8px;margin:6px 0}' +
      '#sb-panel .sb-durum{color:#c7d2fe;font-size:14px;margin:10px 0}';
    document.head.appendChild(st);
  }
  function panel() {
    let p = document.getElementById('sb-panel');
    if (p) return p;
    p = document.createElement('div');
    p.id = 'sb-panel';
    document.body.appendChild(p);
    p.addEventListener('click', tikla);
    return p;
  }
  function panelIcerik(html) {
    const p = panel();
    p.innerHTML = '<button class="sb-kapat">×</button><h3>📡 Sinyal Botu ' + SURUM + '</h3>' + html;
    p.style.display = 'block';
  }
  function sekmeHtml(aktif) {
    return '<div class="sb-sekme"><button data-sekme="sinyal" class="' + (aktif === 'sinyal' ? 'sec' : '') + '">📡 Sinyaller</button>' +
      '<button data-sekme="kayit" class="' + (aktif === 'kayit' ? 'sec' : '') + '">📊 Kayıtlar (' + kayitAl().length + ')</button></div>';
  }
  function ayarHtml() {
    const b = (g, v, y, sec) => '<button data-g="' + g + '" data-v="' + v + '" class="' + (sec ? 'sec' : '') + '">' + y + '</button>';
    let html = '<div class="sb-ayar">' + b('pencere', 3, 'Sonraki 3 saat', ayar.pencere == 3) + b('pencere', 6, 'Sonraki 6 saat', ayar.pencere == 6) + b('pencere', 24, 'Bütün gün', ayar.pencere == 24) + '</div>' +
      '<div class="sb-ayar">' + b('mac', 5, 'Son 5 maç', ayar.macSayisi == 5) + b('mac', 10, 'Son 10 maç', ayar.macSayisi == 10) + '</div>' +
      '<button class="sb-ana" data-islem="tara">▶ Yakındaki maçları tara (' + pencereYazi() + ')</button>';
    if (macSayfasiId()) html += '<button class="sb-ana" data-islem="buMac" style="background:#c7d2fe">🎯 Sadece bu maçı tara</button>';
    return html;
  }
  function ilerleme(yazi) {
    panelIcerik('<div class="sb-durum">⏳ ' + yazi + '</div><button class="sb-ana" data-islem="durdur" style="background:#f87171">⏹ Durdur</button>');
  }
  function sinyalSekmesi() {
    let html = sekmeHtml('sinyal') + ayarHtml();
    const son = sonAl();
    if (son && son.maclar) {
      const sinyalli = son.maclar.filter(m => m.sinyaller && m.sinyaller.length);
      const kesin = sinyalli.filter(m => m.sinyaller[0].kesin).length;
      const yen = yenilenecek(son);
      html += '<div class="sb-k" style="margin-top:10px">Son tarama: ' + zamanYaz(son.zaman) + (son.yenileme ? ' · kadro yenileme ' + zamanYaz(son.yenileme) : '') + (son.sadeceBu ? ' · tek maç' : '') +
        ' · ' + son.mac + ' maç · Statshub\'da bulunan ' + son.maclar.length + ' · <b>' + sinyalli.length + ' maçta sinyal</b> (' + kesin + ' kesin, ' + (sinyalli.length - kesin) + ' kadro bekliyor)' +
        (son.durduruldu ? ' · yarıda durduruldu' : '') + '</div>';
      if (yen.length) html += '<button class="sb-ana" data-islem="kadroYenile" style="background:#fbbf24">🔄 Kadro bekleyen ' + yen.length + ' maçı yenile</button>';
      if (!sinyalli.length) html += '<div class="sb-k" style="padding:8px 0">Bu taramada 6/10 barajını geçen seçim çıkmadı. Bu normal: bot ancak hesabı, piyasası ve verisi yeterince sağlam seçimlere sinyal veriyor.</div>';
      sinyalli.sort((a, b) => (b.sinyaller[0].kesin - a.sinyaller[0].kesin) || (b.sinyaller[0].puan.toplam - a.sinyaller[0].puan.toplam));
      html += sinyalli.map(macHtml).join('');
      const sinyalsiz = son.maclar.filter(m => !(m.sinyaller && m.sinyaller.length));
      if (sinyalsiz.length) html += '<details style="margin-top:10px"><summary class="sb-k">Sinyal çıkmayan maçlar (' + sinyalsiz.length + ')</summary><div class="sb-k">' + h(sinyalsiz.map(m => m.macAd).join(' · ')) + '</div></details>';
      if (son.eslesmeyen && son.eslesmeyen.length) html += '<details style="margin-top:6px"><summary class="sb-k">Statshub\'da bulunamayan maçlar (' + son.eslesmeyen.length + ') · bunlara sinyal verilemez</summary><div class="sb-k">' + h(son.eslesmeyen.join(' · ')) + '</div></details>';
      if (sinyalli.length) html += '<div class="sb-k" style="margin-top:10px">⏳ Ön sinyal: resmi kadro gelmeden hesaplandı, oynama. Kadro açıklanınca "Kadro bekleyen maçları yenile"ye bas: oyuncu ilk 11\'deyse sinyal kesinleşir, değilse kaybolur. Sinyaller tarama anındaki oranlarla hesaplandı; oran düştüyse geçerliliğini yitirmiş olabilir.</div>';
    } else {
      html += '<div class="sb-k" style="padding:8px 0">Henüz tarama yapılmadı.</div>';
    }
    panelIcerik(html);
  }
  async function kayitlarGoster(kontrolEt) {
    let not = '';
    if (kontrolEt) {
      panelIcerik(sekmeHtml('kayit') + '<div class="sb-durum">⏳ Biten maçların sonuçları kontrol ediliyor…</div>');
      try { const n = await sonuclariKontrol(); if (n) not = '✅ ' + n + ' kaydın sonucu güncellendi'; }
      catch (e) { not = '⚠️ Sonuç kontrolü yapılamadı: ' + e.message; }
    }
    const k = kayitAl();
    let html = sekmeHtml('kayit');
    if (not) html += '<div class="sb-durum">' + h(not) + '</div>';
    if (!k.length) html += '<div class="sb-k" style="padding:8px 0">Henüz kayıt yok. Bir sinyaldeki 💾 Kaydet\'e basınca burada görünür.</div>';
    else {
      html += raporHtml(k);
      const bek = k.filter(r => !r.sonuc), bit = k.filter(r => r.sonuc);
      if (bek.length) html += '<div class="sb-grup">⏳ Bekleyenler (' + bek.length + ')</div>' + bek.map(kayitKartHtml).join('');
      if (bit.length) html += '<div class="sb-grup">Sonuçlananlar (' + bit.length + ')</div>' + bit.map(kayitKartHtml).join('');
    }
    html += '<div class="sb-ayar" style="margin-top:14px"><button data-islem="kontrol">🔄 Sonuçları kontrol et</button><button data-islem="yedekAl">📋 Yedeği kopyala</button><button data-islem="yedekYukle">📥 Yedeği geri yükle</button></div>' +
      '<div class="sb-k">Script\'i silersen kayıtlar da silinir. Güncellemeyi GitHub linkinden kur, eskisini silme.</div>';
    panelIcerik(html);
  }

  function sinyalBul(id) {
    const son = sonAl();
    for (const m of (son && son.maclar) || []) {
      const x = (m.sinyaller || []).find(s => s.id === id) || (m.fiyat && m.fiyat.id === id ? m.fiyat : null);
      if (x) return x;
    }
    return null;
  }
  function tikla(e) {
    const t = e.target.closest ? (e.target.closest('button') || e.target) : e.target, p = panel();
    const at = a => t.getAttribute && t.getAttribute(a);
    if (t.classList.contains('sb-kapat')) { p.style.display = 'none'; return; }
    const sekme = at('data-sekme');
    if (sekme === 'kayit') { if (!taraniyor) kayitlarGoster(true); return; }
    if (sekme === 'sinyal') { if (!taraniyor) sinyalSekmesi(); return; }
    const g = at('data-g');
    if (g) {
      if (g === 'pencere') ayar.pencere = Number(at('data-v'));
      if (g === 'mac') ayar.macSayisi = Number(at('data-v'));
      ayarKaydet(); sinyalSekmesi(); return;
    }
    const islem = at('data-islem');
    if (islem === 'tara') { tara(null); return; }
    if (islem === 'buMac') { tara(macSayfasiId()); return; }
    if (islem === 'kadroYenile') { kadroYenile(); return; }
    if (islem === 'durdur') { durdur = true; t.textContent = 'Durduruluyor…'; return; }
    if (islem === 'kontrol') { kayitlarGoster(true); return; }
    if (islem === 'yedekAl') {
      try { GM_setClipboard(JSON.stringify(kayitAl())); alert(kayitAl().length + ' kayıt panoya kopyalandı. Bir not uygulamasına yapıştırıp sakla.'); }
      catch (err) { prompt('Bu metni kopyalayıp sakla:', JSON.stringify(kayitAl())); }
      return;
    }
    if (islem === 'yedekYukle') {
      const metin = prompt('Daha önce kopyaladığın yedeği buraya yapıştır:');
      if (!metin) return;
      try {
        const gelen = JSON.parse(metin);
        if (!Array.isArray(gelen)) throw new Error();
        const k = kayitAl(), var_ = new Set(k.map(x => x.id));
        const ek = gelen.filter(x => x && x.id && !var_.has(x.id));
        kayitYaz(k.concat(ek)); alert(ek.length + ' kayıt geri yüklendi.'); kayitlarGoster(false);
      } catch (err) { alert('Yedek okunamadı. Metnin tamamını kopyaladığından emin ol.'); }
      return;
    }
    const kk = at('data-kaydet');
    if (kk) {
      const s = sinyalBul(kk);
      if (s && kaydet(s)) {
        p.querySelectorAll('[data-kaydet]').forEach(x => { if (x.getAttribute('data-kaydet') === kk) { x.textContent = '✔ Kaydedildi'; x.disabled = true; } });
        const sb = p.querySelector('[data-sekme="kayit"]');
        if (sb) sb.textContent = '📊 Kayıtlar (' + kayitAl().length + ')';
      }
      return;
    }
    const sil = at('data-sil');
    if (sil) { if (confirm('Bu kayıt silinsin mi?')) { kayitSil(sil); kayitlarGoster(false); } return; }
    const elle = at('data-elle');
    if (elle) { sonucYaz(at('data-id'), { durum: elle, elle: true, zaman: Date.now() }); kayitlarGoster(false); }
  }

  function butonKoy() {
    let b = document.getElementById('sb-btn');
    const gizle = /basketbol/.test(location.pathname);
    if (gizle) { if (b) b.style.display = 'none'; return; }
    if (!b) {
      b = document.createElement('button');
      b.id = 'sb-btn';
      b.textContent = '📡';
      b.addEventListener('click', () => {
        const p = panel();
        if (p.style.display === 'block') { p.style.display = 'none'; return; }
        if (taraniyor) { p.style.display = 'block'; return; }
        sinyalSekmesi();
      });
      document.body.appendChild(b);
    }
    b.style.display = 'block';
  }

  css();
  butonKoy();
  setInterval(butonKoy, 2000);
})();
