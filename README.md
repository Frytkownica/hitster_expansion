# Hitster Poland -- README

## Cel projektu

Stworzenie wlasnej aplikacji webowej (PWA), dzialajacej podobnie do
Hitster, ale z wlasna baza utworow oraz wlasnymi kodami QR.

### Glowna zasada

- QR na karcie nie zawiera bezposrednio linku do Spotify.
- QR zawiera wylacznie losowy identyfikator.
- Backend mapuje QR -> utwor -> Spotify Track ID.
- Zmiana Spotify Track ID nigdy nie wymaga ponownego drukowania kart.

## Dane utworu

- QR ID
- Artist/Band
- Collaboration
- Song title
- Year published
- Spotify Track ID

## Zalozenia listy

- 1965-2025
- ok. 500 utworow
- 75-85% utworow popularnych w Polsce
- reszta swiatowe klasyki zwiekszajace roznorodnosc gatunkowa
- maks. 4 utwory jednego wykonawcy
- brak duplikatow
- wszystkie dostepne w Spotify
- preferowane oryginalne nagrania a nie remake

## Architektura

QR -> skaner w aplikacji -> qr_code_id -> Supabase -> Spotify Track ID -> odtwarzanie

## Format QR

Kazdy kod QR zawiera string w formacie:

```text
hitsterexp:000001
```

Aplikacja:

1. skanuje kod QR,
2. sprawdza prefix `hitsterexp:`,
3. wycina `qr_code_id`,
4. pobiera rekord z tabeli `hitster`,
5. pokazuje `artist`, `collab`, `title`, `year`,
6. otwiera Spotify po `spotify_id`.

## GitHub Pages

Strona jest statyczna i moze byc wdrozona na GitHub Pages.

Do dzialania potrzebuje runtime config z:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`