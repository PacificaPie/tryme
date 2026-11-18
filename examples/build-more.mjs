import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import sharp from 'sharp';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const out = path.join(root, 'public/examples');
await mkdir(out, { recursive: true });

// These factories have no dependencies outside their supplied drawing/lifecycle kit.
function memoryGame(k) {
  const { ctx, rect, text, circle, random, finish, status } = k;
  const symbols = ['月', '潮', '贝', '鱼', '星', '帆'];
  const colors = ['#e5ad5e', '#45afa8', '#de8587', '#70a6d0', '#aa93d3', '#82ac83'];
  const deck = Array.from({ length: 12 }, (_, i) => i % 6);
  for (let i = deck.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [deck[i], deck[j]] = [deck[j], deck[i]]; }
  let chosen = 0, shown = [], matched = new Set(), wait = 0, moves = 0, elapsed = 0, done = false;
  const box = i => ({ x: 160 + i % 4 * 148, y: 110 + Math.floor(i / 4) * 146, w: 132, h: 126 });
  function pick(i) {
    chosen = i; if (done || wait || matched.has(i) || shown.includes(i)) return;
    shown.push(i); status(`翻开 ${symbols[deck[i]]}，已配成 ${matched.size / 2} 对`);
    if (shown.length === 2) { moves++; if (deck[shown[0]] === deck[shown[1]]) { shown.forEach(j => matched.add(j)); shown = []; if (matched.size === 12) { done = true; finish(Math.max(100, 1200 - (moves - 6) * 45), `${moves} 次配对，收集全部潮汐`); } } else wait = .85; }
  }
  return {
    update(dt) { if (!done) elapsed += dt; if (wait > 0) { wait -= dt; if (wait <= 0) { wait = 0; shown = []; } } },
    key(code) { if (code === 'ArrowLeft') chosen = Math.max(0, chosen - 1); if (code === 'ArrowRight') chosen = Math.min(11, chosen + 1); if (code === 'ArrowUp') chosen = Math.max(0, chosen - 4); if (code === 'ArrowDown') chosen = Math.min(11, chosen + 4); if (['Space', 'Enter'].includes(code)) pick(chosen); },
    action(name) { this.key(name); },
    pointer(type, p) { if (type !== 'down') return; for (let i = 0; i < 12; i++) { const b = box(i); if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) pick(i); } },
    draw() {
      rect(0, 0, 900, 620, 0, '#e9f2ee'); text('TIDAL MEMORY', 44, 48, 22, '#2d5b57', 'left', 700); text(`${matched.size / 2} / 6 对   ·   ${moves} 次`, 856, 48, 20, '#587b76', 'right');
      for (let i = 0; i < 12; i++) { const b = box(i), open = shown.includes(i) || matched.has(i); rect(b.x, b.y + 5, b.w, b.h, 17, '#c5d8d0'); rect(b.x, b.y, b.w, b.h, 17, open ? '#fffcf3' : '#58958c', i === chosen ? '#e4a45a' : null); if (open) { circle(b.x + 66, b.y + 47, 29, colors[deck[i]]); text(symbols[deck[i]], b.x + 66, b.y + 47, 27, '#fff', 'center', 700); text(matched.has(i) ? '已配对' : '记住它', b.x + 66, b.y + 96, 15, '#66827a', 'center'); } else { text('≈', b.x + 66, b.y + 60, 64, '#cee7d8', 'center'); } }
      text('翻开两张相同的卡片', 450, 585, 20, '#66827a', 'center');
    }, snapshot() { return { deck: [...deck], matched: [...matched], moves, done }; }
  };
}

function snakeGame(k) {
  const { rect, text, random, finish, status } = k;
  const size = 16, cell = 27, ox = 234, oy = 106;
  let snake = [{ x: 4, y: 8 }, { x: 3, y: 8 }, { x: 2, y: 8 }], dir = { x: 1, y: 0 }, next = dir, food, timer = 0, eaten = 0, done = false;
  function spawn() { const free = []; for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!snake.some(s => s.x === x && s.y === y)) free.push({ x, y }); food = free[Math.floor(random() * free.length)]; }
  spawn();
  function steer(name) { const v = { ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 }, ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 } }[name]; if (v && !(v.x === -dir.x && v.y === -dir.y)) next = v; }
  function step() {
    dir = next; const head = { x: snake[0].x + dir.x, y: snake[0].y + dir.y }, grows = head.x === food.x && head.y === food.y;
    const body = grows ? snake : snake.slice(0, -1);
    if (head.x < 0 || head.x >= size || head.y < 0 || head.y >= size || body.some(s => s.x === head.x && s.y === head.y)) { done = true; finish(eaten * 100, `本局收集 ${eaten} 颗果实`); return; }
    snake.unshift(head); if (!grows) snake.pop(); else { eaten++; status(`已收集 ${eaten} / 8 颗果实`); if (eaten === 8) { done = true; finish(1200, '果园收集完成'); } else spawn(); }
  }
  return {
    update(dt) { if (done) return; timer += dt; const pace = Math.max(.12, .22 - eaten * .009); if (timer >= pace) { timer -= pace; step(); } }, key: steer, action: steer,
    pointer(type, p) { if (type !== 'down') return; const dx = p.x - (ox + (snake[0].x + .5) * cell), dy = p.y - (oy + (snake[0].y + .5) * cell); steer(Math.abs(dx) > Math.abs(dy) ? dx > 0 ? 'ArrowRight' : 'ArrowLeft' : dy > 0 ? 'ArrowDown' : 'ArrowUp'); },
    draw() {
      rect(0, 0, 900, 620, 0, '#102b23'); text('PIXEL ORCHARD', 44, 48, 24, '#cfe7a1', 'left', 700); text(`${eaten} / 8`, 856, 48, 28, '#f2b64f', 'right', 700);
      rect(ox - 12, oy - 12, 456, 456, 4, '#284c36');
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) rect(ox + x * cell, oy + y * cell, cell - 1, cell - 1, 1, (x + y) % 2 ? '#183b2d' : '#1c412f');
      snake.forEach((s, i) => rect(ox + s.x * cell + 2, oy + s.y * cell + 2, cell - 4, cell - 4, 4, i ? '#83b85e' : '#cde89d'));
      const h = snake[0]; rect(ox + h.x * cell + 8, oy + h.y * cell + 6, 4, 4, 0, '#24422d'); rect(ox + h.x * cell + 17, oy + h.y * cell + 6, 4, 4, 0, '#24422d');
      rect(ox + food.x * cell + 4, oy + food.y * cell + 5, 20, 19, 6, '#f0a347'); rect(ox + food.x * cell + 13, oy + food.y * cell + 1, 5, 7, 1, '#bbd86f');
      text('收集果实，避开边缘和自己的尾巴', 450, 585, 19, '#8bb89b', 'center');
    }, snapshot() { return { snake: snake.map(s => ({ ...s })), food: { ...food }, dir: { ...dir }, eaten, done }; }
  };
}

