import {
  AxiosError,
  AxiosHeaders,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from "axios"

import { createAxiosHttpClient, type AxiosHttpClientConfig } from "./axios-http-client"
import { createMemoryTokenStore } from "./token-store"

type Route = (config: InternalAxiosRequestConfig) => { status: number; data: unknown }

// Every request the client sends, answered by `route` instead of the network.
const build = (route: Route, overrides: Partial<AxiosHttpClientConfig> = {}) => {
  const tokenStore = createMemoryTokenStore()
  const onUnauthorized = jest.fn()
  const sent: InternalAxiosRequestConfig[] = []
  const http = createAxiosHttpClient({
    baseURL: "http://api.test",
    tokenStore,
    onUnauthorized,
    ...overrides,
  })
  http.axios.defaults.adapter = async (config) => {
    sent.push(config)
    const { status, data } = route(config)
    const response: AxiosResponse = {
      data,
      status,
      statusText: String(status),
      headers: {},
      config,
    }
    if (status >= 400) {
      throw new AxiosError("failed", undefined, config, undefined, response)
    }
    return response
  }
  return { ...http, tokenStore, onUnauthorized, sent }
}

const session = (accessToken: string, refreshToken?: string) => ({
  userId: "u1",
  accessToken,
  ...(refreshToken ? { refreshToken } : {}),
  expiresAt: Math.floor(Date.now() / 1000) + 900,
})

const body = (config: InternalAxiosRequestConfig) =>
  typeof config.data === "string" ? JSON.parse(config.data) : config.data

const header = (config: InternalAxiosRequestConfig, name: string) =>
  AxiosHeaders.from(config.headers).get(name)

describe("createAxiosHttpClient — cookie transport", () => {
  it("sends session routes with credentials and the transport header, nothing else", async () => {
    const { client, sent } = build(() => ({ status: 200, data: {} }), {
      tokenTransport: "cookie",
    })
    await client.request({ method: "post", url: "/sign-in", data: {} })
    await client.request({ method: "post", url: "/sign-out", data: {} })
    await client.request({ method: "post", url: "/me/sign-out-everywhere" })
    await client.request({ method: "get", url: "/me" })

    expect(sent.map((c) => [c.url, c.withCredentials, header(c, "X-Token-Transport")])).toEqual([
      ["/sign-in", true, "cookie"],
      ["/sign-out", true, "cookie"],
      ["/me/sign-out-everywhere", true, "cookie"],
      ["/me", undefined, undefined],
    ])
  })

  it("restores a session from the cookie and never stores a refresh token", async () => {
    const { refreshSession, tokenStore, sent } = build(
      () => ({ status: 201, data: session("access-1") }),
      { tokenTransport: "cookie" }
    )

    await expect(refreshSession()).resolves.toBe(true)

    expect(sent[0].url).toBe("/refresh-token")
    expect(sent[0].withCredentials).toBe(true)
    expect(header(sent[0], "X-Token-Transport")).toBe("cookie")
    expect(body(sent[0])).toEqual({})
    expect(tokenStore.getAccessToken()).toBe("access-1")
    expect(tokenStore.getRefreshToken()).toBeNull()
  })

  it("reports no session on a 401 without signing the page out", async () => {
    const { refreshSession, onUnauthorized } = build(
      () => ({ status: 401, data: { code: "REFRESH_TOKEN_NOT_FOUND" } }),
      { tokenTransport: "cookie" }
    )
    await expect(refreshSession()).resolves.toBe(false)
    expect(onUnauthorized).not.toHaveBeenCalled()
  })

  it("refreshes from the cookie on a 401 and retries with the new token", async () => {
    let refreshed = false
    const { client, sent } = build(
      (config) => {
        if (config.url === "/refresh-token") {
          refreshed = true
          return { status: 201, data: session("access-2") }
        }
        return refreshed ? { status: 200, data: { ok: true } } : { status: 401, data: {} }
      },
      { tokenTransport: "cookie" }
    )

    await expect(client.request({ method: "get", url: "/me" })).resolves.toEqual({ ok: true })
    expect(sent.map((c) => c.url)).toEqual(["/me", "/refresh-token", "/me"])
    expect(header(sent[2], "Authorization")).toBe("Bearer access-2")
  })

  it("signs out when the cookie refresh behind a 401 fails", async () => {
    const { client, tokenStore, onUnauthorized } = build(() => ({ status: 401, data: {} }), {
      tokenTransport: "cookie",
    })
    tokenStore.setAccessToken("stale")
    await expect(client.request({ method: "get", url: "/me" })).rejects.toBeInstanceOf(AxiosError)
    expect(onUnauthorized).toHaveBeenCalled()
    expect(tokenStore.getAccessToken()).toBeNull()
  })

  it("drops a refresh answer that lands after sign-out", async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    const { refreshSession, tokenStore, axios } = build(() => ({ status: 201, data: {} }), {
      tokenTransport: "cookie",
    })
    axios.defaults.adapter = async (config) => {
      await gate
      return { data: session("late"), status: 201, statusText: "201", headers: {}, config }
    }
    tokenStore.setAccessToken("access-1")
    const pending = refreshSession()
    tokenStore.clear()
    release()
    await pending
    expect(tokenStore.getAccessToken()).toBeNull()
  })

  it("runs each refresh inside the cross-tab lock", async () => {
    const order: string[] = []
    const refreshLock = jest.fn(async <T,>(run: () => Promise<T>) => {
      order.push("lock")
      const result = await run()
      order.push("unlock")
      return result
    })
    const { refreshSession } = build(
      () => {
        order.push("request")
        return { status: 201, data: session("access-1") }
      },
      { tokenTransport: "cookie", refreshLock }
    )
    await refreshSession()
    expect(order).toEqual(["lock", "request", "unlock"])
  })
})

describe("createAxiosHttpClient — body transport (default)", () => {
  it("refreshes with the stored token in the body, without credentials", async () => {
    let refreshed = false
    const { client, tokenStore, sent } = build((config) => {
      if (config.url === "/refresh-token") {
        refreshed = true
        return { status: 201, data: session("access-2", "refresh-2") }
      }
      return refreshed ? { status: 200, data: {} } : { status: 401, data: {} }
    })
    tokenStore.setAccessToken("access-1")
    tokenStore.setRefreshToken("refresh-1")

    await client.request({ method: "get", url: "/me" })

    const refresh = sent[1]
    expect(body(refresh)).toEqual({ refreshToken: "refresh-1" })
    expect(refresh.withCredentials).toBeUndefined()
    expect(header(refresh, "X-Token-Transport")).toBeUndefined()
    expect(tokenStore.getRefreshToken()).toBe("refresh-2")
  })

  it("signs out on a 401 when no refresh token is stored", async () => {
    const { client, onUnauthorized, sent } = build(() => ({ status: 401, data: {} }))
    await expect(client.request({ method: "get", url: "/me" })).rejects.toBeInstanceOf(AxiosError)
    expect(onUnauthorized).toHaveBeenCalledTimes(1)
    expect(sent.map((c) => c.url)).toEqual(["/me"])
  })

  it("has no session to restore without a stored refresh token", async () => {
    const { refreshSession, sent } = build(() => ({ status: 201, data: {} }))
    await expect(refreshSession()).resolves.toBe(false)
    expect(sent).toEqual([])
  })
})
