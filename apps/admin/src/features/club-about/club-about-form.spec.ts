import {
  draftToInput,
  moveItem,
  validateClubAboutDraft,
  type ClubAboutDraft,
} from "./club-about-form"

const ok: ClubAboutDraft = {
  contacts: [{ label: "Главный тренер", phone: "8-952-884-94-20" }],
  links: [{ label: "Сайт", url: "https://club.example" }],
  rules: "Правило 1",
}

describe("validateClubAboutDraft", () => {
  it("accepts a filled draft and an empty one", () => {
    expect(validateClubAboutDraft(ok)).toBeNull()
    expect(
      validateClubAboutDraft({ contacts: [], links: [], rules: "" }),
    ).toBeNull()
  })

  it("rejects a contact without a label or with a non-number phone", () => {
    expect(
      validateClubAboutDraft({
        ...ok,
        contacts: [{ label: " ", phone: "+79528849420" }],
      }),
    ).toMatch(/подпись/)
    expect(
      validateClubAboutDraft({
        ...ok,
        contacts: [{ label: "X", phone: "123" }],
      }),
    ).toMatch(/не похож на номер/)
  })

  it.each([
    "952 884-94-20",
    "+8 952 884-94-20",
    "+7 952 884-94-20 доб. 12",
    "+7 952 884-94-20 ext 5",
    "+7 952 884-94-20 #12",
    "+7 952 884-94-20, 12",
    "6 952 884-94-20",
  ])("rejects the phone %p like the server does", (phone) => {
    expect(
      validateClubAboutDraft({ ...ok, contacts: [{ label: "X", phone }] }),
    ).toMatch(/не похож на номер/)
  })

  it.each(["+7 952 884-94-20", "8 (952) 884-94-20", "+375 29 123-45-67"])(
    "accepts the phone %p",
    (phone) => {
      expect(
        validateClubAboutDraft({ ...ok, contacts: [{ label: "X", phone }] }),
      ).toBeNull()
    },
  )

  it("rejects non-http links", () => {
    expect(
      validateClubAboutDraft({
        ...ok,
        links: [{ label: "x", url: "javascript:alert(1)" }],
      }),
    ).toBe("Ссылка должна начинаться с http:// или https://")
    expect(
      validateClubAboutDraft({
        ...ok,
        links: [{ label: "x", url: "club.example" }],
      }),
    ).toMatch(/http/)
  })

  it("enforces the item and length limits", () => {
    const many = Array.from({ length: 11 }, () => ok.contacts[0])
    expect(validateClubAboutDraft({ ...ok, contacts: many })).toMatch(/не больше/)
    expect(validateClubAboutDraft({ ...ok, rules: "a".repeat(10001) })).toMatch(
      /10000/,
    )
  })
})

describe("draftToInput", () => {
  it("trims and turns blank rules into null", () => {
    expect(
      draftToInput({
        contacts: [{ label: " A ", phone: " +7 952 884-94-20 " }],
        links: [{ label: " S ", url: " https://x.y " }],
        rules: "   ",
      }),
    ).toEqual({
      contacts: [{ label: "A", phone: "+7 952 884-94-20" }],
      links: [{ label: "S", url: "https://x.y" }],
      rules: null,
    })
  })
})

describe("moveItem", () => {
  it("swaps neighbours and ignores out-of-range moves", () => {
    expect(moveItem([1, 2, 3], 1, -1)).toEqual([2, 1, 3])
    expect(moveItem([1, 2, 3], 1, 1)).toEqual([1, 3, 2])
    expect(moveItem([1, 2, 3], 0, -1)).toEqual([1, 2, 3])
    expect(moveItem([1, 2, 3], 2, 1)).toEqual([1, 2, 3])
  })
})
