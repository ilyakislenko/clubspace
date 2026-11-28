// Direct API access for scenario setup and cleanup (never on camera): removes
// what a previous run created, so every recording starts from the same state.
import { config } from './env.mjs'

export async function apiSession(email) {
    const call = async (method, path, body, token) => {
        const res = await fetch(`${config.apiUrl}${path}`, {
            method,
            headers: {
                ...(body === undefined ? {} : { 'content-type': 'application/json' }),
                ...(token ? { authorization: `Bearer ${token}` } : {}),
            },
            body: body === undefined ? undefined : JSON.stringify(body),
        })
        const text = await res.text()
        if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text.slice(0, 300)}`)
        return text ? JSON.parse(text) : null
    }
    await call('POST', '/send-auth-code', { email })
    const { accessToken } = await call('POST', '/sign-in', { email, code: config.demoLoginCode })
    return {
        get: (path) => call('GET', path, undefined, accessToken),
        post: (path, body = {}) => call('POST', path, body, accessToken),
        patch: (path, body = {}) => call('PATCH', path, body, accessToken),
        put: (path, body = {}) => call('PUT', path, body, accessToken),
        del: (path) => call('DELETE', path, undefined, accessToken),
    }
}

// The demo club ACADEMY's id, as the given session sees it.
export async function academyId(api) {
    const { data } = await api.post('/get-my-workspaces')
    const club = data.find((w) => w.key === 'academy-demo')
    if (!club) throw new Error('This account is not in the demo club ACADEMY')
    return club.workspaceId
}

// Items of a list response, whatever its envelope.
export const items = (res) => (Array.isArray(res) ? res : (res?.items ?? res?.data ?? res?.results ?? []))
