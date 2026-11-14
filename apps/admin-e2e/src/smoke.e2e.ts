import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

import {
  ACCESS_DENIED_TEXT,
  ERROR_SCREEN_TEXTS,
  LOADER_SELECTOR,
  LOADER_TEXT,
  findBadText,
  isAllowedConsoleError,
  isExpected4xx,
  type HttpContext,
} from './checks'
import { env } from './env'
import { ROLE_MATRIX } from './role-matrix'

// Detail pages, opened with the first id of the list behind them. The list is
// read with the role's own token, so the id is one the role can actually see;
// a detail route is visited only when its parent section is in the sidebar.
const DETAIL_ROUTES: readonly {
  parent: string
  route: string
  list: (workspaceId: string) => string
  idField?: string
}[] = [
  { parent: 'users', route: 'users', list: (ws) => `/workspaces/${ws}/members?curPage=1&perPage=1`, idField: 'userId' },
  { parent: 'groups', route: 'groups', list: (ws) => `/workspaces/${ws}/groups` },
  { parent: 'groups', route: 'gyms', list: (ws) => `/workspaces/${ws}/gyms` },
  { parent: 'content', route: 'content/courses', list: (ws) => `/workspaces/${ws}/playlists?curPage=1&perPage=1` },
  { parent: 'content', route: 'videos', list: (ws) => `/admin/videos?workspaceId=${ws}&curPage=1&perPage=1` },
  { parent: 'gradings', route: 'gradings', list: (ws) => `/workspaces/${ws}/rank-gradings` },
  { parent: 'subscriptions', route: 'subscriptions/plans', list: (ws) => `/workspaces/${ws}/plans` },
]

type Problem = { route: string; kind: string; detail: string }

type Watch = {
  problems: Problem[]
  report: (kind: string, detail: string) => void
  // Route (and HTTP rules) the following events belong to.
  at: (route: string, context?: HttpContext) => void
  readonly inFlight: number
}

// Collects everything that goes wrong on the page, tagged with the route being
// checked. Also counts in-flight API requests so a visit can wait for quiet.
const watchPage = (page: Page): Watch => {
  const problems: Problem[] = []
  let route = '/sign-in'
  let context: HttpContext = 'page'
  let inFlight = 0
  const ours = (url: string) => url.startsWith(env.apiUrl) || url.startsWith(env.baseUrl)
  // The realtime socket's long-poll stays open by design.
  const tracked = (url: string) => url.startsWith(env.apiUrl) && !url.includes('/socket.io/')
  const report = (kind: string, detail: string) => {
    problems.push({ route, kind, detail })
  }

  page.on('request', (req) => {
    if (tracked(req.url())) inFlight++
  })
  page.on('requestfinished', (req) => {
    if (tracked(req.url())) inFlight--
  })
  page.on('requestfailed', (req) => {
    if (tracked(req.url())) inFlight--
    const failure = req.failure()?.errorText ?? ''
    // Cancelled by the next navigation — not a failure of the page.
    if (failure.includes('ERR_ABORTED')) return
    report('request failed', `${req.method()} ${req.url()} ${failure}`)
  })
  page.on('response', (res) => {
    if (!ours(res.url())) return
    const status = res.status()
    if (status >= 500 || (status >= 400 && !isExpected4xx(status, context, res.url()))) {
      report(`HTTP ${status}`, `${res.request().method()} ${res.url()}`)
    }
  })
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return
    const text = msg.text()
    // The browser echoes every failed response as a console error; our own
    // origins' responses are judged above, with the expected-4xx rules.
    if (text.startsWith('Failed to load resource') && ours(msg.location().url)) return
    if (isAllowedConsoleError(text)) return
    report('console error', text.slice(0, 500))
  })
  page.on('pageerror', (error) => report('page error', error.message))

  return {
    problems,
    report,
    at(nextRoute: string, nextContext: HttpContext = 'page') {
      route = nextRoute
      context = nextContext
    },
    get inFlight() {
      return inFlight
    },
  }
}

