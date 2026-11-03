// Ferramenta: planta baixa (croqui).
// Modos: Selecionar (tocar/arrastar), Parede (desenhar parede solta), Porta e Janela (tocar numa parede),
// Borracha (apaga só o trecho da parede entre dois encontros; tocar no trecho apagado devolve a parede).
// Encaixes no estilo do AutoCAD: extremidade, interseção, ponto médio, perpendicular e próximo (liga/desliga).
// Cômodo: nasce retângulo; tocar nele mostra os cantos (arrastar muda a forma) e um "+" no meio de cada
// parede (cria um canto). Lados e diagonais medidos calculam a forma real (triangulação).
import { uid } from '../db.js';
import { h, fmt, measureField, arm, confirmDialog } from '../ui.js';
import { roomArea, bounds, DIR_ARROWS, DIRS, ROOM_KINDS, toFree, solveFree, sideLen, diagLen, closingError } from '../geometry.js';
import { loadRooms, heightEditor, newRoomHeights } from './rooms.js';
import {
  getPlan, worldPoints, segments, segLen, openingGeom, renderWalls, distToSeg, planExtents, pieceAt, findSnap,
  SNAP_KINDS, DOOR_TYPES, WINDOW_TYPES, openingLabels, HALF_T,
} from '../plan.js';

const SNAP = 0.15; // metros: distância mínima para encaixar um cômodo no vizinho
const GRID = 0.05;
const round = (n) => Math.round(n / GRID) * GRID;
const AZUL = '#1E4FA0';

function contentBounds(rooms, plan) {
  const ext = plan ? planExtents(rooms, plan) : null;
  return ext || { minX: 0, minY: 0, maxX: 10, maxY: 8 };
}

function fitView(rooms, plan, w, h, pad = 60) {
  const b = contentBounds(rooms, plan);
  const bw = Math.max(b.maxX - b.minX, 1);
  const bh = Math.max(b.maxY - b.minY, 1);
  const scale = Math.min((w - pad * 2) / bw, (h - pad * 2) / bh, 120);
  return { scale, ox: (w - bw * scale) / 2 - b.minX * scale, oy: (h - bh * scale) / 2 - b.minY * scale };
}

// Cômodo retangular (4 cantos em ângulo reto)?
function isRectShape(r, pts) {
  if (r.shape === 'rect' || !r.shape) return true;
  if (pts.length !== 4) return false;
  for (let i = 0; i < 4; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % 4];
    const c = pts[(i + 2) % 4];
    const dot = (b[0] - a[0]) * (c[0] - b[0]) + (b[1] - a[1]) * (c[1] - b[1]);
    if (Math.abs(dot) > 1e-3) return false;
  }
  return true;
}

// Adaptador de desenho para o canvas da tela.
function canvasAdapter(g, v, print) {
  const X = (x) => v.ox + x * v.scale;
  const Y = (y) => v.oy + y * v.scale;
  const k = print ? 1.4 : 1;
  const styles = { wall: [1.4 * k, '#141414', []], half: [1 * k, '#141414', []], thin: [1.3 * k, '#141414', []], hair: [0.8 * k, '#64748b', []], hidden: [1.2, '#94a3b8', [6, 5]] };
  const fills = { wall: print ? '#9a9a9a' : '#4a4f56', half: print ? '#d9d9d9' : '#cfcac0' };
  return {
    band(poly, st) {
      g.fillStyle = fills[st] || fills.wall;
      g.beginPath();
      poly.forEach(([x, y], i) => (i ? g.lineTo(X(x), Y(y)) : g.moveTo(X(x), Y(y))));
      g.closePath();
      g.fill();
    },
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
      g.font = `500 ${size === 'small' ? 11 : 12}px "IBM Plex Mono", ui-monospace, monospace`;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.translate(X(x), Y(y));
      if (angle) g.rotate(-Math.PI / 2);
      g.fillText(str, 0, 0);
      g.restore();
    },
  };
}

// Símbolos de encaixe (como no AutoCAD).
function drawSnapMarker(g, x, y, kind) {
  g.save();
  g.strokeStyle = AZUL;
  g.lineWidth = 2;
  g.beginPath();
  if (kind === 'end') g.rect(x - 7, y - 7, 14, 14);
  else if (kind === 'mid') { g.moveTo(x, y - 8); g.lineTo(x + 8, y + 6); g.lineTo(x - 8, y + 6); g.closePath(); }
  else if (kind === 'int') { g.moveTo(x - 7, y - 7); g.lineTo(x + 7, y + 7); g.moveTo(x + 7, y - 7); g.lineTo(x - 7, y + 7); }
  else if (kind === 'perp') { g.moveTo(x - 7, y - 7); g.lineTo(x - 7, y + 7); g.lineTo(x + 7, y + 7); g.moveTo(x - 7, y); g.lineTo(x, y); g.lineTo(x, y + 7); }
  else { g.moveTo(x - 7, y - 7); g.lineTo(x + 7, y - 7); g.lineTo(x - 7, y + 7); g.lineTo(x + 7, y + 7); g.closePath(); }
  g.stroke();
  g.font = '500 11px "IBM Plex Mono", ui-monospace, monospace';
  g.fillStyle = AZUL;
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  g.fillText(SNAP_KINDS[kind]?.label || '', x + 12, y - 12);
  g.restore();
}

