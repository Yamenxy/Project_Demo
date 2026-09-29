import { Module } from '@nestjs/common';
import { AttendanceController } from './attendance.controller';
import { AttendanceService } from './attendance.service';
import { ClassesController } from './classes.controller';
import { ClassesService } from './classes.service';
import { ScheduleController } from './schedule.controller';
import { ScheduleService } from './schedule.service';

@Module({
  controllers: [ClassesController, ScheduleController, AttendanceController],
  providers: [ClassesService, ScheduleService, AttendanceService],
  exports: [ClassesService, ScheduleService],
})
export class ClassesModule {}
