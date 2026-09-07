# Nimble roadmap

Where Nimble goes after the MVP. Ordered by horizon; each item says *why*
and names the hard part honestly. Shipped so far: the full BLIK-style
payment loop on NIM (mainnet + testnet behind one URL, auto-detected
per wallet) — instant "Paid" at micro-block inclusion,
receipts with USD frozen at finality, six languages, wallet-signature auth
with silent session refresh, on-chain reconciliation, production deploy —
and, on top of it, the vendor POS: shifts, fiat pricing, daily report and
CSV export, plus an advisory balance pre-check on the approval screen.

## Next — deepen the core loop

**Remote charge.** A vendor bills a customer who is not at the counter:
the charge is created in the till and shared as a link through any
messenger, and the payer's phone opens Nimble straight on the approval
screen via the `nimiqpay://miniapp?url=…` deeplink.

This started life as "request by link", a peer-to-peer feature, and was
re-scoped after asking what it actually adds. As P2P it adds close to
nothing: it is not a core BLIK feature either (BLIK's request-shaped
products are phone-number transfers and cheques), and a plain "send me 20
NIM" between friends is the wallet's job, not ours. What is *not* the
wallet's job is bookkeeping — a charge raised this way belongs to a shift,
lands in the daily report and CSV export, produces receipts on both sides,
reconciles on chain by its token, and pushes live status to the till over
SSE. For a vendor that ledger is the product, which is why the feature
survives in this shape and not the original one.

Consequences of the re-scope, all of them design-bearing: it attaches to a
shift, its validity is hours rather than the 120 s of a counter code, and
it must reach the report exactly like a sale rung up in person.

**Bill splitting.** One amount, N people: generate N linked requests and
watch them settle live. Socially sticky; technically a loop over the
existing session flow.

**Merchant polish — mostly shipped.** The vendor mode landed: shifts with
an operator label (one open per vendor, enforced by a partial index),
pricing in USD or NIM with the quote frozen on the charge row, a daily
report, CSV export, a full-screen paid signal for the till, and an
offline guard that refuses a payment the till cannot verify. What remains
is the verified-business profile with a tax id replacing today's
"Unverified profile" badge, plus refunds, a cashier PIN, and tips.

## Later — grow the network

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

## Rejected — with reasons, so nobody re-derives them

**Cashlink-style cheques.** Technically possible, deliberately not built.

The mechanism is not the one it looks like: funds are not authorised late.
The sender generates a throwaway keypair, sends the funds to that address
in an ordinary immediate transaction, and puts the private key in the link;
the recipient sweeps the address. Claiming therefore means signing with the
cashlink key rather than the wallet key, which the Mini App SDK cannot do —
but the public RPC accepts `sendRawTransaction` and `pushTransaction`
(verified 2026-09-07), so a client-side signed sweep would work.

It is rejected on four grounds, not on feasibility:

- **The URL becomes the key to the money.** A screenshot, a chat backup or
  a clipboard manager loses the funds. That is a different risk class from
  every other flow here, where the payer's funds stay in the wallet until
  one approved transfer.
- **It sits against our own red line.** The backend must never hold a
  private key. A cashlink can respect that — the key lives only in the URL
  fragment, which is never sent in an HTTP request — but that is a rule
  broken by one careless change, not by a decision.
- **Sharing is crippled in the WebView.** `navigator.share` is absent on
  device and downloads are blocked, so sharing means a copy-this-text
  panel. For a feature whose whole point is reaching someone who does not
  have the app, that is not a detail.
- **Nimiq already has Cashlinks.** Our own format would only redeem inside
  Nimble, which defeats the purpose; a compatible one redeems in the Nimiq
  wallet, which raises the question of what we added.

And under the vendor framing this roadmap now leads with, a merchant
receives money rather than handing it out, so there is no place for it.

## Known limits

**The balance pre-check is advisory, and has to stay that way.** Neither
of our own two chain surfaces can read someone else's balance: the Mini
App SDK has no balance call (confirmed by the Nimiq team, 2026-08-30),
and the embedded client runs Pico sync — no accounts tree, so it returns
`balance: 0` for any address it doesn't own (device-verified: an address
holding 200k NIM reported zero, before and after subscribing it).

So the check reads a **public Nimiq RPC server-side** and warns the payer
before they sign. Three properties are load-bearing and must survive any
rework. An unreadable balance answers "unknown", never "zero" — a false
zero would tell a funded payer they cannot pay. Confirm stays enabled:
the wallet is the authority, our reading can be a block stale, and a
payer who just topped up elsewhere must not be locked out. And the RPC is
a third party we do not control, so its downtime must never become our
outage.

The wallet remains the real gate — it knows the balance, refuses to sign,
and Nimble surfaces that refusal verbatim.

## Mainnet — shipped

One URL serves both networks: the app compares the wallet's chain height
(consensus-gated) with both backends and picks the match, re-checking on
every return to the Mini App. Remaining mainnet work: a status page and
the merchant fee ledger (receiver-side, settled periodically — the app
never custodies funds and never adds a fee to P2P payments).
