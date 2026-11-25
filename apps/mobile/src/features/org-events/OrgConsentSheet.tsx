import React, { useState } from "react"
import { ActivityIndicator, StyleSheet, Text, View } from "react-native"

import {
  setMyOrganizationConsent,
  type MyClubOrganization,
} from "../../shared/api/organizations"
import { Pressable } from "../../shared/components/Pressable"
import { Sheet, useSheetAction } from "../../shared/components/Sheet"
import { errorMessage } from "../../shared/error-message"
import type { Theme } from "../../shared/theme"
import { useTheme, useThemedStyles } from "../../shared/theme-context"
import { consentSheetTitle } from "./org-helpers"

/**
 * The federation consent as the server words it (the edition it records),
 * shown before it is given: before the first registration for a federation
 * event («Разрешить и записаться») and from the Home card («Разрешить»).
 * Mounted by the caller; `onClosed` once it is gone, `onGranted` (after the
 * sheet closed) with the updated standing when the person agreed.
 */
export function OrgConsentSheet({
  workspaceId,
  org,
  forChild,
  confirmLabel,
  onGranted,
  onClosed,
}: {
  workspaceId: string
  org: MyClubOrganization
  forChild: boolean
  confirmLabel: string
  onGranted: (updated: MyClubOrganization) => void
  onClosed: () => void
}) {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const sheet = useSheetAction({ initiallyOpen: true, onClosed })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const grant = async () => {
    setBusy(true)
    setError(null)
    try {
      const updated = await setMyOrganizationConsent({
        workspaceId,
        organizationId: org.organizationId,
        granted: true,
      })
      sheet.run(() => onGranted(updated))
    } catch (e) {
      setError(errorMessage(e, "Не удалось сохранить согласие"))
      setBusy(false)
    }
  }

  return (
    <Sheet title={consentSheetTitle(forChild)} {...sheet.sheetProps}>
      <View style={styles.body}>
        <Text style={styles.text}>{org.consentText}</Text>
        {error && <Text style={styles.error}>{error}</Text>}
        <Pressable
          onPress={() => void grant()}
          disabled={busy}
          accessibilityRole="button"
          style={({ pressed }) => [styles.primary, pressed && styles.pressed]}
        >
          {busy ? (
            <ActivityIndicator color={theme.colors.accentText} />
          ) : (
            <Text style={styles.primaryText}>{confirmLabel}</Text>
          )}
        </Pressable>
      </View>
    </Sheet>
  )
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    body: { gap: theme.spacing(3) },
    text: { fontSize: 14, lineHeight: 20, color: theme.colors.text },
    error: { fontSize: 13, color: theme.colors.danger },
    primary: {
      paddingVertical: theme.spacing(3),
      borderRadius: theme.radius.md,
      backgroundColor: theme.colors.accent,
      alignItems: "center",
      justifyContent: "center",
    },
    primaryText: { color: theme.colors.accentText, fontSize: 15, fontWeight: "700" },
    pressed: { opacity: 0.85 },
  })
