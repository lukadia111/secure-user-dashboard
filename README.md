# Secure User Dashboard

This is a small full-stack dashboard project built with Node.js, Express, SQLite, and plain JavaScript on the frontend. It covers the main account features a secure web app usually needs: registration, verified login, password resets, protected sessions, user profiles, and an admin area.

The app is meant to run locally for development and testing. Since there is no real email provider connected, verification codes, password reset links, and two-factor codes are written to a local development outbox.

## What It Includes

- Account registration with email verification
- Login with hashed passwords
- Password reset links
- Secure session cookies
- Optional two-factor login by email code
- Dashboard page for each signed-in user
- Profile editing and password change
- Recent activity list
- Admin user management
- Role-based access control for admin-only pages
- Responsive aquarium-style UI

## Tech Stack

- Node.js and Express
- SQLite through Node's built-in `node:sqlite` module
- HTML, CSS, and vanilla JavaScript
- PBKDF2-SHA256 password hashing
- Signed session tokens stored in `HttpOnly` cookies

## How To Run It

Install Node.js 24 or newer first.

Then open this project folder in a terminal and run:

```bash
npm install
npm start
```

The site will be available at:

```text
http://localhost:3000
```

On Windows, you can also run:

```text
START_DASHBOARD.bat
```

If something goes wrong, run:

```text
DEBUG_START_DASHBOARD.bat
```

That writes the startup output to `work/dashboard-debug.log`.

## Local Email Outbox

The project does not send real emails. Instead, development emails are saved in:

```text
data/email-outbox.log
```

You can also view them in the browser at:

```text
http://localhost:3000/dev/outbox
```

Use this page when testing email verification, password reset, or two-factor login.

## Login Details

The current local admin account is:

```text
Email: luka@gmail.com
Password: LukalukA123!
```

The original seeded admin account, if the database is created from scratch, is:

```text
Email: admin@example.com
Password: AdminPass123!
```

## API Endpoints

| Method | Endpoint | Access | Description |
| --- | --- | --- | --- |
| POST | `/api/auth/register` | Public | Creates a new user account |
| GET | `/api/auth/verify?token=...` | Public | Verifies a user's email address |
| POST | `/api/auth/login` | Public | Logs a user in |
| POST | `/api/auth/2fa` | Public | Completes two-factor login |
| POST | `/api/auth/forgot-password` | Public | Creates a password reset link |
| POST | `/api/auth/reset-password` | Public | Sets a new password with a reset token |
| POST | `/api/auth/logout` | Signed in | Logs the user out |
| GET | `/api/me` | Signed in | Gets the current user's profile |
| PATCH | `/api/me` | Signed in | Updates name or email |
| PATCH | `/api/me/password` | Signed in | Changes the current user's password |
| PATCH | `/api/me/settings` | Signed in | Turns two-factor login on or off |
| GET | `/api/activity` | Signed in | Shows recent account activity |
| GET | `/api/admin/users` | Admin | Lists all users |
| PATCH | `/api/admin/users/:id` | Admin | Updates a user account |
| DELETE | `/api/admin/users/:id` | Admin | Deletes a user account |

## Roles

There are two roles:

- `user`: Can only use their own dashboard, profile, password settings, and activity page.
- `admin`: Can use the normal dashboard and also manage users from the admin page.

The backend checks the user's session and role before allowing access to protected API routes.

## Security Features

Passwords are not stored directly. They are hashed with PBKDF2-SHA256 and a separate salt for each user.

Sessions are stored in signed cookies with `HttpOnly` and `SameSite=Strict` enabled. API routes that need a logged-in user check the session before returning data.

Database queries use bound parameters, which helps prevent SQL injection. User input is validated on the server before it is saved. The app also sends basic security headers such as content security policy, frame protection, and content type protection.

For a real hosted version, HTTPS should be enabled, `COOKIE_SECURE` should be set to `true`, and the local email outbox should be replaced with a real email service.
