import { attachmentFileName } from "./exports"

describe("attachmentFileName", () => {
  it("reads the server's file name", () => {
    expect(attachmentFileName('attachment; filename="payments-2026-10-16_2026-11-15.csv"')).toBe(
      "payments-2026-10-16_2026-11-15.csv",
    )
    expect(attachmentFileName("attachment; filename=members-2026-11-15.csv")).toBe(
      "members-2026-11-15.csv",
    )
  })

  it("is null without one (header not exposed or missing)", () => {
    expect(attachmentFileName(undefined)).toBeNull()
    expect(attachmentFileName("attachment")).toBeNull()
  })
})
