export const COMMONWEALTH_SPORT_CWG_BASE_URL =
  'https://api.commonwealthsport.com/cwg-schedule/v1/cwg';
export const GLASGOW_2026_COMPETITION_ID =
  '3bb0d78e-d439-472a-a5bf-09b4e888aa04';
export const GLASGOW_NETBALL_DISCIPLINE_CODE = 'NBL';
export const OFFICIAL_FEED_TIMEOUT_MS = 10_000;

type OfficialFeedEnvironment = Readonly<
  Record<string, string | undefined>
>;

export function isOfficialGlasgowFeedEnabled(
  env: OfficialFeedEnvironment = process.env,
): boolean {
  if (
    env.IS_PULL_REQUEST !== undefined
    && env.IS_PULL_REQUEST !== ''
    && env.IS_PULL_REQUEST !== 'false'
  ) {
    return false;
  }
  if (env.GLASGOW_LIVE_FEED_ENABLED === 'true') return true;
  if (env.GLASGOW_LIVE_FEED_ENABLED === 'false') return false;
  return env.NODE_ENV === 'production'
    && env.WORKER_ENABLED === 'true'
    && env.DATABASE_ENVIRONMENT?.trim().toLowerCase() === 'production';
}

export function officialGlasgowFeedBaseUrl(
  env: OfficialFeedEnvironment = process.env,
): string {
  return env.GLASGOW_LIVE_FEED_BASE_URL?.trim()
    || COMMONWEALTH_SPORT_CWG_BASE_URL;
}

const MAX_RESPONSE_BYTES = 1_000_000;
const MAX_SESSIONS = 200;
const MAX_PHASES_PER_SESSION = 32;
const MAX_PHASE_RESULTS = 64;

export type OfficialFeedStatus = 'UPCOMING' | 'LIVE' | 'COMPLETE';
export type OfficialFeedPhaseStatus = OfficialFeedStatus | null;
export type NormalizedMatchStatus = 'LIVE' | 'COMPLETED';
export type NormalizedResultQuality = 'PROVISIONAL' | 'OFFICIAL_FINAL';

export interface OfficialFeedVenue {
  code: string;
  description: string | null;
  longDescription: string | null;
  city: string | null;
}

export interface OfficialFeedSessionPhase {
  eventCode: string;
  phaseCode: string;
  genderCode: string;
  status: OfficialFeedPhaseStatus;
  startDate: string;
  description: string | null;
  phaseDescription: string | null;
}

export interface OfficialFeedSession {
  id: string;
  startDate: string;
  endDate: string;
  status: OfficialFeedStatus;
  disciplineCode: typeof GLASGOW_NETBALL_DISCIPLINE_CODE;
  venue: OfficialFeedVenue;
  phases: OfficialFeedSessionPhase[];
}

export interface OfficialFeedPhaseRequest {
  sessionId: string;
  eventCode: string;
  phaseCode: string;
  genderCode: string;
  disciplineCode: typeof GLASGOW_NETBALL_DISCIPLINE_CODE;
  sessionStatus: OfficialFeedStatus;
  phaseStatus: OfficialFeedPhaseStatus;
  sessionStartDate: string;
  sessionEndDate: string;
  phaseStartDate: string;
}

export interface OfficialFeedObservation {
  provider: 'COMMONWEALTH_SPORT';
  providerCompetitionId: typeof GLASGOW_2026_COMPETITION_ID;
  providerMatchCode: string;
  providerSessionId: string;
  providerEventCode: string;
  providerPhaseCode: string;
  providerGenderCode: string;
  providerDisciplineCode: typeof GLASGOW_NETBALL_DISCIPLINE_CODE;
  providerSideAResultId: string;
  providerSideBResultId: string;
  detailRequestUrl: string;
  startDate: string;
  endDate: string;
  status: NormalizedMatchStatus;
  resultQuality: NormalizedResultQuality;
  sideAOrganisationCode: string;
  sideBOrganisationCode: string;
  sideAScore: number;
  sideBScore: number;
}

