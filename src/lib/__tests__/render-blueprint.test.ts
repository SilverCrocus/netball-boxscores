import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const blueprint = readFileSync(resolve(process.cwd(), 'render.yaml'), 'utf8');
const supportedRegions = ['oregon', 'ohio', 'virginia', 'frankfurt', 'singapore'];

describe('Render production blueprint', () => {
  it('uses the immutable region of the existing CentrePass service', () => {
    const region = blueprint.match(/^\s+region:\s+([^\s#]+)\s*$/m)?.[1];

    expect(region).toBe('oregon');
    expect(supportedRegions).toContain(region);
  });

  it('runs migrations before the new application process starts', () => {
    expect(blueprint).toContain('preDeployCommand: npm run db:migrate:deploy');
    expect(blueprint).toContain('healthCheckPath: /api/health');
  });
});
