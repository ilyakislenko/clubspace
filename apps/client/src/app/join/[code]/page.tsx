import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"

import { ClubDetails, ClubHeader } from "../../../features/public-club/ClubProfile"
import { JoinActions } from "../../../features/public-club/JoinActions"
import { getPublicClubByCode } from "../../../shared/api/public-clubs"
import { readStoreLinks } from "../../../shared/lib/app-links"

// Store and web-app links come from the container's environment at request
// time, so the page is rendered per request (the API answer itself is cached).
export const dynamic = "force-dynamic"

type Props = { params: Promise<{ code: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { code } = await params
  const club = await getPublicClubByCode(code)
  return {
    title: club ? `Вступить в «${club.name}»` : "Приглашение в клуб",
    description: club?.description ?? undefined,
    // A join code is a key to the club: keep these pages out of search.
    robots: { index: false, follow: false },
  }
}

export default async function JoinPage({ params }: Props) {
  const { code } = await params
  const club = await getPublicClubByCode(code)
  if (!club || !club.joinCode || !club.joinCodeDisplay) notFound()

  return (
    <main className="mx-auto max-w-xl space-y-8 px-4 py-10">
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">Вас приглашают в клуб</p>
        <ClubHeader club={club} />
      </div>

      <JoinActions
        code={club.joinCode}
        codeDisplay={club.joinCodeDisplay}
        links={readStoreLinks()}
      />

      <ClubDetails club={club} />

      {club.slug && (
        <p className="text-center text-sm">
          <Link
            href={`/c/${club.slug}`}
            className="text-primary underline-offset-4 hover:underline"
          >
            Страница клуба
          </Link>
        </p>
      )}

      <footer className="border-t border-border pt-4 text-center text-xs text-muted-foreground">
        ClubSpace ·{" "}
        <Link href="/legal/privacy" className="hover:underline">
          Конфиденциальность
        </Link>
      </footer>
    </main>
  )
}
