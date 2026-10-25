import { canSyncVideoData, isFeatureEnabled } from "./feature-flags"
import type { WorkspaceSummary } from "./api/workspaces"

const ws = (patch: Record<string, unknown>) =>
  ({ accessExpired: false, features: {}, ...patch }) as unknown as WorkspaceSummary

describe("isFeatureEnabled", () => {
  it("defaults to on when the flag is missing", () => {
    expect(isFeatureEnabled(ws({ features: undefined }), "videos")).toBe(true)
    expect(isFeatureEnabled(null, "videos")).toBe(true)
  })

  it("is off only for an explicit false", () => {
    expect(isFeatureEnabled(ws({ features: { videos: false } }), "videos")).toBe(false)
  })
})

describe("canSyncVideoData", () => {
  it("syncs when videos are on and access is live", () => {
    expect(canSyncVideoData(ws({}))).toBe(true)
  })

  it("skips when videos are off", () => {
    expect(canSyncVideoData(ws({ features: { videos: false } }))).toBe(false)
  })

  it("skips when the access has expired", () => {
    expect(canSyncVideoData(ws({ accessExpired: true }))).toBe(false)
  })

  it("skips without a workspace", () => {
    expect(canSyncVideoData(null)).toBe(false)
  })
})
