// Extracts a user-facing message from an unknown thrown value, falling back to
// a caller-supplied message (every call site passes one specific to its action).
export const errorMessage = (
  error: unknown,
  fallback = "Что-то пошло не так. Попробуйте ещё раз.",
): string => (error instanceof Error ? error.message : fallback)
