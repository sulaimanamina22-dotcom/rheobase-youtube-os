// line.js : Rheobase LINE ART kit. Prefix LINE_. Self-contained (no dependency on ENG), plain 2D canvas,
// deterministic (hashed noise only, no Math.random). Paste after engine/core.js or load as its own script.
//
// WHY: our ink is a dead-even stroke (ctx.lineWidth = 4 in local units, so it scales with the object and
// a 3x figure gets a 12 px sticker outline). The references draw a HIERARCHY of lines:
//   silhouette   = heaviest, near-black with a hue, thick on the shadow side (lower right), thin or LOST on the
//                  lit side (upper left), slight hand wobble, redrawn on twos/threes (boil);
//   inner lines  = about 45% of the silhouette weight, COLORED (a deep version of the local fill), tapered
//                  ends, pooled (thicker) where they hit another line;
//   texture/hatch= about 20% weight, colored, only on the shadow side of the form, cross-hatch in the core shadow;
//   rim line     = thin cool line just inside the shadow-side silhouette (rim light), optional pale key line on
//                  the lit side where the dark line is lost.
//
// UNITS: every width/amplitude option is in FRAME PIXELS at 1920x1080. Points are in whatever transform is
// current on ctx; the kit reads ctx's scale and converts, so zooming the camera does not fatten lines unless
// you pass a bigger w (use LINE_weight(sizeOnScreenPx)).
//
// LIGHT convention (shared brief): light = { x:-0.55, y:-0.83, key:'#fff4e0', rim:'#7fd8ff', amb:0.35 }
// (x,y) points TOWARD the key light (upper left). Shadow side = lower right.
//
// QUICK CALLS
//   const b = LINE_boil(t);                                   // 12 drawings per second
//   const w = LINE_weight(2 * R * camZoom);                   // silhouette weight from on-screen size
//   LINE_stroke(ctx, pts, { w, color, boil:b, seed:3 });       // tapered, pressure-varied, wobbling stroke
//   LINE_toon(ctx, outerPts, { w, boil:b, seed:1, fill:'#e39a55', inner:[{pts:seam, tips:[0.15,1.3]}],
//                              hatch:{ shade:LINE_shadeSphere(cx,cy,R) } });
//   LINE_silhouette(ctx, (g) => drawFillsOnly(g), [x,y,w,h], { w, boil:b });  // toon edge around ANY drawing
//   LINE_hatch(ctx, { box:[x,y,w,h], shade:LINE_shadeSphere(cx,cy,R), clip:(g)=>{...path...} , boil:b });
//   LINE_hatchSphere(ctx, cx, cy, R, { boil:b, shift1:0.72, shift2:1.12 }); // FAST pattern hatch for big round things
//   LINE_backline(ctx, [partPts, ...], { w, boil:b });         // CHEAP silhouette for vector parts: call BEFORE fills
//   LINE_sketch(ctx, pts, { w, boil:b, closed:true });         // double line with overshoot
// COST (headless export on this PC, software canvas): LINE_stroke 1-3 ms per line; LINE_toon 4-8 ms; vector
// LINE_hatch 3-6 ms on a 150 px part but 40+ ms on a full-screen planet (use LINE_hatchSphere there, ~15 ms);
// LINE_silhouette 30-70 ms (pixel bound, use only for small/complex drawings); LINE_backline ~5 ms.
// Measured: full hero frame (Jupiter R=620 + 3 clouds + astronaut) 80-87 ms with this kit vs 23-28 ms old ink.
// Shape helpers: LINE_ellipse, LINE_rrect, LINE_capsule, LINE_cloud, LINE_xform, LINE_inkOf, LINE_mix.
(function (G) {
  'use strict';
  const TAU = Math.PI * 2;
  const LINE_INK = '#120d1c';
  const LINE_LIGHT = { x: -0.55, y: -0.83, key: '#fff4e0', rim: '#7fd8ff', amb: 0.35 };
  const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
  const lerp = (a, b, k) => a + (b - a) * k;
  const sstep = (a, b, x) => { const k = clamp((x - a) / (b - a)); return k * k * (3 - 2 * k); };

  // ---------------- noise (integer-hash value noise) ----------------
  function hsh(a, b = 0, c = 0) {
    let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(c | 0, 1274126177)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }
  function vn2(x, y, seed) {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = hsh(xi, yi, seed), b = hsh(xi + 1, yi, seed), c = hsh(xi, yi + 1, seed), d = hsh(xi + 1, yi + 1, seed);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  // signed noise along a path; periodic when closed (sampled on a circle so the loop has no seam)
  function pathNoise(s, L, closed, lam, seed) {
    if (closed) { const a = (s / L) * TAU, R = Math.max(L / (TAU * lam), 0.3); return vn2(Math.cos(a) * R + 40, Math.sin(a) * R + 40, seed) * 2 - 1; }
    return vn2(s / lam + 3.1, 0.37 * seed, seed) * 2 - 1;
  }

  // ---------------- basics ----------------
  const LINE_boil = (t, fps = 12) => Math.floor(t * fps + 1e-6);
  // Silhouette weight (frame px) for an object `size` px across on screen. depth 0 = near, 1 = far.
  // Calibrated on the references: ~5 px at 100 px, ~8 px at 450 px, ~11 px at 1500 px. Far things get thinner.
  const LINE_weight = (size, depth = 0) => clamp(1.6 * Math.pow(Math.max(size, 1), 0.27) * (1 - 0.45 * clamp(depth)), 1.1, 24);
  function LINE_scale(ctx) { const m = ctx.getTransform(); return Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)) || 1; }

  // ---------------- color ----------------
  function rgb(c) {
    if (Array.isArray(c)) return c;
    if (c[0] === '#') { const n = c.length === 4 ? c.replace(/#(.)(.)(.)/, '#$1$1$2$2$3$3') : c; return [parseInt(n.substr(1, 2), 16), parseInt(n.substr(3, 2), 16), parseInt(n.substr(5, 2), 16)]; }
    const m = c.match(/[\d.]+/g); return [+m[0], +m[1], +m[2]];
  }
  const hex = (a) => '#' + a.map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');
  const LINE_mix = (a, b, k) => { const A = rgb(a), B = rgb(b); return hex(A.map((v, i) => lerp(v, B[i], k))); };
  // Colored line for a fill: the fill multiplied by itself (deeper, more saturated) pulled toward ink.
  // k 0.35 = texture line, 0.55 = inner contour, 0.8 = near-ink.
  function LINE_inkOf(fill, k = 0.55, ink = LINE_INK) { const A = rgb(fill); return LINE_mix(A.map((v) => (v * v) / 255), ink, k); }

  // ---------------- path utilities ----------------
  function LINE_xform(pts, M) { return pts.map(([x, y]) => [M.a * x + M.c * y + M.e, M.b * x + M.d * y + M.f]); }
  function LINE_ellipse(cx, cy, rx, ry, rot = 0, a0 = 0, a1 = TAU, n = 96) {
    const out = [], cr = Math.cos(rot), sr = Math.sin(rot), full = Math.abs(a1 - a0) >= TAU - 1e-6;
    const N = full ? n : n + 1;
    for (let i = 0; i < N; i++) { const a = a0 + ((a1 - a0) * i) / n, x = Math.cos(a) * rx, y = Math.sin(a) * ry; out.push([cx + x * cr - y * sr, cy + x * sr + y * cr]); }
    return out;
  }
  function LINE_rrect(x, y, w, h, r, n = 8) {
    r = Math.min(r, w / 2, h / 2); const out = [];
    const C = [[x + w - r, y + r, -Math.PI / 2], [x + w - r, y + h - r, 0], [x + r, y + h - r, Math.PI / 2], [x + r, y + r, Math.PI]];
    for (const [cx, cy, a0] of C) for (let i = 0; i <= n; i++) { const a = a0 + (i / n) * (Math.PI / 2); out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); }
    return out;
  }
  function LINE_capsule(x0, y0, x1, y1, r, n = 14) {
    const a = Math.atan2(y1 - y0, x1 - x0), out = [];
    for (let i = 0; i <= n; i++) { const t = a - Math.PI / 2 + (i / n) * Math.PI; out.push([x1 + Math.cos(t) * r, y1 + Math.sin(t) * r]); }
    for (let i = 0; i <= n; i++) { const t = a + Math.PI / 2 + (i / n) * Math.PI; out.push([x0 + Math.cos(t) * r, y0 + Math.sin(t) * r]); }
    return out;
  }
  function tracePath(ctx, pts, closed = true) { ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); if (closed) ctx.closePath(); }

  // Cloud from puffs [[cx,cy,r,ry?],...] (ellipse when ry given) listed BACK to FRONT. Returns { outer (closed
  // silhouette, star-shaped around the weighted centre), creases (open arcs where a front puff overlaps a puff
  // behind it: the scalloped inner contours), puffs, cx, cy }.
  function LINE_cloud(puffs, n = 220) {
    let cx = 0, cy = 0, wsum = 0; for (const [x, y, r] of puffs) { cx += x * r; cy += y * r; wsum += r; } cx /= wsum; cy /= wsum;
    const outer = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU, dx = Math.cos(a), dy = Math.sin(a); let best = 0;
      for (const [x, y, r, ry0] of puffs) {
        const k = r / (ry0 || r), px = x - cx, py = (y - cy) * k, ex = dx, ey = dy * k;
        const A = ex * ex + ey * ey, b = ex * px + ey * py, c = px * px + py * py - r * r, disc = b * b - A * c;
        if (disc >= 0) best = Math.max(best, (b + Math.sqrt(disc)) / A);
      }
      outer.push([cx + dx * best, cy + dy * best]);
    }
    const inside = (x, y, j) => { const p = puffs[j], ry = p[3] || p[2]; return ((x - p[0]) / p[2]) ** 2 + ((y - p[1]) / ry) ** 2 < 0.985; };
    const creases = [];
    puffs.forEach(([x, y, r, ry0], i) => {
      let run = []; const ry = ry0 || r, m = Math.max(24, Math.round(Math.max(r, ry) / 4));
      for (let k = 0; k <= m; k++) {
        const a = (k / m) * TAU, px = x + Math.cos(a) * r, py = y + Math.sin(a) * ry;
        let behind = false, front = false;
        for (let j = 0; j < puffs.length; j++) { if (j === i) continue; if (inside(px, py, j)) { if (j < i) behind = true; else front = true; } }
        if (behind && !front) run.push([px, py]); else { if (run.length > 3) creases.push(run); run = []; }
      }
      if (run.length > 3) creases.push(run);
    });
    return { outer, creases, puffs, cx, cy };
  }

  // resample a polyline to even spacing; returns [[x,y,s],...] and length
  function resample(pts, step, closed) {
    const P = closed ? pts.concat([pts[0]]) : pts, cum = [0];
    for (let i = 1; i < P.length; i++) cum.push(cum[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
    const L = cum[cum.length - 1]; if (L < 1e-6) return { p: [], L: 0 };
    const n = Math.max(closed ? 12 : 3, Math.round(L / step)), cnt = closed ? n : n + 1, out = [];
    let j = 0;
    for (let k = 0; k < cnt; k++) {
      const s = (L * k) / n; while (j < P.length - 2 && cum[j + 1] < s) j++;
      const seg = cum[j + 1] - cum[j] || 1, u = clamp((s - cum[j]) / seg);
      out.push([lerp(P[j][0], P[j + 1][0], u), lerp(P[j][1], P[j + 1][1], u), s]);
    }
    return { p: out, L };
  }
  function normals(p, closed) {
    const n = p.length, N = [];
    let area = 0; if (closed) for (let i = 0; i < n; i++) { const a = p[i], b = p[(i + 1) % n]; area += a[0] * b[1] - b[0] * a[1]; }
    const sg = closed && area < 0 ? -1 : 1;
    for (let i = 0; i < n; i++) {
      const a = closed ? p[(i - 1 + n) % n] : p[Math.max(0, i - 1)], b = closed ? p[(i + 1) % n] : p[Math.min(n - 1, i + 1)];
      let tx = b[0] - a[0], ty = b[1] - a[1]; const l = Math.hypot(tx, ty) || 1; tx /= l; ty /= l;
      N.push([sg * ty, -sg * tx]); // closed: outward normal; open: a consistent side
    }
    return N;
  }

  // ---------------- the core: variable-width stroke ----------------
  // pts: [[x,y],...] in current transform. Options (px = frame pixels):
  //  w 6          base width px            color ink          alpha 1
  //  closed false                          light LINE_LIGHT   bias 0.55 (shadow side x(1+bias), lit side x(1-bias))
  //  tips [0.12,0.12] width at start/end (x w); >1 pools ink (use at a junction)   taperLen 5*w px
  //  pressure 0.18  slow width variation   wobble auto (0.12*w+0.5 px)   boilAmp auto (min(1.6, 0.08*w+0.5) px)
  //  lam 110 px  wobble wavelength         boil 0  seed 0     step 4 px (resample spacing)
  //  outside 0.5 (closed: fraction of the width outside the path; 1 = all outside, keeps the fill intact)
  //  shift 0 px  (move the whole line along the normal, + = outward)
  //  lost 0      (0..1: the line fades to nothing on the most lit part, the 'lost edge')
  //  mask null   fn(nx, ny, s, L, x, y) -> 0..1 width multiplier (e.g. rim only on one side)
  function LINE_stroke(ctx, pts, o = {}) {
    if (!pts || pts.length < 2) return;
    const sc = LINE_scale(ctx), L0 = o.light || LINE_LIGHT;
    const ll = Math.hypot(L0.x, L0.y) || 1, Lx = L0.x / ll, Ly = L0.y / ll;
    const wPx = o.w ?? 6, w = wPx / sc, closed = !!o.closed, boil = o.boil | 0, seed = o.seed | 0;
    const bias = o.bias ?? 0.55, tips = o.tips || [0.12, 0.12], press = o.pressure ?? 0.18;
    const wob = (o.wobble ?? 0.12 * wPx + 0.5) / sc, bamp = (o.boilAmp ?? Math.min(1.6, 0.08 * wPx + 0.5)) / sc;
    const lam = (o.lam ?? 110) / sc, outside = o.outside ?? 0.5, shift = (o.shift ?? 0) / sc, lost = o.lost ?? 0;
    const { p, L } = resample(pts, (o.step ?? 4) / sc, closed); if (!p.length) return;
    const N = normals(p, closed), tl = Math.min((o.taperLen ?? 5 * wPx) / sc, L * 0.45);
    const A = [], B = [];
    for (let i = 0; i < p.length; i++) {
      const [x, y, s] = p[i], [nx, ny] = N[i];
      // hand wobble: static shape + a boil part that changes every drawing
      const d = shift + wob * (0.75 * pathNoise(s, L, closed, lam, seed) + 0.25 * pathNoise(s, L, closed, lam / 3.5, seed + 1))
        + bamp * pathNoise(s, L, closed, lam / 1.7, seed + 7 + boil * 13);
      // width
      let k = 1 + press * pathNoise(s, L, closed, lam * 0.8, seed + 5) + 0.06 * pathNoise(s, L, closed, lam / 2, seed + 9 + boil * 5);
      if (!closed) {
        if (s < tl) k *= lerp(tips[0], 1, Math.sin((s / tl) * Math.PI / 2));
        else if (L - s < tl) k *= lerp(tips[1], 1, Math.sin(((L - s) / tl) * Math.PI / 2));
      }
      const g = -(nx * Lx + ny * Ly); // +1 = normal faces away from the light (shadow side)
      if (closed) { k *= 1 + bias * g; if (lost > 0) k *= lerp(1, sstep(-0.92, -0.35, g), lost); }
      if (o.mask) k *= o.mask(nx, ny, s, L, x, y);
      const hw = Math.max(0, w * k);
      let a, b;
      if (closed) { a = hw * outside; b = -hw * (1 - outside); }
      else { const m = 1 + bias * 0.6 * g; a = hw * 0.5 * m; b = -hw * 0.5 * (2 - m); } // open: mass shifts to the shadow side
      A.push([x + nx * (d + a), y + ny * (d + a)]); B.push([x + nx * (d + b), y + ny * (d + b)]);
    }
    ctx.save();
    ctx.globalAlpha *= o.alpha ?? 1; ctx.fillStyle = o.color || LINE_INK;
    ctx.beginPath();
    if (closed) {
      A.forEach((q, i) => (i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]))); ctx.closePath();
      for (let i = B.length - 1; i >= 0; i--) (i === B.length - 1 ? ctx.moveTo(B[i][0], B[i][1]) : ctx.lineTo(B[i][0], B[i][1])); ctx.closePath();
      ctx.fill('evenodd');
    } else {
      A.forEach((q, i) => (i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1])));
      for (let i = B.length - 1; i >= 0; i--) ctx.lineTo(B[i][0], B[i][1]);
      ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  }

  // ---------------- shading fields for hatching ----------------
  // Each returns fn(x,y) -> 0 (fully lit) .. 1 (deep shadow); terminator sits at about 0.5.
  function LINE_shadeSphere(cx, cy, r, light = LINE_LIGHT, sy = 1) {
    const l3 = Math.hypot(light.x, light.y, 0.6), Lx = light.x / l3, Ly = light.y / l3, Lz = 0.6 / l3;
    return (x, y) => { const nx = (x - cx) / r, ny = (y - cy) / (r * sy), d = nx * nx + ny * ny; if (d > 1) return 0; const nz = Math.sqrt(1 - d); return clamp(0.5 - 0.95 * (nx * Lx + ny * Ly + nz * Lz)); };
  }
  // Cylinder along a direction (ax,ay) through (cx,cy), radius r: shading varies across the axis only.
  function LINE_shadeCylinder(cx, cy, ax, ay, r, light = LINE_LIGHT) {
    const al = Math.hypot(ax, ay) || 1, ux = -ay / al, uy = ax / al; // across-axis direction
    const l3 = Math.hypot(light.x, light.y, 0.6), Lx = light.x / l3, Ly = light.y / l3, Lz = 0.6 / l3;
    return (x, y) => { const s = ((x - cx) * ux + (y - cy) * uy) / r; if (Math.abs(s) > 1) return 0; const nz = Math.sqrt(1 - s * s); return clamp(0.5 - 0.95 * (s * (ux * Lx + uy * Ly) + nz * Lz)); };
  }
  // Max of several fields (e.g. one sphere per cloud puff).
  const LINE_shadeMax = (...fs) => (x, y) => { let m = 0; for (const f of fs) m = Math.max(m, f(x, y)); return m; };

  // ---------------- hatching ----------------
  // o: box [x,y,w,h] (current transform units) REQUIRED; shade fn REQUIRED; clip(ctx) builds a path (optional)
  //    thr 0.5 (hatch starts), cross 0.74 (second layer starts; false = none), gap 9 px, w 1.8 px,
  //    color '#2a1838', alpha 0.55, angle (default: along the terminator), crossAngle angle+1.05,
  //    bow 0.12 (lines bend to follow the form), maxLen 15*gap, boil, seed, light,
