# Deploying Karsa for free (Vercel + Render + Supabase)

| Part | Service | Free-tier notes (check current limits before relying on them) |
|---|---|---|
| Frontend (Next.js) | **Vercel** Hobby | Personal / non-commercial use. |
| Backend (NestJS + Socket.IO) | **Render** free web service (Docker) | Sleeps after ~15 min without traffic; first request after that takes ~30–60 s. 750 free hours/month ≈ one service running 24/7. Disk is wiped on every deploy/restart. |
| Database (PostgreSQL) | **Supabase** free | 500 MB. Project **pauses after ~1 week without activity** (resume it from the dashboard). |
| Uploaded images | **Supabase Storage** | 1 GB. Needed because Render's disk is not persistent. |

> Why not the backend on Vercel? The backend keeps live Socket.IO connections and in-memory
> timers (quiz countdown, presenter-disconnect grace). Vercel runs short-lived serverless
> functions, which cannot hold those. The backend must run as a single, always-on process —
> **don't scale it to more than one instance.**

---

## 1. Supabase (database + storage)

1. Create a project at <https://supabase.com>. Region: **Southeast Asia (Singapore)** (same as Render below).
   Save the database password.
2. **Database URL** — *Connect* → *Session pooler* → copy the URI and put your password in it:
   ```
   postgresql://postgres.<project-ref>:<password>@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres
   ```
   Use the **Session pooler** (port 5432), not *Direct connection* (IPv6-only on the free plan —
   Render can't reach it) and not *Transaction pooler* (port 6543, breaks Prisma migrations).
3. **Storage bucket** — *Storage* → *New bucket* → name `karsa-assets`, toggle **Public bucket** on.
4. **Keys** — *Project Settings* → *API*: copy the **Project URL** and the **`service_role`**
   key (or a **secret** key). This key bypasses row-level security: put it only in the backend's
   environment, never in the frontend or in git.

## 2. Render (backend)

1. Push `karsa-backend` to GitHub.
2. Render dashboard → *New* → **Blueprint** → pick the repo. Render reads `render.yaml`
   (Docker, free plan, Singapore, health check `/health`, `JWT_SECRET` auto-generated).
3. Fill in the prompted values:
   | Key | Value |
   |---|---|
   | `DATABASE_URL` | Session pooler URI from step 1.2 |
   | `CORS_ORIGIN` | Your Vercel URL, e.g. `https://karsa.vercel.app` (fill in after step 3; comma-separate several) |
   | `SUPABASE_URL` | `https://<project-ref>.supabase.co` |
   | `SUPABASE_SERVICE_ROLE_KEY` | key from step 1.4 |
4. Deploy. The container runs `prisma migrate deploy` before starting, so the schema is created
   automatically. Check `https://<service>.onrender.com/health` returns 200.

## 3. Vercel (frontend)

1. Push `karsa-frontend` to GitHub → Vercel → *Add New Project* → import it (Next.js is detected).
2. Environment variables:
   | Key | Value |
   |---|---|
   | `NEXT_PUBLIC_API_URL` | `https://<service>.onrender.com` (no trailing slash) |
   | `NEXT_PUBLIC_DEMO_MODE` | `false` |
   | `NEXT_PUBLIC_JOIN_DISPLAY_URL` | optional; leave empty to show the site's own host on the join screen |
3. Deploy, then put the final Vercel URL into Render's `CORS_ORIGIN` and redeploy the backend.
   (`NEXT_PUBLIC_*` values are baked in at build time: redeploy Vercel after changing them.)

## 4. Keep the backend awake (optional)

Render's free service sleeps after ~15 minutes without requests. To avoid the cold start before
a class, point a free uptime monitor (e.g. cron-job.org or UptimeRobot) at
`https://<service>.onrender.com/health` every 10 minutes. One service pinged 24/7 stays within
Render's 750 free hours. Remember the Supabase project still pauses after a week with no use.

## 5. Checklist after deploying

- Register a presenter account, create a presentation, upload an image (it should load from
  `…supabase.co/storage/v1/object/public/karsa-assets/…`).
- Start a session, open the projector, join from a phone using the code — answers should arrive live.
- If the browser console shows CORS or WebSocket errors, `CORS_ORIGIN` doesn't exactly match the
  frontend origin (scheme + host, no trailing slash).

## Environment reference (backend)

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | PostgreSQL connection string |
| `JWT_SECRET` | yes | Signs auth tokens (`openssl rand -hex 32`) |
| `CORS_ORIGIN` | in production | Allowed browser origins for HTTP **and** Socket.IO; unset allows all |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | in production | Persistent image storage; unset = local `uploads/` |
| `SUPABASE_STORAGE_BUCKET` | no | Bucket name (default `karsa-assets`) |
| `PUBLIC_URL` | no | Base URL for locally stored uploads; default derived from the request |
| `PRESENTER_GRACE_MS` | no | Pause delay after the presenter disconnects (default 10000) |
| `DEMO_MODE` | no | Enables demo/simulation commands; keep `false` in production |
| `PORT` | no | Injected by the host |
