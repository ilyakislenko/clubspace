import {
  redirectInWorkspace,
  type LegacyPageProps,
} from "../../../../../shared/workspace/legacy-redirect"

// Achievements are configured in «Настройки → Приложение учеников».
export default async function AchievementsLegacyRedirect(props: LegacyPageProps) {
  return redirectInWorkspace(props, "settings/app")
}
