import { canManageScope, matchesScopeFilter, toggleId } from "./direction-scope"

describe("matchesScopeFilter", () => {
  it("keeps everything without a filter", () => {
    expect(matchesScopeFilter("all", [])).toBe(true)
    expect(matchesScopeFilter("all", ["a"])).toBe(true)
  })

  it("«только для всего клуба» keeps club-wide rows only", () => {
    expect(matchesScopeFilter("club", [])).toBe(true)
    expect(matchesScopeFilter("club", ["a"])).toBe(false)
  })

  it("a direction keeps every row whose set contains it", () => {
    expect(matchesScopeFilter("a", ["b", "a"])).toBe(true)
    expect(matchesScopeFilter("a", ["b"])).toBe(false)
    expect(matchesScopeFilter("a", [])).toBe(false)
  })
})

describe("canManageScope", () => {
  const managerOf = (ids: string[]) => (id: string | null) =>
    id !== null && ids.includes(id)

  it("checks a club-wide row as null", () => {
    expect(canManageScope(() => true, [])).toBe(true)
    expect(canManageScope(managerOf(["a"]), [])).toBe(false)
  })

  it("needs every direction of the set", () => {
    expect(canManageScope(managerOf(["a", "b"]), ["a", "b"])).toBe(true)
    expect(canManageScope(managerOf(["a"]), ["a", "b"])).toBe(false)
  })
})

describe("toggleId", () => {
  it("adds a missing id and removes a present one", () => {
    expect(toggleId(["a"], "b")).toEqual(["a", "b"])
    expect(toggleId(["a", "b"], "a")).toEqual(["b"])
  })
})
