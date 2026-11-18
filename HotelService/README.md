# Hotel Service & Dynamic Inventory Engine

A core hospitality inventory microservice built with Express 5, TypeScript, Sequelize ORM, MySQL, Redis, BullMQ, and node-cron.

---

## Features

- **Dynamic Date-Slotting Inventory**: Pre-materializes discrete daily inventory slots in MySQL, eliminating slow date-range overlap queries.
- **Asynchronous Room Generation Engine**: Offloads heavy multi-month room availability generation to BullMQ Redis background worker queues.
- **Autonomous Rolling Availability Scheduler**: A cron daemon (`node-cron`) automatically queries latest room dates and rolls forward room availability.
- **Generic Base Repository Pattern**: Reusable TypeScript repository abstraction over Sequelize models (`BaseRepository<T>`).
- **Distributed Tracing**: Request correlation propagation using `AsyncLocalStorage` and Winston JSON logging.

---

## API Endpoints

### Hotel Management
- `POST /api/v1/hotels` - Register a new hotel
- `GET /api/v1/hotels` - Fetch all hotels
- `GET /api/v1/hotels/:id` - Fetch hotel by ID
- `DELETE /api/v1/hotels/:id` - Soft delete hotel

### Room Inventory Generation
- `POST /api/v1/room-generation` - Dispatch asynchronous room inventory generation batch job

### Automated Scheduler Management
- `POST /api/v1/scheduler/start` - Start the autonomous availability extension scheduler
- `POST /api/v1/scheduler/stop` - Stop the scheduler
- `GET /api/v1/scheduler/status` - Check current scheduler state
- `POST /api/v1/scheduler/extend` - Manually trigger an immediate availability extension

---

## Setup & Running

### 1. Prerequisites
- Node.js 20+
- MySQL 8.0+
- Redis 7.0+

### 2. Environment Configuration
Create a `.env` file in `HotelService`:
```env
PORT=3000
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=root
DB_NAME=airbnb_hotel
REDIS_HOST=localhost
REDIS_PORT=6379
ROOM_CRON="0 2 * * *"
```

### 3. Install & Run
```bash
# Install dependencies
npm install

# Run database migrations
npm run migrate

# Start development server
npm run dev
```
