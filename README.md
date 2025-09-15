# Analytics UI - Comprehensive Documentation

A modern React-based analytics dashboard for visualizing and analyzing event data with interactive maps, directory views, and entity analytics.

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Core Components](#core-components)
- [State Management](#state-management)
- [API Integration](#api-integration)
- [Routing](#routing)
- [Styling System](#styling-system)
- [Development](#development)
- [Deployment](#deployment)
- [Performance](#performance)

## Overview

Analytics UI is a sophisticated web application that provides:
- **Real-time event visualization** on interactive maps
- **Comprehensive event directory** with advanced search
- **Entity relationship exploration** for actors, tags, and organizations
- **Advanced filtering system** with multiple criteria
- **Network analysis** for discovering connections
- **Data export capabilities** for further analysis

The application serves as a powerful tool for analyzing patterns, relationships, and trends in event data across geographic and temporal dimensions.

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                   User Interface                     │
│  ┌─────────────┬──────────────┬─────────────────┐  │
│  │   MapView   │ DirectoryView │   EntityView    │  │
│  └─────────────┴──────────────┴─────────────────┘  │
│                         │                            │
│  ┌──────────────────────┴────────────────────────┐  │
│  │              Shared Components                 │  │
│  │  (Header, FilterPanel, EventCard, etc.)       │  │
│  └──────────────────────┬────────────────────────┘  │
│                         │                            │
│  ┌──────────────────────┴────────────────────────┐  │
│  │            State Management (Zustand)          │  │
│  └──────────────────────┬────────────────────────┘  │
│                         │                            │
│  ┌──────────────────────┴────────────────────────┐  │
│  │              API Client Layer                  │  │
│  └──────────────────────┬────────────────────────┘  │
│                         │                            │
│  ┌──────────────────────┴────────────────────────┐  │
│  │            Supabase Backend (RPC)              │  │
│  └────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

### Data Flow
1. **User Interaction** → Updates filter state
2. **State Change** → Triggers API calls
3. **API Response** → Updates UI components
4. **Component Render** → Displays updated data

## Tech Stack

### Frontend Core
- **React 18.2**: Component-based UI framework
- **TypeScript 5.3**: Type-safe development
- **Vite 5.0**: Fast build tool and dev server

### UI & Styling
- **Tailwind CSS 3.4**: Utility-first CSS framework
- **Mapbox GL JS 3.0**: Advanced map rendering
- **Recharts 2.10**: Data visualization charts

### State & Routing
- **Zustand 4.4**: Lightweight state management
- **React Router 6.20**: Client-side routing
- **Date-fns 2.30**: Date manipulation

### Backend
- **Supabase**: PostgreSQL database with RPC functions
- **PostGIS**: Geospatial data handling

## Project Structure

```
analytics-ui/
├── src/
│   ├── api/
│   │   ├── analyticsClient.ts      # Main API client singleton
│   │   ├── types.ts                # TypeScript interfaces
│   │   └── utils.ts                # API helper functions
│   │
│   ├── components/
│   │   ├── Header/
│   │   │   ├── Header.tsx          # Navigation header
│   │   │   └── Header.css          # Header styles
│   │   │
│   │   ├── FilterPanel/
│   │   │   ├── FilterPanel.tsx     # Main filter interface
│   │   │   ├── DateRangeFilter.tsx # Date selection
│   │   │   └── MultiSelect.tsx     # Multi-select dropdown
│   │   │
│   │   ├── EventCard/
│   │   │   └── EventCard.tsx       # Event display card
│   │   │
│   │   ├── SearchBar/
│   │   │   └── SearchBar.tsx       # Global search input
│   │   │
│   │   ├── SidePanel/
│   │   │   └── SidePanel.tsx       # Map detail panel
│   │   │
│   │   ├── ActivityChart/
│   │   │   └── ActivityChart.tsx   # Time series chart
│   │   │
│   │   └── LaunchPage/
│   │       └── LaunchPage.tsx      # Landing page
│   │
│   ├── views/
│   │   ├── MapView/
│   │   │   └── MapView.tsx         # Interactive map
│   │   │
│   │   ├── DirectoryView/
│   │   │   └── DirectoryView.tsx   # Event list view
│   │   │
│   │   └── EntityView/
│   │       └── EntityView.tsx      # Entity details
│   │
│   ├── state/
│   │   └── filtersStore.ts         # Global filter state
│   │
│   ├── lib/
│   │   ├── mapboxConfig.ts         # Map configuration
│   │   ├── supabase.ts             # Supabase client
│   │   └── utils.ts                # Utility functions
│   │
│   ├── styles/
│   │   ├── palantir-theme.css     # Design system
│   │   ├── components.css         # Component styles
│   │   └── index.css              # Global styles
│   │
│   ├── App.tsx                    # Root component
│   ├── main.tsx                   # Entry point
│   └── vite-env.d.ts             # Type declarations
│
├── public/                        # Static assets
├── index.html                     # HTML template
├── package.json                   # Dependencies
├── tsconfig.json                 # TypeScript config
├── vite.config.ts               # Vite configuration
├── tailwind.config.js           # Tailwind settings
└── .env.local                   # Environment variables
```

## Core Components

### Views

#### MapView Component
Primary map interface with clustering and interaction.

```typescript
interface MapViewState {
  mapData: MapPointsResponse | null;
  selectedCity: CitySelection | null;
  selectedCluster: ClusterSelection | null;
  showFilters: boolean;
  showVirtualEvents: boolean;
  virtualEventsCount: number;
}
```

**Key Features:**
- Mapbox GL integration with custom styles
- Dynamic clustering (10-50-200+ thresholds)
- Click-to-expand clusters
- City-level event details
- Virtual/non-geocoded event counter
- Mobile gesture support

**Map Configuration:**
```typescript
const mapConfig = {
  style: 'mapbox://styles/mapbox/light-v11',
  center: [-98.5795, 39.8283], // US center
  zoom: 4,
  maxZoom: 18,
  minZoom: 2
};
```

#### DirectoryView Component
Searchable, paginated event listing.

```typescript
interface DirectoryViewState {
  events: EventSummary[];
  loading: boolean;
  totalCount: number;
  cursor: Cursor | undefined;
  hasMore: boolean;
  expandedEventId: string | null;
}
```

**Features:**
- Infinite scroll with intersection observer
- Keyset pagination for performance
- Expandable event cards
- CSV export functionality
- Real-time search integration

**Pagination Implementation:**
```typescript
// Keyset pagination using cursor
const loadEvents = async (isInitial: boolean) => {
  const response = await analyticsClient.getDirectoryEvents(
    filters,
    50, // page size
    isInitial ? undefined : cursor
  );
  // Append or replace events based on isInitial
};
```

#### EntityView Component
Detailed entity analysis with relationships.

```typescript
type EntityType = 'actor' | 'tag' | 'state';

interface EntityViewProps {
  entityType: EntityType;
  entityId: string;
}
```

**Features:**
- Entity metadata display
- Activity timeline chart
- Related events list
- Network connections (actors)
- Back navigation with history

### Shared Components

#### FilterPanel
Comprehensive filtering interface.

```typescript
interface FilterPanelProps {
  className?: string;
  onClose?: () => void;
}

interface Filters {
  period?: 'all' | '30d' | '90d' | '1y';
  date_range?: { start: Date; end: Date };
  confidence?: number;
  states?: string[];
  tags?: string[];
  actor_ids?: string[];
  actor_types?: string[];
  search?: string;
}
```

**Filter Categories:**
1. **Temporal**: Preset periods or custom range
2. **Geographic**: State selection
3. **Confidence**: Score threshold (0-1)
4. **Categories**: Hierarchical tag system
5. **Actors**: Types and specific individuals
6. **Search**: Full-text search

#### EventCard
Displays event information with expandable details.

```typescript
interface EventCardProps {
  event: EventSummary;
  isExpanded: boolean;
  onToggleExpand: () => void;
}
```

**Display Elements:**
- Event name and date
- Location (city, state)
- Confidence score with color coding
- Tag badges (interactive)
- Expandable details section
  - Description
  - AI justification
  - Related actors
  - Source posts

#### SidePanel
Map interaction detail panel.

```typescript
interface SidePanelProps {
  selectedCity?: CitySelection;
  selectedCluster?: ClusterSelection;
  onClose: () => void;
  onCitySelect?: (city: string, state: string) => void;
}
```

**Modes:**
1. **City View**: Events for specific city
2. **Cluster View**: Multiple cities in cluster
3. **Loading State**: Skeleton UI
4. **Error State**: Retry capability

## State Management

### Zustand Store Structure

```typescript
interface FiltersStore {
  // State
  filters: Filters;              // Applied filters
  pendingFilters: Filters;        // Uncommitted changes
  filterOptions: FilterOptions;   // Available options
  isApplying: boolean;           // Loading state
  networkExpanded: boolean;      // Network mode
  expandedActorIds: string[];    // Expanded network
  
  // Actions
  setFilter: (key: keyof Filters, value: any) => void;
  applyFilters: () => void;
  resetFilters: () => void;
  setFilterOptions: (options: FilterOptions) => void;
  setNetworkExpanded: (expanded: boolean) => void;
  setExpandedActorIds: (ids: string[]) => void;
}
```

### State Flow
1. **User Input** → `setFilter()` updates `pendingFilters`
2. **Apply Action** → `applyFilters()` commits to `filters`
3. **Reset Action** → `resetFilters()` clears all
4. **Network Toggle** → Fetches extended actor network
5. **Component Subscribe** → Re-renders on state change

## API Integration

### Analytics Client

Singleton pattern for API management.

```typescript
class AnalyticsClient {
  private supabase: SupabaseClient;
  
  // Map operations
  async getMapPoints(filters: Filters): Promise<MapPointsResponse>
  
  // Directory operations  
  async getDirectoryEvents(
    filters: Filters,
    limit: number,
    cursor?: Cursor
  ): Promise<DirectoryResponse>
  
  // Event operations
  async getEventDetails(eventId: string): Promise<EventDetails>
  async getCityEvents(
    city: string,
    state: string,
    filters: Filters
  ): Promise<CityEventsResponse>
  
  // Entity operations
  async getEntityDetails(
    entityType: string,
    entityId: string
  ): Promise<EntityDetails>
  async getEntityTimeseries(
    entityType: string,
    entityId: string,
    filters: Filters
  ): Promise<TimeseriesData>
  
  // Filter operations
  async getFilterOptions(): Promise<FilterOptions>
  
  // Export operations
  async exportEvents(params: ExportParams): Promise<string[][]>
  
  // Network operations
  async getNetworkActorIds(actorIds: string[]): Promise<string[]>
}
```

### Supabase RPC Functions

Backend functions called by the client:

```sql
-- Map clustering
get_map_points(filters) → map_points[]

-- Event listing with pagination
analytics_city_events_keyset(
  city, state, filters, cursor, limit
) → events[]

-- Directory listing
list_all_events_keyset(
  filters, cursor, limit
) → events[]

-- Entity details
get_entity_details(
  entity_type, entity_id
) → entity_info

-- Filter options
get_filter_options_optimized() → filter_options

-- Network expansion
get_network_actors(actor_ids) → expanded_ids[]
```

## Routing

### Route Configuration

```typescript
const router = createBrowserRouter([
  {
    path: "/",
    element: <LaunchPage />
  },
  {
    path: "/map",
    element: <MapView />
  },
  {
    path: "/directory", 
    element: <DirectoryView />
  },
  {
    path: "/entity/:entityType/:entityId",
    element: <EntityView />
  }
]);
```

### Navigation Patterns
- **Tab Navigation**: Header component tabs
- **Entity Navigation**: Click tags/actors to navigate
- **History Navigation**: Back button with state
- **URL Encoding**: Special character handling

## Styling System

### Design Philosophy
Palantir-inspired design system emphasizing:
- Clean, professional interface
- Information density
- Subtle interactions
- Consistent visual hierarchy

### CSS Architecture

#### 1. Tailwind Utilities
```html
<div className="flex items-center gap-4 p-4 bg-white rounded-lg shadow-sm">
```

#### 2. Component Classes
```css
.card {
  background: white;
  border: 1px solid #e5e7eb;
  border-radius: 0.5rem;
}

.card-interactive:hover {
  transform: translateY(-2px);
  box-shadow: 0 10px 15px -3px rgba(0,0,0,0.1);
}
```

#### 3. Design Tokens
```css
:root {
  --color-primary: #0066cc;
  --color-success: #059669;
  --color-warning: #d97706;
  --radius-sm: 0.25rem;
  --shadow-lg: 0 10px 15px -3px rgba(0,0,0,0.1);
}
```

### Responsive Design

#### Breakpoints
- Mobile: < 640px
- Tablet: 640px - 1024px
- Desktop: > 1024px

#### Mobile Optimizations
- Touch targets: minimum 44px
- Collapsible panels
- Simplified navigation
- Reduced data density
- Gesture support

## Development

### Prerequisites
```bash
# Required
Node.js 18+
npm 9+ or yarn
Git

# API Keys
Mapbox access token
Supabase project URL and anon key
```

### Setup Instructions

1. **Clone Repository**
```bash
git clone https://github.com/jordanharb/analytics-ui.git
cd analytics-ui
```

2. **Install Dependencies**
```bash
npm install
```

3. **Configure Environment**
```bash
cp .env.example .env.local
# Edit .env.local with your credentials
```

4. **Start Development**
```bash
npm run dev
# Opens http://localhost:5173
```

### Available Scripts

```bash
npm run dev        # Start dev server
npm run build      # Production build
npm run preview    # Preview production
npm run lint       # Run ESLint
npm run type-check # TypeScript check
npm run test       # Run tests
```

### Code Quality

#### TypeScript Configuration
```json
{
  "compilerOptions": {
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitReturns": true
  }
}
```

#### ESLint Rules
- React hooks rules
- TypeScript recommended
- Import order enforcement
- Accessibility checks

## Deployment

### Production Build
```bash
npm run build
# Creates optimized build in dist/
```

### Deployment Options

#### Vercel
```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
vercel --prod
```

#### Netlify
```toml
# netlify.toml
[build]
  command = "npm run build"
  publish = "dist"
```

#### Docker
```dockerfile
FROM node:18-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
```

### Environment Variables
```env
# Required
VITE_SUPABASE_URL=https://xxx.supabase.co
VITE_SUPABASE_ANON_KEY=xxx
VITE_MAPBOX_ACCESS_TOKEN=xxx

# Optional
VITE_API_TIMEOUT=30000
VITE_ENABLE_ANALYTICS=true
```

## Performance

### Optimization Strategies

#### Data Loading
- Keyset pagination (no offset)
- Request debouncing (300ms)
- Infinite scroll with observer
- Request caching

#### Map Performance
- Cluster optimization
- Viewport culling
- Lazy marker rendering
- WebGL acceleration

#### Bundle Optimization
- Route-based code splitting
- Tree shaking
- Minification
- Compression (gzip/brotli)

### Performance Metrics
- Initial load: < 3s
- Time to interactive: < 5s
- Lighthouse score: > 90

## Browser Support

- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+
- Mobile Safari iOS 14+
- Chrome Android 90+

## Troubleshooting

### Common Issues

#### Map Not Loading
- Check Mapbox token validity
- Verify network connectivity
- Check browser console for errors

#### Filters Not Working
- Ensure Supabase connection
- Check RPC function permissions
- Verify filter state in Redux DevTools

#### Performance Issues
- Reduce map marker density
- Enable hardware acceleration
- Clear browser cache

## Contributing

1. Fork the repository
2. Create feature branch (`git checkout -b feature/amazing`)
3. Commit changes (`git commit -m 'Add feature'`)
4. Push branch (`git push origin feature/amazing`)
5. Open Pull Request

### Commit Convention
```
type(scope): description

- feat: New feature
- fix: Bug fix
- docs: Documentation
- style: Formatting
- refactor: Code restructuring
- test: Tests
- chore: Maintenance
```

## License

MIT License - see LICENSE file for details

## Support

- **Issues**: [GitHub Issues](https://github.com/jordanharb/analytics-ui/issues)
- **Documentation**: This file
- **API Docs**: Available in `/docs/api`# Trigger Vercel rebuild
