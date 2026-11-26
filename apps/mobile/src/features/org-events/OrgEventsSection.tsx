import React, { useCallback, useState } from "react"
import { ActivityIndicator, StyleSheet, Text, View } from "react-native"

import { showAlert } from "../../shared/alert"
import {
  cancelOrgEventRegistration,
  listClubOrgEvents,
  listMyClubOrganizations,
  registerForOrgEvent,
  type ClubOrgEvent,
  type MyClubOrganization,
} from "../../shared/api/organizations"
import { useAuth } from "../../shared/auth-context"
import { useCachedResource } from "../../shared/cache/useCachedResource"
import { Pressable } from "../../shared/components/Pressable"
import { ResponsiveGrid } from "../../shared/components/ResponsiveGrid"
import { useToast } from "../../shared/components/Toast"
import { errorCode, errorMessage } from "../../shared/error-message"
import { haptics } from "../../shared/haptics"
import type { Theme } from "../../shared/theme"
import { useTheme, useThemedStyles } from "../../shared/theme-context"
import { isStaffWorkspace } from "../retention/retention-helpers"
import { OrgConsentSheet } from "./OrgConsentSheet"
import { OrgEventStudentsSheet } from "./OrgEventStudentsSheet"
import {
  canRegisterStudents,
  consentPrivacyLine,
  orgEventAction,
  orgEventPlacesLine,
  orgEventsTitle,
  orgEventWhen,
  orgEventWhere,
} from "./org-helpers"

/**
 * «События»: the federation's tournaments, seminars and grading days the club
 * lets into the app, above the club's own events. A member (a guardian for
 * the child) signs up here — the consent first, if not given yet; a coach
 * signs students up from a picker. Loads itself and renders nothing without
 * federation events (or with federations off on the server).
 */