//    fast false (true: plain stroked lines, no taper; cheaper for very large areas)
  // o.cache = 'key' : render the hatch ONCE per variant into an offscreen (in the box's local units at the current
  // screen scale), then just drawImage it each frame. variants (default 3) are cycled by boil, so the hatch still
  // boils but only 3 drawings are ever built. Rebuilt if the on-screen scale grows by more than 1.4x.
  // Use it for big or slow-moving objects (a planet): it turns 20 to 60 ms into about 2 ms.
  const HCACHE = {};
  function LINE_hatch(ctx, o) {
    if (o.cache) {
      const sc = LINE_scale(ctx), nv = o.variants ?? 3, v = (o.boil | 0) % nv, key = o.cache + ':' + v, [bx, by, bw, bh] = o.box;
      let e = HCACHE[key];
      if (!e || sc > e.sc * 1.4) {
        const cv = e ? e.cv : document.createElement('canvas'), k = Math.min(sc, 2048 / Math.max(bw, bh));
        cv.width = Math.ceil(bw * k); cv.height = Math.ceil(bh * k);
        const g = cv.getContext('2d'); g.setTransform(k, 0, 0, k, -bx * k, -by * k); g.clearRect(bx, by, bw, bh);
        hatchDraw(g, { ...o, boil: v, gap: (o.gap ?? 9) * k / sc, w: (o.w ?? 1.8) * k / sc, maxLen: (o.maxLen ?? 15 * (o.gap ?? 9)) * k / sc, alpha: 1, clip: null });
        e = HCACHE[key] = { cv, sc };
      }
      ctx.save(); if (o.clip) { o.clip(ctx); ctx.clip(); } ctx.globalAlpha *= o.alpha ?? 0.55; ctx.drawImage(e.cv, bx, by, bw, bh); ctx.restore();
      return;
    }
    hatchDraw(ctx, o);
  }
  function hatchDraw(ctx, o) {
    const sc = LINE_scale(ctx), light = o.light || LINE_LIGHT, [bx, by, bw, bh] = o.box;
    const gap = (o.gap ?? 9) / sc, wl = (o.w ?? 1.8) / sc, boil = o.boil | 0, seed = o.seed | 0;
    const ang0 = o.angle ?? Math.atan2(light.y, light.x) + Math.PI / 2;
    const layers = [[ang0, o.thr ?? 0.5, 1]];
    if (o.cross !== false) layers.push([o.crossAngle ?? ang0 + 1.05, o.cross ?? 0.74, 0.85]);
    const cx = bx + bw / 2, cy = by + bh / 2, D = Math.hypot(bw, bh) / 2, bow = o.bow ?? 0.12, maxLen = (o.maxLen ?? 15 * (o.gap ?? 9)) / sc;
    ctx.save();
    if (o.clip) { o.clip(ctx); ctx.clip(); }
    ctx.globalAlpha *= o.alpha ?? 0.55; ctx.fillStyle = o.color || '#2a1838';
    layers.forEach(([ang, thr, wm], li) => {
      const ux = Math.cos(ang), uy = Math.sin(ang), vx = -uy, vy = ux, st = gap * 0.6;
      ctx.beginPath();
      let i = 0, hwSum = 0, hwN = 0;
      for (let dd = -D; dd <= D; dd += gap, i++) {
        const d = dd + (hsh(i, boil, seed + li * 31) - 0.5) * gap * 0.35, th = thr + (hsh(i, boil + 3, seed + li) - 0.5) * 0.08;
        let run = [];
        const flush = () => {
          if (run.length >= 2) {
            let sh = 0; for (const q of run) sh += q[2]; sh /= run.length;
            const hw = 0.5 * wl * wm * (0.55 + 0.9 * clamp((sh - th) / (1 - th + 1e-6)));
            if (o.fast) { ctx.moveTo(run[0][0], run[0][1]); ctx.lineTo(run[run.length >> 1][0], run[run.length >> 1][1]); ctx.lineTo(run[run.length - 1][0], run[run.length - 1][1]); hwSum += hw; hwN++; run = []; return; }
            if (run.length > 5) { const m = run.length - 1; run = [0, 0.25, 0.5, 0.75, 1].map((u) => run[Math.round(u * m)]); } // decimate: hatch lines are near straight
            const n = run.length, A = [], B = [];
            run.forEach(([x, y], k) => { const u = k / (n - 1), tp = Math.sin(Math.PI * clamp(u * 1.0)) * 0.85 + 0.15; A.push([x + vx * hw * tp, y + vy * hw * tp]); B.push([x - vx * hw * tp, y - vy * hw * tp]); });
            A.forEach((q, k) => (k ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]))); for (let k = n - 1; k >= 0; k--) ctx.lineTo(B[k][0], B[k][1]); ctx.closePath();
          }
          run = [];
        };
        let runLen = 0;
        for (let t = -D; t <= D; t += st) {
          const bend = bow * D * ((t / D) ** 2 - 0.33);
          const x = cx + vx * (d + bend) + ux * t, y = cy + vy * (d + bend) + uy * t;
          const s = o.shade(x, y);
          if (s > th) { run.push([x, y, s]); runLen += st; if (runLen > maxLen * (0.6 + 0.4 * hsh(i, run.length, seed))) { flush(); runLen = 0; t += st; } }
          else if (run.length) { flush(); runLen = 0; }
        }
        flush();
      }
      if (o.fast) { ctx.strokeStyle = ctx.fillStyle; ctx.lineCap = 'round'; ctx.lineWidth = hwN ? (2 * hwSum) / hwN : wl; ctx.stroke(); } else ctx.fill();
    });
    ctx.restore();
  }

  // ---------------- FAST hatching for big round things (planets, moons, big clouds) ----------------
  // Same look as LINE_hatch on a sphere, but filled from a cached tileable hatch tile (built once, 3 boil variants)
  // through crescent clips, so the cost is one pattern fill per layer whatever the size.
  // o: light, gap 9 px, w 1.8 px, color, alpha 0.5, shift1 0.55 (single-hatch crescent: disc minus a circle moved
  //    shift1*r toward the light), shift2 1.0 (cross-hatch crescent), cross true, boil, seed, clip (extra clip path fn)
  const TILES = {};
  function hatchTile(gap, w, v) {
    const key = gap.toFixed(1) + ':' + w.toFixed(2) + ':' + v; if (TILES[key]) return TILES[key];
    const rows = Math.max(8, Math.round(140 / gap)), Ht = Math.round(rows * gap), Wt = 256, c = document.createElement('canvas');
    c.width = Wt; c.height = Ht; const g = c.getContext('2d'); g.fillStyle = '#fff'; g.beginPath();
    for (let r = 0; r < rows; r++) {
      const y = (r + 0.5) * gap + (hsh(r, v, 77) - 0.5) * gap * 0.3; let x = -8;
      const segs = []; // dashes with tapered ends, broken away from the tile edges so it stays seamless
      const brk = 30 + hsh(r, v, 78) * (Wt - 60);
      segs.push([-8, brk - 3 - hsh(r, v, 79) * 6], [brk + 3 + hsh(r, v, 80) * 6, Wt + 8]);
      for (const [a, b] of segs) {
        const n = 6, hw = (w / 2) * (0.75 + 0.5 * hsh(r, v, 81));
        const top = [], bot = [];
        for (let k = 0; k <= n; k++) { const u = k / n, xx = lerp(a, b, u), tp = (a < 0 && u < 0.5) || (b > Wt && u > 0.5) ? 1 : Math.min(1, Math.sin(Math.PI * u) * 1.6); top.push([xx, y - hw * tp]); bot.push([xx, y + hw * tp]); }
        top.forEach((q, k) => (k ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]))); for (let k = n; k >= 0; k--) g.lineTo(bot[k][0], bot[k][1]); g.closePath();
      }
    }
    g.fill();
    return (TILES[key] = c);
  }
  function tinted(tile, color) { const k = tile.__tint || (tile.__tint = {}); if (k[color]) return k[color]; const c = document.createElement('canvas'); c.width = tile.width; c.height = tile.height; const g = c.getContext('2d'); g.drawImage(tile, 0, 0); g.globalCompositeOperation = 'source-in'; g.fillStyle = color; g.fillRect(0, 0, c.width, c.height); return (k[color] = c); }
  function LINE_hatchSphere(ctx, cx, cy, r, o = {}) {
    const sc = LINE_scale(ctx), light = o.light || LINE_LIGHT, ll = Math.hypot(light.x, light.y) || 1, lx = light.x / ll, ly = light.y / ll;
    const boil = o.boil | 0, v = boil % 3, gap = o.gap ?? 9, w = o.w ?? 1.8, color = o.color || '#2a1838';
    const tile = tinted(hatchTile(gap, w, v), color), ang0 = o.angle ?? Math.atan2(light.y, light.x) + Math.PI / 2;
    const layers = [[o.shift1 ?? 0.55, ang0]]; if (o.cross !== false) layers.push([o.shift2 ?? 1.0, o.crossAngle ?? ang0 + 1.05]);
    const m = ctx.getTransform();
    layers.forEach(([sh, ang], li) => {
      ctx.save();
      if (o.clip) { o.clip(ctx); ctx.clip(); }
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.clip();
      const jr = r * (1.02 + 0.015 * (hsh(boil, li, 5) - 0.5));
      ctx.beginPath(); ctx.rect(cx - r * 1.1, cy - r * 1.1, r * 2.2, r * 2.2); ctx.arc(cx + lx * sh * r, cy + ly * sh * r, jr, 0, TAU, true); ctx.clip('evenodd');
      const pat = ctx.createPattern(tile, 'repeat');
      // pattern lives in screen px: undo the current scale so the gap stays constant on screen
      pat.setTransform(new DOMMatrix().translateSelf((hsh(v, li, 9) * 200) / sc, 0).rotateSelf((ang * 180) / Math.PI).scaleSelf(1 / sc, 1 / sc));
      ctx.globalAlpha *= (o.alpha ?? 0.5) * (li ? 0.85 : 1); ctx.fillStyle = pat; ctx.fillRect(cx - r, cy - r, 2 * r, 2 * r);
      ctx.restore();
    });
  }

  // ---------------- toon outline for a path-defined filled shape ----------------
  // outer: closed points. Draws (in order) hatch, inner lines, rim line, key line, silhouette. Does NOT draw the fill.
  // o: w (silhouette px; or size -> LINE_weight(size)), ink, light, bias 0.55, outside 0.6, lost 0.35, boil, seed,
  //    fill (used to color inner lines), inner: [{pts, closed?, w (x silhouette, default 0.45), color, tips, k}],
  //    rim true|false|color (cool line inside the shadow-side edge), rimW 0.38,
  //    keyLine false|color (pale line inside the lit edge where the dark line is lost), hatch: LINE_hatch opts minus box/clip
  function LINE_toon(ctx, outer, o = {}) {
    const light = o.light || LINE_LIGHT, boil = o.boil | 0, seed = o.seed | 0;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of outer) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    const sc = LINE_scale(ctx), w = o.w ?? LINE_weight(Math.max(x1 - x0, y1 - y0) * sc);
    const ink = o.ink || LINE_INK, bias = o.bias ?? 0.55, outside = o.outside ?? 0.6;
    if (o.hatch) LINE_hatch(ctx, { light, boil, seed: seed + 50, color: o.fill ? LINE_inkOf(o.fill, 0.62, ink) : undefined, ...o.hatch,
      box: [x0, y0, x1 - x0, y1 - y0], clip: (g) => tracePath(g, outer, true) });
    (o.inner || []).forEach((ln, i) => LINE_stroke(ctx, ln.pts, { light, boil, seed: seed + 100 + i * 7, closed: !!ln.closed, bias: 0.4,
      w: w * (ln.w ?? 0.45), color: ln.color || (o.fill ? LINE_inkOf(o.fill, ln.k ?? 0.55, ink) : ink), tips: ln.tips || [0.1, 0.1],
      taperLen: ln.taperLen, outside: 0.5, alpha: ln.alpha ?? 1, pressure: 0.22 }));
    const Rl = Math.hypot(light.x, light.y) || 1, Rx = -light.x / Rl, Ry = -light.y / Rl;
    const common = { light, boil, seed, closed: true, wobble: o.wobble, boilAmp: o.boilAmp, lam: o.lam };
    if (o.rim !== false) {
      const rw = w * (o.rimW ?? 0.38);
      LINE_stroke(ctx, outer, { ...common, w: rw, bias: 0, pressure: 0.25, color: typeof o.rim === 'string' ? o.rim : light.rim, alpha: o.rimAlpha ?? 0.9,
        shift: -(w * (1 + bias) * (1 - outside) + rw * 0.9), mask: (nx, ny) => sstep(0.3, 0.8, nx * Rx + ny * Ry) });
    }
    if (o.keyLine) {
      const kw = w * 0.3;
      LINE_stroke(ctx, outer, { ...common, w: kw, bias: 0, color: typeof o.keyLine === 'string' ? o.keyLine : light.key, alpha: 0.85,
        shift: -(w * 0.25 + kw), mask: (nx, ny) => sstep(0.45, 0.85, -(nx * Rx + ny * Ry)) });
    }
    LINE_stroke(ctx, outer, { ...common, w, color: ink, bias, outside, lost: o.lost ?? 0.35 });
  }

  // ---------------- toon silhouette for ANYTHING (mask dilation) ----------------
  // drawFn(g) draws the object's fills (any color, opaque) on g with the SAME transform as ctx.
  // box [x,y,w,h] is in SCREEN pixels (device space) and must contain the object.
  // The outline is the object's alpha dilated more toward the shadow side, minus the object: heavy lower right,
  // thin upper left, only the OUTER edge (inner overlaps stay light, draw those with LINE_stroke).
  // o: w px (default from box), ink, light, bias 0.6, dirs 16, res (auto: 0.5 when box > 420 px, else 1), boil, seed, alpha
  // Cost: two box-sized offscreens and ~1.5*dirs drawImage calls (about 8 to 12 ms for a 700 px box at res 0.5
  // on this PC). Keep the box tight.
  const POOL = {};
  function pool(key, w, h) { let c = POOL[key]; if (!c) { c = POOL[key] = document.createElement('canvas'); } if (c.width < w || c.height < h) { c.width = Math.max(c.width, w); c.height = Math.max(c.height, h); } return c; }
  function LINE_silhouette(ctx, drawFn, box, o = {}) {
    const light = o.light || LINE_LIGHT, res = o.res ?? (Math.max(box[2], box[3]) > 420 ? 0.5 : 1), boil = o.boil | 0, seed = o.seed | 0;
    const w = o.w ?? LINE_weight(Math.max(box[2], box[3])), bias = o.bias ?? 0.6, dirs = o.dirs ?? 16;
    const pad = Math.ceil(w * (1 + bias) + 4), bw = Math.ceil((box[2] + pad * 2) * res), bh = Math.ceil((box[3] + pad * 2) * res);
    const A = pool('silA', bw, bh), B = pool('silB', bw, bh), a = A.getContext('2d'), b = B.getContext('2d');
    a.setTransform(1, 0, 0, 1, 0, 0); a.clearRect(0, 0, bw, bh); b.setTransform(1, 0, 0, 1, 0, 0); b.clearRect(0, 0, bw, bh);
    const M = ctx.getTransform();
    a.setTransform(new DOMMatrix().scaleSelf(res, res).translateSelf(pad - box[0], pad - box[1]).multiplySelf(M));
    a.save(); drawFn(a); a.restore(); a.setTransform(1, 0, 0, 1, 0, 0);
    const ll = Math.hypot(light.x, light.y) || 1, Lx = light.x / ll, Ly = light.y / ll;
    for (let ring = 0; ring < 2; ring++) for (let k = ring; k < dirs; k += 1 + ring) {
      const th = ((k + ring * 0.5) / dirs) * TAU, dx = Math.cos(th), dy = Math.sin(th), g = -(dx * Lx + dy * Ly);
      const r = w * res * (1 + bias * g) * (ring ? 0.55 : 1) * (1 + 0.14 * (hsh(k, boil, seed) - 0.5));
      b.drawImage(A, 0, 0, bw, bh, dx * r, dy * r, bw, bh);
    }
    b.globalCompositeOperation = 'destination-out'; b.drawImage(A, 0, 0);
    b.globalCompositeOperation = 'source-in'; b.fillStyle = o.ink || LINE_INK; b.fillRect(0, 0, bw, bh);
    b.globalCompositeOperation = 'source-over';
    const jx = (hsh(boil, 1, seed) - 0.5) * 0.7, jy = (hsh(boil, 2, seed) - 0.5) * 0.7;
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha *= o.alpha ?? 1;
    ctx.drawImage(B, 0, 0, bw, bh, box[0] - pad + jx, box[1] - pad + jy, bw / res, bh / res);
    ctx.restore();
  }

  // ---------------- cheap vector silhouette for compound shapes: LINE_backline ----------------
  // Call BEFORE the fills. parts: array of closed point lists (all the pieces of a figure, in the current transform).
  // Strokes the union of all parts in ink (lit-side width) and adds a filled + stroked copy pushed toward the shadow,
  // so after the fills cover the inside only an outer ring is left: thin upper left, heavy lower right.
  // Two strokes and one fill: about 10x cheaper than LINE_silhouette, but no hand wobble (it boils by a sub-pixel shift).
  // o: w px, ink, light, bias 0.6, boil, seed
  function LINE_backline(ctx, parts, o = {}) {
    const sc = LINE_scale(ctx), light = o.light || LINE_LIGHT, w = (o.w ?? 8) / sc, bias = o.bias ?? 0.6, boil = o.boil | 0, seed = o.seed | 0;
    const ll = Math.hypot(light.x, light.y) || 1, sx = (-light.x / ll) * 2 * w * bias, sy = (-light.y / ll) * 2 * w * bias;
    const jx = ((hsh(boil, 1, seed) - 0.5) * 0.8) / sc, jy = ((hsh(boil, 2, seed) - 0.5) * 0.8) / sc;
    const path = (dx, dy) => { ctx.beginPath(); for (const pts of parts) { pts.forEach((p, i) => (i ? ctx.lineTo(p[0] + dx, p[1] + dy) : ctx.moveTo(p[0] + dx, p[1] + dy))); ctx.closePath(); } };
    ctx.save(); ctx.fillStyle = ctx.strokeStyle = o.ink || LINE_INK; ctx.lineJoin = 'round'; ctx.lineWidth = 2 * w * (1 - bias);
    path(jx, jy); ctx.stroke();
    path(sx + jx, sy + jy); ctx.fill('nonzero'); ctx.stroke();
    ctx.restore();
  }

  // ---------------- sketch double line ----------------
  // Main stroke plus a thinner second pass with its own wobble, offset and OVERSHOOT past the ends
  // (closed paths: the second pass starts somewhere random and runs ~8% past its start).
  // o: same as LINE_stroke plus overshoot (px, default 2.5*w), second (0.5 = width of 2nd pass), secondAlpha 0.6
  function LINE_sketch(ctx, pts, o = {}) {
    const sc = LINE_scale(ctx), w = o.w ?? 6, seed = o.seed | 0, boil = o.boil | 0;
    LINE_stroke(ctx, pts, o);
    let P;
    if (o.closed) {
      const n = pts.length, st = Math.floor(hsh(seed, boil >> 1, 5) * n), extra = Math.ceil(n * (0.06 + 0.05 * hsh(seed, 2, 5)));
      P = []; for (let i = 0; i <= n + extra; i++) P.push(pts[(st + i) % n]);
    } else {
      const os = (o.overshoot ?? 2.5 * w) / sc, a = pts[0], a2 = pts[1], z = pts[pts.length - 1], z2 = pts[pts.length - 2];
      const la = Math.hypot(a[0] - a2[0], a[1] - a2[1]) || 1, lz = Math.hypot(z[0] - z2[0], z[1] - z2[1]) || 1;
      P = [[a[0] + ((a[0] - a2[0]) / la) * os, a[1] + ((a[1] - a2[1]) / la) * os], ...pts, [z[0] + ((z[0] - z2[0]) / lz) * os, z[1] + ((z[1] - z2[1]) / lz) * os]];
    }
    LINE_stroke(ctx, P, { ...o, closed: false, w: w * (o.second ?? 0.5), seed: seed + 23, alpha: (o.alpha ?? 1) * (o.secondAlpha ?? 0.6),
      shift: (o.shift ?? 0) + w * 0.55 * (hsh(seed, 9) > 0.5 ? 1 : -1), tips: [0.05, 0.05], wobble: (o.wobble ?? 0.12 * w + 0.5) * 1.8, taperLen: 9 * w });
  }

  Object.assign(G, { LINE_INK, LINE_LIGHT, LINE_boil, LINE_weight, LINE_scale, LINE_mix, LINE_inkOf, LINE_xform, LINE_ellipse, LINE_rrect,
    LINE_capsule, LINE_cloud, LINE_path: tracePath, LINE_stroke, LINE_shadeSphere, LINE_shadeCylinder, LINE_shadeMax, LINE_hatch, LINE_hatchSphere,
    LINE_toon, LINE_silhouette, LINE_backline, LINE_sketch });
})(typeof window !== 'undefined' ? window : globalThis);
