import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { fetchActors, fetchDirectoryStats } from '../../api/actorsDirectoryService';
import type {
  Actor,
  ActorDirectoryFilters,
  DirectoryStats,
} from '../../types/actorsDirectory';

const PAGE_SIZE = 100;

type ViewMode = 'table' | 'cards';

const TYPE_FILTERS: Array<{ id: string; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'person', label: 'People' },
  { id: 'organization', label: 'Organizations' },
  { id: 'chapter', label: 'Chapters' },
];

const initialFilters: ActorDirectoryFilters = {
  type: 'all',
  search: '',
};

const LoadingOverlay: React.FC<{ message?: string }> = ({ message }) => (
  <div className="flex items-center justify-center gap-3 rounded-md border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
    <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-400 border-t-transparent" />
    <span>{message ?? 'Loading…'}</span>
  </div>
);

export const ActorsDirectoryView: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [filters, setFilters] = useState<ActorDirectoryFilters>(initialFilters);
  const [actors, setActors] = useState<Actor[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    if (typeof window === 'undefined') return 'table';
    const persisted = window.localStorage.getItem('actors-directory-view');
    return (persisted as ViewMode) ?? 'table';
  });
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isLoadingMore, setIsLoadingMore] = useState<boolean>(false);
  const [stats, setStats] = useState<DirectoryStats | null>(null);

  const hasMore = actors.length < total;

  const loadActors = useCallback(async (currentFilters: ActorDirectoryFilters) => {
    setIsLoading(true);
    try {
      const result = await fetchActors(currentFilters, PAGE_SIZE, 0);
      setActors(result.actors);
      setTotal(result.total);
    } catch (error) {
      console.error('Failed to load actors', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleLoadMore = useCallback(async () => {
    if (isLoadingMore || !hasMore) return;
    setIsLoadingMore(true);
    try {
      const result = await fetchActors(filters, PAGE_SIZE, actors.length);
      setActors(prev => [...prev, ...result.actors]);
      setTotal(result.total);
    } catch (error) {
      console.error('Failed to load more actors', error);
    } finally {
      setIsLoadingMore(false);
    }
  }, [actors.length, filters, hasMore, isLoadingMore]);

  useEffect(() => {
    loadActors(filters);
  }, [filters, loadActors]);

  useEffect(() => {
    fetchDirectoryStats().then(setStats).catch(err => {
      console.error('Failed to fetch directory stats', err);
    });
  }, []);

  const onSearchChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    setFilters(prev => ({ ...prev, search: value }));
  }, []);

  const onTypeChange = useCallback((type: string) => {
    setFilters(prev => ({ ...prev, type }));
  }, []);

  const toggleView = useCallback((mode: ViewMode) => {
    setViewMode(mode);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('actors-directory-view', mode);
    }
  }, []);

  const handleSelectActor = useCallback(
    (actorId: string) => {
      navigate(`/entity/actor/${actorId}`, { state: { from: location.pathname + location.search } });
    },
    [location.pathname, location.search, navigate],
  );

  const statsDisplay = useMemo(() => {
    if (!stats) return null;
    return (
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Total Actors" value={stats.total} />
        <StatCard label="People" value={stats.person} />
        <StatCard label="Organizations" value={stats.organization} />
        <StatCard label="Chapters" value={stats.chapter} />
      </div>
    );
  }, [stats]);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="mx-auto w-full max-w-[1300px] px-6 py-10">
        <header className="mb-8">
          <h1 className="text-3xl font-semibold tracking-tight text-slate-900">Actor Directory</h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-600">
            Explore the full actor dataset with filters, quick search, and detailed profiles.
          </p>
        </header>

        {statsDisplay && (
          <section className="mb-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            {statsDisplay}
          </section>
        )}

        <section className="mb-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-2">
              {TYPE_FILTERS.map(filter => (
                <button
                  key={filter.id}
                  onClick={() => onTypeChange(filter.id)}
                  className={`rounded-full px-4 py-2 text-sm font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 ${
                    filters.type === filter.id
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'border border-slate-200 bg-white text-slate-600 hover:border-blue-400 hover:text-blue-600'
                  }`}
                >
                  {filter.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-3">
              <div className="relative">
                <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-slate-500">
                  <svg
                    className="h-4 w-4"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth="1.5"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197M16.803 15.803A7.5 7.5 0 1 0 5.196 5.197a7.5 7.5 0 0 0 11.607 10.606Z" />
                  </svg>
                </span>
                <input
                  value={filters.search}
                  onChange={onSearchChange}
                  placeholder="Search actors, cities, states, descriptions"
                  className="w-72 rounded-full border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm text-slate-700 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                  type="search"
                />
              </div>
              <div className="inline-flex rounded-full border border-slate-200 bg-slate-100 p-1">
                <ToggleButton label="Table" mode="table" activeMode={viewMode} onToggle={toggleView} />
                <ToggleButton label="Cards" mode="cards" activeMode={viewMode} onToggle={toggleView} />
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="max-h-[70vh] overflow-auto">
            {isLoading ? (
              <div className="flex h-full items-center justify-center">
                <LoadingOverlay message="Fetching actors" />
              </div>
            ) : actors.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-slate-400">
                <span className="text-lg font-semibold">No actors match the current filters.</span>
                <p className="max-w-sm text-sm">
                  Try clearing your search or switching type filters to explore the full dataset.
                </p>
              </div>
            ) : viewMode === 'table' ? (
              <ActorsTable actors={actors} onSelect={handleSelectActor} />
            ) : (
              <ActorsCardGrid actors={actors} onSelect={handleSelectActor} />
            )}
          </div>
          {hasMore && (
            <div className="border-t border-slate-200 bg-slate-100 p-4">
              <button
                onClick={handleLoadMore}
                disabled={isLoadingMore}
                className="w-full rounded-lg bg-blue-600 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-blue-300"
              >
                {isLoadingMore ? 'Loading…' : 'Load More'}
              </button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
};

const StatCard: React.FC<{ label: string; value: number }> = ({ label, value }) => (
  <div className="rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
    <span className="text-xs font-semibold uppercase tracking-wide text-blue-600/80">{label}</span>
    <div className="mt-2 text-2xl font-semibold text-slate-900">{value.toLocaleString()}</div>
  </div>
);

const ToggleButton: React.FC<{
  label: string;
  mode: ViewMode;
  activeMode: ViewMode;
  onToggle: (mode: ViewMode) => void;
}> = ({ label, mode, activeMode, onToggle }) => (
  <button
    onClick={() => onToggle(mode)}
    className={`rounded-full px-4 py-1 text-sm font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 ${
      activeMode === mode ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-600 hover:text-blue-600'
    }`}
  >
    {label}
  </button>
);

const ActorsTable: React.FC<{ actors: Actor[]; onSelect: (actorId: string) => void }> = ({ actors, onSelect }) => (
  <table className="min-w-full divide-y divide-slate-200">
    <thead className="bg-slate-100">
      <tr>
        <Th>Actor</Th>
        <Th>Type</Th>
        <Th>Location</Th>
        <Th>Events</Th>
        <Th>States</Th>
      </tr>
    </thead>
    <tbody className="divide-y divide-slate-100">
      {actors.map(actor => (
        <tr
          key={actor.id}
          onClick={() => onSelect(actor.id)}
          className="cursor-pointer bg-white transition hover:bg-slate-50"
        >
          <Td>
            <div className="flex flex-col">
              <span className="font-semibold text-slate-900">{actor.name ?? 'Unnamed Actor'}</span>
              <span className="text-xs text-slate-500">{actor.about ? truncate(actor.about, 80) : '—'}</span>
            </div>
          </Td>
          <Td>
            <span className="inline-flex items-center rounded-full bg-blue-100 px-2 py-1 text-xs font-medium uppercase tracking-wide text-blue-700">
              {actor.actor_type ?? 'Unknown'}
            </span>
          </Td>
          <Td>
            <span className="text-sm text-slate-600">{[actor.city, actor.state].filter(Boolean).join(', ') || '—'}</span>
          </Td>
          <Td>
            <span className="text-sm font-semibold text-slate-700">{actor.event_count ?? 0}</span>
          </Td>
          <Td>
            <span className="text-sm font-semibold text-slate-700">{actor.state_count ?? 0}</span>
          </Td>
        </tr>
      ))}
    </tbody>
  </table>
);

const ActorsCardGrid: React.FC<{ actors: Actor[]; onSelect: (actorId: string) => void }> = ({ actors, onSelect }) => (
  <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2 xl:grid-cols-3">
    {actors.map(actor => (
      <button
        key={actor.id}
        onClick={() => onSelect(actor.id)}
        className="h-full rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-blue-400 hover:shadow-md"
      >
        <div className="flex items-center justify-between">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-100 text-xl font-semibold text-blue-700">
            {actor.name?.[0]?.toUpperCase() ?? '?'}
          </div>
          <span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-blue-700">
            {actor.actor_type ?? 'Unknown'}
          </span>
        </div>
        <div className="mt-4 text-lg font-semibold text-slate-900">{actor.name ?? 'Unnamed Actor'}</div>
        <p className="mt-2 line-clamp-3 text-sm text-slate-600">{actor.about ?? 'No description available.'}</p>
        <div className="mt-4 flex items-center justify-between text-xs text-slate-500">
          <span>{[actor.city, actor.state].filter(Boolean).join(', ') || 'No location'}</span>
          <span>{(actor.event_count ?? 0).toLocaleString()} events</span>
        </div>
      </button>
    ))}
  </div>
);

const Th: React.FC<React.PropsWithChildren> = ({ children }) => (
  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
    {children}
  </th>
);

const Td: React.FC<React.PropsWithChildren> = ({ children }) => (
  <td className="px-4 py-4 text-sm text-slate-700">{children}</td>
);

function truncate(value: string, length: number) {
  if (value.length <= length) return value;
  return `${value.slice(0, length)}…`;
}

export default ActorsDirectoryView;
