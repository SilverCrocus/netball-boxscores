import { describe, expect, it, vi } from 'vitest';
import {
  buildOfficialPhaseRequests,
  COMMONWEALTH_SPORT_CWG_BASE_URL,
  fetchOfficialObservationsForDate,
  fetchOfficialSessions,
  GLASGOW_2026_COMPETITION_ID,
  londonMatchTimePrefix,
  officialPhaseDetailUrl,
  officialSessionsUrl,
  parseOfficialDetailPayload,
  parseOfficialSessionsPayload,
  type OfficialFeedPhaseRequest,
} from '@/lib/glasgow/official-feed';

const LIVE_SESSION_ID = '2ff0e0dc-27cc-4bef-9b3e-1b7d77ffa806';
const EVENT_CODE = 'TEAM7-------------';
const LIVE_MATCH_CODE = 'NBLWTEAM7-------------GPB-000400--';

const liveSessionsPayload = {
  pageInfo: { page: 0, numPages: 1, pageSize: 1, numEntries: 1 },
  excludedSessionsCount: 0,
  sessions: [{
    id: LIVE_SESSION_ID,
    discipline: {
      id: 'ab768ebc-d7af-4044-8761-5bfa0d7b4acf',
      code: 'NBL',
      description: 'Netball',
    },
    startDate: '2026-07-26T08:00:00Z',
    endDate: '2026-07-26T11:30:00Z',
    status: 'LIVE',
    venue: {
      code: 'SXH',
      description: 'The Hydro',
      longDescription: 'The Hydro',
      city: null,
    },
    sessionEventPhases: [{
      phaseCode: 'GPA-',
      phaseDescription: 'Pool A',
      description: 'Group Play Stage - Group A',
      genderCode: 'W',
      eventCode: EVENT_CODE,
      status: 'UPCOMING',
      startDate: '2026-07-26T10:00:00Z',
    }, {
      phaseCode: 'GPB-',
      phaseDescription: 'Pool B',
      description: 'Group Play Stage - Group B',
      genderCode: 'W',
      eventCode: EVENT_CODE,
      status: 'LIVE',
      startDate: '2026-07-26T08:00:00Z',
    }],
  }],
};

function request(overrides: Partial<OfficialFeedPhaseRequest> = {}): OfficialFeedPhaseRequest {
  return {
    sessionId: LIVE_SESSION_ID,
    eventCode: EVENT_CODE,
    phaseCode: 'GPB-',
    genderCode: 'W',
    disciplineCode: 'NBL',
    sessionStatus: 'LIVE',
    phaseStatus: 'LIVE',
    sessionStartDate: '2026-07-26T08:00:00Z',
    sessionEndDate: '2026-07-26T11:30:00Z',
    phaseStartDate: '2026-07-26T08:00:00Z',
    ...overrides,
  };
}

function competitor(overrides: Record<string, unknown> = {}) {
  return {
    id: '54ff3363-11cd-4bf1-870c-59e5e7381796',
    code: LIVE_MATCH_CODE,
    disciplineCode: 'NBL',
    genderCode: 'W',
    eventCode: EVENT_CODE,
    phaseCode: 'GPB-',
    resultStatus: 'RUNNING',
    resultType: 'POINTS',
    result: '42',
    startOrder: '1',
    competitorCode: 'NBLWTEAM7---WAL01',
    competitorType: 'T',
    organisationId: '245697aa-ad93-47e4-b4b0-5c374a15c7e7',
    organisationCode: 'WAL',
    organisationName: 'Wales',
    ...overrides,
  };
}

function liveDetailPayload() {
  return {
    phaseResults: [{
      unitStatus: 'LIVE',
      startDate: '2026-07-26T08:00:00Z',
      endDate: '2026-07-26T09:45:00Z',
      versus: {
        athleteResult: null,
        teamResult: [
          competitor({
            id: '4e851352-ac05-4865-b723-e0c260588eb1',
            result: '53',
            startOrder: '2',
            competitorCode: 'NBLWTEAM7---SCO01',
            organisationId: 'd58009a3-327e-4a6a-be55-a81ec0c09b7a',
            organisationCode: 'SCO',
            organisationName: 'Scotland',
          }),
          competitor(),
        ],
      },
    }],
  };
}

