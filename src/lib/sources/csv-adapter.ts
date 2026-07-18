import type { CompetitionSourceAdapter } from '@/lib/sources/adapter';
import type {
  NormalizedCompetitionImport,
  NormalizedCoverageInput,
  NormalizedMatchInput,
  NormalizedPlayerInput,
  NormalizedResultInput,
  NormalizedRosterInput,
  NormalizedTeamInput,
  SourceImportContext,
} from '@/lib/sources/types';

export interface CompetitionCsvBundle {
  context: SourceImportContext;
  teams?: string;
  players?: string;
  rosters?: string;
  matches?: string;
  results?: string;
  coverage?: string;
}

function parseCsv(text = ''): Record<string, string>[] {
  if (!text.trim()) return [];
  const rows: string[][] = [];
  let row: string[] = [];
  let value = '';
  let quoted = false;

  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        value += '"';
        index++;
      } else {
        quoted = !quoted;
      }
    } else if (character === ',' && !quoted) {
      row.push(value.trim());
      value = '';
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && text[index + 1] === '\n') index++;
      row.push(value.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      value = '';
    } else {
      value += character;
    }
  }
  row.push(value.trim());
  if (row.some(Boolean)) rows.push(row);

  const [headers = [], ...data] = rows;
  return data.map((cells) => Object.fromEntries(
    headers.map((header, index) => [header, cells[index] ?? ''])
  ));
}

function booleanValue(value: string): boolean {
  return ['true', '1', 'yes'].includes(value.toLowerCase());
}

function optional(value: string): string | undefined {
  return value || undefined;
}

export class CsvCompetitionAdapter implements CompetitionSourceAdapter<CompetitionCsvBundle> {
  readonly format = 'csv';

  async normalize(bundle: CompetitionCsvBundle): Promise<NormalizedCompetitionImport> {
    const teams = parseCsv(bundle.teams).map((row): NormalizedTeamInput => ({
      externalId: row.externalId,
      name: row.name,
      slug: row.slug,
      abbreviation: row.abbreviation,
      groupSlug: optional(row.groupSlug),
      seed: row.seed ? Number(row.seed) : undefined,
      status: optional(row.status) as NormalizedTeamInput['status'],
    }));
    const players = parseCsv(bundle.players).map((row): NormalizedPlayerInput => ({
      externalId: row.externalId,
      teamExternalId: row.teamExternalId,
      canonicalChampionDataPlayerId: row.canonicalChampionDataPlayerId
        ? Number(row.canonicalChampionDataPlayerId)
        : undefined,
      name: row.name,
      position: row.position as NormalizedPlayerInput['position'],
      photoUrl: optional(row.photoUrl),
      photoSourceUrl: optional(row.photoSourceUrl),
      photoCredit: optional(row.photoCredit),
      photoLicense: optional(row.photoLicense),
      photoVerifiedAt: optional(row.photoVerifiedAt),
    }));
    const rosters = parseCsv(bundle.rosters).map((row): NormalizedRosterInput => ({
      teamExternalId: row.teamExternalId,
      playerExternalId: row.playerExternalId,
      status: optional(row.status) as NormalizedRosterInput['status'],
      bib: optional(row.bib),
      isCaptain: booleanValue(row.isCaptain),
    }));
    const matches = parseCsv(bundle.matches).map((row): NormalizedMatchInput => ({
      externalId: row.externalId,
      stageSlug: row.stageSlug,
      groupSlug: optional(row.groupSlug),
      scheduledAt: row.scheduledAt,
      venue: row.venue,
      neutralVenue: booleanValue(row.neutralVenue),
      round: row.round ? Number(row.round) : undefined,
      roundLabel: optional(row.roundLabel),
      status: optional(row.status) as NormalizedMatchInput['status'],
      sideA: {
        teamExternalId: optional(row.sideATeamExternalId),
        sourceType: optional(row.sideASourceType) as NormalizedMatchInput['sideA']['sourceType'],
        sourceGroupSlug: optional(row.sideASourceGroupSlug),
        sourceRank: row.sideASourceRank ? Number(row.sideASourceRank) : undefined,
        sourceMatchExternalId: optional(row.sideASourceMatchExternalId),
        sourceLabel: optional(row.sideALabel),
      },
      sideB: {
        teamExternalId: optional(row.sideBTeamExternalId),
        sourceType: optional(row.sideBSourceType) as NormalizedMatchInput['sideB']['sourceType'],
        sourceGroupSlug: optional(row.sideBSourceGroupSlug),
        sourceRank: row.sideBSourceRank ? Number(row.sideBSourceRank) : undefined,
        sourceMatchExternalId: optional(row.sideBSourceMatchExternalId),
        sourceLabel: optional(row.sideBLabel),
      },
    }));
    const results = parseCsv(bundle.results).map((row): NormalizedResultInput => ({
      matchExternalId: row.matchExternalId,
      status: row.status as NormalizedResultInput['status'],
      sideAScore: Number(row.sideAScore),
      sideBScore: Number(row.sideBScore),
    }));
    const coverage = parseCsv(bundle.coverage).map((row): NormalizedCoverageInput => ({
      capability: row.capability as NormalizedCoverageInput['capability'],
      state: row.state as NormalizedCoverageInput['state'],
      matchExternalId: optional(row.matchExternalId),
      notes: optional(row.notes),
    }));

    return { context: bundle.context, teams, players, rosters, matches, results, coverage };
  }
}

export { parseCsv };
