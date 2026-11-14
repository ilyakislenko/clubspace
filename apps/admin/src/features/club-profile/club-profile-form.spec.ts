import {
  changedParts,
  validateClubProfile,
  type ClubProfileDraft,
} from "./club-profile-form"

const saved: ClubProfileDraft = {
  page: {
    slug: "academy",
    city: "Томск",
    description: "",
    logoKey: null,
    isListed: false,
  },
  about: {
    contacts: [{ label: "Администратор", phone: "+79528849420" }],
    links: [],
    rules: "",
  },
  timezone: "Asia/Tomsk",
}

describe("changedParts", () => {
  it("is empty for the saved values and for whitespace-only edits", () => {
    expect(changedParts(saved, saved)).toEqual([])
    expect(
      changedParts(
        { ...saved, page: { ...saved.page, city: " Томск " }, about: { ...saved.about, rules: "  " } },
        saved,
      ),
    ).toEqual([])
  })

  it("lists every changed part in save order", () => {
    const draft: ClubProfileDraft = {
      page: { ...saved.page, isListed: true },
      about: { ...saved.about, links: [{ label: "Сайт", url: "https://club.example" }] },
      timezone: "Europe/Moscow",
    }
    expect(changedParts(draft, saved)).toEqual(["page", "about", "timezone"])
    expect(changedParts({ ...saved, timezone: "Europe/Moscow" }, saved)).toEqual([
      "timezone",
    ])
  })
})

describe("validateClubProfile", () => {
  const badSlug = { ...saved, page: { ...saved.page, slug: "Я" } }
  const badPhone = {
    ...saved,
    about: { ...saved.about, contacts: [{ label: "Тренер", phone: "123" }] },
  }

  it("checks only the parts being saved", () => {
    expect(validateClubProfile(badSlug, ["about"])).toBeNull()
    expect(validateClubProfile(badSlug, ["page"])).toMatch(/Адрес страницы/)
    expect(validateClubProfile(badPhone, ["page"])).toBeNull()
    expect(validateClubProfile(badPhone, ["about"])).toMatch(/Телефон/)
  })

  it("refuses an empty time zone", () => {
    expect(validateClubProfile({ ...saved, timezone: " " }, ["timezone"])).toMatch(
      /часовой пояс/,
    )
  })
})
