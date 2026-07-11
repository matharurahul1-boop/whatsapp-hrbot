import crypto from 'crypto';

/**
 * Signed, stateless workspace-invite tokens (HMAC-SHA256 over APP_SECRET).
 *
 * These exist so /api/auth/join never has to trust a client-supplied role —
 * only a token minted server-side by an admin/HR user (via
 * /api/organizations/invite) can grant anything above the default
 * "employee" role. No DB table needed: the signature + embedded expiry are
 * enough to make the token self-verifying and impossible to forge or edit.
 */

export type InviteRole = 'employee' | 'manager' | 'hr_assistant' | 'hr';

export interface InvitePayload {
  orgId: string;
  role:  InviteRole;
  exp:   number; // unix ms
}

const ROLES: InviteRole[] = ['employee', 'manager', 'hr_assistant', 'hr'];

function secret(): string {
  const s = process.env.APP_SECRET;
  if (!s) throw new Error('APP_SECRET is not configured');
  return s;
}

export function signInvite(orgId: string, role: InviteRole, ttlMs = 7 * 24 * 60 * 60 * 1000): string {
  const payload: InvitePayload = { orgId, role, exp: Date.now() + ttlMs };
  const body = Buffer.from(JSON.stringify(payload), 'utf-8').toString('base64url');
  const sig  = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifyInvite(token: string): InvitePayload | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts;

  const expected = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  } catch {
    return null; // length mismatch etc.
  }

  let payload: InvitePayload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf-8'));
  } catch {
    return null;
  }

  if (typeof payload.orgId !== 'string' || !ROLES.includes(payload.role)) return null;
  if (typeof payload.exp !== 'number' || Date.now() > payload.exp) return null;

  return payload;
}
