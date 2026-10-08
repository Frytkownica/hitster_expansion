const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync("app.js", "utf8");
const html = fs.readFileSync("index.html", "utf8");
const threshold = source.match(/const PHONE_FLIP_THRESHOLD = \d+;/)?.[0];
const helper = source.match(/function isFaceDown\(beta, gamma\) \{[\s\S]*?\n\}/)?.[0];
assert.ok(threshold && helper, "face-down gate must exist");

const context = {};
vm.runInNewContext(`${threshold}\n${helper}\nresult = isFaceDown;`, context);
const isFaceDown = context.result;

assert.equal(isFaceDown(90, 0), false, "upright scanning must not reveal the song");
assert.equal(isFaceDown(175, 5), true, "face-down must reveal the song");
assert.equal(isFaceDown(null, null), false, "missing sensor data must stay blocked");

assert.match(
  source,
  /startScanButton\.addEventListener\("click", async \(\) => \{[\s\S]*?primeSpotifyPlayback\(\);/,
  "Spotify must be primed from the scan-start user gesture"
);
assert.match(
  source,
  /activeSong = song;[\s\S]*?preloadSpotifyPreview\(`spotify:track:\$\{song\.spotify_id\}`\);/,
  "the scanned track must preload before the phone is turned"
);
assert.match(source, /function setSpotifyIframeApi\(IFrameAPI\)/, "Spotify API must survive an early loader callback");
assert.ok(
  html.indexOf("window.__spotifyIframeApi") < html.indexOf("https://open.spotify.com/embed/iframe-api/v1"),
  "Spotify callback receiver must load before Spotify's async script"
);

assert.match(
  source,
  /function prepareSpotifyController\(\) \{[\s\S]*?spotifySeedUri = `spotify:track:\$\{song\.spotify_id\}`;[\s\S]*?createSpotifyController\(spotifySeedUri\);/,
  "Spotify controller must use a track from the selected packs"
);
assert.match(
  source,
  /function setSpotifyIframeApi\(IFrameAPI\) \{[\s\S]*?if \(spotifySeedUri\) \{[\s\S]*?createSpotifyController\(spotifySeedUri\);/,
  "Spotify controller must exist before the user starts scanning"
);
