# Airbnb Microservices Platform

[![Go Version](https://img.shields.io/badge/Go-1.24.1-00ADD8?style=flat&logo=go&logoColor=white)](https://golang.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6?style=flat&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Express.js](https://img.shields.io/badge/Express-5.1.0-000000?style=flat&logo=express&logoColor=white)](https://expressjs.com/)
[![MySQL](https://img.shields.io/badge/MySQL-8.0-4479A1?style=flat&logo=mysql&logoColor=white)](https://www.mysql.com/)
[![Redis](https://img.shields.io/badge/Redis-7.0-DC382D?style=flat&logo=redis&logoColor=white)](https://redis.io/)
[![Prisma](https://img.shields.io/badge/Prisma-6.8-2D3748?style=flat&logo=prisma&logoColor=white)](https://www.prisma.io/)
[![Sequelize](https://img.shields.io/badge/Sequelize-6.37-52B0E7?style=flat&logo=sequelize&logoColor=white)](https://sequelize.org/)
[![BullMQ](https://img.shields.io/badge/BullMQ-5.56-E65100?style=flat&logo=bull&logoColor=white)](https://bullmq.io/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://opensource.org/licenses/MIT)

A polyglot, distributed hospitality reservation platform architected around high-concurrency booking workflows, materialized daily inventory slotting, and asynchronous event processing. Built with Go 1.24, TypeScript, Express 5, Prisma, Sequelize, Redis Redlock, and BullMQ.

[System Design Docs](./docs/design.md) • [Architecture](#architecture-overview) • [Services](#services-overview) • [Concurrency & Idempotency](#1-two-phase-distributed-booking--concurrency) • [Inter-Service Communication](#inter-service-communication) • [Tech Stack](#tech-stack) • [Project Structure](#project-structure) • [Getting Started](#getting-started) • [API Reference](#api-reference) • [Postman Suite](#1-automated-integration-suite-postman)

---

## Features

- **Edge Reverse Proxy Gateway**: Built on Go Chi and `net/http/httputil`, providing centralized routing (`/hotelservice/*`, `/bookingservice/*`), route-level path stripping, rate limiting, and authenticated user context header injection (`X-User-ID`).
- **Normalized RBAC & Identity Engine**: Multi-tier permission management backed by MySQL relational tables (`users`, `roles`, `permissions`, `role_permissions`, `user_roles`) with bcrypt password hashing and signed JWT authorization.
- **Dynamic Date-Slotting Inventory**: Pre-materializes discrete daily room inventory records in MySQL, eliminating slow date-range overlap queries during reservation lookups.
- **Asynchronous Room Generation**: Offloads heavy multi-month room availability creation to background BullMQ Redis queues without blocking HTTP thread pools.
- **Autonomous Rolling Availability**: A background cron daemon (`node-cron`) automatically queries latest inventory dates and rolls forward room availability.
- **Distributed Concurrency Control**: Property-level distributed mutex locking via the Redis Redlock algorithm (`hotel:{hotelId}`) to prevent race conditions and double-booking across horizontally scaled instances.
- **Stripe-Style Two-Phase Idempotency**: Resilient reservation lifecycle combining client idempotency keys, MySQL pessimistic row-level locking (`SELECT ... FOR UPDATE`), and transactional status state machines (`PENDING` $\rightarrow$ `CONFIRMED`).
- **Decoupled Notification Pipeline**: Non-blocking transactional email delivery consuming from Redis BullMQ queues with dynamic Handlebars (`.hbs`) templates and Nodemailer SMTP transports.
- **Zero-Pollution Distributed Tracing**: Request correlation tracking implemented across asynchronous boundaries using Node.js `AsyncLocalStorage` and Winston daily JSON log rotation.

---

## Architecture Overview

```mermaid
flowchart LR
    subgraph Clients["Clients & Applications"]
        WebClient["Web / Mobile Client"]
        Postman["Postman Test Suite"]
    end

    subgraph Gateway["API Gateway & Auth (:8080)"]
        AuthService["AuthInGo\n(Go 1.24 + Chi)"]
        Proxy["httputil Reverse Proxy"]
        RateLimiter["Token Bucket Rate Limiter"]
    end

    subgraph Microservices["Core Microservices"]
        HotelService["HotelService (:3000)\n(Express 5 + Sequelize)"]
        BookingService["BookingService (:3001)\n(Express 5 + Prisma)"]
        NotificationService["NotificationService (:3002)\n(Express 5 + BullMQ Worker)"]
    end

    subgraph DataStorage["Persistence & Queues"]
        DB_Auth[("MySQL: auth_dev")]
        DB_Hotel[("MySQL: airbnb_hotel")]
        DB_Booking[("MySQL: airbnb_booking")]
        RedisStore[("Redis 7.0+\n- Redlock Mutexes\n- BullMQ Queues")]
    end

    subgraph External["External Services"]
        SMTPServer["SMTP Mail Server"]
    end

    %% Client Traffic
    WebClient -->|HTTP /signup, /login| Gateway
    Postman -->|HTTP /hotelservice/*, /bookingservice/*| Gateway

    %% Gateway Routing & Auth DB
    AuthService -->|Goose Migrations / SQL| DB_Auth
    Gateway -->|HTTP Proxy + X-User-ID| HotelService
    Gateway -->|HTTP Proxy + X-User-ID| BookingService
    AuthService -.->|Direct HTTP POST /notifications/send| NotificationService

    %% Hotel Service Connections
    HotelService -->|Sequelize ORM| DB_Hotel
    HotelService -->|Enqueue Room Gen Jobs| RedisStore
    RedisStore -->|Process Batch Generation| HotelService

    %% Booking Service Connections
    BookingService -->|Prisma ACID + Row Locks| DB_Booking
    BookingService -->|Acquire / Release Mutex| RedisStore
    BookingService -->|Synchronous HTTP REST\nCheck Availability / Assign Rooms| HotelService
    BookingService -->|Enqueue Booking Confirmation| RedisStore

    %% Notification Service Connections
    RedisStore -->|Consume 'queue-mailer'| NotificationService
    NotificationService -->|SMTP Email Dispatch| SMTPServer
```

---

## Services Overview

| Service | Directory | Port | Primary Responsibility & Role | Tech Stack | Storage / Queues |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Auth & Gateway** | [`./AuthInGo`](./AuthInGo) | `:8080` | **Identity, RBAC & Reverse Proxy**: Manages user authentication, OTP verification, role-permission hierarchies, and acts as the edge reverse proxy routing `/hotelservice/*` and `/bookingservice/*` with `X-User-ID` injection. | Go 1.24, Chi, Goose, JWT, `golang.org/x/crypto`, `net/http/httputil` | MySQL (`auth_dev`) |
| **Hotel Service** | [`./HotelService`](./HotelService) | `:3000` | **Hospitality & Inventory Engine**: Manages hotel metadata, pre-materializes discrete daily room slots to bypass overlap checks, runs background batch room generation workers, and automates future availability via cron. | TypeScript, Express 5, Sequelize ORM, BullMQ, `node-cron`, Jest | MySQL (`airbnb_hotel`), Redis (`room-generation-queue`) |
| **Booking Service** | [`./BookingService`](./BookingService) | `:3001` | **Concurrency & Reservation Lifecycle**: Coordinates room reservations using distributed Redlock mutexes (`hotel:{hotelId}`), enforces two-phase idempotency with pessimistic row-locking (`SELECT ... FOR UPDATE`), and publishes confirmation events. | TypeScript, Express 5, Prisma ORM, Redlock, BullMQ, Axios | MySQL (`airbnb_booking`), Redis (Redlock, `queue-mailer`) |
| **Notification Service** | [`./NotificationService`](./NotificationService) | `:3002` | **Event-Driven Messaging Worker**: Consumes email jobs from Redis BullMQ queues (`queue-mailer`), compiles parameterized Handlebars email templates, and sends transactional emails over SMTP. | TypeScript, Express 5, BullMQ, Handlebars, Nodemailer | Redis (`queue-mailer`), Stateless |

---

## Deep-Dive: Core Engineering Flows

### 1. Two-Phase Distributed Booking & Concurrency

To eliminate overselling and duplicate transactions under high load, reservation processing is partitioned into two distinct phases using Redis Redlock and MySQL row-level locking:

```mermaid
sequenceDiagram
    autonumber
    actor Client
    participant Gateway as Auth & Gateway (:8080)
    participant Booking as BookingService (:3001)
    participant Redis as Redis (Redlock / BullMQ)
    participant Hotel as HotelService (:3000)
    participant MySQL as MySQL (airbnb_booking)
    participant Notif as NotificationService (:3002)
    participant Mail as SMTP Server

    Note over Client, Gateway: Phase 1: Reservation Intent
    Client->>Gateway: POST /bookingservice/api/v1/bookings
    Gateway->>Booking: Proxy Request + X-User-ID
    Booking->>Hotel: GET /api/v1/rooms/available
    Hotel-->>Booking: Return Available Room IDs
    Booking->>Redis: Acquire Redlock on `hotel:{hotelId}`
    Redis-->>Booking: Lock Granted (TTL: 5000ms)
    Booking->>MySQL: INSERT INTO Booking (status: PENDING)
    Booking->>MySQL: INSERT INTO IdempotencyKey (finalized: false, idemKey: UUID)
    Booking->>Redis: Release Redlock
    Booking-->>Client: 201 Created (bookingId, idempotencyKey)

    Note over Client, Gateway: Phase 2: Atomic Idempotent Confirmation
    Client->>Gateway: POST /bookingservice/api/v1/bookings/confirm/:idempotencyKey
    Gateway->>Booking: Proxy Request + X-User-ID
    Booking->>MySQL: BEGIN TRANSACTION
    Booking->>MySQL: SELECT * FROM IdempotencyKey WHERE idemKey = ? FOR UPDATE
    alt Idempotency Key Already Finalized
        MySQL-->>Booking: finalized == true
        Booking-->>Client: 400 Bad Request (Already Processed)
    else Key Unfinalized
        MySQL-->>Booking: finalized == false
        Booking->>Hotel: POST /api/v1/rooms/update-booking-id (Assign bookingId)
        Hotel-->>Booking: 200 OK
        Booking->>MySQL: UPDATE Booking SET status = 'CONFIRMED'
        Booking->>MySQL: UPDATE IdempotencyKey SET finalized = true
        Booking->>MySQL: COMMIT
        Booking->>Redis: Enqueue Job in 'queue-mailer'
        Booking-->>Client: 200 OK (Reservation Confirmed)
        
        %% Async Notification Processing
        Redis->>Notif: Worker Pops Job from 'queue-mailer'
        Notif->>Notif: Compile 'booking_confirmation.hbs'
        Notif->>Mail: Deliver Email via Nodemailer
    end
```

### 2. Pre-Materialized Date-Slotting Inventory

Traditional booking systems execute computationally expensive interval overlap queries:
```sql
-- Slow overlap check across large datasets
WHERE check_in < ? AND check_out > ?
```
The **Hotel Service** avoids this by pre-materializing individual daily inventory slots in the `rooms` table:
- Every room category generates discrete rows for every calendar date (`date_of_availability`).
- Availability queries execute high-performance index lookups:
  ```sql
  SELECT * FROM rooms 
  WHERE room_category_id = ? 
    AND date_of_availability BETWEEN ? AND ? 
    AND booking_id IS NULL;
  ```
- Heavy date generation is dispatched as an asynchronous BullMQ queue job (`room-generation-queue`), while an autonomous cron daemon (`node-cron`) rolls forward future date windows automatically.

---

## Inter-Service Communication

### 1. Reverse Proxy Gateway Routing (AuthInGo `:8080`)
`AuthInGo` uses `net/http/httputil` to reverse-proxy requests, strip routing prefixes, and forward authentication headers:

| Public Gateway Route | Forwarded Upstream Target | Path Strip Prefix | Injected Headers |
| :--- | :--- | :--- | :--- |
| `/hotelservice/*` | `HOTEL_SERVICE_URL` (`http://localhost:3000`) | `/hotelservice` | `X-User-ID` *(if authenticated)* |
| `/bookingservice/*` | `BOOKING_SERVICE_URL` (`http://localhost:3001`) | `/bookingservice` | `X-User-ID` *(if authenticated)* |

### 2. Synchronous REST Calls

| Origin Service | Target Service | Endpoint | Protocol | Purpose |
| :--- | :--- | :--- | :--- | :--- |
| `BookingService` | `HotelService` | `GET /api/v1/rooms/available` | HTTP/1.1 (Axios) | Query available date slots for a room category |
| `BookingService` | `HotelService` | `POST /api/v1/rooms/update-booking-id` | HTTP/1.1 (Axios) | Assign confirmed `bookingId` to room slots |
| `AuthInGo` | `NotificationService` | `POST /api/v1/notifications/send` | HTTP/1.1 (`net/http`) | Trigger verification OTPs and reset emails |

### 3. Asynchronous BullMQ Queues (Redis)

| Queue Name | Producer | Consumer | Payload / Job Name | Purpose |
| :--- | :--- | :--- | :--- | :--- |
| `queue-mailer` | `BookingService` & `NotificationService` | `NotificationService` | `payload:mail` (`NotificationDto`) | Asynchronous, non-blocking transactional email dispatch |
| `room-generation-queue` | `HotelService` (Controller & Cron) | `HotelService` | `payload:room-generation` (`RoomGenerationJob`) | Asynchronous batch creation of daily room date slots |

---

## Tech Stack

| Layer | Technology | Version | Purpose |
| :--- | :--- | :--- | :--- |
| **API Gateway & Auth** | Go | 1.24.1 | High-throughput reverse proxy & authentication runtime |
| **Routing (Go)** | go-chi/chi | v5.2.2 | Lightweight, idiomatic HTTP routing & middleware pipeline |
| **Microservices Backend** | Node.js / TypeScript | Node 20+, TS 5.8 | Core application runtime for Hotel, Booking, and Notification |
| **Web Framework** | Express | 5.1.0 | Core HTTP web framework across Node.js services |
| **Relational ORM (Booking)**| Prisma | 6.8.2 | Type-safe database client and ACID transaction engine |
| **Relational ORM (Hotel)** | Sequelize | 6.37.7 | Relational persistence, migrations, and model definitions |
| **Distributed Concurrency** | Redlock | 5.0.0-beta.2 | Distributed resource locking across Redis nodes |
| **Task Queue & Workers** | BullMQ | 5.53 / 5.56 | High-performance Redis-backed job queues and background workers |
| **Cache & Queue Broker** | Redis / ioredis | Redis 7+, ioredis 5 | Distributed locks, message broker, and queue state |
| **Primary Databases** | MySQL | 8.0+ | Persistent relational storage across isolated service databases |
| **Task Scheduling** | node-cron | 4.2.1 | Cron daemon for automated inventory extension |
| **Templating Engine** | Handlebars | 4.7.8 | Dynamic HTML/text email template compiler |
| **Mail Transport** | Nodemailer | 7.0.3 | SMTP client for email delivery |
| **Schema Validation** | Zod / go-playground | Zod 3.24, Validator v10 | Runtime request and DTO payload validation |
| **Structured Logging** | Winston | 3.17.0 | Daily rotating JSON logs and correlation tracing |
| **Testing Framework** | Jest & Supertest | Jest 29.7, Supertest 7.1| Unit and integration testing suite for HotelService |

---

## Databases & Persistence Model

Each microservice maintains its own dedicated database boundary:

| Microservice | Database Name | Migration Tool | Primary Tables / Models |
| :--- | :--- | :--- | :--- |
| **AuthInGo** | `auth_dev` | Goose (SQL) | `users`, `roles`, `permissions`, `role_permissions`, `user_roles`, `otps` |
| **HotelService** | `airbnb_hotel` | Sequelize CLI | `hotels`, `room_categories`, `rooms` |
| **BookingService** | `airbnb_booking` | Prisma Migrate | `Booking` (status: `PENDING`, `CONFIRMED`, `CANCELLED`), `IdempotencyKey` |
| **NotificationService** | *None (Stateless)* | N/A | In-memory processing backed by Redis BullMQ queue storage |

---

## Project Structure

```
project1/
├── AuthInGo/                       # Go 1.24 Auth Service & Edge Reverse Proxy Gateway
│   ├── app/                        # HTTP server initialization and dependency wiring
│   ├── clients/                    # HTTP client calling NotificationService (/notifications/send)
│   ├── config/                     # Environment loading and MySQL database connection
│   ├── controllers/                # HTTP handlers (auth, roles, OTP, ping)
│   ├── db/
│   │   ├── migrations/             # Goose SQL migration scripts
│   │   └── repositories/           # Raw SQL repository queries (users, roles, permissions, OTPs)
│   ├── dto/                        # Request and response data transfer objects
│   ├── middlewares/                # JWT verification, RBAC role guards, rate limiting
│   ├── models/                     # Relational domain models
│   ├── router/                     # Chi router definitions and reverse proxy mounts
│   ├── utils/                      # Reverse proxy helper, JWT token generator, bcrypt hasher
│   ├── Makefile                    # Migration and operational make targets
│   └── main.go                     # Auth service entry point (Port :8080)
│
├── HotelService/                   # Express 5 Hospitality Inventory & Scheduling Engine
│   ├── src/
│   │   ├── config/                 # Sequelize, Redis, logger, and server configs
│   │   ├── controllers/            # Handlers for hotels, rooms, room generation, and scheduler
│   │   ├── db/
│   │   │   ├── migrations/         # Sequelize migration scripts
│   │   │   ├── models/             # Sequelize model definitions (Hotel, Room, RoomCategory)
│   │   │   └── seeders/            # Database seed data
│   │   ├── dto/                    # Zod-derived DTO types
│   │   ├── middlewares/            # Correlation ID tracing and error handling
│   │   ├── processors/             # BullMQ worker for batch room slot generation
│   │   ├── producers/              # BullMQ queue producer for room generation
│   │   ├── queues/                 # BullMQ queue definition ('room-generation-queue')
│   │   ├── repositories/           # Generic BaseRepository pattern implementations
│   │   ├── routers/                # Express v1 routers (/hotels, /rooms, /room-generation, /scheduler)
│   │   ├── scheduler/              # node-cron worker for rolling inventory extension
│   │   ├── services/               # Core business logic
│   │   └── server.ts               # Service bootstrap and startup (Port :3000)
│   └── tests/                      # Jest & Supertest integration test suite
│
├── BookingService/                 # Express 5 Reservation & Concurrency Service
│   ├── src/
│   │   ├── api/                    # Axios REST client communicating with HotelService
│   │   ├── config/                 # Redis, logger, and server configurations
│   │   ├── controllers/            # Handlers for booking creation, confirmation, and lookup
│   │   ├── dto/                    # Booking and notification DTOs
│   │   ├── middlewares/            # Correlation ID tracing and global error handler
│   │   ├── prisma/
│   │   │   ├── migrations/         # Prisma migration history
│   │   │   └── schema.prisma       # Prisma schema (Booking, IdempotencyKey)
│   │   ├── producers/              # BullMQ producer dispatching to 'queue-mailer'
│   │   ├── queues/                 # BullMQ queue definition ('queue-mailer')
│   │   ├── repositories/           # Database queries with Prisma transactions & row locks
│   │   ├── routers/                # Express v1 router (/bookings)
│   │   ├── services/               # Redlock mutex and two-phase idempotency logic
│   │   └── server.ts               # Service bootstrap and startup (Port :3001)
│
├── NotificationService/            # Express 5 Asynchronous Email Worker Service
│   ├── src/
│   │   ├── config/                 # Nodemailer transport, Redis, and logger configs
│   │   ├── controllers/            # Direct notification endpoint handler
│   │   ├── dto/                    # Notification payload DTOs
│   │   ├── middlewares/            # Correlation tracing and error handling
│   │   ├── processors/             # BullMQ email worker processor
│   │   ├── producers/              # Internal BullMQ email queue producer
│   │   ├── queues/                 # BullMQ queue definition ('queue-mailer')
│   │   ├── routers/                # Express v1 router (/notifications)
│   │   ├── services/               # Nodemailer email dispatch service
│   │   ├── templates/              # Handlebars email templates (.hbs) and renderer
│   │   └── server.ts               # Worker bootstrap and Express server (Port :3002)
│
└── postman/                        # Complete integration test suite & environments
    ├── Airbnb_Microservices.postman_collection.json
    └── Airbnb_Microservices.postman_environment.json
```

---

## Getting Started

### Prerequisites

- **Go**: `1.24+`
- **Node.js**: `20.x` or higher
- **MySQL**: `8.0+` (running on `localhost:3306`)
- **Redis**: `7.0+` (running on `localhost:6379`)
- **Goose**: CLI migration tool for Go (`go install github.com/pressly/goose/v3/cmd/goose@latest`)

### 1. Database Initialization

Create the isolated MySQL databases for each microservice:

```sql
CREATE DATABASE auth_dev;
CREATE DATABASE airbnb_hotel;
CREATE DATABASE airbnb_booking;
```

---

### 2. Environment Configuration

Copy the example environment files for each service and adjust credentials if needed:

```bash
# AuthInGo
cp AuthInGo/.env.example AuthInGo/.env

# HotelService
cp HotelService/.env.example HotelService/.env

# BookingService
cp BookingService/.env.example BookingService/.env

# NotificationService
cp NotificationService/.env.example NotificationService/.env
```

---

### 3. Database Migrations

Apply migrations to initialize schemas in their respective databases:

```bash
# 1. AuthInGo (Goose migrations)
cd AuthInGo
make migrate-up
cd ..

# 2. HotelService (Sequelize migrations)
cd HotelService
npm install
npm run migrate
cd ..

# 3. BookingService (Prisma migrations)
cd BookingService
npm install
npx prisma migrate dev
cd ..

# 4. NotificationService (Install dependencies)
cd NotificationService
npm install
cd ..
```

---

### 4. Running the Services

Open 4 separate terminal sessions and start the services in order:

#### Terminal 1: NotificationService (Port 3002)
```bash
cd NotificationService
npm run dev
# -> Server is running on http://localhost:3002
# -> Mailer worker setup completed.
```

#### Terminal 2: HotelService (Port 3000)
```bash
cd HotelService
npm run dev
# -> Server is running on http://localhost:3000
# -> Database connection has been established successfully.
# -> Room availability extension scheduler initialized
```

#### Terminal 3: BookingService (Port 3001)
```bash
cd BookingService
npm run dev
# -> Server is running on http://localhost:3001
```

#### Terminal 4: Auth & API Gateway (Port 8080)
```bash
cd AuthInGo
go run main.go
# -> Starting server on :8080
```

---

## Environment Variables Reference

### 1. `AuthInGo/.env`
| Variable | Description | Default / Example |
| :--- | :--- | :--- |
| `PORT` | HTTP server listening port | `:8080` |
| `DBName` | MySQL database name | `auth_dev` |
| `DB_ADDR` | MySQL host address and port | `127.0.0.1:3306` |
| `DB_USER` | MySQL username | `root` |
| `DB_PASSWORD` | MySQL password | `root` |
| `DB_NET` | Network connection protocol | `tcp` |
| `JWT_SECRET` | Secret key used to sign and verify JWT tokens | `<your_secret_key>` |
| `HOTEL_SERVICE_URL` | Base upstream URL for HotelService reverse proxy | `http://localhost:3000` |
| `BOOKING_SERVICE_URL`| Base upstream URL for BookingService reverse proxy | `http://localhost:3001` |
| `NOTIFICATION_SERVICE_URL`| Base URL for direct NotificationService REST client | `http://localhost:3002` |

### 2. `HotelService/.env`
| Variable | Description | Default / Example |
| :--- | :--- | :--- |
| `PORT` | HTTP server listening port | `3000` |
| `DB_HOST` | MySQL hostname | `localhost` |
| `DB_USER` | MySQL username | `root` |
| `DB_PASSWORD` | MySQL password | `root` |
| `DB_NAME` | MySQL database name | `airbnb_hotel` |
| `REDIS_HOST` | Redis host for BullMQ room generation queue | `localhost` |
| `REDIS_PORT` | Redis port | `6379` |
| `ROOM_CRON` | Cron schedule expression for autonomous availability extension | `0 2 * * *` |

### 3. `BookingService/.env`
| Variable | Description | Default / Example |
| :--- | :--- | :--- |
| `PORT` | HTTP server listening port | `3001` |
| `DATABASE_URL` | Prisma MySQL database connection string | `mysql://root:root@localhost:3306/airbnb_booking` |
| `REDIS_SERVER_URL` | Redis URL for Redlock mutexes and BullMQ email queue | `redis://localhost:6379` |
| `LOCK_TTL` | Redlock distributed lock expiration duration in milliseconds | `5000` |
| `HOTEL_SERVICE_URL`| Target URL for internal REST communication with HotelService | `http://localhost:3000/api/v1/` |

### 4. `NotificationService/.env`
| Variable | Description | Default / Example |
| :--- | :--- | :--- |
| `PORT` | HTTP server listening port | `3002` |
| `REDIS_HOST` | Redis host for BullMQ email queue | `localhost` |
| `REDIS_PORT` | Redis port | `6379` |
| `MAIL_USER` | SMTP username / sender email | `your_email@example.com` |
| `MAIL_PASS` | SMTP application password | `your_email_password` |

---

## API Reference

All client traffic can be directed through the **API Gateway** (`http://localhost:8080`) or directly to individual microservices during development.

### 1. Auth & Identity Endpoints (`AuthInGo` on `:8080`)

| Method | Path | Auth Required | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/ping` | No | Auth service health check |
| `POST` | `/signup` | No | Register a new user account |
| `POST` | `/login` | No | Authenticate credentials and receive signed JWT token |
| `GET` | `/profile` | `Bearer <JWT>` | Retrieve authenticated user profile (Roles: `user`, `admin`) |
| `POST` | `/api/otp/send` | No | Generate and dispatch an OTP via NotificationService |
| `POST` | `/api/otp/verify` | No | Validate provided OTP code against active record |
| `POST` | `/api/otp/resend` | No | Invalidate old OTP and dispatch a fresh code |
| `GET` | `/roles` | No | Fetch all system roles |
| `POST` | `/roles` | No | Create a new role definition |
| `GET` | `/roles/:id` | No | Get role metadata by ID |
| `PUT` | `/roles/:id` | No | Update role description |
| `DELETE` | `/roles/:id` | No | Remove a role definition |
| `GET` | `/roles/:id/permissions` | No | List permissions assigned to a role |
| `POST` | `/roles/:id/permissions` | No | Associate permission ID with role ID |
| `DELETE` | `/roles/:id/permissions` | No | Revoke permission from role |
| `GET` | `/role-permissions` | No | List all active role-permission mappings |
| `POST` | `/roles/:userId/assign/:roleId` | `Bearer <JWT>` | Assign role to user (Roles: `admin`) |

### 2. Gateway Reverse Proxy Routes (`:8080`)

| Method | Gateway Path | Target Service & Path | Description |
| :--- | :--- | :--- | :--- |
| `ANY` | `/hotelservice/*` | `HotelService (:3000)/*` | Proxied with path stripping and `X-User-ID` propagation |
| `ANY` | `/bookingservice/*` | `BookingService (:3001)/*` | Proxied with path stripping and `X-User-ID` propagation |

### 3. Hotel & Inventory Endpoints (`HotelService` on `:3000`)

| Method | Path | Description |
| :--- | :--- | :--- |
| `GET` | `/api/v1/ping` | Hotel service health check |
| `POST` | `/api/v1/hotels` | Register a new hotel property |
| `GET` | `/api/v1/hotels` | List all active hotel properties |
| `GET` | `/api/v1/hotels/:id` | Retrieve hotel details by ID |
| `DELETE`| `/api/v1/hotels/:id` | Soft delete a hotel property (`deletedAt`) |
| `GET` | `/api/v1/rooms/available` | Query available room slots (`roomCategoryId`, `checkInDate`, `checkOutDate`) |
| `POST` | `/api/v1/rooms/update-booking-id`| Assign `bookingId` to room slot records (called by BookingService) |
| `POST` | `/api/v1/room-generation` | Dispatch asynchronous batch room date generation to BullMQ queue |
| `GET` | `/api/v1/scheduler/status` | Get current state of the rolling inventory cron scheduler |
| `POST` | `/api/v1/scheduler/start` | Start the automated inventory extension scheduler |
| `POST` | `/api/v1/scheduler/stop` | Pause the automated inventory extension scheduler |
| `POST` | `/api/v1/scheduler/extend` | Manually trigger an immediate inventory window extension |

### 4. Booking & Concurrency Endpoints (`BookingService` on `:3001`)

| Method | Path | Description |
| :--- | :--- | :--- |
| `GET` | `/api/v1/ping` | Booking service health check |
| `POST` | `/api/v1/bookings` | **Phase 1**: Acquire Redlock, create `PENDING` booking, issue `idempotencyKey` |
| `POST` | `/api/v1/bookings/confirm/:idempotencyKey`| **Phase 2**: Idempotently confirm booking with row-level locks and enqueue email |
| `GET` | `/api/v1/bookings/:id` | Fetch reservation details by booking ID |

### 5. Notification Endpoints (`NotificationService` on `:3002`)

| Method | Path | Description |
| :--- | :--- | :--- |
| `GET` | `/api/v1/ping` | Notification service health check |
| `POST` | `/api/v1/notifications/send` | Enqueue an email dispatch job into `queue-mailer` |

---

## Testing & Verification

### 1. Automated Integration Suite (Postman)

A pre-configured Postman collection and environment are included under [`./postman`](./postman):
- [`postman/Airbnb_Microservices.postman_collection.json`](./postman/Airbnb_Microservices.postman_collection.json)
- [`postman/Airbnb_Microservices.postman_environment.json`](./postman/Airbnb_Microservices.postman_environment.json)

**How to run in Postman:**
1. Import both `.json` files into Postman (`File` $\rightarrow$ `Import`).
2. Select the active environment: **Airbnb Microservices Local Environment**.
3. Run the collection using the Postman Collection Runner or execute folders sequentially:
   - `01 - Auth & API Gateway` (signs up, logs in, stores token)
   - `02 - Hotel Service` (creates hotel, generates room dates)
   - `03 - Booking Service` (creates pending booking, confirms idempotency)
   - `04 - Notification Service` (verifies direct notification dispatch)
   - `05 - Reverse Proxy Gateway Routing` (verifies proxied access via `:8080`)

### 2. Unit & Integration Tests (HotelService)

`HotelService` includes automated Jest unit and controller tests:

```bash
cd HotelService

# Run test suite
npm test

# Run tests in watch mode
npm run test:watch

# Generate code coverage report
npm run test:cov
```

---

## Author & License

- **Author**: yashuu2008
- **License**: [MIT](https://opensource.org/licenses/MIT)
