import {
  redirectInWorkspace,
  type LegacyPageProps,
} from "../../../../../shared/workspace/legacy-redirect"

// «Публичная страница» is part of «Настройки → Профиль клуба».
export default async function PublicPageLegacyRedirect(props: LegacyPageProps) {
  return redirectInWorkspace(props, "settings")
}
