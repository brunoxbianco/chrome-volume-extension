# Tab Volume Mixer (Mikser głośności kart)

Rozszerzenie MV3 dla Helium / Chromium. Pozwala ustawić głośność każdej karty, która odtwarza dźwięk, osobno. Suwaki 0–100 %, wyciszanie, powrót do 100 % i przechodzenie do karty. UI po polsku lub angielsku, zależnie od języka przeglądarki.

## Instalacja (Helium)
1. Otwórz `chrome://extensions`.
2. Włącz **Tryb dewelopera** (Developer mode).
3. Kliknij **Załaduj rozpakowane** (Load unpacked) i wskaż folder `extension/`.
4. Przypnij ikonę głośnika do paska narzędzi.

Karty otwarte przed instalacją działają od razu po pierwszym ruchu suwakiem. Wyjątek to strony, które grają przez Web Audio (np. niektóre gry i odtwarzacze): je trzeba raz przeładować.

## Jak to działa
Skrypt w kontekście strony mnoży głośność każdego elementu `<audio>`/`<video>` przez poziom karty. Wstawia też `GainNode` przed wyjściem każdego `AudioContext`. Strona dalej „widzi” swoją głośność, więc jej własny suwak działa jak wcześniej. Poziomy są trzymane per karta w `storage.session` i przetrwają przeładowanie karty. Znikają po zamknięciu karty lub przeglądarki.

## Ograniczenia
* Zakres 0–100 %, bez wzmocnienia ponad 100 %.
* Na stronach `chrome://`, w sklepie z rozszerzeniami i na stronach innych rozszerzeń dostępne jest tylko wyciszenie.
* Strony `file://` wymagają włączenia „Zezwalaj na dostęp do adresów URL plików”.

## Struktura
| Ścieżka | Zawartość |
| --- | --- |
| `extension/` | Kod rozszerzenia (to ładujesz / pakujesz) |
| `tests/e2e.mjs` | Test E2E w prawdziwym Helium: `cd tests && npm install && node e2e.mjs` |
| `tests/make_icons.py` | Generator ikon |
| `research/`, `architecture/`, `design/` | Decyzje produktowe i architektoniczne |
| `quality/` | Raporty testów, bezpieczeństwa i wydajności oraz zrzuty ekranu |
| `release/` | Paczka ZIP, grafiki do sklepu (`store-assets/`) i arkusz zgłoszenia do Chrome Web Store (`store-submission.md`) |
| `PRIVACY.md` | Polityka prywatności (link do podania w Chrome Web Store) |
| `tests/store-assets.mjs` | Generator zrzutów i grafiki promocyjnej z prawdziwego rozszerzenia |
