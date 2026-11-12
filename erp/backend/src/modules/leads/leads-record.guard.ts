import { BadRequestException, type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common'
import { LeadsService } from './leads.service'

@Injectable()
export class LeadsRecordGuard implements CanActivate {
  constructor(private readonly leads: LeadsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest()
    const rawId = request.params?.id
    if (rawId === undefined) return true
    const id = Number(rawId)
    if (!/^[1-9]\d*$/.test(String(rawId)) || !Number.isSafeInteger(id)) {
      throw new BadRequestException('线索编号无效')
    }
    const handler = context.getHandler().name
    await this.leads.assertRecordAccess(id, request.user,
      request.method === 'GET' ? 'read' : handler === 'addFollowUp' ? 'follow'
        : handler === 'updateFollowUp' ? 'history' : handler === 'correct' ? 'correct' : 'write')
    return true
  }
}
