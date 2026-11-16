export const gameCatalog = [
  {
    id: 'salt-run', title: 'Salt Run', author: '小林', authorId: 'demo-lin',
    description: '按空格或轻点画面，让小方块跳过障碍，完成一段短跑。',
    kind: 'salt-run', cover: 'assets/salt-run.svg', accent: '#c84936',
  },
  {
    id: 'orbit', title: 'Orbit', author: '阿岚', authorId: 'demo-lan',
    description: '移动光球，依次收集六颗星点，留下自己的轨道。',
    kind: 'orbit', cover: 'assets/orbit.svg', accent: '#7298ad',
  },
  {
    id: 'tiles', title: '点亮九宫格', author: '禾禾', authorId: 'demo-he',
    description: '每次点击会翻转自己和相邻的方格，试着让九格同时亮起。',
    kind: 'tiles', cover: 'assets/tiles.svg', accent: '#c4a148',
  },
];

const W = 900;
const H = 560;
const TAU = Math.PI * 2;
const colors = { paper: '#f3f0e9', ink: '#282a27', muted: '#84867e', red: '#c84936', yellow: '#c4a148', blue: '#7298ad' };
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

/**
 * Mount one local, playable prototype. No network requests or analytics are sent.
 * onProgress({ progress, score, label }); onComplete({ score, label }).
 * Call destroy() before replacing the host or opening a different game.
 */
