// Prancha (PDF) e arquivo CAD (DXF) da planta baixa conforme a ABNT NBR 6492:2021
// (regras resumidas em NORMA.md, na raiz do projeto). Pontos aplicados:
//   4.3/4.5  formato da série A; carimbo no canto inferior direito, na largura de uma A4 (178 mm),
//            com as informações mínimas de 4.5.1; acima dele, escala gráfica, notas, quadros e revisões (4.5.2)
//   A.1      tipos e larguras de linha pelos grupos da Tabela A.2 (extralarga : larga : estreita = 1 : 1/2 : 1/4)
//   A.2      fonte sem serifa, maiúsculas, sem itálico; alturas da Tabela A.3 (7 / 5 / 3,5 / 2,5 / 1,8 mm)
//   A.3      só escalas usuais; escala gráfica
//   A.4.1    orientação do norte
//   A.5      cotas em metros, fora do desenho, limites a 45°, chamada parando a 2 mm, cifra sem encostar
//            na linha, vãos de portas e janelas cotados (Figura A.22), sem duplicar cotas
//   A.7      título do desenho numerado
//   A.8/A.9  ambientes identificados pelo nome; esquadrias P1…Pn / J1…Jn com largura x altura (e peitoril);
//            quadro de áreas e quadro de esquadrias
import { loadJsPDF } from '../tools/export.js';
import { roomArea, roomPerimeter, bounds, heightsText } from '../geometry.js';
import { getPlan, worldPoints, segments, renderWalls, openingGeom, openingLabels, openingSchedule, planExtents } from '../plan.js';

// Logo da Cota Zero (01 Identidade) para carimbos e cabeçalhos dos documentos.
let logoData;
export async function brandLogo() {
  if (logoData !== undefined) return logoData;
  try {
    const res = await fetch(new URL('../../brand/logo-carimbo.jpg', import.meta.url));
    const blob = await res.blob();
    logoData = await new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = reject;
      fr.readAsDataURL(blob);
    });
  } catch {
    logoData = null;
  }
  return logoData;
}

export const ESCALAS = [20, 25, 50, 100, 200, 250, 500, 1000, 2000]; // usuais (A.3.1) adequadas a plantas
const n2 = (v) => v.toFixed(2).replace('.', ',');

// Grupos de linhas da Tabela A.2 [extralarga, larga, estreita] em mm, conforme a escala.
export function lineGroup(escala) {
  if (escala <= 25) return [1.0, 0.5, 0.25];
  if (escala <= 50) return [0.7, 0.35, 0.18];
  return [0.5, 0.25, 0.13];
}
// Alturas de texto (mm) → corpo tipográfico (pt) da Tabela A.3.
const PT = { 7: 28, 5: 20, 3.5: 14, 2.5: 10, 1.8: 7.5 };

// Pontos das correntes de cotas externas de um lado (Figuras A.21 e A.22): as duas faces das paredes
// do contorno e os extremos dos vãos de portas e janelas, de modo que a corrente mostre
// espessura da parede, vão interno, vãos das esquadrias e o total externo.
function chainPoints(side, e, segs, geoms) {
  const horiz = side === 'top' || side === 'bottom';
  const line = side === 'top' ? e.minY : side === 'bottom' ? e.maxY : side === 'left' ? e.minX : e.maxX;
  const tol = 0.03;
  const pts = new Set();
  const coord = (p) => +(horiz ? p[0] : p[1]).toFixed(3);
  for (const s of segs) {
    if (s.kind === 'hidden') continue;
    const parallel = horiz ? Math.abs(s.u[1]) < 0.01 : Math.abs(s.u[0]) < 0.01;
    if (!parallel) continue;
    const across = (o) => (horiz ? s.y1 + s.n[1] * o : s.x1 + s.n[0] * o);
    if (Math.abs(across(s.o0) - line) > tol && Math.abs(across(s.o1) - line) > tol) continue;
    const start = [s.x1 - s.u[0] * s.ext0, s.y1 - s.u[1] * s.ext0];
    const end = [s.x2 + s.u[0] * s.ext1, s.y2 + s.u[1] * s.ext1];
    [start, end, [s.x1, s.y1], [s.x2, s.y2]].forEach((p) => pts.add(coord(p)));
    for (const g of geoms) {
      if (g.seg !== s) continue;
      pts.add(coord(g.a));
      pts.add(coord(g.b));
    }
  }
  return [...pts].sort((x, y) => x - y);
}

