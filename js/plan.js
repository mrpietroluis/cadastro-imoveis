// Motor da planta: paredes dos cômodos, paredes soltas, meias paredes, portas e janelas.
// Coordenadas em metros, y para baixo. A mesma rotina desenha na tela, no PDF e no DXF
// através de um "adaptador" com três primitivas: line, arc e text.
//
// Dados guardados no imóvel (property.plan):
//   walls:    [{ id, x1, y1, x2, y2, kind: 'full' | 'half', h }]       paredes soltas
//   openings: [{ id, host: { t: 'room', id, edge } | { t: 'wall', id }, pos, width, kind: 'door' | 'window',
//                type, height, sill, flipHinge, flipSide }]           pos = centro, em metros do início da parede
// No cômodo: room.hiddenEdges = [índices das paredes que não existem] (vão aberto / circulação).
import { roomPoints } from './geometry.js';

export const DOOR_TYPES = ['De abrir', 'De correr', 'Camarão', 'Pivotante', 'Vão livre'];
export const WINDOW_TYPES = ['De correr', 'Basculante', 'Maxim-ar', 'Fixa', 'De abrir'];
export const WALL_T = 0.15; // espessura de representação das esquadrias (m)

export function getPlan(property) {
  const p = property.plan || {};
  return { walls: p.walls || [], openings: p.openings || [] };
}

export function worldPoints(room) {
  return roomPoints(room).map(([x, y]) => [x + (room.x || 0), y + (room.y || 0)]);
}

// Todas as paredes como segmentos: { id, host, x1, y1, x2, y2, kind: 'full'|'half'|'hidden', h }
export function segments(rooms, plan) {
  const segs = [];
  for (const r of rooms) {
    const pts = worldPoints(r);
    if (pts.length < 3) continue;
    const hidden = new Set(r.hiddenEdges || []);
    pts.forEach(([x1, y1], i) => {
      const [x2, y2] = pts[(i + 1) % pts.length];
      segs.push({ id: `${r.id}:${i}`, host: { t: 'room', id: r.id, edge: i }, room: r, x1, y1, x2, y2, kind: hidden.has(i) ? 'hidden' : 'full' });
    });
  }
  for (const w of plan.walls) segs.push({ id: w.id, host: { t: 'wall', id: w.id }, wall: w, x1: w.x1, y1: w.y1, x2: w.x2, y2: w.y2, kind: w.kind === 'half' ? 'half' : 'full', h: w.h });
  return segs;
}

export function segOf(host, segs) {
  return segs.find((s) => s.host.t === host.t && s.host.id === host.id && (host.t !== 'room' || s.host.edge === host.edge));
}

export const segLen = (s) => Math.hypot(s.x2 - s.x1, s.y2 - s.y1);

// Geometria de uma abertura: pontos a/b (extremos do vão), direção u e normal n.
export function openingGeom(op, segs) {
  const s = segOf(op.host, segs);
  if (!s) return null;
  const L = segLen(s);
  if (L < 0.05) return null;
  const u = [(s.x2 - s.x1) / L, (s.y2 - s.y1) / L];
  const n = [-u[1], u[0]];
  const t0 = Math.max(0, op.pos - op.width / 2);
  const t1 = Math.min(L, op.pos + op.width / 2);
  const at = (t) => [s.x1 + u[0] * t, s.y1 + u[1] * t];
  return { seg: s, u, n, t0, t1, a: at(t0), b: at(t1), c: at((t0 + t1) / 2), w: t1 - t0 };
}

// Intervalos [t0, t1] de um segmento cortados por aberturas (inclusive as de paredes sobrepostas).
function cutsFor(seg, geoms) {
  const L = segLen(seg);
  if (L < 1e-6) return [];
  const u = [(seg.x2 - seg.x1) / L, (seg.y2 - seg.y1) / L];
  const out = [];
  for (const g of geoms) {
    if (Math.abs(u[0] * g.u[1] - u[1] * g.u[0]) > 0.02) continue; // não paralelas
    const dx = g.c[0] - seg.x1;
    const dy = g.c[1] - seg.y1;
    if (Math.abs(dx * -u[1] + dy * u[0]) > 0.06) continue; // longe da linha
    const ta = (g.a[0] - seg.x1) * u[0] + (g.a[1] - seg.y1) * u[1];
    const tb = (g.b[0] - seg.x1) * u[0] + (g.b[1] - seg.y1) * u[1];
    const lo = Math.max(0, Math.min(ta, tb));
    const hi = Math.min(L, Math.max(ta, tb));
    if (hi - lo > 0.01) out.push([lo, hi]);
  }
  return out.sort((p, q) => p[0] - q[0]);
}

