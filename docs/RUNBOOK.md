# Karsa — LAN / Phone Testing Runbook

Test Karsa on a real phone over the same WiFi network (plain HTTP, no HTTPS required).

---

## 1. Find your laptop's LAN IP

```bash
ipconfig getifaddr en0   # macOS WiFi (try en1 if this returns nothing)
```

Example output: `192.168.1.50`

---

## 2. Set environment variables

### Backend (`mockup-karsa-backend/`)

No env change needed. The backend already listens on `0.0.0.0` (all interfaces)
and has `CORS origin: true` (allows all origins).

### Frontend (`mockup-karsa-frontend/`)

Create or edit `.env.local`:

```env
# Point the frontend at the backend via LAN IP (not localhost)
NEXT_PUBLIC_API_URL=http://192.168.1.50:3001

# Allow Next.js dev server to serve requests from the phone's browser
# hostname ONLY — no port, no protocol (comma-separated for multiple IPs)
NEXT_ALLOWED_DEV_ORIGINS=192.168.1.50
```

Replace `192.168.1.50` with your actual LAN IP from step 1.

---

## 3. Start the servers

```bash
# Terminal 1 — backend
cd mockup-karsa-backend
pnpm dev   # or: pnpm start:prod after pnpm build

# Terminal 2 — frontend
cd mockup-karsa-frontend
pnpm dev
```

The frontend dev server binds to `0.0.0.0` by default (Next.js), so it is already
reachable from the LAN. The `NEXT_ALLOWED_DEV_ORIGINS` env var tells Next.js to
accept requests whose `Host` header is your LAN IP (the dev CSRF check).

---

## 4. macOS firewall prompt

On first connection from the phone, macOS may show:

> "Do you want the application 'node' to accept incoming network connections?"

Click **Allow**. This is required for the phone to reach both servers.

If you dismissed the prompt, go to **System Settings → Network → Firewall → Options**
and add Node.js manually, or temporarily disable the firewall for testing.

---

## 5. Open the app on your phone

On your phone's browser, navigate to:

```
http://192.168.1.50:3000
```

The presenter lobby's QR code and "Buka Proyektor" link automatically use
`window.location.origin`, so they already encode the LAN IP when you access
the presenter page from the LAN.

---

## 6. "Connection is not secure" warning

This is expected. The app runs on plain HTTP. The browser shows the warning because
there is no TLS certificate. It is safe to proceed for local testing — tap
**Advanced → Proceed** (or equivalent in your browser).

`crypto.randomUUID()` is a secure-context-only API, but Karsa uses a
`crypto.getRandomValues()`-based fallback for all UUID generation so the app
works correctly over plain HTTP.

---

## 7. Verify LAN connectivity (optional)

```bash
# From the frontend repo root, with servers running:
bash scripts/check-lan.sh
# Or pass the IP explicitly:
bash scripts/check-lan.sh 192.168.1.50
```

This script checks that:
1. `GET /join` returns HTTP 200 from the LAN IP
2. `GET /health` on the backend returns HTTP 200
3. A full register → login → create session → join flow succeeds via the LAN API

---

## 8. Known Limitations

### Slide drag-and-drop requires a mouse

The editor's slide reordering uses HTML5 native drag-and-drop (`draggable` attribute +
`dragstart`/`dragover`/`drop` events). This API is not supported on touch screens.
On a phone or tablet you cannot drag slides to reorder them. Use a laptop or desktop for
any editing that requires reordering slides.

---

## 9. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Page doesn't load on phone | macOS firewall blocking Node | Allow Node in Firewall settings |
| "Invalid Host" / blank page | `NEXT_ALLOWED_DEV_ORIGINS` not set | Add LAN IP:PORT to `.env.local` |
| API calls fail (CORS error) | `NEXT_PUBLIC_API_URL` still `localhost` | Set to LAN IP in `.env.local` |
| Socket.IO disconnects immediately | Backend URL is `localhost` | Same as above |
| QR code points to `localhost` | Presenter accessed via `localhost` | Open presenter via LAN IP too |
