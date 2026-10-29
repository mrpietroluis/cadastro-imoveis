// Motor da planta: paredes dos cômodos, paredes soltas, meias paredes, portas e janelas.
// Coordenadas em metros, y para baixo. A mesma rotina desenha na tela, no PDF e no DXF
// através de um "adaptador" com as primitivas: band (faixa da parede), line, arc e text.
//
// Espessura das paredes: o levantamento mede as FACES INTERNAS dos cômodos, então a parede do cômodo
// cresce para fora dele. Dois cômodos vizinhos encaixam deixando entre eles o espaço da parede.
// Paredes soltas ficam centradas na linha desenhada.
//
// Dados guardados no imóvel:
//   property.wallT            espessura padrão (m), 0,15 se não informada
//   property.plan.walls:      [{ id, x1, y1, x2, y2, kind: 'full' | 'half', h, t }]   paredes soltas
//   property.plan.openings:   [{ id, host: { t: 'room', id, edge } | { t: 'wall', id }, pos, width, kind: 'door' | 'window',
//                                type, height, sill, flipHinge, flipSide }]           pos = centro, em m do início da parede
// No cômodo: room.hiddenEdges = [paredes que não existem] (vão aberto) e room.edgeT = { índice: espessura }.
import { roomPoints } from './geometry.js';

export const DOOR_TYPES = ['De abrir', 'De correr', 'Camarão', 'Pivotante', 'Vão livre'];
export const WINDOW_TYPES = ['De correr', 'Basculante', 'Maxim-ar', 'Fixa', 'De abrir'];
export const DEFAULT_T = 0.15;
export const HALF_T = 0.1;

export function getPlan(property) {
  const p = property.plan || {};
  return {
    walls: p.walls || [],
    openings: p.openings || [],
    get t() {
      return property.wallT > 0 ? property.wallT : DEFAULT_T;
    },
  };
}

export function worldPoints(room) {
  return roomPoints(room).map(([x, y]) => [x + (room.x || 0), y + (room.y || 0)]);
}

function signedArea(pts) {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    s += x1 * y2 - x2 * y1;
  }
  return s / 2;
}

export const segLen = (s) => Math.hypot(s.x2 - s.x1, s.y2 - s.y1);

// Todas as paredes como segmentos. Cada um tem a direção u, a normal n = (-u.y, u.x) e a faixa da
// parede de o0 a o1 ao longo de n (em metros a partir da linha). ext0/ext1 = estender a faixa no
// início/fim (cantos convexos) para fechar o canto externo.
export function segments(rooms, plan) {
  const segs = [];
  const T = plan.t ?? DEFAULT_T;
  for (const r of rooms) {
    const pts = worldPoints(r);
    if (pts.length < 3) continue;
    const hidden = new Set(r.hiddenEdges || []);
    const sign = signedArea(pts) >= 0 ? 1 : -1; // +1: n aponta para dentro do cômodo
    const dirs = pts.map(([x1, y1], i) => {
      const [x2, y2] = pts[(i + 1) % pts.length];
      const L = Math.hypot(x2 - x1, y2 - y1) || 1;
      return [(x2 - x1) / L, (y2 - y1) / L];
    });
    const convex = (i) => {
      const a = dirs[(i - 1 + dirs.length) % dirs.length];
      const b = dirs[i];
      return (a[0] * b[1] - a[1] * b[0]) * sign > 1e-6;
    };
    pts.forEach(([x1, y1], i) => {
      const [x2, y2] = pts[(i + 1) % pts.length];
      const t = r.edgeT?.[i] > 0 ? r.edgeT[i] : T;
      const [o0, o1] = sign > 0 ? [-t, 0] : [0, t];
      segs.push({
        id: `${r.id}:${i}`, host: { t: 'room', id: r.id, edge: i }, room: r, x1, y1, x2, y2,
        kind: hidden.has(i) ? 'hidden' : 'full', t, o0, o1, u: dirs[i], n: [-dirs[i][1], dirs[i][0]],
        ext0: convex(i) ? t : 0, ext1: convex((i + 1) % pts.length) ? t : 0, caps: false,
      });
    });
  }
  for (const w of plan.walls) {
    const L = Math.hypot(w.x2 - w.x1, w.y2 - w.y1) || 1;
    const u = [(w.x2 - w.x1) / L, (w.y2 - w.y1) / L];
    const half = w.kind === 'half';
    const t = w.t > 0 ? w.t : half ? HALF_T : T;
    segs.push({
      id: w.id, host: { t: 'wall', id: w.id }, wall: w, x1: w.x1, y1: w.y1, x2: w.x2, y2: w.y2,
      kind: half ? 'half' : 'full', h: w.h, t, o0: -t / 2, o1: t / 2, u, n: [-u[1], u[0]], ext0: 0, ext1: 0, caps: true,
    });
  }
  return segs;
}

