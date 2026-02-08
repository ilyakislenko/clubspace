declare module "plyr" {
  export interface Options {
    controls?: string[]
    settings?: string[]
    autoplay?: boolean
    keyboard?: {
      focused?: boolean
      global?: boolean
      seekTime?: number
    }
  }

  export default class Plyr {
    constructor(target: HTMLMediaElement, options?: Options)
    destroy(): void
  }
}
