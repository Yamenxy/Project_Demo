import { Controller, Delete, Get, HttpCode, Param, Req, UseGuards } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ZodPipe } from '../../../common/http/zod.pipe';
import { metaOf } from '../request-meta';
import { DEVICE_COOKIE } from '../session-cookie';
import { CurrentSession, SessionGuard } from '../session.guard';
import type { ResolvedSession } from '../sessions.service';
import { DevicesService, type DeviceSummary } from './devices.service';

/** The signed-in user's own devices (REQ-AUTH-005, UX-09). */
@Controller('v1/auth/devices')
@UseGuards(SessionGuard)
export class DevicesController {
  constructor(private readonly devices: DevicesService) {}

  @Get()
  async list(
    @CurrentSession() session: ResolvedSession,
    @Req() request: FastifyRequest,
  ): Promise<{ devices: DeviceSummary[] }> {
    return { devices: await this.devices.list(session.userId, request.cookies[DEVICE_COOKIE]) };
  }

  @Delete(':deviceId')
  @HttpCode(204)
  async revoke(
    @CurrentSession() session: ResolvedSession,
    @Param('deviceId', new ZodPipe(z.uuid())) deviceId: string,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    await this.devices.revokeOwn(session.userId, deviceId, metaOf(request));
  }
}
