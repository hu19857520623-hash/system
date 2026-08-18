import { applyDecorators, UseGuards } from '@nestjs/common'
import { Public } from './public.decorator'
import { OmsInternalTokenGuard } from '../guards/oms-internal-token.guard'

/** OMS 服务调用 ERP 的桥接接口：跳过 JWT，但必须携带内部令牌 */
export function OmsBridge() {
  return applyDecorators(Public(), UseGuards(OmsInternalTokenGuard))
}
