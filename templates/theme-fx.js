/* templates/theme-fx.js — ambient backgrounds + add-to-cart bursts for the designer themes.
 *
 * One tiny canvas engine shared by every theme, so each theme's own JS is just a
 * config object:
 *
 *   ThemeFX.installTheme({
 *     themeColor: '#2A0813',                                   // browser toolbar colour (optional)
 *     layers: [{ type: 'dust', count: 40, colors: ['#E9C46A'], size: [.8, 2.6], speed: [6, 18], alpha: .8, glow: true }],
 *     burst:  { type: 'sparkle', count: 14, colors: ['#F6E3A1', '#D4AF37'] },
 *   });
 *
 * Layer types:  dust · petals · stars · bubbles · rain · bokeh · sparkle · confetti · shapes
 * Burst types:  sparkle · petal · bubble · drop · flare · confetti
 *
 * Good citizen: half the particles on low-power / small screens, paused while the tab is
 * hidden, a single static frame under prefers-reduced-motion, pointer-events:none everywhere.
 * The background canvas sits behind the page (z-index -1); bursts use a second canvas on top
 * that only runs while particles are alive.
 */
(function (root) {
  'use strict';

  const doc = root.document;
  const rnd = (a, b) => a + Math.random() * (b - a);
  const pick = a => a[(Math.random() * a.length) | 0];
  const TAU = Math.PI * 2;
  const reduced = () => !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const LOW = () => ((root.navigator && root.navigator.hardwareConcurrency) || 4) <= 4 || root.innerWidth < 420;

  /* ---------- glow sprites (drawn once per colour, blitted every frame) ---------- */
  const sprites = {};
  function sprite(color) {
    if (sprites[color]) return sprites[color];
    const c = doc.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d');
    if (g) {
      const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.18, color); gr.addColorStop(0.5, color + '55'); gr.addColorStop(1, color + '00');
      g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    }
    return (sprites[color] = c);
  }
  function hex(c) { return /^#[0-9a-f]{6}$/i.test(c) ? c : '#ffffff'; }

  /* ---------- particle types for the background canvas ---------- */
  const petalPath = (() => { try { const p = new Path2D(); p.moveTo(0, -1); p.bezierCurveTo(0.9, -0.6, 0.9, 0.5, 0, 1); p.bezierCurveTo(-0.9, 0.5, -0.9, -0.6, 0, -1); return p; } catch (e) { return null; } })();

  const TYPES = {
    /* glowing motes drifting upward (gold dust, fireflies) */
    dust: {
      make: (w, h, c) => ({ x: rnd(0, w), y: rnd(0, h), r: rnd(c.size[0], c.size[1]), vy: -rnd(c.speed[0], c.speed[1]), sway: rnd(0.4, 1.4), ph: rnd(0, TAU), tw: rnd(0.6, 1.8), col: hex(pick(c.colors)) }),
      step: (p, dt, w, h, t) => { p.y += p.vy * dt; p.x += Math.sin(t * 0.0006 * p.sway + p.ph) * 10 * dt; if (p.y < -12) { p.y = h + 12; p.x = rnd(0, w); } if (p.x < -12) p.x = w + 12; if (p.x > w + 12) p.x = -12; },
      draw: (g, p, t, c) => { const a = c.alpha * (0.5 + 0.5 * Math.sin(t * 0.001 * p.tw + p.ph)); g.globalAlpha = Math.max(0, a); const s = p.r * (c.glow ? 7 : 2); g.drawImage(sprite(p.col), p.x - s / 2, p.y - s / 2, s, s); },
    },

    /* soft, large, slow circles (golden-hour bokeh) */
    bokeh: {
      make: (w, h, c) => ({ x: rnd(0, w), y: rnd(0, h), r: rnd(c.size[0], c.size[1]), vx: rnd(-c.speed[1], c.speed[1]) * 0.6, vy: -rnd(c.speed[0], c.speed[1]), ph: rnd(0, TAU), tw: rnd(0.2, 0.6), col: hex(pick(c.colors)) }),
      step: (p, dt, w, h) => { p.x += p.vx * dt; p.y += p.vy * dt; if (p.y < -p.r * 2) { p.y = h + p.r * 2; p.x = rnd(0, w); } if (p.x < -p.r * 2) p.x = w + p.r * 2; if (p.x > w + p.r * 2) p.x = -p.r * 2; },
      draw: (g, p, t, c) => { g.globalAlpha = c.alpha * (0.6 + 0.4 * Math.sin(t * 0.001 * p.tw + p.ph)); const s = p.r * 2; g.drawImage(sprite(p.col), p.x - s / 2, p.y - s / 2, s, s); },
    },

    /* falling, tumbling petals */
    petals: {
      make: (w, h, c) => ({ x: rnd(0, w), y: rnd(-h, h), s: rnd(c.size[0], c.size[1]), vy: rnd(c.speed[0], c.speed[1]), ph: rnd(0, TAU), rot: rnd(0, TAU), vr: rnd(-1.2, 1.2), flip: rnd(1, 2.6), col: pick(c.colors) }),
      step: (p, dt, w, h, t) => { p.y += p.vy * dt; p.x += Math.sin(t * 0.0008 + p.ph) * 22 * dt + 6 * dt; p.rot += p.vr * dt; if (p.y > h + 20) { p.y = -20; p.x = rnd(-20, w); } if (p.x > w + 20) p.x = -20; },
      draw: (g, p, t, c) => { if (!petalPath) return; g.globalAlpha = c.alpha; g.save(); g.translate(p.x, p.y); g.rotate(p.rot); g.scale(p.s * Math.abs(Math.cos(t * 0.001 * p.flip + p.ph)) * 0.8 + p.s * 0.25, p.s * 1.5); g.fillStyle = p.col; g.fill(petalPath); g.restore(); },
    },

    /* twinkling stars + the odd shooting star */
    stars: {
      make: (w, h, c) => ({ x: rnd(0, w), y: rnd(0, h), r: rnd(c.size[0], c.size[1]), ph: rnd(0, TAU), tw: rnd(0.4, 2.2), col: hex(pick(c.colors)), big: Math.random() < 0.12 }),
      step: () => {},
      draw: (g, p, t, c) => {
        g.globalAlpha = c.alpha * (0.35 + 0.65 * Math.abs(Math.sin(t * 0.001 * p.tw + p.ph)));
        g.fillStyle = p.col;
        if (p.big) { const s = p.r * 3.2; g.beginPath(); g.moveTo(p.x, p.y - s); g.quadraticCurveTo(p.x, p.y, p.x + s, p.y); g.quadraticCurveTo(p.x, p.y, p.x, p.y + s); g.quadraticCurveTo(p.x, p.y, p.x - s, p.y); g.quadraticCurveTo(p.x, p.y, p.x, p.y - s); g.fill(); }
        else { g.beginPath(); g.arc(p.x, p.y, p.r, 0, TAU); g.fill(); }
      },
      extra: (g, st, dt, w, h, t, c) => {           // shooting stars
        if (c.shooting === false) return;
        st.next = st.next == null ? t + rnd(1500, 4000) : st.next;
        if (t > st.next && !st.s) { st.s = { x: rnd(w * 0.2, w), y: rnd(0, h * 0.35), life: 0 }; st.next = t + rnd(5000, 11000); }
        if (st.s) {
          const s = st.s; s.life += dt; s.x -= 420 * dt; s.y += 210 * dt;
          const a = Math.max(0, 1 - s.life / 0.9);
          const gr = g.createLinearGradient(s.x, s.y, s.x + 90, s.y - 45);
          gr.addColorStop(0, 'rgba(255,255,255,' + a + ')'); gr.addColorStop(1, 'rgba(255,255,255,0)');
          g.globalAlpha = 1; g.strokeStyle = gr; g.lineWidth = 1.6; g.beginPath(); g.moveTo(s.x, s.y); g.lineTo(s.x + 90, s.y - 45); g.stroke();
          if (s.life > 0.9) st.s = null;
        }
      },
    },

    /* rising bubbles */
    bubbles: {
      make: (w, h, c) => ({ x: rnd(0, w), y: rnd(0, h), r: rnd(c.size[0], c.size[1]), vy: -rnd(c.speed[0], c.speed[1]), ph: rnd(0, TAU), wob: rnd(0.6, 1.6), col: pick(c.colors) }),
      step: (p, dt, w, h, t) => { p.y += p.vy * dt; p.x += Math.sin(t * 0.001 * p.wob + p.ph) * 14 * dt; if (p.y < -p.r * 2) { p.y = h + p.r * 2; p.x = rnd(0, w); } },
      draw: (g, p, t, c) => {
        g.globalAlpha = c.alpha; g.lineWidth = 1.2; g.strokeStyle = p.col; g.fillStyle = p.col + '22';
        g.beginPath(); g.arc(p.x, p.y, p.r, 0, TAU); g.fill(); g.stroke();
        g.globalAlpha = c.alpha * 1.4; g.beginPath(); g.arc(p.x, p.y, p.r * 0.72, Math.PI * 1.15, Math.PI * 1.55); g.stroke();
      },
    },

    /* rain: slanted streaks in two depths, optional lightning */
    rain: {
      make: (w, h, c) => { const far = Math.random() < 0.55; return { x: rnd(-40, w + 40), y: rnd(-h, h), len: far ? rnd(8, 14) : rnd(16, 28), v: far ? rnd(c.speed[0], (c.speed[0] + c.speed[1]) / 2) : rnd((c.speed[0] + c.speed[1]) / 2, c.speed[1]), far: far }; },
      step: (p, dt, w, h, t, c) => { p.y += p.v * dt; p.x += p.v * c.slant * dt; if (p.y > h + 30) { p.y = -30; p.x = rnd(-40, w + 40); } },
      drawAll: (g, ps, t, c) => {
        [true, false].forEach(far => {
          g.globalAlpha = far ? c.alpha * 0.55 : c.alpha; g.strokeStyle = c.colors[0]; g.lineWidth = far ? 0.8 : 1.3; g.beginPath();
          ps.forEach(p => { if (p.far === far) { g.moveTo(p.x, p.y); g.lineTo(p.x - p.len * c.slant * 1.2, p.y - p.len); } });
          g.stroke();
        });
      },
      extra: (g, st, dt, w, h, t, c) => {
        if (!c.lightning) return;
        st.next = st.next == null ? t + rnd(4000, 9000) : st.next;
        if (t > st.next) { st.flash = 1; st.next = t + rnd(9000, 18000); }
        if (st.flash > 0) { g.globalAlpha = Math.min(0.32, st.flash * 0.32 * (Math.sin(st.flash * 22) > -0.3 ? 1 : 0.25)); g.fillStyle = c.lightning; g.fillRect(0, 0, w, h); st.flash -= dt * 2.6; }
      },
    },

    /* four-point twinkles that appear, glint and vanish in place */
    sparkle: {
      make: (w, h, c) => ({ x: rnd(0, w), y: rnd(0, h), s: rnd(c.size[0], c.size[1]), life: rnd(0, 1), spd: rnd(0.25, 0.7), col: hex(pick(c.colors)) }),
      step: (p, dt, w, h) => { p.life += p.spd * dt; if (p.life >= 1) { p.life = 0; p.x = rnd(0, w); p.y = rnd(0, h); } },
      draw: (g, p, t, c) => {
        const k = Math.sin(p.life * Math.PI), s = p.s * k; if (s < 0.3) return;
        g.globalAlpha = c.alpha * k; g.fillStyle = p.col; g.beginPath();
        g.moveTo(p.x, p.y - s * 2); g.quadraticCurveTo(p.x, p.y, p.x + s * 2, p.y); g.quadraticCurveTo(p.x, p.y, p.x, p.y + s * 2); g.quadraticCurveTo(p.x, p.y, p.x - s * 2, p.y); g.quadraticCurveTo(p.x, p.y, p.x, p.y - s * 2); g.fill();
        g.globalAlpha = c.alpha * k * 0.35; const gs = s * 9; g.drawImage(sprite(p.col), p.x - gs / 2, p.y - gs / 2, gs, gs);
      },
    },
  };

  /* ---------- more layers: confetti + floating geometric shapes ---------- */
  TYPES.confetti = {   // sprinkles tumbling slowly down the page
    make: (w, h, c) => ({ x: rnd(0, w), y: rnd(-h, h), w: rnd(c.size[0], c.size[1]), vy: rnd(c.speed[0], c.speed[1]), ph: rnd(0, TAU), rot: rnd(0, TAU), vr: rnd(-1.6, 1.6), flip: rnd(0.8, 2.2), col: pick(c.colors) }),
    step: (p, dt, w, h, t) => { p.y += p.vy * dt; p.x += Math.sin(t * 0.0007 + p.ph) * 14 * dt; p.rot += p.vr * dt; if (p.y > h + 14) { p.y = -14; p.x = rnd(0, w); } },
    draw: (g, p, t, c) => { g.globalAlpha = c.alpha; g.save(); g.translate(p.x, p.y); g.rotate(p.rot); g.scale(1, Math.abs(Math.cos(t * 0.001 * p.flip + p.ph)) * 0.8 + 0.2); g.fillStyle = p.col; g.fillRect(-p.w, -p.w * 0.32, p.w * 2, p.w * 0.64); g.restore(); },
  };
  TYPES.shapes = {     // slow, outlined circles / triangles / squares / plus-signs (neo-pop)
    make: (w, h, c) => ({ x: rnd(0, w), y: rnd(0, h), s: rnd(c.size[0], c.size[1]), vx: rnd(-8, 8), vy: rnd(-12, 12), rot: rnd(0, TAU), vr: rnd(-0.5, 0.5), kind: pick(['circle', 'tri', 'square', 'plus']), col: pick(c.colors), fill: Math.random() < 0.6 }),
    step: (p, dt, w, h) => { p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt; const m = p.s * 2; if (p.x < -m) p.x = w + m; if (p.x > w + m) p.x = -m; if (p.y < -m) p.y = h + m; if (p.y > h + m) p.y = -m; },
    draw: (g, p, t, c) => {
      g.globalAlpha = c.alpha; g.save(); g.translate(p.x, p.y); g.rotate(p.rot); g.lineWidth = 2.2; g.lineJoin = 'round'; g.lineCap = 'round'; g.strokeStyle = c.line || '#111'; g.fillStyle = p.col; g.beginPath();
      const s = p.s;
      if (p.kind === 'circle') g.arc(0, 0, s * 0.6, 0, TAU);
      else if (p.kind === 'tri') { g.moveTo(0, -s * 0.7); g.lineTo(s * 0.65, s * 0.5); g.lineTo(-s * 0.65, s * 0.5); g.closePath(); }
      else if (p.kind === 'square') g.rect(-s * 0.5, -s * 0.5, s, s);
      else { g.moveTo(-s * 0.6, 0); g.lineTo(s * 0.6, 0); g.moveTo(0, -s * 0.6); g.lineTo(0, s * 0.6); g.lineWidth = 3.4; g.stroke(); g.restore(); return; }
      if (p.fill) g.fill(); g.stroke(); g.restore();
    },
  };

  /* ---------- the background canvas ---------- */
  let bg = null;

  function makeCanvas(z) {
    const c = doc.createElement('canvas');
    c.setAttribute('aria-hidden', 'true');
    c.style.cssText = 'position:fixed;left:0;top:0;width:100%;height:100%;pointer-events:none;z-index:' + z;
    if (z === -1) c.classList.add('tfx-bg');   // stable hook: lets CSS dim the ambient backdrop (e.g. for the hidden menu) without touching per-theme code
    return c;
  }

  function size(cv) {
    const dpr = Math.min(root.devicePixelRatio || 1, 1.5);
    const w = root.innerWidth, h = root.innerHeight;
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    return { w: w, h: h, dpr: dpr };
  }

  function seed() {
    const scale = Math.max(0.6, Math.min(1.5, (bg.w * bg.h) / (390 * 844))) * (LOW() ? 0.7 : 1);
    bg.layers = bg.cfg.layers.map(cfg => {
      const T = TYPES[cfg.type]; if (!T) return null;
      const c = Object.assign({ size: [1, 3], speed: [10, 30], alpha: 0.8, colors: ['#ffffff'], slant: 0.18 }, cfg);
      const n = Math.max(1, Math.round((cfg.count || 30) * scale));
      const ps = []; for (let i = 0; i < n; i++) ps.push(T.make(bg.w, bg.h, c));
      return { T: T, c: c, ps: ps, st: {} };
    }).filter(Boolean);
  }

  function frame(now) {
    if (!bg || !bg.running) return;
    bg.raf = root.requestAnimationFrame(frame);
    const minGap = LOW() ? 32 : 15;
    if (now - bg.last < minGap) return;
    const dt = Math.min(0.05, (now - bg.last) / 1000); bg.last = now;
    draw(dt, now);
  }

  function draw(dt, now) {
    const g = bg.g; g.setTransform(bg.dpr, 0, 0, bg.dpr, 0, 0); g.clearRect(0, 0, bg.w, bg.h);
    bg.layers.forEach(L => {
      L.ps.forEach(p => L.T.step(p, dt, bg.w, bg.h, now, L.c));
      if (L.T.drawAll) L.T.drawAll(g, L.ps, now, L.c); else L.ps.forEach(p => L.T.draw(g, p, now, L.c));
      if (L.T.extra) L.T.extra(g, L.st, dt, bg.w, bg.h, now, L.c);
    });
    g.globalAlpha = 1;
  }

  function start(cfg) {
    stop();
    if (!doc || !cfg || !cfg.layers || !cfg.layers.length) return;
    const cv = makeCanvas(-1);
    doc.body.insertBefore(cv, doc.body.firstChild);
    const g = cv.getContext('2d');
    if (!g) { cv.remove(); return; }                   // no canvas support → the CSS backdrop still carries the theme
    const s = size(cv);
    bg = { cfg: cfg, cv: cv, g: g, w: s.w, h: s.h, dpr: s.dpr, last: performance.now(), running: !reduced(), raf: 0, layers: [] };
    seed();
    draw(0.016, performance.now());                    // first frame immediately (also the static frame for reduced-motion)
    if (bg.running) bg.raf = root.requestAnimationFrame(frame);
  }

  function stop() {
    if (!bg) return;
    bg.running = false; root.cancelAnimationFrame(bg.raf);
    if (bg.cv && bg.cv.parentNode) bg.cv.parentNode.removeChild(bg.cv);
    bg = null;
  }

  let rz = 0;
  root.addEventListener('resize', () => {
    clearTimeout(rz);
    rz = setTimeout(() => { if (!bg) return; const s = size(bg.cv); bg.w = s.w; bg.h = s.h; bg.dpr = s.dpr; seed(); }, 180);
  });
  doc.addEventListener('visibilitychange', () => {
    if (!bg || reduced()) return;
    if (doc.hidden) { bg.running = false; root.cancelAnimationFrame(bg.raf); }
    else { bg.running = true; bg.last = performance.now(); bg.raf = root.requestAnimationFrame(frame); }
  });

  /* ---------- bursts (add-to-cart) on a top canvas that only runs while alive ---------- */
  let fg = null;
  const B = {
    sparkle: { n: 14, life: [0.6, 1.1], v: [60, 190], g: 40, size: [2, 5], shape: 'star' },
    petal:   { n: 12, life: [0.9, 1.5], v: [50, 150], g: 90, size: [4, 7], shape: 'petal' },
    bubble:  { n: 10, life: [0.7, 1.2], v: [40, 120], g: -70, size: [3, 7], shape: 'bubble' },
    drop:    { n: 12, life: [0.5, 0.9], v: [60, 170], g: 380, size: [1.6, 3.4], shape: 'dot' },
    flare:   { n: 9,  life: [0.7, 1.2], v: [40, 130], g: -20, size: [14, 30], shape: 'glow' },
    confetti:{ n: 18, life: [0.9, 1.5], v: [90, 240], g: 300, size: [3, 6], shape: 'rect' },
  };

  function burstAt(x, y, cfg) {
    if (!doc || reduced()) return;
    cfg = cfg || {};
    const def = B[cfg.type] || B.sparkle, colors = cfg.colors || ['#ffffff'];
    if (!fg) {
      const cv = makeCanvas(9999); doc.body.appendChild(cv);
      const g = cv.getContext('2d'); if (!g) { cv.remove(); return; }
      const s = size(cv); fg = { cv: cv, g: g, w: s.w, h: s.h, dpr: s.dpr, ps: [], raf: 0, last: 0 };
    } else if (fg.w !== root.innerWidth || fg.h !== root.innerHeight) { const s = size(fg.cv); fg.w = s.w; fg.h = s.h; fg.dpr = s.dpr; }
    const n = Math.round((cfg.count || def.n) * (LOW() ? 0.75 : 1));
    for (let i = 0; i < n; i++) {
      const a = rnd(0, TAU), v = rnd(def.v[0], def.v[1]);
      const life = rnd(def.life[0], def.life[1]);
      fg.ps.push({ x: x, y: y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - (def.g > 0 ? 60 : 0), g: def.g, life: life, max: life, s: rnd(def.size[0], def.size[1]), rot: rnd(0, TAU), vr: rnd(-6, 6), col: hex(pick(colors)), shape: def.shape });
    }
    if (!fg.raf) { fg.last = performance.now(); fg.raf = root.requestAnimationFrame(fgFrame); }
  }

  function fgFrame(now) {
    const dt = Math.min(0.05, (now - fg.last) / 1000); fg.last = now;
    const g = fg.g; g.setTransform(fg.dpr, 0, 0, fg.dpr, 0, 0); g.clearRect(0, 0, fg.w, fg.h);
    fg.ps = fg.ps.filter(p => (p.life -= dt) > 0);
    fg.ps.forEach(p => {
      p.vy += p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.985; p.rot += p.vr * dt;
      const k = p.life / p.max; g.globalAlpha = Math.min(1, k * 1.6); g.fillStyle = p.col; g.strokeStyle = p.col;
      if (p.shape === 'star') { const s = p.s * (0.5 + k); g.beginPath(); g.moveTo(p.x, p.y - s * 1.8); g.quadraticCurveTo(p.x, p.y, p.x + s * 1.8, p.y); g.quadraticCurveTo(p.x, p.y, p.x, p.y + s * 1.8); g.quadraticCurveTo(p.x, p.y, p.x - s * 1.8, p.y); g.quadraticCurveTo(p.x, p.y, p.x, p.y - s * 1.8); g.fill(); }
      else if (p.shape === 'petal' && petalPath) { g.save(); g.translate(p.x, p.y); g.rotate(p.rot); g.scale(p.s * 0.8, p.s * 1.6); g.fill(petalPath); g.restore(); }
      else if (p.shape === 'rect') { g.save(); g.translate(p.x, p.y); g.rotate(p.rot); g.fillRect(-p.s, -p.s * 0.5, p.s * 2, p.s); g.restore(); }
      else if (p.shape === 'bubble') { g.lineWidth = 1.3; g.beginPath(); g.arc(p.x, p.y, p.s * (1.6 - k * 0.5), 0, TAU); g.stroke(); }
      else if (p.shape === 'glow') { const s = p.s * (2.2 - k); g.globalAlpha = k * 0.7; g.drawImage(sprite(p.col), p.x - s, p.y - s, s * 2, s * 2); }
      else { g.beginPath(); g.arc(p.x, p.y, p.s, 0, TAU); g.fill(); }
    });
    g.globalAlpha = 1;
    if (fg.ps.length) fg.raf = root.requestAnimationFrame(fgFrame); else { fg.raf = 0; g.clearRect(0, 0, fg.w, fg.h); }
  }

  function burstFrom(el, cfg) {
    if (!el || !el.getBoundingClientRect) return;
    const r = el.getBoundingClientRect();
    burstAt(r.left + r.width / 2, r.top + r.height / 2, cfg);
  }

  /* ---------- one-call setup used by every theme's JS ---------- */
  function installTheme(cfg) {
    cfg = cfg || {};
    if (cfg.themeColor && doc) {
      let m = doc.querySelector('meta[name="theme-color"]');
      if (!m) { m = doc.createElement('meta'); m.name = 'theme-color'; doc.head.appendChild(m); }
      m.setAttribute('content', cfg.themeColor);
    }
    start(cfg);
    root.templateHooks = { onAddToCart: btn => { if (cfg.burst) burstFrom(btn, cfg.burst); } };
  }

  root.ThemeFX = { installTheme: installTheme, start: start, stop: stop, burstAt: burstAt, burstFrom: burstFrom, TYPES: Object.keys(TYPES), __debug: { state: () => bg } };
})(typeof window !== 'undefined' ? window : globalThis);
