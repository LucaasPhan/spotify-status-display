import { getServerSession } from 'next-auth';
import { authOptions } from '../api/auth/[...nextauth]/route';

const NOW_PLAYING_ENDPOINT = 'https://api.spotify.com/v1/me/player/currently-playing';

export interface NowPlayingResponse {
  isPlaying: boolean;
  title: string;
  artist: string;
  album: string;
  albumImageUrl: string | null;
  songUrl: string | null;
  progressMs?: number | null;
  durationMs?: number | null;
}

interface RawNowPlaying {
  is_playing?: boolean;
  progress_ms?: number;
  item?: {
    name: string;
    artists?: Array<{ name: string }>;
    album?: { name?: string; images?: Array<{ url: string }> };
    external_urls?: { spotify?: string };
    duration_ms?: number;
  };
}

export async function getNowPlaying(): Promise<NowPlayingResponse | null> {
  try {
  const session = (await getServerSession(authOptions as unknown as any)) as unknown as { accessToken?: string };

    if (!session?.accessToken) {
      return null;
    }

    const res = await fetch(NOW_PLAYING_ENDPOINT, {
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
      },
      cache: 'no-store',
    });

    if (res.status === 204) return null;
    if (res.status > 400) return null;

  const json = (await res.json()) as unknown as RawNowPlaying;
  if (!json?.item) return null;

  const progressMs = json.progress_ms ?? null;
  const durationMs = json.item.duration_ms ?? null;

    return {
  isPlaying: !!json.is_playing,
  title: json.item.name,
  artist: (json.item.artists ?? []).map(a => a.name).join(', '),
  album: json.item.album?.name ?? '',
  albumImageUrl: json.item.album?.images?.[0]?.url ?? null,
  songUrl: json.item.external_urls?.spotify ?? null,
      progressMs,
      durationMs,
    };
  } catch (err) {
  // Keep errors silent for API usage — caller can treat null as no-data
  // but log for debugging
  console.error('getNowPlaying error', err);
    return null;
  }
}

export default getNowPlaying;