function breakerGame(k) {
  const { ctx, rect, text, circle, finish, status, keys } = k;
  let paddle = 450, target = 450, ball, launched = false, lives = 3, score = 0, elapsed = 0, done = false;
  const bricks = Array.from({ length: 24 }, (_, i) => ({ x: 100 + i % 8 * 88, y: 119 + Math.floor(i / 8) * 37, w: 78, h: 25, alive: true }));
  function reset() { ball = { x: paddle, y: 513, vx: 180, vy: -340 }; launched = false; }
  reset();
  function launch() { if (!done) launched = true; }
  return {
    update(dt) {
      if (done) return; elapsed += dt; if (elapsed >= 120) { done = true; finish(score, `时间到，击碎 ${score / 50} 块砖`); return; } if (keys.has('ArrowLeft')) target -= 650 * dt; if (keys.has('ArrowRight')) target += 650 * dt; target = Math.max(145, Math.min(755, target)); paddle += (target - paddle) * Math.min(1, dt * 18);
      if (!launched) { ball.x = paddle; return; }
      const old = { x: ball.x, y: ball.y }; ball.x += ball.vx * dt; ball.y += ball.vy * dt;
      if (ball.x < 85) { ball.x = 85; ball.vx = Math.abs(ball.vx); } if (ball.x > 815) { ball.x = 815; ball.vx = -Math.abs(ball.vx); } if (ball.y < 86) { ball.y = 86; ball.vy = Math.abs(ball.vy); }
      if (ball.vy > 0 && old.y <= 523 && ball.y >= 523 && Math.abs(ball.x - paddle) <= 71) { ball.y = 523; const offset = (ball.x - paddle) / 71, direction = Math.sign(ball.vx) || 1; ball.vx = Math.abs(offset * 310) < 90 ? direction * 90 : offset * 310; ball.vy = -Math.sqrt(370 ** 2 - ball.vx ** 2); }
      for (const b of bricks) if (b.alive && ball.x + 8 > b.x && ball.x - 8 < b.x + b.w && ball.y + 8 > b.y && ball.y - 8 < b.y + b.h) { b.alive = false; score += 50; if (old.y + 8 <= b.y || old.y - 8 >= b.y + b.h) ball.vy *= -1; else ball.vx *= -1; status(`击碎 ${score / 50} / 24 块折光砖`); break; }
      if (bricks.every(b => !b.alive)) { done = true; finish(score + lives * 100, '折光砖全部清除'); }
      if (ball.y > 596) { lives--; if (!lives) { done = true; finish(score, `本局击碎 ${score / 50} 块砖`); } else { reset(); status(`还剩 ${lives} 颗球，空格或点“发球”继续`); } }
    },
    key(code) { if (['Space', 'Enter'].includes(code)) launch(); }, action(name) { if (name === 'launch') launch(); if (name === 'left') target -= 65; if (name === 'right') target += 65; },
    pointer(type, p) { if (type === 'down' || type === 'move') target = p.x; if (type === 'down') launch(); },
    draw() {
      rect(0, 0, 900, 620, 0, '#161a36'); text('PRISM BREAKER', 44, 45, 24, '#eee6ff', 'left', 700); text(`● ${lives}   ${Math.ceil(120 - elapsed)}s   /   ${score}`, 856, 45, 22, '#a995e0', 'right');
      rect(75, 76, 750, 508, 10, '#202448', '#3d416b');
      bricks.forEach((b, i) => { if (b.alive) { rect(b.x, b.y, b.w, b.h, 5, ['#b293ed', '#7ba7eb', '#7cd6ce'][Math.floor(i / 8)]); rect(b.x + 6, b.y + 4, b.w - 12, 3, 1, '#ffffff55'); } });
      ctx.strokeStyle = '#626b9c44'; for (let y = 275; y < 530; y += 40) { ctx.beginPath(); ctx.moveTo(90, y); ctx.lineTo(810, y); ctx.stroke(); }
      rect(paddle - 64, 533, 128, 12, 6, '#eee8fb'); circle(ball.x, ball.y, 8, '#ffe39a');
      if (!launched && !done) text('点击画面 / 空格发球', 450, 380, 23, '#aaa9d1', 'center');
    }, snapshot() { return { ball: { ...ball }, paddle, launched, lives, score, done, remaining: bricks.filter(b => b.alive).length }; }
  };
}

function rhythmGame(k) {
  const { rect, text, circle, finish, status } = k;
  const notes = Array.from({ length: 24 }, (_, i) => ({ lane: [0, 2, 1, 3, 0, 1, 3, 2][i % 8], time: 2 + i * .54, hit: false, missed: false }));
  let clock = 0, score = 0, combo = 0, best = 0, judgement = '跟随节拍', flash = [0, 0, 0, 0], done = false;
  function tap(lane) {
    if (done) return; flash[lane] = .18;
    const note = notes.find(n => n.lane === lane && !n.hit && !n.missed && Math.abs(n.time - clock) <= .19);
    if (!note) { combo = 0; judgement = '稍早或稍晚'; return; }
    note.hit = true; const perfect = Math.abs(note.time - clock) <= .085; score += perfect ? 100 : 60; combo++; best = Math.max(best, combo); judgement = perfect ? 'PERFECT' : 'GOOD'; status(`${judgement}，连续 ${combo} 次`);
  }
  return {
    update(dt) { if (done) return; clock += dt; flash = flash.map(v => Math.max(0, v - dt)); for (const n of notes) if (!n.hit && !n.missed && clock > n.time + .19) { n.missed = true; combo = 0; judgement = 'MISS'; } if (clock > notes.at(-1).time + .8) { done = true; finish(score, `击中 ${notes.filter(n => n.hit).length} / 24，最高连击 ${best}`); } },
    key(code) { const lane = ['KeyD', 'KeyF', 'KeyJ', 'KeyK'].indexOf(code); if (lane >= 0) tap(lane); }, action(name) { tap(Number(name)); },
    pointer(type, p) { if (type === 'down' && p.x >= 190 && p.x <= 710) tap(Math.min(3, Math.floor((p.x - 190) / 130))); },
    draw() {
      rect(0, 0, 900, 620, 0, '#f4f1e9'); text('PULSE / 24', 45, 46, 27, '#2c2c2b', 'left', 800); text(String(score).padStart(4, '0'), 855, 46, 30, '#ca4d39', 'right', 800);
      for (let lane = 0; lane < 4; lane++) { rect(190 + lane * 130, 90, 126, 470, 0, flash[lane] ? '#edb2a1' : lane % 2 ? '#e3dfd6' : '#e9e5dd'); text(['D', 'F', 'J', 'K'][lane], 253 + lane * 130, 538, 25, '#2c2c2b', 'center', 700); }
      rect(185, 478, 525, 6, 0, '#ca4d39');
      notes.forEach(n => { const y = 478 - (n.time - clock) * 245; if (!n.hit && !n.missed && y > 86 && y < 510) rect(202 + n.lane * 130, y - 12, 102, 24, 4, '#2d302c'); });
      text(judgement, 450, 590, 21, '#ad6453', 'center', 700); if (combo > 1) text(`${combo}×`, 105, 330, 36, '#ca4d39', 'center', 700);
    }, snapshot() { return { clock, notes: notes.map(n => ({ ...n })), score, done }; }
  };
}

