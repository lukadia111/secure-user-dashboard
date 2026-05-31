import express from 'express';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { db, migrate, seedAdmin } from './db.js';
import {
  hashPassword,
  hashToken,
  isStrongPassword,
  normalizeEmail,
  randomToken,
  sanitizeText,
  signSession,
  timingSafeCode,
  verifyPassword,
  verifySession
} from './security.js';
import { sendMail } from './mailer.js';

const app = express();
const port = Number(process.env.PORT || 3000);
const appOrigin = process.env.APP_ORIGIN || `http://localhost:${port}`;
const cookieSecure = String(process.env.COOKIE_SECURE || 'false') === 'true';

migrate();
seedAdmin(hashPassword('AdminPass123!'));

app.disable('x-powered-by');
app.use(express.json({ limit: '20kb' }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "base-uri 'self'",
    "frame-ancestors 'none'"
  ].join('; '));
  next();
});
app.use(express.static(resolve('public')));

function getCookie(req, name) {
  const cookies = String(req.headers.cookie || '').split(';').map((item) => item.trim());
  const match = cookies.find((item) => item.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : '';
}

function setSessionCookie(res, user) {
  const token = signSession({ sub: user.id, role: user.role });
  res.cookie('session', token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: cookieSecure,
    maxAge: 8 * 60 * 60 * 1000,
    path: '/'
  });
}

function clearSessionCookie(res) {
  res.clearCookie('session', { path: '/', sameSite: 'strict', secure: cookieSecure });
}

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    verified: Boolean(user.verified),
    twoFactorEnabled: Boolean(user.two_factor_enabled),
    createdAt: user.created_at
  };
}

function requireAuth(req, res, next) {
  const payload = verifySession(getCookie(req, 'session'));
  if (!payload) return res.status(401).json({ error: 'Authentication required.' });

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.sub);
  if (!user) return res.status(401).json({ error: 'Authentication required.' });
  req.user = user;
  next();
}

function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required.' });
  next();
}

function logActivity(req, userId, action) {
  db.prepare('INSERT INTO activities (user_id, action, ip, user_agent) VALUES (?, ?, ?, ?)')
    .run(userId, action, req.ip, req.get('user-agent') || '');
}

function createToken(userId, purpose, minutes) {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + minutes * 60 * 1000).toISOString();
  db.prepare('INSERT INTO tokens (user_id, token_hash, purpose, expires_at) VALUES (?, ?, ?, ?)')
    .run(userId, hashToken(token), purpose, expiresAt);
  return { token, expiresAt };
}

function consumeToken(token, purpose) {
  const tokenHash = hashToken(token);
  const row = db.prepare(`
    SELECT tokens.*, users.email, users.name, users.role, users.verified, users.two_factor_enabled, users.password_hash, users.created_at
    FROM tokens
    JOIN users ON users.id = tokens.user_id
    WHERE tokens.token_hash = ? AND tokens.purpose = ? AND tokens.used_at IS NULL
  `).get(tokenHash, purpose);

  if (!row || new Date(row.expires_at).getTime() < Date.now()) return null;
  db.prepare('UPDATE tokens SET used_at = CURRENT_TIMESTAMP WHERE id = ?').run(row.id);
  return { ...row, id: row.user_id };
}

function sendVerificationEmail(user) {
  const { token } = createToken(user.id, 'verify_email', 60 * 24);
  sendMail({
    to: user.email,
    subject: 'Verify your dashboard account',
    body: `Welcome, ${user.name}.\n\nVerify your account:\n${appOrigin}/api/auth/verify?token=${token}`
  });
}

app.post('/api/auth/register', (req, res) => {
  const name = sanitizeText(req.body.name, 80);
  const email = normalizeEmail(req.body.email);
  const password = String(req.body.password || '');

  if (name.length < 2) return res.status(400).json({ error: 'Name must be at least 2 characters.' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'A valid email is required.' });
  if (!isStrongPassword(password)) return res.status(400).json({ error: 'Password must be at least 10 characters and include uppercase, lowercase, and a number.' });

  try {
    const result = db.prepare('INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)')
      .run(name, email, hashPassword(password));
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
    sendVerificationEmail(user);
    logActivity(req, user.id, 'Registered account');
    res.status(201).json({ message: 'Registration successful. Check the development outbox for your verification link.' });
  } catch {
    res.status(409).json({ error: 'An account with that email already exists.' });
  }
});

app.get('/api/auth/verify', (req, res) => {
  const user = consumeToken(String(req.query.token || ''), 'verify_email');
  if (!user) return res.status(400).send('Verification link is invalid or expired.');
  db.prepare('UPDATE users SET verified = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(user.id);
  logActivity(req, user.id, 'Verified email');
  res.redirect('/?verified=1');
});

app.post('/api/auth/login', (req, res) => {
  const email = normalizeEmail(req.body.email);
  const password = String(req.body.password || '');
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);

  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }
  if (!user.verified) return res.status(403).json({ error: 'Please verify your email before logging in.' });

  if (user.two_factor_enabled) {
    const code = timingSafeCode();
    const { token } = createToken(user.id, 'two_factor', 10);
    db.prepare('UPDATE tokens SET token_hash = ? WHERE token_hash = ?')
      .run(hashToken(`${token}:${code}`), hashToken(token));
    sendMail({
      to: user.email,
      subject: 'Your dashboard login code',
      body: `Your login code is ${code}. It expires in 10 minutes.`
    });
    return res.json({ needsTwoFactor: true, challenge: token, message: 'Enter the 2FA code from the development outbox.' });
  }

  setSessionCookie(res, user);
  logActivity(req, user.id, 'Logged in');
  res.json({ user: publicUser(user) });
});

