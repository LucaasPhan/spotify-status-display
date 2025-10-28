"use client";

import dynamic from 'next/dynamic';
import React from 'react';

// Dynamically import the heavy NowPlaying client component with SSR disabled.
const NowPlaying = dynamic(() => import('@/components/NowPlaying'), { ssr: false });

export default function NowPlayingClient() {
  return <NowPlaying />;
}
