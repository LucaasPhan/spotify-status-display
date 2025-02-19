import SpotifyNowPlaying from "./lib/spotifyNowPlaying";

export default function Home() {
  return(
    <>
      <SpotifyNowPlaying client_id={undefined} client_secret={undefined} refresh_token={undefined}/>
    </>
  )
}