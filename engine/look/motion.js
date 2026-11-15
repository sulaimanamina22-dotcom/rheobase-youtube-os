// =====================================================================================
// motion.js  (MOT_ prefix)  Rheobase motion helpers, measured from Cleo Abram / Vox
// animation and the zoom-style demo. Plain JS, deterministic in t (no Math.random),
// no dependencies. Works in the browser (attaches to window) and in node (module.exports).
//
// HOW TO CALL (all times in seconds, 30 fps video; "f" = frames at 30 fps)
//   Easing (k in 0..1 -> progress, may leave 0..1 on purpose):
//     MOT_ease(k, {peak=0.35, inPow=2, outPow=3})   asymmetric ease: velocity peaks at `peak`,
//                                                    long soft tail. Replaces inOutCubic for moves.
//     MOT_spring(k, {overshoot=0.12})                 arrive with overshoot + settle, k=1 settled.
//     MOT_anticipate(k, {back=0.12, wind=0.3, overshoot=0.08})  pull back, then go, then settle.
//     MOT_iris(k)                                     reveal radius 0..1 (log-space, soft landing).
//     MOT_pushIn(k)                                   log-zoom progress that accelerates into a cut.
//     MOT_landOut(k)                                  log-zoom progress after a cut: starts at the
//                                                     push's exit speed, stops in ~7 f.
//     MOT_logLerp(a, b, k)                            interpolate scales/zooms (use with the above).
//     MOT_at(t, t0, frames)                           -> k (clamped 0..1) for a move of `frames` @30.
//   Secondary motion:
//     MOT_follow(t, driver, {freq=2.4, zeta=0.32, window=1.5})  spring follower of driver(t) (number),
//                                                     deterministic (re-simulated from t-window).
//     MOT_chain(t, n, driver, {lagF=2, gain=1.12, freq, zeta})   n chained parts (arm, hand, finger,
//                                                     antenna, tail); part i lags i*lagF frames.
//   Alive while holding:
//     MOT_float(t, seed, {px=7, rotDeg=1.2, period=4.2})   -> {x, y, rot}  slow idle float.
//     MOT_breath(t, seed, {amp=0.012, period=3.4})         -> {sx, sy}  volume-preserving breath.
//     MOT_holdPose(t, seed, {minF=6, maxF=11})              -> value in -1..1, held for 6..11 f,
//                                                     then snaps to a new value (stop-motion idle).
//     MOT_flicker(t, seed, {rate=12, depth=0.18})          -> 1-depth..1 brightness, stepped.
//   Camera (always smooth, never stepped):
//     MOT_camDrift(t, seed, {px=14, rotDeg=0.35, zoom=0.006, period=7}) -> {x, y, rot, z}
//     MOT_shake(t, tHit, seed, {amp=14, frames=11, rotDeg=0.5, freq=13}) -> {x, y, rot}
//     MOT_flash(t, tHit, {pulses=1, gap=0.9}) -> 0..1 white-flash alpha (2 up, 2 full, 1 half, off).
//     MOT_parallax(cam, factor) -> [a,b,c,d,e,f] for ctx.setTransform; cam={x,y,z,rot}, world point
//                                  at screen centre (same meaning as ENG.applyCam). factor: sky 0.12,
//                                  far 0.35, mid 0.7, subject 1, foreground 1.4.
//   Cadence:
//     MOT_twos(t, rate=12)      stepped time for DRAWN LINE BOIL / drawn poses only (12 drawings/s).
//     MOT_boilSeed(t, rate=12)  integer seed that changes 12 times a second.
//     Camera, parallax, transitions and object paths keep using continuous t.
//   Smear:
//     MOT_smear(ctx, t, draw, {samples='auto', shutter=0.5, speedPx=0, fps=30})
//        draw(ctx, ts, t) is called `samples` times at sub-frame times ts spread over the shutter
//        and averaged exactly (premultiplied 'lighter' accumulation). Draw ONLY the moving object
//        (never the background) in the current transform. Use the frame time t (3rd arg) for boil.
//
// RULES (measured; full numbers in REPORT.md)
//   * Moves: velocity peaks at 25-40% of the move, the tail is the longer part. 18-30 f per move.
//   * Arrivals: 7-8 f to the overshoot peak, 10-17% overshoot, back on target 4 f later, then a
//     residual drift of 1-2% of frame width per second (never a dead stop).
//   * Character settle: rotation wobble 6 deg -> 3.5 -> 2.3 -> 0.6, one swing per drawing (zeta 0.2).
//     Landing squash: scaleY 0.90 / scaleX 1.06 for 2-3 f.
//   * Anticipation: 4-6 f back by 8-15% of travel before any deliberate move by a character.
//   * Reveal (iris): 24-26 f total, not 8. Push-through: 22-28 f accelerating in log space, cut at
//     full speed, land in 6-8 f with matched speed, roll the camera 6-12 deg into the push.
//   * Holds: subject floats 5-8 px, rotates +-1-3 deg, camera drifts 10-20 px over 6-8 s.
//   * Parallax: sky 0.10-0.15 of the subject's screen motion, far 0.3-0.4, foreground 1.3-1.6.
//   * Boil only on ink lines, 12/s, 1.2-2 px; paper grain locked (do not re-roll it every boil).
// =====================================================================================
(function (root) {
  const FPS = 30;
  const TAU = Math.PI * 2;
  const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
  const lerp = (a, b, k) => a + (b - a) * k;

  // ---------- deterministic noise ----------
  function MOT_hash(a, b = 0, c = 0) {
    let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(c | 0, 2147483647)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }
  function MOT_noise1(x, seed = 0) { // smooth 1D value noise in -1..1
    const i = Math.floor(x), f = x - i, u = f * f * f * (f * (f * 6 - 15) + 10);
    return lerp(MOT_hash(i, seed, 7), MOT_hash(i + 1, seed, 7), u) * 2 - 1;
  }

  // ---------- timing ----------
  const MOT_at = (t, t0, frames) => clamp((t - t0) * FPS / frames);
  const MOT_logLerp = (a, b, k) => a * Math.pow(b / a, k);

  // ---------- easing ----------
  // Asymmetric ease: power-in up to `peak`, power-out tail; C1 continuous, velocity max at `peak`.
  function MOT_ease(k, { peak = 0.35, inPow = 2, outPow = 3 } = {}) {
    k = clamp(k);
    const p = clamp(peak, 0.05, 0.95);
    const A = 1 / (1 + (inPow * (1 - p)) / (outPow * p)), B = 1 - A;
    return k < p ? A * Math.pow(k / p, inPow) : 1 - B * Math.pow(1 - (k - p) / (1 - p), outPow);
  }
  // Damped spring step response on 0..1, settled (within 1%) at k = 1, exact 1 at k >= 1.
  // overshoot 0.12 -> zeta 0.56; 0.17 -> zeta 0.49; 0.05 -> zeta 0.69. Peak at k ~ 0.4.
  function MOT_spring(k, { overshoot = 0.12 } = {}) {
    if (k <= 0) return 0;
    if (k >= 1) return 1;
    const lo = Math.log(clamp(overshoot, 0.001, 0.9));
    const z = -lo / Math.sqrt(Math.PI * Math.PI + lo * lo);
    const zw = 4.6, w = zw / z, wd = w * Math.sqrt(1 - z * z);
    const x = (s) => 1 - Math.exp(-zw * s) * (Math.cos(wd * s) + (zw / wd) * Math.sin(wd * s));
    const e = x(1) - 1; // remove the tiny residual so k=1 lands exactly
    return x(k) - e * k * k * k;
  }
  // Anticipation: ease back to -back over `wind`, then spring forward to 1 (overshoot, settle).
  function MOT_anticipate(k, { back = 0.12, wind = 0.3, overshoot = 0.08 } = {}) {
    k = clamp(k);
    if (k < wind) { const u = k / wind; return -back * u * u * (3 - 2 * u); }
    const u = (k - wind) / (1 - wind);
    return -back + (1 + back) * MOT_spring(u, { overshoot });
  }
  // Iris / reveal radius: log-space exponential approach (Cleo's ring: r x1.5 per frame at first,
  // linear-speed peak at ~40%, soft 12-frame landing). Returns 0..1 of the final radius.
  function MOT_iris(k, { r0 = 0.005, K = 4.9 } = {}) {
    k = clamp(k);
    const L0 = Math.log(r0), end = Math.exp(-K);
    const g = (Math.exp(-K * k) - end) / (1 - end); // 1 -> 0
    return Math.exp(L0 * g);
  }
  // Push into a detail: log-zoom progress accelerating to the cut (power 2.2 in log space).
  const MOT_pushIn = (k) => Math.pow(clamp(k), 2.2);
  // After the cut: start at the same log speed the push ended with and stop smoothly.
  // Pair: total log distance D1 over F1 frames with MOT_pushIn, then the landing covers
  // D2 = D1 * (2.2 / F1) * F2 / 2.6 over F2 frames (see MOT_landDistance).
  const MOT_landOut = (k) => 1 - Math.pow(1 - clamp(k), 2.6);
  const MOT_landDistance = (D1, F1, F2) => D1 * (2.2 / F1) * F2 / 2.6;

  // ---------- secondary motion ----------
  // Spring follower: x'' = w^2 (d - x) - 2 zeta w x'. Re-simulated from t-window at 240 Hz so the
  // result depends only on t (deterministic, any frame order).
  function MOT_follow(t, driver, { freq = 2.4, zeta = 0.32, window = 1.5, hz = 240 } = {}) {
    const w = TAU * freq, dt = 1 / hz;
    const n = Math.ceil(window * hz);
    let s = t - n * dt, x = driver(s), v = 0;
    for (let i = 0; i < n; i++) {
      const d = driver(s + dt * 0.5);
      const a = w * w * (d - x) - 2 * zeta * w * v;
      v += a * dt; x += v * dt; s += dt;
    }
    return x;
  }
  // Chained parts: returns n values; part i follows the driver delayed by i*lagF frames, through a
  // spring, with a slightly larger swing (gain^i) so tips whip past the root.
  function MOT_chain(t, n, driver, { lagF = 2, gain = 1.12, freq = 2.6, zeta = 0.3, window = 1.2 } = {}) {
    const out = [];
    for (let i = 0; i < n; i++) {
      const lag = (i * lagF) / FPS, g = Math.pow(gain, i);
      out.push(i === 0 ? driver(t) : MOT_follow(t - lag, (s) => driver(s) * g, { freq: freq / (1 + 0.15 * i), zeta, window }));
    }
    return out;
  }

  // ---------- alive while holding ----------
  function MOT_float(t, seed = 0, { px = 7, rotDeg = 1.2, period = 4.2 } = {}) {
    const f = t / period;
    return {
      x: px * 0.6 * (0.7 * Math.sin(TAU * f * 0.71 + seed) + 0.3 * MOT_noise1(f * 1.3, seed + 1)),
      y: px * (0.75 * Math.sin(TAU * f + seed * 1.7) + 0.25 * MOT_noise1(f * 1.7, seed + 2)),
      rot: (rotDeg * Math.PI / 180) * (0.7 * Math.sin(TAU * f * 0.83 + seed * 2.3 + 1) + 0.3 * MOT_noise1(f * 1.1, seed + 3)),
    };
  }
  function MOT_breath(t, seed = 0, { amp = 0.012, period = 3.4 } = {}) {
    const ph = TAU * t / period + seed;
    const s = Math.sin(ph) + 0.25 * Math.sin(2 * ph + 1.1); // quicker in-breath, slower out
    return { sx: 1 - amp * 0.5 * s, sy: 1 + amp * s };
  }
  // Stop-motion idle: a value in -1..1 held for minF..maxF frames, then a new one (zoom-demo idle).
  function MOT_holdPose(t, seed = 0, { minF = 6, maxF = 11 } = {}) {
    const f = Math.floor(t * FPS + 1e-6), B = minF + maxF; // each block = two holds, both minF..maxF
    const blk = Math.floor(f / B), r = f - blk * B;
    const split = minF + Math.floor(MOT_hash(blk, seed, 11) * (maxF - minF + 1));
    const id = blk * 2 + (r >= split ? 1 : 0);
    return MOT_hash(id, seed, 13) * 2 - 1;
  }
  function MOT_flicker(t, seed = 0, { rate = 12, depth = 0.18 } = {}) {
    const i = Math.floor(t * rate + 1e-6);
    return 1 - depth * MOT_hash(i, seed, 17);
  }

  // ---------- camera ----------
  function MOT_camDrift(t, seed = 0, { px = 14, rotDeg = 0.35, zoom = 0.006, period = 7 } = {}) {
    const f = t / period;
    return {
      x: px * (0.65 * Math.sin(TAU * f * 0.8 + seed) + 0.35 * MOT_noise1(f * 1.4, seed + 21)),
      y: px * 0.6 * (0.65 * Math.sin(TAU * f * 0.61 + seed * 1.3 + 2) + 0.35 * MOT_noise1(f * 1.2, seed + 22)),
      rot: (rotDeg * Math.PI / 180) * MOT_noise1(f * 0.9, seed + 23),
      z: 1 + zoom * (0.5 + 0.5 * Math.sin(TAU * f * 0.5 + seed * 0.7)),
    };
  }
  // Impact shake: decaying, deterministic, noise based (not a sine), first kick strongest and
  // pointing along `dir` (radians) if given. Zero before tHit and after `frames`.
  function MOT_shake(t, tHit, seed = 0, { amp = 14, frames = 11, rotDeg = 0.5, freq = 13, dir = null } = {}) {
    const dt = t - tHit, T = frames / FPS;
    if (dt < 0 || dt > T) return { x: 0, y: 0, rot: 0 };
    const env = Math.exp(-3.5 * dt / T) * (1 - Math.pow(dt / T, 4));
    const q = dt * freq, d = dir ?? MOT_hash(seed, 3, 41) * TAU;
    const kick = Math.exp(-dt * 30); // first frame jumps along d, then noise takes over
    const nx = 1.6 * MOT_noise1(q + 0.5, seed + 31), ny = 1.6 * MOT_noise1(q + 0.5, seed + 32);
    const x = lerp(clamp(nx, -1, 1), Math.cos(d), kick), y = lerp(clamp(ny, -1, 1), Math.sin(d), kick);
    return { x: amp * env * x, y: amp * env * y, rot: (rotDeg * Math.PI / 180) * env * MOT_noise1(q, seed + 33) };
  }
  // White flash profile measured on Cleo's lightning: 2 frames up (0.45, 0.85), 2 frames full,
  // 1 frame at 0.45, then gone. pulses>1 repeats after `gap` seconds at 0.8x strength.
  function MOT_flash(t, tHit, { pulses = 1, gap = 0.9 } = {}) {
    const prof = [0.45, 0.85, 1, 1, 0.45];
    let a = 0;
    for (let p = 0; p < pulses; p++) {
      const f = (t - tHit - p * gap) * FPS;
      if (f < 0 || f >= prof.length) continue;
      const i = Math.floor(f), u = f - i;
      const v = lerp(prof[i], prof[i + 1] ?? 0, u);
      a = Math.max(a, v * Math.pow(0.8, p));
    }
    return a;
  }
  // Parallax layer transform. cam = {x, y, z, rot}: world point at screen centre and zoom, as in
  // ENG.applyCam. A layer with factor f moves f times as much as the subject plane (f = 1) and
  // zooms by z^f, so a push separates the layers too. Returns [a,b,c,d,e,f] for ctx.setTransform
  // (premultiply by your base matrix if nested). anchor: the world point where all layers agree.
  function MOT_parallax(cam, factor, { W = 1920, H = 1080, anchor = null } = {}) {
    const ax = anchor ? anchor[0] : W / 2, ay = anchor ? anchor[1] : H / 2;
    const z = Math.pow(cam.z || 1, factor);
    const cx = ax + ((cam.x ?? ax) - ax) * factor, cy = ay + ((cam.y ?? ay) - ay) * factor;
    const r = (cam.rot || 0) * Math.min(1, factor), c = Math.cos(r) * z, s = Math.sin(r) * z;
    // screen = R*z*(world - c) + centre
    return [c, s, -s, c, W / 2 - (c * cx - s * cy), H / 2 - (s * cx + c * cy)];
  }

  // ---------- cadence ----------
  const MOT_twos = (t, rate = 12) => Math.floor(t * rate + 1e-6) / rate;
  const MOT_boilSeed = (t, rate = 12) => Math.floor(t * rate + 1e-6);

  // ---------- smear / motion blur ----------
  let ACC = null, TMP = null;
  function canvasLike(w, h) {
    if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
    const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
  }
  function MOT_smear(ctx, t, draw, { samples = 'auto', shutter = 0.5, speedPx = 0, fps = FPS } = {}) {
    let n = samples === 'auto' ? Math.max(1, Math.min(8, Math.ceil((speedPx * shutter) / 6))) : Math.max(1, samples | 0);
    if (n <= 1) { draw(ctx, t, t); return; }
    const cw = ctx.canvas.width, ch = ctx.canvas.height;
    if (!ACC || ACC.width !== cw || ACC.height !== ch) { ACC = canvasLike(cw, ch); TMP = canvasLike(cw, ch); }
    const a = ACC.getContext('2d'), b = TMP.getContext('2d'), M = ctx.getTransform();
    a.setTransform(1, 0, 0, 1, 0, 0); a.clearRect(0, 0, cw, ch);
    a.globalCompositeOperation = 'lighter'; a.globalAlpha = 1 / n;
    const span = shutter / fps;
    for (let i = 0; i < n; i++) {
      const ts = t - span / 2 + span * ((i + 0.5) / n); // centred shutter
      b.setTransform(1, 0, 0, 1, 0, 0); b.clearRect(0, 0, cw, ch);
      b.globalAlpha = 1; b.globalCompositeOperation = 'source-over';
      b.setTransform(M);
      draw(b, ts, t);
      a.drawImage(TMP, 0, 0);
    }
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(ACC, 0, 0); ctx.restore();
  }

  const API = { MOT_FPS: FPS, MOT_hash, MOT_noise1, MOT_at, MOT_logLerp, MOT_ease, MOT_spring, MOT_anticipate, MOT_iris,
    MOT_pushIn, MOT_landOut, MOT_landDistance, MOT_follow, MOT_chain, MOT_float, MOT_breath, MOT_holdPose, MOT_flicker,
    MOT_camDrift, MOT_shake, MOT_flash, MOT_parallax, MOT_twos, MOT_boilSeed, MOT_smear };
  Object.assign(root, API);
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
