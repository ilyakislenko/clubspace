import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"

import { ClubDetails, ClubHeader } from "../../../features/public-club/ClubProfile"
import { getPublicClubBySlug } from "../../../shared/api/public-clubs"

export const dynamic = "force-dynamic"

type Props = { params: Promise<{ slug: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const club = await getPublicClubBySlug(slug)
  if (!club) return { title: "Клуб не найден" }
  return {
    title: club.city ? `${club.name} — ${club.city}` : club.name,
    description: club.description ?? undefined,
    alternates: { canonical: `/c/${club.slug ?? slug}` },
  }
}

// The public page of a club that chose to be listed. «Вступить» leads to the
// join page for the club's code, which opens the app (or a store) from there.
export default async function ClubPage({ params }: Props) {
  const { slug } = await params
  const club = await getPublicClubBySlug(slug)
  if (!club) notFound()

  return (
    <main className="mx-auto max-w-2xl space-y-8 px-4 py-10">
      <Link
        href="/clubs"
        className="text-xs text-muted-foreground hover:underline"
      >
        ← Все клубы
      </Link>

      <ClubHeader club={club} />

      {club.joinCode && (
        <Link
          href={`/join/${club.joinCode}`}
          className="flex h-12 w-full items-center justify-center rounded-full bg-primary px-6 text-base font-semibold text-primary-foreground transition-opacity hover:opacity-90 sm:w-auto sm:px-10"
        >
          Вступить
        </Link>
      )}

      <ClubDetails club={club} />

      <footer className="border-t border-border pt-4 text-center text-xs text-muted-foreground">
        ClubSpace ·{" "}
        <Link href="/legal/privacy" className="hover:underline">
          Конфиденциальность
        </Link>
      </footer>
    </main>
  )
}
