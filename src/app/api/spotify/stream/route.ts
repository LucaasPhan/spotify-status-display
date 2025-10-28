import { getToken } from 'next-auth/jwt';

const NOW_PLAYING_ENDPOINT = 'https://api.spotify.com/v1/me/player/currently-playing';

function sseEvent(data: string) {
  return `data: ${data}\n\n`;
}

export async function GET(request: Request) {
  // authOptions typing can be complex at runtime; ignore strict typing here
  // read the JWT token to get refreshToken and expiry
  // getToken works in App Router when provided the Request
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const token = await getToken({ req: request as any, secret: process.env.NEXTAUTH_SECRET });
  const t = token as unknown as { accessToken?: string; refreshToken?: string; expiresAt?: number } | undefined;
  if (!t?.accessToken) {
    return new Response('Unauthorized', { status: 401 });
  }

  const encoder = new TextEncoder();

  let lastPayload = '';

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      let timer: ReturnType<typeof setTimeout> | undefined;

      // local token state for this SSE connection (may be refreshed)
      let accessToken = t.accessToken!;
      let refreshToken = t.refreshToken;
      let expiresAt = t.expiresAt ?? 0;

      // refresh helper
      const refreshAccessToken = async () => {
        if (!refreshToken) throw new Error('No refresh token available');
        const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken });
        const basic = Buffer.from(`${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`).toString('base64');
        const res = await fetch('https://accounts.spotify.com/api/token', {
          method: 'POST',
          headers: {
            Authorization: `Basic ${basic}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: body.toString(),
        });
        if (!res.ok) throw new Error(`Refresh failed: ${res.status}`);
        const json = await res.json();
        accessToken = json.access_token ?? accessToken;
        if (json.refresh_token) refreshToken = json.refresh_token;
        expiresAt = Date.now() + ((json.expires_in ?? 3600) * 1000);
      };

      // polling with exponential backoff
      let delay = 5000; // ms
      const maxDelay = 60000;

      // cleanup handler (hoisted so poll can call it)
      function onAbort() {
        if (closed) return;
        closed = true;
        try { if (timer) clearTimeout(timer); } catch { /* ignore */ }
        try { controller.close(); } catch { /* ignore */ }
      }

      const poll = async () => {
        if (closed) return;

        // refresh if expiring within 60s
        if (Date.now() > (expiresAt - 60000)) {
          try {
            await refreshAccessToken();
          } catch (err) {
            const payload = JSON.stringify({ type: 'error', message: (err as Error).message });
            if (payload !== lastPayload && !closed) {
              try { controller.enqueue(encoder.encode(sseEvent(payload))); } catch { /* swallow */ onAbort(); }
              lastPayload = payload;
            }
            delay = Math.min(delay * 2, maxDelay);
            timer = setTimeout(poll, delay);
            return;
          }
        }

        try {
          const res = await fetch(NOW_PLAYING_ENDPOINT, {
            headers: { Authorization: `Bearer ${accessToken}` },
            cache: 'no-store',
          });

          if (res.status === 204) {
            const payload = JSON.stringify({ type: 'no_content' });
            if (payload !== lastPayload && !closed) {
              try { controller.enqueue(encoder.encode(sseEvent(payload))); } catch { /* swallow */ }
              lastPayload = payload;
            }
          } else if (res.status === 401) {
            // Access token likely expired — try refresh once
            try {
              await refreshAccessToken();
              // retry immediately with new token
              delay = 5000;
              timer = setTimeout(poll, 0);
              return;
            } catch {
              const payload = JSON.stringify({ type: 'error', message: 'Unauthorized and refresh failed' });
              if (payload !== lastPayload && !closed) {
                try { controller.enqueue(encoder.encode(sseEvent(payload))); } catch { /* swallow */ }
                lastPayload = payload;
              }
            }
          } else if (res.status === 429 || res.status >= 500) {
            // rate limited or server error — backoff
            const payload = JSON.stringify({ type: 'error', status: res.status });
            if (payload !== lastPayload && !closed) {
              try { controller.enqueue(encoder.encode(sseEvent(payload))); } catch { /* swallow */ }
              lastPayload = payload;
            }
            delay = Math.min(delay * 2, maxDelay);
            timer = setTimeout(poll, delay);
            return;
          } else if (res.status > 400) {
            // other client errors
            const payload = JSON.stringify({ type: 'error', status: res.status });
            if (payload !== lastPayload && !closed) {
              try { controller.enqueue(encoder.encode(sseEvent(payload))); } catch { /* swallow */ }
              lastPayload = payload;
            }
          } else {
            const json = await res.json();
            const payloadObj = {
              type: 'now_playing',
              data: {
                isPlaying: json.is_playing,
                progressMs: json.progress_ms ?? null,
                durationMs: json.item?.duration_ms ?? null,
                title: json.item?.name ?? null,
                album: json.item?.album?.name ?? null,
                albumImageUrl: json.item?.album?.images?.[0]?.url ?? null,
                artist: (json.item?.artists ?? []).map((a: { name: string }) => a.name).join(', '),
                songUrl: json.item?.external_urls?.spotify ?? null,
              },
            };

            const payload = JSON.stringify(payloadObj);
            if (payload !== lastPayload && !closed) {
              try { controller.enqueue(encoder.encode(sseEvent(payload))); } catch { /* swallow */ }
              lastPayload = payload;
            }
            // reset backoff on success
            delay = 5000;
          }
        } catch (err) {
          // network or other transient errors: send an error event and backoff
          const payload = JSON.stringify({ type: 'error', message: (err as Error).message });
          if (payload !== lastPayload && !closed) {
            try { controller.enqueue(encoder.encode(sseEvent(payload))); } catch { /* swallow */ onAbort(); }
            lastPayload = payload;
          }
          delay = Math.min(delay * 2, maxDelay);
        }

        // schedule next poll
        if (!closed) {
          timer = setTimeout(poll, delay);
        }
      };

      // initial poll
      await poll();

      // Use the request signal to detect client disconnects and cancel polling
      try {
        request.signal.addEventListener('abort', onAbort);
      } catch { /* ignore if signal not supported */ }
    },
    cancel() {
      // noop; runtime will clean up
    },
  });

  const headers = new Headers({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
  });

  return new Response(stream, { headers });
}
