const PREFIX = "hitsterexp:";
const TURN_TRANSITION_MS = 1300;
const PHONE_FLIP_THRESHOLD = 150;
const TURN_FALLBACK_MS = 4500;

const config = window.HITSTER_CONFIG || {};
const supabaseClient =
  config.supabaseUrl && config.supabasePublishableKey
    ? window.supabase.createClient(config.supabaseUrl, config.supabasePublishableKey)
    : null;

const screens = {
  home: document.getElementById("screen-home"),
  scanner: document.getElementById("screen-scanner"),
  turn: document.getElementById("screen-turn"),
  resolve: document.getElementById("screen-resolve")
};

const playNowButton = document.getElementById("play-now-button");
const scannerCloseButton = document.getElementById("scanner-close-button");
const scannerStatus = document.getElementById("scanner-status");
const scannerError = document.getElementById("scanner-error");
const turnPhone = document.getElementById("turn-phone");
const nextCardButton = document.getElementById("next-card-button");
const resolveCard = document.getElementById("resolve-card");
const resolvePreviewBar = document.getElementById("resolve-preview-bar");
const resolveStopButton = document.getElementById("resolve-stop-button");
const resolveArtist = document.getElementById("resolve-artist");
const resolveYear = document.getElementById("resolve-year");
const resolveTitle = document.getElementById("resolve-title");
const collabIndicator = document.getElementById("collab-indicator");
const spotifyAutoplayHost = document.getElementById("spotify-autoplay-host");

let scanner = null;
let isScanning = false;
let activeScreen = "home";
let activeSong = null;
let turnAnimationTimer = null;
let turnFallbackTimer = null;
let waitingForFlip = false;
let orientationAccessRequested = false;
let lastOrientationEventAt = 0;
let spotifyController = null;
let pendingSpotifyUri = null;

if (!supabaseClient) {
  showScannerError("Brakuje konfiguracji Supabase.");
}

window.onSpotifyIframeApiReady = (IFrameAPI) => {
  IFrameAPI.createController(
    spotifyAutoplayHost,
    {
      uri: "spotify:track:3AhXZa8sUQht0UEdBJgpGc",
      width: "1",
      height: "1"
    },
    (controller) => {
      spotifyController = controller;
      if (pendingSpotifyUri) {
        startSpotifyPreview(pendingSpotifyUri);
      }
    }
  );
};

playNowButton.addEventListener("click", async () => {
  await ensureOrientationAccess();
  openScanner();
});

scannerCloseButton.addEventListener("click", async () => {
  await stopScanner();
  showScreen("home");
});

nextCardButton.addEventListener("click", async () => {
  resetResolveView();
  await openScanner();
});

resolveStopButton.addEventListener("click", () => {
  stopSpotifyPreview();
});

window.addEventListener("deviceorientation", (event) => {
  lastOrientationEventAt = Date.now();
  if (!waitingForFlip) {
    return;
  }

  const beta = Math.abs(event.beta || 0);
  const gamma = Math.abs(event.gamma || 0);
  if (beta < PHONE_FLIP_THRESHOLD && gamma < PHONE_FLIP_THRESHOLD) {
    return;
  }

  finishTurnFlow();
});

window.addEventListener("orientationchange", () => {
  if (!waitingForFlip) {
    return;
  }

  if (isScreenUpsideDown()) {
    finishTurnFlow();
  }
});

if (window.screen?.orientation?.addEventListener) {
  window.screen.orientation.addEventListener("change", () => {
    if (!waitingForFlip) {
      return;
    }

    if (isScreenUpsideDown()) {
      finishTurnFlow();
    }
  });
}

async function openScanner() {
  if (!supabaseClient) {
    showScreen("scanner");
    showScannerError("Brakuje konfiguracji Supabase.");
    return;
  }

  showScreen("scanner");
  showScannerError("");
  scannerStatus.textContent = "Nakieruj aparat na kod QR.";
  await startScanner();
}

