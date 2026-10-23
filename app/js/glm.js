// Driver Bluetooth LE das trenas Bosch (testado na GLM 50 C, código 3 601 K72 C00).
//
// Existem duas "portas" BLE, conforme a geração do aparelho:
//   antiga (GLM 50 C / 100 C): serviço 00005301-0000-0041-5253-534f46540000
//                              característica 00004301-…  (write + indicate)  ← a GLM 50 C usa esta
//   nova (GLM 50-27 C(G), 120 C, 400 C, PLR … C): serviço 02a6c0d0-0451-4000-b000-fb3210111989
//                              característica 02a6c0d1-…  (write + indicate)
// Nas duas o protocolo é o mesmo (MT-Protocol), com quadros inteiros e CRC-8 no final:
//   comando do app        C0 <cmd> <n> <dados…> <crc>
//   resposta da trena     <status> <n> <dados…> <crc>        (status 0 = ok)
//   aviso da trena        C0 <cmd> <n> <dados…> <crc>        (ex.: C0 55 = medida feita no botão)
// Comandos usados (conferidos na GLM 50 C real):
//   C0 06 00 → identificação          C0 40 00 → medir agora (resposta: u32 LE × 0,05 mm)
//   C0 55 02 01 00 → liga o AutoSync  C0 42 00 → desliga o laser
// No AutoSync, cada medida feita no botão chega como C0 55 10 + 16 bytes, com a distância em
// float32 LE (metros) nos bytes 7..10 do quadro.

export const SERVICES = [
  { name: 'antiga', service: '00005301-0000-0041-5253-534f46540000', char: '00004301-0000-0041-5253-534f46540000' },
  { name: 'nova', service: '02a6c0d0-0451-4000-b000-fb3210111989', char: '02a6c0d1-0451-4000-b000-fb3210111989' },
];

const CMD = { INFO: 0x06, MEASURE: 0x40, LASER_OFF: 0x42, AUTOSYNC: 0x55 };
const STATUS = ['ok', 'tempo esgotado', 'modo inválido', 'erro de checksum', 'comando desconhecido', 'acesso negado', 'dados inválidos'];

// CRC-8 usado no MT-Protocol (polinômio 0xA6, valor inicial 0xAA).
export function crc8(bytes, iv = 0xaa, poly = 0xa6) {
  let v = iv;
  for (const b of bytes) {
    for (let i = 0; i < 8; i++) {
      const x = (v >> 7) ^ ((b >> (7 - i)) & 1);
      v = (v << 1) & 0xff;
      if (x) v ^= poly;
    }
  }
  return v;
}

export function buildFrame(cmd, data = []) {
  const body = [0xc0, cmd, data.length, ...data];
  return new Uint8Array([...body, crc8(body)]);
}

const hex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join(' ');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Separa o fluxo de bytes em quadros completos e válidos (CRC confere).
// Devolve { frames: [{kind:'event'|'response', cmd?, status?, data}], rest }.
export function parseFrames(buffer) {
  const frames = [];
  let i = 0;
  while (i < buffer.length) {
    const isEvent = buffer[i] === 0xc0;
    const head = isEvent ? 3 : 2;
    if (i + head > buffer.length) break;
    const n = buffer[i + head - 1];
    // Byte solto (ex.: sobra após um quadro) não pode travar o fluxo esperando 100+ bytes.
    if (!isEvent && (buffer[i] > 0x3f || n > 48)) {
      i++;
      continue;
    }
    const total = head + n + 1;
    if (i + total > buffer.length) break;
    const frame = buffer.subarray(i, i + total);
    // Tolerância: um quadro publicado da GLM 50 C(G) (C0 55 10 …) não fecha o CRC; aceita esse
    // formato de medida mesmo assim, já que o valor é validado depois.
    const knownMeasure = isEvent && buffer[i + 1] === 0x55 && n === 0x10;
    if (!knownMeasure && crc8(frame.subarray(0, total - 1)) !== frame[total - 1]) {
      i++; // lixo ou quadro corrompido: tenta realinhar no próximo byte
      continue;
    }
    const data = frame.slice(head, head + n);
    frames.push(isEvent ? { kind: 'event', cmd: frame[1], data } : { kind: 'response', status: frame[0] & 0x3f, data });
    i += total;
  }
  return { frames, rest: buffer.slice(i) };
}

