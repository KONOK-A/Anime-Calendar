export type PosterSize = 'thumb' | 'card' | 'hero';
export function posterSource(id: string | undefined, size: PosterSize, image?: string | null, revision?: string | null): string | null {
  // Local artwork/placeholders remain local; source covers use the bounded server cache.
  if (image?.startsWith('/') && !image.startsWith('//')) return image;
  if (!id?.startsWith('bgm:')) return image ?? null;
  return `/media/posters/${encodeURIComponent(id)}/${size}${revision ? `?v=${encodeURIComponent(revision)}` : ''}`;
}
