// Ferramenta: serviços. Cada serviço do catálogo vira um passo a passo:
// fichas → telas próprias (planta baixa, fotos) → pendências com solução → entrega (PDF, CAD, pacote).
import { uid } from '../db.js';
import { h, fmt, fmtDate, parseNum, measureField, toast, confirmDialog, shareOrDownload, slug, getSettings } from '../ui.js';
import { SERVICES, isOn, memorialText } from '../services/catalog.js';
import { buildPrancha, buildDXF, buildZip, buildFicha } from '../services/delivery.js';
import { roomArea } from '../geometry.js';
import roomsTool, { loadRooms } from './rooms.js';
import sketchTool from './sketch.js';
import photosTool, { importFile, renderAnnotated } from './photos.js';

const byId = (id) => SERVICES.find((s) => s.id === id);

function buildSteps(def, rec) {
  const steps = def.sections
    .filter((s) => isOn(s.when, rec.options))
    .map((s) => ({ key: 'sec:' + s.title, title: s.title, kind: s.tool ? 'tool' : 'form', section: s }));
  steps.push({ key: 'photos', title: 'Fotos', kind: 'photos' });
  if (def.memorial) steps.push({ key: 'memorial', title: 'Texto do memorial', kind: 'memorial' });
  steps.push({ key: 'problems', title: 'Pendências e soluções', kind: 'problems' });
  steps.push({ key: 'finish', title: 'Entrega', kind: 'finish' });
  return steps;
}

const COUNTED = (f) => !['calc', 'photo', 'rooms'].includes(f.type);
const filled = (v) => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && !v.length);

