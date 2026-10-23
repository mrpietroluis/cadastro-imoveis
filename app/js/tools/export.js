// Ferramenta: exportar ficha em PDF, planilha CSV e backup/restauração em JSON.
// O PDF junta o que cada ferramenta ativa oferece no método report(), então ferramentas novas
// entram na ficha automaticamente.
import { db } from '../db.js';
import { h, fmt, fmtDate, toast, shareOrDownload, blobToDataURL, dataURLToBlob, slug } from '../ui.js';
import { roomArea, roomPerimeter, wallArea, isPoly } from '../geometry.js';
import { loadRooms } from './rooms.js';

let jsPDFReady;
function loadJsPDF() {
  jsPDFReady ||= new Promise((resolve, reject) => {
    if (window.jspdf) return resolve(window.jspdf.jsPDF);
    const s = document.createElement('script');
    s.src = 'vendor/jspdf.umd.min.js';
    s.onload = () => resolve(window.jspdf.jsPDF);
    s.onerror = () => reject(new Error('Não carregou o gerador de PDF.'));
    document.head.append(s);
  });
  return jsPDFReady;
}

const PROPERTY_LABELS = [
  ['kind', 'Tipo'], ['address', 'Endereço'], ['registry', 'Inscrição / matrícula'], ['owner', 'Proprietário / contato'],
  ['landArea', 'Área do terreno (m²)'], ['visitDate', 'Data da vistoria'], ['notes', 'Observações'],
];

export async function buildPDF(ctx) {
  const jsPDF = await loadJsPDF();
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const M = 15;
  const W = 210 - M * 2;
  const BOTTOM = 297 - M;
  let y = M;

  const ensure = (need) => {
    if (y + need > BOTTOM) {
      doc.addPage();
      y = M;
    }
  };
  const heading = (text) => {
    ensure(14);
    y += 4;
    doc.setFont('helvetica', 'bold').setFontSize(13).setTextColor(15, 23, 42);
    doc.text(text, M, y);
    y += 2;
    doc.setDrawColor(37, 99, 235).setLineWidth(0.6).line(M, y, M + W, y);
    y += 6;
  };

  const p = ctx.property;
  doc.setFont('helvetica', 'bold').setFontSize(18).setTextColor(15, 23, 42);
  doc.text(p.name || 'Imóvel', M, y + 4);
  y += 10;
  doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(100, 116, 139);
  doc.text(`Ficha de cadastro · gerada em ${new Date().toLocaleString('pt-BR')}`, M, y);
  y += 6;

  heading('Dados do imóvel');
  doc.setFontSize(10);
  for (const [key, label] of PROPERTY_LABELS) {
    if (!p[key]) continue;
    const value = key === 'visitDate' ? new Date(p[key] + 'T12:00').toLocaleDateString('pt-BR') : String(p[key]);
    const lines = doc.splitTextToSize(value, W - 50);
    ensure(lines.length * 5 + 2);
    doc.setFont('helvetica', 'bold').setTextColor(71, 85, 105).text(label, M, y);
    doc.setFont('helvetica', 'normal').setTextColor(15, 23, 42).text(lines, M + 50, y);
    y += lines.length * 5 + 1.5;
  }

  const blocks = [];
  for (const tool of ctx.tools) if (tool.report) blocks.push(...(await tool.report(ctx)));

  let photoCol = 0;
  let photoRowH = 0;
  let lastGroup = null;
  for (const b of blocks) {
    if (b.group !== 'Fotos' && photoCol) { y += photoRowH; photoCol = 0; photoRowH = 0; }
    if (b.type === 'table') {
      heading(b.title);
      drawTable(doc, b, M, W, () => y, (v) => (y = v), ensure);
    } else if (b.type === 'image' && b.group === 'Fotos') {
      if (lastGroup !== 'Fotos') heading('Fotos');
      const colW = (W - 6) / 2;
      const ih = Math.min((colW * b.h) / b.w, 95);
      const iw = (ih * b.w) / b.h;
      if (photoCol === 0) ensure(ih + 10);
      const x = M + photoCol * (colW + 6);
      doc.addImage(b.dataUrl, 'JPEG', x, y, iw, ih, undefined, 'FAST');
      doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(71, 85, 105);
      doc.text(doc.splitTextToSize(b.title, colW)[0], x, y + ih + 4);
      photoRowH = Math.max(photoRowH, ih + 9);
      photoCol++;
      if (photoCol === 2) { y += photoRowH; photoCol = 0; photoRowH = 0; }
    } else if (b.type === 'image') {
      const ih = Math.min((W * b.h) / b.w, 200);
      const iw = (ih * b.w) / b.h;
      if (y + ih + 14 > BOTTOM) { doc.addPage(); y = M; }
      heading(b.title);
      doc.setDrawColor(203, 213, 225).setLineWidth(0.2).rect(M, y, W, ih);
      doc.addImage(b.dataUrl, b.dataUrl.startsWith('data:image/png') ? 'PNG' : 'JPEG', M + (W - iw) / 2, y, iw, ih);
      y += ih + 4;
    }
    lastGroup = b.group;
  }

  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(148, 163, 184);
    doc.text(`${p.name || 'Imóvel'} · página ${i} de ${pages}`, 105, 297 - 8, { align: 'center' });
  }
  return doc.output('blob');
}

