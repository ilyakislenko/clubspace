import { FilesService } from '../../infrastructure/files/services/files.service'

// Static raster formats only, like course covers: SVG is a stored-XSS surface,
// HEIC doesn't decode in browsers, animation has no place in a logo.
export const CLUB_LOGO_CONTENT_TYPES = [
    'image/jpeg',
    'image/png',
    'image/webp',
] as const

// Signed into the upload URL, so storage itself refuses a bigger body.
export const CLUB_LOGO_MAX_BYTES = 2 * 1024 * 1024

// Under the club's own prefix, which the bucket policy keeps private: the logo
// is handed out through short-lived signed URLs, never an anonymous one.
export const clubLogoKeyPrefix = (workspaceId: string) =>
    `workspaces/${workspaceId}/logo/`

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

// A key the client hands back must be one this club's upload endpoint issued —
// otherwise an admin could point the public page at another club's (or any
// private) object and have it signed for the whole internet.
export const isOwnClubLogoKey = (workspaceId: string, key: string): boolean => {
    const prefix = clubLogoKeyPrefix(workspaceId)
    return key.startsWith(prefix) && UUID.test(key.slice(prefix.length))
}

// Long enough to outlive a cached public page, short enough that a leaked URL
// expires the same day.
const LOGO_URL_TTL_SECONDS = 12 * 60 * 60

export const signClubLogoUrl = async (
    files: FilesService,
    logoKey: string | null,
): Promise<string | null> =>
    logoKey
        ? await files.getPresignedGetUrl({
              bucket: files.getDefaultBucketName(),
              key: logoKey,
              expiresInSeconds: LOGO_URL_TTL_SECONDS,
          })
        : null
