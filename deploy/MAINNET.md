# Launching the second stack (mainnet + testnet subdomain)

Prepared, NOT launched. The competition demo (legacy stack, port 3001,
testnet, `deploy/.env`) keeps running untouched until we decide to flip.

## One-time launch steps

1. **DNS**: add `testnet.nimble.gallareton.pl A 217.182.76.147`.
2. **Env files** on the VPS in `~/nimble/deploy/`:
   `cp env.test.example .env.test && cp env.main.example .env.main`,
   fill secrets (`openssl rand -hex 32`), `chmod 600 .env.*`.
   Fresh secrets for mainnet — never reuse testnet ones.
3. **Testnet subdomain stack**: `./update.sh test` (port 3002), then
   `sudo cp nginx-nimble-testnet.conf /etc/nginx/sites-available/nimble-testnet`,
   symlink into sites-enabled, `nginx -t && systemctl reload nginx`,
   `certbot --nginx -d testnet.nimble.gallareton.pl`.
4. **Verify testnet subdomain** end to end (device protocol).
5. **Mainnet stack**: `./update.sh main` (port 3003, MainAlbatross —
   mainnet seed nodes are the client's defaults). Verify consensus in
   logs and `/v1/network` height ≈ mainnet head.
6. **The flip**: point the apex vhost (`sites-available/nimble`)
   proxy_pass at `127.0.0.1:3003`, reload nginx. From that moment
   `nimble.gallareton.pl` = mainnet, `testnet.nimble...` = testnet.
7. Retire the legacy stack once traffic drains:
   `sudo docker compose --env-file .env -f docker-compose.prod.yml down`
   (keep the volume until sure).

## What changes for users

- Mainnet DB starts empty: profiles/history are per-network by design.
- The in-app network guard redirects confused wallets: each deployment
  names its own network in the warning banner.
- Deep links and QR derive from the page origin, so both stacks
  self-reference correctly.

## Competition note

Do NOT flip the apex before Cycle I judging concludes — the submitted
demo URL must keep serving the testnet build the judges expect.
