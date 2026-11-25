import { cap, type ClubVocabulary } from "@clubspace/ui-kit/brand"

import type { SectionTab } from "../../../../shared/workspace/section-tabs"

// Sidebar sections that span several routes, shown as a tab row under the
// section title. The sidebar item opens the first tab the role may see, and
// stays lit on every tab. Each tab's `access` matches its route's gate.

// «Ученики»: the roster, the requests waiting for the viewer's decision, the
// messages sent to students (the server scopes each to what the role may see,
// decide and write) and the trial requests from people not yet in the club —
// strangers' phones, so sport leads only (docs/design/2026-11-26-leads.md §4.1).
export const memberTabs: SectionTab[] = [
  {
    key: "users",
    label: "Список",
    path: "users",
    access: "staff",
  },
  {
    key: "users-requests",
    label: "Заявки",
    path: "users/requests",
    access: "staff",
  },
  {
    key: "users-messages",
    label: "Сообщения",
    path: "users/messages",
    access: "staff",
  },
  {
    key: "users-trials",
    label: "Пробные",
    path: "users/trials",
    access: "sportLead",
  },
]

// «Отчёты»: the server scopes the numbers (coaches see their groups).
export const reportTabs = (vocabulary: ClubVocabulary): SectionTab[] => [
  {
    key: "analytics-forecast",
    label: "Выручка и прогноз",
    path: "analytics/forecast",
    access: "clubAdmin",
  },
  {
    key: "analytics-occupancy",
    label: "Загрузка залов",
    path: "analytics/occupancy",
    access: "lead",
  },
  {
    key: "analytics-coaches",
    label: cap(vocabulary.coach.nomPl),
    path: "analytics/coaches",
    access: "sportLead",
  },
  {
    // What each coach earned: money, so club admins only (a head coach would
    // see colleagues' pay).
    key: "analytics-payroll",
    label: "Выплаты",
    path: "analytics/payroll",
    access: "clubAdmin",
  },
  {
    key: "analytics-cohorts",
    label: "Когорты новичков",
    path: "analytics/cohorts",
    access: "lead",
  },
  {
    // Trial requests → bought, by source (the «Пробные» tab's viewers).
    key: "analytics-trials",
    label: "Пробные",
    path: "analytics/trials",
    access: "sportLead",
  },
  {
    key: "analytics-export",
    label: "Выгрузка",
    path: "analytics/export",
    access: "clubAdmin",
  },
  {
    // Sport leads and direction managers; money tools stay the club admins'.
    key: "ai-assistant",
    label: "Спросить ИИ",
    path: "ai-assistant",
    access: "lead",
  },
]

// «Абонементы»: tariffs, discounts and the payments journal, all money.
export const subscriptionTabs: SectionTab[] = [
  {
    key: "subscriptions",
    label: "Тарифы",
    path: "subscriptions",
    access: "clubAdmin",
  },
  {
    key: "subscriptions-discounts",
    label: "Скидки",
    path: "subscriptions/discounts",
    access: "clubAdmin",
  },
  {
    key: "subscriptions-payments",
    label: "Платежи",
    path: "subscriptions/payments",
    access: "clubAdmin",
  },
]

// «Пояса»: gradings first (readiness is every lead's daily view).
export const beltTabs: SectionTab[] = [
  {
    key: "gradings",
    label: "Аттестации",
    path: "gradings",
    access: "lead",
    feature: "ranks",
  },
  {
    key: "ranks",
    label: "Лестницы",
    path: "ranks",
    access: "lead",
    feature: "ranks",
  },
]

// «Новости и события».
export const newsTabs: SectionTab[] = [
  {
    key: "announcements",
    label: "Объявления",
    path: "announcements",
    access: "lead",
  },
  {
    key: "events",
    label: "События",
    path: "events",
    access: "lead",
  },
]
