import {
  isTargetComplete,
  matchesTargetFilter,
  publishConfirmText,
  targetOf,
  targetPayload,
} from "./announcement-target"

const adults = { id: "g1", name: "Взрослые", gymName: "Манеж", directionId: "bjj" }
const kids = { id: "g2", name: "Дети", gymName: null, directionId: "bjj" }
const bjj = { id: "bjj", name: "БЖЖ", color: null, icon: null }

describe("announcement target", () => {
  it("reads the target of a stored announcement", () => {
    expect(targetOf({ direction: null, groups: [adults] } as never)).toEqual({
      kind: "groups",
      directionId: null,
      groupIds: ["g1"],
    })
    expect(targetOf({ direction: bjj, groups: [] } as never).kind).toBe("direction")
    expect(targetOf({ direction: null, groups: [] } as never).kind).toBe("club")
  })

  it("sends one target and clears the other", () => {
    expect(
      targetPayload({ kind: "groups", directionId: "bjj", groupIds: ["g1"] }),
    ).toEqual({ directionId: null, groupIds: ["g1"] })
    expect(
      targetPayload({ kind: "direction", directionId: "bjj", groupIds: ["g1"] }),
    ).toEqual({ directionId: "bjj", groupIds: [] })
    expect(
      targetPayload({ kind: "club", directionId: null, groupIds: [] }),
    ).toEqual({ directionId: null, groupIds: [] })
  })

  it("«Группы» needs a group, «Направление» a direction", () => {
    expect(isTargetComplete({ kind: "groups", directionId: null, groupIds: [] })).toBe(false)
    expect(isTargetComplete({ kind: "direction", directionId: null, groupIds: [] })).toBe(false)
    expect(isTargetComplete({ kind: "club", directionId: null, groupIds: [] })).toBe(true)
  })

  it("files a group announcement under a direction only when all its groups are of it", () => {
    const forGroups = { direction: null, groups: [adults, kids] }
    expect(matchesTargetFilter("all", forGroups)).toBe(true)
    expect(matchesTargetFilter("bjj", forGroups)).toBe(true)
    expect(matchesTargetFilter("mma", forGroups)).toBe(false)
    // «Только для всего клуба» means no direction and no groups.
    expect(matchesTargetFilter("club", forGroups)).toBe(false)
    expect(matchesTargetFilter("club", { direction: null, groups: [] })).toBe(true)
  })

  it("names the groups with their hall in the publish confirmation", () => {
    expect(
      publishConfirmText("ALL", { directionName: null, groups: [adults, kids] }),
    ).toBe(
      "Опубликовать и отправить уведомление всем участникам групп «Взрослые · Манеж», «Дети»?",
    )
    expect(publishConfirmText("ALL", { directionName: "БЖЖ", groups: [] })).toBe(
      "Опубликовать и отправить уведомление всем участникам направления «БЖЖ»?",
    )
  })
})
