# Deploying the hosted (remote) server

A second, separate server instance reachable from the internet — for player
devices and remote GM access. Auth is always on (no opt-out flag exists):
every deployment, local Electron included, uses logins + JWT (see
`server/src/services/auth.ts`). The hosted instance just has its own data:
its own SQLite database and vault — **not** the same files your local
desktop app uses. Keep them separate.

## What you're setting up

One Node process (this repo's `server/`) behind nginx, with:
- Its own SQLite database and vault (upload storage) — **not** the same
  files your local desktop app uses. Keep them separate.
- Accounts for GM + players (first GM via `/api/auth/setup` or
  `ADMIN_USERNAME`/`ADMIN_PASSWORD` bootstrap, players via GM-issued logins).
- HTTPS via Let's Encrypt, since real devices over the real internet need it
  (and Capacitor/mobile HTTP clients generally refuse plain HTTP anyway).

## Steps (Debian/Ubuntu-style Linux, adjust for your distro)

1. **Node.js** (18+) and **nginx** installed, a domain pointed at the
   server's IP (an A/AAAA record — you said you already have one).

2. **Get the code onto the server** — clone/copy this repo to e.g.
   `/opt/rpg-manager/repo`, then:
   ```bash
   cd /opt/rpg-manager/repo/server
   npm install
   npm run build   # compiles to dist/, copies schema.sql alongside it
   ```
   Point `WorkingDirectory` in the systemd unit at wherever `dist/` ends up
   (adjust the path in `rpg-manager.service` if your layout differs from
   `/opt/rpg-manager/server`).

3. **Create the service user and data dirs:**
   ```bash
    useradd -r -s /usr/sbin/nologin rpgmanager
    mkdir -p /opt/rpg-manager/data /opt/rpg-manager/vault /opt/rpg-manager/config /opt/rpg-manager/RPG-Backups
    chown -R rpgmanager:rpgmanager /opt/rpg-manager
   ```

4. **Configure:** copy `.env.example` to `/opt/rpg-manager/.env`, fill in
   `JWT_SECRET` (`openssl rand -hex 32`), `ADMIN_USERNAME`/`ADMIN_PASSWORD`
   (your own GM login — remove these two from the file after the first
   successful login, they're a one-time bootstrap), and set `ALLOWED_ORIGINS`
   once you know the browsers'/apps' actual origins (LAN/private origins are
   allowed automatically; public origins must be listed explicitly).

5. **systemd:**
   ```bash
   cp rpg-manager.service /etc/systemd/system/
   systemctl daemon-reload
   systemctl enable --now rpg-manager
   journalctl -u rpg-manager -f   # should show "listening on http://localhost:3001"
   ```

6. **nginx + HTTPS:**
   ```bash
   cp nginx.conf /etc/nginx/sites-available/rpg-manager
   # edit YOUR_DOMAIN_HERE in that file first
   ln -s /etc/nginx/sites-available/rpg-manager /etc/nginx/sites-enabled/
   nginx -t && systemctl reload nginx
   certbot --nginx -d YOUR_DOMAIN_HERE   # rewrites the ssl_* lines for you
   ```

7. **Verify:**
   ```bash
   curl https://YOUR_DOMAIN_HERE/api/health        # {"ok":true}
   curl https://YOUR_DOMAIN_HERE/api/campaigns      # 401 — good, auth is on
   curl -X POST https://YOUR_DOMAIN_HERE/api/auth/login \
     -H "Content-Type: application/json" \
     -d '{"username":"<ADMIN_USERNAME>","password":"<ADMIN_PASSWORD>"}'
   # should return a token
   ```

## Redeploying after code changes

```bash
cd /opt/rpg-manager/repo && git pull
cd server && npm install && npm run build
systemctl restart rpg-manager
```

## Notes

- Player surface is live: `/api/player/*` (dashboard, characters, statblocks,
  world-entries, transfers) behind the role gate in
  `server/src/services/playerAccess.ts`. Test with `curl`/Postman against
  `/api/auth/login` and `/api/player/*`.
- The local Electron app keeps working as before — it just logs in with its
  own local accounts against its own local database.
- No sync exists between the local and hosted databases (separate files by
  design). Moving data = `POST /api/backup` zip → restore/import on the
  other side.