function pieces(seg, cuts) {
  const L = segLen(seg);
  const res = [];
  let t = 0;
  for (const [lo, hi] of cuts) {
    if (lo > t + 0.005) res.push([t, lo]);
    t = Math.max(t, hi);
  }
  if (L > t + 0.005) res.push([t, L]);
  const u = [(seg.x2 - seg.x1) / L, (seg.y2 - seg.y1) / L];
  return res.map(([p, q]) => [seg.x1 + u[0] * p, seg.y1 + u[1] * p, seg.x1 + u[0] * q, seg.y1 + u[1] * q]);
}

// Designação conforme NBR 6492 (A.8.1): P1, P2… e J1, J2…; esquadrias iguais (tipo e medidas)
// recebem a mesma designação e entram somadas no quadro de esquadrias.
export const openingKey = (op) => [op.kind, op.type, (op.width || 0).toFixed(2), (op.height || 0).toFixed(2), op.kind === 'window' ? (op.sill ?? 0).toFixed(2) : ''].join('|');

export function openingLabels(plan) {
  const byKey = {};
  const map = {};
  let d = 0;
  let j = 0;
  for (const op of plan.openings) {
    const k = openingKey(op);
    byKey[k] ||= op.kind === 'door' ? `P${++d}` : `J${++j}`;
    map[op.id] = byKey[k];
  }
  return map;
}

export function openingSchedule(plan) {
  const labels = openingLabels(plan);
  const rows = {};
  for (const op of plan.openings) {
    const l = labels[op.id];
    rows[l] ||= { label: l, kind: op.kind, type: op.type, width: op.width, height: op.height, sill: op.sill, qt: 0 };
    rows[l].qt++;
  }
  return Object.values(rows).sort((a, b) => (a.kind === b.kind ? Number(a.label.slice(1)) - Number(b.label.slice(1)) : a.kind === 'door' ? -1 : 1));
}

const fmt2 = (x) => x.toFixed(2).replace('.', ',');

export function openingText(op, label) {
  const dims = op.kind === 'door' ? `${fmt2(op.width)}x${fmt2(op.height || 2.1)}` : `${fmt2(op.width)}x${fmt2(op.height || 1)}/${fmt2(op.sill ?? 1.1)}`;
  return `${label} ${dims}`;
}

// Desenha paredes e esquadrias. ad = { line(x1,y1,x2,y2,style), arc(cx,cy,r,a0,a1,style), text(x,y,str,opts) }
// style: 'wall' | 'half' | 'thin' | 'hair' | 'hidden'
export function renderWalls(ad, rooms, plan, { editor = false, labels = true, noOpeningLabels = false } = {}) {
  const segs = segments(rooms, plan);
  const geoms = plan.openings.map((op) => ({ op, g: openingGeom(op, segs) })).filter((x) => x.g);
  const gs = geoms.map((x) => x.g);
  // Parede apagada (vão aberto) também some do cômodo vizinho que divide a mesma parede.
  for (const s of segs) {
    if (s.kind !== 'hidden') continue;
    const L = segLen(s);
    if (L < 0.01) continue;
    const u = [(s.x2 - s.x1) / L, (s.y2 - s.y1) / L];
    gs.push({ u, a: [s.x1, s.y1], b: [s.x2, s.y2], c: [(s.x1 + s.x2) / 2, (s.y1 + s.y2) / 2] });
  }
  const drawn = [];
  for (const s of segs) {
    if (s.kind === 'hidden') {
      if (editor) ad.line(s.x1, s.y1, s.x2, s.y2, 'hidden');
      continue;
    }
    for (const [x1, y1, x2, y2] of pieces(s, cutsFor(s, gs))) ad.line(x1, y1, x2, y2, s.kind === 'half' ? 'half' : 'wall');
    if (s.kind === 'half' && labels) {
      const mx = (s.x1 + s.x2) / 2;
      const my = (s.y1 + s.y2) / 2;
      const L = segLen(s);
      const n = [-(s.y2 - s.y1) / L, (s.x2 - s.x1) / L];
      ad.text(mx + n[0] * 0.18, my + n[1] * 0.18, `h=${fmt2(s.h || 1.1)}`, { size: 'small', angle: Math.abs(s.y2 - s.y1) > Math.abs(s.x2 - s.x1) ? 90 : 0 });
    }
    drawn.push(s);
  }
  const names = openingLabels(plan);
  for (const { op, g } of geoms) drawOpening(ad, op, g, labels && !noOpeningLabels ? names[op.id] : null);
  return { segs, geoms };
}

