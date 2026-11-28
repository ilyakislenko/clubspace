// Shared steps of the admin guides (desktop, 1440×900).
import { config } from './env.mjs'
import { Recorder, signIn } from './recorder.mjs'

// Signs `email` in off camera and opens a recording on `path` of the admin
// (relative to /workspace/<id>/ for club staff, absolute for /org/…).
export async function openAdmin({ id, email, workspaceId, path = '' }) {
    const storageState = await signIn('admin', email)
    const rec = await Recorder.open({ id, kind: 'admin', storageState })
    const url = path.startsWith('/') ? `${config.adminUrl}${path}` : `${config.adminUrl}/workspace/${workspaceId}/${path}`
    await rec.page.goto(url)
    // A new edition of the platform offer shows a banner to the owner until
    // accepted; accept it off camera, as an owner would once.
    const accept = rec.page.getByRole('button', { name: 'Принять', exact: true })
    if (await accept.isVisible({ timeout: 3000 }).catch(() => false)) {
        await accept.click()
        await rec.pause(800)
    }
    await rec.page.mouse.move(rec.pos.x, rec.pos.y)
    return rec
}

// A sidebar entry of the club admin.
export const navLink = (rec, name) => rec.page.getByRole('link', { name, exact: true }).first()

// A Radix select: open it, pick the option.
export async function choose(rec, trigger, option) {
    await rec.click(trigger, { after: 500 })
    await rec.click(rec.page.getByRole('option', { name: option }).first(), { after: 600 })
}