// Runs in the browser: visible loaders (skeletons, spinners, «Загрузка…»)
// outside the sidebar, whose labels are navigation, not page state.
const findLoaders = ({ selector, text }: { selector: string; text: string }): string[] => {
  const loaderText = new RegExp(text)
  const shown = (el: Element | null) => {
    if (!el || el.closest('[data-sidebar]')) return false
    const box = el.getBoundingClientRect()
    return box.width > 0 && box.height > 0 && getComputedStyle(el).visibility !== 'hidden'
  }
  const found: string[] = []
  document.querySelectorAll(selector).forEach((el) => {
    if (shown(el)) found.push(`<${el.tagName.toLowerCase()} class="${el.getAttribute('class') ?? ''}">`)
  })
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const value = node.textContent?.trim() ?? ''
    if (value && loaderText.test(value) && shown(node.parentElement)) found.push(`«${value}»`)
  }
  return found
}

// Waits until no API request is in flight and no loader is visible for 500ms.
// Returns what was still loading when env.stuckMs ran out (empty = settled).
const settle = async (page: Page, watch: Watch): Promise<string[]> => {
  const deadline = Date.now() + env.stuckMs
  let quietSince = 0
  let loaders: string[] = []
  while (Date.now() < deadline) {
    loaders = await page
      .evaluate(findLoaders, { selector: LOADER_SELECTOR, text: LOADER_TEXT.source })
      .catch(() => ['(page was navigating)'])
    if (watch.inFlight <= 0 && loaders.length === 0) {
      if (!quietSince) quietSince = Date.now()
      else if (Date.now() - quietSince >= 500) return []
    } else {
      quietSince = 0
    }
    await page.waitForTimeout(150)
  }
  return loaders.length > 0 ? loaders : [`${watch.inFlight} API request(s) still pending`]
}

// Error boundary, not-found page, and value leaks in the rendered text.
const inspectText = async (page: Page, watch: Watch): Promise<string> => {
  const text = await page.locator('body').innerText()
  for (const screen of ERROR_SCREEN_TEXTS) {
    if (text.includes(screen)) watch.report('error screen', screen)
  }
  for (const leak of findBadText(text)) watch.report('bad text', leak)
  return text
}

const signInThroughUi = async (page: Page, email: string): Promise<string> => {
  await page.goto('/sign-in')
  await page.waitForLoadState('networkidle')
  // Retried as a unit: a fill that lands before hydration is wiped by React.
  await expect(async () => {
    await page.locator('#email').fill(email)
    await page.getByRole('button', { name: 'Получить код' }).click()
    await expect(page.locator('#code')).toBeVisible({ timeout: 5_000 })
  }).toPass({ timeout: 30_000 })
  await page.locator('#code').fill(env.demoLoginCode)
  await page.getByRole('button', { name: 'Войти' }).click()
  await page.waitForURL(/\/workspace\/[0-9a-f-]{36}(\/|$)/, { timeout: 30_000 })
  const match = /\/workspace\/([0-9a-f-]{36})/.exec(page.url())
  if (!match) throw new Error(`no club in the post-sign-in URL ${page.url()}`)
  return match[1]
}

// A separate API session, only to read ids for the detail routes.
const apiToken = async (request: APIRequestContext, email: string): Promise<string> => {
  await request.post(`${env.apiUrl}/send-auth-code`, { data: { email, language: 'RU' } })
  const res = await request.post(`${env.apiUrl}/sign-in`, {
    data: { email, code: env.demoLoginCode },
  })
  expect(res.ok(), `API sign-in for ${email}: HTTP ${res.status()}`).toBe(true)
  return (await res.json()).accessToken
}

const detailRoutes = async (
  request: APIRequestContext,
  token: string,
  workspaceId: string,
  visible: readonly string[],
): Promise<string[]> => {
  const routes: string[] = []
  for (const detail of DETAIL_ROUTES) {
    if (!visible.includes(detail.parent)) continue
    const res = await request.get(`${env.apiUrl}${detail.list(workspaceId)}`, {
      headers: { authorization: `Bearer ${token}` },
    })
    // A refused list surfaces on the parent page visit as an HTTP problem.
    if (!res.ok()) continue
    const first = (await res.json()).data?.[0]
    const id = first?.[detail.idField ?? 'id']
    if (typeof id === 'string') routes.push(`${detail.route}/${id}`)
  }
  return routes
}

