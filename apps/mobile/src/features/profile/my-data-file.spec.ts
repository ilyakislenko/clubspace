import type { MyDataExport } from "../../shared/api/me"
import { myDataFileName, serializeMyData } from "./my-data-file"

describe("myDataFileName", () => {
  it("matches the server's attachment name, dated by the export", () => {
    expect(myDataFileName({ generatedAt: "2026-11-01T09:30:00.000Z" })).toBe(
      "clubspace-my-data-2026-11-01.json",
    )
  })

  it("uses the UTC date like the server, not the device's", () => {
    expect(myDataFileName({ generatedAt: "2026-12-31T23:59:59.999Z" })).toBe(
      "clubspace-my-data-2026-12-31.json",
    )
  })
})

describe("serializeMyData", () => {
  it("writes readable JSON that parses back to the same export", () => {
    const data = {
      formatVersion: 1,
      generatedAt: "2026-11-01T09:30:00.000Z",
      truncated: [],
    } as unknown as MyDataExport

    const text = serializeMyData(data)

    expect(text).toContain('\n  "formatVersion": 1')
    expect(JSON.parse(text)).toEqual(data)
  })
})