function drawTable(doc, block, M, W, getY, setY, ensure) {
  const n = block.head.length;
  const weights = block.head.map((_, i) => (i === 0 ? 1.7 : i === n - 1 ? 1.6 : 1));
  const total = weights.reduce((a, b) => a + b, 0);
  const widths = weights.map((w) => (w / total) * W);
  const row = (cells, header, last) => {
    doc.setFontSize(8).setFont('helvetica', header || last ? 'bold' : 'normal');
    const lines = cells.map((c, i) => doc.splitTextToSize(String(c ?? ''), widths[i] - 2));
    const rh = Math.max(...lines.map((l) => l.length)) * 3.6 + 2.4;
    ensure(rh);
    let y = getY();
    if (header) doc.setFillColor(241, 245, 249).rect(M, y, W, rh, 'F');
    let x = M;
    lines.forEach((l, i) => {
      doc.setTextColor(header ? 71 : 15, header ? 85 : 23, header ? 105 : 42);
      doc.text(l, i > 1 && i < n - 1 ? x + widths[i] - 1 : x + 1, y + 3.6, { align: i > 1 && i < n - 1 ? 'right' : 'left' });
      x += widths[i];
    });
    doc.setDrawColor(226, 232, 240).setLineWidth(0.2).line(M, y + rh, M + W, y + rh);
    setY(y + rh);
  };
  row(block.head, true);
  block.rows.forEach((r, i) => row(r, false, i === block.rows.length - 1 && r[0] === 'Total'));
  setY(getY() + 4);
}

