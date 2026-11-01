import {
  LEGAL_DOCUMENT_TITLES,
  LegalEditionPage,
} from "../../../features/legal/LegalDocument"

// NOTE FOR LAUNCH: the DPA text is a draft not reviewed by a lawyer — see
// docs/legal/README.md. Texts live in apps/client/src/features/legal/dpa/.

export const metadata = {
  title: LEGAL_DOCUMENT_TITLES.dpa,
}

// The edition in force (the server's PLATFORM_DPA_VERSION).
export default function DpaPage() {
  return <LegalEditionPage kind="dpa" />
}
