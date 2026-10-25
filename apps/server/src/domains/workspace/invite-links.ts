import { escapeHtml } from '../../shared/utils/escape-html'

export type AppLinks = {
    web: string | null
    googlePlay: string | null
    ruStore: string | null
}

// The link a member opens (or scans) to land on the join screen with the code
// filled in. No hyphen: it is the stored form. Null when APP_URL is not set.
export const buildJoinUrl = (
    appUrl: string | null,
    code: string,
): string | null => (appUrl ? `${appUrl}/join/${code}` : null)

export const buildAppLinks = (p: {
    appUrl: string | null
    playStoreUrl?: string
    ruStoreUrl?: string
}): AppLinks => ({
    web: p.appUrl,
    googlePlay: p.playStoreUrl || null,
    ruStore: p.ruStoreUrl || null,
})

// Pre-rendered block for e-mail templates (they have no conditionals): a
// button per link that is configured, in a fixed order.
export const appLinksHtml = (links: AppLinks): string => {
    const buttons: [string | null, string][] = [
        [links.googlePlay, 'Google Play'],
        [links.ruStore, 'RuStore'],
        [links.web, 'Открыть в браузере'],
    ]
    return buttons
        .filter((b): b is [string, string] => !!b[0])
        .map(
            ([href, label]) =>
                `<a href="${escapeHtml(href)}" style="display: inline-block; margin: 0 8px 8px 0; padding: 12px 24px; background: #5b58d9; color: #fff; text-decoration: none; border-radius: 999px; font-size: 14px; font-weight: 700;">${label}</a>`,
        )
        .join('')
}
