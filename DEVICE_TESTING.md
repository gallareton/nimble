# Device testing — developer protocol (Nimiq Pay + testnet)

> Just want to try Nimble? You don't need any of this — see **Try it** in
> the [README](README.md). This document is for developers testing local
> builds against real devices.

Production auto-detects the wallet's network (mainnet or testnet behind
one URL); this protocol uses **testnet** so no real funds are at risk.

A repeatable manual test protocol: a real NIM payment between two physical
devices running Nimiq Pay, confirmed on testnet. The checklist at the
bottom is the pass criteria for each run — work through it whenever the
wallet-facing or chain-facing code changes. No real funds are involved.

## One-time setup (each device)

1. Install Nimiq Pay.
2. Open the app menu, then **long-press the settings button for ~10 s** —
   a hidden developer menu appears with a network switch.
3. Switch the network to **Testnet**.
4. On the home screen tap **Get free NIM** to claim testnet funds
   (110 000 NIM per request).

## Run the app locally

```bash
docker compose up -d postgres
pnpm --filter @nimble/api migrate
pnpm --filter @nimble/api dev              # port 3000
pnpm --filter @nimble/web dev --host       # note the LAN URL, e.g. http://192.168.1.42:5173
```

Do NOT insert `--` before `--host` — pnpm would pass a literal `"--"` to
vite, which then ignores `--host` and binds localhost only.

Set `VITE_API_URL` to your machine's LAN address (e.g.
`VITE_API_URL=http://192.168.1.42:3000 pnpm --filter @nimble/web dev --host`)
so phones reach the API. Both devices must be on the same Wi-Fi.

Optional — Windows/WSL2 dev setups only: the phones must use the **Windows** LAN IP (`ipconfig`), not the
WSL-internal address. Forward both ports from Windows to WSL (e.g. netsh
portproxy) — 5173 for the page and 3000 for the API, which the phone calls
directly. Set `CORS_ORIGIN=http://<windows-ip>:5173` for the API.

In Nimiq Pay open **Mini Apps → Custom URL** and enter the web LAN URL on
BOTH devices.

Note: over plain HTTP some secure-context browser APIs are unavailable in
the WebView (no `crypto.randomUUID`, no `crypto.subtle`). The app's
`src/lib/uuid.ts` falls back to `crypto.getRandomValues`; if you add code
using other secure-context APIs, it will break here first.

## Checklist

- [ ] **Auth**: connecting the wallet logs in (server verifies the
      signMessage signature). If verify fails, the wallet's message byte
      format differs from our assumption — fix ONLY
      `apps/api/src/services/nimiqAuth.ts` (see the note there).
- [ ] **Pairing**: device A generates a code, device B claims it within
      120 s; both screens update in real time.
- [ ] **Payment**: B submits a charge, A approves; Nimiq Pay shows the
      native confirmation; `sendBasicTransactionWithData` returns a hash and
      the transaction appears on a testnet explorer with the reconciliation
      token in its data field.
- [ ] **Finality**: CONFIRMED appears within ~2 minutes and only after a
      macro block. If it never appears while the explorer shows the tx as
      final, the batch-length constant in
      `apps/api/src/services/nimiqChain.ts` (`BATCH`) or the
      `getTransactionsByAddress`/`getTransaction` field mapping needs
      adjusting — fix ONLY that file.
- [ ] **Receipts**: both devices show a receipt matching the on-chain
      amount, addresses and hash; History lists it.
- [ ] **Recovery**: kill the app on A after wallet confirmation but before
      the success screen; reopen — the payment must reach CONFIRMED via
      reconciliation (or the "Finish registration" screen).

## Ordered run-through, 2026-09-08

Everything below is untested on a device. Ordered so each step builds on the
one before and an early failure stops you wasting the rest — a broken payment
makes a refund test meaningless.

**Two phones, two wallets, both on testnet.** A vendor cannot pay their own
bill (the API refuses it), so a single phone cannot exercise this.

### 1. The loop still works (regression, ~2 min)

- [ ] A shows a code, B claims it, A approves, both reach **Confirmed — final**.

Everything after this assumes this passed. If it did not, stop and report it —
nothing below is worth diagnosing on top of a broken payment.

### 2. Shift and a sale priced in money

