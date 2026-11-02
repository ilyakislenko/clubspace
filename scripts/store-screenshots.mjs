#!/usr/bin/env node
// Store screenshots of the member app (PWA build) for Google Play, RuStore and
// the App Store, in every size the stores take, plus captioned copies and a
// draft Google Play feature graphic. Drives a headless Chrome over the DevTools
// protocol — no npm dependencies.
//
//   node scripts/store-screenshots.mjs --out ~/Desktop/store-shots \
//       [--app http://localhost:4201] [--code 304682] [--tz Asia/Tomsk] \
//       [--attendance <slotId>/<YYYY-MM-DD>] [--only gp-phone,ios-6.9]
//
// Needs a demo club (SEED_DEMO_WORKSPACE + DEMO_MODE): signs in as
// student@ / coach@ / parent@academy.demo with the demo code. The pages run
// read-only: every API write except sign-in is answered locally with 503, so
// nothing is booked, marked or watched on the stand. `--attendance` names an
// attendance session that already exists (the coach screen «Посещаемость»
// creates one when it is missing); without it that frame is skipped.
// What each size is for and which copy to upload: docs/store/README.md.

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const HERE = dirname(fileURLToPath(import.meta.url))
const TEMPLATES = join(HERE, '..', 'docs', 'store', 'screenshots')

const { values: args } = parseArgs({
    options: {
        app: { type: 'string', default: 'http://localhost:4201' },
        out: { type: 'string' },
        code: { type: 'string', default: process.env.DEMO_LOGIN_CODE || '304682' },
        tz: { type: 'string', default: 'Asia/Tomsk' },
        attendance: { type: 'string' },
        course: { type: 'string', default: 'база белого пояса' },
        only: { type: 'string' },
        chrome: {
            type: 'string',
            default: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        },
    },
})
if (!args.out) {
    console.error('Укажите папку: --out <путь>')
    process.exit(1)
}
const OUT = resolve(args.out.replace(/^~/, homedir()))
const APP = args.app.replace(/\/$/, '')

// Output sizes. `css` × `dpr` = the exact pixel size the store asks for.
// Sources: docs/store/README.md («Размеры»).
const SIZES = [
    { key: 'gp-phone', dir: 'google-play/телефон', w: 360, h: 640, dpr: 3, mobile: true },
    { key: 'gp-tablet-7', dir: 'google-play/планшет-7', w: 612, h: 1088, dpr: 2, mobile: true },
    { key: 'gp-tablet-10', dir: 'google-play/планшет-10', w: 1280, h: 720, dpr: 2, mobile: false },
    { key: 'rustore-phone', dir: 'rustore/телефон', w: 360, h: 640, dpr: 3, mobile: true },
    { key: 'rustore-tablet', dir: 'rustore/планшет', w: 1280, h: 720, dpr: 1.5, mobile: false },
    { key: 'ios-6.9', dir: 'app-store/iphone-6.9', w: 440, h: 956, dpr: 3, mobile: true },
    { key: 'ios-6.5', dir: 'app-store/iphone-6.5', w: 428, h: 926, dpr: 3, mobile: true },
    { key: 'ios-6.3', dir: 'app-store/iphone-6.3', w: 402, h: 874, dpr: 3, mobile: true },
    { key: 'ipad-13', dir: 'app-store/ipad-13', w: 1032, h: 1376, dpr: 2, mobile: false },
]

// Frames in listing order. `prep` runs after the page settled.
const SCENES = [
    {
        file: '01-главная',
        as: 'student',
        path: '/',
        wait: 'Ближайшая',
        prep: hideBanner,
        caption: 'Ближайшая тренировка, абонемент и новости клуба',
    },
    {
        file: '02-расписание',
        as: 'student',
        path: '/schedule',
        wait: 'Сегодня',
        prep: (p) => clickByLabel(p, /^Все залы$/),
        caption: 'Расписание всех залов и групп',
    },
    {
        file: '03-запись',
        as: 'student',
        path: '/schedule',
        wait: 'Сегодня',
        prep: (p) => clickByLabel(p, /^(Сегодня|Завтра) в \d/),
        caption: 'Запись на занятие в пару касаний',
    },
    {
        file: '04-абонемент',
        as: 'student',
        path: '/subscription',
        wait: 'Осталось',
        caption: 'Сколько занятий осталось и до какого числа',
    },
    {
        file: '05-прогресс',
        as: 'student',
        path: '/progress',
        wait: 'ПОСЕЩАЕМОСТЬ',
        caption: 'Посещаемость, пояса и стаж',
    },
    {
        file: '06-видео',
        as: 'student',
        path: '/courses',
        wait: 'Видео',
        prep: openFirstLesson,
        settle: 5000,
        caption: 'Видеоуроки тренера — и без интернета',
    },
    {
        file: '07-тренер-отметка',
        as: 'coach',
        path: args.attendance ? `/attendance/${args.attendance}` : null,
        wait: 'отмечено',
        caption: 'Тренер отмечает группу за минуту',
    },
    {
        file: '08-родитель-дети',
        as: 'parent',
        path: '/children',
        wait: 'МОИ ДЕТИ',
        caption: 'Родитель ведёт профили детей',
    },
]

