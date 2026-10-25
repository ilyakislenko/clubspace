import { Linking } from "react-native"

import { navigationRef } from "../../app/navigation"
import { kvDelete, kvGet, kvSet } from "../../shared/kv"
import { isWeb } from "../../shared/platform"
import { extractJoinCode, shouldOpenJoin } from "./join-code"

// A join link (https://<app>/join/<code> or clubspace://join/<code>) can arrive
// while the member is signed out or has no club. The code is held — in memory
// and in the kv store, so an app restart for sign-in keeps it — until the
// member is signed in and routed to the join screen.
const KEY = "clubspace.pendingJoinCode"
let held: string | null = null
let enabled = false

const capture = (url: string) => {
  const code = extractJoinCode(url)
  if (!code) return
  held = code
  void kvSet(KEY, code).catch(() => undefined)
  flushPendingJoin()
}

// Called once at App.tsx MODULE scope, before any render: on web React
// Navigation rewrites the URL to /sign-in while it mounts, and child effects run
// before the parent App's, so the code has to be read first.
export const initPendingJoinCapture = () => {
  void kvGet(KEY)
    .then((value) => {
      if (value && !held) held = value
    })
    .catch(() => undefined)
  if (isWeb) {
    capture((globalThis as { location?: { href?: string } }).location?.href ?? "")
    return
  }
  void Linking.getInitialURL().then((url) => {
    if (url) capture(url)
  })
  Linking.addEventListener("url", ({ url }) => capture(url))
}

export const peekPendingJoin = () => held

export const setPendingJoinRoutingEnabled = (on: boolean) => {
  enabled = on
  if (on) flushPendingJoin()
}

export const flushPendingJoin = () => {
  void (async () => {
    if (!enabled || !navigationRef.isReady()) return
    const code = held ?? (await kvGet(KEY).catch(() => null))
    if (!code) return
    held = null
    await kvDelete(KEY).catch(() => undefined)
    if (shouldOpenJoin(navigationRef.getCurrentRoute(), code)) {
      navigationRef.navigate("JoinClub", { code })
    }
  })()
}

export const clearPendingJoin = async () => {
  held = null
  await kvDelete(KEY).catch(() => undefined)
}
