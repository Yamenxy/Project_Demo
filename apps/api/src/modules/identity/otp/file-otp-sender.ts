import { appendFile } from 'node:fs/promises';
import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../../config';
import { OtpSender, type OtpPurpose } from './otp-sender';

/**
 * Development and demo only: appends each code as a JSON line to OTP_OUTBOX_FILE, so browser
 * tests and demo presenters can read it. Refused in production by the config schema.
 */
@Injectable()
export class FileOtpSender extends OtpSender {
  private readonly file: string;

  constructor(@Inject(APP_CONFIG) config: Pick<AppConfig, 'otpOutboxFile'>) {
    super();
    if (!config.otpOutboxFile) throw new Error('OTP_OUTBOX_FILE is required for the file sender');
    this.file = config.otpOutboxFile;
  }

  async send(phoneE164: string, code: string, purpose: OtpPurpose): Promise<void> {
    const line = JSON.stringify({ phoneE164, purpose, code, at: new Date().toISOString() });
    await appendFile(this.file, `${line}\n`, 'utf8');
  }
}