- [ ] Open a shift with an operator name.
- [ ] Charge screen defaults to **USD**; the NIM toggle is there.
- [ ] Enter **2.50**, take the payment from B.
- [ ] Sale reaches Confirmed.

### 3. Live refresh — the fix from 2026-09-08

- [ ] While the sale is finalizing, **stay on the home screen**: the grey
      "finalizing" row turns into a finished receipt **by itself**, without
      leaving and coming back. This used to hang forever.
- [ ] Same on the shift screen: the sale appears in the report **without a
      manual refresh**.
- [ ] Background the app for a minute and return: the list is current
      immediately, not after another wait.

### 4. The 2.50 question — the fix from 2026-09-07

- [ ] History shows **2.50 USD**, not 2.51.
- [ ] The receipt shows **2.50**.
- [ ] The shift report shows **2.50**. All three must agree; that they once
      did not is what started this.

### 5. Report entries and export

- [ ] The shift report **lists individual sales**, not only the total (new).
- [ ] Export the report. In a spreadsheet: amounts sum correctly, and a
      reference typed as `=1+1` shows as text rather than evaluating.

### 6. Remote bill

- [ ] Issue a bill for 1.00 USD with a note.
- [ ] It appears under **bills waiting to be paid**, with its expiry.
- [ ] Copy the link. Send it to B **through a messenger** — check the
      messenger renders it as a tappable link (this is why the
      `nimiqpay://` form was dropped).
- [ ] B taps it **with Nimiq Pay closed**: lands on the bill, sees the amount
      and vendor, pays.
- [ ] Issue another and tap it **with Nimiq Pay already open**. This is the
      case that failed with the old link format — if it still fails, that is
      worth reporting to Nimiq; if it works, the draft bug report is moot.
- [ ] Issue a third and **cancel** it: it disappears from the list and the
      link no longer pays.

### 7. Wrong network

- [ ] Switch B's wallet to **mainnet**, open a testnet bill link. Expect
      "this bill is on the test network, switch Nimiq Pay" — **not** "no such
      bill". Switch back afterwards.

### 8. Refunds — needs a confirmed sale from step 2

- [ ] From the shift report, refund **part** of the 2.50 sale.
- [ ] Warning that a refund cannot be undone is visible **before** signing.
- [ ] Sign it. It reaches Confirmed.
- [ ] The report shows **two** rows: the sale, and the refund as a **negative**
      amount referencing it.
- [ ] The total is the difference, and the sale count did **not** go up.
- [ ] B's history shows money coming back.
- [ ] Try to refund more than what is left: refused.

### 9. Closing a shift with a bill outstanding

- [ ] Issue a bill, leave it unpaid, then close the shift.
- [ ] Warning names how many bills are unpaid; the **first** tap does not
      close. The second does.

### 10. Signals and the balance check

- [ ] The paid signal: sound and vibration on the vendor's phone. Note whether
      Nimiq Pay's own incoming-transfer sound drowns ours — it did last time.
- [ ] Pay with a wallet holding less than the charge: a line naming the
      shortfall appears **and Confirm stays enabled** (the wallet is the
      authority, not us).

### 12. The till — catalogue, cart, cash (competition slice, 2026-09-10)

- [ ] **Products**: from the shift screen, add two products (e.g. Coffee 2.50,
      Tea 2.00), pin Coffee. Retire Tea: it greys out but does not vanish.
- [ ] **Charge screen with a catalogue**: pinned products first, then
      categories, then search. Tap Coffee twice: quantity 2, total 5.00.
      The layout of pinned items must **not** reorder after sales.
- [ ] **Cash**: with items in the cart tap Cash — a "recorded" confirmation,
      cart cleared. The shift report shows it under cash, **not** among NIM
      sales, and the fiat total includes it.
- [ ] **Take NIM**: cart → Take NIM → the code field appears; B claims. The
      approval on B shows the cart total and a reference built from the
      first item. After Confirmed, the report's by-product section shows
      Coffee ×2.
- [ ] **Owner with no products**: on a fresh wallet the Charge screen looks
      exactly as before — amount field, code, nothing else.
- [ ] **A retired product** still shows in yesterday's report with
      yesterday's name and price (snapshot, not lookup).

### 13. Merchant API — needs a terminal, not a phone

- [ ] Settings → API keys → create one. The key is shown **once**; the list
      afterwards shows only the label.
