# Analytics UI

A modern React-based analytics dashboard for visualizing and analyzing event data with interactive maps, directory views, and entity analytics.

## Features

- **Interactive Map View**: Visualize events geographically with clustering support
- **Directory View**: Browse all events with infinite scroll and filtering
- **Entity View**: Deep dive into specific actors, tags, and organizations
- **Advanced Filtering**: Filter by date range, confidence score, states, tags, actors, and more
- **Network Expansion**: Explore relationships between actors
- **Export Capabilities**: Export filtered data to CSV

## Tech Stack

- **Frontend**: React 18, TypeScript, Vite
- **Mapping**: Mapbox GL JS
- **Charts**: Recharts
- **State Management**: Zustand
- **Styling**: Tailwind CSS
- **Backend**: Supabase (PostgreSQL)
- **API**: RPC functions with keyset pagination

## Prerequisites

- Node.js 18+
- npm or yarn
- Supabase account with configured database

## Setup

1. Clone the repository:
```bash
git clone [your-repo-url]
cd analytics-ui
```

2. Install dependencies:
```bash
npm install
```

3. Create a `.env.local` file with your configuration:
```env
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
VITE_MAPBOX_ACCESS_TOKEN=your_mapbox_token
```

4. Run the development server:
```bash
npm run dev
```

## Build

To build for production:
```bash
npm run build
```

The built files will be in the `dist` directory.

## Project Structure

```
src/
├── api/              # API client and types
├── components/       # Reusable components
│   ├── ActivityChart/
│   ├── EventCard/
│   ├── FilterPanel/
│   ├── Navigation/
│   └── SidePanel/
├── lib/             # Utilities and configurations
├── state/           # State management (Zustand)
├── styles/          # Global styles
└── views/           # Main view components
    ├── DirectoryView/
    ├── EntityView/
    └── MapView/
```

## Key Components

### MapView
- Interactive map with event clustering
- Click clusters to drill down
- Side panel for event details

### DirectoryView
- Paginated list of all events
- Infinite scroll support
- Same filtering as map view

### EntityView
- Detailed view for actors, tags, and organizations
- Activity timeline charts
- Related events and statistics

## API Integration

The app integrates with a Supabase backend using RPC functions:
- `get_map_points`: Fetch geocoded events for map display
- `analytics_city_events_keyset`: Paginated event listing
- `list_all_events_keyset`: Directory view events
- `get_entity_details`: Detailed entity information
- `get_filter_options_optimized`: Dynamic filter options

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

MIT