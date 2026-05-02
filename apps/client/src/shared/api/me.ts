import { getApiClient } from "./client"

export type Me = {
  id: string
  email: string
  firstname?: string | null
  lastname?: string | null
  profilePhotoUrl?: string | null
  language: string
  createdAt: string
}

export const fetchMe = async () => {
  return await getApiClient().request<Me>({
    method: "get",
    url: "/me",
  })
}
