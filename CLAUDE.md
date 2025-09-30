# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is the Analytics UI for a TPUSA Social Monitoring platform with integrated Arizona Campaign Finance analysis tools. The application is built with React, TypeScript, Vite, and connects to a Supabase database containing campaign finance, legislative, and social monitoring data.

## Commands

### Development
- `npm run dev` or `npm start` - Start development server with Vite at http://localhost:5173
- `npm run build` - Build for production (with TypeScript checks)
- `npm run build:no-typecheck` - Build without TypeScript checks (for deployments with build errors)
- `npm run vercel-build` - Vercel-specific build command (uses no-typecheck)
- `npm run lint` - Run ESLint
- `npm run preview` - Preview production build locally

### Testing
- No test framework currently configured - use development server for testing
- Testing libraries are installed (@testing-library/react, @testing-library/jest-dom) but not configured

### Database Operations
- SQL files in `/sql/` directory contain database functions and migrations
- Use `npx supabase db push` to apply SQL changes to database
- Functions must be applied in correct order - check dependencies

## Architecture

### Tech Stack
- **React 19.1**: UI framework with lazy loading and Suspense
- **TypeScript 5.8**: Type-safe development
- **Vite 7.1**: Fast build tool with hot reload
- **TailwindCSS 4.1**: Utility-first styling
- **React Router 7.8**: Client-side routing
- **Zustand 5.0**: Lightweight state management
- **Supabase**: Database and authentication
- **Mapbox GL**: Interactive mapping

### Core Structure
- **Analytics UI Main App** (`/src/`): Social monitoring interface with map view, directory, chat functionality
- **Legislature Module** (`/src/legislature/`): Campaign finance analysis tools (appears as separate app within main app)
- **SQL Functions** (`/sql/`): Database stored procedures for campaign finance analysis

### Application Architecture
The app has a dual-structure design:
1. **Main Application (Woke Palantir)**: Social monitoring with MapView, DirectoryView, ChatView, EntityView
2. **Legislature Module**: Completely separate React app for campaign finance analysis, mounted at `/legislature/*`

Both apps share the same build system but have separate routing and state management.

### Key Components

#### Main Application (Woke Palantir)
- `/views/MapView/` - Geographic social media monitoring interface
- `/views/DirectoryView/` - Entity directory and search
- `/views/ChatView/` - AI chat interface for analysis
- `/views/EntityView/` - Individual entity analysis pages

#### Legislature Module (Campaign Finance Analysis)
- **LegislatureApp.tsx** - Main router and layout for campaign finance tools
- **ReportGeneratorPage.tsx** - Original AI report generation (broken, needs restoration)
- **ReportGeneratorPageV2.tsx** - Newer version with streaming support
- **HomePage.tsx** - Search interface for legislators and candidates
- **BillsPage.tsx, BulkPage.tsx, ReportsChatPage.tsx** - Additional analysis tools

### Database Integration

#### Supabase Configuration
- Main DB: `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`
- Campaign Finance DB: `VITE_CAMPAIGN_FINANCE_SUPABASE_URL` and `VITE_CAMPAIGN_FINANCE_SUPABASE_ANON_KEY`
- Service keys for admin operations: `SUPABASE_SERVICE_KEY`, `CAMPAIGN_FINANCE_SUPABASE_SERVICE_KEY`

#### Key Database Functions

**⚠️ IMPORTANT: See [DATABASE_FUNCTIONS.md](./DATABASE_FUNCTIONS.md) for complete SQL implementations**

**Core Analysis Functions (Date-Based):**
- `get_session_bills(p_person_id, p_start_date, p_end_date)` - Voting records with outlier detection
  - Returns: bill_id, bill_number, bill_title, vote_value, vote_date, is_sponsor, session_id, is_outlier, party_breakdown
  - Includes sophisticated outlier detection when legislator votes against party majority
  - is_sponsor boolean eliminates need for separate sponsorship function

- `get_legislator_donations(p_person_id, p_start_date, p_end_date)` - Campaign donations analysis
  - Returns: transaction_id, donor_name, donation_date, amount, entity_type_id
  - Uses cf_transactions table with intelligent name parsing
  - Filters PACs, businesses, and individuals with politically relevant occupations
  - Sophisticated entity type filtering (48 different entity types)

