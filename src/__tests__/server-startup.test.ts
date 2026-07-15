import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const prepare = vi.fn<() => Promise<void>>();
  const requestHandler = vi.fn();
  const next = vi.fn(() => ({
    prepare,
    getRequestHandler: vi.fn(() => requestHandler),
  }));

  const expressApp = {
    set: vi.fn(),
    use: vi.fn(),
    all: vi.fn(),
  };
  const express = vi.fn(() => expressApp);

  const httpServer = {
    listen: vi.fn((_port: number, callback: () => void) => callback()),
    close: vi.fn((callback?: () => void) => callback?.()),
  };
  const createServer = vi.fn(() => httpServer);

  return {
    prepare,
    next,
    express,
    expressApp,
    httpServer,
    createServer,
    initSocketServer: vi.fn(() => ({})),
    startWorker: vi.fn<() => Promise<void>>(),
    stopWorker: vi.fn(),
    cleanupOrphanedSimData: vi.fn<() => Promise<number>>(),
  };
});

vi.mock('next', () => ({ default: mocks.next }));
vi.mock('express', () => ({ default: mocks.express }));
vi.mock('http', () => ({
  default: { createServer: mocks.createServer },
  createServer: mocks.createServer,
}));
vi.mock('@/lib/socket-server', () => ({ initSocketServer: mocks.initSocketServer }));
vi.mock('@/lib/worker', () => ({
  startWorker: mocks.startWorker,
  stopWorker: mocks.stopWorker,
}));
vi.mock('@/lib/simulation/sim-routes', () => ({ simRouter: {} }));
vi.mock('@/lib/simulation/engine', () => ({
  cleanupOrphanedSimData: mocks.cleanupOrphanedSimData,
}));

describe('custom server worker wiring', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('SIMULATION_MODE', 'false');
    vi.stubEnv('PORT', '3199');
    vi.stubEnv('WORKER_ENABLED', undefined);
    vi.stubEnv('DATABASE_ENVIRONMENT', undefined);

    mocks.prepare.mockResolvedValue(undefined);
    mocks.startWorker.mockResolvedValue(undefined);
    mocks.cleanupOrphanedSimData.mockResolvedValue(0);
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('does not call the worker for a default development start', async () => {
    await import('../../server');
    await vi.waitFor(() => expect(mocks.httpServer.listen).toHaveBeenCalledOnce());

    expect(mocks.startWorker).not.toHaveBeenCalled();
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('starts the explicitly enabled production worker once without delaying listen', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('WORKER_ENABLED', 'true');
    vi.stubEnv('DATABASE_ENVIRONMENT', 'production');
    mocks.startWorker.mockReturnValue(new Promise(() => undefined));

    await import('../../server');
    await vi.waitFor(() => expect(mocks.httpServer.listen).toHaveBeenCalledOnce());

    expect(mocks.startWorker).toHaveBeenCalledOnce();
    expect(console.log).toHaveBeenCalledWith('[Server] Background worker starting');
    expect(console.log).not.toHaveBeenCalledWith('[Server] Background worker started');
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('exits after listen when the required worker rejects', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('WORKER_ENABLED', 'true');
    vi.stubEnv('DATABASE_ENVIRONMENT', 'production');
    mocks.startWorker.mockRejectedValue(new Error('startup failed'));

    await import('../../server');
    await vi.waitFor(() => expect(exitSpy).toHaveBeenCalledWith(1));

    expect(mocks.httpServer.listen).toHaveBeenCalledOnce();
    expect(mocks.startWorker).toHaveBeenCalledOnce();
    expect(mocks.stopWorker).toHaveBeenCalledOnce();
    expect(mocks.httpServer.close).toHaveBeenCalledOnce();
    expect(console.log).toHaveBeenCalledWith('[Server] Background worker starting');
    expect(console.log).not.toHaveBeenCalledWith('[Server] Background worker started');
  });

  it('mounts simulation only for an enabled worker with disposable test data', async () => {
    vi.stubEnv('SIMULATION_MODE', 'true');
    vi.stubEnv('WORKER_ENABLED', 'true');
    vi.stubEnv('DATABASE_ENVIRONMENT', 'test');

    await import('../../server');
    await vi.waitFor(() => expect(mocks.httpServer.listen).toHaveBeenCalledOnce());

    expect(mocks.expressApp.use).toHaveBeenCalledWith('/api/sim', {});
    expect(mocks.cleanupOrphanedSimData).toHaveBeenCalledOnce();
    expect(mocks.startWorker).toHaveBeenCalledOnce();
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('does not mount or clean simulation data while the worker is disabled', async () => {
    vi.stubEnv('SIMULATION_MODE', 'true');

    await import('../../server');
    await vi.waitFor(() => expect(mocks.httpServer.listen).toHaveBeenCalledOnce());

    expect(mocks.startWorker).not.toHaveBeenCalled();
    expect(mocks.expressApp.use).not.toHaveBeenCalled();
    expect(mocks.cleanupOrphanedSimData).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledWith(
      '[Server] SIMULATION_MODE is set but ignored because WORKER_ENABLED is not true',
    );
  });

  it('blocks simulation on production data even with shared writes acknowledged', async () => {
    vi.stubEnv('SIMULATION_MODE', 'true');
    vi.stubEnv('WORKER_ENABLED', 'true');
    vi.stubEnv('DATABASE_ENVIRONMENT', 'production');
    vi.stubEnv('ALLOW_SHARED_PRODUCTION_DB_WRITES', 'true');

    await import('../../server');
    await vi.waitFor(() => expect(exitSpy).toHaveBeenCalledWith(1));

    expect(mocks.express).not.toHaveBeenCalled();
    expect(mocks.cleanupOrphanedSimData).not.toHaveBeenCalled();
    expect(mocks.startWorker).not.toHaveBeenCalled();
    expect(mocks.httpServer.listen).not.toHaveBeenCalled();
  });
});
