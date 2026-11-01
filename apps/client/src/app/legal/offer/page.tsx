import {
  LEGAL_DOCUMENT_TITLES,
  LegalEditionPage,
} from "../../../features/legal/LegalDocument"

// NOTE FOR LAUNCH: the offer text is a draft not reviewed by a lawyer — see
// docs/legal/README.md. Texts live in apps/client/src/features/legal/offer/.

export const metadata = {
  title: LEGAL_DOCUMENT_TITLES.offer,
}

// The edition in force (the server's PLATFORM_OFFER_VERSION).
export default function OfferPage() {
  return <LegalEditionPage kind="offer" />
}
