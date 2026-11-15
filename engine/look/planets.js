// planets.js: premium sphere rendering for Rheobase (PLAN_ prefix). Drop-in replacements for the
// v3 scenes.js jup(), wedge() and flatEarth(), same signatures and options, plus a few extras.
//
// Load after engine/core.js (needs window.ENG: hash, vnoise, clamp, lerp). Everything is plain 2D canvas,
// deterministic in its inputs (no Math.random), and draws in whatever transform is current, in local
// units, so it works nested (visor), zoomed (40x and more) and rolled. Work is culled to the visible
// rectangle, line widths are capped in screen pixels, and detail (edge noise octaves, texture level)
// is chosen from the on-screen size, so the planet keeps resolving finer structure as you zoom.
//
//   PLAN_jupiter(ctx, cx, cy, R, { rot, boil, hot, scars, light })   // = jup(); scars as in v3 [{lat, lon, r, k, seed}]
//   PLAN_youngJupiter(ctx, cx, cy, R, { rot, boil, glow })           // the young hot planet (jup with hot:true + heat glow)
//   PLAN_cutaway(ctx, cx, cy, R, w, t, boil, { light })              // = wedge(): top-right quadrant opened by w (0..1)
//   PLAN_earth(ctx, x, y, r, boil, alpha = 1, { rot, light })        // = flatEarth()
//   PLAN_protoplanet(ctx, x, y, r, boil, { alpha, dashed, light })   // the possible ancient planet (dashed = hypothetical)
//   PLAN_shadeSphere(ctx, cx, cy, R, palette, light)                 // generic: lit side, step, terminator, night, limb, rims
//   PLAN_halo(ctx, cx, cy, R, rgb, a, light) / PLAN_inkSphere(ctx, cx, cy, R, boil, light)
//
// light (shared convention): { x: -0.55, y: -0.83, key: '#fff4e0', rim: '#7fd8ff', amb: 0.35, z: 0.6 }
//   x, y = screen direction toward the key light; z = how much the light also comes from the camera
//   (0.72 default: night crescent ~28% of the radius at the lower right; 0.9 for a near full-lit hero face).
// Paste: put this file's contents into the episode (e.g. top of scenes.js or subjects.js), then in scenes.js
//   const jup = PLAN_jupiter, wedge = PLAN_cutaway, flatEarth = PLAN_earth;
(function () {
  const E = window.ENG;
  const { hash, vnoise, clamp, lerp } = E;
  const TAU = Math.PI * 2, D2R = Math.PI / 180;
  const INK = '#120d1c';
  const LIGHT = { x: -0.55, y: -0.83, key: '#fff4e0', rim: '#7fd8ff', amb: 0.35, z: 0.72 };

  // ---------------------------------------------------------------- small utils
  const hx = (c) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
  const toHex = (a) => '#' + a.map((v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')).join('');
  const mix = (a, b, k) => { const A = hx(a), B = hx(b); return toHex(A.map((v, i) => lerp(v, B[i], k))); };
  const rgba = (c, a) => { const A = hx(c); return `rgba(${A[0]},${A[1]},${A[2]},${clamp(a)})`; };
  const L3 = (L) => { const z = L.z ?? 0.72, h = Math.hypot(L.x, L.y) || 1, k = Math.sqrt(1 - z * z) / h; return [L.x * k, L.y * k, z]; };

  // visible rectangle in local units + local->screen scale (works under zoom, roll, nesting)
  function view(ctx, mgPx = 40) {
    const M = ctx.getTransform(), inv = M.inverse(), sc = Math.hypot(M.a, M.b) || 1;
    const cw = ctx.canvas.width, ch = ctx.canvas.height;
    const cs = [[0, 0], [cw, 0], [0, ch], [cw, ch]].map(([x, y]) => inv.transformPoint(new DOMPoint(x, y)));
    const mg = mgPx / sc;
    return { x0: Math.min(...cs.map((p) => p.x)) - mg, x1: Math.max(...cs.map((p) => p.x)) + mg,
      y0: Math.min(...cs.map((p) => p.y)) - mg, y1: Math.max(...cs.map((p) => p.y)) + mg, sc };
  }
  const boxOf = (V, cx, cy, r) => { const b = { x0: Math.max(V.x0, cx - r), x1: Math.min(V.x1, cx + r), y0: Math.max(V.y0, cy - r), y1: Math.min(V.y1, cy + r) }; b.ok = b.x1 > b.x0 && b.y1 > b.y0; return b; };
  const inView = (V, x, y, r) => x + r > V.x0 && x - r < V.x1 && y + r > V.y0 && y - r < V.y1;

  // ---------------------------------------------------------------- cached textures
  function pn(x, y, Px, Py, seed) { // periodic value noise
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const X0 = ((xi % Px) + Px) % Px, X1 = (X0 + 1) % Px, Y0 = ((yi % Py) + Py) % Py, Y1 = (Y0 + 1) % Py;
    const a = hash(X0, Y0, seed), b = hash(X1, Y0, seed), c = hash(X0, Y1, seed), d = hash(X1, Y1, seed);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  let FLOW = null;
  function flowTex() { // 512 tile: latitude-stretched, domain-warped streaks and filaments, neutral grey 128
    if (FLOW) return FLOW;
    const S = 512, c = document.createElement('canvas'); c.width = c.height = S;
    const g = c.getContext('2d'), id = g.createImageData(S, S), D = id.data;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const X = x / S, Y = y / S;
      const wx = pn(X * 4, Y * 6, 4, 6, 11) - 0.5, wy = pn(X * 4, Y * 6, 4, 6, 12) - 0.5;
      const n = 0.55 * pn(X * 3 + wx * 1.6, Y * 24 + wy * 5, 3, 24, 21) + 0.3 * pn(X * 6 + wx * 3.2, Y * 48 + wy * 10, 6, 48, 22) + 0.15 * pn(X * 12 + wx * 6.4, Y * 96 + wy * 20, 12, 96, 23);
      const f = pn(X * 8 + wx * 2, Y * 160, 8, 160, 31);
      const v = clamp(0.5 + (n - 0.5) * 1.7 + (f - 0.5) * 0.35, 0, 1);
      const i = (y * S + x) * 4; D[i] = D[i + 1] = D[i + 2] = v * 255; D[i + 3] = 255;
    }
    g.putImageData(id, 0, 0);
    return (FLOW = c);
  }
  // overlay the flow texture over a rect, two detail levels cross-faded by on-screen size
  function flowOverlay(ctx, B, cx, cy, R, sc, shift, alpha, mode = 'overlay') {
    const tex = flowTex(), lvl = Math.log2(Math.max(1e-3, (R * sc) / 650)), L0 = Math.floor(lvl), fr = lvl - L0;
    ctx.save(); ctx.globalCompositeOperation = mode;
    for (const [L, a] of [[L0, 1 - fr * 0.6], [L0 + 1, 0.4 + fr * 0.6]]) {
      const T = R * Math.pow(2, -L) * 1.6; // local size of one tile
      const p = ctx.createPattern(tex, 'repeat'), s = T / 512;
      p.setTransform(new DOMMatrix().translateSelf(cx + (shift % T), cy).scaleSelf(s, s * 0.85));
      ctx.globalAlpha = alpha * a; ctx.fillStyle = p; ctx.fillRect(B.x0, B.y0, B.x1 - B.x0, B.y1 - B.y0);
    }
    ctx.restore();
  }

  // ---------------------------------------------------------------- sphere lighting
  // Path of the region of the visible disk where n.L >= c (orthographic). Exact ellipse arc + limb arc.
  function capPath(ctx, cx, cy, R, L, c) {
    const lu = Math.hypot(L[0], L[1]), lz = L[2], ang = Math.atan2(L[1], L[0]);
    const s = Math.sqrt(Math.max(0, 1 - c * c)), ca = Math.cos(ang), sa = Math.sin(ang);
    const ex = cx + R * c * lu * ca, ey = cy + R * c * lu * sa;
    const q = lu * s < 1e-6 ? 2 : (c * lz) / (s * lu);
    if (q >= 1) { ctx.moveTo(ex + R * s * lz * ca, ey + R * s * lz * sa); ctx.ellipse(ex, ey, Math.max(1e-6, R * s * lz), Math.max(1e-6, R * s), ang, 0, TAU); return; }
    if (q <= -1) { if (lz >= c) { ctx.moveTo(cx + R, cy); ctx.arc(cx, cy, R, 0, TAU); } return; }
    const t0 = Math.acos(q), ue = c * lu + s * lz * Math.cos(t0), ve = s * Math.sin(t0);
    const rx = Math.max(1e-6, R * s * lz), ry = R * s;
    ctx.moveTo(ex + rx * Math.cos(t0) * ca - ry * Math.sin(t0) * sa, ey + rx * Math.cos(t0) * sa + ry * Math.sin(t0) * ca);
    ctx.ellipse(ex, ey, rx, ry, ang, t0, TAU - t0);
    ctx.arc(cx, cy, R, Math.atan2(-ve, ue) + ang, Math.atan2(ve, ue) + ang, false);
    ctx.closePath();
  }
  // Toon sphere shading over the visible part of the disk. Call while clipped to the disk.
  // P: { key:[hex,a], step:[hex,a,c], night:[hex,a], limb:[hex,a], emis:[hex,a] }
  function shadeSphere(ctx, cx, cy, R, P, light = LIGHT, V = null) {
    V = V || view(ctx); const B = boxOf(V, cx, cy, R * 1.02); if (!B.ok) return;
    const L = L3(light), lu = Math.hypot(L[0], L[1]), ux = L[0] / lu, uy = L[1] / lu;
    const rect = () => { ctx.beginPath(); ctx.rect(B.x0, B.y0, B.x1 - B.x0, B.y1 - B.y0); };
    ctx.save();
    // 1. soft key highlight (screen), centred on the sub-light point
    if (P.key) { const px = cx + L[0] * R * 0.8, py = cy + L[1] * R * 0.8, g = ctx.createRadialGradient(px, py, 0, px, py, R * 1.4);
      g.addColorStop(0, rgba(P.key[0], P.key[1])); g.addColorStop(0.4, rgba(P.key[0], P.key[1] * 0.45)); g.addColorStop(1, rgba(P.key[0], 0));
      ctx.globalCompositeOperation = 'soft-light'; ctx.fillStyle = g; rect(); ctx.fill(); }
    ctx.globalCompositeOperation = 'multiply';
    // 2. limb darkening (soft)
    if (P.limb) { const g = ctx.createRadialGradient(cx, cy, R * 0.55, cx, cy, R); g.addColorStop(0, rgba(P.limb[0], 0)); g.addColorStop(0.75, rgba(P.limb[0], P.limb[1] * 0.45)); g.addColorStop(1, rgba(P.limb[0], P.limb[1]));
      ctx.fillStyle = g; rect(); ctx.fill(); }
    // 3. mid step: a hard-edged second tone between the terminator and n.L = c
    if (P.step) { const g = ctx.createLinearGradient(cx, cy, cx - ux * R, cy - uy * R); g.addColorStop(0, rgba(P.step[0], P.step[1] * 0.8)); g.addColorStop(1, rgba(P.step[0], P.step[1]));
      ctx.beginPath(); capPath(ctx, cx, cy, R, L, 0); capPath(ctx, cx, cy, R, L, P.step[2] ?? 0.3); ctx.fillStyle = g; ctx.fill('evenodd'); }
    // 4. night: hard terminator, soft deepening toward the far limb
    if (P.night) { const g = ctx.createLinearGradient(cx - ux * R * lu * 0.3, cy - uy * R * lu * 0.3, cx - ux * R, cy - uy * R);
      g.addColorStop(0, rgba(P.night[0], P.night[1] * 0.82)); g.addColorStop(1, rgba(P.night[0], P.night[1]));
      rect(); capPath(ctx, cx, cy, R, L, 0); ctx.fillStyle = g; ctx.fill('evenodd'); }
    // 5. emissive (hot bodies): glow back over everything, strongest on the night side
    if (P.emis) { ctx.globalCompositeOperation = 'lighter'; const qx = cx - ux * R * 0.5, qy = cy - uy * R * 0.5, g = ctx.createRadialGradient(qx, qy, R * 0.1, qx, qy, R * 1.2);
      g.addColorStop(0, rgba(P.emis[0], P.emis[1] * 0.25)); g.addColorStop(0.7, rgba(P.emis[0], P.emis[1] * 0.6)); g.addColorStop(1, rgba(P.emis[0], P.emis[1]));
      ctx.fillStyle = g; rect(); ctx.fill(); }
    ctx.restore();
  }
  // Thin atmospheric rims: bright key-side rim + cool back rim. Call while clipped to the disk.
  function rims(ctx, cx, cy, R, sc, light, keyCol, keyA, backCol, backA, widthPx = 3.2) {
    const L = L3(light), lu = Math.hypot(L[0], L[1]), ux = L[0] / lu, uy = L[1] / lu;
    const w = clamp(R * sc * 0.007, 1.4, widthPx) / sc;
    ctx.save(); ctx.globalCompositeOperation = 'screen';
    const gk = ctx.createLinearGradient(cx + ux * R, cy + uy * R, cx - ux * R * 0.15, cy - uy * R * 0.15);
    gk.addColorStop(0, rgba(keyCol, keyA)); gk.addColorStop(0.55, rgba(keyCol, keyA * 0.5)); gk.addColorStop(1, rgba(keyCol, 0));
    ctx.strokeStyle = gk; ctx.lineWidth = w * 5; ctx.globalAlpha = 0.28; ctx.beginPath(); ctx.arc(cx, cy, Math.max(0.01, R - w * 2.5), 0, TAU); ctx.stroke(); // haze band
    ctx.globalAlpha = 1; ctx.lineWidth = w; ctx.beginPath(); ctx.arc(cx, cy, Math.max(0.01, R - w * 0.9), 0, TAU); ctx.stroke(); // crisp rim
    const gb = ctx.createLinearGradient(cx - ux * R, cy - uy * R, cx - ux * R * 0.35, cy - uy * R * 0.35);
    gb.addColorStop(0, rgba(backCol, backA)); gb.addColorStop(1, rgba(backCol, 0));
    ctx.strokeStyle = gb; ctx.lineWidth = w * 2.4; ctx.beginPath(); ctx.arc(cx, cy, R - w * 1.6, 0, TAU); ctx.stroke();
    ctx.restore();
  }
  // Outer halo glow (draw BEFORE the body; the body covers its inside). rgb like '255,196,140'.
  function halo(ctx, cx, cy, R, rgb, a, light = LIGHT, ext = 0.22, V = null) {
    V = V || view(ctx); const B = boxOf(V, cx, cy, R * (1 + ext)); if (!B.ok || a <= 0) return;
    const L = L3(light), ox = cx + L[0] * R * 0.06, oy = cy + L[1] * R * 0.06;
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(ox, oy, R * 0.97, cx, cy, R * (1 + ext));
    g.addColorStop(0, `rgba(${rgb},${a})`); g.addColorStop(0.25, `rgba(${rgb},${a * 0.45})`); g.addColorStop(1, `rgba(${rgb},0)`);
    ctx.fillStyle = g; ctx.fillRect(B.x0, B.y0, B.x1 - B.x0, B.y1 - B.y0);
    ctx.restore();
  }
  // Ink silhouette: thin on the lit side, a heavier crescent on the shadow side. No cast shadow.
  function inkSphere(ctx, cx, cy, R, boil, light = LIGHT, V = null, wPx = 4, col = INK) {
    V = V || view(ctx); if (!inView(V, cx, cy, R * 1.05)) return;
    const sc = V.sc, w0 = clamp(R * sc * 0.006, 1.6, wPx) / sc, d = w0 * 1.7;
    const L = L3(light), lu = Math.hypot(L[0], L[1]), ux = L[0] / lu, uy = L[1] / lu, j = (hash(boil, 7, 3) - 0.5) * 0.7 / sc;
    // skip when the limb is entirely off screen (deep zoom inside the disk)
    const far = Math.max(Math.hypot(V.x0 - cx, V.y0 - cy), Math.hypot(V.x1 - cx, V.y0 - cy), Math.hypot(V.x0 - cx, V.y1 - cy), Math.hypot(V.x1 - cx, V.y1 - cy));
    if (far < R - d * 3) return;
    ctx.save();
    ctx.strokeStyle = col; ctx.lineWidth = w0; ctx.beginPath(); ctx.arc(cx, cy, R + j, 0, TAU); ctx.stroke();
    ctx.beginPath(); ctx.rect(V.x0, V.y0, V.x1 - V.x0, V.y1 - V.y0); ctx.arc(cx, cy, R + w0 * 0.4, 0, TAU); ctx.clip('evenodd');
    ctx.fillStyle = col; ctx.beginPath(); ctx.arc(cx - ux * d, cy - uy * d, R + w0 * 0.5 + j, 0, TAU); ctx.fill();
    ctx.restore();
  }

  // ---------------------------------------------------------------- Jupiter
  // bands: [lat top, lat bottom, colour]; latitudes and order as in v3 (science unchanged)
  const BANDS = [[90, 61, '#6c6aa6'], [61, 46, '#c49487'], [46, 34, '#fbeacb'], [34, 25, '#e48848'], [25, 17, '#fff3dc'], [17, 7, '#b2401d'],
    [7, -7, '#ffe1ab'], [-7, -18, '#bd4c22'], [-18, -27, '#fff0d4'], [-27, -36, '#e38e4c'], [-36, -48, '#f7e3c4'], [-48, -61, '#c39788'], [-61, -90, '#6a6aa4']];
  const HOTC = ['#9a3a8c', '#f2746a', '#ffd8b0', '#ff7a3a', '#ffeccc', '#e2302e', '#ffc878', '#e83c2c', '#ffe4bc', '#ff8840', '#ffd4a8', '#f0706a', '#943a8c'];
  const BELT = [0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0]; // darker bands
  const EDGE_AMP = [0.010, 0.013, 0.015, 0.017, 0.02, 0.024, 0.024, 0.02, 0.017, 0.015, 0.013, 0.010]; // radians of latitude
  const JET = [0.0, 0.04, -0.05, 0.07, -0.06, 0.1, -0.09, 0.06, -0.05, 0.04, -0.03, 0.0]; // relative drift per edge
  function edgeOff(u, e, oct) {
    let s = 0.42 * Math.sin(5 * u + e * 1.7) + 0.22 * Math.sin(11 * u - e * 2.3) + 0.12 * Math.sin(23 * u + e);
    let a = 0.5, f = 3;
    for (let o = 0; o < oct; o++) { s += a * (vnoise(u * f + 40, e * 7.1 + o * 13.7, 77) - 0.5) * 2; a *= 0.58; f *= 2; }
    return s;
  }
  // polyline along a perturbed latitude, only across the visible x span; extended past the limb when it reaches it
  function latLine(cx, cy, R, V, latDeg, e, amp, rotE, ph) {
    const phi = latDeg * D2R, cp = Math.cos(phi), Rc = R * cp, yN = cy - R * Math.sin(phi);
    const xl = Math.max(V.x0, cx - R * 1.1), xr = Math.min(V.x1, cx + R * 1.1);
    if (Math.abs(latDeg) >= 90 || yN + amp * R * 2 < V.y0 || yN - amp * R * 2 > V.y1) return [[xl, yN], [xr, yN]];
    const xa = Math.max(V.x0, cx - Rc), xb = Math.min(V.x1, cx + Rc);
    if (xa >= xb) return [[xl, yN], [xr, yN]];
    const la = Math.asin(clamp((xa - cx) / Rc, -1, 1)), lb = Math.asin(clamp((xb - cx) / Rc, -1, 1));
    const oct = clamp(Math.floor(Math.log2(Math.max(2, Rc * V.sc / 22))), 2, 10);
    const n = clamp(Math.ceil((Rc * V.sc * (lb - la)) / 5), 8, 900), P = [];
    for (let k = 0; k <= n; k++) {
      const lam = la + ((lb - la) * k) / n, f = phi + amp * edgeOff(lam + rotE + ph, e, oct) * (0.6 + 0.4 * Math.cos(lam));
      P.push([cx + R * Math.cos(f) * Math.sin(lam), cy - R * Math.sin(f)]);
    }
    if (xa <= cx - Rc + 1e-6) P.unshift([xl, P[0][1]]);
    if (xb >= cx + Rc - 1e-6) P.push([xr, P[P.length - 1][1]]);
    return P;
  }
  const poly = (ctx, P, move = true) => P.forEach((p, i) => (i || !move ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
  // point on the sphere surface for (lat, lon), with foreshortening; null when on the far side
  const surf = (cx, cy, R, lat, lam) => { const c = Math.cos(lam); return { x: cx + R * Math.cos(lat * D2R) * Math.sin(lam), y: cy - R * Math.sin(lat * D2R), c }; };

  // Kelvin-Helmholtz curl: a tapered tongue of zone colour rolling into the belt
  function curl(ctx, x, y, rr, fill, line, dir, lw, ph) {
    const Th = TAU * 1.15, N = 28, O = [], I = [];
    for (let s = 0; s <= N; s++) {
      const q = s / N, th = ph + dir * q * Th, ro = rr * (1 - 0.82 * q), wd = rr * 0.42 * (1 - q) + rr * 0.04;
      O.push([x + Math.cos(th) * ro, y + Math.sin(th) * ro]); I.push([x + Math.cos(th) * (ro - wd), y + Math.sin(th) * (ro - wd)]);
    }
    ctx.beginPath(); poly(ctx, O); poly(ctx, I.reverse(), false); ctx.closePath(); ctx.fillStyle = fill; ctx.fill();
    ctx.strokeStyle = line; ctx.lineWidth = lw; ctx.beginPath(); poly(ctx, O.slice(0, N - 4)); ctx.stroke();
  }
  function festoon(ctx, x, y, s, c, lw, seed) { // dark blue-grey plume trailing from the NEB into the equatorial zone
    ctx.save(); ctx.translate(x, y); ctx.scale(c, 1);
    const L = s * (1.4 + 0.7 * hash(seed, 1)), dr = s * (0.32 + 0.14 * hash(seed, 2)), w = s * 0.16;
    const g = ctx.createLinearGradient(0, 0, -L, dr); g.addColorStop(0, 'rgba(58,72,124,0.85)'); g.addColorStop(1, 'rgba(90,110,165,0.15)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(-w, -w * 0.2); ctx.bezierCurveTo(-w * 1.2, dr * 0.6, -L * 0.45, dr * 1.15, -L, dr);
    ctx.bezierCurveTo(-L * 0.5, dr * 0.7, w * 0.1, dr * 0.45, w * 0.7, -w * 0.2); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(44,54,100,0.6)'; ctx.beginPath(); ctx.ellipse(-w * 0.1, w * 0.15, w * 1.1, w * 0.45, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(170,190,230,0.35)'; ctx.lineWidth = lw; ctx.beginPath(); ctx.moveTo(-w * 0.2, w * 0.5); ctx.bezierCurveTo(-w * 0.4, dr * 0.6, -L * 0.4, dr * 0.95, -L * 0.8, dr * 0.93); ctx.stroke();
    ctx.restore();
  }
  function oval(ctx, x, y, a, b, c, fill, edge, lw) {
    ctx.save(); ctx.translate(x, y); ctx.scale(c, 1);
    ctx.fillStyle = edge; ctx.beginPath(); ctx.ellipse(0, 0, a * 1.25, b * 1.35, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = fill; ctx.beginPath(); ctx.ellipse(0, 0, a, b, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.beginPath(); ctx.ellipse(-a * 0.25, -b * 0.3, a * 0.45, b * 0.35, 0, 0, TAU); ctx.fill();
    ctx.restore();
  }

  function greatRedSpot(ctx, x, y, R, c, rot, hot, lw, boil) {
    ctx.save(); ctx.translate(x, y); ctx.scale(Math.max(c, 0.02), 1);
    const a = R * 0.105, b = R * 0.055;
    // turbulent wake trailing west (left): pale curls and a dark streak
    ctx.fillStyle = hot ? 'rgba(255,214,170,0.75)' : 'rgba(255,246,228,0.8)';
    for (let i = 0; i < 4; i++) { const wx = -a * (1.5 + i * 0.55), wy = (i % 2 ? -1 : 1) * b * 0.35; curl(ctx, wx, wy, b * (0.55 - i * 0.08), ctx.fillStyle, 'rgba(120,50,30,0.45)', i % 2 ? 1 : -1, lw * 0.7, i * 1.3 + rot * 3); }
    // collar: pale hollow around the spot, soft
    let g = ctx.createRadialGradient(0, 0, a * 0.8, 0, 0, a * 1.45); g.addColorStop(0, hot ? '#ffe6c4' : '#fff6e6'); g.addColorStop(0.7, hot ? 'rgba(255,220,180,0.55)' : 'rgba(255,240,220,0.6)'); g.addColorStop(1, 'rgba(255,240,220,0)');
    ctx.save(); ctx.scale(1, b / a); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, a * 1.45, 0, TAU); ctx.fill(); ctx.restore();
    // contact shadow of the raised storm on the collar, toward lower right
    ctx.fillStyle = 'rgba(110,40,30,0.28)'; ctx.beginPath(); ctx.ellipse(a * 0.08, b * 0.16, a * 1.04, b * 1.06, 0, 0, TAU); ctx.fill();
    // body: deep rim to warm centre
    ctx.save(); ctx.scale(1, b / a);
    g = ctx.createRadialGradient(-a * 0.15, -a * 0.12, a * 0.05, 0, 0, a);
    g.addColorStop(0, hot ? '#ffa070' : '#f39a62'); g.addColorStop(0.45, hot ? '#f0503a' : '#d9572f'); g.addColorStop(0.85, hot ? '#c42430' : '#a83220'); g.addColorStop(1, hot ? '#8a1428' : '#7c2216');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, a, 0, TAU); ctx.fill();
    // spiral arms (anticyclone: counterclockwise in the south)
    ctx.lineCap = 'round';
    for (let k = 0; k < 3; k++) {
      ctx.strokeStyle = k === 1 ? 'rgba(110,30,20,0.45)' : 'rgba(255,200,150,0.55)'; ctx.lineWidth = lw * (k === 1 ? 0.9 : 1.1); ctx.beginPath();
      for (let s = 0; s <= 30; s++) { const q = s / 30, an = -(q * 4.2 + k * 2.1 + rot * 4), r = a * (0.18 + 0.72 * q); s ? ctx.lineTo(Math.cos(an) * r, Math.sin(an) * r) : ctx.moveTo(Math.cos(an) * r, Math.sin(an) * r); }
      ctx.stroke();
    }
    // dome: highlight upper left, shade lower right (soft, inside)
    g = ctx.createLinearGradient(-a * 0.7, -a * 0.7, a * 0.7, a * 0.7); g.addColorStop(0, 'rgba(255,236,210,0.42)'); g.addColorStop(0.45, 'rgba(255,236,210,0)'); g.addColorStop(0.6, 'rgba(60,10,30,0)'); g.addColorStop(1, 'rgba(60,10,30,0.45)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, a, 0, TAU); ctx.fill();
    ctx.fillStyle = hot ? 'rgba(255,190,140,0.8)' : 'rgba(255,182,128,0.75)'; ctx.beginPath(); ctx.ellipse(a * 0.04, 0, a * 0.2, a * 0.13, 0.2, 0, TAU); ctx.fill(); // eye
    // ink with weight: thin all round, heavier lower right
    ctx.strokeStyle = INK; ctx.lineWidth = lw * 0.9; ctx.beginPath(); ctx.arc(0, 0, a, 0, TAU); ctx.stroke();
    ctx.lineWidth = lw * 2.0; ctx.beginPath(); ctx.arc(0, 0, a, -0.2, 1.9); ctx.stroke();
    ctx.restore(); ctx.restore();
  }

  function scar(ctx, x, y, r, c, cl, seed, boil) {
    ctx.save(); ctx.translate(x, y); ctx.scale(Math.max(c, 0.02), cl);
    ctx.globalCompositeOperation = 'multiply';
    // diffuse stain
    let g = ctx.createRadialGradient(0, 0, r * 0.3, 0, 0, r * 1.3);
    g.addColorStop(0, 'rgba(70,32,30,0.6)'); g.addColorStop(0.6, 'rgba(110,60,50,0.38)'); g.addColorStop(1, 'rgba(140,90,70,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, r * 1.3, 0, TAU); ctx.fill();
    // ejecta crescent toward lower left, noisy outer edge
    ctx.beginPath(); const a0 = 1.65, a1 = 3.95, N = 26;
    for (let i = 0; i <= N; i++) { const an = lerp(a0, a1, i / N), m = Math.sin((i / N) * Math.PI), rr = r * (1.05 + 0.62 * m) * (1 + (hash(i, seed, 5) - 0.5) * 0.12); i ? ctx.lineTo(Math.cos(an) * rr, Math.sin(an) * rr) : ctx.moveTo(Math.cos(an) * rr, Math.sin(an) * rr); }
    for (let i = N; i >= 0; i--) { const an = lerp(a0, a1, i / N); ctx.lineTo(Math.cos(an) * r * 1.0, Math.sin(an) * r * 1.0); }
    ctx.closePath(); g = ctx.createRadialGradient(0, 0, r, 0, 0, r * 1.7); g.addColorStop(0, 'rgba(60,28,26,0.62)'); g.addColorStop(1, 'rgba(90,50,40,0.25)'); ctx.fillStyle = g; ctx.fill();
    // ring
    ctx.strokeStyle = 'rgba(42,18,20,0.8)'; ctx.lineWidth = r * 0.15; ctx.beginPath();
    for (let i = 0; i <= 40; i++) { const an = (i / 40) * TAU, rr = r * (0.84 + (vnoise(i * 0.5, seed, 9) - 0.5) * 0.1); i ? ctx.lineTo(Math.cos(an) * rr, Math.sin(an) * rr) : ctx.moveTo(Math.cos(an) * rr, Math.sin(an) * rr); }
    ctx.closePath(); ctx.stroke();
    // core
    ctx.fillStyle = 'rgba(26,10,14,0.95)'; ctx.beginPath();
    for (let i = 0; i <= 24; i++) { const an = (i / 24) * TAU, rr = r * 0.48 * (1 + (vnoise(i * 0.7, seed, 11) - 0.5) * 0.22 + (hash(i % 24, boil, seed) - 0.5) * 0.03); i ? ctx.lineTo(Math.cos(an) * rr, Math.sin(an) * rr) : ctx.moveTo(Math.cos(an) * rr, Math.sin(an) * rr); }
    ctx.closePath(); ctx.fill();
    // debris specks
    ctx.fillStyle = 'rgba(40,18,18,0.6)';
    for (let i = 0; i < 16; i++) { const an = hash(i, seed, 1) * TAU, d = r * (1.05 + 0.8 * hash(i, seed, 2)), s = r * (0.03 + 0.05 * hash(i, seed, 3)); ctx.beginPath(); ctx.arc(Math.cos(an) * d, Math.sin(an) * d, s, 0, TAU); ctx.fill(); }
    ctx.restore();
  }

  function PLAN_jupiter(ctx, cx, cy, R, o = {}) {
    const rot = o.rot || 0, boil = o.boil || 0, hot = !!o.hot, light = o.light || LIGHT;
    const V = view(ctx), sc = V.sc;
    if (!inView(V, cx, cy, R * 1.3)) return;
    const col = (i) => (hot ? HOTC[i] : BANDS[i][2]);
    // halo first (the body covers its inside)
    halo(ctx, cx, cy, R, hot ? '255,110,120' : '255,190,135', hot ? 0.55 : 0.32, light, hot ? 0.3 : 0.2, V);
    if (!hot) halo(ctx, cx, cy, R, '127,216,255', 0.28, { ...light, x: -light.x, y: -light.y }, 0.12, V); // cool rim glow, lower right
    const B = boxOf(V, cx, cy, R * 1.02); if (!B.ok) return;
    const px = (p) => clamp(p, 0.6, 1e9) / sc; // screen px -> local
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.clip();
    ctx.fillStyle = col(6); ctx.fillRect(B.x0, B.y0, B.x1 - B.x0, B.y1 - B.y0);
    // edges (shared by neighbouring bands)
    const ph = (e) => (hash(boil, e, 41) - 0.5) * 0.006; // faint boil
    const EL = BANDS.slice(0, -1).map(([, lb], e) => latLine(cx, cy, R, V, lb, e, EDGE_AMP[e], rot * (1 + JET[e]), ph(e)));
    const top = (i) => (i === 0 ? latLine(cx, cy, R, V, 90, 0, 0, 0, 0) : EL[i - 1]);
    const bot = (i) => (i === BANDS.length - 1 ? latLine(cx, cy, R, V, -90, 0, 0, 0, 0) : EL[i]);
    BANDS.forEach(([a, b], i) => {
      const yA = cy - R * Math.sin(a * D2R), yB = cy - R * Math.sin(b * D2R);
      if (yB < V.y0 - R * 0.05 || yA > V.y1 + R * 0.05) return;
      const c0 = col(i), g = ctx.createLinearGradient(0, yA, 0, yB);
      if (BELT[i]) { g.addColorStop(0, mix(c0, '#ffd9b0', 0.12)); g.addColorStop(0.5, mix(c0, '#7a1a08', 0.16)); g.addColorStop(1, mix(c0, '#ffd9b0', 0.1)); }
      else { g.addColorStop(0, mix(c0, '#c98a5a', 0.18)); g.addColorStop(0.5, mix(c0, '#ffffff', 0.25)); g.addColorStop(1, mix(c0, '#c98a5a', 0.18)); }
      ctx.beginPath(); poly(ctx, top(i)); poly(ctx, bot(i).slice().reverse(), false); ctx.closePath(); ctx.fillStyle = g; ctx.fill();
    });
    // filaments inside the bands (thin darker/lighter sub-bands)
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    BANDS.forEach(([a, b], i) => {
      if (Math.abs(a) >= 90 || Math.abs(b) >= 90) return;
      for (let k = 0; k < 3; k++) {
        const f = 0.22 + 0.28 * k + (hash(i, k, 5) - 0.5) * 0.1, lat = lerp(a, b, f), yN = cy - R * Math.sin(lat * D2R);
        if (yN < V.y0 - R * 0.03 || yN > V.y1 + R * 0.03) continue;
        const P = latLine(cx, cy, R, V, lat, 20 + i * 3 + k, EDGE_AMP[Math.min(i, 11)] * 0.7, rot * (1 + JET[Math.min(i, 11)] * 0.5), 0);
        ctx.strokeStyle = BELT[i] ? rgba(mix(col(i), k === 1 ? '#3a0c06' : '#ffc48a', 0.4), 0.45) : rgba(mix(col(i), k === 1 ? '#ffffff' : '#c07a48', 0.5), k === 1 ? 0.6 : 0.4);
        ctx.lineWidth = Math.max(px(1), R * Math.abs(Math.sin(a * D2R) - Math.sin(b * D2R)) * (k === 1 ? 0.07 : 0.035)); ctx.beginPath(); poly(ctx, P); ctx.stroke();
      }
    });
    // band edge lines: dark belt-side line + light zone-side line (embossed, drawn ink feel)
    EL.forEach((P, e) => {
      if (P.length < 4) return;
      const beltBelow = BELT[e + 1], dark = mix(col(beltBelow ? e + 1 : e), '#2a0a06', 0.55), off = px(1.6) * (beltBelow ? -1 : 1);
      ctx.strokeStyle = rgba(hot ? '#ffe2c0' : '#fff6e6', 0.55); ctx.lineWidth = px(clamp(R * sc * 0.0022, 0.8, 2.5));
      ctx.beginPath(); P.forEach((p, k) => (k ? ctx.lineTo(p[0], p[1] + off) : ctx.moveTo(p[0], p[1] + off))); ctx.stroke();
      ctx.strokeStyle = rgba(dark, 0.6); ctx.lineWidth = px(clamp(R * sc * 0.0026, 1, 3)); ctx.beginPath(); poly(ctx, P); ctx.stroke();
    });
    const lw = px(clamp(R * sc * 0.003, 1.1, 3.2));
    // curls along the edges (fewer, bigger, varied)
    for (let e = 2; e < 10; e++) {
      const lat = BANDS[e][1], above = BELT[e], zoneI = above ? e + 1 : e, beltI = above ? e : e + 1;
      for (let i = 0; i < 4; i++) {
        if (hash(e, i, 9) < 0.3) continue;
        const lon = (i / 4) * TAU + hash(e, i, 3) * 1.2, lam = lon + rot * (1 + JET[e]), p = surf(cx, cy, R, lat, lam);
        if (p.c < 0.12) continue;
        const rr = R * (0.03 + hash(e, i, 5) * 0.03), yy = p.y + (above ? -1 : 1) * rr * 0.62 + amplitudeAt(e, lam, rot) * R;
        if (!inView(V, p.x, yy, rr * 1.5)) continue;
        ctx.save(); ctx.translate(p.x, yy); ctx.scale(p.c, 0.78);
        curl(ctx, 0, 0, rr, mix(col(zoneI), '#ffffff', 0.15), rgba(mix(col(beltI), '#2a0a06', 0.4), 0.4), (e % 2 ? 1 : -1), lw / Math.max(p.c, 0.4), hash(e, i, 6) * TAU);
        ctx.restore();
      }
    }
    // festoons off the NEB south edge, brown barges in the NEB, white ovals in the south
    for (let i = 0; i < 9; i++) {
      const lam = (i / 9) * TAU + hash(i, 2, 8) * 0.4 + rot * (1 + JET[5]), p = surf(cx, cy, R, 7, lam);
      if (p.c < 0.1) continue; const yy = p.y + amplitudeAt(5, lam, rot) * R;
      if (inView(V, p.x, yy, R * 0.2)) festoon(ctx, p.x, yy, R * 0.12, p.c, lw * 0.8 / Math.max(p.c, 0.4), i);
    }
    for (let i = 0; i < 5; i++) {
      const lam = (i / 5) * TAU + 0.5 + hash(i, 3, 8) * 0.6 + rot, p = surf(cx, cy, R, 13.5, lam);
      if (p.c > 0.1 && inView(V, p.x, p.y, R * 0.05)) oval(ctx, p.x, p.y, R * 0.028, R * 0.009, p.c, hot ? '#8a1e20' : '#6e2414', 'rgba(60,15,10,0.35)', lw);
    }
    for (let i = 0; i < 7; i++) {
      const lam = (i / 7) * TAU + hash(i, 4, 8) * 0.5 + rot * 1.02, p = surf(cx, cy, R, -41, lam);
      if (p.c > 0.1 && inView(V, p.x, p.y, R * 0.05)) oval(ctx, p.x, p.y, R * 0.022, R * 0.014, p.c, hot ? '#fff0d8' : '#fffaf0', 'rgba(150,90,60,0.4)', lw);
    }
    // texture: flowing streaks across everything drawn so far
    flowOverlay(ctx, B, cx, cy, R, sc, rot * R, hot ? 0.3 : 0.38, 'overlay');
    // Great Red Spot
    { const lam = 1.1 + rot, p = surf(cx, cy, R, -22, lam);
      if (p.c > 0.03 && inView(V, p.x, p.y, R * 0.3)) greatRedSpot(ctx, p.x, p.y, R, p.c, rot, hot, lw, boil); }
    // impact scars
    (o.scars || []).forEach((s) => {
      const lam = s.lon + rot, p = surf(cx, cy, R, s.lat, lam), r = s.r * R * s.k;
      if (p.c < 0.03 || s.k <= 0 || !inView(V, p.x, p.y, r * 1.8)) return;
      scar(ctx, p.x, p.y, r, p.c, Math.cos(s.lat * D2R), s.seed || 1, boil);
    });
    // lighting
    shadeSphere(ctx, cx, cy, R, o.shade ? o.shade : hot
      ? { key: ['#ffe0b0', 0.5], limb: ['#a04060', 0.35], step: ['#ee5a4c', 0.5, 0.28], night: ['#6a1660', 0.8], emis: ['#ff5a3a', 0.3] }
      : { key: ['#ffe2b0', 0.55], limb: ['#5a2a62', 0.32], step: ['#e3824c', 0.55, 0.28], night: ['#3a2a90', 0.9] }, light, V);
    rims(ctx, cx, cy, R, sc, light, hot ? '#ffe0b0' : '#fff4dc', 0.95, hot ? '#ff8a6a' : '#7fd8ff', 0.85);
    ctx.restore();
    inkSphere(ctx, cx, cy, R, boil, light, V, 4.5);
  }
  // latitude offset (in units of R) of edge e at longitude lam: lets features sit on the wavy edge
  function amplitudeAt(e, lam, rot) { const lat = BANDS[e][1] * D2R, d = EDGE_AMP[e] * edgeOff(lam + rot * (1 + JET[e]), e, 3) * (0.6 + 0.4 * Math.cos(lam)); return -(Math.sin(lat + d) - Math.sin(lat)); }

  function PLAN_youngJupiter(ctx, cx, cy, R, o = {}) {
    const g = o.glow ?? 1;
    if (g > 0) { const V = view(ctx), B = boxOf(V, cx, cy, R * 1.9); if (B.ok) { ctx.save(); ctx.globalCompositeOperation = 'lighter';
      const gr = ctx.createRadialGradient(cx, cy, R * 0.9, cx, cy, R * 1.9); gr.addColorStop(0, `rgba(255,90,110,${0.35 * g})`); gr.addColorStop(0.4, `rgba(200,40,120,${0.14 * g})`); gr.addColorStop(1, 'rgba(120,20,90,0)');
      ctx.fillStyle = gr; ctx.fillRect(B.x0, B.y0, B.x1 - B.x0, B.y1 - B.y0); ctx.restore(); } }
    PLAN_jupiter(ctx, cx, cy, R, { ...o, hot: true });
  }

  // ---------------------------------------------------------------- cutaway (top-right quadrant, opened by w)
  // Radii as in v3 (fractions of R): fuzzy dilute core with no edge (to ~0.45), metallic hydrogen (0.45-0.8),
  // liquid molecular hydrogen (to ~0.9), then the thin cloud deck. Transitions are soft (no hard boundaries in
  // the real planet); ink only on the cut edges and the limb.
  function PLAN_cutaway(ctx, cx, cy, R, w, t, boil, o = {}) {
    if (w <= 0) return;
    const light = o.light || LIGHT, V = view(ctx), sc = V.sc;
    if (!inView(V, cx + R / 2, cy - R / 2, R)) return;
    const a0 = -Math.PI / 2, a1 = a0 + w * Math.PI / 2, am = (a0 + a1) / 2;
    const px = (p) => p / sc, tr = 0.012; // soft transition width between layers (fraction of R)
    ctx.save();
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, R, a0, a1); ctx.closePath(); ctx.clip();
    const B = { x0: Math.max(V.x0, cx - 2), y0: Math.max(V.y0, cy - R - 2), x1: Math.min(V.x1, cx + R + 2), y1: Math.min(V.y1, cy + 2) };
    const fill = (st) => { ctx.fillStyle = st; ctx.fillRect(B.x0, B.y0, B.x1 - B.x0, B.y1 - B.y0); };
    // layer volumes: [inner, outer, colour at inner edge (warmed from below), colour at outer edge]
    const LAY = [[0.45, 0.8, '#c4d2f0', '#6c80c0'], [0.8, 0.915, '#3a64c8', '#1a2c80'], [0.915, 0.94, '#7a3a6a', '#c4522c'], [0.94, 0.965, '#f09a50', '#e07a3c'], [0.965, 0.985, '#fff0d4', '#ffe0b0'], [0.985, 1.0, '#f0a060', '#e48848']];
    let g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
    g.addColorStop(0, '#fff8e0'); g.addColorStop(0.14, '#ffd27a'); g.addColorStop(0.3, '#f09040'); g.addColorStop(0.4, '#c86a5a'); // dilute core: no edge, fades into the metal
    LAY.forEach(([a, b, ci, co], i) => { g.addColorStop(i ? a + tr * 0.5 : a, ci); g.addColorStop(Math.max(a + tr, b - tr * 0.5), co); });
    fill(g);
    // 3D read: two cut faces meeting along a crease at the mid angle. The face toward the vertical cut faces
    // right (away from the key): one toon step darker. The floor faces up toward the key: a touch lighter.
    ctx.globalCompositeOperation = 'multiply'; ctx.fillStyle = 'rgba(96,80,150,0.24)';
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, R * 1.01, a0, am); ctx.closePath(); ctx.fill();
    // ambient occlusion along the cut edges
    const ao = (nx, ny, wd, a) => { const gg = ctx.createLinearGradient(cx, cy, cx + nx * wd, cy + ny * wd); gg.addColorStop(0, `rgba(40,24,70,${a})`); gg.addColorStop(1, 'rgba(40,24,70,0)'); fill(gg); };
    ao(1, 0, R * 0.07, 0.4); if (w > 0.95) ao(0, -1, R * 0.05, 0.22);
    ctx.globalCompositeOperation = 'screen'; ctx.fillStyle = 'rgba(255,240,220,0.08)';
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, R * 1.01, am, a1); ctx.closePath(); ctx.fill();
    // emissive, drawn after the face shading so heat is never shaded: core bloom, warmed layer floors
    ctx.globalCompositeOperation = 'lighter';
    const pulse = 0.88 + 0.12 * Math.sin(t * 2.2);
    g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 0.5); g.addColorStop(0, `rgba(255,240,200,${0.85 * pulse})`); g.addColorStop(0.3, `rgba(255,180,90,${0.45 * pulse})`); g.addColorStop(1, 'rgba(255,120,60,0)'); fill(g);
    for (let i = 0; i < 14; i++) { // slow churning cells in the dilute core
      const an = a0 + (0.08 + 0.84 * hash(i, 1, 3)) * (a1 - a0) + Math.sin(t * 0.6 + i) * 0.04, d = R * (0.08 + 0.3 * Math.sqrt(hash(i, 2, 3))), r = R * (0.035 + hash(i, 3, 3) * 0.04);
      const x = cx + Math.cos(an) * d, y = cy + Math.sin(an) * d, gg = ctx.createRadialGradient(x, y, 0, x, y, r);
      gg.addColorStop(0, `rgba(255,236,180,${0.22 + 0.12 * Math.sin(t * 1.7 + i)})`); gg.addColorStop(1, 'rgba(255,180,90,0)'); ctx.fillStyle = gg; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
    }
    ctx.lineCap = 'round';
    [[0.45, '255,210,160', 0.5], [0.8, '150,190,255', 0.55], [0.915, '255,150,110', 0.5]].forEach(([k, c, a]) => {
      ctx.strokeStyle = `rgba(${c},${a * 0.35})`; ctx.lineWidth = Math.max(px(5), R * 0.022); ctx.beginPath(); ctx.arc(cx, cy, R * (k + 0.012), a0, a1); ctx.stroke();
      ctx.strokeStyle = `rgba(${c},${a})`; ctx.lineWidth = Math.max(px(1.5), R * 0.004); ctx.beginPath(); ctx.arc(cx, cy, R * (k + 0.004), a0, a1); ctx.stroke();
    });
    for (let i = 0; i < 9; i++) { // currents in the metallic hydrogen
      const rr = R * (0.5 + i * 0.033), ph = (t * (0.5 + 0.1 * (i % 3)) + hash(i, 4, 3)) % 1, s0 = a0 + 0.05 + ph * 1.2;
      ctx.strokeStyle = `rgba(225,240,255,${0.45 * Math.sin(Math.PI * ph)})`; ctx.lineWidth = Math.max(px(2), R * 0.005); ctx.beginPath(); ctx.arc(cx, cy, rr, s0, Math.min(a1, s0 + 0.28)); ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
    flowOverlay(ctx, B, cx, cy, R, sc, 0, 0.16, 'soft-light');
    // crease, and the lit lip of the outer shell along the cut
    ctx.strokeStyle = 'rgba(30,18,50,0.4)'; ctx.lineWidth = Math.max(px(1.5), R * 0.0035); ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(am) * R, cy + Math.sin(am) * R); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,248,230,0.85)'; ctx.lineWidth = Math.max(px(2), R * 0.005); ctx.beginPath(); ctx.arc(cx, cy, R * 0.996, a0, a1); ctx.stroke();
    ctx.restore();
    // clean ink cut edges, heavier than the layer work
    const lwE = clamp(R * sc * 0.011, 2.5, 7) / sc;
    ctx.save(); ctx.strokeStyle = INK; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = lwE;
    ctx.beginPath(); ctx.moveTo(cx + Math.cos(a0) * R, cy + Math.sin(a0) * R); ctx.lineTo(cx, cy); ctx.lineTo(cx + Math.cos(a1) * R, cy + Math.sin(a1) * R); ctx.stroke();
    ctx.lineWidth = lwE * 0.55; ctx.beginPath(); ctx.arc(cx, cy, R, a0, a1); ctx.stroke();
    ctx.restore();
  }

  // ---------------------------------------------------------------- Earth
  const LANDS = [ // lon, lat (deg), rx, ry (fractions of r), kind: 0 green, 1 dry
    [-0.9, 30, 0.34, 0.26, 0], [-0.55, 8, 0.2, 0.28, 0], [-0.75, -22, 0.16, 0.3, 0], [0.55, 18, 0.3, 0.3, 1], [0.7, -12, 0.2, 0.26, 0], [0.4, 42, 0.36, 0.14, 0],
    [1.5, 40, 0.42, 0.2, 0], [1.9, 20, 0.2, 0.18, 1], [2.3, -25, 0.24, 0.16, 1], [-2.0, 45, 0.3, 0.2, 0], [-1.8, 10, 0.12, 0.14, 0], [3.0, -5, 0.14, 0.08, 0]];
  function PLAN_earth(ctx, x, y, r, boil, alpha = 1, o = {}) { if (!(r >= 8)) return;
    if (alpha <= 0 || r < 0.5) return;
    const light = o.light || LIGHT, rot = o.rot ?? 0.2, V = view(ctx), sc = V.sc;
    if (!inView(V, x, y, r * 1.4)) return;
    ctx.save(); ctx.globalAlpha *= alpha;
    halo(ctx, x, y, r, '110,200,255', 0.7, light, 0.32, V);
    ctx.save(); ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.clip();
    const Lv = L3(light);
    let g = ctx.createRadialGradient(x + Lv[0] * r * 0.5, y + Lv[1] * r * 0.5, r * 0.05, x, y, r);
    g.addColorStop(0, '#3fa0f4'); g.addColorStop(0.55, '#1a62cc'); g.addColorStop(1, '#0c348a'); ctx.fillStyle = g; ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
    // shallow-water rims and land
    const blob = (lx, ly, rx, ry, grow, seed) => { ctx.beginPath(); for (let i = 0; i <= 18; i++) { const an = (i / 18) * TAU, k = 1 + (vnoise(i * 0.55, seed, 4) - 0.5) * 0.5; const X = lx + Math.cos(an) * (rx * k + grow), Y = ly + Math.sin(an) * (ry * k + grow); i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); } ctx.closePath(); };
    const P = LANDS.map(([lon, lat, rx, ry, kind], i) => { const lam = lon + rot, c = Math.cos(lam); return { i, kind, c, X: x + r * Math.cos(lat * D2R) * Math.sin(lam), Y: y - r * Math.sin(lat * D2R), rx: rx * r * Math.max(0.15, c), ry: ry * r * (0.4 + 0.6 * Math.cos(lat * D2R)) }; }).filter((p) => p.c > -0.05);
    ctx.fillStyle = 'rgba(120,220,240,0.35)'; P.forEach((p) => { blob(p.X, p.Y, p.rx, p.ry, r * 0.03, 60 + p.i); ctx.fill(); });
    P.forEach((p) => { g = ctx.createLinearGradient(p.X - p.rx, p.Y - p.ry, p.X + p.rx, p.Y + p.ry);
      if (p.kind) { g.addColorStop(0, '#f2cf7c'); g.addColorStop(1, '#c08c3c'); } else { g.addColorStop(0, '#6cc45a'); g.addColorStop(1, '#2c8a46'); }
      blob(p.X, p.Y, p.rx, p.ry, 0, 60 + p.i); ctx.fillStyle = g; ctx.fill(); ctx.strokeStyle = 'rgba(16,50,40,0.45)'; ctx.lineWidth = Math.max(0.6 / sc, r * 0.012); ctx.stroke(); });
    // ice caps
    ctx.fillStyle = '#f4fbff'; ctx.beginPath(); ctx.ellipse(x, y - r * 0.97, r * 0.42, r * 0.12, 0, 0, TAU); ctx.fill(); ctx.beginPath(); ctx.ellipse(x, y + r * 0.98, r * 0.5, r * 0.13, 0, 0, TAU); ctx.fill();
    // cloud streaks: tapered white strokes with a faint shadow, drifting with rot
    ctx.lineCap = 'round';
    for (let i = 0; i < 14; i++) {
      const lat = -62 + i * 9.5 + (hash(i, 1, 70) - 0.5) * 8, lam0 = hash(i, 2, 70) * TAU + rot * 1.3, span = 0.6 + hash(i, 3, 70) * 0.7;
      for (const [dx, dy, cc, wk] of [[r * 0.02, r * 0.025, 'rgba(10,40,90,0.25)', 1], [0, 0, 'rgba(255,255,255,0.9)', 1]]) {
        ctx.strokeStyle = cc; ctx.beginPath(); let started = false;
        for (let s = 0; s <= 14; s++) { const lam = lam0 + (s / 14) * span, c = Math.cos(lam); if (c < 0.05) { started = false; continue; }
          const la = lat + 2.5 * Math.sin(s * 0.5 + i), X = x + r * Math.cos(la * D2R) * Math.sin(lam) + dx, Y = y - r * Math.sin(la * D2R) + dy;
          started ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); started = true; }
        ctx.lineWidth = r * (0.016 + 0.018 * hash(i, 4, 70)) * wk; ctx.stroke();
      }
    }
    shadeSphere(ctx, x, y, r, { key: ['#fff0d0', 0.5], limb: ['#203a80', 0.4], step: ['#8aa8e6', 0.35, 0.3], night: ['#0a1450', 0.9] }, light, V);
    // city lights on the night side
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 18; i++) { const lam = hash(i, 1, 90) * TAU + rot, c = Math.cos(lam), lat = (hash(i, 2, 90) - 0.4) * 110; if (c < 0.1) continue;
      const X = x + r * Math.cos(lat * D2R) * Math.sin(lam), Y = y - r * Math.sin(lat * D2R), nd = ((X - x) * Lv[0] + (Y - y) * Lv[1]) / r;
      if (nd > -0.45) continue; ctx.fillStyle = 'rgba(255,200,110,0.85)'; ctx.beginPath(); ctx.arc(X, Y, Math.max(0.7 / sc, r * 0.012), 0, TAU); ctx.fill(); }
    ctx.globalCompositeOperation = 'source-over';
    rims(ctx, x, y, r, sc, light, '#bff0ff', 1, '#7fd8ff', 0.9, 3.5);
    ctx.restore();
    inkSphere(ctx, x, y, r, boil, light, V, 3.2);
    ctx.restore();
  }

  // ---------------------------------------------------------------- the possible ancient planet (hypothetical)
  function PLAN_protoplanet(ctx, x, y, r, boil, o = {}) { if (!(r >= 8)) return;
    const a = o.alpha ?? 1, light = o.light || LIGHT; if (a <= 0) return;
    const V = view(ctx); if (!inView(V, x, y, r * 1.3)) return;
    ctx.save(); ctx.globalAlpha *= a;
    halo(ctx, x, y, r, '255,170,150', 0.25, light, 0.18, V);
    ctx.save(); ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.clip();
    let g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.4, r * 0.1, x, y, r); g.addColorStop(0, '#f0caa0'); g.addColorStop(1, '#b98060'); ctx.fillStyle = g; ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
    for (let i = 0; i < 9; i++) { const cx = x + (hash(i, 1, 4) - 0.5) * r * 1.5, cy = y + (hash(i, 2, 4) - 0.5) * r * 1.5, cr = r * (0.06 + 0.1 * hash(i, 3, 4));
      ctx.fillStyle = 'rgba(120,70,50,0.45)'; ctx.beginPath(); ctx.ellipse(cx, cy, cr, cr * 0.8, 0, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(255,230,200,0.55)'; ctx.lineWidth = cr * 0.18; ctx.beginPath(); ctx.ellipse(cx, cy, cr, cr * 0.8, 0, 2.4, 5.2); ctx.stroke(); }
    shadeSphere(ctx, x, y, r, { key: ['#ffe2b0', 0.5], limb: ['#6a3a50', 0.3], step: ['#e0905e', 0.45, 0.3], night: ['#34288c', 0.85] }, light, V);
    rims(ctx, x, y, r, V.sc, light, '#fff0dc', 0.9, '#7fd8ff', 0.7);
    ctx.restore();
    if (o.dashed !== false) { ctx.setLineDash([26 / V.sc, 16 / V.sc]); ctx.lineDashOffset = -boil * 3 / V.sc; }
    ctx.strokeStyle = INK; ctx.lineWidth = clamp(r * V.sc * 0.03, 2, 6) / V.sc; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
    ctx.restore();
  }

  Object.assign(window, { PLAN_jupiter, PLAN_youngJupiter, PLAN_cutaway, PLAN_earth, PLAN_protoplanet,
    PLAN_shadeSphere: shadeSphere, PLAN_halo: halo, PLAN_inkSphere: inkSphere, PLAN_rims: rims, PLAN_capPath: capPath, PLAN_LIGHT: LIGHT });
})();
