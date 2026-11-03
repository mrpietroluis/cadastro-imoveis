// Geometria dos cômodos, compartilhada entre as ferramentas.
// Formas de cômodo:
//   'rect' (padrão)  largura × comprimento
//   'free'           cantos livres em room.pts (relativos a room.x/y). Lados medidos em room.sides[i]
//                    (do canto i ao i+1) e diagonais medidas em room.diags[k] (do canto 1 ao canto k+1).
//                    Com lados + diagonais o app calcula a forma real por triangulação (como no levantamento).
//   'poly' (antigo)  sequência de { len, dir } com dir em graus: 0 →, 90 ↓, 180 ←, 270 ↑.

export const DIRS = { 0: [1, 0], 90: [0, 1], 180: [-1, 0], 270: [0, -1] };
export const DIR_ARROWS = { 0: '→', 90: '↓', 180: '←', 270: '↑' };

export const ROOM_KINDS = [
  'Sala', 'Quarto', 'Suíte', 'Cozinha', 'Banheiro', 'Lavabo', 'Área de serviço', 'Varanda',
  'Sacada', 'Garagem', 'Corredor', 'Escritório', 'Depósito', 'Área externa', 'Outro',
];

export function isPoly(room) {
  if (room.shape === 'free') return (room.pts || []).length >= 3;
  return room.shape === 'poly' && (room.walls || []).filter((w) => w.len > 0).length >= 3;
}

// Pontos do contorno em metros, relativos ao canto do cômodo (sem repetir o primeiro).
export function roomPoints(room) {
  if (room.shape === 'free' && (room.pts || []).length >= 3) return room.pts.map((p) => [p[0], p[1]]);
  if (isPoly(room)) {
    const pts = [[0, 0]];
    let [x, y] = [0, 0];
    for (const w of room.walls) {
      if (!(w.len > 0)) continue;
      const [dx, dy] = DIRS[w.dir] || DIRS[0];
      x += dx * w.len;
      y += dy * w.len;
      pts.push([x, y]);
    }
    pts.pop();
    return pts;
  }
  let w = room.width || 0;
  let l = room.length || 0;
  if (room.rot === 90) [w, l] = [l, w];
  return [[0, 0], [w, 0], [w, l], [0, l]];
}

// Distância entre o fim da última parede e o ponto de partida (0 = fechou certinho).
export function closingGap(room) {
  if (room.shape !== 'poly') return 0;
  let [x, y] = [0, 0];
  for (const w of room.walls || []) {
    if (!(w.len > 0)) continue;
    const [dx, dy] = DIRS[w.dir] || DIRS[0];
    x += dx * w.len;
    y += dy * w.len;
  }
  return Math.hypot(x, y);
}

export function roomArea(room) {
  if (!isPoly(room)) return (room.width || 0) * (room.length || 0);
  const p = roomPoints(room);
  let s = 0;
  for (let i = 0; i < p.length; i++) {
    const [x1, y1] = p[i];
    const [x2, y2] = p[(i + 1) % p.length];
    s += x1 * y2 - x2 * y1;
  }
  return Math.abs(s) / 2;
}

export function roomPerimeter(room) {
  if (!isPoly(room)) return 2 * ((room.width || 0) + (room.length || 0));
  const p = roomPoints(room);
  let s = 0;
  for (let i = 0; i < p.length; i++) {
    const [x1, y1] = p[i];
    const [x2, y2] = p[(i + 1) % p.length];
    s += Math.hypot(x2 - x1, y2 - y1);
  }
  return s;
}

// Pés-direitos do cômodo (pode ter mais de um: forro inclinado, mezanino, rebaixo…).
export function roomHeights(room) {
  const list = (room.heights || (room.height ? [room.height] : [])).filter((x) => x > 0);
  return list;
}

export function heightsText(room, fmtFn) {
  return roomHeights(room).map((x) => fmtFn(x)).join(' / ');
}

export function wallArea(room) {
  return room.height ? roomPerimeter(room) * room.height : 0;
}

