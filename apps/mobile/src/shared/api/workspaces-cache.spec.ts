/* eslint-disable import/first -- jest.mock must be hoisted above the imports
   it stubs, which is the standard jest ordering. */
// pickActiveWorkspace is pure, but the module also imports expo-secure-store
// (native ESM) for its cache I/O — stub it so the suite can load under the
// non-expo jest preset.
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}))

import { pickActiveWorkspace } from "./workspaces-cache"
import type { WorkspaceSummary } from "./workspaces"

const ws = (id: string, accessExpired = false): WorkspaceSummary =>
  ({ workspaceId: id, accessExpired }) as WorkspaceSummary

describe("pickActiveWorkspace", () => {
  it("prefers the stored workspace when it is still in the list", () => {
    const list = [ws("a"), ws("b")]
    expect(pickActiveWorkspace(list, "b")?.workspaceId).toBe("b")
  })

  it("falls back to the first workspace with live access", () => {
    const list = [ws("a", true), ws("b", false)]
    expect(pickActiveWorkspace(list, "missing")?.workspaceId).toBe("b")
  })

  it("falls back to the first workspace when all access is expired", () => {
    const list = [ws("a", true), ws("b", true)]
    expect(pickActiveWorkspace(list, null)?.workspaceId).toBe("a")
  })

  it("returns null for an empty list", () => {
    expect(pickActiveWorkspace([], "a")).toBeNull()
  })
})
