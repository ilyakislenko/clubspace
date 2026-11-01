import { joinCodeFromQr } from "./qr-join"

describe("joinCodeFromQr", () => {
  it("reads the code from a join link on any host", () => {
    expect(joinCodeFromQr("https://app.clubspace.ru/join/ABCD2345")).toBe("ABCD2345")
    expect(joinCodeFromQr("https://yoga.example.com/join/ABCD2345")).toBe("ABCD2345")
    expect(joinCodeFromQr("http://localhost:8081/join/ABCD2345")).toBe("ABCD2345")
  })

  it("accepts a trailing slash, a query string and a fragment", () => {
    expect(joinCodeFromQr("https://a.test/join/ABCD2345/")).toBe("ABCD2345")
    expect(joinCodeFromQr("https://a.test/join/ABCD2345?utm_source=poster")).toBe("ABCD2345")
    expect(joinCodeFromQr("https://a.test/join/ABCD2345/?x=1#top")).toBe("ABCD2345")
  })

  it("normalises a lowercase or hyphenated code", () => {
    expect(joinCodeFromQr("https://a.test/join/abcd-2345")).toBe("ABCD2345")
    expect(joinCodeFromQr("  abcd-2345\n")).toBe("ABCD2345")
    expect(joinCodeFromQr("ABCD2345")).toBe("ABCD2345")
  })

  it("rejects foreign URLs", () => {
    expect(joinCodeFromQr("https://example.com/")).toBeNull()
    expect(joinCodeFromQr("https://a.test/promo/ABCD2345")).toBeNull()
    expect(joinCodeFromQr("https://a.test/x/join/ABCD2345")).toBeNull()
    expect(joinCodeFromQr("https://a.test/join/ABCD2345/extra")).toBeNull()
    expect(joinCodeFromQr("ftp://a.test/join/ABCD2345")).toBeNull()
  })

  it("rejects codes of the wrong length or alphabet", () => {
    expect(joinCodeFromQr("https://a.test/join/ABCD234")).toBeNull()
    expect(joinCodeFromQr("https://a.test/join/ABCD23456")).toBeNull()
    expect(joinCodeFromQr("ABCD1234")).toBeNull() // no 1 in the alphabet
    expect(joinCodeFromQr("ABCD-23456")).toBeNull()
  })

  it("rejects garbage", () => {
    expect(joinCodeFromQr("")).toBeNull()
    expect(joinCodeFromQr("hello world")).toBeNull()
    expect(joinCodeFromQr("WIFI:S:club;T:WPA;P:secret;;")).toBeNull()
    expect(joinCodeFromQr("ABCD 2345")).toBeNull()
  })
})
