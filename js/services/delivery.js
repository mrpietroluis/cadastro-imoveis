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

export { buildPrancha, buildDXF } from './drawing.js';
import { brandLogo } from './drawing.js';

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
    doc.setDrawColor(30, 79, 160).setLineWidth(0.5).line(M, y, M + W, y);
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

  const logo = await brandLogo();
  if (logo) doc.addImage(logo, 'JPEG', 210 - M - 52, M - 4, 52, (52 * 203) / 900);
  doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(85, 85, 85).text(company.empresa || 'COTA ZERO', M, y);
  y += 8;
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
