import { Module } from '@nestjs/common';
import { LedgerController } from './ledger.controller';
import { LedgerService } from './ledger.service';
import { PriceListController } from './price-list.controller';
import { PriceListService } from './price-list.service';

@Module({
  controllers: [PriceListController, LedgerController],
  providers: [PriceListService, LedgerService],
  exports: [PriceListService, LedgerService],
})
export class PaymentsModule {}
