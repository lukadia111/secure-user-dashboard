import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const outbox = resolve('./data/email-outbox.log');
mkdirSync(dirname(outbox), { recursive: true });

export function sendMail({ to, subject, body }) {
  const message = [
    '---',
    `Time: ${new Date().toISOString()}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    '',
    body,
    ''
  ].join('\n');
  appendFileSync(outbox, message);
  console.log(message);
}
