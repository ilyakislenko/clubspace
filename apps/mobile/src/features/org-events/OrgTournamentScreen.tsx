import { cap } from "@clubspace/ui-kit/brand"
import { useFocusEffect } from "@react-navigation/native"
import type { NativeStackScreenProps } from "@react-navigation/native-stack"
import React, { useCallback, useEffect, useState } from "react"
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"

import type { RootStackParamList } from "../../app/navigation"
import { listMyClubOrganizations, type MyClubOrganization } from "../../shared/api/organizations"
import {
  getClubTournament,
  listClubTournamentAthletes,
  type ClubTournament,
  type ClubTournamentAthlete,
  type ClubTournamentAthletes,
} from "../../shared/api/tournaments"
import { useAuth } from "../../shared/auth-context"
import { useVocabulary } from "../../shared/use-vocabulary"
import { useCachedResource } from "../../shared/cache/useCachedResource"
import { CenteredColumn, READABLE_WIDTH } from "../../shared/components/CenteredColumn"
import { Chevron } from "../../shared/components/Chevron"
import { ErrorRetry } from "../../shared/components/ErrorRetry"
import { OfflineNotice } from "../../shared/components/OfflineNotice"
import { Pressable } from "../../shared/components/Pressable"
import { RefreshControl } from "../../shared/components/RefreshControl"
import { useToast } from "../../shared/components/Toast"
import type { Theme } from "../../shared/theme"
import { useTheme, useThemedStyles } from "../../shared/theme-context"
import { isStaffWorkspace } from "../retention/retention-helpers"
import { OrgConsentSheet } from "./OrgConsentSheet"
import { TournamentConfirmSheet } from "./TournamentConfirmSheet"
import { TournamentEntrySheet } from "./TournamentEntrySheet"
import {
  athleteCategoryLine,
  athleteRowKind,
  athleteStatusLabel,
  entryStateLine,
  entryWeightsLine,
  nextMatchLines,
  placeLabel,
  sortAthletes,
  TOURNAMENT_POLL_MS,
  tournamentSections,
  tournamentStatusLine,
} from "./tournament-helpers"

type Props = NativeStackScreenProps<RootStackParamList, "OrgTournament">

/**
 * A federation tournament in the club app (docs/design/2026-11-27-tournaments.md
 * §8). The athlete (a guardian for the child) declares the weight, then
 * follows the division, the next match and the place; a club coach confirms
 * declarations and follows their students. Sections render only when true;
 * refetched on focus and pull, polled every 30 s while focused and running.
 */
