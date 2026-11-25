import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"

import { formatEditionDate } from "../../../../../features/legal/editions"
import { leadConsentEdition } from "../../../../../features/legal/lead-consent/registry"
import { getPublicTrialForm } from "../../../../../shared/api/public-trial"

export const dynamic = "force-dynamic"

type Props = { params: Promise<{ slug: string }> }

export const metadata: Metadata = {
  title: "Согласие на обработку персональных данных",
  robots: { index: false, follow: false },
}

// The consent behind the trial form's checkbox, filled with this club as the
// operator. NOTE FOR LAUNCH: the text is a draft not reviewed by a lawyer —
// docs/legal/README.md. Editions live in features/legal/lead-consent/.
export default async function TrialConsentPage({ params }: Props) {
  const { slug } = await params
  const form = await getPublicTrialForm(slug)
  if (!form) notFound()
  const { version, Text } = leadConsentEdition(form.consentVersion)

  return (
    <article className="mx-auto max-w-3xl space-y-6 px-4 py-10">
      <Link
        href={`/c/${encodeURIComponent(slug)}/trial`}
        className="text-xs text-muted-foreground hover:underline"
      >
        ← К заявке
      </Link>

      <header className="space-y-2">
        <h1 className="text-3xl font-semibold">
          Согласие на обработку персональных данных
        </h1>
        <p className="text-sm text-muted-foreground">
          Заявка на пробное занятие · редакция от {formatEditionDate(version)}
        </p>
      </header>

      <Text
        operatorName={form.operator.name}
        operatorAddress={form.operator.address}
        clubName={form.clubName}
        contacts={form.contacts}
      />
    </article>
  )
}
