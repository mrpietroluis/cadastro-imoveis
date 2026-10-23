// Ferramenta: fotos do imóvel com anotações (caneta, cotas com a medida da trena e textos).
// As anotações ficam guardadas como vetores, então dá para editar depois sem perder a foto original.
import { uid } from '../db.js';
import { h, fmt, arm, confirmDialog, toast } from '../ui.js';
import { loadRooms } from './rooms.js';

const MAX_SIDE = 2000;
const COLORS = ['#ef4444', '#facc15', '#2563eb', '#ffffff', '#111827'];

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Não consegui abrir a imagem.'));
    img.src = src;
  });
}

async function importFile(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const k = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * k);
    c.height = Math.round(img.naturalHeight * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.85));
    return { blob, w: c.width, h: c.height };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function drawAnnotations(g, anns, w, hh) {
  const base = Math.max(w, hh) / 400;
  for (const a of anns) {
    g.strokeStyle = g.fillStyle = a.color;
    g.lineCap = g.lineJoin = 'round';
    if (a.type === 'pen') {
      g.lineWidth = base * 1.6;
      g.beginPath();
      a.points.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
      g.stroke();
    } else if (a.type === 'dim') {
      const [x1, y1] = a.a;
      const [x2, y2] = a.b;
      const ang = Math.atan2(y2 - y1, x2 - x1);
      g.lineWidth = base * 1.2;
      g.beginPath();
      g.moveTo(x1, y1);
      g.lineTo(x2, y2);
      g.stroke();
      for (const [x, y, dir] of [[x1, y1, ang], [x2, y2, ang + Math.PI]]) {
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x + Math.cos(dir + 0.4) * base * 7, y + Math.sin(dir + 0.4) * base * 7);
        g.lineTo(x + Math.cos(dir - 0.4) * base * 7, y + Math.sin(dir - 0.4) * base * 7);
        g.closePath();
        g.fill();
      }
      label(g, a.text || 'meça…', (x1 + x2) / 2, (y1 + y2) / 2, base, a.color, !a.text);
    } else if (a.type === 'text') {
      label(g, a.text, a.at[0], a.at[1], base, a.color);
    }
  }
}

