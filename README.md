# Roman Store

An end-to-end e-commerce platform built with **vanilla HTML/CSS/JavaScript (ES modules)** on the frontend and **Node.js, Express 5, and PostgreSQL** on the backend. No frontend frameworks, no bundlers, zero build step.

---

## Table of Contents

- [Overview](#overview)
- [Key Features](#key-features)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [Admin Access & Bootstrapping](#admin-access--bootstrapping)
- [Mock Mode (Frontend Without Database)](#mock-mode-frontend-without-database)
- [Testing & Quality Assurance](#testing--quality-assurance)
- [Docker & Containerized Setup](#docker--containerized-setup)
- [Deployment](#deployment)
- [API Overview](#api-overview)
- [Available Scripts](#available-scripts)
- [Documentation Index](#documentation-index)
- [Contributing & Code Standards](#contributing--code-standards)

---

## Overview

Roman Store is designed as a clean, performant, modular monolith. The platform covers the complete e-commerce lifecycle:

- Product browsing, category faceting, and predictive search
- Shopping cart, wishlist, and cart-merge on login
- Checkout with address validation, coupon engine, Cash on Delivery (COD), and sandbox online payments
- Order tracking, customer review management, and customer account profiles
- An administrative dashboard for inventory, orders, customer accounts, and review moderation

---

## Key Features

### Storefront (`frontend/`)

- **Modern Vanilla UI**: Responsive, accessible interface styled with standard CSS custom properties and fluid typography.
- **Dynamic Catalogue**: Category navigation with subcategory descriptions, predictive search overlay with keyboard navigation, faceted filtering (price range, stock status, ratings), and sorting.
- **Product Experience**: Variant selector (size, color, SKU), multi-angle image gallery with quick view, verified customer reviews with star ratings, and related product carousels.
- **State & Storage**: Resilient client-side store with reactive subscribers and `localStorage` persistence.
- **Cart & Wishlist**: Slide-over cart drawer, quantity updates, free delivery progress bar, saved-for-later wishlist, and automatic guest-to-account cart merging upon authentication.
- **Checkout Flow**: Multi-step checkout with address selection, promo code validation, and support for COD and simulated online payment gateways.

### Admin Console (`frontend/admin.html`)

- Dedicated single-page management console.
- **Analytics & Overview**: Revenue metrics, order volume, low-stock warnings, and recent activity.
- **Product & Variant Catalog**: Manage products, SKU inventory levels, image galleries, and pricing.
- **Orders**: View order statuses, transition payment/delivery states, and inspect order lines.
- **Customers**: Inspect registered users and manage account status (`ACTIVE` / `SUSPENDED`).
- **Review Moderation**: Approve or flag product reviews.

### Backend API (`backend/`, `/api/v1`)

- **Layered Architecture**: Strict downward flow: Routes &rarr; Controllers &rarr; Services &rarr; Repositories &rarr; PostgreSQL.
- **Input Validation**: Strongly-typed request validation using Zod.
- **Security**: Opaque server-side sessions via `HttpOnly`, `SameSite=Lax` cookies, bcrypt password hashing, CSRF protection on mutation endpoints, Helmet security headers with strict CSP, and granular IP-based rate limiting.
- **Standard Envelope**: Predictable JSON responses (`{ success: true, data: ... }` and `{ success: false, error: { code, message, details } }`).

---

## Tech Stack

| Component      | Technology                                           | Description                                                              |
| :------------- | :--------------------------------------------------- | :----------------------------------------------------------------------- |
| **Frontend**   | HTML5, Modern CSS, Vanilla JS (ES Modules)           | Zero build step, runs natively in any modern browser                     |
| **Backend**    | Node.js (v20+), Express 5                            | Modular architecture, native ESM                                         |
| **Database**   | PostgreSQL 16 / PGlite                               | Relational storage with strict constraints, indexes, and foreign keys    |
| **Validation** | Zod                                                  | Runtime schema validation for requests and environment                   |
| **Testing**    | Node.js Test Runner (`node:test`), Supertest, PGlite | Fast, self-contained unit/integration tests without external DB services |
| **Tooling**    | ESLint 10, Prettier, Nodemon, Concurrently           | Code quality, formatting, and live-reload workspaces                     |
| **Deployment** | Docker, Docker Compose, Render Blueprint             | Containerized production deployment                                      |

---

## Project Structure

```text
├── backend/
│   ├── migrations/            # SQL migration runner & sequential schema files
│   ├── scripts/               # DB creation, admin bootstrapping, DB verification
│   ├── seeds/                 # Demo data (categories, products, users, orders)
│   ├── src/
│   │   ├── config/            # Database pool, env schema, session configuration
│   │   ├── controllers/       # HTTP request handlers
│   │   ├── middleware/        # Auth, error handling, rate limiting, validation
│   │   ├── repositories/      # Parameterized SQL database queries
│   │   ├── routes/            # Express route definitions under /api/v1
│   │   ├── services/          # Business logic (auth, checkout, cart, orders)
│   │   └── utils/             # Logger, response helpers, sanitizers
│   ├── tests/                 # Backend unit & integration test suites
│   ├── server.js              # HTTP server entry point
│   └── package.json
│
├── frontend/
│   ├── admin.html             # Admin console entry point
│   ├── index.html             # Storefront homepage
│   ├── collection.html        # Product catalog & category filtering
│   ├── product.html           # Product details, gallery & reviews
│   ├── cart.html              # Dedicated shopping cart page
│   ├── checkout.html          # Order checkout & payment selection
│   ├── account.html           # Customer profile, orders, addresses
│   ├── js/
│   │   ├── admin/             # Admin views, controllers, and helpers
│   │   ├── api/               # Typed fetch wrappers & API client
│   │   ├── components/        # UI components (navigation, gallery, modals, toasts)
│   │   ├── mock/              # In-browser catalogue fixtures for standalone testing
│   │   ├── state/             # Reactive store, cart, wishlist, and session state
│   │   └── utils/             # DOM helpers, formatters, SVG icons
│   ├── styles/                # Modular CSS design system & component stylesheets
│   ├── tests/                 # Frontend state and unit tests
│   └── package.json
│
├── docs/                      # Technical specifications & operational guides
├── .env.example               # Environment variables template
├── docker-compose.yml         # Local containerized orchestration
├── Dockerfile                 # Production multi-stage Docker build
├── package.json               # Monorepo workspaces definition
└── README.md
```

---

## Prerequisites

Before setting up the project locally, ensure you have:

1. **Node.js**: `v20.0.0` or newer (`node -v`)
2. **npm**: `v10.0.0` or newer (`npm -v`)
3. **PostgreSQL**: `v14` or newer (Optional if running tests only or using Mock Mode; required for live local API development)
4. **Git**: Installed and configured

---

## Quick Start

### 1. Clone the Repository

```bash
git clone https://github.com/Algo-chan/CodeAlpha_Simple_E-commerce_store.git
cd CodeAlpha_Simple_E-commerce_store
```

### 2. Install Dependencies

Install all dependencies across both workspaces from the root:

```bash
npm install
```

### 3. Environment Configuration

Copy the template to create your local `.env` file:

```bash
# macOS / Linux / Git Bash
cp .env.example .env

# Windows PowerShell
Copy-Item .env.example .env
```

Open `.env` in your editor and verify your database credentials:

```ini
PORT=4000
FRONTEND_URL=http://localhost:5173,http://localhost:5500,http://localhost:3000
DATABASE_URL=postgres://postgres:your_password@localhost:5432/ecommerce_store
DB_USER=postgres
DB_PASSWORD=your_password
DB_NAME=ecommerce_store
```

Generate a random secret for session and token security:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Paste the output into `JWT_SECRET` in `.env`.

### 4. Initialize Database & Seed Demo Data

Make sure your local PostgreSQL service is running, then execute:

```bash
# Create the database
npm run db:create

# Run SQL schema migrations
npm run migrate

# Populate categories, demo products, variants, and test users
npm run seed
```

### 5. Start Development Servers

Run both the Express API and the frontend development server concurrently:

```bash
npm run dev
```

- **Storefront**: [http://localhost:5173](http://localhost:5173)
- **API Server**: [http://localhost:4000](http://localhost:4000)
- **Health Check**: [http://localhost:4000/health](http://localhost:4000/health)

---

## Admin Access & Bootstrapping

The admin panel lives at `/admin.html` (e.g. `http://localhost:5173/admin.html`).

### Creating an Admin Account

Because demo seed accounts have locked password hashes for security, create an admin account using the built-in bootstrap script:

1. Add your admin credentials to `.env`:

   ```ini
   BOOTSTRAP_ADMIN_NAME="Store Administrator"
   BOOTSTRAP_ADMIN_EMAIL=admin@example.com
   BOOTSTRAP_ADMIN_PASSWORD=AdminPassword123!
   ```

   _(Password requirements: 8+ characters, including uppercase, lowercase, number, and special character)._

2. Run the bootstrap script:

   ```bash
   node backend/scripts/bootstrap-admin.js
   ```

3. Open [http://localhost:5173/admin.html](http://localhost:5173/admin.html) and log in with your email and password.

---

## Mock Mode (Frontend Without Database)

If you are working strictly on the frontend UI, styles, or interactions and do not wish to run PostgreSQL or the backend API:

1. Start only the frontend server or serve the `frontend/` directory:
   ```bash
   npm run dev:frontend
   ```
2. Navigate with the `?catalogue=mock` query parameter:
   [http://localhost:5173/?catalogue=mock](http://localhost:5173/?catalogue=mock)

In mock mode, product listings, category pages, product details, filters, and searches are served from deterministic in-browser fixtures (`frontend/js/mock/`).

---

## Testing & Quality Assurance

The test suite runs with **no external services required** (no running PostgreSQL instance or network needed). Backend tests use `@electric-sql/pglite`, an in-memory WASM build of PostgreSQL that applies all real migrations and seed constraints in memory.

### Run All Tests

```bash
npm test
```

### Run Tests by Workspace

```bash
# Backend test suite (Auth, Cart, Wishlist, Checkout, Reviews, Payments, Security)
npm run test:backend

# Frontend test suite (State store, cart sync, formatters, mock catalogues)
npm run test:frontend
```

### Run Tests in Watch Mode

```bash
npm run test:watch --workspace @ecommerce/backend
npm run test:watch --workspace @ecommerce/frontend
```

### Code Formatting & Linting

```bash
# Run ESLint across the codebase
npm run lint

# Automatically fix linting issues
npm run lint:fix

# Check formatting with Prettier
npm run format:check

# Format all files
npm run format

# Run full quality check (lint + format check + test suites)
npm run verify
```

---

## Docker & Containerized Setup

You can run the entire stack locally with Docker Compose:

```bash
# Build and run containers
docker compose up --build
```

- Access the application at [http://localhost:4000](http://localhost:4000).
- The database volume persists data in the named Docker volume `postgres_data`.

To build the standalone production image:

```bash
docker build -t roman-store .
docker run --rm -p 4000:4000 --env-file .env roman-store
```

---

## Deployment

The repository includes a ready-to-use Render Blueprint (`render.yaml`).

### Deploying to Render

1. Push this repository to GitHub.
2. In the Render Dashboard, click **New +** &rarr; **Blueprint**.
3. Connect your repository. Render will automatically:
   - Provision a managed PostgreSQL database.
   - Configure the Node.js web service running `Dockerfile`.
   - Run database migrations and bootstrap admin creation on deploy.
   - Serve the app securely with automated HTTPS.

For production hardening, SSL configuration, and environment setups, refer to [docs/deployment.md](./docs/deployment.md) and [docs/production-checklist.md](./docs/production-checklist.md).

---

## API Overview

The REST API is mounted under `/api/v1`.

### Key Endpoints

| Resource       | Method  | Path                              | Auth / Access    | Description                                |
| :------------- | :------ | :-------------------------------- | :--------------- | :----------------------------------------- |
| **Health**     | `GET`   | `/health`                         | Public           | System liveness probe                      |
| **Auth**       | `POST`  | `/api/v1/auth/register`           | Public           | Register new customer account              |
|                | `POST`  | `/api/v1/auth/login`              | Public           | Authenticate and issue session cookie      |
|                | `POST`  | `/api/v1/auth/logout`             | Session          | Revoke current session                     |
|                | `GET`   | `/api/v1/auth/me`                 | Session          | Retrieve current authenticated profile     |
| **Products**   | `GET`   | `/api/v1/products`                | Public           | List published products with facets        |
|                | `GET`   | `/api/v1/products/:idOrSlug`      | Public           | Retrieve single product details & variants |
|                | `GET`   | `/api/v1/products/search`         | Public           | Predictive search endpoint                 |
| **Categories** | `GET`   | `/api/v1/categories`              | Public           | Retrieve category tree                     |
| **Cart**       | `GET`   | `/api/v1/cart`                    | Public / Session | Fetch shopping cart lines                  |
|                | `POST`  | `/api/v1/cart/items`              | Public / Session | Add product variant to cart                |
|                | `PATCH` | `/api/v1/cart/items/:id`          | Public / Session | Update cart line quantity                  |
|                | `POST`  | `/api/v1/cart/merge`              | Session          | Merge guest cart lines on sign-in          |
| **Wishlist**   | `GET`   | `/api/v1/wishlist`                | Session          | Get saved items                            |
|                | `POST`  | `/api/v1/wishlist/:productId`     | Session          | Add or remove item from wishlist           |
| **Orders**     | `POST`  | `/api/v1/orders`                  | Session          | Place order from cart                      |
|                | `GET`   | `/api/v1/orders`                  | Session          | View past order history                    |
| **Admin**      | `GET`   | `/api/v1/admin/overview`          | Admin only       | Dashboard metrics & sales data             |
|                | `POST`  | `/api/v1/admin/products`          | Admin only       | Create new product                         |
|                | `PATCH` | `/api/v1/admin/orders/:id/status` | Admin only       | Update order status                        |

For comprehensive payload schemas, error codes, and headers, see [docs/api.md](./docs/api.md).

---

## Available Scripts

Run these scripts from the repository root:

| Command                  | Description                                                        |
| :----------------------- | :----------------------------------------------------------------- |
| `npm run dev`            | Runs both backend API (`:4000`) and frontend live server (`:5173`) |
| `npm run dev:backend`    | Starts backend with nodemon hot-reload                             |
| `npm run dev:frontend`   | Starts static frontend server                                      |
| `npm start`              | Starts backend in production mode                                  |
| `npm test`               | Runs both backend and frontend test suites                         |
| `npm run test:backend`   | Executes backend tests with `node:test`                            |
| `npm run test:frontend`  | Executes frontend tests                                            |
| `npm run lint`           | Lints JavaScript code with ESLint                                  |
| `npm run lint:fix`       | Fixes autofixable ESLint errors                                    |
| `npm run format`         | Formats all code with Prettier                                     |
| `npm run format:check`   | Verifies code conforms to Prettier rules                           |
| `npm run verify`         | Runs lint, format check, and test suites in sequence               |
| `npm run db:create`      | Creates the PostgreSQL database specified in `.env`                |
| `npm run migrate`        | Applies all pending database migrations                            |
| `npm run migrate:status` | Checks status of database migrations                               |
| `npm run seed`           | Seeds database with demo products, users, and orders               |
| `npm run verify:db`      | Verifies database connectivity and table constraints               |

---

## Documentation Index

Detailed architectural and operational documentation is available in the [`docs/`](./docs) directory:

- [Architecture & Request Lifecycle](./docs/architecture.md)
- [Database Schema & Entity Models](./docs/database-plan.md)
- [API Reference & Response Envelopes](./docs/api.md)
- [Security Model & CSRF/CSP Strategy](./docs/security.md)
- [Testing Architecture & Coverage](./docs/testing.md)
- [Local Setup & Troubleshooting Guide](./docs/setup.md)
- [Performance & Caching Strategy](./docs/performance.md)
- [Production Deployment & Environment Setup](./docs/deployment.md)
- [Pre-Launch Production Checklist](./docs/production-checklist.md)

---

## Contributing & Code Standards

1. **Layer Integrity**: Keep strict separation between Routes &rarr; Controllers &rarr; Services &rarr; Repositories. Business logic belongs in Services; SQL belongs exclusively in Repositories.
2. **Safe SQL**: Never concatenate variables into SQL strings. Always use parameterized queries (`$1, $2, ...`).
3. **Vanilla Frontend**: Maintain zero build dependencies for the frontend. Use native ES modules, semantic HTML, and standard CSS custom properties.
4. **Verification**: Always run `npm run verify` before committing or submitting pull requests to ensure linting, formatting, and tests pass.
