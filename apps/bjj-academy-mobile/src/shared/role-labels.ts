// Russian display labels for the canonical role names that come from
// the Role.name column. Mirror of the admin's shared/lib/role-labels.ts —
// keeping it client-side means renaming the visual doesn't need a DB
// migration. Unknown role names fall back to their raw value.

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
