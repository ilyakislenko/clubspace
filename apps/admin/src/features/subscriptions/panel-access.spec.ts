import { canOpenMemberSubscriptions } from "./panel-access"

const coach = { role: "coach", isOwner: false, managedDirectionIds: [] }
const manager = { role: "coach", isOwner: false, managedDirectionIds: ["bjj"] }
const headCoach = { role: "head_coach", isOwner: false }
const admin = { role: "admin", isOwner: false }
const owner = { role: "user", isOwner: true }

describe("canOpenMemberSubscriptions", () => {
  it("lets sport leads and the owner read any member, themselves included", () => {
    for (const m of [admin, headCoach, owner]) {
      expect(canOpenMemberSubscriptions(m, "me", "student")).toBe(true)
      expect(canOpenMemberSubscriptions(m, "me", "me")).toBe(true)
    }
  })

  it("lets a coach read a member of the profile they opened", () => {
    expect(canOpenMemberSubscriptions(coach, "me", "student")).toBe(true)
    expect(canOpenMemberSubscriptions(manager, "me", "student")).toBe(true)
  })

  it("keeps a group-scoped coach off their own abonements", () => {
    expect(canOpenMemberSubscriptions(coach, "me", "me")).toBe(false)
    expect(canOpenMemberSubscriptions(manager, "me", "me")).toBe(false)
  })

  it("waits until the viewer is known", () => {
    expect(canOpenMemberSubscriptions(coach, null, "student")).toBe(false)
    expect(canOpenMemberSubscriptions(null, "me", "student")).toBe(false)
  })

  it("never opens for a non-staff viewer", () => {
    expect(
      canOpenMemberSubscriptions({ role: "user", isOwner: false }, "me", "student"),
    ).toBe(false)
  })
})
