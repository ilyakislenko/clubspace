import {
  buildContentSecurityPolicy,
  readMediaUrls,
} from "./content-security-policy"

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
    mediaUrls: ["https://s3.example.ru"],
  }

  it("allows scripts only by nonce, with no eval outside next dev", () => {
    const csp = directives(buildContentSecurityPolicy(base))
    expect(csp["script-src"]).toEqual(["'self'", "'nonce-abc123'", "'strict-dynamic'"])
    expect(csp["object-src"]).toEqual(["'none'"])
    expect(csp["base-uri"]).toEqual(["'self'"])
    expect(csp["frame-ancestors"]).toEqual(["'none'"])
    expect(
      directives(buildContentSecurityPolicy({ ...base, dev: true }))["script-src"],
    ).toContain("'unsafe-eval'")
  })

  it("lets the page reach the API, its socket and storage by origin", () => {
    const csp = directives(
      buildContentSecurityPolicy({
        ...base,
        apiUrl: "https://api.example.ru:8443/",
        mediaUrls: ["https://s3.example.ru:8443/clubspace", null, " "],
      }),
    )
    expect(csp["connect-src"]).toEqual([
      "'self'",
      "https://api.example.ru:8443",
      "wss://api.example.ru:8443",
      "https://s3.example.ru:8443",
    ])
    expect(csp["img-src"]).toEqual(["'self'", "data:", "blob:", "https://s3.example.ru:8443"])
    expect(csp["media-src"]).toEqual([
      "'self'",
      "blob:",
      "https://api.example.ru:8443",
      "https://s3.example.ru:8443",
    ])
  })

  it("adds the Sentry ingest origin only when a DSN is set, never its key", () => {
    expect(directives(buildContentSecurityPolicy(base))["connect-src"]).toHaveLength(4)
    const policy = buildContentSecurityPolicy({
      ...base,
      sentryDsn: "https://publickey@o12.ingest.de.sentry.io/345",
    })
    expect(directives(policy)["connect-src"]).toContain("https://o12.ingest.de.sentry.io")
    expect(policy).not.toContain("publickey")
  })

  it("drops sources that are not http(s) URLs", () => {
    const csp = directives(
      buildContentSecurityPolicy({
        ...base,
        apiUrl: "not a url",
        mediaUrls: ["javascript:alert(1)", "https://s3.example.ru"],
        sentryDsn: "",
      }),
    )
    expect(csp["connect-src"]).toEqual(["'self'", "https://s3.example.ru"])
  })
})

describe("readMediaUrls", () => {
  it("reads the public storage address and the accelerate URL when set", () => {
    expect(readMediaUrls({})).toEqual([])
    expect(
      readMediaUrls({
        S3_UPLOAD_BUCKET_URL: "https://s3.example.ru",
        S3_ACCELERATE_URL: "https://cdn.example.ru",
      }),
    ).toEqual(["https://s3.example.ru", "https://cdn.example.ru"])
  })
})
