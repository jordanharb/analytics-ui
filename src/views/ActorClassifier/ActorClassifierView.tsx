import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  fetchClassifierViews,
  fetchUnknownActors,
  fetchUnknownActorById,
  fetchOrganizations,
  fetchPersonRoleCategories,
  fetchRelationshipLookups,
  createActorLinks,
  fetchFieldExistingValues,
  fetchFieldMappings,
  linkUnknownActor,
  promoteUnknownActor,
  searchExistingActors,
} from '../../api/actorClassifierService';
import type {
  ClassifierView,
  FieldMapping,
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

interface PromoteModalProps {
  state: PromoteModalState;
  onClose: () => void;
  onPromote: (payload: {
    actorType: string;
    actorName: string;
    city?: string;
    state?: string;
    fields?: Record<string, any>;
    links?: PromoteLinkInput[];
  }) => void;
  organizations: Array<Pick<Actor, 'id' | 'name'>>;
  roleCategories: string[];
  relationshipLookups: {
    relationships: string[];
    roles: string[];
    roleCategories: string[];
  };
}

interface LinkModalProps {
  state: LinkModalState;
  onClose: () => void;
  searchTerm: string;
  setSearchTerm: (value: string) => void;
  results: Actor[];
  isSearching: boolean;
  onLink: (actorId: string) => void;
  typeFilter: 'all' | 'person' | 'organization' | 'chapter';
  setTypeFilter: (value: 'all' | 'person' | 'organization' | 'chapter') => void;
  advancedOpen: boolean;
  setAdvancedOpen: (open: boolean) => void;
  advancedFilters: typeof defaultLinkAdvancedFilters;
  setAdvancedFilters: (filters: typeof defaultLinkAdvancedFilters) => void;
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

const mappingKey = (mapping: FieldMapping) =>
  (mapping.column_name ?? mapping.field_name).toLowerCase().replace(/[^a-z0-9_]+/g, '_');

const deriveDefaultValue = (
  mapping: FieldMapping,
  actor: UnknownActor,
  location: { city: string; state: string },
) => {
  const name = mapping.field_name.toLowerCase();
  const dataType = mapping.data_type?.toLowerCase?.() ?? 'text';

  if (name.includes('name')) {
    return actor.profile_displayname ?? actor.detected_username ?? '';
  }
  if (name.includes('bio') || name.includes('about')) {
    return actor.profile_bio ?? '';
  }
  if (name.includes('city')) {
    return location.city;
  }
  if (name.includes('state')) {
    return location.state;
  }
  if (name.includes('platform')) {
    return actor.platform ?? '';
  }

  if (dataType === 'boolean') {
    return false;
  }

  return '';
};

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

const createMetadataId = () =>
  typeof window !== 'undefined' && window.crypto && 'randomUUID' in window.crypto
    ? window.crypto.randomUUID()
    : `meta-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

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
      setLinkAdvancedFilters({ ...defaultLinkAdvancedFilters });
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
        organizations={organizations}
        roleCategories={roleCategories}
        relationshipLookups={relationshipLookups}
      />
      <LinkModal
        state={linkModal}
        onClose={() => setLinkModal({ open: false })}
        searchTerm={linkSearchTerm}
        setSearchTerm={setLinkSearchTerm}
        results={linkResults}
        isSearching={linkIsSearching}
        onLink={linkActor}
        typeFilter={linkTypeFilter}
        setTypeFilter={setLinkTypeFilter}
        advancedOpen={linkAdvancedOpen}
        setAdvancedOpen={setLinkAdvancedOpen}
        advancedFilters={linkAdvancedFilters}
        setAdvancedFilters={filters => setLinkAdvancedFilters(filters)}
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


const PromoteModal: React.FC<PromoteModalProps> = ({
  state,
  onClose,
  onPromote,
  organizations,
  roleCategories,
  relationshipLookups,
}) => {
  const actor = state.actor;
  const [actorType, setActorType] = useState<'person' | 'organization' | 'chapter'>('person');
  const [personForm, setPersonForm] = useState<PersonFormState>({
    fullName: '',
    presentRole: '',
    roleCategory: '',
    city: '',
    state: '',
    about: '',
    isTpusaStaff: false,
    isTpusaAffiliated: false,
    primaryOrganizationId: '',
  });
  const [organizationForm, setOrganizationForm] = useState<OrganizationFormState>({
    name: '',
    type: 'external',
    summaryFocus: '',
    regionScope: '',
    isTpusa: false,
  });
  const [chapterForm, setChapterForm] = useState<ChapterFormState>({
    name: '',
    schoolType: 'college',
    city: '',
    stateCode: '',
    active: true,
  });
  const baseColumnKeys = useMemo(
    () =>
      new Set([
        'present_role',
        'role_category',
        'primary_organization_id',
        'about',
        'type',
        'summary_focus',
        'region_scope',
        'is_tpusa',
        'school_type',
        'state_code',
        'active',
      ]),
    [],
  );
  const [fieldMappings, setFieldMappings] = useState<FieldMapping[]>([]);
  const [fieldOptions, setFieldOptions] = useState<Record<string, string[]>>({});
  const [dynamicValues, setDynamicValues] = useState<Record<string, any>>({});
  const [dynamicLoading, setDynamicLoading] = useState(false);
  const [dynamicError, setDynamicError] = useState<string | null>(null);
  const [linkingEnabled, setLinkingEnabled] = useState(false);
  const [linkSearchTerm, setLinkSearchTerm] = useState('');
  const [linkSearchResults, setLinkSearchResults] = useState<Actor[]>([]);
  const [linkSelections, setLinkSelections] = useState<LinkSelection[]>([]);
  const [linkIsSearching, setLinkIsSearching] = useState(false);

  useEffect(() => {
    if (state.open) {
      setActorType('person');
    }
  }, [state.open]);

  useEffect(() => {
    if (!state.open || !actor) return;
    const location = parseLocationFromUnknownActor(actor);
    if (actorType === 'person') {
      setPersonForm({
        fullName: actor.profile_displayname ?? actor.detected_username ?? '',
        presentRole: '',
        roleCategory: '',
        city: location.city,
        state: location.state,
        about: actor.profile_bio ?? '',
        isTpusaStaff: false,
        isTpusaAffiliated: false,
        primaryOrganizationId: '',
      });
    } else if (actorType === 'organization') {
      setOrganizationForm({
        name: actor.profile_displayname ?? actor.detected_username ?? '',
        type: 'external',
        summaryFocus: actor.profile_bio ?? '',
        regionScope: '',
        isTpusa: false,
      });
    } else {
      setChapterForm({
        name: actor.profile_displayname ?? actor.detected_username ?? '',
        schoolType: 'college',
        city: location.city,
        stateCode: location.state ? location.state.slice(0, 2).toUpperCase() : '',
        active: true,
      });
    }
    setLinkingEnabled(false);
    setLinkSearchTerm('');
    setLinkSearchResults([]);
    setLinkSelections([]);
  }, [actorType, state.open, actor]);

  useEffect(() => {
    if (!state.open || !actor) return;
    let cancelled = false;

    const loadMappings = async () => {
      setDynamicLoading(true);
      setDynamicError(null);
      try {
        const mappings = await fetchFieldMappings(actorType);
        if (cancelled) return;
        const filtered = mappings.filter(mapping => {
          const key = (mapping.column_name ?? '').toLowerCase();
          return !baseColumnKeys.has(key);
        });
        setFieldMappings(filtered);
        const defaults: Record<string, any> = {};
        const location = parseLocationFromUnknownActor(actor);
        filtered.forEach(mapping => {
          const key = mappingKey(mapping);
          defaults[key] = deriveDefaultValue(mapping, actor, location);
        });
        setDynamicValues(defaults);
        const optionEntries = await Promise.all(
          filtered
            .filter(mapping => mapping.is_indexed && mapping.column_name)
            .map(async mapping => {
              try {
                const values = await fetchFieldExistingValues(mapping.column_name!);
                return [mappingKey(mapping), values] as const;
              } catch (error) {
                console.error('Failed to load existing values for', mapping.column_name, error);
                return [mappingKey(mapping), []] as const;
              }
            }),
        );
        if (!cancelled) {
          const options: Record<string, string[]> = {};
          optionEntries.forEach(([key, values]) => {
            options[key] = values as string[];
          });
          setFieldOptions(options);
        }
      } catch (error) {
        console.error('Failed to load field mappings', error);
        if (!cancelled) {
          setDynamicError('Unable to load additional fields for this actor type.');
          setFieldMappings([]);
          setFieldOptions({});
          setDynamicValues({});
        }
      } finally {
        if (!cancelled) {
          setDynamicLoading(false);
        }
      }
    };

    loadMappings();

    return () => {
      cancelled = true;
    };
  }, [state.open, actorType, actor, baseColumnKeys]);

  useEffect(() => {
    if (!linkingEnabled) {
      setLinkIsSearching(false);
      setLinkSearchTerm('');
      setLinkSearchResults([]);
      return;
    }

    const term = linkSearchTerm.trim();
    if (term.length < 2) {
      setLinkSearchResults([]);
      setLinkIsSearching(false);
      return;
    }

    let cancelled = false;
    setLinkIsSearching(true);
    const handler = setTimeout(async () => {
      try {
        const selectedIds = new Set(linkSelections.map(selection => selection.actor.id));
        const results = await searchExistingActors(term, { limit: MAX_LINK_SEARCH_RESULTS });
        if (!cancelled) {
          setLinkSearchResults(results.filter(result => !selectedIds.has(result.id)));
        }
      } catch (error) {
        if (!cancelled) {
          console.error('Failed to search actors for linking', error);
          setLinkSearchResults([]);
        }
      } finally {
        if (!cancelled) {
          setLinkIsSearching(false);
        }
      }
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(handler);
    };
  }, [linkingEnabled, linkSearchTerm, linkSelections]);

  const handleAddLinkSelection = (actorToAdd: Actor) => {
    setLinkSelections(prev => {
      if (prev.some(selection => selection.actor.id === actorToAdd.id)) {
        return prev;
      }
      return [
        ...prev,
        {
          actor: {
            id: actorToAdd.id,
            name: actorToAdd.name ?? 'Unnamed Actor',
            actor_type: actorToAdd.actor_type ?? 'unknown',
            city: actorToAdd.city ?? '',
            state: actorToAdd.state ?? '',
          },
          relationship: '',
          role: '',
          roleCategory: '',
          isPrimary: false,
          startDate: '',
          endDate: '',
          metadata: [],
        },
      ];
    });
    setLinkSearchResults(prev => prev.filter(item => item.id !== actorToAdd.id));
    setLinkSearchTerm('');
  };

  const handleRemoveLinkSelection = (actorId: string) => {
    setLinkSelections(prev => prev.filter(selection => selection.actor.id !== actorId));
  };

  const handleSelectionFieldChange = <K extends keyof Omit<LinkSelection, 'actor' | 'metadata'>>(
    index: number,
    key: K,
    value: LinkSelection[K],
  ) => {
    setLinkSelections(prev =>
      prev.map((selection, idx) => (idx === index ? { ...selection, [key]: value } : selection)),
    );
  };

  const handleMetadataChange = (
    selectionIndex: number,
    metadataId: string,
    field: 'key' | 'value',
    value: string,
  ) => {
    setLinkSelections(prev =>
      prev.map((selection, idx) => {
        if (idx !== selectionIndex) return selection;
        return {
          ...selection,
          metadata: selection.metadata.map(entry =>
            entry.id === metadataId ? { ...entry, [field]: value } : entry,
          ),
        };
      }),
    );
  };

  const handleAddMetadata = (selectionIndex: number) => {
    setLinkSelections(prev =>
      prev.map((selection, idx) => {
        if (idx !== selectionIndex) return selection;
        if (selection.metadata.length >= MAX_LINK_METADATA) return selection;
        return {
          ...selection,
          metadata: [...selection.metadata, { id: createMetadataId(), key: '', value: '' }],
        };
      }),
    );
  };

  const handleRemoveMetadata = (selectionIndex: number, metadataId: string) => {
    setLinkSelections(prev =>
      prev.map((selection, idx) => {
        if (idx !== selectionIndex) return selection;
        return {
          ...selection,
          metadata: selection.metadata.filter(entry => entry.id !== metadataId),
        };
      }),
    );
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!actor) return;

    let actorNameValue = '';
    let cityValue: string | undefined;
    let stateValue: string | undefined;
    const fields: Record<string, any> = {};

    if (actorType === 'person') {
      actorNameValue =
        personForm.fullName.trim() ||
        actor.profile_displayname ||
        actor.detected_username ||
        'Unnamed Person';
      cityValue = personForm.city.trim() || undefined;
      stateValue = personForm.state.trim() || undefined;
      fields.present_role = personForm.presentRole.trim() || null;
      fields.role_category = personForm.roleCategory.trim() || null;
      fields.primary_organization_id = personForm.primaryOrganizationId || null;
      fields.about = personForm.about.trim() || null;
      fields.is_tpusa_staff = personForm.isTpusaStaff;
      fields.is_tpusa_affiliated = personForm.isTpusaAffiliated;
    } else if (actorType === 'organization') {
      actorNameValue =
        organizationForm.name.trim() ||
        actor.profile_displayname ||
        actor.detected_username ||
        'Unnamed Organization';
      cityValue = undefined;
      stateValue = undefined;
      fields.type = organizationForm.type || null;
      fields.summary_focus = organizationForm.summaryFocus.trim() || null;
      fields.region_scope = organizationForm.regionScope.trim() || null;
      fields.is_tpusa = organizationForm.isTpusa;
    } else {
      actorNameValue =
        chapterForm.name.trim() ||
        actor.profile_displayname ||
        actor.detected_username ||
        'Unnamed Chapter';
      cityValue = chapterForm.city.trim() || undefined;
      stateValue = chapterForm.stateCode.trim()
        ? chapterForm.stateCode.trim().toUpperCase()
        : undefined;
      fields.school_type = chapterForm.schoolType || null;
      fields.state_code = chapterForm.stateCode.trim().toUpperCase() || null;
      fields.active = chapterForm.active;
    }

    fieldMappings.forEach(mapping => {
      const key = mappingKey(mapping);
      const payloadKey = mapping.column_name ?? key;
      const rawValue = dynamicValues[key];
      if (rawValue === undefined || rawValue === '') {
        return;
      }
      const dataType = mapping.data_type?.toLowerCase?.() ?? 'text';
      if (dataType === 'numeric') {
        const numeric = Number(rawValue);
        if (!Number.isNaN(numeric)) {
          fields[payloadKey] = numeric;
        }
        return;
      }
      if (dataType === 'boolean') {
        fields[payloadKey] = Boolean(rawValue);
        return;
      }
      fields[payloadKey] = typeof rawValue === 'string' ? rawValue.trim() : rawValue;
    });

    const cleanedFields = Object.fromEntries(
      Object.entries(fields).filter(([_, value]) => value !== undefined && value !== ''),
    );

    const links =
      linkingEnabled && linkSelections.length > 0
        ? linkSelections
            .map(selection => {
              const metadata = selection.metadata.reduce<Record<string, string>>((acc, entry) => {
                const key = entry.key.trim();
                const value = entry.value.trim();
                if (key && value) {
                  acc[key] = value;
                }
                return acc;
              }, {});
              return {
                toActorId: selection.actor.id,
                relationship: selection.relationship.trim() || undefined,
                role: selection.role.trim() || undefined,
                roleCategory: selection.roleCategory.trim() || undefined,
                isPrimary: selection.isPrimary ? true : undefined,
                startDate: selection.startDate || undefined,
                endDate: selection.endDate || undefined,
                metadata: Object.keys(metadata).length ? metadata : undefined,
              };
            })
            .filter(link => link.toActorId)
        : undefined;

    onPromote({
      actorType,
      actorName: actorNameValue,
      city: cityValue,
      state: stateValue,
      fields: Object.keys(cleanedFields).length ? cleanedFields : undefined,
      links: links && links.length ? links : undefined,
    });
  };

  const renderPersonFields = () => (
    <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
      <div className="space-y-1">
        <label className="text-xs font-semibold uppercase tracking-wide text-slate-500" htmlFor="promote-person-name">
          Full Name
        </label>
        <input
          id="promote-person-name"
          type="text"
          className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
          value={personForm.fullName}
          onChange={event => setPersonForm(prev => ({ ...prev, fullName: event.target.value }))}
          placeholder="Full name"
        />
      </div>
      <div className="space-y-1">
        <label className="text-xs font-semibold uppercase tracking-wide text-slate-500" htmlFor="promote-person-role">
          Present Role
        </label>
        <input
          id="promote-person-role"
          type="text"
          className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
          value={personForm.presentRole}
          onChange={event => setPersonForm(prev => ({ ...prev, presentRole: event.target.value }))}
          placeholder="Role or title"
        />
      </div>
      <div className="space-y-1">
        <label className="text-xs font-semibold uppercase tracking-wide text-slate-500" htmlFor="promote-person-role-category">
          Role Category
        </label>
        <input
          id="promote-person-role-category"
          type="text"
          list="promote-person-role-categories"
          className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
          value={personForm.roleCategory}
          onChange={event => setPersonForm(prev => ({ ...prev, roleCategory: event.target.value }))}
          placeholder="Category or segment"
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-500" htmlFor="promote-person-city">
            City
          </label>
          <input
            id="promote-person-city"
            type="text"
            className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
            value={personForm.city}
            onChange={event => setPersonForm(prev => ({ ...prev, city: event.target.value }))}
            placeholder="City"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-500" htmlFor="promote-person-state">
            State
          </label>
          <input
            id="promote-person-state"
            type="text"
            className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
            value={personForm.state}
            onChange={event => setPersonForm(prev => ({ ...prev, state: event.target.value }))}
            placeholder="State"
          />
        </div>
      </div>
      <div className="space-y-1">
        <label className="text-xs font-semibold uppercase tracking-wide text-slate-500" htmlFor="promote-person-about">
          About
        </label>
        <textarea
          id="promote-person-about"
          className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
          rows={3}
          value={personForm.about}
          onChange={event => setPersonForm(prev => ({ ...prev, about: event.target.value }))}
          placeholder="Short biography or description"
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={personForm.isTpusaStaff}
            onChange={event => setPersonForm(prev => ({ ...prev, isTpusaStaff: event.target.checked }))}
          />
          TPUSA Staff
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={personForm.isTpusaAffiliated}
            onChange={event => setPersonForm(prev => ({ ...prev, isTpusaAffiliated: event.target.checked }))}
          />
          TPUSA Affiliated
        </label>
      </div>
      <div className="space-y-1">
        <label className="text-xs font-semibold uppercase tracking-wide text-slate-500" htmlFor="promote-person-primary-org">
          Primary Organization (optional)
        </label>
        <select
          id="promote-person-primary-org"
          className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
          value={personForm.primaryOrganizationId}
          onChange={event => setPersonForm(prev => ({ ...prev, primaryOrganizationId: event.target.value }))}
        >
          <option value="">Select organization…</option>
          {organizations.map(org => (
            <option key={org.id} value={org.id}>
              {org.name ?? 'Unnamed Organization'}
            </option>
          ))}
        </select>
      </div>
    </div>
  );

  const renderOrganizationFields = () => (
    <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
      <div className="space-y-1">
        <label className="text-xs font-semibold uppercase tracking-wide text-slate-500" htmlFor="promote-org-name">
          Organization Name
        </label>
        <input
          id="promote-org-name"
          type="text"
          className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
          value={organizationForm.name}
          onChange={event => setOrganizationForm(prev => ({ ...prev, name: event.target.value }))}
          placeholder="Organization name"
        />
      </div>
      <div className="space-y-1">
        <label className="text-xs font-semibold uppercase tracking-wide text-slate-500" htmlFor="promote-org-type">
          Organization Type
        </label>
        <select
          id="promote-org-type"
          className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
          value={organizationForm.type}
          onChange={event => setOrganizationForm(prev => ({ ...prev, type: event.target.value }))}
        >
          <option value="external">External</option>
          <option value="tpusa">TPUSA</option>
          <option value="affiliate">Affiliate</option>
        </select>
      </div>
      <div className="space-y-1">
        <label className="text-xs font-semibold uppercase tracking-wide text-slate-500" htmlFor="promote-org-summary">
          Summary / Focus
        </label>
        <textarea
          id="promote-org-summary"
          className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
          rows={3}
          value={organizationForm.summaryFocus}
          onChange={event => setOrganizationForm(prev => ({ ...prev, summaryFocus: event.target.value }))}
          placeholder="Brief description"
        />
      </div>
      <div className="space-y-1">
        <label className="text-xs font-semibold uppercase tracking-wide text-slate-500" htmlFor="promote-org-region">
          Region Scope
        </label>
        <input
          id="promote-org-region"
          type="text"
          className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
          value={organizationForm.regionScope}
          onChange={event => setOrganizationForm(prev => ({ ...prev, regionScope: event.target.value }))}
          placeholder="Local, regional, national…"
        />
      </div>
      <label className="flex items-center gap-2 text-sm text-slate-600">
        <input
          type="checkbox"
          className="h-4 w-4"
          checked={organizationForm.isTpusa}
          onChange={event => setOrganizationForm(prev => ({ ...prev, isTpusa: event.target.checked }))}
        />
        TPUSA Organization
      </label>
    </div>
  );

  const renderChapterFields = () => (
    <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
      <div className="space-y-1">
        <label className="text-xs font-semibold uppercase tracking-wide text-slate-500" htmlFor="promote-chapter-name">
          Chapter Name
        </label>
        <input
          id="promote-chapter-name"
          type="text"
          className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
          value={chapterForm.name}
          onChange={event => setChapterForm(prev => ({ ...prev, name: event.target.value }))}
          placeholder="Chapter name"
        />
      </div>
      <div className="space-y-1">
        <label className="text-xs font-semibold uppercase tracking-wide text-slate-500" htmlFor="promote-chapter-school-type">
          School Type
        </label>
        <select
          id="promote-chapter-school-type"
          className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
          value={chapterForm.schoolType}
          onChange={event => setChapterForm(prev => ({ ...prev, schoolType: event.target.value }))}
        >
          <option value="college">College</option>
          <option value="high_school">High School</option>
        </select>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-500" htmlFor="promote-chapter-city">
            City
          </label>
          <input
            id="promote-chapter-city"
            type="text"
            className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
            value={chapterForm.city}
            onChange={event => setChapterForm(prev => ({ ...prev, city: event.target.value }))}
            placeholder="City"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-500" htmlFor="promote-chapter-state">
            State Code
          </label>
          <input
            id="promote-chapter-state"
            type="text"
            maxLength={2}
            className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
            value={chapterForm.stateCode}
            onChange={event =>
              setChapterForm(prev => ({ ...prev, stateCode: event.target.value.toUpperCase() }))
            }
            placeholder="e.g., AZ"
          />
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm text-slate-600">
        <input
          type="checkbox"
          className="h-4 w-4"
          checked={chapterForm.active}
          onChange={event => setChapterForm(prev => ({ ...prev, active: event.target.checked }))}
        />
        Active Chapter
      </label>
    </div>
  );

  const renderDynamicField = (mapping: FieldMapping) => {
    const key = mappingKey(mapping);
    const dataType = mapping.data_type?.toLowerCase?.() ?? 'text';
    const value = dynamicValues[key];
    const options = fieldOptions[key] ?? [];
    const listId = options.length ? `${key}-options` : undefined;
    const inputId = `dynamic-${key}`;

    if (dataType === 'boolean') {
      return (
        <label
          key={key}
          className="flex items-center justify-between rounded border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600"
        >
          <span>{mapping.field_name}</span>
          <input
            id={inputId}
            type="checkbox"
            className="h-4 w-4"
            checked={Boolean(value)}
            onChange={event =>
              setDynamicValues(prev => ({ ...prev, [key]: event.target.checked }))
            }
          />
        </label>
      );
    }

    const commonProps = {
      id: inputId,
      className:
        'mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200',
      value: value ?? '',
      onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
        setDynamicValues(prev => ({ ...prev, [key]: event.target.value })),
    };

    if (dataType === 'text' && mapping.field_name.toLowerCase().includes('about')) {
      return (
        <div key={key} className="space-y-1">
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-500" htmlFor={inputId}>
            {mapping.field_name}
          </label>
          <textarea {...commonProps} rows={3} />
          {listId && (
            <datalist id={listId}>
              {options.map(option => (
                <option key={option} value={option} />
              ))}
            </datalist>
          )}
        </div>
      );
    }

    const inputType =
      dataType === 'numeric' ? 'number' : dataType === 'date' ? 'date' : 'text';

    return (
      <div key={key} className="space-y-1">
        <label className="text-xs font-semibold uppercase tracking-wide text-slate-500" htmlFor={inputId}>
          {mapping.field_name}
        </label>
        <input {...commonProps} type={inputType} list={listId} />
        {listId && (
          <datalist id={listId}>
            {options.map(option => (
              <option key={option} value={option} />
            ))}
          </datalist>
        )}
      </div>
    );
  };

  const renderDynamicFields = () => {
    if (dynamicLoading) {
      return (
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <LoadingState message="Loading additional fields" />
        </div>
      );
    }
    if (dynamicError) {
      return (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-700">
          {dynamicError}
        </div>
      );
    }
    if (fieldMappings.length === 0) {
      return null;
    }
    return (
      <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Additional Fields</h3>
        <div className="space-y-3">
          {fieldMappings.map(mapping => renderDynamicField(mapping))}
        </div>
      </div>
    );
  };

  const renderLinkingSection = () => (
    <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
      <div className="space-y-1">
        <label className="text-xs font-semibold uppercase tracking-wide text-slate-500" htmlFor="promote-link-search">
          Search Existing Actors
        </label>
        <input
          id="promote-link-search"
          type="search"
          className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
          placeholder="Search by name, city, or state"
          value={linkSearchTerm}
          onChange={event => setLinkSearchTerm(event.target.value)}
        />
      </div>
      {linkIsSearching && <LoadingState message="Searching actors" />}
      {!linkIsSearching && linkSearchResults.length > 0 && (
        <div className="space-y-2">
          {linkSearchResults.map(result => (
            <div
              key={result.id}
              className="flex items-center justify-between rounded border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600"
            >
              <div>
                <div className="font-medium text-slate-800">{result.name ?? 'Unnamed Actor'}</div>
                <div className="text-xs text-slate-500">
                  {[result.actor_type, [result.city, result.state].filter(Boolean).join(', ')].filter(Boolean).join(' • ') || '—'}
                </div>
              </div>
              <button
                type="button"
                className="rounded-md bg-blue-600 px-3 py-1 text-xs font-semibold text-white shadow-sm transition hover:bg-blue-500"
                onClick={() => handleAddLinkSelection(result)}
              >
                Add
              </button>
            </div>
          ))}
        </div>
      )}
      {linkSelections.length > 0 && (
        <div className="space-y-3">
          {linkSelections.map((selection, index) => (
            <div key={selection.actor.id} className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-semibold text-slate-900">{selection.actor.name ?? 'Unnamed Actor'}</div>
                  <div className="text-xs text-slate-500">
                    {[selection.actor.actor_type, [selection.actor.city, selection.actor.state].filter(Boolean).join(', ')].filter(Boolean).join(' • ') || '—'}
                  </div>
                </div>
                <button
                  type="button"
                  className="text-xs font-semibold text-rose-600 transition hover:text-rose-700"
                  onClick={() => handleRemoveLinkSelection(selection.actor.id)}
                >
                  Remove
                </button>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="text-xs font-semibold uppercase tracking-wide text-slate-500" htmlFor={`link-relationship-${index}`}>
                    Relationship
                  </label>
                  <input
                    id={`link-relationship-${index}`}
                    type="text"
                    list="promote-relationship-types"
                    className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                    value={selection.relationship}
                    onChange={event => handleSelectionFieldChange(index, 'relationship', event.target.value)}
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold uppercase tracking-wide text-slate-500" htmlFor={`link-role-${index}`}>
                    Role
                  </label>
                  <input
                    id={`link-role-${index}`}
                    type="text"
                    list="promote-link-roles"
                    className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                    value={selection.role}
                    onChange={event => handleSelectionFieldChange(index, 'role', event.target.value)}
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold uppercase tracking-wide text-slate-500" htmlFor={`link-role-category-${index}`}>
                    Role Category
                  </label>
                  <input
                    id={`link-role-category-${index}`}
                    type="text"
                    list="promote-link-role-categories"
                    className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                    value={selection.roleCategory}
                    onChange={event => handleSelectionFieldChange(index, 'roleCategory', event.target.value)}
                  />
                </div>
                <label className="mt-5 flex items-center gap-2 text-xs font-medium text-slate-600">
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    checked={selection.isPrimary}
                    onChange={event => handleSelectionFieldChange(index, 'isPrimary', event.target.checked)}
                  />
                  Primary Relationship
                </label>
                <div>
                  <label className="text-xs font-semibold uppercase tracking-wide text-slate-500" htmlFor={`link-start-${index}`}>
                    Start Date
                  </label>
                  <input
                    id={`link-start-${index}`}
                    type="date"
                    className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                    value={selection.startDate}
                    onChange={event => handleSelectionFieldChange(index, 'startDate', event.target.value)}
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold uppercase tracking-wide text-slate-500" htmlFor={`link-end-${index}`}>
                    End Date
                  </label>
                  <input
                    id={`link-end-${index}`}
                    type="date"
                    className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                    value={selection.endDate}
                    onChange={event => handleSelectionFieldChange(index, 'endDate', event.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Metadata</span>
                  {selection.metadata.length < MAX_LINK_METADATA && (
                    <button
                      type="button"
                      className="text-xs font-semibold text-blue-600 transition hover:text-blue-500"
                      onClick={() => handleAddMetadata(index)}
                    >
                      + Add Metadata
                    </button>
                  )}
                </div>
                {selection.metadata.length === 0 ? (
                  <p className="text-xs text-slate-500">No metadata added.</p>
                ) : (
                  selection.metadata.map(entry => (
                    <div key={entry.id} className="grid grid-cols-[1fr_1fr_auto] gap-2">
                      <input
                        type="text"
                        placeholder="Key"
                        className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                        value={entry.key}
                        onChange={event => handleMetadataChange(index, entry.id, 'key', event.target.value)}
                      />
                      <input
                        type="text"
                        placeholder="Value"
                        className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                        value={entry.value}
                        onChange={event => handleMetadataChange(index, entry.id, 'value', event.target.value)}
                      />
                      <button
                        type="button"
                        className="text-xs font-semibold text-rose-600 transition hover:text-rose-700"
                        onClick={() => handleRemoveMetadata(index, entry.id)}
                      >
                        Remove
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  if (!state.open || !actor) return null;

  return (
    <ModalShell title="Promote Unknown Actor" onClose={onClose}>
      <form className="space-y-6" onSubmit={handleSubmit}>
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
                onClick={() => setActorType(type.id as 'person' | 'organization' | 'chapter')}
              >
                {type.label}
              </button>
            ))}
          </div>
        </div>

        {actorType === 'person' && renderPersonFields()}
        {actorType === 'organization' && renderOrganizationFields()}
        {actorType === 'chapter' && renderChapterFields()}

        {renderDynamicFields()}

        <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-4">
          <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={linkingEnabled}
              onChange={event => setLinkingEnabled(event.target.checked)}
            />
            Link this {actorType} to other actors
          </label>
          {linkingEnabled && renderLinkingSection()}
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-600 transition hover:border-slate-400 hover:text-slate-900"
            onClick={onClose}
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
      <datalist id="promote-person-role-categories">
        {roleCategories.map(category => (
          <option key={category} value={category} />
        ))}
      </datalist>
      <datalist id="promote-relationship-types">
        {relationshipLookups.relationships.map(relationship => (
          <option key={relationship} value={relationship} />
        ))}
      </datalist>
      <datalist id="promote-link-roles">
        {relationshipLookups.roles.map(role => (
          <option key={role} value={role} />
        ))}
      </datalist>
      <datalist id="promote-link-role-categories">
        {relationshipLookups.roleCategories.map(roleCategory => (
          <option key={roleCategory} value={roleCategory} />
        ))}
      </datalist>
    </ModalShell>
  );
};

const LinkModal: React.FC<LinkModalProps> = ({
  state,
  onClose,
  searchTerm,
  setSearchTerm,
  results,
  isSearching,
  onLink,
  typeFilter,
  setTypeFilter,
  advancedOpen,
  setAdvancedOpen,
  advancedFilters,
  setAdvancedFilters,
}) => {
  if (!state.open || !state.actor) return null;

  const actor = state.actor;
  const followerCount = actor.follower_count ?? 0;
  const location = actor.profile_location ?? 'Not specified';
  const hasAdvancedFilters = Object.values(advancedFilters).some(value => value.trim() !== '');
  const typeOptions: Array<{ id: 'all' | 'person' | 'organization' | 'chapter'; label: string; icon: string }> = [
    { id: 'all', label: 'All Types', icon: '🌐' },
    { id: 'person', label: 'People', icon: '👤' },
    { id: 'organization', label: 'Organizations', icon: '🏢' },
    { id: 'chapter', label: 'Chapters', icon: '🏫' },
  ];

  const handleAdvancedChange = (field: keyof typeof defaultLinkAdvancedFilters, value: string) => {
    setAdvancedFilters({ ...advancedFilters, [field]: value });
  };

  const handleAdvancedClear = () => {
    setAdvancedFilters({ ...defaultLinkAdvancedFilters });
  };

  return (
    <ModalShell title="Link to Existing Actor" onClose={onClose}>
      <div className="space-y-4">
        <section className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
          <h3 className="text-base font-semibold text-slate-900">@{actor.detected_username}</h3>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <div><strong>Platform:</strong> {actor.platform ?? 'Unknown'}</div>
            <div><strong>Display Name:</strong> {actor.profile_displayname ?? '—'}</div>
            <div><strong>Followers:</strong> {followerCount.toLocaleString()}</div>
            <div><strong>Location:</strong> {location || 'Not specified'}</div>
            <div><strong>Mentions:</strong> {(actor.mention_count ?? 0).toLocaleString()}</div>
            <div><strong>Posts:</strong> {(actor.author_count ?? 0).toLocaleString()}</div>
            <div className="col-span-2">
              <strong>Bio:</strong> {actor.profile_bio ?? 'No bio available'}
            </div>
          </div>
        </section>

        <div className="flex flex-wrap gap-2">
          {typeOptions.map(option => (
            <button
              key={option.id}
              type="button"
              onClick={() => setTypeFilter(option.id)}
              className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                typeFilter === option.id
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'border border-slate-200 bg-white text-slate-600 hover:border-blue-400 hover:text-blue-600'
              }`}
            >
              <span className="mr-2">{option.icon}</span>
              {option.label}
            </button>
          ))}
        </div>

        <div className="space-y-2">
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-500" htmlFor="link-modal-search">
            Quick Search
          </label>
          <input
            id="link-modal-search"
            type="search"
            value={searchTerm}
            onChange={event => setSearchTerm(event.target.value)}
            placeholder="Search by name, city, or state"
            className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
          />
          <button
            type="button"
            className="text-xs font-semibold text-blue-600 transition hover:text-blue-500"
            onClick={() => setAdvancedOpen(!advancedOpen)}
          >
            {advancedOpen ? 'Hide Advanced Filters' : 'Advanced Filters'}
          </button>
        </div>

        {advancedOpen && (
          <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-500" htmlFor="link-advanced-name">
                  Name
                </label>
                <input
                  id="link-advanced-name"
                  type="text"
                  value={advancedFilters.name}
                  onChange={event => handleAdvancedChange('name', event.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                  placeholder="Actor name…"
                />
              </div>
              <div>
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-500" htmlFor="link-advanced-about">
                  About/Bio
                </label>
                <input
                  id="link-advanced-about"
                  type="text"
                  value={advancedFilters.about}
                  onChange={event => handleAdvancedChange('about', event.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                  placeholder="Keywords…"
                />
              </div>
              <div>
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-500" htmlFor="link-advanced-city">
                  City
                </label>
                <input
                  id="link-advanced-city"
                  type="text"
                  value={advancedFilters.city}
                  onChange={event => handleAdvancedChange('city', event.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                  placeholder="City…"
                />
              </div>
              <div>
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-500" htmlFor="link-advanced-state">
                  State
                </label>
                <input
                  id="link-advanced-state"
                  type="text"
                  value={advancedFilters.state}
                  onChange={event => handleAdvancedChange('state', event.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                  placeholder="State…"
                />
              </div>
              <div>
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-500" htmlFor="link-advanced-region">
                  Region
                </label>
                <input
                  id="link-advanced-region"
                  type="text"
                  value={advancedFilters.region}
                  onChange={event => handleAdvancedChange('region', event.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                  placeholder="Region…"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="rounded-md border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-600 transition hover:border-slate-400 hover:text-slate-900"
                onClick={handleAdvancedClear}
              >
                Clear Filters
              </button>
            </div>
          </div>
        )}

        <div className="max-h-64 overflow-y-auto rounded-lg border border-slate-200 bg-white">
          {isSearching ? (
            <div className="flex items-center justify-center py-6">
              <LoadingState message="Searching actors" />
            </div>
          ) : results.length === 0 ? (
            <div className="px-4 py-6 text-sm text-slate-500">
              {searchTerm.trim() || hasAdvancedFilters
                ? 'No matching actors found.'
                : 'Enter a search term or apply advanced filters to find actors.'}
            </div>
          ) : (
            <ul className="divide-y divide-slate-200 text-sm">
              {results.map(result => (
                <li key={result.id} className="flex items-center justify-between px-4 py-3">
                  <div>
                    <div className="font-semibold text-slate-900">{result.name ?? 'Unnamed Actor'}</div>
                    <div className="text-xs text-slate-500">
                      {[result.actor_type, [result.city, result.state].filter(Boolean).join(', ')].filter(Boolean).join(' • ') || '—'}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="rounded-md bg-blue-600 px-3 py-1 text-xs font-semibold text-white shadow-sm transition hover:bg-blue-500"
                    onClick={() => onLink(result.id)}
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
