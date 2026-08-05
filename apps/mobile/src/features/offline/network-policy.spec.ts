/* eslint-disable import/first -- jest.mock must be hoisted above the imports
   it stubs, which is the standard jest ordering. */
// canDownloadNow guards the user's mobile data: it must refuse downloads when
// offline, and refuse on cellular when "Wi-Fi only" is set — but fail OPEN if
// the network probe itself throws (better to attempt than to wedge). Mock the
// network probe and the stored preference and pin every branch.

jest.mock("expo-network", () => ({
    NetworkStateType: { CELLULAR: "CELLULAR", WIFI: "WIFI", NONE: "NONE" },
    getNetworkStateAsync: jest.fn(),
}))

jest.mock("../profile/preferences-store", () => ({
    getPreferences: jest.fn(),
}))

import * as Network from "expo-network"

import {
    getPreferences,
    type Preferences,
} from "../profile/preferences-store"
import { canDownloadNow, networkPolicyMessage } from "./network-policy"

const mockNetworkState = jest.mocked(Network.getNetworkStateAsync)
const mockGetPreferences = jest.mocked(getPreferences)

const prefs = (wifiOnlyDownloads: boolean) =>
    ({ wifiOnlyDownloads }) as unknown as Preferences

const netState = (over: Partial<Network.NetworkState>) =>
    ({
        isConnected: true,
        isInternetReachable: true,
        type: Network.NetworkStateType.WIFI,
        ...over,
    }) as Network.NetworkState

beforeEach(() => {
    mockGetPreferences.mockResolvedValue(prefs(false))
})

describe("canDownloadNow", () => {
    it("refuses when the device is not connected", async () => {
        mockNetworkState.mockResolvedValue(netState({ isConnected: false }))
        expect(await canDownloadNow()).toEqual({ ok: false, reason: "offline" })
    })

    it("refuses when the internet is unreachable", async () => {
        mockNetworkState.mockResolvedValue(
            netState({ isInternetReachable: false }),
        )
        expect(await canDownloadNow()).toEqual({ ok: false, reason: "offline" })
    })

    it("refuses on cellular when Wi-Fi-only is on", async () => {
        mockGetPreferences.mockResolvedValue(prefs(true))
        mockNetworkState.mockResolvedValue(
            netState({ type: Network.NetworkStateType.CELLULAR }),
        )
        expect(await canDownloadNow()).toEqual({ ok: false, reason: "cellular" })
    })

    it("allows cellular when Wi-Fi-only is off", async () => {
        mockGetPreferences.mockResolvedValue(prefs(false))
        mockNetworkState.mockResolvedValue(
            netState({ type: Network.NetworkStateType.CELLULAR }),
        )
        expect(await canDownloadNow()).toEqual({ ok: true })
    })

    it("allows Wi-Fi even when Wi-Fi-only is on", async () => {
        mockGetPreferences.mockResolvedValue(prefs(true))
        mockNetworkState.mockResolvedValue(
            netState({ type: Network.NetworkStateType.WIFI }),
        )
        expect(await canDownloadNow()).toEqual({ ok: true })
    })

    it("fails open when the network probe throws", async () => {
        mockNetworkState.mockRejectedValue(new Error("probe failed"))
        expect(await canDownloadNow()).toEqual({ ok: true })
    })
})

describe("networkPolicyMessage", () => {
    it("explains the offline case", () => {
        expect(networkPolicyMessage("offline")).toMatch(/интернет/i)
    })

    it("explains the Wi-Fi-only case", () => {
        expect(networkPolicyMessage("cellular")).toMatch(/Wi-Fi/i)
    })
})
