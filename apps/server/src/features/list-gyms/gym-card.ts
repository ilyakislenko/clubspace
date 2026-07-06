// Shared shape for a gym list item, used by list-gyms and the realtime deltas
// the create/update handlers emit — so a delta injects exactly what a refetch
// would. `groupCount` is the number of groups training at the gym.
export const serializeGymCard = (
    gym: {
        id: string
        name: string
        address: string
        timezone: string | null
        lat: number | null
        lng: number | null
        createdAt: Date
    },
    groupCount: number,
) => ({
    id: gym.id,
    name: gym.name,
    address: gym.address,
    timezone: gym.timezone,
    lat: gym.lat,
    lng: gym.lng,
    groupCount,
    createdAt: gym.createdAt.toISOString(),
})
