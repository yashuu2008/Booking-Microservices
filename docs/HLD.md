# Airbnb Microservices Platform - High Level Design (HLD)

## 1. System Overview

The **Airbnb Microservices Platform** is an enterprise-grade distributed reservation architecture designed to handle high-concurrency booking operations, eliminate race conditions and double-bookings, and optimize inventory lookups at scale.

The architecture decouples identity management, catalog inventory, transactional reservations, and email notifications into autonomous, specialized services communicating over synchronous HTTP/REST and asynchronous Redis BullMQ queues.

```
                            CLIENTS / FRONTEND / POSTMAN
                                         |
                                         | HTTP Requests
                                         v
    +--------------------------------------------------------------------------+
    |                 EDGE REVERSE PROXY & AUTH GATEWAY (:8080)                |
    |                                                                          |
    |   +-----------------------+    +------------------+    +-------------+   |
    |   | Auth & RBAC Engine    |    | Reverse Proxy    |    | Token-Bucket|   |
    |   | (Go 1.24 + Chi)       |    | (net/httputil)   |    | Rate Limiter|   |
    |   +-----------+-----------+    +--------+---------+    +-------------+   |
    +---------------|-------------------------|--------------------------------+
                    |                         |
         +----------+            +------------+------------+
         |                       |                         |
         | SQL (Goose)           | /hotelservice/*         | /bookingservice/*
         v                       v (Stripped + X-User-ID)  v (Stripped + X-User-ID)
    +-----------+       +-------------------+     +--------------------+
    | MySQL     |       | HOTEL SERVICE     |     | BOOKING SERVICE    |
    | auth_dev  |       | (:3000)           |     | (:3001)            |
    +-----------+       |                   |     |                    |
                        | Express 5 + TS    |     | Express 5 + TS     |
                        | Sequelize ORM     |     | Prisma ORM         |
                        | Dynamic Inventory |     | Two-Phase Engine   |
                        +---------+---------+     +----+----------+----+
                                  |                    |          |
                                  |                    |          |
                        +---------+----------+         |          |
                        | Check Availability |<--------+          |
                        | Update Booking ID  | (Sync REST Axios)  |
                        +--------------------+                    |
                                  |                               |
             +--------------------+-------+                       |
             |                            |                       |
             v                            v                       v
    +-----------------+          +-----------------------------------------+
    | MySQL           |          | REDIS CLUSTER / INSTANCE (:6379)        |
    | airbnb_hotel    |          |                                         |
    +-----------------+          |  - Distributed Redlock: `hotel:{id}`    |
                                 |  - Queue: `room-generation-queue`       |
                                 |  - Queue: `queue-mailer`                |
                                 +--------------------+--------------------+
                                                      |
                                                      | Consume `queue-mailer`
                                                      v
                                         +-------------------------+
                                         | NOTIFICATION SERVICE    |
                                         | (:3002)                 |
                                         |                         |
                                         | Express 5 + BullMQ      |
                                         | Handlebars Compiler     |
                                         | Nodemailer SMTP         |
                                         +------------+------------+
                                                      |
                                                      v
                                              +---------------+
                                              | SMTP Server   |
                                              +---------------+
```

---

## 2. Core Architectural Principles

### 2.1 Domain-Driven Microservices Boundaries
Each service is physically and logically partitioned according to bounded contexts. Services manage private relational databases; no service is permitted to directly query or alter another service's tables.
- **Identity Context (`AuthInGo`):** Manages user accounts, authentication tokens, and RBAC hierarchies.
- **Inventory Context (`HotelService`):** Manages hospitality entities and daily room availability dates.
- **Booking Context (`BookingService`):** Manages reservation state machines, concurrency locks, and idempotency keys.
- **Notification Context (`NotificationService`):** Manages template compilation and email delivery.

### 2.2 Polyglot Runtime Selection
- **Go 1.24 for Edge Gateway & Auth:** Selected for exceptional memory efficiency, fast startup, high concurrency via lightweight goroutines, and raw network routing performance for reverse-proxying downstream traffic.
- **Node.js 20+ (TypeScript) for Application Services:** Selected for rich ORM ecosystems (Prisma, Sequelize), robust Redis/BullMQ worker integrations, and high productivity.

### 2.3 Strict Concurrency & Mutual Exclusion
To prevent overselling hotel rooms when concurrent users attempt to book the exact same room category simultaneously:
- **Distributed Mutex:** A distributed lock is acquired on the property resource (`hotel:{hotelId}`) via Redis Redlock before reservation records are created.
- **Pessimistic Row Locking:** During booking confirmation, database transactions lock the idempotency record using `SELECT ... FOR UPDATE`, ensuring serializable state transitions.

### 2.4 Pre-Materialized Date-Slotting Inventory
Traditional interval overlap queries (`WHERE check_in < ? AND check_out > ?`) suffer from high database I/O and query planning overhead at scale. This platform pre-materializes discrete daily records in the `rooms` table. A room search becomes a lightning-fast range check on an indexed `date_of_availability` column where `booking_id IS NULL`.