export function bounds(room) {
  const p = roomPoints(room);
  const xs = p.map((q) => q[0]);
  const ys = p.map((q) => q[1]);
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

// ---------- Forma livre: cantos, lados e diagonais ----------
const dist = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);

// Converte qualquer cômodo para forma livre mantendo o desenho atual.
export function toFree(room) {
  if (room.shape === 'free') return room;
  const pts = roomPoints(room);
  if (room.shape !== 'poly' || !isPoly(room)) {
    room.sides = [room.width, room.length, room.width, room.length].map((v) => (v > 0 ? v : null));
  } else {
    room.sides = pts.map((p, i) => dist(p, pts[(i + 1) % pts.length]));
  }
  room.pts = pts;
  room.diags = room.diags || {};
  room.shape = 'free';
  return room;
}

export function sideLen(room, i) {
  const p = roomPoints(room);
  return dist(p[i], p[(i + 1) % p.length]);
}

export function diagLen(room, k) {
  const p = roomPoints(room);
  return dist(p[0], p[k]);
}

// Interseção de duas circunferências; devolve a solução mais próxima de "near".
function circleCircle(c0, r0, c1, r1, near) {
  const d = dist(c0, c1);
  if (d < 1e-9) return null;
  const a = (r0 * r0 - r1 * r1 + d * d) / (2 * d);
  const h2 = r0 * r0 - a * a;
  const h = h2 > 0 ? Math.sqrt(h2) : 0; // medidas incompatíveis: usa o ponto mais próximo possível
  const ex = [(c1[0] - c0[0]) / d, (c1[1] - c0[1]) / d];
  const base = [c0[0] + ex[0] * a, c0[1] + ex[1] * a];
  const s1 = [base[0] - ex[1] * h, base[1] + ex[0] * h];
  const s2 = [base[0] + ex[1] * h, base[1] - ex[0] * h];
  return dist(s1, near) <= dist(s2, near) ? s1 : s2;
}

// Recalcula os cantos a partir dos lados e diagonais medidos. O que não foi medido segue o desenho
// atual (ângulos mantidos), então medir só os lados preserva os esquadros; uma diagonal medida
// corrige o ângulo daquele canto; o último lado medido fecha o contorno por triângulo.
export function solveFree(room) {
  const old = room.pts || [];
  const n = old.length;
  if (n < 3) return room;
  const sides = room.sides || [];
  const diags = room.diags || {};
  const S = (i) => (sides[i] > 0 ? sides[i] : dist(old[i], old[(i + 1) % n]));
  const dirOf = (a, b) => Math.atan2(b[1] - a[1], b[0] - a[0]);
  const turn = (k) => dirOf(old[k], old[(k + 1) % n]) - dirOf(old[(k - 1 + n) % n], old[k]);
  const pts = [old[0].slice()];
  let ang = dirOf(old[0], old[1]);
  pts.push([pts[0][0] + Math.cos(ang) * S(0), pts[0][1] + Math.sin(ang) * S(0)]);
  for (let k = 2; k < n; k++) {
    const prev = pts[k - 1];
    const prevDir = dirOf(pts[k - 2], prev);
    const a = prevDir + turn(k - 1);
    const predicted = [prev[0] + Math.cos(a) * S(k - 1), prev[1] + Math.sin(a) * S(k - 1)];
    let r0 = null;
    if (k <= n - 2 && diags[k] > 0) r0 = diags[k];
    if (k === n - 1 && sides[n - 1] > 0) r0 = sides[n - 1];
    pts.push(r0 ? circleCircle(pts[0], r0, prev, S(k - 1), predicted) || predicted : predicted);
  }
  room.pts = pts;
  return room;
}

// Diferença entre o último lado medido e o calculado (erro de fechamento).
export function closingError(room) {
  if (room.shape !== 'free') return 0;
  const n = (room.pts || []).length;
  const m = (room.sides || [])[n - 1];
  return m > 0 ? Math.abs(sideLen(room, n - 1) - m) : 0;
}
