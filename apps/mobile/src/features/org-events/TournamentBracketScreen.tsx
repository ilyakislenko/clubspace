import { useFocusEffect } from "@react-navigation/native"
import type { NativeStackScreenProps } from "@react-navigation/native-stack"
import React, { useCallback, useState } from "react"
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"

import type { RootStackParamList } from "../../app/navigation"
import {
  getClubTournamentBracket,
  type ClubTournamentBracket,
  type ClubTournamentBracketMatch,
  type ClubTournamentPerson,
} from "../../shared/api/tournaments"
import { useCachedResource } from "../../shared/cache/useCachedResource"
import { ErrorRetry } from "../../shared/components/ErrorRetry"
import { OfflineNotice } from "../../shared/components/OfflineNotice"
import { Pressable } from "../../shared/components/Pressable"
import { RefreshControl } from "../../shared/components/RefreshControl"
import type { Theme } from "../../shared/theme"
import { useTheme, useThemedStyles } from "../../shared/theme-context"
import { useResponsive } from "../../shared/useResponsive"
import {
  initialRound,
  matchResultShort,
  pendingSlotLabel,
  personName,
  placeLabel,
  roundLabel,
  TOURNAMENT_POLL_MS,
} from "./tournament-helpers"

type Props = NativeStackScreenProps<RootStackParamList, "TournamentBracket">

/**
 * One division's bracket, read-only. Phone: round tabs («1/4 · 1/2 · Финал»)
 * over a list of matches; tablet: every round as a column. The viewer's
 * athlete has the accent border, their club a dot; hidden people read
 * «Участник скрыт». Nobody's weight or birth year is ever here.
 */
