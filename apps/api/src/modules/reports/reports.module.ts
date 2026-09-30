import { Module } from '@nestjs/common';
import { ClassesModule } from '../classes';
import { GradingModule } from '../grading';
import { PaymentsModule } from '../payments';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({
  imports: [ClassesModule, GradingModule, PaymentsModule],
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
