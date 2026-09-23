// =============================================================================
// console.js – logika konzoly (beží v prehliadači na PC).
//
// Čo robí:
//   1. pripojí sa na server a vytvorí reláciu → zobrazí QR kód
//   2. keď sa pripojí telefón, vytvorí preň kartu hráča
//   3. pohybové dáta z telefónu zobrazuje ako pohybujúcu sa bodku a čísla
//   4. pri stlačení tlačidla A pošle telefónu príkaz na vibráciu
// Neskôr sa tieto vstupy budú posielať do hier namiesto náhľadu.
// =============================================================================

// Názvy správ zo spoločného protokolu (rovnaký súbor používa server aj telefón).
import { EVENTS } from '/shared/protocol.js';

// Skratka: $('qr') namiesto document.getElementById('qr').
const $ = (id) => document.getElementById(id);

// Pripojenie na server. `io` pochádza zo skriptu socket.io.min.js v index.html.
// Bez adresy sa pripojí na ten istý server, z ktorého prišla stránka.
// transports: ['websocket'] = rovno WebSocket (rýchlejšie, bez pomalšieho záložného spôsobu).
const socket = io({ transports: ['websocket'] });

// Pripojení hráči: číslo hráča → { el: karta, dot: bodka, info: text s hodnotami }.
const players = new Map();

// Spojenie so serverom sa nadviazalo (aj po automatickom znovupripojení).
socket.on('connect', () => {
  $('status').textContent = 'Čakám na ovládače';
  // Požiadame server o novú reláciu. Tretí argument je funkcia, ktorú server zavolá s odpoveďou.
  socket.emit(EVENTS.CONSOLE_CREATE, null, ({ code, joinUrl, qr }) => {
    $('code').textContent = code;       // zobrazíme kód relácie
    $('qr').src = qr;                   // QR kód (obrázok v tvare data URL) vložíme do <img>
    $('join-url').href = joinUrl;       // odkaz pre telefón…
    $('join-url').textContent = joinUrl; // …aj jeho text
  });
});

// Spojenie so serverom sa prerušilo (napr. server bol vypnutý).
socket.on('disconnect', () => {
  $('status').textContent = 'Spojenie so serverom prerušené';
  // Server po odpojení konzoly reláciu zmaže, takže zmažeme aj všetkých hráčov na obrazovke.
  // Po znovupripojení sa vytvorí nová relácia s novým QR kódom.
  players.clear();
  $('players').replaceChildren(); // odstráni všetky karty z HTML
});

// Server oznámil, že sa pripojil hráč (nový, alebo vrátený po výpadku).
socket.on(EVENTS.PLAYER_JOINED, ({ playerId, color }) => {
  // Ak už karta existuje (hráč sa vrátil), použijeme ju; inak vytvoríme novú.
  const player = players.get(playerId) ?? createPlayerCard(playerId, color);
  player.el.classList.remove('offline'); // zrušíme polopriehľadnosť
  updateStatus();
});

// Server oznámil, že sa hráč odpojil – kartu necháme, iba ju zosvetlíme.
socket.on(EVENTS.PLAYER_LEFT, ({ playerId }) => {
  players.get(playerId)?.el.classList.add('offline');
  updateStatus();
});

// Prišli pohybové dáta (~60× za sekundu od každého telefónu).
// Rozložíme ich na: p = číslo hráča, o = orientácia [alpha, beta, gamma], a = zrýchlenie [x, y, z].
socket.on(EVENTS.INPUT_MOTION, ({ p, o, a }) => {
  const player = players.get(p);
  if (!player) return; // neznámy hráč – ignorujeme
  // Z orientácie potrebujeme iba beta (predklon) a gamma (náklon do strany).
  // Čiarka na začiatku = prvú hodnotu (alpha) preskočíme.
  const [, beta, gamma] = o;
  // Prevod náklonu na pozíciu bodky:
  //   náklon ±45° → clamp ho obmedzí na -1 až 1 → ×45 → posun o ±45 % od stredu (50 %).
  // Číslo 45 zmeň, ak chceš citlivejší (menšie číslo) alebo menej citlivý (väčšie) náhľad.
  player.dot.style.left = `${50 + clamp(gamma / 45, -1, 1) * 45}%`; // doľava/doprava
  player.dot.style.top = `${50 + clamp(beta / 45, -1, 1) * 45}%`;   // hore/dole
  // Textový výpis hodnôt senzorov (\n = nový riadok).
  player.info.textContent =
    `orient  α ${fmt(o[0])}  β ${fmt(o[1])}  γ ${fmt(o[2])}\n` +
    `accel   x ${fmt(a[0])}  y ${fmt(a[1])}  z ${fmt(a[2])}`;
});

// Hráč stlačil alebo pustil tlačidlo.
socket.on(EVENTS.INPUT_BUTTON, ({ p, button, pressed }) => {
  const player = players.get(p);
  // Počas držania tlačidla má karta farebný obrys (trieda 'pressed' v CSS).
  player?.el.classList.toggle('pressed', pressed);
  // Ukážka spätnej väzby: po stlačení A telefón krátko zavibruje (40 ms).
  // Pole môže mať viac čísel: [vibruj, pauza, vibruj, ...] v milisekundách.
  if (pressed && button === 'A') socket.emit(EVENTS.FEEDBACK_VIBRATE, { playerId: p, pattern: [40] });
});

// Vytvorí HTML kartu pre nového hráča a vloží ju na stránku.
function createPlayerCard(playerId, color) {
  const el = document.createElement('article'); // nový HTML prvok <article>
  el.className = 'player';                     // CSS trieda (štýl v console.css)
  el.style.setProperty('--c', color);          // farba hráča ako CSS premenná --c
  // Obsah karty: nadpis, náhľad s bodkou, miesto na text hodnôt.
  el.innerHTML = `<h2>Hráč ${playerId}</h2><div class="tilt"><div class="dot"></div></div><pre></pre>`;
  // Uložíme si odkazy na prvky, ktoré budeme často meniť (aby sme ich nehľadali 60× za sekundu).
  const player = { el, dot: el.querySelector('.dot'), info: el.querySelector('pre') };
  players.set(playerId, player);
  $('players').append(el); // pridáme kartu na stránku
  return player;
}

// Aktualizuje stavový text v hornej lište podľa počtu pripojených hráčov.
function updateStatus() {
  // [...players.values()] = pole všetkých hráčov; spočítame tých, ktorí nemajú triedu 'offline'.
  const online = [...players.values()].filter((p) => !p.el.classList.contains('offline')).length;
  $('status').textContent = online ? `Pripojení hráči: ${online}` : 'Čakám na ovládače';
}

// Obmedzí číslo `v` na rozsah min až max (napr. clamp(1.7, -1, 1) = 1).
const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
// Naformátuje číslo na 1 desatinné miesto a doplní medzery zľava na 6 znakov,
// aby sa stĺpce v texte neposúvali. `v ?? 0` – chýbajúcu hodnotu zobrazí ako 0.
const fmt = (v) => (v ?? 0).toFixed(1).padStart(6);
