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
