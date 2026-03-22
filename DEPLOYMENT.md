# Sentinel — Deployment Guide (Fixed v2.2)

## Files changed in this patch

| File | What changed |
|------|-------------|
| `package.json` | Added `bcryptjs` — **this was causing all 502 errors** |
| `netlify/functions/api.mjs` | CORS locked, passkey from env var, AI triage endpoint, error logging |
| `import-to-supabase.mjs` | Fixed to write to correct tables (was writing to `sentinel_kv`) |
| `supabase-schema.sql` | New: complete schema to paste into Supabase SQL editor |
| `realtime-patch.js` | New: live feed updates without page refresh |

---

## Step 1 — Set Netlify environment variables

Go to: **Netlify → Your Site → Site configuration → Environment variables**

| Variable | Value |
|----------|-------|
| `SUPABASE_URL` | Your project URL from Supabase → Settings → API |
| `SUPABASE_KEY` | **Service role** key from Supabase → Settings → API |
| `SENTINEL_DEV_PASSKEY` | Choose a strong passkey (replaces the hardcoded `sentinel2024`) |
| `ANTHROPIC_API_KEY` | Your Anthropic API key (for AI tip triage) |
| `ALLOWED_ORIGIN` | `https://sentinelexpose.netlify.app` (your exact domain) |

---

## Step 2 — Create Supabase tables

1. Go to **Supabase → SQL Editor**
2. Paste the entire contents of `supabase-schema.sql`
3. Click **Run**

This creates all tables, indexes, RLS policies, the vote RPC, and enables Realtime.

---

## Step 3 — Enable Realtime in Supabase dashboard

1. Go to **Supabase → Database → Replication**
2. Enable Realtime for tables: `posts`, `comments`, `announcements`, `reactions`

---

## Step 4 — Import your existing data

```bash
SUPABASE_URL=https://your-project.supabase.co \
SUPABASE_KEY=your-service-role-key \
node import-to-supabase.mjs
```

---

## Step 5 — Enable Realtime in the frontend

Add to `index.html` before `src/app.js`:

```html
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js"></script>
<script src="realtime-patch.js"></script>
```

Then open `realtime-patch.js` and set your **ANON key** (not service key):

```js
const SUPABASE_URL      = "https://YOUR_PROJECT.supabase.co";
const SUPABASE_ANON_KEY = "YOUR_ANON_KEY_HERE";
```

---

## Step 6 — Deploy

Push to GitHub. Netlify auto-deploys on push.

```bash
git add .
git commit -m "fix: bcryptjs dep, schema mismatch, CORS, AI triage, realtime"
git push
```

---

## Verify it worked

- Open browser DevTools → Network tab
- Reload the page
- `/api/data` should return **200**, not 502
- Check Netlify Functions logs for any remaining errors

---

## Security notes

- Never commit real API keys to git
- The `SUPABASE_KEY` (service role) should only be in Netlify env vars
- The `SUPABASE_ANON_KEY` in `realtime-patch.js` is safe to commit — it's the public key, protected by RLS policies set in the schema
- Change `SENTINEL_DEV_PASSKEY` immediately — the old value `sentinel2024` is now public on GitHub
