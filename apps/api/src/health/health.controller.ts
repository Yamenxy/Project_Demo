import { Controller, Get } from '@nestjs/common';
import { Public } from '../common/policy';

@Controller('health')
export class HealthController {
  @Get()
  @Public()
  check(): { status: 'ok' } {
    return { status: 'ok' };
  }
}
