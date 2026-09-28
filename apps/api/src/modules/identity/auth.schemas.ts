import { z } from 'zod';

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
  });

/** Base account registration. Student-specific fields and consent arrive with Phase 2. */
export const registerBody = z.object({
  nameAr: z.string().trim().min(2).max(120),
  phone: z.string().min(1).max(40),
  password: z.string().min(1).max(256),
  email: z.email().max(254).optional(),
  dateOfBirth: isoDate.optional(),
  rememberMe: z.boolean().default(false),
});
export type RegisterBody = z.infer<typeof registerBody>;

export const loginBody = z.object({
  /** Phone number (any common format) or email address. */
  identifier: z.string().trim().min(1).max(254),
  password: z.string().min(1).max(256),
  rememberMe: z.boolean().default(false),
});
export type LoginBody = z.infer<typeof loginBody>;

export interface UserSummary {
  id: string;
  nameAr: string;
  platformCode: string;
  status: string;
  phoneVerified: boolean;
}
