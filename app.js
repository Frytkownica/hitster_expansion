const PREFIX = "hitsterexp:";
const resultEmpty = document.getElementById("result-empty");
const resultCard = document.getElementById("result-card");
const songCode = document.getElementById("song-code");
const songTitle = document.getElementById("song-title");
const songArtist = document.getElementById("song-artist");
const songCollab = document.getElementById("song-collab");
const songYear = document.getElementById("song-year");
const spotifyLink = document.getElementById("spotify-link");
const spotifyPlayerShell = document.getElementById("spotify-player-shell");
const statusNode = document.getElementById("status");
const toggleButton = document.getElementById("scan-toggle");
const manualForm = document.getElementById("manual-form");
const manualInput = document.getElementById("manual-code");
const flipPrompt = document.getElementById("flip-prompt");

let isScanning = false;
let scanner = null;
let spotifyEmbedController = null;
let pendingSpotifyUri = null;
let pendingAutoplayUri = null;
let waitingForFlip = false;
let hasPrimedPlayback = false;

const config = window.HITSTER_CONFIG || {};
const supabaseClient =
  config.supabaseUrl && config.supabasePublishableKey
    ? window.supabase.createClient(config.supabaseUrl, config.supabasePublishableKey)
    : null;

if (!supabaseClient) {
  setStatus("Brakuje konfiguracji Supabase. Ustaw config.js lub GitHub Secrets.", true);
}

window.onSpotifyIframeApiReady = (IFrameAPI) => {
  const element = document.getElementById("spotify-player");
  IFrameAPI.createController(
    element,
    {
      uri: "spotify:track:3AhXZa8sUQht0UEdBJgpGc",
      width: "100%",
      height: "152"
    },
    (controller) => {
      spotifyEmbedController = controller;
      if (pendingSpotifyUri) {
        loadSpotifyTrack(pendingSpotifyUri);
      }
    }
  );
};

toggleButton.addEventListener("click", async () => {
  hasPrimedPlayback = true;
  if (isScanning) {
    await stopScanner();
    return;
  }

  await startScanner();
});

manualForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await handleCode(manualInput.value);
});

async function startScanner() {
  if (!window.Html5Qrcode) {
    setStatus("Biblioteka skanera nie zaladowala sie poprawnie.", true);
    return;
  }

  scanner = scanner || new Html5Qrcode("reader");

  try {
    await scanner.start(
      { facingMode: "environment" },
      { fps: 10, qrbox: { width: 240, height: 240 } },
      async (decodedText) => {
        await handleCode(decodedText);
      },
      () => {}
    );
    isScanning = true;
    toggleButton.textContent = "Zatrzymaj skanowanie";
    setStatus("Skaner dziala. Pokaz kod QR do kamery.");
  } catch (error) {
    setStatus(`Nie udalo sie uruchomic kamery: ${error.message || error}`, true);
  }
}

async function stopScanner() {
  if (!scanner || !isScanning) {
    return;
  }

  await scanner.stop();
  await scanner.clear();
  isScanning = false;
  toggleButton.textContent = "Start skanowania";
  setStatus("Kamera jest zatrzymana.");
}

async function handleCode(rawValue) {
  const trimmed = (rawValue || "").trim();
  const qrCodeId = parseQrCodeId(trimmed);

  if (!qrCodeId) {
    setStatus(`Nieznany kod QR: ${trimmed || "pusty kod"}`, true);
    return;
  }

  setStatus(`Szukam utworu dla ${qrCodeId}...`);
  manualInput.value = `${PREFIX}${qrCodeId}`;

  try {
    const song = await fetchSong(qrCodeId);
    renderSong(song);
    setStatus(`Znaleziono utwor dla ${qrCodeId}.`);

    if (song.spotify_id) {
      const spotifyUrl = `https://open.spotify.com/track/${song.spotify_id}`;
      const spotifyUri = `spotify:track:${song.spotify_id}`;
      spotifyLink.href = spotifyUrl;
      spotifyLink.classList.remove("hidden");
      spotifyPlayerShell.classList.remove("hidden");
      loadSpotifyTrack(spotifyUri);
      prepareFlipAutoplay(spotifyUri);
    } else {
      spotifyLink.removeAttribute("href");
      spotifyLink.classList.add("hidden");
      spotifyPlayerShell.classList.add("hidden");
      setStatus("Utwor znaleziony, ale rekord nie ma jeszcze spotify_id.", false);
    }

    if (isScanning) {
      await stopScanner();
    }
  } catch (error) {
    clearSong();
    setStatus(error.message || "Nie udalo sie pobrac danych utworu.", true);
  }
}

