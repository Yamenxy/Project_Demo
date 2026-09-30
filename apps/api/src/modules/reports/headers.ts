/**
 * Column headers for CSV exports. Files leave the app, so their text comes from the API, in the
 * language the user asked for (like email templates), not from the web app's message files.
 */
import type { PaymentMethod } from '../payments';

export const LANGS = ['ar', 'en'] as const;
export type Lang = (typeof LANGS)[number];

interface Headers {
  student: string;
  average: string;
  present: string;
  late: string;
  absent: string;
  excused: string;
  ratePercent: string;
  receipt: string;
  date: string;
  amount: string;
  currency: string;
  method: string;
  item: string;
  collector: string;
  kind: string;
  note: string;
  payment: string;
  reversal: string;
  payments: string;
  collected: string;
  handedConfirmed: string;
  handedPending: string;
  handedRejected: string;
  methods: Record<PaymentMethod, string>;
}

export const HEADERS: Record<Lang, Headers> = {
  ar: {
    student: 'الطالب',
    average: 'المتوسط %',
    present: 'حاضر',
    late: 'متأخر',
    absent: 'غائب',
    excused: 'بعذر',
    ratePercent: 'نسبة الحضور %',
    receipt: 'رقم الإيصال',
    date: 'التاريخ',
    amount: 'المبلغ',
    currency: 'العملة',
    method: 'طريقة الدفع',
    item: 'البند',
    collector: 'المحصِّل',
    kind: 'النوع',
    note: 'ملاحظة',
    payment: 'دفعة',
    reversal: 'قيد عكسي',
    payments: 'عدد الدفعات',
    collected: 'المحصَّل',
    handedConfirmed: 'سُلِّم (مؤكد)',
    handedPending: 'سُلِّم (بانتظار التأكيد)',
    handedRejected: 'تسليم مرفوض',
    methods: {
      cash: 'نقدي',
      transfer: 'تحويل',
      wallet: 'محفظة',
      other: 'أخرى',
    },
  },
  en: {
    student: 'Student',
    average: 'Average %',
    present: 'Present',
    late: 'Late',
    absent: 'Absent',
    excused: 'Excused',
    ratePercent: 'Attendance %',
    receipt: 'Receipt',
    date: 'Date',
    amount: 'Amount',
    currency: 'Currency',
    method: 'Method',
    item: 'Item',
    collector: 'Collected by',
    kind: 'Kind',
    note: 'Note',
    payment: 'Payment',
    reversal: 'Reversal',
    payments: 'Payments',
    collected: 'Collected',
    handedConfirmed: 'Handed over (confirmed)',
    handedPending: 'Handed over (pending)',
    handedRejected: 'Handover rejected',
    methods: {
      cash: 'Cash',
      transfer: 'Transfer',
      wallet: 'Wallet',
      other: 'Other',
    },
  },
};
