# Airbnb Microservices: Polyglot Distributed Booking & Inventory Platform

[![Go Version](https://img.shields.io/badge/Go-1.24.1-00ADD8?style=flat&logo=go)](https://golang.org)
[![Node.js Version](https://img.shields.io/badge/Node.js-22.x-339933?style=flat&logo=nodedotjs)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6?style=flat&logo=typescript)](https://www.typescriptlang.org)
[![Express](https://img.shields.io/badge/Express-5.1-000000?style=flat&logo=express)](https://expressjs.com)
[![MySQL](https://img.shields.io/badge/MySQL-8.0-4479A1?style=flat&logo=mysql&logoColor=white)](https://www.mysql.com)
[![Redis](https://img.shields.io/badge/Redis-7.x-DC382D?style=flat&logo=redis&logoColor=white)](https://redis.io)
[![Prisma](https://img.shields.io/badge/Prisma-6.8-2D3748?style=flat&logo=prisma)](https://www.prisma.io)
[![BullMQ](https://img.shields.io/badge/BullMQ-5.5x-FF6B6B?style=flat)](https://bullmq.io)

A production-grade, polyglot microservices platform architected to solve core distributed system challenges in hospitality platforms: **high concurrency, double-booking prevention, dynamic date-slotted room inventory, two-phase idempotent checkout, and decoupled event-driven background processing**.

---

## 🏛️ System Architecture

```
                                    +-----------------------+
                                    |     Client / Web      |
                                    +-----------------------+
                                                |
                                                v
                                    +-----------------------+
                                    |  AuthInGo (Port 8080) |
                                    | Reverse Proxy Gateway |
                                    |  + RBAC Authorization |
                                    +-----------------------+
                                           /         \
                             [Proxy / Direct]       [Proxy / Direct]
                                         /             \
                                        v               v
                +-------------------------------+    +-----------------------+
                |    HotelService (Port 3000)   |    | BookingService        |
                |  - Express 5 / TypeScript     |    |   (Port 3001)         |
                |  - Sequelize / MySQL          |    | - Express 5 / TS      |
                |  - Daily Inventory Modeling   |    | - Prisma / MySQL      |
                |  - node-cron Rolling Engine   |    | - Redlock Concurrency |
                +-------------------------------+    +-----------------------+
                                |                                |
                     (BullMQ Job Publishing)          (BullMQ Job Publishing)
                                |                                |
                                v                                v
                       +-------------------------------------------------+
                       |              Redis Host / Cluster               |
                       |  - Redlock Distributed Locking Engine           |
                       |  - Queue: 'room-generation-queue'               |
                       |  - Queue: 'mailer-queue'                        |
                       +-------------------------------------------------+
                                                |
                                                v
                                    +-----------------------+
                                    |  NotificationService  |
                                    |      (Port 3002)      |
                                    | - BullMQ Async Worker |
                                    | - Nodemailer SMTP     |
                                    | - Handlebars Engine   |
                                    +-----------------------+
```

---

## 📦 Microservices Matrix

| Service | Language / Framework | Storage / ORM | Concurrency & Async | Core Responsibilities |
| :--- | :--- | :--- | :--- | :--- |
| **[AuthInGo](./AuthInGo)** | Go 1.24 / Chi Router | MySQL (`database/sql`) | Token-Bucket Limiter | Authentication, Normalized RBAC, Reverse Proxy Routing & User Header Injection |
| **[HotelService](./HotelService)** | TypeScript / Express 5 | MySQL (Sequelize 6) | Redis, BullMQ, `node-cron` | Hotel Catalog, Room Categories, Date-Slot Inventory, Autonomous Extension Engine |
| **[BookingService](./BookingService)** | TypeScript / Express 5 | MySQL (Prisma 6.8) | Redis Redlock, BullMQ | Booking Lifecycle, Distributed Resource Locks, Pessimistic Row-Level Idempotency |
| **[NotificationService](./NotificationService)** | TypeScript / Express 5 | Stateless Worker | Redis, BullMQ | Asynchronous Email Queue Processing, Dynamic Handlebars Template Compilation |

---

## ⚡ Core Distributed Systems Highlights

### 1. Redis Redlock Distributed Locking
In a horizontally scaled environment, in-memory process locks cannot prevent cross-instance double-booking. `BookingService` enforces distributed locking via **Redlock** on property resources (`hotel:${hotelId}`) with automated TTL expiration, serializing atomic reservation creation across independent instances.

### 2. Two-Phase Stripe-Style Idempotency Engine
To protect against network timeouts, retries, and race conditions during payment and booking confirmation:
* Booking creation generates a unique UUID `IdempotencyKey`.
* Booking confirmation opens an ACID database transaction and acquires a **MySQL pessimistic row lock**:
  ```sql
  SELECT * FROM IdempotencyKey WHERE idemKey = ? FOR UPDATE;
  ```
* Confirms booking and updates `finalized = true` atomically, ensuring duplicated client retries cannot double-charge or create phantom bookings.

### 3. Discrete Date-Slotted Inventory Modeling
Instead of expensive date-range queries (`WHERE NOT (end <= date1 OR start >= date2)`), availability is pre-materialized as discrete night slots in the `rooms` table. Reserving a room reduces interval computation to high-speed primary key index lookups.

### 4. Asynchronous Event-Driven Messaging
Booking confirmations decouple transactional email delivery by dispatching background jobs to **BullMQ** on Redis. `NotificationService` consumes jobs asynchronously, preventing external SMTP latency from blocking HTTP response cycles.

### 5. Zero-Pollution Request Tracing
All TypeScript services utilize Node.js **`AsyncLocalStorage`** to propagate a unique `correlationId` across asynchronous execution contexts without parameter pollution, injecting correlation IDs automatically into Winston daily rotating JSON logs.

---

## 🚀 Getting Started

### Prerequisites
* **Node.js** >= 20.x
* **Go** >= 1.24.x
* **MySQL** >= 8.0
* **Redis** >= 7.0

---

### Step 1: Clone & Configure

```bash
git clone https://github.com/yashuu2008/airbnb-microservices.git
cd airbnb-microservices
```

---

### Step 2: Service Configuration & Startup

#### 1. AuthInGo (Port 8080)
```bash
cd AuthInGo
# Configure .env (DB_USER, DB_PASSWORD, DB_ADDR, DBName, PORT=:8080, JWT_SECRET)
make migrate-up
go run main.go
```

#### 2. HotelService (Port 3000)
```bash
cd HotelService
npm install
# Configure .env (PORT=3000, DB_USER, DB_PASSWORD, DB_NAME, REDIS_HOST, REDIS_PORT)
npm run migrate
npm run dev
```

#### 3. BookingService (Port 3001)
```bash
cd BookingService
npm install
# Configure .env (PORT=3001, DATABASE_URL, REDIS_SERVER_URL, LOCK_TTL=5000)
npx prisma migrate dev
npm run dev
```

#### 4. NotificationService (Port 3002)
```bash
cd NotificationService
npm install
# Configure .env (PORT=3002, REDIS_HOST, REDIS_PORT, MAIL_USER, MAIL_PASS)
npm run dev
```

---

## 📡 Key API Reference

### 1. Authentication & RBAC (AuthInGo - `http://localhost:8080`)
* `POST /signup` - Register a new user account
  ```json
  { "username": "alex", "email": "alex@example.com", "password": "securepassword" }
  ```
* `POST /login` - Authenticate and retrieve JWT token
  ```json
  { "email": "alex@example.com", "password": "securepassword" }
  ```
* `GET /profile` - Retrieve authenticated user profile (`Authorization: Bearer <token>`)
* `POST /roles/{userId}/assign/{roleId}` - Assign RBAC role to user (Admin only)

### 2. Hotel & Inventory (HotelService - `http://localhost:3000`)
* `POST /api/v1/hotels` - Create a new hotel property
* `GET /api/v1/hotels` - Fetch all listed hotels
* `POST /api/v1/room-generation` - Dispatch async room generation batch job
* `POST /api/v1/scheduler/start` - Start autonomous availability extension cron

### 3. Booking & Concurrency (BookingService - `http://localhost:3001`)
* `POST /api/v1/bookings` - Create a pending reservation and receive idempotency key
  ```json
  { "userId": 1, "hotelId": 1, "totalGuests": 2, "bookingAmount": 250 }
  ```
* `POST /api/v1/bookings/confirm/:idempotencyKey` - Confirm reservation idempotently

---

## 📖 Deep-Dive Documentation

For detailed technical analysis, concurrency flow charts, code audits, and a 25+ question Senior Engineer interview grilling handbook, see [AIRBNB_TECHNICAL_HANDBOOK.md](./AIRBNB_TECHNICAL_HANDBOOK.md).

---

## 👤 Author

**yashuu2008**
* GitHub: [@yashuu2008](https://github.com/yashuu2008)

---

## 📄 License
This project is licensed under the MIT License.
