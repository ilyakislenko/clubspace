import { displayUrl, isWebUrl, telUrl } from "./link-helpers"

describe("telUrl", () => {
  it("keeps only digits and the plus", () => {
    expect(telUrl("+7 (900) 000-00-00")).toBe("tel:+79000000000")
    expect(telUrl("+79528849420")).toBe("tel:+79528849420")
  })
})

describe("isWebUrl", () => {
  it("accepts http and https in any case", () => {
    expect(isWebUrl("https://club.example")).toBe(true)
    expect(isWebUrl("HTTP://club.example")).toBe(true)
  })
  it("refuses everything else", () => {
    expect(isWebUrl("javascript:alert(1)")).toBe(false)
    expect(isWebUrl("tel:+79000000000")).toBe(false)
    expect(isWebUrl("club.example")).toBe(false)
    expect(isWebUrl(" https://club.example")).toBe(false)
  })
})

describe("displayUrl", () => {
  it("drops the scheme and a bare trailing slash", () => {
    expect(displayUrl("https://academytomsk.ru/")).toBe("academytomsk.ru")
    expect(displayUrl("HTTP://club.example/schedule")).toBe(
      "club.example/schedule",
    )
  })
})
