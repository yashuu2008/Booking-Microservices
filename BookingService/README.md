# Booking Service

A high-concurrency booking microservice built with Express 5, TypeScript, Prisma ORM, Redis Redlock, and BullMQ.

---

## Features

- **Distributed Concurrency Control**: Uses the Redis Redlock algorithm on property resources to prevent double-booking across horizontally scaled instances.
- **Two-Phase Idempotency Engine**: Stripe-style idempotency key lifecycle backed by MySQL pessimistic row-level locking (`SELECT ... FOR UPDATE`) within ACID transactions to eliminate race conditions on booking confirmation.
- **Event-Driven Messaging**: Emits asynchronous booking confirmation events to Redis BullMQ queues for non-blocking email processing.
- **Request Context & Tracing**: Implements zero-pollution correlation tracking across async boundaries using Node.js `AsyncLocalStorage`.
- **Structured Logging**: Daily rotating JSON logs powered by Winston and `winston-daily-rotate-file`.

---

## Architecture Flow

```
1. POST /api/v1/bookings
   - Acquire Redis Redlock on `hotel:{hotelId}` (TTL: 5000ms)
   - Create Booking (status: PENDING)
   - Generate & store unique Idempotency Key (finalized: false)
   - Return bookingId and idempotencyKey

2. POST /api/v1/bookings/confirm/:idempotencyKey
   - Open Prisma transaction
   - SELECT * FROM IdempotencyKey WHERE idemKey = ? FOR UPDATE
   - Verify unfinalized state
   - UPDATE Booking (status: CONFIRMED)
   - UPDATE IdempotencyKey (finalized: true)
   - Enqueue email event in BullMQ 'mailer-queue'
```

---

## API Endpoints

- `POST /api/v1/bookings` - Create a pending reservation and generate an idempotency key
- `POST /api/v1/bookings/confirm/:idempotencyKey` - Confirm reservation idempotently
- `GET /api/v1/ping` - Health check endpoint

---

## Setup & Running

### 1. Prerequisites
- Node.js 20+
- MySQL 8.0+
- Redis 7.0+

### 2. Environment Configuration
Create a `.env` file in `BookingService`:
```env
PORT=3001
DATABASE_URL="mysql://root:root@localhost:3306/airbnb_booking"
REDIS_SERVER_URL="redis://localhost:6379"
LOCK_TTL=5000
```

### 3. Install & Run
```bash
# Install dependencies
npm install

# Run Prisma migrations
npx prisma migrate dev

# Start development server
npm run dev
```