export function drawPlan(g, rooms, v, { selection, width, height, print, plan = { walls: [], openings: [] }, preview, showHandles } = {}) {
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
  const selRoom = selection?.room && (selection.t === 'room' || selection.t === 'vertex') ? selection.room : null;
  for (const r of rooms) {
    const pts = worldPoints(r);
    if (pts.length < 3) continue;
    g.beginPath();
    pts.forEach(([x, y], i) => (i ? g.lineTo(tx(x), ty(y)) : g.moveTo(tx(x), ty(y))));
    g.closePath();
    g.fillStyle = r === selRoom ? 'rgba(30,79,160,0.10)' : 'rgba(30,79,160,0.035)';
    g.fill();
  }
  renderWalls(canvasAdapter(g, v, print), rooms, plan, { editor: !print });

  // cotas internas e identificação
  for (const r of rooms) {
    const pts = worldPoints(r);
    if (pts.length < 3) continue;
    g.font = '500 12px "IBM Plex Mono", ui-monospace, monospace';
    g.fillStyle = '#475569';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const rect = isRectShape(r, pts);
    pts.forEach(([x1, y1], i) => {
      if (rect && i > 1) return;
      const [x2, y2] = pts[(i + 1) % pts.length];
      const len = Math.hypot(x2 - x1, y2 - y1);
      if (len * v.scale < 30) return;
      const nx = (y2 - y1) / len;
      const ny = -(x2 - x1) / len;
      const s = Math.sign((pts.length && (worldPoints(r).reduce((a, p, j, arr) => a + p[0] * arr[(j + 1) % arr.length][1] - arr[(j + 1) % arr.length][0] * p[1], 0))) || 1);
      g.save();
      g.translate(tx((x1 + x2) / 2) - nx * 12 * s, ty((y1 + y2) / 2) - ny * 12 * s);
      let ang = Math.atan2(y2 - y1, x2 - x1);
      if (ang > Math.PI / 2) ang -= Math.PI;
      if (ang < -Math.PI / 2) ang += Math.PI;
      g.rotate(ang);
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
    g.strokeStyle = AZUL;
    g.lineWidth = 5;
    g.lineCap = 'round';
    const segs = segments(rooms, plan);
    const hl = (x1, y1, x2, y2) => { g.beginPath(); g.moveTo(tx(x1), ty(y1)); g.lineTo(tx(x2), ty(y2)); g.stroke(); };
    if (selRoom) {
      const pts = worldPoints(selRoom);
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

  // cantos numerados (arrastáveis) e "+" no meio das paredes do cômodo selecionado
  if (!print && selRoom && showHandles) {
    const pts = worldPoints(selRoom);
    pts.forEach(([x, y], i) => {
      const [x2, y2] = pts[(i + 1) % pts.length];
      const mx = tx((x + x2) / 2);
      const my = ty((y + y2) / 2);
      g.fillStyle = '#fff';
      g.strokeStyle = AZUL;
      g.lineWidth = 2;
      g.beginPath(); g.rect(mx - 9, my - 9, 18, 18); g.fill(); g.stroke();
      g.beginPath(); g.moveTo(mx - 5, my); g.lineTo(mx + 5, my); g.moveTo(mx, my - 5); g.lineTo(mx, my + 5); g.stroke();
    });
    pts.forEach(([x, y], i) => {
      const on = selection.t === 'vertex' && selection.i === i;
      g.fillStyle = on ? '#141414' : AZUL;
      g.beginPath(); g.arc(tx(x), ty(y), 11, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#F1EEE8';
      g.font = '500 12px "IBM Plex Mono", ui-monospace, monospace';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(String(i + 1), tx(x), ty(y) + 0.5);
    });
  }

  // parede sendo desenhada + marcador de encaixe
  if (preview && !preview.hideLine) {
    g.setLineDash([8, 6]);
    g.strokeStyle = AZUL;
    g.lineWidth = 3;
    g.beginPath(); g.moveTo(tx(preview.x1), ty(preview.y1)); g.lineTo(tx(preview.x2), ty(preview.y2)); g.stroke();
    g.setLineDash([]);
    const L = Math.hypot(preview.x2 - preview.x1, preview.y2 - preview.y1);
    g.fillStyle = AZUL;
    g.font = '500 13px "IBM Plex Mono", ui-monospace, monospace';
    g.textAlign = 'center';
    g.fillText(`${fmt(L)} m`, tx((preview.x1 + preview.x2) / 2), ty((preview.y1 + preview.y2) / 2) - 14);
  }
  if (preview?.snap) drawSnapMarker(g, tx(preview.snap.p[0]), ty(preview.snap.p[1]), preview.snap.k);
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

// Ajusta (x, y) de um cômodo para encaixar no vizinho, deixando o espaço da parede entre eles.
function snapRoom(room, rooms, x, y, gap = 0, tol = SNAP) {
  const b = bounds(room);
  const mine = { l: x + b.minX, r: x + b.maxX, t: y + b.minY, b: y + b.maxY };
  let bestX = { d: tol, v: null };
  let bestY = { d: tol, v: null };
  for (const o of rooms) {
    if (o === room) continue;
    const ob = bounds(o);
    const other = { l: o.x + ob.minX, r: o.x + ob.maxX, t: o.y + ob.minY, b: o.y + ob.maxY };
    for (const [a, c, gp] of [['l', 'r', gap], ['r', 'l', -gap], ['l', 'l', 0], ['r', 'r', 0]]) {
      const d = Math.abs(mine[a] - (other[c] + gp));
      if (d < bestX.d) bestX = { d, v: x + other[c] + gp - mine[a] };
    }
    for (const [a, c, gp] of [['t', 'b', gap], ['b', 't', -gap], ['t', 't', 0], ['b', 'b', 0]]) {
      const d = Math.abs(mine[a] - (other[c] + gp));
      if (d < bestY.d) bestY = { d, v: y + other[c] + gp - mine[a] };
    }
  }
  return [bestX.v ?? round(x), bestY.v ?? round(y)];
}

const HINTS = {
  select: 'Toque num cômodo para ver os cantos (arraste para mudar a forma) e o + para criar um canto. Arraste o cômodo para encaixar.',
  wall: 'Arraste para desenhar a parede. Ela encaixa em extremidades, meios, interseções e na perpendicular.',
  door: 'Toque numa parede para colocar a porta.',
  window: 'Toque numa parede para colocar a janela.',
  erase: 'Toque no trecho de parede que não existe. Tocar no trecho apagado (tracejado) devolve a parede.',
};

export default {
  id: 'sketch',
  name: 'Croqui',
  description: 'Planta baixa: cômodos com cantos e diagonais, paredes soltas, meias paredes, portas, janelas e borracha, com encaixes como no AutoCAD.',

  async render(body, ctx) {
    const { db, property } = ctx;
    const rooms = await loadRooms(db, property.id);
    const plan = getPlan(property);
    let selection = null;
    let mode = 'select';
    let osnap = true;
    let v = null;
    let preview = null;

    const canvas = h('canvas', { class: 'plan' });
    const side = h('div', { class: 'plan-props', hidden: true });
    const wrap = h('div', { class: 'plan-wrap' }, canvas);
    const hint = h('div', { class: 'plan-hint' }, HINTS.select);
    const g = canvas.getContext('2d');
    const savePlan = () => ctx.saveProperty({ plan: { walls: plan.walls, openings: plan.openings } });
    const setSide = (...els) => side.replaceChildren(...els.filter(Boolean));
    const save = async (room) => {
      await db.put('rooms', room);
      draw();
    };

    // Cômodos sem posição vão lado a lado; formas antigas "parede por parede" viram forma livre.
    let cursor = 0;
    for (const r of rooms) if (r.placed) cursor = Math.max(cursor, (r.x || 0) + bounds(r).maxX + 0.5);
    for (const r of rooms) {
      if (r.shape === 'poly') { toFree(r); db.put('rooms', r); }
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
      drawPlan(g, rooms, v, { selection, width: wrap.clientWidth, height: wrap.clientHeight, plan, preview, showHandles: mode === 'select' });
    };
    const fit = () => {
      const [w, hh] = size();
      v = fitView(rooms, plan, w, hh - 56); // respiro em cima para a barra de botões
      v.oy += 56;
      draw();
    };
    const zoom = (f, cx = wrap.clientWidth / 2, cy = wrap.clientHeight / 2) => {
      v.ox = cx - (cx - v.ox) * f;
      v.oy = cy - (cy - v.oy) * f;
      v.scale *= f;
      draw();
    };

    // ---------- encaixe (object snap) ----------
    const tol = () => 16 / v.scale;
    const snapAt = (p, opts = {}) => {
      if (!osnap) return null;
      const segs = segments(rooms, plan).filter((s) => !opts.skipRoom || s.host.id !== opts.skipRoom.id);
      return findSnap(p, segs, tol(), opts);
    };
    // Ponto final de uma linha a partir de "start": encaixe; senão, ortogonal (±8°) e arredonda o comprimento.
    function snapEnd(start, p, opts = {}) {
      const sp = snapAt(p, { ...opts, from: start });
      if (sp) return { p: sp.p, snap: sp };
      let [dx, dy] = [p[0] - start[0], p[1] - start[1]];
      const ang = Math.abs((Math.atan2(dy, dx) * 180) / Math.PI);
      if (ang < 8 || ang > 172) dy = 0;
      else if (Math.abs(ang - 90) < 8) dx = 0;
      const L = Math.hypot(dx, dy);
      if (L > 0) { const k = round(L) / L; dx *= k; dy *= k; }
      return { p: [start[0] + dx, start[1] + dy], snap: null };
    }

    // ---------- toque: o que está debaixo do dedo ----------
    function handleAt(p) {
      const room = selection?.room && (selection.t === 'room' || selection.t === 'vertex') ? selection.room : null;
      if (!room || mode !== 'select') return null;
      const pts = worldPoints(room);
      const r = 16 / v.scale;
      for (let i = 0; i < pts.length; i++) if (Math.hypot(pts[i][0] - p[0], pts[i][1] - p[1]) < r) return { t: 'vertex', room, i };
      for (let i = 0; i < pts.length; i++) {
        const q = pts[(i + 1) % pts.length];
        const m = [(pts[i][0] + q[0]) / 2, (pts[i][1] + q[1]) / 2];
        if (Math.hypot(m[0] - p[0], m[1] - p[1]) < r) return { t: 'addVertex', room, i };
      }
      return null;
    }
    function hitTest(p) {
      const segs = segments(rooms, plan);
      const t = tol();
      for (const op of [...plan.openings].reverse()) {
        const og = openingGeom(op, segs);
        if (og && distToSeg(p, { x1: og.a[0], y1: og.a[1], x2: og.b[0], y2: og.b[1] }).d < t) return { t: 'op', op };
      }
      for (const s of segs) {
        if (s.host.t !== 'wall') continue;
        if (distToSeg(p, s).d < t + (s.o1 - s.o0) / 2) return { t: 'wall', wall: s.wall };
      }
      for (const s of segs) {
        if (s.host.t !== 'room' || s.kind === 'hidden') continue;
        const mid = (s.o0 + s.o1) / 2;
        const c = { x1: s.x1 + s.n[0] * mid, y1: s.y1 + s.n[1] * mid, x2: s.x2 + s.n[0] * mid, y2: s.y2 + s.n[1] * mid };
        if (distToSeg(p, c).d < Math.max(t * 0.6, (s.o1 - s.o0) / 2)) return { t: 'edge', room: s.room, i: s.host.edge };
      }
      const r = [...rooms].reverse().find((x) => pointInPoly(p, worldPoints(x)));
      return r ? { t: 'room', room: r } : null;
    }

    // ---------- borracha ----------
    function eraseAt(p) {
      const segs = segments(rooms, plan);
      const t = tol();
      // 1º: tocou num trecho já apagado? devolve a parede
      for (const s of segs) {
        for (const iv of s.erased) {
          const mid = (s.o0 + s.o1) / 2;
          const a = [s.x1 + s.u[0] * iv[0] + s.n[0] * mid, s.y1 + s.u[1] * iv[0] + s.n[1] * mid];
          const b = [s.x1 + s.u[0] * iv[1] + s.n[0] * mid, s.y1 + s.u[1] * iv[1] + s.n[1] * mid];
          if (distToSeg(p, { x1: a[0], y1: a[1], x2: b[0], y2: b[1] }).d < Math.max(t, (s.o1 - s.o0) / 2 + 0.05)) {
            const owner = s.host.t === 'room' ? s.room : s.wall;
            if (s.host.t === 'room') owner.erased[s.host.edge] = owner.erased[s.host.edge].filter((x) => x !== iv);
            else owner.erased = owner.erased.filter((x) => x !== iv);
            return commitErase(s, 'Parede devolvida.');
          }
        }
        if (s.kind === 'hidden' && distToSeg(p, s).d < t) {
          s.room.hiddenEdges = (s.room.hiddenEdges || []).filter((x) => x !== s.host.edge);
          return commitErase(s, 'Parede devolvida.');
        }
      }
      // 2º: apaga o trecho entre os dois encontros mais próximos
      let best = null;
      for (const s of segs) {
        if (s.kind === 'hidden') continue;
        const mid = (s.o0 + s.o1) / 2;
        const c = { x1: s.x1 + s.n[0] * mid, y1: s.y1 + s.n[1] * mid, x2: s.x2 + s.n[0] * mid, y2: s.y2 + s.n[1] * mid };
        const r = distToSeg(p, c);
        const lim = t + (s.o1 - s.o0) / 2;
        if (r.d < lim && (!best || r.d < best.d)) best = { s, d: r.d, t: r.t };
      }
      if (!best) return ctx.toast('Toque em cima de uma parede.');
      const { s } = best;
      const [lo, hi] = pieceAt(s, best.t, segs);
      if (hi - lo < 0.02) return;
      if (s.host.t === 'room') {
        s.room.erased = { ...(s.room.erased || {}) };
        s.room.erased[s.host.edge] = [...(s.room.erased[s.host.edge] || []), [lo, hi]];
      } else {
        s.wall.erased = [...(s.wall.erased || []), [lo, hi]];
        const covered = s.wall.erased.reduce((a, [x, y]) => a + (y - x), 0);
        if (covered >= segLen(s) - 0.02) {
          plan.walls = plan.walls.filter((w) => w !== s.wall);
          plan.openings = plan.openings.filter((o) => !(o.host.t === 'wall' && o.host.id === s.wall.id));
        }
      }
      // portas e janelas que ficavam nesse trecho saem junto
      plan.openings = plan.openings.filter((o) => {
        if (o.host.t !== s.host.t || o.host.id !== s.host.id || (s.host.t === 'room' && o.host.edge !== s.host.edge)) return true;
        return o.pos < lo || o.pos > hi;
      });
      commitErase(s, `Trecho de ${fmt(hi - lo)} m apagado. Toque nele de novo para devolver.`);
    }
    async function commitErase(s, msg) {
      if (s.host.t === 'room') await db.put('rooms', s.room);
      await savePlan();
      ctx.toast(msg);
      draw();
    }

    // ---------- cantos do cômodo ----------
    // Reorganiza o que está preso às paredes (portas, espessuras, trechos apagados) quando muda a contagem de cantos.
    function remapEdges(room, fn) {
      const remapObj = (obj) => {
        if (!obj) return obj;
        const out = {};
        for (const [k, val] of Object.entries(obj)) for (const [nk, nv] of fn(Number(k), val)) out[nk] = nv;
        return out;
      };
      room.edgeT = remapObj(room.edgeT);
      room.erased = remapObj(room.erased);
      for (const o of plan.openings) {
        if (o.host.t !== 'room' || o.host.id !== room.id) continue;
        const res = fn(o.host.edge, o.pos, true);
        if (!res.length) continue;
        [[o.host.edge, o.pos]] = res;
      }
      room.hiddenEdges = [];
    }
    function insertVertex(room, i) {
      toFree(room);
      const L = sideLen(room, i);
      const p = room.pts[i];
      const q = room.pts[(i + 1) % room.pts.length];
      room.pts.splice(i + 1, 0, [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]);
      room.sides = [...(room.sides || [])];
      room.sides.splice(i, 1, null, null);
      room.diags = {};
      remapEdges(room, (k, val, isPos) => {
        if (k < i) return [[k, val]];
        if (k > i) return [[k + 1, val]];
        if (isPos) return val > L / 2 ? [[i + 1, val - L / 2]] : [[i, val]];
        if (Array.isArray(val)) return [[i, val.filter(([a]) => a < L / 2)], [i + 1, val.filter(([a]) => a >= L / 2).map(([a, b]) => [a - L / 2, b - L / 2])]];
        return [[i, val], [i + 1, val]];
      });
      save(room);
      savePlan();
      select({ t: 'vertex', room, i: i + 1 });
      ctx.toast(`Canto ${i + 2} criado. Arraste para dar a forma e meça as paredes.`);
    }
    function removeVertex(room, i) {
      toFree(room);
      const n = room.pts.length;
      if (n <= 3) return ctx.toast('Um cômodo precisa de pelo menos 3 cantos.');
      const prev = (i - 1 + n) % n;
      const Lprev = sideLen(room, prev);
      room.pts.splice(i, 1);
      room.sides = [];
      room.diags = {};
      remapEdges(room, (k, val, isPos) => {
        if (k === i) return isPos ? [[prev < i ? prev : prev - 1, val + Lprev]] : [];
        if (k > i) return [[k - 1, val]];
        return [[k, val]];
      });
      save(room);
      savePlan();
      select({ t: 'room', room });
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
        const sp = snapAt(p);
        const start = sp ? sp.p : [round(p[0]), round(p[1])];
        preview = { x1: start[0], y1: start[1], x2: start[0], y2: start[1], snap: sp };
        drag = { kind: 'newWall', start: [e.clientX, e.clientY], moved: false };
        draw();
        return;
      }
      if (mode === 'erase') {
        drag = { kind: 'erase', start: [e.clientX, e.clientY], moved: false, p0: p, origin: [v.ox, v.oy] };
        return;
      }
      if (mode === 'door' || mode === 'window') {
        const segs = segments(rooms, plan).filter((s) => s.kind !== 'hidden');
        let best = null;
        for (const s of segs) {
          const r = distToSeg(p, s);
          if (r.d < tol() * 1.5 + (s.o1 - s.o0) && (!best || r.d < best.r.d)) best = { s, r };
        }
        if (!best) return ctx.toast('Toque mais perto de uma parede.');
        addOpening(mode, best.s, best.r.t);
        setMode('select');
        return;
      }
      const hd = handleAt(p);
      if (hd) {
        drag = { kind: hd.t, hit: hd, start: [e.clientX, e.clientY], moved: false };
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
      } else if (drag.kind === 'vertex') {
        // arrastar canto: encaixe nas outras paredes; senão alinha com os cantos vizinhos (90°)
        const { room, i } = drag.hit;
        toFree(room);
        const n = room.pts.length;
        const ox = room.x || 0;
        const oy = room.y || 0;
        const sp = snapAt(p, { skipRoom: room });
        let q = sp ? sp.p.slice() : [round(p[0]), round(p[1])];
        if (!sp) {
          for (const j of [(i - 1 + n) % n, (i + 1) % n]) {
            const nb = [room.pts[j][0] + ox, room.pts[j][1] + oy];
            if (Math.abs(q[0] - nb[0]) < tol()) q[0] = nb[0];
            if (Math.abs(q[1] - nb[1]) < tol()) q[1] = nb[1];
          }
        }
        room.pts[i] = [q[0] - ox, q[1] - oy];
        preview = sp ? { x1: q[0], y1: q[1], x2: q[0], y2: q[1], snap: sp, hideLine: true } : null;
      } else if (drag.kind === 'erase' || (!drag.kind && !drag.hit)) {
        v.ox = drag.origin[0] + dx;
        v.oy = drag.origin[1] + dy;
      } else if (drag.hit?.t === 'room') {
        [drag.hit.room.x, drag.hit.room.y] = snapRoom(drag.hit.room, rooms, drag.origin[0] + dx / v.scale, drag.origin[1] + dy / v.scale, plan.t, Math.max(SNAP, 22 / v.scale));
      } else if (drag.hit?.t === 'wall') {
        const w = drag.hit.wall;
        const [x1, y1, x2, y2] = drag.origin;
        let mx = dx / v.scale;
        let my = dy / v.scale;
        const sp = snapAt([x1 + mx, y1 + my], { exceptId: w.id }) || snapAt([x2 + mx, y2 + my], { exceptId: w.id });
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
      if (d.kind === 'erase') {
        if (!d.moved) eraseAt(d.p0);
        return;
      }
      if (d.kind === 'vertex') {
        const { room, i } = d.hit;
        if (d.moved) {
          // canto arrastado à mão: as medidas das duas paredes desse canto deixam de valer
          const n = room.pts.length;
          room.sides = [...(room.sides || [])];
          room.sides[i] = null;
          room.sides[(i - 1 + n) % n] = null;
          room.diags = {};
          save(room);
          select({ t: 'vertex', room, i });
        } else select({ t: 'vertex', room, i });
        return;
      }
      if (d.kind === 'addVertex') {
        if (!d.moved) insertVertex(d.hit.room, d.hit.i);
        return;
      }
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
      if (mode !== 'select') select(null);
      draw();
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

    async function addRoom() {
      const b = contentBounds(rooms, plan);
      const room = {
        id: uid(), propertyId: property.id, kind: 'Outro', name: `Cômodo ${rooms.length + 1}`,
        order: rooms.length, shape: 'rect', x: rooms.length ? b.maxX + 0.6 : 0, y: rooms.length ? b.minY + plan.t : 0, placed: true,
        width: 3, length: 3, heights: newRoomHeights(property),
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
    const head = (title) => h('div', { class: 'props-head' }, h('b', {}, title), h('button', { class: 'icon-btn', title: 'Fechar', onclick: () => select(null) }, '✕'));
    const seg2 = (opts, cur, onPick) => h('div', { class: 'segs' }, ...opts.map(([val, label]) => h('button', { class: 'seg' + (cur === val ? ' on' : ''), onclick: () => onPick(val) }, label)));

    function select(sel) {
      selection = sel || null;
      side.hidden = !selection;
      hint.hidden = !!selection;
      draw();
      if (!selection) return setSide();
      if (selection.t === 'room') return roomPanel(selection.room);
      if (selection.t === 'vertex') return vertexPanel(selection.room, selection.i);
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
      const closeOut = h('p', { class: 'gap warn' });
      const refresh = () => {
        areaOut.textContent = `${fmt(roomArea(room))} m²`;
        const err = closingError(room);
        closeOut.textContent = err > 0.01 ? `Diferença no fechamento: ${fmt(err * 100, 0)} cm. Confira as medidas ou meça uma diagonal.` : '';
      };
      const parts = [
        head('Cômodo'),
        h('label', { class: 'field' }, h('span', {}, 'Nome'), name),
        h('label', { class: 'field' }, h('span', {}, 'Tipo'), kind),
      ];
      if (room.shape !== 'free') {
        const diagRect = Math.hypot(room.width || 0, room.length || 0);
        parts.push(
          measureField({ label: 'Largura (parede 1)', value: room.width, onChange: (n) => { room.width = n; save(room); refresh(); } }),
          measureField({ label: 'Comprimento (parede 2)', value: room.length, onChange: (n) => { room.length = n; save(room); refresh(); } }),
          measureField({
            label: 'Diagonal (canto 1 → 3)',
            value: room.diag13 ?? null,
            hint: `No esquadro daria ${fmt(diagRect)} m. Se medir diferente, o app corrige a forma.`,
            onChange: (n) => {
              room.diag13 = n;
              if (n > 0 && Math.abs(n - Math.hypot(room.width || 0, room.length || 0)) > 0.005) {
                toFree(room);
                room.diags = { 2: n };
                solveFree(room);
                save(room);
                select({ t: 'room', room });
                ctx.toast('O cômodo está fora de esquadro: forma corrigida pela diagonal.');
              } else save(room);
            },
          }),
          h('button', { class: 'btn block', onclick: () => { room.rot = room.rot === 90 ? 0 : 90; save(room); } }, '↻ Girar 90°')
        );
      } else {
        const n = room.pts.length;
        room.sides = room.sides || [];
        room.diags = room.diags || {};
        const sideFields = room.pts.map((_, i) => measureField({
          label: `Parede ${i + 1} (canto ${i + 1} → ${((i + 1) % n) + 1})`,
          value: room.sides[i] > 0 ? room.sides[i] : sideLen(room, i),
          onChange: (v2) => { room.sides[i] = v2 > 0 ? v2 : null; solveFree(room); save(room); refresh(); },
        }));
        const diagFields = [];
        for (let k = 2; k <= n - 2; k++) {
          diagFields.push(measureField({
            label: `Diagonal (canto 1 → ${k + 1})`,
            value: room.diags[k] > 0 ? room.diags[k] : diagLen(room, k),
            onChange: (v2) => { room.diags[k] = v2 > 0 ? v2 : undefined; solveFree(room); save(room); refresh(); },
          }));
        }
        parts.push(
          h('div', { class: 'field' }, h('span', {}, 'Paredes'), ...sideFields),
          diagFields.length ? h('div', { class: 'field' }, h('span', {}, 'Diagonais'), ...diagFields) : null,
          closeOut,
          h('p', { class: 'muted' }, 'Meça as paredes em sequência. Para tirar a dúvida do esquadro, meça a diagonal: o app recalcula a forma.')
        );
      }
      parts.push(
        h('div', { class: 'field' }, h('span', {}, 'Pé-direito'), heightEditor(room, () => save(room), ctx)),
        h('p', {}, 'Área: ', areaOut),
        h('p', { class: 'muted' }, 'Cantos numerados: arraste para mudar a forma. Toque no + no meio de uma parede para criar um canto.'),
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
      refresh();
    }

    function vertexPanel(room, i) {
      setSide(
        head(`Canto ${i + 1}`),
        h('p', { class: 'muted' }, `${room.name || room.kind}. Arraste o canto no desenho: ele encaixa nas outras paredes e alinha com os cantos vizinhos.`),
        h('button', { class: 'btn block', onclick: () => removeVertex(room, i) }, 'Remover este canto'),
        h('button', { class: 'btn block', onclick: () => select({ t: 'room', room }) }, 'Ver as medidas do cômodo')
      );
    }

    function edgePanel(room, i) {
      const s = segments(rooms, plan).find((x) => x.host.t === 'room' && x.host.id === room.id && x.host.edge === i);
      if (!s) return select(null);
      setSide(
        head(`Parede ${i + 1}`),
        h('p', {}, h('b', {}, room.name || room.kind), ` · ${fmt(segLen(s))} m`),
        measureField({
          label: 'Espessura desta parede',
          value: s.t,
          hint: `Padrão do imóvel: ${fmt(plan.t)} m. Ela cresce para fora do cômodo.`,
          onChange: async (n) => {
            room.edgeT = { ...(room.edgeT || {}), [i]: n > 0 ? n : undefined };
            await save(room);
          },
        }),
        h('div', { class: 'row' },
          h('button', { class: 'btn', onclick: () => addOpening('door', s, segLen(s) / 2) }, '+ Porta aqui'),
          h('button', { class: 'btn', onclick: () => addOpening('window', s, segLen(s) / 2) }, '+ Janela aqui')),
        h('p', { class: 'muted' }, 'Trecho de parede que não existe (vão, circulação)? Use a Borracha.'),
        h('button', { class: 'btn block', onclick: () => select({ t: 'room', room }) }, 'Ver o cômodo')
      );
    }

    function wallPanel(w) {
      const L = Math.hypot(w.x2 - w.x1, w.y2 - w.y1);
      const dirOf = () => (Math.round((Math.atan2(w.y2 - w.y1, w.x2 - w.x1) * 180) / Math.PI / 90) * 90 + 360) % 360;
      const setLen = (len, dir) => {
        if (!(len > 0)) return;
        let ux;
        let uy;
        if (dir != null) [ux, uy] = DIRS[dir];
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
        measureField({ label: 'Espessura', value: w.t > 0 ? w.t : w.kind === 'half' ? HALF_T : plan.t, onChange: (n) => { w.t = n > 0 ? n : undefined; savePlan(); draw(); } }),
        h('div', { class: 'field' }, h('span', {}, 'Espessura para qual lado da linha'), seg2([['left', 'Lado 1'], ['center', 'Centro'], ['right', 'Lado 2']], w.align || 'center', (a) => {
          w.align = a;
          savePlan();
          select({ t: 'wall', wall: w });
        })),
        w.kind === 'half' ? measureField({ label: 'Altura da meia parede', value: w.h, onChange: (n) => { w.h = n; savePlan(); draw(); } }) : null,
        h('div', { class: 'row' },
          h('button', { class: 'btn', onclick: () => addOpening('door', s, segLen(s) / 2) }, '+ Porta'),
          h('button', { class: 'btn', onclick: () => addOpening('window', s, segLen(s) / 2) }, '+ Janela')),
        h('p', { class: 'muted' }, 'Para apagar a parede ou um pedaço dela, use a Borracha.')
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

    // Espessura padrão das paredes do imóvel (cada parede pode ter a sua nas propriedades).
    const tBtn = h('button', { class: 'btn mono-btn', title: 'Espessura padrão das paredes', onclick: () => defaultsPanel() }, `Paredes ${fmt(plan.t)} m`);
    function defaultsPanel() {
      selection = { t: 'defaults' };
      side.hidden = false;
      hint.hidden = true;
      draw();
      setSide(
        head('Padrões da planta'),
        measureField({
          label: 'Espessura padrão das paredes',
          value: plan.t,
          hint: 'Vale para todas as paredes sem espessura própria. Meça no vão de uma porta.',
          onChange: async (n) => {
            if (!(n > 0)) return;
            await ctx.saveProperty({ wallT: n });
            tBtn.textContent = `Paredes ${fmt(plan.t)} m`;
            draw();
          },
        }),
        h('p', { class: 'muted' }, 'O levantamento mede as faces internas: a parede cresce para fora do cômodo. Ao arrastar, os cômodos vizinhos encaixam deixando o espaço da parede entre eles.')
      );
      arm(side.querySelector('.mfield'));
    }

    // Encaixe liga/desliga (como o F3 do AutoCAD).
    const snapBtn = h('button', {
      class: 'btn mode on',
      title: 'Encaixe em extremidades, meios, interseções e perpendicular',
      onclick: () => {
        osnap = !osnap;
        snapBtn.classList.toggle('on', osnap);
        snapBtn.textContent = osnap ? '⌖ Encaixe' : '⌖ Sem encaixe';
      },
    }, '⌖ Encaixe');

    const modeBtn = (m, label) => (modeBtns[m] = h('button', { class: 'btn mode', onclick: () => setMode(m) }, label));
    body.replaceChildren(
      h('div', { class: 'plan-stage' },
        wrap,
        h('div', { class: 'plan-add' },
          h('button', { class: 'btn primary big', onclick: () => addRoom() }, '+ Cômodo'),
          modeBtn('wall', '╱ Parede'),
          modeBtn('door', '◜ Porta'),
          modeBtn('window', '▭ Janela'),
          modeBtn('erase', '⌫ Borracha'),
          snapBtn,
          tBtn),
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
