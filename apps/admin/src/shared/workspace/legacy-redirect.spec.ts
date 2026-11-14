import { withQuery } from "./legacy-redirect"

describe("withQuery", () => {
  it("keeps the path when there is no query", () => {
    expect(withQuery("/workspace/w/settings", {})).toBe("/workspace/w/settings")
  })

  it("carries single, repeated and encoded values; drops undefined", () => {
    expect(
      withQuery("/workspace/w/settings/audit", {
        page: "2",
        tag: ["a", "b"],
        q: "Иван Петров",
        empty: undefined,
      }),
    ).toBe("/workspace/w/settings/audit?page=2&tag=a&tag=b&q=%D0%98%D0%B2%D0%B0%D0%BD+%D0%9F%D0%B5%D1%82%D1%80%D0%BE%D0%B2")
  })
})