const ACCOUNTS = {
    student: 'student@academy.demo',
    coach: 'coach@academy.demo',
    parent: 'parent@academy.demo',
}

// Every API write except signing in is answered locally: browsing the stand
// must not book, mark, save progress or create an attendance session. The one
// exception is opening the --attendance session: the screen POSTs it, and for
// a session that already exists the server returns it without writing.
const ATTENDANCE_SLOT = args.attendance?.split('/')[0] ?? null
const READ_ONLY = `(() => {
    if (window.__readOnly) return
    window.__readOnly = true
    const AUTH = ['send-auth-code', 'sign-in', 'sign-out', 'refresh-token']
    const SLOT = ${JSON.stringify(ATTENDANCE_SLOT)}
    const allowed = (method, url, body) => {
        const m = String(method || 'GET').toUpperCase()
        if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return true
        const path = String(url).split('?')[0]
        const last = path.split('/').pop()
        if (SLOT && m === 'POST' && /\\/attendance\\/sessions$/.test(path)) return String(body).includes(SLOT)
        return AUTH.includes(last) || /^(get|list|search)-/.test(last)
    }
    const fetch0 = window.fetch.bind(window)
    window.fetch = (input, init) => {
        const url = typeof input === 'string' ? input : input && input.url
        const method = (init && init.method) || (input && input.method)
        if (allowed(method, url, init && init.body)) return fetch0(input, init)
        return Promise.resolve(new Response('{}', { status: 503, headers: { 'content-type': 'application/json' } }))
    }
    const open0 = XMLHttpRequest.prototype.open
    const send0 = XMLHttpRequest.prototype.send
    XMLHttpRequest.prototype.open = function (method, url) {
        this.__req = [method, url]
        return open0.apply(this, arguments)
    }
    XMLHttpRequest.prototype.send = function (body) {
        if (this.__req && !allowed(this.__req[0], this.__req[1], body)) return this.abort()
        return send0.apply(this, arguments)
    }
    if (navigator.sendBeacon) navigator.sendBeacon = () => true
})()`

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---- Chrome over CDP -------------------------------------------------------

async function launchChrome() {
    if (!existsSync(args.chrome)) throw new Error(`Нет Chrome: ${args.chrome} (--chrome <путь>)`)
    const profile = mkdtempSync(join(tmpdir(), 'cs-store-shots-'))
    const proc = spawn(
        args.chrome,
        [
            '--headless=new',
            '--remote-debugging-port=0',
            `--user-data-dir=${profile}`,
            '--no-first-run',
            '--no-default-browser-check',
            '--hide-scrollbars',
            '--lang=ru-RU',
            '--autoplay-policy=no-user-gesture-required',
            'about:blank',
        ],
        { stdio: ['ignore', 'ignore', 'pipe'] },
    )
    const wsUrl = await new Promise((ok, fail) => {
        let log = ''
        proc.stderr.on('data', (chunk) => {
            log += chunk
            const m = log.match(/DevTools listening on (ws:\/\/\S+)/)
            if (m) ok(m[1])
        })
        proc.on('exit', () => fail(new Error(`Chrome не запустился:\n${log}`)))
    })
    const port = new URL(wsUrl).port
    const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json()
    const page = await connect(target.webSocketDebuggerUrl)
    page.close = async () => {
        page.ws.close()
        proc.kill()
        await sleep(300)
        rmSync(profile, { recursive: true, force: true })
    }
    return page
}

