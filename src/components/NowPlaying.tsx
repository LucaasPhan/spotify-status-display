 'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { signIn, signOut, useSession } from 'next-auth/react';
import { LoadingSpinner } from './LoadingSpinner';
import { NowPlayingResponse } from '@/app/lib/spotify';
import { FaPlay, FaPause } from 'react-icons/fa';

export default function NowPlaying({ initialSession = false }: { initialSession?: boolean }) {
  const { data: session } = useSession();
  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<NowPlayingResponse | null>(null);
  const [progressMs, setProgressMs] = useState<number | null>(null);
  const [durationMs, setDurationMs] = useState<number | null>(null);

  function formatTime(ms: number | null) {
    if (ms == null) return '--:--';
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
    const seconds = (totalSeconds % 60).toString().padStart(2, '0');
    return `${minutes}:${seconds}`;
  }

  useEffect(() => {
  // avoid hydration mismatch by only switching to client-driven session after mount
  setMounted(true);

    async function fetchNowPlaying() {
      try {
        const response = await fetch('/api/spotify/now-playing');
        if (!response.ok) {
          throw new Error('Failed to fetch');
        }
        const data = await response.json();
        setData(data);
        setProgressMs(typeof data?.progressMs === 'number' ? data.progressMs : null);
        setDurationMs(typeof data?.durationMs === 'number' ? data.durationMs : null);
      } catch (error) {
        console.error('Error fetching now playing:', error);
      } finally {
        setLoading(false);
      }
    }

    // only fetch once on the client when the real session is available; live updates will come from SSE
    if (session) {
      fetchNowPlaying();
    } else {
      setLoading(false);
    }
  }, [session]);

  // Server-Sent Events listener for live updates from the server poller
  useEffect(() => {
    if (!session) return;

    const es = new EventSource('/api/spotify/stream');

    es.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'now_playing') {
          const payload = msg.data;
          setData(payload);
          setProgressMs(typeof payload?.progressMs === 'number' ? payload.progressMs : null);
          setDurationMs(typeof payload?.durationMs === 'number' ? payload.durationMs : null);
          setLoading(false);
        } else if (msg.type === 'no_content') {
          setData(null);
          setProgressMs(null);
          setDurationMs(null);
          setLoading(false);
        } else if (msg.type === 'error') {
          // optionally handle server-side errors
          // console.warn('SSE error', msg);
        }
      } catch {
        // ignore parse errors
      }
    };

    es.onerror = () => {
      // reconnect logic is handled by EventSource automatically in browsers
      es.close();
    };

    return () => {
      es.close();
    };
  }, [session]);

  // Update progress every second while playing
  useEffect(() => {
    if (!data?.isPlaying || progressMs == null || durationMs == null) return;

    const tick = () => {
      setProgressMs(prev => {
        if (prev == null) return prev;
        const next = prev + 1000;
        // if we've reached or passed the end, trigger a refetch by returning the same value
        if (next >= (durationMs ?? Infinity)) {
          // attempt a refresh to get next track or updated progress
          fetch('/api/spotify/now-playing').then(res => res.json()).then(d => {
            setData(d);
            setProgressMs(typeof d?.progressMs === 'number' ? d.progressMs : null);
            setDurationMs(typeof d?.durationMs === 'number' ? d.durationMs : null);
          }).catch(() => {});
          return next;
        }
        return next;
      });
    };

    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [data?.isPlaying, progressMs, durationMs]);

  // effectiveSession is what we use to decide which UI to render.
  // Before the client mounts we use the server snapshot `initialSession` so server-rendered HTML
  // matches the client initial HTML and avoids hydration mismatches.
  const effectiveSession = mounted ? session : (initialSession ? {} : null);

  // Note: we intentionally do NOT short-circuit rendering here. We rely on
  // `effectiveSession` (which uses the server-provided `initialSession` before mount)
  // so the server and client produce the same initial markup and avoid hydration mismatches.

  if (!effectiveSession) {
    return (
      <div className="flex items-center justify-center p-6">
        <button
          onClick={() => signIn('spotify', { callbackUrl: '/' })}
          className="px-6 py-3 bg-green-500 text-white rounded-full hover:bg-green-600 transition-colors font-medium"
        >
          Connect with Spotify
        </button>
      </div>
    );
  }


  if (loading) {
    return (
      <div className="p-6">
        <LoadingSpinner />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="text-center p-6 text-gray-500">
        No track currently playing
      <button
        onClick={() => signOut({ callbackUrl: '/' })}
        className="px-3 py-1 text-xs bg-red-100 text-red-700 rounded-md hover:bg-red-200"
      >
        Logout
      </button>
      </div>
    );
  }

  return (
    <div className="flex items-center space-x-4 p-6 bg-white rounded-lg shadow-sm justify-evenly">
      <div className="flex-col min-w-0">
        <Link
        href={data.songUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="font-bold text-lg text-gray-900 hover:underline text-pretty"
        >
        {data.title}
        </Link>
        <p className="text-gray-500 text-sm truncate">{data.artist}</p>
        {/* Progress bar */}
        <div className="mt-3">
          <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
            <div
              className="h-2 bg-green-500"
              style={{ width: `${progressMs && durationMs ? Math.min(100, (progressMs / durationMs) * 100) : 0}%` }}
            />
          </div>
          <div className="flex justify-between text-xs text-gray-500 mt-1">
            <span>{formatTime(progressMs)}</span>
            <span>{formatTime(durationMs)}</span>
          </div>
        </div>
      </div>
      <div className="flex ">
        <div className="flex items-center space-x-3">
          <span className={` py-1 rounded-full text-xs font-medium ${
          data.isPlaying ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
          }`}>
            {data.isPlaying ? <FaPause size={15}/> : <FaPlay size={15}/> }
          </span>

          {/* Logout button */}
          <button
            onClick={() => signOut({ callbackUrl: '/' })}
            className="px-3 py-1 text-xs bg-red-100 text-red-700 rounded-md hover:bg-red-200"
          >
            Logout
          </button>
        </div>
      </div>
    </div>
  );
}