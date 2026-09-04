/* A small pixel fire in the corner.

   16x16, 32-frame flipbook drawn as crisp blocks. The frames are generated
   at load with a classic fire-propagation sim (no image assets), and the
   loop is crossfaded so it never jumps. The cursor can shove lit pixels
   around and heat them; the buffer heals back toward the animation. Click
   to blow it out. */

(function () {
  "use strict";

  const N = 16;
  const FRAMES = 32;
  const FPS = 18;

  const BURN_RADIUS = 2.8;
  const HEAL_RATE = 6.0;
  const SWAY_MAX = 2.0;

  const CELL = 3;                 // css px per fire pixel
  const SIZE = N * CELL;          // 48px fire, 48px block under it

  const stage = document.getElementById("fire");
  if (!stage) return;

  // --- procedural textures ---------------------------------------------

  const MAX = 36;                 // hottest source value
  const LIT = 9;                  // below this a cell is transparent
  const STOPS = [
    [0.00, 168, 32, 18],
    [0.35, 226, 96, 24],
    [0.70, 250, 172, 40],
    [1.00, 255, 236, 150],
  ];

  function palette(v, out, p) {
    if (v < LIT) { out[p] = out[p + 1] = out[p + 2] = out[p + 3] = 0; return; }
    const t = Math.min(1, (v - LIT) / (MAX - LIT));
    let k = 1;
    while (k < STOPS.length - 1 && STOPS[k][0] < t) k++;
    const a = STOPS[k - 1], b = STOPS[k];
    const w = (t - a[0]) / (b[0] - a[0]);
    out[p] = a[1] + (b[1] - a[1]) * w;
    out[p + 1] = a[2] + (b[2] - a[2]) * w;
    out[p + 2] = a[3] + (b[3] - a[3]) * w;
    out[p + 3] = 255;
  }

  function makeFrames() {
    const H = N + 3;              // hidden source rows below the visible grid
    const cur = new Uint8Array(N * H);
    const col = new Float32Array(N).fill(MAX);   // per-column source heat

    function step() {
      // the source wanders per column, so some tongues run tall and some short
      for (let x = 0; x < N; x++) {
        col[x] = Math.min(MAX, Math.max(MAX - 18, col[x] + ((Math.random() * 9 | 0) - 4)));
        for (let y = N; y < H; y++) cur[y * N + x] = col[x];
      }
      for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
          const src = cur[(y + 1) * N + x];
          const drift = (Math.random() * 3 | 0) - 1;
          const dx = Math.min(N - 1, Math.max(0, x + drift));
          const decay = (Math.random() < 0.8 ? 1 : 0) + (Math.random() < 0.5 ? 1 : 0)
                      + (Math.random() < 0.3 ? 1 : 0) + (Math.random() < 0.1 ? 1 : 0);
          cur[y * N + dx] = Math.max(0, src - decay);
        }
      }
    }

    for (let i = 0; i < 48; i++) step();          // warm up
    const caps = [];
    for (let i = 0; i < FRAMES + 8; i++) {
      step();
      caps.push(Uint8Array.from(cur.subarray(0, N * N)));
    }

    const frames = [];
    for (let f = 0; f < FRAMES; f++) {
      const data = new Uint8ClampedArray(N * N * 4);
      for (let i = 0; i < N * N; i++) {
        let v = caps[f][i];
        if (f < 8) {                              // seamless loop
          const w = (f + 1) / 9;
          v = caps[f][i] * w + caps[f + FRAMES][i] * (1 - w);
        }
        palette(v, data, i * 4);
      }
      frames.push(data);
    }
    return frames;
  }

  function makeRock() {
    const c = document.createElement("canvas");
    c.width = N; c.height = N;
    const ctx = c.getContext("2d");
    const img = ctx.createImageData(N, N);
    const d = img.data;
    for (let i = 0; i < N * N; i++) {
      const n = Math.random();
      let r = 96 + n * 34, g = 44 + n * 16, b = 42 + n * 16;
      const spot = Math.random();
      if (spot < 0.18) { r *= 0.62; g *= 0.62; b *= 0.62; }
      else if (spot > 0.9) { r *= 1.18; g *= 1.1; b *= 1.1; }
      d[i * 4] = r; d[i * 4 + 1] = g; d[i * 4 + 2] = b; d[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }

  // --- engine ----------------------------------------------------------

  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const hiddenMq = matchMedia("(max-width: 1000px)");

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  stage.appendChild(canvas);

  const off = document.createElement("canvas");
  off.width = N; off.height = N;
  const offCtx = off.getContext("2d");
  const buf = offCtx.createImageData(N, N);

  const grid = new Float32Array(N * N * 4);
  const scratch = new Float32Array(N * N * 4);
  const dist = new Float32Array(N * N);
  let primed = false;

  let swayX = 0, swayTarget = 0;
  const vel = { x: 0, y: 0 };

  const frames = makeFrames();
  const rock = makeRock();

  const box = { x: 0, y: 0, size: SIZE, dpr: 1 };

  let pcell = null, prevP = null;
  let raf = 0, wantRun = false, last = 0, acc = 0;

  const idx = (x, y) => y * N + x;

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cw = stage.clientWidth, ch = stage.clientHeight;
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);
    box.x = Math.round((cw - SIZE) / 2);
    box.y = Math.max(0, ch - SIZE * 2);
    box.dpr = dpr;
    ctx.imageSmoothingEnabled = false;
  }

  function onMove(e) {
    const r = stage.getBoundingClientRect();
    const px = e.clientX - r.left - box.x;
    const py = e.clientY - r.top - box.y;
    if (px < 0 || py < 0 || px > box.size || py > box.size) { pcell = null; return; }
    pcell = { x: (px / box.size) * N, y: (py / box.size) * N };
  }

  function blowAll() {
    for (let i = 0; i < N * N; i++) {
      const p = i * 4;
      if (grid[p + 3] > 127) {
        grid[p] = grid[p + 1] = grid[p + 2] = grid[p + 3] = 0;
        dist[i] = 1;
      }
    }
  }

  function stepFire(dt, src) {
    if (!primed) { grid.set(src); primed = true; }

    if (pcell && prevP) {
      vel.x += ((pcell.x - prevP.x) / Math.max(dt, 0.001) - vel.x) * 0.3;
      vel.y += ((pcell.y - prevP.y) / Math.max(dt, 0.001) - vel.y) * 0.3;
    } else {
      vel.x *= 0.8; vel.y *= 0.8;
    }
    prevP = pcell ? { x: pcell.x, y: pcell.y } : null;

    swayTarget = pcell ? ((pcell.x - N / 2) / (N / 2)) * SWAY_MAX : 0;
    swayX += (swayTarget - swayX) * Math.min(1, dt * 6);

    const distDecay = Math.min(1, HEAL_RATE * dt);
    for (let i = 0; i < N * N; i++) {
      const p = i * 4;
      const srcLit = src[p + 3] > 127;
      const d = dist[i];

      if (d < 0.02) {
        if (srcLit) {
          grid[p] = src[p]; grid[p + 1] = src[p + 1]; grid[p + 2] = src[p + 2]; grid[p + 3] = 255;
        } else {
          grid[p] = grid[p + 1] = grid[p + 2] = grid[p + 3] = 0;
        }
        continue;
      }

      const lit = grid[p + 3] > 127;
      if (!lit && srcLit) {
        if (Math.random() < distDecay * 0.6) {
          grid[p] = src[p]; grid[p + 1] = src[p + 1]; grid[p + 2] = src[p + 2]; grid[p + 3] = 255;
          dist[i] = 0;
          continue;
        }
      } else if (lit && !srcLit) {
        grid[p] = grid[p + 1] = grid[p + 2] = grid[p + 3] = 0;
      }
      dist[i] = d * (1 - distDecay);
    }

    if (pcell) {
      const cx = pcell.x, cy = pcell.y, r = BURN_RADIUS;
      const speed = Math.hypot(vel.x, vel.y);
      const inv = speed > 0.001 ? 1 / speed : 0;
      const pushX = vel.x * inv;
      const pushY = vel.y * inv - 0.8;
      const pl = Math.hypot(pushX, pushY) || 1;
      const ux = pushX / pl, uy = pushY / pl;

      const reach = r + 1.2;
      const x0 = Math.max(0, Math.floor(cx - reach)), x1 = Math.min(N - 1, Math.ceil(cx + reach));
      const y0 = Math.max(0, Math.floor(cy - reach)), y1 = Math.min(N - 1, Math.ceil(cy + reach));

      scratch.set(grid);
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
          const d = Math.hypot(dx, dy);
          if (d > r) continue;
          const i = idx(x, y), p = i * 4;
          const fall = 1 - d / r;
          if (grid[p + 3] < 40) continue;

          const moveBy = 1 + Math.round(fall * 3);
          const tx = Math.min(N - 1, Math.max(0, x + Math.round(ux * moveBy)));
          const ty = Math.min(N - 1, Math.max(0, y + Math.round(uy * moveBy)));
          const tp = idx(tx, ty) * 4;

          const heat = fall;
          const rr = grid[p] + (255 - grid[p]) * heat * 0.6;
          const gg = grid[p + 1] + (245 - grid[p + 1]) * heat * 0.45;
          const bb = grid[p + 2] + (190 - grid[p + 2]) * heat * 0.3;

          if (rr + gg + bb >= scratch[tp] + scratch[tp + 1] + scratch[tp + 2]) {
            scratch[tp] = rr; scratch[tp + 1] = gg; scratch[tp + 2] = bb;
          }
          scratch[tp + 3] = 255;
          dist[idx(tx, ty)] = 1;

          if (fall > 0.12) {
            scratch[p] = scratch[p + 1] = scratch[p + 2] = scratch[p + 3] = 0;
            dist[i] = 1;
          }
        }
      }
      grid.set(scratch);
    }
  }

  function render() {
    const out = buf.data;
    for (let y = 0; y < N; y++) {
      const leanFrac = 1 - y / (N - 1);
      const shift = Math.round(swayX * leanFrac);
      for (let x = 0; x < N; x++) {
        const p = idx(x, y) * 4;
        const sx = Math.min(N - 1, Math.max(0, x - shift));
        const gp = idx(sx, y) * 4;
        out[p] = grid[gp]; out[p + 1] = grid[gp + 1]; out[p + 2] = grid[gp + 2]; out[p + 3] = grid[gp + 3];
      }
    }
    offCtx.putImageData(buf, 0, 0);

    const d = box.dpr;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(rock, box.x * d, (box.y + box.size) * d, box.size * d, box.size * d);
    ctx.drawImage(off, box.x * d, box.y * d, box.size * d, box.size * d);
  }

  function frame(ms) {
    raf = 0;
    const dt = last ? Math.min(0.05, (ms - last) / 1000) : 0.016;
    last = ms;
    acc = (acc + dt * FPS) % FRAMES;
    stepFire(dt, frames[Math.floor(acc) % FRAMES]);
    render();
    if (wantRun) raf = requestAnimationFrame(frame);
  }

  function start() {
    if (reduced || hiddenMq.matches) return;
    wantRun = true;
    if (!raf) { last = 0; raf = requestAnimationFrame(frame); }
  }

  function stop() {
    wantRun = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }

  // --- wire up ---------------------------------------------------------

  resize();
  window.addEventListener("resize", resize);
  window.addEventListener("pointermove", onMove, { passive: true });
  stage.addEventListener("pointerleave", () => { pcell = null; });
  stage.addEventListener("pointerdown", blowAll, { passive: true });
  hiddenMq.addEventListener("change", (e) => (e.matches ? stop() : start()));

  if (reduced) {
    acc = 16;
    grid.set(frames[16]);
    primed = true;
    render();
  } else {
    start();
  }
})();
