# SENTINEL — Deployment Guide (Netlify)

## Files in this project
```
sentinel/
├── index.html                  ← Main app
├── netlify.toml                ← Netlify config
├── package.json                ← Dependencies
└── netlify/
    └── functions/
        └── api.mjs             ← Serverless API + database
```

## Deploy to Netlify (3 steps)

### Option A — Drag & Drop (easiest)
> ⚠ Functions require the Git method. Use Option B.

### Option B — GitHub (recommended)
1. Push this folder to a GitHub repo
2. Go to **netlify.com** → New Site → Import from GitHub
3. Select your repo
4. Build settings are auto-detected from `netlify.toml`
5. Click **Deploy** — done!

## After Deploy
- Visit your site URL
- Click **⬡ DEV** → default passkey: `sentinel2024`
- **Change your passkey immediately** from the Dev Panel

## Database
All data is stored in **Netlify Blobs** (free, included with Netlify).  
No external database needed. Data persists across deploys.

## Netlify Free Tier Limits
- 100GB bandwidth/month
- 125,000 function invocations/month
- Blob storage: 1GB free

These limits are more than enough for a community watchdog site.

## Default Dev Passkey
`sentinel2024` — change it immediately after first login.
