import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { z } from 'zod';
import { ZodPipe } from '../../../common/http/zod.pipe';
import { Authenticated, CurrentSession, type SessionContext } from '../../../common/policy';
import { PushService } from './push.service';

const subscribeBody = z.object({
  endpoint: z.url({ protocol: /^https$/ }).max(1000),
  keys: z.object({ p256dh: z.string().min(20).max(200), auth: z.string().min(8).max(100) }),
});
const unsubscribeBody = z.object({ endpoint: z.string().max(1000) });

/** The signed-in user's push subscriptions (REQ-NOTIF-001). */
@Controller('v1/push')
@Authenticated()
export class PushController {
  constructor(private readonly push: PushService) {}

  /** The VAPID public key the browser subscribes with; null when push isn't set up. */
  @Get('key')
  key(): { publicKey: string | null } {
    return { publicKey: this.push.publicKey };
  }

  @Post('subscriptions')
  @HttpCode(204)
  async subscribe(
    @CurrentSession() session: SessionContext,
    @Body(new ZodPipe(subscribeBody)) body: z.infer<typeof subscribeBody>,
  ): Promise<void> {
    await this.push.subscribe(session.userId, {
      endpoint: body.endpoint,
      p256dh: body.keys.p256dh,
      auth: body.keys.auth,
    });
  }

  @Post('subscriptions/remove')
  @HttpCode(204)
  async unsubscribe(
    @CurrentSession() session: SessionContext,
    @Body(new ZodPipe(unsubscribeBody)) body: z.infer<typeof unsubscribeBody>,
  ): Promise<void> {
    await this.push.unsubscribe(session.userId, body.endpoint);
  }
}