// Medida enviada pela trena no AutoSync (quadro C0 55): distância em metros.
export function eventMeasure(frame) {
  if (frame.cmd !== CMD.AUTOSYNC || frame.data.length < 8) return null;
  const dv = new DataView(frame.data.buffer, frame.data.byteOffset);
  const meters = dv.getFloat32(4, true);
  if (!Number.isFinite(meters) || meters <= 0 || meters > 500) return null;
  return { meters, type: frame.data[0] & 0x1f, ref: frame.data[1] & 0x07 };
}

export class GLM extends EventTarget {
  constructor() {
    super();
    this.status = this.supported ? 'disconnected' : 'unsupported';
    this.device = null;
    this.char = null;
    this.buffer = new Uint8Array(0);
    this.manualDisconnect = false;
    this.logs = [];
    this.pending = null; // resposta aguardada do comando em andamento
    this.queue = Promise.resolve(); // um comando por vez
  }

  get supported() {
    return typeof navigator !== 'undefined' && !!navigator.bluetooth;
  }

  get name() {
    return (this.device?.name || 'Trena').replace(/^Bosch\s+/i, '');
  }

  setStatus(status, detail) {
    this.status = status;
    this.dispatchEvent(new CustomEvent('status', { detail: { status, detail } }));
  }

  log(msg) {
    const line = `${new Date().toLocaleTimeString('pt-BR')}  ${msg}`;
    this.logs.push(line);
    if (this.logs.length > 200) this.logs.shift();
    console.info('[GLM]', msg);
    this.dispatchEvent(new CustomEvent('log', { detail: line }));
  }

  async connect() {
    if (!this.supported) throw new Error('Este navegador não tem Bluetooth. No iPad, abra o app pelo navegador Bluefy.');
    this.manualDisconnect = false;
    const device = await navigator.bluetooth.requestDevice({
      filters: [
        ...SERVICES.map((s) => ({ services: [s.service] })),
        { namePrefix: 'Bosch' }, { namePrefix: 'GLM' }, { namePrefix: 'PLR' },
      ],
      optionalServices: SERVICES.map((s) => s.service),
    });
    this.useDevice(device);
    await this.attach();
  }

  // Reconecta sem abrir a lista, se o navegador lembra da trena autorizada antes.
  async reconnectKnown() {
    if (!this.supported || !navigator.bluetooth.getDevices || this.device) return false;
    let devices = [];
    try {
      devices = await navigator.bluetooth.getDevices();
    } catch {
      return false;
    }
    const device = devices.find((d) => /^(bosch|glm|plr)/i.test(d.name || ''));
    if (!device) return false;
    this.log(`Trena conhecida: ${device.name}. Reconectando…`);
    this.useDevice(device);
    try {
      await this.attach();
      return true;
    } catch {
      return false;
    }
  }

  useDevice(device) {
    this.log(`Trena: ${device.name || '(sem nome)'}`);
    if (this.device === device) return;
    this.device = device;
    device.addEventListener('gattserverdisconnected', () => this.onDisconnected());
  }

  // Uma tentativa de conexão por vez: cliques repetidos e a reconexão automática
  // reaproveitam a mesma tentativa em vez de se atropelarem.
  attach() {
    this.attaching ||= this.attachWithRetries().finally(() => (this.attaching = null));
    return this.attaching;
  }

