import { Module } from '@nestjs/common';
import { ClassesController } from './classes.controller';
import { ClassesService } from './classes.service';
import { ScheduleController } from './schedule.controller';
import { ScheduleService } from './schedule.service';

@Module({
  controllers: [ClassesController, ScheduleController],
  providers: [ClassesService, ScheduleService],
  exports: [ClassesService, ScheduleService],
})
export class ClassesModule {}
