import {
  redirectInWorkspace,
  type LegacyPageProps,
} from "../../../../../shared/workspace/legacy-redirect"

// «Направления» moved under «Настройки».
export default async function DirectionsLegacyRedirect(props: LegacyPageProps) {
  return redirectInWorkspace(props, "settings/directions")
}
