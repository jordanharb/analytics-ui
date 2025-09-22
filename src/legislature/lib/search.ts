import { supabase2 } from '../../lib/supabase2';
import type { PersonSearchResult } from './types';

const toNumber = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const toNumberArray = (value: unknown): number[] => {
  if (!value) return [];

  const addIfNumber = (candidate: unknown, acc: Set<number>) => {
    const parsed = toNumber(candidate);
    if (parsed !== null) acc.add(parsed);
  };

  const result = new Set<number>();

  if (Array.isArray(value)) {
    value.forEach((item) => {
      if (typeof item === 'object' && item !== null) {
        if ('legislator_id' in item) addIfNumber((item as Record<string, unknown>).legislator_id, result);
        if ('entity_id' in item) addIfNumber((item as Record<string, unknown>).entity_id, result);
        if ('session_id' in item) addIfNumber((item as Record<string, unknown>).session_id, result);
      } else {
        addIfNumber(item, result);
      }
    });
    return Array.from(result);
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];

    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        parsed.forEach((item) => addIfNumber(item, result));
        return Array.from(result);
      }
    } catch {
      // fall through to delimiter parsing
    }

    const delimiters = trimmed.includes(',') ? ',' : trimmed.includes('|') ? '|' : null;
    if (delimiters) {
      trimmed.split(delimiters).forEach((token) => addIfNumber(token.trim(), result));
      return Array.from(result);
    }

    addIfNumber(trimmed, result);
    return Array.from(result);
  }

  if (typeof value === 'object' && value !== null) {
    if ('value' in value) addIfNumber((value as Record<string, unknown>).value, result);
  }

  return Array.from(result);
};

const firstString = (...candidates: unknown[]): string | null => {
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) return candidate.trim();
  }
  return null;
};

const buildSummary = (input: { entityCount: number; legislatorCount: number }): string => {
  const entityPart = `${input.entityCount} ${(input.entityCount === 1 ? 'entity' : 'entities')}`;
  const legislatorPart = `${input.legislatorCount} ${(input.legislatorCount === 1 ? 'legislator' : 'legislators')}`;
  return `${legislatorPart} • ${entityPart}`;
};

const normalizePeopleRows = (rows: unknown[] | null | undefined): PersonSearchResult[] => {
  if (!Array.isArray(rows)) return [];

  return rows
    .map((raw) => {
      const row = raw as Record<string, unknown>;

      const personId =
        toNumber(row.person_id) ??
        toNumber(row.personId) ??
        toNumber(row.id);

      if (personId === null) return null;

      const displayName =
        firstString(row.display_name, row.displayName, row.name, row.label) || `Person ${personId}`;

      const legislatorIds = toNumberArray(
        row.all_legislator_ids ??
          row.legislator_ids ??
          row.matching_legislator_ids ??
          row.matching_leg_ids ??
          row.rs_person_legislators,
      );

      const entityIds = toNumberArray(
        row.all_entity_ids ??
          row.entity_ids ??
          row.matching_entity_ids ??
          row.rs_person_cf_entities,
      );

      const sessionIds = toNumberArray(row.all_session_ids ?? row.session_ids);

      const primaryEntityId =
        toNumber(row.primary_entity_id) ??
        toNumber(row.primaryEntityId) ??
        (entityIds.length ? entityIds[0] : null);

      const primaryEntityName = firstString(
        row.primary_candidate_name,
        row.primary_candidate,
        row.primary_candidateName,
        row.primary_committee_name,
        row.primaryCommitteeName,
      );

      const party = firstString(row.party, row.party_name, row.partyName);
      const body = firstString(row.body, row.chamber, row.legislative_body);
      const district = toNumber(row.district ?? row.district_number);

      const totalIncome =
        toNumber(row.total_income) ??
        toNumber(row.totalIncome) ??
        toNumber(row.total_income_all_records) ??
        null;

      const totalExpense =
        toNumber(row.total_expense) ??
        toNumber(row.totalExpense) ??
        toNumber(row.total_expense_all_records) ??
        null;

      const latestActivity = firstString(row.latest_activity, row.latestActivity, row.last_activity, row.last_seen_at);

      const entityCount = entityIds.length || toNumber(row.entity_count) || 0;
      const legislatorCount = legislatorIds.length || toNumber(row.legislator_count) || 0;

      return {
        person_id: personId,
        display_name: displayName,
        party,
        body,
        district,
        latest_activity: latestActivity ?? undefined,
        total_income: totalIncome,
        total_expense: totalExpense,
        all_session_ids: sessionIds,
        all_legislator_ids: legislatorIds,
        all_entity_ids: entityIds,
        primary_entity_id: primaryEntityId ?? undefined,
        primary_entity_name: primaryEntityName ?? undefined,
        entity_count: entityCount,
        legislator_count: legislatorCount,
        summary: buildSummary({ entityCount, legislatorCount }),
      } satisfies PersonSearchResult;
    })
    .filter((item): item is PersonSearchResult => Boolean(item));
};

export interface SearchPeopleWithSessionsOptions {
  query: string;
  limit?: number;
  offset?: number;
}

export const searchPeopleWithSessions = async (
  options: SearchPeopleWithSessionsOptions,
): Promise<PersonSearchResult[]> => {
  const { query, limit = 25, offset = 0 } = options;

  if (!query.trim()) return [];

  // Try the newer search function first, fall back if needed
  const attempts: Array<{ fn: string; payload: Record<string, unknown> }> = [
    { fn: 'search_legislators_with_sessions', payload: { p_search_term: query.trim() } },
  ];

  for (const attempt of attempts) {
    try {
      const { data, error } = await supabase2.rpc(attempt.fn, attempt.payload);
      if (error) {
        console.warn(`RPC ${attempt.fn} failed`, error);
        continue;
      }
      const normalized = normalizePeopleRows(data);
      if (normalized.length > 0) {
        return normalized;
      }
    } catch (error) {
      console.warn(`RPC ${attempt.fn} threw`, error);
    }
  }

  // Last resort: fallback to direct table query (limited features)
  try {
    const { data, error } = await supabase2
      .from('rs_people')
      .select(
        `person_id, display_name, party, body, district,
         rs_person_legislators(legislator_id),
         rs_person_cf_entities(entity_id)`,
      )
      .ilike('display_name', `%${query.trim()}%`)
      .limit(limit)
      .offset(offset);

    if (error) {
      console.error('rs_people fallback query failed', error);
      return [];
    }

    const fallbackRows = (data || []).map((row: any) => ({
      ...row,
      all_legislator_ids: row.rs_person_legislators,
      all_entity_ids: row.rs_person_cf_entities,
    }));

    return normalizePeopleRows(fallbackRows);
  } catch (fallbackError) {
    console.error('searchPeopleWithSessions fallback failed', fallbackError);
    return [];
  }
};

