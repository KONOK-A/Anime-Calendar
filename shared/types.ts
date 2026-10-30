export type Timezone = 'Asia/Shanghai' | 'Asia/Tokyo';
export interface Platform { name: string; url: string; regions: string[] }
export interface AiringRule { anchor: string | null; frequency: 'once' | 'daily' | 'weekly' | 'unsupported' | 'unknown'; raw: string; end: string | null }
export interface NetworkAiring { platform: string; regions: string[]; begin: string; rule: AiringRule; sourceUrl: string }
export interface Anime {
  id: string; bangumiId: number | null; title: string; originalTitle: string; aliases: string[];
  type: 'tv' | 'web'; begin: string; season: string; officialSite: string | null;
  platforms: Platform[]; rule: AiringRule; broadcastRule: AiringRule; networkAiring?: NetworkAiring; sourceUrl: string; scheduleNote?: string; scheduleSource?: string;
}
export interface EventOverride { animeId: string; originalAt?: string; at: string; status: 'scheduled' | 'cancelled'; sourceUrl: string; note?: string }
export interface RuleOverride { animeId: string; broadcast?: string; end?: string; dateOnly?: boolean; kind?: 'network' | 'broadcast'; platform?: string; regions?: string[]; sourceUrl: string; note: string }
export interface Overrides { version: 1; active: { animeId: string; active: boolean; sourceUrl: string }[]; events: EventOverride[]; rules?: RuleOverride[] }
export interface CatalogBase { items: Anime[]; warnings: string[] }
export interface CatalogSnapshot extends CatalogBase {
  schemaVersion: 1; activeIds: string[]; fetchedAt: { catalog: string | null; calendar: string | null }; overrides: Overrides;
}
export interface AiringEvent { animeId: string; at: string; basis: 'estimated' | 'source' | 'official'; status: 'scheduled' | 'cancelled'; sourceUrl: string; note?: string }
export interface AnimeRating { score: number; total: number; rank: number | null }
export interface SeasonRatingEntry { id: string; rating: AnimeRating | null; fetchedAt: string | null; error: string | null }
export interface SeasonRatings {
  schemaVersion: 1; scope: { type: 'ratings'; key: string; season: string }; ids: string[];
  entries: SeasonRatingEntry[]; total: number; processed: number; status: 'loading' | 'ready' | 'partial'; updatedAt: string | null;
}
export interface AnimeDetail extends Anime { summary: string; image: string | null; imageVariants?: { thumb: string | null; card: string | null; hero: string | null }; episodes: number | null; tags: string[]; staff: StaffCredit[]; rating: AnimeRating | null; detailFetchedAt: string | null; detailError: string | null; revalidating?: boolean }
export interface SourceState { fetchedAt: string | null; error: string | null; revalidating?: boolean }
export interface StaffCredit { role: string; names: string[] }
export interface CastCredit { id: number; name: string; originalName?: string; relation: '主角' | '配角'; actors: { id: number; name: string }[] }
export interface AnimeCredits { staff: StaffCredit[]; cast: CastCredit[]; sources: { staff: SourceState; cast: SourceState }; revalidating?: boolean }
export interface CharacterName { id: number; name: string; originalName: string }
export interface CharacterNames { names: CharacterName[]; error: string | null; revalidating?: boolean }
export interface AppStatus { appId: 'anime-calendar'; version: '1.0.0'; refreshing: boolean; hasCatalog: boolean; sources: { catalog: SourceState; calendar: SourceState }; warnings: string[] }
export type CatalogScope =
  | { type: 'weekly'; key: string; week: string; timezone: Timezone; season: string }
  | { type: 'season'; key: string; season: string }
  | { type: 'items'; key: string; ids: string[] };
export interface CatalogView {
  schemaVersion: 1; scope: CatalogScope; revision: string; status: AppStatus;
  seasons: { season: string; total: number }[]; catalog: CatalogSnapshot | null; missingIds?: string[];
}
