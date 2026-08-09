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
const spotifyCard = document.getElementById("resolve-spotify-card");
const spotifyEmbed = document.getElementById("spotify-embed");
const resolveTextCard = document.getElementById("resolve-text-card");
const resolveArtist = document.getElementById("resolve-artist");
const resolveYear = document.getElementById("resolve-year");
const resolveTitle = document.getElementById("resolve-title");
const collabIndicator = document.getElementById("collab-indicator");

let scanner = null;
let isScanning = false;
let activeScreen = "home";
let activeSong = null;
let turnAnimationTimer = null;
let turnFallbackTimer = null;
let waitingForFlip = false;
let orientationAccessRequested = false;
let lastOrientationEventAt = 0;

if (!supabaseClient) {
  showScannerError("Brakuje konfiguracji Supabase.");
}

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
      { fps: 10, qrbox: { width: 240, height: 240 } },
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

  if (isCollaboration(activeSong.collab)) {
    collabIndicator.classList.remove("hidden");
  } else {
    collabIndicator.classList.add("hidden");
  }

  if (activeSong.spotify_id) {
    spotifyEmbed.src = `https://open.spotify.com/embed/track/${activeSong.spotify_id}?utm_source=generator&theme=0`;
    spotifyCard.classList.remove("hidden");
    resolveTextCard.classList.add("hidden");
  } else {
    spotifyEmbed.removeAttribute("src");
    spotifyCard.classList.add("hidden");
    resolveTextCard.classList.remove("hidden");
  }
}

function resetResolveView() {
  activeSong = null;
  waitingForFlip = false;
  clearTurnAnimation();
  clearTurnFallback();
  spotifyEmbed.removeAttribute("src");
  spotifyCard.classList.add("hidden");
  resolveTextCard.classList.add("hidden");
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
