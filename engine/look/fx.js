// fx.js : Rheobase effects kit (prefix FX_). Plain 2D canvas, deterministic in t, needs window.ENG (engine/core.js).
// Load after core.js (paste into subjects.js or include before scenes.js). Exposes window.FX = { FX_... }.
//
// Every function draws in whatever transform is current, in 1920x1080 frame units (or the scene's world
// units under a camera). Sizes passed in are in those same units. Nothing uses Math.random: every flicker,
// particle and branch comes from ENG.hash of (index, seed, boil) or from t, so any frame renders exactly.
//
// Light convention (shared brief): light = { x: -0.55, y: -0.83, key: '#fff4e0', rim: '#7fd8ff', amb: 0.35 }
// (x, y) is the unit vector TOWARD the key light (upper left). Pass your scene's light in o.light.
//
// Quick reference (all return undefined unless noted):
//   FX_glow(ctx, x, y, r, color, a = 1, hot = 0.5)        soft bloom sprite, additive. hot = white core amount.
//   FX_glint(ctx, x, y, s, color, a = 1, rot = 0)         4-point star glint (the neuron-pulse sparkle).
//   FX_bloom(ctx, draw, o)                                 screen-space bloom of whatever draw(c) paints.
//        o: { r: 10 (in your drawing units), wide: 4 (x r, at half the resolution), strength: 1, wideStrength: 0.7, q: 0.25, slot, key }
//        With slot + key, the blurred buffers are reused while key and transform are unchanged (stop-motion holds).
//   FX_heat(k) -> [r,g,b]                                  blackbody-ish ramp, 0 dull red .. 1 white hot.
//   FX_rock(ctx, x, y, R, o)                               cel-shaded rock/ice nucleus with rim light, texture, ink.
//        o: { rot, boil, seed, light, base, shade, hi, rim, lw, craters: 3 }
//   FX_comet(ctx, t, x, y, r, dir, o)                      full comet: dust + gas tails, streaming particles,
//        layered coma, lit nucleus. dir = direction of travel (radians). r = coma scale (nucleus = 0.62 r).
//        o: { tail: 9, tailDir, curve: 0.18, particles: 40, hot: 0..1, lit: 0..1 pulse, alpha, seed, boil, light, spin }
//   FX_dustTrain(ctx, pts, w, color, a)                    soft shared dust band through points (string of pearls).
//   FX_entryFireBack(ctx, t, x, y, s, ang, heat, o)        smoke trail, plasma wake and sparks (draw BEFORE the probe).
//   FX_entryFireFront(ctx, t, x, y, s, ang, heat, o)       glowing heat shield face, shock layer, bloom (AFTER the probe).
//        x, y, s, ang = the same arguments as SUB.probe (shield is the curve (-26,4)-(0,24)-(26,4) in probe units).
//   FX_impact(ctx, t, x, y, R, t0, o) -> light 0..1       core flash, glint, shockwave ring, debris sparks, lingering glow.
//        o: { color, ring: true, squash: 1, rot: 0, up: angle or null (half-dome debris), sparks: 26, seed, scale }
//   FX_impactLight(age, o) -> 0..1                         the flash curve FX_impact uses (for syncing screen light).
//   FX_screenLight(ctx, k, x, y, o)                        tints the whole frame with the flash: soft-light tint,
//        screen-lift around the source, multiply contrast keeper. Never a flat white fill.
//        o: { color: '#fff1cf', tint: '#ffb347', deep: '#2a1038', radius: 1500 }
//   FX_plume(ctx, t, x, y, H, o)                           billowing cel-shaded fireball plume with emissive core.
//        o: { rise 0..1, spread 0..1, fade 0..1, ang (up direction, radians, default -PI/2), w (width), lw, seed, light, boil }
//   FX_lightning(ctx, t, x0, y0, x1, y1, o) -> geom        branched bolt with bloom; geom.main/branches for lighting.
//        o: { seed, a: intensity 0..1, w: 6, glow: '#9fb2ff', core: '#ffffff', branches: 8, rough: 0.2 }
//   FX_lightningFlicker(age) -> 0..1                       stop-motion strike envelope (on, dip, restrike, decay).
//   FX_illuminate(ctx, pathFn, x, y, R, color, a)          light the inside of a path (cloud) from a point.
//   FX_speedLines(ctx, t, o)                               tapered streaks + dust; parallel or radial warp.
//        o: { mode: 'parallel'|'radial', dir, speed, n, seed, color, len: [a,b], w, alpha, cx, cy, additive, dust }
//   FX_sparks(ctx, t, x, y, t0, o)                         ballistic cooling sparks (used by impact; usable alone).
(function () {
  const E = window.ENG;
  const { hash, clamp, lerp } = E;
  const TAU = Math.PI * 2, W = 1920, H = 1080;
  const INK = '#120d1c';
  const LIGHT = { x: -0.55, y: -0.83, key: '#fff4e0', rim: '#7fd8ff', amb: 0.35 };
  const frac = (v) => v - Math.floor(v);
  const smooth = (k) => { k = clamp(k); return k * k * (3 - 2 * k); };

  // ------------------------------------------------------------------ colour
  function rgbOf(c) {
    if (Array.isArray(c)) return c;
    if (c[0] === '#') return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
    const m = c.match(/[\d.]+/g); return [+m[0], +m[1], +m[2]];
  }
  const css = (c, a = 1) => { const [r, g, b] = rgbOf(c); return `rgba(${r | 0},${g | 0},${b | 0},${clamp(a)})`; };
  const mixc = (a, b, k) => { const A = rgbOf(a), B = rgbOf(b); k = clamp(k); return [lerp(A[0], B[0], k), lerp(A[1], B[1], k), lerp(A[2], B[2], k)]; };
  function ramp(stops, k) {
    if (k <= stops[0][0]) return rgbOf(stops[0][1]);
    for (let i = 1; i < stops.length; i++) if (k <= stops[i][0]) return mixc(stops[i - 1][1], stops[i][1], (k - stops[i - 1][0]) / (stops[i][0] - stops[i - 1][0]));
    return rgbOf(stops[stops.length - 1][1]);
  }
  const HEAT = [[0, '#2a0712'], [0.18, '#8e1a22'], [0.36, '#e23f1f'], [0.55, '#ff8424'], [0.72, '#ffc244'], [0.86, '#fff0a6'], [1, '#fffdf6']];
  const FX_heat = (k) => ramp(HEAT, clamp(k));

  // ------------------------------------------------------------------ cached sprites
  const SPR = new Map();
  function sprite(color, hot) {
    hot = Math.round(clamp(hot) * 4) / 4;
    const q = (v) => Math.min(255, Math.round(v / 12) * 12); // quantised so cooling colours reuse sprites
    const [R, G, B] = rgbOf(color).map(q), key = `${R},${G},${B}|${hot}`;
    let cv = SPR.get(key); if (cv) return cv;
    const S = 128; cv = E.makeCanvas(S, S);
    const g = cv.getContext('2d'), id = g.createImageData(S, S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const d = Math.hypot(x + 0.5 - S / 2, y + 0.5 - S / 2) / (S / 2), i = (y * S + x) * 4;
      if (d >= 1) { id.data[i + 3] = 0; continue; }
      // three-gaussian falloff: tight core, body, wide skirt (reads as lens bloom, not a flat disc)
      let a = 0.46 * Math.exp(-((d / 0.09) ** 2)) + 0.34 * Math.exp(-((d / 0.28) ** 2)) + 0.2 * Math.exp(-((d / 0.6) ** 2));
      a *= (1 - d * d) ** 2;
      const w = hot * Math.exp(-((d / 0.11) ** 2));
      id.data[i] = R + (255 - R) * w; id.data[i + 1] = G + (255 - G) * w; id.data[i + 2] = B + (255 - B) * w; id.data[i + 3] = 255 * clamp(a);
    }
    g.putImageData(id, 0, 0); SPR.set(key, cv); if (SPR.size > 400) SPR.delete(SPR.keys().next().value); return cv;
  }
  function FX_glow(ctx, x, y, r, color, a = 1, hot = 0.5) {
    if (!(a > 0) || !(r > 0)) return;
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    let aa = a; while (aa > 0) { ctx.globalAlpha = clamp(aa) * (ctx.globalAlpha > 0 ? 1 : 1); ctx.drawImage(sprite(color, hot), x - r, y - r, 2 * r, 2 * r); aa -= 1; }
    ctx.restore();
  }
  function FX_glint(ctx, x, y, s, color = '#fff4c8', a = 1, rot = 0) {
    if (!(a > 0) || !(s > 0)) return;
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha *= clamp(a);
    ctx.translate(x, y); ctx.rotate(rot);
    const ray = (len, wid) => {
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, len);
      g.addColorStop(0, css('#ffffff', 1)); g.addColorStop(0.25, css(color, 0.9)); g.addColorStop(1, css(color, 0));
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.moveTo(-len, 0); ctx.quadraticCurveTo(0, -wid, len, 0); ctx.quadraticCurveTo(0, wid, -len, 0);
      ctx.moveTo(0, -len); ctx.quadraticCurveTo(wid, 0, 0, len); ctx.quadraticCurveTo(-wid, 0, 0, -len); ctx.fill();
    };
    ray(s, s * 0.09);
    ctx.rotate(Math.PI / 4); ray(s * 0.42, s * 0.06);
    ctx.restore();
    FX_glow(ctx, x, y, s * 0.55, color, a, 1);
  }

  // ------------------------------------------------------------------ screen-space bloom
  const BUF = {};
  function buf(name, w, h) {
    w = Math.max(2, Math.round(w)); h = Math.max(2, Math.round(h));
    let b = BUF[name];
    if (!b || b.c.width !== w || b.c.height !== h) { const c = E.makeCanvas(w, h); b = BUF[name] = { c, g: c.getContext('2d'), key: null }; }
    return b;
  }
  function FX_bloom(ctx, draw, o = {}) {
    const r = o.r ?? 10, wide = o.wide ?? 4, st = o.strength ?? 1, ws = o.wideStrength ?? 0.7, q = o.q ?? 0.25;
    const cw = ctx.canvas.width, ch = ctx.canvas.height, M = ctx.getTransform();
    const bs = Math.hypot(M.a, M.b) || 1; // radii are in the caller's drawing units (follow camera zoom and visor nesting)
    const slot = o.slot || '_', A = buf(slot + 'A', cw * q, ch * q), A1 = buf(slot + 'A1', cw * q, ch * q), B1 = buf(slot + 'B1', cw * q / 2, ch * q / 2);
    // optional box [x0, y0, x1, y1] in drawing units: blur and composite only there (this PC is fill-rate bound)
    let bx = 0, by = 0, bw = A.c.width, bh = A.c.height;
    if (o.box) {
      const [x0, y0, x1, y1] = o.box, ps = [[x0, y0], [x1, y0], [x0, y1], [x1, y1]].map((p) => M.transformPoint(new DOMPoint(p[0], p[1])));
      const pad = r * wide * bs * 1.2;
      const mnx = Math.min(...ps.map((p) => p.x)) - pad, mxx = Math.max(...ps.map((p) => p.x)) + pad, mny = Math.min(...ps.map((p) => p.y)) - pad, mxy = Math.max(...ps.map((p) => p.y)) + pad;
      bx = clamp(Math.floor(mnx * q / 2) * 2, 0, A.c.width); by = clamp(Math.floor(mny * q / 2) * 2, 0, A.c.height);
      bw = clamp(Math.ceil(mxx * q / 2) * 2, 0, A.c.width) - bx; bh = clamp(Math.ceil(mxy * q / 2) * 2, 0, A.c.height) - by;
      if (bw <= 0 || bh <= 0) return;
    }
    const key = o.key !== undefined ? JSON.stringify([o.key, M.a, M.b, M.c, M.d, M.e, M.f, r, wide, bx, by, bw, bh]) : null;
    if (!key || A.key !== key) {
      const g = A.g; g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1; g.filter = 'none';
      g.clearRect(0, 0, A.c.width, A.c.height);
      g.setTransform(M.a * q, M.b * q, M.c * q, M.d * q, M.e * q, M.f * q);
      draw(g);
      g.setTransform(1, 0, 0, 1, 0, 0);
      A1.g.setTransform(1, 0, 0, 1, 0, 0); A1.g.clearRect(bx, by, bw, bh);
      A1.g.filter = `blur(${Math.max(0.5, r * bs * q)}px)`; A1.g.drawImage(A.c, bx, by, bw, bh, bx, by, bw, bh); A1.g.filter = 'none';
      B1.g.setTransform(1, 0, 0, 1, 0, 0); B1.g.clearRect(bx / 2, by / 2, bw / 2, bh / 2);
      B1.g.filter = `blur(${Math.max(0.5, r * wide * bs * q / 2)}px)`; B1.g.drawImage(A.c, bx, by, bw, bh, bx / 2, by / 2, bw / 2, bh / 2); B1.g.filter = 'none';
      A.key = key;
    }
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalCompositeOperation = 'lighter';
    const a0 = ctx.globalAlpha;
    for (let s = st; s > 0; s -= 1) { ctx.globalAlpha = a0 * clamp(s); ctx.drawImage(A1.c, bx, by, bw, bh, bx / q, by / q, bw / q, bh / q); }
    for (let s = ws; s > 0; s -= 1) { ctx.globalAlpha = a0 * clamp(s); ctx.drawImage(B1.c, bx / 2, by / 2, bw / 2, bh / 2, bx / q, by / q, bw / q, bh / q); }
    ctx.restore();
  }

  // ------------------------------------------------------------------ small drawing helpers
  // tapered streak from head (x0,y0) to tail (x1,y1), head width w0, colour fades to tail
  function streak(ctx, x0, y0, x1, y1, w0, color, a0 = 1, w1 = 0) {
    const dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy); if (L < 0.01 || a0 <= 0) return;
    const nx = -dy / L, ny = dx / L;
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    g.addColorStop(0, css(color, a0)); g.addColorStop(1, css(color, 0));
    ctx.fillStyle = g; ctx.beginPath();
    ctx.moveTo(x0 + nx * w0 / 2, y0 + ny * w0 / 2); ctx.arc(x0, y0, w0 / 2, Math.atan2(ny, nx), Math.atan2(ny, nx) + Math.PI, true);
    ctx.lineTo(x1 - nx * w1 / 2, y1 - ny * w1 / 2); ctx.lineTo(x1 + nx * w1 / 2, y1 + ny * w1 / 2); ctx.closePath(); ctx.fill();
  }
  // gradient-free streak (two strokes): for many small particles, sparks and dust
  function streakFast(ctx, x0, y0, x1, y1, w, color, a) {
    if (a <= 0.01) return;
    const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
    ctx.lineCap = 'round'; ctx.strokeStyle = css(color, a); ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(mx, my); ctx.stroke();
    ctx.strokeStyle = css(color, a * 0.4); ctx.lineWidth = w * 0.5; ctx.beginPath(); ctx.moveTo(mx, my); ctx.lineTo(x1, y1); ctx.stroke();
  }
  function circle(ctx, x, y, r) { ctx.beginPath(); ctx.arc(x, y, Math.max(0.01, r), 0, TAU); }

  // ------------------------------------------------------------------ rock / ice nucleus
  function rockPath(ctx, x, y, R, rot, boil, seed, dx = 0, dy = 0, sc = 1) {
    const n = 30, c = Math.cos(rot), s = Math.sin(rot);
    ctx.beginPath();
    for (let i = 0; i <= n; i++) {
      const j = i % n, a = (j / n) * TAU;
      const k = sc * (1 + 0.15 * Math.sin(2 * a + seed * 1.7) + 0.09 * Math.sin(3 * a + seed * 2.3) + 0.05 * Math.sin(5 * a + seed * 0.9) + (hash(j, boil, seed + 71) - 0.5) * 0.035);
      const px = Math.cos(a) * R * 1.12 * k, py = Math.sin(a) * R * 0.86 * k;
      const X = x + dx + px * c - py * s, Y = y + dy + px * s + py * c;
      i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y);
    }
    ctx.closePath();
  }
  function FX_rock(ctx, x, y, R, o = {}) {
    if (!(R > 0.3)) return;
    const L = o.light || LIGHT, rot = o.rot || 0, boil = o.boil ?? 0, seed = o.seed || 0;
    const base = o.base || '#a7b4cc', shade = o.shade || '#3f4670', hi = o.hi || '#f4fbff', rim = o.rim || L.rim, lw = o.lw ?? Math.max(1.4, R * 0.13);
    ctx.save();
    rockPath(ctx, x, y, R, rot, boil, seed); ctx.save(); ctx.clip();
    ctx.fillStyle = css(rim); ctx.fillRect(x - R * 2, y - R * 2, R * 4, R * 4);                                   // rim (shows as crescent away from the light)
    ctx.fillStyle = css(shade); rockPath(ctx, x, y, R, rot, boil, seed, L.x * R * 0.16, L.y * R * 0.16); ctx.fill(); // core shadow
    ctx.fillStyle = css(base); rockPath(ctx, x, y, R, rot, boil, seed, L.x * R * 0.55, L.y * R * 0.55, 1.02); ctx.fill(); // hard terminator
    if (!o.lite) { const g = ctx.createLinearGradient(x + L.x * R, y + L.y * R, x - L.x * R, y - L.y * R); // soft gradient inside the tones
      g.addColorStop(0, 'rgba(255,250,235,0.28)'); g.addColorStop(0.5, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(18,10,40,0.3)');
      ctx.fillStyle = g; ctx.fillRect(x - R * 2, y - R * 2, R * 4, R * 4); }
    ctx.fillStyle = css(hi, 0.95); rockPath(ctx, x, y, R, rot, boil, seed, L.x * R * 0.62, L.y * R * 0.62, 0.42); ctx.fill(); // specular patch
    const nc = o.craters ?? 4, CR = [[0.55, 0.42, 0.15], [2.6, 0.62, 0.085], [3.9, 0.3, 0.06], [5.0, 0.66, 0.05], [1.6, 0.7, 0.045]];
    for (let i = 0; i < Math.min(nc, 5); i++) { // craters of unequal size, scattered (never a matched pair: that reads as a face)
      const a = CR[i][0] + seed * 0.7, d = R * CR[i][1], cr = R * CR[i][2];
      const cx = x + Math.cos(a + rot) * d, cy = y + Math.sin(a + rot) * d * 0.8;
      ctx.fillStyle = css(hi, 0.55); ctx.beginPath(); ctx.ellipse(cx - L.x * cr * 0.3, cy - L.y * cr * 0.3, cr, cr * 0.8, rot, 0, TAU); ctx.fill();
      ctx.fillStyle = css(shade, 0.9); ctx.beginPath(); ctx.ellipse(cx + L.x * cr * 0.12, cy + L.y * cr * 0.12, cr * 0.86, cr * 0.68, rot, 0, TAU); ctx.fill();
    }
    const Md = ctx.getTransform(), Rdev = R * Math.hypot(Md.a, Md.b);
    if (E.TEX.mottle && Rdev > 22) E.gouache(ctx, x - R * 1.5, y - R * 1.5, R * 3, R * 3, 0.32, seed + 5, Math.max(0.05, R / 140));
    ctx.restore();
    ctx.strokeStyle = INK; ctx.lineJoin = 'round'; ctx.lineWidth = lw; rockPath(ctx, x, y, R, rot, boil, seed); ctx.stroke();
    ctx.restore();
  }

  // ------------------------------------------------------------------ comet
  function FX_comet(ctx, t, x, y, r, dir, o = {}) {
    const A = o.alpha ?? 1; if (A <= 0 || r <= 0) return;
    const L = o.light || LIGHT, boil = o.boil ?? E.boilOf(t), seed = o.seed || 0, hot = clamp(o.hot || 0), lit = clamp(o.lit || 0);
    const len = r * (o.tail ?? 9), curve = o.curve ?? 0.18, np = o.particles ?? 40;
    const td = o.tailDir ?? dir + Math.PI, Tx = Math.cos(td), Ty = Math.sin(td), Nx = -Ty, Ny = Tx;
    const hc = Math.sqrt(hot); // colour turns early so a heating comet reads at once
    const gas = mixc('#3d9cff', '#ff5a24', hc), gas2 = mixc('#8fe6ff', '#ffb04a', hc), dust = mixc('#ffd08a', '#ffb050', hc), coma = mixc('#a8ecff', '#ffcf7a', hc);
    // a point on a tail: u along (0..1), side -1..1 across, wf = width factor, cv = curvature
    const P = (u, side, wf, cv, Lm = 1) => {
      const l = len * Lm * u, wd = r * wf * (0.85 + 3.0 * u) * side;
      return [x + Tx * l + Nx * (cv * len * u * u + wd), y + Ty * l + Ny * (cv * len * u * u + wd)];
    };
    const band = (c, wf, cv, Lm, col, a0, a1mid) => {
      const pts = []; for (let i = 0; i <= 18; i++) pts.push(P(i / 18, 1, wf, cv, Lm)); for (let i = 18; i >= 0; i--) pts.push(P(i / 18, -1, wf, cv, Lm));
      const e = P(1, 0, wf, cv, Lm), g = c.createLinearGradient(x, y, e[0], e[1]);
      g.addColorStop(0, css(col, a0)); g.addColorStop(0.35, css(col, a1mid)); g.addColorStop(1, css(col, 0));
      c.fillStyle = g; c.beginPath(); pts.forEach((p, i) => (i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]))); c.closePath(); c.fill();
    };
    ctx.save(); ctx.globalAlpha *= A; ctx.globalCompositeOperation = 'lighter';
    // 1. dust tail (broad, curved, warm white) and 2. gas tail (straight, narrow, blue, longer)
    const M0 = ctx.getTransform(), dev = r * Math.hypot(M0.a, M0.b), bl = o.bloom ?? dev > 45;
    const lite = o.lite ?? dev < 45;
    const tails = (c, k) => { band(c, 1.0, curve, 1, dust, (lite ? 0.55 : 0.42) * k, 0.2 * k); if (!lite) band(c, 0.45, curve * 0.9, 0.8, dust, 0.45 * k, 0.18 * k); band(c, 0.5, 0, 1.25, gas, 0.55 * k, 0.26 * k); };
    tails(ctx, bl ? 0.55 : lite ? 0.45 : 1);
    if (lite) { ctx.save(); ctx.translate(x, y); ctx.rotate(td); ctx.globalAlpha *= 0.55; ctx.drawImage(sprite(dust, 0), -len * 0.12, -r * 1.7, len * 0.95, r * 3.4); ctx.restore(); } // soft tail body
    const ex = x + Tx * len * 1.25, ey = y + Ty * len * 1.25, pad = r * 4.5;
    if (bl) FX_bloom(ctx, (c) => { c.globalCompositeOperation = 'lighter'; tails(c, 1); }, { r: r * 0.3, wide: 3, strength: 0.5, wideStrength: 0.35, slot: 'comet', box: [Math.min(x, ex) - pad, Math.min(y, ey) - pad, Math.max(x, ex) + pad, Math.max(y, ey) + pad] });
    ctx.lineCap = 'round';
    for (let i = 0; i < (lite ? 2 : 5); i++) {
      const off = (hash(i, 1, seed + 3) - 0.5) * 0.9, Lm = 0.9 + 0.45 * hash(i, 2, seed + 3), e = P(1, 0, 0, 0, Lm);
      if (lite) ctx.strokeStyle = css(gas2, 0.3);
      else { const g = ctx.createLinearGradient(x, y, e[0], e[1]); g.addColorStop(0, css(gas2, 0.55)); g.addColorStop(1, css(gas2, 0)); ctx.strokeStyle = g; } ctx.lineWidth = Math.max(1, r * 0.09); ctx.beginPath();
      for (let k = 0; k <= 14; k++) { const u = k / 14, wv = Math.sin(u * 7 - t * 4 + i * 1.7) * r * 0.22 * u, p = P(u, 0, 0, 0, Lm), s = off * r * (0.6 + 2.2 * u) + wv; k ? ctx.lineTo(p[0] + Nx * s, p[1] + Ny * s) : ctx.moveTo(p[0] + Nx * s, p[1] + Ny * s); }
      ctx.stroke();
    }
    // 3. streaming particles (smooth in t, not stepped: light moves, drawings boil)
    for (let i = 0; i < np; i++) {
      const sp = 0.3 + 0.5 * hash(i, 1, seed), ph = frac(hash(i, 2, seed) + t * sp * (o.flow ?? 1)), isDust = hash(i, 3, seed) < 0.55;
      const side = (hash(i, 4, seed) - 0.5) * 2, u = ph;
      const p = isDust ? P(u, side * 0.85, 1, curve) : P(u, side * 0.45, 0.5, 0, 1.25);
      const sz = r * (0.07 + 0.13 * hash(i, 5, seed)) * (1 - 0.45 * u), a = Math.pow(1 - u, 1.4) * (0.55 + 0.45 * hash(i, 6, seed));
      const col = isDust ? dust : gas2;
      FX_glow(ctx, p[0], p[1], sz * 4.5, col, a * 0.9, 0.75);
      if (!lite) streakFast(ctx, p[0], p[1], p[0] + Tx * sz * 7 * sp, p[1] + Ty * sz * 7 * sp, sz * 1.1, col, a);
    }
    // 4. coma: nested glows, stretched back along the tail into a soft teardrop (emissive, no ink)
    const hood = (len2, wid, col, a, hot2) => {
      ctx.save(); ctx.translate(x, y); ctx.rotate(td); ctx.globalAlpha *= clamp(a);
      ctx.drawImage(sprite(col, hot2), -len2 * 0.32, -wid, len2 * 2, wid * 2); ctx.restore();
    };
    hood(r * 7, r * 3.0, coma, 0.5, 0); if (!lite) hood(r * 5, r * 2.0, gas2, 0.55, 0.25); hood(r * 2.4, r * 1.05, '#eaffff', 0.7, 1);
    ctx.restore();
    FX_glow(ctx, x, y, r * 5, coma, 0.35 * A, 0);
    if (!lite) FX_glow(ctx, x, y, r * 3.2, coma, 0.45 * A, 0.25);
    FX_glow(ctx, x - Tx * r * 0.25, y - Ty * r * 0.25, r * 1.6, '#eaffff', 0.55 * A, 1);
    if (hot > 0) { // bow shock ahead of the nucleus when it heats
      const hc = FX_heat(0.6 + 0.4 * hot);
      FX_glow(ctx, x - Tx * r * 0.7, y - Ty * r * 0.7, r * 3.2, hc, hot * A, 0.75);
    }
    // 5. nucleus: lit rock with jets from the sunlit side
    ctx.save(); ctx.globalAlpha *= A;
    FX_rock(ctx, x, y, r * 0.6, { rot: o.spin ?? (t * 0.35 + seed), boil, seed, light: L, base: mixc('#b3bfd6', '#ffcf94', hot), shade: mixc('#3e456e', '#8a2e2a', hot), hi: mixc('#f6fcff', '#fff4d6', hot), rim: mixc(L.rim, '#ffd27a', hot), lite, craters: lite ? 2 : 4 });
    ctx.globalCompositeOperation = 'lighter';
    for (let j = 0; j < (lite ? 0 : 2); j++) {
      const a = Math.atan2(L.y, L.x) + (j ? 0.5 : -0.35), fl = 0.6 + 0.4 * hash(j, boil, seed + 9);
      const sx = x + Math.cos(a) * r * 0.5, sy = y + Math.sin(a) * r * 0.45;
      streak(ctx, sx, sy, sx + Math.cos(a) * r * 1.6 * fl + Tx * r * 0.6, sy + Math.sin(a) * r * 1.6 * fl + Ty * r * 0.6, r * 0.22, '#f0fdff', 0.5 * fl, r * 0.5);
    }
    ctx.restore();
    // 6. pulse (the pearls lighting up one after another)
    if (lit > 0) { FX_glow(ctx, x, y, r * 6, coma, lit * A, 0.5); FX_glint(ctx, x, y, r * (2.4 + 2.2 * lit), '#e8fbff', lit * A, 0.1); }
  }
  function FX_dustTrain(ctx, pts, w, color = '#9fc8ff', a = 0.25) {
    if (pts.length < 2 || a <= 0) return;
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    [[w * 3, 0.25], [w * 1.6, 0.45], [w * 0.6, 0.7]].forEach(([lw, k]) => {
      ctx.strokeStyle = css(color, a * k); ctx.lineWidth = lw; ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.stroke();
    });
    ctx.restore();
  }

  // ------------------------------------------------------------------ entry fire (probe units: shield curve (-26,4)-(0,24)-(26,4))
  const shieldPt = (u) => { const a = (1 - u) * (1 - u), b = 2 * u * (1 - u), c = u * u; return [-26 * a + 0 * b + 26 * c, 4 * a + 24 * b + 4 * c]; };
  function tongue(v) { const s = frac(v); return Math.pow(Math.sin(s * Math.PI), 0.6); }
  function FX_entryFireBack(ctx, t, x, y, s, ang, heat, o = {}) {
    const boil = o.boil ?? E.boilOf(t), seed = o.seed || 0, L = o.light || LIGHT, smokeA = o.smoke ?? 1;
    ctx.save(); ctx.translate(x, y); ctx.rotate(ang); ctx.scale(s, s);
    const lw = (o.lw ?? 5) / s;
    // smoke trail: two wake streams from the shield rim, cel-shaded puffs with ink, receding up
    if (smokeA > 0) {
      const ca = Math.cos(-ang), sa = Math.sin(-ang), lx = L.x * ca - L.y * sa, ly = L.x * sa + L.y * ca;
      const puffs = [];
      for (let i = 0; i < 26; i++) {
        const side = i % 2 ? 1 : -1, ph = frac(hash(i, 1, seed + 40) + t * (0.9 + 0.3 * hash(i, 2, seed + 40)));
        const d = ph * 320, px = side * (22 + ph * 60) + Math.sin(ph * 9 + i) * 8, py = -6 - d;
        puffs.push({ ph, px, py, r: 9 + ph * 30 + hash(i, 3, seed + 40) * 6, i });
      }
      puffs.sort((a, b) => b.ph - a.ph);
      for (const p of puffs) {
        const a = smokeA * Math.pow(1 - p.ph, 0.8) * smooth(p.ph * 6);
        if (a <= 0.01) continue;
        const firelit = clamp(1 - p.ph * 2.2) * heat;
        ctx.globalAlpha = a;
        ctx.fillStyle = INK; circle(ctx, p.px, p.py, p.r + lw); ctx.fill();
        ctx.fillStyle = css(mixc('#2c1a2e', '#9c3324', firelit)); circle(ctx, p.px, p.py, p.r); ctx.fill();
        ctx.fillStyle = css(mixc('#5a3a52', '#ef6a2c', firelit)); circle(ctx, p.px + lx * p.r * 0.22, p.py + ly * p.r * 0.22, p.r * 0.78); ctx.fill();
        ctx.fillStyle = css(mixc('#8b6478', '#ffb04a', firelit)); circle(ctx, p.px + lx * p.r * 0.45, p.py + ly * p.r * 0.45, p.r * 0.4); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    if (heat > 0) {
      // plasma wake: three nested streaming teardrops, tongues travel back along the flow
      // each layer cools along the flow: hot at the shield rim, darker and transparent at the tip
      const layers = [[1.0, [0.62, 0.42, 0.25], 0.95], [0.74, [0.8, 0.62, 0.45], 0.95], [0.46, [0.97, 0.85, 0.7], 0.95]];
      layers.forEach(([k, hs, a], li) => {
        const Lw = (150 + 50 * heat) * k * (0.94 + 0.06 * Math.sin(t * 23 + li));
        const gr = ctx.createLinearGradient(0, 10, 0, 10 - Lw), aa = a * clamp(heat * 1.4);
        gr.addColorStop(0, css(FX_heat(hs[0] * (0.6 + 0.4 * heat)), aa)); gr.addColorStop(0.45, css(FX_heat(hs[1] * (0.6 + 0.4 * heat)), aa * 0.9)); gr.addColorStop(1, css(FX_heat(hs[2]), 0));
        ctx.fillStyle = gr; ctx.beginPath();
        for (let sd = -1; sd <= 1; sd += 2) {
          const seq = []; for (let i = 0; i <= 22; i++) seq.push(i / 22);
          if (sd > 0) seq.reverse();
          seq.forEach((u, idx) => {
            const wd = 30 * k * Math.pow(1 - u, 0.75) * (1 + 0.35 * Math.sin(u * 2.2)) * (1 + 0.28 * (tongue(u * 5 - t * 7 + sd * 0.37 + li * 0.2) - 0.5) * (0.4 + u));
            const X = sd * wd, Y = 10 - u * Lw;
            (sd < 0 && idx === 0) ? ctx.moveTo(X, Y) : ctx.lineTo(X, Y);
          });
        }
        ctx.closePath(); ctx.fill();
      });
      // bloom on the wake
      FX_bloom(ctx, (g) => {
        const gg = g.createLinearGradient(0, 10, 0, -160); gg.addColorStop(0, css(HEAT_C(0.75), heat)); gg.addColorStop(1, css(HEAT_C(0.4), 0));
        g.fillStyle = gg; g.beginPath(); g.moveTo(-28, 8); g.quadraticCurveTo(-22, -80, 0, -170 * heat); g.quadraticCurveTo(22, -80, 28, 8); g.closePath(); g.fill();
      }, { r: 9, wide: 4, strength: 0.45, wideStrength: 0.7, slot: 'entry', box: [-40, -180, 40, 12] });
      // sparks: ablation embers shed from the rim, streaking back and outward, cooling as they go
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 34; i++) {
        const side = hash(i, 1, seed + 7) < 0.5 ? -1 : 1, sp = 0.8 + 0.9 * hash(i, 2, seed + 7), ph = frac(hash(i, 3, seed + 7) + t * sp * 1.4);
        const x0 = side * (18 + 10 * hash(i, 4, seed + 7)), px = x0 + side * ph * (30 + 70 * hash(i, 5, seed + 7)), py = 4 - ph * (90 + 200 * hash(i, 6, seed + 7));
        const col = FX_heat(1 - ph * 0.75), a = heat * (1 - ph);
        streakFast(ctx, px, py, px - side * 6 * sp, py + 26 * sp, 2.4 * (1 - ph * 0.5), col, a);
      }
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.restore();
  }
  const HEAT_C = (k) => FX_heat(k);
  function FX_entryFireFront(ctx, t, x, y, s, ang, heat, o = {}) {
    if (heat <= 0) return;
    ctx.save(); ctx.translate(x, y); ctx.rotate(ang); ctx.scale(s, s);
    // shield face: white at the stagnation point to orange at the rim (overrides the probe's flat shield)
    const g = ctx.createRadialGradient(0, 16, 0, 0, 12, 30);
    g.addColorStop(0, css(FX_heat(heat), 1)); g.addColorStop(0.35, css(FX_heat(heat * 0.82), 1)); g.addColorStop(0.75, css(FX_heat(heat * 0.6), 1)); g.addColorStop(1, css(FX_heat(heat * 0.42), 1));
    ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(-26, 4); ctx.quadraticCurveTo(0, 24, 26, 4); ctx.quadraticCurveTo(0, 12, -26, 4); ctx.fill();
    ctx.strokeStyle = INK; ctx.lineWidth = 3; ctx.stroke();
    // shock layer: a hot cap of plasma riding just ahead of the shield, wrapping round the rim
    const fl = 1 + 0.04 * Math.sin(t * 31);
    ctx.globalCompositeOperation = 'lighter';
    const cap = (off, col, a) => {
      ctx.fillStyle = css(col, a * heat); ctx.beginPath();
      ctx.moveTo(-30 - off * 0.6, 2); ctx.quadraticCurveTo(0, (26 + off) * fl * 2 - 24, 30 + off * 0.6, 2);
      ctx.quadraticCurveTo(0, 22, -30 - off * 0.6, 2); ctx.closePath(); ctx.fill();
    };
    cap(6, FX_heat(0.55), 0.5); cap(3, FX_heat(0.8), 0.6); cap(1, FX_heat(1), 0.8);
    ctx.globalCompositeOperation = 'source-over';
    ctx.restore();
    const sp = (() => { const c = Math.cos(ang), sn = Math.sin(ang); return [x + (0 * c - 20 * sn) * s, y + (0 * sn + 20 * c) * s]; })();
    FX_glow(ctx, sp[0], sp[1], 70 * s, FX_heat(0.7 * heat), 0.9 * heat, 0.6);
    FX_bloom(ctx, (g2) => {
      g2.save(); g2.translate(x, y); g2.rotate(ang); g2.scale(s, s);
      g2.fillStyle = css(FX_heat(heat), 1); g2.beginPath(); g2.moveTo(-32, 2); g2.quadraticCurveTo(0, 40, 32, 2); g2.quadraticCurveTo(0, 18, -32, 2); g2.fill();
      g2.restore();
    }, { r: 8, wide: 5, strength: heat, wideStrength: 0.9 * heat, slot: 'shield', box: [x - 34 * s, y - 4 * s, x + 34 * s, y + 42 * s] });
  }

  // ------------------------------------------------------------------ sparks, impact, screen light
  function FX_sparks(ctx, t, x, y, t0, o = {}) {
    const age = t - t0, life = o.life ?? 1.1; if (age < 0 || age > life) return;
    const n = o.n ?? 26, seed = o.seed || 0, R = o.R ?? 100, up = o.up, spread = o.spread ?? (up == null ? Math.PI : 1.2), g = o.gravity ?? 0;
    const sq = o.squash ?? 1;
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < n; i++) {
      const a = up == null ? hash(i, 1, seed) * TAU : up + (hash(i, 1, seed) - 0.5) * 2 * spread;
      const v = R * (1.2 + 2.6 * hash(i, 2, seed)), dr = 2.2; // drag
      const dist = v * (1 - Math.exp(-dr * age)) / dr, vel = v * Math.exp(-dr * age);
      const cx = x + Math.cos(a) * dist, cy = y + Math.sin(a) * dist * sq + 0.5 * g * age * age;
      const k = age / (life * (0.6 + 0.4 * hash(i, 3, seed)));
      if (k >= 1) continue;
      const col = FX_heat(1 - k * 0.8), tl = Math.max(R * 0.05, vel * 0.06);
      streakFast(ctx, cx, cy, cx - Math.cos(a) * tl, cy - Math.sin(a) * tl * sq, R * 0.035 * (1.4 - k), col, 1 - k);
    }
    ctx.restore();
  }
  function FX_impactLight(age, o = {}) {
    if (age < 0) return 0;
    const rise = clamp(age / (o.rise ?? 0.05));
    return clamp(rise * (0.62 * Math.exp(-age / (o.fast ?? 0.16)) + 0.38 * Math.exp(-age / (o.slow ?? 1.0))));
  }
  function FX_impact(ctx, t, x, y, R, t0, o = {}) {
    const age = t - t0; if (age < 0) return 0;
    const col = o.color || '#ffc24a', seed = o.seed || 0, sq = o.squash ?? 1, rot = o.rot || 0;
    const lt = FX_impactLight(age, o);
    if (lt < 0.003 && age > 3) return 0;
    // lingering glow: wide, cools from gold to deep orange-red
    const cool = clamp(age / 2.2);
    FX_glow(ctx, x, y, R * (2.4 + 1.6 * clamp(age)), mixc(col, '#e0461e', cool), 0.85 * Math.exp(-age / 1.4), 0);
    // core flash
    FX_glow(ctx, x, y, R * (0.9 + 0.5 * clamp(age * 4)), mixc('#fffaf0', col, cool), lt * 1.6, 1);
    // glint
    FX_glint(ctx, x, y, R * (0.8 + 1.4 * Math.exp(-age / 0.2)), '#fff2c8', 0.85 * Math.exp(-age / 0.28), rot + 0.2);
    // shockwave ring(s)
    if (o.ring !== false) {
      const k = clamp(age / (o.ringT ?? 0.9)), rr = R * (0.3 + 2.8 * (1 - Math.pow(1 - k, 3)));
      if (k < 1) {
        ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.translate(x, y); ctx.rotate(rot); ctx.scale(1, sq);
        ctx.lineWidth = R * 0.42 * (1 - k); ctx.strokeStyle = css(col, 0.35 * (1 - k)); circle(ctx, 0, 0, rr); ctx.stroke();
        ctx.lineWidth = R * 0.06 * (1 - k * 0.7); ctx.strokeStyle = css('#fff6e0', 0.7 * (1 - k) * (1 - k)); circle(ctx, 0, 0, rr); ctx.stroke();
        const k2 = clamp((age - 0.12) / 0.8);
        if (k2 > 0 && k2 < 1) { ctx.lineWidth = R * 0.05; ctx.strokeStyle = css(col, 0.6 * (1 - k2)); circle(ctx, 0, 0, R * (0.2 + 1.9 * (1 - Math.pow(1 - k2, 3)))); ctx.stroke(); }
        ctx.restore();
      }
    }
    // debris sparks
    FX_sparks(ctx, t, x, y, t0, { n: o.sparks ?? 26, seed: seed + 11, R, up: o.up ?? null, spread: o.spread, squash: sq, life: o.sparkLife ?? 1.2, gravity: o.gravity ?? 0 });
    return lt;
  }
  function FX_screenLight(ctx, k, x, y, o = {}) {
    k = clamp(k); if (k <= 0.002) return;
    const B = E.getBase(), M = ctx.getTransform(), p = B.inverse().multiply(M).transformPoint(new DOMPoint(x, y));
    const R = o.radius ?? 1500, color = o.color || '#fff1cf', tint = o.tint || '#ffb347', deep = o.deep || '#2a1038';
    ctx.save(); ctx.setTransform(B);
    // 1. tint: warms every colour while keeping darks dark (soft-light, not a white fill)
    if (k > 0.08) { ctx.globalCompositeOperation = 'soft-light'; ctx.fillStyle = css(tint, 0.85 * k); ctx.fillRect(0, 0, W, H); }
    // 2. lift around the source (screen): what is near the flash washes toward the flash colour
    ctx.globalCompositeOperation = 'screen';
    const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, R);
    g.addColorStop(0, css(color, 0.95 * k)); g.addColorStop(0.18, css(color, 0.6 * k)); g.addColorStop(0.5, css(tint, 0.22 * k)); g.addColorStop(1, css(tint, 0));
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    // 3. contrast keeper: far side sinks into a deep hue, so the frame stays high contrast at full flash
    if (k > 0.35) {
    ctx.globalCompositeOperation = 'multiply';
    const g2 = ctx.createRadialGradient(p.x, p.y, R * 0.3, p.x, p.y, R * 1.25);
    g2.addColorStop(0, 'rgba(255,255,255,0)'); g2.addColorStop(1, css(mixc('#ffffff', deep, 0.55 * k), 1));
    ctx.fillStyle = g2; ctx.fillRect(0, 0, W, H);
    }
    ctx.restore();
  }

  // ------------------------------------------------------------------ fireball plume
  const PUFFS = {};
  function puffSet(seed) { // unit puffs: x in widths, y in heights (up = -1); g = draw group (0 back, 1 front)
    if (PUFFS[seed]) return PUFFS[seed];
    const P = [];
    for (let k = 0; k < 11; k++) { const a = -Math.PI * (0.05 + 0.9 * (k / 10)); P.push({ g: 0, cap: 1, u: 0.86, x: Math.cos(a) * 0.6, y: -0.84 + Math.sin(a) * 0.2, r: 0.32 + 0.12 * hash(k, 4, seed), ph: hash(k, 5, seed) }); }
    for (let k = 0; k < 10; k++) { const u = (k / 9) * 0.66, sd = k % 2 ? 1 : -1; P.push({ g: 0, cap: 0, u, x: sd * (0.17 + 0.05 * hash(k, 1, seed)) * (1 - 0.3 * u), y: -u, r: 0.17 + 0.06 * hash(k, 2, seed) + 0.06 * u, ph: hash(k, 3, seed) }); }
    for (let k = 0; k < 5; k++) P.push({ g: 1, cap: 1, u: 0.86, x: (k / 4 - 0.5) * 0.8, y: -0.86 + (hash(k, 9, seed) - 0.5) * 0.08, r: 0.34 + 0.06 * hash(k, 8, seed), ph: hash(k, 10, seed) });
    for (let k = 0; k < 7; k++) { const a = Math.PI * (0.1 + 0.8 * (k / 6)); P.push({ g: 1, cap: 1, u: 0.8, x: Math.cos(a) * 0.62, y: -0.74 + Math.sin(a) * 0.09, r: 0.24 + 0.08 * hash(k, 6, seed), ph: hash(k, 7, seed) }); }
    return (PUFFS[seed] = P);
  }
  const CEL = { hot: ['#ff6a24', '#ffb03e', '#fff0bc'], warm: ['#9a2a2c', '#e0582c', '#ffa04c'], smoke: ['#2a1630', '#5a2f4c', '#8e5468'] };
  function celTones(h) {
    return [0, 1, 2].map((i) => (h > 0.5 ? mixc(CEL.warm[i], CEL.hot[i], (h - 0.5) * 2) : mixc(CEL.smoke[i], CEL.warm[i], h * 2)));
  }
  function FX_plume(ctx, t, x, y, Hh, o = {}) {
    const rise = clamp(o.rise ?? 1), spread = clamp(o.spread ?? 0), fade = clamp(o.fade ?? 1);
    if (rise <= 0 || fade <= 0) return;
    const ang = o.ang ?? -Math.PI / 2, seed = o.seed || 1, boil = o.boil ?? E.boilOf(t), L = o.light || LIGHT;
    const h = Hh * rise * (1 - 0.4 * spread), w = (o.w ?? Hh * 0.55) * (0.45 + 0.55 * rise) * (1 + 1.1 * spread), lw = o.lw ?? 5;
    const rot = ang + Math.PI / 2, ca = Math.cos(-rot), sa = Math.sin(-rot);
    const klx = L.x * ca - L.y * sa, kly = L.x * sa + L.y * ca; // key light in plume space
    const core = clamp(1 - spread * 0.9), top = -h * 0.8;
    const jit = (i) => (hash(i, boil, seed) - 0.5) * w * 0.012;
    ctx.save(); ctx.globalAlpha *= fade; ctx.translate(x, y); ctx.rotate(rot);
    FX_glow(ctx, 0, -h * 0.2, w * 1.7, FX_heat(0.72), 0.8 * (1 - spread * 0.6), 0.4);
    const P = puffSet(seed).map((p, i) => {
      const vis = smooth((rise * 1.08 - p.u) / 0.14); if (vis <= 0) return null;
      const out = p.cap ? 1 + spread * 0.8 : 1;
      let px = p.x * w * out + jit(i), py = p.y * h + jit(i + 50);
      if (p.cap) py += spread * h * 0.4 * Math.abs(p.x); // the cap droops and falls back as it spreads
      const r = p.r * w * vis * (p.cap ? 1 : 1 - spread * 0.5) * (1 + 0.05 * Math.sin(t * 3 + p.ph * 6));
      const heat = clamp(1.15 - p.u * 0.55 - spread * 0.85 - Math.abs(p.x) * 0.35 - (p.g === 0 && p.cap ? 0.2 : 0) + (1 - rise) * 0.3);
      return { px, py, r, heat, g: p.g, i };
    }).filter((p) => p && p.r > 0.3);
    const group = (g) => {
      const G = P.filter((p) => p.g === g);
      ctx.fillStyle = INK; G.forEach((p) => { circle(ctx, p.px, p.py, p.r + lw); ctx.fill(); }); // one silhouette ink pass per group
      G.forEach((p) => {
        const [s0, s1, s2] = celTones(p.heat);
        ctx.fillStyle = css(s0); circle(ctx, p.px, p.py, p.r); ctx.fill();
        ctx.fillStyle = css(s1); circle(ctx, p.px + klx * p.r * 0.22, p.py + kly * p.r * 0.22, p.r * 0.8); ctx.fill();
        ctx.save(); circle(ctx, p.px, p.py, p.r); ctx.clip();
        ctx.fillStyle = css(s2); circle(ctx, p.px + klx * p.r * 0.62, p.py + kly * p.r * 0.62, p.r * 0.62); ctx.fill(); // lit edge
        const cy = clamp(p.py, top, 0), dx = -p.px, dy = cy - p.py, d = Math.hypot(dx, dy) || 1, prox = clamp(1.15 - d / (w * 0.75)) * core;
        if (prox > 0) { // underside lit by the fire inside
          ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = css(FX_heat(0.7), 0.6 * prox);
          circle(ctx, p.px + dx / d * p.r * 0.6, p.py + dy / d * p.r * 0.6, p.r * 0.7); ctx.fill(); ctx.globalCompositeOperation = 'source-over';
        }
        ctx.restore();
        ctx.strokeStyle = INK; ctx.lineWidth = lw * 0.7; ctx.lineCap = 'round'; // inner ink: only the shadow-side bump edge
        const sh = Math.atan2(-kly, -klx); ctx.beginPath(); ctx.arc(p.px, p.py, Math.max(0.1, p.r - lw * 0.35), sh - 0.9, sh + 0.9); ctx.stroke();
      });
    };
    group(0);
    // emissive core: toon fire column (orange, gold, white) between the back and front billows
    const column = (c, sc, ph) => {
      const bw = w * 0.2 * sc; c.beginPath(); c.moveTo(-bw, 0);
      for (let i = 1; i <= 12; i++) { const u = i / 12, wv = 1 + 0.16 * Math.sin(u * 11 - t * 9 + ph); c.lineTo(-bw * (1 - u * 0.5) * wv, top * u * (0.75 + 0.25 * sc)); }
      for (let i = 12; i >= 1; i--) { const u = i / 12, wv = 1 + 0.16 * Math.sin(u * 11 - t * 9 + ph + 2.1); c.lineTo(bw * (1 - u * 0.5) * wv, top * u * (0.75 + 0.25 * sc)); }
      c.lineTo(bw, 0); c.closePath();
    };
    if (core > 0) {
      ctx.save(); ctx.globalAlpha *= core;
      [[1, 0.58, 0], [0.68, 0.82, 1], [0.36, 1, 2]].forEach(([sc, hk, ph]) => { ctx.fillStyle = css(FX_heat(hk)); column(ctx, sc, ph); ctx.fill(); });
      ctx.restore();
      FX_bloom(ctx, (c) => { c.fillStyle = css('#ffc85a', core * fade); column(c, 1.1, 0); c.fill(); }, { r: w * 0.09, wide: 4, strength: 0.9, wideStrength: 1, slot: 'plume', box: [-w * 0.3, top * 1.05, w * 0.3, w * 0.05] });
      FX_glow(ctx, 0, 0, w * 0.75, '#fff2c4', core, 1);
    }
    group(1);
    ctx.restore();
  }

  // ------------------------------------------------------------------ lightning
  const BOLTS = new Map();
  function jag(x0, y0, x1, y1, seed, rough, depth) {
    let pts = [[x0, y0], [x1, y1]], disp = Math.hypot(x1 - x0, y1 - y0) * rough;
    for (let d = 0; d < depth; d++) {
      const np = [pts[0]];
      for (let i = 1; i < pts.length; i++) {
        const [ax, ay] = pts[i - 1], [bx, by] = pts[i], dx = bx - ax, dy = by - ay, l = Math.hypot(dx, dy) || 1;
        const off = (hash(i, d, seed) - 0.5) * 2 * disp;
        np.push([(ax + bx) / 2 - dy / l * off, (ay + by) / 2 + dx / l * off], pts[i]);
      }
      pts = np; disp *= 0.55;
    }
    return pts;
  }
  function boltGeom(x0, y0, x1, y1, seed, nb, rough) {
    const key = [x0, y0, x1, y1, seed, nb, rough].map((v) => Math.round(v * 10)).join(',');
    let g = BOLTS.get(key); if (g) return g;
    const len = Math.hypot(x1 - x0, y1 - y0), main = jag(x0, y0, x1, y1, seed, rough, 6), br = [];
    for (let b = 0; b < nb; b++) {
      const idx = Math.floor(lerp(0.06, 0.8, hash(b, 1, seed)) * (main.length - 2)) + 1, [sx, sy] = main[idx];
      const [ax, ay] = main[idx - 1], base = Math.atan2(sy - ay, sx - ax), sg = hash(b, 2, seed) < 0.5 ? -1 : 1;
      const a = base + sg * (0.35 + 0.6 * hash(b, 3, seed)), bl = len * (0.12 + 0.26 * hash(b, 4, seed)) * (1 - idx / main.length * 0.5);
      const pts = jag(sx, sy, sx + Math.cos(a) * bl, sy + Math.sin(a) * bl, seed + b * 13, 0.28, 4);
      br.push({ pts, w: 0.5 });
      const ns = hash(b, 5, seed) < 0.6 ? 2 : 1;
      for (let s = 0; s < ns; s++) {
        const j = Math.floor(lerp(0.25, 0.75, hash(b, 6 + s, seed)) * (pts.length - 1)), [qx, qy] = pts[j], a2 = a + (hash(b, 8 + s, seed) < 0.5 ? -1 : 1) * (0.4 + 0.5 * hash(b, 10 + s, seed));
        const l2 = bl * (0.3 + 0.3 * hash(b, 12 + s, seed));
        br.push({ pts: jag(qx, qy, qx + Math.cos(a2) * l2, qy + Math.sin(a2) * l2, seed + b * 31 + s, 0.3, 3), w: 0.28 });
      }
    }
    g = { main, branches: br, len }; BOLTS.set(key, g); if (BOLTS.size > 200) BOLTS.delete(BOLTS.keys().next().value);
    return g;
  }
  function strokeTaper(c, pts, w0, w1, color) {
    c.strokeStyle = color; c.lineCap = 'round'; c.lineJoin = 'round';
    const n = pts.length - 1, step = Math.max(1, Math.ceil(n / 4));
    for (let i = 0; i < n; i += step) {
      c.lineWidth = Math.max(0.3, lerp(w0, w1, i / n)); c.beginPath(); c.moveTo(pts[i][0], pts[i][1]);
      for (let j = i + 1; j <= Math.min(n, i + step); j++) c.lineTo(pts[j][0], pts[j][1]);
      c.stroke();
    }
  }
  function FX_lightningFlicker(age) {
    if (age < 0) return 0;
    const f = Math.floor(age * 15); // stop-motion steps
    const seq = [1, 0.35, 1, 0.85, 0.5, 0.75, 0.4, 0.25, 0.15, 0.08];
    return f < seq.length ? seq[f] : 0;
  }
  function FX_lightning(ctx, t, x0, y0, x1, y1, o = {}) {
    const a = clamp(o.a ?? 1), w = o.w ?? 6, glowC = o.glow || '#9fb2ff', coreC = o.core || '#ffffff';
    const geo = boltGeom(x0, y0, x1, y1, o.seed || 1, o.branches ?? 8, o.rough ?? 0.2);
    if (a <= 0) return geo;
    const all = (c, mul, col, al) => {
      c.globalAlpha = al; strokeTaper(c, geo.main, w * mul, w * mul * 0.6, col);
      geo.branches.forEach((b) => strokeTaper(c, b.pts, w * b.w * mul, w * b.w * mul * 0.15, col));
    };
    FX_glow(ctx, x0, y0, geo.len * 0.45, glowC, 0.7 * a, 0.2);
    FX_glow(ctx, x1, y1, geo.len * 0.3, glowC, 0.55 * a, 0.4);
    if (!geo.box) { const P = geo.main.concat(...geo.branches.map((b) => b.pts)); geo.box = [Math.min(...P.map((p) => p[0])), Math.min(...P.map((p) => p[1])), Math.max(...P.map((p) => p[0])), Math.max(...P.map((p) => p[1]))]; }
    FX_bloom(ctx, (c) => all(c, 3.2, css(glowC), 1), { r: w * 1.6, wide: 5, strength: 1.4 * a, wideStrength: 1.1 * a, slot: 'bolt', key: o.key, box: geo.box });
    ctx.save(); ctx.globalAlpha *= 1;
    all(ctx, 2.0, css(glowC, 0.85 * a), 1);
    ctx.globalAlpha = 1; all(ctx, 0.85, css(coreC, a), 1);
    ctx.restore();
    return geo;
  }
  // x may be a number (with y) or an array of [x, y] light points (one clip, several lights)
  function FX_illuminate(ctx, pathFn, x, y, R, color, a = 1) {
    if (a <= 0) return;
    const pts = Array.isArray(x) ? x : [[x, y]];
    ctx.save(); pathFn(ctx); ctx.clip();
    ctx.globalCompositeOperation = 'lighter';
    for (const [px, py] of pts) {
      const g = ctx.createRadialGradient(px, py, 0, px, py, R);
      g.addColorStop(0, css(color, 0.75 * a)); g.addColorStop(0.35, css(color, 0.35 * a)); g.addColorStop(1, css(color, 0));
      ctx.fillStyle = g; ctx.fillRect(px - R, py - R, 2 * R, 2 * R);
    }
    ctx.restore();
  }

  // ------------------------------------------------------------------ speed lines
  function FX_speedLines(ctx, t, o = {}) {
    const mode = o.mode || 'parallel', n = o.n ?? 26, seed = o.seed || 1, col = o.color || '#ffffff', al = o.alpha ?? 0.6;
    const len = o.len || [140, 420], w = o.w ?? 4, speed = o.speed ?? 2400;
    ctx.save(); if (o.additive !== false) ctx.globalCompositeOperation = 'lighter';
    if (mode === 'radial') {
      const cx = o.cx ?? 960, cy = o.cy ?? 540, Rm = o.R ?? 1300;
      for (let i = 0; i < n; i++) {
        const a = hash(i, 1, seed) * TAU, ph = frac(hash(i, 2, seed) + t * speed / Rm * (0.6 + 0.8 * hash(i, 3, seed)));
        const d = Rm * ph * ph, l = lerp(len[0], len[1], hash(i, 4, seed)) * ph, ca = Math.cos(a), sa = Math.sin(a);
        streak(ctx, cx + ca * (d + l), cy + sa * (d + l), cx + ca * d, cy + sa * d, w * (0.4 + ph), col, al * smooth(ph * 3));
      }
    } else {
      const dir = o.dir ?? Math.PI / 2, dx = Math.cos(dir), dy = Math.sin(dir), nx = -dy, ny = dx;
      const span = Math.abs(dx) * W + Math.abs(dy) * H + len[1] * 2, cross = Math.abs(nx) * W + Math.abs(ny) * H;
      const cx = o.cx ?? 960, cy = o.cy ?? 540;
      for (let i = 0; i < n; i++) {
        const c = (hash(i, 1, seed) - 0.5) * cross, sp = 0.6 + 0.8 * hash(i, 3, seed), l = lerp(len[0], len[1], hash(i, 4, seed)) * sp;
        const along = frac(hash(i, 2, seed) + t * speed * sp / span) * span - span / 2;
        const hx = cx + nx * c + dx * along, hy = cy + ny * c + dy * along;
        streak(ctx, hx, hy, hx - dx * l, hy - dy * l, w * (0.5 + 0.7 * hash(i, 5, seed)), col, al * (0.5 + 0.5 * hash(i, 6, seed)));
      }
      const nd = o.dust ?? 0;
      for (let i = 0; i < nd; i++) { // dust motes: short, slower, parallax depth
        const c = (hash(i, 7, seed) - 0.5) * cross, sp = 0.25 + 0.5 * hash(i, 8, seed), along = frac(hash(i, 9, seed) + t * speed * sp / span) * span - span / 2;
        const hx = cx + nx * c + dx * along, hy = cy + ny * c + dy * along, r = 1.5 + 2.5 * hash(i, 10, seed);
        streakFast(ctx, hx, hy, hx - dx * r * 8 * sp, hy - dy * r * 8 * sp, r * 1.6, col, al * 0.8);
      }
    }
    ctx.restore();
  }

  window.FX = { FX_glow, FX_glint, FX_bloom, FX_heat, FX_rock, FX_comet, FX_dustTrain, FX_entryFireBack, FX_entryFireFront,
    FX_impact, FX_impactLight, FX_screenLight, FX_sparks, FX_plume, FX_lightning, FX_lightningFlicker, FX_illuminate, FX_speedLines,
    FX_css: css, FX_mix: mixc, FX_LIGHT: LIGHT, FX_INK: INK };
  Object.assign(window, window.FX);
})();