// ---------- Prancha A3 ----------
export async function buildPrancha({ property, rooms, def, company }) {
  const jsPDF = await loadJsPDF();
  const doc = new jsPDF({ unit: 'mm', format: 'a3', orientation: 'landscape' });
  const plan = getPlan(property);
  const W = 420;
  const H = 297;
  const ML = 25; // margem esquerda (aba de arquivamento)
  const M = 7;
  const COL = 178; // largura do carimbo = largura útil de uma A4 (4.5)
  const SELO_H = 84;
  const colX = W - M - COL;

  const text = (str, x, y, mm, opts = {}) => {
    doc.setFont('helvetica', opts.bold ? 'bold' : 'normal').setFontSize(PT[mm] || mm * 4).setTextColor(0);
    doc.text(str, x, y, { align: opts.align || 'left', angle: opts.angle || 0, baseline: opts.baseline || 'alphabetic' });
  };
  const up = (s) => String(s || '').toUpperCase();

  // Folha: moldura e divisão da coluna de informações
  doc.setDrawColor(0).setLineWidth(0.5).rect(ML, M, W - ML - M, H - 2 * M);
  doc.setLineWidth(0.35).line(colX, M, colX, H - M);

  // ---------- desenho ----------
  const area = { x: ML + 5, y: M + 6, w: colX - ML - 10, h: H - 2 * M - 34 };
  const e = planExtents(rooms, plan);
  let escala = 50;
  let k = 1000 / escala;
  const segs = segments(rooms, plan);
  const geoms = plan.openings.map((op) => openingGeom(op, segs)).filter(Boolean);
  if (e) {
    const bw = Math.max(e.maxX - e.minX, 0.5);
    const bh = Math.max(e.maxY - e.minY, 0.5);
    const reserva = 17; // mm para as cotas externas nos dois lados
    escala = ESCALAS.find((d) => (bw * 1000) / d <= area.w - 2 * reserva && (bh * 1000) / d <= area.h - 2 * reserva) || 2000;
    k = 1000 / escala;
    const [XL, L, E] = lineGroup(escala);
    const ox = area.x + (area.w - bw * k) / 2 - e.minX * k;
    const oy = area.y + (area.h - bh * k) / 2 - e.minY * k;
    const X = (x) => ox + x * k;
    const Y = (y) => oy + y * k;

    // Paredes e esquadrias (mesma rotina do editor, com pesos da Tabela A.2)
    // Parede cortada com preenchimento (hachura sólida) → contorno em linha larga (Tabela A.1)
    const widths = { wall: L, half: E, thin: L, hair: E, hidden: E };
    void XL;
    renderWalls({
      band(poly, st) {
        const pts = poly.map(([x, y]) => [X(x), Y(y)]);
        const deltas = pts.slice(1).map(([x, y], i) => [x - pts[i][0], y - pts[i][1]]);
        doc.setFillColor(st === 'half' ? 225 : 175);
        doc.lines(deltas, pts[0][0], pts[0][1], [1, 1], 'F', true);
      },
      line(x1, y1, x2, y2, st) { doc.setLineWidth(widths[st]).setDrawColor(0).line(X(x1), Y(y1), X(x2), Y(y2)); },
      arc(cx, cy, r, a0, a1, st) {
        const sweep = ((a1 - a0 + 540) % 360) - 180;
        const n = 18;
        doc.setLineWidth(widths[st]);
        let [px, py] = [cx + r * Math.cos((a0 * Math.PI) / 180), cy + r * Math.sin((a0 * Math.PI) / 180)];
        for (let i = 1; i <= n; i++) {
          const a = ((a0 + (sweep * i) / n) * Math.PI) / 180;
          const [qx, qy] = [cx + r * Math.cos(a), cy + r * Math.sin(a)];
          doc.line(X(px), Y(py), X(qx), Y(qy));
          [px, py] = [qx, qy];
        }
      },
      text(x, y, str, { angle } = {}) { text(str, X(x), Y(y), 2.5, { align: 'center', baseline: 'middle', angle: angle ? 90 : 0 }); },
    }, rooms, plan, { labels: true, noOpeningLabels: true });

    // Áreas já ocupadas por textos (mm de papel), para as designações não ficarem em cima de nada.
    const boxes = [];
    const occupy = (x0, y0, x1, y1) => boxes.push([Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1)]);
    const free = ([x0, y0, x1, y1]) => boxes.every(([a0, b0, a1, b1]) => x1 < a0 || x0 > a1 || y1 < b0 || y0 > b1);

    // Cotas (A.5): linha estreita, limites a 45°, cifra 2,5 mm sem encostar na linha
    const dim = (x1, y1, x2, y2, offMm, label, { ext = true } = {}) => {
      // linha de cota paralela ao segmento (x1,y1)-(x2,y2) em mm de papel, deslocada offMm pela normal
      const dx = x2 - x1;
      const dy = y2 - y1;
      const len = Math.hypot(dx, dy);
      if (len < 3) return;
      const nx = -dy / len;
      const ny = dx / len;
      const a = [x1 + nx * offMm, y1 + ny * offMm];
      const b = [x2 + nx * offMm, y2 + ny * offMm];
      doc.setLineWidth(E);
      doc.line(a[0], a[1], b[0], b[1]);
      if (ext) {
        const s = Math.sign(offMm);
        for (const [p, q] of [[[x1, y1], a], [[x2, y2], b]]) {
          // chamada para a 2 mm do objeto e ultrapassa a linha de cota em 1,5 mm
          doc.line(p[0] + nx * 2 * s, p[1] + ny * 2 * s, q[0] + nx * 1.5 * s, q[1] + ny * 1.5 * s);
        }
      }
      for (const p of [a, b]) doc.line(p[0] - 1, p[1] + 1, p[0] + 1, p[1] - 1);
      const vertical = Math.abs(dy) > Math.abs(dx);
      const tx = (a[0] + b[0]) / 2 + (vertical ? -1.2 : 0);
      const ty = (a[1] + b[1]) / 2 + (vertical ? 0 : -1.2);
      text(label, tx, ty, 2.5, { align: 'center', angle: vertical ? 90 : 0 });
      const tw = doc.getTextWidth(label);
      if (vertical) occupy(tx - 3, ty - tw / 2, tx + 0.5, ty + tw / 2);
      else occupy(tx - tw / 2, ty - 3, tx + tw / 2, ty + 0.5);
    };

    // Correntes externas nos quatro lados + cota total (sem duplicar quando só há um trecho)
    const sides = [
      ['top', (p) => [X(p), Y(e.minY)], -1],
      ['bottom', (p) => [X(p), Y(e.maxY)], 1],
      ['left', (p) => [X(e.minX), Y(p)], -1],
      ['right', (p) => [X(e.maxX), Y(p)], 1],
    ];
    for (const [side, P, s] of sides) {
      const pts = chainPoints(side, e, segs, geoms);
      const horiz = side === 'top' || side === 'bottom';
      const total = horiz ? [e.minX, e.maxX] : [e.minY, e.maxY];
      const gap = 9;
      if (pts.length >= 2) {
        for (let i = 0; i < pts.length - 1; i++) {
          if (pts[i + 1] - pts[i] < 0.01) continue;
          const [ax, ay] = P(pts[i]);
          const [bx, by] = P(pts[i + 1]);
          // normal "para fora": a ordem dos pontos define o lado; ajusta o sinal do deslocamento
          const out = horiz ? (side === 'top' ? -gap : gap) : (side === 'left' ? gap : -gap);
          dim(ax, ay, bx, by, horiz ? out * -1 * -1 : out, n2(pts[i + 1] - pts[i]));
        }
      }
      const only = pts.length === 2 && Math.abs(pts[0] - total[0]) < 0.01 && Math.abs(pts[1] - total[1]) < 0.01;
      if (!only && (side === 'top' || side === 'left')) {
        const [ax, ay] = P(total[0]);
        const [bx, by] = P(total[1]);
        const out = horiz ? -gap * 2 : gap * 2;
        dim(ax, ay, bx, by, out, n2(total[1] - total[0]));
      }
      void s;
    }

    // Cotas internas de cada ambiente (largura e comprimento), dentro do ambiente
    for (const r of rooms) {
      const pts = worldPoints(r);
      if (pts.length < 3) continue;
      const rect = r.shape !== 'poly' || pts.length === 4;
      pts.forEach(([x1, y1], i) => {
        if (rect && i > 1) return;
        const [x2, y2] = pts[(i + 1) % pts.length];
        const len = Math.hypot(x2 - x1, y2 - y1);
        if (len * k < 14) return;
        dim(X(x1), Y(y1), X(x2), Y(y2), 7, n2(len), { ext: false });
      });
      // Identificação do ambiente (A.8.2): nome 3,5 mm; área e pé-direito 2,5 mm
      const b = bounds(r);
      const cx = X((b.minX + b.maxX) / 2 + (r.x || 0));
      const cy = Y((b.minY + b.maxY) / 2 + (r.y || 0));
      text(up(r.name || r.kind), cx, cy - 2, 3.5, { align: 'center' });
      text(`A = ${n2(roomArea(r))} m²`, cx, cy + 2.6, 2.5, { align: 'center' });
      const pd = heightsText(r, n2);
      if (pd) text(`P.D. = ${pd}`, cx, cy + 6.4, 2.5, { align: 'center' });
      doc.setFontSize(PT[3.5]);
      const lw = Math.max(doc.getTextWidth(up(r.name || r.kind)), 26) / 2 + 1;
      occupy(cx - lw, cy - 6, cx + lw, cy + 8);
    }

    // Designação das esquadrias (A.8.1): círculo de 7 mm, sigla 2,5 mm, largura x altura / peitoril
    const labels = openingLabels(plan);
    plan.openings.forEach((op) => {
      const g = openingGeom(op, segs);
      if (!g) return;
      const pref = op.kind === 'door' && op.type !== 'Vão livre' ? -(op.flipSide ? -1 : 1) : (op.flipSide ? -1 : 1);
      const dims = `${n2(op.width)} x ${n2(op.height || (op.kind === 'door' ? 2.1 : 1))}`;
      doc.setFontSize(PT[2.5]);
      const dw = doc.getTextWidth(dims);
      const boxAt = (c) => [c[0] - 3.8, c[1] - 4, c[0] + 5 + dw, c[1] + (op.kind === 'window' ? 4.5 : 3.8)];
      // candidatos: lado preferido e oposto, deslocando ao longo da parede
      const cands = [];
      for (const along of [0, 12, -12, 24, -24, 36, -36]) {
        for (const side of [pref, -pref]) {
          for (const dist of [9, 15]) {
            cands.push([X(g.c[0]) + g.n[0] * side * dist + g.u[0] * along, Y(g.c[1]) + g.n[1] * side * dist + g.u[1] * along, along]);
          }
        }
      }
      const pick = cands.find((c) => free(boxAt(c))) || cands[0];
      const c = [pick[0], pick[1]];
      occupy(...boxAt(c));
      if (pick[2]) {
        // chamada a 45° ligando a designação ao vão, quando ela foi afastada (A.4.2)
        doc.setLineWidth(E).line(X(g.c[0]), Y(g.c[1]), c[0], c[1]);
      }
      doc.setFillColor(255).setLineWidth(E).circle(c[0], c[1], 3.5, 'FD');
      text(labels[op.id], c[0], c[1] + 0.9, 2.5, { align: 'center' });
      text(dims, c[0] + 4.5, c[1] - (op.kind === 'window' ? 0.8 : -0.9), 2.5);
      if (op.kind === 'window') {
        doc.setLineWidth(E).line(c[0] + 4.5, c[1] + 0.2, c[0] + 4.5 + dw, c[1] + 0.2);
        text(n2(op.sill ?? 1.1), c[0] + 4.5, c[1] + 3.6, 2.5);
      }
    });

    // Título do desenho (A.7): número no círculo, título 5 mm sublinhado, escala 2,5 mm
    const ty = area.y + area.h + 12;
    const tx = area.x + area.w / 2 - 30;
    doc.setLineWidth(L).circle(tx, ty - 1.8, 5);
    text('1', tx, ty, 3.5, { align: 'center' });
    text('PLANTA BAIXA', tx + 8, ty - 1, 5, { bold: true });
    const tw = doc.getTextWidth('PLANTA BAIXA');
    doc.setLineWidth(L).line(tx + 8, ty + 0.8, tx + 8 + tw, ty + 0.8);
    text(`ESCALA 1:${escala}`, tx + 8, ty + 5.5, 2.5);
  } else {
    text('NENHUM AMBIENTE DESENHADO.', area.x + area.w / 2, area.y + area.h / 2, 3.5, { align: 'center' });
  }

  // ---------- coluna acima do carimbo (4.5.2) ----------
  let y = M + 6;
  const cx0 = colX + 4;
  const cw = COL - 8;
  const table = (title, head, rows, widthsMm, aligns) => {
    text(title, cx0 + cw / 2, y, 3.5, { align: 'center', bold: true });
    y += 3;
    const rowH = 5;
    doc.setLineWidth(0.18);
    const xs = [cx0];
    widthsMm.forEach((w) => xs.push(xs[xs.length - 1] + w));
    const drawRow = (cells, bold) => {
      doc.rect(cx0, y, cw, rowH);
      cells.forEach((c, i) => {
        if (i) doc.line(xs[i], y, xs[i], y + rowH);
        const al = aligns[i] || 'left';
        const x = al === 'right' ? xs[i + 1] - 1.5 : al === 'center' ? (xs[i] + xs[i + 1]) / 2 : xs[i] + 1.5;
        text(String(c), x, y + 3.6, 2.5, { align: al, bold });
      });
      y += rowH;
    };
    drawRow(head, true);
    rows.forEach((r, i) => drawRow(r, i === rows.length - 1 && r.bold));
    y += 5;
  };

  // Quadro de áreas (A.9.2)
  const maxRooms = 11;
  const areaRows = rooms.slice(0, maxRooms).map((r) => [up(r.name || r.kind).slice(0, 30), n2(roomArea(r)), n2(roomPerimeter(r))]);
  if (rooms.length > maxRooms) areaRows.push([`+${rooms.length - maxRooms} AMBIENTES (VER FICHA)`, '', '']);
  const totalRow = ['ÁREA ÚTIL TOTAL', n2(rooms.reduce((s, r) => s + roomArea(r), 0)), ''];
  totalRow.bold = true;
  areaRows.push(totalRow);
  table('QUADRO DE ÁREAS', ['AMBIENTE', 'ÁREA (m²)', 'PERÍM. (m)'], areaRows, [cw - 60, 30, 30], ['left', 'right', 'right']);

  // Quadro de esquadrias (A.9.3)
  const sched = openingSchedule(plan);
  if (sched.length) {
    table('QUADRO DE ESQUADRIAS', ['DESIG.', 'TIPO', 'LARG. x ALT.', 'PEITORIL', 'QT'],
      sched.map((s) => [s.label, up(s.type), `${n2(s.width)} x ${n2(s.height || 0)}`, s.kind === 'window' ? n2(s.sill ?? 0) : '-', s.qt]),
      [16, cw - 16 - 34 - 22 - 12, 34, 22, 12], ['center', 'left', 'center', 'center', 'center']);
  }

  // Notas gerais
  text('NOTAS GERAIS', cx0, y, 3.5, { bold: true });
  y += 4.5;
  [
    '1. COTAS E NÍVEIS EM METROS.',
    '2. MEDIDAS TOMADAS NO LOCAL COM TRENA LASER (FACES INTERNAS).',
    '3. REPRESENTAÇÃO CONFORME ABNT NBR 6492:2021.',
    property.north == null ? '4. ORIENTAÇÃO DO NORTE A CONFIRMAR NO LOCAL.' : '4. CONFERIR MEDIDAS NO LOCAL ANTES DE EXECUTAR.',
  ].forEach((t) => { text(t, cx0, y, 2.5); y += 4; });
  y += 2;

  // Escala gráfica (A.3.2) e norte (A.4.1)
  const unit = escala <= 50 ? 1 : escala <= 100 ? 2 : escala <= 250 ? 5 : 10;
  const u = unit * k;
  const sgx = cx0 + u + 2;
  const sgy = y + 6;
  doc.setLineWidth(0.18);
  for (let i = 0; i < 5; i++) {
    const x0 = sgx - u + (i * u) / 5;
    if (i % 2 === 0) doc.setFillColor(0).rect(x0, sgy, u / 5, 1.6, 'FD'); else doc.rect(x0, sgy, u / 5, 1.6);
  }
  for (let i = 0; i < 3; i++) {
    if (i % 2 === 0) doc.setFillColor(0).rect(sgx + i * u, sgy, u, 1.6, 'FD'); else doc.rect(sgx + i * u, sgy, u, 1.6);
  }
  [[-1, unit], [0, 0], [1, unit], [2, unit * 2], [3, unit * 3]].forEach(([i, v]) => text(String(v), sgx + i * u, sgy - 1.2, 2.5, { align: 'center' }));
  text('ESCALA GRÁFICA (m)', sgx - u, sgy + 6, 2.5);
  // Norte: círculo com a indicação a partir do ponto norte
  const nr = 9;
  const ncx = colX + COL - 4 - nr - 2;
  const ncy = sgy + 2;
  const ang = (((property.north || 0) - 90) * Math.PI) / 180;
  const top = [ncx + nr * Math.cos(ang), ncy + nr * Math.sin(ang)];
  const p1 = [ncx + nr * Math.cos(ang + 2.6), ncy + nr * Math.sin(ang + 2.6)];
  const p2 = [ncx + nr * Math.cos(ang + Math.PI + 0.35), ncy + nr * Math.sin(ang + Math.PI + 0.35)];
  doc.setLineWidth(0.35).circle(ncx, ncy, nr);
  doc.line(top[0], top[1], p1[0], p1[1]);
  doc.line(top[0], top[1], p2[0], p2[1]);
  text('N', top[0] - 2.5, top[1] - 1.5, 3.5, { bold: true });
  y = Math.max(sgy + 12, ncy + nr + 4);

  // Revisões (4.5.2 d)
  const revY = H - M - SELO_H - 16;
  doc.setLineWidth(0.18).rect(cx0, revY, cw, 5).rect(cx0, revY + 5, cw, 5);
  doc.line(cx0 + 16, revY, cx0 + 16, revY + 10).line(cx0 + cw - 30, revY, cx0 + cw - 30, revY + 10);
  text('REV.', cx0 + 8, revY + 3.6, 2.5, { align: 'center', bold: true });
  text('DESCRIÇÃO', cx0 + 18, revY + 3.6, 2.5, { bold: true });
  text('DATA', cx0 + cw - 15, revY + 3.6, 2.5, { align: 'center', bold: true });
  text('R00', cx0 + 8, revY + 8.6, 2.5, { align: 'center' });
  text('EMISSÃO INICIAL', cx0 + 18, revY + 8.6, 2.5);
  text(new Date().toLocaleDateString('pt-BR'), cx0 + cw - 15, revY + 8.6, 2.5, { align: 'center' });

  // ---------- carimbo (4.5.1) ----------
  const sx = colX;
  const sy = H - M - SELO_H;
  doc.setLineWidth(0.5).rect(sx, sy, COL, SELO_H);
  const hl = (yy) => doc.setLineWidth(0.25).line(sx, sy + yy, sx + COL, sy + yy);
  const vl = (xx, y0, y1) => doc.setLineWidth(0.25).line(sx + xx, sy + y0, sx + xx, sy + y1);
  const field = (label, value, x, yy, w, mm = 2.5, bold = false) => {
    text(label, sx + x + 1.5, sy + yy + 3, 1.8);
    doc.setFont('helvetica', bold ? 'bold' : 'normal').setFontSize(PT[mm] || mm * 4);
    const v = doc.splitTextToSize(up(value || '-'), w - 3);
    text(v[0], sx + x + 1.5, sy + yy + 3 + (mm >= 5 ? 8.5 : 4.6), mm, { bold });
  };
  const logo = await brandLogo();
  field('EMPRESA', company.empresa || 'COTA ZERO', 0, 0, logo ? COL - 44 : COL, 3.5, true);
  if (logo) doc.addImage(logo, 'JPEG', sx + COL - 41, sy + 0.8, 38, (38 * 203) / 900);
  hl(10);
  field('CLIENTE / PROPRIETÁRIO', property.owner, 0, 10, COL / 2);
  field('PROJETO / SERVIÇO', `${def.name}${def.subtitle ? ' - ' + def.subtitle : ''}`, COL / 2, 10, COL / 2);
  vl(COL / 2, 10, 20);
  hl(20);
  field('LOCAL (ENDEREÇO / MATRÍCULA)', [property.address, property.registry && `MAT. ${property.registry}`].filter(Boolean).join(' - '), 0, 20, COL);
  hl(30);
  field('TÍTULO DA PRANCHA', 'PLANTA BAIXA', 0, 30, COL, 7, true);
  hl(44);
  field('RESPONSÁVEL TÉCNICO', [company.responsavel, company.registro].filter(Boolean).join(' - '), 0, 44, COL / 2);
  field('AUTORIA DO DESENHO E DO PROJETO', company.responsavel || company.empresa, COL / 2, 44, COL / 2);
  vl(COL / 2, 44, 54);
  hl(54);
  const cells = [['ESCALA', `1:${escala}`, 26], ['DATA', new Date().toLocaleDateString('pt-BR'), 32], ['REVISÃO', 'R00', 22], ['FOLHA', '01/01', 22]];
  let cxp = 0;
  for (const [lab, val, w] of cells) {
    field(lab, val, cxp, 54, w);
    cxp += w;
    vl(cxp, 54, 64);
  }
  field('Nº DO PROJETO', `${(property.id || '').slice(0, 8).toUpperCase()}`, cxp, 54, COL - cxp);
  hl(64);
  text('ASSINATURA DO RESPONSÁVEL TÉCNICO', sx + 1.5, sy + 67, 1.8);
  vl(COL / 2, 64, SELO_H);
  text('CHANCELA DE APROVAÇÃO (QUANDO APLICÁVEL)', sx + COL / 2 + 1.5, sy + 67, 1.8);

  return { blob: doc.output('blob'), escala };
}

