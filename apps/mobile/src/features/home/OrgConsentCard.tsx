import React, { useCallback, useEffect, useState } from "react"
import { StyleSheet, Text, View } from "react-native"

import { listMyClubOrganizations, type MyClubOrganization } from "../../shared/api/organizations"
import { useAuth } from "../../shared/auth-context"
import { useCachedResource } from "../../shared/cache/useCachedResource"
import { Pressable } from "../../shared/components/Pressable"
import { useToast } from "../../shared/components/Toast"
import { haptics } from "../../shared/haptics"
import { kvGet, kvSet } from "../../shared/kv"
import { profileKvKey } from "../../shared/profile-scope"
import type { Theme } from "../../shared/theme"
import { useThemedStyles } from "../../shared/theme-context"
import {
  consentCardBody,
  consentToast,
  federationLabel,
  pickConsentPrompt,
} from "../org-events/org-helpers"
import { OrgConsentSheet } from "../org-events/OrgConsentSheet"

// «Не сейчас» puts one federation off on this device, per profile.
const dismissKey = (organizationId: string, profileId: string | null) =>
  profileKvKey(`clubspace.orgConsentDismissed.${organizationId}`, profileId)

/**
 * Home, a member (or a guardian acting for a child) of a club in a federation
 * who has not decided yet: «Клуб вступил в федерацию …» → «Разрешить» (the
 * consent text in a sheet first, as in «События») / «Не сейчас». Asked once
 * per federation; the switch stays in the club's settings. Renders nothing
 * otherwise (no federation, decided, put off, or federations off on the
 * server).
 */
export function OrgConsentCard({ workspaceId }: { workspaceId: string }) {
  const styles = useThemedStyles(makeStyles)
  const { actingAs } = useAuth()
  const { showToast } = useToast()
  const profileId = actingAs?.id ?? null
  const orgs = useCachedResource(
    `my-orgs:${workspaceId}`,
    useCallback(async () => await listMyClubOrganizations({ workspaceId }), [workspaceId]),
  )
  const [dismissed, setDismissed] = useState<Set<string> | null>(null)
  const [asking, setAsking] = useState<MyClubOrganization | null>(null)

  const ids = (orgs.data ?? []).map((o) => o.organizationId).join(",")
  useEffect(() => {
    let alive = true
    const list = ids ? ids.split(",") : []
    void Promise.all(
      list.map(async (id) => ((await kvGet(dismissKey(id, profileId)).catch(() => null)) ? id : null)),
    ).then((hits) => {
      if (alive) setDismissed(new Set(hits.filter((h): h is string => h !== null)))
    })
    return () => {
      alive = false
    }
  }, [ids, profileId])

  const prompt = orgs.data && dismissed ? pickConsentPrompt(orgs.data, dismissed) : null
  const forChild = actingAs !== null
  const sheet = asking && (
    <OrgConsentSheet
      workspaceId={workspaceId}
      org={asking}
      forChild={forChild}
      confirmLabel="Разрешить"
      onClosed={() => setAsking(null)}
      onGranted={(updated) => {
        haptics.success()
        showToast(consentToast(true), "success")
        orgs.mutate((prev) =>
          (prev ?? []).map((o) => (o.organizationId === updated.organizationId ? updated : o)),
        )
      }}
    />
  )
  if (!prompt) return sheet || null

  const later = () => {
    setDismissed((prev) => new Set([...(prev ?? []), prompt.organizationId]))
    void kvSet(dismissKey(prompt.organizationId, profileId), "1").catch(() => undefined)
  }

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Клуб вступил в федерацию</Text>
      <Text style={styles.name}>{federationLabel(prompt.name)}</Text>
      <Text style={styles.body}>{consentCardBody(forChild)}</Text>
      <View style={styles.actions}>
        <Pressable
          onPress={() => setAsking(prompt)}
          accessibilityRole="button"
          style={({ pressed }) => [styles.primary, pressed && styles.pressed]}
        >
          <Text style={styles.primaryText}>Разрешить</Text>
        </Pressable>
        <Pressable onPress={later} accessibilityRole="button" hitSlop={8} style={styles.secondary}>
          <Text style={styles.secondaryText}>Не сейчас</Text>
        </Pressable>
      </View>
      {sheet}
    </View>
  )
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    card: {
      gap: 4,
      padding: theme.spacing(4),
      borderRadius: theme.radius.lg,
      backgroundColor: theme.colors.accentSoft,
    },
    title: { ...theme.typography.bodyStrong, color: theme.colors.text },
    name: { fontSize: 14, fontWeight: "600", color: theme.colors.text },
    body: { fontSize: 13, lineHeight: 18, color: theme.colors.textSecondary },
    actions: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing(4),
      marginTop: theme.spacing(2),
    },
    primary: {
      paddingVertical: theme.spacing(2),
      paddingHorizontal: theme.spacing(4),
      borderRadius: theme.radius.md,
      backgroundColor: theme.colors.accent,
      minWidth: 112,
      minHeight: 40,
      alignItems: "center",
      justifyContent: "center",
    },
    primaryText: { ...theme.typography.bodyStrong, color: theme.colors.accentText },
    secondary: { paddingVertical: theme.spacing(2) },
    secondaryText: { fontSize: 15, fontWeight: "600", color: theme.colors.textSecondary },
    pressed: { opacity: 0.85 },
  })
