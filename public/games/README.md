# Hry

Každá hra = samostatný priečinok `games/<id>/`, ktorý konzola načíta, keď hráč hru vyberie
na domovskej obrazovke.

## Pridanie hry

1. Vytvor `games/<id>/game.js` (a voliteľne `game.css`).
2. Pridaj hru do zoznamu v [`games.js`](games.js) – rovnaké `id`, názov, ikonu, farbu, počet hráčov.
   Ak má hra `game.css`, nastav `css: true`.

Najjednoduchší príklad je [`test/game.js`](test/game.js).

## Kostra `game.js`

```js
import { BUTTONS } from '/shared/protocol.js';

export default function start(api) {
  api.root.innerHTML = '<canvas></canvas>';

  api.on('button', (player, button, pressed) => {
    if (pressed && button === BUTTONS.A) api.vibrate(player.id, [40]);
  });

  let frame = requestAnimationFrame(function loop() {
    for (const player of api.players.values()) {
      const { x, y } = api.toScreen(player.x, player.y);
      // … kresli hráča na x, y …
    }
    frame = requestAnimationFrame(loop);
  });

  // Upratanie pri odchode z hry (⌂ Domov / Esc / api.exit()).
  return () => cancelAnimationFrame(frame);
}
```

`start` môže byť aj `async`. Ak vráti funkciu, konzola ju zavolá pri ukončení hry.
Odber vstupov (`api.on`) aj obsah `api.root` konzola po hre uprace sama.

## API (`api`)

| Vlastnosť | Popis |
|---|---|
| `root` | HTML prvok cez celé okno, do ktorého hra kreslí. Má atribút `data-game="<id>"` (na štýly v `game.css`). |
| `game` | Záznam hry z `games.js`. |
| `players` | `Map` číslo hráča → stav hráča (živý objekt, konzola ho priebežne mení). |
| `on(typ, fn)` | Odber vstupov, vráti funkciu na odhlásenie. Typy nižšie. |
| `toScreen(x, y)` | Kurzor `-1..1` → `{x, y}` v pixeloch okna. |
| `vibrate(playerId, pattern)` | Vibrácia telefónu, `pattern` = `[vibruj, pauza, vibruj, …]` v ms. |
| `showCursors(bool)` | Zobraziť/skryť kurzory hráčov nad hrou (predvolene zobrazené). |
| `exit()` | Ukončí hru a vráti sa na domovskú obrazovku. |

### Udalosti `api.on`

| Typ | Argumenty | Kedy |
|---|---|---|
| `'motion'` | `(player, packet)` | ~60× za sekundu od každého telefónu. `packet` = surový MotionPacket (`shared/protocol.js`). |
| `'button'` | `(player, button, pressed)` | Stlačenie/pustenie `BUTTONS.A` alebo `BUTTONS.B`. `HOME` hra nedostane – ten hru ukončí. |
| `'join'` | `(player)` | Hráč sa pripojil (alebo vrátil po výpadku). |
| `'leave'` | `(player)` | Hráč sa odpojil (môže sa do 15 s vrátiť). |

### Stav hráča

| Pole | Popis |
|---|---|
| `id`, `color` | Číslo hráča (1–4) a jeho farba. |
| `online` | Je telefón pripojený? |
| `mode` | `MODES.POINTER` (na výšku) alebo `MODES.WHEEL` (na šírku). |
| `x`, `y`, `roll` | Kurzor `-1..1` (0, 0 = stred) a natočenie zápästia v stupňoch. Platí v režime pointer. |
| `steer` | Volant `-1..1`. Platí v režime wheel. |
| `buttons` | `Set` práve držaných tlačidiel. |
| `motion` | Posledný celý pohybový paket (orientácia `o`, zrýchlenie `a`, gyroskop `r`, …). |
