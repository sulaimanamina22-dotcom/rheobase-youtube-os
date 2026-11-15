// ENV: environments and backgrounds for Rheobase (illustrated 3D look: layered planes, atmospheric
// perspective, cel-lit volumes finished with ink). Self-contained: plain 2D canvas, deterministic in t,
// draws in 1920x1080 frame units in whatever transform is current. Uses window.ENG only if present
// (for the gouache mottle texture); everything else is local.
//
// HOW TO CALL (all functions: ctx, t, options; every option has a default)
//   Common options:
//     cam   : {x, y} camera offset in frame px. Each plane moves by cam * its parallax factor.
//     light : {x, y, key, rim, amb}  shared convention, default { x:-0.55, y:-0.83, key:'#fff4e0', rim:'#7fd8ff', amb:0.35 }
//     part  : 'back' | 'front' | 'all'. Draw 'back', then your subject, then 'front' (near planes pass in front).
//
//   ENV_cloud(ctx, x, y, w, o)          one cumulus cluster. (x, y) = centre of its base, w = width in px.
//        o: { seed, boil, pal:{lit,mid,shade,rim,ink,haze}, depth 0 near..1 far, kind:'cumulus'|'tower'|'bank',
//             flip (hangs down, for storm ceilings), base:'flat'|'round', lw (ink px), flash:{x,y,r,k,color} }
//   ENV_cloudField(ctx, t, o)           a parallax plane of drifting clouds (used by everything below).
//   ENV_jupiterSky(ctx, t, o)           the fall: sky, sun, perspective cloud deck, haze, two cloud planes.
//   ENV_jupiterSkyFront(ctx, t, o)      the fall: near clouds and speed streaks, call after the subject.
//        o: { pal: 'dawn'|'amber'|'violet'|'teal'|object, palB, palK (blend to palB), horizon (y), fall (speed mult) }
//   ENV_space(ctx, t, o)                deep gradient, posterised nebula with dust, 3 star layers, bloom.
//        o: { seed, pal:{deep,mid,nebA,nebB,nebC,dust}, nebula 0..1, cam }
//   ENV_descent(ctx, t, i, o)           the seven layers, i = 0..6 (ammonia ice, tan NH4SH, water storm,
//        amber haze, liquid hydrogen, metallic hydrogen, fuzzy core). o: { cam, fall, part }
//   ENV_storm(ctx, t, o)                night storm: hanging ceiling, thunderheads, rain sheets, lightning that
//        lights the cloud undersides and the rain. o: { seed, period (s between flash slots), ground (bool), part, cam, strikes [times], F {k, idx} (drive the flash yourself), bx (where it lights), noBolt (draw your own), ceiling (y) }
//   ENV_bolt(ctx, x0, y0, x1, y1, seed, k)   one branching bolt with bloom, k = intensity 0..1.
//   ENV_flash(t, seed, period)          -> {k, idx}  deterministic flicker schedule used by the storm.
//   ENV_PAL                              palette presets. ENV_mixPal(a, b, k) blends two palette objects.
//
// Budget (measured, see REPORT.md): every scene well under 120 ms at 1920x1080 in headless Chrome on the UHD 620.
(function () {
  const W = 1920, H = 1080, TAU = Math.PI * 2;
  const INK = '#120d1c';
  const LIGHT = { x: -0.55, y: -0.83, key: '#fff4e0', rim: '#7fd8ff', amb: 0.35 };

  // ------------------------------------------------------------------ math
  function hash(a, b = 0, c = 0) {
    let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(c | 0, 1440662683)) | 0; // full avalanche (murmur3 fmix32), no streaks between neighbouring seeds
    h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }
  function vnoise(x, y, seed = 0) {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = hash(xi, yi, seed), b = hash(xi + 1, yi, seed), c = hash(xi, yi + 1, seed), d = hash(xi + 1, yi + 1, seed);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  function fbm(x, y, seed = 0, oct = 4) { let s = 0, a = 0.5, f = 1; for (let i = 0; i < oct; i++) { s += a * vnoise(x * f, y * f, seed + i * 17); f *= 2; a *= 0.5; } return s / (1 - Math.pow(0.5, oct)); }
  const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
  const lerp = (a, b, k) => a + (b - a) * k;
  const smooth = (a, b, x) => { const k = clamp((x - a) / (b - a)); return k * k * (3 - 2 * k); };
  const wrap = (v, s) => ((v % s) + s) % s;
  const boilOf = (t) => Math.floor(t * 15 + 1e-6);
  const camOf = (o) => (o && o.cam) || { x: 0, y: 0 };
  const lightOf = (l) => Object.assign({}, LIGHT, l || {});
  const want = (o, p) => { const q = (o && o.part) || 'all'; return q === 'all' || q === p; };

  // ------------------------------------------------------------------ color
  const HC = {};
  function rgb(c) {
    if (HC[c]) return HC[c];
    let v; if (c[0] === '#') v = [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
    else v = c.match(/[\d.]+/g).slice(0, 3).map(Number);
    return (HC[c] = v);
  }
  function mix(a, b, k) { const A = rgb(a), B = rgb(b); k = clamp(k); return '#' + [0, 1, 2].map((i) => Math.round(lerp(A[i], B[i], k)).toString(16).padStart(2, '0')).join(''); }
  function rgba(c, a) { const A = rgb(c); return `rgba(${A[0]},${A[1]},${A[2]},${clamp(a)})`; }
  function mixPal(a, b, k) {
    if (!b || k <= 0) return a; if (k >= 1) return b;
    const o = {};
    for (const key in a) o[key] = (typeof a[key] === 'string' && a[key][0] === '#' && typeof b[key] === 'string') ? mix(a[key], b[key], k) : (typeof a[key] === 'object' ? mixPal(a[key], b[key], k) : a[key]);
    return o;
  }
  function radial(ctx, x, y, r, c, a, comp = 'lighter') { // soft bloom
    if (r <= 0 || a <= 0) return;
    ctx.save(); ctx.globalCompositeOperation = comp;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, rgba(c, a)); g.addColorStop(0.3, rgba(c, a * 0.45)); g.addColorStop(0.65, rgba(c, a * 0.12)); g.addColorStop(1, rgba(c, 0));
    ctx.fillStyle = g; ctx.fillRect(x - r, y - r, 2 * r, 2 * r); ctx.restore();
  }
  function vgrad(ctx, y0, y1, stops) { const g = ctx.createLinearGradient(0, y0, 0, y1); stops.forEach(([k, c]) => g.addColorStop(k, c)); return g; }
  function mk(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d', { willReadFrequently: true }); return c; } // CPU-backed: blits onto the (software) render canvas stay cheap

  // ------------------------------------------------------------------ palettes
  const CLOUD = (lit, mid, shade, rim, haze, ink = INK) => ({ lit, mid, shade, rim, haze, ink });
  const ENV_PAL = {
    // fall skies (tuned to the v3 colour beats: peach, orange, lavender, teal) but with dark rich tops
    dawn: { skyTop: '#2b1650', skyMid: '#a3406e', skyHor: '#ffb27a', sun: '#fff0c8', haze: '#f49a86', deckZone: '#ffe3c2', deckBelt: '#d9784a', deckShade: '#7a3a6a',
      cloud: CLOUD('#fff4e4', '#f9c39c', '#9a5486', '#9fd8ff', '#f49a86', '#1d1030'), streak: '#fff1e0' },
    amber: { skyTop: '#3a0d10', skyMid: '#b8401c', skyHor: '#ffbe5a', sun: '#fff2c0', haze: '#f0864a', deckZone: '#ffdba4', deckBelt: '#b04a22', deckShade: '#6a1e1c',
      cloud: CLOUD('#fff2d6', '#f7b26e', '#8a3028', '#8fd0ff', '#f0864a', '#1f0c10'), streak: '#ffe8c8' },
    violet: { skyTop: '#120d3a', skyMid: '#4e3a9c', skyHor: '#e2b4f0', sun: '#fff4ff', haze: '#a58ad8', deckZone: '#f3e8ff', deckBelt: '#8a6ac8', deckShade: '#33246e',
      cloud: CLOUD('#fdf9ff', '#d6c4f6', '#4a3790', '#7fe0ff', '#a58ad8', '#140c30'), streak: '#f4ecff' },
    teal: { skyTop: '#031c26', skyMid: '#0c5a62', skyHor: '#a4f2d4', sun: '#f6fff0', haze: '#3aa59a', deckZone: '#e2faee', deckBelt: '#2f8c84', deckShade: '#0e3a48',
      cloud: CLOUD('#f4fff8', '#a8e6d4', '#1b5066', '#ffe6a0', '#3aa59a', '#06161e'), streak: '#eafff6' },
    space: { deep: '#03020a', mid: '#130c30', nebA: '#9a2f8c', nebB: '#1f73a8', nebC: '#ffb08a', dust: '#020108' },
    storm: { top: '#070a26', bot: '#1f2a6a', cloud: CLOUD('#5562ac', '#363f88', '#1a1f52', '#6fc8ff', '#1c2462', '#05051a'), rain: '#aab8ff', flash: '#cfe6ff' },
  };

  // ------------------------------------------------------------------ cloud geometry (unit width 1000, base at y = 0, up is -y)
  const SHAPES = new Map();
  function cloudShape(seed, kind) {
    const key = seed + '|' + kind; if (SHAPES.has(key)) return SHAPES.get(key);
    const h = (k) => hash(seed, k, 911), P = [];
    const tall = kind === 'tower' ? 1.75 : kind === 'bank' ? 0.6 : 1, sx = kind === 'tower' ? 0.72 : kind === 'bank' ? 1.25 : 1;
    const nb = 5 + Math.floor(h(1) * 3);
    for (let i = 0; i < nb; i++) { const u = (i + 0.5) / nb, r = 78 + 45 * h(10 + i) + 45 * Math.sin(u * Math.PI); P.push({ x: ((u - 0.5) * 800 + (h(20 + i) - 0.5) * 50) * (kind === 'bank' ? 1.05 : 1), y: -r * 0.5, r, row: 0 }); }
    const nm = 3 + Math.floor(h(2) * 2);
    for (let i = 0; i < nm; i++) { const u = (i + 0.5) / nm, r = 112 + 55 * h(30 + i) + 35 * Math.sin(u * Math.PI); P.push({ x: ((u - 0.5) * 560 + (h(40 + i) - 0.5) * 70) * sx, y: -(170 + 60 * Math.sin(u * Math.PI) + 30 * h(50 + i)) * tall, r, row: 1 }); }
    const nt = kind === 'bank' ? 1 : 1 + Math.floor(h(3) * 2);
    for (let i = 0; i < nt; i++) { const r = 130 + 55 * h(60 + i); P.push({ x: ((h(70 + i) - 0.5) * 220 + (i - (nt - 1) / 2) * 190) * sx, y: -(330 + 40 * h(80 + i)) * tall, r, row: 2 }); }
    if (kind === 'tower') { P.push({ x: (h(90) - 0.5) * 120, y: -560 * 1.2, r: 120 + 40 * h(91), row: 3 }); P.push({ x: (h(92) - 0.5) * 260, y: -470 * 1.2, r: 105 + 30 * h(93), row: 3 }); }
    const order = P.map((p, i) => i).sort((a, b) => (P[b].row - P[a].row) || (hash(a, seed, 5) - hash(b, seed, 5)));
    const top = Math.min(...P.map((p) => p.y - p.r));
    const s = { puffs: P, order, top, baseY: 18 };
    SHAPES.set(key, s); return s;
  }
  // interior ink: arcs of a row's lobes that lie over the rows behind it (and are not covered by rows in front)
  function contourArcs(shape) {
    if (shape.contours) return shape.contours;
    const P = shape.puffs, out = {};
    P.forEach((p, i) => {
      let run = null; const res = [];
      for (let s = 0; s <= 24; s++) {
        const a = -Math.PI * 0.97 + s * (Math.PI * 0.94 / 24), x = p.x + Math.cos(a) * p.r, y = p.y + Math.sin(a) * p.r;
        const over = P.some((q) => q.row > p.row && Math.hypot(x - q.x, y - q.y) < q.r - 4);
        const hidden = P.some((q, j) => j !== i && q.row <= p.row && Math.hypot(x - q.x, y - q.y) < q.r - 2);
        if (over && !hidden) { if (!run) run = [i, a, a]; else run[2] = a; } else if (run) { res.push(run); run = null; }
      }
      if (run) res.push(run);
      for (const r of res) { const pad = 0.06; if (r[2] - r[1] > 0.25) { (out[p.row] = out[p.row] || []).push([r[0], r[1] + pad, r[2] - pad]); } }
    });
    return (shape.contours = out);
  }
  // silhouette arcs facing the rim side (computed per shape and light, cached)
  const RIMS = new Map();
  function rimArcs(shape, key, lx, ly) {
    const k = key + '|' + lx.toFixed(2) + ly.toFixed(2); if (RIMS.has(k)) return RIMS.get(k);
    const P = shape.puffs, out = [], ra = Math.atan2(-ly, -lx);
    P.forEach((p, i) => {
      let run = null;
      for (let s = -14; s <= 14; s++) {
        const a = ra + s * 0.09, x = p.x + Math.cos(a) * (p.r + 4), y = p.y + Math.sin(a) * (p.r + 4);
        const free = y < shape.baseY - 6 && P.every((q, j) => j === i || Math.hypot(x - q.x, y - q.y) > q.r);
        if (free) { if (!run) run = [i, a, a]; else run[2] = a; } else if (run) { out.push(run); run = null; }
      }
      if (run) out.push(run);
    });
    RIMS.set(k, out); return out;
  }

  // ------------------------------------------------------------------ ENV_cloud
  // Sprite cache: a cloud is drawn once per (look, size, boil parity) into an offscreen canvas, then blitted.
  // Two boil drawings alternate on the stop-motion clock. Flash light is applied on top of the blit.
  const SPR = new Map(), SPR_MAX = 90; let SCR = null;
  function palKey(pal) { return pal ? [pal.lit, pal.mid, pal.shade, pal.rim, pal.ink, pal.haze].join('') : ''; }
  function ENV_cloud(ctx, x, y, w, o = {}) {
    if (w < 4) return;
    if (o.cache === false) return drawCloud(ctx, x, y, w, o);
    const M = ctx.getTransform(), sc = Math.max(0.05, Math.hypot(M.a, M.b) || 1), L = lightOf(o.light);
    const pal = o.pal || ENV_PAL.dawn.cloud, flip = o.flip ? -1 : 1, kind = o.kind || 'cumulus', seed = o.seed ?? 1;
    const key = [seed, kind, flip, o.base || 'flat', (o.depth ?? 0).toFixed(2), Math.round(w * sc), (o.boil ?? 0) & 1, palKey(pal), o.haze || '', L.x, L.y, L.key, L.rim, L.amb, o.lw ?? 5, o.rimW ?? 7, o.rimA ?? 0.75, o.fade ?? 0.8, o.texture === false ? 0 : 1].join('|');
    let spr = SPR.get(key);
    if (spr) { SPR.delete(key); SPR.set(key, spr); }
    else {
      const shape = cloudShape(seed, kind), s1 = w / 1000, P = shape.puffs;
      const pad = ((o.lw ?? 5) + 12);
      const minX = Math.min(...P.map((p) => p.x - p.r)) * s1 - pad, maxX = Math.max(...P.map((p) => p.x + p.r)) * s1 + pad;
      const bot = o.base === 'round' ? Math.max(...P.map((p) => p.y + p.r)) : shape.baseY;
      const yA = shape.top * s1 * flip, yB = bot * s1 * flip, minY = Math.min(yA, yB) - pad, maxY = Math.max(yA, yB) + pad;
      const c = mk(Math.ceil((maxX - minX) * sc), Math.ceil((maxY - minY) * sc)), g = c.getContext('2d');
      g.setTransform(sc, 0, 0, sc, 0, 0);
      drawCloud(g, -minX, -minY, w, Object.assign({}, o, { flash: null, alpha: 1, boil: (o.boil ?? 0) & 1 }));
      spr = { c, ax: -minX, ay: -minY, sc };
      SPR.set(key, spr); if (SPR.size > SPR_MAX) SPR.delete(SPR.keys().next().value);
    }
    let img = spr.c;
    const F = o.flash;
    if (F && F.k > 0) { // light the sprite's own pixels only (source-atop), then blit
      if (!SCR) SCR = mk(16, 16);
      if (SCR.width < img.width || SCR.height < img.height) { SCR.width = Math.max(SCR.width, img.width); SCR.height = Math.max(SCR.height, img.height); }
      const g = SCR.getContext('2d'); g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = 'copy'; g.drawImage(img, 0, 0);
      g.globalCompositeOperation = 'source-atop';
      const fx = (F.x - x + spr.ax) * spr.sc, fy = (F.y - y + spr.ay) * spr.sc, fr = (F.r || 700) * spr.sc, col = F.color || '#d8ecff';
      const gf = g.createRadialGradient(fx, fy, 0, fx, fy, fr); gf.addColorStop(0, rgba(col, 0.6 * F.k)); gf.addColorStop(0.4, rgba(col, 0.25 * F.k)); gf.addColorStop(1, rgba(col, 0));
      g.fillStyle = gf; g.fillRect(0, 0, img.width, img.height); g.globalCompositeOperation = 'source-over';
      ctx.save(); ctx.globalAlpha *= (o.alpha ?? 1);
      ctx.drawImage(SCR, 0, 0, img.width, img.height, x - spr.ax, y - spr.ay, img.width / spr.sc, img.height / spr.sc);
      ctx.restore(); return;
    }
    ctx.save(); ctx.globalAlpha *= (o.alpha ?? 1);
    ctx.drawImage(img, x - spr.ax, y - spr.ay, img.width / spr.sc, img.height / spr.sc);
    ctx.restore();
  }
  function drawCloud(ctx, x, y, w, o = {}) {
    const seed = o.seed ?? 1, boil = o.boil ?? 0, kind = o.kind || 'cumulus', L = lightOf(o.light);
    const pal = o.pal || ENV_PAL.dawn.cloud, depth = clamp(o.depth ?? 0), haze = o.haze || pal.haze;
    const fk = depth * (o.fade ?? 0.8), C = (c) => mix(c, haze, fk);
    const lit = C(pal.lit), mid = C(pal.mid), shade = C(pal.shade), rim = C(pal.rim || L.rim);
    const litHi = mix(lit, L.key, 0.55), shadeDeep = mix(shade, pal.ink || INK, 0.35);
    const ink = pal.ink || INK, inkA = clamp(1 - depth * 0.9), flip = o.flip ? -1 : 1;
    const shape = cloudShape(seed, kind), s = w / 1000;
    const lw = (o.lw ?? 5) * (1 - 0.45 * depth) / s, a0 = ctx.globalAlpha * (o.alpha ?? 1);
    const P = shape.puffs.map((p, i) => ({ x: p.x + (hash(i, boil, seed) - 0.5) * 6, y: p.y + (hash(i + 40, boil, seed) - 0.5) * 6, r: p.r * (1 + (hash(i + 80, boil, seed) - 0.5) * 0.012), row: p.row }));
    const flat = o.base !== 'round', bY = shape.baseY;
    const lx = L.x, ly = L.y * flip;
    const union = (g) => { ctx.beginPath(); for (const p of P) { ctx.moveTo(p.x + p.r + g, p.y); ctx.arc(p.x, p.y, Math.max(1, p.r + g), 0, TAU); } };
    ctx.save(); ctx.globalAlpha = a0;
    ctx.translate(x, y); ctx.scale(s, s * flip);
    if (flat) { ctx.beginPath(); ctx.rect(-3000, -4000, 6000, 4000 + bY + lw); ctx.clip(); }
    // 1. ink silhouette (fades with depth)
    if (inkA > 0.03) { ctx.fillStyle = ink; ctx.globalAlpha = a0 * inkA; union(lw); ctx.fill(); ctx.globalAlpha = a0; }
    ctx.save();
    if (flat) { ctx.beginPath(); ctx.rect(-3000, -4000, 6000, 4000 + bY); ctx.clip(); }
    ctx.fillStyle = shade; union(0); ctx.fill();
    // 2. lobes row by row, back (top) to front (base). Each row is ONE merged mass: shade, then a mid step and a
    //    lit step made of the same circles pushed toward the key (hard scalloped terminators), a soft highlight
    //    inside the lit step, then a broken ink contour where this row's lobes sit in front of the rows behind.
    const amb = clamp(L.amb ?? 0.35), mOff = 0.1 + 0.1 * amb, lOff = 0.4 + 0.06 * amb;
    const rowsU = [...new Set(P.map((p) => p.row))].sort((a, b) => b - a);
    const circ = (list, off, k) => { ctx.beginPath(); for (const p of list) { const cx = p.x + lx * p.r * off, cy = p.y + ly * p.r * off; ctx.moveTo(cx + p.r * k, cy); ctx.arc(cx, cy, p.r * k, 0, TAU); } };
    const contours = contourArcs(shape, P);
    for (const row of rowsU) {
      const R = P.filter((p) => p.row === row);
      ctx.save(); circ(R, 0, 1); ctx.fillStyle = shade; ctx.fill(); ctx.clip();
      circ(R, mOff, 0.93); ctx.fillStyle = mid; ctx.fill();
      circ(R, lOff, 0.68); ctx.fillStyle = lit; ctx.fill();
      for (const p of R) { const cx = p.x + lx * p.r * 0.6, cy = p.y + ly * p.r * 0.6, r2 = p.r * 0.45;
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r2); g.addColorStop(0, rgba(litHi, 0.4)); g.addColorStop(1, rgba(litHi, 0)); ctx.fillStyle = g; ctx.fillRect(cx - r2, cy - r2, 2 * r2, 2 * r2); }
      ctx.restore();
      if (inkA > 0.03 && contours[row]) { ctx.strokeStyle = ink; ctx.lineCap = 'round'; ctx.globalAlpha = a0 * inkA * 0.8; ctx.lineWidth = lw * 0.5; ctx.beginPath();
        for (const [i, aA, aB] of contours[row]) { const p = P[i]; ctx.moveTo(p.x + Math.cos(aA) * p.r, p.y + Math.sin(aA) * p.r); ctx.arc(p.x, p.y, p.r, aA, aB); }
        ctx.stroke(); ctx.globalAlpha = a0; }
    }
    // 3. inside the silhouette: ambient occlusion toward the base, warm soft core, texture, flash light
    union(0); ctx.clip();
    ctx.fillStyle = vgrad(ctx, shape.top, bY, [[0, rgba(shadeDeep, 0)], [0.72, rgba(shadeDeep, 0)], [1, rgba(shadeDeep, 0.3)]]);
    ctx.fillRect(-3000, shape.top - 50, 6000, -shape.top + bY + 100);
    const kx = lx * 260, ky = shape.top * 0.55 + ly * 120;
    const gc = ctx.createRadialGradient(kx, ky, 0, kx, ky, 620);
    gc.addColorStop(0, rgba(L.key, 0.22 * (1 - depth * 0.6))); gc.addColorStop(1, rgba(L.key, 0));
    ctx.fillStyle = gc; ctx.fillRect(-3000, -4000, 6000, 8000);
    const E = window.ENG;
    if (E && E.TEX && E.TEX.mottle && o.texture !== false) {
      ctx.globalCompositeOperation = 'multiply'; ctx.globalAlpha = a0 * 0.07 * (1 - depth * 0.6);
      const pat = ctx.createPattern(E.TEX.mottle, 'repeat'); pat.setTransform(new DOMMatrix().translateSelf(hash(seed, 3) * 400, hash(seed, 4) * 400).scaleSelf(2.2, 2.2));
      ctx.fillStyle = pat; ctx.fillRect(-1000, -1500, 2000, 1700); ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = a0;
    }
    const F = o.flash;
    if (F && F.k > 0) {
      const fx = (F.x - x) / s, fy = (F.y - y) / (s * flip), fr = (F.r || 700) / s;
      const gf = ctx.createRadialGradient(fx, fy, 0, fx, fy, fr);
      gf.addColorStop(0, rgba(F.color || '#d8ecff', 0.6 * F.k)); gf.addColorStop(0.4, rgba(F.color || '#d8ecff', 0.25 * F.k)); gf.addColorStop(1, rgba(F.color || '#d8ecff', 0));
      ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = gf; ctx.fillRect(fx - fr, fy - fr, 2 * fr, 2 * fr); ctx.globalCompositeOperation = 'source-over';
    }
    ctx.restore();
    // 4. cool rim light on the silhouette facing away from the key
    const rims = rimArcs(shape, seed + kind + flip, lx, ly), rw = (o.rimW ?? 7) * (1 - 0.5 * depth) / s;
    ctx.strokeStyle = rim; ctx.lineCap = 'round'; ctx.lineWidth = rw; ctx.globalAlpha = a0 * (o.rimA ?? 0.75);
    ctx.beginPath(); for (const [i, aA, aB] of rims) { const p = P[i]; ctx.moveTo(p.x + Math.cos(aA) * (p.r - rw * 0.6), p.y + Math.sin(aA) * (p.r - rw * 0.6)); ctx.arc(p.x, p.y, p.r - rw * 0.6, aA, aB); }
    ctx.stroke();
    ctx.restore();
  }

  // ------------------------------------------------------------------ ENV_cloudField: one parallax plane of clouds
  // o: { seed, n, w:[min,max], depth, speed (px/s upward), p (parallax), cam, pal, light, kinds, boil, flash(fn or obj), xs, drift (px/s sideways), lw }
  function ENV_cloudField(ctx, t, o = {}) {
    const cam = camOf(o), n = o.n ?? 5, [w0, w1] = o.w || [300, 600], seed = o.seed ?? 7, p = o.p ?? 0.5;
    const span = H + w1 * 0.9 + 200, boil = o.boil ?? boilOf(t), kinds = o.kinds || ['cumulus', 'cumulus', 'tower'];
    const items = [];
    for (let i = 0; i < n; i++) {
      const w = lerp(w0, w1, hash(i, seed, 3)), xs = o.xs ? o.xs[i % o.xs.length] : (i + 0.5) / n * (W + 300) - 150 + (hash(i, seed, 1) - 0.5) * (W / n) * 0.8;
      const x = wrap(xs - cam.x * p + (o.drift || 0) * t + 400, W + 800) - 400;
      const y = o.ys ? o.ys[i % o.ys.length] - cam.y * p : wrap(hash(i, seed, 2) * span - (o.speed || 0) * t - cam.y * p, span) - 100;
      if (!o.ys && (y - w * 0.75 > H + 20 || y < -40)) continue;
      items.push({ x, y, w, i });
    }
    if (!o.ys) items.sort((a, b) => a.y - b.y); // lower = nearer within a plane
    for (const it of items) {
      const fl = typeof o.flash === 'function' ? o.flash(it.x, it.y, it.w) : o.flash;
      ENV_cloud(ctx, it.x, it.y, it.w, { seed: seed * 31 + it.i, boil, pal: o.pal, depth: o.depth ?? 0, kind: kinds[it.i % kinds.length], light: o.light, flash: fl, lw: o.lw, flip: o.flip, base: o.base, alpha: o.alpha });
    }
  }

  // ------------------------------------------------------------------ the fall: Jupiter cloud-deck sky
  function resolvePal(o) {
    let a = o.pal || 'dawn'; if (typeof a === 'string') a = ENV_PAL[a];
    let b = o.palB; if (typeof b === 'string') b = ENV_PAL[b];
    return b ? mixPal(a, b, o.palK ?? 0) : a;
  }
  // one perspective row of the cloud deck: scalloped lit tops over a shaded body
  function deckRow(ctx, y, size, idx, pal, depth, xoff, L, boil) {
    const fk = depth * 0.85, belt = hash(Math.floor(idx / 3), 77) < 0.33;
    const top = mix(mix(belt ? pal.deckBelt : pal.deckZone, pal.sun, 0.12), pal.haze, fk), body = mix(belt ? mix(pal.deckBelt, pal.deckShade, 0.45) : mix(pal.deckZone, pal.deckShade, 0.5), pal.haze, fk);
    const deep = mix(pal.deckShade, pal.haze, fk * 0.9), ink = pal.cloud.ink, sp = size * 0.95, n = Math.ceil(W / sp) + 3;
    const C = [];
    for (let k = -1; k < n; k++) { const j = k + Math.floor(xoff / sp); const r = size * (0.48 + 0.3 * hash(j, idx, 5)); C.push([j * sp - xoff + (hash(j, idx, 6) - 0.5) * sp * 0.3, y - r * 0.35 + (hash(j, idx, 7) - 0.5) * size * 0.25 + (hash(j, boil, idx) - 0.5) * 1.2, r]); }
    const yb = y + size * 2.2;
    const shapeP = (g) => { ctx.beginPath(); for (const [cx, cy, r] of C) { ctx.moveTo(cx + r + g, cy); ctx.arc(cx, cy, r + g, 0, TAU); } ctx.rect(-50, y, W + 100, yb - y + g); };
    const lw = Math.max(0.8, size * 0.035) * (1 - depth * 0.5), inkA = clamp(1 - depth * 0.95);
    if (inkA > 0.03) { ctx.globalAlpha = inkA; ctx.fillStyle = ink; shapeP(lw); ctx.fill(); ctx.globalAlpha = 1; }
    ctx.fillStyle = vgrad(ctx, y - size * 0.6, yb, [[0, body], [0.5, deep], [1, deep]]); shapeP(0); ctx.fill();
    ctx.save(); shapeP(0); ctx.clip();
    ctx.fillStyle = top; ctx.beginPath(); for (const [cx, cy, r] of C) { const ox = cx + L.x * r * 0.36, oy = cy + L.y * r * 0.36; ctx.moveTo(ox + r * 0.76, oy); ctx.arc(ox, oy, r * 0.76, 0, TAU); } ctx.fill();
    if (size > 220) { ctx.fillStyle = mix(top, pal.sun, 0.5); ctx.beginPath(); } else ctx.beginPath(); for (const [cx, cy, r] of C) { const ox = cx + L.x * r * 0.5, oy = cy + L.y * r * 0.5; ctx.moveTo(ox + r * 0.42, oy); ctx.arc(ox, oy, r * 0.42, 0, TAU); } if (size > 220) ctx.fill();
    if (inkA > 0.25) { ctx.strokeStyle = ink; ctx.globalAlpha = inkA * 0.55; ctx.lineWidth = lw * 0.5; ctx.beginPath(); for (const [cx, cy, r] of C) { ctx.moveTo(cx + r * Math.cos(0.2), cy + r * Math.sin(0.2)); ctx.arc(cx, cy, r, 0.2, Math.PI - 0.2); } ctx.stroke(); ctx.globalAlpha = 1; }
    ctx.restore();
  }
  function ENV_jupiterSky(ctx, t, o = {}) {
    const pal = resolvePal(o), cam = camOf(o), L = lightOf(o.light), boil = boilOf(t), fall = o.fall ?? 1;
    const hz = (o.horizon ?? 720) - cam.y * 0.04;
    // sky: dark rich top to a hot horizon
    ctx.fillStyle = vgrad(ctx, -cam.y * 0.02, hz + 40, [[0, pal.skyTop], [0.55, pal.skyMid], [1, pal.skyHor]]); ctx.fillRect(-W, -H, 3 * W, 3 * H);
    // sun (key light) upper left, bloom in two sizes
    const sx = W * 0.5 + L.x * W * 0.62 - cam.x * 0.02, sy = H * 0.5 + L.y * H * 0.62 - cam.y * 0.02;
    radial(ctx, sx, sy, 1500, pal.sun, 0.45); radial(ctx, sx, sy, 420, pal.sun, 0.6);
    // light shafts from the sun, very faint
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = rgba(pal.sun, 0.05); ctx.beginPath();
    for (let i = 0; i < 5; i++) { const a = 0.45 + i * 0.13 + 0.02 * Math.sin(t * 0.4 + i), len = 2600, wd = 0.025 + 0.02 * hash(i, 9);
      ctx.moveTo(sx, sy); ctx.lineTo(sx + Math.cos(a - wd) * len, sy + Math.sin(a - wd) * len); ctx.lineTo(sx + Math.cos(a + wd) * len, sy + Math.sin(a + wd) * len); ctx.closePath(); }
    ctx.fill();
    ctx.restore();
    // far floating clouds just above the horizon (most faded)
    ENV_cloudField(ctx, t, { seed: 11, n: 7, w: [160, 300], depth: 0.82, speed: 14 * fall, p: 0.08, cam, pal: pal.cloud, light: o.light, kinds: ['bank', 'cumulus'], boil, lw: 4, xs: [80, 400, 700, 1000, 1320, 1600, 1880] });
    // the cloud deck in perspective, rows approaching as we fall
    const N = 8, ph = t * 0.32 * fall + 20, fph = ph - Math.floor(ph);
    for (let k = 0; k < N; k++) {
      const u = (k + fph) / N, e = Math.pow(u, 2.3), y = hz + (H * 1.35 - hz) * e, size = 24 + 420 * e;
      if (y - size > H) continue;
      deckRow(ctx, y, size, k - Math.floor(ph), pal, clamp(1 - u * 1.25), hash(k - Math.floor(ph), 3) * 4000 + cam.x * (0.05 + e * 0.9), L, boil);
    }
    // horizon haze band (atmospheric perspective)
    ctx.fillStyle = vgrad(ctx, hz - 160, hz + 230, [[0, rgba(pal.haze, 0)], [0.45, rgba(pal.haze, 0.75)], [0.62, rgba(pal.skyHor, 0.55)], [1, rgba(pal.haze, 0)]]);
    ctx.fillRect(-W, hz - 160, 3 * W, 390);
    // mid plane of floating cumulus, then a thin haze veil
    ENV_cloudField(ctx, t, { seed: 23, n: 5, w: [380, 620], depth: 0.5, speed: 260 * fall, p: 0.3, cam, pal: pal.cloud, light: o.light, boil, lw: 5 });
    ctx.fillStyle = rgba(pal.haze, 0.12); ctx.fillRect(-W, -H, 3 * W, 3 * H);
    ENV_cloudField(ctx, t, { seed: 37, n: 4, w: [520, 820], depth: 0.22, speed: 620 * fall, p: 0.6, cam, pal: pal.cloud, light: o.light, boil, lw: 6, xs: [180, 1700, 520, 1450] });
  }
  function streaks(ctx, t, seed, n, speed, col, a, len, lw, cam, p) {
    ctx.save(); ctx.lineCap = 'round';
    for (let i = 0; i < n; i++) {
      const L = lerp(len[0], len[1], hash(i, seed, 2)), span = H + L * 2;
      const x = wrap(hash(i, seed, 1) * W - cam.x * p, W), y = wrap(hash(i, seed, 3) * span - speed * t * (0.7 + 0.6 * hash(i, seed, 4)) - cam.y * p, span) - L;
      const g = ctx.createLinearGradient(x, y, x, y + L); g.addColorStop(0, rgba(col, 0)); g.addColorStop(0.7, rgba(col, a)); g.addColorStop(1, rgba(col, 0));
      ctx.strokeStyle = g; ctx.lineWidth = lw * (0.5 + hash(i, seed, 5)); ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + L); ctx.stroke();
    }
    ctx.restore();
  }
  function ENV_jupiterSkyFront(ctx, t, o = {}) {
    const pal = resolvePal(o), cam = camOf(o), fall = o.fall ?? 1, boil = boilOf(t);
    streaks(ctx, t, 5, 26, 2600 * fall, pal.streak, 0.45, [140, 420], 3, cam, 1.0);
    ENV_cloudField(ctx, t, { seed: 53, n: 3, w: [900, 1300], depth: 0, speed: 1500 * fall, p: 1.3, cam, pal: pal.cloud, light: o.light, boil, lw: 8, xs: [-120, 2050, 300] });
    streaks(ctx, t, 6, 6, 4200 * fall, pal.streak, 0.3, [500, 900], 7, cam, 1.6);
  }

  // ------------------------------------------------------------------ space
  const NEB = new Map();
  function nebulaTex(seed, pal) {
    const key = seed + JSON.stringify(pal); if (NEB.has(key)) return NEB.get(key);
    const w = 480, h = 270, c = mk(w, h), g = c.getContext('2d'), id = g.createImageData(w, h), D = id.data;
    const A = rgb(pal.nebA), B = rgb(pal.nebB), Cc = rgb(pal.nebC), Dk = rgb(pal.dust);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const u = i / w * 2.2, v = j / h * 1.24;
      const q = fbm(u * 1.3 + 3.1, v * 1.3 + 1.7, seed, 4), r = fbm(u * 1.3 + 8.3, v * 1.3 + 2.8, seed + 5, 4);
      const n = fbm(u + 1.8 * q, v + 1.8 * r, seed + 9, 5);
      // a diagonal river of gas so the frame has a direction, not uniform fog
      const band = Math.exp(-Math.pow((v - 0.62 - (u - 1.1) * 0.42 + (q - 0.5) * 0.5) / 0.42, 2));
      let d = clamp((n - 0.32) * 2.4 * band + band * 0.2 - 0.06);
      const st = Math.floor(d * 3), fr = d * 3 - st, dp = (st + smooth(0.25, 0.75, fr)) / 3; // 3 soft cel steps
      const lane = smooth(0.9, 0.98, 1 - Math.abs(2 * fbm(u * 1.6 + 9, v * 2.6 + 4, seed + 21, 4) - 1)) * smooth(0.2, 0.5, d) * 0.55;
      const ramp = (x) => x < 0.5 ? [lerp(B[0], A[0], x * 2), lerp(B[1], A[1], x * 2), lerp(B[2], A[2], x * 2)] : [lerp(A[0], Cc[0], x * 2 - 1), lerp(A[1], Cc[1], x * 2 - 1), lerp(A[2], Cc[2], x * 2 - 1)];
      let [cr, cg, cb] = ramp(clamp(dp * 0.85 + (r - 0.5) * 0.25));
      const lift = 0.7 + 0.75 * dp; cr *= lift; cg *= lift; cb *= lift;
      cr = lerp(cr, Dk[0], lane); cg = lerp(cg, Dk[1], lane); cb = lerp(cb, Dk[2], lane);
      const a = clamp(Math.pow(dp, 1.2) * 0.95);
      const k = (j * w + i) * 4; D[k] = clamp(cr, 0, 255); D[k + 1] = clamp(cg, 0, 255); D[k + 2] = clamp(cb, 0, 255); D[k + 3] = a * 255;
    }
    g.putImageData(id, 0, 0);
    const bl = mk(w, h), gb = bl.getContext('2d'); gb.filter = 'blur(6px)'; gb.drawImage(c, 0, 0); c.blur = bl; // pre-blurred copy for the glow pass
    NEB.set(key, c); return c;
  }
  const STARS = new Map(), SPACE = new Map();
  const STAR_COLS = ['#fff4e0', '#cfe2ff', '#ffd9a8', '#e8dcff', '#ffffff'];
  function starTile(seed, layer) {
    const key = seed + '|' + layer; if (STARS.has(key)) return STARS.get(key);
    const c = mk(W, H), g = c.getContext('2d'), n = [1700, 420][layer];
    for (let i = 0; i < n; i++) {
      const x = hash(i, seed, 1 + layer * 10) * W, y = hash(i, seed, 2 + layer * 10) * H, m = hash(i, seed, 3 + layer * 10);
      const col = STAR_COLS[Math.floor(hash(i, seed, 4) * 5)], r = layer ? 0.9 + m * 1.1 : 0.45 + m * 0.6, a = layer ? 0.55 + 0.45 * m : 0.25 + 0.45 * m;
      if (layer && m > 0.7) { const gg = g.createRadialGradient(x, y, 0, x, y, r * 5); gg.addColorStop(0, rgba(col, 0.35)); gg.addColorStop(1, rgba(col, 0)); g.fillStyle = gg; g.fillRect(x - r * 5, y - r * 5, r * 10, r * 10); }
      g.fillStyle = rgba(col, a); g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
    }
    STARS.set(key, c); return c;
  }
  function tiled(ctx, img, ox, oy, alpha = 1) {
    ox = wrap(ox, W); oy = wrap(oy, H); ctx.globalAlpha = alpha;
    for (const dx of [0, -W]) for (const dy of [0, -H]) ctx.drawImage(img, ox + dx, oy + dy, W, H);
    ctx.globalAlpha = 1;
  }
  function ENV_space(ctx, t, o = {}) {
    const pal = Object.assign({}, ENV_PAL.space, o.pal || {}), cam = camOf(o), seed = o.seed ?? 3, boil = boilOf(t);
    const neb = o.nebula ?? 1, bk = seed + '|' + JSON.stringify(pal) + neb;
    let back = SPACE.get(bk);
    if (!back) { // built once: 1.3x frame so the slow parallax never shows an edge
      back = mk(Math.round(W * 1.3), Math.round(H * 1.3)); const g = back.getContext('2d'), BW = back.width, BH = back.height;
      const gr = g.createRadialGradient(BW * 0.6, BH * 0.43, 0, BW * 0.6, BH * 0.43, BW * 0.7); gr.addColorStop(0, pal.mid); gr.addColorStop(1, pal.deep); g.fillStyle = gr; g.fillRect(0, 0, BW, BH);
      const st = starTile(seed, 0); g.drawImage(st, 0, 0); g.drawImage(st, W, 0); g.drawImage(st, 0, H); g.drawImage(st, W, H);
      if (neb > 0) { const tex = nebulaTex(seed, { nebA: pal.nebA, nebB: pal.nebB, nebC: pal.nebC, dust: pal.dust });
        g.globalAlpha = neb; g.imageSmoothingQuality = 'high'; g.drawImage(tex, 0, 0, BW, BH);
        g.globalCompositeOperation = 'lighter'; g.globalAlpha = neb * 0.3; g.drawImage(tex.blur, 0, 0, BW, BH); g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1; }
      SPACE.set(bk, back); if (SPACE.size > 4) SPACE.delete(SPACE.keys().next().value);
    }
    const mx = W * 0.15, my = H * 0.15, bx = clamp(-cam.x * 0.06 - t * 3, -mx, mx), by = clamp(-cam.y * 0.06, -my, my);
    ctx.drawImage(back, -mx + bx, -my + by, back.width, back.height);
    tiled(ctx, starTile(seed, 1), -cam.x * 0.14 - t * 6, -cam.y * 0.14, 1);
    // near bright stars: bloom + 4 spikes, twinkle on the stop-motion boil
    ctx.save();
    for (let i = 0; i < 26; i++) {
      const x = wrap(hash(i, seed, 41) * W - cam.x * 0.32 - t * 12, W + 100) - 50, y = wrap(hash(i, seed, 42) * H - cam.y * 0.32, H + 100) - 50;
      const m = hash(i, seed, 43), col = STAR_COLS[Math.floor(hash(i, seed, 44) * 5)], tw = 0.75 + 0.25 * hash(i, boil >> 1, seed);
      const r = (1.6 + m * 2.2) * tw;
      radial(ctx, x, y, r * 14, col, 0.45 * tw);
      if (m > 0.45) { ctx.globalCompositeOperation = 'lighter'; const sl = r * (8 + m * 10);
        for (const [dx, dy] of [[1, 0], [0, 1]]) { const gs = ctx.createLinearGradient(x - dx * sl, y - dy * sl, x + dx * sl, y + dy * sl); gs.addColorStop(0, rgba(col, 0)); gs.addColorStop(0.5, rgba(col, 0.75 * tw)); gs.addColorStop(1, rgba(col, 0));
          ctx.strokeStyle = gs; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(x - dx * sl, y - dy * sl); ctx.lineTo(x + dx * sl, y + dy * sl); ctx.stroke(); }
        ctx.globalCompositeOperation = 'source-over'; }
      ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(x, y, r * 0.75, 0, TAU); ctx.fill();
    }
    ctx.restore();
    // a few drifting dust motes very near the camera (depth cue)
    ctx.save();
    for (let i = 0; i < 10; i++) { const x = wrap(hash(i, seed, 61) * W - cam.x * 0.9 - t * 30, W + 200) - 100, y = wrap(hash(i, seed, 62) * H - cam.y * 0.9, H + 200) - 100;
      radial(ctx, x, y, 30 + 40 * hash(i, seed, 63), '#c8b8ff', 0.06); }
    ctx.restore();
  }

  // ------------------------------------------------------------------ lightning
  const BOLTS = new Map();
  function jag(x0, y0, x1, y1, seed, lv, disp) {
    let pts = [[x0, y0], [x1, y1]];
    for (let l = 0; l < lv; l++) {
      const np = [pts[0]];
      for (let i = 1; i < pts.length; i++) { const [ax, ay] = pts[i - 1], [bx, by] = pts[i], len = Math.hypot(bx - ax, by - ay), nx = -(by - ay) / len, ny = (bx - ax) / len, d = (hash(i, l, seed) - 0.5) * len * disp;
        np.push([(ax + bx) / 2 + nx * d, (ay + by) / 2 + ny * d], pts[i]); }
      pts = np;
    }
    return pts;
  }
  function boltGeom(x0, y0, x1, y1, seed) {
    const key = [x0, y0, x1, y1, seed].map(Math.round).join(','); if (BOLTS.has(key)) return BOLTS.get(key);
    const main = jag(x0, y0, x1, y1, seed, 6, 0.42), out = [{ pts: main, w: 1 }], len = Math.hypot(x1 - x0, y1 - y0);
    const nb = 5 + Math.floor(hash(seed, 1) * 3);
    for (let b = 0; b < nb; b++) {
      const at = main[Math.floor(lerp(0.06, 0.75, hash(seed, b, 2)) * (main.length - 1))], side = hash(seed, b, 3) < 0.5 ? -1 : 1;
      const dir = Math.atan2(y1 - y0, x1 - x0) + side * lerp(0.45, 1.1, hash(seed, b, 4)), L = len * lerp(0.15, 0.38, hash(seed, b, 5));
      const pts = jag(at[0], at[1], at[0] + Math.cos(dir) * L, at[1] + Math.sin(dir) * L, seed + b * 7, 5, 0.5); out.push({ pts, w: 0.5 });
      const at2 = pts[Math.floor(pts.length * 0.5)], d2 = dir + side * 0.6, L2 = L * 0.45;
      out.push({ pts: jag(at2[0], at2[1], at2[0] + Math.cos(d2) * L2, at2[1] + Math.sin(d2) * L2, seed + b * 13, 4, 0.55), w: 0.28 });
    }
    BOLTS.set(key, out); return out;
  }
  function ENV_bolt(ctx, x0, y0, x1, y1, seed, k = 1, o = {}) {
    if (k <= 0) return;
    const G = boltGeom(x0, y0, x1, y1, seed), sc = o.scale ?? 1;
    radial(ctx, (x0 + x1) / 2, (y0 + y1) / 2, Math.hypot(x1 - x0, y1 - y0) * 0.7, o.glow || '#7fb8ff', 0.35 * k);
    ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const passes = [[30, o.glow || '#7fb8ff', 0.32, 'lighter'], [12, '#cfeeff', 0.95, 'source-over'], [5, '#ffffff', 1, 'source-over']];
    for (const [w, c, a, comp] of passes) {
      ctx.globalCompositeOperation = comp; ctx.strokeStyle = rgba(c, a * k);
      for (const b of G) { ctx.lineWidth = w * sc * Math.max(0.35, b.w); ctx.beginPath(); b.pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.stroke(); }
    }
    ctx.restore();
  }
  // flicker: a strike, a dip, a re-strike, then a decay. strikes = optional list of times (sync to narration)
  function ENV_flash(t, seed = 1, period = 1.1, strikes = null) {
    let idx, ph;
    if (strikes) { idx = -1; for (let i = 0; i < strikes.length; i++) if (t >= strikes[i]) idx = i; if (idx < 0) return { k: 0, idx: 0 }; ph = t - strikes[idx]; }
    else { idx = Math.floor(t / period); ph = t - idx * period; if (hash(idx, seed, 9) < 0.3) return { k: 0, idx }; }
    const k = ph < 0.07 ? 1 : ph < 0.11 ? 0.25 : ph < 0.18 ? 0.9 : ph < 0.7 ? 0.9 * Math.exp(-(ph - 0.18) * 8) : 0;
    return { k, idx };
  }

  // ------------------------------------------------------------------ storm
  function rain(ctx, t, seed, n, speed, len, lw, col, a, cam, p, slant, lit) {
    const pos = (i) => { const span = H + len; return [wrap(hash(i, seed, 1) * (W + 400) - cam.x * p + t * speed * slant, W + 400) - 200, wrap(hash(i, seed, 2) * span + speed * t * (0.85 + 0.3 * hash(i, seed, 3)) - cam.y * p, span) - len]; };
    ctx.save(); ctx.lineCap = 'round'; ctx.strokeStyle = rgba(col, a); ctx.lineWidth = lw; ctx.beginPath();
    for (let i = 0; i < n; i++) { const [x, y] = pos(i); ctx.moveTo(x, y); ctx.lineTo(x - slant * len, y + len); }
    ctx.stroke();
    if (lit && lit.k > 0) { // drops near the bolt catch the flash
      ctx.strokeStyle = rgba('#eef8ff', clamp(a * 2.6 * lit.k)); ctx.lineWidth = lw * 1.25; ctx.beginPath();
      for (let i = 0; i < n; i++) { const [x, y] = pos(i); if (Math.abs(x - lit.x) < lit.r * (0.35 + 0.65 * hash(i, seed, 8))) { ctx.moveTo(x, y); ctx.lineTo(x - slant * len, y + len); } }
      ctx.stroke();
    }
    ctx.restore();
  }
  // one row of hanging storm lobes. The row is a cached periodic strip (built once), blitted with a scroll
  // offset; only the flash light on the lobe undersides is drawn live.
  const HROWS = new Map();
  function hangRow(ctx, y, size, seed, pal, depth, xoff, F, boil, first) {
    const c = pal.cloud, fk = depth * 0.6, body = mix(mix(c.shade, '#000000', 0.25), pal.top, fk), mid = mix(mix(body, c.mid, 0.45), pal.top, fk * 0.5), lit = mix(c.lit, pal.top, fk * 0.8);
    const n2 = Math.ceil(2 * W / (size * 1.05)), P = Math.round(n2 * size * 1.05), sp = P / n2, lw = 6 * (1 - depth * 0.5);
    const lobe = (j) => { const m = ((j % n2) + n2) % n2, r = size * (0.6 + 0.3 * hash(m, seed, 5)); return [j * sp + (hash(m, seed, 6) - 0.5) * sp * 0.35, r * 0.4 + (hash(m, seed, 7) - 0.5) * size * 0.35, r]; };
    const top = first ? size * 3 : size * 0.9, bot = size * 1.4;
    const key = [seed, size, depth, first ? 1 : 0, palKey(c), pal.top].join('|');
    let strip = HROWS.get(key);
    if (!strip) {
      strip = mk(Math.ceil(P), Math.ceil(top + bot)); const g = strip.getContext('2d'); g.translate(0, top);
      const C = []; for (let j = -2; j < n2 + 2; j++) C.push(lobe(j));
      const shapeP = (gr) => { g.beginPath(); for (const [cx, cy, r] of C) { g.moveTo(cx + r + gr, cy); g.arc(cx, cy, r + gr, 0, TAU); } const y0 = first ? -top : -size * 0.1; g.rect(-60, y0 - gr, P + 120, -y0 + size * 0.2 + gr); };
      g.fillStyle = c.ink; shapeP(lw); g.fill();
      g.fillStyle = vgrad(g, -size * 1.5, size, [[0, mix(body, '#000000', 0.35)], [1, body]]); shapeP(0); g.fill();
      g.save(); shapeP(0); g.clip();
      g.fillStyle = mid; g.beginPath(); for (const [cx, cy, r] of C) { g.moveTo(cx + r * 0.08 + r * 0.72, cy + r * 0.34); g.arc(cx + r * 0.08, cy + r * 0.34, r * 0.72, 0, TAU); } g.fill();
      g.strokeStyle = rgba(c.ink, 0.7 * (1 - depth)); g.lineWidth = lw * 0.5; g.beginPath();
      for (const [cx, cy, r] of C) { g.moveTo(cx + r * Math.cos(0.15), cy + r * Math.sin(0.15)); g.arc(cx, cy, r, 0.15, Math.PI - 0.15); } g.stroke();
      g.restore();
      g.strokeStyle = rgba(c.rim, 0.55 * (1 - depth)); g.lineWidth = 4; g.lineCap = 'round'; g.beginPath();
      for (const [cx, cy, r] of C) { g.moveTo(cx + (r - 3) * Math.cos(0.5), cy + (r - 3) * Math.sin(0.5)); g.arc(cx, cy, r - 3, 0.5, 1.3); } g.stroke();
      HROWS.set(key, strip); if (HROWS.size > 12) HROWS.delete(HROWS.keys().next().value);
    }
    if (first && y - top > -H) { ctx.fillStyle = mix(body, '#000000', 0.35); ctx.fillRect(-W, -H, 3 * W, y - top + H + 1); }
    const x0 = -wrap(xoff, P);
    for (let x = x0; x < W; x += P) ctx.drawImage(strip, x, y - top);
    if (F.k > 0) { // lobes near the strike take its light on their undersides
      const j0 = Math.floor(xoff / sp) - 2;
      for (let j = j0; j < j0 + W / sp + 5; j++) { const [lx, ly, r] = lobe(j), cx = lx - xoff, cy = y + ly, pr = clamp(1.2 - Math.abs(cx - F.x) / 800) * F.k; if (pr <= 0.02) continue;
        ctx.fillStyle = rgba(mix(lit, pal.flash, 0.5), pr); ctx.beginPath(); ctx.arc(cx, cy + r * 0.42, r * 0.54, 0, TAU); ctx.fill(); }
    }
  }
  function ENV_storm(ctx, t, o = {}) {
    const pal = Object.assign({}, ENV_PAL.storm, o.pal || {}), cam = camOf(o), seed = o.seed ?? 5, boil = boilOf(t);
    const F = o.F || ENV_flash(t, seed, o.period ?? 1.1, o.strikes), ground = o.ground !== false; // o.F = {k, idx}: drive the light yourself
    const bx = (o.bx ?? (460 + hash(F.idx, seed, 1) * 1000)) - cam.x * 0.3, cy = (o.ceiling ?? 360) - cam.y * 0.35, by1 = ground ? H - 95 : H + 60;
    const stormLight = Object.assign({}, o.light, { key: '#c8d4ff', amb: 0.2 });
    const lit = { x: bx, r: 620, k: F.k };
    if (want(o, 'back')) {
      ctx.fillStyle = vgrad(ctx, 0, H, [[0, pal.top], [0.4, mix(pal.top, pal.bot, 0.6)], [1, mix(pal.bot, '#5a6ad0', 0.35)]]); ctx.fillRect(-W, -H, 3 * W, 3 * H);
      radial(ctx, bx, H * 0.62, 1400, pal.flash, 0.4 * F.k);
      // far thunderheads, lit from inside by the strike
      ENV_cloudField(ctx, t, { seed: seed * 3 + 1, n: 5, w: [560, 900], depth: 0.6, drift: -5, p: 0.12, cam, pal: pal.cloud, light: stormLight, kinds: ['tower', 'cumulus', 'tower'], boil, lw: 5,
        xs: [120, 540, 960, 1380, 1800], ys: [H + 220, H + 300, H + 200, H + 280, H + 240], flash: () => ({ x: bx, y: H * 0.75, r: 650, k: F.k * 0.8, color: pal.flash }) });
      rain(ctx, t, seed + 1, 300, 900, 50, 1.4, pal.rain, 0.16, cam, 0.25, 0.12, lit);
      if (ground) { // dark ground with an ink ridge, rim-lit by the flash
        const ridge = (x) => H - 70 - 46 * fbm((x + cam.x * 0.2) * 0.004, 1, seed, 3);
        ctx.fillStyle = mix(pal.top, '#000000', 0.35); ctx.beginPath(); ctx.moveTo(-50, H + 50); for (let x = -50; x <= W + 50; x += 30) ctx.lineTo(x, ridge(x)); ctx.lineTo(W + 50, H + 50); ctx.fill();
        ctx.lineJoin = 'round'; ctx.strokeStyle = pal.cloud.ink; ctx.lineWidth = 6; ctx.stroke();
        if (F.k > 0) { ctx.strokeStyle = rgba(pal.flash, 0.8 * F.k); ctx.lineWidth = 3; ctx.beginPath(); for (let x = bx - 700; x <= bx + 700; x += 30) ctx.lineTo(x, ridge(x) + 4); ctx.stroke(); }
      }
      if (!o.noBolt) ENV_bolt(ctx, bx, cy - 30, bx + (hash(F.idx, seed, 2) - 0.5) * 320, by1, F.idx * 17 + seed, F.k); // o.noBolt: draw your own bolt
      rain(ctx, t, seed + 2, 170, 1300, 90, 2.2, pal.rain, 0.24, cam, 0.6, 0.12, lit);
      // the ceiling: three rows of hanging lobes (back row highest and darkest), lit from below around the strike
      [[cy - 175, 150, 0.55, 0.15], [cy - 85, 185, 0.25, 0.35], [cy, 215, 0, 0.6]].forEach(([y, size, d, p], r) =>
        hangRow(ctx, y, size, seed * 7 + r, pal, d, wrap(t * (10 + 6 * r) + cam.x * p + hash(r, seed) * 900, 100000), { x: bx, k: F.k }, boil, r === 0));
      // crawlers: branches running along the cloud base
      if (!o.noBolt) for (let c = 0; c < 3; c++) { const side = c % 2 ? 1 : -1, len = 380 + 420 * hash(F.idx, seed, 20 + c);
        ENV_bolt(ctx, bx, cy - 20, bx + side * len, cy - 60 + (hash(F.idx, seed, 30 + c) - 0.5) * 110, F.idx * 29 + c * 5 + seed, F.k * 0.9, { scale: 0.55 }); }
      ctx.save(); ctx.globalCompositeOperation = 'screen'; ctx.fillStyle = rgba(pal.flash, 0.1 * F.k); ctx.fillRect(-W, -H, 3 * W, 3 * H); ctx.restore();
    }
    if (want(o, 'front')) rain(ctx, t, seed + 3, 50, 1900, 170, 3.2, pal.rain, 0.28, cam, 1.2, 0.12, { x: bx, r: 800, k: F.k });
    return F;
  }

  // ------------------------------------------------------------------ the seven descent layers
  const DESC = [
    { name: 'ammonia ice', top: '#0d1a50', bot: '#3e64ad', sun: '#fff6e6', haze: '#6f8fd0', cloud: CLOUD('#ffffff', '#dde8fb', '#5a72b4', '#bff0ff', '#7896d4', '#0c1236') },
    { name: 'tan NH4SH', top: '#240909', bot: '#8a3a18', sun: '#ffd9a0', haze: '#b5552a', cloud: CLOUD('#ffe4b4', '#eea062', '#83361f', '#8fd6ff', '#a8502a', '#1c0806') },
    { name: 'water storm', top: '#060a20', bot: '#1f2c58', sun: '#c8d4ff', haze: '#26346a', cloud: CLOUD('#b8c6e6', '#6b7eaa', '#29345e', '#7fd8ff', '#2a3a70', '#05071a') },
    { name: 'amber haze', top: '#2a0a02', mid: '#d0721e', bot: '#4a1404', sun: '#ffe0a0', haze: '#e08a2a' },
    { name: 'liquid hydrogen', top: '#123a8a', bot: '#01061c', sun: '#9fd0ff', haze: '#0c2a6a' },
    { name: 'metallic hydrogen', top: '#0a0e16', bot: '#1d2433', sun: '#ffffff', haze: '#3a4458' },
    { name: 'fuzzy core', top: '#0c0504', bot: '#3a1606', sun: '#ffb050', haze: '#5a2408' },
  ];
  // planes of wavy bands: depth d (1 far .. 0 near) sets speed, parallax, size, fade and ink
  function bandPlanes(ctx, t, fall, cam, seed, planes, perPlane, draw) {
    const items = [];
    for (let pl = 0; pl < planes; pl++) {
      const d = 1 - pl / (planes - 1), p = lerp(0.9, 0.1, d), speed = lerp(1100, 140, d) * fall, span = H + 700, gap = span / perPlane;
      for (let k = 0; k < perPlane; k++) items.push([wrap(k * gap + hash(pl, k, seed) * gap * 0.5 - t * speed - cam.y * p, span) - 300, d, p, pl * 10 + k]);
    }
    items.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
    for (const [y, d, p, id] of items) { ctx.save(); ctx.translate(-cam.x * p, 0); draw(y, d, id); ctx.restore(); }
  }
  function wavePath(ctx, y, A, f, ph, below) {
    const top = (x) => y + A * Math.sin(x * f + ph) + A * 0.45 * Math.sin(x * f * 2.6 - ph * 0.8);
    ctx.beginPath(); ctx.moveTo(-120, y + below); for (let x = -120; x <= W + 120; x += 30) ctx.lineTo(x, top(x)); ctx.lineTo(W + 120, y + below); ctx.closePath();
    return top;
  }
  function strokeTop(ctx, top, dy) { ctx.beginPath(); for (let x = -120; x <= W + 120; x += 30) ctx.lineTo(x, top(x) + dy); ctx.stroke(); }
  function ENV_descent(ctx, t, i, o = {}) {
    const D = DESC[i], cam = camOf(o), boil = boilOf(t), fall = o.fall ?? 1, L = lightOf(o.light);
    const back = want(o, 'back'), front = want(o, 'front');
    if (i <= 2) {
      const F = i === 2 ? ENV_flash(t, 9, 0.85, o.strikes) : { k: 0, idx: 0 };
      const fx = 360 + hash(F.idx, 9, 1) * 1200, fy = 200 + hash(F.idx, 9, 2) * 300;
      const flashFn = i === 2 ? (x, y, w) => ({ x: fx, y: fy + 160, r: 820, k: F.k * clamp(1.5 - Math.hypot(x - fx, (y - w * 0.3) - fy) / 1100), color: '#d6ecff' }) : null;
      const lt = i === 2 ? Object.assign({}, o.light, { key: '#aebcf0', amb: 0.2 }) : o.light;
      if (back) {
        ctx.fillStyle = vgrad(ctx, 0, H, [[0, D.top], [1, D.bot]]); ctx.fillRect(-W, -H, 3 * W, 3 * H);
        if (i < 2) { radial(ctx, W * 0.5 + L.x * W * 0.6, H * 0.5 + L.y * H * 0.6, 1400, D.sun, i ? 0.42 : 0.55); }
        else radial(ctx, fx, fy + 200, 1300, '#9fc0ff', 0.45 * F.k);
        ENV_cloudField(ctx, t, { seed: 100 + i * 10, n: 8, w: [260, 440], depth: 0.78, speed: 160 * fall, p: 0.1, cam, pal: D.cloud, light: lt, boil, lw: 4, kinds: ['bank', 'cumulus', 'tower'], flash: flashFn });
        ctx.fillStyle = rgba(D.haze, 0.2); ctx.fillRect(-W, -H, 3 * W, 3 * H);
        if (i === 2 && F.k > 0) { ENV_bolt(ctx, fx, fy, fx + (hash(F.idx, 9, 3) - 0.5) * 400, fy + 560, F.idx * 31, F.k, { scale: 0.85 });
          ENV_bolt(ctx, fx, fy + 40, fx + (hash(F.idx, 9, 4) < 0.5 ? -1 : 1) * 520, fy - 40, F.idx * 37 + 3, F.k * 0.85, { scale: 0.5 }); }
        ENV_cloudField(ctx, t, { seed: 101 + i * 10, n: 5, w: [560, 860], depth: 0.42, speed: 600 * fall, p: 0.35, cam, pal: D.cloud, light: lt, boil, lw: 5, flash: flashFn, xs: [140, 1780, 620, 1300, 960] });
        if (i === 2) rain(ctx, t, 77, 220, 1600, 60, 1.6, '#9fb4ff', 0.2, cam, 0.4, 0.05, { x: fx, r: 600, k: F.k });
        if (i === 0) { // ice glints
          ctx.save(); ctx.globalCompositeOperation = 'lighter';
          for (let k = 0; k < 46; k++) { const x = wrap(hash(k, 5) * W - cam.x * 0.5, W), y = wrap(hash(k, 6) * H - t * 900 * fall - cam.y * 0.5, H), tw = hash(k, boil >> 1, 3), s = 3 + 8 * hash(k, 7);
            if (tw < 0.35) continue; ctx.strokeStyle = rgba('#ffffff', 0.85 * tw); ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(x - s, y); ctx.lineTo(x + s, y); ctx.moveTo(x, y - s); ctx.lineTo(x, y + s); ctx.stroke(); }
          ctx.restore();
        }
        if (i === 2) { ctx.save(); ctx.globalCompositeOperation = 'screen'; ctx.fillStyle = rgba('#9fbfff', 0.14 * F.k); ctx.fillRect(-W, -H, 3 * W, 3 * H); ctx.restore(); }
      }
      if (front) {
        ENV_cloudField(ctx, t, { seed: 102 + i * 10, n: 2, w: [1150, 1500], depth: 0, speed: 1500 * fall, p: 1.2, cam, pal: D.cloud, light: lt, boil, lw: 8, xs: [80, 1840], flash: flashFn });
        streaks(ctx, t, 41 + i, 18, 2400 * fall, i === 2 ? '#c8d8ff' : '#ffffff', 0.35, [140, 380], 3, cam, 1);
      }
      return;
    }
    if (i === 3) { // amber haze: stacked translucent sheets with lit lips, droplets at three depths
      if (back) {
        ctx.fillStyle = vgrad(ctx, 0, H, [[0, D.top], [0.5, D.mid], [1, D.bot]]); ctx.fillRect(-W, -H, 3 * W, 3 * H);
        radial(ctx, W * 0.5 + L.x * W * 0.4, H * 0.3, 1300, '#ffc060', 0.4);
        bandPlanes(ctx, t, fall, cam, 33, 3, 4, (y, d, s) => {
          const top = wavePath(ctx, y, lerp(70, 26, d), 0.0022 + 0.0012 * hash(s, 1), hash(s, 2) * 6 + t * 0.7, 360);
          const c0 = mix('#ffd48a', D.haze, d * 0.6), c1 = mix('#9a3a0c', D.haze, d * 0.55);
          ctx.globalAlpha = lerp(0.95, 0.55, d); ctx.fillStyle = vgrad(ctx, y - 60, y + 360, [[0, c0], [0.12, mix(c0, c1, 0.45)], [0.14, mix(c0, c1, 0.7)], [1, rgba(c1, 0)]]); ctx.fill();
          ctx.globalAlpha = 1; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
          ctx.strokeStyle = rgba('#2a0a02', 0.75 * (1 - d * 0.8)); ctx.lineWidth = lerp(6, 2, d); strokeTop(ctx, top, 0);
          ctx.strokeStyle = rgba('#fff2c8', 0.7 * (1 - d * 0.5)); ctx.lineWidth = lerp(4, 1.5, d); strokeTop(ctx, top, lerp(9, 4, d));
        });
        for (let k = 0; k < 70; k++) { const d = hash(k, 3), x = wrap(hash(k, 1) * W - cam.x * (0.1 + d), W), y = wrap(hash(k, 2) * (H + 100) - t * (200 + 1400 * d) * fall - cam.y * (0.1 + d), H + 100) - 50;
          ctx.fillStyle = rgba('#fff0c8', 0.35 + 0.4 * (1 - d)); ctx.beginPath(); ctx.arc(x, y, 1.5 + d * 5, 0, TAU); ctx.fill(); }
      }
      if (front) { for (let k = 0; k < 6; k++) { const x = wrap(hash(k, 11) * W - cam.x * 1.4, W), y = wrap(hash(k, 12) * (H + 300) - t * 2600 * fall, H + 300) - 150; radial(ctx, x, y, 70 + 60 * hash(k, 13), '#ffd890', 0.18, 'source-over'); }
        streaks(ctx, t, 44, 16, 2400 * fall, '#fff0d0', 0.3, [160, 420], 3, cam, 1); }
      return;
    }
    if (i === 4) { // liquid hydrogen: deep blue fluid, light from above dying out, glossy flowing currents
      if (back) {
        ctx.fillStyle = vgrad(ctx, 0, H, [[0, D.top], [0.6, '#061a4a'], [1, D.bot]]); ctx.fillRect(-W, -H, 3 * W, 3 * H);
        ctx.save(); ctx.globalCompositeOperation = 'lighter';
        for (let k = 0; k < 6; k++) { const x0 = -200 + k * 330 + 60 * Math.sin(t * 0.7 + k) - cam.x * 0.1, wd = 70 + 60 * hash(k, 4);
          const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, rgba('#9fd0ff', 0.16)); g.addColorStop(0.8, rgba('#9fd0ff', 0)); ctx.fillStyle = g;
          ctx.beginPath(); ctx.moveTo(x0, -20); ctx.lineTo(x0 + wd, -20); ctx.lineTo(x0 + wd + 420, H); ctx.lineTo(x0 + 420 - wd * 0.5, H); ctx.fill(); }
        ctx.restore();
        bandPlanes(ctx, t, fall, cam, 44, 3, 3, (y, d, s) => {
          const th = lerp(120, 45, d), f = 0.0022 + 0.0011 * hash(s, 22), ph = hash(s, 23) * 6 + t * 0.8;
          const yy = (x, q) => y + 80 * Math.sin(x * f + ph) + q * th * (0.6 + 0.4 * Math.sin(x * f * 1.7 + ph * 1.3));
          ctx.beginPath(); for (let x = -120; x <= W + 120; x += 40) ctx.lineTo(x, yy(x, -1)); for (let x = W + 120; x >= -120; x -= 40) ctx.lineTo(x, yy(x, 1)); ctx.closePath();
          const body = mix('#1f58c8', D.haze, d * 0.7), lit = mix('#a8e0ff', D.haze, d * 0.6);
          ctx.globalAlpha = lerp(0.95, 0.55, d); ctx.fillStyle = vgrad(ctx, y - th - 80, y + th + 80, [[0, lit], [0.3, lit], [0.36, body], [1, mix(body, '#000814', 0.6)]]); ctx.fill(); ctx.globalAlpha = 1;
          ctx.strokeStyle = rgba('#020616', 0.85 * (1 - d * 0.85)); ctx.lineWidth = lerp(6, 2, d); ctx.stroke();
          ctx.strokeStyle = rgba('#eef8ff', 0.8 * (1 - d * 0.6)); ctx.lineWidth = lerp(4, 1.5, d); ctx.beginPath(); for (let x = -120; x <= W + 120; x += 40) ctx.lineTo(x, yy(x, -0.7)); ctx.stroke();
        });
      }
      if (front) streaks(ctx, t, 45, 14, 1800 * fall, '#bfe0ff', 0.25, [160, 420], 3, cam, 1);
      return;
    }
    if (i === 5) { // metallic hydrogen: a silver ocean of swells, ink crests, cyan dynamo currents
      if (back) {
        ctx.fillStyle = vgrad(ctx, 0, H, [[0, D.top], [1, D.bot]]); ctx.fillRect(-W, -H, 3 * W, 3 * H);
        bandPlanes(ctx, t, fall, cam, 55, 3, 4, (y, d, s) => {
          const A = lerp(55, 18, d), top = wavePath(ctx, y, A, 0.0028 + 0.0012 * hash(s, 31), hash(s, 32) * 6 + t * 1.6, 520);
          const c0 = mix('#f4f8fc', D.haze, d * 0.55), c1 = mix('#8f9bb0', D.haze, d * 0.5), c2 = mix('#1e2533', D.haze, d * 0.3);
          ctx.fillStyle = vgrad(ctx, y - A, y + 360, [[0, c0], [0.1, c0], [0.12, c1], [0.45, mix(c1, c2, 0.45)], [0.47, mix(c1, c2, 0.75)], [1, c2]]); ctx.fill();
          ctx.save(); ctx.clip(); ctx.strokeStyle = rgba('#ffffff', 0.9 * (1 - d * 0.6)); ctx.lineWidth = lerp(7, 2.5, d); strokeTop(ctx, top, lerp(14, 6, d)); ctx.restore();
          ctx.strokeStyle = rgba('#070a12', 0.9 * (1 - d * 0.75)); ctx.lineWidth = lerp(6, 2, d); ctx.lineJoin = 'round'; strokeTop(ctx, top, 0);
        });
        ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        for (let k = 0; k < 5; k++) { const on = hash(k, boil >> 1, 7); if (on < 0.35) continue;
          let x = hash(k, boil >> 1, 5) * W, y = hash(k, boil >> 1, 6) * H; const pts = [[x, y]];
          for (let j = 0; j < 7; j++) { x += 50 + hash(j, k, boil >> 1) * 60; y += (hash(j, k + 3, boil >> 1) - 0.5) * 90; pts.push([x, y]); }
          radial(ctx, pts[3][0], pts[3][1], 260, '#5fe0ff', 0.35 * on);
          for (const [w, c, a] of [[12, '#3fc8ff', 0.25], [4, '#9ff0ff', 0.9], [1.6, '#ffffff', 1]]) { ctx.strokeStyle = rgba(c, a * on); ctx.lineWidth = w; ctx.beginPath(); pts.forEach((p, q) => (q ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.stroke(); }
        }
        ctx.restore();
      }
      if (front) streaks(ctx, t, 46, 14, 1600 * fall, '#ffffff', 0.3, [160, 420], 3, cam, 1);
      return;
    }
    if (i === 6) { // fuzzy core: no surface, dissolving heavy clumps (hard cel steps inside, soft halo outside), heat from below
      if (back) {
        ctx.fillStyle = vgrad(ctx, 0, H, [[0, D.top], [1, D.bot]]); ctx.fillRect(-W, -H, 3 * W, 3 * H);
        // the core below: cel-stepped heat with soft, wobbling step edges (no surface anywhere)
        const gx = W * 0.5 - cam.x * 0.05, gy = H * 1.22 - cam.y * 0.05;
        const RINGS = [[1700, '#4a1a08'], [1300, '#7a2a0c'], [980, '#b4461a'], [700, '#f0802e'], [440, '#ffb860'], [230, '#fff0c8']];
        RINGS.forEach(([R, c], q) => {
          ctx.fillStyle = vgrad(ctx, gy - R, gy - R * 0.6, [[0, rgba(c, 0)], [0.18, rgba(c, 0.95)], [1, rgba(c, 0.95)]]);
          ctx.beginPath();
          for (let a = 0; a <= 64; a++) { const th = Math.PI + a / 64 * Math.PI, rr = R * (1 + 0.025 * Math.sin(th * 9 + t * 1.3 + q) + 0.015 * Math.sin(th * 17 - t * 2.1)); a ? ctx.lineTo(gx + Math.cos(th) * rr * 1.25, gy + Math.sin(th) * rr) : ctx.moveTo(gx + Math.cos(th) * rr * 1.25, gy + Math.sin(th) * rr); }
          ctx.closePath(); ctx.fill();
        });
        radial(ctx, gx, gy - 200, 900, '#ffd890', 0.35);
        // heavy grains rising past us, dark against the glow, rim-lit from below
        for (let k = 0; k < 26; k++) {
          const d = hash(k, 51), x = wrap(hash(k, 52) * W - cam.x * (0.1 + d * 0.8), W + 200) - 100, y = wrap(hash(k, 53) * (H + 300) - t * (120 + 900 * d) * fall - cam.y * (0.1 + d * 0.8), H + 300) - 150;
          const r = 6 + 34 * d * d + 6 * hash(k, 54), rot = hash(k, 55) * 6 + t * (hash(k, 56) - 0.5);
          ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.globalAlpha = 0.55 + 0.45 * d;
          ctx.beginPath(); for (let q = 0; q < 7; q++) { const a = q / 7 * TAU, rr = r * (0.7 + 0.5 * hash(k, q, 57)); q ? ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr) : ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr); } ctx.closePath();
          ctx.fillStyle = mix('#1a0804', '#7a2a0c', 1 - d); ctx.fill(); ctx.strokeStyle = '#0c0402'; ctx.lineWidth = 1 + 2.5 * d; ctx.lineJoin = 'round'; ctx.stroke();
          ctx.restore();
          ctx.save(); ctx.globalAlpha = 0.55 + 0.45 * d; ctx.strokeStyle = rgba('#ffb050', 0.9); ctx.lineWidth = 1 + 2 * d; ctx.beginPath(); ctx.arc(x, y + r * 0.1, r * 0.8, 0.35, Math.PI - 0.35); ctx.stroke(); ctx.restore();
        }
        ctx.save(); ctx.globalCompositeOperation = 'lighter';
        for (let k = 0; k < 60; k++) { const x = wrap(hash(k, 61) * W - cam.x * 0.6, W), y = wrap(hash(k, 62) * H - t * 600 * fall, H); ctx.fillStyle = rgba('#ffd070', 0.5 * hash(k, boil >> 1, 63)); ctx.fillRect(x, y, 2.5, 2.5); }
        ctx.restore();
      }
      if (front) streaks(ctx, t, 47, 10, 1400 * fall, '#ffd8a0', 0.25, [160, 420], 3, cam, 1);
    }
  }

  window.__ENV_dbg = { deckRow, radial, hangRow, ENV_PAL };
  Object.assign(window, { ENV_cloud, ENV_cloudField, ENV_jupiterSky, ENV_jupiterSkyFront, ENV_space, ENV_descent, ENV_storm, ENV_bolt, ENV_flash, ENV_PAL, ENV_mixPal: mixPal, ENV_DESC: DESC });
})();
