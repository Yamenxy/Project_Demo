import { Module } from '@nestjs/common';
import { CashController } from './cash.controller';
import { CashService } from './cash.service';
import { LedgerController } from './ledger.controller';
import { LedgerService } from './ledger.service';
import { PriceListController } from './price-list.controller';
import { PaymentRequestsController } from './requests.controller';
import { PaymentRequestsService } from './requests.service';
import { PriceListService } from './price-list.service';

@Module({
  controllers: [PriceListController, LedgerController, PaymentRequestsController, CashController],
  providers: [PriceListService, LedgerService, PaymentRequestsService, CashService],
  exports: [PriceListService, LedgerService],
})
export class PaymentsModule {}
