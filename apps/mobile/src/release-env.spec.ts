/* eslint-disable @typescript-eslint/no-require-imports -- release-env.js is
   plain CommonJS so scripts/check-release-env.mjs can load it */
type Env = Record<string, string | undefined>
type Result = { errors: string[]; warnings: string[] } | null

const { checkReleaseEnv } = require("./release-env") as {
  checkReleaseEnv: (input: {
    profile: string | undefined
    platform: string | undefined
    env: Env
    fileExists: (path: string) => boolean
    sameFile: (a: string, b: string) => boolean
  }) => Result
}

const COMMON: Env = {
  EXPO_PUBLIC_API_URL: "https://api.clubspace.ru",
  EXPO_PUBLIC_WEB_URL: "https://app.clubspace.ru",
  EXPO_PUBLIC_SUPPORT_EMAIL: "help@clubspace.ru",
  EAS_PROJECT_ID: "6f1c0d2e-0000-4000-8000-000000000000",
  GOOGLE_SERVICES_FILE: "/home/expo/google-services.json",
}

const CANONICAL: Env = {
  ...COMMON,
  EXPO_PUBLIC_BRAND: "clubspace",
  EXPO_PUBLIC_CLUB_PICKER: "true",
  EXPO_PUBLIC_WORKSPACE_KEY: "",
}

const BRANDED: Env = {
  ...COMMON,
  EXPO_PUBLIC_BRAND: "grappling",
  EXPO_PUBLIC_CLUB_PICKER: "false",
  EXPO_PUBLIC_WORKSPACE_KEY: "kimura_bjj",
  EXPO_PUBLIC_APP_NAME: "Кимура",
  EXPO_PUBLIC_BUNDLE_ID: "ru.kimura.app",
  APP_ASSETS_DIR: "branding/kimura",
}

const check = (
  profile: string | undefined,
  env: Env,
  fs: {
    exists?: (path: string) => boolean
    same?: (a: string, b: string) => boolean
    platform?: string
  } = {},
) =>
  checkReleaseEnv({
    profile,
    platform: fs.platform ?? "android",
    env,
    fileExists: fs.exists ?? (() => true),
    sameFile: fs.same ?? (() => false),
  })

const errorsOf = (result: Result) => {
  if (!result) throw new Error("expected a release profile")
  return result.errors.join("\n")
}

