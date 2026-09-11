# Nimble

Code-mediated peer-to-peer payments inside [Nimiq Pay](https://nimiq.com).
The payer generates a temporary six-digit code and tells it to the receiver.
The receiver claims the code and creates a charge; the payer reviews the
exact transfer (recipient, amount, asset, network) and confirms it in the
Nimiq Pay wallet. The receiver treats the payment as successful only after
blockchain finality. No QR codes, payment links, or wallet addresses are
exchanged.

Nimble is a Nimiq Pay **Mini App**: a web app running in a WebView inside
Nimiq Pay, talking to the wallet through the injected `window.nimiq`
provider (`@nimiq/mini-app-sdk`). Keys never leave the wallet; the backend
never signs anything.

> **Judging the competition?** [JUDGES.md](JUDGES.md) answers the scoring
> checklist question by question, with pointers to verify every claim.

## Try it (no setup)

1. Install [Nimiq Pay](https://www.nimiq.com/nimiq-pay/), open
   **Mini Apps → Custom URL** and enter: `https://nimble.gallareton.pl`
2. Connect the wallet, tap **Pay** to show a code — and have a second
   person (or your second device) claim it under **Charge**. Watch both
   screens follow the payment live until **Confirmed**.

Nimble detects your wallet's network and serves the matching backend:
regular wallets pay with real NIM on **mainnet**; if you'd rather test
with play money, long-press the settings button in Nimiq Pay (~10 s),
switch to **Testnet**, tap **Get free NIM** (faucet) — the app follows
your wallet automatically, with a separate testnet history.

## The till

The payment loop above is the foundation. What NIMble is becoming is **a
till for a small shop, in which NIM is one way to pay**: an owner keeps a
product catalogue, a cashier rings up a cart, each sale is recorded with
its line items — cash or NIM — and the day's report says what sold, by
whom, and how it was paid. Money paid in NIM lands in the owner's own
wallet with no terminal in between.

What is in the app today: shifts with an operator label, a product
catalogue with pinned items and categories, a cart on the till, cash or
NIM per sale, a daily report by product, each shift carrying its operator's name, a one-tap
export as CSV or JSON,
remote bills shared as a link, refunds run as a payment backward, a cashier
PIN lock, and a basic Merchant API (API keys, create a bill with your own
reference, poll until paid). The target model — a business separate from
any cashier's wallet, staff membership and roles, tills, corrections with
an audit trail — is laid out in [ROADMAP.md](ROADMAP.md), together with
two limits stated plainly: it is not a fiscal cash register, and it cannot
prevent theft.

## Repo layout

```
apps/web         React + Vite Mini App (the UI)
apps/api         Fastify API: sessions, charges, SSE, transaction monitor
packages/shared  domain types, luna arithmetic, session state machine, API contract
e2e              Playwright end-to-end suite (mock wallet + fake chain)
```

## Quickstart (mock mode — no wallet, no chain)

Requirements: Node 22+, pnpm 9+, Docker.

```bash
pnpm install
docker compose up -d postgres
pnpm --filter @nimble/api generate && pnpm --filter @nimble/api migrate
MOCK_AUTH=1 FAKE_CHAIN=1 pnpm --filter @nimble/api dev
VITE_WALLET=mock pnpm --filter @nimble/web dev
```

Open two browser profiles at `http://localhost:5173` and walk through
Pay ↔ Charge. Drive fake finality with:

```bash
curl -X POST localhost:3000/__test/chain/advance -H 'content-type: application/json' -d '{"blocks":1}'
curl -X POST localhost:3000/__test/chain/advance -H 'content-type: application/json' -d '{"macro":true}'
```

`MOCK_AUTH` / `FAKE_CHAIN` refuse to start with `NODE_ENV=production`.

## Tests

```bash
pnpm test                     # unit + integration (needs the postgres container)
pnpm --filter @nimble/e2e test   # Playwright end-to-end
```

## Real devices (developer protocol)

See [DEVICE_TESTING.md](DEVICE_TESTING.md) — Nimiq Pay has a hidden
developer menu with a testnet switch and a faucet; the Mini App loads
straight from your dev server via Custom URL.

## Deploy (public HTTPS)

One container serves the API and the built web app from the same origin;
`render.yaml` is a ready [Render](https://render.com) Blueprint (web
service + managed Postgres, secrets generated). Any Docker host works:

```bash
docker build -t nimble .
docker run -p 3000:3000 -e DATABASE_URL=... -e JWT_SECRET=... -e CODE_PEPPER=... nimble
```

In Nimiq Pay: **Mini Apps → Custom URL** → your deployment URL.

## Design notes

- Money is integer **luna** (`bigint`, 1 NIM = 100 000 luna) end to end;
  JSON carries decimal strings.
- The 6-digit code is a **locator, not a credential**: it pairs two
  sessions and is consumed atomically by the first claimer; every failure
  mode returns the same generic response.
- The payer's approval binds recipient, amount, asset, network and a random
  reconciliation token that travels in the transaction's data field — if the
  client dies after broadcasting, the backend matches the transfer on-chain
  and the payment still completes.
- "Paid" means **finalized**: a transaction is CONFIRMED only after the
  including block is sealed by a macro block (Albatross finality).

## Roadmap

See [ROADMAP.md](ROADMAP.md) — the point-of-sale model NIMble is growing
into, bill splitting, phone-number transfers, USDT on Polygon, and the
things deliberately rejected with their reasons.

## License

[MIT](LICENSE)
