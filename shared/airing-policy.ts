import type { AiringRule, ReleaseKind, RuleOverride } from './types.js';

export const STREAMING_ACCESS_POLICY = 'exclude-member-advance-v1';

export function isMemberAdvance(value: { releaseKind?: ReleaseKind } | undefined): boolean {
  return value?.releaseKind === 'member-advance';
}

function sameCycle(rule: AiringRule, broadcast: string): boolean {
  if (rule.raw === broadcast) return true;
  const parts = broadcast.split('/');
  if (parts.length !== 3 || parts[0] !== 'R') return false;
  const frequencies = { P0D: 'once', P1D: 'daily', P7D: 'weekly' } as const;
  const frequency = frequencies[parts[2] as keyof typeof frequencies];
  if (!frequency || rule.frequency !== frequency) return false;
  const anchor = Date.parse(rule.anchor ?? ''), excluded = Date.parse(parts[1] ?? '');
  if (!Number.isFinite(anchor) || !Number.isFinite(excluded)) return false;
  const interval = frequency === 'weekly' ? 7 * 86_400_000 : frequency === 'daily' ? 86_400_000 : 0;
  return interval ? (anchor - excluded) % interval === 0 : anchor === excluded;
}

export function isEligibleNetwork(animeId: string, candidate: { sourceUrl: string; rule: AiringRule; releaseKind?: ReleaseKind }, overrides: readonly RuleOverride[] = []): boolean {
  if (isMemberAdvance(candidate)) return false;
  return !overrides.some(override => override.animeId === animeId && override.candidateExclusions?.some(exclusion => exclusion.sourceUrl === candidate.sourceUrl && (!exclusion.broadcast || sameCycle(candidate.rule, exclusion.broadcast))));
}
