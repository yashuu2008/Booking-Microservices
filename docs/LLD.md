# Airbnb Microservices Platform - Low Level Design (LLD)

## 1. Database Schemas & Relational Data Models

The platform enforces strict relational boundaries across three isolated MySQL databases. No cross-database joins or cross-service foreign keys exist.

---

### 1.1 Database: `auth_dev` (`AuthInGo`)

#### Tables:
1. **`users`**: User identity accounts.
   ```sql
   CREATE TABLE users (
       id BIGINT AUTO_INCREMENT PRIMARY KEY,
       username VARCHAR(50) NOT NULL UNIQUE,
       email VARCHAR(100) NOT NULL UNIQUE,
       password_hash VARCHAR(255) NOT NULL,
       is_verified BOOLEAN DEFAULT FALSE,
       created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
       updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
       INDEX idx_users_email (email)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
   ```
2. **`roles`**: System roles (`admin`, `user`, `manager`).
   ```sql
   CREATE TABLE roles (
       id BIGINT AUTO_INCREMENT PRIMARY KEY,
       name VARCHAR(50) NOT NULL UNIQUE,
       description VARCHAR(200) NOT NULL,
       created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
   ```
3. **`permissions`**: Granular permissions (e.g. `CREATE_HOTEL`, `CANCEL_BOOKING`).
   ```sql
   CREATE TABLE permissions (
       id BIGINT AUTO_INCREMENT PRIMARY KEY,
       name VARCHAR(100) NOT NULL UNIQUE,
       description VARCHAR(255) NOT NULL,
       created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
   ```
4. **`role_permissions`**: Many-to-Many junction mapping roles to permissions.
   ```sql
   CREATE TABLE role_permissions (
       role_id BIGINT NOT NULL,
       permission_id BIGINT NOT NULL,
       PRIMARY KEY (role_id, permission_id),
       FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
       FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
   ```
5. **`user_roles`**: Many-to-Many junction mapping users to assigned roles.
   ```sql
   CREATE TABLE user_roles (
       user_id BIGINT NOT NULL,
       role_id BIGINT NOT NULL,
       PRIMARY KEY (user_id, role_id),
       FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
       FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
   ```
6. **`otps`**: Temporary one-time authentication tokens.
   ```sql
   CREATE TABLE otps (
       id BIGINT AUTO_INCREMENT PRIMARY KEY,
       email VARCHAR(100) NOT NULL,
       code VARCHAR(6) NOT NULL,
       purpose ENUM('email_verification', 'password_reset') NOT NULL,
       is_used BOOLEAN DEFAULT FALSE,
       expires_at TIMESTAMP NOT NULL,
       created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
       INDEX idx_otps_lookup (email, purpose, is_used)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
   ```

---

### 1.2 Database: `airbnb_hotel` (`HotelService`)

#### Sequelize Models & Table Schemas:
1. **`hotels`**: Physical property records.
   ```sql
   CREATE TABLE hotels (
       id INT AUTO_INCREMENT PRIMARY KEY,
       name VARCHAR(255) NOT NULL,
       address VARCHAR(255) NOT NULL,
       location VARCHAR(255) NOT NULL,
       rating FLOAT DEFAULT NULL,
       rating_count INT DEFAULT NULL,
       created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
       updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
       deleted_at TIMESTAMP NULL DEFAULT NULL,
       INDEX idx_hotels_location (location)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
   ```
2. **`room_categories`**: Room classifications per hotel.
   ```sql
   CREATE TABLE room_categories (
       id INT AUTO_INCREMENT PRIMARY KEY,
       hotel_id INT NOT NULL,
       price INT NOT NULL,
       room_type ENUM('SINGLE', 'DOUBLE', 'FAMILY', 'DELUXE', 'SUITE') NOT NULL,
       room_count INT NOT NULL,
       created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
       updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
       deleted_at TIMESTAMP NULL DEFAULT NULL,
       FOREIGN KEY (hotel_id) REFERENCES hotels(id) ON DELETE CASCADE,
       INDEX idx_category_hotel (hotel_id)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
   ```
