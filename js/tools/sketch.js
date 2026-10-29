// Ferramenta: planta baixa (croqui). Cômodos arrastáveis + paredes soltas, meias paredes, portas e janelas.
// Modos: Selecionar (arrastar/editar), Parede (desenhar parede solta com encaixe em cantos e meios),
// Porta e Janela (tocar numa parede para inserir). Toque numa parede de cômodo para apagá-la (vão aberto).
import { uid } from '../db.js';
import { h, fmt, measureField, arm, confirmDialog } from '../ui.js';
import { roomArea, closingGap, bounds, DIR_ARROWS, DIRS, ROOM_KINDS } from '../geometry.js';
import { loadRooms, heightEditor, newRoomHeights } from './rooms.js';
import {
  getPlan, worldPoints, segments, segLen, openingGeom, renderWalls, distToSeg, snapPoints,
  DOOR_TYPES, WINDOW_TYPES, openingLabels,
} from '../plan.js';

const SNAP = 0.15; // metros: distância para "grudar" na parede de outro cômodo
const GRID = 0.05;
const round = (n) => Math.round(n / GRID) * GRID;

function contentBounds(rooms, plan) {
  const b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const add = (x, y) => {
    b.minX = Math.min(b.minX, x); b.minY = Math.min(b.minY, y);
    b.maxX = Math.max(b.maxX, x); b.maxY = Math.max(b.maxY, y);
  };
  for (const r of rooms) for (const [x, y] of worldPoints(r)) add(x, y);
  for (const w of plan?.walls || []) { add(w.x1, w.y1); add(w.x2, w.y2); }
  if (!Number.isFinite(b.minX)) return { minX: 0, minY: 0, maxX: 10, maxY: 8 };
  return b;
}

function fitView(rooms, plan, w, h, pad = 60) {
  const b = contentBounds(rooms, plan);
  const bw = Math.max(b.maxX - b.minX, 1);
  const bh = Math.max(b.maxY - b.minY, 1);
  const scale = Math.min((w - pad * 2) / bw, (h - pad * 2) / bh, 120);
  return { scale, ox: (w - bw * scale) / 2 - b.minX * scale, oy: (h - bh * scale) / 2 - b.minY * scale };
}

// Adaptador de desenho para o canvas da tela.
function canvasAdapter(g, v, print) {
  const X = (x) => v.ox + x * v.scale;
  const Y = (y) => v.oy + y * v.scale;
  const k = print ? 1.4 : 1;
  const styles = { wall: [3 * k, '#141414', []], half: [1.4 * k, '#141414', []], thin: [1.3 * k, '#141414', []], hair: [0.8 * k, '#64748b', []], hidden: [1.2, '#94a3b8', [6, 5]] };
  return {
    line(x1, y1, x2, y2, st) {
      const [w, c, d] = styles[st];
      g.lineWidth = w; g.strokeStyle = c; g.setLineDash(d); g.lineCap = 'square';
      g.beginPath(); g.moveTo(X(x1), Y(y1)); g.lineTo(X(x2), Y(y2)); g.stroke();
      g.setLineDash([]);
    },
    arc(cx, cy, r, a0, a1, st) {
      const [w, c] = styles[st];
      const sweep = ((a1 - a0 + 540) % 360) - 180;
      g.lineWidth = w; g.strokeStyle = c;
      g.beginPath(); g.arc(X(cx), Y(cy), r * v.scale, (a0 * Math.PI) / 180, ((a0 + sweep) * Math.PI) / 180, sweep < 0); g.stroke();
    },
    text(x, y, str, { size, angle } = {}) {
      g.save();
      g.fillStyle = '#334155';
      g.font = `600 ${size === 'small' ? 11 : 12}px "IBM Plex Mono", ui-monospace, monospace`;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.translate(X(x), Y(y));
      if (angle) g.rotate(-Math.PI / 2);
      g.fillText(str, 0, 0);
      g.restore();
    },
  };
}

