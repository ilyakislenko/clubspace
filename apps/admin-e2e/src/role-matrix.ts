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
// `tabs`: tabs of a sidebar page opened by URL (?tab=…); visited and checked
//   like any other page (a refused list behind the tab fails the visit).
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
  'subscriptions/payments',
  'settings',
  ...SETTINGS_SECTIONS,
  'club-import',
  'analytics/forecast',
  'analytics/export',
] as const

const CLUB_ADMIN_OFF_MENU = ['billing', 'club-import', ...SETTINGS_SECTIONS] as const

// «Удержание → Продлить» (renewals and unpaid abonements): sport leads.
const RENEW_TAB = 'retention?tab=renew'

export const ROLE_MATRIX: readonly RoleCase[] = [
  { role: 'owner', email: 'owner@academy.demo', blocked: [], offMenu: CLUB_ADMIN_OFF_MENU, tabs: [RENEW_TAB] },
  { role: 'admin', email: 'admin@academy.demo', blocked: [], offMenu: CLUB_ADMIN_OFF_MENU, tabs: [RENEW_TAB] },
  {
    role: 'head_coach',
    email: 'coach@academy.demo',
    blocked: CLUB_ADMIN_ONLY,
    offMenu: [],
    tabs: [RENEW_TAB],
  },
  {
    // Sidebar: Сегодня, Расписание, Ученики, Удержание (no «Отчёты»: every
    // report is a lead's).
    role: 'coach',
    email: 'pedagog@ritm.demo',
    blocked: [
      ...CLUB_ADMIN_ONLY,
      // Sport leads only (SportLeadGate / LeadGate); /analytics forwards to
      // the first report the role may open, a plain coach has none.
      'analytics',
      'analytics/coaches',
      'ai-assistant',
      'ranks',
      'announcements',
    ],
    offMenu: ['groups', 'content', 'events', 'analytics/cohorts', 'analytics/occupancy'],
    tabs: [],
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
]
