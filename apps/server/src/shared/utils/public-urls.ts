// Public web addresses of the admin and the member web app.
//
// ROOT_URL is the API host, so it cannot be used for links people open (the
// admin link in an e-mail used to land on a 404 of the API). In production the
// address is either given explicitly or derived from an `api.<domain>` ROOT_URL
// by swapping that label; anywhere else a local default is used. When neither
// works the answer is null — the server still boots, and links/QR codes that
// need the address are left out (see PUBLIC_URL_MISSING_NOTICE).
export const resolvePublicUrl = (p: {
    explicit: string | undefined
    rootUrl: string
    subdomain: 'admin' | 'app'
    devDefault: string
    production: boolean
}): string | null => {
    if (p.explicit) return p.explicit.replace(/\/+$/, '')
    if (!p.production) return p.devDefault

    const url = new URL(p.rootUrl)
    if (url.hostname.startsWith('api.')) {
        url.hostname = `${p.subdomain}.${url.hostname.slice('api.'.length)}`
        return url.origin
    }
    return null
}

// Shown to an admin in place of the join link / QR when APP_URL is not set.
export const PUBLIC_URL_MISSING_NOTICE = 'Публичный адрес приложения не настроен'
