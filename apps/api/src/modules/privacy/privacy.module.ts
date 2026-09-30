import { Module } from '@nestjs/common';
import { AssessmentModule } from '../assessment';
import { ClassesModule } from '../classes';
import { GradingModule } from '../grading';
import { PaymentsModule } from '../payments';
import { PrivacyController } from './privacy.controller';
import { PrivacyService } from './privacy.service';

@Module({
  imports: [AssessmentModule, ClassesModule, GradingModule, PaymentsModule],
  controllers: [PrivacyController],
  providers: [PrivacyService],
})
export class PrivacyModule {}