describe('Commonwealth Sport Glasgow 2026 official feed', () => {
  it('parses the current Wales/Scotland-shaped LIVE result and orders sides numerically', () => {
    const sessions = parseOfficialSessionsPayload(liveSessionsPayload);
    const requests = buildOfficialPhaseRequests(sessions);
    expect(requests).toHaveLength(2);

    const liveRequest = requests.find((item) => item.phaseCode === 'GPB-');
    expect(liveRequest).toBeDefined();
    const observations = parseOfficialDetailPayload(
      liveDetailPayload(),
      liveRequest as OfficialFeedPhaseRequest,
    );

    expect(observations).toEqual([expect.objectContaining({
      provider: 'COMMONWEALTH_SPORT',
      providerCompetitionId: GLASGOW_2026_COMPETITION_ID,
      providerMatchCode: LIVE_MATCH_CODE,
      providerSessionId: LIVE_SESSION_ID,
      providerEventCode: EVENT_CODE,
      providerPhaseCode: 'GPB-',
      providerGenderCode: 'W',
      providerDisciplineCode: 'NBL',
      startDate: '2026-07-26T08:00:00Z',
      endDate: '2026-07-26T09:45:00Z',
      status: 'LIVE',
      resultQuality: 'PROVISIONAL',
      sideAOrganisationCode: 'WAL',
      sideBOrganisationCode: 'SCO',
      sideAScore: 42,
      sideBScore: 53,
    })]);
    expect(observations[0].detailRequestUrl).toBe(officialPhaseDetailUrl(liveRequest!));
  });

  it('converts COMPLETE + OFFICIAL results and handles multiple phaseResults', () => {
    const completedRequest = request({
      sessionStatus: 'COMPLETE',
      phaseStatus: 'COMPLETE',
      sessionStartDate: '2026-07-25T08:00:00Z',
      sessionEndDate: '2026-07-25T17:00:00Z',
      phaseStartDate: '2026-07-25T08:00:00Z',
    });
    const completedCompetitors = [
      competitor({
        id: 'nz-result',
        code: 'NBLWTEAM7-------------GPB-000100--',
        resultStatus: 'OFFICIAL',
        result: '74',
        competitorCode: 'NBLWTEAM7---NZL01',
        organisationId: 'new-zealand',
        organisationCode: 'NZL',
      }),
      competitor({
        id: 'sco-result',
        code: 'NBLWTEAM7-------------GPB-000100--',
        resultStatus: 'OFFICIAL',
        result: '44',
        startOrder: '2',
        competitorCode: 'NBLWTEAM7---SCO01',
        organisationId: 'scotland',
        organisationCode: 'SCO',
      }),
    ];
    const laterCompetitors = [
      competitor({
        id: 'jam-result',
        code: 'NBLWTEAM7-------------GPB-000200--',
        resultStatus: 'OFFICIAL',
        result: '66',
        competitorCode: 'NBLWTEAM7---JAM01',
        organisationId: 'jamaica',
        organisationCode: 'JAM',
      }),
      competitor({
        id: 'uga-result',
        code: 'NBLWTEAM7-------------GPB-000200--',
        resultStatus: 'OFFICIAL',
        result: '52',
        startOrder: '2',
        competitorCode: 'NBLWTEAM7---UGA01',
        organisationId: 'uganda',
        organisationCode: 'UGA',
      }),
    ];

    const observations = parseOfficialDetailPayload({
      phaseResults: [{
        unitStatus: 'COMPLETE',
        startDate: '2026-07-25T15:00:00Z',
        endDate: '2026-07-25T16:45:00Z',
        versus: { teamResult: laterCompetitors },
      }, {
        unitStatus: 'COMPLETE',
        startDate: '2026-07-25T08:00:00Z',
        endDate: '2026-07-25T09:45:00Z',
        versus: { teamResult: completedCompetitors },
      }],
    }, completedRequest);

    expect(observations).toHaveLength(2);
    expect(observations[0]).toEqual(expect.objectContaining({
      providerMatchCode: 'NBLWTEAM7-------------GPB-000100--',
      status: 'COMPLETED',
      resultQuality: 'OFFICIAL_FINAL',
      sideAOrganisationCode: 'NZL',
      sideBOrganisationCode: 'SCO',
      sideAScore: 74,
      sideBScore: 44,
    }));
    expect(observations[1].providerMatchCode)
      .toBe('NBLWTEAM7-------------GPB-000200--');
  });

  it('rejects a validly shaped result outside the requested session window', () => {
    const payload = liveDetailPayload();
    payload.phaseResults[0].startDate = '2026-07-27T08:00:00Z';
    payload.phaseResults[0].endDate = '2026-07-27T09:45:00Z';

    expect(() => parseOfficialDetailPayload(payload, request()))
      .toThrow('falls outside the requested session and phase window');
  });

  it('accepts a real multi-match session whose final result ends after the session envelope', () => {
    const payload = liveDetailPayload();
    payload.phaseResults[0].startDate = '2026-07-26T10:00:00Z';
    payload.phaseResults[0].endDate = '2026-07-26T11:45:00Z';

    expect(() => parseOfficialDetailPayload(payload, request({
      phaseStartDate: '2026-07-26T10:00:00Z',
    }))).not.toThrow();
  });

  it('rejects a malformed score', () => {
    const payload = liveDetailPayload();
    payload.phaseResults[0].versus.teamResult[0].result = '53.5';
    expect(() => parseOfficialDetailPayload(payload, request()))
      .toThrow('result must be a non-negative integer');
  });

  it('rejects a discipline mismatch', () => {
    const payload = liveDetailPayload();
    payload.phaseResults[0].versus.teamResult[0].disciplineCode = 'ATH';
    expect(() => parseOfficialDetailPayload(payload, request()))
      .toThrow('disciplineCode does not match the detail request');
  });

  it('requires exactly two team competitors', () => {
    const payload = liveDetailPayload();
    payload.phaseResults[0].versus.teamResult.splice(1);
    expect(() => parseOfficialDetailPayload(payload, request()))
      .toThrow('teamResult must contain exactly two competitors');
  });

  it('requires canonical side orders 1 and 2', () => {
    const payload = liveDetailPayload();
    payload.phaseResults[0].versus.teamResult[0].startOrder = '3';
    payload.phaseResults[0].versus.teamResult[1].startOrder = '2';

    expect(() => parseOfficialDetailPayload(payload, request()))
      .toThrow('must use startOrder values 1 and 2');
  });

  it('never converts UPCOMING scores and quarantines unknown statuses', () => {
    const upcoming = liveDetailPayload();
    upcoming.phaseResults[0].unitStatus = 'UPCOMING';
    upcoming.phaseResults[0].versus.teamResult[0].result = '999';
    expect(parseOfficialDetailPayload(upcoming, request({
      sessionStatus: 'UPCOMING',
      phaseStatus: 'UPCOMING',
    }))).toEqual([]);

    const unknown = liveDetailPayload();
    unknown.phaseResults[0].unitStatus = 'PAUSED';
    expect(() => parseOfficialDetailPayload(unknown, request()))
      .toThrow('unitStatus is not an authoritative result status');
  });

  it('skips the official pre-start LIVE shell until both scores become authoritative', () => {
    const gettingReady = liveDetailPayload();
    for (const team of gettingReady.phaseResults[0].versus.teamResult) {
      team.result = null as unknown as string;
      team.resultStatus = 'GETTING_READY';
      team.resultType = null as unknown as string;
    }

    expect(parseOfficialDetailPayload(gettingReady, request())).toEqual([]);

    gettingReady.phaseResults[0].versus.teamResult[0].result = '0';
    gettingReady.phaseResults[0].versus.teamResult[0].resultStatus = 'RUNNING';
    gettingReady.phaseResults[0].versus.teamResult[0].resultType = 'POINTS';
    expect(() => parseOfficialDetailPayload(gettingReady, request()))
      .toThrow('must not mix getting-ready and authoritative score states');
  });

  it('rejects incomplete discovery and empty selected result coverage', () => {
    expect(() => parseOfficialSessionsPayload({
      ...liveSessionsPayload,
      excludedSessionsCount: 1,
    })).toThrow('excludedSessionsCount must be 0');

    expect(() => parseOfficialSessionsPayload({
      ...liveSessionsPayload,
      pageInfo: {
        ...liveSessionsPayload.pageInfo,
        numPages: 2,
        numEntries: 2,
      },
    })).toThrow('must not advertise an unfetched page');

    expect(() => parseOfficialDetailPayload(
      { phaseResults: [] },
      request(),
    )).toThrow('must contain an authoritative result for the selected phase');
  });

  it('builds encoded official URLs with the required filters', () => {
    const sessionsUrl = new URL(officialSessionsUrl('2026-07-26'));
    expect(`${sessionsUrl.origin}${sessionsUrl.pathname}`).toBe(
      `${COMMONWEALTH_SPORT_CWG_BASE_URL}/competitions/`
        + `${GLASGOW_2026_COMPETITION_ID}/sessions`,
    );
    expect(Object.fromEntries(sessionsUrl.searchParams)).toEqual({
      sessionDate: '2026-07-26',
      size: '200',
      disciplineCodes: 'NBL',
    });

    const detailUrl = new URL(officialPhaseDetailUrl(request({
      sessionId: 'session/id',
      eventCode: 'TEAM 7/&',
      phaseCode: 'GP B-',
      genderCode: 'W+',
    })));
    expect(detailUrl.pathname).toContain('/session/session%2Fid/details');
    expect(Object.fromEntries(detailUrl.searchParams)).toEqual({
      eventCode: 'TEAM 7/&',
      phaseCode: 'GP B-',
      genderCode: 'W+',
      disciplineCode: 'NBL',
    });

    const customBaseUrl = 'https://official-feed.example.test/provider/v1/';
    expect(officialSessionsUrl('2026-07-26', { baseUrl: customBaseUrl }).startsWith(
      'https://official-feed.example.test/provider/v1/competitions/',
    )).toBe(true);
    expect(officialPhaseDetailUrl(request(), { baseUrl: customBaseUrl }).startsWith(
      'https://official-feed.example.test/provider/v1/competitions/',
    )).toBe(true);
    expect(() => officialSessionsUrl('2026-07-26', {
      baseUrl: 'http://official-feed.example.test/provider',
    })).toThrow('baseUrl must use HTTPS');
    expect(() => officialSessionsUrl('2026-07-26', {
      baseUrl: 'https://user:secret@official-feed.example.test/provider',
    })).toThrow('baseUrl must not contain credentials');
  });

  it('uses injected fetch, no-store, and bounded timeout/error handling', async () => {
    const fetchImpl = vi.fn(async () => new Response(
      JSON.stringify(liveSessionsPayload),
      { status: 200 },
    ));
    await expect(fetchOfficialSessions('2026-07-26', { fetchImpl }))
      .resolves.toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledWith(
      officialSessionsUrl('2026-07-26'),
      expect.objectContaining({
        cache: 'no-store',
        signal: expect.any(AbortSignal),
      }),
    );

    const hangingFetch = vi.fn((_url: string, init: RequestInit) => (
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      })
    ));
    await expect(fetchOfficialSessions('2026-07-26', {
      fetchImpl: hangingFetch,
      timeoutMs: 5,
    })).rejects.toThrow('timed out after 5ms');

    const failedFetch = vi.fn(async () => new Response('unavailable', { status: 503 }));
    await expect(fetchOfficialSessions('2026-07-26', { fetchImpl: failedFetch }))
      .rejects.toThrow('failed with HTTP 503');
  });

  it('binds session discovery to the requested Europe/London date', async () => {
    const wrongDay = structuredClone(liveSessionsPayload);
    wrongDay.sessions[0].startDate = '2026-07-27T08:00:00Z';
    wrongDay.sessions[0].endDate = '2026-07-27T11:30:00Z';
    for (const phase of wrongDay.sessions[0].sessionEventPhases) {
      phase.startDate = phase.startDate.replace('2026-07-26', '2026-07-27');
    }
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(wrongDay)));

    await expect(fetchOfficialSessions('2026-07-26', { fetchImpl }))
      .rejects.toThrow(
        'must fall on requested Europe/London date 2026-07-26',
      );
  });

  it('honours an already-aborted caller signal', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchImpl = vi.fn(async () => new Response('{}'));
    await expect(fetchOfficialSessions('2026-07-26', {
      fetchImpl,
      signal: controller.signal,
    })).rejects.toThrow('request aborted');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('caps concurrent phase-detail requests at two', async () => {
    const sessions = [0, 1, 2].map((index) => {
      const session = structuredClone(liveSessionsPayload.sessions[0]);
      session.id = `session-${index}`;
      session.endDate = '2026-07-26T13:00:00Z';
      session.sessionEventPhases = [{
        ...session.sessionEventPhases[1],
        startDate: `2026-07-26T${String(8 + index).padStart(2, '0')}:00:00Z`,
      }];
      return session;
    });
    const discovery = {
      pageInfo: { page: 0, numPages: 1, pageSize: 3, numEntries: 3 },
      excludedSessionsCount: 0,
      sessions,
    };
    let activeDetails = 0;
    let maxActiveDetails = 0;
    const fetchImpl = vi.fn(async (input: string) => {
      const url = new URL(input);
      if (url.pathname.endsWith('/sessions')) {
        return new Response(JSON.stringify(discovery));
      }
      activeDetails += 1;
      maxActiveDetails = Math.max(maxActiveDetails, activeDetails);
      await new Promise((resolve) => setTimeout(resolve, 5));
      const sessionId = url.pathname.split('/session/')[1].split('/')[0];
      const index = Number(sessionId.split('-')[1]);
      const payload = liveDetailPayload();
      payload.phaseResults[0].startDate =
        `2026-07-26T${String(8 + index).padStart(2, '0')}:00:00Z`;
      payload.phaseResults[0].endDate = `2026-07-26T${10 + index}:00:00Z`;
      for (const team of payload.phaseResults[0].versus.teamResult) {
        team.code = `NBL-MATCH-${index}`;
        team.id = `${team.id}-${index}`;
      }
      activeDetails -= 1;
      return new Response(JSON.stringify(payload));
    });

    await expect(fetchOfficialObservationsForDate('2026-07-26', { fetchImpl }))
      .resolves.toHaveLength(3);
    expect(maxActiveDetails).toBe(2);
  });

  it('stops scheduling detail requests after the first failure and drains in-flight work', async () => {
    const sessions = [0, 1, 2, 3].map((index) => {
      const session = structuredClone(liveSessionsPayload.sessions[0]);
      session.id = `session-${index}`;
      session.endDate = '2026-07-26T14:00:00Z';
      session.sessionEventPhases = [{
        ...session.sessionEventPhases[1],
        startDate: `2026-07-26T${String(8 + index).padStart(2, '0')}:00:00Z`,
      }];
      return session;
    });
    const discovery = {
      pageInfo: { page: 0, numPages: 1, pageSize: 4, numEntries: 4 },
      excludedSessionsCount: 0,
      sessions,
    };
    const requestedDetails: string[] = [];
    const fetchImpl = vi.fn(async (input: string) => {
      const url = new URL(input);
      if (url.pathname.endsWith('/sessions')) {
        return new Response(JSON.stringify(discovery));
      }
      const sessionId = url.pathname.split('/session/')[1].split('/')[0];
      requestedDetails.push(sessionId);
      if (sessionId === 'session-0') {
        await new Promise((resolve) => setTimeout(resolve, 1));
        return new Response('unavailable', { status: 503 });
      }
      await new Promise((resolve) => setTimeout(resolve, 15));
      return new Response(JSON.stringify(liveDetailPayload()));
    });

    await expect(fetchOfficialObservationsForDate('2026-07-26', { fetchImpl }))
      .rejects.toThrow('failed with HTTP 503');
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(requestedDetails).toEqual(['session-0', 'session-1']);
  });

  it('formats the provider startDate as a Europe/London BST match prefix', () => {
    expect(londonMatchTimePrefix('2026-07-26T08:00:00Z'))
      .toBe('2026-07-26-0900-');
  });
});
