import type { ApiTypes } from "@clubspace/api-client"
import type { ClubVocabulary } from "@clubspace/ui-kit/brand"

// The club's app-section switches: each `feature` is a `${feature}Enabled`
// Boolean on the workspace settings; the mobile app hides the matching block
// when it's off. Shown on the club's settings page and in the platform console,
// named in the club's words like the app's own menu.
export type AppSectionFeature = ApiTypes.SetPlatformWorkspaceFeatureInputDto["feature"]

export const appSections = (
  v: ClubVocabulary,
): Array<{
  feature: AppSectionFeature
  label: string
  description: string
}> => [
  {
    feature: "announcements",
    label: "Объявления",
    description: "Лента новостей и объявлений клуба.",
  },
  {
    feature: "ranks",
    label: "Ранги",
    description: "Прогресс ученика по поясам, грейдам или уровням.",
  },
  {
    feature: "leaderboard",
    label: "Рейтинг посещаемости",
    description: "Таблица учеников по числу занятий за неделю/месяц.",
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
    description: "Расписание занятий клуба.",
  },
  {
    feature: "groups",
    label: "Группы и залы",
    description: "Группы ученика и список залов клуба.",
  },
  {
    feature: "events",
    label: "События",
    description: "Семинары, мастер-классы, турниры и концерты.",
  },
  {
    feature: "guestVisits",
    label: "Гостевые визиты в другие группы",
    description:
      `Ученики видят расписание всех групп и могут записаться на ${v.session.acc} другой группы. Занятие списывается с абонемента, только когда гостя отметят на ${v.session.prep}.`,
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
    label: `Дневник ${v.session.genPl}`,
    description: `Личные заметки ученика о ${v.session.prepPl}.`,
  },
]