describe("checkReleaseEnv", () => {
  it("ignores non-release profiles and local runs", () => {
    expect(check(undefined, {})).toBeNull()
    expect(check("development", {})).toBeNull()
    expect(check("preview", {})).toBeNull()
  })

  it.each(["production", "store"])("passes a complete %s build", (profile) => {
    expect(check(profile, CANONICAL)).toEqual({ errors: [], warnings: [] })
  })

  it.each(["branded", "branded-store"])(
    "passes a complete %s build",
    (profile) => {
      expect(check(profile, BRANDED)).toEqual({ errors: [], warnings: [] })
    },
  )

  it("refuses placeholder or non-https URLs and missing contacts", () => {
    const errors = errorsOf(
      check("store", {
        ...CANONICAL,
        EXPO_PUBLIC_API_URL: "https://api.clubspace.example.com",
        EXPO_PUBLIC_WEB_URL: "http://app.clubspace.ru",
        EXPO_PUBLIC_SUPPORT_EMAIL: "REPLACE_WITH_SUPPORT_EMAIL",
      }),
    )
    expect(errors).toContain("EXPO_PUBLIC_API_URL is a placeholder")
    expect(errors).toContain("EXPO_PUBLIC_WEB_URL must be an https URL")
    expect(errors).toContain("EXPO_PUBLIC_SUPPORT_EMAIL is missing")
  })

  it("accepts a real domain that merely contains 'example'", () => {
    const result = check("production", {
      ...CANONICAL,
      EXPO_PUBLIC_API_URL: "https://api.myexample.org",
    })
    expect(result?.errors).toEqual([])
  })

  it("refuses a canonical build that is not the club picker", () => {
    expect(
      errorsOf(check("store", { ...CANONICAL, EXPO_PUBLIC_CLUB_PICKER: "" })),
    ).toContain('EXPO_PUBLIC_CLUB_PICKER must be "true"')
  })

  it("needs no club key for the canonical build", () => {
    const env = { ...CANONICAL }
    delete env.EXPO_PUBLIC_WORKSPACE_KEY
    expect(check("store", env)?.errors).toEqual([])
  })

  it("refuses a branded build without its own identity", () => {
    const errors = errorsOf(
      check("branded-store", {
        ...COMMON,
        EXPO_PUBLIC_BRAND: "grappling",
        EXPO_PUBLIC_CLUB_PICKER: "false",
      }),
    )
    for (const name of [
      "EXPO_PUBLIC_WORKSPACE_KEY",
      "EXPO_PUBLIC_APP_NAME",
      "EXPO_PUBLIC_BUNDLE_ID",
      "APP_ASSETS_DIR",
    ]) {
      expect(errors).toContain(`${name} is missing`)
    }
  })

  it.each(["com.clubspace.app", "com.clubspace.kimura"])(
    "refuses a branded build under ClubSpace's id %s (Apple 4.2.6)",
    (id) => {
      expect(
        errorsOf(check("branded-store", { ...BRANDED, EXPO_PUBLIC_BUNDLE_ID: id })),
      ).toContain("belongs to ClubSpace")
    },
  )

  it.each(["kimura", "ru.kimura-bjj.app", "1ru.kimura", "ru..kimura"])(
    "refuses the malformed bundle id %s",
    (id) => {
      expect(
        errorsOf(check("branded", { ...BRANDED, EXPO_PUBLIC_BUNDLE_ID: id })),
      ).toContain("is not a valid app id")
    },
  )

  it("refuses the neutral name, the clubspace scheme and a bad colour", () => {
    const errors = errorsOf(
      check("branded", {
        ...BRANDED,
        EXPO_PUBLIC_APP_NAME: "clubspace",
        EXPO_PUBLIC_APP_SCHEME: "clubspace",
        EXPO_PUBLIC_APP_COLOR: "blue",
      }),
    )
    expect(errors).toContain('EXPO_PUBLIC_APP_NAME is "clubspace"')
    expect(errors).toContain('EXPO_PUBLIC_APP_SCHEME "clubspace"')
    expect(errors).toContain('EXPO_PUBLIC_APP_COLOR "blue"')
  })

  it("refuses a branded build that is the club picker", () => {
    expect(
      errorsOf(check("branded", { ...BRANDED, EXPO_PUBLIC_CLUB_PICKER: "true" })),
    ).toContain("must not be \"true\"")
  })

  it("lists the artwork missing from APP_ASSETS_DIR", () => {
    const seen: string[] = []
    const errors = errorsOf(
      check("branded", BRANDED, {
        exists: (path) => {
          seen.push(path)
          return !path.endsWith("splash-icon.png")
        },
      }),
    )
    expect(seen).toContain("./branding/kimura/icon.png")
    expect(errors).toContain(
      "APP_ASSETS_DIR ./branding/kimura lacks splash-icon.png",
    )
  })

  it("refuses the ClubSpace icon in a branded build", () => {
    const errors = errorsOf(
      check("branded", BRANDED, {
        same: (a, b) =>
          a === "./branding/kimura/icon.png" &&
          b === "./assets/images/icon.png",
      }),
    )
    expect(errors).toContain("carries the ClubSpace icon")
  })

  it("warns, without failing, when push config is missing", () => {
    const env = { ...CANONICAL }
    delete env.EAS_PROJECT_ID
    delete env.GOOGLE_SERVICES_FILE
    const result = check("store", env)
    expect(result?.errors).toEqual([])
    expect(result?.warnings.join("\n")).toContain("EAS_PROJECT_ID")
    expect(result?.warnings.join("\n")).toContain("GOOGLE_SERVICES_FILE")
  })

  it("skips the FCM warning for an iOS build", () => {
    const env = { ...CANONICAL }
    delete env.GOOGLE_SERVICES_FILE
    expect(check("store", env, { platform: "ios" })?.warnings).toEqual([])
  })

  it("refuses a GOOGLE_SERVICES_FILE that does not exist", () => {
    expect(
      errorsOf(
        check("store", CANONICAL, {
          exists: (path) => !path.endsWith("google-services.json"),
        }),
      ),
    ).toContain("GOOGLE_SERVICES_FILE points at a missing file")
  })
})
