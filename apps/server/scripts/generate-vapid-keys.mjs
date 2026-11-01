#!/usr/bin/env node
// Prints a fresh VAPID key pair for Web Push (the PWA's notifications), ready to
// paste into .env:
//
//   node apps/server/scripts/generate-vapid-keys.mjs
//
// Generate once per deployment and keep it: rotating the pair invalidates every
// browser subscription (members have to re-enable notifications).
import { generateKeyPairSync } from "node:crypto"

const { publicKey, privateKey } = generateKeyPairSync("ec", {
  namedCurve: "prime256v1",
})
const pub = publicKey.export({ format: "jwk" })
const point = Buffer.concat([
  Buffer.from([4]),
  Buffer.from(pub.x, "base64url"),
  Buffer.from(pub.y, "base64url"),
])

console.log(`WEB_PUSH_VAPID_PUBLIC_KEY=${point.toString("base64url")}`)
console.log(`WEB_PUSH_VAPID_PRIVATE_KEY=${privateKey.export({ format: "jwk" }).d}`)
console.log("WEB_PUSH_SUBJECT=mailto:you@your-domain")
