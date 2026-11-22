import { sameData } from "../../shared/lib/use-dirty-guard"
import {
  draftToInput as aboutToInput,
  validateClubAboutDraft,
  type ClubAboutDraft,
} from "../club-about/club-about-form"
import {
  draftToInput as pageToInput,
  validatePublicProfileDraft,
  type PublicProfileDraft,
} from "../public-profile/public-profile-form"

// «Настройки → Профиль клуба»: one form over three stores — the public page,
// «О клубе» in the app and the club's time zone. One «Сохранить» writes the
// parts that changed.
export type ClubProfileDraft = {
  page: PublicProfileDraft
  about: ClubAboutDraft
  timezone: string
}

export type ClubProfilePart = keyof ClubProfileDraft

// Parts whose draft differs from what the server holds, in save order. Values
// are compared the way they are sent (trimmed), so stray spaces are not edits.
export const changedParts = (
  draft: ClubProfileDraft,
  saved: ClubProfileDraft,
): ClubProfilePart[] => {
  const parts: ClubProfilePart[] = []
  if (!sameData(pageToInput(draft.page), pageToInput(saved.page))) parts.push("page")
  if (!sameData(aboutToInput(draft.about), aboutToInput(saved.about))) {
    parts.push("about")
  }
  if (draft.timezone.trim() !== saved.timezone) parts.push("timezone")
  return parts
}

// First problem of the parts about to be saved, in Russian; null when they
// can all be saved. Unchanged parts are not re-checked: a value the server
// accepted before must not block saving another part.
export const validateClubProfile = (
  draft: ClubProfileDraft,
  parts: readonly ClubProfilePart[],
): string | null => {
  if (parts.includes("page")) {
    const problem = validatePublicProfileDraft(draft.page)
    if (problem) return problem
  }
  if (parts.includes("about")) {
    const problem = validateClubAboutDraft(draft.about)
    if (problem) return problem
  }
  if (parts.includes("timezone") && !draft.timezone.trim()) {
    return "Выберите часовой пояс клуба"
  }
  return null
}
