import { Module } from '@nestjs/common'
import { OperatingLedgerController } from './operating-ledger.controller'
import { OperatingLedgerService } from './operating-ledger.service'

@Module({
  controllers: [OperatingLedgerController],
  providers: [OperatingLedgerService],
})
export class OperatingLedgerModule {}