- [ ] `curl -X POST …/api/test/v1/merchant/charge-requests -H "X-Api-Key: nmbl_…" -H "Idempotency-Key: $(uuidgen)" -H "content-type: application/json" -d '{"fiatAmountMinor":150,"fiatCurrency":"USD","externalRef":"order-42"}'`
      returns a `url`. Open it on B and pay.
- [ ] `GET …/api/test/v1/merchant/charge-requests?externalRef=order-42`
      shows `state: paid` and `payment.sessionStatus: CONFIRMED` after
      finality — and **not** before: `paid` means accepted, `CONFIRMED` means
      the money is final.
- [ ] Revoke the key; the same curl now returns 401.
- [ ] With the cashier lock on, creating a key returns 423.

### 14. Navigation, profile, dashboard (2026-09-10, after the competition slice)

- [ ] **Bottom bar** of six tabs — Home · Pay · Charge · Shift · History ·
      More — with Home first; the active tab is highlighted. **More** opens a
      sheet with Dashboard, Products, How it works, Settings (no Remote bill);
      Escape or tapping outside closes it.
- [ ] **One back arrow**: from Products it goes to Shift, from Settings and
      History to Home, from a receipt to History — never "wherever you came
      from". The old per-screen "‹ Home / ‹ Shift" buttons are gone.
- [ ] **No bar during a payment**: on the approval screen, a remote bill,
      a receipt and a refund the bottom bar is hidden; only the header
      remains.
- [ ] **Cashier lock badge** appears once, in the header — not again inside
      the Shift or Settings screens.
- [ ] **Profile**: set a business name, address and tax ID in Settings. B's
      approval screen shows the business name **above** the display name and
      does **not** show the tax ID; "Unverified profile" is still there.
      The receipt shows both. Change the business name afterwards: the old
      receipt keeps the old name.
- [ ] **Dashboard** (More → Dashboard): today's fiat and NIM totals, sales
      count, cash vs NIM, who is working, top products, and a section
      labelled "by shift operator" — not "by employee". A NIM sale waiting
      for payment appears under "awaiting" with a link into the session and
      disappears once confirmed. "‹ day" shows yesterday; "day ›" is disabled
      on today. An empty day shows one sentence, not a grid of zeros.

### 15. UX audit fixes (2026-09-11)

- [ ] **Tab bar**: six tabs with **Home first** — Home · Pay · Charge · Shift ·
      History · More. The labels still fit on a 360 px screen.
- [ ] **Keyboard**: tap any text field on the phone — the tab bar disappears
      while the keyboard is up and comes back when it closes. A sticky CTA bar
      sits above the tab bar, and at the bottom when the bar is hidden.
- [ ] **Header**: scroll a long screen — the title stays put under the browser
      chrome and is never clipped.
- [ ] **Pay ring**: the code ring is a true circle (not an oval) on every
      phone. The timer reads 22 px; the ring turns **amber under 30 s** and
      **red under 10 s**. The invite is now secondary text: "Receiver doesn't
      have NIMble yet? Send them a link".
      Note (audit round 2): the grey **"Copied."** toast that shows up after
      tapping Copy code comes from the **host app**, not from NIMble — our
      own feedback is the button itself turning into "✓ Copied".
- [ ] **Charge is two steps**: step 1 "How much?", step 2 "Payment". The
      USD/NIM segment sits **inside** the amount field, with the conversion
      right under it.
- [ ] **Charge with a catalogue**: in USD a typed amount must be **added to the
      cart** before Continue does anything. The cart stepper is compact. On
      step 2, **NIM** and **Cash** are a matched pair.
- [ ] **"Bill someone who isn't here"** lives on Charge (step 1), not on Shift.
      "Manage products" is gone from Charge and from Shift.
- [ ] **Shift** shows "On the till: name". A line reads "Soda × 5" and
      "25.00" as **separate** elements — never run together — and there is no
      coin emoji.
- [ ] **Export**: one **Export** button; tapping it reveals **Export CSV** and
      **Export JSON** (both ≥ 44 px).
- [ ] **Close the shift** is the sticky primary; tapping it opens a
      confirmation dialog naming the operator, the total and the sale count,
      with the unpaid-bills warning **inside** the dialog, and "Keep it open"
      to back out.