async function connect(url) {
    const ws = new WebSocket(url)
    await new Promise((ok, fail) => {
        ws.onopen = ok
        ws.onerror = fail
    })
    let seq = 0
    const pending = new Map()
    ws.onmessage = (event) => {
        const msg = JSON.parse(event.data)
        const p = msg.id && pending.get(msg.id)
        if (!p) return
        pending.delete(msg.id)
        if (msg.error) p.fail(new Error(`${p.method}: ${msg.error.message}`))
        else p.ok(msg.result)
    }
    const send = (method, params = {}) =>
        new Promise((ok, fail) => {
            const id = ++seq
            pending.set(id, { ok, fail, method })
            ws.send(JSON.stringify({ id, method, params }))
        })
    return { ws, send }
}

async function evaluate(page, expression) {
    const { result, exceptionDetails } = await page.send('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true,
    })
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text)
    return result.value
}

// Case-insensitive: innerText applies the uppercase section headers.
async function waitForText(page, text, timeout = 15000) {
    const until = Date.now() + timeout
    const needle = JSON.stringify(text.toLowerCase())
    while (Date.now() < until) {
        if (await evaluate(page, `(document.body?.innerText ?? '').toLowerCase().includes(${needle})`)) return
        await sleep(250)
    }
    throw new Error(`Не дождались «${text}» на ${await evaluate(page, 'location.pathname')}`)
}

// Centre of the first visible element whose aria-label (or, without one, its
// text) matches. `withText` matches «aria-label\ntext» — for rows whose label
// is only a title and whose state is in the visible text.
async function findByLabel(page, pattern, withText = false) {
    return evaluate(
        page,
        `(() => {
            const re = new RegExp(${JSON.stringify(pattern.source)})
            const nodes = [...document.querySelectorAll('[role=button],[role=link],button,a,[tabindex]')]
            for (const el of nodes) {
                const aria = el.getAttribute('aria-label') || ''
                const label = ${withText} ? aria + '\\n' + el.innerText : (aria || el.innerText || '').trim()
                if (!re.test(label)) continue
                el.scrollIntoView({ block: 'center' })
                const r = el.getBoundingClientRect()
                if (r.width === 0 || r.height === 0) continue
                return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
            }
            return null
        })()`,
    )
}

async function click(page, { x, y }) {
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
    await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
    await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
}

async function clickByLabel(page, pattern, { optional = false, withText = false } = {}) {
    const at = await findByLabel(page, pattern, withText)
    if (!at) {
        if (optional) return false
        throw new Error(`Нет элемента ${pattern} на ${await evaluate(page, 'location.pathname')}`)
    }
    await sleep(300)
    await click(page, at)
    await sleep(1200)
    return true
}

async function typeInto(page, selector, text) {
    await evaluate(page, `document.querySelector(${JSON.stringify(selector)})?.focus()`)
    await page.send('Input.insertText', { text })
}

async function navigate(page, path) {
    await page.send('Page.navigate', { url: `${APP}${path}` })
    await sleep(1500)
}

// ---- Scenes ----------------------------------------------------------------

async function hideBanner(page) {
    await clickByLabel(page, /^Скрыть$/, { optional: true })
}

async function openFirstLesson(page) {
    await clickByLabel(page, /^Закрыть$/, { optional: true })
    await clickByLabel(page, new RegExp(args.course))
    await waitForText(page, 'Урок')
    // A lesson that is ready and open: its row shows the duration and neither
    // «в обработке» nor a lock.
    await clickByLabel(page, /^(?![\s\S]*(обрабатывается|в обработке|закрыт))[\s\S]*Урок \d+ · \d+:\d\d/, {
        withText: true,
    })
}

async function signIn(page, account) {
    await page.send('Storage.clearDataForOrigin', { origin: new URL(APP).origin, storageTypes: 'all' })
    await navigate(page, '/sign-in')
    await waitForText(page, 'Получить код')
    await typeInto(page, 'input', ACCOUNTS[account])
    await clickByLabel(page, /^Получить код$/)
    await waitForText(page, 'Войти')
    await typeInto(page, 'input[placeholder="000000"]', args.code)
    await clickByLabel(page, /^Войти$/, { optional: true })
    const until = Date.now() + 20000
    while (Date.now() < until) {
        if (!(await evaluate(page, 'location.pathname')).startsWith('/sign-in')) return
        await sleep(300)
    }
    throw new Error(`Не удалось войти как ${ACCOUNTS[account]}`)
}

