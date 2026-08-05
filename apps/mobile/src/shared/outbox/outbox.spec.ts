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
jest.mock("../api/client", () => ({
  getApiClient: () => ({ request }),
}))

import {
  clearOutbox,
  enqueue,
  flushOutbox,
  isPermanentError,
  pendingCount,
} from "./outbox"

const httpError = (status?: number) => ({
  response: status ? { status } : undefined,
})

beforeEach(async () => {
  file = null
  request.mockReset()
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
})
