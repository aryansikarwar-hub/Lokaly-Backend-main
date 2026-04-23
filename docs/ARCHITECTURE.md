# Lokaly — System Architecture

```
                         ┌─────────────────────┐
                         │   React + Vite SPA  │
                         │   (Lokaly-Frontend) │
                         └──────────┬──────────┘
                                    │
                    HTTP REST  +  Socket.IO (same origin)
                                    │
                ┌───────────────────┴───────────────────┐
                │          Express + Socket.IO          │
                │           (Lokaly-Backend)            │
                │                                       │
                │  /api/*        app.js + routes        │
                │  Socket.IO     sockets/index          │
                │                                       │
                │  controllers → services → models      │
                │                                       │
                │       ┌─────────────────────┐         │
                │       │ @xenova/transformers│         │
                │       │ DistilBERT + MiniLM │         │
                │       │ (local, cached)     │         │
                │       └─────────────────────┘         │
                └───────┬──────────┬──────────┬─────────┘
                        │          │          │
                   MongoDB    Cloudinary    Razorpay
                   (Atlas)    (media CDN)   (checkout)
```

## Request lifecycle

1. **HTTP** — `app.js` wires `helmet`, `cors`, `json`, `morgan`, global rate limit, then delegates `/api/*` to `routes/index.js`.
2. Every route is wrapped in `asyncHandler` so thrown `ApiError`s bubble to `middleware/errorHandler`. Mongoose `ValidationError`, `CastError`, duplicate-key (11000), and JWT errors are normalised to predictable `{ error, details? }` payloads.
3. Controllers stay thin — heavy logic lives in `services/` so it can be reused by sockets and the seed script.
4. **Sockets** share the same HTTP server. The handshake authenticates via JWT, and the socket auto-joins its `user:<id>` room for push-notify (e.g. chat delivery receipts).

## Data model (high level)

- **User** — buyer/seller/admin. Seller fields (`shopName`, `shopCategory`, `isVerifiedSeller`) piggyback on the same collection. `trustScore` and `fraudKarma` are cached; recomputed by `services/trustService` and `services/karmaService`.
- **Product** — owned by a seller, carries `embedding` (MiniLM) for semantic search, `flashDealEndsAt` for live-selling banners.
- **Post** — social feed with embedded comments (each carrying its own moderation block).
- **Order** — 8-state lifecycle, `timeline[]` audit, `coHostSplit[]` for split-cart collaborative rooms. Delivered status fans out to coin awards + GMV accrual.
- **Conversation / Message** — 1:1 DMs. Conversation.unread is a per-user Map so unread counters are O(1).
- **LiveSession** — `flashDeals[]`, `polls[]`, `groupBuy` all embedded. `stats` counters updated by socket handlers.
- **Review** — unique `(buyer, product)` index. Triggers async seller trust recompute.
- **CoinLedger** — append-only. Balance lives on `User.coins`; ledger provides the audit trail.
- **Referral** — 1:1 with referred seller, accrues GMV, unlocks `qualified` at ₹10k, pays `equity_cashback` lifetime.

## ML layer

Two local models loaded lazily from `@xenova/transformers`, cached to `./model-cache`:

| Model                                                                     | Use                                                               |
|---------------------------------------------------------------------------|-------------------------------------------------------------------|
| `Xenova/distilbert-base-uncased-finetuned-sst-2-english`                  | Controlled Chats moderation, review sentiment, Fraud Karma signal |
| `Xenova/all-MiniLM-L6-v2` (384-d mean-pooled + normalised)                | Product embeddings for semantic search + Smart FAQ retrieval      |

The models are loaded on first use via dynamic `import()` so the server boots without blocking; `GET /api/ml/health` can warm them preemptively.

## Signal pipelines

### Trust Graph (seller)

6-signal weighted score → `User.trustScore`:

| Weight | Signal                                    |
|--------|-------------------------------------------|
| 30     | avg product rating                        |
| 20     | delivered-on-time rate (≤7d)              |
| 15     | repeat-buyer share                        |
| 15     | review sentiment mix (pos−neg)            |
| 10     | verified flag bonus                       |
| 10     | fulfillment rate (delivered / non-cancel) |

### Fraud Karma

Separate buyer vs seller pipelines (see `services/karmaService`) — penalizes cancels, refunds, flagged messages, slow response, negative review mix. Produces a 0–100 aura rendered around the avatar on the frontend.

### Seller Stress Radar

Generates `signals[]` from four checks: unfulfilled orders >48h, stockouts, cancellation spike (>20% in 14d), DM backlog (>10 unread in 7d). Each signal carries a `weight`; sum capped at 100.

## External integrations

- **MongoDB** — single connection in `config/db`, 2dsphere index on `User.location.geo` for hyperlocal queries.
- **Cloudinary** — storage driver is swapped at startup depending on env.
- **Razorpay** — HMAC-SHA256 signature verified on `/payments/verify`. Mock path kicks in automatically when keys are absent so the demo never breaks.

## Trade-offs

- Synchronous trust/karma/stress recomputes — fine for demo load, but production should route these through a queue (BullMQ/SQS).
- Semantic search linear over ≤300 candidates — swap to pgvector / a vector DB for production catalogs.
- No CSRF — stateless JWT in `Authorization: Bearer`, not cookies.
- Stateless JWT — no revocation list; `/auth/logout` is a no-op today. Wire Redis when a session revoker is needed.
