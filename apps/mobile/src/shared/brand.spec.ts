/* eslint-disable @typescript-eslint/no-require-imports -- the module must be
   re-required after each doMock so it re-reads the mocked environment */

const loadBrand = (environment: Record<string, unknown>) => {
  jest.resetModules()
  jest.doMock("./env", () => ({ environment }))
  return require("./brand").brand as {
    key: string
    workspaceKey: string | null
  }
}

describe("brand", () => {
  afterEach(() => {
    jest.resetModules()
  })

  it("describes the whole app, not just the video archive", () => {
    for (const key of ["grappling", "fitness", "yoga", "custom", "clubspace"]) {
      const brand = loadBrand({ brand: key, workspaceKey: undefined }) as unknown as {
        tagline: string
      }
      expect(brand.tagline.toLowerCase()).not.toContain("видео")
      expect(brand.tagline.toLowerCase()).toContain("расписание")
    }
  })

  it("falls back to the brand's own key when no override is set", () => {
    const brand = loadBrand({ brand: "grappling", workspaceKey: undefined })

    expect(brand.key).toBe("grappling")
    expect(brand.workspaceKey).toBe("bjj-academy")
  })

  it("uses EXPO_PUBLIC_WORKSPACE_KEY when the deploy sets one", () => {
    const brand = loadBrand({ brand: "grappling", workspaceKey: "gym_petrovich" })

    // A club created in the platform console gets whatever key the operator
    // typed. Sign-in silently attaches the student to nothing when the app's
    // key does not match it, so the deploy must be able to say the real one.
    expect(brand.workspaceKey).toBe("gym_petrovich")
    expect(brand.key).toBe("grappling")
  })

  it("keeps the rest of the brand intact when overriding the key", () => {
    const brand = loadBrand({ brand: "yoga", workspaceKey: "studio_1" }) as unknown as {
      displayName: string
      workspaceKey: string
    }

    expect(brand.displayName).toBe("Yoga Studio")
    expect(brand.workspaceKey).toBe("studio_1")
  })

  it("bakes in no club in the opt-in club-picker build", () => {
    const brand = loadBrand({ brand: "grappling", clubPicker: true })

    expect(brand.workspaceKey).toBeNull()
    expect(brand.key).toBe("grappling")
  })

  it("has a neutral clubspace preset for the club-picker build", () => {
    const brand = loadBrand({ brand: "clubspace", clubPicker: true }) as unknown as {
      displayName: string
      tagline: string
    }

    expect(brand.key).toBe("clubspace")
    expect(brand.displayName).toBe("ClubSpace")
    expect(brand.tagline).toBe("Расписание, абонементы и прогресс вашего клуба")
    expect(brand.workspaceKey).toBeNull()
    expect(require("./brand").isClubPicker).toBe(true)
  })

  it("exposes isClubPicker only for the club-picker build", () => {
    const flag = (environment: Record<string, unknown>) => {
      loadBrand(environment)
      return require("./brand").isClubPicker as boolean
    }

    expect(flag({ brand: "grappling" })).toBe(false)
    expect(flag({ brand: "grappling", workspaceKey: "club_a" })).toBe(false)
    expect(flag({ brand: "grappling", clubPicker: true })).toBe(true)
  })

  it("names a branded build after the club, never the neutral app", () => {
    const named = (environment: Record<string, unknown>) =>
      (loadBrand(environment) as unknown as { displayName: string }).displayName

    expect(
      named({ brand: "grappling", workspaceKey: "club_a", appName: "Кимура" }),
    ).toBe("Кимура")
    expect(
      named({ brand: "clubspace", clubPicker: true, appName: "Кимура" }),
    ).toBe("ClubSpace")
    expect(named({ brand: "yoga" })).toBe("Yoga Studio")
  })
})

describe("brand legal links", () => {
  type Legal = {
    privacyUrl: string
    termsUrl: string
    deleteAccountUrl: string
    supportEmail: string
  }
  const legalOf = (environment: Record<string, unknown>) =>
    (loadBrand({ brand: "grappling", ...environment }) as unknown as {
      legal: Legal
    }).legal

  afterEach(() => {
    jest.resetModules()
  })

  it("keeps the brand defaults when the deploy sets nothing", () => {
    const legal = legalOf({})

    expect(legal.privacyUrl).toBe("https://clubspace.example/legal/privacy")
    expect(legal.supportEmail).toBe("support@clubspace.example")
  })

  it("points every link at the deploy's web origin and inbox", () => {
    const legal = legalOf({
      webUrl: "https://app.club.test:8443/",
      supportEmail: "help@club.test",
    })

    expect(legal.privacyUrl).toBe("https://app.club.test:8443/legal/privacy")
    expect(legal.termsUrl).toBe("https://app.club.test:8443/legal/terms")
    expect(legal.deleteAccountUrl).toBe(
      "https://app.club.test:8443/legal/delete-account",
    )
    expect(legal.supportEmail).toBe("help@club.test")
  })

  it("overrides the web links and the email independently", () => {
    const legal = legalOf({ supportEmail: "help@club.test" })

    expect(legal.privacyUrl).toBe("https://clubspace.example/legal/privacy")
    expect(legal.supportEmail).toBe("help@club.test")
  })
})
