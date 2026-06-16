import { safeExternalUrl } from "./safe-url"

describe("safeExternalUrl", () => {
  it("returns null for nullish / empty / whitespace input", () => {
    expect(safeExternalUrl(null)).toBeNull()
    expect(safeExternalUrl(undefined)).toBeNull()
    expect(safeExternalUrl("")).toBeNull()
    expect(safeExternalUrl("   ")).toBeNull()
  })

  it("allows http(s) URLs and returns them trimmed", () => {
    expect(safeExternalUrl("https://example.com/x")).toBe(
      "https://example.com/x",
    )
    expect(safeExternalUrl("http://example.com")).toBe("http://example.com")
    expect(safeExternalUrl("  https://example.com  ")).toBe(
      "https://example.com",
    )
  })

  it("blocks javascript: URLs (stored-XSS vector)", () => {
    expect(safeExternalUrl("javascript:alert(1)")).toBeNull()
    // URL() lowercases the scheme, so mixed/odd casing is still caught.
    expect(safeExternalUrl("JavaScript:alert(1)")).toBeNull()
    expect(safeExternalUrl("  javascript:alert(1)  ")).toBeNull()
  })

  it("blocks data: URLs", () => {
    expect(
      safeExternalUrl("data:text/html,<script>alert(1)</script>"),
    ).toBeNull()
  })

  it("blocks other non-http(s) schemes", () => {
    expect(safeExternalUrl("mailto:a@b.com")).toBeNull()
    expect(safeExternalUrl("ftp://example.com/f")).toBeNull()
    expect(safeExternalUrl("file:///etc/passwd")).toBeNull()
  })

  it("returns null for strings that aren't absolute URLs", () => {
    expect(safeExternalUrl("not a url")).toBeNull()
    expect(safeExternalUrl("/relative/path")).toBeNull()
    expect(safeExternalUrl("example.com")).toBeNull()
  })
})
