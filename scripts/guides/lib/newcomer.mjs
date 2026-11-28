// A fresh join request from a person outside the club, made through the API
// the app uses (sign in by e-mail code, «Вступить» with the club code). The
// code is read from the local MailDev, so this works on the local stand only.
import { config } from './env.mjs'

const MAILDEV = (process.env.GUIDES_MAILDEV_URL || 'http://localhost:1080').replace(/\/+$/, '')

async function call(method, path, body, token) {
    const res = await fetch(`${config.apiUrl}${path}`, {
        method,
        headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await res.text()
    if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text.slice(0, 300)}`)
    return text ? JSON.parse(text) : null
}

async function codeFromMail(email, since) {
    for (let i = 0; i < 40; i++) {
        const mails = await (await fetch(`${MAILDEV}/api/email`)).json()
        const mail = mails
            .filter((m) => m.to?.some((t) => t.address === email) && new Date(m.time).getTime() >= since)
            .at(-1)
        const code = mail && `${mail.subject} ${mail.text ?? ''}`.match(/\b\d{6}\b/)?.[0]
        if (code) return code
        await new Promise((r) => setTimeout(r, 500))
    }
    throw new Error(`No sign-in code for ${email} in MailDev (${MAILDEV})`)
}

// Leaves the club if a previous run's request was accepted, then asks to join
// again: the request is pending (or still pending from before).
export async function freshJoinRequest({ email, firstname, lastname, clubCode, clubId }) {
    const since = Date.now() - 1000
    await call('POST', '/send-auth-code', { email })
    const { accessToken } = await call('POST', '/sign-in', { email, code: await codeFromMail(email, since) })
    // A new account accepts the personal-data consent first, as the app asks.
    const consent = await call('GET', '/me/consent', undefined, accessToken)
    if (consent.currentVersion && consent.acceptedVersion !== consent.currentVersion) {
        await call('POST', '/me/consent', { version: consent.currentVersion }, accessToken)
    }
    const { data } = await call('POST', '/get-my-workspaces', {}, accessToken)
    if (data.some((w) => w.workspaceId === clubId)) await call('DELETE', `/me/memberships/${clubId}`, undefined, accessToken)
    const res = await call('POST', '/workspaces/join', { code: clubCode, firstname, lastname }, accessToken)
    if (res.status !== 'pending') throw new Error(`Join request is «${res.status}», expected pending (auto-accept on?)`)
}
