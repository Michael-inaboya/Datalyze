import { beforeAll, describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret } from "../secrets";

describe("secrets", () => {
  beforeAll(() => {
    process.env.DATALYZE_SECRET_KEY = Buffer.alloc(32, 7).toString("base64");
  });

  it("round-trips and never stores the plain text", () => {
    const stored = encryptSecret("rk_live_abc123");
    expect(stored).not.toContain("rk_live");
    expect(decryptSecret(stored)).toBe("rk_live_abc123");
  });

  it("rejects tampered values", () => {
    const [v, iv, tag, body] = encryptSecret("rk_live_abc123").split(".");
    const flipped = Buffer.from(body, "base64");
    flipped[0] ^= 1;
    expect(() => decryptSecret([v, iv, tag, flipped.toString("base64")].join("."))).toThrow();
  });
});
