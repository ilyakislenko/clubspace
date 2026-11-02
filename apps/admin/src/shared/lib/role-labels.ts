// Russian display labels for the canonical role names that come from the
// `Role.name` column. Not stored on the server — keeping it client-side
// means we can rename the visual without a DB migration. Unknown role
// names fall back to their raw value so a freshly-seeded role still shows
// up coherently before a label is added here. The coach roles take the
// club's word («Тренер» or «Педагог»).

import { cap, type ClubVocabulary } from "@clubspace/ui-kit/brand"

const ROLE_LABEL_RU: Record<string, string> = {
  user: "Ученик",
  admin: "Администратор",
  moderator: "Модератор",
}

export const formatRoleName = (name: string, vocabulary: ClubVocabulary): string => {
  if (name === "coach") return cap(vocabulary.coach.nom)
  if (name === "head_coach") return cap(vocabulary.headCoach.nom)
  return ROLE_LABEL_RU[name] ?? name
}