export function OrgTournamentScreen({ route, navigation }: Props) {
  const { workspaceId, eventId } = route.params
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const { workspace, actingAs } = useAuth()
  const { showToast } = useToast()
  const staff = isStaffWorkspace(workspace)
  const forChild = actingAs !== null
  const vocabulary = useVocabulary()

  const tournament = useCachedResource<ClubTournament>(
    `tournament:${workspaceId}:${eventId}`,
    useCallback(async () => await getClubTournament({ workspaceId, eventId }), [workspaceId, eventId]),
  )
  const athletes = useCachedResource<ClubTournamentAthletes>(
    staff ? `tournament-athletes:${workspaceId}:${eventId}` : null,
    useCallback(async () => await listClubTournamentAthletes({ workspaceId, eventId }), [workspaceId, eventId]),
  )
  // Same key as «События» and the club settings: a consent re-granted here
  // shows there.
  const orgs = useCachedResource<MyClubOrganization[]>(
    staff ? null : `my-orgs:${workspaceId}`,
    useCallback(async () => await listMyClubOrganizations({ workspaceId }), [workspaceId]),
  )
  const [entrySheet, setEntrySheet] = useState<{ student?: ClubTournamentAthlete } | null>(null)
  const [consentOpen, setConsentOpen] = useState(false)
  const [confirmFor, setConfirmFor] = useState<ClubTournamentAthlete | null>(null)

  const t = tournament.data
  const running = t?.status === "RUNNING"
  const refetchTournament = tournament.refetch
  const refetchAthletes = athletes.refetch
  useFocusEffect(
    useCallback(() => {
      if (!running) return
      const id = setInterval(() => {
        refetchTournament()
        if (staff) refetchAthletes()
      }, TOURNAMENT_POLL_MS)
      return () => clearInterval(id)
    }, [running, staff, refetchTournament, refetchAthletes]),
  )
  useEffect(() => {
    if (t) navigation.setOptions({ title: t.eventTitle })
  }, [navigation, t])

  if (tournament.loading && !t) {
    return (
      <SafeAreaView style={styles.center} edges={["bottom"]}>
        <ActivityIndicator color={theme.colors.accent} />
      </SafeAreaView>
    )
  }

  const refresh = () => {
    tournament.refetch()
    if (staff) athletes.refetch()
  }
  const org = orgs.data?.find((o) => o.organizationId === t?.organizationId) ?? null
  // A member on an older consent edition re-confirms before declaring.
  const declare = () => {
    if (t && !t.consentCurrent && org) setConsentOpen(true)
    else setEntrySheet({})
  }
  const openBracket = (divisionId: string) => navigation.navigate("TournamentBracket", { workspaceId, eventId, divisionId })
  const onAthlete = (a: ClubTournamentAthlete) => {
    const kind = athleteRowKind(a)
    if (kind === "toConfirm") setConfirmFor(a)
    else if (kind === "needsWeight" && t?.status === "SETUP") setEntrySheet({ student: a })
    else if (a.entry?.bracketAvailable && a.entry.divisionId) openBracket(a.entry.divisionId)
  }

  const sections = t ? tournamentSections(t, staff) : null
  const entry = t?.myEntry ?? null
  const next = entry?.nextMatch ? nextMatchLines(entry.nextMatch) : null
  // The server lists only students registered for the event through this club.
  const list = athletes.data ? sortAthletes(athletes.data.data) : []
  const toConfirm = list.filter((a) => athleteRowKind(a) === "toConfirm")

  return (
    <SafeAreaView style={styles.root} edges={["bottom"]}>
      <CenteredColumn maxWidth={READABLE_WIDTH}>
        <ScrollView
          contentContainerStyle={styles.body}
          refreshControl={
            <RefreshControl refreshing={tournament.refreshing} onRefresh={refresh} tintColor={theme.colors.accent} />
          }
        >
          {tournament.error && !t && <ErrorRetry message={tournament.error} onRetry={refresh} />}
          {tournament.stale && t ? <OfflineNotice /> : null}
          {t && sections && (
            <>
              {/* The event title is the header's; the body opens with whose entry and the status. */}
              <Text style={styles.muted}>
                {[forChild && actingAs ? actingAs.firstname : null, tournamentStatusLine(t)]
                  .filter(Boolean)
                  .join(" · ")}
              </Text>

              {sections.declare && !entry && (
                <Pressable onPress={declare} accessibilityRole="button" style={styles.row}>
                  <View style={styles.rowText}>
                    <Text style={styles.accentText}>Заявка: укажите вес</Text>
                    <Text style={styles.muted}>{cap(vocabulary.coach.nom)} подтвердит, категорию подберёт система</Text>
                  </View>
                  <Chevron />
                </Pressable>
              )}

              {sections.entry && entry && (
                <Pressable
                  onPress={sections.declare ? declare : undefined}
                  disabled={!sections.declare}
                  accessibilityRole={sections.declare ? "button" : "text"}
                  style={styles.row}
                >
                  <View style={styles.rowText}>
                    <Text style={styles.label}>Категория</Text>
                    <Text style={styles.strong}>{entryStateLine(entry, vocabulary.coach)}</Text>
                    {entryWeightsLine(entry) && <Text style={styles.muted}>{entryWeightsLine(entry)}</Text>}
                  </View>
                  {sections.declare && <Chevron />}
                </Pressable>
              )}

              {sections.place && entry?.place != null && (
                <Text style={styles.place}>{placeLabel(entry.place)}</Text>
              )}
              {sections.eliminated && <Text style={styles.muted}>Выступление в турнире закончено</Text>}

              {sections.nextMatch && next && (
                <View style={styles.block}>
                  <Text style={styles.label}>Следующая схватка</Text>
                  <Text style={styles.strong}>{next.where}</Text>
                  {next.opponent && <Text style={styles.text}>{next.opponent}</Text>}
                </View>
              )}

              {sections.bracket && entry?.divisionId && (
                <Pressable
                  onPress={() => entry.divisionId && openBracket(entry.divisionId)}
                  accessibilityRole="button"
                  style={styles.row}
                >
                  <Text style={[styles.text, styles.rowText]}>Сетка категории</Text>
                  <Chevron />
                </Pressable>
              )}

              {sections.toConfirm && toConfirm.length > 0 && (
                <View style={styles.block}>
                  <Text style={styles.sectionTitle}>Ждут подтверждения ({toConfirm.length})</Text>
                  {toConfirm.map((a) => (
                    <Pressable key={a.userId} onPress={() => setConfirmFor(a)} accessibilityRole="button" style={styles.row}>
                      <View style={styles.rowText}>
                        <Text style={styles.text} numberOfLines={1}>
                          {a.name}
                        </Text>
                        {a.entry && entryWeightsLine(a.entry) && <Text style={styles.muted}>{entryWeightsLine(a.entry)}</Text>}
                      </View>
                      <Chevron />
                    </Pressable>
                  ))}
                </View>
              )}

              {sections.athletes && (
                <View style={styles.block}>
                  <Text style={styles.sectionTitle}>Мои спортсмены</Text>
                  {athletes.error && !athletes.data && <ErrorRetry message={athletes.error} onRetry={athletes.refetch} />}
                  {athletes.data && list.length === 0 && <Text style={styles.muted}>Никто из ваших учеников не записан</Text>}
                  {list
                    .filter((a) => athleteRowKind(a) !== "toConfirm")
                    .map((a) => {
                      const status = athleteStatusLabel(a, t.status)
                      const kind = athleteRowKind(a)
                      const inert =
                        kind === "withdrawn" ||
                        (kind === "needsWeight" && t.status !== "SETUP") ||
                        (kind === "confirmed" && !a.entry?.bracketAvailable)
                      return (
                        <Pressable
                          key={a.userId}
                          onPress={() => onAthlete(a)}
                          disabled={inert}
                          accessibilityRole={inert ? "text" : "button"}
                          style={styles.row}
                        >
                          <View style={styles.rowText}>
                            <Text style={styles.text} numberOfLines={1}>
                              {a.name}
                            </Text>
                            <Text style={styles.muted} numberOfLines={1}>
                              {athleteCategoryLine(a, vocabulary.coach)}
                            </Text>
                          </View>
                          {status && <Text style={styles.status}>{status}</Text>}
                          {!inert && <Chevron />}
                        </Pressable>
                      )
                    })}
                </View>
              )}

              {sections.results && (
                <Pressable
                  onPress={() => navigation.navigate("TournamentResults", { workspaceId, eventId })}
                  accessibilityRole="button"
                  style={styles.row}
                >
                  <Text style={[styles.text, styles.rowText]}>Итоги турнира</Text>
                  <Chevron />
                </Pressable>
              )}
            </>
          )}
        </ScrollView>
      </CenteredColumn>

      {t && entrySheet && (
        <TournamentEntrySheet
          workspaceId={workspaceId}
          eventId={eventId}
          title={t.eventTitle}
          forChild={forChild}
          student={entrySheet.student ? { userId: entrySheet.student.userId, name: entrySheet.student.name } : undefined}
          initial={entrySheet.student ? null : entry}
          profileBirthYear={entrySheet.student ? entrySheet.student.profileBirthYear : t.profileBirthYear}
          onClosed={() => setEntrySheet(null)}
          onConsentRequired={() => {
            if (org) setConsentOpen(true)
          }}
          onSaved={(saved) => {
            showToast(
              entrySheet.student
                ? `${entrySheet.student.name}: ${saved.divisionName ?? "категорию назначит федерация"}`
                : `Заявка у ${vocabulary.coach.gen}`,
              "success",
            )
            refresh()
          }}
        />
      )}
      {consentOpen && org && (
        <OrgConsentSheet
          workspaceId={workspaceId}
          org={org}
          forChild={forChild}
          confirmLabel="Разрешить и продолжить"
          onClosed={() => setConsentOpen(false)}
          onGranted={(updated) => {
            orgs.mutate((prev) => (prev ?? []).map((o) => (o.organizationId === updated.organizationId ? updated : o)))
            tournament.mutate((prev) => (prev ? { ...prev, consentCurrent: true } : prev))
            setEntrySheet({})
          }}
        />
      )}
      {confirmFor && t && (
        <TournamentConfirmSheet
          workspaceId={workspaceId}
          athlete={confirmFor}
          levels={t.levels}
          onClosed={() => setConfirmFor(null)}
          onConfirmed={(saved) => {
            showToast(`${confirmFor.name}: ${saved.divisionName ?? "категорию назначит федерация"}`, "success")
            refresh()
          }}
        />
      )}
    </SafeAreaView>
  )
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: theme.colors.background },
    center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: theme.colors.background },
    body: { padding: theme.spacing(5), gap: theme.spacing(4) },
    sectionTitle: { ...theme.typography.subheading, color: theme.colors.text },
    block: { gap: theme.spacing(1) },
    label: { ...theme.typography.label },
    text: { fontSize: 15, color: theme.colors.text },
    strong: { ...theme.typography.bodyStrong, color: theme.colors.text },
    accentText: { ...theme.typography.bodyStrong, color: theme.colors.accent },
    muted: { fontSize: 13, color: theme.colors.muted },
    place: { ...theme.typography.heading, color: theme.colors.success },
    status: { fontSize: 13, fontWeight: "600", color: theme.colors.textSecondary },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing(3),
      minHeight: 52,
      paddingVertical: theme.spacing(2),
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.border,
    },
    rowText: { flex: 1, gap: 2 },
  })
