import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  fetchActorDetails,
  fetchActorEvents,
  fetchActorMembers,
  fetchActorRelationships,
  fetchActorUsernames,
  fetchActors,
  fetchDirectoryStats,
} from '../../api/actorsDirectoryService';
import type {
  Actor,
  ActorDirectoryFilters,
  ActorEvent,
  ActorMember,
  ActorRelationship,
  ActorUsername,
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

interface ModalState {
  actor?: Actor;
  usernames: ActorUsername[];
  relationships: ActorRelationship[];
  events: ActorEvent[];
  members: ActorMember[];
  isLoading: boolean;
  error?: string;
}

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

const ActorDetailModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  modalState: ModalState;
}> = ({ isOpen, onClose, modalState }) => {
  if (!isOpen) return null;

  const { actor, usernames, relationships, events, members, isLoading, error } = modalState;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/25 backdrop-blur-sm">
      <div className="relative flex h-[90vh] w-[min(1100px,94vw)] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-start justify-between border-b border-slate-200 bg-slate-50 px-6 py-4">
          <div>
            <h2 className="text-xl font-semibold text-slate-900">{actor?.name ?? 'Actor Details'}</h2>
            <p className="text-sm text-slate-500">
              {actor?.actor_type ? actor.actor_type.toUpperCase() : '—'}
              {actor?.city ? ` • ${actor.city}${actor.state ? `, ${actor.state}` : ''}` : ''}
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-md border border-slate-300 px-3 py-1 text-sm font-medium text-slate-600 transition hover:border-slate-400 hover:text-slate-900"
          >
            Close
          </button>
        </div>
        <div className="flex-1 overflow-y-auto bg-white px-6 py-6">
          {isLoading ? (
            <div className="flex h-full items-center justify-center">
              <LoadingOverlay message="Loading actor profile" />
            </div>
          ) : error ? (
            <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-rose-700">
              {error}
            </div>
          ) : (
            <div className="grid gap-6 lg:grid-cols-[2fr,1fr]">
              <section className="space-y-4">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Overview</h3>
                  <dl className="mt-3 grid grid-cols-2 gap-3 text-sm text-slate-600">
                    <div>
                      <dt className="text-slate-500">Type</dt>
                      <dd>{actor?.actor_type ?? '—'}</dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">Region</dt>
                      <dd>{actor?.region ?? '—'}</dd>
                    </div>
                    <div className="col-span-2">
                      <dt className="text-slate-500">About</dt>
                      <dd className="mt-1 whitespace-pre-wrap text-slate-700">
                        {actor?.about?.trim() || 'No description available.'}
                      </dd>
                    </div>
                  </dl>
                </div>

                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <header className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Events</h3>
                    <span className="text-xs text-slate-500">{events.length} linked</span>
                  </header>
                  {events.length === 0 ? (
                    <p className="mt-2 text-sm text-slate-500">No events found for this actor.</p>
                  ) : (
                    <ul className="mt-3 space-y-3">
                      {events.slice(0, 15).map(event => (
                        <li key={event.id} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">
                          <div className="flex flex-wrap items-center gap-2 text-slate-800">
                            <span className="font-medium">{event.v2_events?.title ?? 'Untitled Event'}</span>
                            <span className="text-xs text-slate-500">{event.event_date ? new Date(event.event_date).toLocaleDateString() : 'No date'}</span>
                          </div>
                          <div className="text-xs text-slate-500">
                            {[event.city, event.state].filter(Boolean).join(', ') || 'No location'}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </section>

              <section className="space-y-4">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Social Handles</h3>
                  {usernames.length === 0 ? (
                    <p className="mt-2 text-sm text-slate-500">No handles linked.</p>
                  ) : (
                    <ul className="mt-3 space-y-2 text-sm">
                      {usernames.map(handle => (
                        <li key={handle.id} className="flex items-center justify-between rounded-md border border-slate-200 bg-white px-3 py-2">
                          <span className="font-medium text-slate-800">@{handle.username}</span>
                          <span className="text-xs uppercase tracking-wide text-slate-500">{handle.platform}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Relationships</h3>
                  {relationships.length === 0 ? (
                    <p className="mt-2 text-sm text-slate-500">No relationships recorded.</p>
                  ) : (
                    <ul className="mt-3 space-y-2 text-sm text-slate-600">
                      {relationships.map(rel => (
                        <li key={rel.id} className="rounded-md border border-slate-200 bg-white px-3 py-2">
                          <div className="text-slate-800">{rel.to_actor?.name ?? rel.to_actor_id}</div>
                          <div className="text-xs text-slate-500">
                            {rel.relationship ?? 'relationship'}
                            {rel.role ? ` • ${rel.role}` : ''}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {members.length > 0 && (
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Members</h3>
                    <ul className="mt-3 space-y-2 text-sm text-slate-600">
                      {members.slice(0, 15).map(member => (
                        <li key={member.id} className="rounded-md border border-slate-200 bg-white px-3 py-2">
                          <div className="text-slate-800">{member.member_actor?.name ?? member.member_actor_id}</div>
                          <div className="text-xs text-slate-500">{member.role ?? 'Member'}</div>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </section>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export const ActorsDirectoryView: React.FC = () => {
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
  const [modalOpen, setModalOpen] = useState<boolean>(false);
  const [modalState, setModalState] = useState<ModalState>({
    usernames: [],
    relationships: [],
    events: [],
    members: [],
    isLoading: false,
  });

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

  const openActorModal = useCallback(async (actorId: string) => {
    setModalOpen(true);
    setModalState({
      isLoading: true,
      usernames: [],
      relationships: [],
      events: [],
      members: [],
    });

    try {
      const [actor, usernames, relationships, events, members] = await Promise.all([
        fetchActorDetails(actorId),
        fetchActorUsernames(actorId),
        fetchActorRelationships(actorId),
        fetchActorEvents(actorId),
        fetchActorMembers(actorId),
      ]);

      setModalState({
        actor: actor ?? undefined,
        usernames,
        relationships,
        events,
        members,
        isLoading: false,
      });
    } catch (error: any) {
      console.error('Failed to load actor modal data', error);
      setModalState(prev => ({
        ...prev,
        isLoading: false,
        error: error?.message ?? 'Failed to load actor',
      }));
    }
  }, []);

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
              <ActorsTable actors={actors} onSelect={openActorModal} />
            ) : (
              <ActorsCardGrid actors={actors} onSelect={openActorModal} />
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

      <ActorDetailModal isOpen={modalOpen} onClose={() => setModalOpen(false)} modalState={modalState} />
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
