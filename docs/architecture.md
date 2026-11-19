# Airbnb Microservices Platform - Architecture Overview

This document provides a visual and operational walkthrough of every architectural component in the platform, detail on how services communicate, and tracing of end-to-end data lifecycles.

---

## 1. System Topology & Component Graph

```
+==================================================================================================+
|                                    CLIENTS & EXTERNAL CONSUMERS                                   |
|                                                                                                  |
|         +-----------------------+                    +---------------------------------+         |
|         | Web / Mobile Client   |                    | Automated Postman Test Suite    |         |
|         +-----------+-----------+                    +----------------+----------------+         |
+=====================|=================================================|==========================+
                      |                                                 |
                      +-----------------------+-------------------------+
                                              |
                                              | HTTP Requests
                                              v
+==================================================================================================+
|                          EDGE REVERSE PROXY & AUTH GATEWAY (AuthInGo :8080)                      |
|                                                                                                  |
|   +------------------------------------------------------------------------------------------+   |
|   | Chi HTTP Router & Middleware Pipeline                                                    |   |
|   |  - Token Bucket Rate Limiter (golang.org/x/time/rate)                                    |   |
|   |  - JWT Authentication Middleware (golang-jwt/jwt/v5)                                     |   |
|   |  - RBAC Role Guard Middleware (RequireAnyRole, RequireAllRoles)                          |   |
|   +------------------------------------------------------------------------------------------+   |
|       |                                 |                                 |                      |
|       v                                 v                                 v                      |
|   +---------------+             +-----------------+             +------------------+             |
|   | Auth Handlers |             | Proxy Director  |             | OTP Controller   |             |
|   | /signup       |             | Strips prefixes |             | /api/otp/send    |             |
|   | /login        |             | Injects headers |             | /api/otp/verify  |             |
|   | /roles        |             | (X-User-ID)     |             +--------+---------+             |
|   +-------+-------+             +--------+--------+                      |                       |
+===========|==============================|===============================|=======================+
            |                              |                               |
            v SQL (Goose)                  |                               v HTTP POST /send
      +-----------+                        |                       +-------------------------------+
      | MySQL     |                        |                       | NotificationService (:3002)   |
      | auth_dev  |                        |                       +-------------------------------+
      +-----------+                        |
                                           +-------------------------------+
                                           |                               |
                                           v HTTP /hotelservice/*          v HTTP /bookingservice/*
+======================================================+ +=========================================+
| HOTEL SERVICE (:3000)                                | | BOOKING SERVICE (:3001)                 |
|                                                      | |                                         |
|  +--------------------+    +----------------------+  | |  +-------------------+  +-------------+ |
|  | Hotels Controller  |    | Rooms Controller     |  | |  | Booking Controller|  | Hotel REST  | |
|  | /api/v1/hotels     |    | /rooms/available     |  | |  | /api/v1/bookings  |  | API Client  | |
|  +--------------------+    +----------+-----------+  | |  +---------+---------+  | (Axios)     | |
|                                       ^              | |            |            +------+------+ |
|                                       |              | |            v                   |        |
|  +--------------------+    +----------+-----------+  | |  +-------------------+         |        |
|  | Room Gen Processor |    | BaseRepository<T>    |  | |  | Booking Service   |<--------+        |
|  | (BullMQ Worker)    |    | (Sequelize ORM)      |  | |  | Redlock Mutex     |                  |
|  +---------+----------+    +----------+-----------+  | |  | 2-Phase Engine    |                  |
|            |                          |              | |  +---------+---------+                  |
|  +---------+----------+               |              | |            |                            |
|  | node-cron Daemon   |               |              | |  +---------+---------+                  |
|  | Rolling Extension  |               |              | |  | Prisma Client     |                  |
|  +--------------------+               |              | |  | (ACID + Row Locks)|                  |
+=======================================|==============+ +============|============================+
                                        |                             |
                                        v SQL                         v SQL
                                 +--------------+              +---------------+
                                 | MySQL        |              | MySQL         |
                                 | airbnb_hotel |              | airbnb_booking|
                                 +--------------+              +---------------+
                                        ^                             ^
                                        |                             |
                                        | Redis Connections           |
                                        v                             v
+==================================================================================================+
|                                    REDIS 7.0+ INFRASTRUCTURE (:6379)                             |
|                                                                                                  |
|   +-----------------------+    +---------------------------+    +----------------------------+   |
|   | Redlock Distributed   |    | BullMQ Job Queue:         |    | BullMQ Job Queue:          |   |
|   | Mutex: `hotel:{id}`   |    | `room-generation-queue`   |    | `queue-mailer`             |   |
|   +-----------------------+    +---------------------------+    +-------------+--------------+   |
+===============================================================================|==================+
                                                                                |
                                                                                | Pops Job `payload:mail`
                                                                                v
+==================================================================================================+
|                              NOTIFICATION SERVICE (:3002)                                        |
|                                                                                                  |
|   +------------------------------------------------------------------------------------------+   |
|   | setupMailerWorker() (BullMQ Worker)                                                      |   |
|   +------------------------------------------------------------------------------------------+   |
|       |                                                                                          |
|       v                                                                                          |
|   +---------------------------+    +--------------------------+    +-------------------------+   |
|   | Handlebars Template Engine|    | Dynamic Email Templates  |    | Nodemailer SMTP         |   |
|   | (templates.handler.ts)    |--->| - booking_confirmation   |--->| Transport               |   |
|   | Compiles context data     |    | - welcome, otp, reset    |    | (mailer.service.ts)     |   |
|   +---------------------------+    +--------------------------+    +------------+------------+   |
+=================================================================================|================+
                                                                                  |
                                                                                  | Delivers Email
                                                                                  v
                                                                        +------------------+
                                                                        | SMTP Mail Server |
                                                                        +------------------+
```

