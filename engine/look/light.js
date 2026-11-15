// light.js : Rheobase lighting and shading library. Every export is prefixed LOOK_.
// Plain 2D canvas, deterministic (no Math.random), works under any current transform
// (camera zoom, roll, nesting inside a visor): all positions/sizes are in the CURRENT
// user units, and the light direction is held fixed in SCREEN space (upper left key),
// so a rotated subject still gets lit from the upper left.
//
// ---------------------------------------------------------------- HOW TO CALL
// A "shape" is either a Path2D or a function (g) => { ...build a path... } that only
// BUILDS sub-paths (moveTo/arc/lineTo/ellipse/roundRect) and does not fill, stroke,
// or change fillStyle. If it uses g.translate/rotate, wrap them in g.save()/g.restore().
// Use a moveTo before every arc so sub-paths do not join. All arcs clockwise (nonzero union).
// A "bbox" is [x, y, w, h] in current user units that contains the shape.
// A "light" is { x:-0.55, y:-0.83, key:'#fff4e0', rim:'#7fd8ff', amb:0.35 } (brief convention),
// optional extras: shadow (multiply hue of shadows, default '#7a4fa8'), z (0..1 frontal part).
//
// Typical subject:
//   ctx.fillStyle = '#f3efe6'; ctx.fill(path);                  // 1. flat art as before
//   LOOK_shade(ctx, path, bbox, { light: L });                  // 2. cel tones + gradient + rim
//   LOOK_ink(ctx, path, 4);                                     // 3. ink line on top
// Sphere/planet:   LOOK_sphere(ctx, x, y, r, { base:'#2f7fd0', surface:(c)=>{...}, atmo:'#7fd8ff', light:L, ink:4 })
// Ground shadow:   LOOK_contactShadow(ctx, x, groundY, width, { light:L })      (before drawing the subject)
// Cast shadow:     LOOK_castShadow(ctx, shape, bbox, { light:L, dist:40, blur:14, receiver:groundShape })
// Overlap AO:      LOOK_ao(ctx, occluderShape, receiverShape, bbox, { radius:18 })  (after receiver, before occluder)
// Glow:            LOOK_glow(ctx, x, y, r, '#ffcc55', 1, { core:'#ffffff', flare:1 })  (cached sprite, additive)
// Bloom:           LOOK_bloom(ctx, (g)=>{draw emitter in its colours}, bbox, { radius:60, strength:1, cacheKey:'saber' })
// Light wrap:      LOOK_lightWrap(ctx, shape, bbox, { color:'#ffb066', dir:[1,0], width:22 })
// God rays:        LOOK_godRays(ctx, x, y, { angle, spread, n, len, width, color:'255,236,200', alpha, t, seed })
// Occluded shafts: LOOK_shafts(ctx, x, y, occluderShape, regionBbox, { color:'#fff1d0', srcR:300, len:0.6 })
// Point light:     LOOK_pointLight(ctx, shape, bbox, px, py, { color:'#ff8a3c', radius:400, intensity:0.9 })
// Utilities:       LOOK_light(overrides), LOOK_tints(light), LOOK_mix(a,b,k), LOOK_rgba(hex,a), LOOK_lightDir(ctx, light)
//
// Speed: per-call offscreen work is sized to the subject's on-screen box (pooled canvases,
// never re-allocated once grown). Blur work runs at 1/2 to 1/3 resolution. Pass cacheKey to
// LOOK_bloom for static emitters (the blurred sprite is stored in user space, so it survives
// camera moves). Glow sprites are cached per colour.
(function () {
  const TAU = Math.PI * 2;
  const DEF = { x: -0.55, y: -0.83, key: '#fff4e0', rim: '#7fd8ff', amb: 0.35, shadow: '#7a4fa8', z: 0.5 };
  const LOOK_light = (o = {}) => Object.assign({}, DEF, o);
  const LT = (o) => (o && o.light) ? Object.assign({}, DEF, o.light) : DEF;

  // ---------------------------------------------------------------- colour
  const hex = (c) => { c = c.replace('#', ''); if (c.length === 3) c = c.split('').map((x) => x + x).join(''); return [parseInt(c.slice(0, 2), 16), parseInt(c.slice(2, 4), 16), parseInt(c.slice(4, 6), 16)]; };
  const toHex = (a) => '#' + a.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
  const LOOK_mix = (a, b, k) => { const A = hex(a), B = hex(b); return toHex(A.map((v, i) => v + (B[i] - v) * k)); };
  const LOOK_rgba = (c, a) => { const A = hex(c); return `rgba(${A[0]},${A[1]},${A[2]},${a})`; };
  // Multiply tints for the tone steps. Shadows are hue-shifted (mauve/violet), never grey.
  function LOOK_tints(L) {
    const s = (1 - (L.amb ?? 0.35)) / 0.65;          // 1 at the default ambient
    return {
      mid: LOOK_mix('#ffffff', L.shadow || DEF.shadow, 0.42 * s),   // first step (default ~#cdb6dc)
      core: LOOK_mix('#ffffff', L.shadow || DEF.shadow, 0.68 * s),  // second step, stacks on mid
      key: L.key || DEF.key, rim: L.rim || DEF.rim,
    };
  }

  // ---------------------------------------------------------------- transforms
  const scaleOf = (M) => Math.sqrt(Math.abs(M.a * M.d - M.b * M.c)) || 1;
  // unit vector TOWARD the light, expressed in current user units (screen-fixed light)
  function LOOK_lightDir(ctx, L = DEF) {
    const inv = ctx.getTransform().inverse();
    const ux = inv.a * L.x + inv.c * L.y, uy = inv.b * L.x + inv.d * L.y, n = Math.hypot(ux, uy) || 1;
    return [ux / n, uy / n];
  }
  function dirLocal(ctx, dx, dy) { // a screen direction to a user-space unit vector
    const inv = ctx.getTransform().inverse();
    const ux = inv.a * dx + inv.c * dy, uy = inv.b * dx + inv.d * dy, n = Math.hypot(ux, uy) || 1;
    return [ux / n, uy / n];
  }

  // ---------------------------------------------------------------- shapes
  function shapePath(g, shape) { if (shape instanceof Path2D) return shape; g.beginPath(); shape(g); return null; }
  function fillShape(g, shape) { const p = shapePath(g, shape); p ? g.fill(p) : g.fill(); }
  function clipShape(g, shape) { const p = shapePath(g, shape); p ? g.clip(p) : g.clip(); }
  // Ink line. outer=false: plain centred stroke (fast, fine for single closed shapes).
  // outer=true: silhouette-only line of width w just outside the edge, so unions of
  // overlapping circles (clouds, smoke, figures built from parts) get no inner lines.
  function LOOK_ink(ctx, shape, w = 4, color = '#120d1c', outer = false, bb = null) {
    if (!outer) {
      ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = w; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      const p = shapePath(ctx, shape); p ? ctx.stroke(p) : ctx.stroke(); ctx.restore(); return;
    }
    const R = devRegion(ctx, bb || [0, 0, ctx.canvas.width, ctx.canvas.height], w * 2); if (!R) return;
    const [c, g] = work('ink', R.w, R.h); setDev(g, R);
    g.strokeStyle = color; g.lineWidth = w * 2; g.lineJoin = 'round'; g.lineCap = 'round';
    const p = shapePath(g, shape); p ? g.stroke(p) : g.stroke();
    g.globalCompositeOperation = 'destination-out'; fillShape(g, shape);
    blitDev(ctx, c, R, 'source-over', 1);
  }

  // ---------------------------------------------------------------- pooled work canvases
  const POOL = {};
  function work(name, w, h) {
    let c = POOL[name];
    if (!c) { c = document.createElement('canvas'); c.width = 64; c.height = 64; POOL[name] = c; }
    if (c.width < w || c.height < h) { c.width = Math.max(c.width, w); c.height = Math.max(c.height, h); }
    const g = c.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1; g.filter = 'none';
    g.clearRect(0, 0, w + 2, h + 2);
    return [c, g];
  }
  // Device-space region (crisp layers): maps the user bbox to screen pixels.
  function devRegion(ctx, bb, pad = 0) {
    const M = ctx.getTransform(), x0 = bb[0] - pad, y0 = bb[1] - pad, x1 = bb[0] + bb[2] + pad, y1 = bb[1] + bb[3] + pad;
    let mnx = 1e9, mny = 1e9, mxx = -1e9, mxy = -1e9;
    for (const [x, y] of [[x0, y0], [x1, y0], [x0, y1], [x1, y1]]) {
      const X = M.a * x + M.c * y + M.e, Y = M.b * x + M.d * y + M.f;
      mnx = Math.min(mnx, X); mny = Math.min(mny, Y); mxx = Math.max(mxx, X); mxy = Math.max(mxy, Y);
    }
    const CW = ctx.canvas.width, CH = ctx.canvas.height;
    mnx = Math.floor(Math.max(0, mnx)); mny = Math.floor(Math.max(0, mny)); mxx = Math.ceil(Math.min(CW, mxx)); mxy = Math.ceil(Math.min(CH, mxy));
    if (mxx - mnx < 1 || mxy - mny < 1) return null;
    return { x: mnx, y: mny, w: mxx - mnx, h: mxy - mny, M };
  }
  function setDev(g, R) { g.setTransform(new DOMMatrix([1, 0, 0, 1, -R.x, -R.y]).multiply(R.M)); }
  function blitDev(ctx, c, R, op, alpha) {
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalCompositeOperation = op; ctx.globalAlpha *= alpha;
    ctx.drawImage(c, 0, 0, R.w, R.h, R.x, R.y, R.w, R.h); ctx.restore();
  }
  // User-space low-res region (soft layers: blur, AO, wrap). res = layer pixels per user unit.
  function userRegion(ctx, bb, pad, resK = 0.5, maxPx = 1400) {
    const s = scaleOf(ctx.getTransform());
    const X = bb[0] - pad, Y = bb[1] - pad, Wd = bb[2] + 2 * pad, Hd = bb[3] + 2 * pad;
    let res = s * resK; res = Math.min(res, maxPx / Wd, maxPx / Hd);
    return { X, Y, W: Wd, H: Hd, res, pw: Math.max(2, Math.ceil(Wd * res)), ph: Math.max(2, Math.ceil(Hd * res)) };
  }
  function setUser(g, U) { g.setTransform(U.res, 0, 0, U.res, -U.X * U.res, -U.Y * U.res); }
  function blitUser(ctx, c, U, op, alpha) {
    ctx.save(); ctx.globalCompositeOperation = op; ctx.globalAlpha *= alpha;
    ctx.drawImage(c, 0, 0, U.pw, U.ph, U.X, U.Y, U.W, U.H); ctx.restore();
  }
  // shape minus (shape shifted by dx,dy), painted with color, on g (already set up)
  function crescent(g, shape, dx, dy, color) {
    g.globalCompositeOperation = 'source-over'; g.fillStyle = color; fillShape(g, shape);
    g.globalCompositeOperation = 'destination-out'; g.save(); g.translate(dx, dy); g.fillStyle = '#000'; fillShape(g, shape); g.restore();
    g.globalCompositeOperation = 'source-over';
  }

  // gouache mottle multiply over a box inside the current clip; pattern cached per context
  const PATS = new WeakMap();
  function texFill(ctx, bb, alpha, scale) {
    if (!(window.ENG && ENG.TEX && ENG.TEX.mottle)) return;
    let pat = PATS.get(ctx); if (!pat) { pat = ctx.createPattern(ENG.TEX.mottle, 'repeat'); PATS.set(ctx, pat); }
    pat.setTransform(new DOMMatrix().translateSelf(bb[0], bb[1]).scaleSelf(scale));
    ctx.save(); ctx.globalCompositeOperation = 'multiply'; ctx.globalAlpha *= alpha; ctx.fillStyle = pat; ctx.fillRect(bb[0], bb[1], bb[2], bb[3]); ctx.restore();
  }

  // ================================================================ LOOK_shade
  // Toon-shades any silhouette ON TOP of art already drawn (overlay passes, so stripes,
  // decals and textures under it keep their colours). Options (fractions of `size`):
  //   size (default min(bbox w,h)), mid 0.30 (first tone step width), core 0.12 (second, darker step),
  //   hi 0.07 (lit-edge kiss), hiA 0.45, rim 0.05 (cool rim on far edge), rimA 1,
  //   grad 1 (soft gradient strength inside the bands), gloss 0 (0..1 inset specular band, for metal/plastic),
  //   glossIn 0.10, glossW 0.07, tex 0 (gouache mottle alpha), texScale 1, ink 0, inkColor '#120d1c', light,
  //   union false: set true when the shape is several OVERLAPPING sub-paths (cloud of circles, merged
  //   figure). Simple shapes (one closed outline, or sub-paths that do not overlap) take a fast direct
  //   path (clip + evenodd, no offscreen canvas); union shapes use offscreen layers (slower).
  // Fill a band inside the current clip: (shape shifted by a) XOR (shape shifted by b, or a big rect when bx === null).
  function bandDirect(ctx, shape, ax, ay, bx, by, bb, pad) {
    if (shape instanceof Path2D) {
      const P = new Path2D();
      if (bx === null) P.rect(bb[0] - pad, bb[1] - pad, bb[2] + 2 * pad, bb[3] + 2 * pad); else P.addPath(shape, new DOMMatrix().translateSelf(bx, by));
      P.addPath(shape, new DOMMatrix().translateSelf(ax, ay)); ctx.fill(P, 'evenodd'); return;
    }
    ctx.beginPath();
    if (bx === null) ctx.rect(bb[0] - pad, bb[1] - pad, bb[2] + 2 * pad, bb[3] + 2 * pad); else { ctx.save(); ctx.translate(bx, by); shape(ctx); ctx.restore(); }
    ctx.save(); ctx.translate(ax, ay); shape(ctx); ctx.restore();
    ctx.fill('evenodd');
  }
  function LOOK_shade(ctx, shape, bb, o = {}) {
    const L = LT(o), T = LOOK_tints(L), [lx, ly] = LOOK_lightDir(ctx, L);
    const size = o.size || Math.min(bb[2], bb[3]), pad = 2; // keep blend-mode fill area tight: ~8 ns/px on UHD 620
    const cx = bb[0] + bb[2] / 2, cy = bb[1] + bb[3] / 2;
    const grad = o.grad ?? 1, mid = o.mid ?? 0.30, core = o.core ?? 0.12, hi = o.hi ?? 0.07, gloss = o.gloss ?? 0, rim = o.rim ?? 0.05;
    const prevA = ctx.globalAlpha;
    ctx.save(); clipShape(ctx, shape);
    // 1. soft gradient inside the form (lit side lifted, far side sinks)
    if (grad > 0) {
      const hx = cx + lx * size * 0.32, hy = cy + ly * size * 0.32;
      const rg = ctx.createRadialGradient(hx, hy, 0, hx, hy, size * 0.85);
      rg.addColorStop(0, LOOK_rgba(T.key, 0.30 * grad)); rg.addColorStop(0.55, LOOK_rgba(T.key, 0.08 * grad)); rg.addColorStop(1, LOOK_rgba(T.key, 0));
      ctx.globalCompositeOperation = 'screen'; ctx.fillStyle = rg; ctx.fillRect(bb[0], bb[1], bb[2], bb[3]);
      const lg = ctx.createLinearGradient(cx + lx * size * 0.1, cy + ly * size * 0.1, cx - lx * size * 0.62, cy - ly * size * 0.62);
      lg.addColorStop(0, LOOK_rgba(T.mid, 0)); lg.addColorStop(1, LOOK_rgba(T.mid, 0.9 * grad));
      ctx.globalCompositeOperation = 'multiply'; ctx.fillStyle = lg; ctx.fillRect(bb[0], bb[1], bb[2], bb[3]);
    }
    if (!o.union) {
      // 2. cel steps (hard terminators), 3. lit-edge kiss, 4. gloss, 5. rim: all drawn directly
      const pass = (op, col, alpha, ax, ay, bx, by) => { ctx.globalCompositeOperation = op; ctx.globalAlpha = prevA * alpha; ctx.fillStyle = col; bandDirect(ctx, shape, ax, ay, bx, by, bb, pad); };
      if (mid > 0) pass('multiply', T.mid, 1, lx * size * mid, ly * size * mid, null, 0);
      if (core > 0) pass('multiply', T.core, 1, lx * size * core, ly * size * core, null, 0);
      if (hi > 0) pass('screen', T.key, o.hiA ?? 0.45, -lx * size * hi, -ly * size * hi, null, 0);
      if (gloss > 0) { const a = size * (o.glossIn ?? 0.10), b = a + size * (o.glossW ?? 0.07); pass('screen', '#ffffff', gloss, -lx * a, -ly * a, -lx * b, -ly * b); }
      if (rim > 0) pass('screen', T.rim, o.rimA ?? 1, lx * size * rim, ly * size * rim, null, 0);
      ctx.globalAlpha = prevA;
    }
    // 6. texture
    if (o.tex) { ctx.globalAlpha = prevA; texFill(ctx, bb, o.tex, o.texScale || 1); }
    ctx.restore();
    if (o.union) {
      const R = devRegion(ctx, bb, size * 0.02); if (!R) return;
      const lay = (dx, dy, col, op, alpha) => { const [c, g] = work('shade', R.w, R.h); setDev(g, R); crescent(g, shape, dx, dy, col); blitDev(ctx, c, R, op, alpha); };
      if (mid > 0) lay(lx * size * mid, ly * size * mid, T.mid, 'multiply', 1);
      if (core > 0) lay(lx * size * core, ly * size * core, T.core, 'multiply', 1);
      if (hi > 0) lay(-lx * size * hi, -ly * size * hi, T.key, 'screen', o.hiA ?? 0.45);
      if (gloss > 0) {
        const [c, g] = work('shade', R.w, R.h); setDev(g, R);
        const a = size * (o.glossIn ?? 0.10), b = a + size * (o.glossW ?? 0.07);
        g.fillStyle = '#ffffff'; g.save(); g.translate(-lx * a, -ly * a); fillShape(g, shape); g.restore();
        g.globalCompositeOperation = 'destination-out'; g.save(); g.translate(-lx * b, -ly * b); fillShape(g, shape); g.restore();
        g.globalCompositeOperation = 'destination-in'; fillShape(g, shape);
        blitDev(ctx, c, R, 'screen', gloss);
      }
      if (rim > 0) lay(lx * size * rim, ly * size * rim, T.rim, 'screen', o.rimA ?? 1);
    }
    if (o.ink) LOOK_ink(ctx, shape, o.ink, o.inkColor, !!o.union, bb);
  }

  // ================================================================ LOOK_lobes
  // Multi-lobe volume (cloud, smoke, explosion puff, plume). lobes = [[x, y, rx, ry], ...] in
  // BACK-TO-FRONT order. Each lobe is filled, toon-shaded as its own volume, and darkened by a
  // soft occlusion where the next lobe sits on it; then one outer ink line wraps the union.
  // o: fill '#f3ecff' (or array per lobe), light, mid 0.30, core 0.12, rim 0.04, lobeMid 0.12, tex 0 (costly: multiply pattern), ao 0.45 (0 = off),
  //    ink 5 (0 = none), inkColor, shadeOpts (extra LOOK_shade options)
  function LOOK_lobes(ctx, lobes, o = {}) {
    const one = (l) => (g) => { g.moveTo(l[0] + l[2], l[1]); g.ellipse(l[0], l[1], l[2], l[3], 0, 0, TAU); };
    const union = (g) => lobes.forEach((l) => one(l)(g));
    let mnx = 1e9, mny = 1e9, mxx = -1e9, mxy = -1e9;
    lobes.forEach((l) => { mnx = Math.min(mnx, l[0] - l[2]); mny = Math.min(mny, l[1] - l[3]); mxx = Math.max(mxx, l[0] + l[2]); mxy = Math.max(mxy, l[1] + l[3]); });
    const ub = [mnx, mny, mxx - mnx, mxy - mny];
    lobes.forEach((l, i) => {
      const s = one(l), bb = [l[0] - l[2], l[1] - l[3], 2 * l[2], 2 * l[3]];
      ctx.fillStyle = Array.isArray(o.fill) ? o.fill[i % o.fill.length] : (o.fill || '#f3ecff'); ctx.beginPath(); s(ctx); ctx.fill();
      // per-lobe pass: only a soft separation step, so lobes read as one mass, not balls
      LOOK_shade(ctx, s, bb, Object.assign({ light: o.light, size: 2 * Math.min(l[2], l[3]), mid: o.lobeMid ?? 0.12, core: 0, rim: 0, hi: 0, grad: 0 }, o.lobeOpts || {}));
      const nx = lobes[i + 1];
      if (nx && (o.ao ?? 0.45) > 0) { // cheap occlusion ring: soft dark halo of the next lobe, clipped to this one
        ctx.save(); ctx.beginPath(); s(ctx); ctx.clip(); ctx.translate(nx[0], nx[1]); ctx.scale(1, nx[3] / nx[2]);
        const rg = ctx.createRadialGradient(0, 0, nx[2] * 0.85, 0, 0, nx[2] * 1.3), col = o.aoColor || '#2a1745';
        rg.addColorStop(0, LOOK_rgba(col, o.ao ?? 0.45)); rg.addColorStop(1, LOOK_rgba(col, 0));
        ctx.globalCompositeOperation = 'multiply'; ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(0, 0, nx[2] * 1.3, 0, TAU); ctx.fill(); ctx.restore();
      }
    });
    // global pass over the whole union: the cloud's real volume (big step, core, rim, lit-edge kiss)
    LOOK_shade(ctx, union, ub, Object.assign({ light: o.light, size: Math.min(ub[2], ub[3]), mid: o.mid ?? 0.30, core: o.core ?? 0.12, rim: o.rim ?? 0.04, hi: o.hi ?? 0.05, hiA: 0.4, grad: 0.8, union: true, tex: o.tex ?? 0 }, o.shadeOpts || {}));
    if ((o.ink ?? 5) > 0) LOOK_ink(ctx, union, o.ink ?? 5, o.inkColor || '#120d1c', true, ub);
    return union;
  }

  // ================================================================ LOOK_cache
  // Bake any lit subject that does not change shape (a cloud that only drifts, a parked probe) into a
  // sprite once, then draw it with one drawImage. Light is screen-fixed, so translation and zoom stay
  // correct; do NOT cache across rotation or re-posing. drawFn(g) draws in the same user units as now.
  // bb [x,y,w,h] must contain the drawing (include glow/ink margins). o: res (px per unit, default 1.25x
  // the current on-screen scale, max 2), key (string; include anything that changes the look).
  const CACHE = new Map();
  function LOOK_cache(ctx, key, bb, drawFn, o = {}) {
    let E = CACHE.get(key);
    if (!E) {
      const res = Math.min(2, o.res || scaleOf(ctx.getTransform()) * 1.25);
      const c = document.createElement('canvas'); c.width = Math.max(2, Math.ceil(bb[2] * res)); c.height = Math.max(2, Math.ceil(bb[3] * res));
      const g = c.getContext('2d'); g.setTransform(res, 0, 0, res, -bb[0] * res, -bb[1] * res); drawFn(g);
      E = { c, bb: bb.slice() }; if (CACHE.size > 200) CACHE.clear(); CACHE.set(key, E);
    }
    const dx = o.dx || 0, dy = o.dy || 0;
    ctx.drawImage(E.c, E.bb[0] + dx, E.bb[1] + dy, E.bb[2], E.bb[3]);
  }

  // ================================================================ LOOK_sphere
  // Analytic toon sphere (no offscreen work, fast). Options:
  //   base '#d9c7a8' or surface(ctx) (draws the flat surface art; the sphere clip is active),
  //   term 0.06 (first terminator: signed semi-minor of the terminator ellipse, fraction of r;
  //   bigger = smaller shadow), core 0.50 (second, darker step), night 0 (0..1 extra darkening of the
  //   dark side, for planets in space: 0.6 gives a night side about 30% of day value),
  //   lift 0.26 (lit-pool screen strength), rim 0.06 + rimA 0.85, hi 0.05 (lit limb kiss), spec 0 (0..1 hard highlight), tex 0,
  //   atmo null|'#7fd8ff' (thin inner scatter on the lit limb + outer halo), atmoW 0.14, atmoA 0.55,
  //   ink 0, inkColor, light.
  function termPath(ctx, x, y, r, a, e) {
    ctx.beginPath(); ctx.arc(x, y, r, a + Math.PI / 2, a + 1.5 * Math.PI, false);
    const em = Math.max(0.0001, Math.abs(e) * r);
    if (e >= 0) ctx.ellipse(x, y, em, r, a, 1.5 * Math.PI, 0.5 * Math.PI, true);
    else ctx.ellipse(x, y, em, r, a, 1.5 * Math.PI, 2.5 * Math.PI, false);
    ctx.closePath();
  }
  // Lighting for a sphere is baked into two cached sprites per (light angle, options, size bucket):
  // MUL (built on white with multiply passes: limb darkening, tone steps, night) and SCR (built on
  // black with screen passes: lit pool, atmosphere scatter, limb kiss, rim). Per frame the cost is
  // the surface art + 2 drawImage calls, independent of how many passes the look uses.
  const SPHC = new Map();
  function sphereSprites(L, T, a, lx, ly, o, px) {
    const key = [Math.round(a * 100), px, o.term ?? 0.06, o.core ?? 0.5, o.night || 0, o.atmo || '', o.atmoA ?? 0.55, o.hi ?? 0.05, o.hiA ?? 0.5, o.rim ?? 0.06, o.rimA ?? 0.85, o.lift ?? 0.26, o.spec || 0, T.mid, T.core, T.key, T.rim].join('|');
    let S = SPHC.get(key); if (S) return S;
    if (SPHC.size > 60) SPHC.clear();
    const mk = () => { const c = document.createElement('canvas'); c.width = c.height = px; return c; };
    const M = mk(), N = mk(), gm = M.getContext('2d'), gs = N.getContext('2d');
    const r = px / 2, x = r, y = r, hx = x + lx * r * 0.42, hy = y + ly * r * 0.42;
    // multiply layer on white
    gm.fillStyle = '#ffffff'; gm.fillRect(0, 0, px, px);
    gm.beginPath(); gm.arc(x, y, r, 0, TAU); gm.clip(); gm.globalCompositeOperation = 'multiply';
    let g = gm.createRadialGradient(hx, hy, r * 0.5, hx, hy, r * 1.55);
    g.addColorStop(0, LOOK_rgba(T.mid, 0)); g.addColorStop(1, LOOK_rgba(T.mid, 1)); gm.fillStyle = g; gm.fillRect(0, 0, px, px);
    gm.fillStyle = T.mid; termPath(gm, x, y, r, a, o.term ?? 0.06); gm.fill();
    gm.fillStyle = T.core; termPath(gm, x, y, r, a, o.core ?? 0.5); gm.fill();
    if (o.night) { gm.globalAlpha = o.night; gm.fillStyle = LOOK_mix('#ffffff', '#1d1450', 0.85); termPath(gm, x, y, r, a, o.term ?? 0.06); gm.fill(); gm.globalAlpha = 1; }
    // screen layer on black
    gs.fillStyle = '#000000'; gs.fillRect(0, 0, px, px);
    gs.beginPath(); gs.arc(x, y, r, 0, TAU); gs.clip(); gs.globalCompositeOperation = 'screen';
    g = gs.createRadialGradient(hx, hy, 0, hx, hy, r * 1.1);
    g.addColorStop(0, LOOK_rgba(T.key, o.lift ?? 0.26)); g.addColorStop(0.5, LOOK_rgba(T.key, (o.lift ?? 0.26) * 0.25)); g.addColorStop(1, LOOK_rgba(T.key, 0));
    gs.fillStyle = g; gs.fillRect(0, 0, px, px);
    if (o.atmo) {
      g = gs.createRadialGradient(x - lx * r * 0.1, y - ly * r * 0.1, r * 0.78, x - lx * r * 0.1, y - ly * r * 0.1, r * 1.1);
      g.addColorStop(0, LOOK_rgba(o.atmo, 0)); g.addColorStop(0.62, LOOK_rgba(o.atmo, 0.12)); g.addColorStop(1, LOOK_rgba(o.atmo, o.atmoA ?? 0.55));
      gs.fillStyle = g; gs.fillRect(0, 0, px, px);
    }
    const hiW = (o.hi ?? 0.05) * r;
    if (hiW > 0) { gs.fillStyle = LOOK_rgba(T.key, o.hiA ?? 0.5); gs.beginPath(); gs.arc(x, y, r, 0, TAU); gs.arc(x - lx * hiW, y - ly * hiW, r, 0, TAU); gs.fill('evenodd'); }
    const rimW = (o.rim ?? 0.06) * r;
    if (rimW > 0) {
      gs.fillStyle = LOOK_rgba(T.rim, (o.rimA ?? 0.85) * 0.35); gs.beginPath(); gs.arc(x, y, r, 0, TAU); gs.arc(x + lx * rimW * 2.4, y + ly * rimW * 2.4, r, 0, TAU); gs.fill('evenodd');
      gs.fillStyle = LOOK_rgba(T.rim, o.rimA ?? 0.85); gs.beginPath(); gs.arc(x, y, r, 0, TAU); gs.arc(x + lx * rimW, y + ly * rimW, r, 0, TAU); gs.fill('evenodd');
    }
    if (o.spec) {
      gs.fillStyle = `rgba(255,255,255,${o.spec})`;
      gs.beginPath(); gs.ellipse(x + lx * r * 0.55, y + ly * r * 0.55, r * 0.16, r * 0.075, a + Math.PI / 2, 0, TAU); gs.fill();
      gs.beginPath(); gs.arc(x + lx * r * 0.36 - ly * r * 0.2, y + ly * r * 0.36 + lx * r * 0.2, r * 0.03, 0, TAU); gs.fill();
    }
    S = { M, N }; SPHC.set(key, S); return S;
  }
  function LOOK_sphere(ctx, x, y, r, o = {}) {
    if (r <= 0.5) return;
    const L = LT(o), T = LOOK_tints(L), [lx, ly] = LOOK_lightDir(ctx, L), a = Math.atan2(ly, lx);
    const onScreen = 2 * r * scaleOf(ctx.getTransform());
    const px = Math.min(1024, Math.max(64, Math.pow(2, Math.ceil(Math.log2(onScreen))) ));   // power-of-two size bucket
    const S = sphereSprites(L, T, a, lx, ly, o, px);
    ctx.save();
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.save(); ctx.clip();
    if (o.surface) o.surface(ctx); else { ctx.fillStyle = o.base || '#d9c7a8'; ctx.fillRect(x - r, y - r, 2 * r, 2 * r); }
    if (o.tex) texFill(ctx, [x - r, y - r, 2 * r, 2 * r], o.tex, o.texScale || r / 260);
    ctx.globalCompositeOperation = 'multiply'; ctx.drawImage(S.M, x - r, y - r, 2 * r, 2 * r);
    ctx.globalCompositeOperation = 'screen'; ctx.drawImage(S.N, x - r, y - r, 2 * r, 2 * r);
    ctx.restore(); // clip
    if (o.atmo) { // outer halo, brighter on the lit side
      const ox = x + lx * r * 0.05, oy = y + ly * r * 0.05, w = o.atmoW ?? 0.14;
      g = ctx.createRadialGradient(ox, oy, r * 0.97, ox, oy, r * (1 + w));
      g.addColorStop(0, LOOK_rgba(o.atmo, o.atmoA ?? 0.55)); g.addColorStop(0.25, LOOK_rgba(o.atmo, (o.atmoA ?? 0.55) * 0.4)); g.addColorStop(1, LOOK_rgba(o.atmo, 0));
      ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = g; ctx.beginPath(); ctx.arc(ox, oy, r * (1 + w), 0, TAU); ctx.arc(x, y, r * 0.995, 0, TAU, true); ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    }
    if (o.ink) { ctx.strokeStyle = o.inkColor || '#120d1c'; ctx.lineWidth = o.ink; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke(); }
    ctx.restore();
  }

  // ================================================================ shadows
  // Soft elliptical contact shadow on a ground line, pushed away from the light.
  // o: h (height, default w*0.16), color '#1c0f33', alpha 0.55, light, lift 0 (0..1: object height above ground, fades + widens)
  function LOOK_contactShadow(ctx, x, y, w, o = {}) {
    const L = LT(o), lift = o.lift || 0, col = o.color || '#1c0f33', al = (o.alpha ?? 0.55) * (1 - 0.7 * lift);
    const sx = x - L.x * w * (0.12 + lift * 0.3), h = (o.h || w * 0.16) * (1 + lift * 0.5), ww = w * (1 + lift * 0.4);
    ctx.save(); ctx.globalCompositeOperation = 'multiply';
    ctx.translate(sx, y); ctx.scale(1, h / ww);
    let g = ctx.createRadialGradient(0, 0, 0, 0, 0, ww * 0.5);
    g.addColorStop(0, LOOK_rgba(col, al * 0.75)); g.addColorStop(0.6, LOOK_rgba(col, al * 0.35)); g.addColorStop(1, LOOK_rgba(col, 0));
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, ww * 0.5, 0, TAU); ctx.fill();
    g = ctx.createRadialGradient(0, 0, 0, 0, 0, ww * 0.26);   // dark core right under the contact
    g.addColorStop(0, LOOK_rgba(col, al)); g.addColorStop(1, LOOK_rgba(col, 0));
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, ww * 0.26, 0, TAU); ctx.fill();
    ctx.restore();
  }
  // Silhouette shadow thrown away from the light onto whatever is behind (optionally only onto `receiver`).
  // o: dist 40, blur 12, color '#1c0f33', alpha 0.5, receiver (shape), light
  function LOOK_castShadow(ctx, shape, bb, o = {}) {
    const L = LT(o), [lx, ly] = LOOK_lightDir(ctx, L), dist = o.dist ?? 40, blur = o.blur ?? 12;
    const U = userRegion(ctx, bb, dist + blur * 2.5, 0.5);
    const [a, ga] = work('csA', U.pw, U.ph); setUser(ga, U);
    ga.fillStyle = o.color || '#1c0f33'; ga.translate(-lx * dist, -ly * dist); fillShape(ga, shape);
    const [b, gb] = work('csB', U.pw, U.ph);
    gb.filter = `blur(${Math.max(0.1, blur * U.res)}px)`; gb.drawImage(a, 0, 0); gb.filter = 'none';
    if (o.receiver) { setUser(gb, U); gb.globalCompositeOperation = 'destination-in'; fillShape(gb, o.receiver); }
    blitUser(ctx, b, U, 'multiply', o.alpha ?? 0.5);
  }
  // Ambient occlusion: darkens the receiver where the occluder sits on/near it. Call after drawing
  // (and shading) the receiver, before drawing the occluder. o: radius 16, color '#2a1745', alpha 0.6
  function LOOK_ao(ctx, occluder, receiver, bb, o = {}) {
    const rad = o.radius ?? 16;
    const U = userRegion(ctx, bb, rad * 2.5, 0.5);
    const [a, ga] = work('aoA', U.pw, U.ph); setUser(ga, U); ga.fillStyle = o.color || '#2a1745'; fillShape(ga, occluder);
    const [b, gb] = work('aoB', U.pw, U.ph);
    gb.filter = `blur(${Math.max(0.1, rad * U.res)}px)`; gb.drawImage(a, 0, 0); gb.drawImage(a, 0, 0); gb.filter = 'none';
    setUser(gb, U); gb.globalCompositeOperation = 'destination-in'; fillShape(gb, receiver);
    blitUser(ctx, b, U, 'multiply', o.alpha ?? 0.6);
  }

  // ================================================================ emissive
  const SPR = new Map();
  function sprite(color, kind) { // 256px radial sprite with a physically-flavoured falloff
    const k = color + kind; if (SPR.has(k)) return SPR.get(k);
    const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d');
    const gr = g.createRadialGradient(128, 128, 0, 128, 128, 128), A = hex(color);
    for (let i = 0; i <= 24; i++) {
      const d = i / 24;
      let v = kind === 'core' ? Math.exp(-d * d * 9) : (1 / (1 + 22 * d * d) - 1 / 23) / (1 - 1 / 23);
      v *= 1 - Math.pow(d, 6);
      gr.addColorStop(d, `rgba(${A[0]},${A[1]},${A[2]},${Math.max(0, v).toFixed(4)})`);
    }
    g.fillStyle = gr; g.fillRect(0, 0, 256, 256); SPR.set(k, c); return c;
  }
  // Additive glow: wide halo (inverse-square-ish) + hot core + optional 4-point flare.
  // o: core '#ffffff' (null = none), coreR 0.16 (fraction of r), flare 0 (length as multiple of r), flareW, rot
  function LOOK_glow(ctx, x, y, r, color, intensity = 1, o = {}) {
    if (r <= 0 || intensity <= 0) return;
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha *= Math.min(1, intensity); ctx.drawImage(sprite(color, 'halo'), x - r, y - r, 2 * r, 2 * r);
    if (intensity > 1) { ctx.globalAlpha = Math.min(1, intensity - 1); ctx.drawImage(sprite(color, 'halo'), x - r * 0.6, y - r * 0.6, 1.2 * r, 1.2 * r); }
    if (o.core !== null) { const cr = r * (o.coreR ?? 0.16) * 2.4; ctx.globalAlpha = Math.min(1, intensity); ctx.drawImage(sprite(o.core || '#ffffff', 'core'), x - cr, y - cr, 2 * cr, 2 * cr); }
    if (o.flare) {
      const len = r * o.flare, w = o.flareW ?? r * 0.035, rot = o.rot || 0;
      for (let i = 0; i < 4; i++) {
        const ang = rot + i * Math.PI / 2, dx = Math.cos(ang), dy = Math.sin(ang), L2 = len * (i % 2 ? 0.62 : 1);
        const gr = ctx.createLinearGradient(x, y, x + dx * L2, y + dy * L2);
        gr.addColorStop(0, 'rgba(255,255,255,0.95)'); gr.addColorStop(0.3, LOOK_rgba(color, 0.6)); gr.addColorStop(1, LOOK_rgba(color, 0));
        ctx.fillStyle = gr; ctx.beginPath(); ctx.moveTo(x - dy * w, y + dx * w); ctx.lineTo(x + dx * L2, y + dy * L2); ctx.lineTo(x + dy * w, y - dx * w); ctx.closePath(); ctx.fill();
      }
    }
    ctx.restore();
  }
  // Shape-true bloom: blur whatever emitFn draws (in its own colours) and add it back.
  // o: radius 50 (wide blur), tight 0.22 (tight blur as a fraction of radius), strength 1, tightA 0.9,
  //    cacheKey (reuse the blurred layer; it lives in user space so camera moves are free).
  const BLOOM = new Map();
  function LOOK_bloom(ctx, emitFn, bb, o = {}) {
    const rad = o.radius ?? 50, st = o.strength ?? 1;
    const U = userRegion(ctx, bb, rad * 2.2, o.res ?? 0.34, 900);
    let out = o.cacheKey ? BLOOM.get(o.cacheKey) : null;
    if (!out) {
      const [a, ga] = work('blA', U.pw, U.ph); setUser(ga, U); emitFn(ga);
      let b, gb;
      if (o.cacheKey) { b = document.createElement('canvas'); b.width = U.pw; b.height = U.ph; gb = b.getContext('2d'); }
      else [b, gb] = work('blB', U.pw, U.ph);
      gb.globalCompositeOperation = 'lighter';
      gb.filter = `blur(${Math.max(0.1, rad * (o.tight ?? 0.22) * U.res)}px)`; gb.globalAlpha = o.tightA ?? 0.9; gb.drawImage(a, 0, 0);
      gb.filter = `blur(${Math.max(0.1, rad * U.res)}px)`; gb.globalAlpha = 1; gb.drawImage(a, 0, 0); gb.drawImage(a, 0, 0);
      gb.filter = 'none';
      out = { c: b, U };
      if (o.cacheKey) BLOOM.set(o.cacheKey, out);
    }
    const V = out.U;
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha *= Math.min(1, st);
    ctx.drawImage(out.c, 0, 0, V.pw, V.ph, V.X, V.Y, V.W, V.H);
    if (st > 1) { ctx.globalAlpha = Math.min(1, st - 1); ctx.drawImage(out.c, 0, 0, V.pw, V.ph, V.X, V.Y, V.W, V.H); }
    ctx.restore();
  }

  // ================================================================ light interaction
  // Light wrap: a bright background/source bleeds a soft band onto the subject's edges.
  // o: color (the background/light colour), dir [dx,dy] SCREEN direction from subject toward the source
  //    (default: toward the key), width (user units, default 0.09*size), alpha 0.85, op 'screen'
  function LOOK_lightWrap(ctx, shape, bb, o = {}) {
    const L = LT(o), size = o.size || Math.min(bb[2], bb[3]), w = o.width ?? size * 0.09;
    const [sx, sy] = o.dir ? dirLocal(ctx, o.dir[0], o.dir[1]) : LOOK_lightDir(ctx, L);
    const U = userRegion(ctx, bb, w * 2, 0.5);
    const [a, ga] = work('wrA', U.pw, U.ph); ga.fillStyle = o.color || L.key; ga.fillRect(0, 0, U.pw, U.ph);
    setUser(ga, U); ga.globalCompositeOperation = 'destination-out'; fillShape(ga, shape);
    const [b, gb] = work('wrB', U.pw, U.ph);
    gb.filter = `blur(${Math.max(0.1, w * U.res * 0.6)}px)`; gb.drawImage(a, 0, 0); gb.filter = 'none';
    setUser(gb, U); gb.globalCompositeOperation = 'destination-in'; fillShape(gb, shape);
    if (o.dir !== null) {
      const cx = bb[0] + bb[2] / 2, cy = bb[1] + bb[3] / 2;
      const lg = gb.createLinearGradient(cx + sx * size * 0.5, cy + sy * size * 0.5, cx - sx * size * 0.35, cy - sy * size * 0.35);
      lg.addColorStop(0, 'rgba(0,0,0,1)'); lg.addColorStop(1, 'rgba(0,0,0,0.08)');
      gb.globalCompositeOperation = 'destination-in'; gb.fillStyle = lg; gb.fillRect(U.X, U.Y, U.W, U.H);
    }
    blitUser(ctx, b, U, o.op || 'screen', o.alpha ?? 0.85);
  }
  // Coloured point light: tints shapes near it (falloff wash) and puts a hard-ish rim on the side facing it.
  // o: color '#ff8a3c', radius 420, intensity 0.85, rim 0.06 (fraction of size), rimA 1, size, op 'screen', union false
  function LOOK_pointLight(ctx, shape, bb, px, py, o = {}) {
    const col = o.color || '#ff8a3c', rad = o.radius ?? 420, I = o.intensity ?? 0.85, size = o.size || Math.min(bb[2], bb[3]);
    ctx.save(); clipShape(ctx, shape); ctx.globalCompositeOperation = o.op || 'screen';
    const g = ctx.createRadialGradient(px, py, 0, px, py, rad);
    g.addColorStop(0, LOOK_rgba(col, I)); g.addColorStop(0.3, LOOK_rgba(col, I * 0.5)); g.addColorStop(0.65, LOOK_rgba(col, I * 0.14)); g.addColorStop(1, LOOK_rgba(col, 0));
    ctx.fillStyle = g; ctx.fillRect(bb[0], bb[1], bb[2], bb[3]); ctx.restore();
    const rim = o.rim ?? 0.06; if (rim <= 0) return;
    const cx = bb[0] + bb[2] / 2, cy = bb[1] + bb[3] / 2, d = Math.hypot(px - cx, py - cy) || 1;
    const fall = Math.max(0, 1 - d / (rad * 1.1)); if (fall <= 0) return;
    const ux = (px - cx) / d, uy = (py - cy) / d;
    const al = (o.rimA ?? 1) * Math.min(1, fall * 1.6) * Math.min(1, I);
    if (!o.union) { ctx.save(); clipShape(ctx, shape); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha *= al; ctx.fillStyle = col; bandDirect(ctx, shape, -ux * size * rim, -uy * size * rim, null, 0, bb, 2); ctx.restore(); return; }
    const R = devRegion(ctx, bb, 2); if (!R) return;
    const [c, gg] = work('pl', R.w, R.h); setDev(gg, R);
    crescent(gg, shape, -ux * size * rim, -uy * size * rim, col);
    blitDev(ctx, c, R, 'lighter', al);
  }
  // God rays: a fan of tapered additive beams from (x, y). Deterministic shimmer from t.
  // o: angle (centre direction, rad, default down-right away from key), spread 0.9, n 9, len 900,
  //    width 120 (far-end width), color '255,236,200' (rgb string), alpha 0.18, seed 1, t 0, op 'lighter'
  const RAYS = new Map();
  function LOOK_godRays(ctx, x, y, o = {}) {
    const n = o.n ?? 9, len = o.len ?? 900, spread = o.spread ?? 0.9, col = o.color || '255,236,200', t = o.t || 0, seed = o.seed ?? 1;
    const ang0 = o.angle ?? Math.atan2(-DEF.y, -DEF.x), wid = o.width ?? 120, alpha = o.alpha ?? 0.18;
    const key = [n, len, spread, col, seed, ang0.toFixed(3), wid, alpha].join('|');
    let F = RAYS.get(key);
    if (!F) { // bake the fan once at low resolution (beams are soft), centred on the source
      const res = Math.min(0.35, 700 / (2 * len)), S = Math.ceil(2 * len * res), c = document.createElement('canvas'); c.width = c.height = S;
      const g = c.getContext('2d'); g.setTransform(res, 0, 0, res, len * res, len * res); g.globalCompositeOperation = 'lighter';
      const h = (i, k) => { let v = Math.sin(i * 127.1 + k * 311.7 + seed * 74.7) * 43758.5453; return v - Math.floor(v); };
      for (let i = 0; i < n; i++) {
        const ang = ang0 + (h(i, 1) - 0.5) * spread, w = wid * (0.35 + 0.9 * h(i, 2)), a = alpha * (0.35 + 0.65 * h(i, 3));
        const l = len * (0.6 + 0.4 * h(i, 5)), dx = Math.cos(ang), dy = Math.sin(ang), nx = -dy, ny = dx;
        const gr = g.createLinearGradient(0, 0, dx * l, dy * l);
        gr.addColorStop(0, `rgba(${col},${a})`); gr.addColorStop(0.45, `rgba(${col},${a * 0.45})`); gr.addColorStop(1, `rgba(${col},0)`);
        g.fillStyle = gr; g.beginPath();
        g.moveTo(nx * w * 0.06, ny * w * 0.06); g.lineTo(dx * l + nx * w * 0.5, dy * l + ny * w * 0.5);
        g.lineTo(dx * l - nx * w * 0.5, dy * l - ny * w * 0.5); g.lineTo(-nx * w * 0.06, -ny * w * 0.06); g.closePath(); g.fill();
      }
      F = c; RAYS.set(key, F);
    }
    // deterministic shimmer: slow breathing plus a tiny rotation wobble
    ctx.save(); ctx.globalCompositeOperation = o.op || 'lighter'; ctx.globalAlpha *= 0.85 + 0.15 * Math.sin(t * 0.7 + seed);
    ctx.translate(x, y); ctx.rotate(0.012 * Math.sin(t * 0.33 + seed)); ctx.drawImage(F, -len, -len, 2 * len, 2 * len); ctx.restore();
  }
  // Occluded light shafts (crepuscular rays): a source at (x, y) streams past occluders.
  // regionBb is the area the shafts may cover (often the whole frame [0,0,1920,1080]).
  // o: color '#fff1d0', srcR 260 (source glow radius), len 0.55 (streak length as zoom factor),
  //    passes 10, alpha 0.6, res 0.25
  function LOOK_shafts(ctx, x, y, occluder, regionBb, o = {}) {
    const U = userRegion(ctx, regionBb, 0, o.res ?? 0.25, 700);
    const [a, ga] = work('shA', U.pw, U.ph); setUser(ga, U);
    const col = o.color || '#fff1d0', sr = o.srcR ?? 260;
    const g = ga.createRadialGradient(x, y, 0, x, y, sr);
    g.addColorStop(0, LOOK_rgba(col, 1)); g.addColorStop(0.35, LOOK_rgba(col, 0.55)); g.addColorStop(1, LOOK_rgba(col, 0));
    ga.fillStyle = g; ga.fillRect(x - sr, y - sr, 2 * sr, 2 * sr);
    if (occluder) { ga.globalCompositeOperation = 'destination-out'; ga.fillStyle = '#000'; fillShape(ga, occluder); }
    const [b, gb] = work('shB', U.pw, U.ph);
    const sx = (x - U.X) * U.res, sy = (y - U.Y) * U.res, P = o.passes ?? 16, len = o.len ?? 0.55;
    gb.globalCompositeOperation = 'lighter';
    for (let i = 0; i < P; i++) { // geometric zoom steps, linear decay
      const f = Math.pow(1 + len, i / (P - 1)); gb.globalAlpha = (1 - i / P) * 2.0 / P;
      gb.setTransform(f, 0, 0, f, sx * (1 - f), sy * (1 - f)); gb.drawImage(a, 0, 0);
    }
    const [c2, gc] = work('shC', U.pw, U.ph); // de-band
    gc.filter = 'blur(1.6px)'; gc.drawImage(b, 0, 0); gc.filter = 'none';
    blitUser(ctx, c2, U, 'lighter', o.alpha ?? 0.6);
  }

  Object.assign(window, { LOOK_cache, LOOK_light, LOOK_tints, LOOK_mix, LOOK_rgba, LOOK_lightDir, LOOK_ink, LOOK_shade, LOOK_lobes, LOOK_sphere,
    LOOK_contactShadow, LOOK_castShadow, LOOK_ao, LOOK_glow, LOOK_bloom, LOOK_lightWrap, LOOK_pointLight, LOOK_godRays, LOOK_shafts });
})();
