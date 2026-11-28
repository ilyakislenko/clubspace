import { render, screen } from "@testing-library/react"
import React from "react"

import { JoinActions } from "../src/features/public-club/JoinActions"
import { readStoreLinks } from "../src/shared/lib/app-links"

const APK = "https://media.club.example/clubspace/downloads/clubspace.apk"

const renderActions = (env: Record<string, string>) =>
  render(
    <JoinActions code="ABCD2345" codeDisplay="ABCD-2345" links={readStoreLinks(env)} />,
  )

describe("JoinActions", () => {
  it("offers the stores and not the APK beside them", () => {
    renderActions({ PLAY_STORE_URL: "https://play.google.com/x", ANDROID_APK_URL: APK })
    expect(
      screen.getByRole("link", { name: "Google Play" }).getAttribute("target"),
    ).toBe("_blank")
    expect(screen.queryByRole("link", { name: "Скачать для Android" })).toBeNull()
  })

  it("downloads the APK in the same tab without a store", () => {
    renderActions({ ANDROID_APK_URL: APK })
    const apk = screen.getByRole("link", { name: "Скачать для Android" })
    expect(apk.getAttribute("href")).toBe(APK)
    expect(apk.getAttribute("target")).toBeNull()
  })

  it("offers the web app once, as «Открыть в браузере»", () => {
    renderActions({ PWA_URL: "https://pwa.club.example" })
    expect(screen.getAllByRole("link", { name: "Открыть в браузере" })).toHaveLength(1)
    expect(screen.queryByRole("link", { name: "Скачать для Android" })).toBeNull()
  })
})
