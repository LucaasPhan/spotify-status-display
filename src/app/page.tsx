import NowPlayingClient from '@/components/NowPlayingClient';

export default function Home() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-900 to-gray-800 px-[15%]">
      <div className="w-full p-1 bg-gradient-to-r from-green-400 to-green-600 rounded-lg">
        <div className="w-full bg-white rounded-lg">
          {/* Client-only NowPlaying will hydrate without mismatches */}
          <NowPlayingClient />
        </div>
      </div>
    </main>
  );
}