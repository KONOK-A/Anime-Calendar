import { describe, expect, it } from 'vitest';
import { infoboxStaff, normalizeStaff, normalizeCast, mergeStaff } from '../server/credits.js';
import { splitSynopsis } from '../shared/synopsis.js';

describe('制作与角色配音资料', () => {
  it('提取主创信息，兼容条目字符串/数组；不把制作委员会当动画制作', () => {
    expect(infoboxStaff([
      { key: '监督', value: '道解慎太郎' },
      { key: '人物原案', value: [{ v: '人设甲' }, { k: '原案', v: '人设乙' }] },
      { key: '人物设定', value: '动画人设甲' },
      { key: '音乐', value: 'ha-j' },
      { key: '动画制作', value: 'Studio PIERROT' },
      { key: '製作', value: '制作委员会' },
      { key: '背景美术', value: '一长串逐集制作人员' },
      { key: 'constructor', value: '不属于制作岗位' },
    ])).toEqual([
      { role: '导演', names: ['道解慎太郎'] },
      { role: '人设原案', names: ['人设甲', '人设乙'] },
      { role: '动画人设', names: ['动画人设甲'] },
      { role: '音乐', names: ['ha-j'] },
      { role: '动画制作', names: ['Studio PIERROT'] },
    ]);
  });
  it('人员接口补齐导演、编剧和公司，按职责去重并保留同人的不同职责', () => {
    expect(normalizeStaff([
      { id: 1, name: '导演甲', relation: '导演', type: 1 },
      { id: 1, name: '导演甲', relation: '监督', type: 1 },
      { id: 1, name: '导演甲', relation: '人物原案', type: 1 },
      { id: 2, name: '编剧乙', relation: '脚本', type: 1 },
      { id: 3, name: '制作公司', relation: '动画制作', type: 2 },
      { id: 4, name: '单集原画人员', relation: '原画', type: 1 },
      { id: 5, name: '无效岗位人员', relation: '__proto__', type: 1 },
    ])).toEqual([
      { role: '导演', names: ['导演甲'] }, { role: '编剧', names: ['编剧乙'] },
      { role: '人设原案', names: ['导演甲'] }, { role: '动画制作', names: ['制作公司'] },
    ]);
  });
  it('关联人员优先同职责，条目补充其未收录的职责，避免重复罗列', () => {
    expect(mergeStaff([{ role: '导演', names: ['原关联名'] }], [{ role: '导演', names: ['同人别名'] }, { role: '音乐', names: ['音乐家'] }])).toEqual([{ role: '导演', names: ['原关联名'] }, { role: '音乐', names: ['音乐家'] }]);
  });
  it('主角优先再配角，角色对应多个演员去重；无CV保留未收录状态，排除闲角和旁白', () => {
    expect(normalizeCast([
      { id: 2, name: '配角乙', relation: '配角', actors: [{ id: 12, name: '声优乙' }, { id: 12, name: '声优乙' }] },
      { id: 1, name: '主角甲', relation: '主角', actors: [{ id: 10, name: '声优甲' }, { id: 11, name: '少年声优甲' }] },
      { id: 3, name: '配角丙', relation: '配角', actors: [] },
      { id: 4, name: '无关角色', relation: '闲角', actors: [{ id: 13, name: '不应被误匹配' }] },
      { id: 5, name: '旁白', relation: '旁白', actors: [{ id: 14, name: '旁白声优' }] },
    ])).toEqual([
      { id: 1, name: '主角甲', relation: '主角', actors: [{ id: 10, name: '声优甲' }, { id: 11, name: '少年声优甲' }] },
      { id: 2, name: '配角乙', relation: '配角', actors: [{ id: 12, name: '声优乙' }] },
      { id: 3, name: '配角丙', relation: '配角', actors: [] },
    ]);
  });
  it('明确的空列表有效，错误结构不伪装成没有资料', () => {
    expect(normalizeStaff([])).toEqual([]); expect(normalizeCast([])).toEqual([]);
    expect(() => normalizeStaff({ error: 'offline' })).toThrow();
    expect(() => normalizeCast({ error: 'offline' })).toThrow();
  });
});

describe('原文简介折叠拆分', () => {
  it('按独立原文标记拆分中日简介，兼容CRLF与多余空行', () => {
    expect(splitSynopsis('中文简介。\r\n\r\n[简介原文]\r\n原文の物語。')).toEqual({ summary: '中文简介。', original: '原文の物語。' });
    expect(splitSynopsis('译文\n【日文原文】\n物語')).toEqual({ summary: '译文', original: '物語' });
  });
  it('没有标记不猜测语言，只有原文标记也不会丢掉内容', () => {
    expect(splitSynopsis('中文里的角色名（ロメリア）保留。')).toEqual({ summary: '中文里的角色名（ロメリア）保留。', original: '' });
    expect(splitSynopsis('物語の日本語简介')).toEqual({ summary: '物語の日本語简介', original: '' });
    expect(splitSynopsis('[简介原文]\n原文の物語。')).toEqual({ summary: '', original: '原文の物語。' });
  });
});
