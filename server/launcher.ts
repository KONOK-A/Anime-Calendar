export async function existingInstance(url: string): Promise<boolean> {
  try {
    const response = await fetch(`${url}/api/status`, { signal: AbortSignal.timeout(1500) });
    if (!response.ok) return false;
    const data: unknown = await response.json();
    return typeof data === 'object' && data !== null && 'appId' in data && data.appId === 'anime-calendar';
  } catch { return false; }
}
