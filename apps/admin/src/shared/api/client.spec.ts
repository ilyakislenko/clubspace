/** @jest-environment jsdom */
import type { AxiosHttpClientConfig } from "@clubspace/api-client"

import type * as ClientModuleNs from "./client"

const mockRequest = jest.fn()
const mockRefreshSession = jest.fn()
const mockConfigs: AxiosHttpClientConfig[] = []

jest.mock("@clubspace/api-client", () => ({
  ...jest.requireActual("@clubspace/api-client"),
  createAxiosHttpClient: (config: AxiosHttpClientConfig) => {
    mockConfigs.push(config)
    return { client: { request: mockRequest }, axios: {}, refreshSession: mockRefreshSession }
  },
}))

type ClientModule = typeof ClientModuleNs

// A fresh module per test: the token store is module-level state.
const load = (): ClientModule => {
  let mod!: ClientModule
  jest.isolateModules(() => {
    mod = jest.requireActual<ClientModule>("./client")
  })
  return mod
}

const session = { userId: "u1", accessToken: "access-1", expiresAt: 1_900_000_000 }

beforeEach(() => {
  mockRequest.mockReset()
  mockRefreshSession.mockReset()
  mockConfigs.length = 0
  window.localStorage.clear()
})

describe("admin session client", () => {
  it("deletes tokens the old localStorage store left behind, and nothing else", () => {
    for (const key of ["accessToken", "refreshToken", "expiresAt", "userId"]) {
      window.localStorage.setItem(key, "old")
    }
    window.localStorage.setItem("clubspace:schedule-calendar", "{}")

    load().getApiClient()

    expect(Object.keys(window.localStorage)).toEqual(["clubspace:schedule-calendar"])
  })

  it("asks the API for the cookie transport", () => {
    load().getApiClient()
    expect(mockConfigs).toHaveLength(1)
    expect(mockConfigs[0].tokenTransport).toBe("cookie")
    expect(mockConfigs[0].refreshLock).toEqual(expect.any(Function))
  })

  it("keeps the access token in memory only", () => {
    const client = load()
    client.storeAuthTokens(session)

    expect(client.getAccessToken()).toBe("access-1")
    expect(window.localStorage.length).toBe(0)
    expect(mockConfigs).toHaveLength(0)
  })

  it("restores a session from the refresh cookie when memory holds none", async () => {
    const client = load()
    mockRefreshSession.mockResolvedValue(true)

    await expect(client.restoreSession()).resolves.toBe(true)
    expect(mockRefreshSession).toHaveBeenCalledTimes(1)
  })

  it("reports no session when the cookie has none", async () => {
    mockRefreshSession.mockResolvedValue(false)
    await expect(load().restoreSession()).resolves.toBe(false)
  })

  it("does not refresh while an access token is in memory", async () => {
    const client = load()
    client.storeAuthTokens(session)

    await expect(client.restoreSession()).resolves.toBe(true)
    expect(mockRefreshSession).not.toHaveBeenCalled()
  })

  it("signs out through the cookie and forgets the token even if the call fails", async () => {
    const client = load()
    client.storeAuthTokens(session)
    mockRequest.mockRejectedValue(new Error("offline"))

    await client.signOut()

    expect(mockRequest).toHaveBeenCalledWith({ method: "post", url: "/sign-out", data: {} })
    expect(client.getAccessToken()).toBeNull()
  })

  it("serializes refreshes across tabs with a Web Lock", async () => {
    load().getApiClient()
    const { refreshLock } = mockConfigs[0]
    const request = jest.fn((_name: string, run: () => Promise<string>) => run())
    Object.defineProperty(navigator, "locks", { value: { request }, configurable: true })
    try {
      await expect(refreshLock!(async () => "done")).resolves.toBe("done")
      expect(request).toHaveBeenCalledWith("clubspace-admin-refresh", expect.any(Function))
    } finally {
      Object.defineProperty(navigator, "locks", { value: undefined, configurable: true })
    }
    // Without the API (old browsers) the refresh just runs.
    await expect(refreshLock!(async () => "plain")).resolves.toBe("plain")
  })
})
