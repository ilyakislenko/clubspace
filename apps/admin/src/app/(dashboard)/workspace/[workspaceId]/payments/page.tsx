import {
  redirectInWorkspace,
  type LegacyPageProps,
} from "../../../../../shared/workspace/legacy-redirect"

// The ЮKassa/Stripe connection lives in «Настройки → Оплата»; the payments list in «Абонементы → Платежи».
export default async function PaymentsLegacyRedirect(props: LegacyPageProps) {
  return redirectInWorkspace(props, "settings/payments")
}
