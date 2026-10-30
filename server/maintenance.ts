import type { AnimeService } from './service.js';

/** A persistent server checks the existing six-hour freshness rule, not the page. */
export function startCatalogMaintenance(service: Pick<AnimeService, 'needsRefresh' | 'refresh'> & Partial<Pick<AnimeService, 'maintain'>>) {
  const timer = setInterval(() => {
    void service.maintain?.().catch(error => console.error('缓存维护失败。', error instanceof Error ? error.name : 'UnknownError'));
    if (service.needsRefresh()) void service.refresh('stale').catch(error => {
      console.error('基础目录维护任务失败。', error instanceof Error ? error.name : 'UnknownError');
    });
  }, 15 * 60_000);
  timer.unref();
  return () => clearInterval(timer);
}
