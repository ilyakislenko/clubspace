// Extracts a user-facing message from an unknown thrown value. Falls back to a
// generic save-failure message; callers pass a more specific fallback when the
// action isn't a "save".
export const errorMessage = (
  error: unknown,
  fallback = "Не удалось сохранить изменения.",
): string => (error instanceof Error ? error.message : fallback)
