import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  fetchClassifierViews,
  fetchUnknownActors,
  fetchUnknownActorById,
  fetchOrganizations,
  fetchPersonRoleCategories,
  fetchRelationshipLookups,
  createActorLinks,
  linkUnknownActor,
  promoteUnknownActor,
  searchExistingActors,
} from '../../api/actorClassifierService';
import type {
  ClassifierView,
  PromoteLinkInput,
  UnknownActor,
} from '../../types/actorClassifier';
import type { Actor } from '../../types/actorsDirectory';

const PAGE_SIZE = 50;

interface PromoteModalState {
  open: boolean;
  actor?: UnknownActor;
}

interface LinkModalState {
  open: boolean;
  actor?: UnknownActor;
}

interface PersonFormState {
  fullName: string;
  presentRole: string;
  roleCategory: string;
  city: string;
  state: string;
  about: string;
  isTpusaStaff: boolean;
  isTpusaAffiliated: boolean;
  primaryOrganizationId: string;
}

interface OrganizationFormState {
  name: string;
  type: string;
  summaryFocus: string;
  regionScope: string;
  isTpusa: boolean;
}

interface ChapterFormState {
  name: string;
  schoolType: string;
  city: string;
  stateCode: string;
  active: boolean;
}

interface MetadataEntry {
  id: string;
  key: string;
  value: string;
}

interface LinkSelection {
  actor: Pick<Actor, 'id' | 'name' | 'actor_type' | 'city' | 'state'>;
  relationship: string;
  role: string;
  roleCategory: string;
  isPrimary: boolean;
  startDate: string;
  endDate: string;
  metadata: MetadataEntry[];
}

const platformOptions = [
  { id: 'any', label: 'All Platforms' },
  { id: 'twitter', label: 'Twitter / X' },
  { id: 'instagram', label: 'Instagram' },
  { id: 'facebook', label: 'Facebook' },
  { id: 'tiktok', label: 'TikTok' },
  { id: 'youtube', label: 'YouTube' },
  { id: 'truth_social', label: 'Truth Social' },
];

const actorTypes = [
  { id: 'person', label: 'Person' },
  { id: 'organization', label: 'Organization' },
  { id: 'chapter', label: 'Chapter' },
];

const defaultLinkAdvancedFilters = {
  name: '',
  city: '',
  state: '',
  region: '',
  about: '',
};

const MAX_LINK_METADATA = 3;
const MAX_LINK_SEARCH_RESULTS = 8;

const parseLocationFromUnknownActor = (actor?: UnknownActor | null): { city: string; state: string } => {
  if (!actor) {
    return { city: '', state: '' };
  }

  const location = actor.profile_location ?? '';
  if (location) {
    const segments = location
      .split(',')
      .map(segment => segment.trim())
      .filter(Boolean);

    if (segments.length >= 2) {
      const city = segments[0];
      const rawState = segments.slice(1).join(', ');
      const normalizedState = /^[A-Za-z]{2}$/.test(rawState)
        ? rawState.toUpperCase()
        : rawState;
      return { city, state: normalizedState };
    }

    if (segments.length === 1) {
      const value = segments[0];
      if (/^[A-Za-z]{2}$/.test(value)) {
        return { city: '', state: value.toUpperCase() };
      }
      return { city: value, state: '' };
    }
  }

  return {
    city: (actor as any).city ?? '',
    state: (actor as any).state ?? '',
  };
};

const LoadingState: React.FC<{ message?: string }> = ({ message }) => (
  <div className="flex items-center justify-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 text-slate-600">
    <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-400 border-t-transparent" />
    <span className="text-sm">{message ?? 'Loading…'}</span>
  </div>
);

