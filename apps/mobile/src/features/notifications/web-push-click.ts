// The contract between the service worker's `notificationclick` handler
// (public/service-worker.js) and the app: with a window open the worker posts
// `{ type: WEB_PUSH_CLICK_MESSAGE, data }` to it; otherwise it opens
// `/?push=<JSON data>`. `data` is the notification's metadata, routed exactly
// like a native push tap (notification-route.ts).
export const WEB_PUSH_CLICK_MESSAGE = "clubspace:push-click"
export const WEB_PUSH_LAUNCH_PARAM = "push"

/** Parses the launch URL's payload; undefined when absent or malformed. */
export const parseWebPushLaunch = (search: string): unknown => {
  const raw = new URLSearchParams(search).get(WEB_PUSH_LAUNCH_PARAM)
  if (!raw) return undefined
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return undefined
  }
}

// Read once at bundle start, before the navigator syncs the address bar to
// the first screen and drops the query string; removed right away so a reload
// doesn't navigate again.
let launchData: unknown = undefined
if (typeof window !== "undefined" && window.location?.search) {
  launchData = parseWebPushLaunch(window.location.search)
  if (launchData !== undefined) {
    const url = new URL(window.location.href)
    url.searchParams.delete(WEB_PUSH_LAUNCH_PARAM)
    window.history.replaceState(window.history.state, "", url.toString())
  }
}

/** The payload a push tap opened the app with — handed out once. */
export const takeWebPushLaunchData = (): unknown => {
  const data = launchData
  launchData = undefined
  return data
}