export type OfficialFeedFetch = (
  input: string,
  init: RequestInit,
) => Promise<Response>;

export interface OfficialFeedUrlOptions {
  baseUrl?: string;
}

export interface OfficialFeedFetchOptions extends OfficialFeedUrlOptions {
  fetchImpl?: OfficialFeedFetch;
  signal?: AbortSignal;
  /**
   * Defaults to the production limit of 10 seconds. This override exists for
   * deterministic tests and callers with a stricter deadline.
   */
  timeoutMs?: number;
}

export class OfficialFeedValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OfficialFeedValidationError';
  }
}

export class OfficialFeedRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OfficialFeedRequestError';
  }
}

type JsonObject = Record<string, unknown>;

interface ParsedCompetitor {
  id: string;
  providerMatchCode: string;
  organisationId: string;
  organisationCode: string;
  competitorCode: string;
  startOrder: number;
  score: number;
}

function invalid(path: string, reason: string): never {
  throw new OfficialFeedValidationError(`${path} ${reason}`);
}

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function objectAt(value: unknown, path: string): JsonObject {
  if (!isObject(value)) invalid(path, 'must be an object');
  return value;
}

function arrayAt(value: unknown, path: string, maxLength: number): unknown[] {
  if (!Array.isArray(value)) invalid(path, 'must be an array');
  if (value.length > maxLength) {
    invalid(path, `must contain no more than ${maxLength} entries`);
  }
  return value;
}

function stringAt(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim()) {
    invalid(path, 'must be a non-empty, trimmed string');
  }
  return value;
}

function nullableStringAt(value: unknown, path: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') invalid(path, 'must be a string or null');
  return value;
}

function timestampAt(value: unknown, path: string): string {
  const timestamp = stringAt(value, path);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(timestamp)
    || Number.isNaN(Date.parse(timestamp))
  ) {
    invalid(path, 'must be an ISO-8601 timestamp with a timezone');
  }
  return timestamp;
}

function statusAt(value: unknown, path: string): OfficialFeedStatus {
  if (value !== 'UPCOMING' && value !== 'LIVE' && value !== 'COMPLETE') {
    invalid(path, 'must be UPCOMING, LIVE, or COMPLETE');
  }
  return value;
}

function phaseStatusAt(value: unknown, path: string): OfficialFeedPhaseStatus {
  if (value === null) return null;
  return statusAt(value, path);
}

function positiveIntegerAt(value: unknown, path: string): number {
  const parsed = typeof value === 'string' && /^\d+$/.test(value)
    ? Number(value)
    : value;
  if (!Number.isSafeInteger(parsed) || (parsed as number) < 1) {
    invalid(path, 'must be a positive integer');
  }
  return parsed as number;
}

function nonNegativeIntegerAt(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    invalid(path, 'must be a non-negative integer');
  }
  return value as number;
}

function scoreAt(value: unknown, path: string): number {
  const parsed = typeof value === 'string' && /^\d+$/.test(value)
    ? Number(value)
    : value;
  if (!Number.isSafeInteger(parsed) || (parsed as number) < 0) {
    invalid(path, 'must be a non-negative integer');
  }
  return parsed as number;
}

function validateDateOrder(startDate: string, endDate: string, path: string): void {
  if (Date.parse(endDate) <= Date.parse(startDate)) {
    invalid(path, 'must end after it starts');
  }
}

function assertRequestToken(value: string, name: string): void {
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim()) {
    invalid(name, 'must be a non-empty, trimmed string');
  }
}

