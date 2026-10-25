const { resolveAppVariant } = require("./app-variant") as {
  resolveAppVariant: (
    config: Record<string, unknown>,
    env: Record<string, string | undefined>,
  ) => Record<string, unknown>
}

const base = {
  name: "Грэпплинг Академия",
  scheme: ["grappling-academy", "clubspace"],
  ios: { bundleIdentifier: "com.clubspace.app" },
  android: { package: "com.clubspace.app" },
}

describe("resolveAppVariant", () => {
  it("leaves the default app untouched", () => {
    expect(resolveAppVariant(base, {})).toBe(base)
    expect(
      resolveAppVariant(base, { EXPO_PUBLIC_WEB_URL: "https://app.club.test" }),
    ).toBe(base)
    expect(resolveAppVariant(base, { EXPO_PUBLIC_CLUB_PICKER: "false" })).toBe(
      base,
    )
  })

  it("names the club-picker build ClubSpace and keeps the package", () => {
    const out = resolveAppVariant(base, { EXPO_PUBLIC_CLUB_PICKER: "true" }) as {
      name: string
      android: { package: string }
    }
    expect(out.name).toBe("ClubSpace")
    expect(out.android.package).toBe("com.clubspace.app")
  })

  it("claims /join/ links on the web host for the club-picker build only", () => {
    const out = resolveAppVariant(base, {
      EXPO_PUBLIC_CLUB_PICKER: "true",
      EXPO_PUBLIC_WEB_URL: "https://app.club.test:8443/",
    }) as {
      ios: { associatedDomains: string[] }
      android: { intentFilters: { data: Record<string, string>[] }[] }
    }
    expect(out.ios.associatedDomains).toEqual(["applinks:app.club.test"])
    expect(out.android.intentFilters[0].data).toEqual([
      { scheme: "https", host: "app.club.test", pathPrefix: "/join/" },
    ])
  })

  it("adds no link claims without a usable web URL", () => {
    const out = resolveAppVariant(base, {
      EXPO_PUBLIC_CLUB_PICKER: "true",
      EXPO_PUBLIC_WEB_URL: "not a url",
    }) as { android: Record<string, unknown> }
    expect(out.android.intentFilters).toBeUndefined()
  })
})
