# Lokaly API Reference

Base URL: `http://localhost:5000/api`. All authenticated requests need `Authorization: Bearer <JWT>`.

## Auth

| Method | Path               | Auth | Body / Query                                                                   |
|--------|--------------------|------|--------------------------------------------------------------------------------|
| POST   | /auth/signup       | —    | `{ name, email, password, role?, shopName?, shopCategory?, referralCode? }`    |
| POST   | /auth/login        | —    | `{ email, password }`                                                          |
| POST   | /auth/logout       | ✓    | —                                                                              |
| GET    | /auth/me           | ✓    | —                                                                              |
| PATCH  | /auth/me           | ✓    | `{ name?, bio?, avatar?, phone?, location?, language?, shopName?, shopCategory? }` |

## Products

| Method | Path             | Auth            | Notes                                                                                             |
|--------|------------------|-----------------|---------------------------------------------------------------------------------------------------|
| GET    | /products        | —               | `?q=&category=&minPrice=&maxPrice=&seller=&sort=new\|price_asc\|price_desc\|rating\|popular&page=&limit=` |
| GET    | /products/mine   | seller/admin    | Seller's own catalog                                                                              |
| GET    | /products/:id    | —               | Populated seller                                                                                   |
| POST   | /products        | seller          | `{ title, description, price, category, tags, images[], stock, compareAtPrice? }`                 |
| PATCH  | /products/:id    | owner/admin     | Partial update                                                                                     |
| DELETE | /products/:id    | owner/admin     | Soft delete (`isActive=false`)                                                                     |

## Uploads

| Method | Path              | Auth | Form field     | Response                                |
|--------|-------------------|------|----------------|-----------------------------------------|
| POST   | /upload/image     | ✓    | `file` (≤25MB) | `{ url, publicId }`                     |
| POST   | /upload/images    | ✓    | `files` (≤8)   | `{ files:[{url,publicId}] }`            |
| POST   | /upload/video     | ✓    | `file`         | `{ url, publicId }`                     |

Cloudinary is used when `CLOUDINARY_*` env vars are set; otherwise files land in `./uploads` served from `/uploads/*`.

## Social Posts

| Method | Path                 | Auth | Notes                                                     |
|--------|----------------------|------|-----------------------------------------------------------|
| GET    | /posts               | —    | `?page=&limit=&hashtag=&authorId=`                        |
| POST   | /posts               | ✓    | `{ caption, media[], taggedProducts[], kind }` hashtags auto-extracted |
| GET    | /posts/:id           | —    | Populates author, products, comments.user                 |
| POST   | /posts/:id/like      | ✓    | Toggle                                                     |
| POST   | /posts/:id/comment   | ✓    | `{ text }` moderated via DistilBERT                        |
| POST   | /posts/:id/share     | —    | Increments counter                                         |
| DELETE | /posts/:id           | owner/admin | —                                                     |

## Cart

| Method | Path                        | Auth | Body                               |
|--------|-----------------------------|------|------------------------------------|
| GET    | /cart                       | ✓    | Returns `{ cart, subtotal }`       |
| POST   | /cart/add                   | ✓    | `{ productId, quantity }`          |
| PATCH  | /cart/update                | ✓    | `{ productId, quantity }` (0 removes) |
| DELETE | /cart/item/:productId       | ✓    | —                                  |
| DELETE | /cart/clear                 | ✓    | —                                  |

## Orders

| Method | Path                    | Auth        | Body                                      |
|--------|-------------------------|-------------|-------------------------------------------|
| POST   | /orders                 | ✓           | `{ address, coinsToRedeem? }` (coins capped at 20% subtotal) |
| GET    | /orders/mine            | ✓           | —                                         |
| GET    | /orders/seller          | seller/admin| —                                         |
| GET    | /orders/:id             | owner/seller/admin | —                                   |
| PATCH  | /orders/:id/status      | seller/admin| `{ status, note }`                        |

Delivered status triggers: stock decrement, sales counter bump, buyer `order_reward` coins (1% min 5), seller GMV accrual + 2% `equity_cashback` to referrer once qualified.

## Payments (Razorpay)

| Method | Path                                          | Auth | Notes                                           |
|--------|-----------------------------------------------|------|-------------------------------------------------|
| POST   | /payments/order/:orderId/razorpay             | ✓    | Creates RP order, returns `{razorpayOrderId, amount, currency, key, mock?}` |
| POST   | /payments/verify                              | ✓    | `{ orderId, razorpay_order_id, razorpay_payment_id, razorpay_signature }` HMAC-SHA256 verified |
| POST   | /payments/webhook                             | —    | Event receiver stub                              |

Without RP keys, both endpoints use a **mock path** so the frontend checkout still works end-to-end in a demo.

## Chat (REST)

| Method | Path                                             | Auth | Notes                                  |
|--------|--------------------------------------------------|------|----------------------------------------|
| GET    | /chat/conversations                              | ✓    | Shaped with `other` user and unread    |
| GET    | /chat/conversations/with/:userId                 | ✓    | Get-or-create DM                       |
| GET    | /chat/conversations/:id/messages                 | ✓    | `?before=<ISO>&limit=30` (cursor)      |
| POST   | /chat/conversations/:id/messages                 | ✓    | Falls back path if sockets unavailable |

