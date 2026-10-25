import React from "react"
import { ScrollView, StyleSheet, Text, View } from "react-native"

import { useAuth } from "../shared/auth-context"
import { brand } from "../shared/brand"
import { Pressable } from "../shared/components/Pressable"
import { canSeeClubInvite } from "../features/invite/invite-access"
import { isFeatureEnabled } from "../shared/feature-flags"
import { supportsOfflineDownload } from "../shared/platform"
import type { Theme } from "../shared/theme"
import { useThemedStyles } from "../shared/theme-context"
import { navigateToTab, navigationRef } from "./navigation"
import {
  NAV_GROUP_LABELS,
  SIDEBAR_SECTIONS,
  sectionLabel,
  visibleSections,
  type NavGroup,
} from "./nav-sections"
import { visibleTabs } from "./tab-routes"

const GROUP_ORDER: readonly NavGroup[] = [
  "training",
  "club",
  "progress",
  "account",
]

/**
 * The desktop navigation column.
 *
 * On a phone the bottom tabs lead to everything, with the less-used sections
 * a tap deeper (Home, Progress and Profile). That is the right shape for a
 * thumb and the wrong one for a 1440px browser window. On a wide viewport the
 * tab bar is hidden and the tabs plus every section move into a persistent
 * sidebar, so the whole app is one click away and the empty space does some
 * work.
 *
 * Web only. The width helpers in `shared/useResponsive.ts` are deliberately
 * width-driven, but a sidebar is a large enough change that switching it on for
 * native tablets deserves its own pass on a real device.
 */
export function DesktopSidebar({ activeRoute }: { activeRoute?: string }) {
  const styles = useThemedStyles(makeStyles)
  const { workspace } = useAuth()

  const tabs = visibleTabs((key) => isFeatureEnabled(workspace, key))
  const visible = visibleSections(
    SIDEBAR_SECTIONS,
    (key) => isFeatureEnabled(workspace, key),
    supportsOfflineDownload,
    canSeeClubInvite(workspace),
  )

  return (
    // Renders as a <nav> landmark on web, so a screen reader can jump to it.
    <View style={styles.sidebar} role="navigation" aria-label="Разделы">
      <View style={styles.brandBlock}>
        <Text style={styles.brandName} numberOfLines={1}>
          {workspace?.name ?? brand.displayName}
        </Text>
        <Text style={styles.brandTagline} numberOfLines={1}>
          {brand.tagline}
        </Text>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
      >
        <View style={styles.group}>
          {tabs.map((tab) => (
            <SidebarItem
              key={tab.name}
              label={tab.label}
              active={tab.name === activeRoute}
              onPress={() => navigateToTab(tab.name)}
            />
          ))}
        </View>
        {GROUP_ORDER.map((group) => {
          const items = visible.filter((section) => section.group === group)
          if (items.length === 0) return null
          return (
            <View key={group} style={styles.group}>
              <Text style={styles.groupLabel}>{NAV_GROUP_LABELS[group]}</Text>
              {items.map((section) => (
                <SidebarItem
                  key={section.route}
                  label={sectionLabel(section)}
                  active={section.route === activeRoute}
                  onPress={() => navigationRef.navigate(section.route)}
                />
              ))}
            </View>
          )
        })}
      </ScrollView>
    </View>
  )
}

function SidebarItem({
  label,
  active,
  onPress,
}: {
  label: string
  active: boolean
  onPress: () => void
}) {
  const styles = useThemedStyles(makeStyles)
  return (
    <Pressable
      onPress={onPress}
      // `aria-current="page"` is the ARIA for "this is the screen
      // you're on". react-native-web drops `accessibilityState`'s
      // `selected` on a button role (aria-selected isn't valid
      // there) and it's inert on native.
      aria-current={active ? "page" : undefined}
      style={[styles.item, active && styles.itemActive]}
    >
      <Text
        style={[styles.itemText, active && styles.itemTextActive]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </Pressable>
  )
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    sidebar: {
      width: 244,
      borderRightWidth: StyleSheet.hairlineWidth,
      borderRightColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
      paddingTop: theme.spacing(4),
    },
    brandBlock: {
      paddingHorizontal: theme.spacing(4),
      paddingBottom: theme.spacing(4),
    },
    brandName: {
      ...theme.typography.subheading,
      color: theme.colors.text,
    },
    brandTagline: {
      ...theme.typography.caption,
      color: theme.colors.muted,
      marginTop: theme.spacing(0.5),
    },
    scroll: { flex: 1 },
    scrollContent: { paddingBottom: theme.spacing(6) },
    group: { marginBottom: theme.spacing(4) },
    groupLabel: {
      ...theme.typography.label,
      color: theme.colors.muted,
      paddingHorizontal: theme.spacing(4),
      marginBottom: theme.spacing(1.5),
    },
    item: {
      paddingVertical: theme.spacing(2.5),
      paddingHorizontal: theme.spacing(4),
      marginHorizontal: theme.spacing(2),
      borderRadius: theme.radius.md,
    },
    itemActive: { backgroundColor: theme.colors.accentSoft },
    itemText: {
      ...theme.typography.body,
      color: theme.colors.textSecondary,
    },
    itemTextActive: {
      color: theme.colors.accent,
      fontWeight: "700",
    },
  })
