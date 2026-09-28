import { Global, Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../config';
import { DisabledEmailSender, EmailSender, SmtpEmailSender } from './email/email-sender';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

/** Global: every module sends notifications (review §3.19). */
@Global()
@Module({
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    {
      provide: EmailSender,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): EmailSender =>
        config.email.provider === 'smtp'
          ? new SmtpEmailSender(config.email.smtpUrl, config.email.from)
          : new DisabledEmailSender(),
    },
  ],
  exports: [NotificationsService],
})
export class NotifyModule {}