async function setSize(page, size) {
    await page.send('Emulation.setDeviceMetricsOverride', {
        width: size.w,
        height: size.h,
        deviceScaleFactor: size.dpr,
        mobile: size.mobile,
    })
}

async function capture(page) {
    const { data } = await page.send('Page.captureScreenshot', { format: 'jpeg', quality: 95 })
    return Buffer.from(data, 'base64')
}

// Fills {{KEY}} placeholders of a template in docs/store/screenshots/.
function fillTemplate(name, values) {
    let html = readFileSync(join(TEMPLATES, name), 'utf8')
    for (const [key, value] of Object.entries(values)) html = html.replaceAll(`{{${key}}}`, () => value)
    return html
}

const dataUrl = (jpeg) => `data:image/jpeg;base64,${jpeg.toString('base64')}`

// The captioned copy: the raw frame on a brand background under a caption,
// same pixel size.
async function renderCaption(page, size, raw, caption) {
    const html = fillTemplate('caption.html', {
        CAPTION: caption,
        IMAGE: dataUrl(raw),
        LAYOUT: size.w > size.h ? 'landscape' : 'portrait',
    })
    return renderHtml(page, html)
}

async function renderHtml(page, html) {
    await page.send('Page.navigate', { url: 'about:blank' })
    await sleep(300)
    const { frameTree } = await page.send('Page.getFrameTree')
    await page.send('Page.setDocumentContent', { frameId: frameTree.frame.id, html })
    await evaluate(page, 'Promise.all([...document.images].map((i) => i.decode())).then(() => document.fonts.ready).then(() => true)')
    await sleep(300)
    return capture(page)
}

function save(file, buffer) {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, buffer)
    console.log(`  ${file.slice(OUT.length + 1)}  ${(buffer.length / 1024).toFixed(0)} КБ`)
}

// ---- Run -------------------------------------------------------------------

const only = args.only ? new Set(args.only.split(',')) : null
const sizes = SIZES.filter((s) => !only || only.has(s.key))
const scenes = SCENES.filter((s) => s.path)
if (!args.attendance) console.warn('Без --attendance кадр «тренер: отметка» пропущен.')

const page = await launchChrome()
try {
    await page.send('Page.enable')
    await page.send('Runtime.enable')
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: READ_ONLY })
    await page.send('Emulation.setEmulatedMedia', {
        features: [{ name: 'prefers-color-scheme', value: 'light' }],
    })
    await page.send('Emulation.setTimezoneOverride', { timezoneId: args.tz })
    await page.send('Emulation.setLocaleOverride', { locale: 'ru-RU' })

    // Raw frames: one sign-in per account, every size per scene.
    const raw = new Map()
    let signedInAs = null
    for (const scene of scenes) {
        if (signedInAs !== scene.as) {
            await setSize(page, SIZES[0])
            await signIn(page, scene.as)
            signedInAs = scene.as
        }
        console.log(scene.file)
        for (const size of sizes) {
            await setSize(page, size)
            await navigate(page, scene.path)
            await waitForText(page, scene.wait)
            if (scene.prep) await scene.prep(page)
            await sleep(scene.settle ?? 1500)
            const shot = await capture(page)
            raw.set(`${size.key}/${scene.file}`, shot)
            save(join(OUT, size.dir, 'без-подписи', `${scene.file}.jpg`), shot)
        }
    }

    console.log('подписи')
    for (const size of sizes) {
        await setSize(page, size)
        for (const scene of scenes) {
            const shot = raw.get(`${size.key}/${scene.file}`)
            save(join(OUT, size.dir, 'с-подписью', `${scene.file}.jpg`), await renderCaption(page, size, shot, scene.caption))
        }
    }

    const left = raw.get('gp-phone/02-расписание')
    const right = raw.get('gp-phone/05-прогресс')
    if (left && right) {
        console.log('feature graphic')
        await setSize(page, { w: 1024, h: 500, dpr: 1, mobile: false })
        const html = fillTemplate('feature-graphic.html', { LEFT: dataUrl(left), RIGHT: dataUrl(right) })
        save(join(OUT, 'google-play', 'feature-graphic-1024x500.jpg'), await renderHtml(page, html))
    }
} finally {
    await page.close()
}