async function startScanner() {
  if (isScanning) {
    return;
  }

  if (!window.Html5Qrcode) {
    showScannerError("Biblioteka skanera nie zaladowala sie poprawnie.");
    return;
  }

  scanner = scanner || new Html5Qrcode("reader");

  try {
    await scanner.start(
      { facingMode: "environment" },
      { fps: 10, qrbox: { width: 240, height: 240 }, aspectRatio: 9 / 16 },
      onScanSuccess,
      () => {}
    );
    isScanning = true;
  } catch (error) {
    showScannerError(`Nie udalo sie uruchomic kamery: ${error.message || error}`);
  }
}

async function stopScanner() {
  if (!scanner || !isScanning) {
    return;
  }

  await scanner.stop();
  await scanner.clear();
  isScanning = false;
}

async function onScanSuccess(decodedText) {
  const qrCodeId = parseQrCodeId(decodedText);
  if (!qrCodeId) {
    showScannerError(`Nieznany kod: ${decodedText}`);
    return;
  }

  scannerStatus.textContent = `Szukam utworu ${qrCodeId}...`;
  showScannerError("");

  try {
    const song = await fetchSong(qrCodeId);
    activeSong = song;
    await stopScanner();
    showTurnScreen();
  } catch (error) {
    showScannerError(error.message || "Nie udalo sie pobrac utworu.");
  }
}

function parseQrCodeId(value) {
  const trimmed = (value || "").trim();
  if (!trimmed.toLowerCase().startsWith(PREFIX)) {
    return "";
  }

  return trimmed.slice(PREFIX.length).trim();
}