function sudokuGame(k) {
  const { rect, text, finish, status } = k;
  const fixed = [1, 0, 0, 4, 0, 4, 1, 0, 2, 0, 0, 3, 0, 3, 2, 0];
  let cells = [...fixed], chosen = 1, mistakes = 0, done = false, elapsed = 0;
  function conflict(index, value) { if (!value) return false; const r = Math.floor(index / 4), c = index % 4; return cells.some((v, i) => i !== index && v === value && (Math.floor(i / 4) === r || i % 4 === c || Math.floor(Math.floor(i / 4) / 2) === Math.floor(r / 2) && Math.floor(i % 4 / 2) === Math.floor(c / 2))); }
  function put(value) { if (done || fixed[chosen]) return; cells[chosen] = value; const bad = conflict(chosen, value); if (bad) mistakes++; status(bad ? '这个数字与同一行、列或宫冲突' : `第 ${Math.floor(chosen / 4) + 1} 行、第 ${chosen % 4 + 1} 列：${value || '空白'}`); if (cells.every(Boolean) && cells.every((v, i) => !conflict(i, v))) { done = true; finish(Math.max(100, 1200 - mistakes * 50 - Math.floor(elapsed)), '四方数独完成'); } }
  return {
    update(dt) { if (!done) elapsed += dt; },
    key(code) { if (code === 'ArrowLeft') chosen = Math.max(0, chosen - 1); if (code === 'ArrowRight') chosen = Math.min(15, chosen + 1); if (code === 'ArrowUp') chosen = Math.max(0, chosen - 4); if (code === 'ArrowDown') chosen = Math.min(15, chosen + 4); if (/^(Digit|Numpad)[1-4]$/.test(code)) put(Number(code.at(-1))); if (['Backspace', 'Delete', 'Digit0'].includes(code)) put(0); }, action(name) { put(Number(name)); },
    pointer(type, p) { if (type !== 'down') return; const c = Math.floor((p.x - 250) / 100), r = Math.floor((p.y - 105) / 100); if (c >= 0 && c < 4 && r >= 0 && r < 4) { chosen = r * 4 + c; status(fixed[chosen] ? '这是已给出的数字' : '选择下方的数字 1–4'); } },
    draw() {
      rect(0, 0, 900, 620, 0, '#f4f0e5'); text('FOUR BY FOUR', 44, 47, 26, '#31516e', 'left', 700); text('1 · 2 · 3 · 4', 856, 47, 21, '#8999a4', 'right');
      rect(241, 96, 418, 418, 6, '#385b76');
      cells.forEach((value, i) => { const x = 250 + i % 4 * 100, y = 105 + Math.floor(i / 4) * 100; rect(x + 2, y + 2, 96, 96, 1, i === chosen ? '#d7e7ed' : fixed[i] ? '#eae7dc' : '#fffdf6'); if (value) text(value, x + 50, y + 52, 43, conflict(i, value) ? '#bd5c4c' : fixed[i] ? '#344c62' : '#4b8aa6', 'center', fixed[i] ? 700 : 400); });
      rect(448, 105, 4, 400, 0, '#385b76'); rect(250, 303, 400, 4, 0, '#385b76'); text('每行、每列、每个 2×2 宫内，1–4 各出现一次', 450, 565, 19, '#6e8491', 'center');
    }, snapshot() { return { cells: [...cells], chosen, done, mistakes }; }
  };
}

function hoopsGame(k) {
  const { ctx, rect, text, circle, finish, status } = k;
  const origin = { x: 170, y: 500 }, rim = { x: 650, y: 245 }, gravity = 780;
  let angle = 55, power = 800, ball = { ...origin }, flying = false, dragging = false, attempts = 0, made = 0, scored = false, done = false, trail = [];
  function aim(p) { const dx = Math.max(20, p.x - origin.x), dy = Math.max(30, origin.y - p.y); angle = Math.max(25, Math.min(78, Math.atan2(dy, dx) * 180 / Math.PI)); power = Math.max(570, Math.min(1050, Math.hypot(dx, dy) * 1.75)); }
  function shoot() { if (flying || done) return; const a = angle * Math.PI / 180; ball = { ...origin, vx: Math.cos(a) * power, vy: -Math.sin(a) * power }; flying = true; scored = false; attempts++; trail = []; }
  return {
    update(dt) {
      if (!flying || done) return; const old = { ...ball }; ball.vy += gravity * dt; ball.x += ball.vx * dt; ball.y += ball.vy * dt; trail.push({ x: ball.x, y: ball.y }); if (trail.length > 24) trail.shift();
      if (!scored && ball.vy > 0 && old.y < rim.y && ball.y >= rim.y) { const x = old.x + (ball.x - old.x) * (rim.y - old.y) / (ball.y - old.y); if (Math.abs(x - rim.x) < 34) { scored = true; made++; status(`命中！${made} / ${attempts}`); } }
      if (ball.x > 875 || ball.y > 585 || ball.y < -250) { flying = false; ball = { ...origin }; if (attempts === 5) { done = true; finish(made * 200, `五次投篮，命中 ${made} 球`); } else if (!scored) status(`第 ${attempts} 球未进，调整角度与力度`); }
    },
    key(code) { if (flying || done) return; if (code === 'ArrowLeft') angle = Math.min(78, angle + 2); if (code === 'ArrowRight') angle = Math.max(25, angle - 2); if (code === 'ArrowUp') power = Math.min(1050, power + 20); if (code === 'ArrowDown') power = Math.max(570, power - 20); if (['Space', 'Enter'].includes(code)) shoot(); },
    action(name) { if (name === 'shoot') shoot(); else this.key(name); },
    pointer(type, p) { if (flying || done) return; if (type === 'down') { dragging = true; aim(p); } if (type === 'move' && dragging) aim(p); if (type === 'up' && dragging) { dragging = false; shoot(); } if (type === 'cancel') dragging = false; },
    draw() {
      rect(0, 0, 900, 620, 0, '#dceaf1'); text('ARC HOOPS', 44, 47, 27, '#34516a', 'left', 800); text(`${made} 命中 / ${attempts} 出手`, 856, 47, 22, '#5c7c91', 'right');
      rect(0, 550, 900, 70, 0, '#c98552'); rect(40, 548, 820, 4, 0, '#fff4de'); rect(710, 145, 8, 405, 2, '#6b8290'); rect(700, 165, 12, 115, 2, '#f9fcfc'); rect(685, 201, 22, 41, 0, '#d6e4e9', '#c2653e');
      ctx.strokeStyle = '#f7fcfc'; ctx.lineWidth = 3; for (let i = 0; i <= 4; i++) { ctx.beginPath(); ctx.moveTo(610 + i * 20, 248); ctx.lineTo(627 + i * 12, 306); ctx.stroke(); } rect(609, 242, 83, 7, 3, '#d75b31');
      if (!flying && !done) { const a = angle * Math.PI / 180; for (let i = 1; i <= 18; i++) { const t = i * .06, x = origin.x + Math.cos(a) * power * t, y = origin.y - Math.sin(a) * power * t + gravity * t * t / 2; if (x < 880 && y > 80 && y < 550) circle(x, y, 3, '#90b0c0'); } }
      trail.forEach((p, i) => circle(p.x, p.y, 3 + i / 9, `rgba(218,117,49,${i / 60})`)); circle(ball.x, ball.y, 17, '#df8138'); ctx.strokeStyle = '#8b4b2f'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(ball.x - 16, ball.y); ctx.lineTo(ball.x + 16, ball.y); ctx.moveTo(ball.x, ball.y - 16); ctx.lineTo(ball.x, ball.y + 16); ctx.stroke();
      text(`角度 ${Math.round(angle)}°   力度 ${Math.round(power)}`, 45, 590, 19, '#fff2d5'); text('拖向篮筐，松手投篮', 855, 590, 19, '#fff2d5', 'right');
    }, snapshot() { return { angle, power, ball: { ...ball }, flying, attempts, made, done }; }
  };
}

