# Nimble roadmap

Where Nimble goes after the MVP. Ordered by horizon; each item says *why*
and names the hard part honestly. Shipped so far: the full BLIK-style
payment loop on NIM (mainnet + testnet behind one URL, auto-detected
per wallet) — instant "Paid" at micro-block inclusion,
receipts with USD frozen at finality, six languages, wallet-signature auth
with silent session refresh, on-chain reconciliation, production deploy.

## Next — deepen the core loop

**Request by link.** The receiver creates a charge and shares it through
any messenger; the payer's phone opens Nimble straight on the approval
screen via the documented `nimiqpay://miniapp?url=…` deeplink. No new
infrastructure, huge reach — every payment request doubles as an
invitation to install Nimiq Pay.

**Bill splitting.** One amount, N people: generate N linked requests and
watch them settle live. Socially sticky; technically a loop over the
existing session flow.

**Merchant polish.** The Charge screen already behaves like a POS
terminal. Add a vendor mode: larger amount pad, per-day totals, receipt
export (CSV), and a verified-business profile replacing today's
"Unverified profile" badge.

## Later — grow the network

**Cashlink-style cheques.** Funds locked to a one-time key and handed
over as a link/code with a longer validity — BLIK cheques, the Nimiq way.
Also answers "pay someone who doesn't have the app yet" without custody.

**Phone-number transfers.** Pair your number (SMS-MO verification: the
user *sends* one SMS, which is cheaper and more fraud-resistant than OTP),
then push a transfer to any paired number. Unpaired numbers get an SMS
invitation — no funds move until the recipient registers. Requires an
inbound SMS provider and a privacy-first directory (hashed numbers,
rate-limited lookups, opt-in discovery).

**External integrations API.** Public charge API + webhooks so webshops
and cash registers can create charges and observe settlement — the
checkout use case BLIK started from. This is also where the business
model lives: merchant tooling stays paid, P2P stays free.

## USDT — supported by design, gated by verification

The session/charge model is deliberately asset-agnostic (`asset`,
`network` fields exist since day one), so USDT is an additive change, not
a rework. What it actually takes, with eyes open:

- In Nimiq Pay, USDT lives on **Polygon** and Mini Apps reach it through
  the standard **`window.ethereum`** provider — a separate wallet surface
  from the `window.nimiq` API we use for NIM (whose SDK exposes Nimiq
  methods only).
- **Testing reality:** Tether issues no official testnet USDT. Polygon's
  Amoy testnet offers mock USDT-like tokens, and whether Nimiq Pay's
  testnet mode wires `window.ethereum` to Amoy needs device verification —
  the same empirical-checkpoint discipline we used for signature formats
  and finality. Full end-to-end semantics can only be proven on mainnet
  with small amounts.
- **Reconciliation differs:** an ERC-20 transfer has no free data field
  for our reconciliation token, so crash-recovery matching needs a
  different design (unique-amount matching within a time window, or a
  thin payment-forwarder contract).
- **Finality differs:** Polygon confirmations replace Albatross
  micro/macro semantics; the two-tier "Paid → final" UX carries over with
  different thresholds.

## Known limits

**No server-side balance checks.** The embedded Nimiq client runs Pico
sync: it has no accounts tree and returns `balance: 0` for any address it
doesn't own (device-verified — an address holding 200k NIM reported zero,
before and after subscribing it). Affordability is therefore the wallet's
call: it knows the balance, refuses to sign, and Nimble surfaces that
refusal verbatim. A pre-flight check could return if we ever run a full
node or query an RPC/explorer for balances.

## Mainnet — shipped

One URL serves both networks: the app compares the wallet's chain height
(consensus-gated) with both backends and picks the match, re-checking on
every return to the Mini App. Remaining mainnet work: a status page and
the merchant fee ledger (receiver-side, settled periodically — the app
never custodies funds and never adds a fee to P2P payments).
