import {
  editTargetPayload,
  isEditTargetComplete,
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
    const forGroups = { direction: null, groups: [adults, kids], groupsRemoved: false }
    expect(matchesTargetFilter("all", forGroups)).toBe(true)
    expect(matchesTargetFilter("bjj", forGroups)).toBe(true)
    expect(matchesTargetFilter("mma", forGroups)).toBe(false)
    // «Только для всего клуба» means no direction and no groups.
    expect(matchesTargetFilter("club", forGroups)).toBe(false)
    expect(
      matchesTargetFilter("club", { direction: null, groups: [], groupsRemoved: false }),
    ).toBe(true)
  })

  describe("every target group deleted since", () => {
    const orphan = { direction: null, groups: [], groupsRemoved: true }

    it("reads as «Группы» with none chosen, not as «Весь клуб»", () => {
      expect(targetOf(orphan as never)).toEqual({
        kind: "groups",
        directionId: null,
        groupIds: [],
      })
      expect(matchesTargetFilter("club", orphan)).toBe(false)
      expect(matchesTargetFilter("bjj", orphan)).toBe(false)
      expect(matchesTargetFilter("all", orphan)).toBe(true)
    })

    it("saving the text keeps it closed; opening it takes choosing «Весь клуб»", () => {
      const untouched = targetOf(orphan as never)
      expect(isEditTargetComplete(untouched, orphan)).toBe(true)
      expect(editTargetPayload(untouched, orphan)).toEqual({})
      const club = { kind: "club", directionId: null, groupIds: [] } as const
      expect(editTargetPayload(club, orphan)).toEqual({ directionId: null, groupIds: [] })
      const regroup = { kind: "groups", directionId: null, groupIds: ["g1"] } as const
      expect(editTargetPayload(regroup, orphan)).toEqual({
        directionId: null,
        groupIds: ["g1"],
      })
      // An announcement with live groups still needs one to save.
      expect(
        isEditTargetComplete(
          { kind: "groups", directionId: null, groupIds: [] },
          { groupsRemoved: false },
        ),
      ).toBe(false)
    })
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
