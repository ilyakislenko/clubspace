import {
  redirectInWorkspace,
  type LegacyPageProps,
} from "../../../../../shared/workspace/legacy-redirect"

// «Интеграции» moved under «Настройки».
export default async function IntegrationsLegacyRedirect(props: LegacyPageProps) {
  return redirectInWorkspace(props, "settings/integrations")
}