function parseQrCodeId(value) {
  if (!value) {
    return "";
  }

  const normalized = value.toLowerCase();
  if (!normalized.startsWith(PREFIX)) {
    return "";
  }

  return value.slice(PREFIX.length).trim();
}

async function fetchSong(qrCodeId) {
  if (!supabaseClient) {
    throw new Error("Supabase nie jest skonfigurowany.");
  }

  const { data, error } = await supabaseClient
    .from("hitster")
    .select("*")
    .eq("qr_code_id", qrCodeId)
    .maybeSingle();

  if (error) {
    throw new Error(`Blad Supabase: ${error.message}`);
  }

  if (!data) {
    throw new Error(`Nie znaleziono utworu dla qr_code_id ${qrCodeId}.`);
  }

  return data;
}

function renderSong(song) {
  resultEmpty.classList.add("hidden");
  resultCard.classList.remove("hidden");
  songCode.textContent = `QR ID ${song.qr_code_id}`;
  songTitle.textContent = song.title;
  songArtist.textContent = `Artist: ${song.artist}`;
  songCollab.textContent = `Collab: ${song.collab}`;
  songYear.textContent = `Year: ${song.year}`;
}

function clearSong() {
  resultEmpty.classList.remove("hidden");
  resultCard.classList.add("hidden");
  spotifyLink.removeAttribute("href");
  spotifyLink.classList.add("hidden");
  spotifyPlayerShell.classList.add("hidden");
  hideFlipPrompt();
}

function setStatus(message, isError = false) {
  statusNode.textContent = message;
  statusNode.style.color = isError ? "#a23314" : "";
}

function loadSpotifyTrack(uri) {
  pendingSpotifyUri = uri;
  if (!spotifyEmbedController) {
    setStatus("Utwor znaleziony. Czekam, az zaladuje sie player Spotify...", false);
    return;
  }

  spotifyEmbedController.loadUri(uri);
  if (typeof spotifyEmbedController.play === "function") {
    spotifyEmbedController.play().catch?.(() => {});
  }
}

function prepareFlipAutoplay(uri) {
  pendingAutoplayUri = uri;
  waitingForFlip = true;
  showFlipPrompt();
  setStatus("Utwor znaleziony. Obroc telefon, a player sprobuje ruszyc automatycznie.");
}

function showFlipPrompt() {
  flipPrompt.classList.remove("hidden");
}

function hideFlipPrompt() {
  waitingForFlip = false;
  pendingAutoplayUri = null;
  flipPrompt.classList.add("hidden");
}

function maybeHandleFlip(beta, gamma) {
  if (!waitingForFlip || !pendingAutoplayUri) {
    return;
  }

  const upsideDown = Math.abs(beta) > 150;
  const sidewaysFlip = Math.abs(gamma) > 150;
  if (!upsideDown && !sidewaysFlip) {
    return;
  }

  waitingForFlip = false;
  flipPrompt.classList.add("hidden");
  setStatus("Telefon obrocony. Uruchamiam odtwarzanie...");
  playCurrentTrack();
}

function playCurrentTrack() {
  if (!pendingAutoplayUri) {
    return;
  }

  if (!spotifyEmbedController) {
    setStatus("Player Spotify jeszcze sie laduje. Sprobuj ponownie za chwile.", true);
    return;
  }

  spotifyEmbedController.loadUri(pendingAutoplayUri);
  const playResult = spotifyEmbedController.play?.();
  if (playResult && typeof playResult.catch === "function") {
    playResult.catch(() => {
      setStatus("Przegladarka zablokowala autoplay. Kliknij Play w osadzonym playerze.", true);
    });
  }
}

window.addEventListener("deviceorientation", (event) => {
  maybeHandleFlip(event.beta, event.gamma);
});
