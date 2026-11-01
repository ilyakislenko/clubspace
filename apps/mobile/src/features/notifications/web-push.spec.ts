/* eslint-disable import/first -- jest.mock must be hoisted above the imports */
jest.mock("../../shared/api/client", () => ({ getApiClient: jest.fn() }))
jest.mock("../../shared/platform", () => ({ isWeb: true }))

import { applicationServerKey, isIosBrowser, webPushAvailability } from "./web-push"
import { parseWebPushLaunch } from "./web-push-click"

const CHROME = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36"
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Version/17.4 Mobile/15E148 Safari/604.1"
const IPAD_AS_MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.4 Safari/605.1.15"

const env = (over: Partial<Parameters<typeof webPushAvailability>[0]> = {}) => ({
  userAgent: CHROME,
  maxTouchPoints: 0,
  standalone: false,
  hasPush: true,
  permission: "default" as NotificationPermission | null,
  ...over,
})

describe("webPushAvailability", () => {
  it("offers the switch in a desktop/Android browser", () => {
    expect(webPushAvailability(env())).toBe("available")
    expect(webPushAvailability(env({ permission: "granted" }))).toBe("available")
  })

  it("reports a blocked site and a browser without the Push API", () => {
    expect(webPushAvailability(env({ permission: "denied" }))).toBe("denied")
    expect(webPushAvailability(env({ hasPush: false }))).toBe("unsupported")
    expect(webPushAvailability(env({ permission: null }))).toBe("unsupported")
  })

  it("asks iPhone and iPad Safari to install to the Home Screen first", () => {
    // Safari outside the installed app has no Notification at all.
    expect(webPushAvailability(env({ userAgent: IPHONE, hasPush: false, permission: null }))).toBe(
      "ios-needs-install",
    )
    expect(webPushAvailability(env({ userAgent: IPAD_AS_MAC, maxTouchPoints: 5 }))).toBe(
      "ios-needs-install",
    )
    expect(webPushAvailability(env({ userAgent: IPHONE, standalone: true }))).toBe("available")
  })

  it("does not take a real Mac for an iPad", () => {
    expect(isIosBrowser({ userAgent: IPAD_AS_MAC, maxTouchPoints: 0 })).toBe(false)
  })
})

describe("applicationServerKey", () => {
  it("decodes base64url without padding", () => {
    expect(Array.from(applicationServerKey("BP8A_w"))).toEqual([4, 255, 0, 255])
  })
})

describe("parseWebPushLaunch", () => {
  it("reads the payload the service worker opened the app with", () => {
    const data = { kind: "announcement.published", workspaceId: "w1" }
    expect(parseWebPushLaunch(`?push=${encodeURIComponent(JSON.stringify(data))}`)).toEqual(data)
  })

  it("ignores a missing or broken parameter", () => {
    expect(parseWebPushLaunch("")).toBeUndefined()
    expect(parseWebPushLaunch("?push=%7Bnope")).toBeUndefined()
  })
})
