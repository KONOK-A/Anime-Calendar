import { expect, it } from 'vitest';
import { normalizeCatalog } from '../server/normalize.js';
import { rawCatalog } from './fixtures.js';
it('评分外部ID仅接受sites中明确的正整数', () => {
  const input = { ...rawCatalog, items: [{ ...rawCatalog.items[0], sites: [{ site: 'bangumi', id: '1' }, { site: 'myanimelist', id: '61234' }, { site: 'anilist', id: '178901' }] }] };
  expect(normalizeCatalog(input).items[0]?.externalIds).toEqual({ mal: 61234, aniList: 178901 });
  input.items[0]!.sites[1]!.id = '12.5'; input.items[0]!.sites[2]!.id = '0';
  expect(normalizeCatalog(input).items[0]?.externalIds).toBeUndefined();
});