### 2.5 Event-Driven Asynchronous Decoupling
Long-running, non-critical tasks—such as batch room date slot generation and SMTP email dispatch—are decoupled from synchronous HTTP request-response cycles using BullMQ Redis queues, guaranteeing sub-50ms API response times.

---

## 3. Component Responsibilities

### 3.1 Auth & Edge Gateway (`AuthInGo` - Port `:8080`)
- **Centralized Authentication:** Issues and cryptographically validates HMAC-signed JSON Web Tokens (JWT).
- **Normalized RBAC Engine:** Implements a 5-table role-permission system (`users`, `roles`, `permissions`, `role_permissions`, `user_roles`) with database enforcement.
- **One-Time Password (OTP) Manager:** Generates, verifies, and invalidates temporary email verification and password reset tokens.
- **Reverse Proxy Director:** Routes public client requests to downstream microservices, strips routing prefixes (`/hotelservice`, `/bookingservice`), and forwards verified user identity via the `X-User-ID` header.
- **Token-Bucket Rate Limiter:** Protects upstream endpoints against DDoS and credential-stuffing attacks.

### 3.2 Hotel & Inventory Service (`HotelService` - Port `:3000`)
- **Hotel Catalog:** Manages hotel property CRUD operations, locations, addresses, and soft deletion (`deleted_at`).
- **Room Category Management:** Defines room types (`SINGLE`, `DOUBLE`, `FAMILY`, `DELUXE`, `SUITE`), capacity, and base pricing.
- **Date-Slotting Inventory Storage:** Stores pre-materialized room records with foreign key relationships to categories and assigned booking IDs.
- **Background Batch Room Generator:** Operates a BullMQ worker (`room-generation-queue`) that computes date ranges and bulk-inserts daily room slots.
- **Autonomous Rolling Availability Scheduler:** Employs `node-cron` to automatically evaluate the latest available inventory dates and dispatch periodic future window extensions.

### 3.3 Booking Service (`BookingService` - Port `:3001`)
- **Distributed Concurrency Guard:** Integrates Redlock to acquire distributed locks on `hotel:{hotelId}` during pending reservation creation.
- **Two-Phase Idempotency Engine:**
  - *Phase 1 (Intent):* Creates `PENDING` booking and generates unique client `idempotencyKey`.
  - *Phase 2 (Confirmation):* Executes an atomic ACID transaction with pessimistic row-locking (`SELECT ... FOR UPDATE`), verifies key state, updates booking to `CONFIRMED`, marks key `finalized = true`, and links rooms in `HotelService`.
- **Replay Protection:** Re-submitting an already finalized idempotency key immediately aborts with HTTP 400 Bad Request.
- **Event Producer:** Emits confirmed reservation events to Redis BullMQ `queue-mailer`.

### 3.4 Notification Service (`NotificationService` - Port `:3002`)
- **BullMQ Queue Consumer:** Worker listens on `queue-mailer` for transactional notification jobs.
- **Handlebars Engine:** Compiles modular templates (`booking_confirmation.hbs`, `welcome.hbs`, `email_verification_otp.hbs`).
- **SMTP Delivery:** Dispatches compiled emails via Nodemailer transport.
- **Direct HTTP Gateway:** Exposes `POST /api/v1/notifications/send` for direct inter-service synchronous triggers (e.g., AuthInGo OTP emails).

### 3.5 Shared Infrastructure
- **Redis 7.0+:** Serves as the central state coordinator for distributed Redlock locks and BullMQ job queues (`queue-mailer`, `room-generation-queue`).
- **MySQL 8.0+:** Provides ACID-compliant persistence across three dedicated logical databases: `auth_dev`, `airbnb_hotel`, and `airbnb_booking`.

---

## 4. End-to-End Data Flow

```
Client                  Gateway (:8080)        HotelService (:3000)      BookingService (:3001)    Redis (:6379)     NotificationService (:3002)
  |                           |                         |                         |                      |                       |
  |--- 1. POST /signup ------>|                         |                         |                      |                       |
  |<-- 201 Created (JWT) -----|                         |                         |                      |                       |
  |                           |                         |                         |                      |                       |
  |--- 2. POST /bookings ---->|                         |                         |                      |                       |
  |    (Via /bookingservice)  |--- Proxy + X-User-ID ---------------------------->|                      |                       |
  |                           |                         |                         |--- Acquire Lock ---->| (hotel:{id})          |
  |                           |                         |<-- Query Available -----|                      |                       |
  |                           |                         |--- Return Room IDs ---->|                      |                       |
  |                           |                         |                         |--- Create PENDING -->| [MySQL: booking]      |
  |                           |                         |                         |--- Release Lock ---->| (hotel:{id})          |
  |<-- 201 Created (idemKey) -|<--------------------------------------------------|                      |                       |
  |                           |                         |                         |                      |                       |
  |--- 3. POST /confirm/:key->|                         |                         |                      |                       |
  |    (Via /bookingservice)  |--- Proxy + X-User-ID ---------------------------->|                      |                       |
  |                           |                         |                         |--- SELECT FOR UPDATE | [MySQL: idemKey]      |
  |                           |                         |<-- Assign bookingId ----|                      |                       |
  |                           |                         |--- 200 OK --------------|                      |                       |
  |                           |                         |                         |--- Set CONFIRMED --->| [MySQL: commit]       |
  |                           |                         |                         |--- Enqueue Job ----->| ('queue-mailer')      |
  |<-- 200 OK (Confirmed) ----|<--------------------------------------------------|                      |                       |
  |                           |                         |                         |                      |--- Pop Job ---------->|
  |                           |                         |                         |                      |    Compile Template   |
  |                           |                         |                         |                      |    Deliver via SMTP   |
```

