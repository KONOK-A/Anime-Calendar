import express from 'express';
import type { AnimeService } from './service.js';
import { basename } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { catalogScope, catalogTimeEpoch, projectCatalog } from './catalog-view.js';
import { PosterError } from './posters.js';
import { UpstreamError } from './upstream.js';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ServerResponse } from 'node:http';
import { assetHtml, staticAssetPath } from './static-assets.js';
export function createApp(service: AnimeService, staticDirectory: string, options: { publicOrigin?: string; assetOrigin?: string; assetsDirectory?: string; observe?: (event: Record<string, unknown>) => void } = {}) {
  const app = express(); app.disable('x-powered-by');
  const publicOrigin = options.publicOrigin, publicHost = publicOrigin ? new URL(publicOrigin).host : undefined;
  let lastManualRefresh: number | undefined;
  const responses = new Map<string, { body: string; etag: string }>(); let previousEpoch = '';
  app.use((req, res, next) => {
    const requestId = randomUUID(), started = performance.now(); res.setHeader('X-Request-ID', requestId);
    res.on('finish', () => options.observe?.({ event: 'http', requestId, method: req.method, route: String(req.route?.path ?? (req.path.startsWith('/api') ? '/api/unknown' : '/static')), status: res.statusCode, durationMs: Math.round((performance.now() - started) * 100) / 100, cache: res.getHeader('X-Cache') ?? null }));
    next();
  });
  app.use((req, res, next) => {
    if (req.headers['x-anime-static-origin'] !== undefined && (!staticAssetPath(req.path) || !['GET', 'HEAD'].includes(req.method))) { res.setHeader('Cache-Control', 'no-store'); res.status(404).end(); return; }
    next();
  });
  app.use(['/api', '/media'], (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    const allowedHost = publicHost ? req.headers.host?.toLowerCase() === publicHost : req.hostname === '127.0.0.1';
    if (!allowedHost) { res.status(403).json({ error: publicOrigin ? '请通过本站地址访问。' : '请从本机固定地址访问。' }); return; }
    const expectedOrigin = publicOrigin ?? `http://${req.headers.host}`;
    const readOnly = req.method === 'GET' || req.method === 'HEAD';
    if (!readOnly && ((publicOrigin && !req.headers.origin) || (req.headers.origin && req.headers.origin !== expectedOrigin))) { res.status(403).json({ error: '仅允许同源操作。' }); return; }
    next();
  });
  app.use(express.json({ limit: '8kb' }));
  app.get('/api/status', (_req, res) => res.json(service.status()));
  app.get('/media/posters/:id/:size', async (req, res) => {
    try {
      const data = await service.posters.get(req.params.id, req.params.size);
      res.setHeader('Cache-Control', data.cache === 'memory' ? 'no-store' : 'public, max-age=86400');
      res.setHeader('ETag', data.etag); res.setHeader('X-Cache', data.cache); res.setHeader('X-Content-Type-Options', 'nosniff');
      if (req.headers['if-none-match']?.split(',').some(value => value.trim().replace(/^W\//, '') === data.etag || value.trim() === '*')) { res.status(304).end(); return; }
      res.type(data.contentType).send(data.bytes);
    } catch (error) {
      const status = error instanceof PosterError || error instanceof UpstreamError ? error.statusCode : 502;
      if (status === 502 || status === 503 || status === 504) res.setHeader('Retry-After', '60');
      res.status(status).json({ error: status === 404 ? '暂未收录封面。' : status === 400 ? '封面请求无效。' : '封面暂不可用，可稍后重试。' });
    }
  });
  app.get('/api/health/live', (_req, res) => res.json({ appId: 'anime-calendar', live: true }));
  app.get('/api/health/ready', (_req, res) => { const status = service.status(); res.status(status.hasCatalog ? 200 : 503).json({ appId: status.appId, ready: status.hasCatalog, degraded: Object.values(status.sources).some(source => !!source.error || !source.fetchedAt || Date.now() - Date.parse(source.fetchedAt) > 24 * 3_600_000) || status.warnings.some(warning => warning.includes('缓存')) }); });
  for (const type of ['weekly', 'season', 'items'] as const) app.get(`/api/catalog/${type}`, (req, res) => {
    const now = new Date().toISOString();
    let scope;
    try { scope = catalogScope(type, req.query, now); }
    catch (error) { res.status(400).json({ error: (error as Error).message }); return; }
    const snapshot = service.catalog();
    if (!snapshot) { res.status(503).json({ ...projectCatalog(null, service.status(null), scope, now), error: '尚无可用目录，请等待首次获取或手动重试。' }); return; }
    const epoch = `${service.epoch()}:${catalogTimeEpoch(snapshot, now)}`;
    if (epoch !== previousEpoch) { responses.clear(); previousEpoch = epoch; }
    let cached = responses.get(scope.key); res.setHeader('X-Cache', cached ? 'hit' : 'miss');
    if (!cached) {
      const body = JSON.stringify(projectCatalog(snapshot, service.status(snapshot), scope, now));
      cached = { body, etag: `W/"${createHash('sha256').update(body).digest('hex')}"` };
      responses.set(scope.key, cached); if (responses.size > 32) responses.delete(responses.keys().next().value!);
    }
    const { body, etag } = cached;
    res.setHeader('Cache-Control', 'private, max-age=0, must-revalidate'); res.setHeader('ETag', etag);
    const matches = req.headers['if-none-match']?.split(',').some(value => value.trim() === '*' || value.trim().replace(/^W\//, '') === etag.replace(/^W\//, ''));
    if (matches) { res.status(304).end(); return; }
    res.type('json').send(body);
  });
  app.get('/api/catalog', (_req, res) => { const data = service.catalog(); res.status(data ? 200 : 503).json(data ?? { error: '尚无可用目录，请等待首次获取或手动重试。' }); });
  app.get('/api/anime/:id', async (req, res) => { const data = await service.detail(req.params.id, req.query.wait === '1'); res.status(data ? 200 : 404).json(data ?? { error: '当前目录未收录该作品。' }); });
  app.get('/api/anime/:id/credits', async (req, res) => { const data = await service.credits(req.params.id, req.query.wait === '1'); res.status(data ? 200 : 404).json(data ?? { error: '当前目录未收录该作品。' }); });
  app.get('/api/anime/:id/character-names', async (req, res) => {
    const raw = req.query.offset ?? '0';
    if (typeof raw !== 'string' || !/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw))) { res.status(400).json({ error: '角色分页位置无效。' }); return; }
    const data = await service.characterNames(req.params.id, Number(raw), req.query.wait === '1'); res.status(data ? 200 : 404).json(data ?? { error: '当前目录未收录该作品。' });
  });
  app.post('/api/refresh', (_req, res) => {
    if (publicOrigin && !service.status().refreshing) {
      const now = Date.now(), remaining = lastManualRefresh === undefined ? 0 : 60_000 - (now - lastManualRefresh);
      if (remaining > 0) { res.setHeader('Retry-After', Math.ceil(remaining / 1000)); res.status(429).json({ error: '刷新过于频繁，请稍后重试。' }); return; }
      lastManualRefresh = now;
    }
    void service.refresh(); res.status(202).json(service.status());
  });
  app.use('/api', (_req, res) => res.status(404).json({ error: '接口不存在。' }));
  let html: Promise<string> | undefined;
  if (options.assetOrigin) app.get(['/', '/index.html'], async (_req, res) => {
    html ??= readFile(join(staticDirectory, 'index.html'), 'utf8').then(value => assetHtml(value, options.assetOrigin!));
    res.setHeader('Cache-Control', 'no-cache'); res.type('html').send(await html);
  });
  const staticHeaders = (res: ServerResponse, path: string) => {
    res.setHeader('Access-Control-Allow-Origin', publicOrigin ?? '*'); res.setHeader('X-Content-Type-Options', 'nosniff');
    if (/[\\/]assets[\\/]/.test(path) && /-[\w-]{8,}\.[\w]+$/.test(basename(path))) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    else if (basename(path) === 'index.html') res.setHeader('Cache-Control', 'no-cache');
    else if (/\.woff2$/.test(path)) res.setHeader('Cache-Control', 'public, max-age=86400');
  };
  app.use(express.static(staticDirectory, { maxAge: 0, setHeaders: staticHeaders }));
  if (options.assetsDirectory) {
    const retained = express.static(options.assetsDirectory, { maxAge: 0, setHeaders: staticHeaders });
    app.use((req, res, next) => staticAssetPath(req.path) ? retained(req, res, next) : next());
  }
  app.use((error: Error & { status?: number; statusCode?: number; type?: string }, req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (res.headersSent) { next(error); return; }
    const status = error.type === 'entity.parse.failed' ? 400 : error.type === 'entity.too.large' ? 413 : error.status === 415 ? 415 : 500;
    options.observe?.({ event: 'request_error', requestId: res.getHeader('X-Request-ID'), method: req.method, route: String(req.route?.path ?? '/api'), status, errorType: error.type ?? error.name });
    res.status(status).json({ error: status === 400 ? '请求格式无效。' : status === 413 ? '请求内容过大。' : status === 415 ? '请求编码不受支持。' : publicOrigin ? '服务处理失败，请稍后重试。' : '本地服务处理失败，请查看启动窗口。' });
  });
  return app;
}