  async attachWithRetries() {
    this.setStatus('connecting');
    let lastErr;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        if (attempt > 1) this.log(`Nova tentativa (${attempt} de 3)…`);
        await this.attachOnce();
        this.everConnected = true;
        this.setStatus('connected');
        return;
      } catch (err) {
        lastErr = err;
        this.log(`ERRO: ${err.name}: ${err.message}`);
        try {
          this.device.gatt.disconnect();
        } catch {
          /* já desconectado */
        }
        await sleep(1500);
      }
    }
    this.setStatus('disconnected', lastErr?.message);
    throw lastErr;
  }

  async attachOnce() {
    const step = (label, promise, ms = 30000) => {
      this.log(label + '…');
      return Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error(`tempo esgotado em: ${label}`)), ms)),
      ]);
    };
    const server = await step('Conectando', this.device.gatt.connect());
    // No Windows o link BLE ainda está negociando logo após connect().
    await sleep(800);
    if (!server.connected) throw new Error('a trena caiu logo após conectar');

    let found = null;
    for (const s of SERVICES) {
      try {
        const service = await step(`Procurando porta ${s.name}`, server.getPrimaryService(s.service), 15000);
        found = { ...s, char: await service.getCharacteristic(s.char) };
        break;
      } catch (err) {
        this.log(`Porta ${s.name} indisponível (${err.message})`);
        if (!server.connected) throw err;
      }
    }
    if (!found) throw new Error('nenhum serviço Bosch encontrado nesta trena');
    this.char = found.char;
    this.buffer = new Uint8Array(0);
    if (!this.char.__glmBound) {
      this.char.addEventListener('characteristicvaluechanged', (e) => this.onValue(e.target.value));
      this.char.__glmBound = true;
    }
    await step('Ativando avisos', this.char.startNotifications());
    this.log(`Conectada pela porta ${found.name}.`);

    const info = await this.request(CMD.INFO).catch(() => null);
    if (info?.length >= 26) {
      const part = new TextDecoder().decode(info.slice(16, 26)).replace(/\0/g, '');
      if (part) this.log(`Código do aparelho: ${part}`);
    }
    await this.request(CMD.AUTOSYNC, [0x01, 0x00]);
    this.log('Pronto. Meça no botão da trena ou use “Medir” no app.');
  }

  // Envia um comando e espera a resposta (um por vez).
  request(cmd, data = [], timeout = 5000) {
    const run = async () => {
      if (!this.char) throw new Error('trena desconectada');
      const frame = buildFrame(cmd, data);
      const answer = new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          this.pending = null;
          reject(new Error('a trena não respondeu'));
        }, timeout);
        this.pending = (resp) => {
          clearTimeout(timer);
          this.pending = null;
          resp.status ? reject(new Error(`trena recusou: ${STATUS[resp.status & 7] || resp.status}`)) : resolve(resp.data);
        };
      });
      this.log(`Enviado: ${hex(frame)}`);
      await (this.char.writeValueWithResponse ? this.char.writeValueWithResponse(frame) : this.char.writeValue(frame));
      return answer;
    };
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => {});
    return result;
  }

  // Mede sem tocar na trena: ela liga o laser, mede e devolve o valor.
  async measure() {
    const data = await this.request(CMD.MEASURE, [], 8000);
    if (data.length < 4) throw new Error('resposta de medida incompleta');
    const meters = (new DataView(data.buffer, data.byteOffset).getUint32(0, true) * 0.05) / 1000;
    if (!(meters > 0)) throw new Error('a trena não conseguiu medir (alvo fora de alcance?)');
    this.emit(Math.round(meters * 10000) / 10000, { remote: true });
    return meters;
  }

  async onDisconnected() {
    this.char = null;
    if (this.pending) this.pending({ status: 1, data: new Uint8Array(0) });
    this.log('Trena desconectou.');
    // Durante uma tentativa em andamento, quem decide repetir é attachWithRetries().
    if (this.attaching) return;
    this.setStatus('disconnected');
    // Só reconecta sozinho se já estava funcionando (a trena desliga após alguns minutos).
    if (this.manualDisconnect || !this.device || !this.everConnected) return;
    await sleep(1500);
    this.attach().catch(() => {});
  }

  disconnect() {
    this.manualDisconnect = true;
    this.device?.gatt?.disconnect();
  }

  onValue(dataView) {
    const chunk = new Uint8Array(dataView.buffer, dataView.byteOffset, dataView.byteLength);
    this.log('Recebido: ' + hex(chunk));
    const merged = new Uint8Array(this.buffer.length + chunk.length);
    merged.set(this.buffer);
    merged.set(chunk, this.buffer.length);
    const { frames, rest } = parseFrames(merged);
    this.buffer = rest.length > 64 ? new Uint8Array(0) : rest;
    for (const f of frames) {
      if (f.kind === 'response') {
        this.pending?.(f);
        continue;
      }
      const m = eventMeasure(f);
      if (m) this.emit(m.meters, m);
    }
  }

  emit(meters, extra = {}) {
    this.dispatchEvent(new CustomEvent('measure', { detail: { meters, ...extra, at: Date.now() } }));
  }

  // Para testar sem a trena (Configurações → Simular medida).
  simulate() {
    const meters = Math.round((1 + Math.random() * 5) * 1000) / 1000;
    this.emit(meters, { simulated: true });
  }
}

export const glm = new GLM();
