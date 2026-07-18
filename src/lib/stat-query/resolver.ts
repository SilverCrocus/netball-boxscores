import { metricCatalogue, type MetricDefinition } from '@/lib/analytics';
import { editDistance, normalizeStatQuestion } from '@/lib/stat-query/normalize';
import type { EditionCandidate, EntityCandidate, ScopeCandidate } from '@/lib/stat-query/types';

function containsPhrase(question: string, phrase: string): boolean {
  if (phrase.length < 2) return false;
  return new RegExp(`(^|\\s)${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=\\s|$)`).test(question);
}

function fuzzyPhrase(question: string, alias: string): boolean {
  if (alias.length < 5) return false;
  const aliasWords = alias.split(' ');
  const words = question.split(' ');
  const threshold = alias.length >= 10 ? 2 : 1;
  for (let index = 0; index <= words.length - aliasWords.length; index += 1) {
    if (editDistance(words.slice(index, index + aliasWords.length).join(' '), alias) <= threshold) return true;
  }
  return false;
}

export function resolveEntities(question: string, candidates: readonly EntityCandidate[]): EntityCandidate[] {
  const normalized = normalizeStatQuestion(question);
  const exactScored = candidates.flatMap((candidate) => {
    const aliases = [candidate.name, ...candidate.aliases].map(normalizeStatQuestion).filter(Boolean);
    const exact = aliases.filter((alias) => containsPhrase(normalized, alias)).toSorted((left, right) => right.length - left.length)[0];
    if (exact) return [{ candidate, score: 10_000 + exact.length, position: normalized.indexOf(exact) }];
    return [];
  });
  const scored = exactScored.length > 0 ? exactScored : candidates.flatMap((candidate) => {
    const fuzzy = [candidate.name, ...candidate.aliases].map(normalizeStatQuestion).find((alias) => fuzzyPhrase(normalized, alias));
    return fuzzy ? [{ candidate, score: 1_000 + fuzzy.length, position: Number.MAX_SAFE_INTEGER }] : [];
  });
  return scored.toSorted((left, right) => left.position - right.position || right.score - left.score || left.candidate.name.localeCompare(right.candidate.name)).map(({ candidate }) => candidate);
}

export function resolveEditions(question: string, candidates: readonly EditionCandidate[]): EditionCandidate[] {
  const normalized = normalizeStatQuestion(question);
  return candidates.filter((candidate) => [candidate.name, ...candidate.aliases]
    .map(normalizeStatQuestion)
    .some((alias) => containsPhrase(normalized, alias)));
}

export function resolveScopeCandidates(question: string, candidates: readonly ScopeCandidate[], competitionId: string): ScopeCandidate[] {
  const normalized = normalizeStatQuestion(question);
  return candidates.filter((candidate) => candidate.competitionId === competitionId && [candidate.name, ...candidate.aliases]
    .map(normalizeStatQuestion)
    .some((alias) => containsPhrase(normalized, alias) || fuzzyPhrase(normalized, alias)));
}

export function resolveMetrics(question: string): MetricDefinition[] {
  const normalized = normalizeStatQuestion(question);
  const direct = metricCatalogue.filter((metric) => [metric.displayName, metric.id.replaceAll('_', ' '), ...metric.aliases]
    .map(normalizeStatQuestion)
    .filter((alias) => alias.length >= 3)
    .some((alias) => containsPhrase(normalized, alias)))
    .filter((metric, index, all) => all.findIndex((candidate) => candidate.id === metric.id) === index)
    .toSorted((left, right) => {
      const leftLength = Math.max(...left.aliases.map((alias) => normalizeStatQuestion(alias).length), normalizeStatQuestion(left.displayName).length);
      const rightLength = Math.max(...right.aliases.map((alias) => normalizeStatQuestion(alias).length), normalizeStatQuestion(right.displayName).length);
      return rightLength - leftLength;
    });
  if (direct.length > 0) return direct;
  return metricCatalogue.filter((metric) => [metric.displayName, metric.id.replaceAll('_', ' '), ...metric.aliases]
    .map(normalizeStatQuestion)
    .some((alias) => fuzzyPhrase(normalized, alias)));
}
