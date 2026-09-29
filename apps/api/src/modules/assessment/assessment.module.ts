import { Module, type OnModuleInit } from '@nestjs/common';
import { JobsRuntime } from '../../jobs';
import { ContentModule } from '../content';
import { GradingModule } from '../grading';
import { AttemptsService } from './attempts.service';
import { ExamsController } from './exams.controller';
import { ExamsService } from './exams.service';
import { QuestionsController } from './questions.controller';
import { QuestionsService } from './questions.service';
import { RegradeService } from './regrade.service';

@Module({
  imports: [ContentModule, GradingModule],
  controllers: [QuestionsController, ExamsController],
  providers: [QuestionsService, ExamsService, AttemptsService, RegradeService],
  exports: [QuestionsService, ExamsService, AttemptsService],
})
export class AssessmentModule implements OnModuleInit {
  constructor(
    private readonly jobs: JobsRuntime,
    private readonly attempts: AttemptsService,
  ) {}

  onModuleInit(): void {
    // Closes attempts whose time is up, within a minute (REQ-EXAM-002).
    this.jobs.register(
      'exam.sweep',
      async () => {
        await this.attempts.sweep();
      },
      '* * * * *',
    );
  }
}
