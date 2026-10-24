import type { WorkspaceSummary } from "../../shared/api/workspaces"
import { displayName, switchableWorkspaces } from "./switchable-workspaces"

const ws = (id: string, accessExpired = false): WorkspaceSummary =>
  ({ workspaceId: id, accessExpired }) as WorkspaceSummary

describe("switchableWorkspaces", () => {
  it("excludes the current club and expired clubs", () => {
    const list = [ws("a", true), ws("b"), ws("c", true), ws("d")]
    expect(switchableWorkspaces(list, "a").map((w) => w.workspaceId)).toEqual([
      "b",
      "d",
    ])
  })

  it("returns nothing when there is no other live club", () => {
    expect(switchableWorkspaces([ws("a", true)], "a")).toEqual([])
    expect(switchableWorkspaces([], null)).toEqual([])
  })
})

describe("displayName", () => {
  it("joins first and last name, skipping blanks", () => {
    expect(displayName({ firstname: "Иван", lastname: "Петров" })).toBe(
      "Иван Петров",
    )
    expect(displayName({ firstname: null, lastname: "Петров" })).toBe("Петров")
    expect(displayName({ firstname: null, lastname: null })).toBe("")
    expect(displayName(null)).toBe("")
  })
})
