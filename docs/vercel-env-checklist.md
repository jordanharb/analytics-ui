# Vercel Environment Variables Checklist

## ✅ Already Set in Vercel (from your list)
- [x] `OPENAI_API_KEY`
- [x] `VITE_GOOGLE_API_KEY`
- [x] `VITE_APP_ENV`
- [x] `VITE_MAPBOX_TOKEN`
- [x] `VITE_SUPABASE_URL`
- [x] `VITE_SUPABASE_ANON_KEY`

## 🔴 Missing - CRITICAL for Automation API Routes
Add these to Vercel for automation to work:

```bash
# Supabase Service Keys (for API routes)
SUPABASE_URL=your_supabase_project_url
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key

# Cron Security
AUTOMATION_CRON_SECRET=generate_with_openssl_rand_base64_32
```

## 🟡 Missing - Campaign Finance Features
Add these if you want campaign finance features to work:

```bash
VITE_CAMPAIGN_FINANCE_SUPABASE_URL=your_campaign_finance_supabase_url
VITE_CAMPAIGN_FINANCE_SUPABASE_ANON_KEY=your_campaign_finance_anon_key
VITE_CAMPAIGN_FINANCE_SUPABASE_SERVICE_KEY=your_campaign_finance_service_key
```

## 🟢 Optional - Automation Tuning
Add these to customize automation behavior:

```bash
# Processing Limits
AUTOMATION_EVENT_POSTS_LIMIT=1000
AUTOMATION_DEDUP_EVENTS_LIMIT=500
AUTOMATION_MEDIA_BATCH_SIZE=200

# Performance
AUTOMATION_EVENT_MAX_WORKERS=6
AUTOMATION_WORKER_COOLDOWN=60
AUTOMATION_DEDUP_SLEEP_SECONDS=120
AUTOMATION_WORKER_POLL_SECONDS=60

# Additional API Keys (for rate limiting)
GEMINI_DEDUP_API_KEY=your_gemini_api_key
GOOGLE_AI_API_KEY_1=your_google_ai_api_key
```

## 📝 Notes

### Generate AUTOMATION_CRON_SECRET:
```bash
openssl rand -base64 32
```

### Which environment to set?
- Set all `VITE_*` variables in **"All Environments"**
- Set server-only variables (`SUPABASE_SERVICE_ROLE_KEY`, etc.) in **"Production"** and **"Preview"** only
- Never expose service keys to the browser!

### Vercel-specific variables (auto-set by Vercel):
These are automatically available, no need to set:
- `VERCEL_URL`
- `VERCEL_ENV`
- `VERCEL_GIT_COMMIT_SHA`
