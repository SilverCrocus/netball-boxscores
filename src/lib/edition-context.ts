export interface EditionContextValue {
  id: string;
  competitionSlug: string;
  competitionName: string;
  editionSlug: string;
  editionLabel: string;
  sourceTimezone: string;
}

export interface EditionContextSource {
  id: string;
  series: { slug: string; name: string } | null;
  slug: string | null;
  label: string | null;
  season: number;
  sourceTimezone: string;
}

export function toEditionContext(edition: EditionContextSource): EditionContextValue {
  if (!edition.series || !edition.slug) {
    throw new Error(`Competition edition ${edition.id} has no public route identity`);
  }

  return {
    id: edition.id,
    competitionSlug: edition.series.slug,
    competitionName: edition.series.name,
    editionSlug: edition.slug,
    editionLabel: edition.label ?? String(edition.season),
    sourceTimezone: edition.sourceTimezone,
  };
}

export function toEditionContexts(editions: readonly EditionContextSource[]): EditionContextValue[] {
  return editions.flatMap((edition) =>
    edition.series && edition.slug ? [toEditionContext(edition)] : []
  );
}
