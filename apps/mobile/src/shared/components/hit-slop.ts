import type { Insets, ViewStyle } from "react-native"

/**
 * react-native-web ignores `hitSlop`. On native it quietly grows a small
 * control's touch target; in a browser it does nothing at all, so the app's
 * icon-sized buttons were exactly as tall as their glyph — the check-in screen's
 * "‹ Назад" was a 13px-high target, well under the ~44px every platform's
 * guidelines ask for.
 *
 * The fix is the standard one: turn the slop into padding, and cancel it with a
 * matching negative margin so the control occupies the same visual box as
 * before. Applied per axis, and only where the caller hasn't set its own
 * padding — a control that already pads itself has a real target and must keep
 * the box model it was written with.
 */

type Slop = { top: number; bottom: number; left: number; right: number }

export const normalizeHitSlop = (
  hitSlop: number | Insets | null | undefined,
): Slop | null => {
  if (hitSlop == null) return null
  if (typeof hitSlop === "number") {
    if (hitSlop <= 0) return null
    return { top: hitSlop, bottom: hitSlop, left: hitSlop, right: hitSlop }
  }
  const slop = {
    top: hitSlop.top ?? 0,
    bottom: hitSlop.bottom ?? 0,
    left: hitSlop.left ?? 0,
    right: hitSlop.right ?? 0,
  }
  return slop.top || slop.bottom || slop.left || slop.right ? slop : null
}

const hasVerticalPadding = (style: ViewStyle): boolean =>
  style.padding !== undefined ||
  style.paddingVertical !== undefined ||
  style.paddingTop !== undefined ||
  style.paddingBottom !== undefined ||
  style.paddingBlock !== undefined

const hasHorizontalPadding = (style: ViewStyle): boolean =>
  style.padding !== undefined ||
  style.paddingHorizontal !== undefined ||
  style.paddingLeft !== undefined ||
  style.paddingRight !== undefined ||
  style.paddingInline !== undefined

/**
 * The style that grows a pressable's target by its hitSlop without moving it.
 * `null` when there's nothing to do.
 */
export const webHitSlopStyle = (
  hitSlop: number | Insets | null | undefined,
  resolvedStyle: ViewStyle | null | undefined,
): ViewStyle | null => {
  const slop = normalizeHitSlop(hitSlop)
  if (!slop) return null

  const style = resolvedStyle ?? {}
  const out: ViewStyle = {}
  if (!hasVerticalPadding(style)) {
    out.paddingTop = slop.top
    out.paddingBottom = slop.bottom
    out.marginTop = -slop.top
    out.marginBottom = -slop.bottom
  }
  if (!hasHorizontalPadding(style)) {
    out.paddingLeft = slop.left
    out.paddingRight = slop.right
    out.marginLeft = -slop.left
    out.marginRight = -slop.right
  }
  return Object.keys(out).length > 0 ? out : null
}