---

## 5. External & Infrastructure Dependencies

| Dependency | Required Version | Architectural Role | Isolation & Scaling Strategy |
| :--- | :--- | :--- | :--- |
| **MySQL Database** | 8.0+ | Relational data persistence for all 3 transactional domains | 3 isolated logical databases (`auth_dev`, `airbnb_hotel`, `airbnb_booking`). Can be split into 3 independent physical RDS instances. |
| **Redis** | 7.0+ | In-memory distributed lock manager and BullMQ message broker | Shared standalone instance in local dev; Redis Cluster or AWS ElastiCache with multi-AZ replication in production. |
| **SMTP Transport** | RFC 5321 | External mail transfer agent (e.g. Gmail SMTP, SendGrid, Amazon SES) | Asynchronously decoupled via BullMQ; slow SMTP responses never block HTTP threads. |

---

## 6. Deployment Architecture

```
                                  INTERNET / CLIENTS
                                          |
                                          | HTTPS / Port 443
                                          v
                              +-----------------------+
                              | Reverse Proxy / Nginx |
                              +-----------+-----------+
                                          |
                                          | HTTP / Port 8080
                                          v
                              +-----------------------+
                              | AuthInGo Gateway      |
                              | (:8080)               |
                              +---+---------------+---+
                                  |               |
                     HTTP / 3000  |               |  HTTP / 3001
                     +------------+               +------------+
                     v                                         v
        +-------------------------+               +-------------------------+
        | HotelService            |               | BookingService          |
        | (:3000)                 |               | (:3001)                 |
        +------------+------------+               +------------+------------+
                     |                                         |
                     +--------------------+--------------------+
                                          |
                                          | Internal Service Network
                                          v
                              +-----------------------+
                              | Redis Instance (:6379)|
                              | - Redlock Mutexes     |
                              | - BullMQ Queues       |
                              +-----------+-----------+
                                          |
                                          | Consume 'queue-mailer'
                                          v
                              +-----------------------+
                              | NotificationService   |
                              | (:3002)               |
                              +-----------+-----------+
                                          |
                                          v
                                    SMTP Provider
```

---

## 7. Scalability & Resilience Considerations

| Potential Bottleneck | Architectural Impact | Implemented Mitigation |
| :--- | :--- | :--- |
| **Simultaneous Booking Rush** | Race conditions on property inventory | Redis Redlock distributed mutex combined with MySQL `SELECT ... FOR UPDATE` row-level locks guarantees serial consistency. |
| **Date Range Overlap Calculation** | Slow $O(N)$ table scans across reservations | Date-slotting inventory converts overlap checks into indexed $O(\log N)$ range queries on `date_of_availability`. |
| **Slow Third-Party SMTP** | HTTP thread pool exhaustion | Notifications are pushed to Redis queues in $<5\text{ms}$; email generation and delivery run entirely in background workers. |
| **Gateway Bottleneck** | Reverse proxy latency degradation | Go's lightweight goroutines and non-blocking I/O handle thousands of concurrent forwarded connections with minimal memory overhead. |
| **Duplicate Requests / Retries** | Double charging or multiple room allocations | Two-phase idempotency engine validates finalized state inside ACID transactions, rejecting replays with HTTP 400. |

---

## 8. Security Model

| Security Dimension | Implementation Strategy |
| :--- | :--- |
| **Edge Authentication** | Signed JWT bearer tokens with expiration timestamps, verified at the gateway middleware level. |
| **Context Propagation** | Gateway verifies tokens and injects verified `X-User-ID` headers into upstream service requests; downstream services trust internal network gateway headers. |
| **Access Control (RBAC)** | Fine-grained role and permission enforcement (`RequireAnyRole`, `RequireAllRoles`) preventing unauthorized role elevations. |
| **Credential Security** | User passwords hashed using `bcrypt` with adaptive cost factors prior to database persistence. |
| **Denial of Service (DDoS)** | Built-in token-bucket rate limiter middleware (`golang.org/x/time/rate`) on the edge gateway. |
| **Injection Defense** | Parameterized SQL queries via Goose/raw repositories in Go, Sequelize parameterized queries in HotelService, and prepared Prisma queries in BookingService. |
