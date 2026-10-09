// ==UserScript==
// @name         Basket Oyuncu Sinyal
// @namespace    basketoyuncusinyal
// @version      1.4
// @description  Bilyoner basketbol oyuncu bahisleri (NBA + EuroLeague): kesin kadro takibi, oyun içi pozisyon analizi, rotasyon/yokluk etkisi, maç senaryosu, simülasyon, gölge kayıt ve kendini sınama
// @match        https://www.bilyoner.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_setClipboard
// @connect      sofascore.com
// @connect      www.sofascore.com
// @connect      api.sofascore.com
// @connect      www.bilyoner.com
// @connect      euroleague.net
// @connect      live.euroleague.net
// @connect      api-live.euroleague.net
// @connect      incrowdsports.com
// @connect      feeds.incrowdsports.com
// @connect      espn.com
// @connect      site.api.espn.com
// @connect      flashscore.ninja
// @connect      10.flashscore.ninja
// @run-at       document-end
// @downloadURL  https://raw.githubusercontent.com/citomuhammet00/mac-arsivi/main/BasketOyuncuSinyal.user.js
// @updateURL    https://raw.githubusercontent.com/citomuhammet00/mac-arsivi/main/BasketOyuncuSinyal.user.js
// ==/UserScript==
(function () {
  'use strict';

  const SURUM = '1.4';
  const SS = 'https://www.sofascore.com/api/v1';
  const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba';
  const EL_LIVE = 'https://live.euroleague.net/api';
  const EL_V2 = ['https://api-live.euroleague.net/v2', 'https://feeds.incrowdsports.com/provider/euroleague-feeds/v2'];
  const FS_FEED = 'https://10.flashscore.ninja/10/x/feed/', FS_IMZA = 'SW9D1eZo';
  const ARSIV_MAC = 20;      // takım başına ilk seferde indirilecek en fazla maç
  const MODEL_MAC = 25;      // modelin kullandığı en fazla maç
  const ARSIV_GUN = 300;     // bundan eski maçlar kullanılmaz
  const ARSIV_MAX = 1000;    // telefonda saklanan en fazla maç (NBA + EuroLeague için)
  const POZ_MAX = 700;       // saklanan en fazla oyun içi pozisyon kaydı (maç × takım)
  const POZ_MAC = 10;        // pozisyon profili için bakılan en fazla maç
  const POZ_YENI = { EL: 6, NBA: 4 }; // bir taramada takım başına indirilecek en fazla yeni pozisyon maçı
  const GOLGE_MAX = 4000;    // gölge kayıt sınırı
  const SIM = 8000;          // simülasyon sayısı
  const MARJ = 1.07;         // tek taraflı "N+" oranlarında varsayılan Bilyoner marjı
  const MAC_BASI = 4;        // maç başına en fazla sinyal
  const ESIK = { fark: 0.10, yuksekFark: 0.12, minP: 0.45, yuksekP: 0.50, supheli: 0.60, ic: 0.05 };
  const SIGMA_TAKIM = { pts: 11, reb: 6.5, ast: 4.5, tpm: 3 };
  const DOSTLUK = /friendly|friendlies|hazirlik|pre ?season|exhibition|summer league|test mac/;
  const SLOT_AD = ['1 numara (oyun kurucu)', '2 numara (şutör guard)', '3 numara (kısa forvet)', '4 numara (uzun forvet)', '5 numara (pivot)'];
  // Aynı oyuncu farklı pozisyonda oynarken dakika başı üretiminin göreli değişimi (ön bilgi; pozisyon verisi geldikçe güncellenir)
  const SLOT_ON = {
    pts: [1, 1.02, 1, 0.98, 0.97], reb: [0.75, 0.82, 1, 1.2, 1.35], ast: [1.35, 1.1, 0.95, 0.85, 0.8],
    tpm: [1.05, 1.1, 1.05, 0.9, 0.7], ftm: [1, 1, 1, 1.03, 1.06], tov: [1.25, 1.08, 0.95, 0.9, 0.88]
  };
  const GRUP_YON = { G: 'guardlara', F: 'forvetlere', C: 'pivotlara' };

  const ayar = Object.assign({ pencere: 3, ligler: 'nba_el', takip: true, ses: true }, GM_getValue('bo_ayar', {}));
  const ayarKaydet = () => GM_setValue('bo_ayar', Object.assign({}, ayar));

  // ---------- Pazarlar ----------
  const STATS = ['pts', 'reb', 'ast', 'tpm', 'ftm', 'tov'];
  const STAT_AD = { pts: 'sayı', reb: 'ribaund', ast: 'asist', tpm: 'üçlük', ftm: 'serbest atış', tov: 'top kaybı' };
  const TIP = {
    pts: { ad: 'Sayı', birim: 'sayı', b: ['pts'] },
    reb: { ad: 'Ribaund', birim: 'ribaund', b: ['reb'] },
    ast: { ad: 'Asist', birim: 'asist', b: ['ast'] },
    tpm: { ad: 'İsabetli Üçlük', birim: 'üçlük', b: ['tpm'] },
    ftm: { ad: 'İsabetli Serbest Atış', birim: 'serbest atış', b: ['ftm'] },
    tov: { ad: 'Top Kaybı', birim: 'top kaybı', b: ['tov'] },
    pa: { ad: 'Sayı + Asist', birim: 'sayı+asist', b: ['pts', 'ast'] },
    pr: { ad: 'Sayı + Ribaund', birim: 'sayı+ribaund', b: ['pts', 'reb'] },
    ra: { ad: 'Ribaund + Asist', birim: 'ribaund+asist', b: ['reb', 'ast'] },
    pra: { ad: 'Sayı + Ribaund + Asist', birim: 'sayı+ribaund+asist', b: ['pts', 'reb', 'ast'] }
  };
  // Bilyoner'in diğer pazarlarından bir pazarın beklentisini türetme formülleri (iç tutarlılık)
  const TURET = {
    pts: [['pa', -1, 'ast'], ['pr', -1, 'reb'], ['pra', -1, 'reb', -1, 'ast'], ['pra', -1, 'ra']],
    reb: [['pr', -1, 'pts'], ['ra', -1, 'ast'], ['pra', -1, 'pa']],
    ast: [['pa', -1, 'pts'], ['ra', -1, 'reb'], ['pra', -1, 'pr']],
    pa: [['pts', 1, 'ast'], ['pra', -1, 'reb']],
    pr: [['pts', 1, 'reb'], ['pra', -1, 'ast']],
    ra: [['reb', 1, 'ast'], ['pra', -1, 'pts']],
    pra: [['pts', 1, 'reb', 1, 'ast'], ['pa', 1, 'reb'], ['pr', 1, 'ast'], ['ra', 1, 'pts']]
  };
  // Türkçe takım adları → Sofascore'daki adları
  const TAKIM_ES = {
    'kizilyildiz': 'crvena zvezda', 'kizil yildiz': 'crvena zvezda', 'bayern munih': 'bayern', 'munih': 'bayern', 'paris': 'paris basketball',
    'olimpiakos': 'olympiacos', 'olympiakos': 'olympiacos', 'barselona': 'barcelona', 'monako': 'monaco', 'valensiya': 'valencia',
    'milano': 'olimpia milano', 'virtus bolonya': 'virtus bologna', 'bolonya': 'virtus bologna', 'panatinaikos': 'panathinaikos'
  };

  // ---------- Yardımcılar ----------
  function norm(s) {
    return String(s || '').replace(/İ/g, 'i').replace(/I/g, 'ı').toLowerCase().replace(/ı/g, 'i')
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9+,. ]/g, ' ').replace(/\s+/g, ' ').trim();
  }
  const BOS = ['basket', 'basketbol', 'basketball', 'bk', 'sk', 'bc', 'kk', 'spor', 'kulubu', 'club', 'team', 'beko'];
  const tokenlar = s => norm(s).replace(/[+,.]/g, ' ').split(' ').filter(t => t.length >= 3 && BOS.indexOf(t) < 0);
  function benzerlik(a, b) {
    let p = 0;
    a.forEach(t => { if (b.some(s => s === t || (t.length >= 4 && s.length >= 4 && s.slice(0, 4) === t.slice(0, 4)))) p++; });
    return p;
  }
  const takimBenzer = (a, b) => benzerlik(tokenlar(a), tokenlar(b));
  function isimPuan(a, b) {
    const A = norm(a).replace(/[+,.]/g, ' ').split(' ').filter(t => t.length >= 3), B = norm(b).replace(/[+,.]/g, ' ').split(' ').filter(t => t.length >= 3);
    let p = 0;
    A.forEach(t => {
      if (B.some(s => s === t)) p += 2;
      else if (B.some(s => t.length >= 4 && s.length >= 4 && s.slice(0, 4) === t.slice(0, 4))) p += 1.5;
    });
    return p;
  }
  function enIyiAday(ad, liste, adF, idF) {
    let iyi = null, puan = 0, belirsiz = false;
    liste.forEach(x => {
      const p = isimPuan(ad, adF(x));
      if (p > puan) { puan = p; iyi = x; belirsiz = false; }
      else if (p === puan && p > 0 && iyi && String(idF(x)) !== String(idF(iyi))) belirsiz = true;
    });
    return puan >= 2 && !belirsiz ? iyi : null;
  }
  // İki isim aynı kişi mi (ad + soyad eşleşmesi gerekir)
  const adEsit = (a, b) => isimPuan(a, b) >= 3.5 || (norm(a) && norm(a) === norm(b));
  const h = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const v1 = x => (Math.round(x * 10) / 10).toFixed(1).replace('.', ',');
  const v0 = x => String(Math.round(x));
  const v2 = x => Number(x).toFixed(2).replace('.', ',');
  const yuzde = x => '%' + Math.round(x * 100);
  const isaretli = x => Math.abs(x) < 0.005 ? '±0%' : (x >= 0 ? '+' : '−') + Math.abs(Math.round(x * 100)) + '%';
  const isaretliSayi = (x, f) => (x >= 0 ? '+' : '−') + (f || v1)(Math.abs(x));
  const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN;
  const toplam = a => a.reduce((x, y) => x + y, 0);
  const sinirla = (x, a, b) => Math.min(b, Math.max(a, x));
  const simdiSn = () => Date.now() / 1000;
  const bekle = ms => new Promise(r => setTimeout(r, ms));
  const logit = p => { p = sinirla(p, 0.001, 0.999); return Math.log(p / (1 - p)); };
  const sigm = z => 1 / (1 + Math.exp(-z));
  const soyad = ad => { const p = String(ad || '').replace(/\s+(jr|sr|ii|iii|iv)\.?$/i, '').trim().split(' '); return p[p.length - 1] || String(ad || ''); };
  const bosDizi = () => [0, 0, 0, 0, 0];
  function phiTers(p) {
    p = sinirla(p, 0.001, 0.999);
    const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
    const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
    const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
    const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
    const pl = 0.02425;
    let q, r;
    if (p < pl) { q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
    if (p > 1 - pl) { q = Math.sqrt(-2 * Math.log(1 - p)); return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
    q = p - 0.5; r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }
  // Negatif binom (d = varyans/ortalama) için P(X ≥ N)
  function nbKuyruk(mu, d, N) {
    if (N <= 0) return 1;
    if (!(mu > 0)) return 0;
    let t, top = 0;
    if (!d || d <= 1.01) {
      t = Math.exp(-mu);
      for (let k = 0; k < N; k++) { top += t; t *= mu / (k + 1); }
    } else {
      const r = mu / (d - 1), q = mu / (r + mu);
      t = Math.pow(r / (r + mu), r);
      for (let k = 0; k < N; k++) { top += t; t *= (k + r) / (k + 1) * q; }
    }
    return sinirla(1 - top, 0, 1);
  }
  // P(X ≥ N) = p olacak ortalamayı bul
  function ortalamaBul(N, p, d) {
    let lo = 0.01, hi = 4 * N + 30;
    for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (nbKuyruk(m, d, N) < p) lo = m; else hi = m; }
    return (lo + hi) / 2;
  }
  // Tekrarlanabilir rastgele sayı (aynı maç için her taramada aynı sonuç)
  function rng(seed) {
    let x = (seed >>> 0) || 2463534242;
    return () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return (x + 0.5) / 4294967296; };
  }
  const tohum = s => { let x = 5381; String(s).split('').forEach(c => { x = ((x << 5) + x + c.charCodeAt(0)) >>> 0; }); return x; };
  function normalUret(R) {
    let yedek = null;
    return () => {
      if (yedek !== null) { const y = yedek; yedek = null; return y; }
      const u = R(), v = R(), rr = Math.sqrt(-2 * Math.log(u)), t = 2 * Math.PI * v;
      yedek = rr * Math.sin(t);
      return rr * Math.cos(t);
    };
  }
  function gamma(R, N, k) {
    if (k < 1) return gamma(R, N, k + 1) * Math.pow(R(), 1 / k);
    const d = k - 1 / 3, c = 1 / Math.sqrt(9 * d);
    for (;;) {
      let x, v;
      do { x = N(); v = 1 + c * x; } while (v <= 0);
      v = v * v * v;
      const u = R();
      if (u < 1 - 0.0331 * x * x * x * x) return d * v;
      if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
    }
  }
  function poisson(R, N, l) {
    if (!(l > 0)) return 0;
    if (l > 30) return Math.max(0, Math.round(l + Math.sqrt(l) * N()));
    const L = Math.exp(-l);
    let k = 0, p = 1;
    do { k++; p *= R(); } while (p > L);
    return k - 1;
  }
  // Lig türü: EL (EuroLeague), NBA, DIGER
  function ligTuru(ad) {
    const n = norm(ad);
    if (/euroleague|euro league|avrupa ligi/.test(n) && !/eurocup|women|kadin/.test(n)) return 'EL';
    if (/(^| )nba( |$)/.test(n) && !/summer|g league|g lig|wnba|women|preseason/.test(n)) return 'NBA';
    return 'DIGER';
  }
  const ligIzinli = lgn => ayar.ligler === 'hepsi' || !lgn || (/nba|euroleague|euro lig|avrupa lig/.test(norm(lgn)) && !/wnba|g lig|kadin|women|eurocup/.test(norm(lgn)));

  // ---------- İstekler ----------
  function istek(url, opt) {
    opt = opt || {};
    const ad = opt.ad || 'Sunucu';
    return new Promise((coz, red) => {
      GM_xmlhttpRequest({
        method: 'GET', url, timeout: opt.sure || 25000,
        headers: Object.assign({ Accept: opt.metin ? '*/*' : 'application/json' }, opt.baslik || {}),
        onload: r => {
          if (r.status !== 200) { const e = new Error(ad + ' cevabı ' + r.status); e.kod = r.status; return red(e); }
          if (opt.metin) return coz(r.responseText || '');
          try { coz(JSON.parse(r.responseText)); } catch (e) { red(new Error(ad + ' verisi okunamadı')); }
        },
        onerror: () => red(new Error(ad + ': bağlantı hatası')),
        ontimeout: () => red(new Error(ad + ': zaman aşımı'))
      });
    });
  }
  // Aynı anda en fazla "es" istek, aralarında "ara" ms bekleme
  function siraci(es, ara) {
    let aktif = 0;
    const q = [];
    const sonraki = () => { setTimeout(() => { aktif--; const n = q.shift(); if (n) n(); }, ara || 0); };
    return (url, opt) => new Promise((coz, red) => {
      const calis = () => { aktif++; istek(url, opt).then(v => { sonraki(); coz(v); }, e => { sonraki(); red(e); }); };
      if (aktif < es) calis(); else q.push(calis);
    });
  }
  const bAl = url => istek(url, { ad: 'Bilyoner' });
  const ssSira = siraci(3, 120), elAl = siraci(2, 80), espnAl = siraci(2, 80);
  let ssKisit = false, ssSay = 0;
  async function ssAl(yol) {
    if (ssKisit) throw new Error('Sofascore şu an istek kabul etmiyor');
    ssSay++;
    try { return await ssSira(SS + yol, { ad: 'Sofascore' }); }
    catch (e) {
      if (e.kod === 403 || e.kod === 429) { ssKisit = true; throw new Error('Sofascore geçici sınır koydu (' + e.kod + ')'); }
      if (e.kod === 404) { const x = new Error('Bulunamadı'); x.kod = 404; throw x; }
      throw e;
    }
  }
  const elJson = url => elAl(url, { ad: 'EuroLeague', sure: 30000 });
  const espnJson = (yol, sure) => espnAl(ESPN + yol, { ad: 'ESPN', sure: sure || 30000 });
  const fsFeed = yol => istek(FS_FEED + yol, { ad: 'Flashscore', metin: true, baslik: { 'x-fsign': FS_IMZA, Referer: 'https://www.flashscore.com.tr/', Origin: 'https://www.flashscore.com.tr' } });
  let C = {};
  // Önbellek: başarısız olan istek saklanmaz, bir sonraki seferde tekrar denenir
  function onbellekli(k, f) {
    if (!(k in C)) {
      const p = f();
      C[k] = p;
      if (p && typeof p.catch === 'function') p.catch(() => { if (C[k] === p) delete C[k]; });
    }
    return C[k];
  }

  // ---------- Bilyoner ----------
  async function bilyonerVeri(bid) {
    const v = await bAl('https://www.bilyoner.com/api/v3/mobile/aggregator/match-card/' + bid + '/odds?isLiveEvent=false&isPopular=false');
    const oranlar = [];
    const gez = x => {
      if (!x || typeof x !== 'object') return;
      if (Array.isArray(x)) { x.forEach(gez); return; }
      if (Array.isArray(x.oddList)) x.oddList.forEach(o => {
        if (o && o.n !== undefined && o.val !== undefined) {
          const val = parseFloat(String(o.val).replace(',', '.'));
          if (val > 1) oranlar.push({ pazar: String(x.name || o.mrn || ''), n: String(o.n), val });
        }
      });
      Object.keys(x).forEach(k => { if (k !== 'oddList' && x[k] && typeof x[k] === 'object') gez(x[k]); });
    };
    gez(v);
    return { ev: v && v.homeTeam, dep: v && v.awayTeam, oranlar };
  }
  async function basketBulteni() {
    const temel = 'https://www.bilyoner.com/api/v3/mobile/aggregator/gamelist/all/v1?tabType=1&bulletinType=2';
    for (const ek of ['', '&sportType=2', '&sportId=2', '&st=2']) {
      try {
        const v = await bAl(temel + ek);
        const ev = Object.values((v && v.events) || {}).filter(e => Number(e.st) === 2);
        if (ev.length) return ev.map(e => ({ bid: String(e.id), ev: e.htn, dep: e.atn, ts: Math.floor(Number(e.esdl) / 1000) || 0, lig: e.lgn || '' }));
      } catch (e) {}
    }
    const ids = [...new Set(Array.from(document.querySelectorAll('a[href*="/mac-karti/basketbol/"]'))
      .map(a => (String(a.getAttribute('href')).match(/mac-karti\/basketbol\/(\d+)/) || [])[1]).filter(Boolean))];
    if (ids.length) return ids.map(bid => ({ bid, ev: '', dep: '', ts: 0, lig: '' }));
    throw new Error('Basketbol maç listesi okunamadı. Bilyoner\'de basketbol bültenini (maç listesini) açıp tekrar dene, ya da bir maçın sayfasında "Sadece bu maçı tara"yı kullan.');
  }
  function oyuncuPazarTipi(baslik) {
    const b = norm(baslik);
    if (!/oyuncu/.test(b) || /takim|double|hangi oyuncu|ilk sayi|en cok|yari|periyot|ceyrek/.test(b)) return null;
    const S = /(^| )sayi( |$)/.test(b), R = /ribaund/.test(b), A = /asist/.test(b);
    const kombo = /toplam|\+|(^| )ve( |$)/.test(b);
    if (kombo) {
      if (S && R && A) return 'pra';
      if (S && A) return 'pa';
      if (S && R) return 'pr';
      if (R && A) return 'ra';
    }
    if ((S && R) || (S && A) || (R && A)) return null;   // belirsiz başlık: tahmin etme
    if (/uclu|ucluk/.test(b)) return 'tpm';
    if (/serbest atis/.test(b)) return 'ftm';
    if (/top kayb/.test(b)) return 'tov';
    if (R) return 'reb';
    if (A) return 'ast';
    if (S) return 'pts';
    return null;
  }
  // "Elie Okobo 11+" → { ad, N }
  const secimCoz = n => { const m = String(n).replace(/\s+/g, ' ').trim().match(/^(.+?)\s*(\d+)\s*\+$/); return m ? { ad: m[1].trim(), N: Number(m[2]) } : null; };
  function piyasaOku(oranlar, ev, dep) {
    const cizgi = (pz, sd) => {
      const g = {};
      oranlar.forEach(x => {
        if (!pz(norm(x.pazar))) return;
        const m = String(x.n).match(/(\d+)[,.]5\s*(Alt|Üst|Ust)/i);
        if (!m) return;
        const L = Number(m[1]) + 0.5, k = /alt/i.test(m[2]) ? 'a' : 'u';
        (g[L] = g[L] || {})[k] = x.val;
      });
      const est = Object.keys(g).map(L => {
        const r = g[L];
        if (!(r.a > 1 && r.u > 1)) return null;
        return Number(L) + sd * phiTers((1 / r.u) / (1 / r.u + 1 / r.a));
      }).filter(x => x !== null);
      return est.length ? mean(est) : null;
    };
    const temiz = p => !/yari|periyot|ceyrek| ve |kombo/.test(' ' + p + ' ');
    const T = cizgi(p => /toplam sayi/.test(p) && temiz(p), 16);
    const E = cizgi(p => /ev sahibi sayi/.test(p) && temiz(p), 11);
    const D = cizgi(p => /deplasman sayi/.test(p) && temiz(p), 11);
    const msP = p => /mac sonucu/.test(p) && !/yari|periyot|handikap|( |^)ve( |$)/.test(p);
    const bul = nAd => { const x = oranlar.find(q => norm(q.n) === nAd && msP(norm(q.pazar))); return x ? x.val : null; };
    const o1 = bul('ms 1'), o2 = bul('ms 2');
    const p1 = o1 && o2 ? (1 / o1) / (1 / o1 + 1 / o2) : null;
    const s = { T, p1 };
    if (E && D) { s.muA = E; s.muB = D; s.kaynak = 'takım sayı çizgileri'; }
    else if (T && p1) { const f = phiTers(p1) * 12.5; s.muA = (T + f) / 2; s.muB = (T - f) / 2; s.kaynak = 'toplam çizgisi + maç sonucu'; }
    else if (T) { s.muA = T / 2; s.muB = T / 2; s.kaynak = 'toplam çizgisi'; }
    s.takim = { ev: {}, dep: {} };
    const evT = tokenlar(ev), depT = tokenlar(dep);
    oranlar.forEach(x => {
      const b = norm(x.pazar);
      if (!/takim/.test(b) || /yari|periyot|ceyrek/.test(b)) return;
      const st = /ribaund/.test(b) ? 'reb' : /asist/.test(b) ? 'ast' : /uclu|ucluk/.test(b) ? 'tpm' : null;
      if (!st) return;
      const m = secimCoz(x.n);
      if (!m) return;
      const tok = tokenlar(m.ad);
      const kim = benzerlik(evT, tok) > benzerlik(depT, tok) ? 'ev' : benzerlik(depT, tok) > benzerlik(evT, tok) ? 'dep' : null;
      if (!kim) return;
      const p = sinirla(1 / (x.val * MARJ), 0.05, 0.95);
      const mu = m.N - 0.5 + SIGMA_TAKIM[st] * phiTers(p);
      (s.takim[kim][st] = s.takim[kim][st] || []).push(mu);
    });
    ['ev', 'dep'].forEach(k => Object.keys(s.takim[k]).forEach(st => { s.takim[k][st] = mean(s.takim[k][st]); }));
    return s;
  }
  // Bilyoner oran görüntüsü: oyuncu oranlarının ilk görüldüğü hali ve son hali (oran hareketi, kaldırılan oranlar)
  function oranGoruntusuKaydet(bid, secimler) {
    const G = GM_getValue('bo_oranGecmis', {});
    const once = G[bid] || null;
    const son = {};
    secimler.forEach(sc => { const k = norm(sc.ad); (son[k] = son[k] || {})[sc.tip + '|' + sc.N] = sc.bil; });
    G[bid] = { z: Date.now(), son, ilk: once ? (once.ilk || once.son) : son, ilkZ: once ? (once.ilkZ || once.z) : Date.now() };
    const k = Object.keys(G);
    if (k.length > 80) k.sort((a, b) => G[a].z - G[b].z).slice(0, k.length - 80).forEach(x => delete G[x]);
    GM_setValue('bo_oranGecmis', G);
    return once;
  }

  // ---------- Sofascore ----------
  const takimOnb = GM_getValue('bo_takimlar', {});
  async function ssTakimBul(ad) {
    const elle = GM_getValue('bo_elle', {})[norm(ad)];
    if (elle) return elle;
    let k = norm(ad);
    for (const a of Object.keys(TAKIM_ES)) if (k === a || k.startsWith(a + ' ')) { k = TAKIM_ES[a] + k.slice(a.length); break; }
    if (takimOnb[k]) return takimOnb[k];
    const tok = tokenlar(k);
    if (!tok.length) return null;
    const sorgular = [k, tok.join(' '), tok[0]].filter((x, i, a) => x && a.indexOf(x) === i);
    let enIyi = null, puan = 0, hata = null, basari = 0;
    for (const q of sorgular) {
      let v;
      try { v = await ssAl('/search/all?q=' + encodeURIComponent(q)); basari++; } catch (e) { hata = e; continue; }
      (v.results || []).forEach(r => {
        const e = r.entity || {};
        if (r.type !== 'team' || !e.sport || e.sport.slug !== 'basketball' || e.gender === 'F') return;
        if (/(^| )u\d\d( |$)/.test(norm(e.name)) && !/u\d\d/.test(k)) return;
        let p = benzerlik(tok, tokenlar((e.name || '') + ' ' + String(e.slug || '').replace(/-/g, ' ') + ' ' + (e.shortName || '')));
        if (p > 0) p += Math.min(0.9, (e.userCount || 0) / 200000);
        if (p > puan) { puan = p; enIyi = { id: e.id, ad: e.name }; }
      });
      if (enIyi && puan >= tok.length) break;
    }
    if (!basari && hata) throw new Error('Sofascore\'a ulaşılamadı (' + hata.message + ')');
    if (enIyi) { takimOnb[k] = enIyi; GM_setValue('bo_takimlar', takimOnb); }
    return enIyi;
  }
  // Elle eşleştirme ekranı için takım arama
  async function ssTakimAra(q) {
    const v = await ssAl('/search/all?q=' + encodeURIComponent(q));
    return (v.results || []).filter(r => r.type === 'team' && r.entity && r.entity.sport && r.entity.sport.slug === 'basketball')
      .map(r => ({ id: r.entity.id, ad: r.entity.name, ulke: (r.entity.country && r.entity.country.name) || '', kadin: r.entity.gender === 'F', n: r.entity.userCount || 0 }))
      .slice(0, 12);
  }
  const turnuvaAdi = e => { const ut = e.tournament && e.tournament.uniqueTournament; return (ut && ut.name) || (e.tournament && e.tournament.name) || ''; };
  const bittiMi = e => e && e.status && e.status.type === 'finished' && e.homeScore && e.awayScore && typeof e.homeScore.current === 'number';
  async function ssMacBul(ev, dep, ts) {
    const [A, B] = await Promise.all([ssTakimBul(ev), ssTakimBul(dep)]);
    if (!A && !B) { const e = new Error('Sofascore\'da takımlar bulunamadı: ' + ev + ', ' + dep); e.takim = [ev, dep]; throw e; }
    const ana = A || B, digerTok = tokenlar(A ? dep : ev), diger = A ? B : A, ref = ts || simdiSn();
    for (const tur of ['next', 'last']) {
      let v;
      try { v = await ssAl('/team/' + ana.id + '/events/' + tur + '/0'); } catch (e) { continue; }
      const aday = (v.events || []).filter(e => {
        if (!e.homeTeam || !e.awayTeam || Math.abs(e.startTimestamp - ref) > (ts ? 6 * 3600 : 4 * 86400)) return false;
        const rakip = e.homeTeam.id === ana.id ? e.awayTeam : e.homeTeam;
        if (diger && rakip.id === diger.id) return true;
        return benzerlik(digerTok, tokenlar(rakip.name + ' ' + String(rakip.slug || '').replace(/-/g, ' '))) > 0;
      });
      if (aday.length) {
        aday.sort((x, y) => Math.abs(x.startTimestamp - ref) - Math.abs(y.startTimestamp - ref));
        const e = aday[0];
        const anaEvde = e.homeTeam.id === ana.id;
        const evId = A ? ana.id : (anaEvde ? e.awayTeam.id : e.homeTeam.id);
        const evSahada = e.homeTeam.id === evId;
        const ut = e.tournament && e.tournament.uniqueTournament;
        const lig = turnuvaAdi(e);
        return {
          id: e.id, ts: e.startTimestamp, durum: e.status && e.status.type, lig, ligTur: ligTuru(lig), ut: ut ? ut.id : null, sez: e.season ? e.season.id : null, evSahada,
          evId, depId: evSahada ? e.awayTeam.id : e.homeTeam.id,
          evSsAd: evSahada ? e.homeTeam.name : e.awayTeam.name, depSsAd: evSahada ? e.awayTeam.name : e.homeTeam.name
        };
      }
    }
    const e = new Error('Sofascore\'da maç bulunamadı: ' + ev + ' - ' + dep);
    e.takim = [ev, dep];
    throw e;
  }
  // Sofascore oyuncu istatistiği (alan adları ligden lige değişebildiği için birkaç ad deneniyor)
  function istatOku(st) {
    st = st || {};
    const g = (...k) => { for (const x of k) if (st[x] != null && st[x] !== '' && !isNaN(+st[x])) return +st[x]; return null; };
    let sec = g('secondsPlayed');
    if (sec == null) { const m = g('minutesPlayed', 'minutes'); sec = m != null ? m * 60 : 0; }
    let reb = g('rebounds', 'totalRebounds');
    if (reb == null) { const o = g('offensiveRebounds'), d = g('defensiveRebounds'); if (o != null || d != null) reb = (o || 0) + (d || 0); }
    const tpm = g('threePointsMade', 'threePointersMade', 'threePointFieldGoalsMade', 'threePointsScored');
    const tpa = g('threePointAttempts', 'threePointsAttempted', 'threePointersAttempted', 'threePointFieldGoalsAttempted');
    const ftm = g('freeThrowsMade', 'freeThrowsScored');
    const fta = g('freeThrowAttempts', 'freeThrowsAttempted');
    let pts = g('points');
    if (pts == null) { const t2 = g('twoPointsMade', 'twoPointersMade'); if (t2 != null || tpm != null || ftm != null) pts = 2 * (t2 || 0) + 3 * (tpm || 0) + (ftm || 0); }
    return { sec: sec || 0, pts: pts || 0, reb: reb || 0, ast: g('assists') || 0, tpm: tpm || 0, tpa, ftm: ftm || 0, fta, tov: g('turnovers') || 0 };
  }
  function kadroSatirlari(taraf) {
    return ((taraf && taraf.players) || []).map(x => {
      const p = x.player || {};
      const s = istatOku(x.statistics);
      const ilk = x.substitute === false ? 1 : x.substitute === true ? 0 : -1;
      return [p.id, p.name || p.shortName || '', String(x.position || p.position || ''), Math.round(s.sec), ilk, s.pts, s.reb, s.ast, s.tpm, s.tpa == null ? -1 : s.tpa, s.ftm, s.fta == null ? -1 : s.fta, s.tov];
    }).filter(r => r[0] != null);
  }
  const satirAc = r => ({ id: String(r[0]), ad: r[1], poz: r[2], dk: r[3] / 60, ilk: r[4], pts: r[5], reb: r[6], ast: r[7], tpm: r[8], tpa: r[9], ftm: r[10], fta: r[11], tov: r[12] });

  // ---------- Maç arşivi (biten maçlar bir kez indirilir, telefonda saklanır) ----------
  let ARS = null, arsivKirli = false;
  const arsiv = () => { if (!ARS) ARS = GM_getValue('bo_arsiv', {}); return ARS; };
  function arsivKaydet() {
    if (!arsivKirli) return;
    const A = Object.assign(GM_getValue('bo_arsiv', {}), arsiv());
    ARS = A;
    const k = Object.keys(A);
    if (k.length > ARSIV_MAX) k.sort((a, b) => A[a].t - A[b].t).slice(0, k.length - ARSIV_MAX).forEach(x => delete A[x]);
    GM_setValue('bo_arsiv', A);
    arsivKirli = false;
  }
  async function maciArsivle(e) {
    const A = arsiv();
    if (A[e.id]) return true;
    let lu;
    try { lu = await ssAl('/event/' + e.id + '/lineups'); } catch (err) { return false; }
    const H = kadroSatirlari(lu.home), Aw = kadroSatirlari(lu.away);
    if (H.length < 5 && Aw.length < 5) return false;
    const ut = e.tournament && e.tournament.uniqueTournament;
    A[e.id] = {
      t: e.startTimestamp, h: e.homeTeam.id, a: e.awayTeam.id, hn: e.homeTeam.name || '', an: e.awayTeam.name || '',
      l: turnuvaAdi(e), ut: ut ? ut.id : null, s: e.season ? e.season.id : null, hs: e.homeScore.current, as: e.awayScore.current, H, A: Aw
    };
    arsivKirli = true;
    return true;
  }
  async function takimArsivi(tid) {
    return onbellekli('ta|' + tid, async () => {
      let ev = [];
      for (const s of [0, 1]) {
        try { const v = await ssAl('/team/' + tid + '/events/last/' + s); ev = ev.concat(v.events || []); } catch (e) { break; }
        if (ev.filter(bittiMi).length >= ARSIV_MAC + 5) break;
      }
      const bitmis = ev.filter(e => bittiMi(e) && simdiSn() - e.startTimestamp < ARSIV_GUN * 86400 && !DOSTLUK.test(norm(turnuvaAdi(e))))
        .sort((a, b) => b.startTimestamp - a.startTimestamp).slice(0, ARSIV_MAC);
      // 1.0'dan kalan maçlarda lig ve takım adı yok: eldeki maç listesinden doldur
      ev.forEach(e => {
        const g = arsiv()[e.id];
        if (!g || g.l || !e.homeTeam || !e.awayTeam) return;
        const ut = e.tournament && e.tournament.uniqueTournament;
        g.l = turnuvaAdi(e); g.ut = ut ? ut.id : null; g.s = e.season ? e.season.id : null;
        g.hn = e.homeTeam.name || ''; g.an = e.awayTeam.name || '';
        arsivKirli = true;
      });
      await Promise.all(bitmis.filter(e => !arsiv()[e.id]).map(e => maciArsivle(e)));
      return { son: bitmis.length ? bitmis[0].startTimestamp : 0, sayi: bitmis.length };
    });
  }
  const topla = x => { const t = { dk: 0 }; STATS.forEach(s => { t[s] = 0; }); x.forEach(r => { t.dk += r.dk; STATS.forEach(s => { t[s] += r[s]; }); }); return t; };
  const regDakika = maclar => {
    const d = maclar.map(m => m.top.dk).filter(x => x > 150).sort((a, b) => a - b);
    return d.length && d[Math.floor(d.length / 2)] > 222 ? 240 : 200;
  };
  // Takımın arşivdeki maçları (yeniden eskiye). Dakika toplamı tutmayan (eksik/bozuk) maçlar atılır.
  function takimMaclari(tid, enFazla) {
    const A = arsiv(), out = [];
    Object.keys(A).forEach(eid => {
      const g = A[eid];
      if (simdiSn() - g.t > ARSIV_GUN * 86400) return;
      let ben, rak, evde;
      if (String(g.h) === String(tid)) { ben = g.H; rak = g.A; evde = true; }
      else if (String(g.a) === String(tid)) { ben = g.A; rak = g.H; evde = false; }
      else return;
      if (!ben || ben.length < 5) return;
      const B = ben.map(satirAc), R = (rak || []).map(satirAc);
      out.push({
        eid, ts: g.t, evde, B, R, top: topla(B), rtop: topla(R), skor: evde ? [g.hs, g.as] : [g.as, g.hs],
        ut: g.ut || null, l: g.l || '', ad: (evde ? g.hn : g.an) || '', rakipAd: (evde ? g.an : g.hn) || '', rakipId: evde ? g.a : g.h
      });
    });
    out.sort((a, b) => b.ts - a.ts);
    const reg = regDakika(out);
    let atilan = 0;
    const temiz = out.filter(m => {
      const ok = m.top.dk >= reg * 0.88 && m.top.dk <= reg * 1.45 && m.B.filter(r => r.dk > 0).length >= 7;
      if (!ok) atilan++;
      m.rOk = m.rtop.dk >= reg * 0.88 && m.rtop.dk <= reg * 1.45;   // rakibin kutusu tam mı
      return ok;
    }).slice(0, enFazla || MODEL_MAC);
    temiz.atilan = atilan;
    temiz.reg = reg;
    return temiz;
  }
  // Bugünkü maçın kadrosu (varsa): oyuncular, ilk 5, sakat/cezalı listesi
  async function bugunKadro(eid) {
    return onbellekli('bk|' + eid, async () => {
      try {
        const lu = await ssAl('/event/' + eid + '/lineups');
        const oku = t => {
          const pl = (t && t.players) || [];
          const ilk = pl.filter(x => x.substitute === false).map(x => String((x.player || {}).id));
          return {
            oyuncular: pl.map(x => String((x.player || {}).id)).filter(x => x !== 'undefined'),
            ilk: ilk.length === 5 ? ilk : [],
            eksik: ((t && t.missingPlayers) || []).map(x => ({ id: String((x.player || {}).id), ad: (x.player || {}).name || '', tur: String(x.type || ''), neden: typeof x.description === 'string' ? x.description : '' }))
          };
        };
        return { var: true, kesin: lu.confirmed === true, home: oku(lu.home), away: oku(lu.away) };
      } catch (e) { return { var: false }; }
    });
  }
  // Takımın güncel oyuncu listesi (takımdan ayrılanları ayırmak için)
  async function ssTakimKadrosu(tid) {
    return onbellekli('tk|' + tid, async () => {
      try {
        const v = await ssAl('/team/' + tid + '/players');
        const ids = new Set(((v && v.players) || []).map(x => String(((x && x.player) || x || {}).id)).filter(x => x && x !== 'undefined'));
        return ids.size >= 8 ? ids : null;
      } catch (e) { return null; }
    });
  }
  // Takıma yeni gelen oyuncunun önceki takımındaki son maçları
  async function oncekiTakimVerisi(pid, tid) {
    const ON = GM_getValue('bo_onceki', {});
    const anahtar = pid + '|' + tid;
    if (ON[anahtar] && Date.now() - ON[anahtar].z < 5 * 86400000) return ON[anahtar].v;
    const v = await ssAl('/player/' + pid + '/events/last/0');
    const evler = (v.events || []).filter(e => bittiMi(e) && e.homeTeam && e.awayTeam && String(e.homeTeam.id) !== String(tid) && String(e.awayTeam.id) !== String(tid) &&
      simdiSn() - e.startTimestamp < ARSIV_GUN * 86400 && !DOSTLUK.test(norm(turnuvaAdi(e))))
      .sort((a, b) => b.startTimestamp - a.startTimestamp).slice(0, 8);
    await Promise.all(evler.filter(e => !arsiv()[e.id]).map(e => maciArsivle(e)));
    const t = { dk: 0, n: 0, tpa: 0, fta: 0 };
    STATS.forEach(s => { t[s] = 0; });
    evler.forEach(e => {
      const g = arsiv()[e.id];
      if (!g) return;
      const r = (g.H || []).concat(g.A || []).find(x => String(x[0]) === String(pid));
      if (!r) return;
      const o = satirAc(r);
      if (!(o.dk > 0)) return;
      t.dk += o.dk; t.n++;
      STATS.forEach(s => { t[s] += o[s]; });
      if (o.tpa >= 0) t.tpa += o.tpa;
      if (o.fta >= 0) t.fta += o.fta;
    });
    ON[anahtar] = { z: Date.now(), v: t };
    const k = Object.keys(ON);
    if (k.length > 150) k.sort((a, b) => ON[a].z - ON[b].z).slice(0, k.length - 150).forEach(x => delete ON[x]);
    GM_setValue('bo_onceki', ON);
    return t;
  }

  // ---------- EuroLeague resmi verisi (ilk 5 + oyun akışı: kim ne zaman girdi/çıktı) ----------
  const elSezon = ts => { const d = new Date(ts * 1000), y = d.getUTCFullYear(); return 'E' + (d.getUTCMonth() >= 7 ? y : y - 1); };
  const elAd = s => { const p = String(s || '').split(','); return p.length === 2 ? (p[1].trim() + ' ' + p[0].trim()) : String(s || '').trim(); };
  const kulupAd = x => { if (!x) return ''; if (typeof x === 'string') return x; const c = x.club || x.team || x; return [c.name, c.editorialName, c.abbreviatedName, c.alias].filter(Boolean).join(' '); };
  const kodSayi = x => { if (x == null) return null; const m = String(x).match(/(\d+)\s*$/); return m ? Number(m[1]) : null; };
  function elOyunlar(sc) {
    return onbellekli('elo|' + sc, async () => {
      const k = 'bo_el_' + sc, onb = GM_getValue(k, null);
      if (onb && Date.now() - onb.z < 6 * 3600000 && onb.v.length) return onb.v;
      let son = null;
      for (const t of EL_V2) {
        try {
          const v = await elJson(t + '/competitions/E/seasons/' + sc + '/games');
          const dizi = Array.isArray(v) ? v : (v && (v.data || v.games || v.items)) || [];
          if (dizi[0] && typeof dizi[0] === 'object') C.__elOrnek = Object.keys(dizi[0]).slice(0, 25).join(', ');
          const out = dizi.map(g => ({
            kod: kodSayi(g.gameCode != null ? g.gameCode : g.code != null ? g.code : g.gamecode),
            ts: Math.floor(Date.parse(g.utcDate || g.date || g.startDate || g.gameDate || '') / 1000) || 0,
            ev: kulupAd(g.local || g.home || g.homeTeam), dep: kulupAd(g.road || g.away || g.awayTeam)
          })).filter(g => g.kod != null && g.ts && g.ev && g.dep);
          if (out.length) { GM_setValue(k, { z: Date.now(), v: out }); return out; }
          son = new Error('EuroLeague maç listesi boş geldi');
        } catch (e) { son = e; }
      }
      if (onb && onb.v.length) return onb.v;
      throw son || new Error('EuroLeague maç listesi alınamadı');
    });
  }
  const EL_ST = { '2FGM': { pts: 2 }, '3FGM': { pts: 3, tpm: 1 }, 'FTM': { pts: 1, ftm: 1 }, 'D': { reb: 1 }, 'O': { reb: 1 }, 'AS': { ast: 1 }, 'TO': { tov: 1 } };
  const EL_CEYREK = ['FirstQuarter', 'SecondQuarter', 'ThirdQuarter', 'ForthQuarter', 'FourthQuarter', 'ExtraTime'];
  // Oyun akışı → olay listesi { per, t (periyotta kalan saniye), tak, pid, tur: IN|OUT|st|x, st }
  function elOlaylar(pbp) {
    const out = [];
    let per = 0;
    EL_CEYREK.forEach(k => {
      const a = pbp && pbp[k];
      if (!Array.isArray(a) || !a.length) return;
      per++;
      let son = -1;
      a.forEach(e => {
        const m = String(e.MARKERTIME || '').trim().match(/^(\d+):(\d+)$/);
        const t = m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
        if (k === 'ExtraTime' && !isNaN(t) && son >= 0 && t > son + 30) per++;
        if (!isNaN(t)) son = t;
        const tur = String(e.PLAYTYPE || '').trim().toUpperCase(), pid = String(e.PLAYER_ID || '').trim(), tak = String(e.CODETEAM || '').trim();
        if (!tak) return;
        if ((tur === 'IN' || tur === 'OUT') && pid) out.push({ per, t, tak, pid, tur });
        else if (EL_ST[tur] && pid) out.push({ per, t, tak, pid, tur: 'st', st: EL_ST[tur] });
        else if (pid) out.push({ per, t, tak, pid, tur: 'x' });
      });
    });
    return out;
  }
  function elKutu(box) {
    const out = {};
    ((box && box.Stats) || []).forEach(t => (t.PlayersStats || []).forEach(p => {
      const kod = String(p.Team || '').trim();
      if (!kod) return;
      const tk = out[kod] || (out[kod] = { ad: t.Team || kod, oyuncular: [] });
      tk.oyuncular.push({ pid: String(p.Player_ID || '').trim(), ad: elAd(p.Player), ilk: Number(p.IsStarter) === 1 });
    }));
    return out;
  }

  // ---------- ESPN (NBA: sakatlık raporu, pozisyon etiketleri PG/SG/SF/PF/C, oyun akışı) ----------
  async function espnTakimlar() {
    const onb = GM_getValue('bo_espnTakim', null);
    if (onb && Date.now() - onb.z < 7 * 86400000 && onb.v.length) return onb.v;
    const v = await espnJson('/teams');
    const lig = ((v && v.sports && v.sports[0] && v.sports[0].leagues) || [])[0] || {};
    const liste = [];
    (lig.teams || []).forEach(x => { const t = (x && x.team) || x; if (t && t.id) liste.push({ id: String(t.id), ad: t.displayName || t.name || '', lakap: t.name || '', kisa: t.abbreviation || '' }); });
    if (liste.length) GM_setValue('bo_espnTakim', { z: Date.now(), v: liste });
    return liste;
  }
  // Takım adını ESPN takımıyla eşleştir (NBA'de takma adlar tek: Lakers, Clippers…)
  function espnTakimEs(ad, T) {
    const n = ' ' + norm(ad) + ' ';
    let en = null, p = 0;
    T.forEach(t => {
      let q = t.lakap && n.indexOf(' ' + norm(t.lakap) + ' ') >= 0 ? 5 : 0;
      q += takimBenzer(ad, t.ad);
      if (q > p) { p = q; en = t; }
    });
    return p >= 2 ? en : null;
  }
  const espnTarih = ts => { const d = new Date((ts - 5 * 3600) * 1000); return d.getUTCFullYear() + String(d.getUTCMonth() + 1).padStart(2, '0') + String(d.getUTCDate()).padStart(2, '0'); };
  function espnGun(gun) {
    return onbellekli('eg|' + gun, async () => {
      const v = await espnJson('/scoreboard?dates=' + gun);
      return (v.events || []).map(e => {
        const c = (e.competitions || [])[0] || {};
        const tamam = x => !!(x && x.type && x.type.completed);
        return {
          id: String(e.id), ts: Math.floor(Date.parse(e.date) / 1000) || 0, bitti: tamam(e.status) || tamam(c.status),
          takimlar: (c.competitors || []).map(x => ({ id: String((x.team || {}).id || x.id), ad: (x.team || {}).displayName || '', ev: x.homeAway === 'home' }))
        };
      });
    });
  }
  async function espnSakat() {
    if (C.__sakat && Date.now() - C.__sakat.z < 5 * 60000) return C.__sakat.v;
    const v = await espnJson('/injuries');
    const dz = x => typeof x === 'object' && x ? (x.name || x.type || x.description || '') : String(x || '');
    const liste = [];
    (v.injuries || []).forEach(t => (t.injuries || []).forEach(x => {
      const ad = (x.athlete && (x.athlete.displayName || x.athlete.fullName)) || '';
      if (ad) liste.push({ ad, takim: t.displayName || '', durum: dz(x.status) || dz(x.type), not: x.shortComment || (x.details && x.details.type) || '' });
    }));
    if (!liste.length) throw new Error('ESPN sakatlık listesi boş geldi');
    C.__sakat = { z: Date.now(), v: liste };
    return liste;
  }
  async function espnKadroPoz(id) {
    return onbellekli('ek|' + id, async () => {
      const v = await espnJson('/teams/' + id + '/roster');
      let a = v.athletes || [];
      if (a.length && a[0] && Array.isArray(a[0].items)) a = [].concat(...a.map(g => g.items || []));
      return a.map(x => ({ ad: x.displayName || x.fullName || '', poz: (x.position && (x.position.abbreviation || x.position.name)) || '' })).filter(x => x.ad);
    });
  }
  const saatSn = s => { s = String(s || '').trim(); let m = s.match(/^(\d+):(\d+)(?:\.\d+)?$/); if (m) return Number(m[1]) * 60 + Number(m[2]); m = s.match(/^(\d+(?:\.\d+)?)$/); return m ? Number(m[1]) : NaN; };
  function espnOlaylar(oz) {
    const sporcu = {}, ilk = {};
    (((oz && oz.boxscore) || {}).players || []).forEach(tp => {
      const tid = String((tp.team || {}).id || '');
      const st0 = (tp.statistics || [])[0] || {};
      (st0.athletes || []).forEach(a => {
        const at = a.athlete || {};
        if (!at.id) return;
        sporcu[String(at.id)] = { ad: at.displayName || at.shortName || '', tak: tid, poz: (at.position && at.position.abbreviation) || '' };
        if (a.starter) (ilk[tid] = ilk[tid] || []).push(String(at.id));
      });
    });
    const olaylar = [];
    const adBul = (ad, tak) => {
      const liste = Object.keys(sporcu).filter(id => !tak || sporcu[id].tak === tak).map(id => ({ id, ad: sporcu[id].ad }));
      const x = enIyiAday(ad, liste, y => y.ad, y => y.id);
      return x ? x.id : null;
    };
    ((oz && oz.plays) || []).forEach(p => {
      const per = Number(p.period && p.period.number) || 0;
      if (!per) return;
      const t = saatSn(p.clock && p.clock.displayValue);
      const tak = String((p.team || {}).id || '');
      const tur = String((p.type || {}).text || ''), metin = String(p.text || '');
      const kat = (p.participants || []).map(x => String((x.athlete || {}).id || '')).filter(Boolean);
      if (/substitution/i.test(tur)) {
        const m = metin.match(/^(.+?) enters the game for (.+?)\.?$/i);
        let giren = null, cikan = null;
        if (m) { giren = adBul(m[1], tak); cikan = adBul(m[2], tak); }
        if (!giren) giren = kat[0] || null;
        if (!cikan) cikan = kat[1] || null;
        const tk = tak || (giren && sporcu[giren] ? sporcu[giren].tak : '');
        if (cikan) olaylar.push({ per, t, tak: tk, pid: cikan, tur: 'OUT' });
        if (giren) olaylar.push({ per, t, tak: tk, pid: giren, tur: 'IN' });
        return;
      }
      const kim = kat[0] || '';
      const tk = (kim && sporcu[kim] ? sporcu[kim].tak : '') || tak;
      if (p.scoringPlay && Number(p.scoreValue) > 0 && kim) {
        const v = Number(p.scoreValue);
        olaylar.push({ per, t, tak: tk, pid: kim, tur: 'st', st: { pts: v, tpm: v === 3 ? 1 : 0, ftm: /free throw/i.test(tur + ' ' + metin) ? 1 : 0 } });
        if (kat[1] && /assist/i.test(metin)) olaylar.push({ per, t, tak: tk, pid: kat[1], tur: 'st', st: { ast: 1 } });
        return;
      }
      if (/rebound/i.test(tur) && kim) { olaylar.push({ per, t, tak: tk, pid: kim, tur: 'st', st: { reb: 1 } }); return; }
      if (/turnover/i.test(tur) && kim) { olaylar.push({ per, t, tak: tk, pid: kim, tur: 'st', st: { tov: 1 } }); return; }
      if (kim) olaylar.push({ per, t, tak: tk, pid: kim, tur: 'x' });
    });
    return { olaylar, ilk, sporcu };
  }

  // ---------- Flashscore (deneysel, sadece Veri kontrolünde) ----------
  function feedCoz(metin) {
    return String(metin || '').split('¬~').map(kayit => {
      const o = {};
      kayit.split('¬').forEach(p => { const i = p.indexOf('÷'); if (i > 0) { const k = p.slice(0, i).replace(/^\s+/, ''); if (!(k in o)) o[k] = p.slice(i + 1); } });
      return o;
    }).filter(o => Object.keys(o).length);
  }

  // ---------- Pozisyon motoru ----------
  // Pozisyon etiketi → boy ölçeği (1 = oyun kurucu … 5 = pivot)
  const POZ_TABLO = {
    PG: 1, SG: 2, G: 1.6, GF: 2.6, FG: 2.8, SF: 3, F: 3.5, PF: 4, FC: 4.4, CF: 4.6, C: 5,
    GUARD: 1.6, POINTGUARD: 1, SHOOTINGGUARD: 2, SMALLFORWARD: 3, POWERFORWARD: 4, FORWARD: 3.5, CENTER: 5, CENTRE: 5,
    GUARDFORWARD: 2.6, FORWARDGUARD: 2.8, FORWARDCENTER: 4.4, CENTERFORWARD: 4.6
  };
  function pozSayi(p) { const k = String(p || '').toUpperCase().replace(/[^A-Z]/g, ''); return k && POZ_TABLO[k] != null ? POZ_TABLO[k] : null; }
  const grupBoyut = b => b < 2.6 ? 'G' : b < 4.2 ? 'F' : 'C';
  const grupEtiket = p => { const x = pozSayi(p); return x == null ? null : grupBoyut(x); };
  // Sahadaki oyuncuları boyuna göre 1–5 numaraya yerleştir (0 = 1 numara … 4 = 5 numara)
  function slotlar(ids, boyutF) {
    const a = ids.slice().sort((x, y) => (boyutF(x) - boyutF(y)) || (String(x) < String(y) ? -1 : 1));
    const n = a.length, s = {};
    a.forEach((id, i) => { s[id] = n <= 1 ? 2 : Math.round(i * 4 / (n - 1)); });
    return s;
  }
  // Oyun akışından: her oyuncunun hangi numarada kaç dakika oynadığı ve o numarada ne ürettiği
  function sahaAnalizi(olaylar, basla, boyutF, perUzun) {
    const S = {};
    const kay = pid => S[pid] || (S[pid] = { dk: bosDizi(), pts: bosDizi(), reb: bosDizi(), ast: bosDizi(), tpm: bosDizi(), ftm: bosDizi(), tov: bosDizi() });
    const tak = Object.keys(basla), saha = {}, slot = {};
    tak.forEach(t => { saha[t] = new Set(); });
    const yenile = t => { Object.assign(slot, slotlar([...saha[t]], boyutF)); };
    const perler = [...new Set(olaylar.map(o => o.per))].sort((a, b) => a - b);
    let toplamSn = 0, hataSay = 0;
    perler.forEach((per, pi) => {
      const ev = olaylar.filter(o => o.per === per);
      tak.forEach(t => {
        const ilkTur = {};
        ev.forEach(o => { if (o.tak === t && o.pid && !(o.pid in ilkTur)) ilkTur[o.pid] = o.tur; });
        let set;
        if (pi === 0 && basla[t] && basla[t].length === 5) set = new Set(basla[t]);
        else {
          set = new Set(Object.keys(ilkTur).filter(pid => ilkTur[pid] !== 'IN'));
          [...saha[t]].forEach(pid => { if (set.size < 5 && !(pid in ilkTur)) set.add(pid); });
          if (pi === 0 && set.size < 5 && basla[t]) basla[t].forEach(pid => { if (set.size < 5) set.add(pid); });
        }
        saha[t] = set;
        yenile(t);
      });
      const bas = per <= 4 ? perUzun : 300;
      let kalan = bas;
      const kredi = sn => { if (!(sn > 0)) return; tak.forEach(t => saha[t].forEach(pid => { kay(pid).dk[slot[pid] != null ? slot[pid] : 2] += sn / 60; })); };
      ev.forEach(o => {
        if (!isNaN(o.t) && o.t <= kalan) { kredi(kalan - o.t); kalan = o.t; }
        if (!o.pid || !saha[o.tak]) return;
        const S2 = saha[o.tak];
        if (o.tur === 'IN') { S2.add(o.pid); yenile(o.tak); }
        else if (o.tur === 'OUT') { S2.delete(o.pid); yenile(o.tak); }
        else {
          if (!S2.has(o.pid)) { hataSay++; if (S2.size < 5) { S2.add(o.pid); yenile(o.tak); } else return; }
          if (o.st) { const k = kay(o.pid), sl = slot[o.pid] != null ? slot[o.pid] : 2; Object.keys(o.st).forEach(s => { if (k[s]) k[s][sl] += o.st[s]; }); }
        }
      });
      kredi(kalan);
      toplamSn += bas;
    });
    return { S, toplamSn, hataSay };
  }
  // Normal numarayı yaz: tam sayıya yakınsa "4 numara (uzun forvet)", değilse "3–4 numara arası"
  const slotYazi = x => { const r = Math.round(x); if (Math.abs(x - r) <= 0.25) return SLOT_AD[r]; return (Math.floor(x) + 1) + '–' + (Math.ceil(x) + 1) + ' numara arası'; };
  const pozDizi = x => x.dk.map(v => Math.round(v * 10) / 10).concat(...STATS.map(s => x[s]));
  const pozAc = a => { const o = { dk: a.slice(0, 5) }; STATS.forEach((s, j) => { o[s] = a.slice(5 + j * 5, 10 + j * 5); }); return o; };
  const bosProfil = () => { const o = { dk: bosDizi() }; STATS.forEach(s => { o[s] = bosDizi(); }); return o; };
  // Oyuncunun boy ölçeği ve rolü: pozisyon etiketi + ribaund/asist/üçlük profili
  function boyutHesapla(O, etiket) {
    const liste = Object.values(O).filter(o => o.oyn.length >= 3 && o.t.dk > 0);
    const td = toplam(liste.map(o => o.t.dk)) || 1;
    const ort = s => toplam(liste.map(o => o.t[s])) / td;
    const tR = ort('reb') || 0.15, tA = ort('ast') || 0.08, tU = ort('tpm') || 0.04;
    Object.values(O).forEach(o => {
      const d = o.t.dk;
      const rel = (s, b) => d > 0 ? (o.t[s] / d) / b : 1;
      const rR = rel('reb', tR), rA = rel('ast', tA), rU = rel('tpm', tU);
      let taban = pozSayi(etiket && etiket[o.id]);
      if (taban == null) taban = pozSayi(o.poz);
      if (taban == null) taban = 3;
      const w = Math.min(1, d / 150);
      o.boyut = sinirla(taban + w * (0.9 * sinirla(rR - 1, -0.6, 0.8) - 0.5 * sinirla(rA - 1, -0.6, 1.2)), 0.5, 5.8);
      o.rebRel = rR; o.astRel = rA; o.ucRel = rU;
      o.etiket = (etiket && etiket[o.id]) || o.poz || '';
      const b = o.boyut;
      o.rol = b < 1.9 ? (rA >= 1.2 ? 'oyun kurucu' : 'guard') : b < 2.7 ? (rU >= 1.2 ? 'şutör guard' : 'guard') : b < 3.6 ? (rU >= 1.3 ? 'şutör kanat' : 'kanat') :
        b < 4.4 ? (rU >= 1.0 ? 'stretch forvet' : 'uzun forvet') : (rU >= 0.8 ? 'stretch pivot' : 'pivot');
    });
  }
  // Pozisyon kayıtları: bo_poz["maçId|takımId"] = { t, k: EL|ESPN|yok|hata, o: { sofascoreOyuncuId: [35 sayı] } }
  let POZ = null, pozKirli = false;
  // 1.1'in adı olmayan maçlar için yazdığı "bulunamadı/hatalı" kayıtlar tekrar denensin
  const eskiPozTemizle = P => { Object.keys(P).forEach(k => { const x = P[k]; if (x && (x.k === 'yok' || x.k === 'hata') && !x.v) { delete P[k]; pozKirli = true; } }); return P; };
  const pozTablo = () => { if (!POZ) POZ = eskiPozTemizle(GM_getValue('bo_poz', {})); return POZ; };
  function pozKaydet() {
    if (!pozKirli) return;
    const P = Object.assign(eskiPozTemizle(GM_getValue('bo_poz', {})), pozTablo());
    POZ = P;
    const k = Object.keys(P);
    if (k.length > POZ_MAX) k.sort((a, b) => (P[a].t || 0) - (P[b].t || 0)).slice(0, k.length - POZ_MAX).forEach(x => delete P[x]);
    GM_setValue('bo_poz', P);
    pozKirli = false;
  }
  // Oyuncunun numara profili: oyun akışı varsa gerçek dakikalar, yoksa ilk 5'teki yerinden yaklaşık
  function pozProfil(maclar, O, tid, w) {
    const P = pozTablo(), prof = {}, kaynak = { pbp: 0, ilk5: 0 };
    const ekle = (pid, a, ww) => {
      const t = prof[pid] || (prof[pid] = bosProfil());
      for (let i = 0; i < 5; i++) { t.dk[i] += ww * a.dk[i]; STATS.forEach(s => { t[s][i] += ww * a[s][i]; }); }
    };
    maclar.slice(0, MODEL_MAC).forEach((m, i) => {
      const ww = w(i);
      const x = P[m.eid + '|' + tid];
      if (x && x.o && (x.k === 'EL' || x.k === 'ESPN')) {
        kaynak.pbp++;
        Object.keys(x.o).forEach(pid => ekle(pid, pozAc(x.o[pid]), ww));
        return;
      }
      const ilkler = m.B.filter(r => r.ilk === 1 && r.dk > 0);
      if (ilkler.length !== 5) return;
      kaynak.ilk5++;
      const sl = slotlar(ilkler.map(r => r.id), id => O[id] ? O[id].boyut : 3);
      ilkler.forEach(r => {
        const a = bosProfil(), k = sl[r.id];
        a.dk[k] = r.dk;
        STATS.forEach(s => { a[s][k] = r[s]; });
        ekle(r.id, a, ww * 0.6);
      });
    });
    return { prof, kaynak };
  }
  const profilNormal = pr => { if (!pr) return null; const t = toplam(pr.dk); return t >= 20 ? toplam(pr.dk.map((v, i) => v * i)) / t : null; };
  // Bütün pozisyon kayıtlarından genel numara etkisi (oyuncu etkisi ayrıldıktan sonra, ön bilgiyle karışık)
  function genelSlotEtki() {
    if (C.__G) return C.__G;
    const P = pozTablo(), oy = {};
    Object.keys(P).forEach(k => {
      const x = P[k];
      if (!x || !x.o) return;
      Object.keys(x.o).forEach(pid => {
        const a = pozAc(x.o[pid]);
        const t = oy[pid] || (oy[pid] = bosProfil());
        for (let i = 0; i < 5; i++) { t.dk[i] += a.dk[i]; STATS.forEach(s => { t[s][i] += a[s][i]; }); }
      });
    });
    const liste = Object.values(oy).filter(t => toplam(t.dk) >= 60);
    const G = { n: liste.length, dk: toplam(liste.map(t => toplam(t.dk))) };
    STATS.forEach(s => {
      let b = SLOT_ON[s].map(Math.log);
      const tdk = G.dk, tst = toplam(liste.map(t => toplam(t[s])));
      const rbar = tdk > 0 && tst > 0 ? tst / tdk : 0.1;
      for (let it = 0; it < 8 && liste.length; it++) {
        const a = liste.map(t => { let st = 0, ex = 0; for (let i = 0; i < 5; i++) { st += t[s][i]; ex += t.dk[i] * Math.exp(b[i]); } return Math.log((st + rbar * 10) / (ex + 10)); });
        b = b.map((_, i) => {
          let S = 0, E = 0;
          liste.forEach((t, j) => { S += t[s][i]; E += t.dk[i] * Math.exp(a[j]); });
          return Math.log((S + 300 * rbar * SLOT_ON[s][i]) / (E + 300 * rbar));
        });
      }
      G[s] = b.map(Math.exp);
    });
    C.__G = G;
    return G;
  }
  // Oyuncu bugün farklı numarada oynarsa dakika başı üretimi nasıl değişir
  function slotEtkisi(pr, bs, G) {
    if (!pr || bs == null) return null;
    const top = toplam(pr.dk);
    if (top < 20) return null;
    const u = pr.dk.map(v => v / top);
    const normal = toplam(u.map((v, i) => v * i));
    const dkB = pr.dk[bs];
    const sonuc = { normal, bugun: bs, dkB, top, guc: dkB >= 120 ? 'güçlü' : dkB >= 40 ? 'orta' : dkB > 0 ? 'zayıf' : 'genel etki', f: null };
    if (Math.abs(bs - normal) < 0.75) return sonuc;
    sonuc.f = {};
    STATS.forEach(s => {
      const rAll = toplam(pr[s]) / top;
      if (!(rAll > 0)) { sonuc.f[s] = 1; return; }
      const Gu = toplam(u.map((v, i) => v * G[s][i]));
      const genel = rAll * G[s][bs] / Math.max(0.05, Gu);
      const kendi = dkB > 0 ? pr[s][bs] / dkB : genel;
      const est = (dkB * kendi + 60 * genel) / (dkB + 60);
      sonuc.f[s] = sinirla(est / rAll, 0.6, 1.6);
    });
    return sonuc;
  }
  // Geçmiş maçların oyun akışını indir (EuroLeague resmi API / NBA için ESPN) ve numara dakikalarını kaydet
  const pozHatalar = [];
  async function pozIndir(tid, maclar, O, ligTur) {
    const P = pozTablo();
    const uygun = m => !m.l || ligTuru(m.l) === ligTur;
    const hedef = maclar.filter(m => uygun(m) && m.ad && m.rakipAd).slice(0, POZ_MAC).filter(m => !P[m.eid + '|' + tid]).slice(0, POZ_YENI[ligTur] || 4);
    for (const m of hedef) {
      const anahtar = m.eid + '|' + tid;
      const yaz = (k, neden) => { P[anahtar] = { t: m.ts, k, neden, v: 2 }; pozKirli = true; };
      try {
        let olaylar, harita = {}, perUzun, kaynak, yedekEtiket = () => null;
        const basla = {};
        let bizKod;
        if (ligTur === 'EL') {
          const liste = await elOyunlar(elSezon(m.ts)).catch(er => { const x = new Error('EuroLeague maç listesi alınamadı (' + er.message + ')'); x.gecici = true; throw x; });
          const g = liste.filter(x => Math.abs(x.ts - m.ts) < 36 * 3600)
            .map(x => ({ x, p: Math.max(takimBenzer(m.ad, x.ev) + takimBenzer(m.rakipAd, x.dep), takimBenzer(m.ad, x.dep) + takimBenzer(m.rakipAd, x.ev)) }))
            .filter(y => y.p >= 2).sort((a, b) => b.p - a.p)[0];
          if (!g) { yaz('yok', 'EuroLeague listesinde yok'); continue; }
          const sc = elSezon(m.ts);
          const [box, pbp] = await Promise.all([
            elJson(EL_LIVE + '/Boxscore?gamecode=' + g.x.kod + '&seasoncode=' + sc),
            elJson(EL_LIVE + '/PlayByPlay?gamecode=' + g.x.kod + '&seasoncode=' + sc)
          ]);
          const kutu = elKutu(box);
          let enIyi = null, enP = 0;
          Object.keys(kutu).forEach(kod => {
            let say = 0;
            const es = {};
            kutu[kod].oyuncular.forEach(p => { const r = enIyiAday(p.ad, m.B, y => y.ad, y => y.id); if (r) { say++; es[p.pid] = r.id; } });
            if (say > enP) { enP = say; enIyi = { kod, es }; }
          });
          if (!enIyi || enP < 5) { yaz('yok', 'oyuncular eşleşmedi'); continue; }
          bizKod = enIyi.kod; harita = enIyi.es;
          basla[bizKod] = kutu[bizKod].oyuncular.filter(p => p.ilk).map(p => p.pid);
          olaylar = elOlaylar(pbp).filter(o => o.tak === bizKod);
          perUzun = 600; kaynak = 'EL';
        } else {
          const T = await espnTakimlar().catch(er => { const x = new Error('ESPN takım listesi alınamadı (' + er.message + ')'); x.gecici = true; throw x; });
          const biz = espnTakimEs(m.ad, T), rak = espnTakimEs(m.rakipAd, T);
          if (!biz) { yaz('yok', 'ESPN takımı bulunamadı'); continue; }
          let e = null, gunHata = null;
          for (const gun of [espnTarih(m.ts), espnTarih(m.ts - 86400), espnTarih(m.ts + 86400)]) {
            let liste = [];
            try { liste = await espnGun(gun); } catch (er) { gunHata = er; continue; }
            e = liste.find(x => x.takimlar.some(t => t.id === biz.id) && (!rak || x.takimlar.some(t => t.id === rak.id)) && Math.abs(x.ts - m.ts) < 36 * 3600);
            if (e) break;
          }
          if (!e && gunHata) { const x = new Error('ESPN maç listesi alınamadı (' + gunHata.message + ')'); x.gecici = true; throw x; }
          if (!e) { yaz('yok', 'ESPN\'de maç bulunamadı'); continue; }
          const oz = await espnJson('/summary?event=' + e.id, 45000);
          const r = espnOlaylar(oz);
          bizKod = biz.id;
          Object.keys(r.sporcu).filter(id => r.sporcu[id].tak === bizKod).forEach(id => { const x = enIyiAday(r.sporcu[id].ad, m.B, y => y.ad, y => y.id); if (x) harita[id] = x.id; });
          if (Object.keys(harita).length < 5) { yaz('yok', 'oyuncular eşleşmedi'); continue; }
          basla[bizKod] = r.ilk[bizKod] || [];
          olaylar = r.olaylar.filter(o => o.tak === bizKod);
          perUzun = 720; kaynak = 'ESPN';
          yedekEtiket = pid => r.sporcu[pid] && r.sporcu[pid].poz;
        }
        const bF = pid => { const sid = harita[pid]; if (sid && O[sid]) return O[sid].boyut; const p = pozSayi(yedekEtiket(pid)); return p != null ? p : 3; };
        const sonuc = sahaAnalizi(olaylar, basla, bF, perUzun);
        const takimDk = toplam(Object.values(sonuc.S).map(x => toplam(x.dk)));
        const bek = 5 * sonuc.toplamSn / 60;
        const degisim = olaylar.filter(o => o.tur === 'IN' || o.tur === 'OUT').length;
        if (!(takimDk > bek * 0.85 && takimDk < bek * 1.15) || degisim < 10) { yaz('hata', 'dakikalar tutmadı (' + Math.round(takimDk) + '/' + Math.round(bek) + ', değişiklik ' + degisim + ')'); continue; }
        const o = {};
        Object.keys(sonuc.S).forEach(pid => { const sid = harita[pid]; if (sid) o[sid] = pozDizi(sonuc.S[pid]); });
        P[anahtar] = { t: m.ts, k: kaynak, o };
        pozKirli = true;
      } catch (e) {
        if (pozHatalar.length < 10) pozHatalar.push((ligTur === 'EL' ? 'EuroLeague' : 'ESPN') + ': ' + e.message);
        // Bu maça özel kalıcı hata (bulunamadı, bozuk veri): kaydet, sonraki maça geç. Geçici hata (bağlantı, sınır, sunucu): dur, sonra tekrar dene.
        if (!e.gecici && ((e.kod >= 400 && e.kod < 500 && e.kod !== 429) || /okunamadı/.test(e.message))) { yaz('hata', e.message); continue; }
        break;
      }
    }
  }
  // Rakip savunması: hangi mevkiye (guard/forvet/pivot) normalden çok ya da az veriyor
  function savunmaTabani(ligTur) {
    const k = '__ST' + ligTur;
    if (C[k]) return C[k];
    const A = arsiv(), T = {};
    Object.keys(A).forEach(eid => {
      const g = A[eid];
      if (!g.l || ligTuru(g.l) !== ligTur) return;
      [g.H, g.A].forEach(liste => (liste || []).forEach(r => {
        const o = satirAc(r);
        if (!(o.dk > 0)) return;
        const gr = grupEtiket(o.poz);
        if (!gr) return;
        const t = T[gr] || (T[gr] = { dk: 0, pts: 0, reb: 0, ast: 0, tpm: 0, ftm: 0, tov: 0 });
        t.dk += o.dk;
        STATS.forEach(s => { t[s] += o[s]; });
      }));
    });
    C[k] = T;
    return T;
  }
  function rakipSavunma(maclarR, ligTur) {
    const taban = savunmaTabani(ligTur), sonuc = {}, T = {};
    maclarR.filter(m => m.rOk && m.l && ligTuru(m.l) === ligTur).slice(0, 15).forEach(m => (m.R || []).forEach(r => {
      if (!(r.dk > 0)) return;
      const gr = grupEtiket(r.poz);
      if (!gr) return;
      const t = T[gr] || (T[gr] = { dk: 0, pts: 0, reb: 0, ast: 0, tpm: 0, ftm: 0, tov: 0 });
      t.dk += r.dk;
      STATS.forEach(s => { t[s] += r[s]; });
    }));
    Object.keys(T).forEach(gr => {
      const t = T[gr], b = taban[gr];
      if (!b || b.dk < 2 * t.dk || t.dk < 150) return;
      const w = t.dk / (t.dk + 1200);
      sonuc[gr] = { dk: t.dk };
      ['pts', 'reb', 'ast', 'tpm'].forEach(s => {
        const v = t[s] / t.dk, bb = b[s] / b.dk;
        sonuc[gr][s] = bb > 0 ? sinirla(1 + w * (v / bb - 1), 0.75, 1.3) : 1;
      });
    });
    return sonuc;
  }
  // Rakipte bugün eksik olan önemli oyuncu: o yokken rakip takıma karşı oynayanlar ne üretmiş
  function rakipEksikEtkisi(maclarR, OR, DR) {
    const d = { pts: 0, reb: 0, ast: 0, tpm: 0 }, notlar = [];
    Object.keys(DR).forEach(id => {
      const dr = DR[id], X = OR[id];
      if (!X || dr.a !== 1 || dr.uzun || X.dk < 15) return;
      const G0 = [], G1 = [];
      maclarR.forEach((m, i) => { if (i > X.ilkIdx || !m.rOk) return; const r = X.s[i]; if (r && r.dk > 0) G1.push(m); else G0.push(m); });
      if (G0.length < 2 || G1.length < 3) return;
      const f = G0.length / (G0.length + G1.length);
      const k = G0.length / (G0.length + 4) * (1 - f);
      const fark = {};
      Object.keys(d).forEach(s => { fark[s] = (mean(G0.map(m => m.rtop[s])) - mean(G1.map(m => m.rtop[s]))) * k; d[s] += fark[s]; });
      if (Math.abs(fark.reb) >= 1.5 || Math.abs(fark.pts) >= 3) notlar.push(X.ad + ' yokken rakipleri ' + isaretliSayi(fark.pts, v0) + ' sayı, ' + isaretliSayi(fark.reb) + ' ribaund üretmiş (' + G0.length + ' maç, ağırlıklı)');
    });
    return { d, notlar };
  }

  // ---------- Takım modeli: ağırlık, oyuncu temeli, kim yok, ilk 5, dakika havuzu ----------
  // Maç ağırlığı: yeni maç > eski maç, bu sezon > geçen sezon, aynı turnuva (EuroLeague/NBA) > diğer
  function agirlikF(maclar, mac) {
    const ref = (mac && mac.ts) || simdiSn();
    const d = new Date(ref * 1000);
    const sezonBas = Date.UTC(d.getUTCMonth() >= 8 ? d.getUTCFullYear() : d.getUTCFullYear() - 1, 8, 1) / 1000;
    const ut = mac && mac.ut;
    const w = maclar.map((m, i) => Math.pow(0.9, i) * (ref - m.ts > 120 * 86400 ? 0.5 : 1) * (ut && m.ut === ut ? 1.4 : 1) * (m.ts < sezonBas ? 0.6 : 1));
    return i => w[i] || 0;
  }
  const sezonBasi = ts => { const d = new Date(ts * 1000); return Date.UTC(d.getUTCMonth() >= 8 ? d.getUTCFullYear() : d.getUTCFullYear() - 1, 8, 1) / 1000; };
  function oyuncuTemel(maclar, etiket, w) {
    const O = {};
    maclar.forEach((m, i) => m.B.forEach(r => {
      const o = O[r.id] || (O[r.id] = { id: r.id, ad: r.ad, pozSay: {}, ilkIdx: i, sonIdx: i, s: {} });
      o.ilkIdx = Math.max(o.ilkIdx, i); o.sonIdx = Math.min(o.sonIdx, i);
      if (r.poz) o.pozSay[r.poz] = (o.pozSay[r.poz] || 0) + 1;
      o.s[i] = r;
    }));
    Object.values(O).forEach(o => {
      o.poz = Object.keys(o.pozSay).sort((a, b) => o.pozSay[b] - o.pozSay[a])[0] || '';
      o.oyn = [];
      for (let i = 0; i <= o.ilkIdx; i++) if (o.s[i] && o.s[i].dk > 0) o.oyn.push(i);
      const son = o.oyn.slice(0, 12);
      let sw = 0, sdk = 0;
      son.forEach(i => { sw += w(i); sdk += w(i) * o.s[i].dk; });
      o.dk = sw ? sdk / sw : 0;
      o.sdDk = sw ? Math.sqrt(son.reduce((a, i) => a + w(i) * Math.pow(o.s[i].dk - o.dk, 2), 0) / sw) : 0;
      const t10 = []; for (let i = 0; i <= Math.min(o.ilkIdx, 9); i++) t10.push(i);
      o.pOyna = t10.length ? t10.filter(i => o.s[i] && o.s[i].dk > 0).length / t10.length : 0;
      const t = { dk: 0, tpa: 0, fta: 0, tpaVar: false, ftaVar: false, w: 0 };
      STATS.forEach(s => { t[s] = 0; });
      o.oyn.slice(0, 15).forEach(i => {
        const r = o.s[i], x = w(i);
        t.w += x; t.dk += x * r.dk;
        STATS.forEach(s => { t[s] += x * r[s]; });
        if (r.tpa >= 0) { t.tpa += x * r.tpa; t.tpaVar = true; }
        if (r.fta >= 0) { t.fta += x * r.fta; t.ftaVar = true; }
      });
      o.t = t;
      o.ort = {};
      STATS.forEach(s => { o.ort[s] = t.w ? t[s] / t.w : 0; });
      o.oran = {}; o.disp = {};
      STATS.forEach(s => {
        o.oran[s] = t.dk > 0 ? t[s] / t.dk : 0;
        let num = 0, den = 0;
        o.oyn.slice(0, 15).forEach(i => { const e = o.oran[s] * o.s[i].dk; num += Math.pow(o.s[i][s] - e, 2); den += e; });
        const d = den > 0 ? num / den : 1;
        o.disp[s] = sinirla(1 + 0.5 * (sinirla(d, 1, 3) - 1), 1, 2);
      });
      const ilkler = o.oyn.slice(0, 10).map(i => o.s[i].ilk).filter(x => x >= 0);
      o.ilkOran = ilkler.length ? mean(ilkler) : null;
      // İlk 5 / yedek ayrımı
      const son12 = o.oyn.slice(0, 12);
      o.ilkVar = son12.filter(i => o.s[i].ilk >= 0).length >= 3;
      const ilkG = son12.filter(i => o.s[i].ilk === 1), yedekG = son12.filter(i => o.s[i].ilk === 0);
      const wdk = G => { let a = 0, b = 0; G.forEach(i => { a += w(i) * o.s[i].dk; b += w(i); }); return b ? a / b : 0; };
      o.nIlk = ilkG.length; o.nYedek = yedekG.length;
      o.dkIlk = wdk(ilkG); o.dkYedek = wdk(yedekG);
      // Üst üste kaçırdığı son maç sayısı
      let k = 0;
      for (let i = 0; i < maclar.length; i++) { if (o.s[i] && o.s[i].dk > 0) break; k++; }
      o.kacirdi = k;
      // Sezon başı kadro değişikliği: takım bu sezon en az 2 maç oynadıysa ve oyuncu hiçbirinde yoksa ayrılmış say
      const sb = sezonBasi(simdiSn());
      const sezonMac = maclar.filter(m => m.ts >= sb).length;
      o.ayrildi = sezonMac >= 2 && !o.oyn.some(i => maclar[i].ts >= sb);
    });
    boyutHesapla(O, etiket);
    return O;
  }
  // Bugün kim yok? → { id: { a: 1 | 0 | '?', kaynak, kesin, uzun } }
  // Öncelik: kesin resmi kadro > ESPN sakatlık raporu > Sofascore eksik listesi > açıklanan kadro > Bilyoner işareti > son maçlar
  function durumHaritasi(O, kadro, kadroKesin, espnListe, bil, takimdakiler, ipucu) {
    const D = {};
    const ssEksikD = e => { const sup = /doubt|quest|belirsiz/i.test(e.tur); return { a: sup ? '?' : 1, kaynak: 'Sofascore: ' + (e.neden || (sup ? 'şüpheli' : 'eksik')), kesin: !sup }; };
    Object.values(O).forEach(o => {
      const listeVar = !!(kadro && kadro.oyuncular.length >= 8);
      const kucuk = o.dk < 6 || o.oyn.length < 2;
      if (kucuk && !(kadroKesin && listeVar)) return;
      let d = null;
      const ssEksik = kadro ? kadro.eksik.find(x => x.id === o.id) : null;
      const ssListede = listeVar && kadro.oyuncular.indexOf(o.id) >= 0;
      if (kadroKesin && listeVar) {
        if (ssEksik) d = ssEksikD(ssEksik);
        else if (ssListede) d = { a: 0, kaynak: 'resmi maç kadrosunda', kesin: true };
        else d = { a: 1, kaynak: 'resmi maç kadrosunda yok', kesin: true };
      }
      // Az oynayan oyuncu: sadece kesin kadroya göre (şüpheliyse oynamıyor say), listede gösterilmez
      if (kucuk) { if (d) { if (d.a === '?') d.a = 1; d.kucuk = true; D[o.id] = d; } return; }
      if (!d && takimdakiler && !takimdakiler.has(o.id) && !ssListede && o.kacirdi >= 1) d = { a: 1, kaynak: 'takımın güncel kadrosunda yok', kesin: true, uzun: true };
      if (!d && espnListe) {
        let es = espnListe.find(x => adEsit(x.ad, o.ad));
        if (!es && espnListe.takimli) { const ayni = espnListe.filter(x => norm(soyad(x.ad)) === norm(soyad(o.ad))); if (ayni.length === 1) es = ayni[0]; }
        if (es) {
          const dz = es.durum + (es.not ? ' (' + es.not + ')' : '');
          if (/out|suspen|inactive/i.test(es.durum)) d = { a: 1, kaynak: 'ESPN: ' + dz, kesin: true };
          else if (/doubt|quest|day|gtd|game.?time/i.test(es.durum)) d = { a: '?', kaynak: 'ESPN: ' + dz };
          else if (/prob|avail/i.test(es.durum)) d = { a: 0, kaynak: 'ESPN: ' + dz };
        }
      }
      if (!d && ssEksik) d = ssEksikD(ssEksik);
      if (!d && ssListede) d = { a: 0, kaynak: 'açıklanan maç kadrosunda' };
      if (!d && o.ayrildi) d = { a: 1, kaynak: 'bu sezon takımda hiç oynamadı (ayrılmış)', uzun: true };
      if (!d && bil && o.dk >= 22 && bil.ilk.has(o.id) && !bil.simdi.has(o.id)) d = { a: '?', kaynak: 'Bilyoner bu oyuncunun oranlarını kaldırdı' };
      // Sadece ipucu (modeli değiştirmez): önemli oyuncuya hiç oran açılmamış
      if (ipucu && bil && o.dk >= 26 && o.kacirdi === 0 && bil.simdi.size >= 4 && !bil.simdi.has(o.id) && !(d && d.a === 1)) ipucu.push(o.ad);
      if (!d) {
        const k = o.kacirdi;
        if (k > 6) d = { a: 1, kaynak: 'uzun süredir yok', uzun: true };
        else if (espnListe && k >= 1) d = { a: 0, kaynak: 'son ' + k + ' maçı kaçırdı ama ESPN sakat listesinde yok (dönüyor)' };
        else if (k >= 2) d = { a: 1, kaynak: 'son ' + k + ' maçta oynamadı' };
        else if (k === 1) d = { a: '?', kaynak: 'son maçta oynamadı' };
        else d = { a: 0, kaynak: '' };
      }
      D[o.id] = d;
    });
    return D;
  }
  // Bugünkü ilk 5: kesin kadroda varsa oradan, yoksa son maçlardaki ilk 5'ler + eksik ilk 5 oyuncusunun yerine kimin başladığı
  function ilk5Belirle(O, maclar, D, kadroIlk, belirsizA) {
    const aDeg = id => { const d = D[id]; if (!d) return 0; return d.a === '?' ? belirsizA : d.a; };
    if (kadroIlk && kadroIlk.length >= 5) {
      const ids = kadroIlk.filter(id => O[id]);
      if (ids.length === 5) return { ids, kesin: true };
    }
    const son = maclar.slice(0, 10);
    const ilkVar = son.some(m => m.B.filter(r => r.ilk === 1).length === 5);
    const basladi = r => ilkVar ? r.ilk === 1 : r.dk >= 24;
    const eksikIlk = Object.keys(D).filter(id => D[id].a === 1 && !D[id].uzun && O[id] && (O[id].ilkOran || 0) >= 0.5);
    const puan = {};
    son.forEach((m, i) => {
      const w = Math.pow(0.85, i);
      const yoklar = eksikIlk.filter(X => !(O[X].s[i] && O[X].s[i].dk > 0)).length;
      m.B.forEach(r => { if (basladi(r)) puan[r.id] = (puan[r.id] || 0) + w + 0.5 * w * yoklar; });
    });
    const sirali = Object.keys(puan).filter(id => O[id] && aDeg(id) !== 1).sort((a, b) => puan[b] - puan[a]);
    // Normalde kaç uzunla başlıyorlar: kanıt yokken bunun dışına çıkma
    const uzunMu = id => O[id].boyut >= 3.9;
    const bes = son.map(m => m.B.filter(r => r.ilk === 1 && O[r.id])).filter(a => a.length === 5).map(a => a.filter(r => uzunMu(r.id)).length);
    const ids = [];
    if (bes.length >= 3) {
      const nr = mean(bes), enCokUzun = Math.ceil(nr), enCokKisa = 5 - Math.floor(nr);
      sirali.forEach(id => { if (ids.length >= 5) return; const u = ids.filter(uzunMu).length, k = ids.length - u; if (uzunMu(id) ? u < enCokUzun : k < enCokKisa) ids.push(id); });
    }
    sirali.forEach(id => { if (ids.length < 5 && ids.indexOf(id) < 0) ids.push(id); });
    return { ids, kesin: false };
  }
  function takimProjeksiyon(a, belirsizA) {
    const { maclar, O, D, sen, ilk5, poz, savunma, b2b, w, onceki, G, dkDuz } = a;
    const reg = regDakika(maclar), maxDk = reg / 5 * 0.95;
    const aDeg = id => { const d = D[id]; if (!d) return 0; return d.a === '?' ? belirsizA : d.a; };
    const tumO = Object.values(O);
    const anahtar = tumO.filter(o => o.dk >= 10 && o.oyn.length >= 3 && !(D[o.id] && D[o.id].uzun)).sort((x, y) => y.dk - x.dk);
    const aktif = tumO.filter(o => aDeg(o.id) !== 1 && o.oyn.length >= 1 && (o.sonIdx <= 8 || (D[o.id] && D[o.id].a === 0 && D[o.id].kaynak)));
    const ilkSet = new Set(((ilk5 && ilk5.ids) || []).filter(id => O[id] && aDeg(id) !== 1));
    const P = {}, yedekDagit = [];
    const wSum = (idx, f) => { let s = 0, ww = 0; idx.forEach(i => { const x = w(i); s += x * f(i); ww += x; }); return ww ? s / ww : 0; };
    aktif.forEach(o => {
      // Bugün ilk 5 mi yedek mi? Normalinden farklıysa dakika tabanı değişir
      let taban = o.dk, durumDegisti = false;
      const bugunIlk = ilkSet.has(o.id);
      if (ilkSet.size === 5 && o.ilkVar && o.ilkOran != null) {
        if (bugunIlk && o.ilkOran < 0.5) { taban = o.nIlk >= 2 ? Math.max(o.dkIlk, o.dk) : Math.min(maxDk, o.dk + 7); durumDegisti = true; }
        else if (!bugunIlk && o.ilkOran >= 0.5) { taban = o.nYedek >= 2 ? Math.min(o.dkYedek, o.dk) : Math.max(4, o.dk - 7); durumDegisti = true; }
      }
      let adjDk = 0, rhoGuc = 0;
      const lnRho = {}; STATS.forEach(s => { lnRho[s] = 0; });
      const kanit = [];
      const sayilan = new Set();   // daha önce bir yokluk etkisinde kullanılan maçlar
      anahtar.forEach(X => {
        if (X.id === o.id) return;
        const G0 = [], G1 = [];
        o.oyn.forEach(i => { if (i > X.ilkIdx) return; const rx = X.s[i]; if (rx && rx.dk > 0) G1.push(i); else G0.push(i); });
        const av = aDeg(X.id);
        let w0 = 0, w1 = 0;
        G0.forEach(i => { w0 += w(i); }); G1.forEach(i => { w1 += w(i); });
        const f = w0 + w1 > 0 ? w0 / (w0 + w1) : 0;
        const fark = av - f;
        if (Math.abs(fark) < 0.05) return;
        if (G0.length >= 1 && G1.length >= 2) {
          // Aynı maçlarda başka bir eksik zaten sayıldıysa bu etkinin o kısmı tekrar sayılmaz
          const yeni = 1 - G0.filter(i => sayilan.has(i)).length / G0.length;
          G0.forEach(i => sayilan.add(i));
          if (yeni < 0.15) return;
          let dDk = wSum(G0, i => o.s[i].dk) - wSum(G1, i => o.s[i].dk);
          dDk *= G0.length / (G0.length + 2);
          adjDk += fark * dDk * yeni * (durumDegisti ? 0.5 : 1);
          const oran = (Gr, s) => { let v = 0, d = 0; Gr.forEach(i => { const x = w(i); v += x * o.s[i][s]; d += x * o.s[i].dk; }); return d > 0 ? v / d : 0; };
          const rho = {}, sh = G0.length / (G0.length + 8);
          STATS.forEach(s => {
            const r0 = oran(G0, s), r1 = oran(G1, s);
            const l = Math.log(sinirla((r0 + 0.01) / (r1 + 0.01), 0.67, 1.5)) * sh;
            rho[s] = Math.exp(l);
            lnRho[s] += fark * l * yeni;
          });
          if (Math.abs(fark) >= 0.5) rhoGuc = Math.max(rhoGuc, sh);
          const ilk = Gr => { const x = Gr.map(i => o.s[i].ilk).filter(v => v >= 0); return x.length ? mean(x) : null; };
          kanit.push({ X: X.id, ad: X.ad, a: av, f, n0: G0.length, n1: G1.length, dDk, rho, ilk0: ilk(G0), ilk1: ilk(G1), guc: G0.length >= 6 ? 'güçlü' : G0.length >= 3 ? 'orta' : 'zayıf' });
        } else if (av === 1 && G0.length === 0 && X.dk >= 12) {
          if (yedekDagit.indexOf(X) < 0) yedekDagit.push(X);
        }
      });
      // Sakatlıktan dönen: ilk maçlarda dakika sınırı olabilir
      let donus = null;
      const dd = D[o.id];
      if (o.kacirdi >= 3 && o.kacirdi <= 15 && (!dd || dd.a !== 1)) { taban *= 0.8; donus = o.kacirdi; }
      else if (o.kacirdi >= 1 && o.kacirdi <= 2 && (!dd || dd.a !== 1)) taban *= 0.93;
      const pO = dd && dd.a === 0 && dd.kesin && o.dk >= 12 ? Math.max(o.pOyna, 0.95) : o.pOyna;
      P[o.id] = { o, dk: Math.max(1, taban + adjDk), taban, adjDk, lnRho, kanit, durumDegisti, bugunIlk, donus, rhoGuc, pO };
    });
    // Dakika havuzu: takımın toplam dakikası sabittir (40 dk × 5 = 200; NBA 240). Boşalan dakika boyu yakın oyunculara daha çok gider.
    for (let tur = 0; tur < 3; tur++) {
      const S = Object.values(P).reduce((t, x) => t + x.pO * x.dk, 0);
      const R = reg - S;
      const agirlik = x => x.pO * x.dk * (R > 0 && yedekDagit.length ? 1 + Math.max(...yedekDagit.map(X => Math.exp(-Math.abs(x.o.boyut - X.boyut)))) : 1);
      const W = Object.values(P).reduce((t, x) => t + agirlik(x), 0);
      if (W <= 0) break;
      Object.values(P).forEach(x => { x.dk = sinirla(x.dk + R * agirlik(x) / W / Math.max(0.3, x.pO), 1, maxDk); });
    }
    // Maç kopma riski: büyük farkta yıldızlar son çeyrekte dinlenir
    const fark = Math.abs(sen.fark || 0);
    let kopma = 'düşük';
    if (fark > 8) {
      const oran = Math.min(0.10, 0.007 * (fark - 8));
      kopma = oran >= 0.06 ? 'yüksek' : 'orta';
      let kesilen = 0;
      Object.values(P).forEach(x => { if (x.dk >= 26) { const c = x.dk * oran; x.dk -= c; kesilen += c * x.pO; } });
      const alt = Object.values(P).filter(x => x.dk < 18);
      const W = alt.reduce((t, x) => t + x.dk * x.pO, 0);
      if (W > 0) alt.forEach(x => { x.dk = Math.min(maxDk, x.dk + kesilen * x.dk / W); });
    }
    if (b2b) Object.values(P).forEach(x => { if (x.dk >= 30) x.dk *= 0.97; });
    // Maç sonu karnesinden: geçmiş dakika tahminleri hep fazla/az çıktıysa düzelt
    Object.values(P).forEach(x => { x.ilkBelli = ilkSet.size === 5; x.dkHam = x.dk; });
    if (dkDuz && ilkSet.size === 5) Object.values(P).forEach(x => { const d = x.bugunIlk ? dkDuz.ilk : dkDuz.yedek; if (d) { x.dk = sinirla(x.dk + d, 1, maxDk); x.karneDuz = d; } });
    // Dakika başı üretim: mevki ortalamasına çekme (yeni gelen için önceki takımı), şans düzeltmesi, yokluk, pozisyon, rakip savunma
    const pozOran = {};
    tumO.forEach(o => {
      const g = grupBoyut(o.boyut);
      const t = pozOran[g] || (pozOran[g] = { dk: 0 });
      t.dk += o.t.dk; STATS.forEach(s => { t[s] = (t[s] || 0) + o.t[s]; });
    });
    const bugunSlot = ilkSet.size === 5 ? slotlar([...ilkSet], id => O[id].boyut) : {};
    Object.values(P).forEach(x => {
      const o = x.o, po = pozOran[grupBoyut(o.boyut)] || { dk: 0 };
      const on = onceki && onceki[o.id] && onceki[o.id].dk >= 40 ? onceki[o.id] : null;
      x.e = {}; x.not = [];
      STATS.forEach(s => {
        let onsel, K;
        if (on) { onsel = on[s] / on.dk; K = Math.min(150, on.dk); }
        else { onsel = po.dk > 0 ? po[s] / po.dk : o.oran[s]; K = 30; }
        x.e[s] = (o.t[s] + K * onsel) / (o.t.dk + K);
      });
      if (on) x.not.push('Takıma yeni: önceki takımındaki son ' + on.n + ' maçı (' + v0(on.dk) + ' dk) da hesaba katıldı');
      if (o.t.tpaVar && o.t.tpa >= 8) {
        const p3 = (o.t.tpm + 0.35 * 50) / (o.t.tpa + 50), ham = x.e.tpm, duz = (o.t.tpa / Math.max(1, o.t.dk)) * p3;
        x.e.tpm = duz; x.e.pts = Math.max(0, x.e.pts - 3 * (ham - duz));
        const isabet = o.t.tpm / o.t.tpa;
        if (Math.abs(isabet - p3) >= 0.06 && o.t.tpa / Math.max(1, o.t.w) >= 2) x.not.push('Üçlük isabeti son maçlarda ' + yuzde(isabet) + ', beklenti ' + yuzde(p3) + '\'e çekildi');
      }
      if (o.t.ftaVar && o.t.fta >= 6) {
        const pf = (o.t.ftm + 0.75 * 30) / (o.t.fta + 30), ham = x.e.ftm, duz = (o.t.fta / Math.max(1, o.t.dk)) * pf;
        x.e.ftm = duz; x.e.pts = Math.max(0, x.e.pts - (ham - duz));
      }
      STATS.forEach(s => { x.e[s] *= Math.exp(sinirla(x.lnRho[s], -0.5, 0.5)); });
      // Pozisyon (numara) etkisi: yokluk analizi zaten güçlüyse çifte sayılmasın diye kısılır
      x.bugunSlot = bugunSlot[o.id] != null ? bugunSlot[o.id] : null;
      x.normalSlot = profilNormal(poz && poz.prof[o.id]);
      x.slotF = poz && x.bugunSlot != null ? slotEtkisi(poz.prof[o.id], x.bugunSlot, G) : null;
      x.slotKat = 1 - x.rhoGuc;
      if (x.slotF && x.slotF.f) STATS.forEach(s => { x.e[s] *= Math.pow(x.slotF.f[s], x.slotKat); });
      // Rakibin bu mevkiye karşı savunması
      const gr = grupBoyut(o.boyut), sf = savunma && savunma[gr];
      if (sf && sf.dk > 150) { ['pts', 'reb', 'ast', 'tpm'].forEach(s => { if (sf[s]) x.e[s] *= sf[s]; }); x.savGrup = gr; x.sav = sf; }
    });
    // Takım toplamına göre ölçekleme (maç senaryosu)
    const kat = {};
    ['pts', 'reb', 'ast', 'tpm'].forEach(s => {
      const ham = Object.values(P).reduce((t, x) => t + x.pO * x.dk * x.e[s], 0);
      kat[s] = sen[s] > 0 && ham > 0 ? sinirla(Math.pow(sen[s] / ham, 0.7), 0.8, 1.25) : 1;
    });
    kat.ftm = kat.pts; kat.tov = 1;
    Object.values(P).forEach(x => {
      STATS.forEach(s => { x.e[s] *= kat[s]; });
      const n = Math.min(10, x.o.oyn.length);
      x.sdDk = Math.sqrt((n * x.o.sdDk * x.o.sdDk + 3 * 25) / (n + 3)) + (yedekDagit.length ? 1.5 : 0) + (x.donus ? 3 : 0) + (x.durumDegisti ? 2 : 0);
      x.maxDk = maxDk;
      x.mu = {}; STATS.forEach(s => { x.mu[s] = x.e[s] * x.dk; });
      const cv = x.sdDk / Math.max(1, x.dk);
      x.istikrar = cv <= 0.2 ? 'yüksek' : cv <= 0.32 ? 'orta' : 'düşük';
    });
    return { P, reg, kopma, kat, yedekDagit: yedekDagit.map(X => X.ad), ilk5, bugunSlot };
  }
  // Uzatma ihtimali (beklenen fark küçükse daha yüksek)
  const uzatmaIhtimali = fark => 0.065 * Math.exp(-(fark * fark) / 72);
  function simule(x, seed, n, pOT, reg) {
    n = n || SIM;
    const R = rng(seed), N = normalUret(R), out = {};
    STATS.forEach(s => { out[s] = new Int16Array(n); });
    const gK = 40, otK = (reg + 25) / reg;
    for (let i = 0; i < n; i++) {
      let dk = sinirla(x.dk + x.sdDk * N(), 2, x.maxDk);
      if (pOT > 0 && R() < pOT) dk *= otK;
      const g = gamma(R, N, gK) / gK;
      for (const s of STATS) {
        const mu = x.e[s] * dk * g;
        if (!(mu > 0)) continue;
        const d = x.o.disp[s], k = mu / Math.max(0.02, d - 1);
        const lam = d > 1.02 ? mu * gamma(R, N, k) / k : mu;
        out[s][i] = poisson(R, N, lam);
      }
    }
    return out;
  }
  const toplamDizi = (sim, b) => { const n = sim[b[0]].length, a = new Int16Array(n); for (let i = 0; i < n; i++) { let t = 0; b.forEach(s => { t += sim[s][i]; }); a[i] = t; } return a; };
  const oranUstu = (a, N) => { let c = 0; for (let i = 0; i < a.length; i++) if (a[i] >= N) c++; return c / a.length; };
  const ortVar = a => { let s = 0, s2 = 0; for (let i = 0; i < a.length; i++) { s += a[i]; s2 += a[i] * a[i]; } const m = s / a.length; return { m, d: m > 0 ? Math.max(1, (s2 / a.length - m * m) / m) : 1 }; };

  // ---------- Güvenilirlik: kalibrasyon, gölge kayıt, öğrenme, kendini sınama ----------
  let KAL = null;
  const kalAl = () => GM_getValue('bo_kal', null);
  function kalibre(p) { if (KAL === null) KAL = kalAl() || {}; return KAL.c ? sigm(KAL.c * logit(p)) : p; }
  // Gölge kayıt: kadrosu kesin maçlarda Bilyoner'deki bütün oyuncu oranları, sinyal verilsin verilmesin
  // { i: kimlik, e: Sofascore maç, p: oyuncu, t: pazar, n: N, o: oran, q: son ihtimal, h: ham ihtimal, g: güven, z: maç saati, r: 1/0/-1, v: gerçek değer }
  let GOLGE = null, golgeKirli = false;
  const golgeAl = () => { if (!GOLGE) GOLGE = GM_getValue('bo_golge', []); return GOLGE; };
  function golgeKaydet() {
    if (!golgeKirli) return;
    let g = golgeAl();
    const idx = {};
    g.forEach((x, i) => { idx[x.i] = i; });
    GM_getValue('bo_golge', []).forEach(x => {
      if (!(x.i in idx)) { idx[x.i] = g.length; g.push(x); }
      else { const y = g[idx[x.i]]; if (y.r == null && x.r != null) Object.assign(y, x); }
    });
    if (g.length > GOLGE_MAX) { g.sort((a, b) => (a.z || 0) - (b.z || 0)); g = g.slice(g.length - GOLGE_MAX); GOLGE = g; }
    GM_setValue('bo_golge', g);
    golgeKirli = false;
  }
  function golgeEkle(liste) {
    const g = golgeAl(), idx = {};
    g.forEach((x, i) => { idx[x.i] = i; });
    liste.forEach(y => {
      if (y.i in idx) { const x = g[idx[y.i]]; if (x.r == null) Object.assign(x, y); }
      else { idx[y.i] = g.length; g.push(y); }
    });
    golgeKirli = true;
  }
  // Biten maçların gölge kayıtlarını sonuçlandır
  async function golgeCoz(sinir) {
    const g = golgeAl();
    const bek = g.filter(x => x.r == null && x.z && simdiSn() > x.z + 2.5 * 3600);
    const evler = [...new Set(bek.map(x => String(x.e)))].slice(0, sinir || 12);
    let n = 0;
    for (const eid of evler) {
      const grup = bek.filter(x => String(x.e) === eid);
      const eski = simdiSn() > (grup[0].z || 0) + 4 * 86400;
      const iade = () => { grup.forEach(x => { x.r = -1; n++; }); golgeKirli = true; };
      try {
        const v = await ssAl('/event/' + eid);
        const e = v.event || v;
        const tur = e.status && e.status.type;
        if (tur === 'canceled' || tur === 'postponed' || (tur !== 'finished' && simdiSn() > (e.startTimestamp || 0) + 3 * 86400)) { iade(); continue; }
        if (!bittiMi(e)) { if (eski) iade(); continue; }
        await maciArsivle(e);
        const A = arsiv()[eid];
        if (!A) { if (eski) iade(); continue; }
        const sat = (A.H || []).concat(A.A || []);
        grup.forEach(x => {
          const r = sat.find(y => String(y[0]) === String(x.p));
          const o = r ? satirAc(r) : null;
          if (!o || !(o.dk > 0)) x.r = -1;
          else { x.v = TIP[x.t].b.reduce((t, s) => t + (o[s] || 0), 0); x.r = x.v >= x.n ? 1 : 0; x.gd = Math.round(o.dk * 10) / 10; x.gi = o.ilk; }
          n++;
        });
        golgeKirli = true;
      } catch (err) {
        if (err.kod === 404 || eski) iade();
        if (ssKisit) break;
      }
    }
    arsivKaydet();
    golgeKaydet();
    return n;
  }
  // ---------- Maç sonu karnesi: tahmin ile gerçeği karşılaştır, kaybın sebebini bul ----------
  // Ortak biçim: { r: 1/0, v: gerçek değer, n: çizgi, d: tahmini dk, gd: gerçek dk, il: tahmin ilk 5, gi: gerçek ilk 5, m: tahmini ortalama, et: dayanak etiketleri }
  function karneSebep(x) {
    if (x.r !== 0) return null;
    if (x.il === 1 && x.gi === 0) return 'rol';
    if (x.d != null && x.gd != null && x.gd < x.d - 5) return 'dakika';
    if (x.v != null && x.v >= x.n - 1) return 'kil';
    return 'verim';
  }
  const SEBEP_AD = { rol: 'rol: ilk 5 dedik, yedekten başladı', dakika: 'dakika: beklenenden 5+ dk az oynadı', kil: 'kıl payı: çizgiye 1 kala kaldı', verim: 'verim: dakikayı aldı ama üretemedi' };
  const ETIKET_AD = { y: 'yokluk analizine dayananlar', p: 'pozisyon değişikliğine dayananlar', d: 'sakatlık dönüşü olanlar', r: 'ilk 5 / yedek değişikliği olanlar' };
  // Kayıtlardan da aynı biçime çevir (gölgede olmayanlar için)
  const kayitKarne = r => {
    const s = r.sonuc, t = r.tahmin;
    if (!s || !t || s.elle || (s.durum !== 'tuttu' && s.durum !== 'tutmadi')) return null;
    return { r: s.durum === 'tuttu' ? 1 : 0, v: s.deger, n: r.N, d: t.dk, dh: t.dh, gd: s.dk, il: t.il, gi: s.ilk, m: t.ort, et: t.et || '', t: r.tip, g: r.guven, e: r.ssId, p: r.oyuncuId, ad: r.oyuncu, secim: r.secim };
  };
  function karneVerisi() {
    const g = golgeAl().filter(x => (x.r === 0 || x.r === 1) && x.d != null);
    const ids = new Set(golgeAl().map(x => x.i));
    return g.concat(kayitAl().filter(r => !ids.has(r.id)).map(kayitKarne).filter(Boolean));
  }
  // Dakika düzeltmesi: aynı oyuncu-maç bir kez sayılır
  function dakikaDuzeltme() {
    const tek = {};
    karneVerisi().forEach(x => { if (x.d != null && x.gd > 0 && (x.il === 0 || x.il === 1)) tek[x.e + '|' + x.p] = x; });
    const sonuc = {};
    [['ilk', 1], ['yedek', 0]].forEach(([k, il]) => {
      const l = Object.values(tek).filter(x => x.il === il);
      const n = l.length;
      sonuc['n' + k] = n;
      sonuc['h' + k] = n ? mean(l.map(x => x.gd - x.d)) : 0;
      const ham = n ? mean(l.map(x => x.gd - (x.dh != null ? x.dh : x.d))) : 0;
      const d = n >= 20 ? Math.round(sinirla(ham * n / (n + 30), -3, 3) * 10) / 10 : 0;
      sonuc[k] = Math.abs(d) >= 0.3 ? d : 0;
    });
    return sonuc;
  }
  // Pazar bazında kalan sapma (kalibrasyondan sonra), gölge kayıt + elle kayıtlar
  function ogrenme() {
    const sonuc = {};
    const g = golgeAl().filter(x => (x.r === 0 || x.r === 1) && x.h > 0);
    const ids = new Set(g.map(x => x.i));
    const k = kayitAl().filter(r => r.sonuc && (r.sonuc.durum === 'tuttu' || r.sonuc.durum === 'tutmadi') && r.pHam > 0 && !ids.has(r.id));
    Object.keys(TIP).forEach(t => {
      const veri = g.filter(x => x.t === t).map(x => ({ h: x.h, r: x.r })).concat(k.filter(r => r.tip === t).map(r => ({ h: r.pHam, r: r.sonuc.durum === 'tuttu' ? 1 : 0 })));
      if (veri.length < 15) return;
      const sapma = mean(veri.map(v => v.r - kalibre(v.h)));
      sonuc[t] = { duz: sapma * veri.length / (veri.length + 60), n: veri.length };
    });
    return sonuc;
  }
  // Geriye dönük test: geçmiş maçları o maçın verisini görmeden tahmin et, gerçek sonuçla karşılaştır
  async function geriyeTest(tidler, ilerle) {
    const veri = [];
    const G = genelSlotEtki();
    for (let ti = 0; ti < tidler.length; ti++) {
      const tid = tidler[ti];
      const M = takimMaclari(tid, 40);
      for (let j = 0; j < Math.min(6, M.length); j++) {
        const gecmis = M.slice(j + 1);
        if (gecmis.length < 8) break;
        const test = M[j];
        if (ilerle) ilerle('Takım ' + (ti + 1) + '/' + tidler.length + ' · geçmiş maç ' + (j + 1) + ' · ' + veri.length + ' örnek');
        await bekle(0);
        const w = agirlikF(gecmis, { ts: test.ts, ut: test.ut });
        const O = oyuncuTemel(gecmis, {}, w);
        const D = {};
        Object.values(O).forEach(o => {
          if (o.dk < 6 || o.oyn.length < 2) return;
          const r = test.B.find(y => y.id === o.id);
          D[o.id] = r && r.dk > 0 ? { a: 0, kaynak: 'oynadı', kesin: true } : { a: 1, kaynak: 'oynamadı', kesin: true, uzun: o.kacirdi > 6 };
        });
        const ilkler = test.B.filter(r => r.ilk === 1).map(r => r.id).filter(id => O[id]);
        const ilk5 = ilkler.length === 5 ? { ids: ilkler, kesin: true } : ilk5Belirle(O, gecmis, D, [], 0);
        const ortT = f => { let s = 0, ww = 0; gecmis.slice(0, 10).forEach((m, i) => { const x = Math.pow(0.9, i); s += x * f(m); ww += x; }); return ww ? s / ww : 0; };
        const sen = { fark: 0 };
        ['pts', 'reb', 'ast', 'tpm'].forEach(s => { sen[s] = ortT(m => m.top[s]); });
        const poz = pozProfil(gecmis, O, tid, w);
        const pr = takimProjeksiyon({ maclar: gecmis, O, D, sen, ilk5, poz, savunma: null, b2b: false, w, onceki: null, G }, 0);
        Object.values(pr.P).forEach(x => {
          const gercek = test.B.find(y => y.id === x.o.id);
          if (!gercek || !(gercek.dk > 0) || x.o.oyn.length < 6) return;
          const sim = simule(x, tohum(test.eid + '|' + x.o.id), 1500, 0, pr.reg);
          ['pts', 'reb', 'ast'].forEach(s => {
            const a = sim[s], m = ortVar(a).m;
            [Math.round(m), Math.round(0.75 * m)].filter((N, i, arr) => N >= 1 && arr.indexOf(N) === i).forEach(N => {
              const p = oranUstu(a, N);
              if (p < 0.05 || p > 0.97) return;
              veri.push({ h: p, r: gercek[s] >= N ? 1 : 0, w: 1, t: s });
            });
          });
        });
      }
    }
    return veri;
  }
  const KOVALAR = [[0, 0.5, '%50 altı'], [0.5, 0.6, '%50–60'], [0.6, 0.7, '%60–70'], [0.7, 1.01, '%70 ve üstü']];
  function kalibrasyonHesapla(veri) {
    const kayip = c => {
      let L = 0, W = 0;
      veri.forEach(v => { const q = sinirla(sigm(c * logit(v.h)), 0.001, 0.999); L -= v.w * (v.r ? Math.log(q) : Math.log(1 - q)); W += v.w; });
      return W ? L / W : 0;
    };
    let enC = 1, enL = kayip(1);
    for (let c = 0.4; c <= 1.2001; c += 0.05) { const L = kayip(c); if (L < enL - 1e-9) { enL = L; enC = Math.round(c * 100) / 100; } }
    const kova = KOVALAR.map(([a, b, ad]) => {
      const g = veri.filter(v => v.h >= a && v.h < b);
      const q = v => sigm(enC * logit(v.h));
      const g2 = veri.filter(v => q(v) >= a && q(v) < b);
      return {
        ad, n: g.length, once: g.length ? mean(g.map(v => v.h)) : null, gercek: g.length ? mean(g.map(v => v.r)) : null,
        n2: g2.length, sonra: g2.length ? mean(g2.map(q)) : null, gercek2: g2.length ? mean(g2.map(v => v.r)) : null
      };
    });
    return { c: enC, kayip: enL, kayip1: kayip(1), kova };
  }
  async function kendiniSina(tidler, ilerle) {
    const test = await geriyeTest(tidler, ilerle);
    const g = golgeAl().filter(x => (x.r === 0 || x.r === 1) && x.h > 0).map(x => ({ h: x.h, r: x.r, w: 2 }));
    const veri = test.concat(g);
    if (veri.length < 40) return { yetersiz: true, n: veri.length };
    const k = kalibrasyonHesapla(veri);
    const kayit = { c: k.c, n: veri.length, test: test.length, golge: g.length, z: Date.now(), kova: k.kova, kayip: k.kayip, kayip1: k.kayip1, takim: tidler.length };
    GM_setValue('bo_kal', kayit);
    KAL = kayit;
    return kayit;
  }

  // ---------- Maç analizi ----------
  // Bilyoner'deki oyuncu adını modeldeki oyuncuyla eşleştir (ad+soyad ya da en az soyad tutmalı)
  function oyuncuEsle(ad, liste, adF) {
    let iyi = null, puan = 0, belirsiz = false;
    const sa = norm(soyad(ad));
    liste.forEach(x => {
      const xa = adF(x);
      let p = isimPuan(ad, xa);
      const sx = norm(soyad(xa));
      if (p < 3.5 && !(sa && sx && (sa === sx || (sa.length >= 5 && sx.length >= 5 && sa.slice(0, 5) === sx.slice(0, 5))))) p = Math.min(p, 1);
      if (p > puan) { puan = p; iyi = x; belirsiz = false; }
      else if (p === puan && p > 0 && iyi !== x) belirsiz = true;
    });
    return puan >= 2 && !belirsiz ? iyi : null;
  }
  async function macAnaliz(bm, ilerle) {
    const adim = t => { if (ilerle) ilerle(t); };
    const bo = await bilyonerVeri(bm.bid);
    const ev = bm.ev || bo.ev, dep = bm.dep || bo.dep;
    if (!ev || !dep) return { durum: 'isim' };
    const macAd = ev + ' - ' + dep;
    const secimler = [], gor = {};
    bo.oranlar.forEach(o => {
      const tip = oyuncuPazarTipi(o.pazar);
      if (!tip) return;
      const sc = secimCoz(o.n);
      if (!sc) return;
      const k = tip + '|' + norm(sc.ad) + '|' + sc.N;
      if (gor[k]) return;
      gor[k] = 1;
      secimler.push({ tip, ad: sc.ad, N: sc.N, bil: o.val });
    });
    if (!secimler.length) return { durum: 'pazaryok', macAd };
    adim('Sofascore\'da maç aranıyor');
    const mac = await ssMacBul(ev, dep, bm.ts);
    if (mac.ligTur === 'DIGER' && ayar.ligler !== 'hepsi' && !bm.tek) return { durum: 'lig', macAd, lig: mac.lig };
    if (bm.ts === 0 && ayar.pencere < 24 && (mac.ts < simdiSn() || mac.ts > simdiSn() + ayar.pencere * 3600) && !bm.tek) return { durum: 'pencere' };
    if (mac.durum && mac.durum !== 'notstarted' && (!bm.tek || bm.takip)) return { durum: 'basladi', macAd };
    const kalan = mac.ts - simdiSn();
    adim('Son maçlar indiriliyor (ilk seferde biraz sürer)');
    await Promise.all([takimArsivi(mac.evId), takimArsivi(mac.depId)]);
    const [kadro, tkA, tkB] = await Promise.all([bugunKadro(mac.id), ssTakimKadrosu(mac.evId), ssTakimKadrosu(mac.depId)]);
    const MA = takimMaclari(mac.evId), MB = takimMaclari(mac.depId);
    if (MA.length < 4 || MB.length < 4) return { durum: 'veriaz', macAd, atilan: (MA.atilan || 0) + (MB.atilan || 0) };

    // NBA: ESPN pozisyon etiketleri ve sakatlık raporu
    let etA = {}, etB = {}, espnA = null, espnB = null, espnVar = false, espnNot = '';
    if (mac.ligTur === 'NBA') {
      adim('ESPN: sakatlık raporu ve pozisyonlar');
      try {
        const T = await espnTakimlar();
        const tA = espnTakimEs(mac.evSsAd, T) || espnTakimEs(ev, T), tB = espnTakimEs(mac.depSsAd, T) || espnTakimEs(dep, T);
        const adlar = M => { const x = {}; M.forEach(m => m.B.forEach(r => { x[r.id] = r.ad; })); return x; };
        const etiketle = async (t, M) => {
          const et = {};
          if (!t) return et;
          try {
            const ros = await espnKadroPoz(t.id), ad = adlar(M);
            Object.keys(ad).forEach(id => { const x = ros.find(y => adEsit(y.ad, ad[id])); if (x && x.poz) et[id] = x.poz; });
          } catch (e) {}
          return et;
        };
        [etA, etB] = await Promise.all([etiketle(tA, MA), etiketle(tB, MB)]);
        try {
          const sak = await espnSakat();
          const suz = t => { if (!t) return sak; const l = sak.filter(x => !x.takim || espnTakimEs(x.takim, [t])); if (!l.length) return sak; l.takimli = true; return l; };
          espnA = suz(tA); espnB = suz(tB); espnVar = true;
        } catch (e) { espnNot = 'ESPN sakatlık raporu alınamadı: ' + e.message; }
        if (!tA || !tB) espnNot = (espnNot ? espnNot + ' · ' : '') + 'ESPN\'de takım eşleşmedi: ' + (!tA ? ev : '') + (!tA && !tB ? ', ' : '') + (!tB ? dep : '');
      } catch (e) { espnNot = 'ESPN\'e ulaşılamadı: ' + e.message; }
    }
    const wA = agirlikF(MA, mac), wB = agirlikF(MB, mac);
    const OA = oyuncuTemel(MA, etA, wA), OB = oyuncuTemel(MB, etB, wB);

    // Takıma yeni gelenler: önceki takımındaki maçlar
    const onceki = {}, yeniler = [];
    const herkesO = Object.values(OA).map(o => ({ o, tid: mac.evId })).concat(Object.values(OB).map(o => ({ o, tid: mac.depId })));
    [...new Set(secimler.map(s => s.ad))].forEach(ad => { const y = oyuncuEsle(ad, herkesO, z => z.o.ad); if (y && y.o.oyn.length < 5 && !yeniler.some(q => q.o === y.o)) yeniler.push(y); });
    if (yeniler.length) adim('Takıma yeni gelen oyuncuların önceki maçları');
    for (const y of yeniler.slice(0, 6)) { try { const v = await oncekiTakimVerisi(y.o.id, y.tid); if (v && v.dk >= 40) onceki[y.o.id] = v; } catch (e) {} }

    // Oyun içi pozisyon verisi
    if (mac.ligTur === 'EL' || mac.ligTur === 'NBA') {
      adim('Oyun içi pozisyon verisi (' + (mac.ligTur === 'EL' ? 'EuroLeague resmi oyun akışı' : 'ESPN oyun akışı') + ')');
      await Promise.all([pozIndir(mac.evId, MA, OA, mac.ligTur), pozIndir(mac.depId, MB, OB, mac.ligTur)]);
      pozKaydet();
    }
    C.__G = null;
    const G = genelSlotEtki();
    const pzA = pozProfil(MA, OA, mac.evId, wA), pzB = pozProfil(MB, OB, mac.depId, wB);

    // Bilyoner oran görüntüsü (kaldırılan oranlar, oran hareketi)
    const once = oranGoruntusuKaydet(bm.bid, secimler);
    const bilTakim = O => {
      const liste = Object.values(O), simdi = new Set(), ilk = new Set();
      secimler.forEach(sc => { const o = oyuncuEsle(sc.ad, liste, x => x.ad); if (o) simdi.add(o.id); });
      if (once && once.ilk) Object.keys(once.ilk).forEach(n => { const o = oyuncuEsle(n, liste, x => x.ad); if (o) ilk.add(o.id); });
      return { simdi, ilk };
    };

    // Kim oynuyor, kadro kesin mi?
    const kA = kadro.var ? (mac.evSahada ? kadro.home : kadro.away) : null, kB = kadro.var ? (mac.evSahada ? kadro.away : kadro.home) : null;
    const elListe = mac.ligTur === 'EL' && kA && kB && [kA, kB].every(k => k.oyuncular.length >= 10 && k.oyuncular.length <= 13) && kalan < 75 * 60;
    const ssKesin = !!(kadro.var && kadro.kesin && kA && kB && kA.oyuncular.length >= 8 && kB.oyuncular.length >= 8);
    const listeKesin = ssKesin || elListe;
    const ipA = [], ipB = [];
    const DA = durumHaritasi(OA, kA, listeKesin, espnA, bilTakim(OA), tkA, ipA), DB = durumHaritasi(OB, kB, listeKesin, espnB, bilTakim(OB), tkB, ipB);
    const belirsizVarMi = (D, O) => Object.keys(D).some(id => D[id].a === '?' && O[id] && O[id].dk >= 15);
    let kesin = false, kadroYazi;
    if (ssKesin) { kesin = true; kadroYazi = 'Kadro kesin (Sofascore resmi kadro)' + (kA.ilk.length >= 5 && kB.ilk.length >= 5 ? ', ilk 5\'ler dahil' : ', ilk 5 tahmini'); }
    else if (elListe) { kesin = true; kadroYazi = 'Maç kadroları (12 kişilik listeler) açıklandı, ilk 5 tahmini'; }
    else if (mac.ligTur === 'NBA' && espnVar && kalan < 90 * 60 && !belirsizVarMi(DA, OA) && !belirsizVarMi(DB, OB)) { kesin = true; kadroYazi = 'NBA sakatlık raporu netleşti, belirsiz oyuncu yok (ilk 5 tahmini)'; }
    else kadroYazi = kadro.var ? 'Kadro açıklandı ama henüz kesinleşmedi' : 'Kadro henüz açıklanmadı' + (mac.ligTur === 'NBA' && espnVar ? ' (NBA: maça 90 dk kala sakatlık raporunda belirsiz önemli oyuncu kalmazsa kesin sayılır)' : '');
    const elle = !kesin && !!GM_getValue('bo_elleKesin', {})[String(mac.id)];
    if (elle) kadroYazi += ' · ✋ kadroyu sen doğruladın';

    // Maç senaryosu
    const pi = piyasaOku(bo.oranlar, ev, dep);
    const ortT = (M, f) => { let s = 0, w = 0; M.slice(0, 10).forEach((m, i) => { const ww = Math.pow(0.9, i); s += ww * f(m); w += ww; }); return w ? s / w : 0; };
    const ortR = (M, f) => { const x = M.filter(m => m.rOk); return x.length >= 3 ? ortT(x, f) : null; };
    const sen = { ev: {}, dep: {} }, istA = {}, istB = {};
    ['pts', 'reb', 'ast', 'tpm'].forEach(s => {
      const yA = ortR(MB, m => m.rtop[s]), yB = ortR(MA, m => m.rtop[s]);
      istA[s] = yA != null ? (ortT(MA, m => m.top[s]) + yA) / 2 : ortT(MA, m => m.top[s]);
      istB[s] = yB != null ? (ortT(MB, m => m.top[s]) + yB) / 2 : ortT(MB, m => m.top[s]);
    });
    const tempo = pi.T && istA.pts + istB.pts > 0 ? sinirla(pi.T / (istA.pts + istB.pts), 0.85, 1.15) : 1;
    sen.ev.pts = pi.muA || istA.pts; sen.dep.pts = pi.muB || istB.pts;
    ['reb', 'ast', 'tpm'].forEach(s => {
      const a = istA[s] * Math.sqrt(tempo), b = istB[s] * Math.sqrt(tempo);
      sen.ev[s] = pi.takim.ev[s] ? 0.7 * pi.takim.ev[s] + 0.3 * a : a;
      sen.dep[s] = pi.takim.dep[s] ? 0.7 * pi.takim.dep[s] + 0.3 * b : b;
    });
    // Rakipte eksik oyuncu etkisi (piyasa çizgisi varsa onun içinde zaten var, az eklenir)
    const etkiEv = rakipEksikEtkisi(MB, OB, DB), etkiDep = rakipEksikEtkisi(MA, OA, DA);
    ['pts', 'reb', 'ast', 'tpm'].forEach(s => {
      const pz = t => s === 'pts' ? !!(t === 'ev' ? pi.muA : pi.muB) : !!pi.takim[t][s];
      const k = t => pz(t) ? (s === 'pts' ? 0.3 : 0.4) : 1;
      sen.ev[s] = Math.max(1, sen.ev[s] + etkiEv.d[s] * k('ev'));
      sen.dep[s] = Math.max(1, sen.dep[s] + etkiDep.d[s] * k('dep'));
    });
    sen.ev.fark = sen.dep.fark = sen.ev.pts - sen.dep.pts;
    const b2b = M => M.length && mac.ts - M[0].ts < 30 * 3600;
    const pOT = uzatmaIhtimali(sen.ev.fark);
    const senYazi = (pi.T ? 'Maç toplamı ' + v1(pi.T) + ' (' + (tempo >= 1.03 ? 'takımların normalinden yüksek tempo' : tempo <= 0.97 ? 'normalinden düşük tempo' : 'normal tempo') + ')' : 'Maç toplamı çizgisi yok, istatistikten') +
      ' → ' + ev + ' ' + v0(sen.ev.pts) + ', ' + dep + ' ' + v0(sen.dep.pts) + ' sayı bekleniyor';
    const ligT = mac.ligTur !== 'DIGER' ? mac.ligTur : null;
    const savA = ligT ? rakipSavunma(MB, ligT) : null, savB = ligT ? rakipSavunma(MA, ligT) : null;

    // Senaryolar: durumu belirsiz oyuncular oynarsa / oynamazsa
    const belirsizAd = Object.keys(DA).filter(id => DA[id].a === '?').map(id => OA[id].ad).concat(Object.keys(DB).filter(id => DB[id].a === '?').map(id => OB[id].ad));
    const senaryolar = belirsizAd.length ? [0, 1] : [0];
    adim('Rotasyon, pozisyon ve simülasyon');
    const dkDuz = dakikaDuzeltme();
    const proj = senaryolar.map(bA => ({
      A: takimProjeksiyon({ maclar: MA, O: OA, D: DA, sen: sen.ev, ilk5: ilk5Belirle(OA, MA, DA, ssKesin && kA ? kA.ilk : [], bA), poz: pzA, savunma: savA, b2b: b2b(MA), w: wA, onceki, G, dkDuz }, bA),
      B: takimProjeksiyon({ maclar: MB, O: OB, D: DB, sen: sen.dep, ilk5: ilk5Belirle(OB, MB, DB, ssKesin && kB ? kB.ilk : [], bA), poz: pzB, savunma: savB, b2b: b2b(MB), w: wB, onceki, G, dkDuz }, bA)
    }));
    const ilk5Kesin = { A: !!(proj[0].A.ilk5 && proj[0].A.ilk5.kesin), B: !!(proj[0].B.ilk5 && proj[0].B.ilk5.kesin) };
    const ogr = ogrenme();
    if (KAL === null) KAL = kalAl() || {};
    const sinyaller = [], supheli = [], tum = [], golgeListe = [];
    const oyuncuGrup = {};
    const herkesP = Object.values(proj[0].A.P).map(x => ({ x, t: 'A' })).concat(Object.values(proj[0].B.P).map(x => ({ x, t: 'B' })));
    secimler.forEach(sc => {
      const bul = oyuncuEsle(sc.ad, herkesP, y => y.x.o.ad);
      if (!bul) return;
      (oyuncuGrup[bul.x.o.id] = oyuncuGrup[bul.x.o.id] || { takim: bul.t, id: bul.x.o.id, secimler: [] }).secimler.push(sc);
    });
    Object.values(oyuncuGrup).forEach(gr => {
      const simler = proj.map(pr => {
        const T = gr.takim === 'A' ? pr.A : pr.B, x = T.P[gr.id];
        return x ? { x, sim: simule(x, tohum(mac.id + '|' + gr.id), SIM, pOT, T.reg) } : null;
      });
      if (simler.some(s => !s)) return;
      const ana = simler[0].x, o = ana.o, T0 = gr.takim === 'A' ? proj[0].A : proj[0].B, D0 = gr.takim === 'A' ? DA : DB;
      // Bilyoner'in bu oyuncu için verdiği her pazardan çıkan beklenti (iç tutarlılık)
      const imp = {}, dis = {};
      Object.keys(TIP).forEach(t => { dis[t] = ortVar(toplamDizi(simler[0].sim, TIP[t].b)).d; });
      gr.secimler.forEach(sc => {
        const p = sinirla(1 / (sc.bil * MARJ), 0.03, 0.97);
        (imp[sc.tip] = imp[sc.tip] || []).push(ortalamaBul(sc.N, p, dis[sc.tip]));
      });
      Object.keys(imp).forEach(t => { imp[t] = mean(imp[t]); });
      const turet = t => {
        const sonuc = [];
        (TURET[t] || []).forEach(f => {
          if (imp[f[0]] === undefined) return;
          let v = imp[f[0]], ok = true;
          for (let i = 1; i < f.length; i += 2) { if (imp[f[i + 1]] === undefined) { ok = false; break; } v += f[i] * imp[f[i + 1]]; }
          if (ok && v > 0) sonuc.push(v);
        });
        return sonuc.length ? mean(sonuc) : null;
      };
      const takimAd = gr.takim === 'A' ? ev : dep;
      const nEtkin = o.oyn.length + (onceki[o.id] ? onceki[o.id].n : 0);
      // Bu oyuncunun tahmini neye dayanıyor (karnede ayrı ayrı ölçülür)
      const dayanak = (ana.kanit.some(k => Math.abs(k.a - k.f) >= 0.5 && Math.abs((k.a - k.f) * k.dDk) >= 1.5) ? 'y' : '') + (ana.slotF && ana.slotF.f ? 'p' : '') + (ana.donus ? 'd' : '') + (ana.durumDegisti ? 'r' : '');
      const enIyi = {};
      gr.secimler.forEach(sc => {
        const b = TIP[sc.tip].b;
        const pler = simler.map(s => oranUstu(toplamDizi(s.sim, b), sc.N));
        const pHam = Math.min.apply(null, pler);
        const ogd = ogr[sc.tip];
        const pKal = kalibre(pHam);
        const p = sinirla(pKal + (ogd ? ogd.duz : 0), 0.01, 0.99);
        const evBot = p * sc.bil - 1;
        const pImp = 1 / (sc.bil * MARJ);
        const muTur = turet(sc.tip);
        const pIc = muTur ? nbKuyruk(muTur, dis[sc.tip], sc.N) : null;
        const ic = pIc !== null ? pIc - pImp : null;
        const ortX = ortVar(toplamDizi(simler[0].sim, b)).m;
        const id = mac.id + '|' + sc.tip + '|' + gr.id + '|' + sc.N;
        const satir = { id, secim: sc.ad + ' ' + sc.N + '+ ' + TIP[sc.tip].birim, tip: sc.tip, ad: sc.ad, N: sc.N, bil: sc.bil, p, pImp, ev: evBot, ort: ortX, h: pHam, pid: gr.id, tk: gr.takim, durum: '' };
        tum.push(satir);
        const tahmin = { dk: Math.round(ana.dk * 10) / 10, dh: Math.round((ana.dk - (ana.karneDuz || 0)) * 10) / 10, nd: Math.round(o.dk * 10) / 10, ort: Math.round(ortX * 10) / 10, il: ana.ilkBelli ? (ana.bugunIlk ? 1 : 0) : -1, et: dayanak };
        golgeListe.push({ i: id, e: mac.id, p: gr.id, t: sc.tip, n: sc.N, o: sc.bil, q: p, h: pHam, g: '', z: mac.ts, d: tahmin.dk, dh: tahmin.dh, m: tahmin.ort, il: tahmin.il, et: dayanak, a: soyad(o.ad) });
        if (evBot >= ESIK.supheli) { satir.durum = 'supheli'; supheli.push({ secim: satir.secim, bil: sc.bil, p, macAd }); return; }
        const kanitlar = ana.kanit.filter(k => Math.abs((k.a - k.f) * k.dDk) >= 1.5 || Math.abs((k.a - k.f) * Math.log(k.rho[b[0]] || 1)) >= 0.06);
        const zayifKanit = kanitlar.some(k => k.guc === 'zayıf') || (ana.adjDk === 0 && T0.yedekDagit.length > 0);
        const slotZayif = !!(ana.slotF && ana.slotF.f && (ana.slotF.guc === 'zayıf' || ana.slotF.guc === 'genel etki') && b.some(s => Math.abs(ana.slotF.f[s] - 1) >= 0.08));
        const varsayim = ana.durumDegisti && !ilk5Kesin[gr.takim];
        let guven = null;
        const temelOK = evBot >= ESIK.fark && p >= ESIK.minP && nEtkin >= 6 && ana.istikrar !== 'düşük' && (ic === null || ic > -ESIK.ic);
        if (temelOK && evBot >= ESIK.yuksekFark && p >= ESIK.yuksekP && ic !== null && ic >= ESIK.ic && ic <= 0.3 && o.oyn.length >= 8 && ana.istikrar === 'yüksek' && !zayifKanit && !slotZayif && !ana.donus && !varsayim) guven = 'yuksek';
        else if (temelOK) guven = 'orta';
        if (!guven) return;
        // Gerekçe
        const gerekce = [];
        gerekce.push(senYazi + '.' + (T0.kopma !== 'düşük' ? ' Maç kopma riski ' + T0.kopma + ': yıldızların dakikası biraz düşürüldü.' : ''));
        gerekce.push('Kadro: ' + kadroYazi);
        // Pozisyon
        let pz = '';
        if (ana.bugunSlot == null) pz = 'Pozisyon: bugün yedekten giriyor' + (ilk5Kesin[gr.takim] ? '' : ' (tahmini)') + ' · rol: ' + o.rol + (ana.normalSlot != null ? ' · genelde ' + slotYazi(ana.normalSlot) + ' oynuyor' : '');
        else {
          pz = 'Pozisyon: bugün ' + (ilk5Kesin[gr.takim] ? '' : '(tahmini) ') + 'ilk 5\'te ' + SLOT_AD[ana.bugunSlot] + ' · rol: ' + o.rol;
          if (ana.normalSlot != null) pz += ' · normalde ' + slotYazi(ana.normalSlot);
          if (ana.slotF && ana.slotF.f) {
            const s0 = b.length === 1 ? b[0] : b.reduce((x, y) => Math.abs(ana.slotF.f[y] - 1) > Math.abs(ana.slotF.f[x] - 1) ? y : x);
            pz += '; bu pozisyonda ' + STAT_AD[s0] + '/dk ' + isaretli(Math.pow(ana.slotF.f[s0], ana.slotKat) - 1) + ' (' + ana.slotF.guc + (ana.slotF.dkB > 0 ? ', o numarada ' + v0(ana.slotF.dkB) + ' dk verisi' : ', ligdeki genel etki') + ')';
            if (ana.slotKat < 0.95) pz += ', yokluk etkisiyle çifte sayılmasın diye kısıldı';
          }
        }
        gerekce.push(pz);
        const dkYazi = Math.abs(ana.dk - o.dk) >= 1.5 ? 'normalde ' + v0(o.dk) + ' → bugün ' + v0(ana.dk) : v0(ana.dk) + ' civarı';
        gerekce.push('Dakika: ' + dkYazi + ' · istikrar ' + ana.istikrar + (ana.bugunIlk ? ' · bugün ilk 5' + (ana.durumDegisti ? ' (normalde yedek)' : '') : (ana.durumDegisti ? ' · bugün yedek (normalde ilk 5)' : '')) +
          (ana.karneDuz ? ' · karne düzeltmesi ' + isaretliSayi(ana.karneDuz) + ' dk (geçmiş dakika tahminlerime göre)' : ''));
        if (ana.donus) gerekce.push('Dönüş: son ' + ana.donus + ' maçı kaçırdı; dönüş maçında dakika sınırı olabilir diye dakikası %20 kısıldı.');
        kanitlar.forEach(k => {
          const ne = k.a === 1 ? k.ad + ' bugün yok' : k.ad + ' dönüyor (son ' + (k.n0 + k.n1) + ' maçın ' + k.n0 + ' tanesinde yoktu, o maçlardaki şişkinlik düzeltildi)';
          const rp = k.rho[b[0]] || 1;
          gerekce.push(ne + ' → onsuz maçlarda ' + soyad(o.ad) + ' ' + isaretliSayi(k.dDk) + ' dk, ' + STAT_AD[b[0]] + '/dk ' + isaretli(rp - 1) + ' (' + k.guc + ', ' + k.n0 + ' maç)' +
            (k.ilk0 !== null && k.ilk1 !== null && k.ilk0 - k.ilk1 >= 0.5 ? ', ilk 5\'e çıkıyor' : ''));
        });
        if (T0.yedekDagit.length && !kanitlar.length) gerekce.push('Eksik: ' + T0.yedekDagit.join(', ') + ' (geçmişte onsuz maç yok; dakikası boyu yakın oyunculara dağıtıldı, tahmini)');
        if (simler.length > 1) gerekce.push('Durumu belirsiz: ' + belirsizAd.join(', ') + ' → oynarsa ve oynamazsa diye iki senaryo hesaplandı, düşük ihtimal kullanıldı.');
        if (ana.sav) {
          const sv = b.filter(s => ana.sav[s] && Math.abs(ana.sav[s] - 1) >= 0.05).map(s => STAT_AD[s] + ' ' + isaretli(ana.sav[s] - 1));
          if (sv.length) gerekce.push('Rakip savunma: ' + GRUP_YON[ana.savGrup] + ' ' + sv.join(', ') + ' veriyor (rakibin son maçları, lig ortalamasına göre)');
        }
        const rakEt = gr.takim === 'A' ? etkiEv : etkiDep;
        if (rakEt.notlar.length) gerekce.push('Rakipte eksik: ' + rakEt.notlar.join('; '));
        const sonVals = o.oyn.slice(0, 10).map(i => b.reduce((a, s) => a + o.s[i][s], 0));
        gerekce.push('Son ' + sonVals.length + ' maçta ' + sonVals.filter(v => v >= sc.N).length + ' kez ' + sc.N + '+ · maç başı ' + v1(mean(sonVals)) + ' ' + TIP[sc.tip].birim);
        const takimSen = gr.takim === 'A' ? sen.ev : sen.dep, st0 = b[0];
        if (['reb', 'ast', 'tpm'].indexOf(st0) >= 0 && b.length === 1) {
          const ist = gr.takim === 'A' ? istA : istB, tc = pi.takim[gr.takim === 'A' ? 'ev' : 'dep'][st0];
          gerekce.push('Takımdan beklenen ' + STAT_AD[st0] + ' ' + v0(takimSen[st0]) + ' (istatistik ' + v0(ist[st0]) + (tc ? ', Bilyoner takım çizgisi ' + v0(tc) : '') + ')');
        }
        ana.not.forEach(t => gerekce.push(t));
        const ilkOran = once && once.ilk && once.ilk[norm(sc.ad)] ? once.ilk[norm(sc.ad)][sc.tip + '|' + sc.N] : null;
        if (ilkOran && Math.abs(sc.bil / ilkOran - 1) >= 0.08) gerekce.push('Bilyoner bu oranı ' + v2(ilkOran) + ' → ' + v2(sc.bil) + ' yaptı' + (sc.bil < ilkOran ? ' (oran düşüyor: piyasa da bu tarafı görüyor)' : ' (oran yükseldi: piyasa ters yöne gidiyor, dikkat)'));
        gerekce.push('Simülasyon (' + SIM.toLocaleString('tr-TR') + ' maç' + (pOT >= 0.03 ? ', uzatma ihtimali ' + yuzde(pOT) + ' dahil' : '') + '): ortalama ' + v1(ortX) + ' · ' + sc.N + '+ ihtimali ' + yuzde(pHam) +
          (KAL && KAL.c && Math.abs(pKal - pHam) >= 0.005 ? ' → kendini sınama ayarıyla ' + yuzde(pKal) : '') +
          (ogd ? ' · öğrenme düzeltmesi ' + (ogd.duz >= 0 ? '+' : '−') + Math.abs(Math.round(ogd.duz * 100)) + ' puan (' + ogd.n + ' sonuç)' : ''));
        if (ic !== null) gerekce.push('Bilyoner\'in diğer oranları bu seçime ' + yuzde(pIc) + ' diyor, bu seçimin kendi oranı ' + yuzde(pImp) + ' diyor → ' + (ic > 0.3 ? 'fark çok büyük, Bilyoner\'in fiyatında hata ya da bilmediğim bir durum olabilir' : ic >= ESIK.ic ? 'destekliyor' : ic <= -ESIK.ic ? 'çelişiyor' : 'nötr'));
        else gerekce.push('Bilyoner\'de karşılaştıracak ilişkili pazar yok (iç tutarlılık kontrol edilemedi).');
        gerekce.push('Hesabım ' + yuzde(p) + ' (adil oran ' + v2(1 / p) + ') · Bilyoner ' + v2(sc.bil) + ' → beklenen getiri ' + isaretli(evBot));
        const bagli = kanitlar.filter(k => k.a === 1 && !(D0[k.X] && D0[k.X].kesin)).map(k => k.ad).concat(simler.length > 1 ? belirsizAd : []).concat(varsayim ? ['tahmini ilk 5'] : []);
        const s = {
          tip: sc.tip, k: sc.tip + '|' + gr.id + '|' + sc.N, secim: satir.secim, pazarAd: TIP[sc.tip].ad,
          bil: sc.bil, p, pHam, evBot, ic, guven, gerekce, N: sc.N, oyuncu: o.ad, oyuncuId: gr.id, takimAd, ad: sc.ad, bagli, tahmin
        };
        if (!enIyi[sc.tip] || s.p > enIyi[sc.tip].p) enIyi[sc.tip] = s;
      });
      Object.values(enIyi).forEach(s => sinyaller.push(s));
    });
    // Piyasa uyum kontrolü: bot bir takımın oranlarının çoğunda Bilyoner'den aynı yöne çok sapıyorsa o takımın hesabına güvenme
    const uyarilar = [], sapanTakim = {};
    ['A', 'B'].forEach(t => {
      const fark = tum.filter(r => r.tk === t).map(r => r.p - r.pImp).sort((a, b) => a - b);
      if (fark.length < 6) return;
      const med = fark[Math.floor(fark.length / 2)];
      if (Math.abs(med) >= 0.12) {
        sapanTakim[t] = true;
        uyarilar.push((t === 'A' ? ev : dep) + ': bot oranların çoğunda Bilyoner\'den ortalama ' + Math.round(Math.abs(med) * 100) + ' puan ' + (med < 0 ? 'düşük' : 'yüksek') + ' görüyor. Büyük ihtimalle dakika/kadro hesabım yanlış, bu takımdan sinyal verilmedi.');
      }
    });
    for (let i = sinyaller.length - 1; i >= 0; i--) if (sapanTakim[sinyaller[i].takimAd === ev ? 'A' : 'B']) sinyaller.splice(i, 1);
    const sira = { yuksek: 0, orta: 1 };
    sinyaller.sort((a, b) => (sira[a.guven] - sira[b.guven]) || (b.p - a.p));
    // Aynı oyuncudan en fazla 2 sinyal; aynı varsayıma dayanan sinyaller işaretlenir
    const oyuncuSay = {}, varsayimGor = {}, secilen = [];
    sinyaller.forEach(s => {
      if (secilen.length >= MAC_BASI) return;
      oyuncuSay[s.oyuncuId] = (oyuncuSay[s.oyuncuId] || 0) + 1;
      if (oyuncuSay[s.oyuncuId] > 2) return;
      if (oyuncuSay[s.oyuncuId] === 2) s.gerekce.push('⚠️ Aynı oyuncudan ikinci sinyal: ikisi birbirine bağlı, biri tutmazsa diğeri de zorlanır.');
      const key = s.bagli.slice().sort().join(',');
      if (key) {
        if (varsayimGor[key]) { s.gerekce.push('⚠️ Bu sinyal de "' + s.bagli.join(', ') + '" varsayımına dayanıyor; aynı varsayıma bağlı birden fazla bahis alırsan risk katlanır.'); if (s.guven === 'yuksek') s.guven = 'orta'; }
        varsayimGor[key] = true;
      }
      secilen.push(s);
    });
    secilen.sort((a, b) => (sira[a.guven] - sira[b.guven]) || (b.p - a.p));
    const kesinMi = kesin || elle;
    secilen.forEach(s => Object.assign(s, { id: mac.id + '|' + s.k, ssId: mac.id, bid: bm.bid, macAd, ts: mac.ts, lig: bm.lig || mac.lig || '', kesin: kesinMi, elle }));
    const secIds = {};
    secilen.forEach(s => { secIds[s.id] = s.guven; });
    tum.forEach(r => { if (secIds[r.id]) r.durum = 'sinyal'; });
    golgeListe.forEach(g => { if (secIds[g.i]) g.g = secIds[g.i]; });
    // Maç başladıktan sonra yapılan analiz gölge kayda girmez (kadroyu görerek "tahmin" etmiş olur)
    if (kesinMi && (!mac.durum || mac.durum === 'notstarted')) golgeEkle(golgeListe);
    const rot = {
      ev: rotasyonOzet(ev, MA, OA, DA, proj[0].A, pzA, savA, etkiEv, ipA),
      dep: rotasyonOzet(dep, MB, OB, DB, proj[0].B, pzB, savB, etkiDep, ipB)
    };
    return {
      durum: 'tamam', kesin: kesinMi, elle, sinyaller: secilen, supheli,
      mac: {
        key: String(mac.id), bid: bm.bid, ev, dep, macAd, ts: mac.ts, lig: bm.lig || mac.lig || '', ligTur: mac.ligTur, kesin: kesinMi, elle, kadroYazi, senYazi, rot, uyari: uyarilar.join(' '),
        kadroVar: kadro.var, tum: tum.sort((a, b) => b.ev - a.ev).slice(0, 80), sonKontrol: Date.now(), takimlar: [mac.evId, mac.depId], espnNot,
        uzatma: pOT, sinyaller: secilen, aday: secilen.length, supheli: supheli.slice(0, 4)
      }
    };
  }
  function rotasyonOzet(ad, maclar, O, D, pr, pz, sav, rakipEt, ipucu) {
    const eksik = [], eksikAd = [], belirsiz = [], donen = [], uzun = [];
    Object.keys(D).forEach(id => {
      const d = D[id], o = O[id];
      if (d.kucuk) return;
      if (d.a === 1 && d.uzun) uzun.push(o.ad);
      else if (d.a === 1) { eksik.push(o.ad + (d.kaynak ? ' (' + d.kaynak + ')' : '')); eksikAd.push(o.ad); }
      else if (d.a === '?') belirsiz.push(o.ad + (d.kaynak ? ' (' + d.kaynak + ')' : ''));
    });
    const ilkSet = new Set((pr.ilk5 && pr.ilk5.ids) || []);
    const satirlar = Object.values(pr.P).sort((a, b) => ((ilkSet.has(b.o.id) ? 1 : 0) - (ilkSet.has(a.o.id) ? 1 : 0)) || (b.dk - a.dk)).slice(0, 10).map(x => ({
      ad: x.o.ad, rol: x.o.rol, ilk: ilkSet.has(x.o.id), slot: x.bugunSlot, normalSlot: x.normalSlot,
      dk0: x.o.dk, dk1: x.dk, pts0: x.o.ort.pts, pts1: x.mu.pts, reb0: x.o.ort.reb, reb1: x.mu.reb, ast0: x.o.ort.ast, ast1: x.mu.ast
    }));
    const etki = {};
    Object.values(pr.P).forEach(x => x.kanit.forEach(k => {
      const e = (k.a - k.f) * k.dDk, r = k.rho.pts || 1;
      if (Math.abs(e) < 1.5 && Math.abs((k.a - k.f) * (r - 1)) < 0.08 && !(k.ilk0 !== null && k.ilk1 !== null && Math.abs(k.ilk0 - k.ilk1) >= 0.5)) return;
      const g = etki[k.X] || (etki[k.X] = { ad: k.ad, a: k.a, f: k.f, liste: [] });
      g.liste.push({ ad: x.o.ad, dDk: k.dDk, r, rr: k.rho.reb || 1, ra: k.rho.ast || 1, n0: k.n0, guc: k.guc, ilk: k.ilk0 !== null && k.ilk1 !== null ? k.ilk0 - k.ilk1 : 0 });
    }));
    Object.values(O).forEach(o => {
      const d = D[o.id];
      if (d && d.a === 0 && o.oyn.length) {
        let k = 0; for (let i = 0; i <= Math.min(7, o.ilkIdx); i++) if (!(o.s[i] && o.s[i].dk > 0)) k++;
        if (k >= 3 && o.dk >= 15) donen.push(o.ad + ' (son 8 maçta ' + k + ' kez yoktu)');
      }
    });
    const etkiler = Object.values(etki).map(g => ({
      baslik: g.ad + (g.a === 1 ? ' yokken' : ' dönüyor'),
      liste: g.liste.sort((a, b) => Math.abs(b.dDk) - Math.abs(a.dDk)).slice(0, 4).map(y => y.ad + ' ' + isaretliSayi(y.dDk) + ' dk, sayı/dk ' + isaretli(y.r - 1) +
        (Math.abs(y.rr - 1) >= 0.08 ? ', ribaund/dk ' + isaretli(y.rr - 1) : '') + (Math.abs(y.ra - 1) >= 0.08 ? ', asist/dk ' + isaretli(y.ra - 1) : '') +
        (y.ilk >= 0.5 ? ', ilk 5\'e çıkıyor' : '') + ' (' + y.guc + ', ' + y.n0 + ' maç)')
    }));
    // İlk 5 yapısı: kaç uzun oyuncu (boy ölçeği ≥ 3,9) başlıyor
    const uzunSay = ids => ids.filter(id => O[id] && O[id].boyut >= 3.9).length;
    let yapi = '';
    if (ilkSet.size === 5) {
      const gecmis = maclar.slice(0, 10).map(m => m.B.filter(r => r.ilk === 1)).filter(a => a.length === 5).map(a => uzunSay(a.map(r => r.id)));
      const bugun = uzunSay([...ilkSet]);
      if (gecmis.length >= 3) {
        const nr = mean(gecmis);
        yapi = 'İlk 5 yapısı: bugün ' + bugun + ' uzun (normalde ' + v1(nr) + ')' + (bugun <= nr - 0.6 ? ' → daha küçük beşli: kalan uzunlara daha çok ribaund, guardlara daha çok top düşer' : bugun >= nr + 0.6 ? ' → daha uzun beşli: ribaund paylaşılır, kanatlar daha az şut bulabilir' : ' → normal yapı');
      } else yapi = 'İlk 5 yapısı: bugün ' + bugun + ' uzun';
    }
    const savNot = [];
    if (sav) Object.keys(sav).forEach(gr => {
      const l = ['pts', 'reb', 'ast', 'tpm'].filter(s => sav[gr][s] && Math.abs(sav[gr][s] - 1) >= 0.06).map(s => STAT_AD[s] + ' ' + isaretli(sav[gr][s] - 1));
      if (l.length) savNot.push(GRUP_YON[gr] + ': ' + l.join(', '));
    });
    return {
      ad, eksik, eksikAd, belirsiz, donen, uzun, satirlar, etkiler, tahmini: pr.yedekDagit, kopma: pr.kopma, mac: maclar.length, atilan: maclar.atilan || 0,
      yapi, savNot, rakipNot: rakipEt ? rakipEt.notlar : [], pozKaynak: pz ? pz.kaynak : { pbp: 0, ilk5: 0 }, ilk5Kesin: !!(pr.ilk5 && pr.ilk5.kesin), ipucu: ipucu || []
    };
  }

  // ---------- Tarama ----------
  let taraniyor = false, durdur = false, takipCalisiyor = false;
  const UYUMLU = ['1.1', '1.2', '1.3', SURUM];   // biçimi aynı olan sürümlerin taraması geçerli sayılır
  const sonAl = () => { const s = GM_getValue('bo_son', null); return s && UYUMLU.indexOf(s.surum) >= 0 ? s : null; };
  const sonYaz = x => GM_setValue('bo_son', Object.assign({ surum: SURUM }, x));
  const tumSinyaller = son => [].concat(...((son && son.maclar) || []).map(m => m.sinyaller || []));
  const basketSayfaId = () => (location.pathname.match(/mac-karti\/basketbol\/(\d+)/) || [])[1] || null;
  const pencereYazi = () => Number(ayar.pencere) >= 24 ? 'bütün gün' : ayar.pencere + ' saat';
  async function tara(tekBid) {
    if (taraniyor) return;
    taraniyor = true; durdur = false; C = {}; ssKisit = false; ssSay = 0; pozHatalar.length = 0;
    const ozet = { mac: 0, tamam: 0, kesin: 0, pazaryok: 0, lig: 0, hata: 0, hatalar: [], baglanacak: [] };
    const maclar = [];
    try {
      let liste;
      if (tekBid) liste = [{ bid: tekBid, ev: '', dep: '', ts: 0, lig: '', tek: true }];
      else {
        ilerleme('Basketbol maç listesi okunuyor…');
        const b = await basketBulteni();
        const simdi = simdiSn(), son = simdi + Number(ayar.pencere) * 3600;
        const zamanda = b.filter(x => x.ts === 0 || (x.ts > simdi + 60 && x.ts <= son));
        liste = zamanda.filter(x => ligIzinli(x.lig)).sort((a, c) => a.ts - c.ts);
        ozet.lig = zamanda.length - liste.length;
        if (!liste.length) throw new Error('Önümüzdeki ' + pencereYazi() + ' içinde başlayacak ' + (ayar.ligler === 'hepsi' ? '' : 'NBA / EuroLeague ') + 'basketbol maçı bulunamadı.' + (ozet.lig ? ' (Başka liglerde ' + ozet.lig + ' maç var; ayarlardan "Bütün ligler"i seçebilirsin.)' : ''));
      }
      for (let i = 0; i < liste.length; i++) {
        if (durdur) break;
        const m = liste[i];
        const baslik = (i + 1) + '/' + liste.length + ' · ' + h(m.ev ? m.ev + ' - ' + m.dep : 'maç okunuyor');
        const yaz = alt => ilerleme(baslik + (alt ? '<br><span class="bo-k">' + h(alt) + '</span>' : '') + '<br>Sofascore isteği: ' + ssSay + ' · şimdiye kadar ' + tumSinyaller({ maclar }).length + ' sinyal' +
          '<br><span class="bo-k">İlk taramada her takımın son ' + ARSIV_MAC + ' maçı ve oyun akışları indirilir, sonra telefonda saklanır. Sonraki taramalar çok daha hızlı olur.</span>');
        yaz('');
        ozet.mac++;
        try {
          const r = await macAnaliz(m, yaz);
          if (r.durum === 'tamam') { ozet.tamam++; if (r.kesin) ozet.kesin++; maclar.push(r.mac); }
          else if (r.durum === 'pazaryok') ozet.pazaryok++;
          else if (r.durum === 'lig') ozet.lig++;
          else if (r.durum === 'veriaz') { ozet.hata++; ozet.hatalar.push((r.macAd || '') + ': Sofascore\'da yeterli maç verisi yok' + (r.atilan ? ' (' + r.atilan + ' maçın dakika verisi bozuk olduğu için atıldı)' : '')); }
          else if (r.durum === 'basladi' && tekBid) ozet.hatalar.push((r.macAd || '') + ': maç başlamış');
        } catch (e) {
          ozet.hata++;
          ozet.hatalar.push((m.ev ? m.ev + ' - ' + m.dep + ': ' : '') + e.message);
          (e.takim || []).forEach(t => { if (t && ozet.baglanacak.indexOf(t) < 0) ozet.baglanacak.push(t); });
        }
        arsivKaydet(); pozKaydet(); golgeKaydet();
      }
      const onceki = GM_getValue('bo_son', null);
      let tum = maclar;
      if (tekBid && onceki && UYUMLU.indexOf(onceki.surum) >= 0) tum = (onceki.maclar || []).filter(x => !maclar.some(y => y.key === x.key) && x.ts > simdiSn() - 3 * 3600).concat(maclar).sort((a, c) => a.ts - c.ts);
      oranlariGuncelleKayit(tumSinyaller({ maclar }));
      sonYaz({ zaman: Date.now(), ozet, maclar: tum, durduruldu: durdur, tek: !!tekBid, kisit: ssKisit, pencere: ayar.pencere, pozHata: pozHatalar.slice(0, 4) });
      sinyalSekmesi();
      arkaPlanIsleri(maclar);
    } catch (e) {
      panelIcerik(sekmeHtml('sinyal') + '<div class="bo-hata">❌ ' + h(e.message) + '</div>' + ayarHtml());
    } finally {
      arsivKaydet(); pozKaydet(); golgeKaydet();
      taraniyor = false;
    }
  }
  // Tarama sonrası: biten maçların gölge kayıtlarını sonuçlandır, günde bir kez kendini sına
  async function arkaPlanIsleri(maclar) {
    try { await golgeCoz(12); } catch (e) {}
    try {
      const k = kalAl();
      if (k && Date.now() - k.z < 20 * 3600000) return;
      const tidler = [...new Set([].concat(...maclar.map(m => m.takimlar || [])))].slice(0, 6);
      if (tidler.length) await kendiniSina(tidler, null);
    } catch (e) {}
  }
  // Birden fazla Bilyoner sekmesi açıksa takibi sadece biri yapsın (çift bildirim olmasın)
  const SEKME = Math.random().toString(36).slice(2);
  function takipKilidi() {
    const k = GM_getValue('bo_takipKilit', null);
    if (k && k.id !== SEKME && Date.now() - k.z < 150000) return false;
    GM_setValue('bo_takipKilit', { id: SEKME, z: Date.now() });
    return true;
  }
  // Kadro takibi: Bilyoner açıkken, kadrosu kesinleşmemiş ve 90 dk içinde başlayacak maçlara 10 dakikada bir bak
  async function takipKontrol() {
    if (!ayar.takip || taraniyor || takipCalisiyor) return;
    if (!takipKilidi()) return;
    const son = sonAl();
    if (!son) return;
    const simdi = simdiSn();
    const aday = (son.maclar || []).filter(m => !m.kesin && !m.basladi && m.bid && m.ts - simdi <= 90 * 60 && m.ts - simdi > -10 * 60 && Date.now() - (m.sonKontrol || 0) > 10 * 60000)
      .sort((a, b) => a.ts - b.ts)[0];
    if (!aday) return;
    takipCalisiyor = true;
    try {
      delete C['bk|' + aday.key];
      C.__sakat = null;
      ssKisit = false;
      let r = null;
      try { r = await macAnaliz({ bid: aday.bid, ev: aday.ev, dep: aday.dep, ts: aday.ts, lig: aday.lig, tek: true, takip: true }, null); }
      catch (e) { r = null; }
      arsivKaydet(); pozKaydet(); golgeKaydet();
      const s2 = sonAl();
      if (!s2) return;
      const i = (s2.maclar || []).findIndex(m => m.key === aday.key);
      if (i < 0) return;
      const eski = s2.maclar[i];
      if (r && r.durum === 'tamam') {
        s2.maclar[i] = r.mac;
        const yeniEksik = ['ev', 'dep'].map(t => (r.mac.rot[t].eksikAd || []).filter(x => (eski.rot && eski.rot[t] && eski.rot[t].eksikAd || []).indexOf(x) < 0)).reduce((a, b) => a.concat(b), []);
        // Bir kaynak (ESPN, Sofascore kadrosu) bu sefer cevap vermediyse "yeni eksik" uyarısı yanıltıcı olur
        const kaynakDustu = (r.mac.espnNot && !eski.espnNot) || (eski.kadroVar && !r.mac.kadroVar);
        if (r.kesin && !eski.kesin) {
          const sn = r.mac.sinyaller || [];
          bildir('✅ Kadro kesinleşti: ' + r.mac.macAd, sn.length ? sn.length + ' sinyal: ' + sn.map(s => s.secim + ' @' + v2(s.bil)).join(' · ') : 'Şartları sağlayan sinyal çıkmadı.');
        } else if (yeniEksik.length && !kaynakDustu) bildir('🚑 Yeni eksik: ' + r.mac.macAd, yeniEksik.join(', ') + ' oynamayacak görünüyor. Kadro henüz kesin değil.');
        oranlariGuncelleKayit(r.mac.sinyaller || []);
      } else if (r && r.durum === 'basladi') { eski.basladi = true; eski.sonKontrol = Date.now(); }
      else eski.sonKontrol = Date.now();
      GM_setValue('bo_son', s2);
      const p = document.getElementById('bo-panel');
      if (p && p.style.display === 'block' && p.__gorunum === 'sinyal' && !taraniyor) sinyalSekmesi();
    } finally { takipCalisiyor = false; }
  }
  // Bildirim: ekranda kutu + titreşim + (izin varsa) kısa ses
  let sesBaglam = null;
  function sesHazirla() {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!sesBaglam && AC) sesBaglam = new AC();
      if (sesBaglam && sesBaglam.state === 'suspended') sesBaglam.resume();
    } catch (e) {}
  }
  function bip() {
    try {
      if (!sesBaglam) return;
      const o = sesBaglam.createOscillator(), g = sesBaglam.createGain();
      o.frequency.value = 880; g.gain.value = 0.15;
      o.connect(g); g.connect(sesBaglam.destination);
      o.start(); o.stop(sesBaglam.currentTime + 0.35);
    } catch (e) {}
  }
  function bildir(baslik, metin) {
    let d = document.getElementById('bo-bildirim');
    if (!d) {
      d = document.createElement('div');
      d.id = 'bo-bildirim';
      document.body.appendChild(d);
      d.addEventListener('click', () => { d.style.display = 'none'; if (!taraniyor) sinyalSekmesi(); });
    }
    d.innerHTML = '<b>' + h(baslik) + '</b><div>' + h(metin) + '</div><div style="font-size:11px;opacity:.8;margin-top:4px">Dokun: sinyalleri aç</div>';
    d.style.display = 'block';
    const bb = document.getElementById('bo-btn');
    if (bb) bb.classList.add('bo-uyari');
    try { if (navigator.vibrate) navigator.vibrate([250, 120, 250]); } catch (e) {}
    if (ayar.ses) bip();
    clearTimeout(bildir.t);
    bildir.t = setTimeout(() => { d.style.display = 'none'; }, 30000);
  }

  // ---------- Veri kontrolü ----------
  async function veriKontrol() {
    const satir = [];
    const yaz = t => { satir.push(t); panelIcerik('<div class="bo-durum">🔍 Veri kontrolü</div><pre class="bo-pre">' + h(satir.join('\n')) + '</pre>'); };
    const dene = async (ad, f) => { try { await f(); } catch (e) { yaz('❌ ' + ad + ': ' + e.message); } };
    C = {}; ssKisit = false; ssSay = 0;
    yaz('Basket Oyuncu Sinyal ' + SURUM + ' · ' + new Date().toLocaleString('tr-TR') + ' · ligler: ' + (ayar.ligler === 'hepsi' ? 'hepsi' : 'NBA + EuroLeague'));
    let bid = basketSayfaId(), bo = null, mac = null, secilen = null;
    await dene('Bilyoner', async () => {
      if (!bid) {
        yaz('Bu sayfa bir basketbol maçı değil, bültenden maç alınıyor…');
        const b = await basketBulteni();
        const uygun = b.filter(x => ligIzinli(x.lig) && (!x.ts || x.ts > simdiSn()));
        yaz('Bülten: ' + b.length + ' basketbol maçı · seçili liglerde: ' + uygun.length + ' · ligler: ' + [...new Set(b.map(x => x.lig))].slice(0, 8).join(', '));
        secilen = uygun.sort((a, c) => a.ts - c.ts)[0] || b[0];
        bid = secilen && secilen.bid;
      }
      if (!bid) throw new Error('Kontrol edilecek maç yok');
      bo = await bilyonerVeri(bid);
      yaz('✅ Bilyoner maç ' + bid + ': ' + bo.ev + ' - ' + bo.dep + ' · ' + bo.oranlar.length + ' oran');
      const say = {};
      bo.oranlar.forEach(o => { const t = oyuncuPazarTipi(o.pazar); if (t) say[t] = (say[t] || 0) + 1; });
      yaz('Oyuncu pazarları: ' + (Object.keys(say).map(t => TIP[t].ad + ' ' + say[t]).join(', ') || 'YOK'));
      const pi = piyasaOku(bo.oranlar, bo.ev, bo.dep);
      yaz('Maç senaryosu: toplam ' + (pi.T ? v1(pi.T) : '-') + ' · ev ' + (pi.muA ? v1(pi.muA) : '-') + ' · dep ' + (pi.muB ? v1(pi.muB) : '-') + ' (' + (pi.kaynak || 'yok') + ')');
      yaz('Takım çizgileri: ev ' + JSON.stringify(pi.takim.ev) + ' · dep ' + JSON.stringify(pi.takim.dep));
    });
    if (bo) await dene('Sofascore maç', async () => {
      mac = await ssMacBul(bo.ev, bo.dep, secilen ? secilen.ts : 0);
      yaz('✅ Sofascore maç: ' + mac.id + ' · ' + mac.evSsAd + ' - ' + mac.depSsAd + ' · ' + new Date(mac.ts * 1000).toLocaleString('tr-TR') + ' · ' + mac.lig + ' (' + mac.ligTur + ') · durum ' + mac.durum);
    });
    if (mac) {
      await dene('Sofascore son maç kutusu', async () => {
        const v = await ssAl('/team/' + mac.evId + '/events/last/0');
        const bitmis = (v.events || []).filter(bittiMi).sort((a, b) => b.startTimestamp - a.startTimestamp);
        yaz('Ev sahibinin biten maçları (1. sayfa): ' + bitmis.length + (bitmis[0] ? ' · son maç: ' + turnuvaAdi(bitmis[0]) : ''));
        if (!bitmis[0]) return;
        const lu = await ssAl('/event/' + bitmis[0].id + '/lineups');
        const pl = (lu.home && lu.home.players) || [];
        yaz('Son maç kadrosu (' + bitmis[0].id + '): ev ' + pl.length + ' oyuncu, dep ' + (((lu.away && lu.away.players) || []).length) + ' oyuncu · ilk 5 işaretli: ' + pl.filter(x => x.substitute === false).length);
        const ilk = pl.find(x => x.statistics && Object.keys(x.statistics).length) || pl[0];
        if (ilk) {
          yaz('Örnek oyuncu: ' + ((ilk.player || {}).name) + ' · pozisyon ' + (ilk.position || (ilk.player || {}).position || '-') + ' · substitute=' + ilk.substitute);
          yaz('İstatistik alanları: ' + Object.keys(ilk.statistics || {}).join(', '));
          yaz('Okunan: ' + JSON.stringify(istatOku(ilk.statistics)));
        }
        yaz('Eksik oyuncu listesi alanı: ' + (lu.home && lu.home.missingPlayers ? lu.home.missingPlayers.length + ' kişi' : 'yok'));
      });
      await dene('Bugünkü kadro', async () => {
        const k = await bugunKadro(mac.id);
        const sat = t => t.oyuncular.length + ' oyuncu, ilk 5: ' + t.ilk.length + ', eksik ' + t.eksik.length + (t.eksik.length ? ' (' + t.eksik.slice(0, 4).map(x => x.ad + ' ' + x.tur + (x.neden ? ' ' + x.neden : '')).join('; ') + ')' : '');
        yaz('Bugünkü maç kadrosu: ' + (k.var ? 'var · kesin=' + k.kesin + ' · ev ' + sat(k.home) + ' · dep ' + sat(k.away) : 'henüz yok (normal, genelde maça yakın açıklanır)'));
      });
      await dene('Sofascore takım kadrosu', async () => {
        const t = await ssTakimKadrosu(mac.evId);
        yaz('Sofascore güncel takım kadrosu (ev): ' + (t ? t.size + ' oyuncu' : 'alınamadı (takımdan ayrılan oyuncu kontrolü yapılmayacak)'));
      });
    }
    // EuroLeague resmi verisi (maç EuroLeague değilse de bağlantı denenir)
    await dene('EuroLeague', async () => {
      const sc = elSezon(mac ? mac.ts : simdiSn());
      const liste = await elOyunlar(sc);
      yaz('✅ EuroLeague ' + sc + ' maç listesi: ' + liste.length + ' maç' + (C.__elOrnek ? ' · alanlar: ' + C.__elOrnek : ''));
      if (mac && mac.ligTur === 'EL') {
        const bugun = liste.filter(x => Math.abs(x.ts - mac.ts) < 36 * 3600)
          .map(x => ({ x, p: takimBenzer(mac.evSsAd, x.ev) + takimBenzer(mac.depSsAd, x.dep) })).sort((a, b) => b.p - a.p)[0];
        yaz('Bugünkü maç EuroLeague listesinde: ' + (bugun && bugun.p >= 2 ? 'kod ' + bugun.x.kod + ' · ' + bugun.x.ev + ' - ' + bugun.x.dep : 'BULUNAMADI'));
      }
      const once = liste.filter(x => x.ts < simdiSn() - 4 * 3600).sort((a, b) => b.ts - a.ts)[0];
      if (!once) { yaz('EuroLeague: bu sezon biten maç yok henüz'); return; }
      const [box, pbp] = await Promise.all([elJson(EL_LIVE + '/Boxscore?gamecode=' + once.kod + '&seasoncode=' + sc), elJson(EL_LIVE + '/PlayByPlay?gamecode=' + once.kod + '&seasoncode=' + sc)]);
      const k = elKutu(box), ol = elOlaylar(pbp);
      yaz('Örnek biten maç (kod ' + once.kod + ', ' + once.ev + ' - ' + once.dep + '): ' + (Object.keys(k).map(t => t + ' ' + k[t].oyuncular.length + ' oyuncu, ilk 5: ' + k[t].oyuncular.filter(p => p.ilk).length).join(' / ') || 'kutu boş · alanlar: ' + Object.keys(box || {}).slice(0, 12).join(', ')));
      yaz('Oyun akışı: ' + ol.length + ' olay · giren/çıkan: ' + ol.filter(o => o.tur === 'IN' || o.tur === 'OUT').length + ' · istatistik olayı: ' + ol.filter(o => o.tur === 'st').length + ' · periyot: ' + (ol.length ? ol[ol.length - 1].per : 0) +
        (pbp && Array.isArray(pbp.FirstQuarter) && pbp.FirstQuarter[0] ? '' : ' · alanlar: ' + Object.keys(pbp || {}).slice(0, 12).join(', ')));
    });
    // ESPN (NBA)
    await dene('ESPN', async () => {
      const T = await espnTakimlar();
      yaz('✅ ESPN takım listesi: ' + T.length);
      let tA = null;
      if (mac && mac.ligTur === 'NBA') {
        tA = espnTakimEs(mac.evSsAd, T);
        const tB = espnTakimEs(mac.depSsAd, T);
        yaz('ESPN eşleşme: ' + (tA ? tA.ad : 'YOK') + ' / ' + (tB ? tB.ad : 'YOK'));
      }
      const sak = await espnSakat();
      yaz('ESPN sakatlık raporu: ' + sak.length + ' oyuncu' + (sak.length ? ' · örnek: ' + sak.slice(0, 3).map(x => x.ad + ' (' + x.takim + ') ' + x.durum).join('; ') : ''));
      if (tA) { const r = await espnKadroPoz(tA.id); yaz('ESPN kadro ' + tA.ad + ': ' + r.length + ' oyuncu · ' + r.slice(0, 5).map(x => x.ad + ' ' + x.poz).join(', ')); }
      let gun = [];
      for (const g of [espnTarih(simdiSn() - 86400), espnTarih(simdiSn() - 2 * 86400)]) { gun = (await espnGun(g)).filter(x => x.bitti); if (gun.length) break; }
      if (!gun.length) { yaz('ESPN son iki günde biten NBA maçı yok (sezon başlamamış olabilir)'); return; }
      const e = gun[0];
      const oz = await espnJson('/summary?event=' + e.id, 45000);
      const r = espnOlaylar(oz);
      yaz('Örnek maç özeti (' + e.id + '): ' + Object.keys(r.sporcu).length + ' oyuncu · ilk 5: ' + Object.values(r.ilk).map(a => a.length).join('/') + ' · olay ' + r.olaylar.length + ' · giren/çıkan ' + r.olaylar.filter(o => o.tur === 'IN' || o.tur === 'OUT').length);
      const ornek = (oz.plays || []).find(p => /substitution/i.test((p.type || {}).text || ''));
      yaz(ornek ? 'Örnek değişiklik: "' + ornek.text + '" · katılımcı: ' + (ornek.participants || []).length : 'Oyun akışında değişiklik kaydı yok · alanlar: ' + Object.keys(oz || {}).slice(0, 15).join(', '));
    });
    const A = arsiv();
    yaz('Arşiv: ' + Object.keys(A).length + ' maç (EuroLeague ' + Object.keys(A).filter(k => A[k].l && ligTuru(A[k].l) === 'EL').length + ', NBA ' + Object.keys(A).filter(k => A[k].l && ligTuru(A[k].l) === 'NBA').length + ')');
    await dene('Flashscore (deneysel)', async () => {
      const t = await fsFeed('f_3_0_3_tr_1');
      const ms = feedCoz(t).filter(o => o.AA && o.AE && o.AF);
      yaz('✅ Flashscore günlük basket listesi: ' + ms.length + ' maç');
      const es = bo ? ms.find(o => takimBenzer(bo.ev, o.AE) >= 1 && takimBenzer(bo.dep, o.AF) >= 1) : null;
      if (!es) { yaz('Flashscore\'da bu maç bulunamadı (isimler farklı olabilir)'); return; }
      yaz('Flashscore maç: ' + es.AA + ' · ' + es.AE + ' - ' + es.AF);
      try {
        const k = feedCoz(await fsFeed('df_li_1_' + es.AA));
        yaz('Flashscore kadro verisi: ' + k.length + ' kayıt · anahtarlar: ' + [...new Set([].concat(...k.slice(0, 30).map(o => Object.keys(o))))].slice(0, 25).join(','));
      } catch (e) { yaz('Flashscore kadro verisi: ' + e.message); }
    });
    const P = pozTablo(), pk = Object.values(P);
    yaz('Pozisyon kayıtları: ' + pk.length + ' (EuroLeague ' + pk.filter(x => x.k === 'EL').length + ', ESPN ' + pk.filter(x => x.k === 'ESPN').length + ', bulunamayan ' + pk.filter(x => x.k === 'yok').length + ', hatalı ' + pk.filter(x => x.k === 'hata').length + ')' +
      (pk.filter(x => x.k === 'hata').slice(-2).map(x => ' · ' + x.neden).join('')));
    const G = genelSlotEtki();
    yaz('Genel numara etkisi (' + G.n + ' oyuncu): ribaund ' + G.reb.map(v => v2(v)).join('/') + ' · asist ' + G.ast.map(v => v2(v)).join('/'));
    const g = golgeAl();
    yaz('Gölge kayıt: ' + g.length + ' (sonuçlanan ' + g.filter(x => x.r === 0 || x.r === 1).length + ', bekleyen ' + g.filter(x => x.r == null).length + ')');
    const k = kalAl();
    yaz('Kendini sınama: ' + (k ? zamanYaz(k.z) + ' · katsayı ' + v2(k.c) + ' · ' + k.n + ' örnek' : 'henüz yapılmadı'));
    yaz('Sofascore istek sayısı: ' + ssSay + (ssKisit ? ' · SINIR KONDU' : ''));
    yaz('✅ Kontrol bitti');
    const p = panel();
    p.insertAdjacentHTML('beforeend', '<div class="bo-ayar"><button data-islem="kopyalaKontrol">📋 Kopyala</button><button data-sekme="sinyal">↩ Geri</button></div>');
    p.__kontrol = satir.join('\n');
    p.__gorunum = 'kontrol';
  }

  // ---------- Kayıtlar (sadece senin 💾 ile eklediklerin) ----------
  const kayitAl = () => GM_getValue('bo_kayitlar', []);
  const kayitYaz = k => GM_setValue('bo_kayitlar', k);
  const kayitliMi = id => kayitAl().some(x => x.id === id);
  function kaydet(s) {
    const k = kayitAl();
    if (k.some(x => x.id === s.id)) return false;
    const kopya = JSON.parse(JSON.stringify(s));
    kopya.kayitZaman = Date.now(); kopya.sonuc = null; kopya.sonOran = s.bil;
    k.unshift(kopya);
    kayitYaz(k);
    return true;
  }
  const kayitSil = id => kayitYaz(kayitAl().filter(x => x.id !== id));
  function sonucYaz(id, sonuc) { const k = kayitAl(), x = k.find(y => y.id === id); if (x) { x.sonuc = sonuc; kayitYaz(k); } }
  // Kapanış oranı takibi: kayıtlı seçimin Bilyoner'deki son oranı
  function oranlariGuncelleKayit(sinyaller) {
    const k = kayitAl();
    let degisti = false;
    sinyaller.forEach(s => { const x = k.find(y => y.id === s.id && !y.sonuc && y.ts > simdiSn()); if (x && x.sonOran !== s.bil) { x.sonOran = s.bil; x.sonOranZaman = Date.now(); degisti = true; } });
    if (degisti) kayitYaz(k);
  }
  async function bekleyenOranlariGuncelle() {
    const k = kayitAl();
    const gruplar = {};
    k.filter(x => !x.sonuc && x.ts > simdiSn() && x.bid).forEach(x => { (gruplar[x.bid] = gruplar[x.bid] || []).push(x); });
    let n = 0;
    for (const bid of Object.keys(gruplar)) {
      try {
        const bo = await bilyonerVeri(bid);
        gruplar[bid].forEach(x => {
          const o = bo.oranlar.find(q => { if (oyuncuPazarTipi(q.pazar) !== x.tip) return false; const m = secimCoz(q.n); return m && m.N === x.N && isimPuan(m.ad, x.ad) >= 2; });
          if (o) { x.sonOran = o.val; x.sonOranZaman = Date.now(); n++; }
        });
      } catch (e) {}
    }
    kayitYaz(k);
    return n;
  }
  async function sonuclariKontrol() {
    const k = kayitAl();
    const bekleyen = k.filter(x => !x.sonuc && x.ssId && x.ts && simdiSn() > x.ts + 2.5 * 3600);
    const gruplar = {};
    bekleyen.forEach(x => { (gruplar[x.ssId] = gruplar[x.ssId] || []).push(x); });
    let yeni = 0;
    for (const eid of Object.keys(gruplar)) {
      try {
        const ev = await ssAl('/event/' + eid);
        const e = ev.event || ev;
        const tur = e.status && e.status.type;
        if (tur === 'canceled' || tur === 'postponed') { gruplar[eid].forEach(x => { sonucYaz(x.id, { durum: 'iade', neden: 'ertelendi', zaman: Date.now() }); yeni++; }); continue; }
        if (tur !== 'finished') continue;
        const lu = await ssAl('/event/' + eid + '/lineups');
        const tum = ((lu.home && lu.home.players) || []).concat((lu.away && lu.away.players) || []);
        if (bittiMi(e)) await maciArsivle(e);
        gruplar[eid].forEach(x => {
          const p = tum.find(y => String((y.player || {}).id) === String(x.oyuncuId));
          const st = p ? istatOku(p.statistics) : null;
          if (!st || !(st.sec > 0)) { sonucYaz(x.id, { durum: 'iade', neden: 'oynamadi', zaman: Date.now() }); yeni++; return; }
          const deger = TIP[x.tip].b.reduce((a, s) => a + (st[s] || 0), 0);
          sonucYaz(x.id, { durum: deger >= x.N ? 'tuttu' : 'tutmadi', deger, dk: Math.round(st.sec / 60), ilk: p.substitute === false ? 1 : p.substitute === true ? 0 : -1, zaman: Date.now() });
          yeni++;
        });
      } catch (e) {}
    }
    arsivKaydet();
    return yeni;
  }

  // ---------- Görünüm ----------
  const GUVEN_YAZI = { yuksek: '🔥 Yüksek güven', orta: '👍 Orta güven' };
  function saatYaz(ts) {
    const d = new Date(ts * 1000), b = new Date();
    const saat = d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
    return d.toDateString() === b.toDateString() ? saat : d.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit' }) + ' ' + saat;
  }
  const zamanYaz = ms => new Date(ms).toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit' }) + ' ' + new Date(ms).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
  const saatSadece = ms => ms ? new Date(ms).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }) : '-';
  function kartHtml(s, mod) {
    const on = mod === 'on' || (mod === 'kayit' && s.kesin === false);
    let html = '<div class="bo-kart bo-' + s.guven + (on ? ' bo-onkart' : '') + '">';
    html += '<div class="bo-mac">🏀 ' + h(s.macAd) + ' · ' + saatYaz(s.ts) + (s.lig ? ' · ' + h(s.lig) : '') + '</div>';
    html += '<div><b>' + h(s.secim) + '</b> · Bilyoner <b>' + v2(s.bil) + '</b> <span class="bo-rozet bo-r-' + s.guven + '">' + (s.guven === 'yuksek' ? 'Güven: yüksek' : 'Güven: orta') + '</span>' + (s.elle ? ' <span class="bo-rozet bo-r-elle">✋ elle doğrulandı</span>' : '') + (on ? ' <span class="bo-rozet bo-r-on">⏳ Ön sinyal</span>' : '') + '</div>';
    html += '<div class="bo-k">' + h(s.oyuncu) + ' · ' + h(s.takimAd) + '</div>';
    if (on && mod === 'on') html += '<div class="bo-k">⏳ Kadro henüz kesin değil' + (s.bagli && s.bagli.length ? ' · dayandığı varsayım: ' + h(s.bagli.join(', ')) : '') + '. Oyuncu hiç süre almazsa bahis iade olur.</div>';
    html += '<ul class="bo-gerekce">' + s.gerekce.map(g => '<li>' + h(g) + '</li>').join('') + '</ul>';
    if (mod === 'kayit') return html + kayitAltHtml(s) + '</div>';
    const var_ = kayitliMi(s.id);
    html += '<button class="bo-kbtn" data-kaydet="' + h(s.id) + '"' + (var_ ? ' disabled' : '') + '>' + (var_ ? '✔ Kaydedildi' : '💾 Kaydet') + '</button> ';
    html += '<button class="bo-kbtn" data-rot="' + h(s.ssId) + '">📋 Rotasyon</button>';
    return html + '</div>';
  }
  function sonucYazisi(r) {
    const s = r.sonuc;
    if (!s) return '⏳ Sonuç bekleniyor';
    if (s.durum === 'iade') return s.elle ? '↩️ İade (elle işaretlendi)' : s.neden === 'ertelendi' ? '↩️ İade · maç ertelendi/iptal' : '↩️ İade · hiç süre almadı';
    const ok = s.durum === 'tuttu' ? '✅ ' : '❌ ';
    if (s.elle) return ok + (s.durum === 'tuttu' ? 'Tuttu' : 'Tutmadı') + ' (elle işaretlendi)';
    return ok + s.deger + ' ' + TIP[r.tip].birim + (s.dk ? ' · ' + s.dk + ' dk' : '');
  }
  function kayitAltHtml(r) {
    let html = '<div class="bo-k">Kaydedildi ' + zamanYaz(r.kayitZaman) + '</div>';
    if (r.sonOran && r.sonOran !== r.bil) {
      const d = r.sonOran / r.bil - 1;
      html += '<div class="bo-k">Kapanış oranı: ' + v2(r.bil) + ' → ' + v2(r.sonOran) + ' (' + (d < 0 ? 'oran düştü ✓ doğru taraftasın' : 'oran yükseldi') + ')</div>';
    }
    const s = r.sonuc;
    const renk = !s ? '#fde047' : s.durum === 'tuttu' ? '#4ade80' : s.durum === 'tutmadi' ? '#f87171' : '#cbd5e1';
    html += '<div style="margin-top:3px;font-weight:bold;color:' + renk + '">Sonuç: ' + sonucYazisi(r) + '</div>';
    const kk = kayitKarne(r);
    if (kk) html += '<div class="bo-k">🔍 ' + h(karneSatir(kk)) + '</div>';
    html += '<div style="margin-top:5px">';
    const b = (d, y) => '<button class="bo-kbtn" data-elle="' + d + '" data-id="' + h(r.id) + '">' + y + '</button> ';
    if (!s) html += b('tuttu', '✅ Tuttu') + b('tutmadi', '❌ Tutmadı') + b('iade', '↩️ İade');
    return html + '<button class="bo-kbtn" data-sil="' + h(r.id) + '">🗑️ Sil</button></div>';
  }
  function ozet(liste) {
    const biten = liste.filter(r => r.sonuc && (r.sonuc.durum === 'tuttu' || r.sonuc.durum === 'tutmadi'));
    const tut = biten.filter(r => r.sonuc.durum === 'tuttu').length;
    const kar = biten.reduce((a, r) => a + (r.sonuc.durum === 'tuttu' ? r.bil - 1 : -1), 0);
    return { n: biten.length, tut, kar, roi: biten.length ? kar / biten.length : 0 };
  }
  function ozetSatir(ad, o) {
    if (!o.n) return '<div class="bo-k">' + ad + ': henüz sonuçlanan yok</div>';
    return '<div>' + ad + ': <b>' + o.tut + '/' + o.n + '</b> tuttu (' + yuzde(o.tut / o.n) + ') · <span class="' + (o.kar >= 0 ? 'bo-iyi' : 'bo-kotu') + '">' +
      (o.kar >= 0 ? '+' : '') + v2(o.kar) + ' birim (' + isaretli(o.roi) + ')</span></div>';
  }
  function raporHtml(k) {
    const bek = k.filter(r => !r.sonuc).length, iade = k.filter(r => r.sonuc && r.sonuc.durum === 'iade').length;
    let html = '<div class="bo-grup">📈 Senin kayıtların</div>' + ozetSatir('Hepsi', ozet(k)) +
      '<div class="bo-k">' + k.length + ' kayıt · ' + bek + ' bekliyor · ' + iade + ' iade · her sinyale 1 birim basılmış gibi</div>';
    html += '<div class="bo-grup2">Güvene göre</div>';
    ['yuksek', 'orta'].forEach(g => { if (k.some(r => r.guven === g)) html += ozetSatir(GUVEN_YAZI[g], ozet(k.filter(r => r.guven === g))); });
    html += '<div class="bo-grup2">Pazara göre</div>';
    Object.keys(TIP).forEach(t => { if (k.some(r => r.tip === t)) html += ozetSatir(TIP[t].ad, ozet(k.filter(r => r.tip === t))); });
    const clv = k.filter(r => r.sonOran && r.bil && r.sonOran !== r.bil);
    html += '<div class="bo-grup2">Kapanış oranı</div>';
    if (clv.length) {
      const dus = clv.filter(r => r.sonOran < r.bil).length;
      html += '<div>Kaydettiğin oran sonradan ' + clv.length + ' kayıtta değişti: <b>' + dus + ' kayıtta düştü</b> (doğru taraf), ' + (clv.length - dus) + ' kayıtta yükseldi · ortalama değişim ' + isaretli(mean(clv.map(r => r.sonOran / r.bil - 1))) + '</div>';
    } else html += '<div class="bo-k">Henüz oran değişimi yakalanmadı. Maç öncesi tekrar tarayınca ya da "Oranları güncelle"ye basınca dolar.</div>';
    return html;
  }
  // Gölge kayıt raporu: bot bütün oranlarda ne kadar isabetli, Bilyoner'e göre nasıl
  function golgeRapor() {
    const tum = golgeAl(), g = tum.filter(x => x.r === 0 || x.r === 1);
    let html = '<div class="bo-grup">👻 Gölge kayıt (kadrosu kesin maçlarda bütün oranlar)</div>';
    html += '<div class="bo-k">Bot, kadrosu kesin maçlarda Bilyoner\'deki bütün oyuncu oranlarını sessizce kaydeder, maç bitince sonucuna bakar. Sinyal vermediklerinin sonucu da burada. ' + g.length + ' sonuçlandı · ' + tum.filter(x => x.r == null).length + ' bekliyor · ' + tum.filter(x => x.r === -1).length + ' iade.</div>';
    if (!g.length) return html;
    const roi = liste => { const n = liste.length; if (!n) return null; const tut = liste.filter(x => x.r === 1).length, kar = liste.reduce((a, x) => a + (x.r === 1 ? x.o - 1 : -1), 0); return { n, tut, kar, roi: kar / n }; };
    [['yuksek', '🔥 Yüksek güven sinyalleri'], ['orta', '👍 Orta güven sinyalleri'], ['', 'Sinyal verilmeyenler']].forEach(([k, ad]) => { const r = roi(g.filter(x => (x.g || '') === k)); if (r) html += ozetSatir(ad, r); });
    const arti = roi(g.filter(x => !x.g && x.q * x.o - 1 >= 0.05));
    if (arti) html += ozetSatir('Sinyal olmayan ama botun +%5 üstü gördükleri', arti);
    html += '<div class="bo-grup2">Kim daha iyi tahmin ediyor?</div>';
    KOVALAR.forEach(([a, b, ad]) => {
      const gb = g.filter(x => x.q >= a && x.q < b), bi = x => sinirla(1 / (x.o * MARJ), 0.01, 0.99), gi = g.filter(x => bi(x) >= a && bi(x) < b);
      if (!gb.length && !gi.length) return;
      html += '<div>' + ad + ': bot dedi ' + (gb.length ? '<b>' + yuzde(mean(gb.map(x => x.q))) + '</b> → oldu <b>' + yuzde(mean(gb.map(x => x.r))) + '</b> (' + gb.length + ')' : '-') +
        ' · Bilyoner dedi ' + (gi.length ? yuzde(mean(gi.map(bi))) + ' → oldu ' + yuzde(mean(gi.map(x => x.r))) + ' (' + gi.length + ')' : '-') + '</div>';
    });
    const brier = f => mean(g.map(x => Math.pow(f(x) - x.r, 2)));
    html += '<div class="bo-k">Hata puanı (düşük olan iyi): bot ' + brier(x => x.q).toFixed(3) + ' · Bilyoner ' + brier(x => sinirla(1 / (x.o * MARJ), 0.01, 0.99)).toFixed(3) + '</div>';
    html += '<div class="bo-k">Bilyoner oranlarının ima ettiği ortalama ihtimal ' + yuzde(mean(g.map(x => 1 / x.o))) + ', gerçekleşen ' + yuzde(mean(g.map(x => x.r))) + (g.length >= 30 ? '' : ' (en az 30 sonuçta anlamlı olur)') + '</div>';
    const og = ogrenme();
    if (Object.keys(og).length) html += '<div class="bo-grup2">Öğrenme düzeltmeleri</div>' + Object.keys(og).map(t => '<div>' + TIP[t].ad + ': ' + (og[t].duz >= 0 ? '+' : '−') + Math.abs(Math.round(og[t].duz * 100)) + ' puan <span class="bo-k">(' + og[t].n + ' sonuç)</span></div>').join('');
    return html;
  }
  // Tek tahminin karnesi: "dakika 31 → 26 (−5) · ilk 5: dedik ✓ başladı · beklenti 17,3 → 19 · sebep: …"
  function karneSatir(x) {
    const p = [];
    if (x.d != null && x.gd != null) p.push('dakika ' + v0(x.d) + ' → ' + v0(x.gd) + ' (' + (Math.round(x.gd - x.d) === 0 ? '±0' : isaretliSayi(x.gd - x.d, v0)) + ')');
    if ((x.il === 0 || x.il === 1) && (x.gi === 0 || x.gi === 1)) p.push('ilk 5: ' + (x.il ? 'dedik' : 'yedek dedik') + (x.il === x.gi ? ' ✓' : ' ✗ (' + (x.gi ? 'ilk 5\'te başladı' : 'yedekten başladı') + ')'));
    if (x.m != null && x.v != null) p.push('beklenti ' + v1(x.m) + ' → gerçek ' + x.v);
    const s = karneSebep(x);
    if (s) p.push('sebep: ' + SEBEP_AD[s]);
    return p.join(' · ');
  }
  function karneHtml() {
    const veri = karneVerisi();
    let html = '<div class="bo-grup">🔍 Maç sonu karnesi (nerede yanıldık?)</div>';
    if (!veri.length) return html + '<div class="bo-k">Kadrosu kesin maçlar bitip sonuçlandıkça dolar. Her tahminde botun dediği dakika, ilk 5 ve beklenti ile gerçekte olan yan yana konur; tutmayanların sebebi ayrılır.</div>';
    // Dakika
    const tek = {};
    veri.forEach(x => { if (x.d != null && x.gd > 0) tek[x.e + '|' + x.p] = x; });
    const dl = Object.values(tek);
    if (dl.length) {
      const hata = dl.map(x => x.gd - x.d);
      html += '<div class="bo-grup2">Dakika tahmini (' + dl.length + ' oyuncu-maç)</div>' +
        '<div>Ortalama fark (gerçek − tahmin): <b>' + isaretliSayi(mean(hata)) + ' dk</b> · ±5 dk içinde: <b>' + yuzde(hata.filter(x => Math.abs(x) <= 5).length / hata.length) + '</b></div>';
      const dz = dakikaDuzeltme();
      html += '<div class="bo-k">İlk 5 dediklerimde ' + (dz.nilk ? isaretliSayi(dz.hilk) + ' dk (' + dz.nilk + ')' : '-') + ' · yedek dediklerimde ' + (dz.nyedek ? isaretliSayi(dz.hyedek) + ' dk (' + dz.nyedek + ')' : '-') + '</div>';
      html += '<div class="bo-k">' + (dz.ilk || dz.yedek ? 'Bot bundan sonra dakikaları ilk 5\'te ' + isaretliSayi(dz.ilk) + ', yedekte ' + isaretliSayi(dz.yedek) + ' dk düzeltiyor.' : 'Dakika düzeltmesi her grupta en az 20 örnek birikince başlar.') + '</div>';
      const il = dl.filter(x => (x.il === 0 || x.il === 1) && (x.gi === 0 || x.gi === 1));
      if (il.length) html += '<div>İlk 5 tahmini doğru: <b>' + yuzde(il.filter(x => x.il === x.gi).length / il.length) + '</b> (' + il.length + ')</div>';
    }
    // Kayıp sebepleri
    const kayip = veri.filter(x => x.r === 0);
    if (kayip.length) {
      const say = {};
      kayip.forEach(x => { const s = karneSebep(x); say[s] = (say[s] || 0) + 1; });
      html += '<div class="bo-grup2">Tutmayanların sebebi (' + kayip.length + ')</div>' + Object.keys(SEBEP_AD).filter(s => say[s]).sort((a, b) => say[b] - say[a])
        .map(s => '<div>' + h(SEBEP_AD[s]) + ': <b>' + say[s] + '</b> (' + yuzde(say[s] / kayip.length) + ')</div>').join('');
    }
    // Dayanağa göre isabet
    const et = Object.keys(ETIKET_AD).map(k => { const l = veri.filter(x => (x.et || '').indexOf(k) >= 0); return l.length ? '<div>' + ETIKET_AD[k] + ': <b>' + l.filter(x => x.r === 1).length + '/' + l.length + '</b> tuttu</div>' : ''; }).join('');
    const duz = veri.filter(x => !x.et);
    if (et) html += '<div class="bo-grup2">Neye dayandıysa ne kadar tuttu</div>' + et + (duz.length ? '<div class="bo-k">özel durumu olmayanlar: ' + duz.filter(x => x.r === 1).length + '/' + duz.length + '</div>' : '');
    // Beklenti sapması pazar bazında
    const pz = Object.keys(TIP).map(t => { const l = veri.filter(x => x.t === t && x.m != null && x.v != null); return l.length >= 5 ? '<div>' + TIP[t].ad + ': beklenti ' + v1(mean(l.map(x => x.m))) + ' → gerçek ' + v1(mean(l.map(x => x.v))) + ' (' + l.length + ')</div>' : ''; }).join('');
    if (pz) html += '<div class="bo-grup2">Beklenti mi fazla, gerçek mi?</div>' + pz;
    // Son sinyallerin karnesi
    const son = golgeAl().filter(x => x.g && (x.r === 0 || x.r === 1) && x.d != null).slice(-6).reverse();
    if (son.length) html += '<div class="bo-grup2">Son sinyallerin karnesi</div>' + son.map(x => '<div class="bo-sat">' + (x.r ? '✅ ' : '❌ ') + h((x.a ? x.a + ' ' : '') + x.n + '+ ' + TIP[x.t].birim) + ' · gerçek ' + x.v + '<br><span class="bo-k">' + h(karneSatir(x)) + '</span></div>').join('');
    return html;
  }
  function sinamaHtml() {
    const k = kalAl();
    let html = '<div class="bo-grup">🧪 Kendini sınama</div>';
    if (!k) return html + '<div class="bo-k">Henüz yapılmadı. Bot geçmiş maçları o maçın verisini görmeden tahmin eder, gerçek sonuçla karşılaştırır ve ihtimallerini buna göre ayarlar. Taramadan sonra günde bir kez kendiliğinden çalışır, ya da aşağıdaki 🧪 düğmesiyle başlatabilirsin.</div>';
    html += '<div>Son sınama: ' + zamanYaz(k.z) + ' · ' + k.n + ' örnek (' + k.test + ' geçmiş maç testi, ' + k.golge + ' gerçek sonuç)</div>';
    html += '<div>Ayar katsayısı: <b>' + v2(k.c) + '</b> ' + (k.c < 0.95 ? '(bot fazla emin çıkıyordu, ihtimaller ortaya çekiliyor)' : k.c > 1.05 ? '(bot fazla temkinliydi, ihtimaller açılıyor)' : '(bot iyi ayarlı)') + '</div>';
    html += '<table class="bo-tab"><tr><th>Aralık</th><th>Önce: dedi→oldu</th><th>Sonra: dedi→oldu</th></tr>' + (k.kova || []).map(b => '<tr><td>' + b.ad + '</td><td>' + (b.n ? yuzde(b.once) + '→' + yuzde(b.gercek) + ' (' + b.n + ')' : '-') + '</td><td>' + (b.n2 ? yuzde(b.sonra) + '→' + yuzde(b.gercek2) + ' (' + b.n2 + ')' : '-') + '</td></tr>').join('') + '</table>';
    return html;
  }
  function css() {
    if (document.getElementById('bo-css')) return;
    const st = document.createElement('style');
    st.id = 'bo-css';
    st.textContent =
      '#bo-btn{position:fixed;right:12px;bottom:370px;z-index:2147483646;width:52px;height:52px;border-radius:50%;border:none;font-size:24px;padding:0;background:#f97316;box-shadow:0 2px 10px #0009}' +
      '#bo-btn.bo-uyari::after{content:"";position:absolute;right:2px;top:2px;width:12px;height:12px;border-radius:50%;background:#22c55e;border:2px solid #fff}' +
      '#bo-bildirim{position:fixed;left:10px;right:10px;top:10px;z-index:2147483647;background:#14532d;color:#fff;padding:12px;border-radius:12px;font:14px/1.4 sans-serif;box-shadow:0 4px 18px #000a;display:none}' +
      '.odd[data-bo]{position:relative}' +
      '.odd[data-bo]::before{content:attr(data-bo);position:absolute;left:3px;top:1px;font-size:9px;font-weight:bold;line-height:1;color:#c2410c;pointer-events:none;z-index:2}' +
      '.odd[data-bo-r="sinyal"]{box-shadow:inset 0 0 0 2px #f97316}' +
      '.odd[data-bo-r="iyi"]{box-shadow:inset 0 0 0 2px #22c55e}' +
      '.odd[data-bo-r="kotu"]{box-shadow:inset 0 0 0 1px #ef4444}' +
      '#bo-panel{position:fixed;left:8px;right:8px;bottom:8px;max-height:85vh;overflow:auto;z-index:2147483647;background:#1d1712;color:#f5ece4;border-radius:14px;padding:14px;font:14px/1.45 sans-serif;box-shadow:0 6px 24px #000c;box-sizing:border-box;display:none}' +
      '#bo-panel h3{margin:0 0 6px;font-size:16px;color:#f5ece4}' +
      '#bo-panel .bo-kapat{position:absolute;right:10px;top:8px;background:none;border:none;color:#ccc;font-size:22px}' +
      '#bo-panel .bo-sekme{display:flex;gap:6px;margin:4px 0 8px}' +
      '#bo-panel .bo-sekme button{flex:1;padding:9px 4px;border-radius:9px;border:1px solid #5a4330;background:#2a2019;color:#f1e3d6;font-size:14px;font-weight:bold}' +
      '#bo-panel .bo-sekme button.sec{background:#fdba74;color:#111;border-color:#fdba74}' +
      '#bo-panel .bo-ayar{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0}' +
      '#bo-panel .bo-ayar button{flex:1;min-width:28%;padding:8px 4px;border-radius:8px;border:1px solid #5a4330;background:#2a2019;color:#f1e3d6;font-size:13px}' +
      '#bo-panel .bo-ayar button.sec{background:#f97316;color:#111;border-color:#f97316}' +
      '#bo-panel .bo-ana{width:100%;padding:11px;border:none;border-radius:10px;background:#fb923c;color:#1a0f05;font-weight:bold;font-size:15px;margin-top:6px}' +
      '#bo-panel .bo-grup{margin-top:14px;font-weight:bold;color:#fed7aa;border-bottom:1px solid #4a3828;padding-bottom:3px}' +
      '#bo-panel .bo-grup2{margin-top:10px;font-weight:bold;color:#fdba74;font-size:13px}' +
      '#bo-panel .bo-kart{margin-top:8px;padding:9px;border-radius:10px;background:#28201a;border-left:4px solid #64748b}' +
      '#bo-panel .bo-yuksek{border-left-color:#ef4444}#bo-panel .bo-orta{border-left-color:#22c55e}#bo-panel .bo-bek{border-left-color:#eab308}' +
      '#bo-panel .bo-mac{font-size:12px;color:#d6c3b2;margin-bottom:2px}' +
      '#bo-panel .bo-rozet{font-size:11px;padding:1px 6px;border-radius:6px;white-space:nowrap}' +
      '#bo-panel .bo-r-yuksek{background:#ef4444;color:#fff}#bo-panel .bo-r-orta{background:#22c55e;color:#062}#bo-panel .bo-r-elle{background:#eab308;color:#111}' +
      '#bo-panel .bo-gerekce{margin:5px 0 6px 0;padding-left:18px;font-size:12.5px;color:#eadccf}' +
      '#bo-panel .bo-gerekce li{margin:2px 0}' +
      '#bo-panel .bo-k{font-size:12px;color:#c9b6a5}' +
      '#bo-panel .bo-kbtn{padding:5px 10px;border-radius:7px;border:1px solid #5a4330;background:#33271e;color:#f5ece4;font-size:12px;margin-top:3px}' +
      '#bo-panel .bo-kbtn[disabled]{opacity:.6}' +
      '#bo-panel .bo-iyi{color:#4ade80;font-weight:bold}#bo-panel .bo-kotu{color:#f87171;font-weight:bold}' +
      '#bo-panel .bo-hata{background:#3b1414;color:#fecaca;padding:8px;border-radius:8px;margin:6px 0}' +
      '#bo-panel .bo-durum{color:#fed7aa;font-size:14px;margin:10px 0}' +
      '#bo-panel .bo-sat{padding:5px 0;border-bottom:1px solid #3a2c20}' +
      '#bo-panel .bo-pre{white-space:pre-wrap;font-size:11.5px;background:#120d09;color:#f5ece4;padding:8px;border-radius:8px;max-height:55vh;overflow:auto}' +
      '#bo-panel table.bo-tab{width:100%;border-collapse:collapse;font-size:12px;margin-top:4px;color:#f5ece4;background:transparent}' +
      '#bo-panel table.bo-tab th,#bo-panel table.bo-tab td{padding:3px 2px;border-bottom:1px solid #3a2c20;text-align:right;color:#f5ece4;background:transparent}' +
      '#bo-panel table.bo-tab th:first-child,#bo-panel table.bo-tab td:first-child{text-align:left}' +
      '#bo-panel table.bo-tab th{color:#fed7aa;font-weight:bold}' +
      '#bo-panel table.bo-tab tr.bo-tr-sinyal td{background:#3a2a12}' +
      '#bo-panel table.bo-tab tr.bo-tr-supheli td{color:#a8a29e}' +
      '#bo-panel .bo-onkart{opacity:.8;border-left-style:dashed !important}' +
      '#bo-panel .bo-r-on{background:#57534e;color:#f5f5f4}' +
      '#bo-panel .bo-rol{display:block;font-size:10.5px;color:#c9b6a5}' +
      '#bo-panel .bo-not{margin-top:6px;font-size:13px}' +
      '#bo-panel .bo-up{color:#4ade80}#bo-panel .bo-down{color:#f87171}';
    document.head.appendChild(st);
  }
  function panel() {
    let p = document.getElementById('bo-panel');
    if (p) return p;
    p = document.createElement('div');
    p.id = 'bo-panel';
    document.body.appendChild(p);
    p.addEventListener('click', tikla);
    return p;
  }
  function panelIcerik(html) {
    const p = panel();
    p.innerHTML = '<button class="bo-kapat">×</button><h3>🏀 Basket Oyuncu Sinyal ' + SURUM + '</h3>' + html;
    p.style.display = 'block';
    p.__gorunum = '';
  }
  function sekmeHtml(aktif) {
    return '<div class="bo-sekme"><button data-sekme="sinyal" class="' + (aktif === 'sinyal' ? 'sec' : '') + '">🏀 Sinyaller</button>' +
      '<button data-sekme="kayit" class="' + (aktif === 'kayit' ? 'sec' : '') + '">📊 Kayıtlar (' + kayitAl().length + ')</button></div>';
  }
  function ayarHtml() {
    const b = (g, v, y, sec) => '<button data-g="' + g + '" data-v="' + v + '" class="' + (sec ? 'sec' : '') + '">' + y + '</button>';
    let html = '<div class="bo-ayar">' + b('pencere', 3, 'Sonraki 3 saat', ayar.pencere == 3) + b('pencere', 6, 'Sonraki 6 saat', ayar.pencere == 6) + b('pencere', 24, 'Bütün gün', ayar.pencere == 24) + '</div>' +
      '<div class="bo-ayar">' + b('ligler', 'nba_el', 'NBA + EuroLeague', ayar.ligler !== 'hepsi') + b('ligler', 'hepsi', 'Bütün ligler', ayar.ligler === 'hepsi') + '</div>' +
      '<div class="bo-ayar">' + b('takip', ayar.takip ? 0 : 1, '🔔 Kadro takibi: ' + (ayar.takip ? 'açık' : 'kapalı'), ayar.takip) + b('ses', ayar.ses ? 0 : 1, '🔊 Ses: ' + (ayar.ses ? 'açık' : 'kapalı'), ayar.ses) + '</div>' +
      '<button class="bo-ana" data-islem="tara">▶ Yakındaki maçları tara (' + pencereYazi() + ')</button>';
    if (basketSayfaId()) html += '<button class="bo-ana" data-islem="buMac" style="background:#fed7aa">🎯 Sadece bu maçı tara</button>';
    html += '<div class="bo-ayar"><button data-islem="kontrol">🔍 Veri kontrolü</button><button data-islem="bagla">🔗 Takım eşleştir</button></div>';
    return html;
  }
  function ilerleme(yazi) {
    panelIcerik('<div class="bo-durum">⏳ ' + yazi + '</div><button class="bo-ana" data-islem="durdur" style="background:#f87171">⏹ Durdur</button>');
  }
  function bekleyenKart(m) {
    const n = (m.sinyaller || []).length;
    return '<div class="bo-kart bo-bek"><div class="bo-mac">🏀 ' + h(m.macAd) + ' · ' + saatYaz(m.ts) + (m.lig ? ' · ' + h(m.lig) : '') + '</div>' +
      '<div>' + (m.basladi ? '▶ Maç başladı' : h(m.kadroYazi)) + '</div>' + (m.uyari ? '<div class="bo-k">⚠️ ' + h(m.uyari) + '</div>' : '') +
      '<div class="bo-k">Aday sinyal: <b>' + n + '</b> (yukarıda ön sinyal olarak) · son kontrol ' + saatSadece(m.sonKontrol) + (m.espnNot ? '<br>⚠️ ' + h(m.espnNot) : '') + '</div>' +
      '<button class="bo-kbtn" data-rot="' + h(m.key) + '">📋 Rotasyon</button> <button class="bo-kbtn" data-tum="' + h(m.key) + '">📊 Tüm oranlar</button>' +
      (m.basladi ? '' : ' <button class="bo-kbtn" data-ellekesin="' + h(m.key) + '">✋ Kadroyu ben doğruladım</button>') + '</div>';
  }
  function sinyalSekmesi() {
    let html = sekmeHtml('sinyal') + ayarHtml();
    const son = sonAl();
    if (!son) { html += '<div class="bo-k" style="padding:8px 0">Henüz tarama yapılmadı.</div>'; panelIcerik(html); panel().__gorunum = 'sinyal'; return; }
    const o = son.ozet, maclar = son.maclar || [];
    html += '<div class="bo-k" style="margin-top:10px">Son tarama: ' + zamanYaz(son.zaman) + (son.tek ? ' · tek maç' : '') + ' · ' + o.mac + ' maç · analiz edilen: ' + o.tamam + ' · kadrosu kesin: ' + o.kesin +
      (o.pazaryok ? ' · oyuncu pazarı olmayan: ' + o.pazaryok : '') + (o.lig ? ' · NBA/EuroLeague dışı: ' + o.lig : '') + (son.durduruldu ? ' · (yarıda durduruldu)' : '') + '</div>';
    if (son.kisit) html += '<div class="bo-hata">Sofascore taramanın ortasında istekleri sınırladı, bazı maçlar eksik kalmış olabilir. Birkaç dakika sonra tekrar tara; indirilenler saklandığı için ikinci tarama daha az istek atar.</div>';
    if (o.hatalar && o.hatalar.length) html += '<div class="bo-k">⚠️ ' + o.hatalar.slice(0, 5).map(h).join('<br>⚠️ ') + '</div>';
    if (son.pozHata && son.pozHata.length) html += '<div class="bo-k">⚠️ Pozisyon verisi: ' + son.pozHata.map(h).join(' · ') + '</div>';
    if (o.baglanacak && o.baglanacak.length) html += '<div class="bo-grup">🔗 Eşleşmeyen takımlar</div><div class="bo-k">Bu adlar Sofascore\'da otomatik bulunamadı. Bir kez eşleştirirsen telefonda saklanır.</div><div class="bo-ayar">' +
      o.baglanacak.map(t => '<button data-bagla="' + h(t) + '">🔗 ' + h(t) + '</button>').join('') + '</div>';
    const kesinler = maclar.filter(m => m.kesin), bekleyen = maclar.filter(m => !m.kesin);
    html += '<div class="bo-grup">✅ Kadrosu kesin maçlar — sinyaller</div>';
    if (!kesinler.length) html += '<div class="bo-k">Henüz kadrosu kesinleşen maç yok. Bazı liglerde kadro maç başlayana kadar kesinleşmez; o maçların sinyalleri aşağıda ön sinyal olarak duruyor.' + (ayar.takip ? ' Bilyoner açık kaldıkça bekleyen maçlara 10 dakikada bir bakarım, kadro kesinleşince haber veririm.' : ' (Kadro takibi kapalı.)') + '</div>';
    else {
      const tumS = tumSinyaller({ maclar: kesinler });
      if (!tumS.length) html += '<div class="bo-k" style="padding:6px 0">Kadrosu kesin maçlarda şartları sağlayan seçim çıkmadı. Bot sadece hesabı, dakika istikrarı ve Bilyoner\'in kendi oranları birlikte destekliyorsa sinyal veriyor.</div>';
      ['yuksek', 'orta'].forEach(g => {
        const gr = tumS.filter(s => s.guven === g).sort((a, b) => b.p - a.p);
        if (gr.length) html += '<div class="bo-grup2">' + GUVEN_YAZI[g] + ' (' + gr.length + ')</div>' + gr.map(s => kartHtml(s, 'sinyal')).join('');
      });
      html += '<div class="bo-grup2">Maçlar</div>' + kesinler.map(m => '<div class="bo-sat">' + h(m.macAd) + ' · ' + saatYaz(m.ts) + '<br><span class="bo-k">' + h(m.kadroYazi) + (m.uyari ? '<br>⚠️ ' + h(m.uyari) : '') + '</span><br>' +
        '<button class="bo-kbtn" data-rot="' + h(m.key) + '">📋 Rotasyon</button> <button class="bo-kbtn" data-tum="' + h(m.key) + '">📊 Tüm oranlar</button></div>').join('');
      if (tumS.length) html += '<div class="bo-k" style="margin-top:8px">Sinyaller analiz anındaki oranlarla hesaplandı. Oynamadan önce Bilyoner\'deki güncel orana bak.</div>';
    }
    // Ön sinyaller: kadrosu kesinleşmemiş maçlar. Oyuncunun kendisi belirsiz (şüpheli) ise gösterilmez.
    const acik = bekleyen.filter(m => !m.basladi);
    const onS = tumSinyaller({ maclar: acik }).filter(s => !(s.bagli || []).includes(s.oyuncu));
    const onElenen = tumSinyaller({ maclar: acik }).length - onS.length;
    if (acik.length) {
      html += '<div class="bo-grup">⏳ Ön sinyaller — kadro henüz kesin değil (' + onS.length + ')</div>';
      html += '<div class="bo-k">Sakatlık raporu ve eksik listesine göre hesaplandı. Basketbolda oyuncunun ilk 5\'te başlaması gerekmez; 1 dakika bile oynarsa bahis geçerli, hiç oynamazsa iade. Risk, dakikasının beklenenden az olması.' +
        (onElenen ? ' Kendisi şüpheli olan ' + onElenen + ' oyuncunun sinyali gösterilmedi.' : '') + '</div>';
      ['yuksek', 'orta'].forEach(g => {
        const gr = onS.filter(s => s.guven === g).sort((a, b) => b.p - a.p);
        if (gr.length) html += '<div class="bo-grup2">' + GUVEN_YAZI[g] + ' (' + gr.length + ')</div>' + gr.map(s => kartHtml(s, 'on')).join('');
      });
      if (!onS.length) html += '<div class="bo-k" style="padding:6px 0">Bu maçlarda şu an şartları sağlayan seçim yok.</div>';
    }
    if (bekleyen.length) html += '<div class="bo-grup">⏳ Kadro bekleniyor (' + bekleyen.length + ')</div>' + bekleyen.slice().sort((a, b) => a.ts - b.ts).map(bekleyenKart).join('');
    const supheli = [].concat(...maclar.map(m => m.supheli || [])).slice(0, 8);
    if (supheli.length) html += '<div class="bo-grup">⚠️ Aşırı fark çıkanlar (sinyal verilmedi)</div><div class="bo-k">Bot hesabı ile Bilyoner arasında %60\'tan büyük fark var. Genelde Bilyoner\'in bildiği bir şey (sakatlık, dakika kısıtı) vardır:<br>' +
      supheli.map(x => h(x.macAd + ': ' + x.secim + ' · ' + v2(x.bil) + ' · hesap ' + yuzde(x.p))).join('<br>') + '</div>';
    panelIcerik(html);
    panel().__gorunum = 'sinyal';
  }
  const maciBul = key => { const son = sonAl(); return son && (son.maclar || []).find(x => String(x.key) === String(key)); };
  function rotasyonGoster(key) {
    const m = maciBul(key);
    if (!m) return;
    const ok = (a, b, ondalik) => {
      const f = b - a, yaz = ondalik ? v1 : v0;
      return yaz(a) + (Math.abs(f) >= (ondalik ? 0.6 : 1.5) ? '→<span class="' + (f > 0 ? 'bo-up' : 'bo-down') + '">' + yaz(b) + '</span>' : '');
    };
    const poz = s => {
      if (s.slot == null) return '<span class="bo-k">yd</span>';
      if (s.normalSlot == null) return String(s.slot + 1);
      const n = s.normalSlot + 1, yazN = Math.abs(n - Math.round(n)) <= 0.25 ? String(Math.round(n)) : v1(n);
      return Math.abs(s.normalSlot - s.slot) >= 0.75 ? yazN + '→<b>' + (s.slot + 1) + '</b>' : String(s.slot + 1);
    };
    let html = sekmeHtml('sinyal') + '<div class="bo-ayar"><button data-sekme="sinyal">↩ Sinyallere dön</button><button data-tum="' + h(m.key) + '">📊 Tüm oranlar</button></div>';
    html += '<div class="bo-grup">📋 ' + h(m.macAd) + ' · ' + saatYaz(m.ts) + '</div><div class="bo-k">' + h(m.senYazi) + '</div><div class="bo-k">Kadro: ' + h(m.kadroYazi) + '</div>' + (m.uyari ? '<div class="bo-hata">⚠️ ' + h(m.uyari) + '</div>' : '');
    if (m.espnNot) html += '<div class="bo-k">⚠️ ' + h(m.espnNot) + '</div>';
    ['ev', 'dep'].forEach(t => {
      const r = m.rot[t];
      html += '<div class="bo-grup">' + h(r.ad) + ' <span class="bo-k">(' + r.mac + ' maçlık arşiv' + (r.atilan ? ', ' + r.atilan + ' bozuk maç atıldı' : '') + ')</span></div>';
      html += '<div>🚫 Bugün yok: ' + (r.eksik.length ? h(r.eksik.join(', ')) : 'yok') + '</div>';
      if (r.belirsiz.length) html += '<div>❓ Belirsiz: ' + h(r.belirsiz.join(', ')) + ' <span class="bo-k">(iki senaryo hesaplanıyor)</span></div>';
      if (r.donen.length) html += '<div>🔙 Dönen: ' + h(r.donen.join(', ')) + '</div>';
      if (r.uzun && r.uzun.length) html += '<div class="bo-k">Uzun süredir oynamayan / takımdan ayrılan: ' + h(r.uzun.join(', ')) + '</div>';
      if (r.ipucu && r.ipucu.length && !m.kesin) html += '<div class="bo-k">💡 Bilyoner bu önemli oyunculara oran açmamış: ' + h(r.ipucu.join(', ')) + ' (oynamayabilir, kadroyu kontrol et)</div>';
      if (r.kopma !== 'düşük') html += '<div class="bo-k">Maç kopma riski ' + r.kopma + ': yıldızların dakikası biraz düşürüldü.</div>';
      html += '<table class="bo-tab"><tr><th>Oyuncu</th><th>Poz.</th><th>Dk</th><th>Sayı</th><th>Rib</th><th>Ast</th></tr>' +
        r.satirlar.map(s => '<tr><td>' + (s.ilk ? '⭐' : '') + h(soyad(s.ad)) + '<span class="bo-rol">' + h(s.rol || '') + '</span></td><td>' + poz(s) + '</td><td>' + ok(s.dk0, s.dk1) + '</td><td>' + ok(s.pts0, s.pts1, true) + '</td><td>' + ok(s.reb0, s.reb1, true) + '</td><td>' + ok(s.ast0, s.ast1, true) + '</td></tr>').join('') + '</table>';
      html += '<div class="bo-k">⭐ bugünkü ilk 5' + (r.ilk5Kesin ? ' (resmi)' : ' (tahmini)') + ' · Poz.: normalde→bugün numara (1 oyun kurucu … 5 pivot), yd = yedekten · sol: son maçlar ortalaması, sağ: bugünkü beklenti</div>';
      if (r.yapi) html += '<div class="bo-not">' + h(r.yapi) + '</div>';
      r.etkiler.forEach(e => { html += '<div class="bo-not"><b>' + h(e.baslik) + ':</b><br>' + e.liste.map(h).join('<br>') + '</div>'; });
      if (r.tahmini.length) html += '<div class="bo-k" style="margin-top:4px">' + h(r.tahmini.join(', ')) + ' için geçmişte onsuz oynanmış maç yok; dakikası boyu yakın oyunculara dağıtıldı (tahmini).</div>';
      if (r.savNot.length) html += '<div class="bo-not">🛡️ Rakip savunma (lig ortalamasına göre verdiği): ' + h(r.savNot.join(' · ')) + '</div>';
      if (r.rakipNot.length) html += '<div class="bo-not">🩹 Rakipte eksik: ' + h(r.rakipNot.join('; ')) + '</div>';
      html += '<div class="bo-k" style="margin-top:4px">Pozisyon verisi: ' + (r.pozKaynak.pbp ? r.pozKaynak.pbp + ' maçta oyun akışından (kim hangi numarada kaç dakika)' : 'oyun akışı yok') + (r.pozKaynak.ilk5 ? ' · ' + r.pozKaynak.ilk5 + ' maçta ilk 5\'ten yaklaşık' : '') + '</div>';
    });
    panelIcerik(html);
    panel().scrollTop = 0;
    panel().__gorunum = 'rot';
  }
  function tumOranlarGoster(key) {
    const m = maciBul(key);
    if (!m) return;
    let html = sekmeHtml('sinyal') + '<div class="bo-ayar"><button data-sekme="sinyal">↩ Sinyallere dön</button><button data-rot="' + h(m.key) + '">📋 Rotasyon</button></div>';
    html += '<div class="bo-grup">📊 ' + h(m.macAd) + ' · bütün oyuncu oranları</div>';
    html += '<div class="bo-k">Bot: botun ihtimali · Bil.: Bilyoner oranının ima ettiği ihtimal · Getiri: botun ihtimaliyle beklenen kazanç. Turuncu satır = sinyal.' + (m.kesin ? '' : ' ⚠️ Kadro kesin değil, rakamlar değişebilir.') + '</div>';
    const satir = (m.tum || []).slice().sort((a, b) => b.ev - a.ev);
    if (!satir.length) html += '<div class="bo-k">Oyuncularla eşleşen oran yok.</div>';
    else html += '<table class="bo-tab"><tr><th>Seçim</th><th>Oran</th><th>Bot</th><th>Bil.</th><th>Getiri</th></tr>' + satir.map(r => '<tr' + (r.durum ? ' class="bo-tr-' + r.durum + '"' : '') + '><td>' + h(r.secim) + '</td><td>' + v2(r.bil) + '</td><td>' + yuzde(r.p) + '</td><td>' + yuzde(r.pImp) + '</td><td class="' + (r.ev >= 0.1 ? 'bo-up' : r.ev <= -0.1 ? 'bo-down' : '') + '">' + isaretli(r.ev) + '</td></tr>').join('') + '</table>';
    panelIcerik(html);
    panel().scrollTop = 0;
    panel().__gorunum = 'tum';
  }
  async function baglaGoster(ad, q) {
    panelIcerik(sekmeHtml('sinyal') + '<div class="bo-durum">⏳ Sofascore\'da aranıyor: ' + h(q || ad) + '</div>');
    let liste = [], hata = '';
    ssKisit = false;
    try { liste = await ssTakimAra(q || ad); } catch (e) { hata = e.message; }
    const mevcut = GM_getValue('bo_elle', {})[norm(ad)];
    let html = sekmeHtml('sinyal') + '<div class="bo-ayar"><button data-sekme="sinyal">↩ Sinyallere dön</button></div>';
    html += '<div class="bo-grup">🔗 Bilyoner\'deki "' + h(ad) + '" hangi takım?</div><div class="bo-k">Sofascore\'daki doğru takımı seç. Eşleşme telefonda saklanır, bir daha sorulmaz.' + (mevcut ? ' Şu anki eşleşme: <b>' + h(mevcut.ad) + '</b>' : '') + '</div>';
    if (hata) html += '<div class="bo-hata">' + h(hata) + '</div>';
    if (!liste.length && !hata) html += '<div class="bo-k" style="padding:6px 0">Sonuç yok. Başka bir adla ara (örneğin İngilizce adı).</div>';
    html += liste.map(t => '<div class="bo-sat"><button class="bo-kbtn" data-baglasec="' + h(t.id) + '" data-bagad="' + h(ad) + '" data-bagss="' + h(t.ad) + '">Seç</button> <b>' + h(t.ad) + '</b> <span class="bo-k">' + h(t.ulke) + (t.kadin ? ' · kadın takımı' : '') + '</span></div>').join('');
    html += '<div class="bo-ayar"><button data-baglaara="' + h(ad) + '">🔎 Başka adla ara</button>' + (mevcut ? '<button data-baglasil="' + h(ad) + '">🗑️ Eşleşmeyi kaldır</button>' : '') + '</div>';
    panelIcerik(html);
    panel().__gorunum = 'bagla';
  }
  async function kayitlarGoster(kontrolEt) {
    let not = '';
    if (kontrolEt) {
      panelIcerik(sekmeHtml('kayit') + '<div class="bo-durum">⏳ Biten maçların sonuçları kontrol ediliyor…</div>');
      ssKisit = false;
      try { const n = await sonuclariKontrol(); if (n) not = '✅ ' + n + ' kaydın sonucu güncellendi'; }
      catch (e) { not = '⚠️ Sonuç kontrolü yapılamadı: ' + e.message; }
      try { await golgeCoz(8); } catch (e) {}
    }
    const k = kayitAl();
    let html = sekmeHtml('kayit');
    if (not) html += '<div class="bo-durum">' + h(not) + '</div>';
    if (!k.length) html += '<div class="bo-k" style="padding:8px 0">Henüz kayıt yok. Bir sinyaldeki 💾 Kaydet\'e basınca burada görünür.</div>';
    else html += raporHtml(k);
    html += karneHtml() + golgeRapor() + sinamaHtml();
    if (k.length) {
      const bek = k.filter(r => !r.sonuc), bit = k.filter(r => r.sonuc);
      if (bek.length) html += '<div class="bo-grup">⏳ Bekleyenler (' + bek.length + ')</div>' + bek.map(r => kartHtml(r, 'kayit')).join('');
      if (bit.length) html += '<div class="bo-grup">Sonuçlananlar (' + bit.length + ')</div>' + bit.map(r => kartHtml(r, 'kayit')).join('');
    }
    html += '<div class="bo-ayar" style="margin-top:14px"><button data-islem="sonucKontrol">🔄 Sonuçları kontrol et</button><button data-islem="oranGuncelle">💱 Oranları güncelle</button><button data-islem="sina">🧪 Kendini sına</button></div>' +
      '<div class="bo-ayar"><button data-islem="yedekAl">📋 Yedeği kopyala</button><button data-islem="yedekYukle">📥 Yedeği geri yükle</button></div>' +
      '<div class="bo-k">Script\'i silersen kayıtlar da silinir. Yeni sürüm kurarken eskisini silme, içini seçip yenisini yapıştır.</div>';
    panelIcerik(html);
    panel().__gorunum = 'kayit';
  }
  async function sinaBaslat() {
    if (taraniyor) return;
    taraniyor = true; durdur = false;
    try {
      const son = sonAl();
      let tidler = [...new Set([].concat(...((son && son.maclar) || []).map(m => m.takimlar || [])))];
      if (!tidler.length) {
        const A = arsiv(), say = {};
        Object.values(A).forEach(g => { say[g.h] = (say[g.h] || 0) + 1; say[g.a] = (say[g.a] || 0) + 1; });
        tidler = Object.keys(say).filter(t => say[t] >= 10).sort((a, b) => say[b] - say[a]);
      }
      tidler = tidler.slice(0, 8);
      if (!tidler.length) { panelIcerik(sekmeHtml('kayit') + '<div class="bo-hata">Sınamak için önce en az bir tarama yapmalısın (geçmiş maçlar indirilsin).</div>'); return; }
      const r = await kendiniSina(tidler, t => panelIcerik(sekmeHtml('kayit') + '<div class="bo-durum">🧪 Kendini sınıyor… ' + h(t) + '</div>'));
      await kayitlarGoster(false);
      if (r.yetersiz) panel().querySelector('.bo-sekme').insertAdjacentHTML('afterend', '<div class="bo-hata">Sınama için yeterli örnek çıkmadı (' + r.n + '). Daha fazla maç tarandıkça dolacak.</div>');
    } catch (e) {
      panelIcerik(sekmeHtml('kayit') + '<div class="bo-hata">❌ ' + h(e.message) + '</div>');
    } finally { taraniyor = false; }
  }
  function yedekVerisi() { return { surum: SURUM, kayitlar: kayitAl(), golge: golgeAl(), kal: kalAl() }; }

  function tikla(e) {
    const t = e.target.closest ? (e.target.closest('button') || e.target) : e.target, p = panel();
    const at = a => t.getAttribute && t.getAttribute(a);
    if (t.classList && t.classList.contains('bo-kapat')) { p.style.display = 'none'; return; }
    const sekme = at('data-sekme');
    if (sekme === 'kayit') { if (!taraniyor) kayitlarGoster(true); return; }
    if (sekme === 'sinyal') { if (!taraniyor) sinyalSekmesi(); return; }
    const rot = at('data-rot');
    if (rot) { rotasyonGoster(rot); return; }
    const tm = at('data-tum');
    if (tm) { tumOranlarGoster(tm); return; }
    const ek = at('data-ellekesin');
    if (ek) {
      const m = maciBul(ek);
      if (!m) return;
      const vars = ['ev', 'dep'].map(t => { const r = m.rot[t]; return r.ad + ' → yok: ' + (r.eksikAd.length ? r.eksikAd.join(', ') : 'kimse') + (r.belirsiz.length ? ' · belirsiz: ' + r.belirsiz.map(x => x.split(' (')[0]).join(', ') : ''); }).join('\n');
      if (!confirm('Botun bu maç için varsayımı:\n' + vars + '\n\nGerçek kadro bununla aynıysa Tamam\'a bas. Farklıysa İptal et ve kadro kesinleşmesini bekle (bot kadroyu senin yerine bilemez).')) return;
      const x = GM_getValue('bo_elleKesin', {});
      x[String(ek)] = Date.now();
      Object.keys(x).forEach(k => { if (Date.now() - x[k] > 3 * 86400000) delete x[k]; });
      GM_setValue('bo_elleKesin', x);
      tara(m.bid);
      return;
    }
    const bg = at('data-bagla');
    if (bg) { baglaGoster(bg); return; }
    const ba = at('data-baglaara');
    if (ba) { const q = prompt('Sofascore\'da hangi adla arayayım?', ba); if (q) baglaGoster(ba, q); return; }
    const bs = at('data-baglasec');
    if (bs) {
      const x = GM_getValue('bo_elle', {});
      x[norm(at('data-bagad'))] = { id: Number(bs), ad: at('data-bagss') };
      GM_setValue('bo_elle', x);
      alert('"' + at('data-bagad') + '" → ' + at('data-bagss') + ' olarak kaydedildi. Bir sonraki taramada kullanılacak.');
      sinyalSekmesi();
      return;
    }
    const bsil = at('data-baglasil');
    if (bsil) { const x = GM_getValue('bo_elle', {}); delete x[norm(bsil)]; GM_setValue('bo_elle', x); baglaGoster(bsil); return; }
    const g = at('data-g');
    if (g) {
      const v = at('data-v');
      if (g === 'pencere') ayar.pencere = Number(v);
      else if (g === 'ligler') ayar.ligler = v;
      else if (g === 'takip') ayar.takip = v === '1';
      else if (g === 'ses') { ayar.ses = v === '1'; if (ayar.ses) { sesHazirla(); bip(); } }
      ayarKaydet(); sinyalSekmesi(); return;
    }
    const islem = at('data-islem');
    if (islem === 'tara') { tara(null); return; }
    if (islem === 'buMac') { tara(basketSayfaId()); return; }
    if (islem === 'durdur') { durdur = true; t.textContent = 'Durduruluyor…'; return; }
    if (islem === 'kontrol') { veriKontrol(); return; }
    if (islem === 'bagla') { const ad = prompt('Bilyoner\'deki takım adını yaz (örneğin Kızılyıldız):'); if (ad) baglaGoster(ad.trim()); return; }
    if (islem === 'kopyalaKontrol') { try { GM_setClipboard(p.__kontrol || ''); alert('Kopyalandı. Buraya yapıştırıp gönderebilirsin.'); } catch (err) { prompt('Kopyala:', p.__kontrol || ''); } return; }
    if (islem === 'sonucKontrol') { kayitlarGoster(true); return; }
    if (islem === 'sina') { sinaBaslat(); return; }
    if (islem === 'oranGuncelle') {
      panelIcerik(sekmeHtml('kayit') + '<div class="bo-durum">⏳ Bekleyen kayıtların oranları güncelleniyor…</div>');
      bekleyenOranlariGuncelle().then(n => { kayitlarGoster(false).then(() => { const d = p.querySelector('.bo-sekme'); if (d) d.insertAdjacentHTML('afterend', '<div class="bo-durum">💱 ' + n + ' kaydın oranı güncellendi</div>'); }); });
      return;
    }
    if (islem === 'yedekAl') {
      const y = JSON.stringify(yedekVerisi());
      try { GM_setClipboard(y); alert(kayitAl().length + ' kayıt, ' + golgeAl().length + ' gölge kayıt ve sınama ayarı panoya kopyalandı. Bir not uygulamasına yapıştırıp sakla.'); }
      catch (err) { prompt('Bu metni kopyalayıp sakla:', y); }
      return;
    }
    if (islem === 'yedekYukle') {
      const metin = prompt('Daha önce kopyaladığın yedeği buraya yapıştır:');
      if (!metin) return;
      try {
        const gelen = JSON.parse(metin);
        const kay = Array.isArray(gelen) ? gelen : (gelen && gelen.kayitlar);
        if (!Array.isArray(kay)) throw new Error();
        const k = kayitAl(), var_ = new Set(k.map(x => x.id));
        const ek2 = kay.filter(x => x && x.id && !var_.has(x.id));
        kayitYaz(k.concat(ek2));
        let gs = 0;
        if (gelen && Array.isArray(gelen.golge)) { const once = golgeAl().length; golgeEkle(gelen.golge.filter(x => x && x.i)); golgeKaydet(); gs = golgeAl().length - once; }
        if (gelen && gelen.kal && !kalAl()) { GM_setValue('bo_kal', gelen.kal); KAL = null; }
        alert(ek2.length + ' kayıt' + (gs ? ', ' + gs + ' gölge kayıt' : '') + ' geri yüklendi.');
        kayitlarGoster(false);
      } catch (err) { alert('Yedek okunamadı. Metnin tamamını kopyaladığından emin ol.'); }
      return;
    }
    const kk = at('data-kaydet');
    if (kk) {
      const s = tumSinyaller(sonAl()).find(x => x.id === kk);
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

  // ---------- Bilyoner maç sayfasında oranların üstüne botun ihtimali ----------
  function butonlariIsaretle() {
    const bid = basketSayfaId();
    if (!bid) return;
    const m = (((sonAl() || {}).maclar) || []).find(x => String(x.bid) === String(bid));
    if (!m || !m.tum || !m.tum.length) return;
    const idx = {};
    m.tum.forEach(r => { idx[r.tip + '|' + norm(r.ad) + '|' + r.N] = r; });
    document.querySelectorAll('.odd').forEach(el => {
      const kutu = el.closest('.market-box');
      if (!kutu) return;
      const hd = kutu.querySelector('[class*="header"], [class*="title"], [class*="name"]');
      const baslik = ((hd ? hd.innerText : kutu.innerText.split('\n')[0]) || '').trim();
      const tip = oyuncuPazarTipi(baslik);
      if (!tip) return;
      const etiket = el.innerText.split('\n').map(s => s.trim()).filter(s => s && !/^\d+[.,]\d+$/.test(s)).join(' ');
      const sc = secimCoz(etiket);
      if (!sc) return;
      const r = idx[tip + '|' + norm(sc.ad) + '|' + sc.N];
      if (!r) return;
      const yazi = (m.kesin ? '' : '⏳') + yuzde(r.p) + ' · ' + isaretli(r.ev);
      if (el.getAttribute('data-bo') !== yazi) el.setAttribute('data-bo', yazi);
      const durum = r.durum === 'sinyal' ? 'sinyal' : r.ev >= 0.1 ? 'iyi' : r.ev <= -0.1 ? 'kotu' : 'notr';
      if (el.getAttribute('data-bo-r') !== durum) el.setAttribute('data-bo-r', durum);
    });
  }
  function butonKoy() {
    let b = document.getElementById('bo-btn');
    if (!b) {
      b = document.createElement('button');
      b.id = 'bo-btn';
      b.textContent = '🏀';
      b.addEventListener('click', () => {
        if (ayar.ses) sesHazirla();
        b.classList.remove('bo-uyari');
        const p = panel();
        if (p.style.display === 'block') { p.style.display = 'none'; return; }
        if (taraniyor) { p.style.display = 'block'; return; }
        sinyalSekmesi();
      });
      document.body.appendChild(b);
    }
    try { butonlariIsaretle(); } catch (e) {}
  }
  css();
  butonKoy();
  setInterval(butonKoy, 3000);
  setTimeout(() => { takipKontrol(); setInterval(takipKontrol, 60000); }, 15000);
})();
