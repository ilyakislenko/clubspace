import { getApiClient } from "../../shared/api/client"
import { isWeb } from "../../shared/platform"

// Web Push for the browser / PWA build. The service worker
// (public/service-worker.js) shows the notifications and routes taps; this
// module owns the subscription: asking for permission (only ever from a tap —
// browsers block or penalise prompts without a user gesture), handing the
// subscription to the server, and dropping it on sign-out.

export type WebPushState =
  // No Push API here (old browser, http://, or the dev server without a SW).
  | "unsupported"
  // iPhone/iPad Safari: Web Push exists only for a site added to the Home
  // Screen (iOS 16.4+), so the member has to install it first.
  | "ios-needs-install"
  // Blocked in the browser's site settings; only the member can undo it.
  | "denied"
  // Can be switched on (permission not asked yet, or granted but no subscription).
  | "available"
  // Subscribed and permitted.
  | "enabled"

type BrowserEnv = {
  userAgent: string
  maxTouchPoints: number
  standalone: boolean
  hasPush: boolean
  permission: NotificationPermission | null
}

/** iPhone, iPad, and iPadOS 13+ which reports itself as a Mac with touch. */
export const isIosBrowser = (env: Pick<BrowserEnv, "userAgent" | "maxTouchPoints">) =>
  /iPad|iPhone|iPod/.test(env.userAgent) ||
  (/Macintosh/.test(env.userAgent) && env.maxTouchPoints > 1)

/**
 * What the notifications switch can offer, before knowing whether a
 * subscription exists (`enabled` is decided by the caller). Pure, for tests.
 */
export const webPushAvailability = (
  env: BrowserEnv,
): Exclude<WebPushState, "enabled"> => {
  if (isIosBrowser(env) && !env.standalone) return "ios-needs-install"
  if (!env.hasPush || env.permission === null) return "unsupported"
  if (env.permission === "denied") return "denied"
  return "available"
}

/** base64url → bytes, for PushManager.subscribe's applicationServerKey. */
export const applicationServerKey = (base64url: string): Uint8Array<ArrayBuffer> => {
  const base64 = base64url.replace(/-/g, "+").replace(/_/g, "/")
  const raw = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4))
  const out = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

const browserEnv = (): BrowserEnv => {
  const nav = navigator as Navigator & { standalone?: boolean }
  return {
    userAgent: nav.userAgent,
    maxTouchPoints: nav.maxTouchPoints ?? 0,
    standalone:
      nav.standalone === true ||
      window.matchMedia?.("(display-mode: standalone)").matches === true,
    hasPush:
      window.isSecureContext &&
      "serviceWorker" in nav &&
      "PushManager" in window,
    permission: "Notification" in window ? Notification.permission : null,
  }
}

// Only the registration the PWA build installed. The dev server serves the
// worker with its build placeholders unreplaced, so registering it here would
// just throw — there is nothing to subscribe with there.
const registration = async (): Promise<ServiceWorkerRegistration | null> => {
  if (!("serviceWorker" in navigator)) return null
  const reg = await navigator.serviceWorker.getRegistration()
  return reg ? navigator.serviceWorker.ready : null
}

const currentSubscription = async (): Promise<PushSubscription | null> =>
  (await (await registration())?.pushManager.getSubscription()) ?? null

export const getWebPushState = async (): Promise<WebPushState> => {
  if (!isWeb) return "unsupported"
  const availability = webPushAvailability(browserEnv())
  if (availability !== "available") return availability
  if (!(await registration())) return "unsupported"
  if (Notification.permission !== "granted") return "available"
  return (await currentSubscription().catch(() => null)) ? "enabled" : "available"
}

const sendToServer = async (sub: PushSubscription) => {
  const json = sub.toJSON()
  await getApiClient().request({
    method: "post",
    url: "/me/web-push-subscriptions",
    data: {
      endpoint: sub.endpoint,
      p256dh: json.keys?.p256dh,
      auth: json.keys?.auth,
      userAgent: navigator.userAgent.slice(0, 512),
    },
  })
}

// Sign-in, a club switch and a tap can all race to subscribe; a second
// pushManager.subscribe() would mint another endpoint and orphan the first.
let subscribing: Promise<PushSubscription> | null = null

const subscribe = (reg: ServiceWorkerRegistration): Promise<PushSubscription> => {
  subscribing ??= createSubscription(reg).finally(() => {
    subscribing = null
  })
  return subscribing
}

const createSubscription = async (reg: ServiceWorkerRegistration) => {
  const existing = await reg.pushManager.getSubscription()
  if (existing) return existing
  const config = await getApiClient().request<{ publicKey: string | null }>({
    method: "get",
    url: "/me/web-push-subscriptions/config",
  })
  if (!config.publicKey) throw new Error("Сервер не настроен для веб-уведомлений")
  return reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: applicationServerKey(config.publicKey),
  })
}

/**
 * Turns notifications on. MUST be called from a tap handler: it may show the
 * browser's permission prompt. Resolves to the resulting state.
 */
export const enableWebPush = async (): Promise<WebPushState> => {
  const state = await getWebPushState()
  if (state !== "available") return state
  const permission = await Notification.requestPermission()
  if (permission !== "granted") return permission === "denied" ? "denied" : "available"
  const reg = await registration()
  if (!reg) return "unsupported"
  await sendToServer(await subscribe(reg))
  return "enabled"
}

/**
 * Drops this browser's subscription, on the server first (so nothing more is
 * sent here) and then in the browser. Best-effort: used on sign-out.
 */
export const disableWebPush = async (): Promise<void> => {
  if (!isWeb) return
  try {
    const sub = await currentSubscription()
    if (!sub) return
    await getApiClient()
      .request({
        method: "delete",
        url: "/me/web-push-subscriptions",
        data: { endpoint: sub.endpoint },
      })
      .catch(() => undefined)
    await sub.unsubscribe()
  } catch {
    /* noop */
  }
}

/**
 * On sign-in: if this browser already allowed notifications, (re)attach its
 * subscription to the signed-in account. Never prompts.
 */
export const syncWebPush = async (): Promise<void> => {
  if (!isWeb) return
  try {
    if ((await getWebPushState()) === "unsupported") return
    if (Notification.permission !== "granted") return
    const reg = await registration()
    if (reg) await sendToServer(await subscribe(reg))
  } catch {
    /* retried on the next sign-in */
  }
}