function drawOpening(ad, op, g, label) {
  const { a, b, u, n, w } = g;
  const T = WALL_T / 2;
  const P = (p, k, m = 0) => [p[0] + n[0] * k + u[0] * m, p[1] + n[1] * k + u[1] * m];
  const L = (p, q, st) => ad.line(p[0], p[1], q[0], q[1], st);
  // batentes
  L(P(a, -T), P(a, T), 'thin');
  L(P(b, -T), P(b, T), 'thin');
  const side = op.flipSide ? -1 : 1;
  const ang = (p, q) => (Math.atan2(q[1] - p[1], q[0] - p[0]) * 180) / Math.PI;
  if (op.kind === 'window') {
    L(P(a, -T), P(b, -T), 'thin');
    L(P(a, T), P(b, T), 'thin');
    L(a, b, 'hair');
    if (op.type === 'De correr') {
      L(P(a, -T / 3), P(a, -T / 3, w * 0.6), 'thin');
      L(P(b, T / 3), P(b, T / 3, -w * 0.6), 'thin');
    }
  } else if (op.type === 'De correr') {
    L(P(a, -0.03 * side), P(a, -0.03 * side, w * 0.6), 'thin');
    L(P(b, 0.03 * side), P(b, 0.03 * side, -w * 0.6), 'thin');
  } else if (op.type === 'Camarão') {
    for (const [p, dir] of [[a, 1], [b, -1]]) {
      const k = w / 4;
      const mid = P(p, k * side, dir * k);
      L(p, mid, 'thin');
      L(mid, P(p, 0, dir * w / 2), 'thin');
    }
  } else if (op.type === 'Pivotante') {
    const piv = P(op.flipHinge ? b : a, 0, (op.flipHinge ? -1 : 1) * w * 0.25);
    const leafEnd = P(piv, side * w * 0.75);
    L(P(piv, -side * w * 0.25), leafEnd, 'thin');
    const far = op.flipHinge ? a : b;
    ad.arc(piv[0], piv[1], w * 0.75, ang(piv, leafEnd), ang(piv, far), 'hair');
  } else if (op.type !== 'Vão livre') {
    // De abrir: folha a 90° e arco de giro
    const hinge = op.flipHinge ? b : a;
    const other = op.flipHinge ? a : b;
    const leaf = P(hinge, side * w);
    L(hinge, leaf, 'thin');
    ad.arc(hinge[0], hinge[1], w, ang(hinge, leaf), ang(hinge, other), 'hair');
  }
  if (label) {
    const off = op.kind === 'door' && op.type !== 'Vão livre' ? -side * 0.28 : side * 0.3;
    const pos = P(g.c, off);
    ad.text(pos[0], pos[1], label, { size: 'small', angle: Math.abs(u[1]) > Math.abs(u[0]) ? 90 : 0 });
  }
}

// ---------- utilidades do editor ----------
export function distToSeg(p, s) {
  const L2 = (s.x2 - s.x1) ** 2 + (s.y2 - s.y1) ** 2;
  if (L2 < 1e-9) return { d: Math.hypot(p[0] - s.x1, p[1] - s.y1), t: 0 };
  let t = ((p[0] - s.x1) * (s.x2 - s.x1) + (p[1] - s.y1) * (s.y2 - s.y1)) / L2;
  t = Math.max(0, Math.min(1, t));
  const q = [s.x1 + t * (s.x2 - s.x1), s.y1 + t * (s.y2 - s.y1)];
  return { d: Math.hypot(p[0] - q[0], p[1] - q[1]), t: t * Math.sqrt(L2), q };
}

// Pontos de encaixe: cantos (endpoint) e meios (midpoint) de todas as paredes.
export function snapPoints(segs, exceptId) {
  const pts = [];
  for (const s of segs) {
    if (s.id === exceptId) continue;
    pts.push({ p: [s.x1, s.y1], k: 'end' }, { p: [s.x2, s.y2], k: 'end' }, { p: [(s.x1 + s.x2) / 2, (s.y1 + s.y2) / 2], k: 'mid' });
  }
  return pts;
}
