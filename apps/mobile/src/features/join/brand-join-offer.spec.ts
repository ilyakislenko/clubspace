import type { Invitation } from "../../shared/api/invitations"
import type { JoinRequest } from "../../shared/api/join"
import {
  brandJoinDismissKey,
  brandJoinPrompt,
  shouldAskToJoinBrandClub,
} from "./brand-join-offer"

const KEY = "bars"

const req = (workspaceKey: string, status: JoinRequest["status"]): JoinRequest => ({
  workspaceId: `id-${workspaceKey}`,
  workspaceName: workspaceKey,
  workspaceKey,
  status,
  requestedAt: "2026-10-25T10:00:00.000Z",
})

const invitation: Invitation = {
  id: "i1",
  workspaceId: "w9",
  workspaceName: "Другой",
  workspaceType: "fitness",
  roleName: "user",
  groupName: null,
  invitedAt: "2026-10-25T10:00:00.000Z",
}

const base = {
  brandKey: KEY as string | null,
  workspaceKeys: [] as string[],
  requests: [] as JoinRequest[] | null,
  invitations: [] as Invitation[] | null,
  dismissed: false,
}

describe("shouldAskToJoinBrandClub", () => {
  it("asks a member who has nothing to do with the baked-in club", () => {
    expect(shouldAskToJoinBrandClub(base)).toBe(true)
  })

  it("asks even when the member is in other clubs or asked other clubs", () => {
    expect(
      shouldAskToJoinBrandClub({
        ...base,
        workspaceKeys: ["other"],
        requests: [req("third", "pending")],
      }),
    ).toBe(true)
  })

  it("never asks in the club-picker build", () => {
    expect(shouldAskToJoinBrandClub({ ...base, brandKey: null })).toBe(false)
  })

  it("does not ask a member of the club", () => {
    expect(
      shouldAskToJoinBrandClub({ ...base, workspaceKeys: ["other", KEY] }),
    ).toBe(false)
  })

  it.each(["pending", "rejected"] as const)(
    "does not ask with a %s request to the club",
    (status) => {
      expect(
        shouldAskToJoinBrandClub({ ...base, requests: [req(KEY, status)] }),
      ).toBe(false)
    },
  )

  it("defers to an open invitation", () => {
    expect(
      shouldAskToJoinBrandClub({ ...base, invitations: [invitation] }),
    ).toBe(false)
  })

  it("respects a «Не сейчас»", () => {
    expect(shouldAskToJoinBrandClub({ ...base, dismissed: true })).toBe(false)
  })

  it("waits until requests and invitations are known", () => {
    expect(shouldAskToJoinBrandClub({ ...base, requests: null })).toBe(false)
    expect(shouldAskToJoinBrandClub({ ...base, invitations: null })).toBe(false)
  })
})

describe("brandJoinDismissKey / brandJoinPrompt", () => {
  it("scopes the dismissal to the account and the club", () => {
    expect(brandJoinDismissKey("u1", KEY)).toBe("clubspace.brandJoinDismissed.u1.bars")
    expect(brandJoinDismissKey("u2", KEY)).not.toBe(brandJoinDismissKey("u1", KEY))
  })

  it("names the club in the question", () => {
    const prompt = brandJoinPrompt("Барс")
    expect(prompt.title).toBe("Вступить в клуб «Барс»?")
    expect([prompt.join, prompt.later]).toEqual(["Вступить", "Не сейчас"])
  })
})
