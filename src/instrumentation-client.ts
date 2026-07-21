import {
  markClientNavigationStart,
} from './lib/client-navigation-timing';

export function onRouterTransitionStart(
  url: string,
  navigationType: 'push' | 'replace' | 'traverse',
): void {
  markClientNavigationStart(url, navigationType);
}
