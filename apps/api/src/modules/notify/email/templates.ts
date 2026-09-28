/**
 * Email texts, in Arabic and English. Only notification types listed here are emailed.
 * The account's language preference arrives with profile settings; until then Arabic comes first
 * and English follows in the same message.
 */
type Params = Record<string, string | number | boolean>;

interface Template {
  subject: { ar: string; en: string };
  body: (params: Params) => { ar: string; en: string };
}

const TEMPLATES: Record<string, Template> = {
  'account.two_factor_enabled': {
    subject: { ar: 'تم تفعيل التحقق بخطوتين', en: 'Two-step verification turned on' },
    body: () => ({
      ar: 'تم تفعيل التحقق بخطوتين على حسابك. إن لم تفعل ذلك، تواصل مع الدعم فورًا.',
      en: "Two-step verification was turned on for your account. If this wasn't you, contact support now.",
    }),
  },
  'account.password_reset': {
    subject: { ar: 'تم تغيير كلمة المرور', en: 'Your password was changed' },
    body: () => ({
      ar: 'تم تغيير كلمة مرور حسابك وتسجيل خروجك من كل الأجهزة. إن لم تفعل ذلك، تواصل مع الدعم فورًا.',
      en: "Your password was changed and you were signed out everywhere. If this wasn't you, contact support now.",
    }),
  },
};

export function hasEmailTemplate(type: string): boolean {
  return Object.hasOwn(TEMPLATES, type);
}

export function renderEmail(type: string, params: Params): { subject: string; text: string } {
  const template = TEMPLATES[type];
  if (!template) throw new Error(`No email template for ${type}`);
  const body = template.body(params);
  return {
    subject: `${template.subject.ar} | ${template.subject.en}`,
    text: `${body.ar}\n\n---\n\n${body.en}\n`,
  };
}