export function segOf(host, segs) {
  return segs.find((s) => s.host.t === host.t && s.host.id === host.id && (host.t !== 'room' || s.host.edge === host.edge));
}

// Geometria de uma abertura: a/b = extremos do vão no eixo da parede, u = direção, n = normal,
// T = meia espessura, c = centro.
export function openingGeom(op, segs) {
  const s = segOf(op.host, segs);
  if (!s) return null;
  const L = segLen(s);
  if (L < 0.05) return null;
  const { u, n } = s;
  const mid = (s.o0 + s.o1) / 2;
  const t0 = Math.max(0, op.pos - op.width / 2);
  const t1 = Math.min(L, op.pos + op.width / 2);
  const at = (t) => [s.x1 + u[0] * t + n[0] * mid, s.y1 + u[1] * t + n[1] * mid];
  return { seg: s, u, n, t0, t1, a: at(t0), b: at(t1), c: at((t0 + t1) / 2), w: t1 - t0, T: (s.o1 - s.o0) / 2 };
}

// Intervalos [t0, t1] de um segmento cortados por aberturas e vãos abertos, inclusive os da
// parede vizinha paralela cuja faixa cobre a mesma parede.
function cutsFor(seg, cutters) {
  const L = segLen(seg);
  if (L < 1e-6) return [];
  const { u, n } = seg;
  const out = [];
  for (const g of cutters) {
    if (g.seg === seg) {
      out.push([g.t0, g.t1]);
      continue;
    }
    if (Math.abs(u[0] * g.u[1] - u[1] * g.u[0]) > 0.02) continue; // não paralelas
    const d = (g.c[0] - seg.x1) * n[0] + (g.c[1] - seg.y1) * n[1];
    const reach = (g.T || 0) + 0.03;
    if (d < seg.o0 - reach || d > seg.o1 + reach) continue; // fora da faixa desta parede
    const ta = (g.a[0] - seg.x1) * u[0] + (g.a[1] - seg.y1) * u[1];
    const tb = (g.b[0] - seg.x1) * u[0] + (g.b[1] - seg.y1) * u[1];
    const lo = Math.max(-seg.ext0, Math.min(ta, tb));
    const hi = Math.min(L + seg.ext1, Math.max(ta, tb));
    if (hi - lo > 0.01) out.push([lo, hi]);
  }
  return out.sort((p, q) => p[0] - q[0]);
}

