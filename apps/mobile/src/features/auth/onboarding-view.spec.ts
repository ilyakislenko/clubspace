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
    expect(
      onboardingView({ whiteLabelKey: null, requests: [], offerBrandJoin: false }),
    ).toEqual({ kind: "welcome" })
  })

  it("splits requests into pending and rejected", () => {
    const a = req("a", "pending")
    const b = req("b", "rejected")
    expect(
      onboardingView({ whiteLabelKey: null, requests: [a, b], offerBrandJoin: false }),
    ).toEqual({
      kind: "requests",
      pending: [a],
      rejected: [b],
    })
  })

  it("never offers a baked-in club it doesn't have", () => {
    expect(
      onboardingView({ whiteLabelKey: null, requests: [], offerBrandJoin: true }),
    ).toEqual({ kind: "welcome" })
  })
})

describe("onboardingView, build with a baked-in club", () => {
  const key = "club_a"

  it("waits when the baked-in club has a pending request", () => {
    expect(
      onboardingView({
        whiteLabelKey: key,
        requests: [req("other", "rejected"), req(key, "pending")],
        offerBrandJoin: false,
      }),
    ).toEqual({ kind: "wl-pending" })
  })

  it("reports a rejection by the baked-in club", () => {
    expect(
      onboardingView({
        whiteLabelKey: key,
        requests: [req(key, "rejected")],
        offerBrandJoin: false,
      }),
    ).toEqual({ kind: "wl-rejected" })
  })

  it("offers to join the baked-in club when there is no request for it", () => {
    expect(
      onboardingView({ whiteLabelKey: key, requests: [], offerBrandJoin: true }),
    ).toEqual({ kind: "wl-offer" })
    expect(
      onboardingView({
        whiteLabelKey: key,
        requests: [req("other", "pending")],
        offerBrandJoin: true,
      }),
    ).toEqual({ kind: "wl-offer" })
  })

  it("falls back to the welcome screen once the offer was declined", () => {
    expect(
      onboardingView({ whiteLabelKey: key, requests: [], offerBrandJoin: false }),
    ).toEqual({ kind: "welcome" })
  })

  it("lists requests made by code to other clubs when none is for the baked-in one", () => {
    const other = req("other", "pending")
    expect(
      onboardingView({ whiteLabelKey: key, requests: [other], offerBrandJoin: false }),
    ).toEqual({ kind: "requests", pending: [other], rejected: [] })
  })
})
