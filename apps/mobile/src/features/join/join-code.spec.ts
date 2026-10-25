import {
  extractJoinCode,
  formatJoinCodeInput,
  joinCodeFromInput,
  JOIN_CODE_FORBIDDEN_HINT,
  shouldOpenJoin,
} from "./join-code"

describe("formatJoinCodeInput", () => {
  it("uppercases and groups as XXXX-XXXX", () => {
    expect(formatJoinCodeInput("abcd2345")).toBe("ABCD-2345")
    expect(formatJoinCodeInput("abc")).toBe("ABC")
    expect(formatJoinCodeInput("abcd")).toBe("ABCD")
    expect(formatJoinCodeInput("abcd2")).toBe("ABCD-2")
  })

  it("ignores spaces, dashes and other symbols", () => {
    expect(formatJoinCodeInput(" ab cd-23 45 ")).toBe("ABCD-2345")
    expect(formatJoinCodeInput("ABCD-2345-")).toBe("ABCD-2345")
  })

  it("stops at eight characters", () => {
    expect(formatJoinCodeInput("ABCD2345XYZ")).toBe("ABCD-2345")
  })

  it("is stable when fed its own output", () => {
    expect(formatJoinCodeInput(formatJoinCodeInput("abcd23"))).toBe("ABCD-23")
  })
})

describe("joinCodeFromInput", () => {
  it("is not a code yet below eight characters, without an error", () => {
    expect(joinCodeFromInput("ABCD-23")).toEqual({ code: null, error: null })
    expect(joinCodeFromInput("")).toEqual({ code: null, error: null })
  })

  it("returns the bare code once complete", () => {
    expect(joinCodeFromInput("ABCD-2345")).toEqual({
      code: "ABCD2345",
      error: null,
    })
  })

  it.each(["ABCD-2340", "ABCD-2341", "OBCD-2345", "IBCD-2345", "LBCD-2345"])(
    "explains a forbidden character in %s",
    (value) => {
      expect(joinCodeFromInput(value)).toEqual({
        code: null,
        error: JOIN_CODE_FORBIDDEN_HINT,
      })
    },
  )
})

describe("extractJoinCode", () => {
  it.each([
    ["https://app.club.test/join/ABCD-2345", "ABCD2345"],
    ["https://app.club.test:8443/join/abcd2345", "ABCD2345"],
    ["clubspace://join/ABCD2345", "ABCD2345"],
    ["https://app.club.test/join/ABCD-2345?utm=qr#x", "ABCD2345"],
    ["https://app.club.test/join/ABCD2345/", "ABCD2345"],
  ])("reads %s", (url, code) => {
    expect(extractJoinCode(url)).toBe(code)
  })

  it.each([
    "https://app.club.test/",
    "https://app.club.test/sign-in",
    "https://app.club.test/join/",
    "https://app.club.test/join/ABCD-234",
    "https://app.club.test/join/ABCD-2340",
    "https://app.club.test/join/ABCD2345678",
    "",
  ])("rejects %s", (url) => {
    expect(extractJoinCode(url)).toBeNull()
  })
})

describe("shouldOpenJoin", () => {
  it("opens from any other screen", () => {
    expect(shouldOpenJoin(undefined, "ABCD2345")).toBe(true)
    expect(shouldOpenJoin({ name: "Main" }, "ABCD2345")).toBe(true)
    expect(shouldOpenJoin({ name: "JoinClub" }, "ABCD2345")).toBe(true)
  })

  it("does not reopen the join screen already showing this code", () => {
    expect(
      shouldOpenJoin(
        { name: "JoinClub", params: { code: "ABCD-2345" } },
        "ABCD2345",
      ),
    ).toBe(false)
    expect(
      shouldOpenJoin(
        { name: "JoinClub", params: { code: "ABCD2345" } },
        "ABCD2345",
      ),
    ).toBe(false)
  })

  it("opens again for a different code", () => {
    expect(
      shouldOpenJoin(
        { name: "JoinClub", params: { code: "ZZZZ2222" } },
        "ABCD2345",
      ),
    ).toBe(true)
  })
})
