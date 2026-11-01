import { buildOfflinePlan, OfflinePlanError } from "./offline-plan"

const BASE = "https://app.example.com/__offline/vid-1/"

// What GET /videos/:id/offline-manifest returns for an ffmpeg VOD rung: the
// server rewrites each segment line into an absolute presigned URL.
const MANIFEST = [
  "#EXTM3U",
  "#EXT-X-VERSION:3",
  "#EXT-X-TARGETDURATION:4",
  "#EXT-X-MEDIA-SEQUENCE:0",
  "#EXT-X-PLAYLIST-TYPE:VOD",
  "#EXT-X-INDEPENDENT-SEGMENTS",
  "#EXTINF:4.000000,",
  "https://s3.example.com/clubspace/hls/vid-1/v1/seg_00000.ts?X-Amz-Signature=a",
  "#EXTINF:4.000000,",
  "https://s3.example.com/clubspace/hls/vid-1/v1/seg_00001.ts?X-Amz-Signature=b",
  "#EXTINF:2.500000,",
  "https://s3.example.com/clubspace/hls/vid-1/v1/seg_00002.ts?X-Amz-Signature=c",
  "#EXT-X-ENDLIST",
  "",
].join("\n")

describe("buildOfflinePlan", () => {
  it("lists every segment with a stable local path and its duration", () => {
    const plan = buildOfflinePlan(MANIFEST, BASE)
    expect(plan.resources).toEqual([
      {
        kind: "segment",
        remoteUrl:
          "https://s3.example.com/clubspace/hls/vid-1/v1/seg_00000.ts?X-Amz-Signature=a",
        localPath: "seg/00000.ts",
        durationSec: 4,
      },
      expect.objectContaining({ localPath: "seg/00001.ts", durationSec: 4 }),
      expect.objectContaining({ localPath: "seg/00002.ts", durationSec: 2.5 }),
    ])
    expect(plan.segmentCount).toBe(3)
    expect(plan.totalDurationSec).toBeCloseTo(10.5)
  })

  it("rewrites the playlist to the local copies and keeps the tags", () => {
    const { playlist } = buildOfflinePlan(MANIFEST, BASE)
    const lines = playlist.split("\n")
    expect(lines).toContain(`${BASE}seg/00000.ts`)
    expect(lines).toContain(`${BASE}seg/00002.ts`)
    expect(playlist).not.toContain("s3.example.com")
    expect(playlist).not.toContain("X-Amz-Signature")
    expect(lines[0]).toBe("#EXTM3U")
    expect(lines).toContain("#EXT-X-ENDLIST")
    expect(lines.filter((l) => l.startsWith("#EXTINF"))).toHaveLength(3)
  })

  it("keeps local paths and fingerprint when the links are re-signed", () => {
    const resigned = MANIFEST.replace(/Signature=[a-z]/g, "Signature=zzz")
    const first = buildOfflinePlan(MANIFEST, BASE)
    const second = buildOfflinePlan(resigned, BASE)
    expect(second.fingerprint).toBe(first.fingerprint)
    expect(second.resources.map((r) => r.localPath)).toEqual(
      first.resources.map((r) => r.localPath),
    )
    expect(second.resources[0].remoteUrl).toContain("Signature=zzz")
  })

  it("changes the fingerprint when the rendition differs", () => {
    const shorter = MANIFEST.replace("#EXTINF:2.500000,", "#EXTINF:2.000000,")
    expect(buildOfflinePlan(shorter, BASE).fingerprint).not.toBe(
      buildOfflinePlan(MANIFEST, BASE).fingerprint,
    )
  })

  it("downloads encryption keys and init sections and points the tags at them", () => {
    const manifest = [
      "#EXTM3U",
      '#EXT-X-KEY:METHOD=AES-128,URI="https://s3.example.com/k/key.bin?sig=1",IV=0x01',
      '#EXT-X-MAP:URI="https://s3.example.com/v/init.mp4?sig=2"',
      "#EXTINF:4,",
      "https://s3.example.com/v/seg0.m4s?sig=3",
      "#EXT-X-ENDLIST",
    ].join("\n")
    const plan = buildOfflinePlan(manifest, BASE)
    expect(plan.resources.map((r) => [r.kind, r.localPath])).toEqual([
      ["key", "key/00000.key"],
      ["init", "init/00000.mp4"],
      ["segment", "seg/00000.m4s"],
    ])
    expect(plan.playlist).toContain(
      `#EXT-X-KEY:METHOD=AES-128,URI="${BASE}key/00000.key",IV=0x01`,
    )
    expect(plan.playlist).toContain(`#EXT-X-MAP:URI="${BASE}init/00000.mp4"`)
  })

  it("leaves an unencrypted key tag alone", () => {
    const manifest = MANIFEST.replace(
      "#EXT-X-INDEPENDENT-SEGMENTS",
      "#EXT-X-KEY:METHOD=NONE",
    )
    const plan = buildOfflinePlan(manifest, BASE)
    expect(plan.resources.every((r) => r.kind === "segment")).toBe(true)
    expect(plan.playlist).toContain("#EXT-X-KEY:METHOD=NONE")
  })

  it.each([
    ["not a playlist", "<html>"],
    ["a master playlist", "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nhttps://x/v0.m3u8\n#EXT-X-ENDLIST"],
    ["a live playlist without ENDLIST", MANIFEST.replace("#EXT-X-ENDLIST", "")],
    ["no segments", "#EXTM3U\n#EXT-X-ENDLIST"],
    ["a relative segment URI", MANIFEST.replace(/https:\/\/s3[^\n]*seg_00001[^\n]*/, "seg_00001.ts")],
    ["byte-range segments", MANIFEST.replace("#EXTINF:4.000000,", "#EXTINF:4.000000,\n#EXT-X-BYTERANGE:100@0")],
    ["a segment without EXTINF", MANIFEST.replace("#EXTINF:2.500000,\n", "")],
  ])("refuses %s", (_label, manifest) => {
    expect(() => buildOfflinePlan(manifest, BASE)).toThrow(OfflinePlanError)
  })
})
