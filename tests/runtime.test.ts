import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { runtimeConfig } from '../server/runtime.js';

describe('本机与服务器运行配置', () => {
  const root = resolve('test-runtime-root');
  it('默认仍使用项目内缓存，不启用公网模式', () => {
    expect(runtimeConfig({}, root)).toEqual({ publicOrigin: undefined, dataDirectory: resolve(root, '.local') });
  });
  it('显式HTTPS地址规范化为Origin，缓存支持独立绝对路径', () => {
    const dataDirectory = resolve('test-persistent-data');
    expect(runtimeConfig({ ANIME_CALENDAR_ORIGIN: 'https://anime.example.test/', ANIME_CALENDAR_DATA_DIR: dataDirectory }, root))
      .toEqual({ publicOrigin: 'https://anime.example.test', dataDirectory });
  });
  it('拒绝不安全或不是Origin的配置，不静默打开公网', () => {
    for (const publicOrigin of ['http://anime.example.test', 'https://user:password@anime.example.test', 'https://anime.example.test/path', 'https://anime.example.test/?token=x', 'https://anime.example.test/#section', 'not a url']) {
      expect(() => runtimeConfig({ ANIME_CALENDAR_ORIGIN: publicOrigin }, root)).toThrow();
    }
    expect(() => runtimeConfig({ ANIME_CALENDAR_DATA_DIR: './relative-cache' }, root)).toThrow();
  });
});