- `get_person_sessions(p_person_id)` - Legislative sessions with date ranges
  - Returns: session_id, session_name, year, start_date, end_date, vote_count, date_range_display
  - Essential for calculating date ranges for analysis

**Phase 2 Analysis Functions:**
- `get_bill_details(p_bill_id)` - Full bill text and summary for AI analysis
- `search_rts_positions(p_bill_ids, p_keywords, p_limit)` - Request to Speak positions

**Search Functions:**
- Person search function returns: person_id, label (display_name), extra (counts info)

### AI Integration

#### Gemini API Integration
- API Key: `VITE_GOOGLE_API_KEY` or `VITE_GEMINI_API_KEY`
- Models used: `gemini-2.5-flash` (fast), `gemini-2.5-pro` (high-quality)
- Function calling for database queries during analysis

#### Two-Phase Analysis System (NEEDS RESTORATION)
**Phase 1**: Generate potential bill-donor connections without reading full bill text
- Uses metadata like donor industry, bill titles, timing
- Creates ranked list of potential conflicts of interest
- Faster, broad-scope analysis

**Phase 2**: Deep dive analysis of high-confidence matches
- Reads full bill text using `get_bill_details(bill_id)`
- Validates or rejects potential connections
- Provides detailed explanations with bill text citations

## Current Issues & Restoration Needed

### Lost Functionality
1. **Report Generator Integration**: The original AI analysis system was broken during recent changes
2. **Function Calling System**: The Gemini function calling integration needs to be restored
3. **Two-Phase Analysis**: The sophisticated analysis workflow from `/Users/jordanharb/Desktop/az-campaign-analyzer-app/backend/scripts/analysis.mjs` needs to be integrated

### Database Schema Updates
- Recent changes moved from `cf_donations` to `cf_transactions` table
- Entity type filtering updated (entity_type_id values changed)
- New SQL functions created but not fully integrated into UI

### Environment Variables
- Gemini API key access in components may be inconsistent
- Backend URL configuration for streaming analysis

## Development Guidelines

### Adding New Features
- Legislature module components should follow existing patterns in `/src/legislature/`
- Use `supabase2` client for campaign finance database queries
- Implement proper TypeScript interfaces for all database responses

### Database Changes
- Add new SQL functions to `/sql/` directory
- Test functions manually before integrating into UI components
- Update TypeScript interfaces when database schema changes

### AI Integration
- Use function calling pattern from original analysis.mjs
- Implement proper error handling for API timeouts
- Cache expensive database queries when possible

## Key Files to Understand

### Essential Configuration
- `vite.config.ts` - Build configuration with chunk splitting and MCP proxy
- `src/App.tsx` - Main router with lazy loading and conditional header display
- `src/lib/supabase2.ts` - Database client configuration for campaign finance DB
- `src/lib/supabase.ts` - Main database client configuration

### Legislature Module Core Files
- `src/legislature/LegislatureApp.tsx` - Legislature module router and layout
- `src/legislature/ReportGeneratorPage.tsx` - Original AI analysis interface (needs fixing)
- `src/legislature/ReportGeneratorPageV2.tsx` - Newer version with streaming support
- `src/legislature/HomePage.tsx` - Search interface for legislators and candidates

### Database & Analysis
- `sql/update_report_functions_fixed.sql` - Latest database function definitions
- Original analysis script: `/Users/jordanharb/Desktop/az-campaign-analyzer-app/backend/scripts/analysis.mjs`

### Build & Deployment
- `vercel.json` - Client-side routing configuration for Vercel
- `package.json` - Contains vercel-build script for deployment

## Development Workflow

### MCP Integration
- Local MCP server runs on port 5175 during development
- Vite proxy forwards `/api/mcp` requests to MCP server
- MCP SDK is excluded from optimization to prevent import issues

### Build Process
- Uses manual chunk splitting for optimal loading (react-vendor, ai-vendor, etc.)
- TypeScript checks can be bypassed for deployments using `build:no-typecheck`
- CommonJS compatibility for node_modules

## Restoration Priority
1. Fix Gemini API integration in ReportGeneratorPage
2. Restore function calling system for database queries
3. Implement two-phase analysis workflow
4. Update database function calls to use new schema
5. Test end-to-end analysis pipeline