// Trechos de parede que sobram entre os cortes, já como faixas (4 cantos) e com as faces e tampas.
function pieces(seg, cuts) {
  const L = segLen(seg);
  const start = -seg.ext0;
  const end = L + seg.ext1;
  const res = [];
  let t = start;
  for (const [lo, hi] of cuts) {
    if (lo > t + 0.005) res.push([t, lo]);
    t = Math.max(t, hi);
  }
  if (end > t + 0.005) res.push([t, end]);
  const { u, n, o0, o1 } = seg;
  const P = (t2, o) => [seg.x1 + u[0] * t2 + n[0] * o, seg.y1 + u[1] * t2 + n[1] * o];
  return res.map(([p, q]) => ({
    poly: [P(p, o0), P(q, o0), P(q, o1), P(p, o1)],
    faces: [[P(p, o0), P(q, o0)], [P(p, o1), P(q, o1)]],
    caps: [
      ...(p > start + 0.001 || seg.caps ? [[P(p, o0), P(p, o1)]] : []),
      ...(q < end - 0.001 || seg.caps ? [[P(q, o0), P(q, o1)]] : []),
    ],
  }));
}

// Contorno externo de tudo (faces externas incluídas).
export function planExtents(rooms, plan) {
  const xs = [];
  const ys = [];
  for (const s of segments(rooms, plan)) {
    if (s.kind === 'hidden') {
      xs.push(s.x1, s.x2);
      ys.push(s.y1, s.y2);
      continue;
    }
    for (const pc of pieces(s, [])) for (const [x, y] of pc.poly) { xs.push(x); ys.push(y); }
  }
  if (!xs.length) return null;
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
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

// Desenha paredes e esquadrias.
// ad = { band(poly, style)?, line(x1,y1,x2,y2,style), arc(cx,cy,r,a0,a1,style), text(x,y,str,opts) }
// style: 'wall' | 'half' | 'thin' | 'hair' | 'hidden'
export function renderWalls(ad, rooms, plan, { editor = false, labels = true, noOpeningLabels = false } = {}) {
  const segs = segments(rooms, plan);
  const geoms = plan.openings.map((op) => ({ op, g: openingGeom(op, segs) })).filter((x) => x.g);
  const cutters = geoms.map((x) => x.g);
  // Parede apagada (vão aberto) também some da parede vizinha que ocupa o mesmo lugar.
  for (const s of segs) {
    if (s.kind !== 'hidden') continue;
    const L = segLen(s);
    if (L < 0.01) continue;
    const mid = (s.o0 + s.o1) / 2;
    const off = (p) => [p[0] + s.n[0] * mid, p[1] + s.n[1] * mid];
    cutters.push({ seg: s, u: s.u, a: off([s.x1, s.y1]), b: off([s.x2, s.y2]), c: off([(s.x1 + s.x2) / 2, (s.y1 + s.y2) / 2]), T: (s.o1 - s.o0) / 2, t0: 0, t1: L });
  }
  const ps = [];
  for (const s of segs) {
    if (s.kind === 'hidden') {
      if (editor) ad.line(s.x1, s.y1, s.x2, s.y2, 'hidden');
      continue;
    }
    for (const pc of pieces(s, cutsFor(s, cutters))) ps.push({ s, pc });
  }
  // 1º os preenchimentos (para as faces ficarem por cima), depois faces e tampas
  if (ad.band) for (const { s, pc } of ps) ad.band(pc.poly, s.kind === 'half' ? 'half' : 'wall');
  for (const { s, pc } of ps) {
    const st = s.kind === 'half' ? 'half' : 'wall';
    for (const [p, q] of [...pc.faces, ...pc.caps]) ad.line(p[0], p[1], q[0], q[1], st);
  }
  for (const s of segs) {
    if (s.kind !== 'half' || !labels) continue;
    const off = s.o1 + 0.16;
    const mx = (s.x1 + s.x2) / 2 + s.n[0] * off;
    const my = (s.y1 + s.y2) / 2 + s.n[1] * off;
    ad.text(mx, my, `h=${fmt2(s.h || 1.1)}`, { size: 'small', angle: Math.abs(s.u[1]) > Math.abs(s.u[0]) ? 90 : 0 });
  }
  const names = openingLabels(plan);
  for (const { op, g } of geoms) drawOpening(ad, op, g, labels && !noOpeningLabels ? names[op.id] : null);
  return { segs, geoms };
}

function drawOpening(ad, op, g, label) {
  const { a, b, u, n, w, T } = g;
  const P = (p, k, m = 0) => [p[0] + n[0] * k + u[0] * m, p[1] + n[1] * k + u[1] * m];
  const L = (p, q, st) => ad.line(p[0], p[1], q[0], q[1], st);
  const side = op.flipSide ? -1 : 1;
  const ang = (p, q) => (Math.atan2(q[1] - p[1], q[0] - p[0]) * 180) / Math.PI;
  if (op.kind === 'window') {
    // janela: faces do caixilho na espessura da parede e linha do vidro
    L(P(a, -T), P(b, -T), 'thin');
    L(P(a, T), P(b, T), 'thin');
    L(P(a, -T / 4), P(b, -T / 4), 'hair');
    L(P(a, T / 4), P(b, T / 4), 'hair');
    if (op.type === 'De correr') {
      L(P(a, -T / 4), P(a, -T / 4, w * 0.55), 'thin');
      L(P(b, T / 4), P(b, T / 4, -w * 0.55), 'thin');
    }
  } else if (op.type === 'De correr') {
    L(P(a, -0.025 * side), P(a, -0.025 * side, w * 0.6), 'thin');
    L(P(b, 0.025 * side), P(b, 0.025 * side, -w * 0.6), 'thin');
  } else if (op.type === 'Camarão') {
    for (const [p0, dir] of [[a, 1], [b, -1]]) {
      const p = P(p0, side * T);
      const k = w / 4;
      const mid = P(p, k * side, dir * k);
      L(p, mid, 'thin');
      L(mid, P(p, 0, (dir * w) / 2), 'thin');
    }
  } else if (op.type === 'Pivotante') {
    const piv = P(op.flipHinge ? b : a, 0, (op.flipHinge ? -1 : 1) * w * 0.25);
    const leafEnd = P(piv, side * w * 0.75);
    L(P(piv, -side * w * 0.25), leafEnd, 'thin');
    const far = op.flipHinge ? a : b;
    ad.arc(piv[0], piv[1], w * 0.75, ang(piv, leafEnd), ang(piv, P(far, side * 0)), 'hair');
  } else if (op.type !== 'Vão livre') {
    // De abrir: folha a 90° articulada na face do lado para onde abre, e arco de giro
    const hinge = P(op.flipHinge ? b : a, side * T);
    const other = P(op.flipHinge ? a : b, side * T);
    const leaf = P(hinge, side * w);
    L(hinge, leaf, 'thin');
    ad.arc(hinge[0], hinge[1], w, ang(hinge, leaf), ang(hinge, other), 'hair');
  }
  if (label) {
    const off = op.kind === 'door' && op.type !== 'Vão livre' ? -side * (T + 0.22) : side * (T + 0.25);
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

// Pontos de encaixe: cantos (endpoint) e meios (midpoint) das paredes, nas duas faces.
export function snapPoints(segs, exceptId) {
  const pts = [];
  for (const s of segs) {
    if (s.id === exceptId) continue;
    pts.push({ p: [s.x1, s.y1], k: 'end' }, { p: [s.x2, s.y2], k: 'end' }, { p: [(s.x1 + s.x2) / 2, (s.y1 + s.y2) / 2], k: 'mid' });
    if (s.kind !== 'hidden' && s.n && s.host.t === 'room') {
      const o = s.o0 !== 0 ? s.o0 : s.o1; // face externa
      const sh = (x, y) => [x + s.n[0] * o, y + s.n[1] * o];
      pts.push({ p: sh(s.x1 - s.u[0] * s.ext0, s.y1 - s.u[1] * s.ext0), k: 'end' }, { p: sh(s.x2 + s.u[0] * s.ext1, s.y2 + s.u[1] * s.ext1), k: 'end' });
    }
  }
  return pts;
}
