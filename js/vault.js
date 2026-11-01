/* Passphrase-encrypted backups using the browser's built-in WebCrypto (no libraries, nothing leaves the device).
 * AES-256-GCM, key from PBKDF2-SHA-256 (310,000 iterations, random 16-byte salt), random 12-byte IV per file.
 * A wrong passphrase or a modified file fails authentication and never produces data. */
(function (root) {
  'use strict';
  const ITER = 310000;
  const subtle = () => (root.crypto && root.crypto.subtle) || null;
  const b64 = u8 => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return root.btoa(s); };
  const unb64 = s => { const bin = root.atob(s), u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i); return u8; };
  async function key(pass, salt, iter, usage) {
    const base = await subtle().importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
    return subtle().deriveKey({ name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, usage);
  }
  const Vault = {
    available: () => !!subtle(),
    isEncrypted: o => !!o && typeof o === 'object' && o.fitwiseEncrypted === 1 && typeof o.data === 'string' && typeof o.salt === 'string' && typeof o.iv === 'string',
    async encrypt(text, pass) {
      if (!pass || pass.length < 8) throw new Error('weak');
      const salt = root.crypto.getRandomValues(new Uint8Array(16)), iv = root.crypto.getRandomValues(new Uint8Array(12));
      const ct = await subtle().encrypt({ name: 'AES-GCM', iv }, await key(pass, salt, ITER, ['encrypt']), new TextEncoder().encode(text));
      return { fitwiseEncrypted: 1, kdf: 'PBKDF2-SHA256', iter: ITER, cipher: 'AES-256-GCM', salt: b64(salt), iv: b64(iv), data: b64(new Uint8Array(ct)) };
    },
    async decrypt(obj, pass) {
      if (!Vault.isEncrypted(obj) || !(obj.iter >= 100000 && obj.iter <= 2000000)) throw new Error('format');
      try {
        const pt = await subtle().decrypt({ name: 'AES-GCM', iv: unb64(obj.iv) }, await key(pass, unb64(obj.salt), obj.iter, ['decrypt']), unb64(obj.data));
        return new TextDecoder().decode(pt);
      } catch (e) { throw new Error('wrong'); }
    }
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = Vault; else root.FitwiseVault = Vault;
})(typeof window !== 'undefined' ? window : globalThis);
