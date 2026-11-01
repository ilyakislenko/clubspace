import type { Metadata } from "next"

import { formatEditionDate } from "../../../../features/legal/editions"
import {
  editionStaticParams,
  LEGAL_DOCUMENT_TITLES,
  LegalEditionPage,
} from "../../../../features/legal/LegalDocument"

// NOTE FOR LAUNCH: the offer text is a draft not reviewed by a lawyer — see
// docs/legal/README.md.

type Props = { params: Promise<{ version: string }> }

// Only editions in the registry exist; anything else is a 404.
export const dynamicParams = false

export const generateStaticParams = () => editionStaticParams("offer")

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { version } = await params
  return {
    title: `${LEGAL_DOCUMENT_TITLES.offer} — редакция от ${formatEditionDate(version)}`,
  }
}

export default async function OfferEditionPage({ params }: Props) {
  const { version } = await params
  return <LegalEditionPage kind="offer" version={version} />
}
