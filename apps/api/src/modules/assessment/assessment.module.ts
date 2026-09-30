import { Module, type OnModuleInit } from '@nestjs/common';
import { JobsRuntime } from '../../jobs';
import { ContentModule } from '../content';
import { GradingModule } from '../grading';
import { AttemptsService } from './attempts.service';
import { ExamsController } from './exams.controller';
import { CommentsController } from './comments.controller';
import { CommentsService } from './comments.service';
import { ExamsService } from './exams.service';
import { HomeworkController } from './homework.controller';
import { HomeworkService } from './homework.service';
import { QuestionsController } from './questions.controller';
import { QuestionsService } from './questions.service';
import { RegradeService } from './regrade.service';

@Module({
  imports: [ContentModule, GradingModule],
  controllers: [QuestionsController, ExamsController, HomeworkController, CommentsController],
  providers: [
    QuestionsService,
    ExamsService,
    AttemptsService,
    RegradeService,
    HomeworkService,
    CommentsService,
  ],
  exports: [QuestionsService, ExamsService, AttemptsService, HomeworkService],
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