3. **`rooms`**: Discrete daily materialized inventory slots.
   ```sql
   CREATE TABLE rooms (
       id INT AUTO_INCREMENT PRIMARY KEY,
       hotel_id INT NOT NULL,
       room_category_id INT NOT NULL,
       date_of_availability DATE NOT NULL,
       price INT NOT NULL,
       booking_id INT DEFAULT NULL,
       created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
       updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
       deleted_at TIMESTAMP NULL DEFAULT NULL,
       FOREIGN KEY (hotel_id) REFERENCES hotels(id) ON DELETE CASCADE,
       FOREIGN KEY (room_category_id) REFERENCES room_categories(id) ON DELETE CASCADE,
       INDEX idx_avail_search (room_category_id, date_of_availability, booking_id)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
   ```

---

### 1.3 Database: `airbnb_booking` (`BookingService`)

#### Prisma Schema:
```prisma
datasource db {
  provider = "mysql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

model Booking {
  id                Int             @id @default(autoincrement())
  userId            Int
  hotelId           Int
  roomCategoryId    Int
  checkInDate       DateTime
  checkOutDate      DateTime
  createdAt         DateTime        @default(now())
  updatedAt         DateTime        @updatedAt
  bookingAmount     Int
  status            BookingStatus   @default(PENDING)
  totalGuests       Int
  idempotencyKey    IdempotencyKey?

  @@index([userId])
  @@index([hotelId])
}

model IdempotencyKey {
  id         Int      @id @default(autoincrement())
  idemKey    String   @unique
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt
  finalized  Boolean  @default(false)
  bookingId  Int      @unique
  booking    Booking? @relation(fields: [bookingId], references: [id])
}

enum BookingStatus {
  PENDING
  CONFIRMED
  CANCELLED
}
```

---

## 2. In-Memory & Redis Data Structures

### 2.1 Distributed Mutex Keys (Redlock)
- **Key Pattern:** `hotel:{hotelId}`
- **Type:** String (Redis Lock Token)
- **TTL:** `5000ms` (configured via `LOCK_TTL`)
- **Acquisition Logic:**
  ```typescript
  const redlock = new Redlock([redisConnection], {
      driftFactor: 0.01,
      retryCount: 10,
      retryDelay: 200,
      retryJitter: 200
  });
  const lock = await redlock.acquire([`hotel:${hotelId}`], 5000);
  ```

### 2.2 BullMQ Queue Specifications

| Queue Constant | Queue Name | Payload Interface / DTO | Purpose |
| :--- | :--- | :--- | :--- |
| `ROOM_GENERATION_QUEUE` | `"room-generation-queue"` | `RoomGenerationJob` | Background batch generation of discrete daily room inventory |
| `MAILER_QUEUE` | `"queue-mailer"` | `NotificationDto` | Asynchronous email compilation and SMTP delivery |

#### Payload Schemas:
```typescript
// NotificationDto
export interface NotificationDto {
    to: string;
    subject: string;
    templateId: string;
    params?: Record<string, any>;
}

// RoomGenerationJob
export interface RoomGenerationJob {
    roomCategoryId: number;
    startDate: string; // ISO DateTime
    endDate: string;   // ISO DateTime
    priceOverride?: number;
    batchSize?: number;
}
```

---

## 3. Service Layer & Business Logic Internals

### 3.1 AuthInGo: Edge Gateway & Cryptography

#### Reverse Proxy Implementation (`utils/proxy.go`):
```go
func ProxyToService(targetBaseUrl string, pathPrefix string) http.HandlerFunc {
    target, err := url.Parse(targetBaseUrl)
    if err != nil {
        return nil
    }

    proxy := httputil.NewSingleHostReverseProxy(target)
    originalDirector := proxy.Director

    proxy.Director = func(r *http.Request) {
        originalDirector(r)
        // Strip routing path prefix (e.g. /hotelservice)
        strippedPath := strings.TrimPrefix(r.URL.Path, pathPrefix)
        r.URL.Host = target.Host
        r.URL.Path = target.Path + strippedPath
        r.Host = target.Host

        // Inject authenticated user context header
        if userId, ok := r.Context().Value("userID").(string); ok {
            r.Header.Set("X-User-ID", userId)
        }
    }
    return proxy.ServeHTTP
}
```

