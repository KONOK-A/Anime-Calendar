import express from 'express';
import type { AnimeService } from './service.js';
export function createApp(service: AnimeService, staticDirectory: string) {
  const app = express(); app.disable('x-powered-by');
  app.use('/api', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    if (req.hostname !== '127.0.0.1') { res.status(403).json({ error: '请从本机固定地址访问。' }); return; }
    if (req.method !== 'GET' && req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) { res.status(403).json({ error: '仅允许本地同源操作。' }); return; }
    next();
  });
  app.use(express.json({ limit: '8kb' }));
  app.get('/api/status', (_req, res) => res.json(service.status()));
  app.get('/api/catalog', (_req, res) => { const data = service.catalog(); res.status(data ? 200 : 503).json(data ?? { error: '尚无可用目录，请等待首次获取或手动重试。' }); });
  app.get('/api/anime/:id', async (req, res) => { const data = await service.detail(req.params.id); res.status(data ? 200 : 404).json(data ?? { error: '当前目录未收录该作品。' }); });
  app.get('/api/anime/:id/credits', async (req, res) => { const data = await service.credits(req.params.id); res.status(data ? 200 : 404).json(data ?? { error: '当前目录未收录该作品。' }); });
  app.get('/api/anime/:id/character-names', async (req, res) => {
    const raw = req.query.offset ?? '0';
    if (typeof raw !== 'string' || !/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw))) { res.status(400).json({ error: '角色分页位置无效。' }); return; }
    const data = await service.characterNames(req.params.id, Number(raw)); res.status(data ? 200 : 404).json(data ?? { error: '当前目录未收录该作品。' });
  });
  app.post('/api/refresh', (_req, res) => { void service.refresh(); res.status(202).json(service.status()); });
  app.use('/api', (_req, res) => res.status(404).json({ error: '接口不存在。' }));
  app.use(express.static(staticDirectory, { maxAge: 0 }));
  app.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => { res.status(500).json({ error: error instanceof SyntaxError ? '请求格式无效。' : '本地服务处理失败，请查看启动窗口。' }); });
  return app;
}