export function TournamentBracketScreen({ route }: Props) {
  const { workspaceId, eventId, divisionId } = route.params
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const { sizeClass } = useResponsive()
  const wide = sizeClass !== "compact"
  const bracket = useCachedResource<ClubTournamentBracket>(
    `tournament-bracket:${workspaceId}:${divisionId}`,
    useCallback(
      async () => await getClubTournamentBracket({ workspaceId, eventId, divisionId }),
      [workspaceId, eventId, divisionId],
    ),
  )
  const data = bracket.data
  const [round, setRound] = useState<number | null>(null)
  const live = !!data && !data.division.finishedAt
  const { refetch } = bracket
  useFocusEffect(
    useCallback(() => {
      if (!live) return
      const id = setInterval(refetch, TOURNAMENT_POLL_MS)
      return () => clearInterval(id)
    }, [live, refetch]),
  )

  if (bracket.loading && !data) {
    return (
      <SafeAreaView style={styles.center} edges={["bottom"]}>
        <ActivityIndicator color={theme.colors.accent} />
      </SafeAreaView>
    )
  }

  const rounds = data ? Array.from({ length: data.rounds }, (_, i) => i + 1) : []
  const shown = round ?? (data ? initialRound(data.matches) : 1)
  const matchesOf = (r: number) => (data?.matches ?? []).filter((m) => m.round === r).sort((a, b) => a.position - b.position)

  return (
    <SafeAreaView style={styles.root} edges={["bottom"]}>
      <ScrollView
        contentContainerStyle={styles.body}
        refreshControl={<RefreshControl refreshing={bracket.refreshing} onRefresh={refetch} tintColor={theme.colors.accent} />}
      >
        {bracket.error && !data && <ErrorRetry message={bracket.error} onRetry={refetch} />}
        {bracket.stale && data ? <OfflineNotice /> : null}
        {data && (
          <>
            {/* The division name wraps here; the header would cut it. */}
            <View style={styles.heading}>
              <Text style={styles.title}>{data.division.name}</Text>
              {(data.division.mat !== null || data.division.finishedAt) && (
                <Text style={styles.muted}>
                  {[data.division.mat !== null ? `Ковёр ${data.division.mat}` : null, data.division.finishedAt ? "Категория завершена" : null]
                    .filter(Boolean)
                    .join(" · ")}
                </Text>
              )}
            </View>
            {data.soloWinner && (
              <View style={styles.card}>
                <PersonLine person={data.soloWinner} winner styles={styles} />
                <Text style={styles.muted}>{placeLabel(data.soloWinner.place)} · без соперника</Text>
              </View>
            )}
            {!wide && rounds.length > 1 && (
              <View style={styles.tabs} accessibilityRole="tablist">
                {rounds.map((r) => {
                  const active = r === shown
                  return (
                    <Pressable
                      key={r}
                      onPress={() => setRound(r)}
                      accessibilityRole="tab"
                      accessibilityState={{ selected: active }}
                      style={[styles.tab, active && styles.tabActive]}
                    >
                      <Text style={[styles.tabText, active && styles.tabTextActive]}>{roundLabel(r, data.rounds)}</Text>
                    </Pressable>
                  )
                })}
              </View>
            )}
            {wide ? (
              <ScrollView horizontal contentContainerStyle={styles.columns}>
                {rounds.map((r) => (
                  <View key={r} style={styles.column}>
                    <Text style={styles.columnTitle}>{roundLabel(r, data.rounds)}</Text>
                    <View style={[styles.columnBody, { gap: theme.spacing(3) * 2 ** (r - 1) }]}>
                      {matchesOf(r).map((m) => (
                        <MatchCard key={m.id} match={m} matches={data.matches} styles={styles} />
                      ))}
                    </View>
                  </View>
                ))}
              </ScrollView>
            ) : (
              <View style={styles.list}>
                {matchesOf(shown).map((m) => (
                  <MatchCard key={m.id} match={m} matches={data.matches} styles={styles} />
                ))}
              </View>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

type Styles = ReturnType<typeof makeStyles>

function PersonLine({
  person,
  pending,
  winner,
  styles,
}: {
  person: Pick<ClubTournamentPerson, "hidden" | "personName" | "clubName" | "isMyClub"> | null
  /** What an empty slot waits for («победитель схватки …» / «—»). */
  pending?: string
  winner: boolean
  styles: Styles
}) {
  if (!person) {
    return (
      <Text style={styles.pending} numberOfLines={2}>
        {pending ?? "—"}
      </Text>
    )
  }
  return (
    <View style={styles.person}>
      <View style={styles.personText}>
        <Text style={[styles.name, winner && styles.winner]} numberOfLines={1}>
          {personName(person)}
        </Text>
        {!person.hidden && person.clubName && (
          <Text style={styles.club} numberOfLines={1}>
            {person.clubName}
          </Text>
        )}
      </View>
      {/* A hidden person shows nothing about them, the club included. */}
      {person.isMyClub && !person.hidden && <View style={styles.dot} accessibilityLabel="Ваш клуб" />}
    </View>
  )
}

function MatchCard({
  match,
  matches,
  styles,
}: {
  match: ClubTournamentBracketMatch
  matches: readonly ClubTournamentBracketMatch[]
  styles: Styles
}) {
  const me = match.entryA?.isMe || match.entryB?.isMe
  const result = matchResultShort(match)
  if (match.isBye) {
    const athlete = match.entryA ?? match.entryB
    return (
      <View style={[styles.card, me && styles.cardMe]}>
        <PersonLine person={athlete} winner={false} styles={styles} />
        <Text style={styles.muted}>проходит без схватки</Text>
      </View>
    )
  }
  return (
    <View style={[styles.card, me && styles.cardMe]}>
      <PersonLine
        person={match.entryA}
        pending={pendingSlotLabel(matches, match, "A")}
        winner={match.winnerSide === "A"}
        styles={styles}
      />
      <PersonLine
        person={match.entryB}
        pending={pendingSlotLabel(matches, match, "B")}
        winner={match.winnerSide === "B"}
        styles={styles}
      />
      {result && <Text style={styles.muted}>{result}</Text>}
    </View>
  )
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: theme.colors.background },
    center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: theme.colors.background },
    body: { padding: theme.spacing(5), gap: theme.spacing(3) },
    heading: { gap: theme.spacing(1) },
    title: { ...theme.typography.subheading, color: theme.colors.text },
    muted: { fontSize: 13, color: theme.colors.muted },
    tabs: { flexDirection: "row", gap: theme.spacing(2) },
    tab: {
      flex: 1,
      minHeight: 44,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: theme.radius.md,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
    },
    tabActive: { borderColor: theme.colors.accent, backgroundColor: theme.colors.accentSoft },
    tabText: { fontSize: 15, color: theme.colors.text },
    tabTextActive: { fontWeight: "700", color: theme.colors.accent },
    list: { gap: theme.spacing(2) },
    columns: { gap: theme.spacing(4) },
    column: { width: 240, gap: theme.spacing(2) },
    columnTitle: { ...theme.typography.label },
    columnBody: { flex: 1, justifyContent: "space-around" },
    card: {
      gap: theme.spacing(1),
      padding: theme.spacing(3),
      borderRadius: theme.radius.md,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surfaceElevated,
    },
    cardMe: { borderColor: theme.colors.accent, borderWidth: 2 },
    person: { flexDirection: "row", alignItems: "center", gap: theme.spacing(2) },
    personText: { flex: 1 },
    name: { fontSize: 15, color: theme.colors.text },
    pending: { fontSize: 13, color: theme.colors.muted, paddingVertical: 2 },
    winner: { fontWeight: "700" },
    club: { fontSize: 12, color: theme.colors.muted },
    dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: theme.colors.mutedFaint },
  })
