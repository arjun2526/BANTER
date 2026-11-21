const MAGIC = "BANT";

export async function encryptArchive(json: string, passphrase: string): Promise<Blob> {
  if (passphrase.length < 8) throw new Error("Use a passphrase of at least 8 characters.");
  const enc = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await derive(passphrase, salt);
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(json));
  const out = new Uint8Array(4 + 1 + 16 + 12 + cipher.byteLength);
  out.set(enc.encode(MAGIC), 0);
  out[4] = 1;
  out.set(salt, 5);
  out.set(iv, 21);
  out.set(new Uint8Array(cipher), 33);
  return new Blob([out], { type: "application/octet-stream" });
}

export async function decryptArchive(file: ArrayBuffer, passphrase: string): Promise<string> {
  const bytes = new Uint8Array(file);
  const head = new TextDecoder().decode(bytes.slice(0, 4));
  if (head !== MAGIC || bytes[4] !== 1) throw new Error("That is not a Banter archive.");
  const salt = bytes.slice(5, 21);
  const iv = bytes.slice(21, 33);
  const cipher = bytes.slice(33);
  const key = await derive(passphrase, salt);
  try {
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, cipher);
    return new TextDecoder().decode(plain);
  } catch {
    throw new Error("Could not unlock this archive. Check the passphrase.");
  }
}

async function derive(passphrase: string, salt: Uint8Array) {
  const base = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt as BufferSource, iterations: 150_000, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