export function drawPlan(g, rooms, v, { selection, width, height, print, plan = { walls: [], openings: [] }, preview } = {}) {
  g.save();
  g.fillStyle = '#fff';
  g.fillRect(0, 0, width, height);
  const tx = (x) => v.ox + x * v.scale;
  const ty = (y) => v.oy + y * v.scale;
  if (!print && v.scale > 8) {
    g.strokeStyle = '#E6E1D7';
    g.lineWidth = 1;
    const step = v.scale;
    for (let x = v.ox % step; x < width; x += step) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, height); g.stroke(); }
    for (let y = v.oy % step; y < height; y += step) { g.beginPath(); g.moveTo(0, y); g.lineTo(width, y); g.stroke(); }
  }
  // preenchimento dos cômodos
  for (const r of rooms) {
    const pts = worldPoints(r);
    if (pts.length < 3) continue;
    const sel = selection?.t === 'room' && selection.room === r;
    g.beginPath();
    pts.forEach(([x, y], i) => (i ? g.lineTo(tx(x), ty(y)) : g.moveTo(tx(x), ty(y))));
    g.closePath();
    g.fillStyle = sel ? 'rgba(30,79,160,0.10)' : 'rgba(30,79,160,0.035)';
    g.fill();
  }
  // paredes, meias paredes e esquadrias
  renderWalls(canvasAdapter(g, v, print), rooms, plan, { editor: !print });

  // cotas internas e identificação
  for (const r of rooms) {
    const pts = worldPoints(r);
    if (pts.length < 3) continue;
    g.font = '500 12px "IBM Plex Mono", ui-monospace, monospace';
    g.fillStyle = '#475569';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const rect = r.shape !== 'poly' || pts.length === 4;
    pts.forEach(([x1, y1], i) => {
      if (rect && i > 1) return;
      const [x2, y2] = pts[(i + 1) % pts.length];
      const len = Math.hypot(x2 - x1, y2 - y1);
      if (len * v.scale < 30) return;
      const nx = (y2 - y1) / len;
      const ny = -(x2 - x1) / len;
      g.save();
      g.translate(tx((x1 + x2) / 2) - nx * 12, ty((y1 + y2) / 2) - ny * 12);
      if (Math.abs(y2 - y1) > Math.abs(x2 - x1)) g.rotate(-Math.PI / 2);
      g.fillText(fmt(len), 0, 0);
      g.restore();
    });
    const b = bounds(r);
    const cx = tx((b.minX + b.maxX) / 2 + (r.x || 0));
    const cy = ty((b.minY + b.maxY) / 2 + (r.y || 0));
    g.fillStyle = '#0f172a';
    g.font = '700 14px "Space Grotesk", system-ui, sans-serif';
    g.fillText((r.name || r.kind || '').toUpperCase(), cx, cy - 9);
    g.font = '500 12px "IBM Plex Mono", ui-monospace, monospace';
    g.fillStyle = '#475569';
    g.fillText(`${fmt(roomArea(r))} m²`, cx, cy + 9);
  }

  // destaque da seleção
  if (!print && selection) {
    g.strokeStyle = '#1E4FA0';
    g.lineWidth = 5;
    g.lineCap = 'round';
    const segs = segments(rooms, plan);
    const hl = (x1, y1, x2, y2) => { g.beginPath(); g.moveTo(tx(x1), ty(y1)); g.lineTo(tx(x2), ty(y2)); g.stroke(); };
    if (selection.t === 'room') {
      const pts = worldPoints(selection.room);
      g.lineWidth = 2.5;
      g.beginPath();
      pts.forEach(([x, y], i) => (i ? g.lineTo(tx(x), ty(y)) : g.moveTo(tx(x), ty(y))));
      g.closePath();
      g.stroke();
    } else if (selection.t === 'edge' || selection.t === 'wall') {
      const s = segs.find((x) => (selection.t === 'wall' ? x.host.t === 'wall' && x.host.id === selection.wall.id : x.host.t === 'room' && x.host.id === selection.room.id && x.host.edge === selection.i));
      if (s) hl(s.x1, s.y1, s.x2, s.y2);
    } else if (selection.t === 'op') {
      const og = openingGeom(selection.op, segs);
      if (og) { g.lineWidth = 7; g.strokeStyle = 'rgba(30,79,160,.5)'; hl(og.a[0], og.a[1], og.b[0], og.b[1]); }
    }
  }
  // parede sendo desenhada + marcador de encaixe
  if (preview && !preview.hideLine) {
    g.setLineDash([8, 6]);
    g.strokeStyle = '#1E4FA0';
    g.lineWidth = 3;
    g.beginPath(); g.moveTo(tx(preview.x1), ty(preview.y1)); g.lineTo(tx(preview.x2), ty(preview.y2)); g.stroke();
    g.setLineDash([]);
    const L = Math.hypot(preview.x2 - preview.x1, preview.y2 - preview.y1);
    g.fillStyle = '#1E4FA0';
    g.font = '500 13px "IBM Plex Mono", ui-monospace, monospace';
    g.fillText(`${fmt(L)} m`, tx((preview.x1 + preview.x2) / 2), ty((preview.y1 + preview.y2) / 2) - 14);
  }
  if (preview?.snap) {
    const [sx, sy] = preview.snap.p;
    g.strokeStyle = '#1E4FA0';
    g.lineWidth = 2;
    g.beginPath();
    if (preview.snap.k === 'mid') { g.moveTo(tx(sx), ty(sy) - 8); g.lineTo(tx(sx) + 8, ty(sy) + 6); g.lineTo(tx(sx) - 8, ty(sy) + 6); g.closePath(); }
    else g.rect(tx(sx) - 7, ty(sy) - 7, 14, 14);
    g.stroke();
  }
  g.restore();
}

