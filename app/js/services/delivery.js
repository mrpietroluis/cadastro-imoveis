// Arquivos de entrega de um serviço: prancha da planta (PDF A3), arquivo CAD (DXF), ficha (PDF A4) e pacote ZIP.
//
// Prancha seguindo as convenções de desenho de arquitetura:
//   NBR 16752 (folhas): A3 paisagem, margem esquerda 25 mm e demais 7 mm, carimbo no canto inferior direito.
//   NBR 6492 (representação de projetos): escala normalizada, cotas em metros, nome/área/pé-direito
//   de cada ambiente, quadro de áreas, título do desenho com escala.
import { loadJsPDF } from '../tools/export.js';
import { roomPoints, roomArea, roomPerimeter, bounds, heightsText } from '../geometry.js';
import { fmt } from '../ui.js';

const ESCALAS = [20, 25, 50, 75, 100, 125, 200, 250, 500, 1000];
const n2 = (v) => fmt(v, 2);

export function worldRooms(rooms) {
  return rooms
    .map((r) => ({ room: r, pts: roomPoints(r).map(([x, y]) => [x + (r.x || 0), y + (r.y || 0)]) }))
    .filter((w) => w.pts.length >= 3);
}

function extents(wr) {
  const xs = wr.flatMap((w) => w.pts.map((p) => p[0]));
  const ys = wr.flatMap((w) => w.pts.map((p) => p[1]));
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

// ---------- Prancha A3 ----------
export async function buildPrancha({ property, rooms, rec, def, company }) {
  const jsPDF = await loadJsPDF();
  const doc = new jsPDF({ unit: 'mm', format: 'a3', orientation: 'landscape' });
  const W = 420;
  const H = 297;
  const ML = 25;
  const M = 7;
  const SELO_W = 175;
  const SELO_H = 62;

  // Moldura
  doc.setDrawColor(0).setLineWidth(0.6).rect(ML, M, W - ML - M, H - 2 * M);

  const wr = worldRooms(rooms);
  const area = { x: ML + 10, y: M + 10, w: W - ML - M - 20, h: H - 2 * M - SELO_H - 24 };
  let escala = 100;
  if (wr.length) {
    const e = extents(wr);
    const bw = Math.max(e.maxX - e.minX, 0.5);
    const bh = Math.max(e.maxY - e.minY, 0.5);
    const margemCotas = 20; // mm para cotas externas
    escala = ESCALAS.find((d) => (bw * 1000) / d <= area.w - 2 * margemCotas && (bh * 1000) / d <= area.h - 2 * margemCotas) || 1000;
    const k = 1000 / escala; // mm de papel por metro
    const ox = area.x + (area.w - bw * k) / 2 - e.minX * k;
    const oy = area.y + (area.h - bh * k) / 2 - e.minY * k;
    const X = (x) => ox + x * k;
    const Y = (y) => oy + y * k;

    // Paredes (traço grosso) e ambientes
    for (const { room, pts } of wr) {
      doc.setLineWidth(0.5).setDrawColor(0);
      pts.forEach(([x1, y1], i) => {
        const [x2, y2] = pts[(i + 1) % pts.length];
        doc.line(X(x1), Y(y1), X(x2), Y(y2));
      });
      // Cotas internas de cada parede (linha fina com marcas a 45°)
      doc.setLineWidth(0.13);
      doc.setFont('helvetica', 'normal').setFontSize(7).setTextColor(0);
      const rect = room.shape !== 'poly' || pts.length === 4;
      pts.forEach(([x1, y1], i) => {
        if (rect && i > 1) return;
        const [x2, y2] = pts[(i + 1) % pts.length];
        const len = Math.hypot(x2 - x1, y2 - y1);
        if (len * k < 8) return;
        const nx = (y2 - y1) / len; // normal para dentro
        const ny = -(x2 - x1) / len;
        const off = 4.5; // mm para dentro do ambiente
        const ax = X(x1) - nx * off;
        const ay = Y(y1) - ny * off;
        const bx = X(x2) - nx * off;
        const by = Y(y2) - ny * off;
        doc.line(ax, ay, bx, by);
        for (const [px, py] of [[ax, ay], [bx, by]]) doc.line(px - 1, py + 1, px + 1, py - 1);
        const vertical = Math.abs(y2 - y1) > Math.abs(x2 - x1);
        const tx = (ax + bx) / 2 - nx * 1.6;
        const ty = (ay + by) / 2 - ny * 1.6;
        doc.text(n2(len), tx, ty, { align: 'center', baseline: 'middle', angle: vertical ? 90 : 0 });
      });
      // Identificação do ambiente
      const b = bounds(room);
      const cx = X((b.minX + b.maxX) / 2 + (room.x || 0));
      const cy = Y((b.minY + b.maxY) / 2 + (room.y || 0));
      doc.setFont('helvetica', 'bold').setFontSize(8.5);
      doc.text((room.name || room.kind || '').toUpperCase(), cx, cy - 3, { align: 'center' });
      doc.setFont('helvetica', 'normal').setFontSize(7.5);
      doc.text(`A = ${n2(roomArea(room))} m²`, cx, cy + 1, { align: 'center' });
      const pd = heightsText(room, n2);
      if (pd) doc.text(`P.D. = ${pd}`, cx, cy + 4.6, { align: 'center' });
    }

    // Cotas externas totais
    doc.setLineWidth(0.13).setFontSize(7.5);
    const top = Y(e.minY) - 10;
    doc.line(X(e.minX), top, X(e.maxX), top);
    for (const x of [e.minX, e.maxX]) {
      doc.line(X(x), top - 2, X(x), top + 2);
      doc.line(X(x) - 1, top + 1, X(x) + 1, top - 1);
    }
    doc.text(n2(e.maxX - e.minX), (X(e.minX) + X(e.maxX)) / 2, top - 1.5, { align: 'center' });
    const left = X(e.minX) - 10;
    doc.line(left, Y(e.minY), left, Y(e.maxY));
    for (const y of [e.minY, e.maxY]) {
      doc.line(left - 2, Y(y), left + 2, Y(y));
      doc.line(left - 1, Y(y) + 1, left + 1, Y(y) - 1);
    }
    doc.text(n2(e.maxY - e.minY), left - 1.5, (Y(e.minY) + Y(e.maxY)) / 2, { align: 'center', angle: 90 });

    // Título do desenho
    const ty = area.y + area.h + 8;
    doc.setFont('helvetica', 'bold').setFontSize(11);
    doc.text('PLANTA BAIXA', area.x + area.w / 2, ty, { align: 'center' });
    const tw = doc.getTextWidth('PLANTA BAIXA');
    doc.setLineWidth(0.4).line(area.x + area.w / 2 - tw / 2, ty + 1.2, area.x + area.w / 2 + tw / 2, ty + 1.2);
    doc.setFont('helvetica', 'normal').setFontSize(8).text(`ESC. 1:${escala}`, area.x + area.w / 2, ty + 5, { align: 'center' });
  } else {
    doc.setFont('helvetica', 'normal').setFontSize(12).text('Nenhum ambiente desenhado ainda.', W / 2, H / 2, { align: 'center' });
  }

  // Quadro de áreas (à esquerda do carimbo)
  const qx = ML + 4;
  const qy = H - M - SELO_H;
  const qw = 120;
  let y = qy + 5;
  doc.setLineWidth(0.3).rect(qx, qy, qw, SELO_H - 4);
  doc.setFont('helvetica', 'bold').setFontSize(8).text('QUADRO DE ÁREAS', qx + qw / 2, y, { align: 'center' });
  y += 4;
  doc.setFontSize(7).text('AMBIENTE', qx + 2, y).text('ÁREA (m²)', qx + 82, y, { align: 'right' }).text('PERÍM. (m)', qx + qw - 2, y, { align: 'right' });
  doc.setLineWidth(0.13).line(qx, y + 1.2, qx + qw, y + 1.2);
  doc.setFont('helvetica', 'normal');
  const linhas = rooms.slice(0, 9);
  for (const r of linhas) {
    y += 4;
    doc.text((r.name || r.kind || '').slice(0, 38), qx + 2, y).text(n2(roomArea(r)), qx + 82, y, { align: 'right' }).text(n2(roomPerimeter(r)), qx + qw - 2, y, { align: 'right' });
  }
  if (rooms.length > linhas.length) doc.text(`(+${rooms.length - linhas.length} ambientes – ver ficha)`, qx + 2, (y += 4));
  const total = rooms.reduce((s, r) => s + roomArea(r), 0);
  doc.setFont('helvetica', 'bold').text('ÁREA ÚTIL TOTAL', qx + 2, qy + SELO_H - 7).text(n2(total), qx + 82, qy + SELO_H - 7, { align: 'right' });

  // Notas
  doc.setFont('helvetica', 'normal').setFontSize(6.5);
  const notas = ['NOTAS:', '1. Cotas e níveis em metros.', '2. Medidas tomadas no local com trena laser.', '3. Representação conforme NBR 6492 e NBR 16752.', '4. Conferir medidas no local antes de executar.'];
  notas.forEach((t, i) => doc.text(t, qx + qw + 6, qy + 5 + i * 3.6));

  // Carimbo (selo)
  const sx = W - M - SELO_W;
  const sy = H - M - SELO_H;
  doc.setLineWidth(0.5).rect(sx, sy, SELO_W, SELO_H);
  const linha = (yy) => doc.setLineWidth(0.2).line(sx, sy + yy, sx + SELO_W, sy + yy);
  const campo = (rotulo, valor, x, yy, w, size = 8) => {
    doc.setFont('helvetica', 'normal').setFontSize(5.5).setTextColor(80);
    doc.text(rotulo, x + 1.5, sy + yy + 2.6);
    doc.setFont('helvetica', 'bold').setFontSize(size).setTextColor(0);
    doc.text(doc.splitTextToSize(String(valor || '-'), w - 3)[0], x + 1.5, sy + yy + 6.6);
  };
  campo('EMPRESA', company.empresa || 'Nome da empresa', sx, 0, SELO_W, 10);
  linha(9);
  campo('SERVIÇO', `${def.name}${def.subtitle ? ' - ' + def.subtitle : ''}`, sx, 9, SELO_W);
  linha(18);
  campo('CONTEÚDO', 'Planta baixa e quadro de áreas', sx, 18, SELO_W);
  linha(27);
  campo('PROPRIETÁRIO / CLIENTE', property.owner, sx, 27, SELO_W / 2);
  campo('MATRÍCULA', property.registry, sx + SELO_W / 2, 27, SELO_W / 2);
  doc.line(sx + SELO_W / 2, sy + 27, sx + SELO_W / 2, sy + 36);
  linha(36);
  campo('ENDEREÇO', property.address, sx, 36, SELO_W);
  linha(45);
  campo('RESPONSÁVEL TÉCNICO', [company.responsavel, company.registro].filter(Boolean).join(' - '), sx, 45, 95, 7);
  campo('ESCALA', `1:${escala}`, sx + 95, 45, 25);
  campo('DATA', new Date().toLocaleDateString('pt-BR'), sx + 120, 45, 30, 7);
  campo('FOLHA', '01/01', sx + 150, 45, 25);
  [95, 120, 150].forEach((dx) => doc.line(sx + dx, sy + 45, sx + dx, sy + SELO_H));
  doc.setFont('helvetica', 'normal').setFontSize(5.5).setTextColor(80).text('ASSINATURA', sx + 1.5, sy + SELO_H - 1.5);
  doc.setTextColor(0);

  return { blob: doc.output('blob'), escala };
}

// ---------- DXF (AutoCAD R12, metros) ----------
export function buildDXF(rooms) {
  const out = [];
  const g = (code, value) => out.push(String(code), String(value));
  const layers = [
    ['ARQ_PAREDE', 7],
    ['ARQ_COTA', 1],
    ['ARQ_TEXTO', 3],
  ];
  g(0, 'SECTION'); g(2, 'HEADER');
  g(9, '$ACADVER'); g(1, 'AC1009');
  g(9, '$INSUNITS'); g(70, 6);
  g(0, 'ENDSEC');
  g(0, 'SECTION'); g(2, 'TABLES');
  g(0, 'TABLE'); g(2, 'LAYER'); g(70, layers.length);
  for (const [name, color] of layers) {
    g(0, 'LAYER'); g(2, name); g(70, 0); g(62, color); g(6, 'CONTINUOUS');
  }
  g(0, 'ENDTAB');
  g(0, 'ENDSEC');
  g(0, 'SECTION'); g(2, 'ENTITIES');
  const f = (v) => (Math.round(v * 10000) / 10000).toString();
  const line = (layer, x1, y1, x2, y2) => {
    g(0, 'LINE'); g(8, layer); g(10, f(x1)); g(20, f(-y1)); g(30, 0); g(11, f(x2)); g(21, f(-y2)); g(31, 0);
  };
  const text = (layer, x, y, hgt, str, rot = 0) => {
    g(0, 'TEXT'); g(8, layer); g(10, f(x)); g(20, f(-y)); g(30, 0); g(40, hgt); g(1, str); g(50, rot);
    g(72, 1); g(11, f(x)); g(21, f(-y)); g(31, 0); // centralizado
  };
  const ascii = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
  for (const { room, pts } of worldRooms(rooms)) {
    pts.forEach(([x1, y1], i) => {
      const [x2, y2] = pts[(i + 1) % pts.length];
      line('ARQ_PAREDE', x1, y1, x2, y2);
      const len = Math.hypot(x2 - x1, y2 - y1);
      if (len < 0.2) return;
      const nx = (y2 - y1) / len;
      const ny = -(x2 - x1) / len;
      const vertical = Math.abs(y2 - y1) > Math.abs(x2 - x1);
      text('ARQ_COTA', (x1 + x2) / 2 - nx * 0.25, (y1 + y2) / 2 - ny * 0.25, 0.12, len.toFixed(2).replace('.', ','), vertical ? 90 : 0);
    });
    const b = bounds(room);
    const cx = (b.minX + b.maxX) / 2 + (room.x || 0);
    const cy = (b.minY + b.maxY) / 2 + (room.y || 0);
    text('ARQ_TEXTO', cx, cy - 0.15, 0.18, ascii((room.name || room.kind || '').toUpperCase()));
    text('ARQ_TEXTO', cx, cy + 0.15, 0.12, `A = ${roomArea(room).toFixed(2).replace('.', ',')} m2`);
  }
  g(0, 'ENDSEC');
  g(0, 'EOF');
  return new Blob([out.join('\r\n') + '\r\n'], { type: 'application/dxf' });
}

// ---------- ZIP (sem compressão) ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export async function buildZip(files) {
  const enc = new TextEncoder();
  const parts = [];
  const central = [];
  let offset = 0;
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  for (const { name, blob } of files) {
    const data = new Uint8Array(await blob.arrayBuffer());
    const nameBytes = enc.encode(name);
    const crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // nomes em UTF-8
    local.setUint16(8, 0, true);
    local.setUint16(10, dosTime, true);
    local.setUint16(12, dosDate, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, nameBytes.length, true);
    parts.push(local.buffer, nameBytes, data);
    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(4, 20, true);
    cd.setUint16(6, 20, true);
    cd.setUint16(8, 0x0800, true);
    cd.setUint16(12, dosTime, true);
    cd.setUint16(14, dosDate, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, data.length, true);
    cd.setUint32(24, data.length, true);
    cd.setUint16(28, nameBytes.length, true);
    cd.setUint32(42, offset, true);
    central.push(cd.buffer, nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const cdSize = central.reduce((s, p) => s + (p.byteLength ?? p.length), 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true);
  end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end.buffer], { type: 'application/zip' });
}

