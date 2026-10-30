import { afterEach, describe, expect, it, vi } from 'vitest';
import { startCatalogMaintenance } from '../server/maintenance.js';

afterEach(() => vi.useRealTimers());

describe('常驻服务基础数据维护', () => {
  it('每15分钟检查过期状态，不为未过期来源发送刷新', async () => {
    vi.useFakeTimers();
    const service = { needsRefresh: vi.fn(() => false), refresh: vi.fn(async () => {}) };
    const stop = startCatalogMaintenance(service);
    await vi.advanceTimersByTimeAsync(15 * 60_000);
    expect(service.needsRefresh).toHaveBeenCalledTimes(1);
    expect(service.refresh).not.toHaveBeenCalled();
    service.needsRefresh.mockReturnValue(true);
    await vi.advanceTimersByTimeAsync(15 * 60_000);
    expect(service.refresh).toHaveBeenCalledTimes(1);
    stop();
  });
  it('停止后不再检查或刷新，不保留活动定时器', async () => {
    vi.useFakeTimers();
    const service = { needsRefresh: vi.fn(() => true), refresh: vi.fn(async () => {}) };
    const stop = startCatalogMaintenance(service);
    stop();
    await vi.advanceTimersByTimeAsync(6 * 3_600_000);
    expect(service.needsRefresh).not.toHaveBeenCalled();
    expect(service.refresh).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
