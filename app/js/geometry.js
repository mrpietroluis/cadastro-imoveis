// Geometria dos cômodos, compartilhada entre as ferramentas.
// Um cômodo é retangular (largura × comprimento) ou um polígono de paredes ortogonais,
// descrito como uma sequência de { len, dir } com dir em graus: 0 →, 90 ↓, 180 ←, 270 ↑.

export const DIRS = { 0: [1, 0], 90: [0, 1], 180: [-1, 0], 270: [0, -1] };
export const DIR_ARROWS = { 0: '→', 90: '↓', 180: '←', 270: '↑' };

export const ROOM_KINDS = [
  'Sala', 'Quarto', 'Suíte', 'Cozinha', 'Banheiro', 'Lavabo', 'Área de serviço', 'Varanda',
  'Sacada', 'Garagem', 'Corredor', 'Escritório', 'Depósito', 'Área externa', 'Outro',
];

export function isPoly(room) {
  return room.shape === 'poly' && (room.walls || []).filter((w) => w.len > 0).length >= 3;
}

// Pontos do contorno em metros, relativos ao canto do cômodo (sem repetir o primeiro).
export function roomPoints(room) {
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

export function wallArea(room) {
  return room.height ? roomPerimeter(room) * room.height : 0;
}

export function bounds(room) {
  const p = roomPoints(room);
  const xs = p.map((q) => q[0]);
  const ys = p.map((q) => q[1]);
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}
