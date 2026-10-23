// Utilitários de interface: criação de elementos, avisos, formatação e campos de medida.

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function toast(msg, ms = 2600) {
  const host = document.getElementById('toasts');
  const el = h('div', { class: 'toast' }, msg);
  host.append(el);
  setTimeout(() => el.classList.add('out'), ms);
  setTimeout(() => el.remove(), ms + 400);
}

export function confirmDialog(msg) {
  return Promise.resolve(window.confirm(msg));
}

// ---------- Configurações ----------
const SETTINGS_KEY = 'cadastro.settings';
const DEFAULTS = { enabledTools: null, decimals: 2, autoAdvance: true, beep: true };

export function getSettings() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(patch) {
  const next = { ...getSettings(), ...patch };
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
  } catch {
    /* modo privado */
  }
  return next;
}

// ---------- Números ----------
export function fmt(n, decimals = getSettings().decimals) {
  if (n == null || n === '' || !Number.isFinite(Number(n))) return '';
  return Number(n).toLocaleString('pt-BR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export function parseNum(s) {
  if (typeof s === 'number') return s;
  if (s == null) return null;
  const t = String(s).trim().replace(/\s/g, '').replace(',', '.');
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export function fmtDate(ts) {
  return new Date(ts).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

// ---------- Campos de medida ligados à trena ----------
// Tocar no campo o "arma": a próxima medida da trena cai nele. O lápis libera digitação manual.
let armed = null;

export function armedField() {
  return armed && armed.isConnected ? armed : null;
}

export function arm(field) {
  if (armed) armed.classList.remove('armed');
  armed = field;
  if (field) {
    field.classList.add('armed');
    field.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}

export function measureField({ label, value, onChange, hint }) {
  const input = h('input', {
    class: 'mfield-input',
    inputmode: 'decimal',
    readOnly: true,
    value: fmt(value),
    placeholder: '—',
  });
  const field = h('label', { class: 'mfield' }, h('span', { class: 'mfield-label' }, label), input, h('span', { class: 'mfield-unit' }, 'm'));
  const edit = h('button', { class: 'mfield-edit', type: 'button', title: 'Digitar', 'aria-label': `Digitar ${label}` }, '✎');
  field.append(edit);
  if (hint) field.title = hint;

  field.setValue = (meters, { silent } = {}) => {
    input.value = fmt(meters);
    field.classList.remove('flash');
    void field.offsetWidth;
    field.classList.add('flash');
    if (!silent) onChange?.(meters);
  };

  field.addEventListener('click', (e) => {
    if (e.target === edit) return;
    if (input.readOnly) {
      e.preventDefault();
      arm(field);
    }
  });
  edit.addEventListener('click', (e) => {
    e.preventDefault();
    input.readOnly = false;
    arm(field);
    input.focus();
    input.select();
  });
  input.addEventListener('blur', () => {
    if (input.readOnly) return;
    input.readOnly = true;
    const n = parseNum(input.value);
    input.value = fmt(n);
    onChange?.(n);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') input.blur();
  });
  return field;
}

// Ao receber uma medida: preenche o campo armado e passa para o próximo.
export function deliverMeasure(meters) {
  const field = armedField();
  if (!field) return false;
  field.setValue(meters);
  // Se o campo foi redesenhado pelo onChange, quem redesenhou decide o próximo alvo.
  if (!field.isConnected) return true;
  if (getSettings().autoAdvance && field.classList.contains('mfield')) {
    const all = [...document.querySelectorAll('.mfield')].filter((f) => f.offsetParent !== null);
    const next = all[all.indexOf(field) + 1];
    arm(next || null);
  }
  return true;
}

let audioCtx;
export function beep() {
  if (!getSettings().beep) return;
  try {
    audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.frequency.value = 1320;
    g.gain.setValueAtTime(0.08, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.12);
    o.connect(g).connect(audioCtx.destination);
    o.start();
    o.stop(audioCtx.currentTime + 0.13);
  } catch {
    /* sem áudio */
  }
}

// ---------- Arquivos ----------
export async function shareOrDownload(blob, filename) {
  const file = new File([blob], filename, { type: blob.type });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename });
      return;
    } catch (err) {
      if (err.name === 'AbortError') return;
    }
  }
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

export async function dataURLToBlob(url) {
  return (await fetch(url)).blob();
}

export function slug(s) {
  return (s || 'imovel').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
}