- [ ] **Past shifts are gone from Shift** — it shows only the current (or
      just-closed) shift.
- [ ] **History** has a **Transactions | Shifts** segment. **Filters**
      collapse behind a "Filters (n)" button and open when any filter is
      active. Empty date fields read "From · any date" and "To · today".
- [ ] A past shift opens at **/history/shifts/:id** — the same report,
      read-only, with its own Export.
- [ ] **Receipt**: the luna amount is small print, **Copy hash** sits on its
      own line under the hash, and the bottom offers "New charge" (receiver)
      or "New payment" (payer) plus "Done".
- [ ] **Settings**: **Save**, **Save PIN** and **Create** are blue when
      enabled and grey when disabled (never a washed-out blue). **Products**
      is under **Point of sale**; **How it works** and **Recommend NIMble**
      are under **Help**.
- [ ] **Settings → Danger zone**: **Disconnect** is red and takes **two taps**
      ("Are you sure? Tap again to disconnect"); the armed state lapses after
      a few seconds. "Show the guide again" is gone.
- [ ] **Home**: **Pay** and **Charge** are equal-weight filled cards with role
      captions; "Today's numbers" sits next to RECENT; a single row reads
      "How does NIMble work?" instead of the old list, and opens the guide at
      **/guide** (also reachable from More).

### 16. Audit round 2 (2026-09-11)

Covers the rulings Q1–Q11 from `NIMBle_v2.xlsx`. Needs a shift with at least
one **cash** sale — the round's critical finding was cash missing from the
takings.

- [ ] **Q1 — takings include cash.** Ring up two cash sales of 17.50 and no
      NIM at all. The shift summary headline reads **35.00 USD**, with
      `0 NIM · 35.00 USD cash · 2 sales` under it, and it must **not** say
      "No sales yet". Same figures in the close-the-shift dialog, which also
      shows **Cash to settle: 35.00 USD**; its close button stays disabled
      until the report has loaded. History → Shifts shows the same 35.00 USD
      on the shift's row.
- [ ] **Q2 — pieces vs money.** SOLD BY PRODUCT reads `Soda × 7` on one side
      and `35.00 USD` on the other — the amount always names its currency.
      BY PAYMENT METHOD says `{n} transactions`, not a bare count. The
      Dashboard's Cash and NIM figures carry the currency too.
- [ ] **Q3 — one "Copied" is ours.** Tap **Copy code** on Pay. Our button
      turns into **✓ Copied** for two seconds, in place, and stays tappable.
      A second grey **"Copied."** toast may appear near the bottom: that one
      is the **host app's** (Nimiq Pay / Android) clipboard overlay, not
      NIMble's, and we cannot suppress it. Note whether your device shows it.
- [ ] **Q4 — the ring is a circle.** Pay's code ring must be round, not an
      oval, on every phone: 280 px, dropping to 250 px under a 360 px screen.
      Check both a small and a large handset.
- [ ] **Q5 — one USD/NIM switch.** Charge (step 1) and Remote bill wear the
      *same* control: a pill segment whose active side is a **blue fill with
      white text**. The amount field's label says what you are typing in —
      **Amount (USD)** or **Amount (NIM)**.
- [ ] **Q6 — placeholders and honest disabled buttons.** Empty amount fields
      show **e.g. 2.50** / **e.g. 2.5**, and name fields **e.g. Soda**, in a
      visibly fainter grey than a real value. Under each greyed-out CTA a
      13 px hint says what is missing — Continue: "Add a product or enter an
      amount to continue"; Create bill: "Enter an amount to create the bill";
      Add product: "Enter a name and a price" — and it disappears the moment
      the button goes blue.
- [ ] **Q7 — the path is not cut.** On Charge step 1 the **Continue** bar sits
      directly under the card; **"Bill someone who isn't here"** is below it.
      Scroll to the bottom: the last field is not hidden behind the CTA.
- [ ] **Q8 — the cashier-lock warning is readable.** Settings → Cashier lock
      leads with one sentence in a gold-edged warning box: "This PIN locks
      this app. It does not protect your NIM in Nimiq Pay." The longer
      explanation is behind **Learn more**, which opens and closes.
- [ ] **Q9 — six tabs, six equal slots.** On a 360 px screen the tab labels
      sit in slots of the same width and none wraps or is clipped.
