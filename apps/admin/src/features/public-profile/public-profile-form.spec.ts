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
    })
    expect(d).toEqual({
      slug: "gracie-tomsk",
      city: "",
      description: "",
      logoKey: "workspaces/w1/logo/x",
      isListed: true,
    })
    expect(draftToInput({ ...d, slug: " Gracie-Tomsk ", city: "  " })).toEqual({
      slug: "gracie-tomsk",
      city: null,
      description: null,
      logoKey: "workspaces/w1/logo/x",
      isListed: true,
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
