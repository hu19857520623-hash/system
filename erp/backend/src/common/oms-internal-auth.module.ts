import { Global, Module } from '@nestjs/common'
import { OmsInternalTokenGuard } from './guards/oms-internal-token.guard'

@Global()
@Module({
  providers: [OmsInternalTokenGuard],
  exports: [OmsInternalTokenGuard],
})
export class OmsInternalAuthModule {}
