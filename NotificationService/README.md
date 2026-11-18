# Notification Service

An asynchronous event-driven notification engine built with Express 5, TypeScript, BullMQ, Redis, Nodemailer, and Handlebars.

---

## Features

- **Queue Consumer Architecture**: Decoupled from the primary HTTP booking pipeline, listening on Redis BullMQ `mailer-queue`.
- **Dynamic Template Rendering**: Compiles modular Handlebars (`.hbs`) templates with personalized transaction parameters.
- **Resilient Delivery**: Automatic retry backoffs and fault isolation protecting upstream services from slow third-party SMTP transports.
- **Zero-Pollution Tracing**: Correlation ID tracking via Node.js `AsyncLocalStorage` and Winston JSON daily log rotation.

---

## Setup & Running

### 1. Prerequisites
- Node.js 20+
- Redis 7.0+

### 2. Environment Configuration
Create a `.env` file in `NotificationService`:
```env
PORT=3002
REDIS_HOST=localhost
REDIS_PORT=6379
MAIL_USER=your_smtp_user@example.com
MAIL_PASS=your_smtp_password
```

### 3. Install & Run
```bash
# Install dependencies
npm install

# Start development worker & server
npm run dev
```
