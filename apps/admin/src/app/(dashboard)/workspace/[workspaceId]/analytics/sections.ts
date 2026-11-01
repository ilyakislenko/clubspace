import {
  CalendarClock,
  PhoneCall,
  Repeat,
  TrendingUp,
  UserCheck,
} from "lucide-react"

// «Аналитика» sub-pages: the sidebar group and the overview cards read the
// same list. Every staff role sees them; the server scopes the numbers.
export const ANALYTICS_SECTIONS = [
  {
    key: "analytics-churn",
    label: "Кому позвонить",
    title: "Кому позвонить сегодня",
    description:
      "Ученики с риском ухода, причины и сколько денег на кону. Отметьте звонок — список обновится.",
    icon: PhoneCall,
    path: "churn",
  },
  {
    key: "analytics-cohorts",
    label: "Удержание",
    title: "Удержание по когортам",
    description:
      "Сколько новичков каждого месяца ходят через 1, 2, 3 и 6 месяцев.",
    icon: Repeat,
    path: "cohorts",
  },
  {
    key: "analytics-occupancy",
    label: "Загрузка расписания",
    title: "Загрузка расписания",
    description:
      "Тепловая карта залов, слабые и сильные слоты и что поменять в расписании.",
    icon: CalendarClock,
    path: "occupancy",
  },
  {
    key: "analytics-coaches",
    label: "Тренеры",
    title: "Тренеры",
    description:
      "Активные ученики, удержание, продления и посещаемость по каждому тренеру.",
    icon: UserCheck,
    path: "coaches",
  },
  {
    key: "analytics-forecast",
    label: "Прогноз",
    title: "Прогноз выручки",
    description:
      "Ожидаемые продления на 30 и 90 дней, риск потерь и конверсия пробных.",
    icon: TrendingUp,
    path: "forecast",
  },
]
