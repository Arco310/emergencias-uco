// Criptografía con WebCrypto (navegador y Node 18+). Sin dependencias.
//  - Contraseñas: nunca se guardan; se deriva una clave con PBKDF2-SHA256.
//  - Datos locales: cifrados con una clave de datos (DEK) AES-GCM-256 que se
//    guarda envuelta con la clave de cada usuario y con una clave de recuperación.
//  - Sincronización: cifrado extremo a extremo con una clave del preventivo (HKDF).
import { randomBytes, enc, dec, b64, unb64, hex, base32, base32decode } from './util.js';

const subtle = () => globalThis.crypto.subtle;
export const PBKDF2_ITER = 150000;

export async function deriveKek(password, salt, iter = PBKDF2_ITER) {
  const base = await subtle().importKey('raw', enc.encode(String(password).normalize('NFC')), 'PBKDF2', false, ['deriveKey']);
  return subtle().deriveKey({ name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
export async function genDek() { return subtle().generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']); }
export async function exportRaw(key) { return new Uint8Array(await subtle().exportKey('raw', key)); }
export async function importAes(raw, extractable = true) { return subtle().importKey('raw', raw, { name: 'AES-GCM' }, extractable, ['encrypt', 'decrypt']); }

export async function encryptBytes(key, bytes) {
  const iv = randomBytes(12);
  const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv }, key, bytes));
  return { iv, ct };
}
export async function decryptBytes(key, rec) {
  return new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv: rec.iv }, key, rec.ct));
}
export async function encryptJSON(key, obj) { return encryptBytes(key, enc.encode(JSON.stringify(obj))); }
export async function decryptJSON(key, rec) { return JSON.parse(dec.decode(await decryptBytes(key, rec))); }

/** Envuelve la clave de datos con una contraseña */
export async function wrapDek(dek, password, iter = PBKDF2_ITER) {
  const salt = randomBytes(16);
  const kek = await deriveKek(password, salt, iter);
  const w = await encryptBytes(kek, await exportRaw(dek));
  return { salt, iter, iv: w.iv, ct: w.ct };
}
/** Recupera la clave de datos. Lanza un error si la contraseña no es correcta. */
export async function unwrapDek(wrap, password) {
  const kek = await deriveKek(password, wrap.salt, wrap.iter);
  return importAes(await decryptBytes(kek, wrap), true);
}

export async function sha256(data) {
  const bytes = typeof data === 'string' ? enc.encode(data) : data;
  return new Uint8Array(await subtle().digest('SHA-256', bytes));
}
export async function sha256hex(data) { return hex(await sha256(data)); }

export async function hkdfBits(secret, info, bits = 256) {
  const k = await subtle().importKey('raw', secret, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await subtle().deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: enc.encode('uco-gestor-v1'), info: enc.encode(info) }, k, bits));
}
/** Claves de un preventivo compartido a partir de su secreto */
export async function prevKeys(secret) {
  const keyRaw = await hkdfBits(secret, 'datos');
  const token = hex(await hkdfBits(secret, 'acceso'));
  return { key: await importAes(keyRaw, false), token, tokenHash: await sha256hex(token) };
}

/** Cifrado compacto para transporte: base64(iv || ct) */
export async function seal(key, obj) {
  const r = await encryptJSON(key, obj);
  const out = new Uint8Array(r.iv.length + r.ct.length); out.set(r.iv, 0); out.set(r.ct, r.iv.length);
  return b64(out);
}
export async function open(key, str) {
  const u = unb64(str);
  return decryptJSON(key, { iv: u.subarray(0, 12), ct: u.subarray(12) });
}
export async function sealBytes(key, bytes) {
  const r = await encryptBytes(key, bytes);
  const out = new Uint8Array(r.iv.length + r.ct.length); out.set(r.iv, 0); out.set(r.ct, r.iv.length);
  return out;
}
export async function openBytes(key, u) { return decryptBytes(key, { iv: u.subarray(0, 12), ct: u.subarray(12) }); }

/** Clave de recuperación legible: 6 grupos de 5 caracteres */
export function newRecoveryCode() {
  const s = base32(randomBytes(19)).slice(0, 30);
  return s.match(/.{5}/g).join('-');
}
export function normalizeRecovery(code) { return String(code || '').toUpperCase().replace(/[^0-9A-Z]/g, ''); }
export { base32decode };
