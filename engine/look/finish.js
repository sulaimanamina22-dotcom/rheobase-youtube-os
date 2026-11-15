// finish.js : Rheobase texture and finish kit (prefix FIN_). Plain 2D canvas, deterministic in t, no Math.random.
// Self-contained: needs nothing from the engine. Textures are built once on first use (~0.65 s) plus ~0.3 s per new
// vignette/grain setting (baked finish layer). Everything per frame is tiled drawImage, never createPattern (a scaled
// pattern fill is several times slower in Chrome's software canvas) and never a full-frame CSS/SVG filter (60-90 ms).
//
// HOW TO CALL
//   1) Textured fill (inside any shape, moves and scales with the current transform, like paint on the object):
//        FIN_texFill(ctx, path, { bbox: [x, y, w, h], tex: 'stipple', strength: 0.32, light: FIN_LIGHT })
//      `path` is a Path2D, or a function (ctx) => { ctx.beginPath(); ...build path... } (do not fill inside it).
//      Call it AFTER you fill/shade the shape and BEFORE you ink its outline. It adds:
//        overlay texture (shows most in the midtones, vanishes in pure black/white, so it follows your shading),
//        pigment granulation on the shadow side, paper-white specks on the lit side, darker pooled pigment at the rim.
//      tex: 'stipple' (print/gouache speckle, default), 'paper', 'gouache' (dry-brush streaks), 'fibre' (soft).
//   2) Backgrounds (draw first, in the scene transform so they travel with the camera):
//        FIN_bgPaper(ctx, '#efe9dc', { strength: 0.45, stain: 0.35 })
//        FIN_bgSpace(ctx, t, { top: '#0c0d18', bottom: '#05060b', dust: 1, nebulas: [{ x, y, r, color: '#3b2a8a', a: 0.55 }], drift: [dx, dy] })
//   3) Whole-frame finish, called ONCE at the very end of EPISODE.render (replaces the old finish()):
//        FIN_finish(ctx, t)                  // defaults = the recommended look
//        FIN_finish(ctx, t, { bloom: 0.8, fringe: 1.5, leak: { x: 0, y: 0, r: 900, color: '#ff9a50', a: 0.18 } })
//      Options (defaults in brackets): curve [0.25] S-curve strength (overlay of the frame on itself), black [0] optional
//      black point in levels (color-burn, +1 blit), bloom [0.55], bloomThr [0.8], bloomAuto [true] (bloom fades out as
//      the frame's mean luma goes from 0.22 to 0.62), vignette [0.45] corner darkening, vigColor ['#1a1030'],
//      vigAuto [true] (vignette and grain fade to 40% on bright frames), grain [0.03] (~4 levels std in the mids, ~3
//      levels of specks in the blacks), fringe [0] px of red/blue split at the corners (costly, hero shots only), leak.
//   Lite variant (cheaper than the old finish): FIN_finish(ctx, t, { bloom: 0, curve: 0 }) = vignette + grain, 1 blit.
//   FIN_stats.ms holds the last FIN_finish cost in ms.
// Light convention (shared): FIN_LIGHT = { x: -0.55, y: -0.83, key: '#fff4e0', rim: '#7fd8ff', amb: 0.35 }.
(function () {
  const W = 1920, H = 1080, TAU = Math.PI * 2;
  const FIN_LIGHT = { x: -0.55, y: -0.83, key: '#fff4e0', rim: '#7fd8ff', amb: 0.35 };

  // ------------------------------------------------------------ deterministic noise
  function hash(a, b = 0, c = 0) {
    let h = (a * 374761393 + b * 668265263 + c * 2147483647) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967296;
  }
  function rng(seed) { let s = seed >>> 0 || 1; return () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  // periodic value noise (period Px, Py cells) so tiles have no seams
  function vp(x, y, Px, Py, seed) {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const wx = (i) => ((i % Px) + Px) % Px, wy = (i) => ((i % Py) + Py) % Py;
    const a = hash(wx(xi), wy(yi), seed), b = hash(wx(xi + 1), wy(yi), seed), c = hash(wx(xi), wy(yi + 1), seed), d = hash(wx(xi + 1), wy(yi + 1), seed);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  function fbmP(x, y, S, P, oct, seed, ax = 1) { // x,y in pixels of an SxS tile, base period P cells
    let n = 0, a = 0.5, p = P, norm = 0;
    for (let o = 0; o < oct; o++) { n += a * vp((x / S) * p * ax, (y / S) * p, p * ax, p, seed + o * 13); norm += a; a *= 0.5; p *= 2; }
    return n / norm;
  }
  const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
  const gauss = (r) => (r() + r() + r() - 1.5) * 2; // approx N(0,1)
  const hex = (c) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];

  function mk(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  function fromGrey(S, fn) { // fn(x,y) -> 0..255 grey, opaque tile
    const c = mk(S, S), g = c.getContext('2d'), id = g.createImageData(S, S), d = id.data;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const v = fn(x, y), i = (y * S + x) * 4; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; }
    g.putImageData(id, 0, 0); return c;
  }
  function fromAlpha(S, col, fn) { // fn(x,y) -> 0..1 alpha, colour fixed
    const c = mk(S, S), g = c.getContext('2d'), id = g.createImageData(S, S), d = id.data, [r, gg, b] = hex(col);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const i = (y * S + x) * 4; d[i] = r; d[i + 1] = gg; d[i + 2] = b; d[i + 3] = 255 * clamp(fn(x, y)); }
    g.putImageData(id, 0, 0); return c;
  }
  // short wrapped strokes (paper fibres, dry brush)
  function strokes(g, S, n, seed, { len = [4, 18], lw = [0.5, 1.1], ang = null, spread = Math.PI, curve = 0.6, cols }) {
    const r = rng(seed); g.lineCap = 'round';
    for (let i = 0; i < n; i++) {
      const x = r() * S, y = r() * S, L = len[0] + r() * (len[1] - len[0]), a = (ang == null ? r() * TAU : ang + (r() - 0.5) * spread), bend = (r() - 0.5) * curve;
      const c = cols[(r() * cols.length) | 0]; g.strokeStyle = c; g.lineWidth = lw[0] + r() * (lw[1] - lw[0]);
      for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) {
        const X = x + ox, Y = y + oy; if (X < -L || X > S + L || Y < -L || Y > S + L) continue;
        g.beginPath(); g.moveTo(X, Y);
        g.quadraticCurveTo(X + Math.cos(a + bend) * L * 0.5, Y + Math.sin(a + bend) * L * 0.5, X + Math.cos(a) * L, Y + Math.sin(a) * L); g.stroke();
      }
    }
  }

  // ------------------------------------------------------------ texture library (built once)
  const T = {};
  let built = false;
  function build() {
    if (built) return; built = true;
    const S = 512;
    // (film grain is baked into the full-frame finish layers, see finLayer below)
    // paper: fibres + 1px tooth + soft blotches, overlay-neutral (mean ~128)
    {
      const r = rng(77);
      const base = fromGrey(S, (x, y) => clamp(128 + (fbmP(x, y, S, 4, 3, 11) - 0.5) * 34 + (fbmP(x, y, S, 24, 2, 12) - 0.5) * 16 + gauss(r) * 7, 0, 255));
      const g = base.getContext('2d');
      strokes(g, S, 1100, 5, { len: [5, 22], lw: [0.4, 1.0], cols: ['rgba(255,255,255,0.16)', 'rgba(255,255,255,0.10)', 'rgba(0,0,0,0.10)', 'rgba(0,0,0,0.06)'] });
      T.paper = base;
    }
    // stipple: print / gouache speckle inside colour fills (like the textured map fills)
    {
      const r = rng(31);
      T.stipple = fromGrey(S, (x, y) => {
        let v = 128 + gauss(r) * 16 + (fbmP(x, y, S, 32, 2, 21) - 0.5) * 30 + (fbmP(x, y, S, 6, 3, 22) - 0.5) * 22;
        const s = r(); if (s < 0.018) v += 70 + r() * 50; else if (s < 0.036) v -= 60 + r() * 40;
        return clamp(v, 0, 255);
      });
    }
    // gouache: horizontal brush drag + dry-brush scratches
    {
      const r = rng(41);
      const c = fromGrey(S, (x, y) => clamp(128 + (fbmP(x, y, S, 3, 4, 33, 0.12) - 0.5) * 46 + (fbmP(x, y, S, 40, 1, 34) - 0.5) * 14 + gauss(r) * 5, 0, 255));
      strokes(c.getContext('2d'), S, 160, 6, { len: [40, 140], lw: [0.7, 1.5], ang: -0.35, spread: 0.5, curve: 0.08, cols: ['rgba(0,0,0,0.13)', 'rgba(0,0,0,0.08)', 'rgba(255,255,255,0.10)'] });
      T.gouache = c;
    }
    // fibre: soft, low-contrast (for skin/suit/clean plastics)
    { const r = rng(51); T.fibre = fromGrey(S, (x, y) => clamp(128 + (fbmP(x, y, S, 8, 3, 44) - 0.5) * 22 + gauss(r) * 5, 0, 255)); }
    // stain: big low-frequency blotches for backgrounds (256 tile, drawn scaled up)
    T.stain = fromGrey(256, (x, y) => clamp(128 + (fbmP(x, y, 256, 3, 4, 55) - 0.5) * 120, 0, 255));
    // granulation (shadow side pigment pooling): ink-coloured, alpha from thresholded noise
    T.gran = fromAlpha(S, '#120d1c', (x, y) => { const d = 0.05 + 0.3 * clamp((fbmP(x, y, S, 16, 3, 61) - 0.38) * 2.2); const h = hash(x, y, 62); return (h < d ? 0.35 + 0.5 * hash(x, y, 63) : 0) + (fbmP(x, y, S, 48, 2, 64) - 0.5) * 0.25; });
    // specks (lit side, paper showing through): white flecks
    {
      const c = fromAlpha(S, '#ffffff', (x, y) => { const h = hash(x, y, 71); return h < 0.022 ? 0.35 + hash(x, y, 72) * 0.6 : clamp((fbmP(x, y, S, 40, 2, 73) - 0.66) * 3) * 0.5; });
      strokes(c.getContext('2d'), S, 220, 8, { len: [3, 9], lw: [0.6, 1.2], cols: ['rgba(255,255,255,0.55)', 'rgba(255,255,255,0.3)'] });
      T.speck = c;
    }
    // space dust: 1024 tile of many faint specks (transparent, draw with 'lighter')
    {
      const S2 = 1024, c = mk(S2, S2), g = c.getContext('2d'), r = rng(88);
      for (let i = 0; i < 9000; i++) {
        const x = r() * S2, y = r() * S2, m = r(), warm = r();
        const a = m < 0.92 ? 0.05 + m * 0.22 : 0.3 + (m - 0.92) * 6;
        const col = warm < 0.33 ? '255,226,196' : warm < 0.66 ? '200,214,255' : '235,235,245';
        g.fillStyle = `rgba(${col},${clamp(a)})`;
        const s = m < 0.97 ? 1 : 1.6; g.fillRect(x, y, s, s);
      }
      T.dust = c;
    }
  }
  const nebCache = new Map();
  function nebSprite(color, seed) { // 384 px soft cloud, noise-modulated radial falloff
    const key = color + '|' + seed; if (nebCache.has(key)) return nebCache.get(key);
    const S = 384, c = fromAlpha(S, color, (x, y) => {
      const dx = x / S * 2 - 1, dy = y / S * 2 - 1;
      const wx = fbmP(x, y, S, 3, 3, seed + 3) - 0.5, wy = fbmP(x, y, S, 3, 3, seed + 4) - 0.5;
      const d = Math.hypot(dx + wx * 0.5, dy + wy * 0.5);
      const fall = clamp(1 - d); const n = fbmP(x + wx * 90, y + wy * 90, S, 4, 5, seed);
      return Math.pow(fall, 1.6) * clamp(0.25 + (n - 0.35) * 1.9);
    });
    nebCache.set(key, c); return c;
  }

  // ------------------------------------------------------------ tiling (drawImage tiles, NOT createPattern:
  // in Chrome's software canvas a scaled pattern fill costs several times a tiled drawImage of the same area)
  // Covers local rect (x,y,w,h) with tile `img` placed by matrix ptm (tile space -> local space).
  function tileFill(ctx, img, x, y, w, h, ptm) {
    const S = img.width, Sh = img.height, inv = ptm.inverse();
    let u0 = 1e9, v0 = 1e9, u1 = -1e9, v1 = -1e9;
    for (const [px, py] of [[x, y], [x + w, y], [x, y + h], [x + w, y + h]]) { const q = inv.transformPoint(new DOMPoint(px, py)); u0 = Math.min(u0, q.x); v0 = Math.min(v0, q.y); u1 = Math.max(u1, q.x); v1 = Math.max(v1, q.y); }
    // limit to what is on screen
    const M = ctx.getTransform().multiply(ptm), Mi = M.inverse(), cw = ctx.canvas.width, ch = ctx.canvas.height;
    let s0 = 1e9, t0 = 1e9, s1 = -1e9, t1 = -1e9;
    for (const [px, py] of [[0, 0], [cw, 0], [0, ch], [cw, ch]]) { const q = Mi.transformPoint(new DOMPoint(px, py)); s0 = Math.min(s0, q.x); t0 = Math.min(t0, q.y); s1 = Math.max(s1, q.x); t1 = Math.max(t1, q.y); }
    u0 = Math.max(u0, s0); v0 = Math.max(v0, t0); u1 = Math.min(u1, s1); v1 = Math.min(v1, t1);
    if (u1 <= u0 || v1 <= v0) return;
    ctx.save(); ctx.transform(ptm.a, ptm.b, ptm.c, ptm.d, ptm.e, ptm.f);
    for (let j = Math.floor(v0 / Sh); j * Sh < v1; j++) for (let i = Math.floor(u0 / S); i * S < u1; i++) ctx.drawImage(img, i * S, j * Sh);
    ctx.restore();
  }

  // shared scratch canvases
  const SCR = {};
  function scratch(name, w, h) {
    let c = SCR[name]; if (!c || c.width !== w || c.height !== h) { c = SCR[name] = mk(w, h); c._g = c.getContext('2d'); }
    return c;
  }

  // ------------------------------------------------------------ textured fill
  function setPath(ctx, path) { if (typeof path === 'function') { ctx.beginPath(); path(ctx); return null; } return path; }
  function FIN_texFill(ctx, path, o = {}) {
    build();
    const { bbox, tex = 'stipple', scale = 1, rot = 0, seed = 0, strength = 0.32, light = FIN_LIGHT,
      shade = 0.22, speck = 0.22, edge = 0.28, edgeW = null, edgeColor = '#120d1c' } = o;
    const [x, y, w, h] = bbox;
    ctx.save();
    const P = setPath(ctx, path); P ? ctx.clip(P) : ctx.clip();
    const ox = hash(seed, 1) * 512, oy = hash(seed, 2) * 512;
    const ptm = new DOMMatrix().translateSelf(x - ox, y - oy).rotateSelf(rot * 180 / Math.PI).scaleSelf(scale, scale);
    // 1) midtone texture (overlay is self-weighting: strongest at 50% grey, zero at black and white)
    ctx.globalCompositeOperation = 'overlay'; ctx.globalAlpha = strength; tileFill(ctx, T[tex], x, y, w, h, ptm);
    // light direction in local units (screen-fixed light under any rotation of the transform)
    const M = ctx.getTransform(), inv = M.inverse();
    let lx = inv.a * light.x + inv.c * light.y, ly = inv.b * light.x + inv.d * light.y; const ll = Math.hypot(lx, ly) || 1; lx /= ll; ly /= ll;
    const cx = x + w / 2, cy = y + h / 2, R = Math.hypot(w, h) / 2, gl = [cx + lx * R, cy + ly * R, cx - lx * R, cy - ly * R];
    // 2) granulation on the shadow side, paper specks on the lit side (each masked by a light gradient in a scratch canvas)
    if (shade > 0) masked(ctx, bbox, T.gran, ptm, gl, [[0, 0], [0.45, 0.12], [1, 1]], 'multiply', shade);
    if (speck > 0) masked(ctx, bbox, T.speck, ptm, gl, [[0, 1], [0.5, 0.25], [1, 0]], 'screen', speck);
    // 3) pooled pigment at the rim (3 soft steps, inside the clip)
    if (edge > 0) {
      const ew = edgeW || Math.max(4, Math.min(w, h) * 0.035);
      ctx.globalCompositeOperation = 'multiply'; ctx.strokeStyle = edgeColor; ctx.lineJoin = 'round';
      for (let i = 0; i < 3; i++) { ctx.globalAlpha = edge * 0.34; ctx.lineWidth = ew * 2 * (1 - i * 0.33); if (P) ctx.stroke(P); else { setPath(ctx, path); ctx.stroke(); } }
    }
    ctx.restore();
  }
  function devBox(M, x, y, w, h, cw, ch) {
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const [px, py] of [[x, y], [x + w, y], [x, y + h], [x + w, y + h]]) { const q = M.transformPoint(new DOMPoint(px, py)); x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y); x1 = Math.max(x1, q.x); y1 = Math.max(y1, q.y); }
    x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0)); x1 = Math.min(cw, Math.ceil(x1)); y1 = Math.min(ch, Math.ceil(y1));
    return x1 - x0 < 1 || y1 - y0 < 1 ? null : [x0, y0, x1 - x0, y1 - y0];
  }
  function masked(ctx, bbox, img, ptm, gl, stops, op, alpha) {
    const [x, y, w, h] = bbox, M = ctx.getTransform(), cw = ctx.canvas.width, ch = ctx.canvas.height;
    const db = devBox(M, x, y, w, h, cw, ch); if (!db) return;
    const S = scratch('mask', cw, ch), g = S._g;
    g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1; g.clearRect(...db);
    g.save(); g.beginPath(); g.rect(...db); g.clip(); g.setTransform(M);
    tileFill(g, img, x, y, w, h, ptm);
    const gr = g.createLinearGradient(gl[0], gl[1], gl[2], gl[3]); for (const [s, a] of stops) gr.addColorStop(s, `rgba(0,0,0,${a})`);
    g.globalCompositeOperation = 'destination-in'; g.fillStyle = gr; g.fillRect(x, y, w, h); g.restore();
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalCompositeOperation = op; ctx.globalAlpha = alpha;
    ctx.drawImage(S, ...db, ...db); ctx.restore();
  }

  // ------------------------------------------------------------ backgrounds (draw in the scene transform)
  function FIN_bgPaper(ctx, color, o = {}) {
    build();
    const { x = -W, y = -H, w = W * 3, h = H * 3, strength = 0.45, stain = 0.35, scale = 1, seed = 0, tex = 'paper' } = o;
    ctx.save();
    ctx.fillStyle = color; ctx.fillRect(x, y, w, h);
    const ox = hash(seed, 5) * 512, oy = hash(seed, 6) * 512;
    ctx.globalCompositeOperation = 'overlay'; ctx.globalAlpha = strength;
    tileFill(ctx, T[tex], x, y, w, h, new DOMMatrix().translateSelf(-ox, -oy).scaleSelf(scale, scale));
    if (stain > 0) { ctx.globalCompositeOperation = 'soft-light'; ctx.globalAlpha = stain; tileFill(ctx, T.stain, x, y, w, h, new DOMMatrix().translateSelf(-ox * 2, -oy * 2).scaleSelf(4 * scale, 4 * scale)); }
    ctx.restore();
  }
  function FIN_bgSpace(ctx, t, o = {}) {
    build();
    const { top = '#0c0d18', bottom = '#05060b', nebulas = [], dust = 1, drift = [0, 0], seed = 0, grit = 0.5 } = o;
    ctx.save();
    const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, top); g.addColorStop(1, bottom);
    ctx.fillStyle = g; ctx.fillRect(-W, -H, W * 3, H * 3);
    if (grit > 0) { // faint large-scale mottling so the black is never a dead flat colour
      ctx.globalCompositeOperation = 'soft-light'; ctx.globalAlpha = grit;
      tileFill(ctx, T.stain, -W, -H, W * 3, H * 3, new DOMMatrix().translateSelf(-hash(seed, 11) * 1280, 0).scaleSelf(5, 5));
    }
    ctx.globalCompositeOperation = 'screen';
    for (const n of nebulas) { const q = n.squash ?? 1; ctx.globalAlpha = n.a ?? 0.5; ctx.drawImage(nebSprite(n.color, (n.seed ?? seed) + 100), n.x - n.r, n.y - n.r * q, n.r * 2, n.r * 2 * q); }
    if (dust > 0) {
      ctx.globalCompositeOperation = 'lighter';
      const o1 = hash(seed, 9) * 1024, o2 = hash(seed, 10) * 1024;
      ctx.globalAlpha = dust; tileFill(ctx, T.dust, -W, -H, W * 3, H * 3, new DOMMatrix().translateSelf(drift[0] * 0.35 - o1, drift[1] * 0.35 - o2));
      ctx.globalAlpha = dust * 0.55; tileFill(ctx, T.dust, -W, -H, W * 3, H * 3, new DOMMatrix().translateSelf(drift[0] * 0.7 - o2, drift[1] * 0.7 - o1).scaleSelf(1.6, 1.6));
    }
    ctx.restore();
  }

  // ------------------------------------------------------------ whole-frame finish
  // One baked "finish layer" per (vignette, colour, grain) setting: 2048x1152, grey 128 = no change, applied with
  // 'hard-light'. Below 128 hard-light multiplies by 2*layer (the tinted vignette), above 128 it screens (the bright
  // half of the grain). So vignette + grain in the mids + grain specks in the blacks cost ONE blit per frame.
  // 3 grain variants; each frame picks one at a hashed offset (up to 128 px, which moves the grain completely and the
  // vignette invisibly).
  const LAYERS = new Map();
  function finLayer(v, vigColor, grain) {
    const key = v + '|' + vigColor + '|' + grain; if (LAYERS.has(key)) return LAYERS.get(key);
    if (LAYERS.size > 3) LAYERS.clear();
    const LW = 2048, LH = 1152, [vr, vg, vb] = hex(vigColor).map((c) => c / 255), out = [];
    const vm = new Float32Array(LW * LH); // vignette amount: 0 inside 0.45 of the half-diagonal ellipse, eased to v at the corners
    for (let y = 0; y < LH; y++) for (let x = 0; x < LW; x++) {
      const dx = (x - LW / 2) / (W / 2), dy = (y - LH / 2) / (H / 2), d = Math.hypot(dx, dy);
      vm[y * LW + x] = Math.pow(clamp((d - 0.45) / (1.42 - 0.45)), 1.7) * v;
    }
    for (let k = 0; k < 3; k++) {
      const c = mk(LW, LH), g = c.getContext('2d'), id = g.createImageData(LW, LH), d = id.data, r = rng(9001 + k * 77);
      const n = new Float32Array(LW * LH); for (let i = 0; i < n.length; i++) n[i] = gauss(r);
      for (let y = 0; y < LH; y++) for (let x = 0; x < LW; x++) {
        const i = y * LW + x, xl = x ? i - 1 : i + 1, xr = x < LW - 1 ? i + 1 : i - 1, yu = y ? i - LW : i + LW, yd = y < LH - 1 ? i + LW : i - LW;
        let gr = (n[i] * 0.5 + (n[xl] + n[xr] + n[yu] + n[yd]) * 0.125) * grain * 255; // ~1.3 px grain
        if (gr < 0) gr *= 0.45; // hard-light scales the dark half by the pixel value: halve it so highlights stay clean
        const s = vm[i], j = i * 4;
        d[j] = clamp(128 * (1 - s * (1 - vr)) + gr, 0, 255); d[j + 1] = clamp(128 * (1 - s * (1 - vg)) + gr, 0, 255); d[j + 2] = clamp(128 * (1 - s * (1 - vb)) + gr, 0, 255); d[j + 3] = 255;
      }
      g.putImageData(id, 0, 0); out.push(c);
    }
    LAYERS.set(key, out); return out;
  }

  const FIN_stats = { ms: 0, parts: {}, meanL: 0 };
  const DEF = { curve: 0.25, black: 0, bloom: 0.55, bloomThr: 0.8, bloomAuto: true, vignette: 0.45, vigColor: '#1a1030', vigAuto: true,
    grain: 0.03, fringe: 0, leak: null };
  function FIN_finish(ctx, t, opts = {}) {
    build();
    const o = Object.assign({}, DEF, opts), t0 = performance.now(), parts = {};
    const cv = ctx.canvas, cw = cv.width, ch = cv.height;
    let tm = t0; const lap = (k) => { const n = performance.now(); parts[k] = +(n - tm).toFixed(2); tm = n; };
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.filter = 'none'; ctx.imageSmoothingEnabled = true;
    // 0) optional black point (colour-burn with a light grey = linear levels; skipped when black = 0).
    //    Better: fix lifted blacks at the source (ink #120d1c, darker backgrounds).
    if (o.black > 0) { const q = 255 - o.black; ctx.globalCompositeOperation = 'color-burn'; ctx.fillStyle = `rgb(${q},${q},${q})`; ctx.fillRect(0, 0, cw, ch); }
    // 1) S-curve: the frame overlaid on itself (darks down, lights up, midtone saturation up). One blit.
    if (o.curve > 0) { ctx.globalCompositeOperation = 'overlay'; ctx.globalAlpha = o.curve; ctx.drawImage(cv, 0, 0); ctx.globalAlpha = 1; }
    lap('curve');
    // 2) frame brightness from a 32x18 readback (cheap: the export reads the frame back anyway)
    const Mc = scratch('meter', 32, 18), mg = Mc._g; mg.globalCompositeOperation = 'copy'; mg.imageSmoothingQuality = 'low'; mg.drawImage(cv, 0, 0, 32, 18);
    const md = mg.getImageData(0, 0, 32, 18).data; let ms = 0; for (let i = 0; i < md.length; i += 4) ms += 0.2126 * md[i] + 0.7152 * md[i + 1] + 0.0722 * md[i + 2];
    const L = ms / (32 * 18 * 255); FIN_stats.meanL = +L.toFixed(3);
    lap('meter');
    // 3) bloom: luma-led threshold on a 1/4 copy, blur at two scales (~12 px and ~48 px at full res), composited with
    //    'screen' ONLY over the region that has bloom (found from a 120x67 readback). Auto: fades out on bright frames.
    const bloomAmt = o.bloom * (o.bloomAuto ? clamp((0.62 - L) / 0.4) : 1);
    if (bloomAmt > 0.01) {
      const bw = cw >> 2, bh = ch >> 2, sw = bw >> 2, sh = bh >> 2, B1 = scratch('b1', bw, bh), b1 = B1._g, B2 = scratch('b2', bw, bh), b2 = B2._g, B3 = scratch('b3', sw, sh), b3 = B3._g;
      const thr = o.bloomThr, cT = (1 + thr) / (1 - thr), aT = 1 / (1 + thr);
      b1.globalCompositeOperation = 'copy'; b1.imageSmoothingQuality = 'low';
      b1.filter = `saturate(0.3) brightness(${aT.toFixed(4)}) contrast(${cT.toFixed(4)}) saturate(2.4)`; b1.drawImage(cv, 0, 0, bw, bh); b1.filter = 'none';
      b3.globalCompositeOperation = 'copy'; b3.imageSmoothingQuality = 'medium'; b3.filter = 'blur(3px)'; b3.drawImage(B1, 0, 0, sw, sh); b3.filter = 'none';
      // which 128x128 px cells of the frame carry visible bloom (max channel > 5/255 on the wide blur)
      const bd = b3.getImageData(0, 0, sw, sh).data, C = 8, gx = Math.ceil(sw / C), gy = Math.ceil(sh / C), on = new Uint8Array(gx * gy);
      for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) { const i = (y * sw + x) * 4; if (bd[i] > 5 || bd[i + 1] > 5 || bd[i + 2] > 5) on[((y / C) | 0) * gx + ((x / C) | 0)] = 1; }
      let any = 0; for (const v of on) any += v;
      if (any) {
        b2.globalCompositeOperation = 'copy'; b2.filter = 'blur(3px)'; b2.drawImage(B1, 0, 0); b2.filter = 'none';
        b2.globalCompositeOperation = 'lighter'; b2.globalAlpha = 1.4; b2.drawImage(B3, 0, 0, bw, bh); b2.globalAlpha = 1;
        ctx.globalCompositeOperation = 'screen'; ctx.globalAlpha = clamp(bloomAmt);
        const q = C * 4; // cell size in B2 pixels (32) -> 128 frame px
        for (let j = 0; j < gy; j++) { let i = 0; while (i < gx) { // merge runs of lit cells per row into one draw
          if (!on[j * gx + i]) { i++; continue; } let k = i; while (k < gx && on[j * gx + k]) k++;
          const rx = i * q, ry = j * q, rw = Math.min(bw, k * q) - rx, rh = Math.min(bh, (j + 1) * q) - ry;
          if (rw > 0 && rh > 0) ctx.drawImage(B2, rx, ry, rw, rh, rx * 4, ry * 4, rw * 4, rh * 4); i = k; } }
        ctx.globalAlpha = 1; parts.bloomCells = any + '/' + gx * gy;
      }
    }
    lap('bloom');
    // 4) light leak (optional): soft screen glow, filled only over its own circle
    if (o.leak) {
      const Lk = o.leak, g = ctx.createRadialGradient(Lk.x, Lk.y, 0, Lk.x, Lk.y, Lk.r), [r, gg, b] = hex(Lk.color);
      g.addColorStop(0, `rgba(${r},${gg},${b},${Lk.a})`); g.addColorStop(0.5, `rgba(${r},${gg},${b},${Lk.a * 0.35})`); g.addColorStop(1, `rgba(${r},${gg},${b},0)`);
      ctx.globalCompositeOperation = 'screen'; ctx.fillStyle = g;
      const lx0 = Math.max(0, Lk.x - Lk.r), ly0 = Math.max(0, Lk.y - Lk.r); ctx.fillRect(lx0, ly0, Math.min(cw, Lk.x + Lk.r) - lx0, Math.min(ch, Lk.y + Lk.r) - ly0);
    }
    // 5) chromatic fringe (optional, costly: ~4 extra full-frame ops): red pushed out, blue pulled in, outer ring only
    if (o.fringe > 0) {
      const sc = o.fringe / Math.hypot(cw / 2, ch / 2), R = scratch('fr', cw, ch), r = R._g, Bc = scratch('fb', cw, ch), bb = Bc._g;
      r.globalCompositeOperation = 'copy'; r.drawImage(cv, 0, 0); r.globalCompositeOperation = 'multiply'; r.fillStyle = '#ff0000'; r.fillRect(0, 0, cw, ch);
      bb.globalCompositeOperation = 'copy'; bb.drawImage(cv, 0, 0); bb.globalCompositeOperation = 'multiply'; bb.fillStyle = '#0000ff'; bb.fillRect(0, 0, cw, ch);
      ctx.save(); ctx.beginPath(); ctx.rect(0, 0, cw, ch); ctx.ellipse(cw / 2, ch / 2, cw * 0.36, ch * 0.36, 0, 0, TAU, true); ctx.clip('evenodd');
      ctx.globalCompositeOperation = 'multiply'; ctx.fillStyle = '#00ff00'; ctx.fillRect(0, 0, cw, ch);
      ctx.globalCompositeOperation = 'lighter';
      ctx.drawImage(R, -cw * sc / 2, -ch * sc / 2, cw * (1 + sc), ch * (1 + sc));
      ctx.drawImage(Bc, cw * sc / 2, ch * sc / 2, cw * (1 - sc), ch * (1 - sc));
      ctx.restore();
    }
    lap('fringe');
    // 6) vignette + animated grain: one hard-light blit of a baked layer, new grain every frame (30 fps)
    if (o.vignette > 0 || o.grain > 0) {
      const Ls = finLayer(o.vignette, o.vigColor, o.grain), fr = Math.floor(t * 15 + 1e-6); // grain steps with the drawings (15/s), not every frame
      const ox = Math.round(64 + (hash(fr, 3) - 0.5) * 128), oy = Math.round(36 + (hash(fr, 4) - 0.5) * 72);
      ctx.globalCompositeOperation = 'hard-light'; ctx.globalAlpha = o.vigAuto ? 1 - 0.6 * clamp((L - 0.25) / 0.45) : 1;
      ctx.drawImage(Ls[fr % 3], -ox, -oy); ctx.globalAlpha = 1;
    }
    lap('vigGrain');
    ctx.restore();
    FIN_stats.ms = +(performance.now() - t0).toFixed(2); FIN_stats.parts = parts;
  }

  Object.assign(window, { FIN_LIGHT, FIN_texFill, FIN_bgPaper, FIN_bgSpace, FIN_finish, FIN_stats, FIN_build: build, FIN_TEX: T, FIN_layer: finLayer });
})();