---

## 2. Request Flow Diagrams

### 2.1 User Registration & JWT Authentication Flow

```mermaid
sequenceDiagram
    autonumber
    actor Client
    participant Gateway as Auth & Gateway (:8080)
    participant DB as MySQL (auth_dev)

    Client->>Gateway: POST /signup {username, email, password}
    Gateway->>Gateway: Hash password with bcrypt (Cost: 10)
    Gateway->>DB: INSERT INTO users (username, email, password_hash)
    DB-->>Gateway: User ID 101 Created
    Gateway->>DB: INSERT INTO user_roles (user_id: 101, role_id: 'user')
    Gateway-->>Client: 201 Created {message: "User created successfully", data: {Id: 101}}

    Client->>Gateway: POST /login {email, password}
    Gateway->>DB: SELECT * FROM users WHERE email = ?
    DB-->>Gateway: Return user record
    Gateway->>Gateway: Compare bcrypt hash with password
    Gateway->>DB: SELECT roles, permissions for user
    DB-->>Gateway: Roles: ['user']
    Gateway->>Gateway: Generate signed HMAC-SHA256 JWT (Claims: userId, roles, exp)
    Gateway-->>Client: 200 OK {token: "<JWT_BEARER_TOKEN>"}
```

---

### 2.2 Reverse Proxy Gateway Routing Flow

```mermaid
sequenceDiagram
    autonumber
    actor Client
    participant Gateway as Auth & Gateway (:8080)
    participant RateLimit as Token-Bucket Rate Limiter
    participant Downstream as HotelService (:3000)

    Client->>Gateway: GET /hotelservice/api/v1/hotels (Header: Authorization: Bearer <JWT>)
    Gateway->>RateLimit: Check IP / Token-Bucket Capacity
    RateLimit-->>Gateway: Request Allowed
    Gateway->>Gateway: Validate JWT Signature & Extract userID
    Gateway->>Gateway: Strip Path Prefix '/hotelservice' -> '/api/v1/hotels'
    Gateway->>Gateway: Inject Header 'X-User-ID: 101'
    Gateway->>Downstream: HTTP GET /api/v1/hotels (Host: localhost:3000)
    Downstream-->>Gateway: 200 OK [JSON Hotel List]
    Gateway-->>Client: 200 OK [JSON Hotel List]
```

