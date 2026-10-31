import { expect, it } from 'vitest';
import { SeasonRatingService } from '../server/season-ratings.js';
import type { Anime, AnimeDetail } from '../shared/types.js';
import { summarizeRatings } from '../shared/scores.js';
it('相同季度与作品ID补齐外站关联后不复用旧的无分排序快照', async () => {
  const item = { id: 'bgm:1', bangumiId: 1 } as Anime;
  let id: number | undefined, reads = 0;
  const service = new SeasonRatingService(async () => ({ id: item.id, rating: null, detailFetchedAt: '2026-10-31T00:00:00Z', detailError: null }) as AnimeDetail, () => new Date('2026-10-31T01:00:00Z'), {
    summary: async () => { reads++; return summarizeRatings([{ provider: 'mal', score: id ? 8.64 : null, maxScore: 10, votes: id ? 100 : null, url: id ? `https://myanimelist.net/anime/${id}` : null, fetchedAt: id ? '2026-10-31T00:00:00Z' : null, status: id ? 'ready' : 'unlinked' }]); },
  });
  service.get('2026-4', [item]); await service.drain();
  expect(service.get('2026-4', [item]).entries[0]?.summary?.score).toBeNull();
  id = 61987;
  service.get('2026-4', [{ ...item, externalIds: { mal: id } }]); await service.drain();
  expect(service.get('2026-4', [{ ...item, externalIds: { mal: id } }]).entries[0]?.summary?.score).toBe(8.6);
  expect(reads).toBe(2); service.close();
});
