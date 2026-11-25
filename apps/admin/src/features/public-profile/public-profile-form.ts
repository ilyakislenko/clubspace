import { CreateClubLogoUploadInputSchema } from "@clubspace/api-client/schemas"

import type {
  ClubLogoUploadInput,
  ClubPublicProfile,
  ClubPublicProfileInput,
} from "../../shared/api/public-profile"
import { FORM_LIMITS } from "../../shared/lib/contract-limits"

const L = FORM_LIMITS.clubProfile

export type PublicProfileDraft = {
  slug: string
  city: string
  description: string
  logoKey: string | null
  isListed: boolean
  // «Заявки на пробное с сайта»: the switch and the operator of the
  // prospects' data named in the consent text.
  trialRequestsEnabled: boolean
  pdOperatorName: string
  pdOperatorAddress: string
}

// Mirrors the server's isValidPublicSlug: lowercase Latin letters and digits,
// words joined by single hyphens, at least 3 characters. Checked here so a
// typo is explained before the round trip. The minimum and the pattern live
// in a server refine, which the contract does not carry; the maximum does.
const SLUG_MIN = 3
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
export const LOGO_CONTENT_TYPES: readonly ClubLogoUploadInput["contentType"][] =
  CreateClubLogoUploadInputSchema.properties.contentType.enum

export const profileToDraft = (p: ClubPublicProfile): PublicProfileDraft => ({
  slug: p.slug,
  city: p.city ?? "",
  description: p.description ?? "",
  logoKey: p.logoKey,
  isListed: p.isListed,
  trialRequestsEnabled: p.trialRequestsEnabled,
  pdOperatorName: p.pdOperatorName ?? "",
  pdOperatorAddress: p.pdOperatorAddress ?? "",
})

export const draftToInput = (d: PublicProfileDraft): ClubPublicProfileInput => ({
  slug: d.slug.trim().toLowerCase(),
  city: d.city.trim() || null,
  description: d.description.trim() || null,
  logoKey: d.logoKey,
  isListed: d.isListed,
  trialRequestsEnabled: d.trialRequestsEnabled,
  pdOperatorName: d.pdOperatorName.trim() || null,
  pdOperatorAddress: d.pdOperatorAddress.trim() || null,
})

// Did this save touch the trial form (switch or operator)? A refusal then
// belongs to that block, not to the page as a whole.
export const trialChanged = (draft: PublicProfileDraft, saved: PublicProfileDraft): boolean =>
  draft.trialRequestsEnabled !== saved.trialRequestsEnabled ||
  draft.pdOperatorName.trim() !== saved.pdOperatorName.trim() ||
  draft.pdOperatorAddress.trim() !== saved.pdOperatorAddress.trim()

export const validatePublicProfileDraft = (
  d: PublicProfileDraft,
): string | null => {
  const slug = d.slug.trim().toLowerCase()
  if (slug.length < SLUG_MIN || slug.length > L.slug.max || !SLUG_PATTERN.test(slug)) {
    return `Адрес страницы: ${SLUG_MIN}–${L.slug.max} символа — строчные латинские буквы и цифры, слова через дефис`
  }
  if (d.description.trim().length > L.description.max) {
    return `Описание — не длиннее ${L.description.max} символов`
  }
  // The server refuses the switch without both (and without the owner's DPA
  // acceptance, which only it knows for sure); said here before the trip.
  if (d.trialRequestsEnabled && (!d.pdOperatorName.trim() || !d.pdOperatorAddress.trim())) {
    return "Укажите оператора персональных данных — название и адрес"
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
  if (file.size > L.logoBytes.max) {
    return {
      ok: false,
      error: `Логотип должен быть не больше ${L.logoBytes.max / 1024 / 1024} МБ`,
    }
  }
  return { ok: true, input: { contentType: file.type, contentLength: file.size } }
}
