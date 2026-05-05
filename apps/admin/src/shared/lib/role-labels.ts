// Russian display labels for the canonical role names that come from the
// `Role.name` column. Not stored on the server — keeping it client-side
// means we can rename the visual without a DB migration. Unknown role
// names fall back to their raw value so a freshly-seeded role still shows
// up coherently before a label is added here.

const ROLE_LABEL_RU: Record<string, string> = {
  user: "Ученик",
  coach: "Тренер",
  head_coach: "Главный тренер",
  admin: "Администратор",
  moderator: "Модератор",
}

export const formatRoleName = (name: string): string => {
  return ROLE_LABEL_RU[name] ?? name
}
