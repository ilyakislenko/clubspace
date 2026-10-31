import { resolvePublicAppUrl } from "./public-app-url"

describe("resolvePublicAppUrl", () => {
  it("prefers the explicit address, without a trailing slash", () => {
    expect(
      resolvePublicAppUrl({
        explicit: "https://club.example.ru/",
        apiBaseUrl: "https://api.example.ru",
      }),
    ).toBe("https://club.example.ru")
  })

  it("derives app.<domain> from an api.<domain> API address, keeping the port", () => {
    expect(
      resolvePublicAppUrl({
        explicit: undefined,
        apiBaseUrl: "https://api.example.ru:8443",
      }),
    ).toBe("https://app.example.ru:8443")
  })

  it("gives up on a local API or a malformed address", () => {
    expect(
      resolvePublicAppUrl({
        explicit: "",
        apiBaseUrl: "http://localhost:3000",
      }),
    ).toBeNull()
    expect(
      resolvePublicAppUrl({ explicit: undefined, apiBaseUrl: "not a url" }),
    ).toBeNull()
  })
})
