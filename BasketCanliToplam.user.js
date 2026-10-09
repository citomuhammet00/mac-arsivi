// ==UserScript==
// @name         Basket Canlı Toplam
// @namespace    basketcanlitoplam
// @version      1.0
// @description  Bilyoner canlı basketbol toplam sayı alt/üst (maç, takım, çeyrek, yarı): top top simülasyon, tempo/isabet ayrımı, piyasa harmanı, gölge kayıt ve kendini ayarlama
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

  const SURUM = '1.0';
  const SS = 'https://www.sofascore.com/api/v1';
  const BIL = 'https://www.bilyoner.com/api/v3/mobile/aggregator/match-card/';
  const SIM_N = [2000, 3000];  // simüle edilen maç sayısı: ilk yarı / ikinci yarı (ihtimal hatası ~%1)
  const DONGU = 45;            // canlı takip aralığı (sn)
  const DONGU_ONCE = 180;      // maç başlamadan önce kontrol aralığı (sn)
  const GOLGE_MAX = 3000;
  // Karar eşikleri: A = büyük ligler, B = diğerleri. Dönem (çeyrek/yarı) ve takım pazarları daha gürültülü olduğu için ek pay.
  const ESIK = { A: { p: 0.56, ev: 0.06 }, B: { p: 0.60, ev: 0.09 }, donem: 0.02, takim: 0.01, zayifOncul: 0.02 };
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
  let ssSinirZ = 0;
  async function ssAl(yol) {
    if (Date.now() < ssSinirZ) throw new Error('Sofascore geçici sınır koydu, ' + Math.ceil((ssSinirZ - Date.now()) / 60000) + ' dk bekleniyor');
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
    if ((m = p.match(/ (\d) ?\.? ?ceyrek/))) donem = { t: 'q', k: +m[1] };
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
    if (tur !== 'mac' && donem) return null;          // takımın dönem toplamı modellenmiyor
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
  const yonlu = pz => !T.ters ? pz : pz.map(x => {
    if (x.tur === 'mac') return x;
    const t = x.tur === 'ev' ? 'dep' : 'ev';
    return Object.assign({}, x, { tur: t, k: t + x.k.slice(x.k.indexOf('|')) });
  });
  async function bilyonerOranlar(bid, canliMi) {
    const denenen = [];
    for (const c of (canliMi ? ['true'] : ['false', 'true'])) {
      const ad = c === 'true' ? 'canlı API' : 'maç öncesi API';
      try {
        const v = await istek(BIL + bid + '/odds?isLiveEvent=' + c + '&isPopular=false', { ad: 'Bilyoner' });
        const oranlar = oranTopla(v);
        const ev = (v && typeof v.homeTeam === 'string' && v.homeTeam) || '', dep = (v && typeof v.awayTeam === 'string' && v.awayTeam) || '';
        const pz = pazarlar(oranlar, ev, dep);
        denenen.push(ad + ': ' + oranlar.length + ' oran, ' + pz.length + ' alt/üst çizgisi');
        if (pz.length) return { ev, dep, oranlar, pz: yonlu(pz), kaynak: 'Bilyoner ' + ad, denenen };
        if (ev && dep) { T.evAdBil = T.evAdBil || ev; T.depAdBil = T.depAdBil || dep; }
      } catch (e) { denenen.push(ad + ': ' + e.message); }
    }
    const d = domOranlar();
    const pz = pazarlar(d, T.evAdBil || '', T.depAdBil || '');
    denenen.push('sayfadan: ' + d.length + ' oran, ' + pz.length + ' alt/üst çizgisi');
    if (pz.length) return { ev: '', dep: '', oranlar: d, pz: yonlu(pz), kaynak: 'Bilyoner sayfası', denenen };
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
  function ligProfiliHesapla(evler) {
    const Ts = [], Q = [[], [], [], []], kop = [], ot = [];
    (evler || []).forEach(e => {
      if (!e.status || e.status.type !== 'finished' || !e.homeScore || !e.awayScore) return;
      const hs = skorParca(e.homeScore), as = skorParca(e.awayScore);
      if (hs.per.length < 4 || as.per.length < 4) return;
      const tot = hs.cur + as.cur;
      if (!(tot > 60)) return;
      Ts.push(tot);
      for (let i = 0; i < 4; i++) Q[i].push(hs.per[i] + as.per[i]);
      ot.push(hs.otSay || as.otSay || hs.ot || as.ot ? 1 : 0);
      kop.push({ d: Math.abs(hs.per[0] + hs.per[1] + hs.per[2] - as.per[0] - as.per[1] - as.per[2]), q4: hs.per[3] + as.per[3] });
    });
    if (Ts.length < 8) return null;
    const ort = mean(Ts), sd = Math.sqrt(mean(Ts.map(x => (x - ort) * (x - ort))));
    const q = Q.map(a => mean(a));
    const k = kop.filter(x => x.d >= 18);
    return { n: Ts.length, ort, sd, q, ot: mean(ot), kopR: k.length >= 4 ? sinirla(mean(k.map(x => x.q4)) / q[3], 0.8, 1.05) : null, kopN: k.length };
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
    let posH, posA, pace, paceO, pppH, pppA, sansH = 0, sansA = 0, kompH, kompA, Kp, Ke;
    if (istTamam) {
      posH = hucumSay(istA.h); posA = hucumSay(istA.a);
      Kp = 30; Ke = 70;
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
      Kp = 45; Ke = 1e9;
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
    const carp = (tier === 'B' ? 1.25 : 1) * (on.zayif ? 1.3 : 1);
    const posOrt = (posH + posA) / 2;
    const sdPace = Math.max(0.012, 0.04 * Math.sqrt(Kp / (Kp + posOrt))) * carp;
    const sdH = (istTamam ? Math.max(0.015, 0.045 * Math.sqrt(Ke / (Ke + posH))) : 0.05) * carp;
    const sdA = (istTamam ? Math.max(0.015, 0.045 * Math.sqrt(Ke / (Ke + posA))) : 0.05) * carp;
    const kopR = lig && lig.kopR ? lig.kopR : 0.92;
    return {
      np: S.np, pl: S.pl, ol: S.ol, per: S.per, kalan: S.kalan, sh: S.sh, sa: S.sa, ara: !!S.ara,
      qPts: Array.from({ length: S.np }, (_, i) => (S.qh[i] || 0) + (S.qa[i] || 0)), nOT: S.nOT || 0,
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
    const res = { tot: new Int16Array(N), reg: new Int16Array(N), h: new Int16Array(N), a: new Int16Array(N), ot: new Uint8Array(N), q: [] };
    for (let k = 0; k < np; k++) res.q.push(new Int16Array(N));
    for (let i = 0; i < N; i++) {
      const pace = Math.max(M.pace * 0.6, M.pace * (1 + M.sdPace * Z()));
      const ph = M.pppH * (1 + M.sdH * Z()), pa = M.pppA * (1 + M.sdA * Z());
      const ortSure = regSn / (2 * pace);
      let sh = M.sh, sa = M.sa, per = M.per, kalan = M.kalan, otVar = M.nOT > 0;
      const q = M.qPts.slice();
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
        if (per <= np) q[per - 1] += puan;
        kalan -= sure;
        top = 1 - top;
      }
      res.tot[i] = sh + sa; res.h[i] = sh; res.a[i] = sa; res.ot[i] = otVar ? 1 : 0;
      let rt = 0;
      for (let k2 = 0; k2 < np; k2++) { res.q[k2][i] = q[k2]; rt += q[k2]; }
      res.reg[i] = rt;
    }
    return res;
  }
  function ornekDegeri(res, x, np, i) {
    if (x.tur === 'ev') return res.h[i];
    if (x.tur === 'dep') return res.a[i];
    if (!x.donem) return x.ot ? res.tot[i] : res.reg[i];
    if (x.donem.t === 'q') return res.q[x.donem.k - 1][i];
    if (np === 2) return res.q[x.donem.k - 1][i] + (x.donem.k === 2 && x.ot ? res.tot[i] - res.reg[i] : 0);
    return x.donem.k === 1 ? res.q[0][i] + res.q[1][i] : res.q[2][i] + res.q[3][i] + (x.ot ? res.tot[i] - res.reg[i] : 0);
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
    if (ctx.zayif) { A -= 0.1; B += 0.1; }
    const es = ESIK[ctx.tier] || ESIK.B;
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
      satirlar.push({ x, pm, pk, pf, bek: top / N, yon, p, oran, ev, marj: iu + ia - 1, minP, minEv, minOran: (1 + minEv) / p, gecer: p >= minP && ev >= minEv });
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
  const T = { aktif: false, gor: 'canli', say: 0, sinyalSay: {}, sonSinyalK: '' };
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
    let liste = [];
    try { liste = (await ssAl('/sport/basketball/events/live')).events || []; } catch (e) {}
    T.canliListe = liste;
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
  async function ligProfili(ut, sid) {
    if (!ut || !sid) return null;
    const L = GM_getValue('bc_lig', {}), k = ut + '|' + sid;
    if (L[k] && Date.now() - L[k].z < 20 * 3600000) return L[k].p;
    const v = await ssAl('/unique-tournament/' + ut + '/season/' + sid + '/events/last/0');
    const p = ligProfiliHesapla(v.events || []);
    L[k] = { z: Date.now(), p };
    GM_setValue('bc_lig', buda(L, 60));
    return p;
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
  // Başlangıç beklentisi: maç öncesi çizgi > maçın ilk dakikalarındaki canlı çizgi > takım formu + lig ortalaması
  async function onculBul(S, canli) {
    const kayit = GM_getValue('bc_on', {})[T.bid];
    if (kayit && kayit.T > 50) { T.oncul = { T: kayit.T, pay: kayit.pay, kaynak: 'mac_oncesi', zayif: false, yazi: 'maç öncesi Bilyoner çizgisi ' + v1(kayit.T) }; return; }
    const pz = T.bil ? T.bil.pz : [];
    const sdO = S.pl >= 720 ? 0.065 : 0.075;
    const macL = pz.filter(x => x.tur === 'mac' && !x.donem && x.ot);
    const payBul = () => {
      const Hm = ortalamaCizgi(pz.filter(x => x.tur === 'ev' && !x.donem), 0.09), Am = ortalamaCizgi(pz.filter(x => x.tur === 'dep' && !x.donem), 0.09);
      return Hm && Am ? sinirla(Hm / (Hm + Am), 0.35, 0.65) : 0.505;
    };
    if (!canli) {
      const Tm = ortalamaCizgi(macL, sdO);
      if (Tm) {
        const pay = payBul();
        const O = GM_getValue('bc_on', {});
        O[T.bid] = { T: Tm, pay, z: Date.now() };
        GM_setValue('bc_on', buda(O, 300));
        T.oncul = { T: Tm, pay, kaynak: 'mac_oncesi', zayif: false, yazi: 'maç öncesi Bilyoner çizgisi ' + v1(Tm) };
      }
      return;
    }
    if (S.gecen / (S.np * S.pl) <= 0.15 && macL.length) {
      const Lm = ortalamaCizgi(macL, sdO);
      if (Lm) { T.oncul = { T: Lm, pay: payBul(), kaynak: 'ilk_canli', zayif: false, yazi: 'maçın başındaki canlı çizgi ' + v1(Lm) }; return; }
    }
    let Tf = null, pay = 0.505;
    try {
      const [fh, fa] = await Promise.all([takimFormu(T.evId), takimFormu(T.depId)]);
      if (fh && fa) { const eh = (fh.f + fa.y) / 2 + 1, ea = (fa.f + fh.y) / 2 - 1; Tf = eh + ea; pay = sinirla(eh / Tf, 0.35, 0.65); }
    } catch (e) {}
    const lg = T.lig && T.lig.ort;
    const Tt = Tf && lg ? 0.65 * Tf + 0.35 * lg : Tf || lg || (S.pl >= 720 ? 225 : 158);
    T.oncul = {
      T: Tt, pay, kaynak: Tf ? 'form' : lg ? 'lig' : 'varsayilan', zayif: true,
      yazi: Tf ? 'takımların son maç ortalamaları' + (lg ? ' + lig ortalaması' : '') + ' (' + v1(Tt) + ')' : lg ? 'lig ortalaması ' + v1(lg) : 'varsayılan ' + v0(Tt)
    };
  }

  // ---------- Gölge kayıt, kayıtlar, öğrenme ----------
  function golgeYaz(cp, satirlar) {
    if (!satirlar || !satirlar.length) return;
    const G = GM_getValue('bc_golge', []), k = T.eid + '|' + cp;
    if (G.some(r => r.k === k)) return;
    const grup = {};
    satirlar.forEach(s => { const g = s.x.tur + donemKod(s.x.donem) + (s.x.ot ? 1 : 0); (grup[g] = grup[g] || []).push(s); });
    const sec = [];
    Object.values(grup).forEach(l => l.sort((a, b) => Math.abs(a.pk - 0.5) - Math.abs(b.pk - 0.5)).slice(0, 2).forEach(s => sec.push(s)));
    const L = sec.slice(0, 12).map(s => [s.x.tur, donemKod(s.x.donem), s.x.ot ? 1 : 0, s.x.L, r3(s.pm), r3(s.pk), s.x.u, s.x.a]);
    G.push({ k, e: T.eid, ut: T.ut, tr: T.tier, cp, g: Math.round(T.saat.gecen), sh: T.saat.sh, sa: T.saat.sa, z: Date.now(), v: SURUM, L, r: null });
    if (G.length > GOLGE_MAX) G.splice(0, G.length - GOLGE_MAX);
    GM_setValue('bc_golge', G);
  }
  function sonucCikar(e) {
    const hs = skorParca(e.homeScore), as = skorParca(e.awayScore);
    const np = (e.time && +e.time.totalPeriodCount) || 4, q = [];
    for (let i = 0; i < np; i++) q.push((hs.per[i] || 0) + (as.per[i] || 0));
    const reg = q.reduce((a, b) => a + b, 0);
    return { tot: hs.cur + as.cur, reg, h: hs.cur, a: as.cur, q, otPts: hs.cur + as.cur - reg, np };
  }
  function degerAl(sd, tur, dk, ot) {
    const d = donemCoz(dk);
    if (tur === 'ev') return d ? null : sd.h;
    if (tur === 'dep') return d ? null : sd.a;
    if (!d) return ot ? sd.tot : sd.reg;
    if (d.t === 'q') return sd.q[d.k - 1] == null ? null : sd.q[d.k - 1];
    if (sd.np === 2) return sd.q[d.k - 1] + (d.k === 2 && ot ? sd.otPts : 0);
    return d.k === 1 ? sd.q[0] + sd.q[1] : sd.q[2] + sd.q[3] + (ot ? sd.otPts : 0);
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
  function sinyalKaydet() {
    const s = T.sinyal;
    if (!s) return false;
    const K = GM_getValue('bc_kayit', []);
    const id = T.eid + '|' + s.x.k + '|' + s.yon;
    if (K.some(r => r.id === id && !r.sonuc)) return false;
    K.unshift({
      id, e: T.eid, bid: T.bid, mac: (T.evAd || '') + ' - ' + (T.depAd || ''), lig: T.ligAd || '', tur: s.x.tur, d: donemKod(s.x.donem), ot: s.x.ot, L: s.x.L, yon: s.yon,
      ad: pazarAd(s.x), oran: s.oran, p: r3(s.p), pm: r3(s.pm), pk: r3(s.pk), ev: r3(s.ev), z: Date.now(), an: periyotYazi(T.saat), skor: T.saat.sh + '-' + T.saat.sa, v: SURUM, sonuc: null
    });
    GM_setValue('bc_kayit', K.slice(0, 500));
    return true;
  }
  async function bekleyenleriKontrol() {
    const K = GM_getValue('bc_kayit', []), G = GM_getValue('bc_golge', []);
    const ids = new Set(), simdi = Date.now();
    K.forEach(r => { if (!r.sonuc && simdi - r.z > 2 * 3600000) ids.add(String(r.e)); });
    G.forEach(r => { if (!r.r && simdi - r.z > 2 * 3600000) ids.add(String(r.e)); });
    let n = 0;
    for (const eid of [...ids].slice(0, 8)) {
      try {
        const v = await ssAl('/event/' + eid), e = v.event || v;
        if (e.status && e.status.type === 'finished') { sonuclandir(eid, e); n++; }
        else if (e.status && (e.status.type === 'canceled' || e.status.type === 'postponed')) {
          const K2 = GM_getValue('bc_kayit', []);
          K2.forEach(r => { if (String(r.e) === eid && !r.sonuc) r.sonuc = { durum: 'iade', z: Date.now() }; });
          GM_setValue('bc_kayit', K2);
          n++;
        }
      } catch (err) { if (Date.now() < ssSinirZ) break; }
    }
    return n;
  }

  // ---------- Takip döngüsü ----------
  function sinyalYasak(S) {
    if (Date.now() < ssSinirZ) return 'Sofascore geçici sınır koydu';
    if (!T.bil) return 'Bilyoner oranı okunamadı';
    if (S.durum === 'oynaniyor' && S.gecen < 300) return 'İlk 5 dakika: veri henüz az';
    if (S.durum === 'oynaniyor' && S.per >= S.np && S.kalan < 60) return 'Son dakika: oranlar çok hızlı değişiyor';
    if (S.saatIsliyor && S.sonDegisim != null && S.sonDegisim > 150) return 'Sofascore verisi ' + Math.round(S.sonDegisim / 60) + ' dakikadır güncellenmedi (gecikme olabilir)';
    if (T.istA && T.istZ && Date.now() - T.istZ > 300000) return 'İstatistik verisi eski';
    return '';
  }
  function hesapla() {
    const S = T.saat;
    // Skor, saat ve oranlar değişmediyse (mola, çeyrek arası) baştan hesaplama: pil tasarrufu
    const imza = [S.sh, S.sa, S.per, Math.round(S.kalan / 5), T.istZ, T.bil ? T.bil.pz.map(x => x.k + x.u + x.a).join() : ''].join('|');
    if (imza === T.imza && T.satirlar) return;
    T.imza = imza;
    T.M = modelKur(S, T.oncul, T.istA, T.istP, T.lig, T.tier);
    T.res = simule(T.M, S.gecen < S.np * S.pl / 2 ? SIM_N[0] : SIM_N[1], tohum(T.eid + '|' + imza));
    T.ozet = ozetCikar(T.res);
    T.satirlar = degerlendir(T.M, T.res, T.bil ? T.bil.pz : [], { agirlik: agirlikAl(), zayif: T.oncul.zayif, tier: T.tier, gecen: S.gecen });
    T.yasak = sinyalYasak(S);
    let sinyal = null;
    if (!T.yasak) for (const s of T.satirlar) {
      if (!s.gecer) continue;
      const grup = s.x.tur + donemKod(s.x.donem) + s.yon;
      if ((T.sinyalSay[grup] || 0) >= 2 && T.sonSinyalK !== s.x.k + s.yon) continue;   // aynı pazarda aynı yöne en fazla 2 sinyal
      sinyal = s;
      break;
    }
    T.sinyal = sinyal;
    if (sinyal && sinyal.x.k + sinyal.yon !== T.sonSinyalK) {
      const grup = sinyal.x.tur + donemKod(sinyal.x.donem) + sinyal.yon;
      T.sinyalSay[grup] = (T.sinyalSay[grup] || 0) + 1;
      T.sonSinyalK = sinyal.x.k + sinyal.yon;
      golgeYaz('S:' + T.sonSinyalK, T.satirlar);
      uyar();
    }
    if (S.ara) golgeYaz(S.per - 1 === 1 ? 'Ç1' : S.per - 1 === 2 ? 'DA' : S.per - 1 === 3 ? 'Ç3' : 'A' + (S.per - 1), T.satirlar);
  }
  async function dongu() {
    clearTimeout(T.zam);
    if (!T.aktif) return;
    if (document.visibilityState === 'hidden') { T.zam = setTimeout(dongu, 15000); return; }   // ekran kapalıyken istek yok
    T.hata = '';
    try {
      const v = await ssAl('/event/' + T.eid), e = v.event || v;
      const tm = e.time || {};
      const pps = T.oncul ? T.oncul.T / ((+tm.totalPeriodCount || 4) * (+tm.periodLength || 600)) : ((+tm.periodLength || 600) >= 720 ? 0.078 : 0.066);
      const S = saatDurumu(e, Date.now(), pps);
      T.saat = S;
      if (S.durum === 'bitti') { sonuclandir(T.eid, e); T.aktif = false; T.bitti = true; ciz(); return; }
      const canli = S.durum === 'oynaniyor' || S.durum === 'ara';
      try { T.bil = await bilyonerOranlar(T.bid, canli); T.bilHata = ''; T.bilDenenen = T.bil.denenen; }
      catch (err) { T.bil = null; T.bilHata = err.message; T.bilDenenen = err.denenen || []; }
      if (!T.oncul && (canli || T.bil)) await onculBul(S, canli);
      if (canli && T.oncul) {
        if (T.say % 2 === 0 || S.ara || !S.saatIsliyor || !T.istA) {
          try {
            const iv = await ssAl('/event/' + T.eid + '/statistics');
            T.istA = istatCoz(iv, 'ALL');
            T.istP = S.np === 4 && S.per <= 4 ? istatCoz(iv, S.per + 'Q') : null;
            T.istZ = Date.now();
            T.istHata = '';
          } catch (err) { T.istHata = err.message; }
        }
        hesapla();
      }
    } catch (err) { T.hata = err.message; }
    T.say++;
    ciz();
    T.zam = setTimeout(dongu, (T.saat && T.saat.durum === 'baslamadi' ? DONGU_ONCE : DONGU) * 1000);
  }
  async function olayKur(eid) {
    T.eid = eid;
    const v = await ssAl('/event/' + eid), e = v.event || v;
    T.evId = e.homeTeam.id; T.depId = e.awayTeam.id;
    T.evAd = e.homeTeam.name; T.depAd = e.awayTeam.name;
    T.evKisa = e.homeTeam.shortName || e.homeTeam.name; T.depKisa = e.awayTeam.shortName || e.awayTeam.name;
    const ut = e.tournament && e.tournament.uniqueTournament;
    T.ut = ut ? ut.id : null; T.sid = e.season ? e.season.id : null;
    T.ligAd = turnuvaAdi(e);
    T.tier = ligSinifi(T.ligAd + ' ' + ((e.tournament && e.tournament.name) || ''));
    if (T.evAdBil) { const tb = tokenlar(esAd(T.evAdBil)); T.ters = benzerlik(tb, takimTok(e.awayTeam)) > benzerlik(tb, takimTok(e.homeTeam)); } else T.ters = false;
    try { T.lig = await ligProfili(T.ut, T.sid); } catch (err) { T.lig = null; }
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
    return Object.keys(g).slice(0, 20).map(id => ({ id, ad: g[id] }));
  }
  async function takipBaslat(bid) {
    clearTimeout(T.zam);
    Object.assign(T, { bid, aktif: false, gor: 'canli', hata: '', oncul: null, sinyal: null, sinyalSay: {}, sonSinyalK: '', bitti: false, istA: null, istP: null, istZ: 0, M: null, res: null, satirlar: null, saat: null, evAdBil: '', depAdBil: '', ters: false, bil: null, eid: null, imza: '' });
    panelIcerik('<div class="bc-durum">⏳ Maç bilgileri alınıyor…</div>');
    try { T.bil = await bilyonerOranlar(bid, true); } catch (e) { try { T.bil = await bilyonerOranlar(bid, false); } catch (e2) { T.bilHata = e2.message; T.bilDenenen = e2.denenen || []; } }
    if (T.bil && T.bil.ev) { T.evAdBil = T.bil.ev; T.depAdBil = T.bil.dep; }
    if (!T.evAdBil) { const s = sayfaTakimlari(); T.evAdBil = s.ev; T.depAdBil = s.dep; }
    let eid = null;
    try { eid = await ssEslestir(T.evAdBil, T.depAdBil, bid); } catch (e) { T.hata = e.message; }
    if (!eid) { T.gor = 'sec'; ciz(); return; }
    try { await olayKur(eid); } catch (e) { T.hata = e.message; ciz(); }
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
  function pazarAd(x) {
    if (x.donem) return (x.donem.t === 'q' ? x.donem.k + '. çeyrek' : x.donem.k + '. yarı') + ' toplamı' + (x.ot ? ' (uzatma dahil)' : '');
    if (x.tur === 'ev') return (T.evKisa || 'Ev sahibi') + ' sayısı';
    if (x.tur === 'dep') return (T.depKisa || 'Deplasman') + ' sayısı';
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
      h(T.yasak || 'Şartları sağlayan seçim yok.') + (en ? '<br>En yakın: ' + h(pazarAd(en.x)) + ' ' + yonAd(en.yon) + ' ' + v1(en.x.L) + ' · getiri ' + isaretli(en.ev) + ' (gereken ' + isaretli(en.minEv) + ')' : '') + '</div></div>';
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
    html += '<div class="bc-k">Başlangıç beklentisi: ' + h(T.oncul.yazi) + (T.oncul.zayif ? ' (zayıf kaynak: Bilyoner\'e daha çok ağırlık, eşikler yüksek)' : '') + '</div>';
    return html;
  }
  function tablo() {
    const l = (T.satirlar || []).slice(0, 14);
    if (!l.length) return '<div class="bc-k" style="margin-top:6px">Değerlendirilecek açık alt/üst çizgisi yok.</div>';
    return '<div class="bc-grup">📊 Bütün çizgiler (getiriye göre)</div><table class="bc-tab"><tr><th>Pazar</th><th>Çizgi</th><th>Bot üst</th><th>Bil. üst</th><th>Seçim</th><th>Getiri</th></tr>' +
      l.map(s => '<tr' + (T.sinyal === s ? ' class="bc-tr-s"' : '') + '><td>' + h(pazarAd(s.x)) + '</td><td>' + v1(s.x.L) + '</td><td>' + yuzde(s.pf) + '</td><td>' + yuzde(s.pk) + '</td><td>' + yonAd(s.yon) + ' ' + v2(s.oran) + '</td><td class="' + (s.gecer ? 'bc-up' : s.ev < 0 ? 'bc-down' : '') + '">' + isaretli(s.ev) + '</td></tr>').join('') +
      '</table><div class="bc-k">Bot üst: model ile Bilyoner\'in harmanlanmış ihtimali · Bil. üst: Bilyoner oranının marjsız ihtimali.</div>';
  }
  function sekmeler(aktif) {
    return '<div class="bc-sekme"><button data-gor="canli" class="' + (aktif === 'canli' ? 'sec' : '') + '">📈 Canlı</button><button data-gor="kayit" class="' + (aktif === 'kayit' ? 'sec' : '') + '">📊 Kayıtlar (' + GM_getValue('bc_kayit', []).length + ')</button></div>';
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
    return html + '<div class="bc-ayar"><button data-islem="kontrol">🔍 Veri kontrolü</button></div>';
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
    const tut = biten.filter(r => r.sonuc.durum === 'tuttu').length, kar = biten.reduce((a, r) => a + (r.sonuc.durum === 'tuttu' ? r.oran - 1 : -1), 0);
    html += '<div class="bc-grup">📈 Aldığın canlı bahisler</div>';
    html += biten.length ? '<div><b>' + tut + '/' + biten.length + '</b> tuttu (' + yuzde(tut / biten.length) + ') · <span class="' + (kar >= 0 ? 'bc-up' : 'bc-down') + '">' + (kar >= 0 ? '+' : '') + v2(kar) + ' birim (' + isaretli(kar / biten.length) + ')</span></div>' : '<div class="bc-k">Henüz sonuçlanan yok.</div>';
    const turAd = { mac: 'Maç toplamı', ev: 'Takım toplamı', dep: 'Takım toplamı' };
    const gr = {};
    biten.forEach(r => { const g = r.d ? (r.d[0] === 'q' ? 'Çeyrek toplamı' : 'Yarı toplamı') : turAd[r.tur]; (gr[g] = gr[g] || []).push(r); });
    Object.keys(gr).forEach(g => { const l = gr[g], t = l.filter(r => r.sonuc.durum === 'tuttu').length, k = l.reduce((a, r) => a + (r.sonuc.durum === 'tuttu' ? r.oran - 1 : -1), 0); html += '<div class="bc-k">' + g + ': ' + t + '/' + l.length + ' · ' + (k >= 0 ? '+' : '') + v2(k) + ' birim</div>'; });
    html += raporHtml();
    html += K.slice(0, 40).map(r => {
      const s = r.sonuc, renk = !s ? '#fde047' : s.durum === 'tuttu' ? '#4ade80' : s.durum === 'tutmadi' ? '#f87171' : '#cbd5e1';
      return '<div class="bc-kart"><div class="bc-k">' + h(r.mac) + ' · ' + h(r.an) + ' · skor ' + h(r.skor) + '</div><div><b>' + h(r.ad) + ' ' + yonAd(r.yon) + ' ' + v1(r.L) + '</b> @' + v2(r.oran) + ' · bot ' + yuzde(r.p) + '</div>' +
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
    s.push('Başlangıç beklentisi: ' + (T.oncul ? T.oncul.yazi + ' · pay ' + r3(T.oncul.pay) : 'yok'));
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
      '#bc-btn{position:fixed;right:12px;bottom:440px;z-index:2147483646;width:52px;height:52px;border-radius:50%;border:none;font-size:24px;padding:0;background:#0ea5e9;box-shadow:0 2px 10px #0009}' +
      '#bc-btn.bc-uyari{background:#22c55e}' +
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
    p.innerHTML = '<button class="bc-kapat">×</button><h3>📈 Basket Canlı Toplam ' + SURUM + '</h3>' + html;
    p.style.display = 'block';
    p.scrollTop = kay;
  }
  function ciz() {
    const p = document.getElementById('bc-panel');
    if (!p || p.style.display !== 'block') return;
    if (T.gor === 'kayit' || T.gor === 'kontrol') return;          // kullanıcı başka ekrandaysa bozma
    if (T.gor === 'sec') { panelIcerik(secimEkrani()); return; }
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
    const tk = at('data-takip');
    if (tk) { takipBaslat(tk); return; }
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
    if (islem === 'kaydet') { if (sinyalKaydet()) { t.textContent = '✔ Kaydedildi'; t.disabled = true; } else { t.textContent = 'Zaten kayıtlı'; } return; }
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
      const y = JSON.stringify({ surum: SURUM, kayit: GM_getValue('bc_kayit', []), golge: GM_getValue('bc_golge', []), ogren: GM_getValue('bc_ogren', {}), on: GM_getValue('bc_on', {}) });
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
    b.textContent = '📈';
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
    globalThis.__BC = { T, norm, pazarSinifi, cizgiCoz, pazarlar, saatDurumu, istatCoz, modelKur, simule, degerlendir, ozetCikar, ortalamaCizgi, ligProfiliHesapla, sonucCikar, degerAl, takipEkrani, kayitEkrani, anaEkran, kontrolMetni, hesapla, panelIcerik };
    return;
  }
  css();
  butonKoy();
  setInterval(butonKoy, 10000);
  if (Date.now() - GM_getValue('bc_sonKontrol', 0) > 30 * 60000) { GM_setValue('bc_sonKontrol', Date.now()); bekleyenleriKontrol().catch(() => {}); }
})();
