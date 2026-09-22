# Hitster Expansion

Statyczna aplikacja webowa do grania w domowa wersje Hitstera z wlasnymi
kartami QR i lokalna baza utworow.

## Co robi aplikacja

- skanuje kody QR w formacie `hitsterexp:<qr_code_id>`,
- laduje wybrane paczki z katalogu `songs/`,
- losuje jeden utwor przypisany do zeskanowanej karty,
- wymaga odwrocenia telefonu ekranem w dol przed pokazaniem odpowiedzi,
- pokazuje wykonawce, tytul, rok i oznaczenie wspolpracy,
- odtwarza podglad utworu przez Spotify Embed, jezeli rekord ma `spotify_id`,
- zapamietuje wybor paczek w `localStorage`.

Nie ma juz backendu ani Supabase w runtime. Wszystkie dane sa czytane z plikow
JSON hostowanych razem ze strona.

## Struktura projektu

```text
index.html              # ekran aplikacji
styles.css              # wyglad i animacje
app.js                  # logika gry, skaner, paczki, Spotify Embed
songs/packs.json        # lista dostepnych paczek
songs/standard.json     # glowna baza kart i utworow
vendor/textFit.min.js   # lokalna kopia textFit
test_orientation.js     # prosty test logiki odwrocenia telefonu
```

## Format paczki

`songs/packs.json` wskazuje pliki z paczkami:

```json
{
  "name": "Standard Expansion",
  "file": "standard.json",
  "songs": 488,
  "description": "Standardowe rozszerzenie z bazowymi piosenkami",
  "years_min": 1965,
  "years_max": 2025,
  "set": [1, 2, 3]
}
```

Kazdy plik paczki zawiera liste kart. Jedna karta moze miec kilka utworow;
aplikacja tasuje je i wybiera kolejny przy skanowaniu tego samego QR.

```json
{
  "qr_code_id": "1965_1",
  "songs": [
    {
      "year": 1965,
      "title": "Like a Rolling Stone",
      "artist": "Bob Dylan",
      "collab": false,
      "spotify_id": "3AhXZa8sUQht0UEdBJgpGc"
    }
  ]
}
```

QR dla powyzszej karty powinien zawierac:

```text
hitsterexp:1965_1
```

## Uruchomienie lokalne

Najprosciej odpalic statyczny serwer w katalogu projektu:

```bash
python -m http.server 8000
```

Potem wejdz na:

```text
http://localhost:8000
```

Otwieranie `index.html` bez serwera moze nie zadzialac, bo aplikacja pobiera
pliki JSON przez `fetch()`.

## Test

```bash
npm test
```

Test sprawdza minimalnie, czy ekran odpowiedzi nie odblokuje sie bez odczytu
pozycji telefonu ekranem w dol.

## Wdrozenie

Aplikacja nadaje sie do GitHub Pages albo dowolnego hostingu statycznego.
Wystarczy opublikowac pliki z repozytorium. Kamera w przegladarce wymaga
bezpiecznego kontekstu, czyli `https://` albo `localhost`.
