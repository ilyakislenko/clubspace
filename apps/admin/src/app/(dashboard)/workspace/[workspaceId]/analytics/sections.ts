import {
  CalendarClock,
  Repeat,
  TrendingUp,
  UserCheck,
  type LucideIcon,
} from "lucide-react"

import { cap, type ClubVocabulary } from "@clubspace/ui-kit/brand"

import type { Access } from "../../../../../shared/lib/permissions"

type AnalyticsSection = {
  key: string
  label: string
  title: string
  description: string
  icon: LucideIcon
  path: string
  // Who sees the section (sidebar + overview card); matches the server tier.
  access: Access
}

// «Аналитика» sub-pages: the sidebar group and the overview cards read the
// same list, filtered by `access`; the server scopes the numbers. The
// coaches page is named in the club's words («Тренеры» or «Педагоги»).
// «Кому позвонить» is a daily page of its own (/retention).
export const analyticsSections = (
  vocabulary: ClubVocabulary,
): AnalyticsSection[] => [
  {
    key: "analytics-cohorts",
    label: "Удержание",
    title: "Удержание по когортам",
    description:
      "Сколько новичков каждого месяца ходят через 1, 2, 3 и 6 месяцев.",
    icon: Repeat,
    path: "cohorts",
    access: "lead",
  },
  {
    key: "analytics-occupancy",
    label: "Загрузка расписания",
    title: "Загрузка расписания",
    description:
      "Тепловая карта залов, слабые и сильные слоты и что поменять в расписании.",
    icon: CalendarClock,
    path: "occupancy",
    access: "lead",
  },
  {
    key: "analytics-coaches",
    label: cap(vocabulary.coach.nomPl),
    title: cap(vocabulary.coach.nomPl),
    description: `Активные ученики, удержание, продления и посещаемость по каждому ${vocabulary.coach.dat}.`,
    icon: UserCheck,
    path: "coaches",
    access: "sportLead",
  },
  {
    key: "analytics-forecast",
    label: "Прогноз",
    title: "Прогноз выручки",
    description:
      "Ожидаемые продления на 30 и 90 дней, риск потерь и конверсия пробных.",
    icon: TrendingUp,
    path: "forecast",
    access: "clubAdmin",
  },
]
