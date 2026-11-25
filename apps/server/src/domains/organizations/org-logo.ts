// An organization's logo: the club logo rules (domains/workspace/club-logo.ts —
// raster only, 2 MB, private bucket, short-lived signed URLs) under the org's
// own prefix, so a key handed back is accepted only if this org's upload
// endpoint issued it.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export const orgLogoKeyPrefix = (organizationId: string) =>
    `organizations/${organizationId}/logo/`

export const isOwnOrgLogoKey = (organizationId: string, key: string): boolean => {
    const prefix = orgLogoKeyPrefix(organizationId)
    return key.startsWith(prefix) && UUID.test(key.slice(prefix.length))
}
