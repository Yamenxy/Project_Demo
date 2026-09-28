import { Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { ZodPipe } from '../../common/http/zod.pipe';
import { Authenticated, CurrentSession, type SessionContext } from '../../common/policy';
import { NotificationsService, type NotificationView } from './notifications.service';

const listQuery = z.object({ before: z.iso.datetime().optional() });

/** The signed-in user's own notifications, across all their workspaces. */
@Controller('v1/notifications')
@Authenticated()
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(
    @CurrentSession() session: SessionContext,
    @Query(new ZodPipe(listQuery)) query: z.infer<typeof listQuery>,
  ): Promise<{ items: NotificationView[]; unread: number }> {
    return this.notifications.list(
      session.userId,
      query.before ? new Date(query.before) : undefined,
    );
  }

  @Post('read-all')
  @HttpCode(204)
  async readAll(@CurrentSession() session: SessionContext): Promise<void> {
    await this.notifications.markAllRead(session.userId);
  }

  @Post(':notificationId/read')
  @HttpCode(204)
  async read(
    @CurrentSession() session: SessionContext,
    @Param('notificationId', new ZodPipe(z.uuid())) notificationId: string,
  ): Promise<void> {
    await this.notifications.markRead(session.userId, notificationId);
  }
}
