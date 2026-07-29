# Device testing (Nimiq Pay + testnet)

Manual exit criteria for the NIM payment slice: a real NIM payment between
two physical Android devices running Nimiq Pay, confirmed on testnet.

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
pnpm --filter @nimblink/api migrate
pnpm --filter @nimblink/api dev              # port 3000
pnpm --filter @nimblink/web dev --host       # note the LAN URL, e.g. http://192.168.1.42:5173
```

Do NOT insert `--` before `--host` — pnpm would pass a literal `"--"` to
vite, which then ignores `--host` and binds localhost only.

Set `VITE_API_URL` to your machine's LAN address (e.g.
`VITE_API_URL=http://192.168.1.42:3000 pnpm --filter @nimblink/web dev --host`)
so phones reach the API. Both devices must be on the same Wi-Fi.

WSL2 note: the phones must use the **Windows** LAN IP (`ipconfig`), not the
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
