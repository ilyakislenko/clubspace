// Contact details for the public /legal/* pages. NEXT_PUBLIC_* values are
// inlined at build time (see apps/client/Dockerfile); empty falls back to the
// defaults below.
export const LEGAL_OPERATOR =
  process.env.NEXT_PUBLIC_LEGAL_OPERATOR ||
  "Кисленко Илья Андреевич, индивидуальный разработчик (Республика Казахстан)"

export const SUPPORT_EMAIL =
  process.env.NEXT_PUBLIC_SUPPORT_EMAIL || "dude_talks@icloud.com"

export const LEGAL_ADDRESS = process.env.NEXT_PUBLIC_LEGAL_ADDRESS || ""
