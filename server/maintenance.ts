import type { AnimeService } from './service.js';

/** A persistent server checks the existing six-hour freshness rule, not the page. */
export function startCatalogMaintenance(service: Pick<AnimeService, 'needsRefresh' | 'refresh'>) {
  const timer = setInterval(() => {
    if (service.needsRefresh()) void service.refresh().catch(error => {
      console.error('基础目录维护任务失败。', error instanceof Error ? error.name : 'UnknownError');
    });
  }, 15 * 60_000);
  timer.unref();
  return () => clearInterval(timer);
}