## Live Sessions

| Method | Path                                                                       | Auth           |
|--------|----------------------------------------------------------------------------|----------------|
| GET    | /live/sessions                                                             | —              |
| GET    | /live/sessions/:id                                                         | —              |
| POST   | /live/sessions                                                             | seller         |
| POST   | /live/sessions/:id/start \| /end                                            | host           |
| POST   | /live/sessions/:id/flash-deal                                              | host           |
| POST   | /live/sessions/:id/flash-deal/:dealId/claim                                | ✓              |
| POST   | /live/sessions/:id/poll                                                    | host           |
| POST   | /live/sessions/:id/poll/:pollId/vote                                       | ✓              |
| POST   | /live/sessions/:id/spin                                                    | ✓              |
| POST   | /live/sessions/:id/group-buy/join                                          | ✓              |

## Reviews + Trust

| Method | Path                          | Auth | Notes                                            |
|--------|-------------------------------|------|--------------------------------------------------|
| POST   | /reviews                      | ✓    | `{ product, order?, rating, text, images[] }`    |
| GET    | /reviews/product/:productId   | —    | —                                                |
| GET    | /reviews/seller/:userId       | —    | —                                                |
| POST   | /reviews/:id/helpful          | ✓    | Toggle                                           |
| GET    | /trust/:userId                | —    | Returns `{ trustScore, fraudKarma, breakdown }` (seller) |

## Coins + Referrals

| Method | Path                    | Auth | Notes                                |
|--------|-------------------------|------|--------------------------------------|
| GET    | /coins/ledger           | ✓    | `{ items, balance }`                 |
| POST   | /coins/redeem           | ✓    | (See Orders — redemption at checkout) |
| GET    | /referrals/dashboard    | ✓    | `{ referrals[], totalCashback, qualifiedCount, pending, referralCode }` |

## ML

| Method | Path                   | Notes                                               |
|--------|------------------------|-----------------------------------------------------|
| GET    | /ml/health             | Warms pipelines                                     |
| GET/POST | /ml/sentiment        | `?text=` → `{ label, score, flagged, keywordHit }`  |
| POST   | /ml/embed              | `{ text }` → `{ dim, vector }`                      |
| POST/GET | /ml/search           | `{ query, topK?, category? }` → `{ hits[{ score, product }] }` (semantic) |
| POST   | /ml/reindex            | admin — re-embed entire catalog                     |

## Stress + Karma

| Method | Path            | Auth        |
|--------|-----------------|-------------|
| GET    | /stress/mine    | seller/admin|
| GET    | /stress/karma   | ✓ (own)     |

## FAQ

| Method | Path               | Auth | Notes                                                                       |
|--------|--------------------|------|-----------------------------------------------------------------------------|
| GET    | /faq/suggest       | —    | `?query=&sellerId=` → `{ suggestion }` (best semantic match or null)        |
| GET    | /faq/flagged       | seller | List of flagged messages sent to this seller                               |

## Socket.IO

Connect to the same origin (e.g. `http://localhost:5000`), pass JWT on handshake:

```js
const socket = io('http://localhost:5000', { auth: { token } });
```

### Chat

| Event                    | Direction         | Payload                                                         |
|--------------------------|-------------------|-----------------------------------------------------------------|
| `chat:join` / `chat:leave` | client → server | `{ conversationId }`                                            |
| `chat:typing`            | client ↔ server   | `{ conversationId, isTyping }`                                  |
| `chat:send`              | client → server   | `{ conversationId, text?, attachment?, productRef? }` — ack `{ ok, message }` |
| `chat:message`           | server → room     | `Message` document                                              |
| `chat:notify`            | server → user     | `{ conversationId, from, preview }`                             |
| `chat:read`              | client → server / server → room | `{ conversationId }` / `{ by }`                       |

### Live

| Event                | Direction     | Payload                                              |
|----------------------|---------------|------------------------------------------------------|
| `live:join` / `live:leave` | c → s    | `{ roomId }`                                         |
| `live:viewerCount`   | s → room      | `{ count }`                                          |
| `live:chat`          | c → s / s → room | `{ roomId, text }` / `{ from, text, flagged, at }` |
| `live:reaction`      | c → s / s → room | `{ roomId, emoji }` / `{ emoji, from }`            |
| `live:productPin`    | c → s / s → room | `{ roomId, productId }`                            |
| `live:flashDeal`     | s → room      | Flash deal document                                  |
| `live:dealClaimed`   | s → room      | `{ dealId, remaining }`                              |
| `live:poll` / `live:pollUpdate` | s → room | Poll document                                    |
| `live:spin`          | s → room      | `{ user, prize }`                                    |
| `live:groupBuyUnlocked` | s → room   | `{ discountPct }`                                    |
| `live:started` / `live:ended` | s → global/room | `{ id, roomId? }`                             |
