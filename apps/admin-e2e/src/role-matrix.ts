// Who signs in, and what each role must NOT be offered. Edit this table when a
// role rule changes; the suite derives everything else (visible routes come
// from the rendered sidebar and the section tab rows, ids from the API).
//
// Routes are relative to /workspace/<id>/.
// `blocked`: absent from the sidebar AND refused when opened by URL
//   (redirected away, or the access-denied notice instead of the page).
// `offMenu`: absent from the sidebar, but the role may still open it (the
//   server allows it; the menu just doesn't offer it, or offers it outside the
//   sidebar list: the account menu, the settings section list). Visited and
//   checked like any other page.
// `tabs`: tabs or filtered views of a page opened by URL (?tab=…, ?kind=…);
//   visited and checked like any other page (a refused list behind the tab
//   fails the visit).
//
// Matrix: docs/design/2026-11-08-admin-cleanup.md §1. Owner and admin see
// everything; a club without a section (ranks off in «Ритм») hides it for
// everyone, so feature-gated routes are not listed here.

export type RoleName = 'owner' | 'admin' | 'head_coach' | 'coach'

export type RoleCase = {
  role: RoleName
  email: string
  blocked: readonly string[]
  offMenu: readonly string[]
  tabs: readonly string[]
}

// «Настройки» sections: the sidebar links only the first one.
const SETTINGS_SECTIONS = [
  'settings/directions',
  'settings/access',
  'settings/app',
  'settings/payments',
  'settings/integrations',
  'settings/notifications',
  'settings/audit',
] as const

// Money and system: owner/admin only (ClubAdminGate). «Подписка ClubSpace»
// (billing) sits in the account menu.
const CLUB_ADMIN_ONLY = [
  'billing',
  'subscriptions',
  'subscriptions/discounts',
  'subscriptions/payments',
  'settings',
  ...SETTINGS_SECTIONS,
  'club-import',
  'analytics/forecast',
  'analytics/payroll',
  'analytics/export',
] as const

const CLUB_ADMIN_OFF_MENU = ['billing', 'club-import', ...SETTINGS_SECTIONS] as const

// «Удержание → Продлить» (renewals and unpaid abonements): sport leads.
const RENEW_TAB = 'retention?tab=renew'

// «Ученики → Заявки» (every role; the tab itself is crawled from the section
// tab row) filtered to one kind — where the «Сегодня» row leads when only one
// kind waits. A kind the role has no requests of falls back to the whole list.
const REQUESTS_KIND_TAB = 'users/requests?kind=freeze'

// «Ученики → Сообщения» (every role; the list is crawled from the tab row)
// with the compose panel open: its live preview asks the server with the
// role's segment, so a refused segment fails the visit. «Не оплатили» is the
// sport leads' (the roster's «Должники → Написать этим ученикам»).
const COMPOSE_TAB = 'users/messages?compose=1'
const COMPOSE_UNPAID_TAB = 'users/messages?compose=1&segment=UNPAID'

// «Ученики → Пробные» (sport leads; the tab is crawled from the tab row) on
// a view other than the default «Нужно действие» — anonymised rows show here.
const TRIALS_VIEW_TAB = 'users/trials?view=all'

export const ROLE_MATRIX: readonly RoleCase[] = [
  {
    role: 'owner',
    email: 'owner@academy.demo',
    blocked: [],
    offMenu: CLUB_ADMIN_OFF_MENU,
    tabs: [RENEW_TAB, REQUESTS_KIND_TAB, COMPOSE_TAB, COMPOSE_UNPAID_TAB, TRIALS_VIEW_TAB],
  },
  {
    role: 'admin',
    email: 'admin@academy.demo',
    blocked: [],
    offMenu: CLUB_ADMIN_OFF_MENU,
    tabs: [RENEW_TAB, REQUESTS_KIND_TAB, COMPOSE_TAB, COMPOSE_UNPAID_TAB, TRIALS_VIEW_TAB],
  },
  {
    role: 'head_coach',
    email: 'coach@academy.demo',
    blocked: CLUB_ADMIN_ONLY,
    offMenu: [],
    tabs: [RENEW_TAB, REQUESTS_KIND_TAB, COMPOSE_TAB, COMPOSE_UNPAID_TAB, TRIALS_VIEW_TAB],
  },
  {
    // Sidebar: Сегодня, Расписание, Ученики (Список · Заявки · Сообщения),
    // Удержание (no «Отчёты»: every report is a lead's).
    role: 'coach',
    email: 'pedagog@ritm.demo',
    blocked: [
      ...CLUB_ADMIN_ONLY,
      // Sport leads only (SportLeadGate / LeadGate); /analytics forwards to
      // the first report the role may open, a plain coach has none.
      'analytics',
      'analytics/coaches',
      // «Пробные»: strangers' phones and their funnel (SportLeadGate).
      'users/trials',
      'analytics/trials',
      'ai-assistant',
      'ranks',
      'announcements',
    ],
    offMenu: ['groups', 'content', 'events', 'analytics/cohorts', 'analytics/occupancy'],
    tabs: [REQUESTS_KIND_TAB, COMPOSE_TAB],
  },
]

// Moved admin routes: opening the old URL (with its query) lands on the new
// one. Checked as the owner, who may open every target.
export const LEGACY_REDIRECTS: readonly { from: string; to: string }[] = [
  { from: 'payments', to: 'settings/payments' },
  { from: 'public-page?from=e2e', to: 'settings' },
  { from: 'achievements', to: 'settings/app' },
  { from: 'integrations', to: 'settings/integrations' },
  { from: 'audit', to: 'settings/audit' },
  { from: 'directions', to: 'settings/directions' },
  { from: 'analytics', to: 'analytics/forecast' },
  { from: 'analytics/churn', to: 'retention' },
  { from: 'videos', to: 'content' },
]
