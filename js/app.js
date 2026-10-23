import { db, uid } from './db.js';
import { glm } from './glm.js';
import { h, toast, fmt, fmtDate, getSettings, saveSettings, deliverMeasure, armedField, arm, beep, confirmDialog } from './ui.js';
import { TOOLS } from './tools/index.js';
import { roomArea } from './geometry.js';
import { restoreButton } from './tools/export.js';

const view = document.getElementById('view');
let currentPropertyId = null;
const history = []; // medidas recentes desta sessão

// ---------- Ferramentas habilitadas ----------
export function enabledTools() {
  const ids = getSettings().enabledTools;
  return TOOLS.filter((t) => (ids ? ids.includes(t.id) : t.defaultEnabled !== false));
}

// ---------- Barra superior: estado da trena ----------
const pill = document.getElementById('glm-pill');
const pillText = document.getElementById('glm-text');
const lastEl = document.getElementById('glm-last');

const measureBtn = document.getElementById('glm-measure');
measureBtn.addEventListener('click', async () => {
  if (measureBtn.disabled) return;
  measureBtn.disabled = true;
  measureBtn.textContent = 'Medindo…';
  try {
    await glm.measure();
  } catch (err) {
    toast('Não mediu: ' + err.message, 4000);
  } finally {
    measureBtn.disabled = false;
    measureBtn.textContent = 'Medir';
  }
});

function renderPill() {
  measureBtn.hidden = glm.status !== 'connected';
  pill.dataset.status = glm.status;
  pillText.textContent = {
    unsupported: 'Sem Bluetooth',
    disconnected: showAllNext ? 'Procurar todos' : 'Conectar trena',
    connecting: 'Conectando…',
    connected: glm.name,
  }[glm.status];
}

// Se a trena não apareceu na lista filtrada, o próximo toque mostra todos os aparelhos.
let showAllNext = false;

pill.addEventListener('click', async () => {
  if (glm.status === 'unsupported') {
    toast('Este navegador não acessa Bluetooth. No iPad use o Bluefy; no PC, Chrome ou Edge.', 5000);
    return;
  }
  if (glm.status === 'connecting') {
    toast('Já estou tentando conectar — aguarde.');
    return;
  }
  if (glm.status === 'connected') {
    if (await confirmDialog(`Desconectar ${glm.name}?`)) glm.disconnect();
    return;
  }
  try {
    await glm.connect({ showAll: showAllNext });
    showAllNext = false;
    toast('Trena conectada. Toque num campo de medida e meça.');
  } catch (err) {
    if (err.name === 'NotFoundError') {
      glm.log('Seleção cancelada ou nenhuma trena encontrada.');
      if (!showAllNext) {
        showAllNext = true;
        renderPill();
        toast('A trena não apareceu? Toque em “Procurar todos” e escolha “Bosch GLM50C”.', 6000);
      }
      return;
    }
    toast('Não conectou: ' + err.message + ' — veja ⚙ Configurações › Diagnóstico da trena.', 7000);
  }
});

glm.addEventListener('status', renderPill);
glm.addEventListener('measure', async (e) => {
  const { meters, simulated } = e.detail;
  beep();
  lastEl.textContent = fmt(meters, 3) + ' m';
  lastEl.classList.remove('pop');
  void lastEl.offsetWidth;
  lastEl.classList.add('pop');
  history.unshift({ meters, at: Date.now() });
  history.length = Math.min(history.length, 30);
  renderTray();
  if (currentPropertyId) {
    db.put('measures', { id: uid(), propertyId: currentPropertyId, meters, at: Date.now(), simulated: !!simulated });
  }
  if (!deliverMeasure(meters)) toast(`${fmt(meters, 3)} m — toque num campo para usar`);
});
renderPill();

// ---------- Bandeja de medidas recentes ----------
const tray = document.getElementById('tray');
const trayList = document.getElementById('tray-list');
document.getElementById('tray-toggle').addEventListener('click', () => tray.classList.toggle('open'));

