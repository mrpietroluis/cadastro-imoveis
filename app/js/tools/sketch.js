// Ferramenta: croqui da planta. Cada cômodo vira uma forma arrastável, com cotas.
// Retângulos usam largura × comprimento; formas irregulares são desenhadas parede a parede.
import { uid } from '../db.js';
import { h, fmt, measureField, arm, confirmDialog } from '../ui.js';
import { roomPoints, roomArea, closingGap, bounds, DIR_ARROWS, DIRS, ROOM_KINDS } from '../geometry.js';
import { loadRooms, heightEditor, newRoomHeights } from './rooms.js';

const SNAP = 0.15; // metros: distância para "grudar" na parede de outro cômodo
const GRID = 0.05;

function worldPoints(room) {
  return roomPoints(room).map(([x, y]) => [x + (room.x || 0), y + (room.y || 0)]);
}

function contentBounds(rooms) {
  const b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const r of rooms) {
    for (const [x, y] of worldPoints(r)) {
      b.minX = Math.min(b.minX, x); b.minY = Math.min(b.minY, y);
      b.maxX = Math.max(b.maxX, x); b.maxY = Math.max(b.maxY, y);
    }
  }
  if (!Number.isFinite(b.minX)) return { minX: 0, minY: 0, maxX: 10, maxY: 8 };
  return b;
}

function fitView(rooms, w, h, pad = 60) {
  const b = contentBounds(rooms);
  const bw = Math.max(b.maxX - b.minX, 1);
  const bh = Math.max(b.maxY - b.minY, 1);
  const scale = Math.min((w - pad * 2) / bw, (h - pad * 2) / bh, 120);
  return { scale, ox: (w - bw * scale) / 2 - b.minX * scale, oy: (h - bh * scale) / 2 - b.minY * scale };
}

export function drawPlan(g, rooms, v, { selectedId, width, height, print } = {}) {
  g.save();
  g.fillStyle = '#fff';
  g.fillRect(0, 0, width, height);
  if (!print) {
    // grade de 1 m
    g.strokeStyle = '#eef1f5';
    g.lineWidth = 1;
    const step = v.scale;
    if (step > 8) {
      for (let x = v.ox % step; x < width; x += step) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, height); g.stroke(); }
      for (let y = v.oy % step; y < height; y += step) { g.beginPath(); g.moveTo(0, y); g.lineTo(width, y); g.stroke(); }
    }
  }
  const tx = (x) => v.ox + x * v.scale;
  const ty = (y) => v.oy + y * v.scale;

  for (const r of rooms) {
    const pts = worldPoints(r);
    if (pts.length < 3) continue;
    const sel = r.id === selectedId;
    g.beginPath();
    pts.forEach(([x, y], i) => (i ? g.lineTo(tx(x), ty(y)) : g.moveTo(tx(x), ty(y))));
    g.closePath();
    g.fillStyle = sel ? 'rgba(37,99,235,0.10)' : 'rgba(15,23,42,0.03)';
    g.fill();
    g.lineWidth = sel ? 4 : 3;
    g.strokeStyle = sel ? '#2563eb' : '#1f2937';
    g.stroke();

    // cotas de cada parede
    g.font = '600 12px system-ui, sans-serif';
    g.fillStyle = '#475569';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const rect = r.shape !== 'poly';
    pts.forEach(([x1, y1], i) => {
      if (rect && i > 1) return; // retângulo: só topo e lateral direita
      const [x2, y2] = pts[(i + 1) % pts.length];
      const len = Math.hypot(x2 - x1, y2 - y1);
      if (len * v.scale < 30) return;
      const mx = tx((x1 + x2) / 2);
      const my = ty((y1 + y2) / 2);
      const nx = (y2 - y1) / len; // normal para dentro (sentido horário)
      const ny = -(x2 - x1) / len;
      g.save();
      g.translate(mx - nx * 12, my - ny * 12);
      if (Math.abs(y2 - y1) > Math.abs(x2 - x1)) g.rotate(-Math.PI / 2);
      g.fillText(fmt(len), 0, 0);
      g.restore();
    });

    // nome e área no centro
    const b = bounds(r);
    const cx = tx((b.minX + b.maxX) / 2 + (r.x || 0));
    const cy = ty((b.minY + b.maxY) / 2 + (r.y || 0));
    g.fillStyle = '#0f172a';
    g.font = '700 14px system-ui, sans-serif';
    g.fillText(r.name || r.kind || '', cx, cy - 9);
    g.font = '500 12px system-ui, sans-serif';
    g.fillStyle = '#475569';
    g.fillText(`${fmt(roomArea(r))} m²`, cx, cy + 9);
  }
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

