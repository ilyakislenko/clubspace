import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"

import { leadConsentEdition } from "../../../../features/legal/lead-consent/registry"
import { ClubLogo } from "../../../../features/public-club/ClubProfile"
import { TrialRequestForm } from "../../../../features/public-club/TrialRequestForm"
import { getPublicTrialForm } from "../../../../shared/api/public-trial"

export const dynamic = "force-dynamic"

type Props = {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ src?: string | string[] }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const form = await getPublicTrialForm(slug)
  if (!form) return { title: "Клуб не принимает заявки" }
  return {
    title: `Пробное занятие — ${form.clubName}`,
    // A club takes requests without being in the catalog (leads design §12):
    // only a listed club's form may be found through search.
    ...(form.isListed
      ? { alternates: { canonical: `/c/${slug}/trial` } }
      : { robots: { index: false, follow: false } }),
  }
}

// «Записаться на пробное»: from the club page (source page) or the club's QR
// poster (`?src=qr`). 404 unless the club switched the form on with an
// operator named — the API decides.
export default async function TrialRequestPage({ params, searchParams }: Props) {
  const { slug } = await params
  const { src } = await searchParams
  const form = await getPublicTrialForm(slug)
  if (!form) notFound()
  const { version } = leadConsentEdition(form.consentVersion)

  return (
    <main className="mx-auto max-w-xl space-y-8 px-4 py-10">
      {form.isListed && (
        <Link
          href={`/c/${encodeURIComponent(slug)}`}
          className="text-xs text-muted-foreground hover:underline"
        >
          ← Страница клуба
        </Link>
      )}

      <header className="flex items-center gap-4">
        <ClubLogo name={form.clubName} logoUrl={form.logoUrl} size="md" />
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold leading-tight">
            Пробное занятие
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">{form.clubName}</p>
        </div>
      </header>

      <TrialRequestForm
        slug={slug}
        form={form}
        consentVersion={version}
        source={src === "qr" ? "qr" : "page"}
      />

      <footer className="border-t border-border pt-4 text-center text-xs text-muted-foreground">
        ClubSpace ·{" "}
        <Link href="/legal/privacy" className="hover:underline">
          Конфиденциальность
        </Link>
      </footer>
    </main>
  )
}
