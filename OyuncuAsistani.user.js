// ==UserScript==
// @name         Oyuncu Asistanı
// @namespace    oyuncuasistani
// @version      1.6
// @description  Bilyoner oyuncu şut / isabetli şut / top çalma / faul / kart oranlarına Statshub istatistiği ve referans oranı ekler
// @match        https://www.bilyoner.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_setClipboard
// @connect      statshub.com
// @connect      www.statshub.com
// @connect      www.bilyoner.com
// @run-at       document-end
// @downloadURL  https://raw.githubusercontent.com/citomuhammet00/mac-arsivi/main/OyuncuAsistani.user.js
// @updateURL    https://raw.githubusercontent.com/citomuhammet00/mac-arsivi/main/OyuncuAsistani.user.js
// ==/UserScript==
(function () {
  'use strict';

  const SURUM = '1.6';
  const ayar = Object.assign({ macSayisi: 10, konum: 'karisik' }, GM_getValue('oy_ayar', {}));
  const ayarKaydet = () => GM_setValue('oy_ayar', Object.assign({}, ayar));

  const TIP = {
    sut: { ad: 'Şut', birim: 'şut', market: 'PLAYER_SHOTS', deger: st => Number(st.shots) || 0 },
    isabetli: { ad: 'Kaleyi Bulan Şut', birim: 'kaleyi bulan şut', market: 'PLAYER_SHOTS_ON_TARGET', deger: st => Number(st.onTargetScoringAttempt) || 0 },
    topcalma: { ad: 'Top Çalma', birim: 'top çalma', market: 'PLAYER_TACKLES', deger: st => Number(st.totalTackle) || 0 },
    faul: { ad: 'Faul Yapar', birim: 'faul', market: 'PLAYER_FOULS_COMMITTED', deger: st => Number(st.fouls) || 0 },
    maruz: { ad: 'Faule Maruz Kalır', birim: 'faule maruz kalma', market: 'PLAYER_TO_BE_FOULED', deger: st => Number(st.wasFouled) || 0 },
    kart: { ad: 'Kart', birim: 'kart', market: 'PLAYER_CARDS', deger: st => (Number(st.yellowCard) || 0) + (Number(st.redCard) || 0) }
  };

  // ---------- Yardımcılar ----------
  function norm(s) {
    return String(s || '').replace(/İ/g, 'i').replace(/I/g, 'ı').toLowerCase().replace(/ı/g, 'i')
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9+,. ]/g, ' ').replace(/\s+/g, ' ').trim();
  }
  const BOS = ['fk', 'fc', 'sk', 'afc', 'club', 'spor', 'kulubu', 'cf', 'sc'];
  const tokenlar = s => norm(s).replace(/[+,.]/g, ' ').split(' ').filter(t => t.length >= 3 && BOS.indexOf(t) < 0);
  function benzerlik(a, b) {
    let p = 0;
    a.forEach(t => { if (b.some(s => s === t || (t.length >= 4 && s.length >= 4 && s.slice(0, 4) === t.slice(0, 4)))) p++; });
    return p;
  }
  // İsim puanı: tam kelime 2, ilk 4 harf 1.5
  function isimPuan(a, b) {
    const A = tokenlar(a), B = tokenlar(b);
    let p = 0;
    A.forEach(t => {
      if (B.some(s => s === t)) p += 2;
      else if (B.some(s => t.length >= 4 && s.length >= 4 && s.slice(0, 4) === t.slice(0, 4))) p += 1.5;
    });
    return p;
  }
  // Oyuncu adı kelimeleri (baş harf kısaltmaları hariç: "A. Batrakov" → batrakov)
  const adKelime = s => norm(s).replace(/[+,.]/g, ' ').split(' ').filter(t => t.length >= 2);
  // Sıkı kural: Bilyoner'deki soyad (son kelime) adayın isminde birebir geçmeli.
  // Sadece aynı ön adı taşıyan başka oyuncu ("Aleksey ...") artık eşleşmez.
  function soyadTutar(ad, aday) {
    const A = adKelime(ad), B = adKelime(aday);
    if (!A.length || !B.length) return false;
    const soyad = A[A.length - 1];
    if (soyad.length < 3) return false;
    return B.indexOf(soyad) >= 0;
  }
  const h = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const v1 = x => (Math.round(x * 10) / 10).toFixed(1).replace('.', ',');
  const v2 = x => Number(x).toFixed(2).replace('.', ',');

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

  // ---------- Pazar tanıma ----------
  function pazarTipi(baslik) {
    const b = norm(baslik);
    if (!/oyuncu/.test(b)) return null;
    if (/isabet|kaleyi bul|kaleye|kale icine|cerceve/.test(b)) return 'isabetli';
    if (/sut/.test(b)) return 'sut';
    if (/top cal|top kap|mudahale|tackle/.test(b)) return 'topcalma';
    if (/faule maruz|faul alir|faul kazan|maruz kal/.test(b)) return 'maruz';
    if (/faul/.test(b)) return 'faul';
    if (/kart/.test(b)) return 'kart';
    return null;
  }
  // "Jamerson 2+" → { ad, esik }   |   sadece isim ("Hangi Oyuncu Kart Görür?") → esik 1
  function secimCoz(tip, etiket) {
    const t = String(etiket || '').replace(/\s+/g, ' ').trim();
    const m = t.match(/^(.+?)\s*(\d+)\s*\+$/) || t.match(/^(.+?)\s+(\d+)\s*(?:veya|ve)?\s*(?:ust|üst|fazla)$/i);
    if (m) return { ad: m[1].trim(), esik: parseInt(m[2], 10) };
    if (t && !/\d/.test(t) && t.length < 40 && !/^(evet|hayir|hayır|ust|üst|alt|var|yok)$/i.test(t)) return { ad: t, esik: 1 };
    return null;
  }
  const anahtar = (tip, ad, esik) => tip + '|' + norm(ad) + '|' + esik;

  // ---------- Bilyoner ----------
  const macIdOku = () => (location.pathname.match(/mac-karti\/[^/]+\/(\d+)/) || [])[1] || null;

  async function bilyonerVeri(bid) {
    const v = await al('https://www.bilyoner.com/api/v3/mobile/aggregator/match-card/' + bid + '/odds?isLiveEvent=true&isPopular=false');
    const oranlar = [];
    const gez = x => {
      if (!x || typeof x !== 'object') return;
      if (Array.isArray(x)) { x.forEach(gez); return; }
      if (Array.isArray(x.oddList)) {
        x.oddList.forEach(o => {
          if (o && o.n !== undefined && o.val !== undefined)
            oranlar.push({ pazar: String(x.name || o.mrn || ''), n: String(o.n), val: parseFloat(String(o.val).replace(',', '.')) });
        });
      }
      Object.keys(x).forEach(k => { if (k !== 'oddList' && x[k] && typeof x[k] === 'object') gez(x[k]); });
    };
    gez(v);
    return { ev: v.homeTeam, dep: v.awayTeam, oranlar, ts: baslamaZamani(v) };
  }

  // Bilyoner cevabında maç başlama saatini arar (alan adı bilinmediği için genel tarama). Bulamazsa null.
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

  function domOranlar() {
    const sonuc = [];
    document.querySelectorAll('.odd').forEach(el => {
      const o = oddOku(el);
      if (o.deger > 1) sonuc.push({ pazar: o.baslik, n: o.etiket, val: o.deger });
    });
    return sonuc;
  }
  function oddOku(oddEl) {
    const degerEl = oddEl.querySelector('.odd__value');
    const deger = parseFloat(((degerEl && degerEl.innerText) || '').replace(',', '.'));
    let etiket = oddEl.innerText.split('\n').map(s => s.trim()).filter(s => s && !/^\d+[.,]\d+$/.test(s)).join(' ');
    if (!etiket && oddEl.previousElementSibling) etiket = oddEl.previousElementSibling.innerText.trim();
    const kutu = oddEl.closest('.market-box') || (oddEl.closest('.market-box__content') || oddEl).parentElement;
    let baslik = '';
    if (kutu) {
      const hd = kutu.querySelector('[class*="header"], [class*="title"], [class*="name"]');
      baslik = ((hd ? hd.innerText : kutu.innerText.split('\n')[0]) || '').trim();
    }
    return { deger, etiket, baslik };
  }

  // ---------- Statshub ----------
  // Takım eşleşme oranı: Bilyoner adındaki kelimelerin ne kadarı Statshub adında var (0–1)
  function takimOran(bT, sT) { return bT.length ? benzerlik(bT, sT) / bT.length : 0; }
  async function statshubMaci(ev, dep, bilTs) {
    const evT = tokenlar(ev), depT = tokenlar(dep);
    const bugun = new Date(); bugun.setHours(0, 0, 0, 0);
    const b0 = Math.floor(bugun.getTime() / 1000);
    for (const g of [0, 1, 2, -1]) {
      const s = b0 + g * 86400;
      const veri = await al('https://www.statshub.com/api/event/by-date?startOfDay=' + s + '&endOfDay=' + (s + 86399));
      let enIyi = null, puan = 0;
      (veri.data || []).forEach(x => {
        const e = x.events || {};
        if (!e.slug) return;
        const parca = e.slug.replace(/-[a-z0-9]+$/, '').split('-vs-');
        if (parca.length !== 2) return;
        const ts = Number(e.timeStartTimestamp) || 0;
        // Saat biliniyorsa 3 saatten fazla fark eden maç başka maçtır
        if (bilTs && ts && Math.abs(ts - bilTs) > 3 * 3600) return;
        const p1 = takimOran(evT, parca[0].split('-')), p2 = takimOran(depT, parca[1].split('-'));
        // İki takımın da adının en az yarısı tutmalı (sadece "Lokomotiv" tutması yetmez)
        if (p1 < 0.5 || p2 < 0.5) return;
        if (p1 + p2 > puan) {
          puan = p1 + p2;
          enIyi = { id: e.id, slug: e.slug, homeTeamId: e.homeTeamId, awayTeamId: e.awayTeamId, ts: Number(e.timeStartTimestamp) || 0 };
        }
      });
      if (enIyi) return enIyi;
    }
    return null;
  }

  const onbellek = {};
  async function onbellekli(k, f) {
    if (onbellek[k] === undefined) onbellek[k] = await f();
    return onbellek[k];
  }
  async function kadro(takimId, konum, limit) {
    return onbellekli('k|' + takimId + '|' + konum + '|' + limit, async () => {
      const temel = 'https://www.statshub.com/api/team/' + takimId + '/players/performance?limit=' + limit + '&location=' + konum;
      let v = null;
      try { v = await al(temel); } catch (e) {}
      if (!v || !v.data || !v.data.length) { try { v = await al(temel + '&tournamentId=1,11,16,27,851,10783'); } catch (e) {} }
      return (v && v.data) || [];
    });
  }
  async function piyasa(macId, market) {
    return onbellekli('p|' + macId + '|' + market, async () => {
      try { const v = await al('https://www.statshub.com/api/event/' + macId + '/odds-movements?market=' + market); return v.series || []; }
      catch (e) { return []; }
    });
  }

  const lim0 = () => Number(ayar.macSayisi) || 10;

  // ---------- Kayıtlar ----------
  const kayitAl = () => GM_getValue('oy_kayitlar', []);
  const kayitYaz = k => GM_setValue('oy_kayitlar', k);
  const kayitId = r => r.macId + '|' + r.k;
  const kayitliMi = r => kayitAl().some(x => x.id === kayitId(r));
  function kaydet(r) {
    const k = kayitAl();
    if (k.some(x => x.id === kayitId(r))) return false;
    const kopya = JSON.parse(JSON.stringify(r));
    kopya.id = kayitId(r);
    kopya.kayitZaman = Date.now();
    kopya.sonuc = null;
    k.unshift(kopya);
    kayitYaz(k);
    return true;
  }
  function kayitSil(id) { kayitYaz(kayitAl().filter(x => x.id !== id)); }
  function sonucYaz(id, sonuc) {
    const k = kayitAl();
    const x = k.find(y => y.id === id);
    if (x) { x.sonuc = sonuc; kayitYaz(k); }
  }

  // İlk 11: true = ilk 11'de başladı, false = başlamadı, null = bilinmiyor
  async function ilk11(macId, tid, oyuncuId) {
    const k = 'l|' + macId + '|' + tid;
    if (onbellek[k] === undefined) {
      try { onbellek[k] = await al('https://www.statshub.com/api/event/' + macId + '/team-lineup?teamId=' + tid + '&heatmap=false'); }
      catch (e) { onbellek[k] = null; }
    }
    const v = onbellek[k];
    if (!v || typeof v !== 'object') return null;
    const idOf = o => o.id != null ? o.id : o.playerId != null ? o.playerId : (o.player && o.player.id);
    const kapsayici = o => Object.keys(o).some(a => Array.isArray(o[a]) && o[a].some(y => y && typeof y === 'object'));
    let bulundu = null, oyuncuSay = 0;
    const gez = (x, yol) => {
      if (!x || typeof x !== 'object' || bulundu) return;
      if (Array.isArray(x)) { x.forEach(y => gez(y, yol)); return; }
      const id = idOf(x);
      if (id != null && !kapsayici(x) && (x.name || x.player || x.playerName || x.shirtNumber != null || x.position != null || 'substitute' in x)) {
        oyuncuSay++;
        if (String(id) === String(oyuncuId)) bulundu = { o: x, yol };
        return;
      }
      Object.keys(x).forEach(a => gez(x[a], yol.concat(a)));
    };
    gez(v, []);
    if (!bulundu) return oyuncuSay >= 11 ? false : null;   // maç kadrosunda hiç yok → başlamadı
    const o = bulundu.o;
    for (const a of ['substitute', 'isSubstitute', 'sub', 'bench', 'isBench']) if (typeof o[a] === 'boolean') return !o[a];
    for (const a of ['starter', 'isStarter', 'isStarting', 'started', 'firstEleven']) if (typeof o[a] === 'boolean') return o[a];
    for (const a of ['type', 'status', 'role', 'lineupType', 'lineup']) {
      const d = typeof o[a] === 'string' ? o[a].toLowerCase() : '';
      if (/sub|bench|yedek|reserve/.test(d)) return false;
      if (/start|first|ilk/.test(d)) return true;
    }
    const yol = bulundu.yol.join(' ').toLowerCase();
    if (/sub|bench|yedek|reserve/.test(yol)) return false;
    if (/start|first|ilk|xi/.test(yol)) return true;
    return null;
  }

  // Maçı bitmiş, sonucu boş kayıtları Statshub'dan kontrol eder.
  // Bilyoner kuralı: ilk 11'de başlamayan oyuncunun bahsi iade (1,00).
  async function sonuclariKontrol() {
    const simdi = Date.now() / 1000;
    const bekleyen = kayitAl().filter(x => !x.sonuc && x.oyuncuId && x.takimId && x.macTs && simdi > x.macTs + 2.5 * 3600);
    const takimlar = [...new Set(bekleyen.map(x => x.takimId))];
    let yeni = 0;
    for (const tid of takimlar) {
      let liste = [];
      for (const ek of ['', '&tournamentId=1,11,16,27,851,10783']) {
        try {
          const v = await al('https://www.statshub.com/api/team/' + tid + '/players/performance?limit=10&location=both' + ek);
          liste = (v && v.data) || [];
        } catch (e) { liste = []; }
        if (liste.length) break;
      }
      for (const x of bekleyen.filter(y => y.takimId === tid)) {
        const eid = String(x.macId);
        const veriVar = liste.some(o => o.stats && o.stats[eid]);
        if (!veriVar) continue;                     // maç verisi henüz gelmemiş
        const o = liste.find(y => String(y.id) === String(x.oyuncuId));
        const st = o && o.stats && o.stats[eid];
        const oynadi = st && Number(st.minutesPlayed) > 0;
        const basladi = oynadi ? await ilk11(x.macId, tid, x.oyuncuId) : false;
        if (!oynadi || basladi === false) {
          sonucYaz(x.id, { durum: 'iade', neden: oynadi ? 'yedek' : 'oynamadi', dk: oynadi ? Number(st.minutesPlayed) : 0, zaman: Date.now() });
        } else {
          const deger = TIP[x.tip].deger(st);
          sonucYaz(x.id, { durum: deger >= x.esik ? 'tuttu' : 'tutmadi', deger, dk: Number(st.minutesPlayed), ilk11: basladi, zaman: Date.now() });
        }
        yeni++;
      }
    }
    return yeni;
  }

  // ---------- Eşleştirme ----------
  // En yüksek puanlı tek adayı döndürür; iki farklı kişi aynı puanda ise belirsiz sayar.
  function enIyiAday(ad, liste, adF, idF) {
    let iyi = null, puan = 0, belirsiz = false;
    liste.forEach(x => {
      if (!soyadTutar(ad, adF(x))) return;
      const p = isimPuan(ad, adF(x)) + 0.1;
      if (p > puan) { puan = p; iyi = x; belirsiz = false; }
      else if (p === puan && p > 0 && iyi && String(idF(x)) !== String(idF(iyi))) belirsiz = true;
    });
    return iyi && !belirsiz ? iyi : null;
  }

  // ---------- Hesap ----------
  let sonuclar = {};      // anahtar → satır
  let sonListe = [];
  let calisiyor = false;
  let sonEv = '', sonDep = '', sonMacYazi = '';

  async function analiz() {
    if (calisiyor) return;
    calisiyor = true;
    sonuclar = {}; sonListe = [];
    try {
      const bid = macIdOku();
      if (!bid) throw new Error('Önce bir maçın detay sayfasını aç (mac-karti).');

      durum('Bilyoner oranları okunuyor…');
      let bv = null;
      try { bv = await bilyonerVeri(bid); } catch (e) {}
      let ev = bv && bv.ev, dep = bv && bv.dep;
      if (!ev || !dep) {
        const m = document.title.match(/^\s*(.+?)\s+-\s+(.+?)(?:\s+(?:maç|maci|iddaa|canlı|oran)|\s*\||$)/i);
        if (m) { ev = m[1].trim(); dep = m[2].trim(); }
      }
      if (!ev || !dep) throw new Error('Takım adları okunamadı.');

      // Oyuncu pazarlarını topla (önce API, yoksa ekrandaki butonlar)
      const topla = kaynak => {
        const out = [], gor = {};
        kaynak.forEach(o => {
          const tip = pazarTipi(o.pazar);
          if (!tip) return;
          const s = secimCoz(tip, o.n);
          if (!s || !(o.val > 1)) return;
          const k = anahtar(tip, s.ad, s.esik);
          if (gor[k]) return;
          gor[k] = 1;
          out.push({ tip, ad: s.ad, esik: s.esik, bil: o.val, k, pazar: o.pazar });
        });
        return out;
      };
      let secimler = bv ? topla(bv.oranlar) : [];
      if (!secimler.length) secimler = topla(domOranlar());
      if (!secimler.length) {
        const oyuncuPazar = [...new Set((bv ? bv.oranlar : []).map(o => o.pazar).filter(p => /oyuncu/.test(norm(p))))];
        throw new Error('Bu maçta oyuncu şut / kaleyi bulan şut / top çalma / faul / kart oranı bulunamadı.' +
          (oyuncuPazar.length ? ' Bulunan oyuncu pazarları: ' + oyuncuPazar.slice(0, 8).join(' · ') : ''));
      }

      durum('Statshub\'da maç aranıyor: ' + ev + ' - ' + dep);
      const mac = await statshubMaci(ev, dep, bv && bv.ts);
      if (!mac) throw new Error('Statshub\'da maç bulunamadı: ' + ev + ' - ' + dep);
      sonEv = ev; sonDep = dep;
      sonMacYazi = mac.slug.replace(/-[a-z0-9]+$/, '').replace(/-vs-/, ' - ').replace(/-/g, ' ');
      const ayarYazi = 'son ' + lim0() + ' maç · ' + (ayar.konum === 'evdep' ? 'ev sahibi evde, dep. deplasmanda' : 'tüm maçlar');

      durum('Oyuncu istatistikleri çekiliyor…');
      const lim = lim0();
      const evdep = ayar.konum === 'evdep';
      const [evK, depK] = await Promise.all([
        kadro(mac.homeTeamId, evdep ? 'home' : 'both', lim),
        kadro(mac.awayTeamId, evdep ? 'away' : 'both', lim)
      ]);
      const tumKadro = evK.map(o => ({ o, taraf: 'ev' })).concat(depK.map(o => ({ o, taraf: 'dep' })));

      durum('Referans oranlar çekiliyor…');
      const seriler = {};
      for (const tip of [...new Set(secimler.map(s => s.tip))]) seriler[tip] = await piyasa(mac.id, TIP[tip].market);

      secimler.forEach(s => {
        const seri = seriler[s.tip] || [];
        // 1) Oyuncuyu kadroda bul; 2) olmazsa referans oran listesindeki isimden id ile bul
        let bul = enIyiAday(s.ad, tumKadro, x => x.o.name || '', x => x.o.id);
        let sx = null;
        if (!bul) {
          sx = enIyiAday(s.ad, seri, x => x.player || x.playerKey || '', x => x.playerId);
          if (sx) bul = tumKadro.find(x => String(x.o.id) === String(sx.playerId)) || null;
        }
        const satir = {
          ...s, oyuncu: bul ? bul.o.name : null, taraf: bul ? bul.taraf : null,
          oyuncuId: bul ? bul.o.id : (sx ? sx.playerId : null),
          takimId: bul ? (bul.taraf === 'ev' ? mac.homeTeamId : mac.awayTeamId) : null,
          takimAd: bul ? (bul.taraf === 'ev' ? ev : dep) : null,
          macId: mac.id, macTs: mac.ts, macAd: ev + ' - ' + dep, ayarYazi
        };

        // İstatistik
        if (bul) {
          const oyn = Object.values(bul.o.stats || {}).filter(st => Number(st.minutesPlayed) > 0);
          const vals = oyn.map(TIP[s.tip].deger);
          satir.n = vals.length;
          satir.ort = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
          satir.tut = vals.filter(v => v >= s.esik).length;
          satir.dk = oyn.length ? oyn.reduce((a, st) => a + Number(st.minutesPlayed), 0) / oyn.length : null;
        }

        // Referans oran (Üst esik-0,5)
        const pid = bul ? bul.o.id : (sx ? sx.playerId : null);
        const adT = bul ? bul.o.name : s.ad;
        const ayni = x => pid != null ? String(x.playerId) === String(pid) : soyadTutar(adT, x.player || x.playerKey || '');
        const sirket = {};
        seri.filter(x => String(x.selection).toUpperCase() === 'OVER' && Math.abs(Number(x.line) - (s.esik - 0.5)) < 0.01 && Number(x.currentOdds) > 1 && ayni(x))
          .forEach(x => { sirket[x.bookmaker || ('Site #' + x.bookmakerId)] = Number(x.currentOdds); });
        const refs = Object.entries(sirket);
        if (refs.length) {
          const en = refs.reduce((a, r) => r[1] > a[1] ? r : a);
          const kotu = refs.reduce((a, r) => r[1] < a[1] ? r : a);
          satir.refEn = en[1]; satir.refEnSirket = en[0];
          satir.refKotu = kotu[1]; satir.refKotuSirket = kotu[0];
          satir.refSay = refs.length;
          satir.ihtimal = 100 / en[1];                    // en iyi orana göre (temkinli) tutma ihtimali
          satir.fark = (s.bil / en[1] - 1) * 100;         // Bilyoner, en iyi siteden % kaç fazla/az
        }
        // Şüphe kontrolü: böyle satırlar "En iyi fırsatlar"a girmez
        satir.suphe = [];
        if (satir.refEn && satir.fark > 40) satir.suphe.push('Bilyoner diğer siteden %' + Math.round(satir.fark) + ' fazla, oran eşleşmesi şüpheli');
        if (satir.refEn && satir.n >= 5 && Math.abs(satir.ihtimal - satir.tut / satir.n * 100) > 40)
          satir.suphe.push('İstatistik (' + satir.tut + '/' + satir.n + ') ile tutma ihtimali (%' + Math.round(satir.ihtimal) + ') çelişiyor');
        sonuclar[s.k] = satir;
        sonListe.push(satir);
      });

      isaretleTumu();
      sonucGoster(ev, dep);
    } catch (e) {
      panelIcerik(sekmeHtml('analiz') + '<div class="oy-hata">❌ ' + h(e.message) + '</div>' + ayarHtml());
    } finally {
      calisiyor = false;
    }
  }

  // ---------- Butonları işaretle ----------
  function isaretleTumu() {
    if (!sonListe.length) return;
    document.querySelectorAll('.odd').forEach(el => {
      const o = oddOku(el);
      const tip = pazarTipi(o.baslik);
      if (!tip) return;
      const s = secimCoz(tip, o.etiket);
      if (!s) return;
      const r = sonuclar[anahtar(tip, s.ad, s.esik)];
      if (!r) return;
      const parca = [];
      if (r.n) parca.push(r.tut + '/' + r.n);
      if (r.refEn) parca.push((r.suphe && r.suphe.length ? '⚠️' : r.fark > 0 ? '🟢' : '🔴') + '%' + Math.round(r.ihtimal));
      if (!parca.length) parca.push('veri yok');
      const yazi = parca.join(' ');
      if (el.getAttribute('data-oy') !== yazi) el.setAttribute('data-oy', yazi);
      el.setAttribute('data-oy-r', r.suphe && r.suphe.length ? 'yok' : r.refEn ? (r.fark > 0 ? 'iyi' : 'kotu') : 'yok');
    });
  }

  // ---------- Panel ----------
  function css() {
    if (document.getElementById('oy-css')) return;
    const st = document.createElement('style');
    st.id = 'oy-css';
    st.textContent =
      '.odd[data-oy]{position:relative}' +
      '.odd[data-oy]::before{content:attr(data-oy);position:absolute;left:3px;top:1px;font-size:9px;font-weight:bold;line-height:1;color:#1d4ed8;pointer-events:none;z-index:2}' +
      '.odd[data-oy-r="iyi"]{box-shadow:inset 0 0 0 2px #22c55e}' +
      '.odd[data-oy-r="kotu"]{box-shadow:inset 0 0 0 2px #ef4444}' +
      '#oy-btn{position:fixed;right:12px;bottom:230px;z-index:2147483646;width:52px;height:52px;border-radius:50%;border:none;font-size:24px;padding:0;background:#16a34a;box-shadow:0 2px 10px #0009}' +
      '#oy-panel{position:fixed;left:8px;right:8px;bottom:8px;max-height:82vh;overflow:auto;z-index:2147483647;background:#14201a;color:#eef3ef;border-radius:14px;padding:14px;font:14px/1.45 sans-serif;box-shadow:0 6px 24px #000c;box-sizing:border-box;display:none}' +
      '#oy-panel h3{margin:0 0 6px;font-size:16px}' +
      '#oy-panel .oy-kapat{position:absolute;right:10px;top:8px;background:none;border:none;color:#ccc;font-size:22px}' +
      '#oy-panel .oy-ayar{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0}' +
      '#oy-panel .oy-ayar button{flex:1;min-width:30%;padding:8px 4px;border-radius:8px;border:1px solid #3a5a48;background:#1d2e25;color:#dfe;font-size:13px}' +
      '#oy-panel .oy-ayar button.sec{background:#16a34a;color:#fff;border-color:#16a34a}' +
      '#oy-panel .oy-calis{width:100%;padding:11px;border:none;border-radius:10px;background:#22c55e;color:#06210f;font-weight:bold;font-size:15px;margin-top:4px}' +
      '#oy-panel .oy-grup{margin-top:12px;font-weight:bold;color:#9fe0b5;border-bottom:1px solid #2c4337;padding-bottom:3px}' +
      '#oy-panel .oy-sat{padding:6px 0;border-bottom:1px solid #1f3229}' +
      '#oy-panel .oy-sat b{font-size:14px}' +
      '#oy-panel .oy-k{font-size:12px;color:#a9b8af}' +
      '#oy-panel .oy-iyi{color:#4ade80;font-weight:bold}' +
      '#oy-panel .oy-kotu{color:#f87171;font-weight:bold}' +
      '#oy-panel .oy-hata{background:#3b1414;color:#fecaca;padding:8px;border-radius:8px;margin:6px 0}' +
      '#oy-panel .oy-durum{color:#a9b8af;font-size:13px;margin:6px 0}' +
      '#oy-panel .oy-sekme{display:flex;gap:6px;margin:4px 0 8px}' +
      '#oy-panel .oy-sekme button{flex:1;padding:9px 4px;border-radius:9px;border:1px solid #3a5a48;background:#1d2e25;color:#dfe;font-size:14px;font-weight:bold}' +
      '#oy-panel .oy-sekme button.sec{background:#fde047;color:#1a1a1a;border-color:#fde047}' +
      '#oy-panel .oy-kucuk-btn{padding:5px 10px;border-radius:7px;border:1px solid #3a5a48;background:#22382c;color:#e6f5ea;font-size:12px}' +
      '#oy-panel .oy-kucuk-btn[disabled]{opacity:.6}';
    document.head.appendChild(st);
  }

  function ayarHtml() {
    const b = (grup, deger, yazi, sec) => '<button data-g="' + grup + '" data-v="' + deger + '" class="' + (sec ? 'sec' : '') + '">' + yazi + '</button>';
    return '<div class="oy-ayar">' +
      b('mac', 5, 'Son 5 maç', ayar.macSayisi == 5) + b('mac', 10, 'Son 10 maç', ayar.macSayisi == 10) + '</div>' +
      '<div class="oy-ayar">' +
      b('konum', 'karisik', 'Karışık (ev+dep)', ayar.konum === 'karisik') +
      b('konum', 'evdep', 'Ev sahibi evde · Dep. deplasmanda', ayar.konum === 'evdep') + '</div>' +
      '<button class="oy-calis">▶ Analiz et</button>';
  }

  function panel() {
    let p = document.getElementById('oy-panel');
    if (p) return p;
    p = document.createElement('div');
    p.id = 'oy-panel';
    document.body.appendChild(p);
    p.addEventListener('click', e => {
      const t = e.target;
      if (t.classList.contains('oy-kapat')) { p.style.display = 'none'; return; }
      if (t.classList.contains('oy-calis')) { analiz(); return; }
      const sekme = t.getAttribute && t.getAttribute('data-sekme');
      if (sekme === 'kayit') { kayitlarGoster(true); return; }
      if (sekme === 'analiz') { analizSekmesi(); return; }
      const kk = t.getAttribute && t.getAttribute('data-kaydet');
      if (kk) {
        const r = sonuclar[kk];
        if (r && kaydet(r)) {
          p.querySelectorAll('[data-kaydet]').forEach(x => { if (x.getAttribute('data-kaydet') === kk) { x.textContent = '✔ Kaydedildi'; x.disabled = true; } });
          sekmeSayisiGuncelle();
        }
        return;
      }
      const sil = t.getAttribute && t.getAttribute('data-sil');
      if (sil) { if (confirm('Bu kayıt silinsin mi?')) { kayitSil(sil); kayitlarGoster(false); } return; }
      const elle = t.getAttribute && t.getAttribute('data-elle');
      if (elle) { sonucYaz(t.getAttribute('data-id'), { durum: elle, elle: true, zaman: Date.now() }); kayitlarGoster(false); return; }
      const islem = t.getAttribute && t.getAttribute('data-islem');
      if (islem === 'kontrol') { kayitlarGoster(true); return; }
      if (islem === 'yedekAl') {
        try { GM_setClipboard(JSON.stringify(kayitAl())); alert(kayitAl().length + ' kayıt panoya kopyalandı. Bir not uygulamasına yapıştırıp sakla.'); }
        catch (e) { prompt('Bu metni kopyalayıp sakla:', JSON.stringify(kayitAl())); }
        return;
      }
      if (islem === 'yedekYukle') {
        const metin = prompt('Daha önce kopyaladığın yedeği buraya yapıştır:');
        if (!metin) return;
        try {
          const gelen = JSON.parse(metin);
          if (!Array.isArray(gelen)) throw new Error();
          const k = kayitAl(), var_ = new Set(k.map(x => x.id));
          const eklenecek = gelen.filter(x => x && x.id && !var_.has(x.id));
          kayitYaz(k.concat(eklenecek));
          alert(eklenecek.length + ' kayıt geri yüklendi.');
          kayitlarGoster(false);
        } catch (e) { alert('Yedek okunamadı. Metnin tamamını kopyaladığından emin ol.'); }
        return;
      }
      const g = t.getAttribute && t.getAttribute('data-g');
      if (g) {
        if (g === 'mac') ayar.macSayisi = Number(t.getAttribute('data-v'));
        if (g === 'konum') ayar.konum = t.getAttribute('data-v');
        ayarKaydet();
        analiz();
      }
    });
    return p;
  }
  function panelIcerik(html) {
    const p = panel();
    p.innerHTML = '<button class="oy-kapat">×</button><h3>🎯 Oyuncu Asistanı ' + SURUM + '</h3>' + html;
    p.style.display = 'block';
  }
  const durum = yazi => panelIcerik('<div class="oy-durum">⏳ ' + h(yazi) + '</div>');
  const macSayfasi = () => /mac-karti\//.test(location.pathname) && !/basketbol/.test(location.pathname);
  function analizSekmesi() {
    if (sonListe.length) { sonucGoster(sonEv, sonDep); return; }
    if (!macSayfasi()) { panelIcerik(sekmeHtml('analiz') + '<div class="oy-k" style="padding:8px 0">Analiz için bir futbol maçının detay sayfasını aç.</div>'); return; }
    panelIcerik(sekmeHtml('analiz') + ayarHtml());
  }
  function sekmeSayisiGuncelle() {
    const b = document.querySelector('#oy-panel [data-sekme="kayit"]');
    if (b) b.textContent = '📊 Kayıtlar (' + kayitAl().length + ')';
  }

  function secimYazi(r) {
    if (r.tip === 'kart') return r.ad + ' kart görür';
    return r.ad + ' ' + r.esik + '+ ' + TIP[r.tip].birim;
  }
  // Sıra: önce 🟢 (Bilyoner en iyi siteyi geçiyor), sonra 🔴, en son oranı olmayanlar.
  // Her grubun içinde tutma ihtimali yüksek olan üstte.
  function sirala(a, b) {
    const sinif = r => r.suphe && r.suphe.length ? 3 : r.refEn ? (r.fark > 0 ? 0 : 1) : 2;
    if (sinif(a) !== sinif(b)) return sinif(a) - sinif(b);
    if (a.refEn && b.refEn) return b.ihtimal - a.ihtimal;
    const oran = r => r.n ? r.tut / r.n : -1;
    return oran(b) - oran(a);
  }
  function satirHtml(r, mod) {
    const isaret = r.suphe && r.suphe.length ? '⚠️ ' : r.refEn ? (r.fark > 0 ? '🟢 ' : '🔴 ') : '⚪ ';
    let html = '<div class="oy-sat"><div>' + isaret + '<b>' + h(secimYazi(r)) + '</b> · Bilyoner <b>' + v2(r.bil) + '</b></div>';
    if (r.refEn) {
      if (r.refSay > 1) {
        html += '<div class="oy-k">Siteler: en iyi <b>' + v2(r.refEn) + '</b> (' + h(r.refEnSirket) + ') · en kötü ' + v2(r.refKotu) + ' (' + h(r.refKotuSirket) + ')</div>';
      } else {
        html += '<div class="oy-k">Tek site: <b>' + v2(r.refEn) + '</b> (' + h(r.refEnSirket) + ')</div>';
      }
      const sinif = r.fark > 0 ? 'oy-iyi' : 'oy-kotu';
      html += '<div class="oy-k">Tutma ihtimali: <b>%' + Math.round(r.ihtimal) + '</b> · <span class="' + sinif + '">Bilyoner en iyi siteden %' +
        Math.abs(Math.round(r.fark)) + (r.fark > 0 ? ' fazla' : ' az') + '</span></div>';
    } else {
      html += '<div class="oy-k">Diğer sitelerde bu seçimin oranı yok</div>';
    }
    if (r.oyuncu) {
      let alt = 'Statshub: <b>' + h(r.oyuncu) + '</b> · ' + h(r.takimAd || (r.taraf === 'ev' ? 'ev' : 'dep')) + ' (' + (r.taraf === 'ev' ? 'ev' : 'dep') + ')';
      if (r.n) alt += ' · son ' + r.n + ' maç: <b>' + r.tut + '/' + r.n + '</b> · ort ' + v1(r.ort) + ' · ' + Math.round(r.dk) + ' dk';
      else alt += ' · son maçlarda süre almamış';
      html += '<div class="oy-k">' + alt + '</div>';
    } else {
      html += '<div class="oy-k">⚪ Statshub\'da yok · istatistik gösterilmiyor</div>';
    }
    (r.suphe || []).forEach(x => { html += '<div class="oy-k" style="color:#fbbf24">⚠️ ' + h(x) + '</div>'; });
    if (mod === 'kayit') return html + kayitAltHtml(r) + '</div>';
    const var_ = kayitliMi(r);
    html += '<div style="margin-top:4px"><button class="oy-kucuk-btn" data-kaydet="' + h(r.k) + '"' + (var_ ? ' disabled' : '') + '>' +
      (var_ ? '✔ Kaydedildi' : '💾 Kaydet') + '</button></div>';
    return html + '</div>';
  }

  function sekmeHtml(aktif) {
    const n = kayitAl().length;
    return '<div class="oy-sekme"><button data-sekme="analiz" class="' + (aktif === 'analiz' ? 'sec' : '') + '">🎯 Analiz</button>' +
      '<button data-sekme="kayit" class="' + (aktif === 'kayit' ? 'sec' : '') + '">📊 Kayıtlar (' + n + ')</button></div>';
  }
  const tarihYaz = ts => new Date(ts).toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit' });
  const saatYaz = ts => new Date(ts).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });

  function sonucYazisi(r) {
    const s = r.sonuc;
    if (!s) return '⏳ Sonuç bekleniyor';
    if (s.durum === 'iade' || s.durum === 'oynamadi') {
      if (s.elle) return '↩️ İade (elle işaretlendi)';
      if (s.neden === 'yedek') return '↩️ İade · ilk 11\'de başlamadı, oyuna sonradan girdi (' + s.dk + ' dk)';
      return '↩️ İade · oynamadı';
    }
    const ok = s.durum === 'tuttu' ? '✅ ' : '❌ ';
    if (s.elle) return ok + (s.durum === 'tuttu' ? 'Tuttu' : 'Tutmadı') + ' (elle işaretlendi)';
    let y = r.tip === 'kart' ? (s.deger > 0 ? 'Kart gördü' : 'Kart görmedi') : s.deger + ' ' + TIP[r.tip].birim;
    if (s.dk) y += ' · ' + s.dk + ' dk';
    if (s.ilk11 === true) y += ' · ilk 11';
    return ok + y;
  }
  function kayitAltHtml(r) {
    let html = '<div class="oy-k">' + h(r.macAd || '') + (r.macTs ? ' · ' + tarihYaz(r.macTs * 1000) : '') +
      ' · kaydedildi ' + tarihYaz(r.kayitZaman) + ' ' + saatYaz(r.kayitZaman) + (r.ayarYazi ? ' · ' + h(r.ayarYazi) : '') + '</div>';
    const s = r.sonuc;
    const renk = !s ? '#fde047' : s.durum === 'tuttu' ? '#4ade80' : s.durum === 'tutmadi' ? '#f87171' : '#cbd5e1';
    html += '<div style="margin-top:3px;font-weight:bold;color:' + renk + '">Sonuç: ' + sonucYazisi(r) + '</div>';
    html += '<div style="margin-top:4px">';
    if (!s) {
      if (!r.oyuncuId || !r.takimId) html += '<div class="oy-k">Oyuncu eşleşmediği için sonucu elle işaretle:</div>';
      html += '<button class="oy-kucuk-btn" data-elle="tuttu" data-id="' + h(r.id) + '">✅ Tuttu</button> ' +
        '<button class="oy-kucuk-btn" data-elle="tutmadi" data-id="' + h(r.id) + '">❌ Tutmadı</button> ' +
        '<button class="oy-kucuk-btn" data-elle="iade" data-id="' + h(r.id) + '">↩️ İade</button> ';
    } else if (!s.elle && s.ilk11 == null && (s.durum === 'tuttu' || s.durum === 'tutmadi')) {
      html += '<div class="oy-k">⚠️ İlk 11 bilgisi alınamadı. Oyuncu yedekten girdiyse bahis iade olur:</div>' +
        '<button class="oy-kucuk-btn" data-elle="iade" data-id="' + h(r.id) + '">↩️ İade olarak işaretle</button> ';
    }
    html += '<button class="oy-kucuk-btn" data-sil="' + h(r.id) + '">🗑️ Sil</button></div>';
    return html;
  }

  function ozet(liste) {
    const biten = liste.filter(r => r.sonuc && (r.sonuc.durum === 'tuttu' || r.sonuc.durum === 'tutmadi'));
    const tut = biten.filter(r => r.sonuc.durum === 'tuttu');
    const kar = biten.reduce((a, r) => a + (r.sonuc.durum === 'tuttu' ? r.bil - 1 : -1), 0);
    return { n: biten.length, tut: tut.length, oran: biten.length ? tut.length / biten.length * 100 : 0, kar, roi: biten.length ? kar / biten.length * 100 : 0 };
  }
  function ozetSatir(baslik, o) {
    if (!o.n) return '<div class="oy-k">' + baslik + ': henüz sonuçlanan yok</div>';
    const renk = o.kar >= 0 ? 'oy-iyi' : 'oy-kotu';
    return '<div>' + baslik + ': <b>' + o.tut + '/' + o.n + '</b> tuttu (%' + Math.round(o.oran) + ') · ' +
      '<span class="' + renk + '">' + (o.kar >= 0 ? '+' : '') + v2(o.kar) + ' birim (' + (o.roi >= 0 ? '+' : '') + Math.round(o.roi) + '%)</span></div>';
  }

  function raporHtml(k) {
    const bekleyen = k.filter(r => !r.sonuc).length;
    const iade = k.filter(r => r.sonuc && (r.sonuc.durum === 'iade' || r.sonuc.durum === 'oynamadi')).length;
    let html = '<div class="oy-grup">📈 Genel</div>';
    html += ozetSatir('Hepsi', ozet(k));
    html += '<div class="oy-k">' + k.length + ' kayıt · ' + bekleyen + ' bekliyor · ' + iade + ' iade · her seçime 1 birim basılmış gibi</div>';

    html += '<div class="oy-grup">Pazara göre</div>';
    Object.keys(TIP).forEach(tip => { if (k.some(r => r.tip === tip)) html += ozetSatir(TIP[tip].ad, ozet(k.filter(r => r.tip === tip))); });

    html += '<div class="oy-grup">Tahmin ettiğim ihtimal doğru mu?</div>';
    const kovalar = [[0, 50, '%50 altı'], [50, 60, '%50–60'], [60, 70, '%60–70'], [70, 101, '%70 ve üstü']];
    let yazildi = false;
    kovalar.forEach(([a, b, ad]) => {
      const g = k.filter(r => r.ihtimal >= a && r.ihtimal < b && r.sonuc && (r.sonuc.durum === 'tuttu' || r.sonuc.durum === 'tutmadi'));
      if (!g.length) return;
      yazildi = true;
      const dedi = g.reduce((x, r) => x + r.ihtimal, 0) / g.length;
      const gercek = g.filter(r => r.sonuc.durum === 'tuttu').length / g.length * 100;
      html += '<div>' + ad + ': dedim <b>%' + Math.round(dedi) + '</b> · gerçekte <b>%' + Math.round(gercek) + '</b> tuttu <span class="oy-k">(' + g.length + ' kayıt)</span></div>';
    });
    if (!yazildi) html += '<div class="oy-k">Sonuçlanan kayıt oldukça burası dolacak. Güvenilir olması için her aralıkta en az 20–30 kayıt gerekir.</div>';
    return html;
  }

  async function kayitlarGoster(kontrolEt) {
    let not = '';
    if (kontrolEt) {
      panelIcerik(sekmeHtml('kayit') + '<div class="oy-durum">⏳ Biten maçların sonuçları kontrol ediliyor…</div>');
      try { const n = await sonuclariKontrol(); if (n) not = '✅ ' + n + ' kaydın sonucu güncellendi'; }
      catch (e) { not = '⚠️ Sonuç kontrolü yapılamadı: ' + e.message; }
    }
    const k = kayitAl();
    let html = sekmeHtml('kayit');
    if (not) html += '<div class="oy-durum">' + h(not) + '</div>';
    if (!k.length) {
      html += '<div class="oy-k" style="padding:8px 0">Henüz kayıt yok. Analizde bir satırdaki 💾 Kaydet\'e basınca burada görünür.</div>';
    } else {
      html += raporHtml(k);
      const bekleyen = k.filter(r => !r.sonuc), biten = k.filter(r => r.sonuc);
      if (bekleyen.length) html += '<div class="oy-grup">⏳ Bekleyenler (' + bekleyen.length + ')</div>' + bekleyen.map(r => satirHtml(r, 'kayit')).join('');
      if (biten.length) html += '<div class="oy-grup">Sonuçlananlar (' + biten.length + ')</div>' + biten.map(r => satirHtml(r, 'kayit')).join('');
    }
    html += '<div class="oy-ayar" style="margin-top:14px"><button data-islem="kontrol">🔄 Sonuçları kontrol et</button>' +
      '<button data-islem="yedekAl">📋 Yedeği kopyala</button><button data-islem="yedekYukle">📥 Yedeği geri yükle</button></div>' +
      '<div class="oy-k">Script\'i silersen kayıtlar da silinir. Yeni sürüm kurarken eskisini silme, içini seçip yenisini yapıştır. Ara ara yedeği kopyalayıp bir yere not al.</div>';
    panelIcerik(html);
  }

  function sonucGoster(ev, dep) {
    const konumYazi = ayar.konum === 'evdep' ? 'ev sahibi evde, deplasman deplasmanda' : 'tüm maçlar';
    let html = sekmeHtml('analiz') + '<div class="oy-k">' + h(ev) + ' - ' + h(dep) + ' · son ' + ayar.macSayisi + ' maç · ' + konumYazi + '</div>' + ayarHtml();
    const bulunan = sonListe.filter(r => r.oyuncu).length;
    if (sonMacYazi) html += '<div class="oy-k" style="margin-top:6px">Statshub maçı: <b>' + h(sonMacYazi) + '</b></div>';
    const refli = sonListe.filter(r => r.refEn).length;
    html += '<div class="oy-k" style="margin-top:6px">' + sonListe.length + ' seçim · ' + bulunan + ' oyuncu eşleşti · ' + (sonListe.length - bulunan) + ' Statshub\'da yok · ' + refli + ' tanesinde diğer sitelerin oranı var</div>';

    const firsat = sonListe.filter(r => r.refEn && r.fark > 0 && !(r.suphe && r.suphe.length)).sort(sirala);
    html += '<div class="oy-grup" style="color:#fde047">⭐ En iyi fırsatlar <span class="oy-k" style="font-weight:normal">(Bilyoner en iyi siteyi geçiyor · tutma ihtimali yüksek olan üstte)</span></div>';
    html += firsat.length ? firsat.map(r => satirHtml(r, 'analiz')).join('') : '<div class="oy-k" style="padding:6px 0">Bu maçta Bilyoner\'in en iyi siteyi geçtiği seçim yok.</div>';

    Object.keys(TIP).forEach(tip => {
      const grup = sonListe.filter(r => r.tip === tip).sort(sirala);
      if (!grup.length) return;
      const adlar = [...new Set(grup.map(r => r.pazar).filter(Boolean))];
      html += '<div class="oy-grup">' + TIP[tip].ad + (adlar.length ? '<div class="oy-k" style="font-weight:normal">Bilyoner: ' + h(adlar.join(' · ')) + '</div>' : '') + '</div>';
      html += grup.map(r => satirHtml(r, 'analiz')).join('');
    });
    html += '<div class="oy-k" style="margin-top:10px">🟢 Bilyoner, en iyi oranı veren siteden de yüksek ödüyor · 🔴 düşük · ⚪ karşılaştıracak oran yok · ⚠️ şüpheli (fırsatlara alınmaz). ' +
      'Tutma ihtimali en iyi siteye göre hesaplanır (1 ÷ oran). Oyuncu sekmesini açarsan butonların üstünde de görünür.</div>';
    panelIcerik(html);
  }

  // ---------- Başlat ----------
  function butonKoy() {
    const sayfa = !/basketbol/.test(location.pathname);
    let b = document.getElementById('oy-btn');
    if (!sayfa) { if (b) b.style.display = 'none'; return; }
    if (!b) {
      b = document.createElement('button');
      b.id = 'oy-btn';
      b.textContent = '🎯';
      b.addEventListener('click', () => {
        const p = panel();
        if (p.style.display === 'block') { p.style.display = 'none'; return; }
        if (sonListe.length) { p.style.display = 'block'; return; }
        if (!macSayfasi()) { kayitlarGoster(true); return; }
        analizSekmesi();
      });
      document.body.appendChild(b);
    }
    b.style.display = 'block';
  }

  css();
  let sonYol = location.pathname;
  setInterval(() => {
    if (location.pathname !== sonYol) {
      sonYol = location.pathname;
      sonuclar = {}; sonListe = [];
      const p = document.getElementById('oy-panel');
      if (p) p.style.display = 'none';
    }
    butonKoy();
    isaretleTumu();
  }, 1500);
  butonKoy();
})();
