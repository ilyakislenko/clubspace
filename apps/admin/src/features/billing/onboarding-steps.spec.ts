import { checklistState } from "./onboarding-steps"

const all = (done: Record<string, boolean>) =>
  (["gym", "group", "schedule", "plans", "members", "payments", "video"] as const).map((key) => ({
    key,
    done: done[key] ?? false,
  }))

describe("launch checklist", () => {
  it("is complete when the required steps are done, with payments and video still open", () => {
    const state = checklistState(
      all({ gym: true, group: true, schedule: true, plans: true, members: true }),
    )
    expect(state.complete).toBe(true)
    expect(state).toMatchObject({ requiredDone: 5, requiredTotal: 5 })
  })

  it("lists only the steps to do, required first, optional ones marked", () => {
    const state = checklistState(all({ gym: true, group: true, video: false }))
    expect(state.complete).toBe(false)
    expect(state.requiredDone).toBe(2)
    expect(state.todo).toEqual([
      { key: "schedule", optional: false },
      { key: "plans", optional: false },
      { key: "members", optional: false },
      { key: "payments", optional: true },
      { key: "video", optional: true },
    ])
  })

  it("counts only the steps the club has (a club without abonements has no plans step)", () => {
    const steps = all({ gym: true, group: true, schedule: true, members: true }).filter(
      (s) => s.key !== "plans" && s.key !== "payments",
    )
    expect(checklistState(steps)).toMatchObject({ complete: true, requiredTotal: 4 })
  })
})
