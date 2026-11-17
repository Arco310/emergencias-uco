// Acceso a IndexedDB con promesas, y almacén en memoria de reserva (cuando el
// navegador no permite IndexedDB, por ejemplo en la vista previa). La interfaz es
// la misma para ambos.
export const DB_NAME = 'uco-gestor';
export const DB_VERSION = 1;
export const STORES = {
  meta: { keyPath: 'k' },
  users: { keyPath: 'id' },
  docs: { keyPath: 'id' },
  ops: { keyPath: 'id', indexes: [['p', 'p'], ['pend', ['p', 'ps']]] },
  blobs: { keyPath: 'id' },
  audit: { keyPath: 'id', indexes: [['t', 't']] },
  backups: { keyPath: 'id', indexes: [['t', 't']] },
};

/** Migraciones documentadas. v1: esquema inicial. */
function upgrade(db, oldV) {
  if (oldV < 1) {
    for (const [name, def] of Object.entries(STORES)) {
      const st = db.createObjectStore(name, { keyPath: def.keyPath });
      for (const [iname, path] of def.indexes || []) st.createIndex(iname, path);
    }
  }
}

const P = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export class IDBAdapter {
  static async open(name = DB_NAME) {
    if (!globalThis.indexedDB) throw new Error('IndexedDB no disponible');
    const req = indexedDB.open(name, DB_VERSION);
    req.onupgradeneeded = e => upgrade(req.result, e.oldVersion);
    const db = await new Promise((res, rej) => {
      req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error);
      req.onblocked = () => rej(new Error('La base de datos está bloqueada por otra pestaña con una versión anterior'));
    });
    db.onversionchange = () => { db.close(); };
    const a = new IDBAdapter(); a.db = db; a.kind = 'indexeddb'; return a;
  }
  _tx(stores, mode = 'readonly') { return this.db.transaction(stores, mode); }
  async get(store, key) { return P(this._tx([store]).objectStore(store).get(key)); }
  async getAll(store, index, query) {
    const st = this._tx([store]).objectStore(store);
    return P(index ? st.index(index).getAll(query) : st.getAll());
  }
  async count(store) { return P(this._tx([store]).objectStore(store).count()); }
  async put(store, value) { return this.putMany(store, [value]); }
  async putMany(store, values) {
    const t = this._tx([store], 'readwrite'); const st = t.objectStore(store);
    for (const v of values) st.put(v);
    return new Promise((res, rej) => { t.oncomplete = () => res(); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error || new Error('Transacción abortada')); });
  }
  async del(store, key) {
    const t = this._tx([store], 'readwrite'); t.objectStore(store).delete(key);
    return new Promise((res, rej) => { t.oncomplete = () => res(); t.onerror = () => rej(t.error); });
  }
  async clear(stores) {
    const t = this._tx(stores, 'readwrite'); for (const s of stores) t.objectStore(s).clear();
    return new Promise((res, rej) => { t.oncomplete = () => res(); t.onerror = () => rej(t.error); });
  }
  /**
   * Guarda operaciones asignando de forma atómica (misma transacción) el número
   * local correlativo (nl) y la referencia provisional por dispositivo (nr).
   * Evita duplicados aunque haya varias pestañas abiertas.
   */
  async appendOps(pid, records, devCode) {
    const t = this._tx(['ops', 'meta'], 'readwrite');
    const ops = t.objectStore('ops'), meta = t.objectStore('meta');
    const kNum = 'num:' + pid, kRef = 'ref:' + pid;
    const done = new Promise((res, rej) => { t.oncomplete = () => res(records); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error || new Error('Transacción abortada')); });
    const rn = meta.get(kNum), rr = meta.get(kRef);
    let got = 0;
    const go = () => {
      if (++got < 2) return;
      let num = (rn.result && rn.result.v) || 0, ref = (rr.result && rr.result.v) || 0;
      for (const r of records) {
        if (r.nl && r.num == null) r.num = ++num;
        if (r.nr && !r.ref) r.ref = devCode + '-' + (++ref);
        ops.put(r);
      }
      meta.put({ k: kNum, v: num }); meta.put({ k: kRef, v: ref });
    };
    rn.onsuccess = go; rr.onsuccess = go;
    return done;
  }
}

/** Almacén en memoria con la misma interfaz (datos no persistentes) */
export class MemoryAdapter {
  constructor() { this.kind = 'memoria'; this.s = {}; for (const k of Object.keys(STORES)) this.s[k] = new Map(); }
  key(store, v) { return v[STORES[store].keyPath]; }
  async get(store, key) { const v = this.s[store].get(key); return v === undefined ? undefined : structuredClone(v); }
  async getAll(store, index, query) {
    let vals = [...this.s[store].values()];
    if (index) {
      const path = STORES[store].indexes.find(i => i[0] === index)[1];
      vals = vals.filter(v => (Array.isArray(path) ? path.every((p, i) => v[p] === query[i]) : v[path] === query));
    }
    return vals.map(v => structuredClone(v));
  }
  async count(store) { return this.s[store].size; }
  async put(store, value) { this.s[store].set(this.key(store, value), structuredClone(value)); }
  async putMany(store, values) { for (const v of values) await this.put(store, v); }
  async del(store, key) { this.s[store].delete(key); }
  async clear(stores) { for (const s of stores) this.s[s].clear(); }
  async appendOps(pid, records, devCode) {
    const kNum = 'num:' + pid, kRef = 'ref:' + pid;
    let num = (this.s.meta.get(kNum) || {}).v || 0, ref = (this.s.meta.get(kRef) || {}).v || 0;
    for (const r of records) {
      if (r.nl && r.num == null) r.num = ++num;
      if (r.nr && !r.ref) r.ref = devCode + '-' + (++ref);
      this.s.ops.set(r.id, structuredClone(r));
    }
    this.s.meta.set(kNum, { k: kNum, v: num }); this.s.meta.set(kRef, { k: kRef, v: ref });
    return records;
  }
}

export async function openStorage() {
  try { return await IDBAdapter.open(); }
  catch (e) { console.warn('IndexedDB no disponible, se usa memoria:', e && e.message); return new MemoryAdapter(); }
}
