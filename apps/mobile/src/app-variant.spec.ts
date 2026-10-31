/* eslint-disable @typescript-eslint/no-require-imports -- app-variant.js is
   plain CommonJS (app.config.js and the node scripts load it), and brand.ts is
   re-required after each doMock */
type Env = Record<string, string | undefined>
type ExpoConfig = {
  name: string
  slug: string
  icon: string
  scheme: string[]
  ios: {
    bundleIdentifier: string
    associatedDomains?: string[]
  }
  android: {
    package: string
    googleServicesFile?: string
    adaptiveIcon: { foregroundImage: string }
    intentFilters?: { data: Record<string, string>[] }[]
  }
  web: { favicon: string }
  extra: { eas?: { projectId: string } } & Record<string, unknown>
  plugins: (string | [string, Record<string, unknown>])[]
}

const {
  BRAND_ACCENT,
  buildWebManifest,
  resolveAppConfig,
  resolveAppIdentity,
} = require("./app-variant") as {
  BRAND_ACCENT: Record<string, string>
  buildWebManifest: (env: Env) => Record<string, unknown>
  resolveAppConfig: (env: Env) => ExpoConfig
  resolveAppIdentity: (env: Env) => { variant: string; name: string }
}

const CANONICAL_ENV: Env = {
  EXPO_PUBLIC_CLUB_PICKER: "true",
  EXPO_PUBLIC_BRAND: "clubspace",
  EXPO_PUBLIC_WEB_URL: "https://app.club.test",
}

const BRANDED_ENV: Env = {
  EXPO_PUBLIC_CLUB_PICKER: "false",
  EXPO_PUBLIC_BRAND: "yoga",
  EXPO_PUBLIC_WEB_URL: "https://app.yoga.test",
  EXPO_PUBLIC_APP_NAME: "Йога на Покровке",
  EXPO_PUBLIC_BUNDLE_ID: "ru.yogapokrovka.App",
  APP_ASSETS_DIR: "branding/yoga/",
}

const pluginOptions = (config: ExpoConfig, name: string) =>
  config.plugins.find(
    (p): p is [string, Record<string, unknown>] =>
      Array.isArray(p) && p[0] === name,
  )?.[1]

describe("resolveAppConfig — the neutral ClubSpace app", () => {
  it("is ClubSpace with the canonical ids, scheme and assets", () => {
    const out = resolveAppConfig(CANONICAL_ENV)
    expect(out.name).toBe("ClubSpace")
    expect(out.ios.bundleIdentifier).toBe("com.clubspace.app")
    expect(out.android.package).toBe("com.clubspace.app")
    expect(out.scheme).toEqual(["clubspace"])
    // The EAS project (keystore, version counter) keeps its original slug.
    expect(out.slug).toBe("grappling-academy-mobile")
    expect(out.icon).toBe("./assets/images/icon.png")
    expect(out.android.adaptiveIcon.foregroundImage).toBe(
      "./assets/images/adaptive-icon.png",
    )
    expect(pluginOptions(out, "expo-splash-screen")?.image).toBe(
      "./assets/images/splash-icon.png",
    )
  })

  it("ignores branded identity env, so it can't be re-branded by accident", () => {
    const out = resolveAppConfig({ ...BRANDED_ENV, ...CANONICAL_ENV })
    expect(out.name).toBe("ClubSpace")
    expect(out.ios.bundleIdentifier).toBe("com.clubspace.app")
    expect(out.icon).toBe("./assets/images/icon.png")
  })

  it("claims /join/ links on the web host", () => {
    const out = resolveAppConfig({
      ...CANONICAL_ENV,
      EXPO_PUBLIC_WEB_URL: "https://app.club.test:8443/",
    })
    expect(out.ios.associatedDomains).toEqual(["applinks:app.club.test"])
    expect(out.android.intentFilters?.[0].data).toEqual([
      { scheme: "https", host: "app.club.test", pathPrefix: "/join/" },
    ])
  })

  it("adds no link claims without a usable web URL", () => {
    const out = resolveAppConfig({
      ...CANONICAL_ENV,
      EXPO_PUBLIC_WEB_URL: "not a url",
    })
    expect(out.android.intentFilters).toBeUndefined()
    expect(out.ios.associatedDomains).toBeUndefined()
  })
})

