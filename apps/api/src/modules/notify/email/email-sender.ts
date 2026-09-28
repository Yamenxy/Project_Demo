import { Logger } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

/**
 * Sends transactional email (teachers and owners: account, billing, security; review §3.19).
 * Selected by EMAIL_PROVIDER. An HTTP provider such as Resend is added as another sender when the
 * production setup is chosen (architecture §8.3).
 */
export abstract class EmailSender {
  abstract send(message: EmailMessage): Promise<void>;
}

/** SMTP: Mailpit locally, or any SMTP relay. */
export class SmtpEmailSender extends EmailSender {
  private readonly transport: Transporter;

  constructor(
    smtpUrl: string,
    private readonly from: string,
  ) {
    super();
    this.transport = createTransport(smtpUrl);
  }

  async send(message: EmailMessage): Promise<void> {
    await this.transport.sendMail({ from: this.from, ...message });
  }
}

/** EMAIL_PROVIDER=none: email is switched off; the in-app notification still exists. */
export class DisabledEmailSender extends EmailSender {
  private readonly logger = new Logger('Email');

  send(): Promise<void> {
    this.logger.log({ event: 'email_skipped', reason: 'EMAIL_PROVIDER=none' });
    return Promise.resolve();
  }
}
