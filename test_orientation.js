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
  /activeSong = song;[\s\S]*?preloadSpotifyPreview\(spotifyUri\);[\s\S]*?showTurnScreen\(\);/,
  "the selected track must preload before the turn screen"
);
assert.doesNotMatch(
  source,
  /preloadSpotifyPreview\(spotifyUri\);\s*startSpotifyPreview\(spotifyUri\);/,
  "scanning must not start a bootstrap or the selected track"
);
assert.match(
  source,
  /turnReadyButton\.addEventListener\("click", \(\) => \{[\s\S]*?startSpotifyPreview\(`spotify:track:\$\{activeSong\.spotify_id\}`\);/,
  "Gotowe must start the scanned track from a user gesture"
);
assert.match(source, /function setSpotifyIframeApi\(IFrameAPI\)/, "Spotify API must survive an early loader callback");
assert.ok(
  html.indexOf("window.__spotifyIframeApi") < html.indexOf("https://open.spotify.com/embed/iframe-api/v1"),
  "Spotify callback receiver must load before Spotify's async script"
);

assert.match(
  source,
  /function setSpotifyIframeApi\(IFrameAPI\) \{[\s\S]*?if \(pendingSpotifyUri\) \{[\s\S]*?createSpotifyController\(pendingSpotifyUri\);/,
  "Spotify API must create the scanned-track controller when it becomes ready"
);
assert.doesNotMatch(source, /primeSpotifyPlayback|spotifySeedUri|showTopLevelPlayerFromQuery/, "the bootstrap and redirect experiments must be removed");
assert.match(html, /id="turn-ready-button"/, "turn screen must provide a Gotowe button");
