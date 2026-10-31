export const rawCatalog = {
  siteMeta: {
    bangumi: { title: 'Bangumi', type: 'info', urlTemplate: 'https://bgm.tv/subject/{{id}}' },
    bilibili: { title: '哔哩哔哩', type: 'onair', urlTemplate: 'https://www.bilibili.com/bangumi/media/md{{id}}', regions: ['CN'] },
    resource: { title: '资源站', type: 'resource', urlTemplate: 'https://example.com/{{id}}' },
  },
  items: [{
    title: 'テストの旅', titleTranslate: { 'zh-Hans': ['星旅', '星之旅'], en: ['A journey'] },
    type: 'tv', lang: 'ja', officialSite: 'https://example.com/anime',
    begin: '2026-10-19T15:30:00Z', broadcast: 'R/2026-10-19T15:30:00Z/P7D', end: '',
    sites: [{ site: 'bangumi', id: '1' }, { site: 'bilibili', id: '10', url: 'https://www.bilibili.com/bangumi/play/ss10', regions: ['TW'], begin: '2026-10-19T15:30:00Z', broadcast: 'R/2026-10-19T15:30:00Z/P7D' }, { site: 'resource', id: '1' }],
  }, {
    title: '帰り道', titleTranslate: {}, type: 'web', lang: 'ja', officialSite: '',
    begin: '2026-10-30T10:00:00Z', broadcast: 'R/2026-10-30T10:00:00Z/P0D', end: '',
    sites: [{ site: 'bangumi', id: '2' }],
  }],
};

export const rawCalendar = [{ weekday: { id: 1, cn: '星期一' }, items: [{ id: 1, type: 2 }] }];