#### JWT Claims & Token Generation (`utils/auth.go`):
- Signed with HMAC-SHA256 (`jwt.SigningMethodHS256`).
- Standard Claims: `user_id`, `email`, `roles`, `exp` (24 hours).

---

### 3.2 HotelService: Date-Slotting Inventory & Scheduler

#### Availability Algorithm (`services/room.service.ts`):
Given `checkInDate`, `checkOutDate`, and `roomCategoryId`:
1. Calculate expected stay duration: $D = \text{checkOutDate} - \text{checkInDate}$.
2. Query daily slots matching criteria:
   ```typescript
   const rooms = await Room.findAll({
       where: {
           roomCategoryId,
           dateOfAvailability: {
               [Op.gte]: checkInDate,
               [Op.lt]: checkOutDate
           },
           bookingId: null,
           deletedAt: null
       },
       order: [['dateOfAvailability', 'ASC']]
   });
   ```
3. Group available room records by continuous date sequence.
4. Return IDs of room slots ready to be assigned.

#### Autonomous Cron Engine (`scheduler/roomScheduler.ts`):
```typescript
export const startScheduler = () => {
    const cronSchedule = serverConfig.ROOM_CRON || '0 2 * * *';
    cron.schedule(cronSchedule, async () => {
        logger.info('Executing autonomous room inventory extension cron');
        const latestDate = await Room.max('dateOfAvailability');
        // If latest availability window is within 30 days, auto-extend by 90 days
        await roomGenerationQueue.add('payload:room-generation', {
            roomCategoryId: 1,
            startDate: latestDate,
            endDate: addDays(latestDate, 90)
        });
    });
};
```

---

### 3.3 BookingService: Concurrency & Idempotency Engine

#### Two-Phase Booking Confirmation (`services/booking.service.ts`):
```typescript
export async function confirmBooking(idempotencyKey: string) {
    return await prisma.$transaction(async (tx) => {
        // 1. Pessimistic row-level lock
        const keyRecord = await tx.$queryRaw<IdempotencyKey[]>`
            SELECT * FROM IdempotencyKey WHERE idemKey = ${idempotencyKey} FOR UPDATE
        `;

        if (!keyRecord || keyRecord.length === 0) {
            throw new AppError("Idempotency key not found", 404);
        }

        const key = keyRecord[0];
        if (key.finalized) {
            throw new AppError("Idempotency key has already been finalized", 400);
        }

        // 2. Fetch booking record
        const booking = await tx.booking.findUnique({
            where: { id: key.bookingId }
        });

        if (!booking) {
            throw new AppError("Associated booking not found", 404);
        }

        // 3. Mark rooms as booked in HotelService
        await updateBookingIdToRooms(booking.id, booking.roomIds);

        // 4. Update booking state
        const confirmedBooking = await tx.booking.update({
            where: { id: booking.id },
            data: { status: "CONFIRMED" }
        });

        // 5. Finalize idempotency key
        await tx.idempotencyKey.update({
            where: { id: key.id },
            data: { finalized: true }
        });

        // 6. Enqueue confirmation notification
        await addEmailToQueue({
            to: "guest@example.com",
            subject: "Your Booking is Confirmed!",
            templateId: "booking_confirmation",
            params: {
                bookingId: booking.id,
                amount: booking.bookingAmount
            }
        });

        return confirmedBooking;
    });
}
```

---

## 4. API Request / Response Data Contracts

### 4.1 AuthInGo (`:8080`)

#### `POST /signup`
- **Request Body:**
  ```json
  {
    "username": "alex_dev",
    "email": "alex@example.com",
    "password": "SecurePassword123!"
  }
  ```
- **Response (201 Created):**
  ```json
  {
    "success": true,
    "message": "User created successfully",
    "data": {
      "Id": 1,
      "Username": "alex_dev",
      "Email": "alex@example.com",
      "IsVerified": false
    }
  }
  ```