// Ajusta (x, y) para alinhar bordas com outros cômodos próximos.
function snap(room, rooms, x, y) {
  const b = bounds(room);
  const mine = { l: x + b.minX, r: x + b.maxX, t: y + b.minY, b: y + b.maxY };
  let bestX = { d: SNAP, v: null };
  let bestY = { d: SNAP, v: null };
  for (const o of rooms) {
    if (o === room) continue;
    const ob = bounds(o);
    const other = { l: o.x + ob.minX, r: o.x + ob.maxX, t: o.y + ob.minY, b: o.y + ob.maxY };
    for (const [a, c] of [['l', 'r'], ['r', 'l'], ['l', 'l'], ['r', 'r']]) {
      const d = Math.abs(mine[a] - other[c]);
      if (d < bestX.d) bestX = { d, v: x + other[c] - mine[a] };
    }
    for (const [a, c] of [['t', 'b'], ['b', 't'], ['t', 't'], ['b', 'b']]) {
      const d = Math.abs(mine[a] - other[c]);
      if (d < bestY.d) bestY = { d, v: y + other[c] - mine[a] };
    }
  }
  const round = (n) => Math.round(n / GRID) * GRID;
  return [bestX.v ?? round(x), bestY.v ?? round(y)];
}

export default {
  id: 'sketch',
  name: 'Croqui',
  description: 'Planta baixa simples: arraste os cômodos para montar o imóvel ou desenhe cômodos irregulares parede por parede com a trena.',

  async render(body, ctx) {
    const { db, property } = ctx;
    const rooms = await loadRooms(db, property.id);
    let selected = null;
    let v = null;

    const canvas = h('canvas', { class: 'plan' });
    const side = h('div', { class: 'plan-props', hidden: true });
    const wrap = h('div', { class: 'plan-wrap' }, canvas);
    const hint = h('div', { class: 'plan-hint' }, 'Toque num cômodo para ver as propriedades. Arraste para encaixar nos vizinhos.');
    const g = canvas.getContext('2d');

    // Posições iniciais: cômodos sem posição vão lado a lado.
    let cursor = 0;
    for (const r of rooms) if (r.placed) cursor = Math.max(cursor, (r.x || 0) + bounds(r).maxX + 0.5);
    for (const r of rooms) {
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
      const [w, hh] = [wrap.clientWidth, wrap.clientHeight];
      drawPlan(g, rooms, v, { selectedId: selected?.id, width: w, height: hh });
    };
    const fit = () => {
      const [w, hh] = size();
      v = fitView(rooms, w, hh);
      draw();
    };
    const zoom = (f, cx = wrap.clientWidth / 2, cy = wrap.clientHeight / 2) => {
      v.ox = cx - (cx - v.ox) * f;
      v.oy = cy - (cy - v.oy) * f;
      v.scale *= f;
      draw();
    };

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
        return;
      }
      const p = toWorld(e);
      const hit = [...rooms].reverse().find((r) => pointInPoly(p, worldPoints(r)));
      drag = { room: hit, start: [e.clientX, e.clientY], origin: hit ? [hit.x, hit.y] : [v.ox, v.oy], moved: false };
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
      if (drag.room) {
        [drag.room.x, drag.room.y] = snap(drag.room, rooms, drag.origin[0] + dx / v.scale, drag.origin[1] + dy / v.scale);
      } else {
        v.ox = drag.origin[0] + dx;
        v.oy = drag.origin[1] + dy;
      }
      draw();
    });
    const end = (e) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;
      if (!drag) return;
      if (drag.room && drag.moved) db.put('rooms', drag.room);
      if (!drag.moved) select(drag.room || null);
      drag = null;
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rc = canvas.getBoundingClientRect();
      zoom(e.deltaY < 0 ? 1.1 : 1 / 1.1, e.clientX - rc.left, e.clientY - rc.top);
    }, { passive: false });

    // ---------- painel lateral ----------
    const save = async (room) => {
      await db.put('rooms', room);
      draw();
    };

    function select(room) {
      selected = room;
      draw();
      side.hidden = !room;
      hint.hidden = !!room;
      if (!room) return side.replaceChildren();
      const name = h('input', { value: room.name || '', placeholder: 'Nome' });
      name.addEventListener('change', () => { room.name = name.value; save(room); });

      const shapeBtn = (shape, label) => h('button', {
        class: 'seg' + ((room.shape || 'rect') === shape ? ' on' : ''),
        onclick: async () => {
          if (shape === 'poly' && !(room.walls || []).length) {
            const w = room.width || 3;
            const l = room.length || 3;
            room.walls = [{ len: w, dir: 0 }, { len: l, dir: 90 }, { len: w, dir: 180 }, { len: l, dir: 270 }];
          }
          room.shape = shape;
          await save(room);
          select(room);
        },
      }, label);

      const kind = h('select', {}, ...ROOM_KINDS.map((k) => h('option', { selected: room.kind === k }, k)));
      kind.addEventListener('change', () => { room.kind = kind.value; save(room); });
      const areaOut = h('b', {}, `${fmt(roomArea(room))} m²`);
      const saveArea = async (r) => { await save(r); areaOut.textContent = `${fmt(roomArea(r))} m²`; };
      const parts = [
        h('div', { class: 'props-head' }, h('b', {}, 'Propriedades do cômodo'), h('button', { class: 'icon-btn', title: 'Fechar', onclick: () => select(null) }, '✕')),
        h('label', { class: 'field' }, h('span', {}, 'Nome'), name),
        h('label', { class: 'field' }, h('span', {}, 'Tipo'), kind),
        h('div', { class: 'field' }, h('span', {}, 'Forma'), h('div', { class: 'segs' }, shapeBtn('rect', 'Retângulo'), shapeBtn('poly', 'Parede por parede'))),
      ];

      if ((room.shape || 'rect') === 'rect') {
        parts.push(
          measureField({ label: 'Largura', value: room.width, onChange: (n) => { room.width = n; saveArea(room); } }),
          measureField({ label: 'Comprimento', value: room.length, onChange: (n) => { room.length = n; saveArea(room); } }),
          h('button', { class: 'btn block', onclick: () => { room.rot = room.rot === 90 ? 0 : 90; save(room); } }, '↻ Girar 90°')
        );
      } else {
        parts.push(wallEditor(room));
      }
      parts.push(
        h('div', { class: 'field' }, h('span', {}, 'Pé-direito'), heightEditor(room, () => save(room), ctx)),
        h('p', {}, 'Área: ', areaOut),
        h('button', {
          class: 'btn danger block',
          onclick: async () => {
            if (!(await confirmDialog(`Excluir “${room.name || room.kind}”?`))) return;
            await db.del('rooms', room.id);
            rooms.splice(rooms.indexOf(room), 1);
            select(null);
          },
        }, 'Excluir cômodo')
      );
      side.replaceChildren(...parts);
    }

    function wallEditor(room) {
      room.walls ||= [];
      const box = h('div', { class: 'walls' });
      const gap = h('p', { class: 'gap' });
      const showGap = () => {
        const d = closingGap(room);
        gap.textContent = room.walls.length < 3 ? 'Meça cada parede em sequência, no sentido horário.'
          : d < 0.02 ? '✓ Contorno fechado.' : `Falta fechar: ${fmt(d)} m`;
        gap.className = 'gap ' + (d < 0.02 && room.walls.length >= 3 ? 'ok' : 'warn');
      };
      const rows = () => {
        box.replaceChildren(...room.walls.map((w, i) => {
          const dirs = h('div', { class: 'dirs' }, ...[0, 90, 180, 270].map((d) =>
            h('button', { class: 'dir' + (w.dir === d ? ' on' : ''), onclick: () => { w.dir = d; save(room); rows(); } }, DIR_ARROWS[d])));
          return h('div', { class: 'wall-row' },
            measureField({
              label: `Parede ${i + 1}`,
              value: w.len,
              onChange: (n) => {
                w.len = n || 0;
                save(room);
                showGap();
                // Mediu a última parede e o contorno ainda não fechou: já abre a próxima.
                if (i === room.walls.length - 1 && w.len > 0 && (room.walls.length < 3 || closingGap(room) > 0.02)) addWall();
              },
            }),
            dirs,
            h('button', { class: 'icon-btn', onclick: () => { room.walls.splice(i, 1); save(room); rows(); } }, '✕'));
        }));
        showGap();
      };
      rows();
      const addWall = () => {
        const last = room.walls[room.walls.length - 1];
        room.walls.push({ len: null, dir: last ? (last.dir + 90) % 360 : 0 });
        rows();
        const fields = box.querySelectorAll('.mfield');
        arm(fields[fields.length - 1]);
      };
      const close = () => {
        let [x, y] = [0, 0];
        for (const w of room.walls) { const [dx, dy] = DIRS[w.dir]; x += dx * (w.len || 0); y += dy * (w.len || 0); }
        if (Math.abs(x) > 0.01) room.walls.push({ len: Math.abs(x), dir: x > 0 ? 180 : 0 });
        if (Math.abs(y) > 0.01) room.walls.push({ len: Math.abs(y), dir: y > 0 ? 270 : 90 });
        save(room);
        rows();
      };
      return h('div', {},
        h('p', { class: 'muted' }, 'Cada parede: meça com a trena e escolha a direção em que ela segue (sentido horário). A próxima parede vira 90° sozinha.'),
        box, gap,
        h('div', { class: 'row' },
          h('button', { class: 'btn primary', onclick: addWall }, '+ Parede'),
          h('button', { class: 'btn', onclick: close }, 'Fechar contorno')));
    }

    async function addRoom(shape) {
      const b = contentBounds(rooms);
      const room = {
        id: uid(), propertyId: property.id, kind: 'Outro', name: `Cômodo ${rooms.length + 1}`,
        order: rooms.length, shape, x: rooms.length ? b.maxX + 0.5 : 0, y: rooms.length ? b.minY : 0, placed: true,
        width: shape === 'rect' ? 3 : null, length: shape === 'rect' ? 3 : null,
        walls: shape === 'poly' ? [{ len: null, dir: 0 }] : [],
        heights: newRoomHeights(property),
      };
      room.height = room.heights[0];
      await db.put('rooms', room);
      rooms.push(room);
      fit();
      select(room);
      arm(side.querySelector('.mfield'));
    }

    body.replaceChildren(
      h('div', { class: 'plan-stage' },
        wrap,
        h('div', { class: 'plan-add' },
          h('button', { class: 'btn primary big', onclick: () => addRoom('rect') }, '+ Cômodo'),
          h('button', { class: 'btn', onclick: () => addRoom('poly') }, '+ Parede por parede')),
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
    select(null);
    requestAnimationFrame(fit);
    const ro = new ResizeObserver(() => { if (v) { size(); draw(); } });
    ro.observe(wrap);
  },

  async report(ctx) {
    const rooms = await loadRooms(ctx.db, ctx.property.id);
    if (!rooms.length) return [];
    const width = 1600;
    const height = 1100;
    const c = document.createElement('canvas');
    c.width = width;
    c.height = height;
    const g = c.getContext('2d');
    g.scale(2, 2);
    drawPlan(g, rooms, fitView(rooms, width / 2, height / 2, 40), { width: width / 2, height: height / 2, print: true });
    return [{ type: 'image', title: 'Croqui', dataUrl: c.toDataURL('image/jpeg', 0.92), w: width, h: height }];
  },
};
