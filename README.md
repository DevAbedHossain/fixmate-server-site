# FixMate Server

Express + MongoDB API for **FixMate**, a repair service platform where customers book verified technicians and pay only after the job is completed.

- **Live API:** _add your server URL_
- **Client repository:** _add your client repo URL_

## Key features

- **JWT verification & role middlewares** — `verifyToken` checks the BetterAuth JWT (public keys from the client's `/api/auth/jwks`) and loads the user's current role from the database; `verifyCustomer`, `verifyTechnician` and `verifyAdmin` return `403` for the wrong role, missing/invalid tokens get `401`.
- **Ownership checks** — users only reach their own data: a technician can update only their own services and jobs, a customer can read and cancel only their own bookings.
- **Server-enforced job pipeline** — `requested → accepted | rejected`, `accepted → in-progress`, `in-progress → completed` (final amount > 0). Anything else is rejected.
- **Business rules** — one active request per customer per service, preferred date today or later, technicians/admins cannot request, editing a service sends it back to `pending`.
- **Stripe payments** — Checkout sessions are created from the booking in the database (never from a client amount). Payments are saved from the success-page verification and/or the webhook, with a unique `stripeSessionId` index so the same payment is never stored twice.
- **Server-side search, filter & sort** for public services.

## API

| Method & route | Access |
| --- | --- |
| `GET /services?search=&category=&mode=&sort=` · `GET /service/:id` · `GET /service-limit` · `GET /user/:id` | Public |
| `POST /booking-request` · `GET /booking-request/my` · `PATCH /booking-request/:id/cancel` · `POST /create-payment-intent` · `GET /payment/verify` · `GET /payments/my` | Customer |
| `POST /service` · `PATCH /service/:id` · `DELETE /service/:id` · `GET /services/technician` · `GET /booking-request/technician` · `PATCH /booking-request/:id/status` | Technician |
| `GET /admin/users` · `PATCH /admin/users/:id/role` · `GET /admin/services` · `PATCH /admin/services/:id/approval` · `GET /booking-request` · `GET /admin/payments` | Admin |
| `PATCH /user/:id` (own profile only) | Any logged-in user |
| `POST /stripe/webhook` | Stripe (signature verified) |

## Collections

`user` (BetterAuth users with `role`, `phone`, `area`, `bio`), `services`, `bookings`, `payments`.

## npm packages

| Package | Purpose |
| --- | --- |
| `express` | HTTP server |
| `cors` | Allowed client origins |
| `mongodb` | Database driver |
| `jose` | JWT verification against the BetterAuth JWKS |
| `stripe` | Checkout sessions, verification and webhooks |
| `dotenv` | Environment variables |
| `nodemon` (dev) | Auto-restart in development |

## Getting started

```bash
npm install
npm run dev
```

`.env` (never commit it):

```env
PORT=5000
# Comma-separated: first one is used for Stripe redirects
CLIENT_URL=http://localhost:3000
BETTER_AUTH_MONGO_DB_URL=
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
```

### Scripts

- `node scripts/seed.js` — creates the demo accounts (client must be running) and **resets** services, bookings and payments with realistic connected data.
- `node scripts/migrate.js` — safe one-off data fixes (text prices → numbers, missing `createdAt`).
