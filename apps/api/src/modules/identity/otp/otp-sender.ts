import { Injectable, Logger } from '@nestjs/common';

export type OtpPurpose = 'verify_phone' | 'password_reset';

/**
 * Delivers one-time codes (REQ-AUTH-001: WhatsApp first, SMS fallback). Selected by OTP_PROVIDER.
 * Only the console sender exists so far; the WhatsApp and SMS senders are built once the
 * WhatsApp Business account is ready (open question OQ-19), and production refuses to start
 * without one (config.schema.ts).
 */
export abstract class OtpSender {
  abstract send(phoneE164: string, code: string, purpose: OtpPurpose): Promise<void>;
}

/**
 * Development and demo only: prints the code to the server console so a developer can enter it.
 * Writes to stdout directly because the structured logger masks phone numbers and codes by design.
 */
@Injectable()
export class ConsoleOtpSender extends OtpSender {
  private readonly logger = new Logger('ConsoleOtpSender');

  send(phoneE164: string, code: string, purpose: OtpPurpose): Promise<void> {
    const masked = `${phoneE164.slice(0, 5)}****${phoneE164.slice(-2)}`;
    process.stdout.write(`[dev OTP] ${purpose} for ${masked}: ${code}\n`);
    this.logger.log({ event: 'otp_sent', purpose, provider: 'console' });
    return Promise.resolve();
  }
}
