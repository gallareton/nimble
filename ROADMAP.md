# Nimble roadmap

Where Nimble goes after the MVP. Ordered by horizon; each item says *why*
and names the hard part honestly. Shipped so far: the full BLIK-style
payment loop on NIM (mainnet + testnet behind one URL, auto-detected
per wallet) — instant "Paid" at micro-block inclusion,
receipts with USD frozen at finality, six languages, wallet-signature auth
with silent session refresh, on-chain reconciliation, production deploy —
and, on top of it, the vendor POS: shifts, fiat pricing, daily report and
CSV export, plus an advisory balance pre-check on the approval screen.

## The point of sale — what NIMble is becoming

A review on 10 September reframed the product, and the reframing is right.
NIMble is not a payment app with a vendor mode. It is **a till for a small
shop, in which NIM is one way to pay**. The payment loop — the six-digit
code, macro-block finality, receipts on both sides, on-chain
reconciliation — is the foundation, not the product. The product is what
a stallholder says at the end of the day: *on this phone I have my
products, I serve customers, I know who worked the till and what sold, and
the money lands in my own wallet with no terminal in between.*

That is two promises, and they are worth keeping apart:

| Promise | What it means |
|---|---|
| **Organising sales** | catalogue, cart, staff, shifts, receipts with line items, reports by product and by cashier |
| **Taking payment** | a NIM transfer straight to the business's wallet |

The first is why an owner keeps the app open all day. The second only
decides how a customer can pay.

### The target model

- **A business is not a cashier's wallet.** Today `user_profile.wallet_address`
  is both the identity and the payout address, which is why the cashier
  PIN lock exists at all — it papers over a missing separation. The target
  is three distinct things: *who* acts (a staff member, identified by their
  own wallet), *on whose behalf* (the business), and *where the money goes*
  (the business's payout wallet, changed only by the owner as a deliberate
  act, never as a profile preference). A cashier can then take payments
  without ever holding the keys to the takings.
- **A sale is not a charge.** A charge says how much NIM was due, to
  where, and whether it arrived. A sale says what was sold, how many, at
  what price, by whom, during which shift. Line items are stored as
  snapshots: tomorrow's price change must never rewrite yesterday's report.
- **Membership, not just login.** A wallet signature proves control of an
  address; that this address is Piotr on till 1 is something the owner
  confirms. `member = staff + business + role + access status`, so revoking
  someone leaves their history intact.
- **Corrections leave a trace.** Finished operations are never deleted;
  a correction is a new event attributed to a person. This gives an audit
  trail, not theft prevention — the system cannot see goods handed over
  with no sale rung up, and the app must never promise that it can.
- **Cash is a payment method from day one.** A till that only sees NIM
  sales is not a picture of the business; it is worse than a notebook.
  Recording a cash sale moves no money and needs no integration.
- **Personal phone first.** A cashier logs in with their own Nimiq Pay and
  picks the business. A shared tablet on the counter is a different
  authorisation design (the staff member authorises a terminal session
  from their own phone) and comes later, not alongside.

### What is built now, and what waits

The two-day competition slice takes only what is **additive** on a live
database — new tables and nullable columns, no rework of sessions,
shifts or identity:

| Now | Later |
|---|---|
| Product catalogue with categories, pinned items, retire-not-delete | Business entity, members, roles, owner approval of shifts |
| Sales as documents with snapshotted line items | Registers / tills as first-class things; shared tablet |
| Cart on the till; one-off items outside the catalogue | Discounts, corrections with an audit event |
| Cash or NIM per sale | A price and reporting currency per business (USD stays for now) |
| Report by product and by operator label | Suppliers, stock, multiple locations |
| Merchant API: API keys, create and poll a bill by your own reference | Webhooks (a delivery subsystem of its own: retries, signing, replay) |

### Two things the till cannot do, said plainly

**It is not a fiscal cash register.** In Poland most retail sales legally
require one, and NIMble is not a homologated device and will not become
one. For a Polish stall it is a ledger *beside* the fiscal register, not
instead of it. This alone suggests the first pilot market is not Poland,
even though the BLIK metaphor comes from there. The report is an aid to
bookkeeping, not bookkeeping.

**It cannot prevent theft.** Attributing a sale to a cashier gives the
owner a trail — who sold, who refunded, who closed the shift. It does not
catch goods that were never rung up. That needs stock control or
procedure, and the app will not claim otherwise.

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

**Vendor mode — shipped, and superseded by the point of sale above.**
Shifts with an operator label, pricing in USD or NIM with the quote frozen
on the charge row, a daily report, CSV export, a full-screen paid signal,
an offline guard, remote bills, refunds as a payment run backward, a
cashier PIN lock, nightly database backups. What remains — a business
profile with a tax id, tips — is folded into the target model: a tax id
typed by the vendor verifies nothing, and showing it next to the word
"verified" would build trust nothing backs.

## Later — grow the network

**Phone-number transfers.** Pair your number (SMS-MO verification: the
user *sends* one SMS, which is cheaper and more fraud-resistant than OTP),
then push a transfer to any paired number. Unpaired numbers get an SMS
invitation — no funds move until the recipient registers. Requires an
inbound SMS provider and a privacy-first directory (hashed numbers,
rate-limited lookups, opt-in discovery).

**Merchant API — the basic form is in the competition slice.** API keys
issued and revoked by the owner, create a bill with your own external
reference, poll its state until it is paid and read the transaction hash.
That is enough for a webshop to take NIM. What waits is webhooks — not
because they are hard to fire, but because delivery, retries, signing and
replay protection are a subsystem, and a webhook that fires once and is
lost is worse than a poll. This is also where the business model lives:
merchant tooling stays paid, P2P stays free.

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
