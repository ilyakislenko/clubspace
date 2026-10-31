import type {
  ClubLogoUploadInput,
  ClubPublicProfile,
  ClubPublicProfileInput,
} from "../../shared/api/public-profile"

export type PublicProfileDraft = {
  slug: string
  city: string
  description: string
  logoKey: string | null
  isListed: boolean
}

// Mirrors the server: lowercase Latin letters and digits, words joined by
// single hyphens, 3–64 characters. Checked here so a typo is explained before
// the round trip.
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
export const DESCRIPTION_MAX = 2000
export const LOGO_MAX_BYTES = 2 * 1024 * 1024
export const LOGO_CONTENT_TYPES: readonly ClubLogoUploadInput["contentType"][] =
  ["image/jpeg", "image/png", "image/webp"]

export const profileToDraft = (p: ClubPublicProfile): PublicProfileDraft => ({
  slug: p.slug,
  city: p.city ?? "",
  description: p.description ?? "",
  logoKey: p.logoKey,
  isListed: p.isListed,
})

export const draftToInput = (d: PublicProfileDraft): ClubPublicProfileInput => ({
  slug: d.slug.trim().toLowerCase(),
  city: d.city.trim() || null,
  description: d.description.trim() || null,
  logoKey: d.logoKey,
  isListed: d.isListed,
})

export const validatePublicProfileDraft = (
  d: PublicProfileDraft,
): string | null => {
  const slug = d.slug.trim().toLowerCase()
  if (slug.length < 3 || slug.length > 64 || !SLUG_PATTERN.test(slug)) {
    return "Адрес страницы: 3–64 символа — строчные латинские буквы и цифры, слова через дефис"
  }
  if (d.description.trim().length > DESCRIPTION_MAX) {
    return `Описание — не длиннее ${DESCRIPTION_MAX} символов`
  }
  return null
}

const isLogoContentType = (
  type: string,
): type is ClubLogoUploadInput["contentType"] =>
  (LOGO_CONTENT_TYPES as readonly string[]).includes(type)

// The upload request for a picked file, or the reason it can't be a logo.
export const logoUploadFor = (file: {
  type: string
  size: number
}): { ok: true; input: ClubLogoUploadInput } | { ok: false; error: string } => {
  if (!isLogoContentType(file.type)) {
    return { ok: false, error: "Логотип — картинка JPEG, PNG или WebP" }
  }
  if (file.size > LOGO_MAX_BYTES) {
    return { ok: false, error: "Логотип должен быть не больше 2 МБ" }
  }
  return { ok: true, input: { contentType: file.type, contentLength: file.size } }
}
