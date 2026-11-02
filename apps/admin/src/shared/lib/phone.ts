// A stored phone, grouped for reading: «+79528849420» → «+7 952 884-94-20».
// Every +7 number gets the mask (Kazakhstan's +7 7xx shares the plan), as does
// a Russian number kept without the plus («8 952…» / «7 952…»). Anything else —
// a foreign number, a short code, text — is shown as stored. `tel:` links keep
// the stored value, never this.
export const formatPhone = (phone: string): string => {
  const trimmed = phone.trim()
  if (!/^\+?[\d\s().-]+$/.test(trimmed)) return phone
  const digits = trimmed.replace(/\D/g, "")
  const plusSeven = trimmed.startsWith("+") && digits[0] === "7"
  const bare = !trimmed.startsWith("+") && (digits[0] === "7" || digits[0] === "8")
  if (digits.length !== 11 || !(plusSeven || bare)) return phone
  const n = digits.slice(1)
  return `+7 ${n.slice(0, 3)} ${n.slice(3, 6)}-${n.slice(6, 8)}-${n.slice(8)}`
}
