// One recording: a Playwright context with `recordVideo`, a visible cursor
// (desktop) or touch dot (phone) with a click ripple, deliberate pacing, and
// the caption cues and cut intervals timed from the run itself.
//
// Sign-in happens before the recording, in a separate unrecorded context
// (`signIn`), and the session is handed over as storage state: the demo code
// is typed into the real form there and never appears on video.
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { chromium, devices } from 'playwright'

import { config } from './env.mjs'

const PHONE = devices['iPhone 13']

// Context options per kind.
const contextOptions = (kind) =>
    kind === 'phone'
        ? { ...PHONE, locale: 'ru-RU', timezoneId: 'Asia/Tomsk' }
        : { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: 'ru-RU', timezoneId: 'Asia/Tomsk' }

// The video is the viewport's CSS size: Chromium's screencast frames come at
// CSS pixels, and Playwright pads a larger video instead of scaling them up.
const videoSize = (kind) => (kind === 'phone' ? { ...PHONE.viewport } : { width: 1440, height: 900 })

// Injected into the recording context only: the pointer the viewer follows.
// Listens in the capture phase so the app cannot swallow the events.
const cursorScript = (kind) => `(() => {
  if (window.__guideCursor) return; window.__guideCursor = true;
  const phone = ${JSON.stringify(kind === 'phone')};
  const mount = () => {
    const root = document.documentElement;
    const style = document.createElement('style');
    style.textContent = \`
      #__gc { position: fixed; left: 0; top: 0; z-index: 2147483647; pointer-events: none;
        transition: opacity .25s; will-change: transform; }
      .__gr { position: fixed; z-index: 2147483646; pointer-events: none; border-radius: 50%;
        width: 18px; height: 18px; margin: -9px 0 0 -9px; background: rgba(37,99,235,.45);
        border: 2px solid rgba(37,99,235,.9); animation: __gr .55s ease-out forwards; }
      @keyframes __gr { to { transform: scale(\${phone ? 4.2 : 3.4}); opacity: 0; } }\`;
    root.appendChild(style);
    const c = document.createElement('div');
    c.id = '__gc';
    c.innerHTML = phone
      ? '<div style="width:34px;height:34px;margin:-17px 0 0 -17px;border-radius:50%;background:rgba(255,255,255,.55);border:2px solid rgba(15,23,42,.55);box-shadow:0 1px 6px rgba(0,0,0,.35)"></div>'
      : '<svg width="30" height="30" viewBox="0 0 24 24" style="margin:-2px 0 0 -3px;filter:drop-shadow(0 1px 2px rgba(0,0,0,.45))"><path d="M4 2.5 L4 19.5 L8.6 15.4 L11.6 22 L14.6 20.7 L11.7 14.2 L18 14.2 Z" fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/></svg>';
    c.style.opacity = phone ? '0' : '1';
    root.appendChild(c);
    let hide;
    const at = (x, y) => {
      c.style.transform = 'translate(' + x + 'px,' + y + 'px)';
      if (phone) { c.style.opacity = '1'; clearTimeout(hide); hide = setTimeout(() => (c.style.opacity = '0'), 900); }
    };
    const last = window.__guideCursorAt; if (last) at(last[0], last[1]);
    addEventListener('mousemove', (e) => { window.__guideCursorAt = [e.clientX, e.clientY]; at(e.clientX, e.clientY); }, true);
    addEventListener('mousedown', (e) => {
      const r = document.createElement('div'); r.className = '__gr';
      r.style.left = e.clientX + 'px'; r.style.top = e.clientY + 'px';
      root.appendChild(r); setTimeout(() => r.remove(), 700);
    }, true);
  };
  if (document.documentElement) mount(); else addEventListener('DOMContentLoaded', mount);
})();`

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let browser
// Recordings opened and not finished: a scenario failed midway.
const unfinished = new Set()

async function getBrowser() {
    browser ??= await chromium.launch({ headless: !config.headed })
    return browser
}

