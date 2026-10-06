/**
 * Auth validator schemas.
 *
 * Whatever is not declared here is silently dropped before it reaches the
 * service (Zod strips unknown keys), which is the first line of defence against
 * a client "upgrading" itself by sending `role: 'ADMIN'` or `status:
 * 'ACTIVE'`. The service still never writes privileged fields, but it must
 * never even see them.
 */
import { z } from 'zod';
import { emailSchema, shortTextSchema } from './common.schema.js';

/**
 * Phone numbers match the database CHECK: digits only, an optional leading +,
 * 9-15 characters. ETB convention (09... / +251...) falls inside this range.
 */
export const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+?[0-9]{9,15}$/, 'Enter a valid phone number (digits only, 9-15, e.g. 0911000000)');

/**
 * Strong passwords: at least 8 characters and one of each class. Each rule is
 * its own message so the form can show the shopper exactly which check failed.
 */
export const passwordSchema = z
  .string()
  .min(8, { message: 'Password must be at least 8 characters' })
  .max(128, { message: 'Password must be at most 128 characters' })
  .regex(/[a-z]/, { message: 'Password must include a lowercase letter' })
  .regex(/[A-Z]/, { message: 'Password must include an uppercase letter' })
  .regex(/[0-9]/, { message: 'Password must include a number' })
  .regex(/[^A-Za-z0-9]/, { message: 'Password must include a symbol' });

const passwordConfirmation = z.string().min(1, { message: 'Please re-enter your password' });

export const registerSchema = z
  .object({
    name: z.string().trim().min(2, { message: 'Name must be at least 2 characters' }).max(120),
    email: emailSchema,
    phone: phoneSchema,
    password: passwordSchema,
    passwordConfirmation,
  })
  .refine((data) => data.password === data.passwordConfirmation, {
    message: 'Passwords do not match',
    path: ['passwordConfirmation'],
  });

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, { message: 'Enter your password' }),
});

/** Profile edits. Email is the login identifier, so it is intentionally absent. */
export const profileUpdateSchema = z
  .object({
    name: shortTextSchema(120),
    phone: phoneSchema,
  })
  .partial()
  .refine((data) => data.name !== undefined || data.phone !== undefined, {
    message: 'Provide at least one field to update',
    path: ['_root'],
  });

export const passwordChangeSchema = z
  .object({
    currentPassword: z.string().min(1, { message: 'Enter your current password' }),
    newPassword: passwordSchema,
    newPasswordConfirmation: passwordConfirmation,
  })
  .refine((data) => data.newPassword === data.newPasswordConfirmation, {
    message: 'Passwords do not match',
    path: ['newPasswordConfirmation'],
  });

/** Delivery address fields (matches `addresses` with an id-less body). */
export const addressSchema = z.object({
  label: shortTextSchema(60),
  full_name: shortTextSchema(120),
  phone: phoneSchema,
  city: shortTextSchema(80),
  area: shortTextSchema(80),
  street: shortTextSchema(160),
  landmark: shortTextSchema(160).optional(),
  additional_notes: z.string().trim().max(1000).optional(),
});

export const createAddressSchema = addressSchema;

export const updateAddressSchema = addressSchema
  .partial()
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Provide at least one field to update',
    path: ['_root'],
  });

export const addressIdParamSchema = z.object({
  id: z.string().uuid({ message: 'Address id must be a valid UUID' }),
});

export default {
  registerSchema,
  loginSchema,
  profileUpdateSchema,
  passwordChangeSchema,
  createAddressSchema,
  updateAddressSchema,
  addressIdParamSchema,
  phoneSchema,
  passwordSchema,
};
