import { leadFixture } from "./lead-fixtures"
import { draftToCreateInput, draftToUpdateInput, EMPTY_LEAD_DRAFT, leadToDraft, validateLeadDraft } from "./lead-form"

const draft = { ...EMPTY_LEAD_DRAFT, name: " Анна ", phone: "8 952 884-94-20" }

describe("lead form", () => {
  it("needs a name, a phone and, for a child, the child's name and an age in range", () => {
    expect(validateLeadDraft(EMPTY_LEAD_DRAFT)).toBe("Укажите имя")
    expect(validateLeadDraft({ ...draft, phone: " " })).toBe("Укажите телефон")
    expect(validateLeadDraft(draft)).toBeNull()
    const child = { ...draft, forChild: true }
    expect(validateLeadDraft(child)).toBe("Укажите имя ребёнка")
    expect(validateLeadDraft({ ...child, childName: "Маша", childAge: "18" })).toBe("Возраст ребёнка — от 1 до 17 лет")
    expect(validateLeadDraft({ ...child, childName: "Маша", childAge: "8" })).toBeNull()
  })

  it("omits empty fields on create and clears them on edit", () => {
    expect(draftToCreateInput(draft, " ")).toEqual({
      name: "Анна",
      phone: "8 952 884-94-20",
      forChild: false,
      consentConfirmed: true,
    })
    expect(
      draftToCreateInput({ ...draft, forChild: true, childName: "Маша", childAge: "8", directionId: "d1" }, "Хочет в субботу"),
    ).toMatchObject({ childName: "Маша", childAge: 8, directionId: "d1", comment: "Хочет в субботу" })
    expect(draftToUpdateInput(leadToDraft(leadFixture({ email: null })), "v1")).toEqual({
      name: "Анна Петрова",
      phone: "+79528849420",
      email: null,
      forChild: false,
      childName: null,
      childAge: null,
      directionId: null,
      expectedUpdatedAt: "v1",
    })
  })
})
