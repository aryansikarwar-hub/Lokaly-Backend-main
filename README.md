# Lokaly Backend

> Social-commerce platform backend — Instagram-style feed + live selling + local on-device ML.

Node.js + Express + MongoDB + Socket.IO + `@xenova/transformers` (sentiment + embeddings, runs fully local, no API keys).

## Quick start

```bash
git clone https://github.com/Shishir2405/Lokaly-Backend.git
cd Lokaly-Backend
cp .env.example .env            # fill MONGO_URI, JWT_SECRET (Razorpay/Cloudinary optional)
npm install
npm run seed                    # loads 20 Indian sellers + 40 buyers + 100 products + 60 posts + 10 live sessions + 120 reviews + 30 orders
npm run dev                     # http://localhost:5000
```

Health check: `GET http://localhost:5000/health`.

## Demo accounts (from seed)

| Role   | Email                 | Password   |
|--------|-----------------------|------------|
| Admin  | admin@lokaly.in       | admin123   |
| Seller | shop@lokaly.in        | demo1234   |
| Buyer  | demo@lokaly.in        | demo1234   |

All other seed accounts follow `sellerN@lokaly.in` / `buyerN@lokaly.in` with password `password123`.

## Features implemented

- **Auth** — JWT, buyer/seller/admin roles, referral code auto-issued at signup
- **Products** — CRUD, category/tag filters, text search, embeddings for semantic search, flash-deal window
- **Social feed** — posts (photo/video/reel), likes, comments (auto-moderated), shares, hashtags
- **Cart + Orders** — 8-state lifecycle with audit timeline, coin redemption at checkout (20% cap), free shipping >₹999
- **Payments** — Razorpay (create order + HMAC verification) with dev mock fallback
- **Chat** — 1:1 DMs with Socket.IO (typing, read receipts, unread counters), product-card-in-chat, AI moderation + FAQ autosuggest
- **Live selling** — sessions with viewer count, live chat, flash deals, polls, spin-the-wheel, group-buy unlock threshold
- **Reviews + Trust Graph** — 6-signal weighted trust score (rating / on-time / repeat / sentiment / verified / fulfillment)
- **Fraud Karma** — behavioural aura for buyers and sellers
- **Seller Stress Radar** — proactive coaching signals (unfulfilled/stockout/cancellation spike/DM backlog)
- **Community Coins** — append-only ledger, earn via reviews/orders/live-games/referrals, redeem at checkout
- **Referrals** — 2% lifetime equity cashback after referred seller crosses ₹10k GMV
- **ML (local)** — DistilBERT sentiment + MiniLM embeddings, semantic product search, Smart FAQ replies, Controlled Chats moderation
- **Uploads** — Cloudinary when configured, local disk fallback

## API docs

See [`docs/API.md`](docs/API.md) for all REST endpoints and Socket.IO events.

## Architecture

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Tech stack

- Node.js 18+, Express 4
- MongoDB 6+ via Mongoose 8 (2dsphere for hyperlocal)
- Socket.IO 4 with per-conversation rooms, per-live-room rooms, per-user notification rooms
- `@xenova/transformers` 2.x (ONNX, runs locally, models auto-cache into `./model-cache`)
- `bcryptjs`, `jsonwebtoken`, `helmet`, `cors`, `express-rate-limit`, `morgan`
- `multer` + `multer-storage-cloudinary` (falls back to disk storage in dev)
- `razorpay` SDK

## Project structure

```
src/
  config/      env, db, cloudinary, razorpay
  controllers/ auth, product, post, cart, order, payment, chat, live, review, trust, coins, referral, stress, faq, ml
  models/      User, Product, Post, Cart, Order, Conversation, Message, LiveSession, Review, CoinLedger, Referral
  routes/      modular routers mounted in routes/index.js
  middleware/  auth, errorHandler, upload
  sockets/     index (attach), chatHandlers, liveHandlers
  services/    trustService, karmaService, stressService, coinsService, referralService, searchService, moderationService
  ml/          pipelines (lazy singletons for sentiment + embeddings)
  utils/       ApiError, asyncHandler, logger
  app.js       express app
  server.js    http + socket bootstrap
  seed.js      Indian seed data
```

## Design decisions

- **CommonJS** deliberately — easier to integrate with `@xenova/transformers` (ESM) via dynamic `import()` and keeps the file count and tooling overhead small for a hackathon codebase.
- **No Redis / no queue** — coin awards and trust recomputes are fire-and-forget in the request handler. Good for a demo; a production build would move them to BullMQ.
- **Semantic search in-process** — cosine over a ≤300-row candidate window. Fine for the demo catalog; swap to pgvector or a vector DB once catalog crosses ~10k items.
- **Dev-friendly payment mock** — if `RAZORPAY_KEY_ID` is blank, `/payments` returns a mock `order_dev_*` flow so the frontend demo never breaks.

## Scripts

```bash
npm run dev      # nodemon
npm start        # production
npm run seed     # (re)load Indian demo data
```