function pointInPoly([px, py], pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// Ajusta (x, y) de um cômodo para alinhar bordas com outros cômodos próximos.
function snapRoom(room, rooms, x, y) {
  const b = bounds(room);
  const mine = { l: x + b.minX, r: x + b.maxX, t: y + b.minY, b: y + b.maxY };
  let bestX = { d: SNAP, v: null };
  let bestY = { d: SNAP, v: null };
  for (const o of rooms) {
    if (o === room) continue;
    const ob = bounds(o);
    const other = { l: o.x + ob.minX, r: o.x + ob.maxX, t: o.y + ob.minY, b: o.y + ob.maxY };
    for (const [a, c] of [['l', 'r'], ['r', 'l'], ['l', 'l'], ['r', 'r']]) {
      const d = Math.abs(mine[a] - other[c]);
      if (d < bestX.d) bestX = { d, v: x + other[c] - mine[a] };
    }
    for (const [a, c] of [['t', 'b'], ['b', 't'], ['t', 't'], ['b', 'b']]) {
      const d = Math.abs(mine[a] - other[c]);
      if (d < bestY.d) bestY = { d, v: y + other[c] - mine[a] };
    }
  }
  return [bestX.v ?? round(x), bestY.v ?? round(y)];
}

const HINTS = {
  select: 'Toque num cômodo, parede, porta ou janela para ver as propriedades. Arraste para mover.',
  wall: 'Arraste para desenhar a parede. Ela gruda em cantos (■) e meios (▲) de outras paredes.',
  door: 'Toque numa parede para colocar a porta.',
  window: 'Toque numa parede para colocar a janela.',
};

export default {
  id: 'sketch',
  name: 'Croqui',
  description: 'Planta baixa: cômodos arrastáveis, paredes soltas, meias paredes, portas e janelas, com encaixe automático.',

  async render(body, ctx) {
    const { db, property } = ctx;
    const rooms = await loadRooms(db, property.id);
    const plan = getPlan(property);
    let selection = null;
    let mode = 'select';
    let v = null;
    let preview = null;

    const canvas = h('canvas', { class: 'plan' });
    const side = h('div', { class: 'plan-props', hidden: true });
    const wrap = h('div', { class: 'plan-wrap' }, canvas);
    const hint = h('div', { class: 'plan-hint' }, HINTS.select);
    const g = canvas.getContext('2d');
    const savePlan = () => ctx.saveProperty({ plan: { walls: plan.walls, openings: plan.openings } });
    const setSide = (...els) => side.replaceChildren(...els.filter(Boolean));

    // Posições iniciais: cômodos sem posição vão lado a lado.
    let cursor = 0;
    for (const r of rooms) if (r.placed) cursor = Math.max(cursor, (r.x || 0) + bounds(r).maxX + 0.5);
    for (const r of rooms) {
      if (r.placed) continue;
      r.x = cursor;
      r.y = 0;
      r.placed = true;
      cursor += (bounds(r).maxX || 3) + 0.5;
      db.put('rooms', r);
    }

    const size = () => {
      const w = wrap.clientWidth;
      const hh = wrap.clientHeight;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = w * dpr;
      canvas.height = hh * dpr;
      canvas.style.width = w + 'px';
      canvas.style.height = hh + 'px';
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      return [w, hh];
    };
    const draw = () => {
      if (!v) return;
      drawPlan(g, rooms, v, { selection, width: wrap.clientWidth, height: wrap.clientHeight, plan, preview });
    };
    const fit = () => {
      const [w, hh] = size();
      // respiro em cima para a barra de botões não tapar o desenho
      v = fitView(rooms, plan, w, hh - 56);
      v.oy += 56;
      draw();
    };
    const zoom = (f, cx = wrap.clientWidth / 2, cy = wrap.clientHeight / 2) => {
      v.ox = cx - (cx - v.ox) * f;
      v.oy = cy - (cy - v.oy) * f;
      v.scale *= f;
      draw();
    };

    // ---------- encaixe ----------
    const tol = () => 16 / v.scale;
    function snapPoint(p, exceptId) {
      let best = null;
      for (const sp of snapPoints(segments(rooms, plan), exceptId)) {
        const d = Math.hypot(sp.p[0] - p[0], sp.p[1] - p[1]);
        if (d < tol() && (!best || d < best.d)) best = { ...sp, d };
      }
      return best;
    }
    function snapEnd(start, p, exceptId) {
      const sp = snapPoint(p, exceptId);
      if (sp) return { p: sp.p, snap: sp };
      let [dx, dy] = [p[0] - start[0], p[1] - start[1]];
      const ang = Math.abs((Math.atan2(dy, dx) * 180) / Math.PI);
      if (ang < 10 || ang > 170) dy = 0;
      else if (Math.abs(ang - 90) < 10) dx = 0;
      const L = Math.hypot(dx, dy);
      if (L > 0) { const k = round(L) / L; dx *= k; dy *= k; }
      return { p: [start[0] + dx, start[1] + dy], snap: null };
    }

    // ---------- seleção por toque ----------
    function hitTest(p) {
      const segs = segments(rooms, plan);
      const t = tol();
      for (const op of [...plan.openings].reverse()) {
        const og = openingGeom(op, segs);
        if (og && distToSeg(p, { x1: og.a[0], y1: og.a[1], x2: og.b[0], y2: og.b[1] }).d < t) return { t: 'op', op };
      }
      for (const w of [...plan.walls].reverse()) if (distToSeg(p, w).d < t) return { t: 'wall', wall: w };
      for (const s of segs) {
        if (s.host.t !== 'room') continue;
        if (distToSeg(p, s).d < t * 0.6) return { t: 'edge', room: s.room, i: s.host.edge };
      }
      const r = [...rooms].reverse().find((x) => pointInPoly(p, worldPoints(x)));
      return r ? { t: 'room', room: r } : null;
    }

    // ---------- toque / arrasto / pinça ----------
    const pointers = new Map();
    let drag = null;
    let pinch = null;
    const toWorld = (e) => {
      const rc = canvas.getBoundingClientRect();
      return [(e.clientX - rc.left - v.ox) / v.scale, (e.clientY - rc.top - v.oy) / v.scale];
    };
    canvas.addEventListener('pointerdown', (e) => {
      canvas.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, e);
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch = { d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) };
        drag = null;
        preview = null;
        return;
      }
      const p = toWorld(e);
      if (mode === 'wall') {
        const sp = snapPoint(p);
        const start = sp ? sp.p : [round(p[0]), round(p[1])];
        preview = { x1: start[0], y1: start[1], x2: start[0], y2: start[1], snap: sp };
        drag = { kind: 'newWall', start: [e.clientX, e.clientY], moved: false };
        draw();
        return;
      }
      if (mode === 'door' || mode === 'window') {
        const segs = segments(rooms, plan).filter((s) => s.kind !== 'hidden');
        let best = null;
        for (const s of segs) {
          const r = distToSeg(p, s);
          if (r.d < tol() * 1.5 && (!best || r.d < best.r.d)) best = { s, r };
        }
        if (!best) return ctx.toast('Toque mais perto de uma parede.');
        addOpening(mode, best.s, best.r.t);
        setMode('select');
        return;
      }
      const hit = hitTest(p);
      let origin = [v.ox, v.oy];
      if (hit?.t === 'room') origin = [hit.room.x, hit.room.y];
      if (hit?.t === 'wall') origin = [hit.wall.x1, hit.wall.y1, hit.wall.x2, hit.wall.y2];
      drag = { hit, start: [e.clientX, e.clientY], origin, moved: false, p0: p };
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, e);
      if (pinch && pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
        const rc = canvas.getBoundingClientRect();
        zoom(d / pinch.d, (a.clientX + b.clientX) / 2 - rc.left, (a.clientY + b.clientY) / 2 - rc.top);
        pinch.d = d;
        return;
      }
      if (!drag) return;
      const dx = e.clientX - drag.start[0];
      const dy = e.clientY - drag.start[1];
      if (Math.hypot(dx, dy) > 6) drag.moved = true;
      if (!drag.moved) return;
      const p = toWorld(e);
      if (drag.kind === 'newWall') {
        const end = snapEnd([preview.x1, preview.y1], p);
        Object.assign(preview, { x2: end.p[0], y2: end.p[1], snap: end.snap });
      } else if (drag.hit?.t === 'room') {
        [drag.hit.room.x, drag.hit.room.y] = snapRoom(drag.hit.room, rooms, drag.origin[0] + dx / v.scale, drag.origin[1] + dy / v.scale);
      } else if (drag.hit?.t === 'wall') {
        const w = drag.hit.wall;
        const [x1, y1, x2, y2] = drag.origin;
        let mx = dx / v.scale;
        let my = dy / v.scale;
        const sp = snapPoint([x1 + mx, y1 + my], w.id) || snapPoint([x2 + mx, y2 + my], w.id);
        if (sp) {
          const near1 = Math.hypot(sp.p[0] - (x1 + mx), sp.p[1] - (y1 + my)) < Math.hypot(sp.p[0] - (x2 + mx), sp.p[1] - (y2 + my));
          [mx, my] = near1 ? [sp.p[0] - x1, sp.p[1] - y1] : [sp.p[0] - x2, sp.p[1] - y2];
        } else {
          mx = round(mx); my = round(my);
        }
        Object.assign(w, { x1: x1 + mx, y1: y1 + my, x2: x2 + mx, y2: y2 + my });
        preview = sp ? { x1: w.x1, y1: w.y1, x2: w.x1, y2: w.y1, snap: sp, hideLine: true } : null;
      } else if (drag.hit?.t === 'op') {
        const op = drag.hit.op;
        const og = openingGeom(op, segments(rooms, plan));
        if (og) {
          const L = segLen(og.seg);
          const t = distToSeg(p, og.seg).t;
          op.pos = Math.min(Math.max(round(t), op.width / 2), L - op.width / 2);
        }
      } else if (!drag.hit) {
        v.ox = drag.origin[0] + dx;
        v.oy = drag.origin[1] + dy;
      }
      draw();
    });
    const end = (e) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;
      if (!drag) return;
      const d = drag;
      drag = null;
      if (d.kind === 'newWall') {
        const pv = preview;
        preview = null;
        if (pv && Math.hypot(pv.x2 - pv.x1, pv.y2 - pv.y1) >= 0.1) {
          const w = { id: uid(), x1: pv.x1, y1: pv.y1, x2: pv.x2, y2: pv.y2, kind: 'full' };
          plan.walls.push(w);
          savePlan();
          select({ t: 'wall', wall: w });
        } else draw();
        return;
      }
      preview = null;
      if (d.moved) {
        if (d.hit?.t === 'room') db.put('rooms', d.hit.room);
        if (d.hit?.t === 'wall' || d.hit?.t === 'op') savePlan();
        draw();
        return;
      }
      select(d.hit);
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rc = canvas.getBoundingClientRect();
      zoom(e.deltaY < 0 ? 1.1 : 1 / 1.1, e.clientX - rc.left, e.clientY - rc.top);
    }, { passive: false });

    // ---------- modos ----------
    const modeBtns = {};
    function setMode(m) {
      mode = mode === m && m !== 'select' ? 'select' : m;
      for (const [k, b] of Object.entries(modeBtns)) b.classList.toggle('on', k === mode);
      hint.textContent = HINTS[mode];
      hint.hidden = mode === 'select' && !!selection;
      canvas.style.cursor = mode === 'select' ? 'default' : 'crosshair';
    }

    // ---------- inserir ----------
    function addOpening(kind, seg, t) {
      const width = kind === 'door' ? 0.8 : 1.2;
      const L = segLen(seg);
      const op = {
        id: uid(), host: seg.host, kind, width: Math.min(width, L), pos: Math.min(Math.max(round(t), width / 2), L - width / 2),
        type: kind === 'door' ? 'De abrir' : 'De correr', height: kind === 'door' ? 2.1 : 1.0, sill: kind === 'door' ? 0 : 1.1,
      };
      plan.openings.push(op);
      savePlan();
      select({ t: 'op', op });
      arm(side.querySelector('.mfield'));
    }

    async function addRoom(shape) {
      const b = contentBounds(rooms, plan);
      const room = {
        id: uid(), propertyId: property.id, kind: 'Outro', name: `Cômodo ${rooms.length + 1}`,
        order: rooms.length, shape, x: rooms.length ? b.maxX + 0.5 : 0, y: rooms.length ? b.minY : 0, placed: true,
        width: shape === 'rect' ? 3 : null, length: shape === 'rect' ? 3 : null,
        walls: shape === 'poly' ? [{ len: null, dir: 0 }] : [],
        heights: newRoomHeights(property),
      };
      room.height = room.heights[0];
      await db.put('rooms', room);
      rooms.push(room);
      setMode('select');
      fit();
      select({ t: 'room', room });
      arm(side.querySelector('.mfield'));
    }

    // ---------- painel de propriedades ----------
    const save = async (room) => {
      await db.put('rooms', room);
      draw();
    };
    const head = (title) => h('div', { class: 'props-head' }, h('b', {}, title), h('button', { class: 'icon-btn', title: 'Fechar', onclick: () => select(null) }, '✕'));
    const seg2 = (opts, cur, onPick) => h('div', { class: 'segs' }, ...opts.map(([val, label]) => h('button', { class: 'seg' + (cur === val ? ' on' : ''), onclick: () => onPick(val) }, label)));

    function select(sel) {
      selection = sel || null;
      side.hidden = !selection;
      hint.hidden = !!selection;
      draw();
      if (!selection) return setSide();
      if (selection.t === 'room') return roomPanel(selection.room);
      if (selection.t === 'edge') return edgePanel(selection.room, selection.i);
      if (selection.t === 'wall') return wallPanel(selection.wall);
      if (selection.t === 'op') return openingPanel(selection.op);
    }

    function roomPanel(room) {
      const name = h('input', { value: room.name || '', placeholder: 'Nome' });
      name.addEventListener('change', () => { room.name = name.value; save(room); });
      const kind = h('select', {}, ...ROOM_KINDS.map((k) => h('option', { selected: room.kind === k }, k)));
      kind.addEventListener('change', () => { room.kind = kind.value; save(room); });
      const areaOut = h('b', {}, `${fmt(roomArea(room))} m²`);
      const saveArea = async (r) => { await save(r); areaOut.textContent = `${fmt(roomArea(r))} m²`; };
      const parts = [
        head('Cômodo'),
        h('label', { class: 'field' }, h('span', {}, 'Nome'), name),
        h('label', { class: 'field' }, h('span', {}, 'Tipo'), kind),
        h('div', { class: 'field' }, h('span', {}, 'Forma'), seg2([['rect', 'Retângulo'], ['poly', 'Parede por parede']], room.shape || 'rect', async (shape) => {
          if (shape === 'poly' && !(room.walls || []).length) {
            const w = room.width || 3;
            const l = room.length || 3;
            room.walls = [{ len: w, dir: 0 }, { len: l, dir: 90 }, { len: w, dir: 180 }, { len: l, dir: 270 }];
          }
          room.shape = shape;
          await save(room);
          select({ t: 'room', room });
        })),
      ];
      if ((room.shape || 'rect') === 'rect') {
        parts.push(
          measureField({ label: 'Largura', value: room.width, onChange: (n) => { room.width = n; saveArea(room); } }),
          measureField({ label: 'Comprimento', value: room.length, onChange: (n) => { room.length = n; saveArea(room); } }),
          h('button', { class: 'btn block', onclick: () => { room.rot = room.rot === 90 ? 0 : 90; save(room); } }, '↻ Girar 90°')
        );
      } else {
        parts.push(wallEditor(room));
      }
      parts.push(
        h('div', { class: 'field' }, h('span', {}, 'Pé-direito'), heightEditor(room, () => save(room), ctx)),
        h('p', {}, 'Área: ', areaOut),
        h('p', { class: 'muted' }, 'Para apagar uma parede deste cômodo ou pôr porta/janela, toque na própria parede.'),
        h('button', {
          class: 'btn danger block',
          onclick: async () => {
            if (!(await confirmDialog(`Excluir “${room.name || room.kind}”?`))) return;
            await db.del('rooms', room.id);
            rooms.splice(rooms.indexOf(room), 1);
            plan.openings = plan.openings.filter((o) => !(o.host.t === 'room' && o.host.id === room.id));
            savePlan();
            select(null);
          },
        }, 'Excluir cômodo')
      );
      setSide(...parts);
    }

    function edgePanel(room, i) {
      const s = segments(rooms, plan).find((x) => x.host.t === 'room' && x.host.id === room.id && x.host.edge === i);
      const exists = !(room.hiddenEdges || []).includes(i);
      setSide(
        head('Parede do cômodo'),
        h('p', {}, h('b', {}, room.name || room.kind), ` · ${fmt(segLen(s))} m`),
        h('div', { class: 'field' }, h('span', {}, 'Esta parede existe?'), seg2([[true, 'Sim'], [false, 'Não (vão aberto)']], exists, async (val) => {
          const set = new Set(room.hiddenEdges || []);
          val ? set.delete(i) : set.add(i);
          room.hiddenEdges = [...set];
          if (!val) plan.openings = plan.openings.filter((o) => !(o.host.t === 'room' && o.host.id === room.id && o.host.edge === i));
          await save(room);
          savePlan();
          select({ t: 'edge', room, i });
        })),
        exists ? h('div', { class: 'row' },
          h('button', { class: 'btn', onclick: () => addOpening('door', s, segLen(s) / 2) }, '+ Porta aqui'),
          h('button', { class: 'btn', onclick: () => addOpening('window', s, segLen(s) / 2) }, '+ Janela aqui')) : null,
        h('button', { class: 'btn block', onclick: () => select({ t: 'room', room }) }, 'Ver o cômodo')
      );
    }

    function wallPanel(w) {
      const L = Math.hypot(w.x2 - w.x1, w.y2 - w.y1);
      const dirOf = () => {
        const a = (Math.round((Math.atan2(w.y2 - w.y1, w.x2 - w.x1) * 180) / Math.PI / 90) * 90 + 360) % 360;
        return a;
      };
      const setLen = (len, dir) => {
        if (!(len > 0)) return;
        const d = dir ?? null;
        let ux;
        let uy;
        if (d != null) [ux, uy] = DIRS[d];
        else {
          const cur = Math.hypot(w.x2 - w.x1, w.y2 - w.y1) || 1;
          [ux, uy] = [(w.x2 - w.x1) / cur, (w.y2 - w.y1) / cur];
        }
        w.x2 = w.x1 + ux * len;
        w.y2 = w.y1 + uy * len;
        savePlan();
        draw();
      };
      const s = segments(rooms, plan).find((x) => x.host.t === 'wall' && x.host.id === w.id);
      setSide(
        head('Parede'),
        measureField({ label: 'Comprimento', value: L, onChange: (n) => setLen(n) }),
        h('div', { class: 'field' }, h('span', {}, 'Direção (a partir do início)'),
          h('div', { class: 'dirs wide' }, ...[0, 90, 180, 270].map((d) => h('button', { class: 'dir' + (dirOf() === d ? ' on' : ''), onclick: () => { setLen(Math.hypot(w.x2 - w.x1, w.y2 - w.y1), d); select({ t: 'wall', wall: w }); } }, DIR_ARROWS[d])))),
        h('div', { class: 'field' }, h('span', {}, 'Tipo'), seg2([['full', 'Parede inteira'], ['half', 'Meia parede']], w.kind || 'full', (k) => {
          w.kind = k;
          if (k === 'half' && !w.h) w.h = 1.1;
          savePlan();
          select({ t: 'wall', wall: w });
        })),
        w.kind === 'half' ? measureField({ label: 'Altura da meia parede', value: w.h, onChange: (n) => { w.h = n; savePlan(); draw(); } }) : null,
        h('div', { class: 'row' },
          h('button', { class: 'btn', onclick: () => addOpening('door', s, segLen(s) / 2) }, '+ Porta'),
          h('button', { class: 'btn', onclick: () => addOpening('window', s, segLen(s) / 2) }, '+ Janela')),
        h('button', {
          class: 'btn danger block',
          onclick: () => {
            plan.walls = plan.walls.filter((x) => x !== w);
            plan.openings = plan.openings.filter((o) => !(o.host.t === 'wall' && o.host.id === w.id));
            savePlan();
            select(null);
          },
        }, 'Excluir parede')
      );
    }

    function openingPanel(op) {
      const segs = segments(rooms, plan);
      const og = openingGeom(op, segs);
      const L = og ? segLen(og.seg) : op.width;
      const label = openingLabels(plan)[op.id];
      const types = op.kind === 'door' ? DOOR_TYPES : WINDOW_TYPES;
      const type = h('select', {}, ...types.map((t) => h('option', { selected: op.type === t }, t)));
      type.addEventListener('change', () => { op.type = type.value; savePlan(); select({ t: 'op', op }); });
      const clamp = () => { op.pos = Math.min(Math.max(op.pos, op.width / 2), L - op.width / 2); };
      const swing = op.kind === 'door' && ['De abrir', 'Pivotante', 'Camarão', 'De correr'].includes(op.type);
      setSide(
        head(`${op.kind === 'door' ? 'Porta' : 'Janela'} ${label}`),
        h('label', { class: 'field' }, h('span', {}, 'Tipo'), type),
        measureField({ label: 'Largura', value: op.width, onChange: (n) => { if (n > 0) { op.width = Math.min(n, L); clamp(); savePlan(); draw(); } } }),
        measureField({ label: 'Altura', value: op.height, onChange: (n) => { op.height = n; savePlan(); } }),
        op.kind === 'window' ? measureField({ label: 'Peitoril', value: op.sill, onChange: (n) => { op.sill = n; savePlan(); } }) : null,
        measureField({ label: 'Distância do canto', value: op.pos - op.width / 2, hint: 'Do início da parede até o vão.', onChange: (n) => { if (n != null) { op.pos = n + op.width / 2; clamp(); savePlan(); draw(); } } }),
        swing ? h('div', { class: 'row' },
          h('button', { class: 'btn', onclick: () => { op.flipHinge = !op.flipHinge; savePlan(); draw(); } }, '↔ Inverter lado'),
          h('button', { class: 'btn', onclick: () => { op.flipSide = !op.flipSide; savePlan(); draw(); } }, '⇅ Abrir para o outro lado')) : null,
        h('p', { class: 'muted' }, 'Arraste a esquadria no desenho para mudar de lugar.'),
        h('button', {
          class: 'btn danger block',
          onclick: () => { plan.openings = plan.openings.filter((x) => x !== op); savePlan(); select(null); },
        }, `Excluir ${op.kind === 'door' ? 'porta' : 'janela'}`)
      );
    }

    function wallEditor(room) {
      room.walls ||= [];
      const box = h('div', { class: 'walls' });
      const gap = h('p', { class: 'gap' });
      const showGap = () => {
        const d = closingGap(room);
        gap.textContent = room.walls.length < 3 ? 'Meça cada parede em sequência, no sentido horário.'
          : d < 0.02 ? '✓ Contorno fechado.' : `Falta fechar: ${fmt(d)} m`;
        gap.className = 'gap ' + (d < 0.02 && room.walls.length >= 3 ? 'ok' : 'warn');
      };
      const rows = () => {
        box.replaceChildren(...room.walls.map((w, i) => {
          const dirs = h('div', { class: 'dirs' }, ...[0, 90, 180, 270].map((d) =>
            h('button', { class: 'dir' + (w.dir === d ? ' on' : ''), onclick: () => { w.dir = d; save(room); rows(); } }, DIR_ARROWS[d])));
          return h('div', { class: 'wall-row' },
            measureField({
              label: `Parede ${i + 1}`,
              value: w.len,
              onChange: (n) => {
                w.len = n || 0;
                save(room);
                showGap();
                if (i === room.walls.length - 1 && w.len > 0 && (room.walls.length < 3 || closingGap(room) > 0.02)) addWall();
              },
            }),
            dirs,
            h('button', { class: 'icon-btn', onclick: () => { room.walls.splice(i, 1); save(room); rows(); } }, '✕'));
        }));
        showGap();
      };
      rows();
      const addWall = () => {
        const last = room.walls[room.walls.length - 1];
        room.walls.push({ len: null, dir: last ? (last.dir + 90) % 360 : 0 });
        rows();
        const fields = box.querySelectorAll('.mfield');
        arm(fields[fields.length - 1]);
      };
      const close = () => {
        let [x, y] = [0, 0];
        for (const w of room.walls) { const [dx, dy] = DIRS[w.dir]; x += dx * (w.len || 0); y += dy * (w.len || 0); }
        if (Math.abs(x) > 0.01) room.walls.push({ len: Math.abs(x), dir: x > 0 ? 180 : 0 });
        if (Math.abs(y) > 0.01) room.walls.push({ len: Math.abs(y), dir: y > 0 ? 270 : 90 });
        save(room);
        rows();
      };
      return h('div', {},
        h('p', { class: 'muted' }, 'Cada parede: meça com a trena e escolha a direção (sentido horário). A próxima vira 90° sozinha.'),
        box, gap,
        h('div', { class: 'row' },
          h('button', { class: 'btn primary', onclick: addWall }, '+ Parede'),
          h('button', { class: 'btn', onclick: close }, 'Fechar contorno')));
    }

    const modeBtn = (m, label) => (modeBtns[m] = h('button', { class: 'btn mode', onclick: () => setMode(m) }, label));
    body.replaceChildren(
      h('div', { class: 'plan-stage' },
        wrap,
        h('div', { class: 'plan-add' },
          h('button', { class: 'btn primary big', onclick: () => addRoom('rect') }, '+ Cômodo'),
          modeBtn('wall', '╱ Parede'),
          modeBtn('door', '◜ Porta'),
          modeBtn('window', '▭ Janela'),
          h('button', { class: 'btn', onclick: () => addRoom('poly') }, 'Cômodo irregular')),
        h('div', { class: 'plan-tools' },
          h('button', { class: 'btn', onclick: () => zoom(1.25) }, '+'),
          h('button', { class: 'btn', onclick: () => zoom(0.8) }, '−'),
          h('button', { class: 'btn', onclick: fit }, 'Ajustar'),
          h('button', {
            class: 'btn',
            onclick: (e) => {
              const stage = e.currentTarget.closest('.plan-stage');
              const full = stage.classList.toggle('full');
              e.currentTarget.textContent = full ? '✕ Sair da tela cheia' : '⛶ Tela cheia';
              requestAnimationFrame(fit);
            },
          }, '⛶ Tela cheia')),
        hint,
        side)
    );
    setMode('select');
    requestAnimationFrame(fit);
    const ro = new ResizeObserver(() => { if (v) { size(); draw(); } });
    ro.observe(wrap);
  },

  async report(ctx) {
    const rooms = await loadRooms(ctx.db, ctx.property.id);
    if (!rooms.length) return [];
    const plan = getPlan(ctx.property);
    const width = 1600;
    const height = 1100;
    const c = document.createElement('canvas');
    c.width = width;
    c.height = height;
    const g = c.getContext('2d');
    g.scale(2, 2);
    drawPlan(g, rooms, fitView(rooms, plan, width / 2, height / 2, 40), { width: width / 2, height: height / 2, print: true, plan });
    return [{ type: 'image', title: 'Croqui', dataUrl: c.toDataURL('image/jpeg', 0.92), w: width, h: height }];
  },
};
