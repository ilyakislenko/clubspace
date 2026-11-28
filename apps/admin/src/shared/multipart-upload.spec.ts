jest.mock("./upload-to-s3", () => ({ putToPresignedUrl: jest.fn() }))

import {
  combinedPercent,
  PART_ATTEMPTS,
  PART_CONCURRENCY,
  planPartRanges,
  uploadInParts,
  uploadVideoFile,
} from "./multipart-upload"
import { putToPresignedUrl } from "./upload-to-s3"

const putMock = putToPresignedUrl as jest.Mock

const signed = (count: number) =>
  Array.from({ length: count }, (_, i) => ({
    partNumber: i + 1,
    url: `https://s3/x?partNumber=${i + 1}`,
  }))

const partOf = (url: string) => Number(new URL(url).searchParams.get("partNumber"))

describe("planPartRanges", () => {
  it("cuts full parts and a shorter last one, in part order", () => {
    expect(
      planPartRanges(1_000, 300, [...signed(4)].reverse()).map((p) => [
        p.partNumber,
        p.start,
        p.end,
      ]),
    ).toEqual([
      [1, 0, 300],
      [2, 300, 600],
      [3, 600, 900],
      [4, 900, 1_000],
    ])
  })
})

describe("combinedPercent", () => {
  it("sums the bytes sent of every part against the whole file", () => {
    expect(combinedPercent(new Map(), 1_000)).toBe(0)
    expect(
      combinedPercent(
        new Map([
          [1, 300],
          [2, 150],
        ]),
        1_000,
      ),
    ).toBe(45)
    expect(combinedPercent(new Map([[1, 1_000]]), 1_000)).toBe(100)
    expect(combinedPercent(new Map(), 0)).toBe(0)
  })
})