function renderTray() {
  document.getElementById('tray-count').textContent = history.length || '';
  trayList.replaceChildren(
    ...(history.length
      ? history.map((m) =>
          h('button', {
            class: 'tray-item',
            onclick: () => {
              const f = armedField();
              if (!f) return toast('Toque primeiro no campo que vai receber a medida.');
              deliverMeasure(m.meters);
            },
          }, h('b', {}, fmt(m.meters, 3) + ' m'), h('small', {}, new Date(m.at).toLocaleTimeString('pt-BR'))))
      : [h('p', { class: 'muted' }, 'As medidas da trena aparecem aqui.')])
  );
}
renderTray();

// ---------- Rotas ----------
async function route() {
  arm(null);
  const parts = location.hash.replace(/^#\/?/, '').split('/');
  window.scrollTo(0, 0);
  if (parts[0] === 'imovel' && parts[1]) return renderProperty(parts[1], parts[2] || 'dados');
  if (parts[0] === 'config') return renderConfig();
  return renderHome();
}
window.addEventListener('hashchange', route);

function crumbs(...items) {
  document.getElementById('crumbs').replaceChildren(
    ...items.flatMap((c, i) => [i ? h('span', { class: 'sep' }, '›') : [], c.href ? h('a', { href: c.href }, c.label) : h('span', {}, c.label)])
  );
}

// ---------- Início: lista de imóveis ----------
async function renderHome() {
  currentPropertyId = null;
  crumbs({ label: 'Imóveis' });
  const props = (await db.all('properties')).sort((a, b) => b.updatedAt - a.updatedAt);
  const rooms = await db.all('rooms');
  const search = h('input', { class: 'search', type: 'search', placeholder: 'Buscar por nome, endereço ou inscrição…' });
  const list = h('div', { class: 'cards' });

  const draw = () => {
    const q = search.value.trim().toLowerCase();
    const filtered = props.filter((p) => !q || [p.name, p.address, p.registry, p.owner].join(' ').toLowerCase().includes(q));
    list.replaceChildren(
      ...filtered.map((p) => {
        const rs = rooms.filter((r) => r.propertyId === p.id);
        const area = rs.reduce((s, r) => s + roomArea(r), 0);
        return h('a', { class: 'card prop-card', href: `#/imovel/${p.id}` },
          h('div', { class: 'prop-kind' }, p.kind || 'Imóvel'),
          h('h3', {}, p.name || 'Sem nome'),
          h('p', { class: 'muted' }, p.address || 'Endereço não informado'),
          h('div', { class: 'prop-meta' },
            h('span', {}, `${rs.length} cômodo${rs.length === 1 ? '' : 's'}`),
            h('span', {}, area ? `${fmt(area)} m²` : '—'),
            h('span', {}, fmtDate(p.updatedAt))));
      })
    );
    if (!filtered.length) list.append(h('div', { class: 'empty' }, props.length ? 'Nada encontrado.' : 'Nenhum imóvel ainda. Toque em “Novo imóvel” para começar.'));
  };
  search.addEventListener('input', draw);
  draw();

  view.replaceChildren(
    h('div', { class: 'page-head' },
      h('h1', {}, 'Imóveis'),
      h('button', { class: 'btn primary', onclick: newProperty }, '+ Novo imóvel')),
    search,
    list
  );
}

async function newProperty() {
  const p = await db.put('properties', { id: uid(), name: '', kind: 'Casa', createdAt: Date.now() });
  location.hash = `#/imovel/${p.id}/dados`;
}

// ---------- Imóvel ----------
async function renderProperty(id, tab) {
  const property = await db.get('properties', id);
  if (!property) {
    location.hash = '#/';
    return;
  }
  currentPropertyId = id;
  crumbs({ label: 'Imóveis', href: '#/' }, { label: property.name || 'Novo imóvel' });

  const tools = enabledTools();
  const tabs = [{ id: 'dados', name: 'Dados' }, ...tools];
  if (!tabs.some((t) => t.id === tab)) tab = 'dados';

  const body = h('div', { class: 'tool-body' });
  view.replaceChildren(
    h('nav', { class: 'tabs' }, ...tabs.map((t) => h('a', { class: 'tab' + (t.id === tab ? ' active' : ''), href: `#/imovel/${id}/${t.id}` }, t.name))),
    body
  );

  const ctx = {
    property,
    db,
    glm,
    toast,
    tools,
    async saveProperty(patch) {
      Object.assign(property, patch);
      await db.put('properties', property);
    },
    rerender: () => renderProperty(id, tab),
  };

  if (tab === 'dados') return renderPropertyData(body, ctx);
  const tool = tools.find((t) => t.id === tab);
  try {
    await tool.render(body, ctx);
  } catch (err) {
    console.error(err);
    body.replaceChildren(h('div', { class: 'empty' }, `Erro na ferramenta ${tool.name}: ${err.message}`));
  }
}

const PROPERTY_FIELDS = [
  ['name', 'Identificação', 'Ex.: Casa Rua das Flores, 120'],
  ['kind', 'Tipo', null, ['Casa', 'Apartamento', 'Sobrado', 'Sala comercial', 'Loja', 'Galpão', 'Terreno', 'Rural', 'Outro']],
  ['address', 'Endereço', 'Rua, número, bairro, cidade'],
  ['registry', 'Inscrição imobiliária / matrícula', ''],
  ['owner', 'Proprietário / contato', ''],
  ['landArea', 'Área do terreno (m²)', '', null, 'decimal'],
  ['visitDate', 'Data da vistoria', '', null, 'date'],
  ['notes', 'Observações', 'Estado de conservação, padrão de acabamento…', null, 'textarea'],
];

function renderPropertyData(body, ctx) {
  const { property } = ctx;
  const form = h('div', { class: 'form-grid' });
  for (const [key, label, placeholder, options, type] of PROPERTY_FIELDS) {
    let input;
    if (options) input = h('select', {}, ...options.map((o) => h('option', { selected: property[key] === o }, o)));
    else if (type === 'textarea') input = h('textarea', { rows: 4, placeholder }, property[key] || '');
    else input = h('input', { type: type === 'date' ? 'date' : 'text', inputmode: type === 'decimal' ? 'decimal' : null, placeholder, value: property[key] || '' });
    input.addEventListener('change', async () => {
      await ctx.saveProperty({ [key]: input.value });
      if (key === 'name') crumbs({ label: 'Imóveis', href: '#/' }, { label: input.value || 'Novo imóvel' });
    });
    form.append(h('label', { class: 'field' + (type === 'textarea' ? ' wide' : '') }, h('span', {}, label), input));
  }
  body.replaceChildren(
    form,
    h('div', { class: 'danger-zone' },
      h('button', {
        class: 'btn danger',
        onclick: async () => {
          if (!(await confirmDialog('Excluir este imóvel com todos os cômodos e fotos? Não dá para desfazer.'))) return;
          await db.deleteProperty(property.id);
          location.hash = '#/';
        },
      }, 'Excluir imóvel'))
  );
  if (!property.name) form.querySelector('input').focus();
}

// ---------- Configurações ----------
async function renderConfig() {
  currentPropertyId = null;
  crumbs({ label: 'Imóveis', href: '#/' }, { label: 'Configurações' });
  const s = getSettings();
  const enabled = new Set(enabledTools().map((t) => t.id));

  const toolList = h('div', { class: 'tool-list' },
    ...TOOLS.map((t) => {
      const cb = h('input', { type: 'checkbox', checked: enabled.has(t.id) });
      cb.addEventListener('change', () => {
        cb.checked ? enabled.add(t.id) : enabled.delete(t.id);
        saveSettings({ enabledTools: TOOLS.filter((x) => enabled.has(x.id)).map((x) => x.id) });
        toast(`${t.name} ${cb.checked ? 'ativada' : 'desativada'}`);
      });
      return h('label', { class: 'tool-row' },
        h('div', {}, h('b', {}, t.name), h('p', { class: 'muted' }, t.description)),
        h('span', { class: 'switch' }, cb, h('i')));
    }));

  const toggle = (key, label, desc) => {
    const cb = h('input', { type: 'checkbox', checked: !!s[key] });
    cb.addEventListener('change', () => saveSettings({ [key]: cb.checked }));
    return h('label', { class: 'tool-row' }, h('div', {}, h('b', {}, label), h('p', { class: 'muted' }, desc)), h('span', { class: 'switch' }, cb, h('i')));
  };

  const decimals = h('select', {}, ...[1, 2, 3].map((d) => h('option', { value: d, selected: s.decimals === d }, `${d} casa${d > 1 ? 's' : ''} (${fmt(3.4567, d)} m)`)));
  decimals.addEventListener('change', () => saveSettings({ decimals: Number(decimals.value) }));

  const storage = h('p', { class: 'muted' }, 'Calculando espaço…');
  (async () => {
    if (!navigator.storage?.estimate) return (storage.textContent = 'Espaço: indisponível neste navegador.');
    const { usage, quota } = await navigator.storage.estimate();
    const persisted = navigator.storage.persisted ? await navigator.storage.persisted() : false;
    storage.textContent = `Usando ${(usage / 1e6).toFixed(1)} MB de ${(quota / 1e9).toFixed(1)} GB. ${persisted ? 'Armazenamento protegido.' : 'Armazenamento pode ser limpo pelo sistema — faça backups.'}`;
  })();

  view.replaceChildren(
    h('div', { class: 'page-head' }, h('h1', {}, 'Configurações')),
    h('section', { class: 'panel' }, h('h2', {}, 'Ferramentas'), h('p', { class: 'muted' }, 'Ligue só o que você usa. As ferramentas ativas aparecem como abas em cada imóvel.'), toolList),
    h('section', { class: 'panel' },
      h('h2', {}, 'Trena'),
      h('label', { class: 'field' }, h('span', {}, 'Casas decimais'), decimals),
      toggle('autoAdvance', 'Avançar sozinho', 'Depois de receber uma medida, já seleciona o próximo campo.'),
      toggle('beep', 'Bip ao medir', 'Toca um bip curto quando a medida chega.'),
      h('div', { class: 'row' },
        h('button', { class: 'btn', onclick: () => glm.simulate() }, 'Simular medida'),
        h('span', { class: 'muted' }, 'Útil para testar sem a trena.'))),
    diagnosticsPanel(),
    h('section', { class: 'panel' },
      h('h2', {}, 'Dados'),
      storage,
      h('button', {
        class: 'btn',
        onclick: async () => {
          const ok = navigator.storage?.persist ? await navigator.storage.persist() : false;
          toast(ok ? 'Armazenamento protegido.' : 'O navegador não permitiu. Faça backups pela aba Exportar.');
          renderConfig();
        },
      }, 'Proteger armazenamento'),
      h('div', { class: 'row' }, ...restoreButton('Restaurar backup (.json)', () => (location.hash = '#/')))),
    h('p', { class: 'muted small' }, 'Cadastro de Imóveis · versão 1.0 · dados salvos só neste aparelho.')
  );
}

function diagnosticsPanel() {
  const pre = h('pre', { class: 'diag' });
  const draw = () => {
    pre.textContent = glm.logs.length ? glm.logs.join('\n') : 'Nada ainda. Clique em “Conectar trena” e faça uma medida.';
    pre.scrollTop = pre.scrollHeight;
  };
  const onLog = () => (pre.isConnected ? draw() : glm.removeEventListener('log', onLog));
  glm.addEventListener('log', onLog);
  draw();
  return h('section', { class: 'panel' },
    h('h2', {}, 'Diagnóstico da trena'),
    h('p', { class: 'muted' }, 'Mostra cada passo da conexão e os pacotes que chegam. Se algo falhar, copie e envie.'),
    pre,
    h('div', { class: 'row' },
      h('button', {
        class: 'btn',
        onclick: async () => {
          try {
            await navigator.clipboard.writeText(glm.logs.join('\n'));
            toast('Diagnóstico copiado.');
          } catch {
            toast('Não consegui copiar; selecione o texto manualmente.');
          }
        },
      }, 'Copiar'),
      h('button', { class: 'btn', onclick: () => { glm.logs.length = 0; draw(); } }, 'Limpar')));
}

// ---------- Início ----------
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
route();
glm.reconnectKnown();
