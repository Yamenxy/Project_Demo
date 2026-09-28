import { OtpSender, type OtpPurpose } from '../../src/modules/identity';

/** Records codes instead of sending them, so tests can read the latest code for a phone. */
export class CapturingOtpSender extends OtpSender {
  readonly sent: { phoneE164: string; code: string; purpose: OtpPurpose }[] = [];

  send(phoneE164: string, code: string, purpose: OtpPurpose): Promise<void> {
    this.sent.push({ phoneE164, code, purpose });
    return Promise.resolve();
  }

  lastCode(phoneE164: string, purpose: OtpPurpose): string | undefined {
    return this.sent.filter((m) => m.phoneE164 === phoneE164 && m.purpose === purpose).at(-1)?.code;
  }
}
