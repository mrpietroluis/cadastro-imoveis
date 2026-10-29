// Ferramenta: cômodos com medidas da trena, área, perímetro e área de paredes.
import { uid } from '../db.js';
import { h, fmt, measureField, arm, confirmDialog } from '../ui.js';
import { ROOM_KINDS, roomArea, roomPerimeter, wallArea, isPoly, heightsText } from '../geometry.js';

// Pés-direitos de um cômodo: um ou mais. O primeiro medido no imóvel vira o padrão dos próximos cômodos.
export function heightEditor(room, onSave, ctx) {
  room.heights ||= room.height ? [room.height] : [null];
  const box = h('div', { class: 'heights' });
  const sync = () => (room.height = room.heights.find((x) => x > 0) ?? null);
  const draw = () => {
    box.replaceChildren(
      ...room.heights.map((v, i) => h('div', { class: 'height-row' },
        measureField({
          label: room.heights.length > 1 ? `Pé-direito ${i + 1}` : 'Pé-direito',
          value: v,
          onChange: async (n) => {
            room.heights[i] = n;
            sync();
            if (n > 0 && ctx.property.defaultHeight == null) await ctx.saveProperty({ defaultHeight: n });
            onSave();
          },
        }),
        i > 0 ? h('button', { type: 'button', class: 'icon-btn', title: 'Remover', onclick: () => { room.heights.splice(i, 1); sync(); onSave(); draw(); } }, '✕') : null)),
      h('button', {
        type: 'button',
        class: 'btn link-btn',
        onclick: () => {
          room.heights.push(null);
          draw();
          const fs = box.querySelectorAll('.mfield');
          arm(fs[fs.length - 1]);
        },
      }, '+ outro pé-direito'));
  };
  draw();
  return box;
}

export function newRoomHeights(property) {
  return property.defaultHeight > 0 ? [property.defaultHeight] : [null];
}

export async function loadRooms(db, propertyId) {
  return (await db.byProperty('rooms', propertyId)).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

export default {
  id: 'rooms',
  name: 'Cômodos',
  description: 'Lista de cômodos com largura, comprimento e pé-direito vindos da trena. Calcula área, perímetro e área de paredes.',

  async render(body, ctx) {
    const { db, property } = ctx;
    const rooms = await loadRooms(db, property.id);
    const totals = h('div', { class: 'totals' });
    const list = h('div', { class: 'room-list' });

    const drawTotals = () => {
      const area = rooms.reduce((s, r) => s + roomArea(r), 0);
      const walls = rooms.reduce((s, r) => s + wallArea(r), 0);
      totals.replaceChildren(
        stat('Cômodos', rooms.length),
        stat('Área total', `${fmt(area)} m²`),
        stat('Área de paredes', walls ? `${fmt(walls)} m²` : '—')
      );
    };

    const save = (room) => db.put('rooms', room);

    const card = (room) => {
      const results = h('div', { class: 'room-results' });
      const drawResults = () => {
        results.replaceChildren(
          h('span', {}, 'Área ', h('b', {}, `${fmt(roomArea(room))} m²`)),
          h('span', {}, 'Perímetro ', h('b', {}, `${fmt(roomPerimeter(room))} m`)),
          h('span', {}, 'Paredes ', h('b', {}, room.height ? `${fmt(wallArea(room))} m²` : '—'))
        );
        drawTotals();
      };
      const set = (key) => async (value) => {
        room[key] = value;
        await save(room);
        drawResults();
      };

      const name = h('input', { class: 'room-name', value: room.name || '', placeholder: 'Nome do cômodo' });
      name.addEventListener('change', () => set('name')(name.value));
      const kind = h('select', { class: 'room-kind' }, ...ROOM_KINDS.map((k) => h('option', { selected: room.kind === k }, k)));
      kind.addEventListener('change', () => set('kind')(kind.value));
      const notes = h('textarea', { rows: 2, placeholder: 'Observações (piso, acabamento, estado…)' }, room.notes || '');
      notes.addEventListener('change', () => set('notes')(notes.value));

      const poly = isPoly(room);
      const el = h('div', { class: 'card room-card' },
        h('div', { class: 'room-head' }, name, kind,
          h('button', {
            class: 'icon-btn',
            title: 'Excluir cômodo',
            onclick: async () => {
              if (!(await confirmDialog(`Excluir “${room.name || room.kind}”?`))) return;
              await db.del('rooms', room.id);
              rooms.splice(rooms.indexOf(room), 1);
              el.remove();
              drawTotals();
            },
          }, '✕')),
        h('div', { class: 'mfields' },
          poly ? h('div', { class: 'note' }, 'Forma irregular — paredes editadas no Croqui.') : [
            measureField({ label: 'Largura', value: room.width, onChange: set('width') }),
            measureField({ label: 'Comprimento', value: room.length, onChange: set('length') }),
          ],
          heightEditor(room, async () => { await save(room); drawResults(); }, ctx)),
        results,
        notes);
      drawResults();
      return el;
    };

    const add = async () => {
      const kindName = rooms.length ? 'Quarto' : 'Sala';
      const count = rooms.filter((r) => r.kind === kindName).length + 1;
      const room = await save({
        id: uid(), propertyId: property.id, kind: kindName, name: `${kindName} ${count}`,
        order: rooms.length, shape: 'rect', x: 0, y: 0, heights: newRoomHeights(property),
      });
      room.height = room.heights[0];
      rooms.push(room);
      const el = card(room);
      list.append(el);
      drawTotals();
      arm(el.querySelector('.mfield'));
    };

    list.append(...rooms.map(card));
    drawTotals();
    body.replaceChildren(
      totals,
      h('p', { class: 'muted' }, 'Toque num campo de medida (fica destacado) e aperte o botão da trena. O próximo campo é selecionado sozinho.'),
      list,
      h('button', { class: 'btn primary block', onclick: add }, '+ Adicionar cômodo')
    );
  },

  async report(ctx) {
    const rooms = await loadRooms(ctx.db, ctx.property.id);
    if (!rooms.length) return [];
    const rows = rooms.map((r) => [
      r.name || r.kind, r.kind,
      isPoly(r) ? 'irregular' : fmt(r.width), isPoly(r) ? '' : fmt(r.length), heightsText(r, (x) => fmt(x)),
      fmt(roomArea(r)), fmt(roomPerimeter(r)), r.height ? fmt(wallArea(r)) : '',
      r.notes || '',
    ]);
    const total = rooms.reduce((s, r) => s + roomArea(r), 0);
    rows.push(['Total', '', '', '', '', fmt(total), '', fmt(rooms.reduce((s, r) => s + wallArea(r), 0)), '']);
    return [{
      type: 'table',
      title: 'Cômodos',
      head: ['Cômodo', 'Tipo', 'Largura (m)', 'Compr. (m)', 'Pé-dir. (m)', 'Área (m²)', 'Perím. (m)', 'Paredes (m²)', 'Obs.'],
      rows,
    }];
  },
};

function stat(label, value) {
  return h('div', { class: 'stat' }, h('small', {}, label), h('b', {}, value));
}
