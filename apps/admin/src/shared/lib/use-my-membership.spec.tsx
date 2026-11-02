/** @jest-environment jsdom */
import { renderHook, waitFor } from "@testing-library/react"

import { clearAuthTokens } from "../api/client"
import { getMyMembership } from "../api/members"
import { useMyMembership } from "./use-my-membership"

jest.mock("../api/members", () => ({ getMyMembership: jest.fn() }))

const getMembership = getMyMembership as jest.MockedFunction<typeof getMyMembership>

const owner = { role: "admin", isOwner: true, managedDirectionIds: [] }
const manager = { role: "coach", isOwner: false, managedDirectionIds: ["bjj"] }

describe("useMyMembership", () => {
  it("does not hand the previous account's role to the next one on this tab", async () => {
    getMembership.mockResolvedValueOnce(owner as never)
    const first = renderHook(() => useMyMembership("w1"))
    await waitFor(() => expect(first.result.current).toEqual(owner))
    first.unmount()

    clearAuthTokens()

    getMembership.mockResolvedValueOnce(manager as never)
    const next = renderHook(() => useMyMembership("w1"))
    expect(next.result.current).toBeNull()
    await waitFor(() => expect(next.result.current).toEqual(manager))
  })
})
