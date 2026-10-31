export type Adaptation = '漫改' | '小说改' | '原创' | '游戏改';
const labels: Record<string, Adaptation> = {
  漫改: '漫改', 漫画改: '漫改', 漫画改编: '漫改', 漫畫改: '漫改', 漫畫改編: '漫改',
  小说改: '小说改', 小说改编: '小说改', 小說改: '小说改', 小說改編: '小说改', 轻小说改: '小说改', 轻小说改编: '小说改', 轻改: '小说改',
  原创: '原创', 原創: '原创', オリジナル: '原创',
  游戏改: '游戏改', 游戏改编: '游戏改', 遊戲改: '游戏改', 遊戲改編: '游戏改', galgame改: '游戏改',
};
export function adaptationFromTags(tags: readonly (string | { name: string; count?: number })[]): Adaptation | null {
  const votes = new Map<Adaptation, number>();
  for (const tag of tags) {
    const name = (typeof tag === 'string' ? tag : tag.name).normalize('NFKC').trim().toLowerCase();
    const label = labels[name]; if (!label) continue;
    const count = typeof tag === 'string' || !Number.isFinite(tag.count) || Number(tag.count) <= 0 ? 1 : Number(tag.count);
    votes.set(label, Math.max(votes.get(label) ?? 0, count));
  }
  const sorted = [...votes].sort((a, b) => b[1] - a[1]);
  if (!sorted.length || sorted.length > 1 && sorted[0]![1] < sorted[1]![1] * 2) return null;
  return sorted[0]![0];
}
