import crypto from 'node:crypto';

const secret = process.env.SESSION_SECRET || 'development-secret-change-me';
const encoder = new TextEncoder();

function b64url(input) {
  return Buffer.from(input).toString('base64url');
}

function fromB64url(input) {
  return Buffer.from(input, 'base64url').toString('utf8');
}

export function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

export function hashPassword(password, salt = crypto.randomBytes(16).toString('base64url')) {
  const hash = crypto.pbkdf2Sync(password, salt, 310000, 32, 'sha256').toString('base64url');
  return `pbkdf2_sha256$310000$${salt}$${hash}`;
}

export function verifyPassword(password, storedHash) {
  const [algorithm, iterations, salt, hash] = String(storedHash || '').split('$');
  if (algorithm !== 'pbkdf2_sha256' || !iterations || !salt || !hash) return false;
  const candidate = crypto.pbkdf2Sync(password, salt, Number(iterations), 32, 'sha256').toString('base64url');
  if (candidate.length !== hash.length) return false;
  return crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(hash));
}

export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function signSession(payload, maxAgeSeconds = 60 * 60 * 8) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const body = { ...payload, exp: Math.floor(Date.now() / 1000) + maxAgeSeconds };
  const unsigned = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(body))}`;
  const signature = crypto.createHmac('sha256', secret).update(unsigned).digest('base64url');
  return `${unsigned}.${signature}`;
}

export function verifySession(token) {
  const [header, body, signature] = String(token || '').split('.');
  if (!header || !body || !signature) return null;
  const unsigned = `${header}.${body}`;
  const expected = crypto.createHmac('sha256', secret).update(unsigned).digest('base64url');
  if (signature.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;

  let payload;
  try {
    payload = JSON.parse(fromB64url(body));
  } catch {
    return null;
  }
  if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}

export function sanitizeText(value, max = 120) {
  return String(value || '').replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, max);
}

export function isStrongPassword(password) {
  return typeof password === 'string'
    && password.length >= 10
    && /[a-z]/.test(password)
    && /[A-Z]/.test(password)
    && /\d/.test(password);
}

export function htmlEscape(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[char]);
}

export function timingSafeCode() {
  return String(crypto.randomInt(100000, 1000000));
}

export function constantTimeEquals(a, b) {
  const left = encoder.encode(String(a || ''));
  const right = encoder.encode(String(b || ''));
  if (left.byteLength !== right.byteLength) return false;
  return crypto.timingSafeEqual(left, right);
}