app.post('/api/auth/2fa', (req, res) => {
  const challenge = String(req.body.challenge || '');
  const code = String(req.body.code || '');
  const user = consumeToken(`${challenge}:${code}`, 'two_factor');
  if (!user) return res.status(401).json({ error: 'Invalid or expired 2FA code.' });
  setSessionCookie(res, user);
  logActivity(req, user.id, 'Completed two-factor login');
  res.json({ user: publicUser(user) });
});

app.post('/api/auth/forgot-password', (req, res) => {
  const email = normalizeEmail(req.body.email);
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (user) {
    const { token } = createToken(user.id, 'reset_password', 30);
    sendMail({
      to: user.email,
      subject: 'Reset your dashboard password',
      body: `Reset your password:\n${appOrigin}/?reset=${token}`
    });
    logActivity(req, user.id, 'Requested password reset');
  }
  res.json({ message: 'If that email exists, a reset link has been sent to the development outbox.' });
});

app.post('/api/auth/reset-password', (req, res) => {
  const token = String(req.body.token || '');
  const password = String(req.body.password || '');
  if (!isStrongPassword(password)) return res.status(400).json({ error: 'Password must be at least 10 characters and include uppercase, lowercase, and a number.' });
  const user = consumeToken(token, 'reset_password');
  if (!user) return res.status(400).json({ error: 'Reset token is invalid or expired.' });
  db.prepare('UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(hashPassword(password), user.id);
  logActivity(req, user.id, 'Reset password');
  res.json({ message: 'Password reset successful. You can now log in.' });
});

app.post('/api/auth/logout', requireAuth, (req, res) => {
  logActivity(req, req.user.id, 'Logged out');
  clearSessionCookie(res);
  res.json({ message: 'Logged out.' });
});

app.get('/api/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

app.patch('/api/me', requireAuth, (req, res) => {
  const name = sanitizeText(req.body.name, 80);
  const email = normalizeEmail(req.body.email);
  if (name.length < 2) return res.status(400).json({ error: 'Name must be at least 2 characters.' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'A valid email is required.' });

  try {
    const needsVerification = email !== req.user.email;
    db.prepare('UPDATE users SET name = ?, email = ?, verified = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(name, email, needsVerification ? 0 : req.user.verified, req.user.id);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    if (needsVerification) sendVerificationEmail(user);
    logActivity(req, req.user.id, needsVerification ? 'Updated profile and requested email verification' : 'Updated profile');
    res.json({ user: publicUser(user), message: needsVerification ? 'Profile updated. Verify your new email before the next login.' : 'Profile updated.' });
  } catch {
    res.status(409).json({ error: 'That email is already in use.' });
  }
});

app.patch('/api/me/password', requireAuth, (req, res) => {
  const currentPassword = String(req.body.currentPassword || '');
  const newPassword = String(req.body.newPassword || '');
  if (!verifyPassword(currentPassword, req.user.password_hash)) return res.status(400).json({ error: 'Current password is incorrect.' });
  if (!isStrongPassword(newPassword)) return res.status(400).json({ error: 'New password must be at least 10 characters and include uppercase, lowercase, and a number.' });
  db.prepare('UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(hashPassword(newPassword), req.user.id);
  logActivity(req, req.user.id, 'Changed password');
  res.json({ message: 'Password changed.' });
});

app.patch('/api/me/settings', requireAuth, (req, res) => {
  const enabled = Boolean(req.body.twoFactorEnabled);
  db.prepare('UPDATE users SET two_factor_enabled = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(enabled ? 1 : 0, req.user.id);
  logActivity(req, req.user.id, enabled ? 'Enabled two-factor authentication' : 'Disabled two-factor authentication');
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  res.json({ user: publicUser(user) });
});

app.get('/api/activity', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT action, created_at FROM activities WHERE user_id = ? ORDER BY created_at DESC LIMIT 12').all(req.user.id);
  res.json({ activities: rows });
});

app.get('/api/admin/users', requireAuth, requireAdmin, (req, res) => {
  const users = db.prepare('SELECT id, name, email, role, verified, two_factor_enabled, created_at FROM users ORDER BY created_at DESC').all();
  res.json({ users: users.map(publicUser) });
});

app.patch('/api/admin/users/:id', requireAuth, requireAdmin, (req, res) => {
  const userId = Number(req.params.id);
  const name = sanitizeText(req.body.name, 80);
  const email = normalizeEmail(req.body.email);
  const role = req.body.role === 'admin' ? 'admin' : 'user';
  const verified = Boolean(req.body.verified);

  if (name.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Valid name and email are required.' });
  try {
    db.prepare('UPDATE users SET name = ?, email = ?, role = ?, verified = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(name, email, role, verified ? 1 : 0, userId);
    logActivity(req, req.user.id, `Admin updated user ${userId}`);
    res.json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(userId)) });
  } catch {
    res.status(409).json({ error: 'Unable to update user. Email may already be in use.' });
  }
});

app.delete('/api/admin/users/:id', requireAuth, requireAdmin, (req, res) => {
  const userId = Number(req.params.id);
  if (userId === req.user.id) return res.status(400).json({ error: 'Admins cannot delete their own account.' });
  db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  logActivity(req, req.user.id, `Admin deleted user ${userId}`);
  res.json({ message: 'User deleted.' });
});

app.get('/dev/outbox', (req, res) => {
  const path = resolve('./data/email-outbox.log');
  res.type('text/plain').send(existsSync(path) ? readFileSync(path, 'utf8') : 'Outbox is empty.');
});

app.get('*', (req, res) => {
  res.sendFile(resolve('public/index.html'));
});

app.listen(port, () => {
  console.log(`Secure dashboard running at ${appOrigin}`);
});
