import { StackActions } from "@react-navigation/native"
import Constants from "expo-constants"
import { Linking } from "react-native"

import { navigationRef } from "../../app/navigation"
import { environment } from "../../shared/env"
import { isWeb } from "../../shared/platform"
import { parseMomentLink, type MomentLink } from "./moment-link"

// Shared moments («Поделиться моментом») in the native app. The web build
// routes `/video/<id>?startAt=…` through its linking config; native deep
// linking stays off (App.tsx), so — like join links (pending-join) — a moment
// link that opened the app is held here until the member is signed in, past
// consent and lock screens, and then opens the lesson. A lesson the member
// can't open shows VideoScreen's own error.

let held: MomentLink | null = null
let enabled = false

const capture = (url: string) => {
  const moment = parseMomentLink(url)
  if (!moment) return
  held = moment
  flushPendingMoment()
}

// Called once at App.tsx module scope, next to the join capture.
export const initPendingMomentCapture = () => {
  if (isWeb) return
  void Linking.getInitialURL().then((url) => {
    if (url) capture(url)
  })
  Linking.addEventListener("url", ({ url }) => capture(url))
}

export const setPendingMomentRoutingEnabled = (on: boolean) => {
  enabled = on
  if (on) flushPendingMoment()
}

export const flushPendingMoment = () => {
  if (!enabled || !held || !navigationRef.isReady()) return
  const { videoId, startAt, loopEndAt } = held
  held = null
  // A fresh lesson screen: one already open reads its start only once.
  navigationRef.dispatch(StackActions.push("Video", { videoId, startAt, loopEndAt }))
}

/**
 * Where shared links point: the deploy's web app when it has one (opens for
 * anyone, app or not), the web app's own origin when running in it, else this
 * app's scheme.
 */
export const momentLinkBase = (): string => {
  if (environment.webUrl) return environment.webUrl
  if (isWeb) {
    const origin = (globalThis as { location?: { origin?: string } }).location?.origin
    if (origin) return origin
  }
  const scheme = Constants.expoConfig?.scheme
  return `${(Array.isArray(scheme) ? scheme[0] : scheme) ?? "clubspace"}://`
}
