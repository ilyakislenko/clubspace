import { Reflector } from '@nestjs/core'
import { TfaRequestGroupEnum } from '../../domains/tfa/interfaces/tfa.interfaces'

export const TfaGroup = Reflector.createDecorator<TfaRequestGroupEnum>()
