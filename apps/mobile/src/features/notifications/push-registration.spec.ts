/* eslint-disable import/first -- jest.mock must be hoisted above the imports
   it stubs. */
// On Android 13+ the system permission prompt does not appear until a
// notification channel exists, so the channel must be created first. The prompt
// itself is asked for at most once, and only when the caller says the member is
// inside a club.
const calls: string[] = []
const store = new Map<string, string>()
let promptThrows = false

jest.mock("react-native", () => ({ Platform: { OS: "android" } }))
jest.mock("expo-constants", () => ({
  __esModule: true,
  default: { expoConfig: { extra: {} }, easConfig: {} },
}))
jest.mock("../../shared/kv", () => ({
  kvGet: async (key: string) => store.get(key) ?? null,
  kvSet: async (key: string, value: string) => {
    store.set(key, value)
  },
}))
jest.mock("expo-device", () => ({ isDevice: true }))
jest.mock("../../shared/platform", () => ({ supportsPushNotifications: true }))
jest.mock("../../shared/api/client", () => ({
  getApiClient: () => ({ request: jest.fn(async () => ({})) }),
}))
jest.mock("expo-notifications", () => ({
  AndroidImportance: { DEFAULT: 3 },
  setNotificationChannelAsync: jest.fn(async () => {
    calls.push("channel")
  }),
  getPermissionsAsync: jest.fn(async () => {
    calls.push("getPermissions")
    return { granted: false }
  }),
  requestPermissionsAsync: jest.fn(async () => {
    calls.push("requestPermissions")
    if (promptThrows) throw new Error("prompt failed")
    return { granted: true }
  }),
  getExpoPushTokenAsync: jest.fn(async () => ({ data: "ExponentPushToken[x]" })),
}))

import { registerPushToken } from "./push-registration"

beforeEach(() => {
  calls.length = 0
  store.clear()
  promptThrows = false
})

it("creates the Android channel before asking for permission", async () => {
  await registerPushToken({ requestPermission: true })

  expect(calls.indexOf("channel")).toBeGreaterThanOrEqual(0)
  expect(calls.indexOf("channel")).toBeLessThan(
    calls.indexOf("requestPermissions"),
  )
})

it("only checks permission when the caller does not ask for a prompt", async () => {
  await registerPushToken()

  expect(calls).toContain("getPermissions")
  expect(calls).not.toContain("requestPermissions")
})

it("asks for permission at most once", async () => {
  await registerPushToken({ requestPermission: true })
  await registerPushToken({ requestPermission: true })

  expect(calls.filter((c) => c === "requestPermissions")).toHaveLength(1)
})

it("does not count a prompt that threw as asked", async () => {
  promptThrows = true
  await registerPushToken({ requestPermission: true })
  promptThrows = false
  await registerPushToken({ requestPermission: true })

  expect(calls.filter((c) => c === "requestPermissions")).toHaveLength(2)
})
