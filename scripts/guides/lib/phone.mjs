// Shared steps of the app guides (PWA in a phone viewport, iPhone 13).
import { Recorder, signIn } from './recorder.mjs'

// Signs `email` in to the PWA off camera and opens a recording on `url`.
export async function openPhone({ id, email, url }) {
    const storageState = await signIn('phone', email)
    const rec = await Recorder.open({ id, kind: 'phone', storageState })
    await rec.page.goto(url)
    return rec
}
