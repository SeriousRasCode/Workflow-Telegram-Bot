import crypto from 'crypto';
import { config } from '../config.js';

/**
 * Verify GitHub webhook signature against HMAC SHA-256.
 *
 * @param signatureHeader The `x-hub-signature-256` header from GitHub.
 * @param rawBody The raw payload buffer or string.
 * @param secret The webhook secret configured in GitHub.
 */
export function verifyGitHubSignature(
  signatureHeader: string | undefined,
  rawBody: Buffer | string,
  secret: string = config.webhookSecret
): boolean {
  if (!secret) {
    return false;
  }

  if (!signatureHeader) {
    return false;
  }

  const parts = signatureHeader.split('=');
  if (parts.length !== 2 || parts[0] !== 'sha256') {
    return false;
  }

  const expectedSignature = parts[1];
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(typeof rawBody === 'string' ? Buffer.from(rawBody, 'utf-8') : rawBody);
  const calculatedSignature = hmac.digest('hex');

  const expectedBuffer = Buffer.from(expectedSignature, 'utf-8');
  const calculatedBuffer = Buffer.from(calculatedSignature, 'utf-8');

  if (expectedBuffer.length !== calculatedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedBuffer, calculatedBuffer);
}
