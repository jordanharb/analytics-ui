# Deployment Guide for Analytics UI

## Standalone Deployment (Vercel)

When deploying **only** the `analytics-ui` folder to Vercel (or any standalone environment), the following dependencies are required at the root level:

### Required Folders
- ✅ `utils/` - Database, geocoding, embeddings utilities
- ✅ `config/` - Settings and configuration
- ✅ `automation/` - Pipeline scripts and workers
- ✅ `sql/` - Database migrations and functions

### Deployment Structure

```
analytics-ui/                    # Deploy this folder as root
├── automation/
│   ├── scrapers/               # Twitter, Instagram scrapers
│   ├── processors/             # Event extraction, post processing
│   ├── scripts/                # Coordinate backfill, deduplication
│   └── worker/                 # Pipeline worker
├── config/
│   └── settings.py             # Environment config
├── utils/
│   ├── database.py             # Supabase client
│   ├── geocoding.py            # Google Maps geocoding
│   └── ...                     # Other utilities
├── sql/                        # Database migrations
├── src/                        # React frontend
└── ... (other frontend files)
```

### Path Resolution

The `pipeline_worker.py` automatically detects deployment type:

- **Standalone** (Vercel): Checks if `analytics-ui/utils/database.py` exists → Sets `REPO_ROOT` to `analytics-ui`
- **Full Repo** (Local): If utils not found in analytics-ui → Goes up to find repo root

### Environment Variables

Required in Vercel:
```bash
# Supabase
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_KEY=eyJ...

# Campaign Finance DB
VITE_CAMPAIGN_FINANCE_SUPABASE_URL=...
VITE_CAMPAIGN_FINANCE_SUPABASE_ANON_KEY=...
CAMPAIGN_FINANCE_SUPABASE_SERVICE_KEY=...

# Google APIs
VITE_GOOGLE_API_KEY=AIza...
VITE_GOOGLE_MAPS_API_KEY=AIza...

# Gemini
VITE_GEMINI_API_KEY=AIza...
GOOGLE_API_KEY=AIza...

# Automation
AUTOMATION_WORKER_POLL_SECONDS=60
AUTOMATION_MEDIA_BATCH_SIZE=200
AUTOMATION_EVENT_MAX_WORKERS=6
```

### Testing Standalone Deployment Locally

To test if the standalone structure works:

```bash
cd /Users/jordanharb/Documents/tpusa-social-monitoring/web/analytics-ui

# Set environment variables
export $(cat .env | grep -v '^#' | xargs)

# Test worker
python automation/worker/pipeline_worker.py

# Should see: "🚀 Standalone deployment detected (analytics-ui is root)"
```

### Syncing Utils from Repo Root

If you update utils in the repo root, sync to analytics-ui:

```bash
cd /Users/jordanharb/Documents/tpusa-social-monitoring

# Copy updated utils
cp -r utils/* web/analytics-ui/utils/

# Copy updated config
cp -r config/* web/analytics-ui/config/

# Commit and push
git add web/analytics-ui/utils web/analytics-ui/config
git commit -m "sync: update utils and config for standalone deployment"
git push
```

## Vercel Configuration

### Root Directory
Set to `web/analytics-ui` or deploy only this folder

### Build Command
```bash
npm run build
```

### Output Directory
```bash
dist
```

### Install Command
```bash
npm install
```

## GitHub Deployment

If deploying from GitHub:

### Option 1: Deploy Subdirectory
Use Vercel's "Root Directory" setting:
- Root Directory: `web/analytics-ui`
- Vercel will deploy ONLY this folder

### Option 2: Separate Repo
Create a separate repo with just `analytics-ui` contents:

```bash
# In a new location
git clone <your-repo> analytics-ui-standalone
cd analytics-ui-standalone
git filter-branch --subdirectory-filter web/analytics-ui -- --all
git remote add vercel <vercel-git-url>
git push vercel main
```

## Validation Checklist

Before deploying:

- [ ] `utils/` folder exists in analytics-ui root
- [ ] `config/` folder exists in analytics-ui root
- [ ] `automation/` folder has all scripts
- [ ] `sql/` folder has all migrations
- [ ] `.env` variables configured in Vercel
- [ ] Test worker locally with standalone structure
- [ ] Database functions applied (SQL migrations)
- [ ] RPC functions exist (bulk operations)

## Troubleshooting

### "ModuleNotFoundError: No module named 'utils'"
→ Utils folder not copied to analytics-ui

### "REPO_ROOT path incorrect"
→ Check pipeline_worker.py debug output, ensure detection logic works

### "Database connection failed"
→ Environment variables not set in Vercel

### "SQL function does not exist"
→ Apply migrations from `sql/` folder via Supabase dashboard
