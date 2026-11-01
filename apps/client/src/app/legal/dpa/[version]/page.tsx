import type { Metadata } from "next"

import { formatEditionDate } from "../../../../features/legal/editions"
import {
  editionStaticParams,
  LEGAL_DOCUMENT_TITLES,
  LegalEditionPage,
} from "../../../../features/legal/LegalDocument"

// NOTE FOR LAUNCH: the DPA text is a draft not reviewed by a lawyer — see
// docs/legal/README.md.

type Props = { params: Promise<{ version: string }> }

// Only editions in the registry exist; anything else is a 404.
export const dynamicParams = false

export const generateStaticParams = () => editionStaticParams("dpa")

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { version } = await params
  return {
    title: `${LEGAL_DOCUMENT_TITLES.dpa} — редакция от ${formatEditionDate(version)}`,
  }
}

export default async function DpaEditionPage({ params }: Props) {
  const { version } = await params
  return <LegalEditionPage kind="dpa" version={version} />
}
