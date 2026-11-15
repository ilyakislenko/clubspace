import {
  LEGAL_DOCUMENT_TITLES,
  LegalEditionPage,
} from "../../../features/legal/LegalDocument"

// NOTE FOR LAUNCH: the autopay terms are a draft not reviewed by a lawyer — see
// docs/legal/README.md. Texts live in apps/client/src/features/legal/autopay/.
// The member app links here from the autopay consent (autopayTermsUrl).

export const metadata = {
  title: LEGAL_DOCUMENT_TITLES.autopay,
}

// The edition in force (= the server's AUTOPAY_CONSENT_VERSION).
export default function AutopayTermsPage() {
  return <LegalEditionPage kind="autopay" />
}
