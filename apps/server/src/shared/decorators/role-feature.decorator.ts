import { Reflector } from '@nestjs/core'
import { RoleFeaturesEnum } from '../interfaces/shared.intefaces'

export const RoleFeature = Reflector.createDecorator<RoleFeaturesEnum>()
