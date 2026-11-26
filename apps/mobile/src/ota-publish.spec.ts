import { readFileSync } from "node:fs"
import { join } from "node:path"

type Env = Record<string, string | undefined>
type EasJson = { build?: Record<string, Record<string, unknown>> }

const { resolveBuildProfile, resolveOtaPublish } = require("./ota-publish") as {
  resolveBuildProfile: (easJson: EasJson, name: string) => Record<string, unknown>
  resolveOtaPublish: (input: { easJson: EasJson; profile: string; env: Env }) => {
    channel: string
    environment: string
    env: Record<string, string>
  }
}

const EAS_JSON: EasJson = JSON.parse(
  readFileSync(join(__dirname, "..", "eas.json"), "utf8"),
)
const PROJECT = { EAS_PROJECT_ID: "6f1c0d2e-0000-4000-8000-000000000000" }

describe("eas.json channels", () => {
  const channelOf = (profile: string) =>
    resolveBuildProfile(EAS_JSON, profile).channel

  it("gives development builds no channel: they take no OTA updates", () => {
    expect(channelOf("development")).toBeUndefined()
  })

  it("publishes preview and the neutral app's release builds on their own channels", () => {
    expect(channelOf("preview")).toBe("preview")
    expect(channelOf("production")).toBe("production")
    // The Play AAB is the same app as the APK: one update reaches both.
    expect(channelOf("store")).toBe("production")
  })

  it("keeps a club's branded app on a channel of its own", () => {
    expect(channelOf("branded")).toBe("branded")
    expect(channelOf("branded-store")).toBe("branded")
  })
})

describe("resolveBuildProfile", () => {
  it("applies extends and merges env key by key", () => {
    const easJson = {
      build: {
        base: { channel: "base", env: { A: "1", B: "1" } },
        child: { extends: "base", env: { B: "2" } },
      },
    }
    expect(resolveBuildProfile(easJson, "child")).toEqual({
      channel: "base",
      env: { A: "1", B: "2" },
    })
  })

  it("refuses an unknown profile and an extends loop", () => {
    expect(() => resolveBuildProfile({ build: {} }, "nope")).toThrow("nope")
    const loop = { build: { a: { extends: "b" }, b: { extends: "a" } } }
    expect(() => resolveBuildProfile(loop, "a")).toThrow("loop")
  })
})

describe("resolveOtaPublish", () => {
  it("targets the profile's channel and EAS environment", () => {
    const out = resolveOtaPublish({ easJson: EAS_JSON, profile: "store", env: PROJECT })
    expect(out.channel).toBe("production")
    expect(out.environment).toBe("production")
    const preview = resolveOtaPublish({ easJson: EAS_JSON, profile: "preview", env: PROJECT })
    expect(preview.environment).toBe("preview")
  })

  it("bundles with the profile's env, not the publisher's dev shell", () => {
    const out = resolveOtaPublish({
      easJson: EAS_JSON,
      profile: "production",
      env: {
        ...PROJECT,
        PATH: "/usr/bin",
        EXPO_PUBLIC_API_URL: "http://localhost:3000",
        EXPO_PUBLIC_DEMO_LOGIN_CODE: "dev-only",
        APP_ASSETS_DIR: "branding/dev",
        GOOGLE_SERVICES_FILE: "./google-services.dev.json",
        UNSET: undefined,
      },
    })
    expect(out.env).toEqual({
      ...PROJECT,
      PATH: "/usr/bin",
      ...(EAS_JSON.build?.production.env as Record<string, string>),
    })
    expect(out.env.EXPO_PUBLIC_CLUB_PICKER).toBe("true")
  })

  it("leaves a branded app's identity to its EAS environment", () => {
    const out = resolveOtaPublish({
      easJson: EAS_JSON,
      profile: "branded",
      env: { ...PROJECT, EXPO_PUBLIC_APP_NAME: "Чужой клуб" },
    })
    expect(out.env).toEqual({ ...PROJECT, EXPO_PUBLIC_CLUB_PICKER: "false" })
  })

  it("refuses a profile without a channel and an unknown EAS project", () => {
    expect(() =>
      resolveOtaPublish({ easJson: EAS_JSON, profile: "development", env: PROJECT }),
    ).toThrow("no channel")
    expect(() =>
      resolveOtaPublish({ easJson: EAS_JSON, profile: "production", env: { EAS_PROJECT_ID: " " } }),
    ).toThrow("EAS_PROJECT_ID")
  })

  it("refuses a channel without an EAS environment", () => {
    const easJson = { build: { p: { channel: "p" } } }
    expect(() => resolveOtaPublish({ easJson, profile: "p", env: PROJECT })).toThrow(
      "environment",
    )
  })
})
