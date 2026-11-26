import { readFileSync } from "node:fs"
import { join } from "node:path"

type Env = Record<string, string | undefined>
type EasJson = { build?: Record<string, Record<string, unknown>> }
type PublishInput = {
  easJson: EasJson
  profile: string
  args?: string[]
  env: Env
  fileExists?: (path: string) => boolean
}

const { platformOf, resolveBuildProfile, resolveOtaPublish } =
  require("./ota-publish") as {
    platformOf: (args: string[]) => string
    resolveBuildProfile: (easJson: EasJson, name: string) => Record<string, unknown>
    resolveOtaPublish: (input: Required<PublishInput>) => {
      channel: string
      environment: string
      env: Record<string, string>
    }
  }

const EAS_JSON: EasJson = JSON.parse(
  readFileSync(join(__dirname, "..", "eas.json"), "utf8"),
)
const PROJECT = { EAS_PROJECT_ID: "6f1c0d2e-0000-4000-8000-000000000000" }
const FCM = { GOOGLE_SERVICES_FILE: "/secrets/google-services.json" }

// The committed eas.json carries placeholders until set-mobile-target.sh
// fills them in; this is it after that run.
const TARGET_ENV = {
  EXPO_PUBLIC_API_URL: "https://api.clubspace.ru",
  EXPO_PUBLIC_WEB_URL: "https://app.clubspace.ru",
  EXPO_PUBLIC_SUPPORT_EMAIL: "help@clubspace.ru",
}
const TARGETED: EasJson = {
  build: {
    ...EAS_JSON.build,
    production: {
      ...EAS_JSON.build?.production,
      env: { ...(EAS_JSON.build?.production.env as Env), ...TARGET_ENV },
    },
  },
}

const publish = ({ args = [], fileExists = () => true, ...rest }: PublishInput) =>
  resolveOtaPublish({ args, fileExists, ...rest })

