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
export interface AnimeDetail extends Anime { summary: string; image: string | null; episodes: number | null; tags: string[]; staff: StaffCredit[]; detailFetchedAt: string | null; detailError: string | null }
export interface SourceState { fetchedAt: string | null; error: string | null }
export interface StaffCredit { role: string; names: string[] }
export interface CastCredit { id: number; name: string; originalName?: string; relation: '主角' | '配角'; actors: { id: number; name: string }[] }
export interface AnimeCredits { staff: StaffCredit[]; cast: CastCredit[]; sources: { staff: SourceState; cast: SourceState } }
export interface CharacterName { id: number; name: string; originalName: string }
export interface CharacterNames { names: CharacterName[]; error: string | null }
export interface AppStatus { appId: 'anime-calendar'; version: '1.0.0'; refreshing: boolean; hasCatalog: boolean; sources: { catalog: SourceState; calendar: SourceState }; warnings: string[] }
