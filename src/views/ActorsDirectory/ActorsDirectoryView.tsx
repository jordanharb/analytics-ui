import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { fetchActors, fetchDirectoryStats } from '../../api/actorsDirectoryService';
import { supabaseClient } from '../../api/supabaseClient';
import type {
  Actor,
  ActorDirectoryFilters,
  DirectoryStats,
} from '../../types/actorsDirectory';

const PAGE_SIZE = 100;

type ViewMode = 'table' | 'cards';

const TYPE_FILTERS: Array<{ id: string; label: string }> = [
  { id: 'all',          label: 'all' },
  { id: 'person',       label: 'people' },
  { id: 'organization', label: 'organizations' },
  { id: 'chapter',      label: 'chapters' },
];

const initialFilters: ActorDirectoryFilters = {
  type: 'all',
  search: '',
};

// fieldnotes palette
// page #f6f1e6   surface #fdfaf2   ink #1a1a1a   muted #6b6b6b
// accent #c2410c   accent text #9a330a   tag fill #fdf2ed   neutral #ede5d2

const LoadingOverlay: React.FC<{ message?: string }> = ({ message }) => (
  <div className="flex items-center justify-center gap-3 px-4 py-10 text-sm text-[#6b6b6b]">
    <span className="h-4 w-4 animate-spin rounded-full border-2 border-[#c2410c] border-t-transparent" />
    <span>{message ?? 'loading…'}</span>
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
      setActors((prev) => [...prev, ...result.actors]);
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
    fetchDirectoryStats()
      .then(setStats)
      .catch((err) => {
        console.error('Failed to fetch directory stats', err);
      });
  }, []);

  const onSearchChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    setFilters((prev) => ({ ...prev, search: value }));
  }, []);

  const onTypeChange = useCallback((type: string) => {
    setFilters((prev) => ({ ...prev, type }));
  }, []);

  const toggleView = useCallback((mode: ViewMode) => {
    setViewMode(mode);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('actors-directory-view', mode);
    }
  }, []);

  const handleSelectActor = useCallback(
    (actorId: string) => {
      navigate(`/entity/actor/${actorId}`, {
        state: { from: location.pathname + location.search },
      });
    },
    [location.pathname, location.search, navigate],
  );

  return (
    <div className="min-h-screen bg-[#f6f1e6] text-[#1a1a1a]">
      <div className="mx-auto w-full max-w-[1300px] px-4 md:px-6 py-8 md:py-10">
        {/* Hero */}
        <header className="mb-6">
          <div className="text-[10px] uppercase tracking-[0.4px] text-[#6b6b6b]">directory</div>
          <h1
            className="mt-1 text-[26px] md:text-[30px] font-semibold leading-tight text-[#1a1a1a] tracking-tight"
          >
            {stats ? `${stats.total.toLocaleString()} actors on file.` : 'actors on file.'}
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-[#6b6b6b]">
            people, organizations, and chapters we're keeping tabs on. click any row for the full profile.
          </p>
        </header>

        {/* Stat cards */}
        {stats && (
          <section className="mb-5 grid grid-cols-2 gap-2.5 md:grid-cols-4">
            <StatCard label="total" value={stats.total} />
            <StatCard label="people" value={stats.person} />
            <StatCard label="organizations" value={stats.organization} />
            <StatCard label="chapters" value={stats.chapter} />
          </section>
        )}

        {/* Pinned umbrella orgs */}
        <PinnedOrgs onSelect={(id) => navigate(`/entity/actor/${id}`)} />

        {/* Filter bar */}
        <section className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-wrap items-center gap-1.5">
            {TYPE_FILTERS.map((filter) => {
              const active = filters.type === filter.id;
              return (
                <button
                  key={filter.id}
                  onClick={() => onTypeChange(filter.id)}
                  className="text-xs px-3 py-1.5 transition-colors focus:outline-none"
                  style={{
                    borderRadius: 11,
                    background: active ? '#c2410c' : '#fdfaf2',
                    color: active ? '#fdfaf2' : '#2a2a2a',
                    border: active ? '0.5px solid #c2410c' : '0.5px solid rgba(0,0,0,0.12)',
                    fontWeight: active ? 500 : 400,
                  }}
                >
                  {filter.label}
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-2">
            <div className="relative flex-1 md:flex-none">
              <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-[#9a9a9a]">
                <svg className="h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197M16.803 15.803A7.5 7.5 0 1 0 5.196 5.197a7.5 7.5 0 0 0 11.607 10.606Z" />
                </svg>
              </span>
              <input
                value={filters.search}
                onChange={onSearchChange}
                placeholder="search actors, cities, descriptions…"
                type="search"
                className="w-full md:w-72 bg-[#fdfaf2] border border-black/[0.12] py-2 pl-9 pr-3 text-xs text-[#1a1a1a] placeholder:text-[#9a9a9a] focus:border-[#c2410c]/40 focus:outline-none focus:ring-2 focus:ring-[#c2410c]/15"
                style={{ borderRadius: 6 }}
              />
            </div>
            <div
              className="inline-flex bg-[#ede5d2] p-[3px]"
              style={{ borderRadius: 6 }}
            >
              <ToggleButton label="table" mode="table" activeMode={viewMode} onToggle={toggleView} />
              <ToggleButton label="cards" mode="cards" activeMode={viewMode} onToggle={toggleView} />
            </div>
          </div>
        </section>

        {/* Results */}
        <section className="bg-[#fdfaf2] border border-black/[0.1] rounded-lg overflow-hidden">
          <div className="max-h-[70vh] overflow-auto scrollbar-thin">
            {isLoading ? (
              <LoadingOverlay message="fetching actors" />
            ) : actors.length === 0 ? (
              <div className="flex h-64 flex-col items-center justify-center gap-2 text-center text-[#9a9a9a]">
                <span className="text-base font-medium text-[#6b6b6b]">no actors match the current filters.</span>
                <p className="max-w-sm text-xs">
                  try clearing search or switching the type filter to explore the full dataset.
                </p>
              </div>
            ) : viewMode === 'table' ? (
              <ActorsTable actors={actors} onSelect={handleSelectActor} />
            ) : (
              <ActorsCardGrid actors={actors} onSelect={handleSelectActor} />
            )}
          </div>
          {hasMore && (
            <div className="border-t border-black/[0.08] bg-[#f6f1e6] p-3 text-center">
              <button
                onClick={handleLoadMore}
                disabled={isLoadingMore}
                className="text-xs font-medium text-[#c2410c] hover:text-[#9a330a] disabled:opacity-50"
              >
                {isLoadingMore
                  ? 'loading…'
                  : `load more · showing ${actors.length.toLocaleString()} of ${total.toLocaleString()}`}
              </button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
};

// ---- subcomponents ---------------------------------------------------------

const PINNED_ORG_IDS = [
  '72ddb970-a5c4-4c4e-b157-bfbfc9673f30', // Turning Point Action
  'eeb37cb1-eb4a-40d0-aa28-f6bd0ade63ac', // Turning Point USA
  'de9ed050-b116-4ae4-8579-c4868fb0ec79', // TPUSA Students
  'f9987bb1-c9ea-4d3d-8eff-e160fe9a0bc6', // Turning Point Action Coalitions
  '1d0699a1-13e3-455f-951e-50392cac37e3', // TPUSA Faith
  '5781a70f-2384-404e-8516-ad714f6c0b01', // Turning Point Academy
];

const PinnedOrgs: React.FC<{ onSelect: (id: string) => void }> = ({ onSelect }) => {
  const [orgs, setOrgs] = useState<(Actor & { network_event_count: number })[]>([]);

  useEffect(() => {
    const load = async () => {
      const { data } = await supabaseClient
        .from('v2_actors_with_counts')
        .select('id,name,actor_type,event_count')
        .in('id', PINNED_ORG_IDS);

      if (!data) return;

      // Fetch network actor IDs for each org in parallel, then sum event counts
      const enriched = await Promise.all(
        data.map(async (org) => {
          try {
            const { data: netIds } = await supabaseClient.rpc('get_network_actor_ids', {
              p_actor_ids: [org.id],
              p_include_self: false,
            });
            const linked: string[] = netIds ?? [];
            if (linked.length === 0) {
              return { ...(org as Actor), network_event_count: org.event_count ?? 0 };
            }
            const { data: linkedActors } = await supabaseClient
              .from('v2_actors_with_counts')
              .select('event_count')
              .in('id', linked);
            const networkTotal = (linkedActors ?? []).reduce(
              (sum: number, a: any) => sum + (a.event_count ?? 0),
              org.event_count ?? 0,
            );
            return { ...(org as Actor), network_event_count: networkTotal };
          } catch {
            return { ...(org as Actor), network_event_count: org.event_count ?? 0 };
          }
        }),
      );

      enriched.sort((a, b) => b.network_event_count - a.network_event_count);
      setOrgs(enriched);
    };
    load();
  }, []);

  if (orgs.length === 0) return null;

  return (
    <section className="mb-5">
      <div className="text-[10px] uppercase tracking-[0.4px] text-[#6b6b6b] mb-2">umbrella organizations</div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-6">
        {orgs.map((org) => (
          <button
            key={org.id}
            onClick={() => onSelect(org.id)}
            className="bg-[#fdfaf2] border border-black/[0.08] rounded-md px-3 py-2.5 text-left hover:border-[#c2410c]/40 transition-colors cursor-pointer"
          >
            <div className="text-[12px] font-medium text-[#1a1a1a] truncate">{org.name}</div>
            <div className="text-[11px] text-[#6b6b6b] mt-0.5 tabular-nums">
              {org.network_event_count.toLocaleString()} events
            </div>
          </button>
        ))}
      </div>
    </section>
  );
};

const StatCard: React.FC<{ label: string; value: number }> = ({ label, value }) => (
  <div className="bg-[#fdfaf2] border border-black/[0.08] rounded-md px-4 py-3">
    <div className="text-[10px] uppercase tracking-[0.4px] text-[#6b6b6b]">{label}</div>
    <div className="mt-1 text-[22px] font-medium text-[#1a1a1a] tabular-nums">
      {value.toLocaleString()}
    </div>
  </div>
);

const ToggleButton: React.FC<{
  label: string;
  mode: ViewMode;
  activeMode: ViewMode;
  onToggle: (mode: ViewMode) => void;
}> = ({ label, mode, activeMode, onToggle }) => {
  const active = activeMode === mode;
  return (
    <button
      onClick={() => onToggle(mode)}
      className="text-xs px-3 py-1 transition-colors focus:outline-none"
      style={{
        borderRadius: 4,
        background: active ? '#fdfaf2' : 'transparent',
        color: active ? '#1a1a1a' : '#6b6b6b',
        fontWeight: active ? 500 : 400,
      }}
    >
      {label}
    </button>
  );
};

// type pill: person = burnt orange, org/chapter = neutral
const TypePill: React.FC<{ type: string | null | undefined }> = ({ type }) => {
  const isPerson = type === 'person';
  return (
    <span
      style={{
        background: isPerson ? '#fdf2ed' : '#ede5d2',
        color: isPerson ? '#9a330a' : '#6b6b6b',
        border: isPerson ? '0.5px solid rgba(194,65,12,0.2)' : '0.5px solid transparent',
        padding: '2px 8px',
        borderRadius: 11,
        fontSize: 10,
      }}
    >
      {type ?? 'unknown'}
    </span>
  );
};

const initialsFor = (name?: string | null) => {
  if (!name) return '?';
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
};

// avatar tone: actors with >= 50 events get the orange treatment, others stay neutral
const Avatar: React.FC<{ actor: Actor; size?: number }> = ({ actor, size = 30 }) => {
  const hot = (actor.event_count ?? 0) >= 50;
  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: hot ? '#c2410c' : '#ede5d2',
        color: hot ? '#fdfaf2' : '#6b6b6b',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: size >= 44 ? 14 : 11,
        fontWeight: 500,
        flexShrink: 0,
      }}
    >
      {initialsFor(actor.name)}
    </span>
  );
};

const ActorsTable: React.FC<{ actors: Actor[]; onSelect: (actorId: string) => void }> = ({
  actors,
  onSelect,
}) => (
  <table className="min-w-full" style={{ tableLayout: 'fixed' }}>
    <thead className="bg-[#f6f1e6]">
      <tr>
        <Th width="44%">actor</Th>
        <Th width="14%">type</Th>
        <Th width="26%">location</Th>
        <Th width="16%" align="right">events</Th>
      </tr>
    </thead>
    <tbody>
      {actors.map((actor) => (
        <tr
          key={actor.id}
          onClick={() => onSelect(actor.id)}
          className="cursor-pointer transition-colors hover:bg-[#f6f1e6] border-t border-black/[0.06]"
        >
          <Td>
            <div className="flex items-center gap-2.5 min-w-0">
              <Avatar actor={actor} />
              <div className="min-w-0">
                <div className="text-[13px] font-medium text-[#1a1a1a] truncate">
                  {actor.name ?? 'unnamed actor'}
                </div>
                <div className="text-[11px] text-[#6b6b6b] truncate">
                  {actor.about ? truncate(actor.about, 70) : '—'}
                </div>
              </div>
            </div>
          </Td>
          <Td><TypePill type={actor.actor_type} /></Td>
          <Td>
            <span className="text-xs text-[#2a2a2a]">
              {[actor.city, actor.state].filter(Boolean).join(', ') || '—'}
            </span>
          </Td>
          <Td align="right">
            <span className="text-xs font-medium text-[#1a1a1a] tabular-nums">
              {(actor.event_count ?? 0).toLocaleString()}
            </span>
          </Td>
        </tr>
      ))}
    </tbody>
  </table>
);

const ActorsCardGrid: React.FC<{ actors: Actor[]; onSelect: (actorId: string) => void }> = ({
  actors,
  onSelect,
}) => (
  <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
    {actors.map((actor) => (
      <button
        key={actor.id}
        onClick={() => onSelect(actor.id)}
        className="h-full rounded-md border border-black/[0.1] bg-[#fdfaf2] p-4 text-left transition-colors hover:border-[#c2410c]/40 hover:bg-[#f6f1e6]"
      >
        <div className="flex items-start justify-between gap-3">
          <Avatar actor={actor} size={44} />
          <TypePill type={actor.actor_type} />
        </div>
        <div className="mt-3 text-[15px] font-medium text-[#1a1a1a] leading-snug">
          {actor.name ?? 'unnamed actor'}
        </div>
        <p className="mt-1.5 line-clamp-2 text-[12px] text-[#6b6b6b] leading-relaxed">
          {actor.about ?? 'no description on file.'}
        </p>
        <div className="mt-3 flex items-center justify-between text-[11px] text-[#6b6b6b]">
          <span>{[actor.city, actor.state].filter(Boolean).join(', ') || 'no location'}</span>
          <span className="tabular-nums">
            {(actor.event_count ?? 0).toLocaleString()} events
          </span>
        </div>
      </button>
    ))}
  </div>
);

const Th: React.FC<React.PropsWithChildren<{ width?: string; align?: 'left' | 'right' }>> = ({
  children,
  width,
  align = 'left',
}) => (
  <th
    className="px-4 py-2.5 text-[10px] uppercase tracking-[0.4px] font-medium text-[#6b6b6b]"
    style={{ width, textAlign: align }}
  >
    {children}
  </th>
);

const Td: React.FC<React.PropsWithChildren<{ align?: 'left' | 'right' }>> = ({
  children,
  align = 'left',
}) => (
  <td className="px-4 py-3 text-sm text-[#2a2a2a]" style={{ textAlign: align, verticalAlign: 'middle' }}>
    {children}
  </td>
);

function truncate(value: string, length: number) {
  if (value.length <= length) return value;
  return `${value.slice(0, length)}…`;
}

export default ActorsDirectoryView;
