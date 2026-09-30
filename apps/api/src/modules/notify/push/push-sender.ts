import webpush from 'web-push';

export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushMessage {
  title: string;
  body: string;
  /** Path in the web app to open on tap. */
  url: string;
}

/** 'gone': the browser dropped the subscription (404 or 410); delete it. */
export type PushResult = 'sent' | 'gone';

/** Web push behind an adapter (REQ-OPS-004): the standard protocol, or nothing. */
export abstract class PushSender {
  abstract readonly publicKey: string | null;
  abstract send(target: PushTarget, message: PushMessage): Promise<PushResult>;
}

export class DisabledPushSender extends PushSender {
  readonly publicKey = null;

  send(): Promise<PushResult> {
    return Promise.reject(new Error('Push is not configured'));
  }
}

/** VAPID-signed, encrypted Web Push (RFC 8030, 8291, 8292) through the `web-push` library. */
export class WebPushSender extends PushSender {
  constructor(
    readonly publicKey: string,
    private readonly privateKey: string,
    private readonly subject: string,
  ) {
    super();
  }

  async send(target: PushTarget, message: PushMessage): Promise<PushResult> {
    try {
      await webpush.sendNotification(
        { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
        JSON.stringify(message),
        {
          vapidDetails: {
            subject: this.subject,
            publicKey: this.publicKey,
            privateKey: this.privateKey,
          },
          TTL: 24 * 3600,
          urgency: 'normal',
        },
      );
      return 'sent';
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) return 'gone';
      throw err;
    }
  }
}