// Closes the browser; a recording a failed scenario left open gets a
// screenshot of where it stopped (<work>/<id>/failure.png).
export async function closeBrowser() {
    for (const rec of unfinished) {
        await rec.page.screenshot({ path: rec.failureShot }).catch(() => {})
        console.error(`  снимок места ошибки: ${rec.failureShot}`)
    }
    unfinished.clear()
    await browser?.close()
    browser = undefined
}

// Signs `email` in through the real form (admin or PWA) in an unrecorded
// context; returns its storage state for the recording.
export async function signIn(kind, email, { app = kind === 'phone' ? 'pwa' : 'admin' } = {}) {
    if (!config.demoLoginCode) throw new Error('DEMO_LOGIN_CODE is not set (environment or repo .env)')
    const b = await getBrowser()
    const ctx = await b.newContext(contextOptions(kind))
    const page = await ctx.newPage()
    try {
        if (app === 'admin') {
            await page.goto(`${config.adminUrl}/sign-in`)
            // Retried as a unit: a fill that lands before hydration is wiped.
            await expectSoon(async () => {
                await page.locator('#email').fill(email)
                await page.getByRole('button', { name: 'Получить код' }).click()
                await page.locator('#code').waitFor({ timeout: 3000 })
            })
            await page.locator('#code').fill(config.demoLoginCode)
            await page.getByRole('button', { name: 'Войти' }).click()
            await page.waitForURL(/\/(workspace|org)s?\//, { timeout: 30_000 })
        } else {
            await page.goto(`${config.pwaUrl}/`)
            await expectSoon(async () => {
                const emailInput = page.getByPlaceholder('you@example.com')
                if (!(await emailInput.isVisible())) {
                    // The club picker / welcome screen leads to the sign-in form.
                    await page.getByText(/^Войти$/).first().click({ timeout: 3000 })
                }
                await emailInput.fill(email)
                await page.getByText('Получить код', { exact: true }).click()
                await page.getByPlaceholder('000000').first().waitFor({ timeout: 4000 })
            }, 6)
            const codeInput = page.getByPlaceholder('000000').first()
            await codeInput.fill(config.demoLoginCode)
            // A full code submits itself; the button is only a fallback.
            const submitted = await codeInput.waitFor({ state: 'detached', timeout: 3000 }).then(() => true, () => false)
            if (!submitted) await page.getByText('Войти', { exact: true }).last().click()
            await codeInput.waitFor({ state: 'detached', timeout: 30_000 })
            await sleep(1500)
            // The «Уведомления на iPhone» tip, dismissed once (kept in localStorage).
            await page.getByLabel('Скрыть').click({ timeout: 3000 }).catch(() => {})
        }
        return await ctx.storageState()
    } finally {
        await ctx.close()
    }
}

async function expectSoon(fn, attempts = 4) {
    for (let i = 1; ; i++) {
        try {
            return await fn()
        } catch (e) {
            if (i >= attempts) throw e
            await sleep(1000)
        }
    }
}

export class Recorder {
    static async open({ id, kind, storageState }) {
        const dir = join(config.workDir, id, 'raw')
        rmSync(dir, { recursive: true, force: true })
        mkdirSync(dir, { recursive: true })
        const b = await getBrowser()
        const context = await b.newContext({
            ...contextOptions(kind),
            storageState,
            recordVideo: { dir, size: videoSize(kind) },
        })
        await context.addInitScript(cursorScript(kind))
        const page = await context.newPage()
        const rec = new Recorder(kind, context, page)
        rec.failureShot = join(config.workDir, id, 'failure.png')
        unfinished.add(rec)
        return rec
    }

    constructor(kind, context, page) {
        this.kind = kind
        this.context = context
        this.page = page
        this.t0 = Date.now()
        this.start = 0
        this.cues = []
        this.cuts = []
        this.pos = kind === 'phone' ? { x: 195, y: 600 } : { x: 900, y: 520 }
    }

    now() {
        return (Date.now() - this.t0) / 1000
    }

    // Marks where the guide begins: everything before (loading, setup) is trimmed.
    begin() {
        this.start = this.now()
    }

    // The poster shows this moment (default: the middle of the guide).
    markPoster() {
        this.posterAt = this.now()
    }

    pause(ms) {
        return sleep(ms)
    }

    // A caption, shown from now until the next one; waits long enough to read
    // before the next action starts. `top`: at the top of the frame, for steps
    // at the bottom of the page (desktop captions sit at the bottom).
    async say(text, { hold, top = false } = {}) {
        this.cues.push({ at: this.now(), text, top })
        await sleep(hold ?? Math.min(3600, Math.max(1500, text.length * 42)))
    }

    // Runs `fn` off camera: the interval is cut from the video (sign-in steps,
    // waiting for processing, setup navigation).
    async offCamera(fn) {
        const from = this.now()
        try {
            return await fn()
        } finally {
            this.cuts.push({ from, to: this.now() })
        }
    }

    async goto(url, { waitFor } = {}) {
        await this.page.goto(url)
        if (waitFor) await waitFor.waitFor({ timeout: 30_000 })
    }

    // Glides the pointer to the middle of `locator` (an ease-out path, about
    // half a second), so the viewer sees where the click lands.
    async moveTo(locator) {
        await locator.waitFor({ state: 'visible', timeout: 30_000 })
        await locator.scrollIntoViewIfNeeded()
        const box = await locator.boundingBox()
        if (!box) throw new Error(`No box for ${locator}`)
        const to = { x: box.x + box.width / 2, y: box.y + Math.min(box.height / 2, 22) }
        const dist = Math.hypot(to.x - this.pos.x, to.y - this.pos.y)
        const steps = Math.max(8, Math.min(32, Math.round(dist / 25)))
        if (this.kind === 'phone') {
            await this.page.mouse.move(to.x, to.y)
        } else {
            for (let i = 1; i <= steps; i++) {
                const k = 1 - (1 - i / steps) ** 3
                await this.page.mouse.move(this.pos.x + (to.x - this.pos.x) * k, this.pos.y + (to.y - this.pos.y) * k)
                await sleep(16)
            }
        }
        this.pos = to
        return to
    }

    // Glides there, then lets Playwright click the element itself: a list that
    // scrolled meanwhile (long selects) cannot make the click land elsewhere.
    async click(locator, { after = 900, before = 250 } = {}) {
        await this.moveTo(locator)
        await sleep(before)
        const box = await locator.boundingBox()
        await locator.click()
        if (box) this.pos = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
        await sleep(after)
    }

    // Clicks the field and types like a person (about 14 characters a second).
    async type(locator, text, { clear = true, delay = 70, after = 500 } = {}) {
        await this.click(locator, { after: 200 })
        if (clear) await locator.fill('')
        await locator.pressSequentially(text, { delay })
        await sleep(after)
    }

    async select(locator, option, { after = 700 } = {}) {
        await this.moveTo(locator)
        await sleep(250)
        await locator.selectOption(option)
        await sleep(after)
    }

    async scroll(dy, { after = 600 } = {}) {
        const step = dy / 12
        for (let i = 0; i < 12; i++) {
            await this.page.mouse.wheel(0, step)
            await sleep(25)
        }
        await sleep(after)
    }

    // Drags `from` onto the middle of `to` with the button held (sortable lists).
    async drag(from, to, { after = 900 } = {}) {
        await this.moveTo(from)
        await sleep(300)
        await this.page.mouse.down()
        const box = await to.boundingBox()
        if (!box) throw new Error(`No box for ${to}`)
        const start = this.pos
        const target = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
        for (let i = 1; i <= 30; i++) {
            const k = 1 - (1 - i / 30) ** 3
            await this.page.mouse.move(start.x + (target.x - start.x) * k, start.y + (target.y - start.y) * k)
            await sleep(20)
        }
        await sleep(300)
        await this.page.mouse.up()
        this.pos = target
        await sleep(after)
    }

    // Ends the recording; returns the raw video and the timeline.
    async finish() {
        const end = this.now()
        const video = this.page.video()
        unfinished.delete(this)
        await this.context.close()
        return {
            kind: this.kind,
            video: await video.path(),
            timeline: { start: this.start, end, cuts: this.cuts },
            cues: this.cues,
            posterAt: this.posterAt,
        }
    }
}
