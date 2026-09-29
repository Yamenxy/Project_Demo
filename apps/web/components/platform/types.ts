export type SubscriptionStatus = 'trial' | 'active' | 'grace' | 'lapsed';
export type Plan = 'starter' | 'growth' | 'pro';
export type PaymentMethod = 'cash' | 'instapay' | 'wallet' | 'bank_transfer' | 'fawry';

export const PLANS: Plan[] = ['starter', 'growth', 'pro'];
export const PAYMENT_METHODS: PaymentMethod[] = [
  'cash',
  'instapay',
  'wallet',
  'bank_transfer',
  'fawry',
];

export interface WorkspaceSummary {
  id: string;
  slug: string;
  name: string;
  ownerName: string;
  plan: Plan;
  periodEndsAt: string;
  status: SubscriptionStatus;
  suspension: 'billing' | 'admin' | null;
  members: Partial<Record<'owner' | 'class_teacher' | 'assistant' | 'student', number>>;
}

export interface PaymentView {
  id: string;
  amountPiastres: number;
  method: PaymentMethod;
  reference: string | null;
  paidOn: string;
  months: number;
}

export const STATUS_STYLE: Record<SubscriptionStatus, string> = {
  trial: 'bg-blue-50 text-blue-800',
  active: 'bg-green-50 text-green-800',
  grace: 'bg-amber-50 text-amber-800',
  lapsed: 'bg-red-50 text-red-800',
};
