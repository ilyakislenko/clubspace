import React from "react"
import { StyleSheet, Text, type TextStyle, type StyleProp } from "react-native"

import type { Theme } from "../../shared/theme"
import { useThemedStyles } from "../../shared/theme-context"
import type { OfferPrice } from "./payment-helpers"

/** «~~4 000 ₽~~ 3 600 ₽»: the list price struck through when the amount is lower. */
export function OfferPriceText({
  offer,
  style,
}: {
  offer: OfferPrice
  style: StyleProp<TextStyle>
}) {
  const styles = useThemedStyles(makeStyles)
  return (
    <Text style={style}>
      {offer.listPrice !== null && (
        <Text style={styles.struck}>{offer.listPrice} </Text>
      )}
      {offer.amount}
    </Text>
  )
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    struck: {
      color: theme.colors.muted,
      fontWeight: "400",
      textDecorationLine: "line-through",
    },
  })
