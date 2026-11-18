# AuthInGo & API Gateway Service

A high-performance Authentication, Role-Based Access Control (RBAC), and Reverse Proxy Gateway service built with Go 1.24 and Chi.

---

## Features

- **Authentication & Cryptography**: User registration and login with bcrypt password hashing and signed JWT authentication.
- **Normalized RBAC Architecture**: Multi-tier permissions and roles (`users`, `roles`, `permissions`, `role_permissions`, `user_roles`).
- **Edge Reverse Proxy**: Dynamic request forwarding (`net/http/httputil`) that strips path prefixes, enforces upstream security, and injects authenticated user context headers (`X-User-ID`).
- **Rate Limiting**: Built-in token-bucket rate limiter middleware (`golang.org/x/time/rate`).
- **Database Migrations**: Version-controlled SQL schema migrations with Goose.

---

## Directory Structure

```
├── app/              # Application bootstrap & HTTP server configuration
├── config/           # Database and environment configurations
├── controllers/      # HTTP request handlers & response formatting
├── db/
│   ├── migrations/   # Goose SQL migration scripts
│   └── repositories/ # Raw SQL database repository layer
├── dto/              # Request / Response Data Transfer Objects
├── middlewares/      # JWT auth, RBAC role guard, and rate limiter middlewares
├── models/           # Domain entity definitions
├── router/           # Chi router declarations & routing tables
├── utils/            # JWT helpers, hashing, reverse proxy, and JSON writers
├── main.go           # Application entrypoint
└── Makefile          # Build and migration targets
```

---

## API Endpoints

### Authentication
- `POST /signup` - Register a new user account
- `POST /login` - Authenticate user credentials and return JWT bearer token
- `GET /profile` - Retrieve authenticated user profile (requires Bearer token)

### Role-Based Access Control (RBAC)
- `GET /roles` - List all roles
- `GET /roles/{id}` - Get role details
- `POST /roles` - Create a new role
- `PUT /roles/{id}` - Update role metadata
- `DELETE /roles/{id}` - Delete a role
- `GET /roles/{id}/permissions` - Get permissions mapped to a role
- `POST /roles/{id}/permissions` - Assign a permission to a role
- `DELETE /roles/{id}/permissions` - Revoke a permission from a role
- `POST /roles/{userId}/assign/{roleId}` - Assign role to user (admin only)

---

## Setup & Running

### 1. Prerequisites
- Go 1.24+
- MySQL 8.0+

### 2. Environment Configuration
Create a `.env` file in the root of `AuthInGo`:
```env
PORT=:8080
DB_USER=root
DB_PASSWORD=root
DB_NET=tcp
DB_ADDR=127.0.0.1:3306
DBName=auth_dev
JWT_SECRET=your_super_secret_jwt_key
```

### 3. Run Migrations & Start
```bash
# Run Goose migrations
make migrate-up

# Start the service
go run main.go
```