// Workspace-relative paths of every link in the rendered sidebar.
const sidebarRoutes = async (page: Page, base: string): Promise<string[]> => {
  const hrefs = await page
    .locator('[data-sidebar="sidebar"] a[href]')
    .evaluateAll((links) => links.map((a) => a.getAttribute('href') ?? ''))
  return [
    ...new Set(
      hrefs
        .filter((href) => href === base || href.startsWith(`${base}/`))
        .map((href) => href.slice(base.length).replace(/^\//, '')),
    ),
  ]
}

const visit = async (page: Page, watch: Watch, base: string, route: string) => {
  watch.at(`/${route}`)
  await page.goto(route ? `${base}/${route}` : base, { waitUntil: 'domcontentloaded' })
  for (const loader of await settle(page, watch)) watch.report('stuck loader', loader)
  if (new URL(page.url()).pathname.startsWith('/sign-in')) watch.report('session lost', page.url())
  // A link the role is then refused: the sidebar must not offer it at all.
  if (ACCESS_DENIED_TEXT.test(await inspectText(page, watch))) {
    watch.report('linked but denied', 'the page shows the access-denied notice')
  }
}

const expectBlocked = async (page: Page, watch: Watch, base: string, route: string) => {
  watch.at(`/${route} (must be blocked)`, 'blocked')
  const target = `${base}/${route}`
  await page.goto(target, { waitUntil: 'domcontentloaded' })
  for (const loader of await settle(page, watch)) watch.report('stuck loader', loader)
  const path = new URL(page.url()).pathname
  if (path.startsWith('/sign-in')) {
    watch.report('session lost', page.url())
    return
  }
  const text = await inspectText(page, watch)
  const redirected = path !== target && !path.startsWith(`${target}/`)
  if (!redirected && !ACCESS_DENIED_TEXT.test(text)) {
    watch.report('not blocked', 'the page rendered without an access-denied notice or redirect')
  }
}

for (const roleCase of ROLE_MATRIX) {
  test(`${roleCase.role} (${roleCase.email}): offered routes render clean, forbidden ones are blocked`, async ({
    page,
    request,
  }) => {
    expect(env.demoLoginCode, 'DEMO_LOGIN_CODE (env or the repo .env)').toMatch(/^\d{6}$/)
    const token = await apiToken(request, roleCase.email)

    const watch = watchPage(page)
    const workspaceId = await signInThroughUi(page, roleCase.email)
    const base = `/workspace/${workspaceId}`
    watch.at('(landing)')
    for (const loader of await settle(page, watch)) watch.report('stuck loader', loader)

    const visible = await sidebarRoutes(page, base)
    expect(visible, 'sidebar links').not.toHaveLength(0)
    const offered = [...roleCase.blocked, ...roleCase.offMenu].filter((route) => visible.includes(route))
    expect.soft(offered, `sidebar of ${roleCase.role} offers routes it must not`).toEqual([])

    const routes = [
      ...visible,
      ...roleCase.offMenu,
      ...roleCase.tabs,
      ...(await detailRoutes(request, token, workspaceId, visible)),
    ]
    for (const route of routes) {
      await test.step(`visit /${route}`, () => visit(page, watch, base, route))
    }
    for (const route of roleCase.blocked) {
      await test.step(`blocked /${route}`, () => expectBlocked(page, watch, base, route))
    }

    await test.info().attach('routes.json', {
      body: JSON.stringify({ sidebar: visible, visited: routes, blocked: roleCase.blocked }, null, 2),
      contentType: 'application/json',
    })
    expect(
      watch.problems.map((p) => `${p.route} — ${p.kind}: ${p.detail}`),
      `${roleCase.role}: ${routes.length} routes visited, ${roleCase.blocked.length} blocked checks`,
    ).toEqual([])
  })
}
