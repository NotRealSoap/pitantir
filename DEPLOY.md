# Deploy Pitantir on a ~$5 VPS

Run **web + worker + Postgres** on a cheap always-on VPS. Keep **Tampermonkey only on Windows** (PitPal session stays in the browser). Your Mac can sleep.

## What you need

| Piece | Role |
|---|---|
| VPS (2GB+ RAM preferred) | Hosts Docker: Postgres, Next.js, worker |
| Windows PC | Chrome/Edge + Tampermonkey + PitPal admin login |
| API keys | Same `HYPIXEL_API_KEY` / `PITPANDA_API_KEY` as on the Mac |

**Budget pick:** [Hetzner Cloud](https://www.hetzner.com/cloud) **CX22** (~€4/mo, 4GB RAM) — under five dollars at typical EUR/USD and enough RAM to build Next.js. DigitalOcean / Vultr / Linode **$6 / 1GB** works if you add ~2GB swap before `docker compose build`.

Use **Ubuntu 24.04**, open **TCP 22** and **TCP 3000** (or 80/443 if you add a reverse proxy later). Do **not** expose Postgres publicly — compose keeps it internal.

## 1. Create the VPS

1. Create an Ubuntu 24.04 instance (CX22 or similar).
2. Note the public IPv4 (example: `203.0.113.10`).
3. SSH in:

```bash
ssh root@YOUR_VPS_IP
```

## 2. Install Docker

```bash
apt-get update
apt-get install -y ca-certificates curl git
curl -fsSL https://get.docker.com | sh
systemctl enable --now docker
```

Optional on 1GB droplets (skip on 4GB Hetzner):

```bash
fallocate -l 2G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

## 3. Clone and configure

```bash
git clone https://github.com/NotRealSoap/pitantir.git
cd pitantir
# Prefer main once this lands; until then use the VPS deploy branch:
git checkout cursor/vps-deploy-96ea

cp deploy/env.production.example .env
nano .env
```

Set at least:

- `POSTGRES_PASSWORD` — long random string (letters/numbers only; special chars break the URL)
- `HYPIXEL_API_KEY`
- `PITPANDA_API_KEY`
- `INVENTORY_SOURCE=hypixel_pit`

## 4. Build and start

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

First build can take several minutes. Check:

```bash
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs -f --tail=80 web worker
```

Open in a browser: `http://YOUR_VPS_IP:3000`

## 5. Point Windows Tampermonkey at the VPS

Edit `scripts/pitpal-lobbies.user.js` in Tampermonkey (or reinstall from the repo):

1. Change:

```js
const PITANTIR_BASE = "http://YOUR_VPS_IP:3000";
```

2. Add a `@connect` line for the VPS host (IP or domain), e.g.:

```
// @connect      203.0.113.10
```

3. Save. On PitPal (admin), the badge should show lobby/stash OK instead of Unauthorized / connection errors.

PitPal itself still runs in the browser on Windows; only the ingest URL moves off `127.0.0.1`.

## 6. Day-2 ops

```bash
cd ~/pitantir
git pull
docker compose -f docker-compose.prod.yml up -d --build

# Logs
docker compose -f docker-compose.prod.yml logs -f worker

# Stop
docker compose -f docker-compose.prod.yml down
# Keep DB volume: omit -v. Wipe DB: add -v (destructive).
```

Copy a Mac DB dump only if you care about existing accounts/items; otherwise start fresh on the VPS and re-add accounts in the UI.

## Firewall (UFW)

```bash
ufw allow OpenSSH
ufw allow 3000/tcp
ufw enable
```

## Optional: domain + HTTPS

Point an A record at the VPS, put Caddy/nginx in front of `:3000`, then set `PITANTIR_BASE` / `@connect` to `https://pitantir.example.com`. Not required for MVP.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Badge `Unauthorized` on PitPal | Log into PitPal as admin on that browser; stashes API is admin-only |
| Badge connection / network error | Wrong `PITANTIR_BASE`, missing `@connect`, or VPS firewall blocking 3000 |
| `compose build` OOM killed | Add swap or move to 2GB+ RAM |
| Worker idle / no scans | Check `HYPIXEL_API_KEY`, `INVENTORY_SOURCE=hypixel_pit`, worker logs |
| Postgres password with `@`/`#` | Regenerate alphanumeric password; recreate volume if needed |

## Local Mac vs VPS

| | Mac (old) | VPS (this guide) |
|---|---|---|
| Postgres | `docker compose up -d` | prod compose `postgres` |
| Web / worker | `pnpm` in terminals + caffeinate | always-on containers |
| Tampermonkey | `http://127.0.0.1:3000` | `http://VPS_IP:3000` |
