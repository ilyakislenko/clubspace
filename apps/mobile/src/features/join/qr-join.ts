import { joinCodeFromInput } from "./join-code"

// A club's QR poster encodes `https://<web host>/join/<CODE>`
// (apps/server/src/domains/workspace/join-qr.ts). Any host is accepted: a
// branded club's poster points at its own domain. The path must be exactly
// /join/<CODE> (a trailing slash, query or fragment is fine).
const JOIN_URL =
  /^https?:\/\/[^/?#\s]+\/join\/([A-Za-z0-9-]+)\/?(?:[?#]\S*)?$/i

// A poster may carry just the code: XXXX-XXXX or XXXXXXXX.
const BARE_CODE = /^[A-Za-z0-9]{4}-?[A-Za-z0-9]{4}$/

/** The join code in a scanned QR payload, or null when it is not a club's. */
export const joinCodeFromQr = (data: string): string | null => {
  const text = data.trim()
  const raw = JOIN_URL.exec(text)?.[1] ?? (BARE_CODE.test(text) ? text : null)
  if (raw === null || raw.replace(/-/g, "").length !== 8) return null
  return joinCodeFromInput(raw).code
}
