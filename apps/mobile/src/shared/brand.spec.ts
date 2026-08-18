/* eslint-disable @typescript-eslint/no-require-imports -- the module must be
   re-required after each doMock so it re-reads the mocked environment */

const loadBrand = (environment: Record<string, unknown>) => {
  jest.resetModules()
  jest.doMock("./env", () => ({ environment }))
  return require("./brand").brand as { key: string; workspaceKey: string }
}

describe("brand", () => {
  afterEach(() => {
    jest.resetModules()
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
})
