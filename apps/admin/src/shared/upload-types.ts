// Mirror of the server-side ALLOWED_THUMBNAIL_CONTENT_TYPES enum. Keep in
// sync — animated formats (gif, apng, animated webp) and SVG are rejected
// for catalog consistency and to avoid stored-XSS via SVG.
export const ALLOWED_THUMBNAIL_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const

export type AllowedThumbnailType = (typeof ALLOWED_THUMBNAIL_TYPES)[number]

export const ALLOWED_THUMBNAIL_ACCEPT = ALLOWED_THUMBNAIL_TYPES.join(",")

export const isAllowedThumbnailType = (
  value: string,
): value is AllowedThumbnailType =>
  (ALLOWED_THUMBNAIL_TYPES as readonly string[]).includes(value)

export const THUMBNAIL_REJECT_MESSAGE =
  "Поддерживаются только JPG, PNG и WEBP. GIF и анимация запрещены."
