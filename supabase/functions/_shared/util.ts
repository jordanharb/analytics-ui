export function chunkText(text: string, size: number, overlap: number): string[] {
  const cleaned = text.trim();
  if (!cleaned) {
    return [];
  }

  const chunks: string[] = [];
  const step = Math.max(size - overlap, 1);

  for (let start = 0; start < cleaned.length; start += step) {
    const slice = cleaned.slice(start, start + size).trim();
    if (slice) {
      chunks.push(slice);
    }
    if (start + size >= cleaned.length) {
      break;
    }
  }

  return chunks;
}

export interface BillRecord {
  short_title: string | null;
  now_title: string | null;
  bill_summary: string | null;
  bill_text: string | null;
}

export function buildBillSummary(bill: BillRecord): string {
  const parts: string[] = [];

  const title = bill.now_title?.trim() || bill.short_title?.trim();
  if (title) {
    parts.push(title);
  }

  const summary = bill.bill_summary?.trim();
  if (summary) {
    parts.push(summary);
  } else if (bill.bill_text) {
    parts.push(bill.bill_text.slice(0, 1800).trim());
  }

  return parts.join("\n\n").trim();
}

export interface RtsRecord {
  entity_name: string | null;
  representing: string | null;
  position: string | null;
  comment: string | null;
  notes: string | null;
}

export function buildRtsContent(rts: RtsRecord): string {
  const lines: string[] = [];

  if (rts.entity_name) {
    lines.push(`Entity: ${rts.entity_name.trim()}`);
  }
  if (rts.representing) {
    lines.push(`Representing: ${rts.representing.trim()}`);
  }
  if (rts.position) {
    lines.push(normalizePosition(rts.position));
  }

  const comment = rts.comment?.trim();
  if (comment) {
    lines.push("", comment);
  }

  const notes = rts.notes?.trim();
  if (notes) {
    lines.push("", `Notes: ${notes}`);
  }

  return lines.join("\n").trim();
}

export interface DonorDisplayParts {
  name: string;
  employer?: string;
  occupation?: string;
}

export function selectDonorDisplayParts(
  entityName: string,
  employers: (string | null | undefined)[],
  occupations: (string | null | undefined)[],
): DonorDisplayParts {
  const result: DonorDisplayParts = {
    name: entityName.trim(),
  };

  const employer = mostFrequent(employers);
  if (employer) {
    result.employer = employer;
  }

  const occupation = mostFrequent(occupations);
  if (occupation) {
    result.occupation = occupation;
  }

  return result;
}

export function buildDonorContent(parts: DonorDisplayParts): string {
  const lines = [`Donor: ${parts.name}`];
  if (parts.employer) {
    lines.push(`Employer: ${parts.employer}`);
  }
  if (parts.occupation) {
    lines.push(`Occupation: ${parts.occupation}`);
  }
  return lines.join("\n").trim();
}

export function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function normalizePosition(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (["for", "support", "supporting"].includes(normalized)) {
    return "Position: For";
  }
  if (["against", "oppose", "opposing"].includes(normalized)) {
    return "Position: Against";
  }
  if (["neutral", "monitor"].includes(normalized)) {
    return "Position: Neutral";
  }
  return `Position: ${value.trim()}`;
}

function mostFrequent(values: (string | null | undefined)[]): string | undefined {
  const counts = new Map<string, number>();

  for (const raw of values) {
    const value = raw?.trim();
    if (!value) {
      continue;
    }
    const count = counts.get(value) ?? 0;
    counts.set(value, count + 1);
  }

  let best: string | undefined;
  let bestCount = 0;
  for (const [value, count] of counts.entries()) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }

  return best;
}