---

### 2.3 Room Inventory Pre-Materialization & Automated Cron Flow

```mermaid
sequenceDiagram
    autonumber
    participant Cron as node-cron Daemon
    participant Controller as Room Generation Controller
    participant Redis as Redis (room-generation-queue)
    participant Worker as BullMQ Room Worker
    participant MySQL as MySQL (airbnb_hotel)

    alt Manual / Admin Trigger
        Controller->>Redis: Enqueue Job `payload:room-generation` {roomCategoryId, startDate, endDate}
    else Automated Rolling Extension Trigger
        Cron->>Cron: Trigger daily schedule ("0 2 * * *")
        Cron->>MySQL: SELECT MAX(date_of_availability) FROM rooms
        MySQL-->>Cron: Latest Date: 2026-12-31
        Cron->>Redis: Enqueue Job to extend window to 2027-03-31
    end

    Redis->>Worker: Worker pops `payload:room-generation`
    loop For Each Date in Window
        Worker->>Worker: Generate discrete slot per available room count
    end
    Worker->>MySQL: Bulk INSERT INTO rooms (hotel_id, category_id, date, price, booking_id = NULL)
    MySQL-->>Worker: Bulk Insert Complete
    Worker-->>Redis: Mark Job Completed
```

---

### 2.4 Distributed Two-Phase Booking Confirmation Flow

```mermaid
sequenceDiagram
    autonumber
    actor Client
    participant Gateway as Gateway (:8080)
    participant Booking as BookingService (:3001)
    participant Hotel as HotelService (:3000)
    participant Redis as Redis (Redlock / BullMQ)
    participant MySQL as MySQL (airbnb_booking)
    participant Notif as NotificationService (:3002)

    Note over Client, Gateway: Phase 1: Reservation Intent
    Client->>Gateway: POST /bookingservice/api/v1/bookings
    Gateway->>Booking: Proxy Request + X-User-ID
    Booking->>Hotel: GET /api/v1/rooms/available?roomCategoryId=1&checkIn=...&checkOut=...
    Hotel-->>Booking: Return Available Room IDs: [401, 402, 403]
    Booking->>Redis: Redlock.lock("hotel:1", TTL: 5000ms)
    Redis-->>Booking: Lock Acquired
    Booking->>MySQL: INSERT INTO Booking (status: PENDING)
    Booking->>MySQL: INSERT INTO IdempotencyKey (idemKey: UUID, finalized: false)
    Booking->>Redis: Redlock.unlock("hotel:1")
    Booking-->>Client: 201 Created {bookingId: 88, idempotencyKey: "idem_abc123"}

    Note over Client, Gateway: Phase 2: Atomic Confirmation & Idempotency
    Client->>Gateway: POST /bookingservice/api/v1/bookings/confirm/idem_abc123
    Gateway->>Booking: Proxy Request + X-User-ID
    Booking->>MySQL: BEGIN TRANSACTION
    Booking->>MySQL: SELECT * FROM IdempotencyKey WHERE idemKey = 'idem_abc123' FOR UPDATE
    alt Already Finalized (Replay Attack / Duplicate Click)
        MySQL-->>Booking: finalized == true
        Booking->>MySQL: ROLLBACK
        Booking-->>Client: 400 Bad Request (Idempotency Key Already Finalized)
    else Unfinalized Key
        MySQL-->>Booking: finalized == false
        Booking->>Hotel: POST /api/v1/rooms/update-booking-id {bookingId: 88, roomIds: [401, 402, 403]}
        Hotel-->>Booking: 200 OK (Rooms Marked Booked)
        Booking->>MySQL: UPDATE Booking SET status = 'CONFIRMED' WHERE id = 88
        Booking->>MySQL: UPDATE IdempotencyKey SET finalized = true WHERE idemKey = 'idem_abc123'
        Booking->>MySQL: COMMIT TRANSACTION
        Booking->>Redis: BullMQ.add("payload:mail", NotificationDto) to 'queue-mailer'
        Booking-->>Client: 200 OK {status: "CONFIRMED", bookingId: 88}

        Note over Redis, Notif: Asynchronous Event Processing
        Redis->>Notif: Worker pops 'payload:mail'
        Notif->>Notif: Render Handlebars template 'booking_confirmation.hbs'
        Notif->>Notif: Nodemailer sends SMTP email
    end
```