// ---------- DXF (AutoCAD R12, unidade metro) ----------
// Camadas por função, com cores que seguem a convenção de penas: 7 = extralarga, 4 = larga, 1 = estreita.
// Alturas de texto calculadas pela escala para sair com 3,5 mm / 2,5 mm impressos (Tabela A.3).
export function buildDXF(rooms, property = {}, escala = 50) {
  const plan = getPlan(property);
  const out = [];
  const g = (code, value) => out.push(String(code), String(value));
  const layers = [
    ['ARQ-PAREDE', 7], ['ARQ-PAREDE-HACHURA', 8], ['ARQ-MEIA-PAREDE', 4], ['ARQ-ESQUADRIA', 4], ['ARQ-ESQUADRIA-GIRO', 1],
    ['ARQ-COTA', 1], ['ARQ-TEXTO', 3], ['ARQ-DESIGNACAO', 2],
  ];
  const mm = (h) => (h * escala) / 1000; // altura impressa (mm) → metros no modelo
  g(0, 'SECTION'); g(2, 'HEADER'); g(9, '$ACADVER'); g(1, 'AC1009'); g(9, '$INSUNITS'); g(70, 6); g(0, 'ENDSEC');
  g(0, 'SECTION'); g(2, 'TABLES'); g(0, 'TABLE'); g(2, 'LAYER'); g(70, layers.length);
  for (const [name, color] of layers) { g(0, 'LAYER'); g(2, name); g(70, 0); g(62, color); g(6, 'CONTINUOUS'); }
  g(0, 'ENDTAB'); g(0, 'ENDSEC');
  g(0, 'SECTION'); g(2, 'ENTITIES');
  const f = (v) => (Math.round(v * 10000) / 10000).toString();
  const ascii = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
  const line = (layer, x1, y1, x2, y2) => { g(0, 'LINE'); g(8, layer); g(10, f(x1)); g(20, f(-y1)); g(30, 0); g(11, f(x2)); g(21, f(-y2)); g(31, 0); };
  const text = (layer, x, y, hgt, str, rot = 0) => {
    g(0, 'TEXT'); g(8, layer); g(10, f(x)); g(20, f(-y)); g(30, 0); g(40, f(hgt)); g(1, ascii(str)); g(50, rot);
    g(72, 1); g(11, f(x)); g(21, f(-y)); g(31, 0);
  };
  const layerOf = { wall: 'ARQ-PAREDE', half: 'ARQ-MEIA-PAREDE', thin: 'ARQ-ESQUADRIA', hair: 'ARQ-ESQUADRIA-GIRO', hidden: null };
  renderWalls({
    // preenchimento da parede como SOLID (vértices na ordem 1, 2, 4, 3 do DXF)
    band(poly, st) {
      const [p0, p1, p2, p3] = poly;
      g(0, 'SOLID'); g(8, st === 'half' ? 'ARQ-MEIA-PAREDE' : 'ARQ-PAREDE-HACHURA');
      [[10, 20, p0], [11, 21, p1], [12, 22, p3], [13, 23, p2]].forEach(([cx, cy, p]) => { g(cx, f(p[0])); g(cy, f(-p[1])); g(cx + 20, 0); });
    },
    line(x1, y1, x2, y2, st) { if (layerOf[st]) line(layerOf[st], x1, y1, x2, y2); },
    arc(cx, cy, r, a0, a1, st) {
      const sweep = ((a1 - a0 + 540) % 360) - 180;
      // y invertido no DXF: ângulo θ vira -θ e o sentido se inverte
      const [s, e] = sweep > 0 ? [-(a0 + sweep), -a0] : [-a0, -(a0 + sweep)];
      g(0, 'ARC'); g(8, layerOf[st] || 'ARQ-ESQUADRIA-GIRO'); g(10, f(cx)); g(20, f(-cy)); g(30, 0); g(40, f(r)); g(50, f((s + 360) % 360)); g(51, f((e + 360) % 360));
    },
    text(x, y, str, { angle } = {}) { text('ARQ-TEXTO', x, y, mm(2.5), str, angle ? 90 : 0); },
  }, rooms, plan, { labels: true, noOpeningLabels: true });

  for (const r of rooms) {
    const pts = worldPoints(r);
    if (pts.length < 3) continue;
    const rect = r.shape !== 'poly' || pts.length === 4;
    pts.forEach(([x1, y1], i) => {
      if (rect && i > 1) return;
      const [x2, y2] = pts[(i + 1) % pts.length];
      const len = Math.hypot(x2 - x1, y2 - y1);
      if (len < 0.2) return;
      const nx = (y2 - y1) / len;
      const ny = -(x2 - x1) / len;
      const off = mm(5);
      const a = [x1 - nx * off, y1 - ny * off];
      const b = [x2 - nx * off, y2 - ny * off];
      line('ARQ-COTA', a[0], a[1], b[0], b[1]);
      for (const p of [a, b]) line('ARQ-COTA', p[0] - mm(1), p[1] + mm(1), p[0] + mm(1), p[1] - mm(1));
      const vertical = Math.abs(y2 - y1) > Math.abs(x2 - x1);
      text('ARQ-COTA', (a[0] + b[0]) / 2 - nx * mm(1.6), (a[1] + b[1]) / 2 - ny * mm(1.6), mm(2.5), n2(len), vertical ? 90 : 0);
    });
    const b = bounds(r);
    const cx = (b.minX + b.maxX) / 2 + (r.x || 0);
    const cy = (b.minY + b.maxY) / 2 + (r.y || 0);
    text('ARQ-TEXTO', cx, cy - mm(2), mm(3.5), (r.name || r.kind || '').toUpperCase());
    text('ARQ-TEXTO', cx, cy + mm(2.6), mm(2.5), `A = ${n2(roomArea(r))} m2`);
    const pd = heightsText(r, n2);
    if (pd) text('ARQ-TEXTO', cx, cy + mm(6.4), mm(2.5), `P.D. = ${pd}`);
  }
  const segs = segments(rooms, plan);
  const labels = openingLabels(plan);
  for (const op of plan.openings) {
    const og = openingGeom(op, segs);
    if (!og) continue;
    const side = op.kind === 'door' && op.type !== 'Vão livre' ? -(op.flipSide ? -1 : 1) : (op.flipSide ? -1 : 1);
    const c = [og.c[0] + og.n[0] * side * mm(9), og.c[1] + og.n[1] * side * mm(9)];
    g(0, 'CIRCLE'); g(8, 'ARQ-DESIGNACAO'); g(10, f(c[0])); g(20, f(-c[1])); g(30, 0); g(40, f(mm(3.5)));
    text('ARQ-DESIGNACAO', c[0], c[1], mm(2.5), labels[op.id]);
    const dims = `${n2(op.width)} x ${n2(op.height || 0)}${op.kind === 'window' ? ` / ${n2(op.sill ?? 0)}` : ''}`;
    text('ARQ-DESIGNACAO', c[0] + mm(14), c[1], mm(2.5), dims);
  }
  g(0, 'ENDSEC');
  g(0, 'EOF');
  return new Blob([out.join('\r\n') + '\r\n'], { type: 'application/dxf' });
}

