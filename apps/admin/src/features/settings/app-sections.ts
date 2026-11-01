import type { ApiTypes } from "@clubspace/api-client"

// The club's app-section switches: each `feature` is a `${feature}Enabled`
// Boolean on the workspace settings; the mobile app hides the matching block
// when it's off. Shown on the club's settings page and in the platform console.
export type AppSectionFeature = ApiTypes.SetPlatformWorkspaceFeatureInputDto["feature"]

export const APP_SECTIONS: Array<{
  feature: AppSectionFeature
  label: string
  description: string
}> = [
  {
    feature: "announcements",
    label: "Объявления",
    description: "Лента новостей и объявлений клуба.",
  },
  {
    feature: "ranks",
    label: "Ранги",
    description: "Прогресс ученика по поясам/грейдам.",
  },
  {
    feature: "leaderboard",
    label: "Рейтинг посещаемости",
    description: "Таблица учеников по числу тренировок за неделю/месяц.",
  },
  {
    feature: "attendance",
    label: "Посещаемость",
    description: "История посещений ученика.",
  },
  {
    feature: "subscription",
    label: "Абонемент",
    description: "Остаток занятий и статус абонемента.",
  },
  {
    feature: "schedule",
    label: "Расписание",
    description: "Расписание тренировок клуба.",
  },
  {
    feature: "groups",
    label: "Группы и залы",
    description: "Группы ученика и список залов клуба.",
  },
  {
    feature: "events",
    label: "События",
    description: "Семинары, сборы и турниры.",
  },
  {
    feature: "guestVisits",
    label: "Гостевые визиты в другие группы",
    description:
      "Ученики видят расписание всех групп и могут записаться на тренировку другой группы. Занятие списывается с абонемента, только когда гостя отметят на тренировке.",
  },
  {
    feature: "videos",
    label: "Видео и курсы",
    description: "Библиотека видео, плейлисты и избранное.",
  },
  {
    feature: "achievements",
    label: "Достижения",
    description: "Награды ученика за посещаемость и серии.",
  },
  {
    feature: "journal",
    label: "Дневник тренировок",
    description: "Личные заметки ученика о тренировках.",
  },
]
