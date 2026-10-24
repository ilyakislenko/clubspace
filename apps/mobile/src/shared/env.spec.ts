
const loadEnvironment = (opts: {
  dev: boolean
  processEnv?: Record<string, string>
  extra?: Record<string, string>
}) => {
  jest.resetModules()
  ;(globalThis as unknown as { __DEV__: boolean }).__DEV__ = opts.dev
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("EXPO_PUBLIC_")) delete process.env[key]
  }
  Object.assign(process.env, opts.processEnv)
  jest.doMock("expo-constants", () => ({
    __esModule: true,
    default: { expoConfig: { extra: opts.extra ?? {} } },
  }))
  return () =>
    require("./env").environment as {
      apiBaseUrl: string
      workspaceKey?: string
    }
}

afterEach(() => {
  jest.resetModules()
})

describe("environment", () => {
  it("uses the app.json extra fallback in dev", () => {
    const load = loadEnvironment({
      dev: true,
      extra: { EXPO_PUBLIC_API_URL: "http://192.168.1.5:3000" },
    })

    expect(load().apiBaseUrl).toBe("http://192.168.1.5:3000")
  })

  it("never consults app.json extra in a release build", () => {
    const load = loadEnvironment({
      dev: false,
      extra: {
        EXPO_PUBLIC_API_URL: "http://localhost:3000",
        EXPO_PUBLIC_WORKSPACE_KEY: "from_extra",
      },
      processEnv: {
        EXPO_PUBLIC_API_URL: "https://api.club.test",
        EXPO_PUBLIC_BRAND: "grappling",
      },
    })

    const environment = load()
    expect(environment.apiBaseUrl).toBe("https://api.club.test")
    expect(environment.workspaceKey).toBeUndefined()
  })

  it("throws in a release build without EAS env instead of using localhost", () => {
    const load = loadEnvironment({
      dev: false,
      extra: { EXPO_PUBLIC_API_URL: "http://localhost:3000" },
    })

    expect(load).toThrow(/EXPO_PUBLIC_API_URL/)
  })
})