- [ ] **Q10 — the bar clears the system bar.** The tab bar must not sit under
      the Android gesture/navigation bar: check with gesture navigation and
      with three-button navigation. Its top shadow should read clearly
      against a white screen.
- [ ] **Q11 — Products.** Each product is a card row: name (with 📌 when
      pinned) over its category, price with the NIM line on the right. Under
      it sit small chips — **Edit**, **Pin/Unpin** and **Retire**, the last
      one in red outline. Retiring a product shows "Withdrawn" on its row and
      turns the chip into **Reactivate**.

### 11. Offline

- [ ] Turn off data on the vendor's phone and try to take a payment: refused
      with a clear message rather than accepting something it cannot verify.

## Vendor POS — shift, daily report, export

Added with the shift work. Everything here runs against the testnet stack.
**Not yet performed** — it needs two wallets on real devices, so it is a
handover checklist, not a record of a passed run.

- [ ] **Opening a shift**: Shift screen offers the form, an operator name
      opens it, and a second attempt on the same wallet is refused rather
      than silently opening a second one.
- [ ] **Pricing in money**: the Charge screen asks for an amount in USD,
      not in NIM. Enter 1.00, take the payment, then 2.50 and take another.
      The wallet's own confirmation window must show the converted NIM
      amount — that window is the payer's only trustworthy view of what
      they are paying, and nothing in the Mini App can alter it.
- [ ] **Running total**: mid-shift, the Shift screen shows the takings so
      far. The report is provisional until the shift closes, and the file
      exported before closing is named `…-open.csv` for exactly that reason.
- [ ] **Closing**: closing the shift returns the day's totals — two
      confirmed sales, the gross in NIM, the average ticket.
- [ ] **Every sale is in the report**: this is the one that would have been
      missed. Take one payment priced in USD and one priced in NIM if the
      UI still allows it; both must appear in the closed report. A report
      containing only the money-priced sale means the shift stamp regressed.
- [ ] **The file an accountant gets**: open the CSV in a spreadsheet.
      Accented characters in the operator name must survive (the BOM),
      amounts must land in separate columns, `amount_fiat_minor` must be an
      integer, and every confirmed row's `tx_hash` must resolve on a testnet
      explorer with `fx_rate_at` no older than the sale.
- [x] **Sharing a file** — VERIFIED 2026-08-28 on the owner's device: `navigator.share`
      is NOT available in the Nimiq Pay webview. The export falls back to the
      on-screen panel with a Copy button, which is what a vendor gets today.
      Treat "hand the vendor a file" as impossible in this host until proven
      otherwise; anything that needs a file must go through copy or a link.
- [ ] **Formula safety**: set a reference to `=1+1`, export, open in a
      spreadsheet. The cell must show the text, not a computed 2.
- [ ] **Backend down**: stop the API and open the Shift screen. It must say
      the shift could not be loaded — it must NOT show the "open a shift"
      form, which would tell a vendor with a live shift that their day is
      empty.

### Release signal (BR-P05) — needs a real device

- [ ] **The panel is legible on your screen.** It was only ever rendered in a
      headless DOM; the amount, the finality line and the release instruction
      have to fit without scrolling on the phone a cashier actually holds.
- [ ] **Sound and vibration.** Both are best-effort and the panel must appear
      with or without them. Note which of the two your device does, so the
      next person knows what this host supports.
- [ ] **The audio unlock.** Browsers refuse to make sound unless the audio
      context was created near a real tap. Take a payment the way a cashier
      does and say whether the beep actually sounded — if it never does, the
      beep is dead weight and should go.

## Reading balances — answered by the Nimiq team, 2026-08-30

`nimiq.getBalance` does not exist and is not supported; there is no
`eth_getBalance` equivalent in the Mini App provider. The team called it a
sensible thing to have and said they would discuss it internally, but for now
the recommended route is a **public RPC server**, both of which also serve
testnet:

- https://rpc.nimiqwatch.com
- https://rpc-mainnet.nimiqscan.com

This matters because commit ed3993a removed the pre-send balance check on the
grounds that the light client cannot read balances. That reasoning still holds
for the embedded client — but it is no longer a reason to have no check at all.
A payer who cannot afford a charge should learn that before they sign, not from
the wallet's own "Bad Request" after they have approved it.
