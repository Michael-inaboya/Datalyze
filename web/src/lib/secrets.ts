import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// AES-256-GCM with a key that lives only in the server environment (DATALYZE_SECRET_KEY, 32 bytes base64).
function key(): Buffer {
  const k = Buffer.from(process.env.DATALYZE_SECRET_KEY ?? "", "base64");
  if (k.length !== 32) throw new Error("Live connections are not set up on this server yet (DATALYZE_SECRET_KEY is missing).");
  return k;
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64"), c.getAuthTag().toString("base64"), body.toString("base64")].join(".");
}

export function decryptSecret(stored: string): string {
  const [v, iv, tag, body] = stored.split(".");
  if (v !== "v1" || !iv || !tag || !body) throw new Error("Stored key is unreadable. Reconnect the account.");
  const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(body, "base64")), d.final()]).toString("utf8");
}
