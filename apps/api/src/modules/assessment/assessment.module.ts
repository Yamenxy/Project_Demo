import { Module } from '@nestjs/common';
import { ContentModule } from '../content';
import { QuestionsController } from './questions.controller';
import { QuestionsService } from './questions.service';

@Module({
  imports: [ContentModule],
  controllers: [QuestionsController],
  providers: [QuestionsService],
  exports: [QuestionsService],
})
export class AssessmentModule {}
