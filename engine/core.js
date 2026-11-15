// Rheobase engine core: deterministic, time-driven canvas drawing helpers.
// Everything here is a pure function of its inputs (plus fixed seeds), so any
// frame can be rendered exactly, in any order. No real-time playback.
(function () {
  const W = 1920, H = 1080, FPS = 30, DRAW_FPS = 15; // drawings on twos

  // ---------- randomness ----------
  function hash(a, b = 0, c = 0) {
    let h = (a * 374761393 + b * 668265263 + c * 2147483647) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }
  function rng(seed) {
    let s = seed >>> 0 || 1;
    return function () {
      s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function vnoise(x, y, seed = 0) {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = hash(xi, yi, seed), b = hash(xi + 1, yi, seed), c = hash(xi, yi + 1, seed), d = hash(xi + 1, yi + 1, seed);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  function fbm(x, y, seed = 0, oct = 4) {
    let s = 0, a = 0.5, f = 1;
    for (let i = 0; i < oct; i++) { s += a * vnoise(x * f, y * f, seed + i * 17); f *= 2; a *= 0.5; }
    return s;
  }

  // ---------- time ----------
  const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
  const lerp = (a, b, k) => a + (b - a) * k;
  const prog = (t, a, b) => clamp((t - a) / (b - a));
  const ease = {
    inOut: (k) => k * k * (3 - 2 * k),
    out: (k) => 1 - (1 - k) * (1 - k),
    in: (k) => k * k,
    outCubic: (k) => 1 - Math.pow(1 - k, 3),
    inCubic: (k) => k * k * k,
    inOutCubic: (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2),
  };
  const step = (t) => Math.floor(t * DRAW_FPS + 1e-6) / DRAW_FPS; // stop-motion time
  const boilOf = (t) => Math.floor(t * DRAW_FPS + 1e-6);          // boil seed
  const expLerp = (a, b, k) => a * Math.pow(b / a, k);

  // ---------- textures (built once) ----------
  function makeCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  const TEX = {};
  function buildTextures() {
    // paper grain: 4 variants, cycled with the boil
    TEX.grain = [];
    for (let v = 0; v < 4; v++) {
      const c = makeCanvas(W / 2, H / 2), g = c.getContext('2d');
      const id = g.createImageData(c.width, c.height), r = rng(1000 + v);
      for (let i = 0; i < id.data.length; i += 4) {
        const n = 128 + (r() - 0.5) * 90;
        id.data[i] = id.data[i + 1] = id.data[i + 2] = n; id.data[i + 3] = 255;
      }
      g.putImageData(id, 0, 0);
      TEX.grain.push(c);
    }
    // tileable gouache mottling (period-wrapped value noise, so no seams)
    const S = 512;
    const vp = (x, y, P, seed) => {
      const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
      const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
      const w = (i) => ((i % P) + P) % P;
      const a = hash(w(xi), w(yi), seed), b = hash(w(xi + 1), w(yi), seed), c = hash(w(xi), w(yi + 1), seed), d = hash(w(xi + 1), w(yi + 1), seed);
      return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
    };
    const tile = (fn) => { const c = makeCanvas(S, S), g = c.getContext('2d'), id = g.createImageData(S, S);
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const k = clamp(fn(x, y)); const i = (y * S + x) * 4; id.data[i] = id.data[i + 1] = id.data[i + 2] = 255 * k; id.data[i + 3] = 255; }
      g.putImageData(id, 0, 0); return c; };
    TEX.mottle = tile((x, y) => {
      let n = 0, amp = 0.5, P = 8;
      for (let o = 0; o < 5; o++) { n += amp * vp((x / S) * P, (y / S) * P, P, 7 + o); amp *= 0.5; P *= 2; }
      return 0.62 + (n - 0.5) * 1.25 + (vp(x / S * 64, y / S * 64, 64, 99) - 0.5) * 0.12;
    });
    // horizontal brush streaks (for flowing cloud bands)
    TEX.streak = tile((x, y) => {
      let n = 0, amp = 0.5, Px = 4, Py = 32;
      for (let o = 0; o < 4; o++) { n += amp * vpXY(x, y, Px, Py, 31 + o); amp *= 0.5; Px *= 2; Py *= 2; }
      return 0.6 + (n - 0.5) * 1.3;
    });
    function vpXY(x, y, Px, Py, seed) { // anisotropic: separate periods in x and y
      const X = (x / S) * Px, Y = (y / S) * Py;
      const xi = Math.floor(X), yi = Math.floor(Y), xf = X - xi, yf = Y - yi;
      const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
      const wx = (i) => ((i % Px) + Px) % Px, wy = (i) => ((i % Py) + Py) % Py;
      const a = hash(wx(xi), wy(yi), seed), b = hash(wx(xi + 1), wy(yi), seed), c = hash(wx(xi), wy(yi + 1), seed), d = hash(wx(xi + 1), wy(yi + 1), seed);
      return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
    }
  }

  // ---------- drawing helpers ----------
  // A boiled closed blob/circle path.
  function blobPath(ctx, cx, cy, rx, ry, boil, amp = 0.02, n = 48, seed = 0, rot = 0) {
    ctx.beginPath();
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2;
      const j = i % n;
      const k = 1 + (hash(j, boil, seed) - 0.5) * amp + (vnoise(j * 0.4, seed, 3) - 0.5) * amp;
      const x = Math.cos(a) * rx * k, y = Math.sin(a) * ry * k;
      const X = cx + x * Math.cos(rot) - y * Math.sin(rot), Y = cy + x * Math.sin(rot) + y * Math.cos(rot);
      i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y);
    }
    ctx.closePath();
  }
  // Ink stroke along points with boil jitter, double pass for a brushy edge.
  function inkLine(ctx, pts, { w = 3, color = '#140d0b', boil = 0, jit = 1.2, seed = 0, alpha = 1, close = false } = {}) {
    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.strokeStyle = color; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (let pass = 0; pass < 2; pass++) {
      ctx.lineWidth = pass ? w * 0.55 : w;
      ctx.globalAlpha *= pass ? 0.6 : 1;
      ctx.beginPath();
      pts.forEach((p, i) => {
        const jx = (hash(i, boil, seed + pass * 31) - 0.5) * jit * 2;
        const jy = (hash(i + 99, boil, seed + pass * 31) - 0.5) * jit * 2;
        i ? ctx.lineTo(p[0] + jx, p[1] + jy) : ctx.moveTo(p[0] + jx, p[1] + jy);
      });
      if (close) ctx.closePath();
      ctx.stroke();
    }
    ctx.restore();
  }
  // Fill the current clip with mottled gouache texture (multiply).
  function gouache(ctx, x, y, w, h, alpha = 0.35, seed = 0, scale = 1, tex = 'mottle', sy = null) {
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.globalAlpha = alpha;
    const ox = (hash(seed, 1) * 400) | 0, oy = (hash(seed, 2) * 400) | 0;
    const pat = ctx.createPattern(TEX[tex], 'repeat');
    const m = new DOMMatrix().translateSelf(x - ox, y - oy).scaleSelf(scale, sy ?? scale);
    pat.setTransform(m);
    ctx.fillStyle = pat;
    ctx.fillRect(x, y, w, h);
    ctx.restore();
  }
  // Crosshatch inside the current clip.
  function hatch(ctx, x, y, w, h, { angle = -0.7, gap = 9, color = '#1a1020', lw = 1.4, alpha = 0.5, boil = 0, seed = 0 } = {}) {
    ctx.save();
    ctx.globalAlpha *= alpha; ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.lineCap = 'round';
    const cx = x + w / 2, cy = y + h / 2, L = Math.hypot(w, h);
    const ca = Math.cos(angle), sa = Math.sin(angle);
    ctx.beginPath();
    let i = 0;
    for (let d = -L / 2; d < L / 2; d += gap, i++) {
      const j = (hash(i, boil, seed) - 0.5) * gap * 0.5;
      const px = cx - sa * (d + j), py = cy + ca * (d + j);
      const len = L * (0.5 + 0.05 * hash(i, boil + 7, seed));
      ctx.moveTo(px - ca * len, py - sa * len);
      ctx.lineTo(px + ca * len, py + sa * len);
    }
    ctx.stroke();
    ctx.restore();
  }
  function glow(ctx, x, y, r, color, alpha = 1) {
    if (r <= 0 || alpha <= 0) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = clamp(alpha);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color); g.addColorStop(0.35, color.replace(/[\d.]+\)$/, '0.35)')); g.addColorStop(1, color.replace(/[\d.]+\)$/, '0)'));
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
    ctx.restore();
  }
  // Paper grain + vignette over the whole frame.
  function finish(ctx, t, { grain = 0.16, vignette = 0.45, warm = null } = {}) {
    const b = boilOf(t);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'overlay';
    ctx.globalAlpha = grain;
    ctx.drawImage(TEX.grain[b % 4], 0, 0, W, H);
    ctx.globalCompositeOperation = 'multiply';
    ctx.globalAlpha = grain * 0.9;
    const pat = ctx.createPattern(TEX.mottle, 'repeat');
    pat.setTransform(new DOMMatrix().scaleSelf(2.2, 2.2));
    ctx.fillStyle = pat; ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 1.05);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, `rgba(5,3,12,${vignette})`);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    if (warm) { ctx.globalCompositeOperation = 'soft-light'; ctx.fillStyle = warm; ctx.fillRect(0, 0, W, H); }
    ctx.restore();
  }

  // ---------- camera ----------
  // cam = {x, y, z}: world point at screen centre, zoom.
  // BASE maps a full 1920x1080 scene frame onto the real canvas (identity normally;
  // a smaller/offset matrix when a scene is drawn nested inside another, e.g. in a visor).
  let BASE = new DOMMatrix();
  function setBase(m) { BASE = m || new DOMMatrix(); }
  function getBase() { return BASE; }
  function screen(ctx) { ctx.setTransform(BASE); }
  function applyCam(ctx, cam) { ctx.setTransform(BASE.multiply(new DOMMatrix([cam.z, 0, 0, cam.z, W / 2 - cam.x * cam.z, H / 2 - cam.y * cam.z]))); }
  function toScreen(cam, x, y) { return [W / 2 + (x - cam.x) * cam.z, H / 2 + (y - cam.y) * cam.z]; }

  // ---------- stars ----------
  function starfield(ctx, t, { seed = 1, n = 420, colors = ['255,236,190'], parallax = null, size = 1 } = {}) {
    const r = rng(seed), b = boilOf(t);
    ctx.save(); screen(ctx);
    for (let i = 0; i < n; i++) {
      let x = r() * W, y = r() * H; const m = r(), c = colors[i % colors.length];
      if (parallax) { x = ((x + parallax[0] * (0.3 + m)) % W + W) % W; y = ((y + parallax[1] * (0.3 + m)) % H + H) % H; }
      const tw = 0.55 + 0.45 * hash(i, b >> 1, seed);
      const s = (m < 0.93 ? 0.9 + m * 1.2 : 2.2 + m * 2) * size;
      ctx.fillStyle = `rgba(${c},${(0.35 + 0.65 * m) * tw})`;
      ctx.beginPath(); ctx.arc(x, y, s, 0, 7); ctx.fill();
      if (m > 0.985) glow(ctx, x, y, 14 * size, `rgba(${c},0.5)`, tw);
    }
    ctx.restore();
  }

  window.ENG = { W, H, FPS, DRAW_FPS, hash, rng, vnoise, fbm, clamp, lerp, prog, ease, step, boilOf, expLerp,
    makeCanvas, TEX, buildTextures, blobPath, inkLine, gouache, hatch, glow, finish, applyCam, toScreen, starfield, setBase, getBase, screen };
})();