export async function buildCSV(ctx) {
  const rooms = await loadRooms(db, ctx.property.id);
  const esc = (v) => {
    const s = String(v ?? '');
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const num = (n) => (n == null || n === '' ? '' : fmt(n, 3));
  const lines = [
    ['Imóvel', 'Endereço', 'Cômodo', 'Tipo', 'Forma', 'Largura (m)', 'Comprimento (m)', 'Pé-direito (m)', 'Área (m²)', 'Perímetro (m)', 'Área de paredes (m²)', 'Observações'],
    ...rooms.map((r) => [
      ctx.property.name, ctx.property.address, r.name, r.kind, isPoly(r) ? 'Irregular' : 'Retangular',
      isPoly(r) ? '' : num(r.width), isPoly(r) ? '' : num(r.length), num(r.height),
      num(roomArea(r)), num(roomPerimeter(r)), r.height ? num(wallArea(r)) : '', r.notes,
    ]),
  ];
  return new Blob(['﻿' + lines.map((l) => l.map(esc).join(';')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
}

// ---------- Backup ----------
export async function buildBackup(propertyId) {
  const props = propertyId ? [await db.get('properties', propertyId)] : await db.all('properties');
  const ids = new Set(props.map((p) => p.id));
  const out = { app: 'cadastro-imoveis', version: 1, exportedAt: new Date().toISOString(), properties: props };
  for (const name of ['rooms', 'photos', 'measures']) {
    const items = (await db.all(name)).filter((x) => ids.has(x.propertyId));
    if (name === 'photos') {
      for (const ph of items) ph.blob = await blobToDataURL(ph.blob);
    }
    out[name] = items;
  }
  return new Blob([JSON.stringify(out)], { type: 'application/json' });
}

export async function restoreBackup(file) {
  const data = JSON.parse(await file.text());
  if (data.app !== 'cadastro-imoveis') throw new Error('Arquivo não é um backup deste app.');
  for (const p of data.properties || []) await db.put('properties', p);
  for (const name of ['rooms', 'photos', 'measures']) {
    for (const item of data[name] || []) {
      if (name === 'photos' && typeof item.blob === 'string') item.blob = await dataURLToBlob(item.blob);
      await db.put(name, item);
    }
  }
  return (data.properties || []).length;
}

export function restoreButton(label = 'Restaurar backup', onDone) {
  const input = h('input', { type: 'file', accept: 'application/json,.json', hidden: true });
  input.addEventListener('change', async () => {
    const f = input.files[0];
    input.value = '';
    if (!f) return;
    try {
      const n = await restoreBackup(f);
      toast(`${n} imóve${n === 1 ? 'l restaurado' : 'is restaurados'}.`);
      onDone?.();
    } catch (err) {
      toast('Falhou: ' + err.message, 5000);
    }
  });
  return [input, h('button', { class: 'btn', onclick: () => input.click() }, label)];
}

export default {
  id: 'export',
  name: 'Exportar',
  description: 'Gera a ficha do imóvel em PDF (dados, cômodos, croqui e fotos), planilha CSV para Excel e backups.',

  async render(body, ctx) {
    const base = slug(ctx.property.name) + '-' + fmtDate(Date.now()).replace(/\//g, '-');
    const run = (fn) => async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      const old = btn.textContent;
      btn.textContent = 'Gerando…';
      try {
        await fn();
      } catch (err) {
        console.error(err);
        toast('Falhou: ' + err.message, 5000);
      } finally {
        btn.disabled = false;
        btn.textContent = old;
      }
    };
    const action = (title, desc, label, fn) => h('div', { class: 'card export-card' },
      h('div', {}, h('h3', {}, title), h('p', { class: 'muted' }, desc)),
      h('button', { class: 'btn primary', onclick: run(fn) }, label));

    body.replaceChildren(
      h('div', { class: 'export-list' },
        action('Ficha em PDF', 'Dados do imóvel, tabela de cômodos, croqui e fotos anotadas — tudo das ferramentas ativas.', 'Gerar PDF',
          async () => shareOrDownload(await buildPDF(ctx), `${base}.pdf`)),
        action('Planilha (CSV)', 'Cômodos com medidas e áreas, pronta para abrir no Excel ou Google Planilhas.', 'Gerar CSV',
          async () => shareOrDownload(await buildCSV(ctx), `${base}.csv`)),
        action('Backup deste imóvel', 'Arquivo .json com tudo, inclusive fotos. Guarde no iCloud/Arquivos.', 'Fazer backup',
          async () => shareOrDownload(await buildBackup(ctx.property.id), `backup-${base}.json`)),
        action('Backup completo', 'Todos os imóveis do aparelho num arquivo só.', 'Backup de tudo',
          async () => shareOrDownload(await buildBackup(null), `backup-cadastro-${fmtDate(Date.now()).replace(/\//g, '-')}.json`)),
        h('div', { class: 'card export-card' },
          h('div', {}, h('h3', {}, 'Restaurar'), h('p', { class: 'muted' }, 'Importa um backup .json (junta com o que já existe).')),
          ...restoreButton('Escolher arquivo', () => ctx.rerender())))
    );
  },
};
