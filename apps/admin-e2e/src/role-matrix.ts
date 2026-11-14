// Who signs in, and what each role must NOT be offered. Edit this table when a
// role rule changes; the suite derives everything else (visible routes come
// from the rendered sidebar, ids from the API).
//
// Routes are relative to /workspace/<id>/.
// `blocked`: absent from the sidebar AND refused when opened by URL
//   (redirected away, or the access-denied notice instead of the page).
// `offMenu`: absent from the sidebar, but the role may still open it (the
//   server allows it; the menu just doesn't offer it). Visited and checked like
//   any other page.
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

// Money and system settings, tariffs included: owner/admin only
// (ClubAdminGate).
const CLUB_ADMIN_ONLY = [
  'billing',
  'payments',
  'subscriptions',
  'settings',
  'directions',
  'club-import',
  'public-page',
  'integrations',
  'audit',
  'analytics/forecast',
] as const

// «Кому позвонить → Продлить» (renewals and unpaid abonements): sport leads.
const RENEW_TAB = 'retention?tab=renew'

export const ROLE_MATRIX: readonly RoleCase[] = [
  { role: 'owner', email: 'owner@academy.demo', blocked: [], offMenu: [], tabs: [RENEW_TAB] },
  { role: 'admin', email: 'admin@academy.demo', blocked: [], offMenu: [], tabs: [RENEW_TAB] },
  {
    role: 'head_coach',
    email: 'coach@academy.demo',
    blocked: CLUB_ADMIN_ONLY,
    offMenu: [],
    tabs: [RENEW_TAB],
  },
  {
    // Sidebar: Обзор, Кому позвонить, Участники, Расписание (no «Аналитика»
    // group: every analytics page is a lead's).
    role: 'coach',
    email: 'pedagog@ritm.demo',
    blocked: [
      ...CLUB_ADMIN_ONLY,
      // Sport leads only (SportLeadGate / LeadGate).
      'analytics/coaches',
      'ai-assistant',
      'ranks',
      'announcements',
    ],
    offMenu: ['groups', 'content', 'events', 'analytics/cohorts', 'analytics/occupancy'],
    tabs: [],
  },
]