describe("uploadInParts", () => {
  const file = new Blob([new Uint8Array(1_000)])

  it("sends each slice to its URL and returns the ETags in part order", async () => {
    const bodies = new Map<number, number>()
    const put = jest.fn(async (url: string, body: Blob) => {
      bodies.set(partOf(url), body.size)
      // Finish out of order: later parts first.
      await new Promise((r) => setTimeout(r, 10 - partOf(url)))
      return { etag: `"e${partOf(url)}"` }
    })
    const progress: number[] = []
    const parts = await uploadInParts({
      file,
      partSize: 300,
      parts: signed(4),
      put,
      onProgress: (p) => progress.push(p),
    })
    expect(parts).toEqual([1, 2, 3, 4].map((n) => ({ partNumber: n, etag: `"e${n}"` })))
    expect([...bodies.entries()].sort()).toEqual([
      [1, 300],
      [2, 300],
      [3, 300],
      [4, 100],
    ])
    expect(progress.at(-1)).toBe(100)
  })

  it(`keeps at most ${PART_CONCURRENCY} parts in flight`, async () => {
    let inFlight = 0
    let peak = 0
    const put = jest.fn(async (url: string) => {
      inFlight++
      peak = Math.max(peak, inFlight)
      await new Promise((r) => setTimeout(r, 1))
      inFlight--
      return { etag: `"e${partOf(url)}"` }
    })
    await uploadInParts({ file, partSize: 100, parts: signed(10), put })
    expect(put).toHaveBeenCalledTimes(10)
    expect(peak).toBe(PART_CONCURRENCY)
  })

  it("reports progress across parts while they upload", async () => {
    const progress: number[] = []
    const put = jest.fn(async (url: string, body: Blob, options) => {
      options.onProgress?.({ loaded: body.size / 2, total: body.size, percent: 50 })
      return { etag: `"e${partOf(url)}"` }
    })
    await uploadInParts({
      file,
      partSize: 500,
      parts: signed(2),
      put,
      onProgress: (p) => progress.push(p),
    })
    // Part 1 half sent (25 %), part 2 half sent too (50 %), …, all done.
    expect(progress[0]).toBe(25)
    expect(progress).toContain(50)
    expect(progress.at(-1)).toBe(100)
  })

  it("tries a failing part again, from zero", async () => {
    const progress: number[] = []
    let failed = false
    const put = jest.fn(async (url: string, body: Blob, options) => {
      options.onProgress?.({ loaded: body.size, total: body.size, percent: 100 })
      if (partOf(url) === 2 && !failed) {
        failed = true
        throw new Error("Сетевая ошибка")
      }
      return { etag: `"e${partOf(url)}"` }
    })
    const parts = await uploadInParts({
      file,
      partSize: 500,
      parts: signed(2),
      put,
      retryDelayMs: 0,
      onProgress: (p) => progress.push(p),
    })
    expect(parts.map((p) => p.etag)).toEqual(['"e1"', '"e2"'])
    expect(put.mock.calls.filter(([url]) => partOf(url) === 2)).toHaveLength(2)
    expect(progress.at(-1)).toBe(100)
  })

  it(`gives up after ${PART_ATTEMPTS} tries and stops the other parts`, async () => {
    const seen: AbortSignal[] = []
    const put = jest.fn(async (url: string, _body: Blob, options) => {
      seen.push(options.signal)
      if (partOf(url) === 1) throw new Error("Не удалось загрузить файл (код 500)")
      // The others hang until stopped.
      await new Promise((_, reject) =>
        options.signal.addEventListener("abort", () =>
          reject(new DOMException("Upload aborted", "AbortError")),
        ),
      )
      return { etag: null }
    })
    await expect(
      uploadInParts({ file, partSize: 300, parts: signed(4), put, retryDelayMs: 0 }),
    ).rejects.toThrow("код 500")
    expect(put.mock.calls.filter(([url]) => partOf(url) === 1)).toHaveLength(PART_ATTEMPTS)
    expect(seen.every((s) => s.aborted)).toBe(true)
  })

  it("fails at once when storage hides the ETag header (CORS)", async () => {
    const put = jest.fn(async () => ({ etag: null }))
    await expect(
      uploadInParts({ file, partSize: 1_000, parts: signed(1), put, retryDelayMs: 0 }),
    ).rejects.toThrow("ExposeHeaders: ETag")
    expect(put).toHaveBeenCalledTimes(1)
  })

  it("rejects with an AbortError when cancelled, and starts no more parts", async () => {
    const controller = new AbortController()
    const put = jest.fn(async (_url: string, _body: Blob, options) => {
      await new Promise((_, reject) =>
        options.signal.addEventListener("abort", () =>
          reject(new DOMException("Upload aborted", "AbortError")),
        ),
      )
      return { etag: null }
    })
    const upload = uploadInParts({
      file,
      partSize: 100,
      parts: signed(10),
      put,
      signal: controller.signal,
    })
    controller.abort()
    await expect(upload).rejects.toMatchObject({ name: "AbortError" })
    expect(put).toHaveBeenCalledTimes(PART_CONCURRENCY)
  })
})

describe("uploadVideoFile", () => {
  const video = new File([new Uint8Array(10)], "v.mp4", { type: "video/mp4" })

  beforeEach(() => putMock.mockReset())

  it("sends a single PUT and returns no parts", async () => {
    putMock.mockResolvedValue({ etag: '"x"' })
    const progress: number[] = []
    await expect(
      uploadVideoFile({ method: "PUT", url: "https://s3/x" }, video, {
        contentType: "video/mp4",
        onProgress: (p) => progress.push(p),
      }),
    ).resolves.toBeUndefined()
    expect(putMock).toHaveBeenCalledWith(
      "https://s3/x",
      video,
      expect.objectContaining({ contentType: "video/mp4" }),
    )
    putMock.mock.calls[0][2].onProgress({ loaded: 5, total: 10, percent: 50 })
    expect(progress).toEqual([50])
  })

  it("uploads in parts when the server asks for it", async () => {
    putMock.mockImplementation(async (url: string) => ({ etag: `"e${partOf(url)}"` }))
    await expect(
      uploadVideoFile(
        { method: "MULTIPART", uploadId: "u1", partSize: 5, parts: signed(2) },
        video,
        { contentType: "video/mp4" },
      ),
    ).resolves.toEqual([
      { partNumber: 1, etag: '"e1"' },
      { partNumber: 2, etag: '"e2"' },
    ])
    expect(putMock).toHaveBeenCalledTimes(2)
  })

  it("refuses a PUT target without a URL", async () => {
    await expect(
      uploadVideoFile({ method: "PUT" }, video, { contentType: "video/mp4" }),
    ).rejects.toThrow("адрес")
  })
})