const entries = [
  { id: 'memory-tide', title: '潮汐记忆', desc: '翻开十二张卡片，配对六种海边图案。', controls: '点按翻牌；方向键选择，空格或回车翻牌。', estimatedDuration: '约 1–2 分钟', theme: ['#e9f2ee', '#2d5b57', '#58958c'], game: memoryGame, buttons: [['←', 'ArrowLeft'], ['↑', 'ArrowUp'], ['↓', 'ArrowDown'], ['→', 'ArrowRight'], ['翻牌', 'Enter']] },
  { id: 'pixel-orchard', title: '像素果园', desc: '引导小蛇收集八颗果实，避开墙壁和自己的尾巴。', controls: '方向键或下方方向按钮；也可点向蛇头四周转弯。', estimatedDuration: '约 1 分钟', theme: ['#102b23', '#cfe7a1', '#83b85e'], game: snakeGame, buttons: [['←', 'ArrowLeft'], ['↑', 'ArrowUp'], ['↓', 'ArrowDown'], ['→', 'ArrowRight']] },
  { id: 'prism-breaker', title: '折光弹球', desc: '在两分钟内移动挡板反弹小球，用三次机会清除二十四块砖。', controls: '拖动移动挡板，点击发球；左右键移动，空格发球。', estimatedDuration: '约 2 分钟', theme: ['#161a36', '#eee6ff', '#b293ed'], game: breakerGame, buttons: [['左移', 'left'], ['发球', 'launch'], ['右移', 'right']] },
  { id: 'pulse-lanes', title: '拍点', desc: '在音符抵达红线时点按对应轨道，完成二十四次视觉节拍。', controls: '点按四条轨道或下方按钮；键盘 D / F / J / K。无需声音。', estimatedDuration: '约 15 秒', theme: ['#f4f1e9', '#2c2c2b', '#ca4d39'], game: rhythmGame, buttons: [['D', '0'], ['F', '1'], ['J', '2'], ['K', '3']] },
  { id: 'mini-sudoku', title: '四方数独', desc: '在四行四列中填入数字，让每行、每列及每宫各有一个 1–4。', controls: '点选格子后点数字；方向键选择，1–4 输入，退格清除。', estimatedDuration: '约 1–2 分钟', theme: ['#f4f0e5', '#31516e', '#4b8aa6'], game: sudokuGame, buttons: [['1', '1'], ['2', '2'], ['3', '3'], ['4', '4'], ['清除', '0']] },
  { id: 'arc-hoops', title: '弧线投篮', desc: '调整抛物线的角度与力度，在五次机会中尽可能多投进篮筐。', controls: '向篮筐方向拖拽并松手；左右键调角度，上下键调力度，空格投篮。', estimatedDuration: '约 30–60 秒', theme: ['#dceaf1', '#34516a', '#df8138'], game: hoopsGame, buttons: [['角度 +', 'ArrowLeft'], ['角度 −', 'ArrowRight'], ['力度 −', 'ArrowDown'], ['力度 +', 'ArrowUp'], ['投篮', 'shoot']] }
];