export default {
  id: 'services',
  name: 'Serviços',
  description: 'Escolha o serviço (levantamento, regularização, memorial…) e siga as etapas: ficha pronta, planta, fotos, pendências com solução e entrega em PDF e CAD.',

  async render(body, ctx) {
    const { db, property, params } = ctx;
    const base = `#/imovel/${property.id}/services`;
    const go = (path) => (location.hash = base + (path ? '/' + path : ''));
    const records = (await db.byProperty('services', property.id)).sort((a, b) => a.createdAt - b.createdAt);

    // ---------- escolher serviço ----------
    if (params[0] === 'novo' || (!params[0] && !records.length)) return renderPicker();
    if (!params[0]) return renderList();
    const rec = records.find((r) => r.id === params[0]);
    if (!rec) return go('');
    return renderService(rec, Number(params[1]) || 0);

    function renderList() {
      body.replaceChildren(
        h('div', { class: 'row space' }, h('h2', {}, 'Serviços deste imóvel'), h('button', { class: 'btn primary', onclick: () => go('novo') }, '+ Iniciar serviço')),
        h('div', { class: 'cards' }, ...records.map((r) => {
          const def = byId(r.serviceId);
          const steps = buildSteps(def, r);
          const done = steps.filter((s) => r.done?.[s.key]).length;
          return h('a', { class: 'card svc-card', href: `${base}/${r.id}` },
            h('div', { class: 'prop-kind' }, def.subtitle || 'Serviço'),
            h('h3', {}, def.name),
            h('p', { class: 'muted' }, def.options.filter((o) => r.options.includes(o.id)).map((o) => o.label).join(' · ') || def.description),
            h('div', { class: 'progress' }, h('i', { style: { width: `${(done / steps.length) * 100}%` } })),
            h('div', { class: 'prop-meta' }, h('span', {}, `${done}/${steps.length} etapas`), h('span', {}, r.finishedAt ? 'Entregue' : 'Em andamento'), h('span', {}, fmtDate(r.createdAt))));
        }))
      );
    }

    function renderPicker() {
      let chosen = null;
      let selected = [];
      const optionsBox = h('div', { class: 'picker-options' });
      const drawOptions = () => {
        if (!chosen) return optionsBox.replaceChildren();
        const single = chosen.mode === 'single';
        optionsBox.replaceChildren(
          h('h3', {}, chosen.name),
          h('p', { class: 'muted' }, single ? 'Escolha uma opção:' : 'Marque o que entra neste serviço:'),
          h('div', { class: 'opt-list' }, ...chosen.options.map((o) => {
            const on = selected.includes(o.id);
            return h('button', {
              class: 'opt' + (on ? ' on' : '') + (o.fixed ? ' fixed' : ''),
              onclick: () => {
                if (o.fixed) return;
                if (single) selected = [o.id];
                else selected = on ? selected.filter((x) => x !== o.id) : [...selected, o.id];
                drawOptions();
              },
            }, h('span', { class: 'box' }, on ? '✓' : ''), o.label);
          })),
          h('button', {
            class: 'btn primary block',
            disabled: single && !selected.length,
            onclick: async () => {
              const rec = await db.put('services', {
                id: uid(), propertyId: property.id, serviceId: chosen.id, name: chosen.name,
                options: selected, values: {}, problems: {}, docs: {}, custom: [], deliverables: {}, done: {}, createdAt: Date.now(),
              });
              go(rec.id);
            },
          }, 'Começar serviço')
        );
        optionsBox.scrollIntoView({ behavior: 'smooth', block: 'start' });
      };
      body.replaceChildren(
        h('div', { class: 'row space' }, h('h2', {}, 'Qual serviço você vai fazer?'), records.length ? h('button', { class: 'btn', onclick: () => go('') }, 'Voltar') : null),
        h('div', { class: 'cards picker' }, ...SERVICES.map((s) => h('button', {
          class: 'card svc-pick',
          onclick: (e) => {
            chosen = s;
            selected = s.options.filter((o) => o.fixed).map((o) => o.id);
            body.querySelectorAll('.svc-pick').forEach((b) => b.classList.remove('on'));
            e.currentTarget.classList.add('on');
            drawOptions();
          },
        }, h('div', { class: 'prop-kind' }, s.subtitle || ''), h('h3', {}, s.name), h('p', { class: 'muted' }, s.description)))),
        optionsBox
      );
    }

    // ---------- serviço em andamento ----------
    async function renderService(rec, stepIndex) {
      const def = byId(rec.serviceId);
      const steps = buildSteps(def, rec);
      const i = Math.min(Math.max(stepIndex, 0), steps.length - 1);
      const step = steps[i];
      const save = () => db.put('services', rec);
      const value = (f) => rec.values[f.id] ?? (f.bind ? property[f.bind] : undefined) ?? undefined;
      const allValues = () => {
        const v = {};
        for (const s of def.sections) for (const f of s.fields) v[f.id] = value(f);
        return v;
      };

      const progressOf = (st) => {
        if (!st.section) return null;
        const fs = st.section.fields.filter((f) => isOn(f.when, rec.options) && COUNTED(f));
        return [fs.filter((f) => filled(value(f))).length, fs.length];
      };
      const nav = h('nav', { class: 'steps' }, ...steps.map((st, k) => {
        const p = progressOf(st);
        return h('a', { class: 'step' + (k === i ? ' active' : '') + (rec.done[st.key] ? ' done' : ''), href: `${base}/${rec.id}/${k}` },
          h('span', { class: 'num' }, rec.done[st.key] ? '✓' : k + 1),
          h('span', { class: 'txt' }, st.title, p && p[1] ? h('small', {}, `${p[0]}/${p[1]}`) : null));
      }));

      const content = h('div', { class: 'step-body' });
      const footer = h('div', { class: 'step-foot' },
        i > 0 ? h('button', { class: 'btn', onclick: () => go(`${rec.id}/${i - 1}`) }, '← Anterior') : h('span'),
        step.kind !== 'finish' ? h('button', {
          class: 'btn primary',
          onclick: async () => {
            rec.done[step.key] = true;
            await save();
            go(`${rec.id}/${i + 1}`);
          },
        }, 'Concluir etapa →') : h('span'));

      body.replaceChildren(
        h('div', { class: 'svc-head' },
          h('div', {}, h('a', { href: base, class: 'muted' }, '‹ Serviços'), h('h2', {}, def.name),
            h('div', { class: 'chips' }, ...def.options.filter((o) => rec.options.includes(o.id)).map((o) => h('span', { class: 'chip' }, o.label)))),
          h('button', {
            class: 'icon-btn',
            title: 'Excluir serviço',
            onclick: async () => {
              if (!(await confirmDialog(`Excluir o serviço “${def.name}” deste imóvel?`))) return;
              await db.del('services', rec.id);
              go('');
            },
          }, '🗑')),
        h('div', { class: 'svc-layout' + (step.kind === 'tool' ? ' wide' : '') }, nav, h('div', {}, h('h2', { class: 'step-title' }, step.title), content, footer))
      );

      if (step.kind === 'form') renderForm(step.section, content);
      else if (step.kind === 'tool') await renderPlan(step.section, content);
      else if (step.kind === 'photos') await photosTool.render(content, ctx);
      else if (step.kind === 'memorial') renderMemorial(content);
      else if (step.kind === 'problems') renderProblems(content);
      else if (step.kind === 'finish') await renderFinish(content);

      // ---------- ficha ----------
      function renderForm(section, box) {
        const calcs = [];
        const refreshCalcs = () => calcs.forEach((fn) => fn());
        const set = async (f, v) => {
          rec.values[f.id] = v;
          if (f.bind) await ctx.saveProperty({ [f.bind]: v });
          await save();
          refreshCalcs();
        };
        const grid = h('div', { class: 'form-grid' });
        for (const f of section.fields) {
          if (!isOn(f.when, rec.options)) continue;
          grid.append(fieldEl(f, value(f), (v) => set(f, v), calcs));
        }
        box.replaceChildren(grid);
        refreshCalcs();
      }

      function fieldEl(f, v, onChange, calcs) {
        const wrap = (control, wide) => h('label', { class: 'field' + (wide ? ' wide' : ''), title: f.hint || '' }, h('span', {}, f.label), control, f.hint ? h('small', { class: 'muted' }, f.hint) : null);
        switch (f.type) {
          case 'measure':
            return h('div', { class: 'field' }, measureField({ label: f.label, value: v, onChange }), f.hint ? h('small', { class: 'muted' }, f.hint) : null);
          case 'textarea': {
            const t = h('textarea', { rows: 3, placeholder: f.placeholder || '' }, v || '');
            t.addEventListener('change', () => onChange(t.value));
            return wrap(t, true);
          }
          case 'number':
          case 'area': {
            const shown = v == null ? '' : f.type === 'area' ? fmt(v, 2).replace(/\./g, '') : String(v).replace('.', ',');
            const inp = h('input', { inputmode: 'decimal', value: shown, placeholder: f.type === 'area' ? 'm²' : '' });
            inp.addEventListener('change', () => onChange(parseNum(inp.value)));
            return wrap(f.type === 'area' ? h('div', { class: 'suffix' }, inp, h('span', {}, 'm²')) : inp);
          }
          case 'date': {
            const inp = h('input', { type: 'date', value: v || '' });
            inp.addEventListener('change', () => onChange(inp.value));
            return wrap(inp);
          }
          case 'select': {
            const sel = h('select', {}, h('option', { value: '' }, '—'), ...f.options.map((o) => h('option', { selected: v === o }, o)));
            sel.addEventListener('change', () => onChange(sel.value || null));
            return wrap(sel);
          }
          case 'multi': {
            let cur = Array.isArray(v) ? [...v] : [];
            const box = h('div', { class: 'chips pick' });
            const draw = () => box.replaceChildren(...f.options.map((o) => h('button', {
              type: 'button',
              class: 'chip' + (cur.includes(o) ? ' on' : ''),
              onclick: () => {
                cur = cur.includes(o) ? cur.filter((x) => x !== o) : [...cur, o];
                draw();
                onChange(cur);
              },
            }, o)));
            draw();
            return h('div', { class: 'field wide' }, h('span', {}, f.label), box);
          }
          case 'check': {
            const segs = h('div', { class: 'segs yn' });
            const draw = (cur) => segs.replaceChildren(...[[true, 'Sim'], [false, 'Não']].map(([val, label]) => h('button', {
              type: 'button',
              class: 'seg' + (cur === val ? ' on' : ''),
              onclick: () => {
                const next = cur === val ? null : val;
                draw(next);
                onChange(next);
              },
            }, label)));
            draw(v);
            return h('div', { class: 'field' }, h('span', {}, f.label), segs);
          }
          case 'calc': {
            const out = h('div', { class: 'calc' });
            calcs?.push(() => (out.textContent = f.calc(allValues())));
            return h('div', { class: 'field' }, h('span', {}, f.label), out);
          }
          case 'photo':
            return photoField(f);
          case 'rooms':
            return roomsSummary(f);
          default: {
            const inp = h('input', { value: v || '', placeholder: f.placeholder || '' });
            inp.addEventListener('change', () => onChange(inp.value));
            return wrap(inp);
          }
        }
      }

      function photoField(f) {
        const thumb = h('img', { class: 'field-photo', alt: '' });
        const file = h('input', { type: 'file', accept: 'image/*', hidden: true });
        const load = async () => {
          const p = (await db.byProperty('photos', property.id)).find((x) => x.serviceRecordId === rec.id && x.fieldId === f.id);
          if (p) {
            thumb.src = await renderAnnotated(p);
            thumb.hidden = false;
          } else thumb.hidden = true;
          return p;
        };
        file.addEventListener('change', async () => {
          const fl = file.files[0];
          file.value = '';
          if (!fl) return;
          const old = await load();
          const { blob, w, h: hh } = await importFile(fl);
          await db.put('photos', { id: old?.id || uid(), propertyId: property.id, serviceRecordId: rec.id, fieldId: f.id, roomId: null, blob, w, h: hh, anns: [], caption: f.label, createdAt: old?.createdAt || Date.now() });
          load();
        });
        load();
        return h('div', { class: 'field' }, h('span', {}, f.label), thumb, file, h('button', { type: 'button', class: 'btn', onclick: () => file.click() }, '📷 Foto'));
      }

      function roomsSummary(f) {
        const out = h('div', { class: 'calc' }, 'Carregando…');
        loadRooms(db, property.id).then((rs) => {
          const total = rs.reduce((s, r) => s + roomArea(r), 0);
          out.textContent = rs.length ? `${rs.length} ambientes · ${fmt(total)} m² de área útil` : 'Nenhum ambiente cadastrado.';
        });
        return h('div', { class: 'field wide' }, h('span', {}, f.label), out, h('a', { class: 'btn', href: `#/imovel/${property.id}/rooms` }, 'Abrir cômodos'));
      }

      // ---------- planta baixa ----------
      async function renderPlan(section, box) {
        const fieldsBox = h('div');
        renderForm(section, fieldsBox);
        let mode = sessionStorage.getItem('plan.mode') || 'sketch';
        const inner = h('div', { class: 'plan-inner' });
        const seg = h('div', { class: 'segs' });
        const draw = async () => {
          seg.replaceChildren(...[['sketch', 'Desenho'], ['rooms', 'Lista de cômodos']].map(([id, label]) => h('button', {
            class: 'seg' + (mode === id ? ' on' : ''),
            onclick: () => {
              mode = id;
              try { sessionStorage.setItem('plan.mode', id); } catch { /* sem armazenamento */ }
              draw();
            },
          }, label)));
          await (mode === 'sketch' ? sketchTool : roomsTool).render(inner, ctx);
        };
        const hasFields = section.fields.some((f) => isOn(f.when, rec.options));
        box.replaceChildren(seg, inner, hasFields ? h('details', { class: 'more' }, h('summary', {}, 'Outras informações da planta'), fieldsBox) : '');
        await draw();
      }

      // ---------- memorial ----------
      function renderMemorial(box) {
        const finalidade = def.options.find((o) => rec.options.includes(o.id))?.label;
        const make = async () => {
          const v = allValues();
          const rs = await loadRooms(db, property.id);
          if (rs.length) v.__ambientes = rs.map((r) => `${(r.name || r.kind).toLowerCase()} (${fmt(roomArea(r))} m²)`).join(', ');
          return memorialText(v, finalidade, getSettings().company || {});
        };
        const ta = h('textarea', { class: 'memorial', rows: 18 }, rec.memorial || '');
        ta.addEventListener('change', () => { rec.memorial = ta.value; save(); });
        const regen = async () => {
          ta.value = await make();
          rec.memorial = ta.value;
          save();
        };
        box.replaceChildren(
          h('p', { class: 'muted' }, 'Texto montado a partir das fichas. Os campos “___” ainda não foram preenchidos. Você pode editar à vontade.'),
          h('div', { class: 'row' },
            h('button', { class: 'btn primary', onclick: regen }, '↻ Gerar texto de novo'),
            h('button', { class: 'btn', onclick: async () => { try { await navigator.clipboard.writeText(ta.value); toast('Texto copiado.'); } catch { toast('Selecione o texto e copie.'); } } }, 'Copiar')),
          ta
        );
        if (!rec.memorial) regen();
      }

      // ---------- pendências ----------
      function renderProblems(box) {
        const list = def.problems.filter((p) => isOn(p.when, rec.options));
        const card = (p) => {
          const on = !!rec.problems[p.id];
          return h('div', { class: 'card problem' + (on ? ' on' : '') },
            h('label', { class: 'problem-head' },
              h('input', {
                type: 'checkbox',
                checked: on,
                onchange: (e) => { rec.problems[p.id] = e.target.checked; save(); renderProblems(box); },
              }),
              h('b', {}, p.problem)),
            on ? h('div', { class: 'solution' },
              h('small', {}, 'SOLUÇÃO'), h('p', {}, p.solution),
              p.docs?.length ? h('div', {}, h('small', {}, 'DOCUMENTOS'), h('div', { class: 'chips pick' }, ...p.docs.map((d) => {
                const key = `${p.id}:${d}`;
                return h('button', {
                  type: 'button',
                  class: 'chip' + (rec.docs[key] ? ' on' : ''),
                  onclick: () => { rec.docs[key] = !rec.docs[key]; save(); renderProblems(box); },
                }, (rec.docs[key] ? '✓ ' : '') + d);
              }))) : null) : null);
        };
        const customBox = h('div', { class: 'room-list' }, ...rec.custom.map((c, k) => {
          const pr = h('input', { value: c.problem || '', placeholder: 'Problema encontrado' });
          const so = h('textarea', { rows: 2, placeholder: 'Solução / próximo passo' }, c.solution || '');
          pr.addEventListener('change', () => { c.problem = pr.value; save(); });
          so.addEventListener('change', () => { c.solution = so.value; save(); });
          return h('div', { class: 'card problem on' }, h('div', { class: 'row space' }, pr, h('button', { class: 'icon-btn', onclick: () => { rec.custom.splice(k, 1); save(); renderProblems(box); } }, '✕')), so);
        }));
        box.replaceChildren(
          h('p', { class: 'muted' }, 'Marque o que você encontrou no imóvel. O app mostra a solução e os documentos necessários.'),
          h('div', { class: 'room-list' }, ...list.map(card)),
          h('h3', {}, 'Outros problemas'),
          customBox,
          h('button', { class: 'btn', onclick: () => { rec.custom.push({ problem: '', solution: '' }); save(); renderProblems(box); } }, '+ Adicionar problema')
        );
      }

      // ---------- entrega ----------
      async function renderFinish(box) {
        const rooms = await loadRooms(db, property.id);
        const company = getSettings().company || {};
        const hasPlan = steps.some((s) => s.kind === 'tool');
        const name = slug(`${def.name}-${property.name || property.address || 'imovel'}`);
        const valueText = (f) => {
          const v = value(f);
          if (f.type === 'calc') return f.calc(allValues());
          if (f.type === 'rooms') return rooms.length ? `${rooms.length} ambientes, ${fmt(rooms.reduce((s, r) => s + roomArea(r), 0))} m²` : '';
          if (!filled(v)) return '';
          if (f.type === 'measure') return `${fmt(v)} m`;
          if (f.type === 'area') return `${fmt(v)} m²`;
          if (f.type === 'check') return v ? 'Sim' : 'Não';
          if (f.type === 'multi') return v.join(', ');
          if (f.type === 'date') return new Date(v + 'T12:00').toLocaleDateString('pt-BR');
          return String(v);
        };
        const files = async () => {
          const out = [{ name: `${name}-ficha.pdf`, blob: await buildFicha({ property, rec, def, steps, valueText, isOn, company }) }];
          if (hasPlan) {
            const pr = await buildPrancha({ property, rooms, rec, def, company });
            out.push({ name: `${name}-planta-baixa.pdf`, blob: pr.blob });
            out.push({ name: `${name}-planta-baixa.dxf`, blob: buildDXF(rooms, property, pr.escala) });
          }
          return out;
        };
        const run = (fn) => async (e) => {
          const btn = e.currentTarget;
          const old = btn.textContent;
          btn.disabled = true;
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
        const deliverables = def.deliverables.filter((d) => isOn(d.when, rec.options));
        const pending = steps.filter((s) => s.kind !== 'finish' && !rec.done[s.key]);
        const action = (title, desc, label, fn, primary) => h('div', { class: 'card export-card' },
          h('div', {}, h('h3', {}, title), h('p', { class: 'muted' }, desc)),
          h('button', { class: 'btn' + (primary ? ' primary' : ''), onclick: run(fn) }, label));

        box.replaceChildren(
          ...[
            pending.length ? h('div', { class: 'note' }, `Etapas ainda não concluídas: ${pending.map((s) => s.title).join(', ')}.`) : null,
            !company.empresa ? h('div', { class: 'note' }, 'Dica: preencha os dados da empresa e do responsável técnico em ⚙ Configurações para saírem no carimbo.') : null,
          ].filter(Boolean),
          h('h3', {}, 'Entregáveis'),
          h('div', { class: 'tool-list' }, ...deliverables.map((d) => {
            const cb = h('input', { type: 'checkbox', checked: !!rec.deliverables[d.id] });
            cb.addEventListener('change', () => { rec.deliverables[d.id] = cb.checked; save(); });
            return h('label', { class: 'tool-row' }, h('b', {}, d.label), h('span', { class: 'switch' }, cb, h('i')));
          })),
          h('h3', {}, 'Arquivos'),
          h('div', { class: 'export-list' },
            action('Pacote completo (.zip)', hasPlan ? 'Ficha, prancha da planta em PDF e arquivo CAD, prontos para enviar ao cliente.' : 'Ficha do serviço em PDF.', 'Gerar pacote', async () => {
              rec.finishedAt = Date.now();
              rec.done.finish = true;
              await save();
              shareOrDownload(await buildZip(await files()), `${name}.zip`);
            }, true),
            hasPlan ? action('Prancha da planta (PDF A3)', 'Planta baixa na NBR 6492: cotas, esquadrias P/J, quadros de áreas e de esquadrias, escala gráfica, norte e carimbo.', 'Gerar prancha', async () => {
              const { blob, escala } = await buildPrancha({ property, rooms, rec, def, company });
              toast(`Prancha na escala 1:${escala}.`);
              shareOrDownload(blob, `${name}-planta-baixa.pdf`);
            }) : null,
            hasPlan ? action('Arquivo CAD (DXF)', 'Abre no AutoCAD, ZWCAD e outros. Camadas: paredes, cotas e textos. Unidade: metro.', 'Gerar DXF', async () => { const { escala } = await buildPrancha({ property, rooms, rec, def, company }); shareOrDownload(buildDXF(rooms, property, escala), `${name}-planta-baixa.dxf`); }) : null,
            action('Ficha do serviço (PDF A4)', 'Tudo o que foi preenchido, pendências com soluções e memorial.', 'Gerar ficha', async () => shareOrDownload((await files())[0].blob, `${name}-ficha.pdf`)))
        );
      }
    }
  },

  async report(ctx) {
    const recs = await ctx.db.byProperty('services', ctx.property.id);
    const blocks = [];
    for (const rec of recs) {
      const def = byId(rec.serviceId);
      if (!def) continue;
      const rows = def.problems.filter((p) => rec.problems?.[p.id]).map((p) => [p.problem, p.solution]);
      for (const c of rec.custom || []) if (c.problem) rows.push([c.problem, c.solution || '']);
      if (rows.length) blocks.push({ type: 'table', title: `${def.name} - pendências`, head: ['Pendência', 'Solução'], rows });
      if (rec.memorial) blocks.push({ type: 'text', title: 'Memorial descritivo', text: rec.memorial });
    }
    return blocks;
  },
};