export const ActorClassifierView: React.FC = () => {
  const [views, setViews] = useState<ClassifierView[]>([]);
  const [selectedViewId, setSelectedViewId] = useState<string | null>(null);
  const [actors, setActors] = useState<UnknownActor[]>([]);
  const [selectedActorId, setSelectedActorId] = useState<string | null>(null);
  const [detailActor, setDetailActor] = useState<UnknownActor | null>(null);
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [platform, setPlatform] = useState<string>('any');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isLoadingMore, setIsLoadingMore] = useState<boolean>(false);
  const [hasMore, setHasMore] = useState<boolean>(false);
  const [total, setTotal] = useState<number>(0);
  const [promoteModal, setPromoteModal] = useState<PromoteModalState>({ open: false });
  const [linkModal, setLinkModal] = useState<LinkModalState>({ open: false });
  const [linkSearchTerm, setLinkSearchTerm] = useState<string>('');
  const [linkResults, setLinkResults] = useState<Actor[]>([]);
  const [linkIsSearching, setLinkIsSearching] = useState<boolean>(false);
  const [operationMessage, setOperationMessage] = useState<string | null>(null);
  const [organizations, setOrganizations] = useState<Array<Pick<Actor, 'id' | 'name'>>>([]);
  const [roleCategories, setRoleCategories] = useState<string[]>([]);
  const [relationshipLookups, setRelationshipLookups] = useState<{
    relationships: string[];
    roles: string[];
    roleCategories: string[];
  }>({ relationships: [], roles: [], roleCategories: [] });
  const [linkTypeFilter, setLinkTypeFilter] = useState<'all' | 'person' | 'organization' | 'chapter'>('all');
  const [linkAdvancedOpen, setLinkAdvancedOpen] = useState(false);
  const [linkAdvancedFilters, setLinkAdvancedFilters] = useState(defaultLinkAdvancedFilters);

  const selectedView = useMemo(
    () => views.find(view => view.id === selectedViewId) ?? null,
    [views, selectedViewId],
  );

  const loadViews = useCallback(async () => {
    try {
      const data = await fetchClassifierViews();
      setViews(data);
      if (data.length > 0) {
        setSelectedViewId(data[0].id);
      }
    } catch (error) {
      console.error('Failed to load classifier views', error);
    }
  }, []);

  const loadActors = useCallback(
    async (reset: boolean) => {
      if (!selectedView) return;
      const offset = reset ? 0 : actors.length;
      if (reset) {
        setIsLoading(true);
      } else {
        setIsLoadingMore(true);
      }
      try {
        const result = await fetchUnknownActors({
          config: selectedView.filter_config,
          offset,
          limit: PAGE_SIZE,
          searchTerm: searchTerm.trim() || undefined,
          platform: platform === 'any' ? undefined : platform,
        });

        if (reset) {
          setActors(result.actors);
        } else {
          setActors(prev => [...prev, ...result.actors]);
        }
        setTotal(result.total);
        setHasMore(result.hasMore);
      } catch (error) {
        console.error('Failed to load unknown actors', error);
      } finally {
        if (reset) {
          setIsLoading(false);
        } else {
          setIsLoadingMore(false);
        }
      }
    },
    [actors.length, platform, searchTerm, selectedView],
  );

  useEffect(() => {
    loadViews();
  }, [loadViews]);

  useEffect(() => {
    (async () => {
      try {
        const [orgs, categories, lookups] = await Promise.all([
          fetchOrganizations(),
          fetchPersonRoleCategories(),
          fetchRelationshipLookups(),
        ]);
        setOrganizations(orgs);
        setRoleCategories(categories);
        setRelationshipLookups(lookups);
      } catch (error) {
        console.error('Failed to load promotion metadata', error);
      }
    })();
  }, []);

  useEffect(() => {
    if (!selectedView) return;
    loadActors(true);
  }, [selectedView, searchTerm, platform, loadActors]);

  const handleViewSelect = useCallback((viewId: string) => {
    setSelectedViewId(viewId);
    setSelectedActorId(null);
    setDetailActor(null);
  }, []);

  const handleActorSelect = useCallback(
    async (actorId: string) => {
      setSelectedActorId(actorId);
      const cached = actors.find(a => a.id === actorId);
      if (cached) {
        setDetailActor(cached);
      } else {
        try {
          const fresh = await fetchUnknownActorById(actorId);
          if (fresh) {
            setDetailActor(fresh);
          }
        } catch (error) {
          console.error('Failed to load actor detail', error);
        }
      }
    },
    [actors],
  );

  const handleLoadMore = useCallback(() => {
    if (hasMore && !isLoadingMore) {
      loadActors(false);
    }
  }, [hasMore, isLoadingMore, loadActors]);

  useEffect(() => {
    if (!linkModal.open) {
      setLinkSearchTerm('');
      setLinkResults([]);
      setLinkTypeFilter('all');
      setLinkAdvancedOpen(false);
      setLinkAdvancedFilters(defaultLinkAdvancedFilters);
    }
  }, [linkModal.open]);

  useEffect(() => {
    if (!linkModal.open) {
      return;
    }

    let cancelled = false;

    const handler = setTimeout(async () => {
      setLinkIsSearching(true);
      try {
        const results = await searchExistingActors(linkSearchTerm.trim(), {
          actorType: linkTypeFilter === 'all' ? undefined : linkTypeFilter,
          name: linkAdvancedFilters.name || undefined,
          city: linkAdvancedFilters.city || undefined,
          state: linkAdvancedFilters.state || undefined,
          region: linkAdvancedFilters.region || undefined,
          about: linkAdvancedFilters.about || undefined,
          limit: 25,
        });
        if (!cancelled) {
          setLinkResults(results);
        }
      } catch (error) {
        if (!cancelled) {
          console.error('Failed to search actors', error);
        }
      } finally {
        if (!cancelled) {
          setLinkIsSearching(false);
        }
      }
    }, 300);

    return () => {
      cancelled = true;
      clearTimeout(handler);
    };
  }, [linkModal.open, linkSearchTerm, linkTypeFilter, linkAdvancedFilters]);

  const refreshAfterOperation = useCallback(() => {
    setOperationMessage('Refreshing list…');
    setTimeout(() => {
      loadActors(true).finally(() => {
        setOperationMessage(null);
      });
    }, 300);
  }, [loadActors]);

  const promoteActor = useCallback(
    async (payload: {
      actorType: string;
      actorName: string;
      city?: string;
      state?: string;
      fields?: Record<string, any>;
      links?: PromoteLinkInput[];
    }) => {
      if (!promoteModal.actor) return;
      try {
        const newActorId = await promoteUnknownActor({
          unknownActorId: promoteModal.actor.id,
          actorType: payload.actorType,
          actorName: payload.actorName,
          city: payload.city,
          state: payload.state,
          fields: payload.fields,
        });

        if (payload.links && payload.links.length && newActorId) {
          try {
            await createActorLinks(newActorId, payload.links);
          } catch (linkError) {
            console.error('Failed to create actor links', linkError);
            setOperationMessage('Actor promoted, but some links could not be created.');
            setTimeout(() => setOperationMessage(null), 4000);
          }
        }
        setPromoteModal({ open: false });
        setSelectedActorId(null);
        setDetailActor(null);
        refreshAfterOperation();
      } catch (error) {
        console.error('Failed to promote actor', error);
        setOperationMessage('Promotion failed – check console for details.');
        setTimeout(() => setOperationMessage(null), 3000);
      }
    },
    [promoteModal.actor, refreshAfterOperation],
  );

  const linkActor = useCallback(
    async (actorId: string) => {
      if (!linkModal.actor) return;
      try {
        await linkUnknownActor({
          unknownActorId: linkModal.actor.id,
          actorId,
        });
        setLinkModal({ open: false });
        setSelectedActorId(null);
        setDetailActor(null);
        refreshAfterOperation();
      } catch (error) {
        console.error('Failed to link actor', error);
        setOperationMessage('Linking failed – check console for details.');
        setTimeout(() => setOperationMessage(null), 3000);
      }
    },
    [linkModal.actor, refreshAfterOperation],
  );

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="mx-auto flex w-full max-w-[1380px] flex-col px-6 py-10">
        <header className="mb-8">
          <h1 className="text-3xl font-semibold tracking-tight text-slate-900">Actor Classifier</h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-600">
            Review high-priority unknown actors, promote confirmed identities, and link to existing entities.
          </p>
        </header>

        <section className="mb-8 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap gap-2">
              {views.map(view => (
                <button
                  key={view.id}
                  className={`rounded-full px-4 py-2 text-sm font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 ${
                    view.id === selectedViewId
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'border border-slate-200 bg-white text-slate-600 hover:border-blue-400 hover:text-blue-600'
                  }`}
                  onClick={() => handleViewSelect(view.id)}
                >
                  {view.name}
                </button>
              ))}
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
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
                  className="w-64 rounded-full border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm text-slate-700 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                  placeholder="Search handles, bios, keywords"
                  value={searchTerm}
                  onChange={event => setSearchTerm(event.target.value)}
                />
              </div>
              <select
                value={platform}
                onChange={event => setPlatform(event.target.value)}
                className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
              >
                {platformOptions.map(option => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-[2fr,1fr]">
          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 px-5 py-3 text-sm text-slate-500">
              Showing {actors.length.toLocaleString()} of {total.toLocaleString()} pending actors
            </div>
            <div className="overflow-x-auto">
              {isLoading ? (
                <div className="flex h-full items-center justify-center">
                  <LoadingState message="Loading unknown actors" />
                </div>
              ) : actors.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-slate-400">
                  <span className="text-lg font-semibold">No actors match the selected view.</span>
                  <p className="max-w-sm text-sm">
                    Adjust view filters or search criteria to explore other parts of the backlog.
                  </p>
                </div>
              ) : (
                <table className="min-w-full divide-y divide-slate-200">
                  <thead className="bg-slate-100">
                    <tr>
                      <Th>Handle</Th>
                      <Th>Display Name</Th>
                      <Th>Platform</Th>
                      <Th>Mentions</Th>
                      <Th>Authors</Th>
                      <Th>Priority</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {actors.map(actor => {
                      const score = (actor.mention_count ?? 0) * 2 + (actor.author_count ?? 0) * 5;
                      const isSelected = actor.id === selectedActorId;
                      return (
                        <tr
                          key={actor.id}
                          onClick={() => handleActorSelect(actor.id)}
                          className={`cursor-pointer transition ${
                            isSelected ? 'bg-blue-50' : 'bg-white hover:bg-slate-50'
                          }`}
                        >
                          <Td>
                            <div className="flex flex-col">
                              <span className="font-semibold text-slate-900">@{actor.detected_username ?? 'unknown'}</span>
                              <span className="text-xs text-slate-500">
                                {actor.first_seen_date ? `First seen ${new Date(actor.first_seen_date).toLocaleDateString()}` : 'First seen —'}
                              </span>
                            </div>
                          </Td>
                          <Td>
                            <span className="text-sm text-slate-700">{actor.profile_displayname ?? '—'}</span>
                          </Td>
                          <Td>
                            <span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-blue-700">
                              {actor.platform ?? '—'}
                            </span>
                          </Td>
                          <Td>
                            <span className="font-semibold text-slate-800">{actor.mention_count ?? 0}</span>
                          </Td>
                          <Td>
                            <span className="font-semibold text-slate-800">{actor.author_count ?? 0}</span>
                          </Td>
                          <Td>
                            <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">
                              {score}
                            </span>
                          </Td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
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
          </div>

          <aside className="flex flex-col rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 px-5 py-4">
              <h2 className="text-lg font-semibold text-slate-900">Actor Detail</h2>
              <p className="text-xs text-slate-500">Select an actor from the table to review context and take action.</p>
            </div>
            <div className="flex-1 overflow-auto px-5 py-4">
              {!detailActor ? (
                <div className="flex h-full items-center justify-center text-sm text-slate-500">
                  No actor selected yet.
                </div>
              ) : (
                <div className="space-y-4">
                  <div>
                    <h3 className="text-xl font-semibold text-slate-900">@{detailActor.detected_username}</h3>
                    <p className="text-sm text-slate-600">{detailActor.profile_displayname}</p>
                  </div>
                  <InfoRow label="Platform" value={detailActor.platform ?? '—'} />
                  <InfoRow label="Mentions" value={(detailActor.mention_count ?? 0).toLocaleString()} />
                  <InfoRow label="Authors" value={(detailActor.author_count ?? 0).toLocaleString()} />
                  <InfoRow
                    label="Priority Score"
                    value={
                      ((detailActor.mention_count ?? 0) * 2 + (detailActor.author_count ?? 0) * 5).toLocaleString()
                    }
                  />
                  <div>
                    <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Bio</span>
                    <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">
                      {detailActor.profile_bio?.trim() || 'No bio available.'}
                    </p>
                  </div>
                </div>
              )}
            </div>
            <div className="border-t border-slate-200 bg-slate-100 px-5 py-4">
              <div className="flex flex-col gap-2">
                <button
                  disabled={!detailActor}
                  onClick={() => detailActor && setPromoteModal({ open: true, actor: detailActor })}
                  className="rounded-lg bg-emerald-500 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-emerald-300"
                >
                  Promote to Actor
                </button>
                <button
                  disabled={!detailActor}
                  onClick={() => detailActor && setLinkModal({ open: true, actor: detailActor })}
                  className="rounded-lg bg-blue-600 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-blue-300"
                >
                  Link to Existing Actor
                </button>
                <a
                  href="/legacy/actor-classifier.html"
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-lg border border-slate-200 py-2 text-center text-sm font-semibold text-slate-600 transition hover:border-blue-400 hover:text-blue-600"
                >
                  Open Legacy Tool
                </a>
              </div>
              {operationMessage && (
                <div className="mt-3 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
                  {operationMessage}
                </div>
              )}
            </div>
          </aside>
        </section>
      </div>

      <PromoteModal
        state={promoteModal}
        onClose={() => setPromoteModal({ open: false })}
        onPromote={promoteActor}
      />
      <LinkModal
        state={linkModal}
        onClose={() => setLinkModal({ open: false })}
        searchTerm={linkSearchTerm}
        setSearchTerm={setLinkSearchTerm}
        results={linkResults}
        isSearching={linkIsSearching}
        onLink={linkActor}
      />
    </div>
  );
};

const Th: React.FC<React.PropsWithChildren> = ({ children }) => (
  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
    {children}
  </th>
);

const Td: React.FC<React.PropsWithChildren> = ({ children }) => (
  <td className="px-4 py-4 text-sm text-slate-700">{children}</td>
);

const InfoRow: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div>
    <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</span>
    <div className="text-sm text-slate-700">{value}</div>
  </div>
);

const PromoteModal: React.FC<{
  state: PromoteModalState;
  onClose: () => void;
  onPromote: (payload: { actorType: string; actorName: string; city?: string; state?: string }) => void;
}> = ({ state, onClose, onPromote }) => {
  const [actorType, setActorType] = useState<string>('person');
  const [actorName, setActorName] = useState<string>('');
  const [city, setCity] = useState<string>('');
  const [stateValue, setStateValue] = useState<string>('');

  useEffect(() => {
    if (state.open && state.actor) {
      setActorName(state.actor.profile_displayname ?? state.actor.detected_username ?? '');
      setActorType('person');
      setCity('');
      setStateValue('');
    }
  }, [state.open, state.actor]);

  if (!state.open || !state.actor) return null;

  return (
    <ModalShell title="Promote Unknown Actor" onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={event => {
          event.preventDefault();
          if (!actorName.trim()) return;
          onPromote({ actorType, actorName: actorName.trim(), city: city.trim() || undefined, state: stateValue.trim() || undefined });
        }}
      >
        <div>
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Actor Type</label>
          <div className="mt-1 grid grid-cols-3 gap-2">
            {actorTypes.map(type => (
              <button
                key={type.id}
                type="button"
                className={`rounded-md border px-3 py-2 text-center text-sm font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 ${
                  actorType === type.id
                    ? 'border-blue-500 bg-blue-50 text-blue-700'
                    : 'border-slate-200 bg-white text-slate-600 hover:border-blue-300 hover:text-blue-600'
                }`}
                onClick={() => setActorType(type.id)}
              >
                {type.label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Actor Name</label>
          <input
            value={actorName}
            onChange={event => setActorName(event.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
            required
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">City</label>
            <input
              value={city}
              onChange={event => setCity(event.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
            />
          </div>
          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">State</label>
            <input
              value={stateValue}
              onChange={event => setStateValue(event.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-600 transition hover:border-slate-400 hover:text-slate-900"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="rounded-md bg-emerald-500 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-400"
          >
            Promote Actor
          </button>
        </div>
      </form>
    </ModalShell>
  );
};

const LinkModal: React.FC<{
  state: LinkModalState;
  onClose: () => void;
  searchTerm: string;
  setSearchTerm: (value: string) => void;
  results: Actor[];
  isSearching: boolean;
  onLink: (actorId: string) => void;
}> = ({ state, onClose, searchTerm, setSearchTerm, results, isSearching, onLink }) => {
  if (!state.open || !state.actor) return null;

  return (
    <ModalShell title="Link to Existing Actor" onClose={onClose}>
      <div className="space-y-3">
        <p className="text-sm text-slate-600">
          Select an existing actor to link <span className="font-semibold">@{state.actor.detected_username}</span>.
        </p>
        <input
          value={searchTerm}
          onChange={event => setSearchTerm(event.target.value)}
          placeholder="Search by name, city, or state"
          className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
        />
        <div className="max-h-64 overflow-y-auto rounded-lg border border-slate-200 bg-white">
          {isSearching ? (
            <div className="flex items-center justify-center py-6">
              <LoadingState message="Searching actors" />
            </div>
          ) : results.length === 0 ? (
            <div className="px-4 py-6 text-sm text-slate-500">No matching actors yet.</div>
          ) : (
            <ul className="divide-y divide-slate-200 text-sm">
              {results.map(actor => (
                <li key={actor.id} className="flex items-center justify-between px-4 py-3">
                  <div>
                    <div className="font-semibold text-slate-900">{actor.name}</div>
                    <div className="text-xs text-slate-500">
                      {[actor.city, actor.state].filter(Boolean).join(', ') || 'Location —'}
                    </div>
                  </div>
                  <button
                    onClick={() => onLink(actor.id)}
                    className="rounded-md bg-blue-600 px-3 py-1 text-xs font-semibold text-white shadow-sm transition hover:bg-blue-500"
                  >
                    Link
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </ModalShell>
  );
};

const ModalShell: React.FC<{
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}> = ({ title, onClose, children }) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/25 backdrop-blur-sm">
    <div className="relative w-[min(600px,94vw)] rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
        <button
          onClick={onClose}
          className="rounded-md border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-600 transition hover:border-slate-400 hover:text-slate-900"
        >
          Close
        </button>
      </div>
      {children}
    </div>
  </div>
);