function runtime(createGame, entry) {
  'use strict';
  const embedded = window.parent !== window;
  document.documentElement.classList.toggle('embedded', embedded);
  const $ = id => document.getElementById(id), canvas = $('canvas'), ctx = canvas.getContext('2d'), keys = new Set(), stage = $('stage');
  let game = null, active = false, reported = false, raf = 0, previous = 0, pointerDown = false, resizeObserver = null;
  const listeners = new AbortController();
  const kit = {
    ctx, keys, random: Math.random,
    rect(x, y, w, h, radius, fill, stroke) { ctx.beginPath(); ctx.roundRect(x, y, w, h, radius); if (fill) { ctx.fillStyle = fill; ctx.fill(); } if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 4; ctx.stroke(); } },
    circle(x, y, radius, fill) { ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fillStyle = fill; ctx.fill(); },
    text(value, x, y, size, color, align = 'left', weight = 500) { ctx.font = `${weight} ${size}px -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif`; ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = 'middle'; ctx.fillText(String(value), x, y); },
    status(value) { $('status').textContent = value; },
    finish(score, label) {
      if (!active) return; active = false; cancelAnimationFrame(raf); raf = 0; keys.clear(); $('end').disabled = true; $('restart').disabled = false; $('status').textContent = `${label} · ${score} 分`; canvas.setAttribute('aria-label', `${entry.controls} 本局结果：${label}，${score} 分。`);
      // The injected SDK owns input/session collection. One document reports at most one terminal result.
      if (!reported) { reported = true; try { window.funtrack?.complete?.({ score, label }); } catch {} }
    }
  };
  function fitCanvas() { if (!embedded) return; const width = Math.max(0, Math.min(stage.clientWidth, stage.clientHeight * 900 / 620)); canvas.style.width = width + 'px'; canvas.style.height = width * 620 / 900 + 'px'; }
  function render() { game?.draw(); }
  function frame(now) { raf = 0; if (!active || document.hidden) { previous = 0; return; } const dt = previous ? Math.min(.04, (now - previous) / 1000) : 0; previous = now; game.update(dt); render(); if (active) raf = requestAnimationFrame(frame); }
  function start() {
    cancelAnimationFrame(raf); game?.destroy?.(); keys.clear(); previous = 0; pointerDown = false; active = true;
    game = createGame(kit); $('cover').hidden = true; $('start-layer').hidden = true; canvas.hidden = false; $('controls').hidden = false; $('restart').disabled = false; $('end').disabled = false; $('status').textContent = '游戏中'; canvas.setAttribute('aria-label', entry.controls); fitCanvas(); canvas.focus({ preventScroll: true }); render(); raf = requestAnimationFrame(frame);
  }
  function stop() { if (!active) return; active = false; cancelAnimationFrame(raf); raf = 0; previous = 0; pointerDown = false; keys.clear(); game?.destroy?.(); $('end').disabled = true; $('status').textContent = '本局已结束'; }
  function listen(node, type, fn, options = {}) { node.addEventListener(type, fn, { ...options, signal: listeners.signal }); }
  if (embedded) { if (window.ResizeObserver) { resizeObserver = new window.ResizeObserver(fitCanvas); resizeObserver.observe(stage); } listen(window, 'resize', fitCanvas); fitCanvas(); }
  listen($('start'), 'click', start); listen($('restart'), 'click', start); listen($('end'), 'click', stop);
  for (const button of document.querySelectorAll('[data-action]')) listen(button, 'click', () => { if (!active) return; game.action?.(button.dataset.action); render(); canvas.focus({ preventScroll: true }); });
  listen(canvas, 'keydown', event => { if (!active || event.ctrlKey || event.metaKey || event.altKey) return; const handled = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space', 'Enter', 'Backspace', 'Delete', 'KeyD', 'KeyF', 'KeyJ', 'KeyK'].includes(event.code) || /^(Digit|Numpad)[0-4]$/.test(event.code); if (!handled) return; event.preventDefault(); keys.add(event.code); if (!event.repeat) game.key?.(event.code); render(); });
  listen(window, 'keyup', event => keys.delete(event.code)); listen(window, 'blur', () => { keys.clear(); pointerDown = false; game?.pointer?.('cancel', { x: 0, y: 0 }); });
  function point(event) { const bounds = canvas.getBoundingClientRect(); return { x: (event.clientX - bounds.left) * 900 / bounds.width, y: (event.clientY - bounds.top) * 620 / bounds.height }; }
  listen(canvas, 'pointerdown', event => { if (!active || event.button !== 0) return; pointerDown = true; canvas.focus({ preventScroll: true }); canvas.setPointerCapture?.(event.pointerId); game.pointer?.('down', point(event)); render(); });
  listen(canvas, 'pointermove', event => { if (!active || event.pointerType === 'touch' && !pointerDown) return; game.pointer?.('move', point(event)); render(); });
  listen(canvas, 'pointerup', event => { if (!active || !pointerDown) return; pointerDown = false; game.pointer?.('up', point(event)); render(); });
  listen(canvas, 'pointercancel', () => { pointerDown = false; game?.pointer?.('cancel', { x: 0, y: 0 }); });
  listen(document, 'visibilitychange', () => { keys.clear(); previous = 0; if (document.hidden) { pointerDown = false; game?.pointer?.('cancel', { x: 0, y: 0 }); cancelAnimationFrame(raf); raf = 0; } else if (active && !raf) raf = requestAnimationFrame(frame); });
  listen(window, 'pagehide', event => { stop(); if (!event.persisted) { game?.destroy?.(); game = null; resizeObserver?.disconnect(); listeners.abort(); canvas.width = 0; canvas.height = 0; } });
}

function coverSVG(entry) {
  const [bg, ink, accent] = entry.theme;
  let art = '';
  if (entry.id === 'memory-tide') art = Array.from({ length: 6 }, (_, i) => `<g transform="translate(${550 + i % 3 * 180} ${140 + Math.floor(i / 3) * 220}) rotate(${i % 2 ? 5 : -5} 72 88)"><rect width="145" height="175" rx="22" fill="${i % 3 === 0 ? '#fffaf0' : accent}"/><circle cx="72" cy="77" r="32" fill="${i % 3 === 0 ? '#e7ad60' : '#cce6d6'}"/><path d="M48 126q24-16 48 0" fill="none" stroke="${i % 3 === 0 ? accent : '#cce6d6'}" stroke-width="6"/></g>`).join('');
  if (entry.id === 'pixel-orchard') { art = '<path d="M620 230H940V480H730V365H840" fill="none" stroke="#83b85e" stroke-width="70" stroke-linejoin="round"/>'; art += '<rect x="580" y="195" width="80" height="70" rx="12" fill="#cfe7a1"/><rect x="592" y="210" width="10" height="10" fill="#24422d"/><rect x="618" y="210" width="10" height="10" fill="#24422d"/><rect x="1000" y="155" width="55" height="56" rx="15" fill="#f0a347"/><rect x="1027" y="140" width="13" height="22" rx="4" fill="#bbd86f"/>'; }
  if (entry.id === 'prism-breaker') { art = Array.from({ length: 15 }, (_, i) => `<rect x="${560 + i % 5 * 105}" y="${145 + Math.floor(i / 5) * 55}" width="92" height="37" rx="7" fill="${['#b293ed', '#7ba7eb', '#7cd6ce'][Math.floor(i / 5)]}"/>`).join(''); art += '<path d="M650 505L830 345L1010 520" fill="none" stroke="#8486b2" stroke-width="3" stroke-dasharray="8 12"/><circle cx="830" cy="345" r="18" fill="#ffe39a"/><rect x="865" y="530" width="175" height="18" rx="9" fill="#eee8fb"/>'; }
  if (entry.id === 'pulse-lanes') { art = Array.from({ length: 4 }, (_, i) => `<rect x="${590 + i * 120}" y="115" width="110" height="450" fill="${i % 2 ? '#dfdad1' : '#e8e3da'}"/><rect x="${599 + i * 120}" y="${[335, 185, 400, 265][i]}" width="92" height="27" rx="4" fill="#2d302c"/>`).join(''); art += '<rect x="580" y="485" width="490" height="7" fill="#ca4d39"/>'; }
  if (entry.id === 'mini-sudoku') { art = '<rect x="625" y="120" width="420" height="420" rx="8" fill="#385b76"/>'; art += Array.from({ length: 16 }, (_, i) => `<rect x="${635 + i % 4 * 100}" y="${130 + Math.floor(i / 4) * 100}" width="96" height="96" fill="${[1, 6, 9, 15].includes(i) ? '#d7e7ed' : '#fffdf6'}"/>${[0, 3, 5, 6, 8, 11, 13, 14].includes(i) ? `<text x="${683 + i % 4 * 100}" y="${193 + Math.floor(i / 4) * 100}" font-size="48" text-anchor="middle" fill="#31516e">${[1, 2, 3, 4, 3, 4, 1, 2, 2, 1, 4, 3, 4, 3, 2, 1][i]}</text>` : ''}`).join(''); art += '<rect x="831" y="130" width="4" height="396" fill="#385b76"/><rect x="635" y="326" width="396" height="4" fill="#385b76"/>'; }
  if (entry.id === 'arc-hoops') art = '<path d="M540 500Q700 20 965 300" fill="none" stroke="#94b4c4" stroke-width="5" stroke-dasharray="5 17"/><rect x="1080" y="150" width="9" height="420" fill="#6b8290"/><rect x="1055" y="175" width="18" height="125" fill="#fff"/><path d="M925 304L945 370H1005L1025 304M950 304L970 370M975 304V370M1000 304L980 370" fill="none" stroke="#fff" stroke-width="4"/><rect x="920" y="295" width="115" height="10" rx="5" fill="#d75b31"/><circle cx="710" cy="226" r="42" fill="#df8138"/><path d="M670 226H750M710 186V266" stroke="#945031" stroke-width="4"/><path d="M490 570H1120" stroke="#c98552" stroke-width="12"/>';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="750" viewBox="0 0 1200 750"><rect width="1200" height="750" fill="${bg}"/><g font-family="Arial,PingFang SC,sans-serif">${art}<text x="70" y="110" font-size="18" letter-spacing="4" fill="${ink}" opacity=".62">FUNTRACK / DEMO</text><text x="70" y="310" font-size="56" font-weight="700" fill="${ink}">${entry.title}</text><rect x="74" y="355" width="64" height="6" rx="3" fill="${accent}"/><text x="70" y="653" font-size="20" fill="${ink}" opacity=".65">${entry.estimatedDuration} · 演示作品</text></g></svg>`;
}

function htmlFor(entry, cover) {
  const publicEntry = { controls: entry.controls };
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="referrer" content="no-referrer"><title>${entry.title} · TryMe 演示作品</title><style>
*{box-sizing:border-box}body{margin:0;background:#fafaf7;color:#30332b;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif}button{font:inherit;cursor:pointer;min-height:44px;border:1px solid #d4d8d0;border-radius:8px;background:#fff;color:#39453a;padding:10px 16px}button:hover:not(:disabled){background:#eff3ec}button:focus-visible,canvas:focus-visible{outline:3px solid #749e9a;outline-offset:3px}button:disabled{opacity:.4;cursor:default}[hidden]{display:none!important}main{max-width:960px;margin:auto;padding:20px}header{margin-bottom:14px}h1{font-size:22px;letter-spacing:-.5px;margin:0}.demo{font-size:11px;color:#949b90;margin:6px 0 10px}.instructions{font-size:13px;line-height:1.7;margin:0;color:#6f7b6a}.stage{position:relative;aspect-ratio:900/620;border:1px solid #ddd;border-radius:12px;overflow:hidden;background:${entry.theme[0]}}.stage img,.stage canvas{width:100%;height:100%;display:block;object-fit:contain}.stage canvas{touch-action:${['memory-tide', 'pulse-lanes', 'mini-sudoku'].includes(entry.id) ? 'pan-y' : 'none'}}.layer{position:absolute;inset:0;display:grid;place-items:center;background:#ffffff16}.primary{background:#344d45;color:#fff;border-color:#344d45;padding:13px 25px}.primary:hover:not(:disabled){background:#426353}.controls{display:flex;justify-content:center;flex-wrap:wrap;gap:8px;margin:14px 0}.controls button{min-width:54px}.toolbar{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:14px}.actions{display:flex;gap:8px;flex-shrink:0}.status{font-size:13px;line-height:1.7;min-height:22px;margin:0;color:#64745f}canvas:focus-visible{outline-offset:-4px}@media(max-width:540px){main{padding:13px 10px}h1{font-size:20px}.stage{border-radius:8px}.toolbar{align-items:flex-start;flex-direction:column}.actions{align-self:flex-end}button{padding:9px 12px}.controls{gap:6px}.controls button{min-width:48px;padding:9px 11px}.instructions{font-size:12px}}.embedded,.embedded body{height:100%;overflow:hidden}.embedded main{height:100vh;height:100dvh;max-width:none;padding:8px 10px;display:flex;flex-direction:column;gap:6px}.embedded header{margin:0;flex:none}.embedded h1,.embedded .demo{display:none}.embedded .instructions{font-size:11px;line-height:1.35}.embedded .stage{flex:1;min-height:0;aspect-ratio:auto;display:flex;align-items:center;justify-content:center}.embedded .stage img{position:absolute;inset:0;object-fit:contain}.embedded .stage canvas{flex:none;max-width:100%;max-height:100%}.embedded .controls{flex:none;margin:0;gap:6px}.embedded .controls button{min-width:44px;min-height:44px;padding:8px 10px;font-size:12px}.embedded .toolbar{flex:none;flex-direction:row;align-items:center;min-height:44px;margin:0;gap:8px}.embedded .status{font-size:11px;line-height:1.35;max-height:44px;overflow-y:auto;min-width:0}.embedded .actions{align-self:auto;gap:6px}.embedded .actions button{min-height:44px;font-size:11px;padding:8px 10px}@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto}}
</style></head><body><main><header><h1>${entry.title}</h1><p class="demo">TryMe 演示作品</p><p class="instructions">${entry.controls}</p></header><section id="stage" class="stage" aria-label="游戏画面"><img id="cover" src="data:image/png;base64,${cover}" alt="${entry.title}封面"><canvas id="canvas" width="900" height="620" tabindex="0" aria-label="${entry.controls}" hidden></canvas><div id="start-layer" class="layer"><button id="start" class="primary" type="button">开始游戏</button></div></section><div id="controls" class="controls" hidden>${entry.buttons.map(([label, action]) => `<button type="button" data-action="${action}">${label}</button>`).join('')}</div><div class="toolbar"><p id="status" class="status" role="status" aria-live="polite"></p><div class="actions"><button id="restart" type="button" disabled>重新开始</button><button id="end" type="button" disabled>结束本局</button></div></div><noscript>请启用 JavaScript 后游玩。</noscript></main><script>(${runtime.toString()})(${entry.game.toString()},${JSON.stringify(publicEntry)});</script></body></html>`;
}

const existing = [
  { id: 'salt-run', name: 'Salt Run · 演示', desc: '跳跃躲过障碍，坚持十八秒。', html: '/examples/salt-run.html', cover: '/examples/salt-run.jpg', controls: '空格、↑ 或点击跳跃。', estimatedDuration: '约 18 秒', demo: true },
  { id: 'orbit', name: 'Orbit · 演示', desc: '移动光球，依次接触六颗星点。', html: '/examples/orbit.html', cover: '/examples/orbit.png', controls: '鼠标、触控或方向键移动。', estimatedDuration: '约 30 秒', demo: true },
  { id: 'tiles', name: '点亮九宫格 · 演示', desc: '翻转相邻方格，让九格同时亮起。', html: '/examples/tiles.html', cover: '/examples/tiles.png', controls: '点击方格，或方向键选择后空格翻转。', estimatedDuration: '约 30 秒', demo: true }
];

for (const entry of entries) {
  const png = await sharp(Buffer.from(coverSVG(entry))).png().toBuffer();
  const html = htmlFor(entry, png.toString('base64'));
  assert(Buffer.byteLength(html) < 1_000_000, `${entry.id}: HTML exceeds 1 MB`);
  assert(png.length < 2_000_000, `${entry.id}: cover exceeds 2 MB`);
  assert(!/<(?:script|link)\b[^>]*(?:src|href)\s*=|\b(?:fetch|XMLHttpRequest|WebSocket|EventSource)\s*\(/i.test(html), `${entry.id}: external dependency`);
  new vm.Script(html.match(/<script>([\s\S]*?)<\/script>/)[1], { filename: entry.id });
  await writeFile(path.join(out, entry.id + '.html'), html);
  await writeFile(path.join(out, entry.id + '.png'), png);
  console.log(`${entry.id}: HTML ${Buffer.byteLength(html)} bytes; PNG ${png.length} bytes`);
}
const catalog = [...existing, ...entries.map(e => ({ id: e.id, name: e.title + ' · 演示', desc: e.desc, html: '/examples/' + e.id + '.html', cover: '/examples/' + e.id + '.png', controls: e.controls, estimatedDuration: e.estimatedDuration, demo: true }))];
await writeFile(path.join(out, 'catalog.json'), JSON.stringify(catalog, null, 2) + '\n');
await writeFile(path.join(out, 'more.html'), `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>TryMe 演示游戏</title><style>body{font:15px -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;background:#f7f7f2;color:#34413a;max-width:1100px;margin:auto;padding:32px}h1{font-size:25px}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:22px}article{background:white;border:1px solid #ddd;border-radius:10px;overflow:hidden}img{width:100%;aspect-ratio:8/5;object-fit:contain;background:#efefea;display:block}section{padding:16px}h2{margin:0 0 9px;font-size:19px}p{font-size:13px;line-height:1.7;color:#687469}a{color:#375f55}nav{display:flex;gap:16px;margin-top:14px}small{display:block;margin:12px 0 25px;color:#879180}</style><h1>演示游戏</h1><small>用于体验与上传测试，不代表外部创作者作品。</small><main>${catalog.map(e => `<article><a href="${e.html}"><img src="${e.cover}" alt="${e.name}"></a><section><h2>${e.name}</h2><p>${e.desc}</p><nav><a href="${e.html}">打开游玩</a><a href="${e.html}" download>下载 HTML</a><a href="${e.cover}" download>下载封面</a></nav></section></article>`).join('')}</main></html>`);

function testKit() {
  let seed = 12345; const results = [];
  const ctx = new Proxy({}, { get: (o, key) => o[key] ?? (() => {}), set: (o, key, value) => (o[key] = value, true) });
  return { ctx, keys: new Set(), results, rect() {}, text() {}, circle() {}, status() {}, random() { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; }, finish(score, label) { results.push({ score, label }); } };
}
function verifyGames() {
  const mk = fn => { const kit = testKit(), game = fn(kit); game.draw(); return { kit, game }; };
  const memory = mk(memoryGame), deck = memory.game.snapshot().deck;
  for (let value = 0; value < 6; value++) for (const i of deck.flatMap((v, i) => v === value ? [i] : [])) memory.game.pointer('down', { x: 160 + i % 4 * 148 + 60, y: 110 + Math.floor(i / 4) * 146 + 50 });
  assert.equal(memory.kit.results.length, 1); assert.equal(memory.kit.results[0].score, 1200);
  const snake = mk(snakeGame); for (let i = 0; i < 200 && !snake.kit.results.length; i++) snake.game.update(.03); assert.equal(snake.kit.results.length, 1); assert.equal(snake.game.snapshot().done, true);
  const harvest = mk(snakeGame);
  for (let turn = 0; turn < 1000 && !harvest.kit.results.length; turn++) {
    const state = harvest.game.snapshot(), head = state.snake[0], queue = [{ ...head, first: null }], visited = new Set([`${head.x},${head.y}`]); let direction;
    for (let q = 0; q < queue.length; q++) {
      const node = queue[q]; if (node.x === state.food.x && node.y === state.food.y) { direction = node.first; break; }
      for (const [dx, dy, code] of [[1, 0, 'ArrowRight'], [0, 1, 'ArrowDown'], [-1, 0, 'ArrowLeft'], [0, -1, 'ArrowUp']]) {
        const x = node.x + dx, y = node.y + dy, key = `${x},${y}`;
        if (x < 0 || x > 15 || y < 0 || y > 15 || visited.has(key) || state.snake.slice(0, -1).some(s => s.x === x && s.y === y)) continue;
        visited.add(key); queue.push({ x, y, first: node.first || code });
      }
    }
    assert(direction, 'A reachable fruit route must exist'); harvest.game.key(direction); harvest.game.update(.23);
  }
  assert.equal(harvest.game.snapshot().eaten, 8); assert.equal(harvest.kit.results[0].score, 1200);
  const breaker = mk(breakerGame); breaker.game.action('launch');
  for (let frame = 0; frame < 36_000 && !breaker.kit.results.length; frame++) { const state = breaker.game.snapshot(); breaker.game.pointer('move', { x: state.ball.x }); if (!state.launched) breaker.game.action('launch'); breaker.game.update(1 / 120); }
  assert.equal(breaker.kit.results.length, 1); assert.equal(breaker.game.snapshot().remaining, 0, 'Actual ball collisions can clear all 24 bricks');
  const rhythm = mk(rhythmGame); let time = 0; for (const note of rhythm.game.snapshot().notes) { rhythm.game.update(note.time - time); time = note.time; rhythm.game.action(String(note.lane)); } rhythm.game.update(1); assert.equal(rhythm.kit.results[0].score, 2400);
  const sudoku = mk(sudokuGame), solution = [1, 2, 3, 4, 3, 4, 1, 2, 2, 1, 4, 3, 4, 3, 2, 1];
  solution.forEach((value, i) => { sudoku.game.pointer('down', { x: 250 + i % 4 * 100 + 50, y: 105 + Math.floor(i / 4) * 100 + 50 }); sudoku.game.key('Digit' + value); }); assert.equal(sudoku.kit.results.length, 1);
  const hoops = mk(hoopsGame); for (let attempt = 0; attempt < 5; attempt++) { hoops.game.action('shoot'); for (let frame = 0; frame < 600 && hoops.game.snapshot().flying; frame++) hoops.game.update(1 / 120); } assert.equal(hoops.kit.results.length, 1); assert.equal(hoops.game.snapshot().attempts, 5); assert(hoops.game.snapshot().made > 0, 'Default aiming arc must allow a real basket');
  for (const { game, kit } of [memory, snake, breaker, rhythm, sudoku, hoops]) { const count = kit.results.length; game.update(10); game.key('Space'); game.action('shoot'); game.draw(); assert.equal(kit.results.length, count, 'Terminal game cannot complete twice'); }
  console.log('PASS: six actual game factories, natural terminals, memory/sudoku solutions, perfect rhythm, brick collisions, real baskets, single terminal, embedded-only dependencies and size.');
}
verifyGames();

// Exercise the generated inline runtime through its real DOM handlers. This does
// not impersonate browser-trusted input or claim a server event receipt.
async function verifyRuntime() {
  async function load(entry, embedded = false, viewport = { width: 900, height: 620 }) {
    const nodes = {}, raf = new Map(), completions = []; let id = 0, now = 0;
    const context = new Proxy({}, { get: (o, key) => o[key] ?? (() => {}), set: (o, key, value) => (o[key] = value, true) });
    const document = new EventTarget(); document.hidden = false; document.documentElement = { classList: { toggle() {} } };
    class Node extends EventTarget {
      constructor() { super(); this.hidden = false; this.disabled = false; this.textContent = ''; this.dataset = {}; this.style = {}; this.width = 900; this.height = 620; this.clientWidth = viewport.width; this.clientHeight = viewport.height; }
      getContext() { return context; }
      focus() { document.activeElement = this; }
      setAttribute() {}
      setPointerCapture() {}
      getBoundingClientRect() { return { left: 0, top: 0, width: parseFloat(this.style.width) || 900, height: parseFloat(this.style.height) || 620 }; }
    }
    for (const name of ['stage', 'canvas', 'cover', 'start-layer', 'start', 'controls', 'restart', 'end', 'status']) nodes[name] = new Node();
    const buttons = entry.buttons.map(([, action]) => { const node = new Node(); node.dataset.action = action; return node; });
    document.getElementById = id => nodes[id]; document.querySelectorAll = () => buttons;
    const window = new EventTarget(); window.parent = embedded ? {} : window; window.funtrack = { complete: result => completions.push(result) };
    const scope = { document, window, AbortController, console, requestAnimationFrame(callback) { raf.set(++id, callback); return id; }, cancelAnimationFrame(id) { raf.delete(id); } };
    vm.createContext(scope);
    const html = await readFile(path.join(out, entry.id + '.html'), 'utf8');
    vm.runInContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], scope, { filename: entry.id + '.html' });
    const click = name => nodes[name].dispatchEvent(new Event('click'));
    const frame = (ms = 16) => { now += ms; const pending = [...raf.values()]; raf.clear(); pending.forEach(fn => fn(now)); };
    const key = code => { const event = new Event('keydown', { cancelable: true }); Object.assign(event, { code, repeat: false }); nodes.canvas.dispatchEvent(event); const up = new Event('keyup'); up.code = code; window.dispatchEvent(up); };
    const pointer = (x, y) => { const event = new Event('pointerdown'); Object.assign(event, { clientX: x, clientY: y, pointerId: 1, button: 0 }); nodes.canvas.dispatchEvent(event); };
    return { nodes, raf, completions, document, window, click, frame, key, pointer };
  }
  for (const entry of entries) {
    const rt = await load(entry);
    assert.equal(rt.raf.size, 0); assert.equal(rt.completions.length, 0);
    rt.click('start'); assert.equal(rt.raf.size, 1); rt.frame();
    rt.document.hidden = true; rt.document.dispatchEvent(new Event('visibilitychange')); assert.equal(rt.raf.size, 0); rt.frame(120_000); assert.equal(rt.completions.length, 0);
    rt.document.hidden = false; rt.document.dispatchEvent(new Event('visibilitychange')); assert.equal(rt.raf.size, 1); rt.frame();
    rt.click('end'); assert.equal(rt.raf.size, 0); assert.equal(rt.completions.length, 0, 'Manual end is not completion');
    rt.click('restart'); rt.click('restart'); assert.equal(rt.raf.size, 1, 'Restart does not duplicate RAF');
    rt.window.dispatchEvent(new Event('pagehide')); assert.equal(rt.raf.size, 0); assert.equal(rt.nodes.canvas.width, 0);
  }
  const rt = await load(entries.find(entry => entry.id === 'mini-sudoku'));
  const solution = [1, 2, 3, 4, 3, 4, 1, 2, 2, 1, 4, 3, 4, 3, 2, 1];
  for (const button of ['start', 'restart']) {
    rt.click(button);
    solution.forEach((value, i) => { rt.pointer(250 + i % 4 * 100 + 50, 105 + Math.floor(i / 4) * 100 + 50); rt.key('Digit' + value); });
    assert.equal(rt.raf.size, 0); assert.equal(rt.completions.length, 1, 'One document must never report a second SDK completion');
  }
  assert.match(rt.nodes.status.textContent, /四方数独完成/);
  for (const viewport of [{ width: 900, height: 315 }, { width: 370, height: 270 }]) {
    const embedded = await load(entries.find(entry => entry.id === 'mini-sudoku'), true, viewport); embedded.click('start');
    const width = parseFloat(embedded.nodes.canvas.style.width), height = parseFloat(embedded.nodes.canvas.style.height);
    assert(width <= viewport.width && height <= viewport.height); assert(Math.abs(width / height - 900 / 620) < 1e-9, 'Embedded canvas must never stretch');
    solution.forEach((value, i) => { embedded.pointer((250 + i % 4 * 100 + 50) * width / 900, (105 + Math.floor(i / 4) * 100 + 50) * height / 620); embedded.key('Digit' + value); });
    assert.equal(embedded.completions.length, 1, 'Scaled embedded pointer coordinates still select the actual cells');
  }
  console.log('PASS: generated HTML runtime start, manual stop, repeated restart, hidden pause without catch-up, pagehide cleanup, keyboard/pointer Sudoku completion and one SDK result per document.');
}
await verifyRuntime();