describe("resolveAppConfig — a club's branded app", () => {
  it("takes name, ids, scheme, slug and artwork from env", () => {
    const out = resolveAppConfig(BRANDED_ENV)
    expect(out.name).toBe("Йога на Покровке")
    expect(out.ios.bundleIdentifier).toBe("ru.yogapokrovka.App")
    expect(out.android.package).toBe("ru.yogapokrovka.App")
    // Never `clubspace`: that scheme must keep opening the neutral app.
    expect(out.scheme).toEqual(["ru.yogapokrovka.app"])
    expect(out.slug).toBe("ru-yogapokrovka-app")
    expect(out.icon).toBe("./branding/yoga/icon.png")
    expect(out.android.adaptiveIcon.foregroundImage).toBe(
      "./branding/yoga/adaptive-icon.png",
    )
    expect(out.web.favicon).toBe("./branding/yoga/favicon.png")
    expect(pluginOptions(out, "expo-splash-screen")?.image).toBe(
      "./branding/yoga/splash-icon.png",
    )
    expect(out.ios.associatedDomains).toEqual(["applinks:app.yoga.test"])
  })

  it("honours an explicit scheme, slug and absolute assets dir", () => {
    const out = resolveAppConfig({
      ...BRANDED_ENV,
      EXPO_PUBLIC_APP_SCHEME: "yogapokrovka",
      EXPO_PUBLIC_APP_SLUG: "yoga-pokrovka",
      APP_ASSETS_DIR: "/home/expo/branding",
    })
    expect(out.scheme).toEqual(["yogapokrovka"])
    expect(out.slug).toBe("yoga-pokrovka")
    expect(out.icon).toBe("/home/expo/branding/icon.png")
  })

  it("falls back to the canonical identity when nothing is set (expo start)", () => {
    const out = resolveAppConfig({})
    expect(resolveAppIdentity({}).variant).toBe("branded")
    expect(out.name).toBe("ClubSpace")
    expect(out.ios.bundleIdentifier).toBe("com.clubspace.app")
    expect(out.scheme).toEqual(["clubspace"])
    expect(out.slug).toBe("grappling-academy-mobile")
    expect(out.icon).toBe("./assets/images/icon.png")
  })
})

describe("resolveAppConfig — push", () => {
  it("lists expo-notifications with the brand colour", () => {
    expect(pluginOptions(resolveAppConfig(CANONICAL_ENV), "expo-notifications"))
      .toEqual({ color: BRAND_ACCENT.clubspace })
    expect(
      pluginOptions(
        resolveAppConfig({ ...BRANDED_ENV, EXPO_PUBLIC_APP_COLOR: "#AA3300" }),
        "expo-notifications",
      ),
    ).toEqual({ color: "#AA3300" })
    // A malformed colour falls back to the brand preset.
    expect(
      pluginOptions(
        resolveAppConfig({ ...BRANDED_ENV, EXPO_PUBLIC_APP_COLOR: "red" }),
        "expo-notifications",
      ),
    ).toEqual({ color: BRAND_ACCENT.yoga })
  })

  it("sets the EAS project id and FCM file only when given", () => {
    const bare = resolveAppConfig(CANONICAL_ENV)
    expect(bare.extra.eas).toBeUndefined()
    expect(bare.android.googleServicesFile).toBeUndefined()

    const out = resolveAppConfig({
      ...CANONICAL_ENV,
      EAS_PROJECT_ID: "6f1c0d2e-0000-4000-8000-000000000000",
      GOOGLE_SERVICES_FILE: "/home/expo/google-services.json",
    })
    expect(out.extra.eas).toEqual({
      projectId: "6f1c0d2e-0000-4000-8000-000000000000",
    })
    expect(out.android.googleServicesFile).toBe(
      "/home/expo/google-services.json",
    )
  })

  it("keeps the dev-only extra fallback on the neutral app", () => {
    expect(resolveAppConfig({}).extra).toMatchObject({
      EXPO_PUBLIC_API_URL: "http://localhost:3000",
      EXPO_PUBLIC_BRAND: "clubspace",
      EXPO_PUBLIC_CLUB_PICKER: "true",
    })
  })
})

describe("buildWebManifest", () => {
  it("installs the neutral PWA as ClubSpace in the brand colour", () => {
    expect(buildWebManifest(CANONICAL_ENV)).toMatchObject({
      name: "ClubSpace",
      short_name: "ClubSpace",
      theme_color: BRAND_ACCENT.clubspace,
      lang: "ru",
    })
  })

  it("installs a branded PWA under the club's name and colour", () => {
    expect(
      buildWebManifest({ ...BRANDED_ENV, EXPO_PUBLIC_APP_COLOR: "#123456" }),
    ).toMatchObject({
      name: "Йога на Покровке",
      short_name: "Йога на Покровке",
      theme_color: "#123456",
    })
  })

  it("advertises the install icons sync-web-assets renders", () => {
    const icons = buildWebManifest(CANONICAL_ENV).icons as { src: string }[]
    expect(icons.map((i) => i.src)).toEqual([
      "/icons/icon-192.png",
      "/icons/icon-512.png",
      "/icons/icon-maskable-512.png",
    ])
  })
})

describe("BRAND_ACCENT", () => {
  afterEach(() => {
    jest.resetModules()
  })

  it("mirrors every brand preset's accent in shared/brand.ts", () => {
    for (const key of Object.keys(BRAND_ACCENT)) {
      jest.resetModules()
      jest.doMock("./shared/env", () => ({
        environment: { brand: key, workspaceKey: undefined },
      }))
      const { brand } = require("./shared/brand") as {
        brand: { key: string; colors: { accent: string } }
      }
      expect(brand.key).toBe(key)
      expect(brand.colors.accent).toBe(BRAND_ACCENT[key])
    }
  })
})
