# Hitster Poland -- README

## Cel projektu

Stworzenie własnej aplikacji webowej (PWA), działającej podobnie do
Hitster, ale z własną bazą utworów oraz własnymi kodami QR.

### Główna zasada

-   QR na karcie nie zawiera bezposrednio linku do Spotify.
-   QR zawiera wyłącznie losowy identyfikator.
-   Backend mapuje QR → utwór → Spotify Track ID.
-   Zmiana Spotify Track ID nigdy nie wymaga ponownego drukowania kart.

## Dane utworu

-   QR ID (do wygenerowania)
-   Artist/Band
-   Collaboration (TRUE = zespół/duet/wielu wykonawców)
-   Song title
-   Year published
-   Spotify Track ID (do wygenerowania)

## Założenia listy

-   1965--2025
-   ok. 500 utworów
-   75--85% utworów popularnych w Polsce
-   reszta światowe klasyki zwiększające różnorodność gatunkową
-   maks. 4 utwory jednego wykonawcy
-   brak duplikatów
-   wszystkie dostępne w Spotify
-   preferowane oryginalne nagrania a nie remake

## Architektura

QR ↓ Backend ↓ Song ↓ Spotify Track ID ↓ Odtwarzanie

## Proof of Concept

1.  Jeden QR.
2.  Jeden rekord w bazie.
3.  Skanowanie.
4.  Wykrycie odwrócenia telefonu.
5.  Odtwarzanie Spotify po odwróceniu.
6.  Pokazac dane z listy:
    -   wykonawcy
    -   tytułu
    -   roku
    -   Collaboration
## Etapy

1.  Finalizacja listy utworów.
2.  Weryfikacja Spotify.
3.  Generowanie QR.
4.  Backend.
5.  Frontend.
6.  PWA.
7.  Generator kart (przód i tyl).
8.  Testy.