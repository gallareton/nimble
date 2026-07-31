# Nimble — answers to the scoring checklist

A self-assessment against the [competition scoring guide](https://miniappscompetition.com/scoring),
question by question, with pointers to verify every claim. Try everything
live at **https://nimble.gallareton.pl** (testnet — no real funds).

## Design & UX

**Does the Mini App look professional and trustworthy at first glance?**
The design system is built from the official `nimiq-style` tokens: Nimiq
Blue `#1F2348` text, light-blue radial-gradient pill buttons, white cards
on the `#F4F4F4` canvas, Mulish typography. Opening Nimble from Nimiq Pay
feels like staying in the same product — that was the explicit goal.

**Are the colors, typography, and layout clean and consistent?**
One accent color with one meaning (light blue = the primary action), Nimiq
palette colors used only semantically (green = paid, orange = delayed,
red = errors). All tokens live in a single
[`styles.css`](apps/web/src/styles.css); there is no per-screen styling
drift.

**Can a new user figure out how to use it without instructions?**
Anyone who knows BLIK (millions of Poles) needs zero instructions. For
everyone else the home screen is two tiles that say what they do: *Pay —
show a code* / *Charge — enter a code*. Each screen has exactly one
primary action.

**Does it feel native and responsive on a phone?**
Built mobile-first for the WebView: pill buttons ≥48 px, bottom
"Back to home" in the thumb zone, `sms`-style single-field code entry with
3+3 rhythm, live SSE updates with no pull-to-refresh anywhere, reduced
motion respected.

**Can someone go from zero to using the Mini App in under 60 seconds?**
Yes, measurably: Connect wallet (one tap + wallet signature) → Pay → a
code is already on screen — the code even generates itself on entering the
screen. Re-opening later needs no re-login (silent refresh-token session).

## Functionality

**Does the main function of the Mini App actually work reliably?**
The full payer↔receiver flow runs on Nimiq testnet today, verified on two
physical phones (protocol in [DEVICE_TESTING.md](DEVICE_TESTING.md)), plus
100+ automated tests: unit/integration across API, web and shared packages
and a Playwright E2E suite that walks two browser contexts through the
whole payment against a fake chain.

**Does it use Nimiq Pay wallets, transactions, or payments as a core part
of the experience?**
Payments *are* the product. Wallet-signature login (challenge → Keyguard
"Signed Message" verification server-side), `sendBasicTransactionWithData`
with a reconciliation token in the tx data field, real-time inclusion
tracking via the Nimiq web-client's transaction subscription, macro-block
finality for receipts.

**Does the Mini App load fast and respond without lag?**
~78 kB gzipped JS, self-hosted font, no external requests from the client
except our API. Status changes arrive by SSE push, "Paid" shows seconds
after on-chain inclusion.

**Does it fail gracefully or does it crash and confuse the user?**
Failure paths are designed, not accidental: uniform "code unavailable"
errors (no oracle for guessing), rate-limit messaging, readable wallet
rejections, a kill-the-app-mid-payment recovery (the backend reconciles
the transfer on-chain and the payment completes), SSE auto-reconnect with
state resync, and a browser landing page instead of a dead button when
opened outside Nimiq Pay.

**Does this feel like a finished product or a half-built prototype?**
Judge by the details: receipts freeze the USD value at confirmation, six
languages picked up from Nimiq Pay's host language, screen-reader
countdown announcements, per-context session isolation, idempotency keys
on every mutating request, MIT-licensed monorepo with CI-grade test
coverage and one-command production deploys.

## Usefulness & originality

**Does this Mini App address a real need or want?**
Face-to-face crypto payments today mean QR codes (swappable with a
sticker), links (phishable) or 40-character addresses (unreadable). BLIK
proved a one-time code beats all three — it moves no value itself, can be
spoken aloud, and dies after one use or 120 seconds.

**Is it clear who this Mini App is for?**
Two people settling in person: friends splitting a bill, a market vendor
and a customer. The two home tiles map exactly to those two roles.

**Is this a fresh idea or a meaningful improvement on something that
exists?**
Nobody else in the ecosystem does code-mediated payments. The receiver
states the amount *before* the code is entered (BLIK-style), so the payer
gets a complete, verifiable approval — recipient, amount, network — in one
screen.

**Would someone open this Mini App more than once?**
It's a payment instrument, not a demo: history with receipts, silent
session refresh so it opens logged-in days later, and a P2P use case that
recurs by nature.

**Does this Mini App make Nimiq Pay more useful or attractive to new
users?**
It gives Nimiq Pay the payment UX that made BLIK a national standard in
Poland — and NIM's near-instant finality is precisely the ingredient that
makes it work on a blockchain. Roadmap (request-by-link, bill splitting,
Cashlink cheques) deepens that.

## Marketing & distribution

**How many distinct Nimiq wallets interacted with the Mini App during the
scoring period?**
Live deployment is public since submission; every wallet connection
creates a profile server-side, so this number is auditable from our data.
Grab a friend and add two more.

**Did the builder actively promote the Mini App beyond just submitting
it?**
Launch post in the competition community, public demo URL that works from
any phone, and a browser landing page whose only job is converting
visitors into Nimiq Pay users (deeplink + store links + QR).

**Did the builder document their build, create a demo video, or tell a
compelling story about the Mini App?**
Demo video in the submission; the README documents architecture and
design decisions; the builder story explains *why codes beat QR and
links* — safety as the narrative, not an afterthought.

**Did the builder participate in calls, share progress, help others, and
show up in the community?**
Active in the community during the cycle — and testing fellow builders'
apps (payments need counterparties; we know the value of showing up).

**Does the submission look app-store ready?**
Manifest with proper name/description/icons, 512 px icon and 240 px
thumbnail designed from the app's signature (the countdown ring), polished
copy in six languages, and a production HTTPS deployment with auto-renewed
certificates.

## Bonus

**Does the submission incentivize the usage of NIM?**
NIM is the only asset today — every payment is a NIM transfer on
Albatross, chosen deliberately because NIM's instant, low-fee finality is
what makes code payments feel like cash. USDT fits the same
(asset-agnostic) session model later, but NIM is the star.
