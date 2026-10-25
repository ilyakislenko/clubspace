import type { JoinRequest } from "../../shared/api/join"
import { onboardingView } from "./onboarding-view"

const req = (
  workspaceKey: string,
  status: "pending" | "rejected",
): JoinRequest => ({
  workspaceId: `id-${workspaceKey}`,
  workspaceName: workspaceKey,
  workspaceKey,
  status,
  requestedAt: "2026-10-25T10:00:00.000Z",
})

describe("onboardingView, club-picker build", () => {
  it("welcomes a member with no requests", () => {
    expect(onboardingView({ whiteLabelKey: null, requests: [] })).toEqual({
      kind: "welcome",
    })
  })

  it("splits requests into pending and rejected", () => {
    const a = req("a", "pending")
    const b = req("b", "rejected")
    expect(onboardingView({ whiteLabelKey: null, requests: [a, b] })).toEqual({
      kind: "requests",
      pending: [a],
      rejected: [b],
    })
  })
})

describe("onboardingView, build with a baked-in club", () => {
  const key = "club_a"

  it("waits when the baked-in club has a pending request", () => {
    expect(
      onboardingView({
        whiteLabelKey: key,
        requests: [req("other", "rejected"), req(key, "pending")],
      }),
    ).toEqual({ kind: "wl-pending" })
  })

  it("reports a rejection by the baked-in club", () => {
    expect(
      onboardingView({ whiteLabelKey: key, requests: [req(key, "rejected")] }),
    ).toEqual({ kind: "wl-rejected" })
  })

  it("says the request was not found instead of a silent «sent»", () => {
    expect(onboardingView({ whiteLabelKey: key, requests: [] })).toEqual({
      kind: "wl-missing",
    })
  })

  it("lists requests made by code to other clubs when none is for the baked-in one", () => {
    const other = req("other", "pending")
    expect(
      onboardingView({ whiteLabelKey: key, requests: [other] }),
    ).toEqual({ kind: "requests", pending: [other], rejected: [] })
  })
})