function label(g, text, x, y, base, color, pending) {
  g.font = `700 ${Math.round(base * 9)}px system-ui, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const w = g.measureText(text).width + base * 8;
  const hh = base * 13;
  g.fillStyle = color === '#ffffff' || color === '#facc15' ? 'rgba(17,24,39,0.85)' : 'rgba(255,255,255,0.92)';
  g.fillRect(x - w / 2, y - hh / 2, w, hh);
  g.fillStyle = pending ? '#94a3b8' : color === '#ffffff' ? '#ffffff' : color === '#facc15' ? '#facc15' : color;
  g.fillText(text, x, y);
}

export async function renderAnnotated(photo, type = 'image/jpeg') {
  const url = URL.createObjectURL(photo.blob);
  try {
    const img = await loadImage(url);
    const c = document.createElement('canvas');
    c.width = photo.w;
    c.height = photo.h;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0, c.width, c.height);
    drawAnnotations(g, photo.anns || [], c.width, c.height);
    return c.toDataURL(type, 0.85);
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function openEditor(photo, ctx, rooms, onClose) {
  const { db } = ctx;
  photo.anns ||= [];
  let tool = 'dim';
  let color = COLORS[0];
  let current = null;
  let pendingDim = null;

  const url = URL.createObjectURL(photo.blob);
  const img = await loadImage(url);
  const canvas = h('canvas', { class: 'photo-canvas' });
  const g = canvas.getContext('2d');
  const stage = h('div', { class: 'photo-stage' }, canvas);
  const textInput = h('input', { class: 'ann-text', placeholder: 'Texto / cota manual' });

  // Alvo invisível para a trena: a próxima medida vira o texto da cota pendente.
  const target = h('span', { class: 'dim-target' });
  target.setValue = (m) => {
    if (!pendingDim) return;
    pendingDim.text = `${fmt(m)} m`;
    pendingDim = null;
    arm(null);
    redraw();
    persist();
  };

  const redraw = () => {
    g.drawImage(img, 0, 0, canvas.width, canvas.height);
    drawAnnotations(g, current ? [...photo.anns, current] : photo.anns, canvas.width, canvas.height);
  };
  const layout = () => {
    canvas.width = photo.w;
    canvas.height = photo.h;
    const k = Math.min(stage.clientWidth / photo.w, stage.clientHeight / photo.h);
    canvas.style.width = photo.w * k + 'px';
    canvas.style.height = photo.h * k + 'px';
    redraw();
  };
  const persist = () => db.put('photos', photo);
  const pos = (e) => {
    const rc = canvas.getBoundingClientRect();
    return [((e.clientX - rc.left) / rc.width) * photo.w, ((e.clientY - rc.top) / rc.height) * photo.h];
  };

  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    const p = pos(e);
    if (tool === 'pen') current = { type: 'pen', color, points: [p] };
    else if (tool === 'dim') current = { type: 'dim', color, a: p, b: p, text: '' };
    else if (tool === 'text') {
      if (!textInput.value.trim()) return toast('Escreva o texto na barra antes de tocar na foto.');
      photo.anns.push({ type: 'text', color, at: p, text: textInput.value.trim() });
      redraw();
      persist();
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!current) return;
    const p = pos(e);
    if (current.type === 'pen') current.points.push(p);
    else current.b = p;
    redraw();
  });
  canvas.addEventListener('pointerup', () => {
    if (!current) return;
    const done = current;
    current = null;
    if (done.type === 'dim') {
      if (Math.hypot(done.b[0] - done.a[0], done.b[1] - done.a[1]) < 10) return redraw();
      if (textInput.value.trim()) done.text = textInput.value.trim();
      else {
        pendingDim = done;
        arm(target);
        toast('Agora meça com a trena — o valor entra na cota.');
      }
    }
    photo.anns.push(done);
    redraw();
    persist();
  });

  const toolBtn = (id, label) => h('button', {
    class: 'seg' + (tool === id ? ' on' : ''),
    onclick: (e) => {
      tool = id;
      e.currentTarget.parentNode.querySelectorAll('.seg').forEach((b) => b.classList.remove('on'));
      e.currentTarget.classList.add('on');
    },
  }, label);
  const swatches = h('div', { class: 'swatches' }, ...COLORS.map((c) => h('button', {
    class: 'swatch' + (c === color ? ' on' : ''),
    style: { background: c },
    onclick: (e) => {
      color = c;
      swatches.querySelectorAll('.swatch').forEach((b) => b.classList.remove('on'));
      e.currentTarget.classList.add('on');
    },
  })));
  const roomSel = h('select', {}, h('option', { value: '' }, 'Sem cômodo'), ...rooms.map((r) => h('option', { value: r.id, selected: r.id === photo.roomId }, r.name || r.kind)));
  roomSel.addEventListener('change', () => { photo.roomId = roomSel.value || null; persist(); });
  const caption = h('input', { placeholder: 'Legenda', value: photo.caption || '' });
  caption.addEventListener('change', () => { photo.caption = caption.value; persist(); });

  const close = () => {
    arm(null);
    URL.revokeObjectURL(url);
    modal.remove();
    window.removeEventListener('resize', layout);
    onClose();
  };
  const modal = h('div', { class: 'modal photo-editor' },
    h('div', { class: 'editor-bar' },
      h('div', { class: 'segs' }, toolBtn('dim', 'Cota'), toolBtn('pen', 'Caneta'), toolBtn('text', 'Texto')),
      swatches,
      textInput,
      h('button', { class: 'btn', onclick: () => { photo.anns.pop(); pendingDim = null; redraw(); persist(); } }, 'Desfazer'),
      h('button', { class: 'btn primary', onclick: close }, 'Concluir')),
    stage,
    h('div', { class: 'editor-bar' },
      roomSel, caption,
      h('button', {
        class: 'btn danger',
        onclick: async () => {
          if (!(await confirmDialog('Excluir esta foto?'))) return;
          await db.del('photos', photo.id);
          close();
        },
      }, 'Excluir foto')),
    target);
  document.body.append(modal);
  window.addEventListener('resize', layout);
  requestAnimationFrame(layout);
}

export default {
  id: 'photos',
  name: 'Fotos',
  description: 'Fotos do imóvel ligadas aos cômodos, com cotas (valor da trena), desenhos e textos por cima.',

  async render(body, ctx) {
    const { db, property } = ctx;
    const rooms = await loadRooms(db, property.id);
    const roomName = (id) => { const r = rooms.find((x) => x.id === id); return r ? r.name || r.kind : ''; };
    const urls = [];
    let filter = '';

    const grid = h('div', { class: 'photo-grid' });
    const draw = async () => {
      urls.splice(0).forEach(URL.revokeObjectURL);
      const photos = (await db.byProperty('photos', property.id)).sort((a, b) => a.createdAt - b.createdAt).filter((p) => !filter || p.roomId === filter);
      grid.replaceChildren(...photos.map((p) => {
        const thumb = h('img', { alt: p.caption || 'Foto', loading: 'lazy' });
        renderAnnotated(p).then((src) => (thumb.src = src));
        return h('button', { class: 'photo-tile', onclick: () => openEditor(p, ctx, rooms, draw) },
          thumb,
          h('span', {}, [roomName(p.roomId), p.caption].filter(Boolean).join(' · ') || 'Sem legenda'),
          p.anns?.length ? h('i', { class: 'badge' }, p.anns.length) : null);
      }));
      if (!photos.length) grid.append(h('div', { class: 'empty' }, 'Nenhuma foto ainda.'));
    };

    const file = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true });
    file.addEventListener('change', async () => {
      const files = [...file.files];
      file.value = '';
      let last;
      for (const f of files) {
        const { blob, w, h: hh } = await importFile(f);
        last = await db.put('photos', { id: uid(), propertyId: property.id, roomId: filter || null, blob, w, h: hh, anns: [], caption: '', createdAt: Date.now() });
      }
      await draw();
      if (files.length === 1 && last) openEditor(last, ctx, rooms, draw);
    });

    const roomFilter = h('select', {}, h('option', { value: '' }, 'Todos os cômodos'), ...rooms.map((r) => h('option', { value: r.id }, r.name || r.kind)));
    roomFilter.addEventListener('change', () => { filter = roomFilter.value; draw(); });

    body.replaceChildren(
      h('div', { class: 'row space' }, roomFilter, h('button', { class: 'btn primary', onclick: () => file.click() }, '+ Foto')),
      file,
      grid
    );
    await draw();
  },

  async report(ctx) {
    const rooms = await loadRooms(ctx.db, ctx.property.id);
    const photos = (await ctx.db.byProperty('photos', ctx.property.id)).sort((a, b) => a.createdAt - b.createdAt);
    const out = [];
    for (const p of photos) {
      const room = rooms.find((r) => r.id === p.roomId);
      out.push({
        type: 'image',
        title: [room?.name || room?.kind, p.caption].filter(Boolean).join(' - ') || 'Foto',
        dataUrl: await renderAnnotated(p),
        w: p.w,
        h: p.h,
        group: 'Fotos',
      });
    }
    return out;
  },
};