function assertLocalDate(localDate: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(localDate)) {
    invalid('localDate', 'must use YYYY-MM-DD');
  }
  const parsed = new Date(`${localDate}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== localDate) {
    invalid('localDate', 'must be a real calendar date');
  }
}

function officialBaseUrl(options: OfficialFeedUrlOptions): string {
  const rawBaseUrl = options.baseUrl ?? COMMONWEALTH_SPORT_CWG_BASE_URL;
  let url: URL;
  try {
    url = new URL(rawBaseUrl);
  } catch {
    invalid('baseUrl', 'must be a valid HTTPS URL');
  }
  if (url.protocol !== 'https:') invalid('baseUrl', 'must use HTTPS');
  if (url.username || url.password) invalid('baseUrl', 'must not contain credentials');
  if (url.search || url.hash) invalid('baseUrl', 'must not contain a query or fragment');
  url.pathname = url.pathname.replace(/\/+$/, '');
  return url.toString().replace(/\/$/, '');
}

export function officialSessionsUrl(
  localDate: string,
  options: OfficialFeedUrlOptions = {},
): string {
  assertLocalDate(localDate);
  const url = new URL(
    `${officialBaseUrl(options)}/competitions/${GLASGOW_2026_COMPETITION_ID}/sessions`,
  );
  url.searchParams.set('sessionDate', localDate);
  url.searchParams.set('size', String(MAX_SESSIONS));
  url.searchParams.set('disciplineCodes', GLASGOW_NETBALL_DISCIPLINE_CODE);
  return url.toString();
}

export function officialPhaseDetailUrl(
  request: Pick<
    OfficialFeedPhaseRequest,
    'sessionId' | 'eventCode' | 'phaseCode' | 'genderCode' | 'disciplineCode'
  >,
  options: OfficialFeedUrlOptions = {},
): string {
  assertRequestToken(request.sessionId, 'sessionId');
  assertRequestToken(request.eventCode, 'eventCode');
  assertRequestToken(request.phaseCode, 'phaseCode');
  assertRequestToken(request.genderCode, 'genderCode');
  if (request.disciplineCode !== GLASGOW_NETBALL_DISCIPLINE_CODE) {
    invalid('disciplineCode', `must be ${GLASGOW_NETBALL_DISCIPLINE_CODE}`);
  }

  const sessionId = encodeURIComponent(request.sessionId);
  const url = new URL(
    `${officialBaseUrl(options)}/competitions/${GLASGOW_2026_COMPETITION_ID}`
      + `/session/${sessionId}/details`,
  );
  url.searchParams.set('eventCode', request.eventCode);
  url.searchParams.set('phaseCode', request.phaseCode);
  url.searchParams.set('genderCode', request.genderCode);
  url.searchParams.set('disciplineCode', request.disciplineCode);
  return url.toString();
}

export function parseOfficialSessionsPayload(
  payload: unknown,
  expectedLocalDate?: string,
): OfficialFeedSession[] {
  if (expectedLocalDate !== undefined) assertLocalDate(expectedLocalDate);
  const root = objectAt(payload, 'payload');
  const rawSessions = arrayAt(root.sessions, 'payload.sessions', MAX_SESSIONS);
  const excludedSessionsCount = nonNegativeIntegerAt(
    root.excludedSessionsCount,
    'payload.excludedSessionsCount',
  );
  if (excludedSessionsCount !== 0) {
    invalid('payload.excludedSessionsCount', 'must be 0 for complete coverage');
  }
  const pageInfo = objectAt(root.pageInfo, 'payload.pageInfo');
  const page = nonNegativeIntegerAt(pageInfo.page, 'payload.pageInfo.page');
  const numPages = nonNegativeIntegerAt(
    pageInfo.numPages,
    'payload.pageInfo.numPages',
  );
  const pageSize = nonNegativeIntegerAt(
    pageInfo.pageSize,
    'payload.pageInfo.pageSize',
  );
  const numEntries = nonNegativeIntegerAt(
    pageInfo.numEntries,
    'payload.pageInfo.numEntries',
  );
  if (page !== 0) invalid('payload.pageInfo.page', 'must be 0');
  if (numPages > 1) {
    invalid('payload.pageInfo.numPages', 'must not advertise an unfetched page');
  }
  if (numPages === 0 && rawSessions.length > 0) {
    invalid('payload.pageInfo.numPages', 'must advertise the returned page');
  }
  if (pageSize !== rawSessions.length || numEntries !== rawSessions.length) {
    invalid('payload.pageInfo', 'must account for every returned session');
  }
  const sessionIds = new Set<string>();

  return rawSessions.map((rawSession, sessionIndex) => {
    const path = `payload.sessions[${sessionIndex}]`;
    const session = objectAt(rawSession, path);
    const id = stringAt(session.id, `${path}.id`);
    if (sessionIds.has(id)) invalid(`${path}.id`, 'must be unique');
    sessionIds.add(id);

    const startDate = timestampAt(session.startDate, `${path}.startDate`);
    const endDate = timestampAt(session.endDate, `${path}.endDate`);
    validateDateOrder(startDate, endDate, path);
    if (
      expectedLocalDate
      && londonMatchTimePrefix(startDate).slice(0, 10) !== expectedLocalDate
    ) {
      invalid(`${path}.startDate`, `must fall on requested Europe/London date ${expectedLocalDate}`);
    }
    const status = statusAt(session.status, `${path}.status`);

    const discipline = objectAt(session.discipline, `${path}.discipline`);
    const disciplineCode = stringAt(
      discipline.code,
      `${path}.discipline.code`,
    );
    if (disciplineCode !== GLASGOW_NETBALL_DISCIPLINE_CODE) {
      invalid(
        `${path}.discipline.code`,
        `must be ${GLASGOW_NETBALL_DISCIPLINE_CODE}`,
      );
    }

    const rawVenue = objectAt(session.venue, `${path}.venue`);
    const venue: OfficialFeedVenue = {
      code: stringAt(rawVenue.code, `${path}.venue.code`),
      description: nullableStringAt(
        rawVenue.description,
        `${path}.venue.description`,
      ),
      longDescription: nullableStringAt(
        rawVenue.longDescription,
        `${path}.venue.longDescription`,
      ),
      city: nullableStringAt(rawVenue.city, `${path}.venue.city`),
    };

    const rawPhases = arrayAt(
      session.sessionEventPhases,
      `${path}.sessionEventPhases`,
      MAX_PHASES_PER_SESSION,
    );
    const phases = rawPhases.map((rawPhase, phaseIndex): OfficialFeedSessionPhase => {
      const phasePath = `${path}.sessionEventPhases[${phaseIndex}]`;
      const phase = objectAt(rawPhase, phasePath);
      const phaseStartDate = timestampAt(phase.startDate, `${phasePath}.startDate`);
      if (
        expectedLocalDate
        && londonMatchTimePrefix(phaseStartDate).slice(0, 10) !== expectedLocalDate
      ) {
        invalid(
          `${phasePath}.startDate`,
          `must fall on requested Europe/London date ${expectedLocalDate}`,
        );
      }
      if (
        Date.parse(phaseStartDate) < Date.parse(startDate)
        || Date.parse(phaseStartDate) > Date.parse(endDate)
      ) {
        invalid(`${phasePath}.startDate`, 'must fall within the session');
      }
      return {
        eventCode: stringAt(phase.eventCode, `${phasePath}.eventCode`),
        phaseCode: stringAt(phase.phaseCode, `${phasePath}.phaseCode`),
        genderCode: stringAt(phase.genderCode, `${phasePath}.genderCode`),
        status: phaseStatusAt(phase.status, `${phasePath}.status`),
        startDate: phaseStartDate,
        description: nullableStringAt(
          phase.description,
          `${phasePath}.description`,
        ),
        phaseDescription: nullableStringAt(
          phase.phaseDescription,
          `${phasePath}.phaseDescription`,
        ),
      };
    });

    return {
      id,
      startDate,
      endDate,
      status,
      disciplineCode: GLASGOW_NETBALL_DISCIPLINE_CODE,
      venue,
      phases,
    };
  });
}

export function buildOfficialPhaseRequests(
  sessions: readonly OfficialFeedSession[],
): OfficialFeedPhaseRequest[] {
  const requests = new Map<string, OfficialFeedPhaseRequest>();

  for (const session of sessions) {
    for (const phase of session.phases) {
      const request: OfficialFeedPhaseRequest = {
        sessionId: session.id,
        eventCode: phase.eventCode,
        phaseCode: phase.phaseCode,
        genderCode: phase.genderCode,
        disciplineCode: session.disciplineCode,
        sessionStatus: session.status,
        phaseStatus: phase.status,
        sessionStartDate: session.startDate,
        sessionEndDate: session.endDate,
        phaseStartDate: phase.startDate,
      };
      const key = JSON.stringify([
        request.sessionId,
        request.eventCode,
        request.phaseCode,
        request.genderCode,
        request.disciplineCode,
      ]);
      const existing = requests.get(key);
      if (existing) {
        if (
          existing.phaseStatus !== request.phaseStatus
          || existing.phaseStartDate !== request.phaseStartDate
        ) {
          invalid('sessions', 'contain conflicting duplicate phase requests');
        }
        continue;
      }
      requests.set(key, request);
    }
  }

  return [...requests.values()];
}

function parseCompetitor(
  rawCompetitor: unknown,
  path: string,
  request: OfficialFeedPhaseRequest,
  unitStatus: 'LIVE' | 'COMPLETE',
  liveResultStatus: 'RUNNING' | 'SCHEDULED_BREAK' = 'RUNNING',
): ParsedCompetitor {
  const competitor = objectAt(rawCompetitor, path);
  const expectedResultStatus = unitStatus === 'LIVE'
    ? liveResultStatus
    : 'OFFICIAL';

  if (stringAt(competitor.disciplineCode, `${path}.disciplineCode`) !== request.disciplineCode) {
    invalid(`${path}.disciplineCode`, 'does not match the detail request');
  }
  if (stringAt(competitor.eventCode, `${path}.eventCode`) !== request.eventCode) {
    invalid(`${path}.eventCode`, 'does not match the detail request');
  }
  if (stringAt(competitor.phaseCode, `${path}.phaseCode`) !== request.phaseCode) {
    invalid(`${path}.phaseCode`, 'does not match the detail request');
  }
  if (stringAt(competitor.genderCode, `${path}.genderCode`) !== request.genderCode) {
    invalid(`${path}.genderCode`, 'does not match the detail request');
  }
  if (stringAt(competitor.competitorType, `${path}.competitorType`) !== 'T') {
    invalid(`${path}.competitorType`, 'must identify a team');
  }
  if (stringAt(competitor.resultType, `${path}.resultType`) !== 'POINTS') {
    invalid(`${path}.resultType`, 'must be POINTS');
  }
  if (stringAt(competitor.resultStatus, `${path}.resultStatus`) !== expectedResultStatus) {
    invalid(
      `${path}.resultStatus`,
      `must be ${expectedResultStatus} for a ${unitStatus} result`,
    );
  }

  return {
    id: stringAt(competitor.id, `${path}.id`),
    providerMatchCode: stringAt(competitor.code, `${path}.code`),
    organisationId: stringAt(
      competitor.organisationId,
      `${path}.organisationId`,
    ),
    organisationCode: stringAt(
      competitor.organisationCode,
      `${path}.organisationCode`,
    ),
    competitorCode: stringAt(
      competitor.competitorCode,
      `${path}.competitorCode`,
    ),
    startOrder: positiveIntegerAt(competitor.startOrder, `${path}.startOrder`),
    score: scoreAt(competitor.result, `${path}.result`),
  };
}

function isGettingReadyCompetitor(
  rawCompetitor: unknown,
  path: string,
): boolean {
  const competitor = objectAt(rawCompetitor, path);
  return competitor.resultStatus === 'GETTING_READY'
    && competitor.result === null
    && competitor.resultType === null;
}

export function parseOfficialDetailPayload(
  payload: unknown,
  request: OfficialFeedPhaseRequest,
  urlOptions: OfficialFeedUrlOptions = {},
): OfficialFeedObservation[] {
  if (request.disciplineCode !== GLASGOW_NETBALL_DISCIPLINE_CODE) {
    invalid('request.disciplineCode', `must be ${GLASGOW_NETBALL_DISCIPLINE_CODE}`);
  }
  const root = objectAt(payload, 'payload');
  const phaseResults = arrayAt(
    root.phaseResults,
    'payload.phaseResults',
    MAX_PHASE_RESULTS,
  );
  const detailRequestUrl = officialPhaseDetailUrl(request, urlOptions);
  const seenMatchCodes = new Set<string>();
  const observations: OfficialFeedObservation[] = [];
  let gettingReadyRows = 0;

  for (const [resultIndex, rawPhaseResult] of phaseResults.entries()) {
    const path = `payload.phaseResults[${resultIndex}]`;
    const phaseResult = objectAt(rawPhaseResult, path);
    const rawUnitStatus = phaseResult.unitStatus;

    if (rawUnitStatus === 'UPCOMING') continue;
    if (
      rawUnitStatus !== 'LIVE'
      && rawUnitStatus !== 'COMPLETE'
      && rawUnitStatus !== null
    ) {
      invalid(`${path}.unitStatus`, 'is not an authoritative result status');
    }

    const startDate = timestampAt(phaseResult.startDate, `${path}.startDate`);
    const endDate = timestampAt(phaseResult.endDate, `${path}.endDate`);
    validateDateOrder(startDate, endDate, path);
    const sessionStart = Date.parse(request.sessionStartDate);
    const sessionEnd = Date.parse(request.sessionEndDate);
    const phaseStart = Date.parse(request.phaseStartDate);
    const resultStart = Date.parse(startDate);
    if (
      Number.isNaN(sessionStart)
      || Number.isNaN(sessionEnd)
      || Number.isNaN(phaseStart)
      || resultStart < sessionStart
      || resultStart < phaseStart
      || resultStart > sessionEnd
    ) {
      invalid(path, 'falls outside the requested session and phase window');
    }
    const versus = objectAt(phaseResult.versus, `${path}.versus`);
    const teamResults = arrayAt(
      versus.teamResult,
      `${path}.versus.teamResult`,
      2,
    );
    if (teamResults.length !== 2) {
      invalid(`${path}.versus.teamResult`, 'must contain exactly two competitors');
    }

    const gettingReady = teamResults.map((competitor, competitorIndex) =>
      isGettingReadyCompetitor(
        competitor,
        `${path}.versus.teamResult[${competitorIndex}]`,
      ));
    let unitStatus: 'LIVE' | 'COMPLETE';
    let liveResultStatus: 'RUNNING' | 'SCHEDULED_BREAK' = 'RUNNING';
    if (rawUnitStatus === null) {
      if (request.phaseStatus !== null) {
        invalid(
          `${path}.unitStatus`,
          'may be null only when the selected phase status is also null',
        );
      }
      if (gettingReady.every(Boolean)) {
        gettingReadyRows += 1;
        continue;
      }
      const scheduledBreak = teamResults.map((rawCompetitor) => (
        objectAt(rawCompetitor, `${path}.versus.teamResult`).resultStatus
          === 'SCHEDULED_BREAK'
      ));
      if (!scheduledBreak.every(Boolean)) {
        invalid(
          `${path}.versus.teamResult`,
          'must contain two SCHEDULED_BREAK results when unitStatus is null',
        );
      }
      unitStatus = 'LIVE';
      liveResultStatus = 'SCHEDULED_BREAK';
    } else {
      unitStatus = rawUnitStatus;
      if (unitStatus === 'LIVE') {
        if (gettingReady.every(Boolean)) {
          gettingReadyRows += 1;
          continue;
        }
        if (gettingReady.some(Boolean)) {
          invalid(
            `${path}.versus.teamResult`,
            'must not mix getting-ready and authoritative score states',
          );
        }
      }
    }

    const competitors = teamResults
      .map((competitor, competitorIndex) => parseCompetitor(
        competitor,
        `${path}.versus.teamResult[${competitorIndex}]`,
        request,
        unitStatus,
        liveResultStatus,
      ))
      .sort((left, right) => left.startOrder - right.startOrder);
    const [sideA, sideB] = competitors;

    if (sideA.startOrder !== 1 || sideB.startOrder !== 2) {
      invalid(`${path}.versus.teamResult`, 'must use startOrder values 1 and 2');
    }
    if (
      sideA.id === sideB.id
      || sideA.organisationId === sideB.organisationId
      || sideA.organisationCode === sideB.organisationCode
      || sideA.competitorCode === sideB.competitorCode
    ) {
      invalid(`${path}.versus.teamResult`, 'must contain two distinct teams');
    }
    if (sideA.providerMatchCode !== sideB.providerMatchCode) {
      invalid(`${path}.versus.teamResult`, 'must share one provider match code');
    }
    if (seenMatchCodes.has(sideA.providerMatchCode)) {
      invalid(`${path}.versus.teamResult`, 'duplicates a provider match code');
    }
    seenMatchCodes.add(sideA.providerMatchCode);

    observations.push({
      provider: 'COMMONWEALTH_SPORT',
      providerCompetitionId: GLASGOW_2026_COMPETITION_ID,
      providerMatchCode: sideA.providerMatchCode,
      providerSessionId: request.sessionId,
      providerEventCode: request.eventCode,
      providerPhaseCode: request.phaseCode,
      providerGenderCode: request.genderCode,
      providerDisciplineCode: request.disciplineCode,
      providerSideAResultId: sideA.id,
      providerSideBResultId: sideB.id,
      detailRequestUrl,
      startDate,
      endDate,
      status: unitStatus === 'LIVE' ? 'LIVE' : 'COMPLETED',
      resultQuality: unitStatus === 'LIVE' ? 'PROVISIONAL' : 'OFFICIAL_FINAL',
      sideAOrganisationCode: sideA.organisationCode,
      sideBOrganisationCode: sideB.organisationCode,
      sideAScore: sideA.score,
      sideBScore: sideB.score,
    });
  }

  const sorted = observations.sort((left, right) => (
    left.startDate.localeCompare(right.startDate)
    || left.providerMatchCode.localeCompare(right.providerMatchCode)
  ));
  if (
    sorted.length === 0
    && gettingReadyRows === 0
    && request.phaseStatus !== 'UPCOMING'
  ) {
    invalid(
      'payload.phaseResults',
      'must contain an authoritative result for the selected phase',
    );
  }
  return sorted;
}

async function readBoundedJson(
  response: Response,
  label: string,
): Promise<unknown> {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    await response.body?.cancel().catch(() => undefined);
    throw new OfficialFeedRequestError(
      `${label} response exceeded ${MAX_RESPONSE_BYTES} bytes`,
    );
  }
  if (!response.body) {
    throw new OfficialFeedRequestError(`${label} response did not contain a body`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let raw = '';
  let bytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) {
        raw += decoder.decode();
        break;
      }
      bytes += chunk.value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new OfficialFeedRequestError(
          `${label} response exceeded ${MAX_RESPONSE_BYTES} bytes`,
        );
      }
      raw += decoder.decode(chunk.value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }

  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new OfficialFeedRequestError(`${label} response was not valid JSON`);
  }
}

async function fetchOfficialJson(
  url: string,
  label: string,
  options: OfficialFeedFetchOptions,
): Promise<unknown> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? OFFICIAL_FEED_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    invalid('timeoutMs', 'must be a positive number');
  }
  if (options.signal?.aborted) {
    throw new OfficialFeedRequestError(`${label} request aborted`);
  }

  const controller = new AbortController();
  let abortKind: 'caller' | 'timeout' | null = null;
  const forwardAbort = () => {
    abortKind = 'caller';
    controller.abort(options.signal?.reason);
  };
  options.signal?.addEventListener('abort', forwardAbort, { once: true });

  let rejectOnAbort: ((reason: OfficialFeedRequestError) => void) | undefined;
  const abortPromise = new Promise<never>((_resolve, reject) => {
    rejectOnAbort = reject;
  });
  const rejectForAbort = () => {
    const message = abortKind === 'timeout'
      ? `${label} request timed out after ${timeoutMs}ms`
      : `${label} request aborted`;
    rejectOnAbort?.(new OfficialFeedRequestError(message));
  };
  controller.signal.addEventListener('abort', rejectForAbort, { once: true });

  const timeout = setTimeout(() => {
    abortKind = 'timeout';
    controller.abort();
  }, timeoutMs);

  const request = (async () => {
    let response: Response;
    try {
      response = await fetchImpl(url, {
        cache: 'no-store',
        headers: { accept: 'application/json' },
        signal: controller.signal,
      });
    } catch {
      if (controller.signal.aborted) {
        const message = abortKind === 'timeout'
          ? `${label} request timed out after ${timeoutMs}ms`
          : `${label} request aborted`;
        throw new OfficialFeedRequestError(message);
      }
      throw new OfficialFeedRequestError(`${label} request failed`);
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new OfficialFeedRequestError(
        `${label} request failed with HTTP ${response.status}`,
      );
    }
    return readBoundedJson(response, label);
  })();

  try {
    return await Promise.race([request, abortPromise]);
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', forwardAbort);
    controller.signal.removeEventListener('abort', rejectForAbort);
  }
}

export async function fetchOfficialSessions(
  localDate: string,
  options: OfficialFeedFetchOptions = {},
): Promise<OfficialFeedSession[]> {
  const payload = await fetchOfficialJson(
    officialSessionsUrl(localDate, options),
    'Commonwealth Sport sessions',
    options,
  );
  return parseOfficialSessionsPayload(payload, localDate);
}

export async function fetchOfficialPhaseResults(
  request: OfficialFeedPhaseRequest,
  options: OfficialFeedFetchOptions = {},
): Promise<OfficialFeedObservation[]> {
  const payload = await fetchOfficialJson(
    officialPhaseDetailUrl(request, options),
    'Commonwealth Sport phase details',
    options,
  );
  return parseOfficialDetailPayload(payload, request, options);
}

async function fetchPhaseResultsWithConcurrencyTwo(
  requests: readonly OfficialFeedPhaseRequest[],
  options: OfficialFeedFetchOptions,
): Promise<OfficialFeedObservation[][]> {
  const results = new Array<OfficialFeedObservation[]>(requests.length);
  let nextIndex = 0;
  let failure: unknown;
  const worker = async () => {
    while (failure === undefined && nextIndex < requests.length) {
      const index = nextIndex;
      nextIndex += 1;
      try {
        results[index] = await fetchOfficialPhaseResults(requests[index], options);
      } catch (error) {
        failure ??= error;
      }
    }
  };
  const workerCount = Math.min(2, requests.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  if (failure !== undefined) throw failure;
  return results;
}

export async function fetchOfficialObservationsForDate(
  localDate: string,
  options: OfficialFeedFetchOptions = {},
): Promise<OfficialFeedObservation[]> {
  const sessions = await fetchOfficialSessions(localDate, options);
  const requests = buildOfficialPhaseRequests(sessions).filter(
    (request) => (
      request.phaseCode !== 'VICT'
      && request.phaseStatus !== 'UPCOMING'
    ),
  );
  const results = await fetchPhaseResultsWithConcurrencyTwo(requests, options);
  const observations = results.flat().sort((left, right) => (
    left.startDate.localeCompare(right.startDate)
    || left.providerMatchCode.localeCompare(right.providerMatchCode)
  ));
  const matchCodes = new Set<string>();
  for (const observation of observations) {
    if (matchCodes.has(observation.providerMatchCode)) {
      invalid('observations', 'contain a duplicate provider match code');
    }
    matchCodes.add(observation.providerMatchCode);
  }
  return observations;
}

export function londonMatchTimePrefix(startDate: string): string {
  const timestamp = timestampAt(startDate, 'startDate');
  const date = new Date(timestamp);
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  const year = values.get('year');
  const month = values.get('month');
  const day = values.get('day');
  const hour = values.get('hour');
  const minute = values.get('minute');
  if (!year || !month || !day || !hour || !minute) {
    invalid('startDate', 'could not be formatted in Europe/London');
  }
  return `${year}-${month}-${day}-${hour}${minute}-`;
}
