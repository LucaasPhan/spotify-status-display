import { NextResponse } from 'next/server';
import { getNowPlaying } from '@/app/lib/spotify';

export async function GET() {
  try {
    const data = await getNowPlaying();
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error in now-playing API route:', error);
    return NextResponse.json({ error: 'Failed to fetch now playing' }, { status: 500 });
  }
}