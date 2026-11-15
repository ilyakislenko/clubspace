import type { Metadata } from "next"

import { formatEditionDate } from "../../../../features/legal/editions"
import {
  editionStaticParams,
  LEGAL_DOCUMENT_TITLES,
  LegalEditionPage,
} from "../../../../features/legal/LegalDocument"

// NOTE FOR LAUNCH: the autopay terms are a draft not reviewed by a lawyer — see
// docs/legal/README.md. The version is the one recorded with the member's
// consent (MemberAutopay.consentVersion).

type Props = { params: Promise<{ version: string }> }

// Only editions in the registry exist; anything else is a 404.
export const dynamicParams = false

export const generateStaticParams = () => editionStaticParams("autopay")

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { version } = await params
  return {
    title: `${LEGAL_DOCUMENT_TITLES.autopay} — редакция от ${formatEditionDate(version)}`,
  }
}

export default async function AutopayTermsEditionPage({ params }: Props) {
  const { version } = await params
  return <LegalEditionPage kind="autopay" version={version} />
}
