import {
  draftToInput,
  logoUploadFor,
  profileToDraft,
  validatePublicProfileDraft,
  type PublicProfileDraft,
} from "./public-profile-form"

const draft: PublicProfileDraft = {
  slug: "gracie-tomsk",
  city: "Томск",
  description: "Зал у реки",
  logoKey: null,
  isListed: false,
  trialRequestsEnabled: false,
  pdOperatorName: "",
  pdOperatorAddress: "",
}

describe("profileToDraft / draftToInput", () => {
  it("round-trips a profile and stores blank text as null", () => {
    const d = profileToDraft({
      slug: "gracie-tomsk",
      city: null,
      description: null,
      logoKey: "workspaces/w1/logo/x",
      logoUrl: "https://s3/x",
      isListed: true,
      pageUrl: null,
      joinPageUrl: null,
      trialRequestsEnabled: true,
      pdOperatorName: "ИП Орлов А. С.",
      pdOperatorAddress: null,
      trialFormUrl: null,
      leadsDpaAccepted: true,
    })
    expect(d).toEqual({
      slug: "gracie-tomsk",
      city: "",
      description: "",
      logoKey: "workspaces/w1/logo/x",
      isListed: true,
      trialRequestsEnabled: true,
      pdOperatorName: "ИП Орлов А. С.",
      pdOperatorAddress: "",
    })
    expect(
      draftToInput({ ...d, slug: " Gracie-Tomsk ", city: "  ", pdOperatorName: " ИП Орлов А. С. " }),
    ).toEqual({
      slug: "gracie-tomsk",
      city: null,
      description: null,
      logoKey: "workspaces/w1/logo/x",
      isListed: true,
      trialRequestsEnabled: true,
      pdOperatorName: "ИП Орлов А. С.",
      pdOperatorAddress: null,
    })
  })
})

describe("validatePublicProfileDraft", () => {
  it("accepts a valid draft", () => {
    expect(validatePublicProfileDraft(draft)).toBeNull()
  })

  it.each(["ab", "грэпплинг", "gracie_tomsk", "gracie--tomsk", "-gracie"])(
    "explains a bad slug: %s",
    (slug) => {
      expect(validatePublicProfileDraft({ ...draft, slug })).toContain(
        "Адрес страницы",
      )
    },
  )

  it("refuses an overlong description", () => {
    expect(
      validatePublicProfileDraft({ ...draft, description: "x".repeat(2001) }),
    ).toContain("Описание")
  })

  it("refuses the trial form without the data operator's name and address", () => {
    const on = { ...draft, trialRequestsEnabled: true }
    expect(validatePublicProfileDraft(on)).toBe("Укажите оператора персональных данных — название и адрес")
    expect(validatePublicProfileDraft({ ...on, pdOperatorName: "ИП Орлов" })).not.toBeNull()
    expect(
      validatePublicProfileDraft({ ...on, pdOperatorName: "ИП Орлов", pdOperatorAddress: "Томск, ул. Ленина, 1" }),
    ).toBeNull()
    // Off: the operator may stay empty.
    expect(validatePublicProfileDraft(draft)).toBeNull()
  })
})

describe("logoUploadFor", () => {
  it("builds the upload request for an image", () => {
    expect(logoUploadFor({ type: "image/png", size: 1000 })).toEqual({
      ok: true,
      input: { contentType: "image/png", contentLength: 1000 },
    })
  })

  it("refuses an SVG", () => {
    expect(logoUploadFor({ type: "image/svg+xml", size: 10 })).toEqual({
      ok: false,
      error: "Логотип — картинка JPEG, PNG или WebP",
    })
  })

  it("refuses a file over 2 MB", () => {
    expect(
      logoUploadFor({ type: "image/jpeg", size: 2 * 1024 * 1024 + 1 }),
    ).toMatchObject({ ok: false })
  })
})
