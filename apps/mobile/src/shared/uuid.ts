// RFC 4122 version-4 ids for records the client creates offline (the server
// accepts them as primary keys). Hermes has no `crypto.randomUUID` and only
// some builds expose `getRandomValues`, so this falls back to Math.random —
// collisions within one member's own records are not a realistic concern.

type CryptoLike = {
  randomUUID?: () => string
  getRandomValues?: (bytes: Uint8Array) => Uint8Array
}

export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export const randomUuid = (): string => {
  // RN's global typings don't declare Web Crypto; it may or may not exist.
  const host = globalThis as { crypto?: CryptoLike }
  const crypto = host.crypto
  if (typeof crypto?.randomUUID === "function") return crypto.randomUUID()
  const bytes = new Uint8Array(16)
  if (typeof crypto?.getRandomValues === "function") {
    crypto.getRandomValues(bytes)
  } else {
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = Math.floor(Math.random() * 256)
    }
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