async function fetchSong(qrCodeId) {
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

function showTurnScreen() {
  if (!activeSong) {
    return;
  }

  showScreen("turn");
  waitingForFlip = true;
  clearTurnAnimation();
  turnPhone.classList.remove("turn-phone-active");
  turnAnimationTimer = window.setTimeout(() => {
    turnPhone.classList.add("turn-phone-active");
  }, TURN_TRANSITION_MS);
  turnFallbackTimer = window.setTimeout(() => {
    if (!waitingForFlip) {
      return;
    }

    if (!lastOrientationEventAt && !supportsScreenOrientationSignal()) {
      finishTurnFlow();
    }
  }, TURN_FALLBACK_MS);
}

function renderResolve() {
  if (!activeSong) {
    showScreen("home");
    return;
  }

  showScreen("resolve");
  resolveArtist.textContent = activeSong.artist || "";
  resolveYear.textContent = activeSong.year || "";
  resolveTitle.textContent = activeSong.title || "";
  resolveCard.classList.remove("resolve-card-spotify");
  resolvePreviewBar.classList.add("hidden");
  applyResolveTextSizing(activeSong);

  if (isCollaboration(activeSong.collab)) {
    collabIndicator.classList.remove("hidden");
  } else {
    collabIndicator.classList.add("hidden");
  }

  if (activeSong.spotify_id) {
    resolveCard.classList.add("resolve-card-spotify");
    resolvePreviewBar.classList.remove("hidden");
    startSpotifyPreview(`spotify:track:${activeSong.spotify_id}`);
  } else {
    stopSpotifyPreview();
  }

  requestAnimationFrame(() => {
    fitTextToTwoLines(resolveArtist, 20);
    fitTextToTwoLines(resolveTitle, 18);
  });
}

function resetResolveView() {
  activeSong = null;
  waitingForFlip = false;
  clearTurnAnimation();
  clearTurnFallback();
  stopSpotifyPreview();
  resolvePreviewBar.classList.add("hidden");
  resolveCard.classList.remove("resolve-card-spotify");
  resolveArtist.classList.remove("resolve-artist-tight", "resolve-artist-ultra-tight");
  resolveTitle.classList.remove("resolve-title-tight", "resolve-title-ultra-tight");
  collabIndicator.classList.add("hidden");
}

function clearTurnAnimation() {
  if (turnAnimationTimer) {
    window.clearTimeout(turnAnimationTimer);
    turnAnimationTimer = null;
  }
  turnPhone.classList.remove("turn-phone-active");
}

function clearTurnFallback() {
  if (turnFallbackTimer) {
    window.clearTimeout(turnFallbackTimer);
    turnFallbackTimer = null;
  }
}

function showScannerError(message) {
  if (!message) {
    scannerError.textContent = "";
    scannerError.classList.add("hidden");
    return;
  }

  scannerError.textContent = message;
  scannerError.classList.remove("hidden");
}

function showScreen(name) {
  activeScreen = name;
  Object.entries(screens).forEach(([key, element]) => {
    const isActive = key === name;
    element.classList.toggle("hidden", !isActive);
    element.classList.toggle("screen-active", isActive);
  });
}

function isCollaboration(value) {
  if (typeof value === "boolean") {
    return value;
  }

  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "true" || normalized === "prawda" || normalized === "1" || normalized === "yes";
}

async function ensureOrientationAccess() {
  if (orientationAccessRequested) {
    return;
  }

  orientationAccessRequested = true;

  try {
    if (typeof DeviceOrientationEvent?.requestPermission === "function") {
      await DeviceOrientationEvent.requestPermission();
    }
  } catch (_) {
    // If the browser rejects the prompt path, we still keep fallback signals.
  }
}

function finishTurnFlow() {
  waitingForFlip = false;
  clearTurnAnimation();
  clearTurnFallback();
  renderResolve();
}

function supportsScreenOrientationSignal() {
  return typeof window.orientation === "number" || typeof window.screen?.orientation?.angle === "number";
}

function isScreenUpsideDown() {
  const angle =
    typeof window.screen?.orientation?.angle === "number"
      ? window.screen.orientation.angle
      : typeof window.orientation === "number"
        ? window.orientation
        : null;

  if (angle === null) {
    return false;
  }

  const normalized = ((angle % 360) + 360) % 360;
  return normalized === 180;
}

function applyResolveTextSizing(song) {
  const artistLength = String(song.artist || "").length;
  const titleLength = String(song.title || "").length;

  resolveArtist.classList.remove("resolve-artist-tight", "resolve-artist-ultra-tight");
  resolveTitle.classList.remove("resolve-title-tight", "resolve-title-ultra-tight");

  if (artistLength > 30) {
    resolveArtist.classList.add(artistLength > 44 ? "resolve-artist-ultra-tight" : "resolve-artist-tight");
  }

  if (titleLength > 30) {
    resolveTitle.classList.add(titleLength > 46 ? "resolve-title-ultra-tight" : "resolve-title-tight");
  }
}

function fitTextToTwoLines(element, minFontSizePx) {
  if (!element) {
    return;
  }

  element.style.fontSize = "";
  element.style.lineHeight = "";
  element.style.maxHeight = "";

  const computed = window.getComputedStyle(element);
  const initialFontSize = parseFloat(computed.fontSize);
  const initialLineHeight = parseFloat(computed.lineHeight) || initialFontSize * 1.08;

  let fontSize = initialFontSize;
  let lineHeight = initialLineHeight;
  let guard = 0;

  while (guard < 20 && element.scrollHeight > lineHeight * 2 + 1 && fontSize > minFontSizePx) {
    fontSize -= 1;
    lineHeight = Math.max(fontSize * 1.06, minFontSizePx * 1.06);
    element.style.fontSize = `${fontSize}px`;
    element.style.lineHeight = `${lineHeight}px`;
    guard += 1;
  }

  element.style.maxHeight = `${lineHeight * 2 + 2}px`;
}

function startSpotifyPreview(uri) {
  pendingSpotifyUri = uri;
  if (!spotifyController) {
    return;
  }

  spotifyController.loadUri(uri);
  const playResult = spotifyController.play?.();
  if (playResult && typeof playResult.catch === "function") {
    playResult.catch(() => {});
  }
}

function stopSpotifyPreview() {
  pendingSpotifyUri = null;
  if (!spotifyController) {
    return;
  }

  const pauseResult = spotifyController.pause?.();
  if (pauseResult && typeof pauseResult.catch === "function") {
    pauseResult.catch(() => {});
  }
}