#### `POST /login`
- **Request Body:**
  ```json
  {
    "email": "alex@example.com",
    "password": "SecurePassword123!"
  }
  ```
- **Response (200 OK):**
  ```json
  {
    "success": true,
    "message": "User logged in successfully",
    "data": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
  ```

---

### 4.2 HotelService (`:3000`)

#### `POST /api/v1/hotels`
- **Request Body (Zod `hotelSchema`):**
  ```json
  {
    "name": "Seaside Resort",
    "address": "45 Coastal Highway",
    "location": "Goa",
    "rating": 4.8,
    "ratingCount": 240
  }
  ```
- **Response (201 Created):**
  ```json
  {
    "success": true,
    "data": {
      "id": 1,
      "name": "Seaside Resort",
      "address": "45 Coastal Highway",
      "location": "Goa",
      "rating": 4.8,
      "ratingCount": 240,
      "createdAt": "2026-11-20T00:00:00.000Z",
      "updatedAt": "2026-11-20T00:00:00.000Z"
    }
  }
  ```

#### `GET /api/v1/rooms/available`
- **Query Params:** `?roomCategoryId=1&checkInDate=2026-12-01&checkOutDate=2026-12-04`
- **Response (200 OK):**
  ```json
  {
    "success": true,
    "data": [
      { "id": 101, "dateOfAvailability": "2026-12-01", "price": 4500 },
      { "id": 102, "dateOfAvailability": "2026-12-02", "price": 4500 },
      { "id": 103, "dateOfAvailability": "2026-12-03", "price": 4500 }
    ]
  }
  ```

---

### 4.3 BookingService (`:3001`)

#### `POST /api/v1/bookings` (Phase 1)
- **Request Body (Zod `createBookingSchema`):**
  ```json
  {
    "userId": 1,
    "hotelId": 1,
    "roomCategoryId": 1,
    "totalGuests": 2,
    "bookingAmount": 13500,
    "checkInDate": "2026-12-01",
    "checkOutDate": "2026-12-04"
  }
  ```
- **Response (201 Created):**
  ```json
  {
    "success": true,
    "message": "Booking created successfully",
    "data": {
      "bookingId": 42,
      "idempotencyKey": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
      "status": "PENDING"
    }
  }
  ```

#### `POST /api/v1/bookings/confirm/:idempotencyKey` (Phase 2)
- **URL Parameter:** `:idempotencyKey`
- **Response (200 OK):**
  ```json
  {
    "success": true,
    "message": "Booking confirmed successfully",
    "data": {
      "id": 42,
      "status": "CONFIRMED",
      "bookingAmount": 13500,
      "finalized": true
    }
  }
  ```

---

## 5. Error Handling & Global Middleware

### 5.1 Correlation ID Tracing
Every request flowing into Express services passes through `attachCorrelationIdMiddleware`:
- Inspects header `x-correlation-id`.
- If missing, generates a fresh UUID v4 via `uuidv4()`.
- Stores correlation ID in Node.js `AsyncLocalStorage`.
- Attaches correlation ID to all outgoing Winston log entries.

### 5.2 Error Classification & Responses

| Error Type | HTTP Status | Response Format | Handling Strategy |
| :--- | :--- | :--- | :--- |
| **Zod / Validation Error** | `400 Bad Request` | `{"success": false, "message": "Validation Error", "errors": [...]}` | Caught by validator middleware; request halts before controller. |
| **Idempotency Replay** | `400 Bad Request` | `{"success": false, "message": "Idempotency key already finalized"}` | Aborts transaction; no double processing. |
| **Unauthorized / Bad Token** | `401 Unauthorized` | `{"success": false, "message": "Invalid token"}` | Gateway JWT middleware rejects request. |
| **Forbidden Role** | `403 Forbidden` | `{"success": false, "message": "Forbidden access"}` | RBAC middleware checks `user_roles`. |
| **Not Found** | `404 Not Found` | `{"success": false, "message": "Resource not found"}` | Handled by repository layer. |
| **Redlock Concurrency Contention** | `500 / 429` | `{"success": false, "message": "Could not acquire lock"}` | Redlock retries up to 10 times with jitter; throws if contested. |
