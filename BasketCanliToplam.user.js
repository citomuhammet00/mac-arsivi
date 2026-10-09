// ==UserScript==
// @name         Basket Canlı Toplam
// @namespace    basketcanlitoplam
// @version      2.0
// @description  Bilyoner canlı basketbol toplam sayı alt/üst (maç, takım, çeyrek/periyot, yarı): top top simülasyon, geçmiş maçlardan takım güçleri, çizgi öğrenme, çoklu maç tarama, piyasa harmanı, gölge kayıt
// @match        https://www.bilyoner.com/*
// @noframes
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_setClipboard
// @connect      sofascore.com
// @connect      www.sofascore.com
// @connect      api.sofascore.com
// @connect      www.bilyoner.com
// @updateURL    https://raw.githubusercontent.com/citomuhammet00/mac-arsivi/main/BasketCanliToplam.user.js
// @downloadURL  https://raw.githubusercontent.com/citomuhammet00/mac-arsivi/main/BasketCanliToplam.user.js
// @run-at       document-end
// ==/UserScript==
(function () {
  'use strict';

  const SURUM = '2.0';
  const SS = 'https://www.sofascore.com/api/v1';
  const BIL = 'https://www.bilyoner.com/api/v3/mobile/aggregator/match-card/';
  const SIM_N = [2000, 3000];  // simüle edilen maç sayısı: ilk yarı / ikinci yarı (ihtimal hatası ~%1)
  const DONGU = 45;            // canlı takip aralığı (sn)
  const DONGU_ONCE = 180;      // maç başlamadan önce kontrol aralığı (sn)
  const GOLGE_MAX = 3000;
  // Karar eşikleri: A = büyük ligler, B = diğerleri. Dönem (çeyrek/yarı) ve takım pazarları daha gürültülü olduğu için ek pay.
  const ESIK = { A: { p: 0.56, ev: 0.06 }, B: { p: 0.60, ev: 0.09 }, donem: 0.02, takim: 0.01, zayifOncul: 0.02 };
  // Bot ile Bilyoner'in ihtimalleri bundan fazla ayrışırsa sinyal yok (bot büyük ihtimalle bir şeyi bilmiyor: sakatlık, rotasyon, veri hatası)
  const AYRILIK = { guclu: 0.30, orta: 0.26, zayif: 0.22 };
  const TARA_MAX = 15, TARA_ARALIK = 240;   // tarama: en fazla maç, otomatik tarama aralığı (sn)
  const AGIRLIK0 = { a: 0.6, b: 0.4 };   // son ihtimal = model ile Bilyoner'in harmanı; kayıtlar biriktikçe öğrenilir
  const REF_FIBA = { ppp: 1.08, p2: 0.52, p3: 0.35, ft: 0.75, r3: 0.36, trip: 0.12, to: 0.14 };
  const REF_NBA = { ppp: 1.13, p2: 0.54, p3: 0.36, ft: 0.78, r3: 0.40, trip: 0.11, to: 0.125 };
  const BUYUK_LIG = /(^| )nba( |$)|euroleague|eurocup|endesa|(^| )acb( |$)|basketbol super|super lig|(^| )bsl( |$)|lega basket|(^| )lba( |$)|serie a|pro a|(^| )lnb( |$)|(^| )bbl( |$)|bundesliga|(^| )aba( |$)|admiralbet|(^| )vtb( |$)|basket league|greek|(^| )nbl( |$)|(^| )cba( |$)|champions league|lkl|winner league/;
  const KUCUK_ISARET = /preseason|pre season|hazirlik|women|kadin|wnba|(^| )u\d\d( |$)|summer|youth|friendly|friendlies|exhibition/;
  const TAKIM_ES = {
    'kizilyildiz': 'crvena zvezda', 'kizil yildiz': 'crvena zvezda', 'bayern munih': 'bayern', 'munih': 'bayern', 'paris': 'paris basketball',
    'olimpiakos': 'olympiacos', 'olympiakos': 'olympiacos', 'barselona': 'barcelona', 'monako': 'monaco', 'valensiya': 'valencia',
    'milano': 'olimpia milano', 'virtus bolonya': 'virtus bologna', 'bolonya': 'virtus bologna', 'panatinaikos': 'panathinaikos', 'zalgiris kaunas': 'zalgiris'
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
  const h = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const v0 = x => String(Math.round(x));
  const v1 = x => (Math.round(x * 10) / 10).toFixed(1).replace('.', ',');
  const v2 = x => Number(x).toFixed(2).replace('.', ',');
  const yuzde = x => '%' + Math.round(x * 100);
  const isaretli = x => Math.abs(x) < 0.005 ? '±0%' : (x >= 0 ? '+' : '−') + Math.abs(Math.round(x * 100)) + '%';
  const isaretliSayi = x => (x >= 0 ? '+' : '−') + v1(Math.abs(x));
  const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN;
  const sinirla = (x, a, b) => Math.min(b, Math.max(a, x));
  const logit = p => { p = sinirla(p, 0.001, 0.999); return Math.log(p / (1 - p)); };
  const sigm = z => 1 / (1 + Math.exp(-z));
  const r3 = x => Math.round(x * 1000) / 1000;
  const sureYaz = sn => { sn = Math.max(0, Math.round(sn)); return Math.floor(sn / 60) + ':' + String(sn % 60).padStart(2, '0'); };
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
  // Nesnede en eski kayıtları at (z = zaman)
  function buda(o, max) {
    const k = Object.keys(o);
    if (k.length > max) k.sort((a, b) => (o[a].z || 0) - (o[b].z || 0)).slice(0, k.length - max).forEach(x => delete o[x]);
    return o;
  }

  // ---------- İstekler ----------
  function istek(url, opt) {
    opt = opt || {};
    const ad = opt.ad || 'Sunucu';
    return new Promise((coz, red) => {
      GM_xmlhttpRequest({
        method: 'GET', url, timeout: opt.sure || 20000,
        headers: { Accept: 'application/json' },
        onload: r => {
          if (r.status !== 200) { const e = new Error(ad + ' cevabı ' + r.status); e.kod = r.status; return red(e); }
          try { coz(JSON.parse(r.responseText)); } catch (e) { red(new Error(ad + ' verisi okunamadı')); }
        },
        onerror: () => red(new Error(ad + ': bağlantı hatası')),
        ontimeout: () => red(new Error(ad + ': zaman aşımı'))
      });
    });
  }
  let ssSinirZ = 0, ssSira = 0;
  const uyu = ms => new Promise(r => setTimeout(r, ms));
  async function ssAl(yol) {
    if (Date.now() < ssSinirZ) throw new Error('Sofascore geçici sınır koydu, ' + Math.ceil((ssSinirZ - Date.now()) / 60000) + ' dk bekleniyor');
    // istekler arasında en az 0,4 sn: tarama sırasında Sofascore'u yormamak için
    const bekle = ssSira - Date.now();
    ssSira = Math.max(Date.now(), ssSira) + 400;
    if (bekle > 0) await uyu(bekle);
    try { return await istek(SS + yol, { ad: 'Sofascore' }); }
    catch (e) { if (e.kod === 403 || e.kod === 429) ssSinirZ = Date.now() + 5 * 60000; throw e; }
  }
  const turnuvaAdi = e => { const ut = e && e.tournament && e.tournament.uniqueTournament; return (ut && ut.name) || (e && e.tournament && e.tournament.name) || ''; };

  // ---------- Bilyoner oranları ----------
  function oranTopla(v) {
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
    return oranlar;
  }
  // API çalışmazsa oranları sayfadan oku (30'dan büyük sayılar çizgidir, küçükler orandır)
  function domOranlar() {
    const out = [];
    document.querySelectorAll('.market-box').forEach(kutu => {
      const hd = kutu.querySelector('[class*="header"], [class*="title"], [class*="name"]');
      const baslik = ((hd ? hd.textContent : '') || '').trim();
      if (!baslik) return;
      kutu.querySelectorAll('.odd').forEach(el => {
        const parca = String(el.innerText || el.textContent || '').split('\n').map(s => s.trim()).filter(Boolean);
        const etiket = [], oran = [];
        parca.forEach(s => { const sayi = /^\d+[.,]\d+$/.test(s) ? parseFloat(s.replace(',', '.')) : NaN; if (sayi > 1 && sayi < 30) oran.push(sayi); else etiket.push(s); });
        if (etiket.length && oran.length) out.push({ pazar: baslik, n: etiket.join(' '), val: oran[oran.length - 1] });
      });
    });
    return out;
  }
  const DIGER_ISTAT = /ucluk|uclu|ribaund|asist|faul|blok|top calma|serbest atis|mola|top kaybi|sayi farki|farki/;
  // Pazar başlığı → { tur: mac|ev|dep, donem: null|{t:q|y,k}, ot: uzatma dahil mi }
  function pazarSinifi(ad, ev, dep) {
    const p = ' ' + norm(ad) + ' ';
    if (/handikap|mac sonucu| ms |tek cift|hangi|yaris|oyuncu|kombine|kombo| ve |en cok|en az|ilk sayi|son sayi|cifte sans|kazanir|kazanan|beraberlik|aralik/.test(p)) return null;
    if (DIGER_ISTAT.test(p)) return null;
    if (!/toplam|sayi|alt|ust/.test(p)) return null;
    let donem = null, m;
    if ((m = p.match(/ (\d) ?\.? ?(ceyrek|periyot)/))) donem = { t: 'q', k: +m[1] };   // Bilyoner çeyreğe "Periyot" diyor
    else if ((m = p.match(/ (\d) ?\.? ?yari/))) donem = { t: 'y', k: +m[1] };
    else if (/ ilk yari /.test(p)) donem = { t: 'y', k: 1 };
    else if (/ ikinci yari /.test(p)) donem = { t: 'y', k: 2 };
    else if (/ceyrek|yari|periyot/.test(p)) return null;
    let tur = 'mac';
    if (/ev sahibi/.test(p)) tur = 'ev';
    else if (/deplasman/.test(p)) tur = 'dep';
    else if (ev || dep) {
      const pt = tokenlar(ad), be = ev ? benzerlik(tokenlar(ev), pt) : 0, bd = dep ? benzerlik(tokenlar(dep), pt) : 0;
      if (be > bd && be > 0) tur = 'ev'; else if (bd > be && bd > 0) tur = 'dep';
    }
    let ot;
    if (/uzatma(lar)? dahil/.test(p)) ot = true;
    else if (/normal sure|uzatma(lar)? haric|uzatmasiz/.test(p)) ot = false;
    else ot = donem ? (donem.t === 'y' && donem.k === 2) : true;   // varsayım: maç ve takım toplamı, 2. yarı uzatma dahil; çeyrekler hariç
    return { tur, donem, ot };
  }
  function cizgiCoz(n, pazar) {
    const s = ' ' + norm(n).replace(/,/g, '.') + ' ';
    const yon = / alt /.test(s) ? 'a' : / ust /.test(s) ? 'u' : null;
    if (!yon) return null;
    const m = s.match(/(\d{1,3})\.5(?!\d)/) || (' ' + norm(pazar).replace(/,/g, '.') + ' ').match(/(\d{1,3})\.5(?!\d)/);
    if (!m) return null;
    return { yon, L: +m[1] + 0.5 };
  }
  const donemKod = d => d ? d.t + d.k : '';
  const donemCoz = s => s ? { t: s[0], k: +s.slice(1) } : null;
  function pazarlar(oranlar, ev, dep) {
    const g = {};
    oranlar.forEach(o => {
      const s = pazarSinifi(o.pazar, ev, dep);
      if (!s) return;
      const c = cizgiCoz(o.n, o.pazar);
      if (!c) return;
      const k = s.tur + '|' + donemKod(s.donem) + '|' + (s.ot ? 1 : 0) + '|' + c.L;
      const x = g[k] || (g[k] = { k, tur: s.tur, donem: s.donem, ot: s.ot, L: c.L, ad: o.pazar });
      x[c.yon] = o.val;
    });
    return Object.values(g).filter(x => x.a > 1 && x.u > 1);
  }
  // Bilyoner'in ev sahibi Sofascore'da deplasmandaysa takım pazarlarını çevir
  const yonlu = (pz, C) => !C.ters ? pz : pz.map(x => {
    if (x.tur === 'mac') return x;
    const t = x.tur === 'ev' ? 'dep' : 'ev';
    return Object.assign({}, x, { tur: t, k: t + x.k.slice(x.k.indexOf('|')) });
  });
  async function bilyonerOranlar(bid, canliMi, C) {
    C = C || T;
    const denenen = [];
    for (const c of (canliMi ? ['true'] : ['false', 'true'])) {
      const ad = c === 'true' ? 'canlı API' : 'maç öncesi API';
      try {
        const v = await istek(BIL + bid + '/odds?isLiveEvent=' + c + '&isPopular=false', { ad: 'Bilyoner' });
        const oranlar = oranTopla(v);
        const ev = (v && typeof v.homeTeam === 'string' && v.homeTeam) || '', dep = (v && typeof v.awayTeam === 'string' && v.awayTeam) || '';
        const pz = pazarlar(oranlar, ev, dep);
        denenen.push(ad + ': ' + oranlar.length + ' oran, ' + pz.length + ' alt/üst çizgisi');
        if (pz.length) return { ev, dep, oranlar, pz: yonlu(pz, C), kaynak: 'Bilyoner ' + ad, denenen };
        if (ev && dep) { C.evAdBil = C.evAdBil || ev; C.depAdBil = C.depAdBil || dep; }
      } catch (e) { denenen.push(ad + ': ' + e.message); }
    }
    if (sayfaId() === String(bid)) {   // sayfadan okuma sadece açık olan maç için
      const d = domOranlar();
      const pz = pazarlar(d, C.evAdBil || '', C.depAdBil || '');
      denenen.push('sayfadan: ' + d.length + ' oran, ' + pz.length + ' alt/üst çizgisi');
      if (pz.length) return { ev: '', dep: '', oranlar: d, pz: yonlu(pz, C), kaynak: 'Bilyoner sayfası', denenen };
    }
    const e = new Error('Bilyoner alt/üst oranları okunamadı');
    e.denenen = denenen;
    throw e;
  }
  // Çizgilerden piyasanın beklediği ortalamayı çıkar (oranın ima ettiği ihtimal + normal dağılım)
  function ortalamaCizgi(liste, sdOran) {
    let top = 0, w = 0;
    liste.forEach(x => {
      const iu = 1 / x.u, ia = 1 / x.a, pu = iu / (iu + ia);
      if (pu < 0.08 || pu > 0.92) return;
      const wi = pu * (1 - pu);
      top += wi * (x.L + sdOran * x.L * phiTers(pu)); w += wi;
    });
    return w > 0 ? top / w : null;
  }

  // ---------- Sofascore: maç, saat, istatistik ----------
  function skorParca(sc) {
    const per = [];
    let ot = 0, otSay = 0;
    Object.keys(sc || {}).forEach(k => {
      const m = k.match(/^period(\d+)$/);
      if (m) per[+m[1] - 1] = +sc[k] || 0;
      if (/^overtime\d*$/.test(k)) { ot += +sc[k] || 0; otSay++; }
    });
    for (let i = 0; i < per.length; i++) if (per[i] == null) per[i] = 0;
    return { per, ot, otSay, cur: +((sc || {}).current) || 0 };
  }
  const SIRA = { '1st': 1, '2nd': 2, '3rd': 3, '4th': 4, first: 1, second: 2, third: 3, fourth: 4 };
  // Sofascore'un "played" alanı bazı maçlarda toplam, bazılarında periyot içi saniye veriyor: dönemde atılan sayıya en uyan yorum seçilir
  function saatDurumu(e, simdi, pps) {
    const t = e.time || {}, st = e.status || {};
    const pl = +t.periodLength || 600, ol = +t.overtimeLength || 300, np = +t.totalPeriodCount || 4;
    const hs = skorParca(e.homeScore), as = skorParca(e.awayScore);
    const d = norm(st.description || '');
    const o = { pl, ol, np, sh: hs.cur, sa: as.cur, qh: hs.per, qa: as.per, nOT: Math.max(hs.otSay, as.otSay), aciklama: st.description || '', kod: st.code };
    if (st.type === 'notstarted') return Object.assign(o, { durum: 'baslamadi' });
    if (st.type === 'finished') return Object.assign(o, { durum: 'bitti' });
    if (st.type !== 'inprogress') return Object.assign(o, { durum: 'bilinmiyor' });
    const nPer = Math.max(hs.per.length, as.per.length);
    let per = null, ara = false;
    if (/half ?time|devre arasi/.test(d)) { per = (nPer || np / 2) + 1; ara = true; }
    else if (/pause|break|end of|interval|awaiting|(^| )ara( |$)/.test(d)) { per = nPer + o.nOT + 1; ara = true; }
    else if (/overtime|uzatma/.test(d)) per = np + Math.max(1, o.nOT);
    else { const m = d.match(/(1st|2nd|3rd|4th|first|second|third|fourth)/); if (m) per = SIRA[m[1]]; }
    if (per == null) {
      const kodlar = { 13: 1, 14: 2, 15: 3, 16: 4, 6: 1, 7: 2 };
      if (kodlar[st.code] && np === (st.code <= 7 ? 2 : 4)) per = kodlar[st.code];
      else if (st.code === 31) { per = np / 2 + 1; ara = true; }
    }
    if (per == null) return Object.assign(o, { durum: 'bilinmiyor' });
    const len = per <= np ? pl : ol;
    const base = per <= np ? (per - 1) * pl : np * pl + (per - np - 1) * ol;
    let ic = null;
    if (ara) ic = 0;
    else {
      const played = Number(t.played);
      const adaylar = [];
      if (isFinite(played)) {
        if (played >= base - 5 && played <= base + len + 5) adaylar.push(played - base);
        if (base > 0 && played <= len + 5) adaylar.push(played);
      }
      const qPts = per <= np ? (hs.per[per - 1] || 0) + (as.per[per - 1] || 0) : null;
      if (adaylar.length > 1 && qPts != null && pps > 0) { const bek = qPts / pps; adaylar.sort((x, y) => Math.abs(x - bek) - Math.abs(y - bek)); }
      if (adaylar.length) ic = adaylar[0];
      if (ic != null && t.clockRunning) {
        const lu = Date.parse(t.playedLastUpdated || t.clockRunningLastUpdated || '') || 0;
        if (lu) ic += Math.min(60, Math.max(0, (simdi - lu) / 1000)) * 0.7;   // saat işliyorsa son güncellemeden beri geçen sürenin bir kısmı
      }
    }
    if (ic == null) return Object.assign(o, { durum: 'bilinmiyor', per });
    ic = sinirla(ic, 0, len);
    const sonDegisim = e.changes && e.changes.changeTimestamp ? simdi / 1000 - e.changes.changeTimestamp : null;
    return Object.assign(o, { durum: ara ? 'ara' : 'oynaniyor', per, kalan: len - ic, len, gecen: base + ic, ara, saatIsliyor: !!t.clockRunning && !ara, sonDegisim });
  }
  function istatCoz(v, per) {
    const P = ((v && v.statistics) || []).find(x => x.period === per);
    if (!P) return null;
    const it = {};
    (P.groups || []).forEach(g => (g.statisticsItems || []).forEach(x => { if (x && x.key) it[x.key] = x; }));
    const yap = taraf => {
      const val = k => it[k] ? +it[k][taraf + 'Value'] : NaN, top = k => it[k] ? +it[k][taraf + 'Total'] : NaN;
      return {
        p2m: val('twoPointersScored'), p2a: top('twoPointersScored'), p3m: val('threePointersScored'), p3a: top('threePointersScored'),
        ftm: val('freeThrowsScored'), fta: top('freeThrowsScored'), oreb: val('offensiveRebounds'), tov: val('turnovers'), faul: val('totalFouls')
      };
    };
    const hh = yap('home'), aa = yap('away');
    const tamam = x => [x.p2m, x.p2a, x.p3m, x.p3a, x.ftm, x.fta].every(n => isFinite(n));
    return { h: hh, a: aa, tamam: tamam(hh) && tamam(aa) };
  }
  const puanIst = x => 2 * (x.p2m || 0) + 3 * (x.p3m || 0) + (x.ftm || 0);
  function hucumSay(x) {
    const fga = (x.p2a || 0) + (x.p3a || 0);
    const oreb = isFinite(x.oreb) ? x.oreb : 0.27 * (fga - (x.p2m || 0) - (x.p3m || 0));
    const tov = isFinite(x.tov) ? x.tov : 0.13 * (fga + 0.44 * (x.fta || 0));
    return Math.max(1, fga - oreb + tov + 0.44 * (x.fta || 0));
  }
  // Şans: lig ortalaması isabetle beklenenin üstünde/altında atılan sayının şansa bağlı kısmı (üçlük en çok, serbest atış orta, ikilik en az)
  const sansHesap = (x, ref) => 0.7 * 3 * ((x.p3m || 0) - (x.p3a || 0) * ref.p3) + 0.4 * 2 * ((x.p2m || 0) - (x.p2a || 0) * ref.p2) + 0.5 * ((x.ftm || 0) - (x.fta || 0) * ref.ft);
  function komp(x, pos, ref) {
    if (!x || !(pos > 0)) return { trip: ref.trip, r3: ref.r3, to: ref.to, ftp: ref.ft, p2: ref.p2, p3: ref.p3 };
    const K = 40;
    return {
      trip: sinirla(((x.fta || 0) / 2 + ref.trip * K) / (pos + K), 0.05, 0.25),
      r3: sinirla(((x.p3a || 0) + ref.r3 * K) / (pos + K), 0.15, 0.6),
      to: sinirla(((isFinite(x.tov) ? x.tov : ref.to * pos) + ref.to * K) / (pos + K), 0.06, 0.25),
      ftp: sinirla(((x.ftm || 0) + ref.ft * 30) / ((x.fta || 0) + 30), 0.55, 0.92),
      p2: ref.p2, p3: ref.p3
    };
  }
  // Biten maçı kısa kayda çevir: [id, zaman, evId, depId, evSayı, depSayı, evÇeyrekler, depÇeyrekler, uzatma]
  function sikistir(e) {
    if (!e || !e.status || e.status.type !== 'finished' || !e.homeScore || !e.awayScore || !e.homeTeam || !e.awayTeam) return null;
    const hs = skorParca(e.homeScore), as = skorParca(e.awayScore);
    if (hs.per.length < 2 || hs.per.length !== as.per.length || !(hs.cur + as.cur > 60)) return null;
    return [e.id, e.startTimestamp || 0, e.homeTeam.id, e.awayTeam.id, hs.cur, as.cur, hs.per, as.per, hs.otSay || as.otSay || hs.ot || as.ot ? 1 : 0];
  }
  function ligProfiliHesapla(ev) {
    const Ts = [], Q = [[], [], [], []], kop = [], ot = [];
    (ev || []).forEach(c => {
      const qh = c[6], qa = c[7];
      Ts.push(c[4] + c[5]);
      ot.push(c[8]);
      if (qh.length !== 4) return;
      for (let i = 0; i < 4; i++) Q[i].push(qh[i] + qa[i]);
      kop.push({ d: Math.abs(qh[0] + qh[1] + qh[2] - qa[0] - qa[1] - qa[2]), q4: qh[3] + qa[3] });
    });
    if (Ts.length < 8) return null;
    const ort = mean(Ts), sd = Math.sqrt(mean(Ts.map(x => (x - ort) * (x - ort))));
    const q = Q[0].length >= 8 ? Q.map(a => mean(a)) : null;
    const k = kop.filter(x => x.d >= 18);
    return { n: Ts.length, ort, sd, q, ot: mean(ot), kopR: q && k.length >= 4 ? sinirla(mean(k.map(x => x.q4)) / q[3], 0.8, 1.05) : null, kopN: k.length };
  }
  // Takım güçleri: her takımın hücum ve savunma değeri, rakibin gücüne göre düzeltilerek bulunur (yeni maçlar daha ağır)
  function reytingHesapla(ev, simdiSn) {
    const G = (ev || []).map(c => ({ h: c[2], a: c[3], sh: c[4], sa: c[5], w: Math.exp(-Math.max(0, simdiSn - c[1]) / 86400 / 90) }));
    if (G.length < 10) return null;
    let sw = 0, sp = 0, sf = 0;
    G.forEach(g => { sw += g.w; sp += g.w * (g.sh + g.sa) / 2; sf += g.w * (g.sh - g.sa); });
    const mu = sp / sw, hfa = sf / (sw + 20);
    const off = {}, def = {}, n = {}, say = {};
    G.forEach(g => [g.h, g.a].forEach(t => { n[t] = (n[t] || 0) + g.w; say[t] = (say[t] || 0) + 1; off[t] = 0; def[t] = 0; }));
    const LAM = 3;
    for (let it = 0; it < 25; it++) {
      const so = {}, sd = {};
      G.forEach(g => {
        const bh = mu + hfa / 2, ba = mu - hfa / 2;
        so[g.h] = (so[g.h] || 0) + g.w * (g.sh - bh - def[g.a]);
        so[g.a] = (so[g.a] || 0) + g.w * (g.sa - ba - def[g.h]);
        sd[g.h] = (sd[g.h] || 0) + g.w * (g.sa - ba - off[g.a]);
        sd[g.a] = (sd[g.a] || 0) + g.w * (g.sh - bh - off[g.h]);
      });
      Object.keys(n).forEach(t => { off[t] = so[t] / (n[t] + LAM); def[t] = sd[t] / (n[t] + LAM); });
    }
    return { mu, hfa, off, def, n, say, mac: G.length };
  }
  function reytingTahmin(R, hid, aid) {
    if (!R || !(R.say[hid] >= 3) || !(R.say[aid] >= 3)) return null;
    const ph = R.mu + R.hfa / 2 + R.off[hid] + R.def[aid], pa = R.mu - R.hfa / 2 + R.off[aid] + R.def[hid];
    return { T: ph + pa, pay: sinirla(ph / (ph + pa), 0.35, 0.65), ph, pa, nH: R.n[hid], nA: R.n[aid], sayH: R.say[hid], sayA: R.say[aid], mac: R.mac };
  }

  // ---------- Model ----------
  function modelKur(S, on, istA, istP, lig, tier) {
    const ref = S.pl >= 720 ? REF_NBA : REF_FIBA;
    const regSn = S.np * S.pl;
    const T0 = on.T * 0.992;                                  // uzatma ve son dakika faulleri simülasyonda ayrıca oluşuyor
    const pace0 = T0 / (2 * ref.ppp);                         // takım başına hücum (normal süre)
    const ppp0h = T0 * on.pay / pace0, ppp0a = T0 * (1 - on.pay) / pace0;
    const oran = S.gecen / regSn;
    const istTamam = !!(istA && istA.tamam && Math.abs(puanIst(istA.h) - S.sh) <= 4 && Math.abs(puanIst(istA.a) - S.sa) <= 4);
    // Başlangıç beklentisi zayıfsa maçın kendi verisine daha hızlı geçilir
    const hiz = on.zayif ? 0.6 : on.orta ? 0.8 : 1;
    let posH, posA, pace, paceO, pppH, pppA, sansH = 0, sansA = 0, kompH, kompA, Kp, Ke;
    if (istTamam) {
      posH = hucumSay(istA.h); posA = hucumSay(istA.a);
      Kp = 30 * hiz; Ke = 70 * hiz;
      const posO = (posH + posA) / 2;
      paceO = oran > 0.03 ? posO / oran : pace0;
      pace = (pace0 * Kp + paceO * posO) / (Kp + posO);
      sansH = sansHesap(istA.h, ref); sansA = sansHesap(istA.a, ref);
      pppH = (ppp0h * Ke + (S.sh - sansH)) / (Ke + posH);
      pppA = (ppp0a * Ke + (S.sa - sansA)) / (Ke + posA);
      kompH = komp(istA.h, posH, ref); kompA = komp(istA.a, posA, ref);
    } else {
      // Sadece skor: sayı hızı güncellenir, verim önden gelir, takımlar arası pay skora göre kayar
      const pppOrt = (ppp0h + ppp0a) / 2;
      posH = posA = (S.sh + S.sa) / (2 * pppOrt);
      Kp = 45 * hiz; Ke = 1e9;
      paceO = oran > 0.03 ? posH / oran : pace0;
      pace = (pace0 * Kp + paceO * posH) / (Kp + posH);
      const nP = S.sh + S.sa, payO = nP > 0 ? S.sh / nP : on.pay;
      const pay = (on.pay * 60 + payO * nP) / (60 + nP);
      pppH = 2 * pppOrt * pay; pppA = 2 * pppOrt * (1 - pay);
      kompH = komp(null, 0, ref); kompA = komp(null, 0, ref);
    }
    let bonusH = 0, bonusA = 0;
    if (istP && S.per <= S.np && !S.ara) {
      if (istP.a.faul >= 4) bonusH = 0.07;      // deplasman faul limitinde: ev sahibi hücumda daha çok serbest atış
      if (istP.h.faul >= 4) bonusA = 0.07;
    }
    const carp = (tier === 'B' ? 1.25 : 1) * (on.zayif ? 1.3 : on.orta ? 1.15 : 1);
    const posOrt = (posH + posA) / 2;
    const sdPace = Math.max(0.012, 0.04 * Math.sqrt(Kp / (Kp + posOrt))) * carp;
    const sdH = (istTamam ? Math.max(0.015, 0.045 * Math.sqrt(Ke / (Ke + posH))) : 0.05) * carp;
    const sdA = (istTamam ? Math.max(0.015, 0.045 * Math.sqrt(Ke / (Ke + posA))) : 0.05) * carp;
    const kopR = lig && lig.kopR ? lig.kopR : 0.92;
    return {
      np: S.np, pl: S.pl, ol: S.ol, per: S.per, kalan: S.kalan, sh: S.sh, sa: S.sa, ara: !!S.ara,
      qPts: Array.from({ length: S.np }, (_, i) => (S.qh[i] || 0) + (S.qa[i] || 0)), qhPts: Array.from({ length: S.np }, (_, i) => S.qh[i] || 0), nOT: S.nOT || 0,
      pace, pppH, pppA, sdPace, sdH, sdA, kompH, kompA, bonusH, bonusA, kopP: Math.sqrt(kopR), kopE: Math.sqrt(kopR), faulSure: S.pl >= 720 ? 60 : 50,
      bilgi: { pace0, paceO, sansH, sansA, istTamam, ppp0h, ppp0a, posH, posA }
    };
  }
  // Tek hücumun sonucu (0/1/2/3). Hedef verim, isabet oranları ölçeklenerek tutturulur (hücum ribaundu dahil).
  function hucum(R, k, hedef, acele, bonus) {
    const t = Math.min(0.35, k.trip + bonus), r3 = acele ? Math.min(0.7, k.r3 * 1.7) : k.r3, to = k.to;
    const r2 = Math.max(0.05, 1 - t - r3 - to);
    const ftPuan = t * 2 * k.ftp, saha = r3 * 3 * k.p3 + r2 * 2 * k.p2 * 1.03;
    const m = sinirla(saha > 0 ? (hedef - ftPuan) / saha : 1, 0.55, 1.55);
    const u = R();
    if (u < t) return (R() < k.ftp ? 1 : 0) + (R() < k.ftp ? 1 : 0);
    if (u < t + to) return 0;
    if (u < t + to + r3) return R() < Math.min(0.92, k.p3 * m) ? 3 : 0;
    if (R() < Math.min(0.95, k.p2 * m)) return 2 + (R() < 0.05 && R() < k.ftp ? 1 : 0);
    return 0;
  }
  // Maçın kalanını top top binlerce kez oyna
  function simule(M, N, seed) {
    const R = rng(seed), Z = normalUret(R);
    const np = M.np, regSn = np * M.pl;
    const res = { tot: new Int16Array(N), reg: new Int16Array(N), h: new Int16Array(N), a: new Int16Array(N), ot: new Uint8Array(N), q: [], qh: [] };
    for (let k = 0; k < np; k++) { res.q.push(new Int16Array(N)); res.qh.push(new Int16Array(N)); }
    for (let i = 0; i < N; i++) {
      const pace = Math.max(M.pace * 0.6, M.pace * (1 + M.sdPace * Z()));
      const ph = M.pppH * (1 + M.sdH * Z()), pa = M.pppA * (1 + M.sdA * Z());
      const ortSure = regSn / (2 * pace);
      let sh = M.sh, sa = M.sa, per = M.per, kalan = M.kalan, otVar = M.nOT > 0;
      const q = M.qPts.slice(), qh = M.qhPts.slice();
      let top = R() < 0.5 ? 0 : 1, adim = 0;
      while (adim++ < 4000) {
        if (kalan <= 0.01) {
          if (per < np) { per++; kalan = M.pl; top = R() < 0.5 ? 0 : 1; continue; }
          if (sh === sa) { per++; kalan = M.ol; otVar = true; top = R() < 0.5 ? 0 : 1; continue; }
          break;
        }
        const sonPer = per >= np;
        const fark = sh - sa, d = Math.abs(fark), lider = fark > 0 ? 0 : fark < 0 ? 1 : -1;
        const ev = top === 0, k = ev ? M.kompH : M.kompA;
        let hedef = ev ? ph : pa;
        const kopma = (per === np && d >= 20) || (per === np - 1 && d >= 25 && kalan < M.pl * 0.4);
        const pm = kopma ? M.kopP : 1;
        if (kopma) hedef *= M.kopE;
        const bonus = per === M.per ? (ev ? M.bonusH : M.bonusA) : 0;
        const umut = d <= 2 * Math.ceil(kalan / 10) + 2;   // fark kalan sürede kapanabilecek kadar mı
        let sure, puan;
        if (sonPer && lider >= 0 && top === lider && umut && ((d <= 2 && kalan <= 24) || (d >= 4 && d <= 8 && kalan <= M.faulSure))) {
          sure = 2 + 4 * R();                          // geride olan takım bilerek faul yapar
          puan = (R() < k.ftp + 0.03 ? 1 : 0) + (R() < k.ftp + 0.03 ? 1 : 0);
        } else if (sonPer && lider >= 0 && top !== lider && d >= 3 && umut && kalan <= M.faulSure * 1.3) {
          sure = 4 + 8 * R();                          // geride olan takım hızlı ve üçlükle hücum eder
          puan = hucum(R, k, hedef, true, bonus);
        } else {
          sure = Math.min(26, Math.max(2, (ortSure / pm) * (0.45 + 1.1 * R())));
          puan = hucum(R, k, hedef, false, bonus);
        }
        if (sure > kalan) { if (R() > kalan / sure) puan = 0; sure = kalan; }   // dönem sonunda yarım kalan hücum
        if (ev) sh += puan; else sa += puan;
        if (per <= np) { q[per - 1] += puan; if (ev) qh[per - 1] += puan; }
        kalan -= sure;
        top = 1 - top;
      }
      res.tot[i] = sh + sa; res.h[i] = sh; res.a[i] = sa; res.ot[i] = otVar ? 1 : 0;
      let rt = 0;
      for (let k2 = 0; k2 < np; k2++) { res.q[k2][i] = q[k2]; res.qh[k2][i] = qh[k2]; rt += q[k2]; }
      res.reg[i] = rt;
    }
    return res;
  }
  // Dönem toplamı: f(k) = k. çeyreğin (ya da yarının) sayısı, otEk = uzatma sayıları (2. yarıya eklenir)
  function donemTop(f, np, d, otEk) {
    if (d.t === 'q') return f(d.k - 1);
    if (np === 2) return f(d.k - 1) + (d.k === 2 ? otEk : 0);
    return d.k === 1 ? f(0) + f(1) : f(2) + f(3) + otEk;
  }
  function ornekDegeri(res, x, np, i) {
    if (x.tur === 'mac') {
      if (!x.donem) return x.ot ? res.tot[i] : res.reg[i];
      return donemTop(k => res.q[k][i], np, x.donem, x.ot ? res.tot[i] - res.reg[i] : 0);
    }
    const ev = x.tur === 'ev', f = ev ? k => res.qh[k][i] : k => res.q[k][i] - res.qh[k][i];
    const top = ev ? res.h[i] : res.a[i];
    let reg = 0;
    for (let k = 0; k < np; k++) reg += f(k);
    if (!x.donem) return x.ot ? top : reg;
    return donemTop(f, np, x.donem, x.ot ? top - reg : 0);
  }
  // Bitmiş ya da bitmek üzere olan dönemlerin pazarları değerlendirilmez
  function donemGecerli(x, M) {
    if (!x.donem) return true;
    if (M.per > M.np) return false;
    const kisa = !M.ara && M.kalan < 90;
    if (x.donem.t === 'q') {
      if (M.np !== 4 || x.donem.k > 4 || x.donem.k < M.per) return false;
      return !(x.donem.k === M.per && kisa);
    }
    if (M.np === 4) {
      const son = x.donem.k === 1 ? 2 : 4;
      if (M.per > son) return false;
      return !(M.per === son && kisa);
    }
    if (M.np === 2) return x.donem.k >= M.per && !(x.donem.k === M.per && kisa);
    return false;
  }
  function degerlendir(M, res, pz, ctx) {
    let A = ctx.agirlik.a, B = ctx.agirlik.b;
    if (ctx.zayif) { A -= 0.1; B += 0.1; } else if (ctx.orta) { A -= 0.05; B += 0.05; }
    const es = ESIK[ctx.tier] || ESIK.B;
    const ayrMax = ctx.zayif ? AYRILIK.zayif : ctx.orta ? AYRILIK.orta : AYRILIK.guclu;
    const erken = ctx.zayif && ctx.gecen < M.np * M.pl / 2 ? ESIK.zayifOncul : 0;
    const N = res.tot.length, satirlar = [];
    pz.forEach(x => {
      if (!donemGecerli(x, M)) return;
      let ust = 0, top = 0;
      for (let i = 0; i < N; i++) { const v = ornekDegeri(res, x, M.np, i); top += v; if (v > x.L) ust++; }
      const pm = sinirla(ust / N, 0.005, 0.995);
      const iu = 1 / x.u, ia = 1 / x.a, pk = iu / (iu + ia);
      const pf = sigm(A * logit(pm) + B * logit(pk));
      const evU = pf * x.u - 1, evA = (1 - pf) * x.a - 1;
      const yon = evU >= evA ? 'u' : 'a';
      const p = yon === 'u' ? pf : 1 - pf, oran = yon === 'u' ? x.u : x.a, ev = Math.max(evU, evA);
      const ek = (x.donem ? ESIK.donem : 0) + (x.tur !== 'mac' ? ESIK.takim : 0) + erken;
      const minP = es.p + ek, minEv = es.ev + ek;
      const ayrik = Math.abs(pm - pk) > ayrMax;
      satirlar.push({ x, pm, pk, pf, bek: top / N, yon, p, oran, ev, marj: iu + ia - 1, minP, minEv, minOran: (1 + minEv) / p, ayrik, gecer: p >= minP && ev >= minEv && !ayrik });
    });
    satirlar.sort((a, b) => b.ev - a.ev);
    return satirlar;
  }
  function ozetCikar(res) {
    const N = res.tot.length, s = Array.from(res.tot).sort((x, y) => x - y);
    let ot = 0;
    for (let i = 0; i < N; i++) ot += res.ot[i];
    return { tot: mean(Array.from(res.tot)), lo: s[Math.floor(N * 0.05)], hi: s[Math.floor(N * 0.95)], h: mean(Array.from(res.h)), a: mean(Array.from(res.a)), ot: ot / N };
  }

  // ---------- Durum ----------
  const T = { aktif: false, gor: 'canli', say: 0, sinyalSay: {}, sonSinyalK: '', tarama: {}, otoTara: false, taramaZ: 0 };
  const ligSinifi = ad => { const n = norm(ad); return BUYUK_LIG.test(n) && !KUCUK_ISARET.test(n) ? 'A' : 'B'; };
  function esAd(ad) {
    let k = norm(ad);
    for (const a of Object.keys(TAKIM_ES)) if (k === a || k.startsWith(a + ' ')) { k = TAKIM_ES[a] + k.slice(a.length); break; }
    return k;
  }
  const takimTok = t => tokenlar((t.name || '') + ' ' + String(t.slug || '').replace(/-/g, ' ') + ' ' + (t.shortName || ''));
  function olayPuan(e, tEv, tDep) {
    const H = takimTok(e.homeTeam || {}), A = takimTok(e.awayTeam || {});
    const dH = benzerlik(tEv, H), dA = benzerlik(tDep, A), tH = benzerlik(tEv, A), tA = benzerlik(tDep, H);
    return Math.max(dH && dA ? Math.min(dH, 2) + Math.min(dA, 2) : 0, tH && tA ? Math.min(tH, 2) + Math.min(tA, 2) : 0);
  }
  async function ssEslestir(ev, dep, bid) {
    const ES = GM_getValue('bc_es', {});
    if (ES[bid] && Date.now() - ES[bid].z < 4 * 86400000) return ES[bid].e;
    let liste = T.canliListe || [];
    if (!T.canliZ || Date.now() - T.canliZ > 60000) {   // canlı maç listesi tarama boyunca 1 dk paylaşılır
      try { liste = (await ssAl('/sport/basketball/events/live')).events || []; T.canliZ = Date.now(); } catch (e) {}
      T.canliListe = liste;
    }
    const tEv = tokenlar(esAd(ev)), tDep = tokenlar(esAd(dep));
    if (!tEv.length || !tDep.length) return null;
    let en = null, ep = 0;
    liste.forEach(e => { const p = olayPuan(e, tEv, tDep); if (p > ep) { ep = p; en = e; } });
    if (!en || ep < 2) {
      try {   // henüz başlamadıysa: takımı ara, sıradaki maçlarına bak
        const v = await ssAl('/search/all?q=' + encodeURIComponent(tEv.join(' ')));
        const takimlar = (v.results || []).filter(r => r.type === 'team' && r.entity && r.entity.sport && r.entity.sport.slug === 'basketball').map(r => r.entity)
          .sort((a, b) => benzerlik(tEv, takimTok(b)) - benzerlik(tEv, takimTok(a)));
        for (const tm of takimlar.slice(0, 2)) {
          if (!(benzerlik(tEv, takimTok(tm)) > 0)) continue;
          const nv = await ssAl('/team/' + tm.id + '/events/next/0');
          (nv.events || []).forEach(e => { if (Math.abs(e.startTimestamp - Date.now() / 1000) > 36 * 3600) return; const p = olayPuan(e, tEv, tDep); if (p > ep) { ep = p; en = e; } });
          if (en && ep >= 2) break;
        }
      } catch (e) {}
    }
    if (!en || ep < 2) return null;
    ES[bid] = { e: en.id, z: Date.now() };
    GM_setValue('bc_es', buda(ES, 200));
    return en.id;
  }
  // Ligin geçmiş maçları (bu sezon, azsa geçen sezon da): lig profili + takım güçleri için. 12 saat saklanır.
  async function ligVerisi(ut, sid) {
    if (!ut || !sid) return null;
    const L = GM_getValue('bc_lig2', {}), k = ut + '|' + sid;
    if (L[k] && Date.now() - L[k].z < 12 * 3600000) return L[k];
    const ev = [], gor = new Set();
    const ekle = v => (v.events || []).forEach(e => { const c = sikistir(e); if (c && !gor.has(c[0])) { gor.add(c[0]); ev.push(c); } });
    for (let s = 0; s < 3; s++) {
      try { const v = await ssAl('/unique-tournament/' + ut + '/season/' + sid + '/events/last/' + s); ekle(v); if (!v.hasNextPage) break; }
      catch (e) { if (s === 0 && e.kod !== 404) throw e; break; }
    }
    if (ev.length < 40) {
      try {
        const ss = (await ssAl('/unique-tournament/' + ut + '/seasons')).seasons || [];
        const i = ss.findIndex(x => x.id === sid), onceki = i >= 0 ? ss[i + 1] : null;
        if (onceki) for (let s = 0; s < 2; s++) { const v = await ssAl('/unique-tournament/' + ut + '/season/' + onceki.id + '/events/last/' + s); ekle(v); if (!v.hasNextPage) break; }
      } catch (e) {}
    }
    const r = { z: Date.now(), ev, p: ligProfiliHesapla(ev) };
    L[k] = r;
    GM_setValue('bc_lig2', buda(L, 30));
    return r;
  }
  async function takimFormu(tid) {
    const F = GM_getValue('bc_form', {});
    if (F[tid] && Date.now() - F[tid].z < 20 * 3600000) return F[tid];
    const v = await ssAl('/team/' + tid + '/events/last/0');
    const ev = (v.events || []).filter(e => e.status && e.status.type === 'finished' && e.homeScore && e.awayScore && typeof e.homeScore.current === 'number' && !KUCUK_ISARET.test(norm(turnuvaAdi(e))))
      .sort((a, b) => b.startTimestamp - a.startTimestamp).slice(0, 10);
    if (ev.length < 4) return null;
    const r = {
      z: Date.now(), n: ev.length,
      f: mean(ev.map(e => e.homeTeam.id === tid ? e.homeScore.current : e.awayScore.current)),
      y: mean(ev.map(e => e.homeTeam.id === tid ? e.awayScore.current : e.homeScore.current))
    };
    F[tid] = r;
    GM_setValue('bc_form', buda(F, 300));
    return r;
  }
  // Takım güçlerinden maç beklentisi (lig verisi + son maç formu)
  async function gucTahmin(C) {
    let rt = null, fo = null;
    if (C.ligEv && C.ligEv.length >= 10) rt = reytingTahmin(reytingHesapla(C.ligEv, Date.now() / 1000), C.evId, C.depId);
    try {
      const [fh, fa] = await Promise.all([takimFormu(C.evId), takimFormu(C.depId)]);
      if (fh && fa) { const eh = (fh.f + fa.y) / 2 + 1, ea = (fa.f + fh.y) / 2 - 1; fo = { T: eh + ea, pay: sinirla(eh / (eh + ea), 0.35, 0.65) }; }
    } catch (e) {}
    const lg = C.lig && C.lig.ort;
    if (rt) {
      const T1 = fo ? 0.75 * rt.T + 0.25 * fo.T : rt.T, pay = fo ? sinirla(0.75 * rt.pay + 0.25 * fo.pay, 0.35, 0.65) : rt.pay;
      return { T: T1, pay, rt, guc: Math.min(rt.nH, rt.nA) >= 4 ? 'orta' : 'zayif', yazi: 'takım güçleri (ligde ' + rt.sayH + ' ve ' + rt.sayA + ' maç' + (fo ? ', + son maç formu' : '') + ') ' + v1(T1) };
    }
    if (fo) { const T1 = lg ? 0.65 * fo.T + 0.35 * lg : fo.T; return { T: T1, pay: fo.pay, guc: 'zayif', yazi: 'takımların son maç ortalamaları' + (lg ? ' + lig ortalaması' : '') + ' ' + v1(T1) }; }
    if (lg) return { T: lg, pay: 0.505, guc: 'zayif', yazi: 'lig ortalaması ' + v1(lg) };
    return null;
  }
  // Maç öncesi Bilyoner çizgisi: maç toplamı yoksa takım toplamları, o da yoksa ilk yarı ya da 1. periyot çizgisinden
  function macOnuCizgi(pz, sdO) {
    const sec = f => pz.filter(f);
    const Hm = ortalamaCizgi(sec(x => x.tur === 'ev' && !x.donem && x.ot), 0.09), Am = ortalamaCizgi(sec(x => x.tur === 'dep' && !x.donem && x.ot), 0.09);
    let Tm = ortalamaCizgi(sec(x => x.tur === 'mac' && !x.donem && x.ot), sdO), kay = 'maç toplamı';
    if (!Tm && Hm && Am) { Tm = Hm + Am; kay = 'takım toplamları'; }
    if (!Tm) { const y = ortalamaCizgi(sec(x => x.tur === 'mac' && x.donem && x.donem.t === 'y' && x.donem.k === 1), sdO * 1.4); if (y) { Tm = y * 2.03; kay = 'ilk yarı çizgisi'; } }
    if (!Tm) { const q = ortalamaCizgi(sec(x => x.tur === 'mac' && x.donem && x.donem.t === 'q' && x.donem.k === 1), sdO * 2); if (q) { Tm = q * 4.1; kay = '1. periyot çizgisi'; } }
    if (!Tm) return null;
    return { T: Tm, pay: Hm && Am ? sinirla(Hm / (Hm + Am), 0.35, 0.65) : 0.505, kay };
  }
  // Geçmiş sonuçlardan öğrenilen çizgi düzeltmesi: ligde Bilyoner çizgisi sistematik düşük/yüksek mi, takım güçleri çizgiye ne kadar bilgi katıyor
  function cizgiDuzelt(ut, Tl, Rt) {
    const X = GM_getValue('bc_cizgi', []);
    const lg = X.filter(r => r[0] === ut);
    const bias = lg.length >= 5 ? sinirla(lg.reduce((a, r) => a + (r[3] - r[1]), 0) / (lg.length + 15), -4, 4) : 0;
    let w = 0.15, xx = 0, xy = 0, n = 0;
    X.forEach(r => { if (r[2] != null) { const dx = sinirla(r[2] - r[1], -15, 15), dy = r[3] - r[1]; xx += dx * dx; xy += dx * dy; n++; } });
    if (n >= 30) w = sinirla((xy + 0.15 * 600) / (xx + 600), 0, 0.6);
    const ek = bias + (Rt != null ? w * sinirla(Rt - Tl, -15, 15) : 0);
    return { T: Tl + ek, ek, yazi: Math.abs(ek) >= 0.5 ? ' → geçmiş verilerle ' + isaretliSayi(ek) + ' = ' + v1(Tl + ek) : '' };
  }
  // Başlangıç beklentisi: maç öncesi çizgi (+öğrenilen düzeltme) > maçın ilk dakikalarındaki canlı çizgi > takım güçleri > form/lig
  async function onculHesap(C, S, canli) {
    const O = GM_getValue('bc_on', {}), kayit = O[C.bid];
    const pz = C.bil ? C.bil.pz : [];
    const sdO = S.pl >= 720 ? 0.065 : 0.075;
    if (!C.gucHazir) { C.gucHazir = true; try { C.guc = await gucTahmin(C); } catch (e) { C.guc = null; } }
    const Rt = C.guc ? C.guc.T : null;
    if (kayit && kayit.T > 50) {
      if (kayit.e == null && C.eid) { kayit.e = C.eid; kayit.ut = C.ut; kayit.R = Rt != null ? Math.round(Rt * 10) / 10 : null; GM_setValue('bc_on', O); }
      const d = cizgiDuzelt(C.ut, kayit.T, Rt);
      return { T: d.T, pay: kayit.pay, kaynak: 'mac_oncesi', zayif: false, yazi: 'maç öncesi Bilyoner çizgisi ' + v1(kayit.T) + (kayit.kay && kayit.kay !== 'maç toplamı' ? ' (' + kayit.kay + ')' : '') + d.yazi };
    }
    if (!canli) {
      const on = macOnuCizgi(pz, sdO);
      if (!on) return null;
      O[C.bid] = { T: on.T, pay: on.pay, kay: on.kay, z: Date.now(), e: C.eid, ut: C.ut, R: Rt != null ? Math.round(Rt * 10) / 10 : null };
      GM_setValue('bc_on', buda(O, 400));
      const d = cizgiDuzelt(C.ut, on.T, Rt);
      return { T: d.T, pay: on.pay, kaynak: 'mac_oncesi', zayif: false, yazi: 'maç öncesi Bilyoner çizgisi ' + v1(on.T) + (on.kay !== 'maç toplamı' ? ' (' + on.kay + ')' : '') + d.yazi };
    }
    if (S.gecen / (S.np * S.pl) <= 0.15) {
      const on = macOnuCizgi(pz, sdO);
      if (on && on.kay === 'maç toplamı') return { T: on.T, pay: on.pay, kaynak: 'ilk_canli', zayif: false, yazi: 'maçın başındaki canlı çizgi ' + v1(on.T) };
    }
    const g = C.guc;
    const Tt = g ? g.T : (S.pl >= 720 ? 225 : 158);
    return { T: Tt, taban: Tt, pay: g ? g.pay : 0.505, kaynak: g ? (g.rt ? 'guc' : 'form') : 'varsayilan', zayif: !g || g.guc !== 'orta', orta: !!g && g.guc === 'orta', dinamik: true, yazi: g ? g.yazi : 'varsayılan ' + v0(Tt) };
  }
  // Maç öncesi çizgi yoksa: başlangıç beklentisini her turda canlı Bilyoner çizgisiyle düzelt (tek başına zayıf tahmine körü körüne güvenmemek için)
  function canliCapa(C, S) {
    const on = C.oncul;
    if (!on || !on.dinamik || !C.bil) return;
    const oran = S.gecen / (S.np * S.pl);
    if (oran < 0.1 || oran > 0.85) return;
    const sdO = (S.pl >= 720 ? 0.065 : 0.075) * Math.sqrt(1 - oran);
    const Lm = ortalamaCizgi(C.bil.pz.filter(x => x.tur === 'mac' && !x.donem && x.ot), sdO);
    if (!Lm) return;
    const Timp = (Lm - S.sh - S.sa) / (1 - oran);
    if (!(Timp > 60)) return;
    const w = on.zayif ? 0.6 : 0.4;
    on.T = w * Timp + (1 - w) * on.taban;
    on.capa = Timp;
  }

  // ---------- Gölge kayıt, kayıtlar, öğrenme ----------
  function golgeYaz(C, cp, satirlar) {
    if (!satirlar || !satirlar.length) return;
    const G = GM_getValue('bc_golge', []), k = C.eid + '|' + cp;
    if (G.some(r => r.k === k)) return;
    const grup = {};
    satirlar.forEach(s => { const g = s.x.tur + donemKod(s.x.donem) + (s.x.ot ? 1 : 0); (grup[g] = grup[g] || []).push(s); });
    const sec = [];
    Object.values(grup).forEach(l => l.sort((a, b) => Math.abs(a.pk - 0.5) - Math.abs(b.pk - 0.5)).slice(0, 2).forEach(s => sec.push(s)));
    const L = sec.slice(0, 14).map(s => [s.x.tur, donemKod(s.x.donem), s.x.ot ? 1 : 0, s.x.L, r3(s.pm), r3(s.pk), s.x.u, s.x.a]);
    G.push({ k, e: C.eid, ut: C.ut, tr: C.tier, cp, g: Math.round(C.saat.gecen), sh: C.saat.sh, sa: C.saat.sa, on: C.oncul ? C.oncul.kaynak : '', z: Date.now(), v: SURUM, L, r: null });
    if (G.length > GOLGE_MAX) G.splice(0, G.length - GOLGE_MAX);
    GM_setValue('bc_golge', G);
  }
  // Canlı Bilyoner maç toplamı çizgisinin seyri (ileride geriye dönük test için): maç başına en fazla 45 nokta
  function cizgiLog(C) {
    const S = C.saat;
    if (!C.bil || !(S.durum === 'oynaniyor' || S.durum === 'ara')) return;
    const l = C.bil.pz.filter(x => x.tur === 'mac' && !x.donem && x.ot);
    if (!l.length) return;
    const x = l.slice().sort((a, b) => Math.abs(1 / a.u - 1 / a.a) - Math.abs(1 / b.u - 1 / b.a))[0];
    const H = GM_getValue('bc_hat', {}), r = H[C.eid] || (H[C.eid] = { z: 0, ut: C.ut, l: [] });
    const son = r.l[r.l.length - 1];
    if (son && S.gecen - son[0] < 100) return;
    r.l.push([Math.round(S.gecen), S.sh, S.sa, x.L, x.u, x.a]);
    if (r.l.length > 45) r.l.splice(0, r.l.length - 45);
    r.z = Date.now();
    GM_setValue('bc_hat', buda(H, 150));
  }
  function sonucCikar(e) {
    const hs = skorParca(e.homeScore), as = skorParca(e.awayScore);
    const np = (e.time && +e.time.totalPeriodCount) || 4, q = [], qh = [], qa = [];
    for (let i = 0; i < np; i++) { qh.push(hs.per[i] == null ? null : hs.per[i]); qa.push(as.per[i] == null ? null : as.per[i]); q.push(hs.per[i] == null || as.per[i] == null ? null : hs.per[i] + as.per[i]); }
    const reg = q.reduce((a, b) => a + (b || 0), 0);
    return { tot: hs.cur + as.cur, reg, h: hs.cur, a: as.cur, q, qh, qa, otPts: hs.cur + as.cur - reg, np };
  }
  function degerAl(sd, tur, dk, ot) {
    const d = donemCoz(dk);
    const dizi = tur === 'mac' ? sd.q : tur === 'ev' ? sd.qh : sd.qa;
    if (!dizi || dizi.some(v => v == null)) return d ? null : (tur === 'mac' ? sd.tot : tur === 'ev' ? sd.h : sd.a);
    const top = tur === 'mac' ? sd.tot : tur === 'ev' ? sd.h : sd.a;
    const reg = dizi.reduce((a, b) => a + b, 0);
    if (!d) return ot ? top : reg;
    if (d.t === 'q' && (sd.np !== 4 || d.k > 4)) return null;
    return donemTop(k => dizi[k], sd.np, d, ot ? top - reg : 0);
  }
  function sonuclandir(eid, e) {
    const sd = sonucCikar(e);
    const G = GM_getValue('bc_golge', []);
    let g = false;
    G.forEach(r => { if (String(r.e) === String(eid) && !r.r) { r.r = r.L.map(l => { const v = degerAl(sd, l[0], l[1], l[2]); return v == null ? -1 : v > l[3] ? 1 : 0; }); g = true; } });
    if (g) GM_setValue('bc_golge', G);
    const K = GM_getValue('bc_kayit', []);
    let k = false;
    K.forEach(r => {
      if (String(r.e) !== String(eid) || r.sonuc) return;
      const v = degerAl(sd, r.tur, r.d, r.ot);
      if (v == null) return;
      r.sonuc = { deger: v, durum: (r.yon === 'u') === (v > r.L) ? 'tuttu' : 'tutmadi', z: Date.now() };
      k = true;
    });
    if (k) GM_setValue('bc_kayit', K);
    // Maç öncesi çizgi → gerçek sonuç: çizgi öğrenmesi için
    const O = GM_getValue('bc_on', {});
    let o = false;
    Object.keys(O).forEach(b => {
      const r = O[b];
      if (String(r.e) !== String(eid) || r.son) return;
      r.son = 1; o = true;
      const X = GM_getValue('bc_cizgi', []);
      X.push([r.ut, Math.round(r.T * 10) / 10, r.R == null ? null : r.R, sd.tot, Date.now()]);
      GM_setValue('bc_cizgi', X.slice(-2000));
    });
    if (o) GM_setValue('bc_on', O);
    if (g) ogren();
  }
  const agirlikAl = () => Object.assign({}, AGIRLIK0, GM_getValue('bc_ogren', {}));
  // Modelin ve Bilyoner'in ihtimallerini gerçek sonuçlarla karşılaştırıp harman ağırlığını öğren (en az 150 sonuç)
  function ogren() {
    const X = [];
    GM_getValue('bc_golge', []).forEach(r => (r.r || []).forEach((y, i) => { if (y === 0 || y === 1) X.push([logit(r.L[i][4]), logit(r.L[i][5]), y]); }));
    const eski = GM_getValue('bc_ogren', {});
    if (X.length < 150) { GM_setValue('bc_ogren', Object.assign(eski, { n: X.length })); return; }
    let a = AGIRLIK0.a, b = AGIRLIK0.b;
    const lam = 20 / X.length;
    for (let it = 0; it < 300; it++) {
      let ga = 0, gb = 0;
      X.forEach(([m, k, y]) => { const p = sigm(a * m + b * k); ga += (p - y) * m; gb += (p - y) * k; });
      a -= 0.3 * (ga / X.length + lam * (a - AGIRLIK0.a));
      b -= 0.3 * (gb / X.length + lam * (b - AGIRLIK0.b));
    }
    GM_setValue('bc_ogren', { a: sinirla(a, 0, 1.5), b: sinirla(b, 0, 1.5), n: X.length, z: Date.now() });
  }
  // tip: 'sinyal' (botun sinyali) ya da 'elle' (tablodan kendi seçimin)
  function kayitEkle(C, s, tip) {
    if (!s || !C.saat) return false;
    const K = GM_getValue('bc_kayit', []);
    const id = C.eid + '|' + s.x.k + '|' + s.yon;
    if (K.some(r => r.id === id && !r.sonuc)) return false;
    K.unshift({
      id, e: C.eid, bid: C.bid, mac: (C.evAd || C.evAdBil || '') + ' - ' + (C.depAd || C.depAdBil || ''), lig: C.ligAd || '', tur: s.x.tur, d: donemKod(s.x.donem), ot: s.x.ot, L: s.x.L, yon: s.yon,
      ad: pazarAd(s.x, C), oran: s.oran, p: r3(s.p), pm: r3(s.pm), pk: r3(s.pk), ev: r3(s.ev), z: Date.now(), an: periyotYazi(C.saat), skor: C.saat.sh + '-' + C.saat.sa,
      v: SURUM, tip: tip || 'sinyal', gecer: s.gecer ? 1 : 0, sonuc: null
    });
    GM_setValue('bc_kayit', K.slice(0, 500));
    return true;
  }
  async function bekleyenleriKontrol() {
    const K = GM_getValue('bc_kayit', []), G = GM_getValue('bc_golge', []), O = GM_getValue('bc_on', {});
    const ids = new Set(), simdi = Date.now();
    K.forEach(r => { if (!r.sonuc && simdi - r.z > 2 * 3600000) ids.add(String(r.e)); });
    G.forEach(r => { if (!r.r && simdi - r.z > 2 * 3600000) ids.add(String(r.e)); });
    Object.values(O).forEach(r => { if (r.e && !r.son && simdi - r.z > 4 * 3600000 && simdi - r.z < 6 * 86400000) ids.add(String(r.e)); });
    let n = 0;
    for (const eid of [...ids].slice(0, 15)) {
      try {
        const v = await ssAl('/event/' + eid), e = v.event || v;
        if (e.status && e.status.type === 'finished') { sonuclandir(eid, e); n++; }
        else if (e.status && (e.status.type === 'canceled' || e.status.type === 'postponed')) {
          const K2 = GM_getValue('bc_kayit', []);
          K2.forEach(r => { if (String(r.e) === eid && !r.sonuc) r.sonuc = { durum: 'iade', z: Date.now() }; });
          GM_setValue('bc_kayit', K2);
          const O2 = GM_getValue('bc_on', {});
          Object.values(O2).forEach(r => { if (String(r.e) === eid) r.son = 1; });
          GM_setValue('bc_on', O2);
          n++;
        }
      } catch (err) { if (Date.now() < ssSinirZ) break; }
    }
    return n;
  }

  // ---------- Takip döngüsü (takip edilen maç ve taranan maçlar aynı işlemden geçer) ----------
  function sinyalYasak(C, S) {
    if (Date.now() < ssSinirZ) return 'Sofascore geçici sınır koydu';
    if (!C.bil) return 'Bilyoner oranı okunamadı';
    if (S.durum === 'oynaniyor' && S.gecen < 300) return 'İlk 5 dakika: veri henüz az';
    if (S.durum === 'oynaniyor' && S.per >= S.np && S.kalan < 60) return 'Son dakika: oranlar çok hızlı değişiyor';
    if (S.saatIsliyor && S.sonDegisim != null && S.sonDegisim > 150) return 'Sofascore verisi ' + Math.round(S.sonDegisim / 60) + ' dakikadır güncellenmedi (gecikme olabilir)';
    if (C.istA && C.istZ && Date.now() - C.istZ > 300000) return 'İstatistik verisi eski';
    return '';
  }
  function hesapla(C) {
    const S = C.saat;
    // Skor, saat ve oranlar değişmediyse (mola, çeyrek arası) baştan hesaplama: pil tasarrufu
    const imza = [S.sh, S.sa, S.per, Math.round(S.kalan / 5), C.istZ, C.oncul.T.toFixed(1), C.bil ? C.bil.pz.map(x => x.k + x.u + x.a).join() : ''].join('|');
    if (imza === C.imza && C.satirlar) return;
    C.imza = imza;
    C.M = modelKur(S, C.oncul, C.istA, C.istP, C.lig, C.tier);
    const N = S.gecen < S.np * S.pl / 2 ? SIM_N[0] : SIM_N[1];
    C.res = simule(C.M, C === T ? N : Math.round(N * 0.6), tohum(C.eid + '|' + imza));
    C.ozet = ozetCikar(C.res);
    C.satirlar = degerlendir(C.M, C.res, C.bil ? C.bil.pz : [], { agirlik: agirlikAl(), zayif: C.oncul.zayif, orta: C.oncul.orta, tier: C.tier, gecen: S.gecen });
    C.yasak = sinyalYasak(C, S);
    let sinyal = null;
    if (!C.yasak) for (const s of C.satirlar) {
      if (!s.gecer) continue;
      const grup = s.x.tur + donemKod(s.x.donem) + s.yon;
      if ((C.sinyalSay[grup] || 0) >= 2 && C.sonSinyalK !== s.x.k + s.yon) continue;   // aynı pazarda aynı yöne en fazla 2 sinyal
      sinyal = s;
      break;
    }
    C.sinyal = sinyal;
    if (sinyal && sinyal.x.k + sinyal.yon !== C.sonSinyalK) {
      const grup = sinyal.x.tur + donemKod(sinyal.x.donem) + sinyal.yon;
      C.sinyalSay[grup] = (C.sinyalSay[grup] || 0) + 1;
      C.sonSinyalK = sinyal.x.k + sinyal.yon;
      C.sinyalZ = Date.now();
      golgeYaz(C, 'S:' + C.sonSinyalK, C.satirlar);
      uyar();
    }
    if (S.ara) golgeYaz(C, S.per - 1 === 1 ? 'Ç1' : S.per - 1 === 2 ? 'DA' : S.per - 1 === 3 ? 'Ç3' : 'A' + (S.per - 1), C.satirlar);
  }
  // Bir maçın bir turu: saat, oranlar, başlangıç beklentisi, istatistik, hesap
  async function macGuncelle(C) {
    const v = await ssAl('/event/' + C.eid), e = v.event || v;
    const tm = e.time || {};
    const pps = C.oncul ? C.oncul.T / ((+tm.totalPeriodCount || 4) * (+tm.periodLength || 600)) : ((+tm.periodLength || 600) >= 720 ? 0.078 : 0.066);
    const S = saatDurumu(e, Date.now(), pps);
    C.saat = S;
    if (S.durum === 'bitti') { sonuclandir(C.eid, e); C.bitti = true; return; }
    const canli = S.durum === 'oynaniyor' || S.durum === 'ara';
    try { C.bil = await bilyonerOranlar(C.bid, canli, C); C.bilHata = ''; C.bilDenenen = C.bil.denenen; }
    catch (err) { C.bil = null; C.bilHata = err.message; C.bilDenenen = err.denenen || []; }
    if (!C.oncul && (canli || C.bil)) C.oncul = await onculHesap(C, S, canli);
    if (!canli || !C.oncul) return;
    canliCapa(C, S);
    if (C.say % 2 === 0 || S.ara || !S.saatIsliyor || !C.istA) {
      try {
        const iv = await ssAl('/event/' + C.eid + '/statistics');
        C.istA = istatCoz(iv, 'ALL');
        C.istP = S.np === 4 && S.per <= 4 ? istatCoz(iv, S.per + 'Q') : null;
        C.istZ = Date.now();
        C.istHata = '';
      } catch (err) { C.istHata = err.message; }
    }
    hesapla(C);
    cizgiLog(C);
  }
  async function dongu() {
    clearTimeout(T.zam);
    if (!T.aktif) return;
    if (document.visibilityState === 'hidden') { T.zam = setTimeout(dongu, 15000); return; }   // ekran kapalıyken istek yok
    T.hata = '';
    try {
      await macGuncelle(T);
      if (T.bitti) { T.aktif = false; ciz(); return; }
    } catch (err) { T.hata = err.message; }
    T.say++;
    ciz();
    T.zam = setTimeout(dongu, (T.saat && T.saat.durum === 'baslamadi' ? DONGU_ONCE : DONGU) * 1000);
  }
  function olayAyarla(C, e) {
    C.eid = e.id;
    C.evId = e.homeTeam.id; C.depId = e.awayTeam.id;
    C.evAd = e.homeTeam.name; C.depAd = e.awayTeam.name;
    C.evKisa = e.homeTeam.shortName || e.homeTeam.name; C.depKisa = e.awayTeam.shortName || e.awayTeam.name;
    const ut = e.tournament && e.tournament.uniqueTournament;
    C.ut = ut ? ut.id : null; C.sid = e.season ? e.season.id : null;
    C.ligAd = turnuvaAdi(e);
    C.tier = ligSinifi(C.ligAd + ' ' + ((e.tournament && e.tournament.name) || ''));
    if (C.evAdBil) { const tb = tokenlar(esAd(C.evAdBil)); C.ters = benzerlik(tb, takimTok(e.awayTeam)) > benzerlik(tb, takimTok(e.homeTeam)); } else C.ters = false;
  }
  async function ligKur(C) {
    try { const L = await ligVerisi(C.ut, C.sid); C.lig = L ? L.p : null; C.ligEv = L ? L.ev : null; } catch (err) { C.lig = null; C.ligEv = null; }
  }
  async function olayKur(eid) {
    const v = await ssAl('/event/' + eid), e = v.event || v;
    olayAyarla(T, e);
    await ligKur(T);
    T.aktif = true; T.say = 0;
    dongu();
  }
  function sayfaId() {
    const p = location.pathname + location.search + location.hash;
    const m = p.match(/basketbol\/(?:[^/?#]*\/)*?(\d{5,})/i) || p.match(/(?:mac-karti|eventId|event)[=/](\d{5,})/i);
    return m ? m[1] : null;
  }
  function sayfaTakimlari() {
    const m = String(document.title || '').match(/^\s*(.+?)\s+[-–]\s+(.+?)(?:\s+(?:canl|iddaa|bahis|maç|mac)|\s*\||$)/i);
    return m ? { ev: m[1].trim(), dep: m[2].trim() } : { ev: '', dep: '' };
  }
  function sayfaLinkleri() {
    const g = {};
    document.querySelectorAll('a[href*="basketbol"]').forEach(a => {
      const m = String(a.getAttribute('href') || '').match(/basketbol\/(?:[^/?#]*\/)*?(\d{5,})/i);
      if (m && !g[m[1]]) g[m[1]] = String(a.innerText || a.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60);
    });
    return Object.keys(g).slice(0, 30).map(id => ({ id, ad: g[id] }));
  }
  const bosBaglam = bid => ({ bid, sinyalSay: {}, sonSinyalK: '', say: 0, oncul: null, sinyal: null, bitti: false, istA: null, istP: null, istZ: 0, M: null, res: null, satirlar: null, saat: null, evAdBil: '', depAdBil: '', ters: false, bil: null, eid: null, imza: '', guc: null, gucHazir: false, lig: null, ligEv: null, hata: '' });
  async function takipBaslat(bid) {
    clearTimeout(T.zam);
    Object.assign(T, bosBaglam(bid), { aktif: false, gor: 'canli' });
    panelIcerik('<div class="bc-durum">⏳ Maç bilgileri alınıyor…</div>');
    try { T.bil = await bilyonerOranlar(bid, true, T); } catch (e) { try { T.bil = await bilyonerOranlar(bid, false, T); } catch (e2) { T.bilHata = e2.message; T.bilDenenen = e2.denenen || []; } }
    if (T.bil && T.bil.ev) { T.evAdBil = T.bil.ev; T.depAdBil = T.bil.dep; }
    if (!T.evAdBil) { const s = sayfaTakimlari(); T.evAdBil = s.ev; T.depAdBil = s.dep; }
    let eid = null;
    try { eid = await ssEslestir(T.evAdBil, T.depAdBil, bid); } catch (e) { T.hata = e.message; }
    if (!eid) { T.gor = 'sec'; ciz(); return; }
    try { await olayKur(eid); } catch (e) { T.hata = e.message; ciz(); }
  }

  // ---------- Çoklu maç tarama ----------
  async function taraBir(C, ad) {
    if (C.bitti || C.eslesmedi) return;
    if (!C.eid) {
      try { C.bil = await bilyonerOranlar(C.bid, true, C); } catch (e) { try { C.bil = await bilyonerOranlar(C.bid, false, C); } catch (e2) { C.hata = 'Bilyoner alt/üst oranı yok'; return; } }
      C.evAdBil = C.bil.ev || C.evAdBil; C.depAdBil = C.bil.dep || C.depAdBil;
      if (!C.evAdBil && ad) { const m = ad.match(/^(.+?)\s+[-–]\s+(.+)$/); if (m) { C.evAdBil = m[1]; C.depAdBil = m[2]; } }
      const eid = await ssEslestir(C.evAdBil, C.depAdBil, C.bid);
      if (!eid) { C.eslesmedi = true; C.hata = 'Sofascore\'da eşleşmedi'; return; }
      const v = await ssAl('/event/' + eid);
      olayAyarla(C, v.event || v);
      await ligKur(C);
    }
    // Başlamamış maç: maç öncesi çizgi kaydedildiyse 30 dk'da bir bakmak yeter
    if (C.saat && C.saat.durum === 'baslamadi' && C.oncul && Date.now() - (C.taraZ || 0) < 30 * 60000) return;
    C.hata = '';
    await macGuncelle(C);
    C.taraZ = Date.now();
  }
  async function tara() {
    if (T.taraniyor) return;
    const l = sayfaLinkleri().filter(x => !(T.aktif && x.id === String(T.bid))).slice(0, TARA_MAX);
    if (!l.length) { T.taramaNot = 'Bu sayfada basket maçı linki bulunamadı. Bilyoner\'in canlı (ya da maç öncesi) basketbol listesini aç.'; ciz(); return; }
    T.taraniyor = true; T.taramaNot = '';
    try {
      for (let i = 0; i < l.length; i++) {
        T.taramaDurum = (i + 1) + '/' + l.length;
        ciz();
        const C = T.tarama[l[i].id] || (T.tarama[l[i].id] = Object.assign(bosBaglam(l[i].id), { ad: l[i].ad }));
        try { await taraBir(C, l[i].ad); } catch (err) { C.hata = err.message; }
        if (Date.now() < ssSinirZ) { T.taramaNot = 'Sofascore geçici sınır koydu, tarama yarıda kaldı.'; break; }
      }
    } finally {
      T.taraniyor = false; T.taramaZ = Date.now();
      Object.keys(T.tarama).forEach(b => { const C = T.tarama[b]; if (C.bitti || (C.taraZ && Date.now() - C.taraZ > 3 * 3600000)) delete T.tarama[b]; });
      ciz();
    }
  }
  function otoTaraKontrol() {
    if (!T.otoTara || T.taraniyor || document.visibilityState === 'hidden') return;
    if (Date.now() - (T.taramaZ || 0) < TARA_ARALIK * 1000) return;
    if (!sayfaLinkleri().length) return;
    tara();
  }

  // ---------- Görünüm ----------
  function periyotYazi(S) {
    if (!S) return '';
    if (S.durum === 'baslamadi') return 'başlamadı';
    if (S.durum === 'bitti') return 'bitti';
    if (S.durum === 'bilinmiyor') return S.aciklama || 'durum okunamadı';
    const ad = k => k <= S.np ? k + (S.np === 2 ? '. yarı' : '. çeyrek') : (k - S.np) + '. uzatma';
    if (S.durum === 'ara') return (S.np === 4 && S.per === 3 ? 'devre arası' : ad(S.per - 1) + ' bitti') + ' · sırada ' + ad(S.per);
    return ad(S.per) + ' · ' + sureYaz(S.kalan) + ' kaldı';
  }
  function pazarAd(x, C) {
    C = C || T;
    const tk = x.tur === 'ev' ? (C.evKisa || 'Ev sahibi') : x.tur === 'dep' ? (C.depKisa || 'Deplasman') : '';
    if (x.donem) return (x.donem.t === 'q' ? x.donem.k + '. çeyrek' : x.donem.k + '. yarı') + (tk ? ' ' + tk + ' sayısı' : ' toplamı') + (x.ot ? ' (uzatma dahil)' : '');
    if (tk) return tk + ' sayısı' + (x.ot ? '' : ' (normal süre)');
    return 'Maç toplamı' + (x.ot ? '' : ' (normal süre)');
  }
  const yonAd = y => y === 'u' ? 'ÜST' : 'ALT';
  function kararKarti() {
    const s = T.sinyal;
    if (s) {
      const gucu = s.ev >= 2 * s.minEv && s.p >= s.minP + 0.05 && T.M.bilgi.istTamam && !T.saat.saatIsliyor ? 'yüksek' : 'orta';
      return '<div class="bc-kart bc-' + (s.yon === 'u' ? 'ust' : 'alt') + '"><div class="bc-karar">' + yonAd(s.yon) + ' ' + v1(s.x.L).replace(',0', '') + '</div>' +
        '<div>' + h(pazarAd(s.x)) + ' · Bilyoner <b>' + v2(s.oran) + '</b> · en az <b>' + v2(s.minOran) + '</b></div>' +
        '<div class="bc-k">Bot ' + yuzde(s.p) + ' · Bilyoner ' + yuzde(s.yon === 'u' ? s.pk : 1 - s.pk) + ' · beklenen getiri ' + isaretli(s.ev) + ' · güven ' + gucu + '</div>' +
        '<div class="bc-k">' + (T.saat.saatIsliyor ? '⚠️ Saat işliyor, oran hızlı değişebilir. Oran "en az" değerinin altındaysa alma.' : '✅ Saat durdu: uygun an. Oran "en az" değerinin altındaysa alma.') + '</div>' +
        '<button class="bc-kbtn" data-islem="kaydet">💾 Aldım, kaydet</button></div>';
    }
    const en = (T.satirlar || [])[0];
    return '<div class="bc-kart bc-bekle"><div class="bc-karar">BEKLE</div><div class="bc-k">' +
      h(T.yasak || 'Şartları sağlayan seçim yok.') + (en ? '<br>En yakın: ' + h(pazarAd(en.x)) + ' ' + yonAd(en.yon) + ' ' + v1(en.x.L) + ' · getiri ' + isaretli(en.ev) + ' (gereken ' + isaretli(en.minEv) + ')' +
        (en.ayrik ? '<br>⚠️ Bot ile Bilyoner çok farklı düşünüyor (bot ' + yuzde(en.pm) + ' / Bilyoner ' + yuzde(en.pk) + ' üst). Bu kadar fark genelde botun bilmediği bir şeyden olur (sakatlık, rotasyon, veri hatası): sinyal verilmedi.' : '') : '') + '</div></div>';
  }
  function beklentiKarti() {
    const o = T.ozet, M = T.M, b = M.bilgi;
    let html = '<div class="bc-grup">🧮 Botun beklentisi</div>';
    html += '<div>Toplam <b>' + v1(o.tot) + '</b> <span class="bc-k">(%90 aralık ' + o.lo + '–' + o.hi + ')</span> · ' + h(T.evKisa || 'Ev') + ' ' + v1(o.h) + ' · ' + h(T.depKisa || 'Dep') + ' ' + v1(o.a) + (o.ot >= 0.01 ? ' · uzatma ihtimali ' + yuzde(o.ot) : '') + '</div>';
    const birim = M.pl >= 720 ? 48 : 40;
    if (b.paceO) html += '<div class="bc-k">Tempo: maç takım başına ' + v0(b.paceO) + ' hücum temposunda (' + birim + ' dk için), başta beklenen ' + v0(b.pace0) + ' → hesapta ' + v0(M.pace) + '</div>';
    if (b.istTamam) {
      const sy = (ad, x) => Math.abs(x) < 1.5 ? ad + ' normal isabette' : ad + ' ' + (x > 0 ? v1(x) + ' sayı şanslı (geri dönmesi beklenir)' : v1(-x) + ' sayı şanssız (toparlaması beklenir)');
      html += '<div class="bc-k">İsabet: ' + h(sy(T.evKisa || 'Ev', b.sansH)) + ' · ' + h(sy(T.depKisa || 'Dep', b.sansA)) + '</div>';
    } else html += '<div class="bc-k">Takım istatistikleri gelmedi: sadece skora göre hesaplanıyor (daha temkinli).</div>';
    if (M.bonusH) html += '<div class="bc-k">Faul limiti: ' + h(T.depKisa || 'Dep') + ' bu çeyrekte limitte → ' + h(T.evKisa || 'Ev') + ' daha çok serbest atış atar</div>';
    if (M.bonusA) html += '<div class="bc-k">Faul limiti: ' + h(T.evKisa || 'Ev') + ' bu çeyrekte limitte → ' + h(T.depKisa || 'Dep') + ' daha çok serbest atış atar</div>';
    const on = T.oncul;
    html += '<div class="bc-k">Başlangıç beklentisi: ' + h(on.yazi) + (on.capa ? ' · canlı çizgiyle düzeltildi → ' + v1(on.T) : '') +
      (on.zayif ? ' (zayıf kaynak: Bilyoner\'e daha çok ağırlık, eşikler yüksek)' : on.orta ? ' (orta güçte kaynak)' : '') + '</div>';
    if (T.guc && T.guc.rt && on.kaynak !== 'guc') html += '<div class="bc-k">Takım güçlerine göre maç öncesi beklenti: ' + h(T.evKisa || 'Ev') + ' ' + v1(T.guc.rt.ph) + ' – ' + h(T.depKisa || 'Dep') + ' ' + v1(T.guc.rt.pa) + ' = ' + v1(T.guc.rt.T) + '</div>';
    return html;
  }
  function tablo() {
    const l = (T.satirlar || []).slice(0, 14);
    if (!l.length) return '<div class="bc-k" style="margin-top:6px">Değerlendirilecek açık alt/üst çizgisi yok.</div>';
    return '<div class="bc-grup">📊 Bütün çizgiler (getiriye göre)</div><table class="bc-tab"><tr><th>Pazar</th><th>Çizgi</th><th>Bot üst</th><th>Bil. üst</th><th>Seçim</th><th>Getiri</th><th></th></tr>' +
      l.map((s, i) => '<tr' + (T.sinyal === s ? ' class="bc-tr-s"' : '') + '><td>' + h(pazarAd(s.x)) + (s.ayrik ? ' ⚠️' : '') + '</td><td>' + v1(s.x.L) + '</td><td>' + yuzde(s.pf) + '</td><td>' + yuzde(s.pk) + '</td><td>' + yonAd(s.yon) + ' ' + v2(s.oran) + '</td><td class="' + (s.gecer ? 'bc-up' : s.ev < 0 ? 'bc-down' : '') + '">' + isaretli(s.ev) + '</td><td><button class="bc-mini" data-satir="' + i + '">💾</button></td></tr>').join('') +
      '</table><div class="bc-k">Bot üst: model ile Bilyoner\'in harmanlanmış ihtimali · Bil. üst: Bilyoner oranının marjsız ihtimali · ⚠️ bot ile Bilyoner çok farklı · 💾 kendi aldığın seçimi kaydet (kayıtlarda "kendi seçimlerin" olarak ayrı sayılır).</div>';
  }
  function sekmeler(aktif) {
    const ts = Object.values(T.tarama).filter(c => c.sinyal && !c.bitti).length;
    return '<div class="bc-sekme"><button data-gor="canli" class="' + (aktif === 'canli' ? 'sec' : '') + '">🏀 Maç</button><button data-gor="tara" class="' + (aktif === 'tara' ? 'sec' : '') + '">🔎 Tarama' + (ts ? ' (' + ts + '🟢)' : '') + '</button><button data-gor="kayit" class="' + (aktif === 'kayit' ? 'sec' : '') + '">📊 Kayıtlar (' + GM_getValue('bc_kayit', []).length + ')</button></div>';
  }
  function takipEkrani() {
    const S = T.saat;
    let html = sekmeler('canli');
    html += '<div class="bc-baslik">' + h(T.evAd || T.evAdBil || '?') + ' – ' + h(T.depAd || T.depAdBil || '?') + '</div>';
    html += '<div class="bc-k" style="text-align:center">' + h(T.ligAd || '') + (T.tier ? ' · ' + (T.tier === 'A' ? 'büyük lig' : 'diğer lig: eşikler yüksek') : '') + '</div>';
    if (T.hata) html += '<div class="bc-hata">⚠️ ' + h(T.hata) + '</div>';
    if (!S) return html + '<div class="bc-durum">⏳ Veri bekleniyor…</div>' + altButonlar();
    html += '<div class="bc-skor">' + S.sh + ' – ' + S.sa + '</div><div class="bc-k" style="text-align:center">' + h(periyotYazi(S)) +
      (S.durum === 'oynaniyor' ? (S.saatIsliyor ? ' · ⏱ saat işliyor' : ' · ⏸ saat durdu') : '') + (S.sonDegisim != null ? ' · son veri ' + Math.round(S.sonDegisim) + ' sn önce' : '') + '</div>';
    if (S.durum === 'baslamadi') html += '<div class="bc-durum">Maç başlamadı. ' + (T.oncul ? 'Maç öncesi çizgi kaydedildi: ' + v1(T.oncul.T) + '.' : 'Maç öncesi çizgi bekleniyor.') + ' Başlayınca kendiliğinden canlı takibe geçer.</div>';
    if (S.durum === 'bilinmiyor') html += '<div class="bc-hata">Maç saati okunamadı (' + h(S.aciklama) + '). Sinyal verilmiyor. 🔍 Veri kontrolü ekranını gönderirsen düzeltirim.</div>';
    if (T.bitti) html += '<div class="bc-durum">🏁 Maç bitti. Kayıtlar ve gölge kayıtlar sonuçlandırıldı.</div>';
    if (T.satirlar && T.M && (S.durum === 'oynaniyor' || S.durum === 'ara')) html += kararKarti() + beklentiKarti() + tablo();
    if (T.bilHata) html += '<div class="bc-k">⚠️ Oranlar: ' + h(T.bilHata) + '</div>';
    if (T.istHata) html += '<div class="bc-k">⚠️ İstatistik: ' + h(T.istHata) + '</div>';
    return html + altButonlar();
  }
  function altButonlar() {
    return '<div class="bc-ayar">' + (T.aktif ? '<button data-islem="durdur">⏸ Takibi durdur</button>' : (T.eid && !T.bitti ? '<button data-islem="devam">▶ Devam et</button>' : '')) +
      (T.eid ? '<button data-islem="simdi">🔄 Şimdi güncelle</button>' : '') + '<button data-islem="kontrol">🔍 Veri kontrolü</button>' + (T.bid ? '<button data-islem="yeni">↩ Maç değiştir</button>' : '') + '</div>';
  }
  function anaEkran() {
    let html = sekmeler('canli');
    const id = sayfaId();
    html += '<div class="bc-k" style="margin:6px 0">Bilyoner\'de canlı (ya da birazdan başlayacak) bir basket maçının sayfasını aç, sonra takibi başlat. Maç başlamadan açarsan maç öncesi çizgi de kaydedilir ve tahmin daha sağlam olur.</div>';
    if (id) html += '<button class="bc-ana" data-takip="' + h(id) + '">▶ Bu maçı takip et</button>';
    else html += '<div class="bc-durum">Bu sayfada basket maçı bulunamadı.</div>';
    const l = sayfaLinkleri().filter(x => x.id !== id);
    if (l.length) html += '<div class="bc-grup">Sayfadaki basket maçları</div>' + l.map(x => '<div class="bc-sat"><button class="bc-kbtn" data-takip="' + h(x.id) + '">▶ Takip</button> ' + h(x.ad || x.id) + '</div>').join('');
    if (T.bid && T.eid) html += '<button class="bc-ana" data-islem="geri" style="background:#7dd3fc">↩ Takip edilen maça dön</button>';
    html += '<div class="bc-k" style="margin-top:8px">💡 Birden çok maçı aynı anda izlemek için canlı basket listesindeyken 🔎 Tarama sekmesini kullan.</div>';
    return html + '<div class="bc-ayar"><button data-islem="kontrol">🔍 Veri kontrolü</button></div>';
  }
  function taramaSatiri(C) {
    const ad = C.evAd ? (C.evKisa || C.evAd) + ' – ' + (C.depKisa || C.depAd) : (C.ad || C.bid);
    const S = C.saat;
    let html = '<div class="bc-kart' + (C.sinyal ? (C.sinyal.yon === 'u' ? ' bc-ust' : ' bc-alt') : '') + '"><div><b>' + h(ad) + '</b>' + (S && S.durum !== 'baslamadi' ? ' · ' + S.sh + '-' + S.sa : '') + '</div>';
    html += '<div class="bc-k">' + h(C.ligAd || '') + (S ? ' · ' + h(periyotYazi(S)) : '') + (C.oncul ? ' · başlangıç: ' + h(C.oncul.kaynak === 'mac_oncesi' ? 'maç öncesi çizgi' : C.oncul.kaynak === 'ilk_canli' ? 'ilk canlı çizgi' : C.oncul.kaynak === 'guc' ? 'takım güçleri' : 'zayıf') : '') + '</div>';
    if (C.hata) html += '<div class="bc-k">⚠️ ' + h(C.hata) + '</div>';
    else if (C.bitti) html += '<div class="bc-k">🏁 Bitti</div>';
    else if (S && S.durum === 'baslamadi') html += '<div class="bc-k">Başlamadı · ' + (C.oncul ? 'maç öncesi çizgi kaydedildi (' + v1(C.oncul.T) + ')' : 'maç öncesi çizgi yok') + '</div>';
    else if (C.sinyal) {
      const s = C.sinyal;
      html += '<div class="bc-karar" style="font-size:18px">' + yonAd(s.yon) + ' ' + v1(s.x.L).replace(',0', '') + '</div><div>' + h(pazarAd(s.x, C)) + ' · Bilyoner <b>' + v2(s.oran) + '</b> · en az <b>' + v2(s.minOran) + '</b> · bot ' + yuzde(s.p) + ' · getiri ' + isaretli(s.ev) + '</div>' +
        '<div class="bc-k">Sinyal ' + Math.round((Date.now() - (C.sinyalZ || Date.now())) / 60000) + ' dk önce · tarama verisi ' + Math.round((Date.now() - (C.taraZ || Date.now())) / 60000) + ' dk önce. Almadan önce ▶ Takip ile aç, güncel hâline bak.</div>' +
        '<button class="bc-kbtn" data-tkaydet="' + h(C.bid) + '">💾 Aldım, kaydet</button> ';
    } else if (C.satirlar && C.satirlar[0]) {
      const en = C.satirlar[0];
      html += '<div class="bc-k">' + h(C.yasak || 'Sinyal yok') + ' · en yakın: ' + h(pazarAd(en.x, C)) + ' ' + yonAd(en.yon) + ' ' + v1(en.x.L) + ' (' + isaretli(en.ev) + ')' + (en.ayrik ? ' ⚠️' : '') + '</div>';
    } else if (!C.oncul && S && S.durum !== 'baslamadi') html += '<div class="bc-k">Başlangıç beklentisi bulunamadı</div>';
    return html + '<button class="bc-kbtn" data-takip="' + h(C.bid) + '">▶ Takip</button></div>';
  }
  function taramaEkrani() {
    let html = sekmeler('tara');
    const l = sayfaLinkleri();
    html += '<div class="bc-k" style="margin:6px 0">Bilyoner\'in canlı basketbol listesi açıkken tara: sayfadaki maçların hepsi (en fazla ' + TARA_MAX + ') tek tek hesaplanır, fırsat olan en üste çıkar ve telefon titrer. Maç öncesi listede tararsan maç öncesi çizgiler kaydedilir; o maçlar başlayınca tahmin çok daha sağlam olur.</div>';
    html += '<div class="bc-ayar"><button data-islem="tara"' + (T.taraniyor ? ' disabled' : '') + '>🔎 Şimdi tara (' + l.length + ' maç)</button><button data-islem="oto">' + (T.otoTara ? '🔁 Otomatik: AÇIK' : '🔁 Otomatik: kapalı') + '</button></div>';
    if (T.otoTara) html += '<div class="bc-k">Otomatik: bu sayfa açık ve ekran açıkken ' + (TARA_ARALIK / 60) + ' dakikada bir tarar.</div>';
    if (T.taraniyor) html += '<div class="bc-durum">⏳ Taranıyor ' + h(T.taramaDurum || '') + '</div>';
    else if (T.taramaZ) html += '<div class="bc-k">Son tarama ' + Math.round((Date.now() - T.taramaZ) / 60000) + ' dk önce</div>';
    if (T.taramaNot) html += '<div class="bc-hata">' + h(T.taramaNot) + '</div>';
    const enIyi = C => C.sinyal ? 10 + C.sinyal.ev : C.satirlar && C.satirlar[0] ? C.satirlar[0].ev : -10;
    const liste = Object.values(T.tarama).filter(C => C.taraZ || C.hata).sort((a, b) => enIyi(b) - enIyi(a));
    if (!liste.length && !T.taraniyor) html += '<div class="bc-durum">Henüz tarama yapılmadı.</div>';
    return html + liste.map(taramaSatiri).join('');
  }
  function secimEkrani() {
    let html = sekmeler('canli') + '<div class="bc-grup">🔗 Sofascore\'da maç eşleşmedi</div><div class="bc-k">Bilyoner: ' + h(T.evAdBil || '?') + ' – ' + h(T.depAdBil || '?') + '. Aşağıdaki canlı maçlardan doğru olanı seç; eşleşme kaydedilir.</div>';
    const l = T.canliListe || [];
    if (!l.length) html += '<div class="bc-durum">Şu an canlı basket maçı listesi alınamadı. Maç başladıktan sonra tekrar dene.</div>';
    html += l.slice(0, 40).map(e => '<div class="bc-sat"><button class="bc-kbtn" data-ssec="' + h(e.id) + '">Seç</button> ' + h((e.homeTeam || {}).name) + ' – ' + h((e.awayTeam || {}).name) + ' <span class="bc-k">' + h(turnuvaAdi(e)) + '</span></div>').join('');
    return html + '<div class="bc-ayar"><button data-islem="yeni">↩ Geri</button></div>';
  }
  function kayitEkrani(not) {
    const K = GM_getValue('bc_kayit', []);
    let html = sekmeler('kayit');
    if (not) html += '<div class="bc-durum">' + h(not) + '</div>';
    const biten = K.filter(r => r.sonuc && (r.sonuc.durum === 'tuttu' || r.sonuc.durum === 'tutmadi'));
    const ozet = l => {
      const t = l.filter(r => r.sonuc.durum === 'tuttu').length, k = l.reduce((a, r) => a + (r.sonuc.durum === 'tuttu' ? r.oran - 1 : -1), 0);
      return '<b>' + t + '/' + l.length + '</b> tuttu (' + yuzde(t / l.length) + ') · <span class="' + (k >= 0 ? 'bc-up' : 'bc-down') + '">' + (k >= 0 ? '+' : '') + v2(k) + ' birim (' + isaretli(k / l.length) + ')</span>';
    };
    html += '<div class="bc-grup">📈 Aldığın canlı bahisler</div>';
    if (!biten.length) html += '<div class="bc-k">Henüz sonuçlanan yok.</div>';
    else {
      const bot = biten.filter(r => r.tip !== 'elle'), elle = biten.filter(r => r.tip === 'elle');
      if (bot.length) html += '<div>Bot sinyalleri: ' + ozet(bot) + '</div>';
      if (elle.length) html += '<div>Kendi seçimlerin: ' + ozet(elle) + '</div>';
      const gr = {};
      biten.forEach(r => { const g = (r.tur === 'mac' ? 'Maç' : 'Takım') + ' ' + (r.d ? (r.d[0] === 'q' ? 'çeyrek' : 'yarı') : 'toplamı'); (gr[g] = gr[g] || []).push(r); });
      Object.keys(gr).forEach(g => { html += '<div class="bc-k">' + g + ': ' + ozet(gr[g]) + '</div>'; });
    }
    html += raporHtml();
    html += K.slice(0, 40).map(r => {
      const s = r.sonuc, renk = !s ? '#fde047' : s.durum === 'tuttu' ? '#4ade80' : s.durum === 'tutmadi' ? '#f87171' : '#cbd5e1';
      return '<div class="bc-kart"><div class="bc-k">' + h(r.mac) + ' · ' + h(r.an) + ' · skor ' + h(r.skor) + (r.tip === 'elle' ? ' · ✋ kendi seçimin' : '') + '</div><div><b>' + h(r.ad) + ' ' + yonAd(r.yon) + ' ' + v1(r.L) + '</b> @' + v2(r.oran) + ' · bot ' + yuzde(r.p) + '</div>' +
        '<div style="color:' + renk + ';font-weight:bold">' + (!s ? '⏳ Sonuç bekleniyor' : s.durum === 'iade' ? '↩️ İade' : (s.durum === 'tuttu' ? '✅ ' : '❌ ') + 'gerçek: ' + s.deger) + '</div>' +
        '<button class="bc-kbtn" data-sil="' + h(r.id) + '">🗑️ Sil</button></div>';
    }).join('');
    html += '<div class="bc-ayar"><button data-islem="sonuc">🔄 Sonuçları kontrol et</button><button data-islem="yedekAl">📋 Yedeği kopyala</button><button data-islem="yedekYukle">📥 Yedeği yükle</button></div>';
    return html;
  }
  function raporHtml() {
    const X = [];
    GM_getValue('bc_golge', []).forEach(r => (r.r || []).forEach((y, i) => { if (y === 0 || y === 1) X.push({ pm: r.L[i][4], pk: r.L[i][5], y, cp: r.cp, tr: r.tr, d: r.L[i][1] }); }));
    const W = agirlikAl();
    let html = '<div class="bc-grup">👻 Gölge kayıt (sinyal olsun olmasın her çeyrek arasındaki tahminler)</div>';
    const bek = GM_getValue('bc_golge', []).filter(r => !r.r).length;
    html += '<div class="bc-k">' + X.length + ' sonuçlanan çizgi · ' + bek + ' bekleyen kayıt. Harman ağırlığı: model ' + v2(W.a) + ' / Bilyoner ' + v2(W.b) + (W.n >= 150 ? ' (sonuçlardan öğrenildi)' : ' (başlangıç değeri; 150 sonuçtan sonra öğrenilir)') + '</div>';
    if (X.length < 20) return html + '<div class="bc-k">Rapor için en az 20 sonuç gerekiyor.</div>';
    const brier = (l, f) => mean(l.map(x => (f(x) - x.y) * (f(x) - x.y)));
    const harman = x => sigm(W.a * logit(x.pm) + W.b * logit(x.pk));
    const satir = (ad, l) => l.length < 10 ? '' : '<tr><td>' + ad + '</td><td>' + l.length + '</td><td>' + brier(l, x => x.pm).toFixed(3) + '</td><td>' + brier(l, x => x.pk).toFixed(3) + '</td><td>' + brier(l, harman).toFixed(3) + '</td></tr>';
    html += '<table class="bc-tab"><tr><th>Grup</th><th>n</th><th>Model</th><th>Bilyoner</th><th>Harman</th></tr>' + satir('Hepsi', X) +
      satir('1. çeyrek sonu', X.filter(x => x.cp === 'Ç1')) + satir('Devre arası', X.filter(x => x.cp === 'DA')) + satir('3. çeyrek sonu', X.filter(x => x.cp === 'Ç3')) +
      satir('Sinyal anları', X.filter(x => String(x.cp).indexOf('S:') === 0)) + satir('Büyük ligler', X.filter(x => x.tr === 'A')) + satir('Diğer ligler', X.filter(x => x.tr === 'B')) +
      satir('Çeyrek/yarı pazarları', X.filter(x => x.d)) + '</table><div class="bc-k">Hata puanı: düşük olan daha iyi tahmin ediyor. Harman, Bilyoner\'den düşükse bot gerçekten bir şey katıyor demektir.</div>';
    return html + cizgiRaporu();
  }
  function cizgiRaporu() {
    const X = GM_getValue('bc_cizgi', []);
    let html = '<div class="bc-grup">📏 Maç öncesi çizgi öğrenmesi</div>';
    if (X.length < 5) return html + '<div class="bc-k">' + X.length + ' maç. Maç öncesi çizgisi kaydedilen maçlar bittikçe, Bilyoner çizgisinin liglere göre sistematik hatası ve takım güçlerinin katkısı öğrenilir.</div>';
    const fark = X.map(r => r[3] - r[1]);
    const R = X.filter(r => r[2] != null);
    const hata = (l, f) => mean(l.map(r => Math.abs(r[3] - f(r))));
    html += '<div class="bc-k">' + X.length + ' maç · gerçek toplam çizgiden ortalama ' + isaretliSayi(mean(fark)) + ' sayı · çizginin ortalama sapması ' + v1(hata(X, r => r[1])) + ' sayı' +
      (R.length >= 10 ? ' · takım güçleriyle düzeltilmiş: ' + v1(hata(R, r => cizgiDuzelt(r[0], r[1], r[2]).T)) + ' (' + R.length + ' maç)' : '') + '</div>';
    const H = GM_getValue('bc_hat', {});
    html += '<div class="bc-k">Canlı çizgi seyri kaydı: ' + Object.keys(H).length + ' maç</div>';
    return html;
  }
  function kontrolMetni() {
    const s = [];
    s.push('Basket Canlı Toplam ' + SURUM + ' · ' + new Date().toLocaleString('tr-TR'));
    s.push('Sayfa: ' + location.pathname + ' · bulunan maç no: ' + (sayfaId() || 'yok'));
    s.push('Takip: Bilyoner ' + (T.bid || '-') + ' · Sofascore ' + (T.eid || '-') + ' · ' + (T.evAdBil || '?') + ' - ' + (T.depAdBil || '?') + (T.ters ? ' · (ev/dep ters çevrildi)' : ''));
    s.push('Oran kaynağı: ' + (T.bil ? T.bil.kaynak : 'yok') + ' · denenen: ' + ((T.bilDenenen || []).join(' | ') || '-'));
    if (T.bil) {
      const adlar = [...new Set(T.bil.oranlar.map(o => o.pazar))];
      s.push('Pazar adları (' + adlar.length + '): ' + adlar.slice(0, 40).join(' / '));
      s.push('Örnek seçimler: ' + T.bil.oranlar.slice(0, 12).map(o => o.pazar + ' → ' + o.n + ' @' + o.val).join(' / '));
      s.push('Alt/üst çizgileri: ' + T.bil.pz.map(x => pazarAd(x) + ' ' + x.L + ' (Ü ' + x.u + ' / A ' + x.a + ')').join(' / '));
    }
    if (T.olayHam) s.push('Sofascore durum: ' + JSON.stringify(T.olayHam));
    if (T.saat) s.push('Hesaplanan saat: ' + JSON.stringify({ durum: T.saat.durum, per: T.saat.per, kalan: T.saat.kalan && Math.round(T.saat.kalan), gecen: T.saat.gecen && Math.round(T.saat.gecen), saatIsliyor: T.saat.saatIsliyor, sonDegisim: T.saat.sonDegisim && Math.round(T.saat.sonDegisim) }));
    s.push('İstatistik: ' + (T.istA ? (T.istA.tamam ? 'tam' : 'eksik') + ' · ev ' + JSON.stringify(T.istA.h) + ' · dep ' + JSON.stringify(T.istA.a) : 'yok' + (T.istHata ? ' (' + T.istHata + ')' : '')));
    if (T.istP) s.push('Bu çeyrek faul: ev ' + T.istP.h.faul + ' · dep ' + T.istP.a.faul);
    s.push('Lig: ' + (T.ligAd || '-') + ' · sınıf ' + (T.tier || '-') + ' · profil: ' + (T.lig ? JSON.stringify({ n: T.lig.n, ort: Math.round(T.lig.ort), sd: Math.round(T.lig.sd), ot: r3(T.lig.ot), kopR: T.lig.kopR && r3(T.lig.kopR) }) : 'yok'));
    s.push('Başlangıç beklentisi: ' + (T.oncul ? T.oncul.yazi + ' · kaynak ' + T.oncul.kaynak + ' · hesapta ' + v1(T.oncul.T) + (T.oncul.capa ? ' · canlı çizgi çapası ' + v1(T.oncul.capa) : '') + ' · pay ' + r3(T.oncul.pay) : 'yok'));
    s.push('Lig geçmişi: ' + (T.ligEv ? T.ligEv.length + ' maç' : 'yok') + ' · takım gücü: ' + (T.guc && T.guc.rt ? JSON.stringify({ ev: v1(T.guc.rt.ph), dep: v1(T.guc.rt.pa), macEv: T.guc.rt.sayH, macDep: T.guc.rt.sayA }) : 'yok') + ' · çizgi öğrenme: ' + GM_getValue('bc_cizgi', []).length + ' maç');
    s.push('Tarama: ' + Object.keys(T.tarama).length + ' maç · sayfadaki link: ' + sayfaLinkleri().length + ' · otomatik ' + (T.otoTara ? 'açık' : 'kapalı'));
    if (T.M) s.push('Model: ' + JSON.stringify({ tempo: r3(T.M.pace), tempo0: r3(T.M.bilgi.pace0), verimEv: r3(T.M.pppH), verimDep: r3(T.M.pppA), sansEv: r3(T.M.bilgi.sansH), sansDep: r3(T.M.bilgi.sansA), bonus: [T.M.bonusH, T.M.bonusA] }));
    s.push('Sinyal engeli: ' + (T.yasak || 'yok') + ' · Sofascore sınırı: ' + (Date.now() < ssSinirZ ? 'VAR' : 'yok'));
    if (T.hata) s.push('Hata: ' + T.hata);
    return s.join('\n');
  }
  function css() {
    if (document.getElementById('bc-css')) return;
    const st = document.createElement('style');
    st.id = 'bc-css';
    st.textContent =
      '#bc-btn{position:fixed;left:12px;bottom:300px;z-index:2147483646;width:52px;height:52px;border-radius:50%;border:2px solid #fff;font:bold 17px sans-serif;color:#fff;padding:0;background:#ea580c;box-shadow:0 2px 10px #0009}' +
      '#bc-btn.bc-uyari{background:#16a34a}' +
      '#bc-panel .bc-mini{padding:2px 5px;border-radius:6px;border:1px solid #2b4458;background:#1b3149;font-size:12px}' +
      '#bc-panel{position:fixed;left:8px;right:8px;bottom:8px;max-height:85vh;overflow:auto;z-index:2147483647;background:#0f1a24;color:#e6f1f8;border-radius:14px;padding:14px;font:14px/1.45 sans-serif;box-shadow:0 6px 24px #000c;box-sizing:border-box;display:none}' +
      '#bc-panel h3{margin:0 0 6px;font-size:16px;color:#e6f1f8}' +
      '#bc-panel .bc-kapat{position:absolute;right:10px;top:8px;background:none;border:none;color:#ccc;font-size:22px}' +
      '#bc-panel .bc-sekme{display:flex;gap:6px;margin:4px 0 8px}' +
      '#bc-panel .bc-sekme button{flex:1;padding:9px 4px;border-radius:9px;border:1px solid #2b4458;background:#15263a;color:#dbeafe;font-size:14px;font-weight:bold}' +
      '#bc-panel .bc-sekme button.sec{background:#7dd3fc;color:#0b1520;border-color:#7dd3fc}' +
      '#bc-panel .bc-ayar{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0 4px}' +
      '#bc-panel .bc-ayar button{flex:1;min-width:28%;padding:8px 4px;border-radius:8px;border:1px solid #2b4458;background:#15263a;color:#dbeafe;font-size:13px}' +
      '#bc-panel .bc-ana{width:100%;padding:11px;border:none;border-radius:10px;background:#38bdf8;color:#04121c;font-weight:bold;font-size:15px;margin-top:6px}' +
      '#bc-panel .bc-baslik{font-weight:bold;font-size:15px;text-align:center;margin-top:4px}' +
      '#bc-panel .bc-skor{font-size:30px;font-weight:bold;text-align:center;margin:2px 0}' +
      '#bc-panel .bc-grup{margin-top:12px;font-weight:bold;color:#bae6fd;border-bottom:1px solid #22384c;padding-bottom:3px}' +
      '#bc-panel .bc-kart{margin-top:8px;padding:10px;border-radius:10px;background:#15263a;border-left:5px solid #64748b}' +
      '#bc-panel .bc-ust{border-left-color:#22c55e}#bc-panel .bc-alt{border-left-color:#f97316}#bc-panel .bc-bekle{border-left-color:#64748b}' +
      '#bc-panel .bc-karar{font-size:22px;font-weight:bold;letter-spacing:1px}' +
      '#bc-panel .bc-k{font-size:12px;color:#a8c3d6}' +
      '#bc-panel .bc-kbtn{padding:6px 10px;border-radius:7px;border:1px solid #2b4458;background:#1b3149;color:#e6f1f8;font-size:13px;margin-top:6px}' +
      '#bc-panel .bc-up{color:#4ade80;font-weight:bold}#bc-panel .bc-down{color:#f87171}' +
      '#bc-panel .bc-hata{background:#3b1414;color:#fecaca;padding:8px;border-radius:8px;margin:6px 0}' +
      '#bc-panel .bc-durum{color:#bae6fd;font-size:14px;margin:10px 0}' +
      '#bc-panel .bc-sat{padding:5px 0;border-bottom:1px solid #22384c}' +
      '#bc-panel .bc-pre{white-space:pre-wrap;font-size:11.5px;background:#08111a;color:#e6f1f8;padding:8px;border-radius:8px;max-height:55vh;overflow:auto}' +
      '#bc-panel table.bc-tab{width:100%;border-collapse:collapse;font-size:12px;margin-top:4px;color:#e6f1f8;background:transparent}' +
      '#bc-panel table.bc-tab th,#bc-panel table.bc-tab td{padding:3px 2px;border-bottom:1px solid #22384c;text-align:right;color:#e6f1f8;background:transparent}' +
      '#bc-panel table.bc-tab th:first-child,#bc-panel table.bc-tab td:first-child{text-align:left}' +
      '#bc-panel table.bc-tab th{color:#bae6fd}#bc-panel table.bc-tab tr.bc-tr-s td{background:#123524}';
    document.head.appendChild(st);
  }
  function panel() {
    let p = document.getElementById('bc-panel');
    if (p) return p;
    p = document.createElement('div');
    p.id = 'bc-panel';
    document.body.appendChild(p);
    p.addEventListener('click', tikla);
    return p;
  }
  function panelIcerik(html) {
    const p = panel();
    const kay = p.scrollTop;
    p.innerHTML = '<button class="bc-kapat">×</button><h3>🏀 Basket Canlı Toplam ' + SURUM + '</h3>' + html;
    p.style.display = 'block';
    p.scrollTop = kay;
  }
  function ciz() {
    const p = document.getElementById('bc-panel');
    if (!p || p.style.display !== 'block') return;
    if (T.gor === 'kayit' || T.gor === 'kontrol') return;          // kullanıcı başka ekrandaysa bozma
    if (T.gor === 'sec') { panelIcerik(secimEkrani()); return; }
    if (T.gor === 'tara') { panelIcerik(taramaEkrani()); return; }
    panelIcerik(T.eid ? takipEkrani() : anaEkran());
  }
  function uyar() {
    try { if (navigator.vibrate) navigator.vibrate([200, 100, 200]); } catch (e) {}
    const b = document.getElementById('bc-btn');
    if (b) b.classList.add('bc-uyari');
  }
  async function tikla(e) {
    const t = e.target.closest ? (e.target.closest('button') || e.target) : e.target, p = panel();
    const at = a => t.getAttribute && t.getAttribute(a);
    if (t.classList && t.classList.contains('bc-kapat')) { p.style.display = 'none'; return; }
    const gor = at('data-gor');
    if (gor === 'canli') { T.gor = T.eid ? 'canli' : T.gor === 'sec' ? 'sec' : 'canli'; ciz(); if (T.gor === 'canli') panelIcerik(T.eid ? takipEkrani() : anaEkran()); return; }
    if (gor === 'kayit') { T.gor = 'kayit'; panelIcerik(kayitEkrani()); return; }
    if (gor === 'tara') { T.gor = 'tara'; panelIcerik(taramaEkrani()); return; }
    const tk = at('data-takip');
    if (tk) { takipBaslat(tk); return; }
    const sat = at('data-satir');
    if (sat != null) {
      const s = (T.satirlar || [])[+sat];
      if (s && confirm(pazarAd(s.x) + ' ' + yonAd(s.yon) + ' ' + v1(s.x.L) + ' @' + v2(s.oran) + ' kendi seçimin olarak kaydedilsin mi?')) { t.textContent = kayitEkle(T, s, 'elle') ? '✔' : '='; }
      return;
    }
    const tkay = at('data-tkaydet');
    if (tkay) { const C = T.tarama[tkay]; if (C && C.sinyal) { t.textContent = kayitEkle(C, C.sinyal, 'sinyal') ? '✔ Kaydedildi' : 'Zaten kayıtlı'; t.disabled = true; } return; }
    const ss = at('data-ssec');
    if (ss) {
      const ES = GM_getValue('bc_es', {});
      ES[T.bid] = { e: Number(ss), z: Date.now() };
      GM_setValue('bc_es', buda(ES, 200));
      T.gor = 'canli';
      panelIcerik('<div class="bc-durum">⏳ Maç kuruluyor…</div>');
      try { await olayKur(Number(ss)); } catch (err) { T.hata = err.message; ciz(); }
      return;
    }
    const sil = at('data-sil');
    if (sil) { if (confirm('Bu kayıt silinsin mi?')) { GM_setValue('bc_kayit', GM_getValue('bc_kayit', []).filter(r => r.id !== sil)); panelIcerik(kayitEkrani()); } return; }
    const islem = at('data-islem');
    if (islem === 'kaydet') { if (kayitEkle(T, T.sinyal, 'sinyal')) { t.textContent = '✔ Kaydedildi'; t.disabled = true; } else { t.textContent = 'Zaten kayıtlı'; } return; }
    if (islem === 'tara') { T.gor = 'tara'; tara(); return; }
    if (islem === 'oto') { T.otoTara = !T.otoTara; GM_setValue('bc_oto', T.otoTara); if (T.otoTara) otoTaraKontrol(); panelIcerik(taramaEkrani()); return; }
    if (islem === 'durdur') { T.aktif = false; clearTimeout(T.zam); ciz(); return; }
    if (islem === 'devam') { T.aktif = true; dongu(); return; }
    if (islem === 'simdi') { if (T.aktif) dongu(); else { T.aktif = true; dongu(); } return; }
    if (islem === 'yeni') { T.aktif = false; clearTimeout(T.zam); T.eid = null; T.gor = 'canli'; panelIcerik(anaEkran()); return; }
    if (islem === 'geri') { T.gor = 'canli'; ciz(); return; }
    if (islem === 'kontrol') {
      T.gor = 'kontrol';
      if (T.eid) { try { const v = await ssAl('/event/' + T.eid), ev = v.event || v; T.olayHam = { status: ev.status, time: ev.time, homeScore: ev.homeScore, awayScore: ev.awayScore, changes: ev.changes }; } catch (err) { T.olayHam = { hata: err.message }; } }
      p.__kontrol = kontrolMetni();
      panelIcerik('<div class="bc-grup">🔍 Veri kontrolü</div><pre class="bc-pre">' + h(p.__kontrol) + '</pre><div class="bc-ayar"><button data-islem="kopyala">📋 Kopyala</button><button data-islem="geri">↩ Geri</button></div>');
      return;
    }
    if (islem === 'kopyala') { try { GM_setClipboard(p.__kontrol || ''); alert('Kopyalandı.'); } catch (err) { prompt('Kopyala:', p.__kontrol || ''); } return; }
    if (islem === 'sonuc') {
      panelIcerik(sekmeler('kayit') + '<div class="bc-durum">⏳ Biten maçlar kontrol ediliyor…</div>');
      let n = 0, not = '';
      try { n = await bekleyenleriKontrol(); not = n ? '✅ ' + n + ' maç sonuçlandırıldı' : 'Sonuçlanacak yeni maç yok'; } catch (err) { not = '⚠️ ' + err.message; }
      panelIcerik(kayitEkrani(not));
      return;
    }
    if (islem === 'yedekAl') {
      const y = JSON.stringify({ surum: SURUM, kayit: GM_getValue('bc_kayit', []), golge: GM_getValue('bc_golge', []), ogren: GM_getValue('bc_ogren', {}), on: GM_getValue('bc_on', {}), cizgi: GM_getValue('bc_cizgi', []) });
      try { GM_setClipboard(y); alert('Yedek panoya kopyalandı. Bir not uygulamasına yapıştırıp sakla.'); } catch (err) { prompt('Bu metni kopyalayıp sakla:', y); }
      return;
    }
    if (islem === 'yedekYukle') {
      const metin = prompt('Kopyaladığın yedeği yapıştır:');
      if (!metin) return;
      try {
        const g = JSON.parse(metin);
        const K = GM_getValue('bc_kayit', []), ids = new Set(K.map(r => r.id));
        (g.kayit || []).forEach(r => { if (r && r.id && !ids.has(r.id)) K.push(r); });
        GM_setValue('bc_kayit', K);
        const G = GM_getValue('bc_golge', []), gk = new Set(G.map(r => r.k));
        (g.golge || []).forEach(r => { if (r && r.k && !gk.has(r.k)) G.push(r); });
        GM_setValue('bc_golge', G.slice(-GOLGE_MAX));
        if (g.ogren && !GM_getValue('bc_ogren', null)) GM_setValue('bc_ogren', g.ogren);
        if (g.on) GM_setValue('bc_on', Object.assign({}, g.on, GM_getValue('bc_on', {})));
        if (g.cizgi && g.cizgi.length > GM_getValue('bc_cizgi', []).length) GM_setValue('bc_cizgi', g.cizgi);
        ogren();
        alert('Yedek yüklendi.');
        panelIcerik(kayitEkrani());
      } catch (err) { alert('Yedek okunamadı.'); }
    }
  }
  function butonKoy() {
    if (document.getElementById('bc-btn')) return;
    const b = document.createElement('button');
    b.id = 'bc-btn';
    b.textContent = 'A/Ü';
    b.addEventListener('click', () => {
      b.classList.remove('bc-uyari');
      const p = panel();
      if (p.style.display === 'block') { p.style.display = 'none'; return; }
      p.style.display = 'block';
      if (T.gor === 'kayit') { panelIcerik(kayitEkrani()); return; }
      if (T.gor === 'kontrol') T.gor = 'canli';
      ciz();
    });
    document.body.appendChild(b);
  }

  if (typeof globalThis !== 'undefined' && globalThis.__BC_TEST) {
    globalThis.__BC = { T, norm, pazarSinifi, cizgiCoz, pazarlar, saatDurumu, istatCoz, modelKur, simule, degerlendir, ozetCikar, ortalamaCizgi, ligProfiliHesapla, sonucCikar, degerAl, takipEkrani, kayitEkrani, anaEkran, kontrolMetni, hesapla, panelIcerik, sikistir, reytingHesapla, reytingTahmin, macOnuCizgi, cizgiDuzelt, onculHesap, canliCapa, ornekDegeri, taramaEkrani, taramaSatiri, bosBaglam, sonuclandir, kayitEkle, macGuncelle, tara };
    return;
  }
  css();
  butonKoy();
  T.otoTara = !!GM_getValue('bc_oto', false);
  setInterval(() => { butonKoy(); otoTaraKontrol(); }, 10000);
  if (Date.now() - GM_getValue('bc_sonKontrol', 0) > 30 * 60000) { GM_setValue('bc_sonKontrol', Date.now()); bekleyenleriKontrol().catch(() => {}); }
})();
