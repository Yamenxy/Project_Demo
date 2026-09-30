import { Global, Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../config';
import { DisabledEmailSender, EmailSender, SmtpEmailSender } from './email/email-sender';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { PushController } from './push/push.controller';
import { DisabledPushSender, PushSender, WebPushSender } from './push/push-sender';
import { PushService } from './push/push.service';

/** Global: every module sends notifications (review §3.19). */
@Global()
@Module({
  controllers: [NotificationsController, PushController],
  providers: [
    NotificationsService,
    PushService,
    {
      provide: PushSender,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): PushSender =>
        config.push.provider === 'webpush'
          ? new WebPushSender(config.push.publicKey, config.push.privateKey, config.push.subject)
          : new DisabledPushSender(),
    },
    {
      provide: EmailSender,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): EmailSender =>
        config.email.provider === 'smtp'
          ? new SmtpEmailSender(config.email.smtpUrl, config.email.from)
          : new DisabledEmailSender(),
    },
  ],
  exports: [NotificationsService, PushService],
})
export class NotifyModule {}