export function mountGame(host, kind, { onComplete, onProgress } = {}) {
  if (!host || typeof host.replaceChildren !== 'function') throw new TypeError('A game host element is required.');
  if (!gameCatalog.some(game => game.kind === kind)) throw new RangeError(`Unknown game kind: ${kind}`);
  const canvas = document.createElement('canvas');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  canvas.tabIndex = 0;
  canvas.setAttribute('role', 'application');
  const instructions = {
    'salt-run': 'Salt Run。空格、上方向键或点击画面跳跃。躲过障碍，坚持十八秒。',
    orbit: 'Orbit。鼠标或触摸移动光球，也可用方向键移动。依次收集六颗发光星点。',
    tiles: '点亮九宫格。点击方格，或用方向键选中后按空格或回车翻转。自己的格子和上下左右相邻格会一起翻转。让九格同时亮起。',
  };
  canvas.setAttribute('aria-label', instructions[kind]);
  canvas.style.cssText = 'display:block;width:100%;height:auto;aspect-ratio:45 / 28;touch-action:none;border-radius:16px;outline-offset:4px;';
  host.replaceChildren(canvas);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser cannot create a canvas game.');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const listeners = [];
  let destroyed = false;
  let finished = false;
  let result = null;
  let raf = 0;
  let previous = 0;
  let elapsed = 0;
  let lastProgressTime = -1;
  const keys = new Set();

  function listen(target, name, handler, options) {
    target.addEventListener(name, handler, options);
    listeners.push(() => target.removeEventListener(name, handler, options));
  }
  function point(event) {
    const rect = canvas.getBoundingClientRect();
    return { x: (event.clientX - rect.left) / rect.width * W, y: (event.clientY - rect.top) / rect.height * H };
  }
  function report(progress, score, label, force = false) {
    if (destroyed || finished) return;
    if (force || elapsed - lastProgressTime >= 0.3) {
      lastProgressTime = elapsed;
      onProgress?.({ progress: clamp(progress, 0, 1), score, label });
    }
  }
  function complete(score, label) {
    if (finished || destroyed) return;
    finished = true;
    result = { score, label };
    canvas.setAttribute('aria-label', `${instructions[kind]} 本次结果：${label}，${score} 分。`);
    onComplete?.(result);
  }
  function text(value, x, y, size = 16, color = colors.ink, align = 'left', weight = 400) {
    ctx.fillStyle = color;
    ctx.font = `${weight} ${size}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    ctx.fillText(value, x, y);
  }
  function rounded(x, y, width, height, radius, fill) {
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, radius);
    ctx.fill();
  }
  function header(name, note, dark = false) {
    const fg = dark ? '#f3f0e9' : colors.ink;
    text(name, 36, 37, 19, fg, 'left', 650);
    text(note, W - 36, 37, 13, dark ? '#a5b1b6' : colors.muted, 'right');
  }
  function finishOverlay() {
    if (!finished) return;
    rounded(W / 2 - 175, H / 2 - 47, 350, 94, 16, '#f3f0e9');
    text(result.label, W / 2, H / 2 - 9, 25, colors.ink, 'center', 650);
    text(`${result.score} 分 · 本次体验已结束`, W / 2, H / 2 + 23, 14, colors.muted, 'center');
  }

  function createRunner() {
    const ground = 421;
    const player = { x: 160, y: ground - 38, size: 38, vy: 0, grounded: true };
    const duration = 18;
    let obstacles = [];
    let nextSpawn = 1.8;
    let serial = 0;
    let passed = 0;
    function jump() {
      if (finished || !player.grounded) return;
      player.vy = -700;
      player.grounded = false;
    }
    listen(canvas, 'pointerdown', event => { event.preventDefault(); canvas.focus({ preventScroll: true }); jump(); });
    return {
      key(event) { if (!event.repeat && ['Space', 'ArrowUp', 'KeyW'].includes(event.code)) jump(); },
      update(dt) {
        player.vy += 1800 * dt;
        player.y += player.vy * dt;
        if (player.y >= ground - player.size) { player.y = ground - player.size; player.vy = 0; player.grounded = true; }
        if (elapsed >= nextSpawn && elapsed < duration - 1.8) {
          const height = [42, 52, 36, 60][serial % 4];
          obstacles.push({ x: W + 30, width: serial % 3 === 0 ? 34 : 26, height, passed: false });
          nextSpawn += [1.7, 1.55, 1.9, 1.6][serial++ % 4];
        }
        for (const obstacle of obstacles) {
          obstacle.x -= (310 + elapsed * 3) * dt;
          if (!obstacle.passed && obstacle.x + obstacle.width < player.x) { obstacle.passed = true; passed += 1; }
          const inset = 5;
          if (player.x + player.size - inset > obstacle.x && player.x + inset < obstacle.x + obstacle.width && player.y + player.size - inset > ground - obstacle.height) {
            complete(passed * 100 + Math.floor(elapsed * 10), '撞到障碍了');
            return;
          }
        }
        obstacles = obstacles.filter(obstacle => obstacle.x > -60);
        report(elapsed / duration, passed * 100, `已越过 ${passed} 个障碍`);
        if (elapsed >= duration) complete(passed * 100 + 500, '抵达终点！');
      },
      draw() {
        ctx.fillStyle = colors.paper; ctx.fillRect(0, 0, W, H);
        header('SALT RUN', 'SPACE / 点击 · 跳跃');
        text('小小一步，也算前进。', 36, 93, 13, colors.muted);
        ctx.strokeStyle = '#d8d8cd'; ctx.lineWidth = 1;
        for (let i = 0; i < 13; i++) {
          const x = ((i * 92 - elapsed * 35) % (W + 92) + W + 92) % (W + 92);
          ctx.beginPath(); ctx.moveTo(x, 245 + (i % 3) * 24); ctx.lineTo(x + 28, 245 + (i % 3) * 24); ctx.stroke();
        }
        ctx.fillStyle = '#e9e6dd'; ctx.fillRect(0, ground, W, H - ground);
        ctx.strokeStyle = '#494c43'; ctx.beginPath(); ctx.moveTo(0, ground); ctx.lineTo(W, ground); ctx.stroke();
        for (let i = 0; i < 20; i++) {
          const x = ((i * 61 - elapsed * 315) % (W + 61) + W + 61) % (W + 61);
          ctx.fillStyle = '#c6c9bd'; ctx.fillRect(x, ground + 24 + i % 3 * 13, 14, 2);
        }
        ctx.fillStyle = '#d0cfc4'; ctx.beginPath(); ctx.ellipse(player.x + 19, ground + 6, 26, 5, 0, 0, TAU); ctx.fill();
        rounded(player.x, player.y, player.size, player.size, 5, colors.red);
        ctx.fillStyle = colors.paper; ctx.fillRect(player.x + 25, player.y + 9, 4, 5);
        for (const obstacle of obstacles) rounded(obstacle.x, ground - obstacle.height, obstacle.width, obstacle.height, 3, colors.ink);
        rounded(36, H - 46, W - 72, 5, 3, '#d8d8cc');
        rounded(36, H - 46, Math.max(4, (W - 72) * clamp(elapsed / duration, 0, 1)), 5, 3, colors.red);
        text(`${Math.min(duration, Math.floor(elapsed))} / ${duration} 秒`, W - 36, 94, 15, colors.ink, 'right');
      },
    };
  }

  function createTiles() {
    const size = 99, gap = 14, origin = { x: 288, y: 111 };
    const values = Array(9).fill(true);
    let selected = 4;
    let moves = 0;
    function flip(index) {
      const row = Math.floor(index / 3), col = index % 3;
      for (const [dr, dc] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const r = row + dr, c = col + dc;
        if (r >= 0 && r < 3 && c >= 0 && c < 3) values[r * 3 + c] = !values[r * 3 + c];
      }
    }
    [0, 4, 8].forEach(flip); // A guaranteed-solvable board, three switches away from the goal.
    function activate(index) {
      if (finished) return;
      selected = index;
      flip(index); moves += 1;
      const lit = values.filter(Boolean).length;
      canvas.setAttribute('aria-label', `${instructions.tiles} 已操作 ${moves} 次，亮起 ${lit} 格。当前第 ${Math.floor(selected / 3) + 1} 行、第 ${selected % 3 + 1} 列。`);
      report(lit / 9, moves, `${lit} / 9 格已点亮`, true);
      if (lit === 9) complete(Math.max(100, 1000 - Math.max(0, moves - 3) * 40), `${moves} 步，全部点亮！`);
    }
    listen(canvas, 'pointerdown', event => {
      event.preventDefault(); canvas.focus({ preventScroll: true });
      const p = point(event);
      const col = Math.floor((p.x - origin.x) / (size + gap));
      const row = Math.floor((p.y - origin.y) / (size + gap));
      if (col >= 0 && col < 3 && row >= 0 && row < 3 && (p.x - origin.x) % (size + gap) <= size && (p.y - origin.y) % (size + gap) <= size) activate(row * 3 + col);
    });
    return {
      key(event) {
        const row = Math.floor(selected / 3), col = selected % 3;
        if (event.code === 'ArrowLeft') selected = row * 3 + Math.max(0, col - 1);
        if (event.code === 'ArrowRight') selected = row * 3 + Math.min(2, col + 1);
        if (event.code === 'ArrowUp') selected = Math.max(0, row - 1) * 3 + col;
        if (event.code === 'ArrowDown') selected = Math.min(2, row + 1) * 3 + col;
        if (!event.repeat && ['Space', 'Enter'].includes(event.code)) activate(selected);
      },
      update() {},
      draw() {
        ctx.fillStyle = colors.paper; ctx.fillRect(0, 0, W, H);
        header('点亮九宫格', '方向键选择 · SPACE 翻转');
        text(`${moves} 步`, W - 36, 89, 21, colors.ink, 'right', 600);
        for (let i = 0; i < 9; i++) {
          const x = origin.x + i % 3 * (size + gap), y = origin.y + Math.floor(i / 3) * (size + gap);
          rounded(x, y + 5, size, size, 13, '#d8d4c8');
          rounded(x, y, size, size, 13, values[i] ? colors.yellow : '#dfdfd5');
          ctx.fillStyle = values[i] ? '#f7edc7' : '#c3c5b9';
          ctx.beginPath(); ctx.arc(x + size / 2, y + size / 2, 9, 0, TAU); ctx.fill();
          if (i === selected && document.activeElement === canvas) {
            ctx.strokeStyle = colors.ink; ctx.lineWidth = 2; ctx.beginPath(); ctx.roundRect(x - 5, y - 5, size + 10, size + 10, 17); ctx.stroke();
          }
        }
        text('点击一格，自己与上下左右一起翻转', W / 2, 480, 16, colors.ink, 'center');
        text('目标：让九格同时亮起', W / 2, 508, 13, colors.muted, 'center');
      },
    };
  }

  function createOrbit() {
    const player = { x: W / 2, y: H / 2, vx: 0, vy: 0 };
    const target = { x: player.x, y: player.y };
    const beacons = [{ x: 680, y: 176 }, { x: 705, y: 385 }, { x: 460, y: 442 }, { x: 214, y: 353 }, { x: 258, y: 155 }, { x: 450, y: 268 }];
    const trail = [];
    let collected = 0;
    let ripple = 0;
    function steer(event) { const p = point(event); target.x = clamp(p.x, 28, W - 28); target.y = clamp(p.y, 80, H - 45); }
    listen(canvas, 'pointerdown', event => { event.preventDefault(); canvas.focus({ preventScroll: true }); canvas.setPointerCapture?.(event.pointerId); steer(event); });
    listen(canvas, 'pointermove', steer);
    return {
      key() {},
      update(dt) {
        if (keys.has('ArrowLeft') || keys.has('KeyA')) target.x -= 320 * dt;
        if (keys.has('ArrowRight') || keys.has('KeyD')) target.x += 320 * dt;
        if (keys.has('ArrowUp') || keys.has('KeyW')) target.y -= 320 * dt;
        if (keys.has('ArrowDown') || keys.has('KeyS')) target.y += 320 * dt;
        target.x = clamp(target.x, 28, W - 28); target.y = clamp(target.y, 80, H - 45);
        const pull = Math.min(1, dt * 7);
        player.vx += ((target.x - player.x) * 5 - player.vx) * pull;
        player.vy += ((target.y - player.y) * 5 - player.vy) * pull;
        player.x += player.vx * dt; player.y += player.vy * dt;
        trail.push({ x: player.x, y: player.y }); if (trail.length > 85) trail.shift();
        ripple = Math.max(0, ripple - dt);
        const beacon = beacons[collected];
        if (beacon && Math.hypot(player.x - beacon.x, player.y - beacon.y) < 25) {
          collected += 1; ripple = 0.6;
          report(collected / beacons.length, collected * 100, `已收集 ${collected} / 6 颗星点`, true);
          if (collected === beacons.length) complete(600 + Math.max(0, 400 - Math.floor(elapsed * 8)), '你的轨道，完成了！');
        }
      },
      draw() {
        ctx.fillStyle = '#242b2e'; ctx.fillRect(0, 0, W, H);
        header('ORBIT', '鼠标 / 触摸 / 方向键 · 移动', true);
        text(`${collected} / 6`, W - 36, 88, 22, '#e6e8e2', 'right', 600);
        for (let i = 0; i < 65; i++) {
          const x = (i * 137.2 + 33) % W, y = 78 + (i * 81.7) % (H - 118);
          ctx.fillStyle = i % 5 ? '#465358' : '#75898f'; ctx.beginPath(); ctx.arc(x, y, i % 5 ? 1 : 1.8, 0, TAU); ctx.fill();
        }
        ctx.strokeStyle = '#38464c'; ctx.lineWidth = 1;
        for (let i = 1; i <= 3; i++) { ctx.beginPath(); ctx.ellipse(W / 2, H / 2 + 10, 90 * i, 54 * i, -0.2, 0, TAU); ctx.stroke(); }
        if (trail.length > 1) {
          for (let i = 1; i < trail.length; i++) {
            ctx.strokeStyle = `rgba(126, 171, 192, ${i / trail.length * 0.55})`; ctx.lineWidth = 1 + i / trail.length * 5;
            ctx.beginPath(); ctx.moveTo(trail[i - 1].x, trail[i - 1].y); ctx.lineTo(trail[i].x, trail[i].y); ctx.stroke();
          }
        }
        for (let i = 0; i < beacons.length; i++) {
          const beacon = beacons[i];
          if (i > collected) continue;
          ctx.strokeStyle = i < collected ? '#62716d' : '#e0bd66'; ctx.lineWidth = i < collected ? 1 : 2;
          ctx.beginPath(); ctx.arc(beacon.x, beacon.y, i < collected ? 5 : 20 + Math.sin(elapsed * 3) * 3, 0, TAU); ctx.stroke();
          if (i === collected) {
            ctx.fillStyle = '#e0bd66'; ctx.beginPath(); ctx.moveTo(beacon.x, beacon.y - 8); ctx.lineTo(beacon.x + 5, beacon.y); ctx.lineTo(beacon.x, beacon.y + 8); ctx.lineTo(beacon.x - 5, beacon.y); ctx.closePath(); ctx.fill();
            text(`${i + 1}`, beacon.x, beacon.y - 36, 12, '#b1bbb8', 'center');
          }
        }
        for (let i = 0; i < 7; i++) {
          const a = elapsed * (1 + i % 3 * 0.2) + i * TAU / 7;
          ctx.fillStyle = '#7298ad'; ctx.beginPath(); ctx.arc(player.x + Math.cos(a) * (20 + i % 2 * 10), player.y + Math.sin(a) * (12 + i % 2 * 8), 1.7, 0, TAU); ctx.fill();
        }
        if (ripple > 0) { ctx.strokeStyle = `rgba(224,189,102,${ripple})`; ctx.beginPath(); ctx.arc(player.x, player.y, 15 + (0.6 - ripple) * 65, 0, TAU); ctx.stroke(); }
        ctx.fillStyle = '#eaf1e9'; ctx.beginPath(); ctx.arc(player.x, player.y, 8, 0, TAU); ctx.fill();
        text('靠近发光星点，画出一条属于你的路径', W / 2, H - 28, 13, '#a5b1b6', 'center');
      },
    };
  }

  const game = kind === 'salt-run' ? createRunner() : kind === 'tiles' ? createTiles() : createOrbit();
  const supportedKeys = new Set(['Space', 'Enter', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'KeyW', 'KeyA', 'KeyS', 'KeyD']);
  listen(window, 'keydown', event => {
    if (destroyed || finished || document.activeElement !== canvas) return;
    if (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable="true"]')) return;
    if (!supportedKeys.has(event.code)) return;
    event.preventDefault(); keys.add(event.code); game.key(event);
  });
  listen(window, 'keyup', event => keys.delete(event.code));
  listen(window, 'blur', () => keys.clear());
  listen(canvas, 'blur', () => keys.clear());
  function frame(now) {
    if (destroyed) return;
    const dt = previous ? Math.min(0.04, (now - previous) / 1000) : 0;
    previous = now;
    if (!finished) { elapsed += dt; game.update(dt); }
    if (destroyed) return;
    game.draw(); finishOverlay();
    if (!finished) raf = requestAnimationFrame(frame);
  }
  game.draw();
  canvas.focus({ preventScroll: true });
  raf = requestAnimationFrame(frame);
  return {
    destroy() {
      if (destroyed) return;
      destroyed = true; cancelAnimationFrame(raf); keys.clear();
      listeners.forEach(remove => remove());
      if (canvas.parentNode === host) canvas.remove();
    },
  };
}