---

## 3. Module & Service Dependency Graph

```
project1
  ├── AuthInGo (:8080)
  │     ├── chi router (routing & reverse proxy)
  │     ├── Goose (MySQL migrations for auth_dev)
  │     ├── rate limiter (token bucket)
  │     └── notification_client (HTTP calling NotificationService:3002)
  │
  ├── HotelService (:3000)
  │     ├── Express 5 router (/hotels, /rooms, /room-generation, /scheduler)
  │     ├── Sequelize ORM (MySQL models: Hotel, Room, RoomCategory)
  │     ├── BullMQ ('room-generation-queue' producer & worker)
  │     ├── node-cron ('roomScheduler.ts' automated availability extension)
  │     └── Jest / Supertest (tests/controllers/)
  │
  ├── BookingService (:3001)
  │     ├── Express 5 router (/bookings)
  │     ├── Prisma ORM (MySQL models: Booking, IdempotencyKey)
  │     ├── Redlock algorithm (ioredis mutex on 'hotel:{id}')
  │     ├── hotel.api.ts (Axios REST client calling HotelService:3000)
  │     └── email.producer.ts (BullMQ producer pushing to 'queue-mailer')
  │
  └── NotificationService (:3002)
        ├── Express 5 router (/notifications)
        ├── BullMQ ('queue-mailer' worker)
        ├── Handlebars (templates/mailer/*.hbs)
        └── Nodemailer (SMTP transport)
```

---

## 4. Background Services & Cron Daemons

| Worker / Daemon | Process Host | Trigger Interval / Queue | Purpose & Responsibilities |
| :--- | :--- | :--- | :--- |
| **`setupMailerWorker`** | `NotificationService` | Continuous (`queue-mailer`) | Consumes booking confirmation and welcome email events from Redis, compiles Handlebars templates, and transmits SMTP mail. |
| **`setupRoomGenerationWorker`** | `HotelService` | On-Demand (`room-generation-queue`) | Pulls batch room generation jobs, performs calendar iteration, and executes bulk database insertions for daily room inventory. |
| **`startScheduler`** | `HotelService` | Cron Expression (`ROOM_CRON`: `"0 2 * * *"`) | Inspects current date horizon in MySQL, identifies approaching availability cutoffs, and dispatches future extension jobs automatically. |

---

## 5. Data Lifecycle & State Transition Matrix

### Booking Entity Lifecycle:
```
[Client Request] ──> PENDING ──> [Two-Phase Confirmation] ──> CONFIRMED ──> [BullMQ Event Emitted]
                        │
                        └──> CANCELLED (Timeout / User Abort)
```

| Current Status | Event / Trigger | Target Status | Side Effects & Actions |
| :--- | :--- | :--- | :--- |
| `None` | `POST /bookings` | `PENDING` | Redlock acquired, unfinalized idempotency key generated in database. |
| `PENDING` | `POST /bookings/confirm/:key` | `CONFIRMED` | Row lock verified, rooms assigned in HotelService, idempotency key finalized, BullMQ email queued. |
| `CONFIRMED` | Re-submission of same `:key` | `CONFIRMED` | Request rejected with HTTP 400 Bad Request; database state unchanged. |
| `PENDING` | Cancellation / Failure | `CANCELLED` | Lock released, room slots remain unassociated. |