export function OrgEventsSection({ workspaceId }: { workspaceId: string }) {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const { workspace, actingAs } = useAuth()
  const { showToast } = useToast()
  const staff = isStaffWorkspace(workspace)
  const forChild = actingAs !== null
  const events = useCachedResource<ClubOrgEvent[]>(
    `org-events:${workspaceId}`,
    useCallback(async () => await listClubOrgEvents({ workspaceId }), [workspaceId]),
  )
  // Same key as the Home card: a consent given in one shows in the other.
  const orgs = useCachedResource<MyClubOrganization[]>(
    `my-orgs:${workspaceId}`,
    useCallback(async () => await listMyClubOrganizations({ workspaceId }), [workspaceId]),
  )
  const [busyId, setBusyId] = useState<string | null>(null)
  const [consentFor, setConsentFor] = useState<{ event: ClubOrgEvent; org: MyClubOrganization } | null>(null)
  const [pickerFor, setPickerFor] = useState<ClubOrgEvent | null>(null)

  if (!events.data || events.data.length === 0) return null
  const list = events.data
  const orgOf = (e: ClubOrgEvent) => orgs.data?.find((o) => o.organizationId === e.organizationId) ?? null

  const register = async (event: ClubOrgEvent) => {
    setBusyId(event.id)
    try {
      await registerForOrgEvent({ workspaceId, eventId: event.id })
      haptics.success()
      showToast("Вы записаны", "success")
      events.refetch()
    } catch (e) {
      const org = orgOf(event)
      // Withdrawn on another device since the list loaded: ask again.
      if (errorCode(e) === "ORG_CONSENT_REQUIRED" && org) setConsentFor({ event, org })
      else showToast(errorMessage(e, "Не удалось записаться"), "error")
    } finally {
      setBusyId(null)
    }
  }

  const signUp = (event: ClubOrgEvent) => {
    const org = orgOf(event)
    if (org && !org.consentGranted) setConsentFor({ event, org })
    else void register(event)
  }

  const cancel = (event: ClubOrgEvent, registrationId: string) =>
    showAlert("Отменить запись?", event.title, [
      { text: "Нет", style: "cancel" },
      {
        text: "Отменить запись",
        style: "destructive",
        onPress: async () => {
          setBusyId(event.id)
          try {
            await cancelOrgEventRegistration({ workspaceId, registrationId })
            haptics.light()
            showToast("Запись отменена", "success")
            events.refetch()
          } catch (e) {
            showToast(errorMessage(e, "Не удалось отменить запись"), "error")
          } finally {
            setBusyId(null)
          }
        },
      },
    ])

  return (
    <View style={styles.section}>
      <Text style={styles.title}>{orgEventsTitle(list)}</Text>
      <ResponsiveGrid>
        {list.map((event) => {
          const action = orgEventAction(event, staff)
          const where = orgEventWhere(event)
          const places = orgEventPlacesLine(event, staff)
          const busy = busyId === event.id
          return (
            <View key={event.id} style={styles.card}>
              <Text style={styles.cardTitle}>{event.title}</Text>
              <Text style={styles.when}>{orgEventWhen(event.startAt, event.endAt, event.timezone)}</Text>
              {where && (
                <Text style={styles.muted} numberOfLines={2}>
                  {where}
                </Text>
              )}
              {event.description && (
                <Text style={styles.description} numberOfLines={3}>
                  {event.description}
                </Text>
              )}
              {(event.feeNote || places) && (
                <Text style={styles.meta}>{[event.feeNote, places].filter(Boolean).join(" · ")}</Text>
              )}
              {action.kind === "booked" && (
                <>
                  <Text style={styles.booked}>Вы записаны</Text>
                  {action.canCancel && (
                    <Pressable
                      onPress={() => cancel(event, action.registrationId)}
                      disabled={busy}
                      accessibilityRole="button"
                      style={[styles.button, styles.secondary]}
                    >
                      <Text style={styles.secondaryText}>{busy ? "Отменяем…" : "Отменить запись"}</Text>
                    </Pressable>
                  )}
                </>
              )}
              {action.kind === "register" && (
                <>
                  <Pressable
                    onPress={() => signUp(event)}
                    disabled={busy}
                    accessibilityRole="button"
                    style={[styles.button, styles.primary]}
                  >
                    {busy ? (
                      <ActivityIndicator color={theme.colors.accent} />
                    ) : (
                      <Text style={styles.primaryText}>Записаться</Text>
                    )}
                  </Pressable>
                  <Text style={styles.caption}>{consentPrivacyLine(forChild)}</Text>
                </>
              )}
              {action.kind === "full" && <Text style={styles.muted}>Мест нет</Text>}
              {action.kind === "closed" && <Text style={styles.muted}>Запись закрыта</Text>}
              {canRegisterStudents(event, staff) && (
                <Pressable
                  onPress={() => setPickerFor(event)}
                  accessibilityRole="button"
                  style={[styles.button, styles.secondary]}
                >
                  <Text style={styles.secondaryText}>Записать учеников</Text>
                </Pressable>
              )}
            </View>
          )
        })}
      </ResponsiveGrid>
      {consentFor && (
        <OrgConsentSheet
          workspaceId={workspaceId}
          org={consentFor.org}
          forChild={forChild}
          confirmLabel="Разрешить и записаться"
          onClosed={() => setConsentFor(null)}
          onGranted={(updated) => {
            orgs.mutate((prev) =>
              (prev ?? []).map((o) => (o.organizationId === updated.organizationId ? updated : o)),
            )
            void register(consentFor.event)
          }}
        />
      )}
      {pickerFor && (
        <OrgEventStudentsSheet
          workspaceId={workspaceId}
          eventId={pickerFor.id}
          title={pickerFor.title}
          onChanged={events.refetch}
          onClosed={() => setPickerFor(null)}
        />
      )}
    </View>
  )
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    section: { gap: theme.spacing(2) },
    title: { ...theme.typography.subheading, color: theme.colors.text },
    card: {
      flexGrow: 1,
      gap: theme.spacing(1),
      padding: theme.spacing(4),
      borderRadius: theme.radius.lg,
      backgroundColor: theme.colors.surfaceElevated,
      borderWidth: 1,
      borderColor: theme.colors.border,
      ...theme.shadows.sm,
    },
    cardTitle: { ...theme.typography.subheading, color: theme.colors.text },
    when: { fontSize: 13, color: theme.colors.text },
    muted: { fontSize: 12, color: theme.colors.muted },
    description: { fontSize: 13, color: theme.colors.text, marginTop: theme.spacing(1) },
    meta: { fontSize: 13, fontWeight: "600", color: theme.colors.text, marginTop: theme.spacing(1) },
    booked: { fontSize: 13, color: theme.colors.success, marginTop: theme.spacing(1) },
    caption: { fontSize: 12, color: theme.colors.muted, textAlign: "center" },
    button: {
      marginTop: theme.spacing(2),
      paddingVertical: theme.spacing(3),
      borderRadius: theme.radius.md,
      alignItems: "center",
      justifyContent: "center",
    },
    // Tonal: every event card carries one, so the list isn't a column of
    // filled buttons (same as the club's own events below).
    primary: { backgroundColor: theme.colors.accentSoft },
    primaryText: { color: theme.colors.accent, fontSize: 15, fontWeight: "700" },
    secondary: {
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
    },
    secondaryText: { color: theme.colors.text, fontSize: 15, fontWeight: "600" },
  })
