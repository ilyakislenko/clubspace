/* eslint-disable import/first -- jest.mock must be hoisted above the imports. */
// The queue file's location and its I/O both come from fs-safe, so mocking that
// one module keeps expo-file-system (native ESM) out of the import graph.
let file: string | null = null
jest.mock("../fs-safe", () => ({
  DOCUMENT_DIR: "file:///doc/",
  safeReadString: jest.fn(async () => file),
  safeWriteString: jest.fn(async (_path: string, content: string) => {
    file = content
    return true
  }),
}))

const request = jest.fn()
const requestProfiles: (string | null)[] = []
jest.mock("../api/client", () => ({
  requestAs: (profileId: string | null, config: unknown) => {
    requestProfiles.push(profileId)
    return request(config)
  },
}))

import {
  clearOutbox,
  discardKeyed,
  enqueue,
  flushOutbox,
  isPermanentError,
  pendingCount,
} from "./outbox"
import { setProfileScopeId } from "../profile-scope"

const httpError = (status?: number) => ({
  response: status ? { status } : undefined,
})

beforeEach(async () => {
  file = null
  request.mockReset()
  requestProfiles.length = 0
  setProfileScopeId(null)
  await clearOutbox()
})

describe("isPermanentError", () => {
  it("is true for 4xx, false for 5xx / network", () => {
    expect(isPermanentError(httpError(404))).toBe(true)
    expect(isPermanentError(httpError(409))).toBe(true)
    expect(isPermanentError(httpError(500))).toBe(false)
    expect(isPermanentError(httpError(undefined))).toBe(false)
    expect(isPermanentError(new Error("Network Error"))).toBe(false)
  })

  it("keeps a write refused only for a pending consent", () => {
    const consentGate = {
      response: { status: 403, data: { code: "CONSENT_REQUIRED" } },
    }
    const revoked = { response: { status: 403, data: { code: "FORBIDDEN" } } }
    expect(isPermanentError(consentGate)).toBe(false)
    expect(isPermanentError(revoked)).toBe(true)
  })
})

describe("outbox flush", () => {
  const op = (label: string) =>
    ({ label, method: "post", url: `/x/${label}` }) as const

  it("replays queued ops in order and clears them on success", async () => {
    request.mockResolvedValue({})
    await enqueue(op("a"))
    await enqueue(op("b"))
    expect(await pendingCount()).toBe(2)

    await flushOutbox()

    expect(request).toHaveBeenCalledTimes(2)
    expect(request.mock.calls[0][0].url).toBe("/x/a")
    expect(request.mock.calls[1][0].url).toBe("/x/b")
    expect(await pendingCount()).toBe(0)
  })

  it("stops at a transient failure, keeping the op for next time", async () => {
    request.mockRejectedValueOnce(httpError(undefined)) // network
    await enqueue(op("a"))
    await flushOutbox()
    expect(await pendingCount()).toBe(1)

    request.mockResolvedValueOnce({})
    await flushOutbox()
    expect(await pendingCount()).toBe(0)
  })

  it("drops a permanently-failing (4xx) op and continues", async () => {
    request
      .mockRejectedValueOnce(httpError(404)) // drop
      .mockResolvedValueOnce({}) // next succeeds
    await enqueue(op("bad"))
    await enqueue(op("good"))

    await flushOutbox()

    expect(await pendingCount()).toBe(0)
    expect(request).toHaveBeenCalledTimes(2)
  })

  it("replays each op as the profile it was queued in, not the active one", async () => {
    request.mockResolvedValue({})
    await enqueue(op("guardian"))
    setProfileScopeId("kid-1")
    await enqueue(op("kid"))
    setProfileScopeId("kid-2")

    await flushOutbox()

    expect(requestProfiles).toEqual([null, "kid-1"])
  })
})

describe("keyed ops (latest wins)", () => {
  const progress = (position: number) =>
    ({
      label: "Прогресс урока",
      method: "post",
      url: "/videos/v-1/progress",
      data: { position },
      key: "progress:v-1",
    }) as const

  it("keeps only the newest op per key, behind unrelated ones", async () => {
    request.mockResolvedValue({})
    await enqueue(progress(10))
    await enqueue({ label: "a", method: "post", url: "/x/a" })
    await enqueue(progress(20))
    expect(await pendingCount()).toBe(2)

    await flushOutbox()

    expect(request.mock.calls.map((c) => c[0].url)).toEqual([
      "/x/a",
      "/videos/v-1/progress",
    ])
    expect(request.mock.calls[1][0].data).toEqual({ position: 20 })
  })

  it("keeps one pending op per profile under the same key", async () => {
    request.mockResolvedValue({})
    await enqueue(progress(10))
    setProfileScopeId("kid-1")
    await enqueue(progress(30))
    expect(await pendingCount()).toBe(2)

    await flushOutbox()
    expect(requestProfiles).toEqual([null, "kid-1"])
  })

  it("forgets the queued op once a newer write reached the server", async () => {
    await enqueue(progress(10))
    await discardKeyed("progress:v-1")
    expect(await pendingCount()).toBe(0)
  })

  it("doesn't drop a replacement queued while its predecessor was in flight", async () => {
    let finish: (value: unknown) => void = () => undefined
    request.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    await enqueue(progress(10))
    const flushing = flushOutbox()
    // Replaces the op whose request is still out.
    await enqueue(progress(20))
    request.mockResolvedValue({})
    finish({})
    await flushing

    expect(request.mock.calls.map((c) => c[0].data)).toEqual([
      { position: 10 },
      { position: 20 },
    ])
    expect(await pendingCount()).toBe(0)
  })
})
