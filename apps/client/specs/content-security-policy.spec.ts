import {
  buildContentSecurityPolicy,
  readMediaUrls,
} from "../src/shared/lib/content-security-policy"

const directives = (policy: string): Record<string, string[]> =>
  Object.fromEntries(
    policy.split("; ").map((d) => {
      const [name, ...values] = d.split(" ")
      return [name, values]
    }),
  )

describe("buildContentSecurityPolicy", () => {
  const base = {
    nonce: "abc123",
    dev: false,
    apiUrl: "https://api.example.ru",
    mediaUrls: ["https://s3.example.ru/clubspace"],
    metrika: false,
  }

  it("allows scripts only by nonce and lists the API, socket and storage", () => {
    const csp = directives(buildContentSecurityPolicy(base))
    expect(csp["script-src"]).toEqual(["'self'", "'nonce-abc123'", "'strict-dynamic'"])
    expect(csp["connect-src"]).toEqual([
      "'self'",
      "https://api.example.ru",
      "wss://api.example.ru",
      "https://s3.example.ru",
    ])
    expect(csp["media-src"]).toEqual([
      "'self'",
      "blob:",
      "https://api.example.ru",
      "https://s3.example.ru",
    ])
    expect(csp["frame-src"]).toEqual(["'self'"])
    expect(csp["object-src"]).toEqual(["'none'"])
    expect(csp["frame-ancestors"]).toEqual(["'none'"])
  })

  it("names Yandex Metrika only while a counter is configured", () => {
    expect(buildContentSecurityPolicy(base)).not.toContain("yandex")
    const csp = directives(buildContentSecurityPolicy({ ...base, metrika: true }))
    expect(csp["connect-src"]).toContain("https://mc.yandex.ru")
    expect(csp["img-src"]).toContain("https://mc.yandex.ru")
    expect(csp["frame-src"]).toEqual(["'self'", "blob:", "https://mc.yandex.ru"])
    expect(csp["script-src"].slice(0, 3)).toEqual([
      "'self'",
      "'nonce-abc123'",
      "'strict-dynamic'",
    ])
  })

  it("adds the Sentry ingest origin without the DSN's key, and eval only in dev", () => {
    const policy = buildContentSecurityPolicy({
      ...base,
      dev: true,
      sentryDsn: "https://publickey@o12.ingest.sentry.io/345",
    })
    expect(directives(policy)["connect-src"]).toContain("https://o12.ingest.sentry.io")
    expect(directives(policy)["script-src"]).toContain("'unsafe-eval'")
    expect(policy).not.toContain("publickey")
  })
})

describe("readMediaUrls", () => {
  it("reads the public storage address and the accelerate URL when set", () => {
    expect(readMediaUrls({})).toEqual([])
    expect(readMediaUrls({ S3_UPLOAD_BUCKET_URL: "https://s3.example.ru" })).toEqual([
      "https://s3.example.ru",
    ])
  })
})
