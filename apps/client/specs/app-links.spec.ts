import {
  apiBaseUrl,
  appJoinUrl,
  buildAppleAppSiteAssociation,
  buildAssetLinks,
  pwaJoinUrl,
  readStoreLinks,
} from "../src/shared/lib/app-links"

describe("readStoreLinks", () => {
  it("treats unset and blank values as not configured", () => {
    expect(readStoreLinks({ APP_STORE_URL: "  ", PLAY_STORE_URL: "" })).toEqual({
      appStore: null,
      googlePlay: null,
      ruStore: null,
      pwa: null,
    })
  })

  it("passes configured links through and trims the PWA slash", () => {
    const links = readStoreLinks({
      APP_STORE_URL: "https://apps.apple.com/app/id1",
      RUSTORE_URL: "https://rustore.ru/x",
      PWA_URL: "https://pwa.club.example/",
    })
    expect(links.appStore).toBe("https://apps.apple.com/app/id1")
    expect(links.ruStore).toBe("https://rustore.ru/x")
    expect(pwaJoinUrl(links, "ABCD2345")).toBe(
      "https://pwa.club.example/join/ABCD2345",
    )
  })

  it("has no browser link without a PWA", () => {
    expect(pwaJoinUrl(readStoreLinks({}), "ABCD2345")).toBeNull()
  })
})

describe("appJoinUrl", () => {
  it("uses the clubspace scheme", () => {
    expect(appJoinUrl("ABCD2345")).toBe("clubspace://join/ABCD2345")
  })
})

describe("apiBaseUrl", () => {
  it("prefers the internal address", () => {
    expect(
      apiBaseUrl({
        API_INTERNAL_URL: "http://server:3000/",
        NEXT_PUBLIC_API_URL: "https://api.x",
      }),
    ).toBe("http://server:3000")
  })

  it("falls back to the public address", () => {
    expect(apiBaseUrl({ NEXT_PUBLIC_API_URL: "https://api.x" })).toBe(
      "https://api.x",
    )
  })
})

describe("buildAppleAppSiteAssociation", () => {
  it("is null until the team and a bundle are set", () => {
    expect(buildAppleAppSiteAssociation({ APPLE_TEAM_ID: "TEAM" })).toBeNull()
    expect(
      buildAppleAppSiteAssociation({ IOS_BUNDLE_ID: "com.clubspace.app" }),
    ).toBeNull()
  })

  it("claims /join/* for every bundle in both formats", () => {
    const aasa = buildAppleAppSiteAssociation({
      APPLE_TEAM_ID: "ABCDE12345",
      IOS_BUNDLE_ID: "com.clubspace.app, com.myclub.app",
    })
    expect(aasa).toEqual({
      applinks: {
        apps: [],
        details: [
          {
            appIDs: [
              "ABCDE12345.com.clubspace.app",
              "ABCDE12345.com.myclub.app",
            ],
            components: [{ "/": "/join/*" }],
          },
          { appID: "ABCDE12345.com.clubspace.app", paths: ["/join/*"] },
          { appID: "ABCDE12345.com.myclub.app", paths: ["/join/*"] },
        ],
      },
    })
  })
})

describe("buildAssetLinks", () => {
  it("is null until a package and a fingerprint are set", () => {
    expect(buildAssetLinks({ ANDROID_PACKAGE: "com.clubspace.app" })).toBeNull()
  })

  it("declares every fingerprint for every package", () => {
    expect(
      buildAssetLinks({
        ANDROID_PACKAGE: "com.clubspace.app,com.myclub.app",
        ANDROID_CERT_SHA256: "aa:bb,CC:DD",
      }),
    ).toEqual([
      {
        relation: ["delegate_permission/common.handle_all_urls"],
        target: {
          namespace: "android_app",
          package_name: "com.clubspace.app",
          sha256_cert_fingerprints: ["AA:BB", "CC:DD"],
        },
      },
      {
        relation: ["delegate_permission/common.handle_all_urls"],
        target: {
          namespace: "android_app",
          package_name: "com.myclub.app",
          sha256_cert_fingerprints: ["AA:BB", "CC:DD"],
        },
      },
    ])
  })
})
