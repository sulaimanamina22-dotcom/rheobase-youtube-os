// =====================================================================================
// CHAR: the Rheobase astronaut. Original design (cobalt + gold on warm white, big
// bubble visor, chunky 2.8-head proportions). Plain 2D canvas, deterministic in t.
//
// CALL
//   const r = CHAR_astronaut(ctx, x, y, scale, pose, t, light, opts)
//     x, y    figure origin (chest centre) in the CURRENT transform's units
//     scale   figure units -> current units. The figure is about 150 units tall
//             (helmet top -75 to boot sole +75), so scale 5 is about 750 px tall.
//     pose    a preset name ('fall' | 'dive' | 'float' | 'stand' | 'wave'),
//             a pose object (see DEF below), or a function t => pose object.
//             Names and functions get follow-through (spring lag + overshoot on
//             limbs and head) and lagging hoses/tether. Static objects do not.
//             Blend: pose = (t) => CHAR_blend(CHAR_pose('dive', t), CHAR_pose('float', t), k(t))
//     t       seconds
//     light   { x:-0.55, y:-0.83, key:'#fff4e0', rim:'#7fd8ff', amb:0.35 } (screen space,
//             vector TOWARD the key light). null = this default.
//     opts    { visorFill(ctx, v), face (0..1, default 1, or 0 when visorFill is set),
//               wind [wx, wy] (screen dir * strength 0..1.5, streams hoses + tether),
//               accent '#hex' (replaces cobalt), env {sky:'#hex', ground:'#hex'} (visor reflection tint),
//               glass 1 (visor reflections; fade to 0 while the camera pushes into the visor),
//               lineScale 1, boil (int, default floor(t*15)), ink '#120d1c', tether true, glow true,
//               spring true, detail 1 (0 = skip seams/ribs, auto-drops for tiny figures) }
//   returns { M, visor, frame }:
//     M      DOMMatrix figure units -> current units
//     visor  { x, y, rx, ry, rot } of the visor ellipse in current units (rot in radians)
//     frame  DOMMatrix that maps a full 1920x1080 frame onto a 16:9 rect of height 2*visor.ry
//            centred on the visor, in current units (nest a scene: scene(ctx, t, ctx.getTransform().multiply(frame)))
//   visorFill(ctx, v): called with ctx in FIGURE units, already clipped to the glass;
//            v = { x, y, rx, ry, rot, frame } in figure units (frame as above, in figure units).
//
//   CHAR_visor(x, y, scale, pose, t)   -> same { M, visor, frame } with no drawing (for camera
//            push-ins: zoom so that visor.ry * zoom >= 540 and visor.rx * zoom >= 960).
//   CHAR_pose(name, t)                 -> pose object of a preset at time t
//   CHAR_blend(a, b, k)                -> lerped pose (angles lerp numerically)
//
// Light convention: key from upper left, cool rim from lower right, cel shading with a hard
// terminator (shape shifted toward the light = lit tone), soft gradient inside each tone,
// rim crescent, cast shadows of parts onto parts drawn before them, ink silhouette heavier on
// the shadow side, thin inner lines, bloom on lamps.
// =====================================================================================
(function (root) {
  'use strict';
  const TAU = Math.PI * 2;
  const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
  const lerp = (a, b, k) => a + (b - a) * k;
  const sstep = (k) => { k = clamp(k); return k * k * (3 - 2 * k); };
  function hash(a, b = 0, c = 0) {
    let h = (a * 374761393 + b * 668265263 + c * 2147483647) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }

  // ------------------------------------------------------------------ colour
  const RGB = (c) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
  const mixA = (A, B, k) => [lerp(A[0], B[0], k), lerp(A[1], B[1], k), lerp(A[2], B[2], k)];
  const css = (A, a = 1) => `rgba(${A[0] | 0},${A[1] | 0},${A[2] | 0},${a})`;
  const MAT = {
    suit:   { base: '#e8e2d8', shade: '#a39fd0', core: '#7d77b8', hi: '#ffffff' },
    pack:   { base: '#d6d1e2', shade: '#8f8ac2', core: '#6a64a6', hi: '#ffffff' },
    helmet: { base: '#ece6dc', shade: '#a8a4d6', core: '#7b76ba', hi: '#ffffff' },
    accent: { base: '#2f5bff', shade: '#1b2391', core: '#151a6e', hi: '#9ab6ff' },
    gold:   { base: '#ffc43d', shade: '#d06e17', core: '#a84d10', hi: '#fff3bf' },
    slate:  { base: '#4c5379', shade: '#272a49', core: '#1b1d36', hi: '#9aa2d0' },
  };
  const DEF_LIGHT = { x: -0.55, y: -0.83, key: '#fff4e0', rim: '#7fd8ff', amb: 0.35 };
  let colCache = new Map();
  function colors(m, light, accent) {
    const key = m + '|' + light.key + light.rim + light.amb + (m === 'accent' ? accent || '' : '');
    let C = colCache.get(key); if (C) return C;
    if (colCache.size > 200) colCache = new Map();
    const M = MAT[m], K = RGB(light.key || '#fff4e0'), Rm = RGB(light.rim || '#7fd8ff');
    let base = RGB(M.base), shade = RGB(M.shade), core = RGB(M.core), hi = RGB(M.hi);
    if (m === 'accent' && accent) { base = RGB(accent); shade = mixA(base, [20, 14, 60], 0.55); core = mixA(base, [14, 10, 40], 0.72); hi = mixA(base, [255, 255, 255], 0.55); }
    const amb = clamp((light.amb ?? 0.35) - 0.35, -0.3, 0.5);
    shade = amb >= 0 ? mixA(shade, base, amb) : mixA(shade, core, -amb * 2);
    C = { lit: css(mixA(base, K, 0.16)), hi: css(mixA(hi, K, 0.25)), shade: css(shade), core: css(core),
      rim: css(mixA(Rm, [255, 255, 255], 0.25)), litA: mixA(base, K, 0.16) };
    colCache.set(key, C); return C;
  }

  // ------------------------------------------------------------------ pose
  // Angles in radians. Arm: r = raise in the frontal plane (0 down, PI/2 out, PI up), f = swing
  // toward the camera, b = elbow bend, w = bend direction (0 forward, 1 inward).
  // Leg: s = spread, f = hip flex (forward), k = knee bend, a = ankle.
  // yaw (0 faces camera, +turns to screen right), pitch (+ top leans away), roll (screen rotation),
  // hp head pitch (+ looks down), hy head yaw, hr head roll, mood (-1 scared .. 0 .. 1 smile), eyes (open).
  const DEF = { yaw: 0, pitch: 0, roll: 0, hp: 0, hy: 0, hr: 0,
    aLr: 0.35, aLf: 0.05, aLb: 0.25, aLw: 0.3, aRr: 0.35, aRf: 0.05, aRb: 0.25, aRw: 0.3,
    lLs: 0.1, lLf: 0.0, lLk: 0.08, lLa: 0, lRs: 0.1, lRf: 0.0, lRk: 0.08, lRa: 0, mood: 0, eyes: 1, gaze: 0 };
  const KEYS = Object.keys(DEF);
  const S = Math.sin;
  const POSES = {
    stand: (t) => ({}),
    // feet first, arms up and flailing, legs bicycling at nothing, head looking down into the void
    fall: (t) => ({
      yaw: 0.42 + 0.1 * S(t * 0.9), pitch: 0.12, roll: 0.07 * S(t * 1.7),
      hp: 0.42 + 0.12 * S(t * 2.3), hy: 0.22 * S(t * 1.1 + 0.5), hr: 0.12 * S(t * 1.6),
      aLr: 2.3 + 0.36 * S(t * 6.3), aLf: 0.05 + 0.22 * S(t * 6.3 + 1.1), aLb: 0.75 + 0.5 * S(t * 6.3 + 2.0), aLw: 0.5,
      aRr: 2.25 + 0.36 * S(t * 7.1 + 1.4), aRf: 0.05 + 0.22 * S(t * 7.1 + 2.6), aRb: 0.7 + 0.5 * S(t * 7.1 + 3.3), aRw: 0.5,
      lLs: 0.2, lLf: 0.3 + 0.55 * S(t * 8.4), lLk: 0.75 + 0.6 * S(t * 8.4 - 1.3), lLa: 0.3 * S(t * 8.4 - 2),
      lRs: 0.22, lRf: 0.3 + 0.55 * S(t * 8.4 + Math.PI), lRk: 0.75 + 0.6 * S(t * 8.4 + Math.PI - 1.3), lRa: 0.3 * S(t * 8.4 + 1.1),
      mood: -1, eyes: 1.2, gaze: 0.25 * S(t * 1.3) }),
    // head first, arms reaching ahead, legs trailing with a slow flutter
    dive: (t) => ({
      yaw: -0.55 + 0.06 * S(t * 1.2), pitch: 0.25, roll: Math.PI + 0.1 * S(t * 2),
      hp: -0.55, hy: 0.1 * S(t * 1.4), hr: 0.05 * S(t * 1.9),
      aLr: 2.85, aLf: 0.35 + 0.1 * S(t * 4.5), aLb: 0.25 + 0.15 * S(t * 4.5 + 1), aLw: 0.6,
      aRr: 2.75, aRf: 0.3 + 0.1 * S(t * 4.5 + 1.5), aRb: 0.3 + 0.15 * S(t * 4.5 + 2.4), aRw: 0.6,
      lLs: 0.12, lLf: -0.15 + 0.25 * S(t * 5), lLk: 0.35 + 0.25 * S(t * 5 - 1), lLa: -0.2,
      lRs: 0.1, lRf: -0.15 + 0.25 * S(t * 5 + Math.PI), lRk: 0.35 + 0.25 * S(t * 5 + Math.PI - 1), lRa: -0.2,
      mood: 0.1, eyes: 1, gaze: 0 }),
    // facing camera, arms out, drifting
    float: (t) => ({
      yaw: 0.1 * S(t * 0.5), pitch: 0.06, roll: 0.06 * S(t * 0.7),
      hp: -0.06 + 0.05 * S(t * 0.9), hy: 0.12 * S(t * 0.6 + 1), hr: 0.13 + 0.04 * S(t * 0.8),
      aLr: 1.22 + 0.09 * S(t * 1.3), aLf: 0.18, aLb: 0.4 + 0.08 * S(t * 1.3 + 1), aLw: 0.2,
      aRr: 1.1 + 0.09 * S(t * 1.3 + 1.2), aRf: 0.12, aRb: 0.5 + 0.08 * S(t * 1.3 + 2), aRw: 0.2,
      lLs: 0.22, lLf: 0.18 + 0.05 * S(t * 1.1), lLk: 0.25, lLa: 0.1,
      lRs: 0.14, lRf: -0.08 + 0.05 * S(t * 1.1 + 1), lRk: 0.6, lRa: 0.15,
      mood: 0.45, eyes: 1, gaze: 0.15 * S(t * 0.7) }),
    wave: (t) => ({ yaw: 0.25, hp: 0.05, hr: 0.1, aRr: 2.6, aRf: 0.3, aRb: 0.9 + 0.35 * S(t * 7), aRw: 0.9, aLr: 0.4, aLb: 0.4, lRk: 0.2, mood: 1 }),
  };
  function CHAR_pose(name, t) { return Object.assign({}, DEF, (POSES[name] || POSES.stand)(t)); }
  function CHAR_blend(a, b, k) { const o = {}; for (const key of KEYS) o[key] = lerp(a[key] ?? DEF[key], b[key] ?? DEF[key], k); return o; }

  // spring follow-through: response of an under-damped spring to the pose history (overshoot built in)
  const SPR = { dt: 1 / 60, n: 32 };
  function kernel(w, z) {
    const wd = w * Math.sqrt(1 - z * z), ks = []; let s = 0;
    for (let i = 0; i < SPR.n; i++) { const tau = (i + 0.5) * SPR.dt; const h = Math.exp(-z * w * tau) * Math.sin(wd * tau); ks.push(h); s += h; }
    return ks.map((h) => h / s);
  }
  const K_UP = kernel(17, 0.55), K_LO = kernel(13, 0.36), K_HEAD = kernel(11, 0.45);
  const CH_UP = ['aLr', 'aLf', 'aRr', 'aRf', 'lLs', 'lLf', 'lRs', 'lRf'], CH_LO = ['aLb', 'aRb', 'lLk', 'lRk', 'lLa', 'lRa', 'aLw', 'aRw'], CH_HEAD = ['hp', 'hy', 'hr'];
  function resolve(pose, t, spring) {
    const fn = typeof pose === 'string' ? (tt) => CHAR_pose(pose, tt) : typeof pose === 'function' ? (tt) => Object.assign({}, DEF, pose(tt)) : null;
    if (!fn) return { p: Object.assign({}, DEF, pose || {}), fn: null };
    const p = fn(t);
    if (!spring) return { p, fn };
    const hist = []; for (let i = 0; i < SPR.n; i++) hist.push(i ? fn(t - (i + 0.5) * SPR.dt) : p);
    const apply = (chs, K) => { for (const c of chs) { let s = 0; for (let i = 0; i < SPR.n; i++) s += K[i] * hist[i][c]; p[c] = s; } };
    // keep the newest sample dominant enough that big deliberate moves still land
    apply(CH_UP, K_UP); apply(CH_LO, K_LO); apply(CH_HEAD, K_HEAD);
    return { p, fn };
  }

  // ------------------------------------------------------------------ 3D helpers
  const rotY = (p, a) => [p[0] * Math.cos(a) + p[2] * Math.sin(a), p[1], -p[0] * Math.sin(a) + p[2] * Math.cos(a)];
  const rotX = (p, a) => [p[0], p[1] * Math.cos(a) - p[2] * Math.sin(a), p[1] * Math.sin(a) + p[2] * Math.cos(a)];
  const rotZ = (p, a) => [p[0] * Math.cos(a) - p[1] * Math.sin(a), p[0] * Math.sin(a) + p[1] * Math.cos(a), p[2]];
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  const orth = (v, d) => norm(sub(v, mul(d, dot(v, d))));
  const n2 = (x, y) => { const l = Math.hypot(x, y) || 1; return [x / l, y / l]; };

  // body proportions (figure units, y down, origin at chest)
  const B = { neck: [0, -27, 0], pelvis: [0, 23, 0], sh: 25, shY: -18, hipX: 11.5, hipY: 22, ua: 19, fa: 16, th: 20, sn: 19,
    headPivot: [0, -27, 0], headOff: [0, -22, 0], R: 25, vX: 19.5, vY: 15.5, vD: 13.5, tW: 25, bW: 21, tD: 19, pack: [0, -9, -21] };

  function rig(p) {
    const body = (v) => rotX(rotY(v, p.yaw), -p.pitch);
    const P = (v) => body(v); // position (orthographic, depth = z)
    const head = (v) => body(rotY(rotX(rotZ(v, p.hr), -p.hp), p.hy));
    const R = {};
    R.neck = P(B.neck); R.pelvis = P(B.pelvis); R.chest = P([0, -3, 0]);
    R.hc = add(P(B.headPivot), head(B.headOff));
    R.hR = head([1, 0, 0]); R.hD = head([0, 1, 0]); R.hF = head([0, 0, 1]);
    R.bR = body([1, 0, 0]); R.bD = body([0, 1, 0]); R.bF = body([0, 0, 1]);
    R.pack = P(B.pack);
    R.arms = []; R.legs = [];
    for (const side of [-1, 1]) {
      const k = side < 0 ? 'aL' : 'aR', r = p[k + 'r'], f = p[k + 'f'], b = p[k + 'b'], w = p[k + 'w'];
      const sh = [side * B.sh, B.shY, 0];
      const d = norm([side * Math.sin(r) * Math.cos(f), Math.cos(r) * Math.cos(f), Math.sin(f)]);
      const bend = orth(norm([-side * w, -0.15, 1 - w * 0.5]), d);
      const d2 = norm(add(mul(d, Math.cos(b)), mul(bend, Math.sin(b))));
      const el = add(sh, mul(d, B.ua)), wr = add(el, mul(d2, B.fa)), hand = add(wr, mul(d2, 5.5));
      const thumbDir = norm([side * -0.2 + d2[0] * 0, 0, 0.6]);
      R.arms.push({ side, sh: P(sh), el: P(el), wr: P(wr), hand: P(hand), d2: body(d2), bend: body(bend), thumb: body(orth(add(bend, [0, 0, 0.3]), d2)), td: thumbDir });
      const q = side < 0 ? 'lL' : 'lR', s = p[q + 's'], lf = p[q + 'f'], kn = Math.max(0, p[q + 'k']), an = p[q + 'a'];
      const hip = [side * B.hipX, B.hipY, 0];
      const ld = norm([side * Math.sin(s) * Math.cos(lf), Math.cos(s) * Math.cos(lf), Math.sin(lf)]);
      const kb = orth([0, 0, -1], ld);
      const sd = norm(add(mul(ld, Math.cos(kn)), mul(kb, Math.sin(kn))));
      const knee = add(hip, mul(ld, B.th)), ank = add(knee, mul(sd, B.sn));
      let fw = orth([side * 0.15, 0, 1], sd); fw = norm(add(mul(fw, Math.cos(an)), mul(sd, Math.sin(an))));
      const heel = add(add(ank, mul(sd, 6)), mul(fw, -4)), toe = add(add(ank, mul(sd, 6.5)), mul(fw, 12));
      R.legs.push({ side, hip: P(hip), knee: P(knee), ank: P(ank), heel: P(heel), toe: P(toe), sd: body(sd), fw: body(fw), ld: body(ld) });
    }
    return R;
  }

  // ------------------------------------------------------------------ paths (all clockwise)
  function capsule(x0, y0, r0, x1, y1, r1, P = new Path2D()) {
    const dx = x1 - x0, dy = y1 - y0, d = Math.hypot(dx, dy);
    if (d <= Math.abs(r0 - r1) + 0.01) { const big = r0 > r1; P.moveTo((big ? x0 : x1) + (big ? r0 : r1), big ? y0 : y1); P.arc(big ? x0 : x1, big ? y0 : y1, big ? r0 : r1, 0, TAU); return P; }
    const a = Math.atan2(dy, dx), off = Math.acos(clamp((r0 - r1) / d, -1, 1));
    P.moveTo(x1 + Math.cos(a - off) * r1, y1 + Math.sin(a - off) * r1);
    P.arc(x1, y1, r1, a - off, a + off);
    P.arc(x0, y0, r0, a + off, a - off + TAU);
    P.closePath(); return P;
  }
  function ell(x, y, rx, ry, rot = 0, P = new Path2D()) { P.ellipse(x, y, Math.max(0.01, rx), Math.max(0.01, ry), rot, 0, TAU); return P; }
  // rounded box along an axis (superellipse), widths taper from top to bottom
  function sbox(c, V, hh, wTop, wBot, n = 3.2, P = new Path2D()) {
    const U = [V[1], -V[0]] /* body right */, N = 44;
    // make sure U x V > 0 (clockwise)
    const s = U[0] * V[1] - U[1] * V[0] > 0 ? 1 : -1;
    for (let i = 0; i <= N; i++) {
      const th = (i / N) * TAU, cx = Math.cos(th), sy = Math.sin(th);
      const ex = Math.sign(cx) * Math.pow(Math.abs(cx), 2 / n), ey = Math.sign(sy) * Math.pow(Math.abs(sy), 2 / n);
      const u = ex * lerp(wTop, wBot, (ey + 1) / 2) * s, v = ey * hh;
      const X = c[0] + U[0] * u + V[0] * v, Y = c[1] + U[1] * u + V[1] * v;
      i ? P.lineTo(X, Y) : P.moveTo(X, Y);
    }
    P.closePath(); return P;
  }

  // ------------------------------------------------------------------ shading
  // cel(ctx, P, mat, c, r): two tones split by a hard terminator, soft gradient in each, rim crescent
  function cel(ctx, G, P, mat, c, r, o = {}) {
    if (typeof P === 'function') return celFree(ctx, G, P, mat, c, r, o);
    const C = colors(mat, G.light, G.accent), L = G.L, Rm = G.Rm;
    ctx.save(); ctx.clip(P);
    const x0 = c[0] + L[0] * r, y0 = c[1] + L[1] * r, x1 = c[0] - L[0] * r, y1 = c[1] - L[1] * r;
    // 1 rim colour everywhere, 2 shadow tone shifted away from the rim light (leaves a rim crescent),
    // 3 lit tone shifted toward the key light (hard terminator). One clip per part.
    const w = r * (o.rimW ?? 0.13);
    ctx.globalAlpha = 1; ctx.fillStyle = G.rimA * (o.rimA ?? 1) > 0.01 ? C.rim : C.shade; ctx.fill(P);
    ctx.save(); ctx.translate(-Rm[0] * w, -Rm[1] * w);
    let g = ctx.createLinearGradient(x0, y0, x1, y1);
    g.addColorStop(0, C.shade); g.addColorStop(0.55, C.core); g.addColorStop(1, C.shade);
    ctx.fillStyle = g; ctx.fill(P); ctx.restore();
    const d = r * (o.term ?? 0.42);
    ctx.save(); ctx.translate(L[0] * d, L[1] * d);
    g = ctx.createLinearGradient(x0 - L[0] * d, y0 - L[1] * d, x1 - L[0] * d, y1 - L[1] * d);
    g.addColorStop(0, C.hi); g.addColorStop(0.42, C.lit); g.addColorStop(1, C.lit);
    ctx.fillStyle = g; ctx.fill(P); ctx.restore();
    ctx.restore();
    if (o.spec) { // glossy specular: soft blob + hard dot
      const [sx, sy, srx, sry, srot] = o.spec;
      ctx.save();
      ctx.globalAlpha = 0.55 * (o.gloss ?? 1); ctx.fillStyle = C.hi; ctx.beginPath(); ctx.ellipse(sx, sy, srx, sry, srot, 0, TAU); ctx.fill();
      ctx.globalAlpha = 0.95 * (o.gloss ?? 1); ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.ellipse(sx - L[0] * srx * 0.15, sy - L[1] * srx * 0.15, srx * 0.42, sry * 0.42, srot, 0, TAU); ctx.fill();
      ctx.restore();
    }
  }
  // clip-free cel: F(inset) returns the shape shrunk by inset. An inset shape shifted by the inset stays
  // inside the outline and touches it on the shifted side, so no clip mask is needed (much cheaper).
  function celFree(ctx, G, F, mat, c, r, o) {
    const C = colors(mat, G.light, G.accent), L = G.L, Rm = G.Rm;
    const x0 = c[0] + L[0] * r, y0 = c[1] + L[1] * r, x1 = c[0] - L[0] * r, y1 = c[1] - L[1] * r;
    const w = r * (o.rimW ?? 0.13), d = r * (o.term ?? 0.42);
    ctx.save();
    ctx.fillStyle = C.rim; ctx.fill(F(0));
    ctx.save(); ctx.translate(-Rm[0] * w / 2, -Rm[1] * w / 2);
    ctx.fillStyle = C.shade; ctx.fill(F(w / 2)); ctx.restore();
    ctx.save(); ctx.translate(L[0] * d / 2, L[1] * d / 2);
    const g = ctx.createLinearGradient(x0, y0, x1, y1); g.addColorStop(0, C.hi); g.addColorStop(0.42, C.lit); g.addColorStop(1, C.lit);
    ctx.fillStyle = g; ctx.fill(F(d / 2)); ctx.restore();
    ctx.restore();
    if (o.spec) {
      const [sx, sy, srx, sry, srot] = o.spec;
      ctx.save(); ctx.globalAlpha = 0.55 * (o.gloss ?? 1); ctx.fillStyle = C.hi; ctx.beginPath(); ctx.ellipse(sx, sy, srx, sry, srot, 0, TAU); ctx.fill();
      ctx.globalAlpha = 0.95 * (o.gloss ?? 1); ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.ellipse(sx - L[0] * srx * 0.15, sy - L[1] * srx * 0.15, srx * 0.42, sry * 0.42, srot, 0, TAU); ctx.fill(); ctx.restore();
    }
  }
  // shape functions: F(inset) -> Path2D (negative inset = dilate). F(0) results are remembered so the
  // silhouette pass can fill a dilated copy (a fill is far cheaper than a wide round-join stroke).
  let SHAPE = new WeakMap();
  const reg = (F) => { const g = (i) => { const P = F(i); if (i === 0) SHAPE.set(P, g); return P; }; return g; };
  const capF = (x0, y0, r0, x1, y1, r1) => reg((i) => capsule(x0, y0, Math.max(0.1, r0 - i), x1, y1, Math.max(0.1, r1 - i)));
  const ellF = (x, y, rx, ry, rot = 0) => reg((i) => ell(x, y, Math.max(0.05, rx - i), Math.max(0.05, ry - i), rot));
  function seam(ctx, G, pts, a = 1) { // embossed panel seam: dark line + light line on the lit side
    if (G.detail <= 0 || pts.length < 2) return;
    ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const line = (dx, dy) => { ctx.beginPath(); pts.forEach((q, i) => (i ? ctx.lineTo(q[0] + dx, q[1] + dy) : ctx.moveTo(q[0] + dx, q[1] + dy))); ctx.stroke(); };
    ctx.strokeStyle = G.ink; ctx.globalAlpha = 0.5 * a; ctx.lineWidth = G.wd; line(0, 0);
    ctx.strokeStyle = '#ffffff'; ctx.globalAlpha = 0.6 * a; ctx.lineWidth = G.wd * 0.8; line(G.L[0] * G.wd * 1.4, G.L[1] * G.wd * 1.4);
    ctx.restore();
  }
  function ring(ctx, G, c, dir, r, a = 1) { // accordion ring across a limb at c, limb direction dir (2D)
    if (G.detail <= 0) return;
    const nx = -dir[1], ny = dir[0];
    seam(ctx, G, [[c[0] - nx * r * 0.86 - dir[0] * 1.0, c[1] - ny * r * 0.86 - dir[1] * 1.0], [c[0] + dir[0] * 1.6, c[1] + dir[1] * 1.6], [c[0] + nx * r * 0.86 - dir[0] * 1.0, c[1] + ny * r * 0.86 - dir[1] * 1.0]], a);
  }
  function bloom(ctx, x, y, r, rgb, a) {
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = clamp(a);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(${rgb},0.9)`); g.addColorStop(0.3, `rgba(${rgb},0.35)`); g.addColorStop(1, `rgba(${rgb},0)`);
    ctx.fillStyle = g; ctx.fillRect(x - r, y - r, 2 * r, 2 * r); ctx.restore();
  }

  // ------------------------------------------------------------------ visor geometry (figure units)
  function visorGeom(R) {
    const c = add(R.hc, mul(R.hF, B.vD));
    const u = [R.hR[0] * B.vX, R.hR[1] * B.vX], v = [R.hD[0] * B.vY, R.hD[1] * B.vY];
    // equivalent ellipse (for callers): major/minor from the conjugate axes
    const a = u[0] * u[0] + v[0] * v[0], b = u[0] * u[1] + v[0] * v[1], d = u[1] * u[1] + v[1] * v[1];
    const tr = (a + d) / 2, det = Math.sqrt(Math.max(0, ((a - d) / 2) ** 2 + b * b));
    const l1 = tr + det, l2 = Math.max(0, tr - det), rot = 0.5 * Math.atan2(2 * b, a - d);
    const A = new DOMMatrix([u[0], u[1], v[0], v[1], c[0], c[1]]);
    const ry = B.vY * Math.max(0.05, Math.hypot(R.hD[0], R.hD[1]));
    const up = Math.atan2(R.hD[1], R.hD[0]) - Math.PI / 2; // frame "down" follows the head
    const frame = new DOMMatrix().translateSelf(c[0], c[1]).rotateSelf(up * 180 / Math.PI).scaleSelf(ry * 2 / 1080).translateSelf(-960, -540);
    return { x: c[0], y: c[1], rx: Math.sqrt(l1), ry: Math.sqrt(l2), rot, A, facing: R.hF[2], frame, c };
  }
  function figMatrix(x, y, scale, roll) { return new DOMMatrix().translateSelf(x, y).rotateSelf(roll * 180 / Math.PI).scaleSelf(scale); }
  function toCaller(M, v) {
    const p = M.transformPoint(new DOMPoint(v.x, v.y)), sc = Math.hypot(M.a, M.b), ang = Math.atan2(M.b, M.a);
    return { x: p.x, y: p.y, rx: v.rx * sc, ry: v.ry * sc, rot: v.rot + ang };
  }
  function CHAR_visor(x, y, scale, pose, t) {
    const { p } = resolve(pose, t, true);
    const R = rig(p), V = visorGeom(R), M = figMatrix(x, y, scale, p.roll);
    return { M, visor: toCaller(M, V), frame: M.multiply(V.frame), facing: V.facing };
  }

  // ------------------------------------------------------------------ main
  function CHAR_astronaut(ctx, x, y, scale, pose, t, light, opts = {}) {
    light = Object.assign({}, DEF_LIGHT, light || {});
    const { p, fn } = resolve(pose, t, opts.spring !== false);
    const R = rig(p);
    const M = figMatrix(x, y, scale, p.roll);
    ctx.save();
    ctx.transform(M.a, M.b, M.c, M.d, M.e, M.f);
    const T = ctx.getTransform();
    const det = T.a * T.d - T.b * T.c || 1;
    const inv = (vx, vy) => n2((T.d * vx - T.c * vy) / det, (-T.b * vx + T.a * vy) / det);
    const eff = Math.sqrt(Math.abs(det));
    const L = inv(light.x, light.y), Rm = light.rx != null ? inv(light.rx, light.ry) : [-L[0], -L[1]];
    const wo = (7.5 * Math.pow(Math.max(eff, 0.05) / 5, 0.55) * (opts.lineScale ?? 1)) / eff;
    const G = { light, accent: opts.accent, L, Rm, rimA: 0.7, ink: opts.ink || '#120d1c', wo, wi: wo * 0.42, wd: wo * 0.24,
      detail: (opts.detail ?? 1) * (eff > 1.2 ? 1 : 0), boil: opts.boil ?? Math.floor(t * 15) };
    const wind = opts.wind ? (() => { const w = inv(opts.wind[0], opts.wind[1]); const m = Math.hypot(opts.wind[0], opts.wind[1]); return [w[0] * m, w[1] * m]; })() : [0, 0];
    const parts = [];
    const add2 = (z, P, draw, o = {}) => parts.push(Object.assign({ z, P, draw }, o, { F: o.F || SHAPE.get(P) }));

    // ---- backpack (life support) ----
    {
      const c = R.pack, V = n2(R.bD[0], R.bD[1]);
      const wf = Math.hypot(27 * R.bR[0], 10 * R.bF[0]);
      const hh = Math.max(14, 29 * Math.hypot(R.bD[0], R.bD[1]));
      const PF = reg((i) => sbox(c, V, hh - i, wf - i, wf * 0.94 - i, 3.6)), P = PF(0);
      add2(c[2], P, () => {
        cel(ctx, G, PF, 'pack', c, 30);
        const back = -R.bF[2]; // >0: the back face is toward us
        if (back > 0.05) {
          ctx.save(); ctx.clip(P); ctx.globalAlpha = clamp(back * 2);
          const A = new DOMMatrix([R.bR[0], R.bR[1], R.bD[0], R.bD[1], c[0] - R.bF[0] * 10, c[1] - R.bF[1] * 10]);
          const panel = new Path2D(); panel.addPath(capsuleRect(-15, -18, 30, 20, 5), A);
          cel(ctx, G, panel, 'accent', [c[0], c[1] - 8], 18);
          ctx.strokeStyle = G.ink; ctx.lineWidth = G.wi; ctx.stroke(panel);
          for (let i = 0; i < 3; i++) { const sl = new Path2D(); sl.addPath(capsuleRect(-12, 8 + i * 6, 24, 2.6, 1.3), A); ctx.fillStyle = 'rgba(30,24,70,0.55)'; ctx.fill(sl); }
          for (const sx of [-17, 17]) { const k = new Path2D(); k.addPath(ell(sx, -24, 4, 4), A); cel(ctx, G, k, 'gold', A.transformPoint(new DOMPoint(sx, -24)).toJSON ? [A.transformPoint(new DOMPoint(sx, -24)).x, A.transformPoint(new DOMPoint(sx, -24)).y] : c, 5); ctx.strokeStyle = G.ink; ctx.lineWidth = G.wd * 1.4; ctx.stroke(k); }
          ctx.restore();
        }
        // side vents read in profile
        if (Math.abs(R.bF[2]) < 0.5) seam(ctx, G, [[c[0] - V[0] * hh * 0.7 + R.bR[0] * 2, c[1] - V[1] * hh * 0.7], [c[0] + V[0] * hh * 0.7 + R.bR[0] * 2, c[1] + V[1] * hh * 0.7]], 0.5);
      }, { r: 30, recv: true });
    }

    // ---- torso ----
    const sp = [R.pelvis[0] - R.neck[0], R.pelvis[1] - R.neck[1]];
    const spL = Math.hypot(sp[0], sp[1]);
    const V = spL > 0.5 ? [sp[0] / spL, sp[1] / spL] : [R.bD[0], R.bD[1]];
    const tW = Math.hypot(B.tW * R.bR[0], B.tD * R.bF[0]) || 1, bW = tW * B.bW / B.tW;
    const tc = [(R.neck[0] + R.pelvis[0]) / 2 + V[0] * 1, (R.neck[1] + R.pelvis[1]) / 2 + V[1] * 1];
    const thh = Math.max(spL / 2 + 6, 16);
    const torsoF = reg((i) => sbox(tc, V, thh - i, tW - i, bW - i, 3.0)), torsoP = torsoF(0);
    const U = [V[1], -V[0]];
    add2(0, torsoP, () => {
      cel(ctx, G, torsoF, 'suit', tc, 30);
      ctx.save(); ctx.clip(torsoP);
      // waist band (accent), bowed like a ring seen slightly from above
      const bow = 3 + 5 * Math.sin(p.pitch + 0.25);
      const bandY = thh * 0.5, bh = 6.5;
      const band = new Path2D();
      const bp = (v, k) => [tc[0] + U[0] * k * (bW + 4) + V[0] * (v + bow * (1 - k * k)), tc[1] + U[1] * k * (bW + 4) + V[1] * (v + bow * (1 - k * k))];
      for (let i = 0; i <= 16; i++) { const q = bp(bandY - bh / 2, -1 + i / 8); i ? band.lineTo(...q) : band.moveTo(...q); }
      for (let i = 16; i >= 0; i--) band.lineTo(...bp(bandY + bh / 2, -1 + i / 8));
      band.closePath();
      cel(ctx, G, band, 'accent', [tc[0] + V[0] * bandY, tc[1] + V[1] * bandY], 26, { term: 0.3 });
      ctx.strokeStyle = G.ink; ctx.lineWidth = G.wd * 1.3; ctx.stroke(band);
      // vertical panel seams wrapping the torso
      for (const th of [-0.62, 0.62]) {
        const a = th + p.yaw; const vis = Math.cos(a); if (vis < 0.05) continue;
        const off = Math.sin(a) * (R.bR[0] >= 0 ? 1 : 1);
        const pts = []; for (let i = 0; i <= 8; i++) { const v = lerp(-thh * 0.75, bandY - bh, i / 8); const k = off * lerp(tW, bW, (v / thh + 1) / 2) * (1 - 0.06 * Math.cos(i / 8 * Math.PI)); pts.push([tc[0] + U[0] * k + V[0] * v, tc[1] + U[1] * k + V[1] * v]); }
        seam(ctx, G, pts, vis);
      }
      // chest yoke seam
      const yk = []; for (let i = 0; i <= 12; i++) { const k = -1 + i / 6, v = -thh * 0.42 + bow * 0.6 * (1 - k * k); yk.push([tc[0] + U[0] * k * tW + V[0] * v, tc[1] + U[1] * k * tW + V[1] * v]); }
      seam(ctx, G, yk, 0.8);
      ctx.restore();
      // chest control unit: a box on the front, drawn in the body's projected axes
      const f = R.bF[2];
      if (f > 0.08) {
        const cc = add(R.chest, mul(R.bF, 16));
        const A = new DOMMatrix([R.bR[0], R.bR[1], R.bD[0], R.bD[1], cc[0], cc[1] + 2]);
        const box = new Path2D(); box.addPath(capsuleRect(-12, -7.5, 24, 15, 4), A);
        const side = new Path2D(); side.addPath(capsuleRect(-12, -7.5, 24, 15, 4), new DOMMatrix([R.bR[0], R.bR[1], R.bD[0], R.bD[1], cc[0] - R.bF[0] * 4, cc[1] + 2 - R.bF[1] * 4]));
        ctx.save(); ctx.globalAlpha = clamp(f * 3);
        ctx.fillStyle = colors('slate', light).shade; ctx.fill(side);
        cel(ctx, G, box, 'pack', [cc[0], cc[1]], 14, { term: 0.5 });
        ctx.strokeStyle = G.ink; ctx.lineWidth = G.wi; ctx.stroke(box);
        // display window + three lights
        const win = new Path2D(); win.addPath(capsuleRect(-9, -5, 11, 7, 2), A);
        ctx.fillStyle = '#16204a'; ctx.fill(win);
        ctx.save(); ctx.clip(win); ctx.fillStyle = 'rgba(80,230,220,0.85)'; const wv = new Path2D(); wv.addPath(capsuleRect(-8, -1.5 + 0.8 * Math.sin(t * 5), 9, 1.2, 0.6), A); ctx.fill(wv); ctx.restore();
        ctx.strokeStyle = G.ink; ctx.lineWidth = G.wd; ctx.stroke(win);
        const lights = [[6, -2.5, '#ff5d4a', '255,93,74'], [9.5, -2.5, '#ffd23d', '255,210,61'], [6, 3, '#3ce6c8', '60,230,200']];
        G.glows.push(...lights.map((l, i) => { const q = A.transformPoint(new DOMPoint(l[0], l[1])); const on = 0.6 + 0.4 * Math.sin(t * (2.1 + i) + i * 2); return [q.x, q.y, 7, l[3], on * f]; }));
        for (const l of lights) { const q = A.transformPoint(new DOMPoint(l[0], l[1])); ctx.fillStyle = l[2]; ctx.beginPath(); ctx.ellipse(q.x, q.y, 1.9 * Math.abs(R.bR[0]) + 0.4, 1.9, 0, 0, TAU); ctx.fill(); }
        const sl = new Path2D(); sl.addPath(capsuleRect(-9, 3.5, 11, 1.6, 0.8), A); ctx.fillStyle = 'rgba(30,24,70,0.5)'; ctx.fill(sl);
        ctx.restore();
      }
    }, { r: 30, recv: true });

    // ---- hoses: pack shoulder to chest unit, with lag and a lazy wave ----
    const lagPose = fn ? fn(t - 0.14) : p;
    const dRoll = fn ? p.roll - lagPose.roll : 0;
    for (const side of [1]) {
      const a0 = [side * 24, -6, -12], a1 = [side * 12.5, 2, 16];
      const sway = 2.2 * Math.sin(t * 2.3 + side) + 9 * dRoll * -side;
      const c0 = add(a0, [side * 13, 10 + sway * 0.4, 6]), c1 = add(a1, [side * 10 + sway, 13, 3]);
      const pts3 = [a0, c0, c1, a1].map((v) => rotX(rotY(v, p.yaw), -p.pitch));
      const W2 = [wind[0] * 5, wind[1] * 5];
      const bz = []; for (let i = 0; i <= 14; i++) { const u = i / 14, m = 1 - u; const q = [0, 1].map((j) => m * m * m * pts3[0][j] + 3 * m * m * u * pts3[1][j] + 3 * m * u * u * pts3[2][j] + u * u * u * pts3[3][j]); const wk = Math.sin(u * Math.PI); bz.push([q[0] + W2[0] * wk, q[1] + W2[1] * wk]); }
      const z = (pts3[0][2] + pts3[3][2]) / 2 + 4;
      parts.push({ z, hose: bz, w: 4.4, draw: () => drawHose(ctx, G, bz, 4.4, 'pack') });
    }

    // ---- tether: snapped line from the belt, streaming with the wind, wave travels down it ----
    if (opts.tether !== false) {
      const anc = rotX(rotY([15, 20, 9], p.yaw), -p.pitch);
      const wm0 = Math.hypot(wind[0], wind[1]), base = wm0 > 0.01 ? Math.atan2(wind[1], wind[0]) : Math.PI / 2;
      const wm = clamp(Math.hypot(wind[0], wind[1]), 0, 1.5);
      const pts = [[anc[0], anc[1]]]; let a = base, q = [anc[0], anc[1]];
      const N = 11;
      for (let i = 1; i <= N; i++) {
        const u = i / N;
        const lagR = fn ? (p.roll - fn(t - u * 0.35).roll) : 0;
        a = Math.PI / 2 + angDiff(Math.PI / 2, base) * clamp(wm * 1.2) + (0.95 - wm * 0.3) * u * Math.sin(t * 3.4 - u * 5.5) + lagR * u * 1.2 + 0.55 * Math.sin(u * 2.6 + 0.7 + 0.5 * Math.sin(t * 0.9));
        const seg = 8.5;
        q = [q[0] + Math.cos(a) * seg, q[1] + Math.sin(a) * seg]; pts.push(q);
      }
      parts.push({ z: anc[2] + 3, hose: pts, w: 2.6, draw: () => { drawHose(ctx, G, pts, 2.6, 'gold', true); const e = pts[pts.length - 1], e2 = pts[pts.length - 2]; const dir = n2(e[0] - e2[0], e[1] - e2[1]);
        const cl = capsule(e[0], e[1], 3.2, e[0] + dir[0] * 5, e[1] + dir[1] * 5, 2.6); cel(ctx, G, cl, 'slate', e, 5); ctx.strokeStyle = G.ink; ctx.lineWidth = G.wi; ctx.stroke(cl); } });
    }

    // ---- legs ----
    for (const L2 of R.legs) {
      const zb = L2.side * 0.01;
      const thF = capF(L2.hip[0], L2.hip[1], 10.5, L2.knee[0], L2.knee[1], 9.5), th = thF(0);
      const zT = (L2.hip[2] + L2.knee[2]) / 2 - 3 + zb;
      add2(zT, th, () => { cel(ctx, G, thF, 'suit', mid(L2.hip, L2.knee), 11); ring(ctx, G, lerp2(L2.hip, L2.knee, 0.82), dir2(L2.hip, L2.knee), 9.5, 0.9); }, { r: 11 });
      const shF = capF(L2.knee[0], L2.knee[1], 9.6, L2.ank[0], L2.ank[1], 9), sh = shF(0);
      add2((L2.knee[2] + L2.ank[2]) / 2 - 3 + zb + 0.2, sh, () => { cel(ctx, G, shF, 'suit', mid(L2.knee, L2.ank), 10);
        ctx.save(); ring(ctx, G, lerp2(L2.knee, L2.ank, 0.16), dir2(L2.knee, L2.ank), 9.5, 0.9); ring(ctx, G, lerp2(L2.knee, L2.ank, 0.3), dir2(L2.knee, L2.ank), 9.5, 0.7); ctx.restore(); }, { r: 10 });
      // knee pad (accent)
      const kpF = ellF(L2.knee[0] + L2.fw[0] * 3, L2.knee[1] + L2.fw[1] * 3, 6.5, 5.5 * (0.45 + 0.55 * Math.abs(L2.fw[2])), Math.atan2(L2.ld[1], L2.ld[0])), kp = kpF(0);
      if (L2.fw[2] > -0.2) add2((L2.knee[2]) - 3 + zb + 0.3 + 4, kp, () => cel(ctx, G, kpF, 'accent', L2.knee, 7, { term: 0.35 }), { r: 7 });
      // boot: sole, shell, strap
      const zA = Math.max(L2.heel[2], L2.toe[2]) - 3 + zb + 0.4;
      const sd = [L2.sd[0], L2.sd[1]];
      const soleF = capF(L2.heel[0] + sd[0] * 3, L2.heel[1] + sd[1] * 3, 7.4, L2.toe[0] + sd[0] * 3, L2.toe[1] + sd[1] * 3, 7), sole = soleF(0);
      add2(zA, sole, () => cel(ctx, G, soleF, 'slate', mid(L2.heel, L2.toe), 9), { r: 9 });
      const bootF = reg((i) => capsule(L2.heel[0], L2.heel[1], 9.6 - i, L2.toe[0], L2.toe[1], 8.6 - i, capsule(L2.ank[0], L2.ank[1], 10.2 - i, L2.heel[0], L2.heel[1], 9.6 - i))), boot = bootF(0);
      add2(zA + 0.1, boot, () => { cel(ctx, G, bootF, 'suit', mid(L2.ank, L2.toe), 12);
        ctx.save(); ctx.clip(boot); const sc = lerp2(L2.ank, L2.heel, 0.4); const st = capsule(sc[0] - L2.fw[0] * 9 - sd[1] * 9, sc[1] - L2.fw[1] * 9 + sd[0] * 9, 3.2, sc[0] + L2.fw[0] * 9 + sd[1] * 9, sc[1] + L2.fw[1] * 9 - sd[0] * 9, 3.2);
        cel(ctx, G, st, 'accent', sc, 8, { term: 0.3 }); ctx.restore(); }, { r: 12, nounion: false });
    }

    // ---- arms ----
    for (const A of R.arms) {
      const zb = A.side * 0.01;
      const upF = capF(A.sh[0], A.sh[1], 9, A.el[0], A.el[1], 8), up = upF(0);
      const zU = (A.sh[2] + A.el[2]) / 2 + 2 + zb;
      add2(zU, up, () => { cel(ctx, G, upF, 'suit', mid(A.sh, A.el), 9.5); ring(ctx, G, lerp2(A.sh, A.el, 0.85), dir2(A.sh, A.el), 8, 0.9); }, { r: 9.5 });
      const loF = capF(A.el[0], A.el[1], 8.1, A.wr[0], A.wr[1], 7.6), lo = loF(0);
      add2((A.el[2] + A.wr[2]) / 2 + 2 + zb + 0.2, lo, () => { cel(ctx, G, loF, 'suit', mid(A.el, A.wr), 8.5); ctx.save(); ring(ctx, G, lerp2(A.el, A.wr, 0.15), dir2(A.el, A.wr), 8, 0.9); ring(ctx, G, lerp2(A.el, A.wr, 0.3), dir2(A.el, A.wr), 8, 0.7); ctx.restore(); }, { r: 8.5 });
      // gauntlet cuff (gold ring) + glove (accent) + thumb
      const d2 = n2(A.d2[0], A.d2[1]);
      const zW = A.wr[2] + 2 + zb + 0.4;
      const cuffF = capF(A.wr[0] - d2[0] * 1.5, A.wr[1] - d2[1] * 1.5, 8.6, A.wr[0] + d2[0] * 1.8, A.wr[1] + d2[1] * 1.8, 8.6), cuff = cuffF(0);
      add2(zW, cuff, () => cel(ctx, G, cuffF, 'gold', A.wr, 9, { term: 0.35 }), { r: 9 });
      const hc = [A.hand[0], A.hand[1]];
      const tdir = n2(A.thumb[0], A.thumb[1]);
      const gloveF = capF(hc[0] - d2[0] * 1.5, hc[1] - d2[1] * 1.5, 7.6, hc[0] + d2[0] * 3, hc[1] + d2[1] * 3, 6.8), glove = gloveF(0);
      const thumbF = capF(hc[0] + tdir[0] * 4, hc[1] + tdir[1] * 4, 3.4, hc[0] + tdir[0] * 7.5 + d2[0] * 2.5, hc[1] + tdir[1] * 7.5 + d2[1] * 2.5, 3), thumb = thumbF(0);
      const zH = A.hand[2] + 2 + zb + 0.6;
      add2(zH + (A.thumb[2] > 0 ? 0.1 : -0.1), thumb, () => cel(ctx, G, thumbF, 'accent', hc, 6), { r: 6 });
      add2(zH, glove, () => { cel(ctx, G, gloveF, 'accent', hc, 8, { spec: [hc[0] + G.L[0] * 3.5, hc[1] + G.L[1] * 3.5, 2.6, 1.6, Math.atan2(d2[1], d2[0])], gloss: 0.6 });
        ctx.save(); seam(ctx, G, [[hc[0] + d2[0] * 3 - tdir[0] * 5, hc[1] + d2[1] * 3 - tdir[1] * 5], [hc[0] + d2[0] * 3.5 + tdir[0] * 2, hc[1] + d2[1] * 3.5 + tdir[1] * 2]], 0.6); ctx.restore(); }, { r: 8 });
      // shoulder cap (accent pauldron)
      const capPF = ellF(A.sh[0], A.sh[1] - 1, 11.5, 10.5), capP = capPF(0);
      add2(zU + 1.5, capP, () => cel(ctx, G, capPF, 'accent', A.sh, 11.5, { spec: [A.sh[0] + G.L[0] * 5.5, A.sh[1] - 1 + G.L[1] * 5.5, 3.6, 2.2, Math.atan2(G.L[1], G.L[0]) + Math.PI / 2], gloss: 0.7 }), { r: 11.5 });
    }

    // ---- neck ring + helmet ----
    {
      const nr = add(R.neck, mul(R.bD, -1.5));
      const nPF = ellF(nr[0], nr[1], Math.hypot(17 * R.bR[0], 14 * R.bF[0]) + 0.5, 6, Math.atan2(R.bR[1], R.bR[0])), nP = nPF(0);
      add2(nr[2] + 3.5, nP, () => cel(ctx, G, nPF, 'gold', nr, 14, { term: 0.3 }), { r: 14 });
      const hc = R.hc;
      const hF = ellF(hc[0], hc[1], B.R, B.R), hP = hF(0);
      const Vg = visorGeom(R);
      G.visor = Vg;
      add2(hc[2] + 5, hP, () => drawHelmet(ctx, G, R, hP, Vg, p, t, opts), { r: B.R });
    }

    // ---- render: silhouette ink, then parts far to near with cast shadows ----
    parts.sort((a, b) => a.z - b.z);
    ctx.save();
    const jx = (hash(G.boil, 3, 17) - 0.5) * G.wo * 0.25, jy = (hash(G.boil, 4, 17) - 0.5) * G.wo * 0.25;
    ctx.translate(-L[0] * wo * 0.45 + jx, -L[1] * wo * 0.45 + jy);
    ctx.strokeStyle = G.ink; ctx.fillStyle = G.ink; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    for (const q of parts) {
      if (q.hose) { ctx.lineWidth = q.w * 2 + wo * 2; polyStroke(ctx, q.hose); }
      else if (q.F) ctx.fill(q.F(-wo)); else { ctx.lineWidth = wo * 2; ctx.stroke(q.P); }
    }
    ctx.restore();
    G.glows = G.glows || [];
    // cast shadows: parts in front of the torso/pack darken them (one clip per receiver)
    const recv = parts.filter((q) => q.recv);
    for (const q of parts) {
      q.draw();
      if (q.P) { ctx.strokeStyle = G.ink; ctx.lineWidth = G.wi; ctx.lineJoin = 'round'; ctx.stroke(q.P); }
      if (q.recv && opts.castShadows !== false) {
        const casters = parts.filter((k) => k.P && !k.recv && k.z > q.z && k.cast !== false);
        if (casters.length) {
          ctx.save(); ctx.clip(q.P); ctx.translate(-L[0] * 3.5, -L[1] * 3.5);
          ctx.globalCompositeOperation = 'multiply'; ctx.fillStyle = 'rgba(70,52,150,0.26)';
          const U2 = new Path2D(); for (const k of casters) U2.addPath(k.P); ctx.fill(U2); ctx.restore();
        }
      }
    }
    if (opts.glow !== false) for (const g of G.glows) bloom(ctx, g[0], g[1], g[2], g[3], g[4]);
    ctx.restore();
    const vC = toCaller(M, G.visor);
    return { M, visor: vC, frame: M.multiply(G.visor.frame), facing: G.visor.facing };
  }
  CHAR_astronaut.toString = () => 'CHAR_astronaut';

  function drawHelmet(ctx, G, R, hP, Vg, p, t, opts) {
    const hc = R.hc, L = G.L;
    cel(ctx, G, ellF(hc[0], hc[1], B.R, B.R), 'helmet', hc, B.R, { term: 0.36, spec: [hc[0] + L[0] * 15, hc[1] + L[1] * 15, 6.5, 3.6, Math.atan2(L[1], L[0]) + Math.PI / 2], gloss: 1 });
    ctx.save(); ctx.clip(hP);
    // meridian seam (great circle through the crown, front to back)
    {
      const pts = []; let vis = [];
      for (let i = 0; i <= 24; i++) { const a = -Math.PI * 0.95 + (i / 24) * Math.PI * 1.9; const q = add(mul(R.hD, -Math.cos(a) * B.R * 0.99), mul(R.hF, -Math.sin(a) * B.R * 0.99)); if (q[2] > 0 && dot(norm(q), R.hF) < 0.55) { vis.push([hc[0] + q[0], hc[1] + q[1]]); } else if (vis.length) { pts.push(vis); vis = []; } }
      if (vis.length) pts.push(vis);
      pts.forEach((s) => seam(ctx, G, s, 0.8));
    }
    // ear pucks + lamp
    for (const side of [-1, 1]) {
      const n = mul(R.hR, side);
      if (n[2] > -0.15) {
        const c = add(hc, mul(n, B.R * 0.9));
        const PF = ellF(c[0], c[1], 7.5 * Math.max(0.12, Math.abs(n[2])), 7.5, Math.atan2(n[1], n[0])), P = PF(0);
        cel(ctx, G, PF, 'slate', c, 8, { term: 0.3 }); ctx.strokeStyle = G.ink; ctx.lineWidth = G.wi; ctx.stroke(P);
        const P2F = ellF(c[0] + n[0] * 1.2, c[1] + n[1] * 1.2, 4.2 * Math.max(0.12, Math.abs(n[2])), 4.2, Math.atan2(n[1], n[0])), P2 = P2F(0);
        cel(ctx, G, P2F, 'accent', c, 5); ctx.stroke(P2);
      }
      const ln = norm(add(add(mul(R.hR, side * 0.8), mul(R.hD, -0.5)), mul(R.hF, 0.3)));
      if (side > 0 && ln[2] > 0.0) {
        const c = add(hc, mul(ln, B.R * 0.97));
        const PF = ellF(c[0], c[1], 3.8 * Math.max(0.2, ln[2]), 3.8, Math.atan2(ln[1], ln[0])), P = PF(0);
        cel(ctx, G, PF, 'gold', c, 5, { term: 0.3 }); ctx.strokeStyle = G.ink; ctx.lineWidth = G.wd * 1.5; ctx.stroke(P);
        ctx.fillStyle = '#fffbe6'; ctx.beginPath(); ctx.ellipse(c[0], c[1], 2.1 * Math.max(0.2, ln[2]), 2.1, Math.atan2(ln[1], ln[0]), 0, TAU); ctx.fill();
        G.glows.push([c[0], c[1], 13, '255,214,120', 0.55 * ln[2] + 0.15]);
      }
    }
    ctx.restore();
    // visor: gold frame, glass, nested scene, face, reflections
    if (Vg.facing <= -0.02) return;
    const fa = clamp(Vg.facing * 6);
    const A = Vg.A;
    const unit = (rx, ry, x = 0, y = 0) => { const q = new Path2D(); q.addPath(ell(x, y, rx, ry), A); return q; };
    const frameP = new Path2D(); frameP.addPath(ell(0, 0, 1.17, 1.2), new DOMMatrix([A.a, A.b, A.c, A.d, A.e - R.hF[0] * 1.5, A.f - R.hF[1] * 1.5]));
    const glass = unit(1, 1);
    ctx.save(); ctx.globalAlpha = fa;
    ctx.save(); ctx.translate(-L[0] * 2.5, -L[1] * 2.5); ctx.fillStyle = 'rgba(60,40,140,0.22)'; ctx.clip(hP); ctx.fill(frameP); ctx.restore();
    cel(ctx, G, frameP, 'gold', [Vg.x, Vg.y], 20, { term: 0.3, rimW: 0.12 });
    ctx.strokeStyle = G.ink; ctx.lineWidth = G.wi; ctx.stroke(frameP);
    // glass base
    ctx.save(); ctx.clip(glass);
    ctx.save(); ctx.transform(A.a, A.b, A.c, A.d, A.e, A.f);
    let g = ctx.createLinearGradient(0, -1, 0, 1);
    const env = opts.env || {};
    g.addColorStop(0, '#060824'); g.addColorStop(0.45, '#141d58'); g.addColorStop(0.8, '#1d4f8f'); g.addColorStop(1, '#2fb7c9');
    ctx.fillStyle = g; ctx.fillRect(-1.2, -1.2, 2.4, 2.4);
    ctx.restore();
    if (opts.visorFill) {
      ctx.save(); opts.visorFill(ctx, { x: Vg.x, y: Vg.y, rx: Vg.rx, ry: Vg.ry, rot: Vg.rot, frame: Vg.frame }); ctx.restore();
    }
    const face = opts.face ?? (opts.visorFill ? 0 : 1);
    if (face > 0) drawFace(ctx, G, A, p, t, face);
    // reflections, in visor unit space
    ctx.save(); ctx.transform(A.a, A.b, A.c, A.d, A.e, A.f);
    const la = Math.atan2(L[1] * 1, L[0]); // light angle (approx, unit space)
    const gs = clamp(opts.glass ?? 1); ctx.globalAlpha = gs;
    // top inner shadow from the brow
    g = ctx.createLinearGradient(0, -1, 0, -0.35); g.addColorStop(0, 'rgba(4,4,20,0.75)'); g.addColorStop(1, 'rgba(4,4,20,0)');
    ctx.fillStyle = g; ctx.fillRect(-1.2, -1.2, 2.4, 0.9);
    // environment: reflected horizon band tinted by the scene
    if (env.sky || env.ground) {
      ctx.globalAlpha = 0.22 * gs; ctx.fillStyle = env.ground || env.sky; ctx.beginPath(); ctx.ellipse(0, 1.15, 1.4, 0.62, 0, 0, TAU); ctx.fill();
      ctx.globalAlpha = 0.12 * gs; ctx.fillStyle = env.sky || env.ground; ctx.beginPath(); ctx.ellipse(0, -0.9, 1.3, 0.5, 0, 0, TAU); ctx.fill();
    }
    // big window highlight (soft crescent toward the key light)
    ctx.globalAlpha = 0.5 * gs;
    ctx.fillStyle = G.light.key;
    ctx.beginPath(); ctx.arc(0, 0, 0.86, la - 0.62, la + 0.62); ctx.arc(0, 0, 0.62, la + 0.5, la - 0.5, true); ctx.closePath(); ctx.fill();
    ctx.globalAlpha = 0.95 * gs; ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.ellipse(Math.cos(la + 0.85) * 0.66, Math.sin(la + 0.85) * 0.66, 0.085, 0.085, 0, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.ellipse(Math.cos(la + 1.12) * 0.62, Math.sin(la + 1.12) * 0.62, 0.045, 0.045, 0, 0, TAU); ctx.fill();
    // cool rim on the far edge
    ctx.globalAlpha = 0.75 * gs; ctx.strokeStyle = G.light.rim; ctx.lineWidth = 0.07; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(0, 0, 0.9, la + Math.PI - 0.75, la + Math.PI + 0.75); ctx.stroke();
    ctx.restore();
    ctx.restore(); // glass clip
    ctx.strokeStyle = G.ink; ctx.lineWidth = G.wi; ctx.stroke(glass);
    ctx.restore();
  }

  function drawFace(ctx, G, A, p, t, face) {
    // a face behind tinted glass: soft, low contrast, but it blinks and emotes
    ctx.save(); ctx.transform(A.a, A.b, A.c, A.d, A.e, A.f);
    const gx = clamp(p.hy * 0.5 + p.gaze * 0.6, -0.35, 0.35), gy = clamp(p.hp * 0.35, -0.25, 0.3);
    ctx.globalAlpha = face;
    const fx = gx * 0.5, fy = 0.12 + gy * 0.4;
    let g = ctx.createRadialGradient(fx - 0.2, fy - 0.3, 0.1, fx, fy, 0.85);
    g.addColorStop(0, '#ffd2b0'); g.addColorStop(0.65, '#e79a78'); g.addColorStop(1, '#9a5a66');
    ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(fx, fy + 0.12, 0.62, 0.78, 0, 0, TAU); ctx.fill();
    // cap of the comms hood
    ctx.fillStyle = '#2a2448'; ctx.beginPath(); ctx.ellipse(fx, fy - 0.62, 0.78, 0.5, 0, 0, TAU); ctx.fill();
    // blink: 0.13 s every ~3.4 s, deterministic
    const per = 3.4, ph = ((t + 0.7) % per + per) % per, bl = ph < 0.13 ? Math.sin(ph / 0.13 * Math.PI) : 0;
    const open = clamp(p.eyes * (1 - bl), 0.06, 1.3);
    const scared = clamp(-p.mood), happy = clamp(p.mood);
    for (const s of [-1, 1]) {
      const ex = fx + s * 0.26 + gx * 0.18, ey = fy - 0.08;
      ctx.fillStyle = '#fffaf3'; ctx.beginPath(); ctx.ellipse(ex, ey, 0.12, 0.15 * open * (1 + scared * 0.15), 0, 0, TAU); ctx.fill();
      if (open > 0.2) {
        ctx.fillStyle = '#1a1030'; ctx.beginPath(); ctx.ellipse(ex + gx * 0.08, ey + gy * 0.05, 0.075 * (1 - scared * 0.2), 0.095 * Math.min(1, open), 0, 0, TAU); ctx.fill();
        ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(ex + gx * 0.08 - 0.03, ey - 0.04, 0.025, 0, TAU); ctx.fill();
      }
      if (happy > 0.3 && open > 0.2) { ctx.fillStyle = '#c97a62'; ctx.beginPath(); ctx.ellipse(ex, ey + 0.16, 0.14, 0.07 * happy, 0, 0, TAU); ctx.fill(); }
      // brow: raised and tilted when scared, soft arch when calm
      ctx.strokeStyle = '#3a2030'; ctx.lineWidth = 0.05; ctx.lineCap = 'round';
      ctx.beginPath(); const by = ey - 0.22 - scared * 0.06;
      ctx.moveTo(ex - s * 0.12, by + (scared ? -0.05 * scared * s * -s : 0) - scared * 0.04); ctx.quadraticCurveTo(ex, by - 0.06, ex + s * 0.13, by + scared * 0.05); ctx.stroke();
    }
    // mouth
    ctx.fillStyle = '#4a1e2c'; ctx.strokeStyle = '#4a1e2c'; ctx.lineWidth = 0.045;
    const my = fy + 0.36;
    if (scared > 0.3) { ctx.beginPath(); ctx.ellipse(fx + gx * 0.1, my, 0.07 + 0.03 * scared, 0.09 + 0.04 * scared * (0.8 + 0.2 * Math.sin(t * 9)), 0, 0, TAU); ctx.fill(); }
    else { ctx.beginPath(); ctx.moveTo(fx - 0.13, my - 0.02 * happy); ctx.quadraticCurveTo(fx, my + 0.12 * happy - 0.02, fx + 0.13, my - 0.02 * happy); ctx.stroke(); }
    // glass tint over the face (it is behind the visor)
    ctx.globalAlpha = face * 0.2;
    g = ctx.createLinearGradient(0, -1, 0, 1); g.addColorStop(0, '#1a1f66'); g.addColorStop(1, '#2a7fa4');
    ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(fx, fy + 0.12, 0.66, 0.82, 0, 0, TAU); ctx.fill();
    ctx.restore();
  }

  function drawHose(ctx, G, pts, w, mat, plain) {
    const C = colors(mat, G.light, G.accent);
    ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.strokeStyle = G.ink; ctx.lineWidth = w * 2 + G.wi * 2; polyStroke(ctx, pts);
    ctx.strokeStyle = C.shade; ctx.lineWidth = w * 2; polyStroke(ctx, pts);
    ctx.save(); ctx.translate(G.L[0] * w * 0.35, G.L[1] * w * 0.35); ctx.strokeStyle = C.lit; ctx.lineWidth = w * 1.2; polyStroke(ctx, pts); ctx.restore();
    ctx.save(); ctx.translate(G.L[0] * w * 0.55, G.L[1] * w * 0.55); ctx.strokeStyle = C.hi; ctx.globalAlpha = 0.8; ctx.lineWidth = w * 0.35; polyStroke(ctx, pts); ctx.restore();
    if (!plain && G.detail > 0) {
      ctx.strokeStyle = G.ink; ctx.globalAlpha = 0.4; ctx.lineWidth = w * 0.3; ctx.beginPath();
      for (let i = 1; i < pts.length - 1; i++) { const a = pts[i - 1], b = pts[i + 1], n = n2(b[1] - a[1], a[0] - b[0]); const q = pts[i]; ctx.moveTo(q[0] - n[0] * w * 0.9, q[1] - n[1] * w * 0.9); ctx.lineTo(q[0] + n[0] * w * 0.9, q[1] + n[1] * w * 0.9); }
      ctx.stroke();
    }
    ctx.restore();
  }
  function polyStroke(ctx, pts) { ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length - 1; i++) { const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2; ctx.quadraticCurveTo(pts[i][0], pts[i][1], mx, my); } const e = pts[pts.length - 1]; ctx.lineTo(e[0], e[1]); ctx.stroke(); }
  function capsuleRect(x, y, w, h, r) { const P = new Path2D(); P.moveTo(x + r, y); P.arcTo(x + w, y, x + w, y + h, r); P.arcTo(x + w, y + h, x, y + h, r); P.arcTo(x, y + h, x, y, r); P.arcTo(x, y, x + w, y, r); P.closePath(); return P; }
  const angDiff = (a, b) => { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; };
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const lerp2 = (a, b, k) => [lerp(a[0], b[0], k), lerp(a[1], b[1], k)];
  const dir2 = (a, b) => n2(b[0] - a[0], b[1] - a[1]);

  root.CHAR_astronaut = CHAR_astronaut;
  root.CHAR_visor = CHAR_visor;
  root.CHAR_pose = CHAR_pose;
  root.CHAR_blend = CHAR_blend;
  root.CHAR_POSES = POSES;
})(typeof window !== 'undefined' ? window : globalThis);
