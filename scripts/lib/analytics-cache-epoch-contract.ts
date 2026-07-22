export function hasExactEmptySearchPath(config: readonly string[] | null): boolean {
  return config?.length === 1 && config[0] === 'search_path=""';
}