// ---------- Ficha do serviço (PDF A4) ----------
export async function buildFicha({ property, rec, def, steps, valueText, isOn, company }) {
  const jsPDF = await loadJsPDF();
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const M = 15;
  const W = 210 - 2 * M;
  let y = M;
  const ensure = (need) => {
    if (y + need > 297 - M) {
      doc.addPage();
      y = M;
    }
  };
  const heading = (t) => {
    ensure(14);
    y += 3;
    doc.setFont('helvetica', 'bold').setFontSize(12).setTextColor(15, 23, 42).text(t, M, y);
    y += 2;
    doc.setDrawColor(37, 99, 235).setLineWidth(0.5).line(M, y, M + W, y);
    y += 5;
  };
  const para = (t, size = 9.5, bold = false) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal').setFontSize(size).setTextColor(15, 23, 42);
    for (const line of doc.splitTextToSize(t, W)) {
      ensure(5);
      doc.text(line, M, y);
      y += size * 0.45;
    }
  };

  doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(100, 116, 139).text(company.empresa || '', M, y);
  y += 6;
  doc.setFont('helvetica', 'bold').setFontSize(17).setTextColor(15, 23, 42).text(def.name, M, y);
  y += 6;
  doc.setFont('helvetica', 'normal').setFontSize(10).setTextColor(71, 85, 105);
  doc.text(`${property.name || property.address || 'Imóvel'} · ${new Date().toLocaleDateString('pt-BR')}`, M, y);
  y += 5;
  const opts = def.options.filter((o) => rec.options.includes(o.id)).map((o) => o.label);
  if (opts.length) para('Inclui: ' + opts.join('; '), 9);

  for (const st of steps) {
    if (st.kind !== 'form' && st.kind !== 'tool') continue;
    const rows = st.section.fields
      .filter((f) => isOn(f.when, rec.options) && f.type !== 'photo')
      .map((f) => [f.label, valueText(f)])
      .filter(([, v]) => v);
    if (!rows.length) continue;
    heading(st.title);
    for (const [label, value] of rows) {
      const lines = doc.splitTextToSize(value, W - 70);
      ensure(lines.length * 4.6 + 1.5);
      doc.setFont('helvetica', 'bold').setFontSize(9).setTextColor(71, 85, 105).text(doc.splitTextToSize(label, 66), M, y);
      doc.setFont('helvetica', 'normal').setTextColor(15, 23, 42).text(lines, M + 70, y);
      y += Math.max(lines.length, doc.splitTextToSize(label, 66).length) * 4.6 + 1.2;
    }
  }

  const found = def.problems.filter((p) => rec.problems?.[p.id]);
  const custom = (rec.custom || []).filter((c) => c.problem);
  if (found.length || custom.length) {
    heading('Pendências encontradas e soluções');
    for (const p of [...found, ...custom]) {
      para('• ' + p.problem, 9.5, true);
      if (p.solution) para('Solução: ' + p.solution, 9);
      if (p.docs?.length) para('Documentos: ' + p.docs.join(', '), 8.5);
      y += 1.5;
    }
  }
  if (rec.memorial) {
    heading('Memorial descritivo');
    for (const block of rec.memorial.split('\n\n')) {
      para(block, 9.5);
      y += 2;
    }
  }
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal').setFontSize(7.5).setTextColor(148, 163, 184);
    doc.text(`${def.name} · ${property.name || ''} · página ${i} de ${pages}`, 105, 290, { align: 'center' });
  }
  return doc.output('blob');
}
