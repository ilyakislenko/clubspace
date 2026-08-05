import { useWindowDimensions } from "react-native"

// Width breakpoints. These are deliberately width-driven (not platform-driven):
// a phone is always narrow so native keeps its current layout untouched, while
// a desktop browser or a tablet in landscape opts into the roomier layouts.
export const BP_TABLET = 700
export const BP_DESKTOP = 1024
// Below this there isn't enough room for side-by-side (video + panel) layouts.
export const BP_WIDE = 900

/**
 * Cap for a control that's meant to fill the width of a phone screen — a
 * segmented toggle, a primary submit button, a code field.
 *
 * Like `CenteredColumn`, this is deliberately unconditional: a phone's content
 * column is narrower than this, so the cap is a no-op there and the layout stays
 * byte-for-byte the mobile one. On a desktop browser it stops a two-option
 * toggle from becoming two 426px slabs.
 */
export const CONTROL_MAX_WIDTH = 420

export type Breakpoint = "mobile" | "tablet" | "desktop"

export type Responsive = {
  width: number
  height: number
  breakpoint: Breakpoint
  isMobile: boolean
  isTablet: boolean
  isDesktop: boolean
  // Enough horizontal room for two-column / side-panel layouts.
  isWide: boolean
  // Width to cap a centered reading column at on big screens (full width on phones).
  contentMaxWidth: number
}

export const useResponsive = (): Responsive => {
  const { width, height } = useWindowDimensions()
  const isDesktop = width >= BP_DESKTOP
  const isTablet = !isDesktop && width >= BP_TABLET
  const isMobile = !isDesktop && !isTablet
  return {
    width,
    height,
    breakpoint: isDesktop ? "desktop" : isTablet ? "tablet" : "mobile",
    isMobile,
    isTablet,
    isDesktop,
    isWide: width >= BP_WIDE,
    contentMaxWidth: isDesktop ? 960 : width,
  }
}
