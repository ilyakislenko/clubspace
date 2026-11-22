import {
  redirectInWorkspace,
  type LegacyPageProps,
} from "../../../../../shared/workspace/legacy-redirect"

// «История изменений» moved under «Настройки».
export default async function AuditLegacyRedirect(props: LegacyPageProps) {
  return redirectInWorkspace(props, "settings/audit")
}