describe("eas.json channels", () => {
  it("puts every build profile on its channel: development none, the neutral app's builds together, branded apart", () => {
    const channels = Object.fromEntries(
      Object.keys(EAS_JSON.build ?? {}).map((profile) => [
        profile,
        resolveBuildProfile(EAS_JSON, profile).channel ?? null,
      ]),
    )
    expect(channels).toEqual({
      development: null,
      preview: "preview",
      production: "production",
      // The Play AAB is the same app as the APK: one update reaches both.
      store: "production",
      branded: "branded",
      "branded-store": "branded",
    })
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

describe("platformOf", () => {
  it("reads eas update's --platform / -p, all when absent", () => {
    expect(platformOf([])).toBe("all")
    expect(platformOf(["--rollout-percentage", "20"])).toBe("all")
    expect(platformOf(["--platform", "ios"])).toBe("ios")
    expect(platformOf(["--platform=android"])).toBe("android")
    expect(platformOf(["-p", "ios"])).toBe("ios")
    expect(platformOf(["-p=ios"])).toBe("ios")
  })
})

describe("resolveOtaPublish", () => {
  it("targets the profile's channel and EAS environment", () => {
    const out = publish({ easJson: TARGETED, profile: "store", env: { ...PROJECT, ...FCM } })
    expect(out.channel).toBe("production")
    expect(out.environment).toBe("production")
    const preview = publish({ easJson: EAS_JSON, profile: "preview", env: PROJECT })
    expect(preview.environment).toBe("preview")
  })

  it("bundles with the profile's env, not the publisher's dev shell", () => {
    const out = publish({
      easJson: TARGETED,
      profile: "production",
      env: {
        ...PROJECT,
        ...FCM,
        PATH: "/usr/bin",
        EXPO_PUBLIC_API_URL: "http://localhost:3000",
        EXPO_PUBLIC_DEMO_LOGIN_CODE: "dev-only",
        APP_ASSETS_DIR: "branding/dev",
        UNSET: undefined,
      },
    })
    expect(out.env).toEqual({
      ...PROJECT,
      ...FCM,
      PATH: "/usr/bin",
      ...(TARGETED.build?.production.env as Record<string, string>),
    })
    expect(out.env.EXPO_PUBLIC_CLUB_PICKER).toBe("true")
  })

  it("leaves a branded app's identity to its EAS environment", () => {
    const out = publish({
      easJson: EAS_JSON,
      profile: "branded",
      env: { ...PROJECT, ...FCM, EXPO_PUBLIC_APP_NAME: "Чужой клуб" },
    })
    expect(out.env).toEqual({ ...PROJECT, ...FCM, EXPO_PUBLIC_CLUB_PICKER: "false" })
  })

  it("refuses the neutral app's release with placeholder or plain-http URLs, like the build guard", () => {
    // The committed eas.json, before set-mobile-target.sh.
    expect(() =>
      publish({ easJson: EAS_JSON, profile: "production", env: { ...PROJECT, ...FCM } }),
    ).toThrow(/EXPO_PUBLIC_API_URL is a placeholder.*EXPO_PUBLIC_WEB_URL must be an https URL/)
    const http: EasJson = {
      build: {
        ...TARGETED.build,
        production: {
          ...TARGETED.build?.production,
          env: {
            ...(TARGETED.build?.production.env as Env),
            EXPO_PUBLIC_API_URL: "http://192.168.1.46:3000",
          },
        },
      },
    }
    expect(() =>
      publish({ easJson: http, profile: "store", env: { ...PROJECT, ...FCM } }),
    ).toThrow("EXPO_PUBLIC_API_URL must be an https URL")
  })

  describe("google-services.json (hashed into the Android fingerprint)", () => {
    it("keeps the publisher's local copy and checks it exists", () => {
      const seen: string[] = []
      const out = publish({
        easJson: TARGETED,
        profile: "production",
        env: { ...PROJECT, ...FCM },
        fileExists: (path) => {
          seen.push(path)
          return true
        },
      })
      expect(out.env.GOOGLE_SERVICES_FILE).toBe(FCM.GOOGLE_SERVICES_FILE)
      expect(seen).toEqual([FCM.GOOGLE_SERVICES_FILE])

      expect(() =>
        publish({
          easJson: EAS_JSON,
          profile: "preview",
          env: { ...PROJECT, ...FCM },
          fileExists: () => false,
        }),
      ).toThrow("missing file")
    })

    it("is required for a release publish that includes Android", () => {
      for (const args of [[], ["--platform", "android"], ["-p", "all"]]) {
        expect(() =>
          publish({ easJson: TARGETED, profile: "production", args, env: PROJECT }),
        ).toThrow("GOOGLE_SERVICES_FILE is not set")
        expect(() =>
          publish({ easJson: EAS_JSON, profile: "branded-store", args, env: PROJECT }),
        ).toThrow("GOOGLE_SERVICES_FILE is not set")
      }
    })

    it("is not needed for an iOS-only publish or a preview build", () => {
      expect(
        publish({
          easJson: TARGETED,
          profile: "production",
          args: ["--platform", "ios"],
          env: PROJECT,
        }).channel,
      ).toBe("production")
      expect(publish({ easJson: EAS_JSON, profile: "preview", env: PROJECT }).channel).toBe(
        "preview",
      )
    })
  })

  it("refuses a profile without a channel and an unknown EAS project", () => {
    expect(() =>
      publish({ easJson: EAS_JSON, profile: "development", env: PROJECT }),
    ).toThrow("no channel")
    expect(() =>
      publish({ easJson: TARGETED, profile: "production", env: { EAS_PROJECT_ID: " " } }),
    ).toThrow("EAS_PROJECT_ID")
  })

  it("refuses a channel without an EAS environment", () => {
    const easJson = { build: { p: { channel: "p" } } }
    expect(() => publish({ easJson, profile: "p", env: PROJECT })).toThrow("environment")
  })
})
