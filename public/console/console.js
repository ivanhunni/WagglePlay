// =============================================================================
// console.js – logika konzoly (beží v prehliadači na PC).
//
// Čo robí:
//   1. pripojí sa na server a vytvorí reláciu → zobrazí QR kód
//   2. sleduje pripojených hráčov a ich vstupy (kurzor, volant, tlačidlá)
//   3. domovská obrazovka: kurzory hráčov, mriežka hier; A nad hrou = spustiť
//   4. spustí hru z public/games/<id>/game.js a posiela jej vstupy cez jednoduché API
//      (popis API je v public/games/README.md); tlačidlo ⌂ Domov alebo Esc hru ukončí
// =============================================================================

// Názvy správ a konštanty zo spoločného protokolu (rovnaký súbor používa server aj telefón).
import { EVENTS, MODES, BUTTONS, MAX_PLAYERS, PLAYER_COLORS } from '/shared/protocol.js';
// Zoznam hier pre domovskú obrazovku.
import { GAMES } from '/games/games.js';

// Skratka: $('qr') namiesto document.getElementById('qr').
const $ = (id) => document.getElementById(id);

// Koľko miest má mriežka hier (4 × 3). Nevyužité miesta ostanú prázdne ako na Wii.
const CHANNEL_SLOTS = 12;
// Krátke zavibrovanie telefónu, keď kurzor nabehne na hru (ms).
const HOVER_BUZZ = [12];

// Pripojenie na server. `io` pochádza zo skriptu socket.io.min.js v index.html.
// transports: ['websocket'] = rovno WebSocket (rýchlejšie, bez pomalšieho záložného spôsobu).
const socket = io({ transports: ['websocket'] });

/**
 * Stav jedného hráča. Rovnaký objekt dostávajú aj hry (api.players), preto sú polia popísané.
 * @typedef {Object} Player
 * @property {number}  id      – číslo hráča (1–4)
 * @property {string}  color   – farba hráča (#RRGGBB)
 * @property {boolean} online  – je telefón práve pripojený?
 * @property {string}  mode    – MODES.POINTER alebo MODES.WHEEL
 * @property {number}  x, y    – kurzor od -1 do 1 (0, 0 = stred obrazovky)
 * @property {number}  roll    – otočenie zápästia v stupňoch
 * @property {number}  steer   – volant od -1 (doľava) po 1 (doprava)
 * @property {Set<string>} buttons – práve držané tlačidlá
 * @property {Object}  motion  – posledný celý pohybový paket (o, a, r, ... – viď protocol.js)
 */

/** @type {Map<number, Player>} číslo hráča → stav */
const players = new Map();
// Kurzory na obrazovke a čo majú pod sebou (interné, hry ich nevidia): číslo hráča → { el, hover }.
const cursors = new Map();

// Odberatelia vstupov pre bežiacu hru: typ udalosti → množina funkcií.
const listeners = { motion: new Set(), button: new Set(), join: new Set(), leave: new Set() };
const emit = (type, ...args) => listeners[type].forEach((fn) => fn(...args));

// Práve bežiaca hra: { game, offs: [funkcie na odhlásenie], cleanup } alebo null (sme doma).
let current = null;
// Práve sa načítava hra? (aby dvojité stlačenie A nespustilo dve hry naraz)
let loading = false;
// Zobrazovať kurzory aj počas hry? Hra si to môže vypnúť cez api.showCursors(false).
let cursorsInGame = true;

// --- Spojenie so serverom ----------------------------------------------------

// Spojenie so serverom sa nadviazalo (aj po automatickom znovupripojení).
socket.on('connect', () => {
  updateStatus();
  // Požiadame server o novú reláciu. Tretí argument je funkcia, ktorú server zavolá s odpoveďou.
  socket.emit(EVENTS.CONSOLE_CREATE, null, ({ code, joinUrl, qr }) => {
    $('code').textContent = code;        // zobrazíme kód relácie
    $('qr').src = qr;                    // QR kód (obrázok v tvare data URL) vložíme do <img>
    $('join-url').href = joinUrl;        // odkaz pre telefón…
    $('join-url').textContent = joinUrl; // …aj jeho text
  });
});

// Spojenie so serverom sa prerušilo (napr. server bol vypnutý).
socket.on('disconnect', () => {
  // Server po odpojení konzoly reláciu zmaže → hru ukončíme a zabudneme všetkých hráčov.
  // Po znovupripojení sa vytvorí nová relácia s novým QR kódom.
  goHome();
  players.clear();
  cursors.forEach(({ el }) => el.remove());
  cursors.clear();
  renderSlots();
  $('status').textContent = 'Spojenie so serverom prerušené';
});

// Server oznámil, že sa pripojil hráč (nový, alebo vrátený po výpadku).
socket.on(EVENTS.PLAYER_JOINED, ({ playerId, color }) => {
  let player = players.get(playerId);
  if (!player) {
    player = { id: playerId, color, online: true, mode: MODES.POINTER, x: 0, y: 0, roll: 0, steer: 0, buttons: new Set(), motion: null };
    players.set(playerId, player);
    createCursor(player);
  }
  player.online = true;
  updateCursor(player);
  renderSlots();
  updateStatus();
  emit('join', player);
});

// Server oznámil, že sa hráč odpojil. Stav si necháme – môže sa do 15 s vrátiť.
socket.on(EVENTS.PLAYER_LEFT, ({ playerId }) => {
  const player = players.get(playerId);
  if (!player) return;
  player.online = false;
  player.buttons.clear();
  setHover(player, null);
  updateCursor(player);
  renderSlots();
  updateStatus();
  emit('leave', player);
});

// Prišli pohybové dáta (~60× za sekundu od každého telefónu).
// p = číslo hráča, m = režim, c = kurzor [x, y, roll], s = volant (celý popis v protocol.js).
socket.on(EVENTS.INPUT_MOTION, (packet) => {
  const player = players.get(packet.p);
  if (!player) return; // neznámy hráč – ignorujeme
  player.mode = packet.m;
  player.motion = packet;
  if (packet.m === MODES.WHEEL) {
    player.steer = packet.s ?? 0;
  } else if (packet.c) {
    [player.x, player.y, player.roll] = packet.c;
  }
  updateCursor(player);
  // Doma zisťujeme, nad ktorou hrou kurzor je; v hre pošleme pohyb hre.
  if (current) emit('motion', player, packet);
  else updateHover(player);
});

// Hráč stlačil alebo pustil tlačidlo.
socket.on(EVENTS.INPUT_BUTTON, ({ p, button, pressed }) => {
  const player = players.get(p);
  if (!player) return;
  if (pressed) player.buttons.add(button);
  else player.buttons.delete(button);
  cursors.get(p)?.el.classList.toggle('pressed', player.buttons.has(BUTTONS.A));

  // ⌂ Domov vybavuje konzola sama – hra sa o ňom nedozvie, iba sa ukončí.
  if (button === BUTTONS.HOME) {
    if (pressed) goHome();
    return;
  }
  if (current) {
    emit('button', player, button, pressed);
  } else if (pressed && button === BUTTONS.A) {
    // Doma: A = „klik“ na to, nad čím je kurzor (dlaždica hry je obyčajné <button>).
    cursors.get(p)?.hover?.click();
  }
});

// --- Kurzory hráčov ------------------------------------------------------------

// Vytvorí na obrazovke kurzor hráča (krúžok v jeho farbe s číslom).
function createCursor(player) {
  const el = document.createElement('div');
  el.className = 'cursor';
  el.style.setProperty('--c', player.color);
  el.innerHTML = `<span class="ring"></span><span class="tag">${player.id}</span>`;
  $('cursors').append(el);
  cursors.set(player.id, { el, hover: null });
}

// Presunie kurzor podľa aktuálneho stavu hráča a skryje ho, ak nemá zmysel ho ukázať.
function updateCursor(player) {
  const { el } = cursors.get(player.id);
  const visible = player.online && player.mode === MODES.POINTER && (!current || cursorsInGame);
  el.hidden = !visible;
  if (!visible) return;
  const { x, y } = toScreen(player.x, player.y);
  // translate = presun (rýchlejší ako meniť left/top), rotate = natočenie zápästia.
  el.style.transform = `translate(${x}px, ${y}px)`;
  el.querySelector('.ring').style.transform = `rotate(${player.roll}deg)`;
}

// Kurzor [-1..1, -1..1] → pixely v okne prehliadača.
function toScreen(x, y) {
  return { x: ((x + 1) / 2) * innerWidth, y: ((y + 1) / 2) * innerHeight };
}

// --- Domovská obrazovka -------------------------------------------------------

// Vytvorí mriežku hier: dlaždica za každú hru z games.js + prázdne miesta do počtu CHANNEL_SLOTS.
function renderChannels() {
  const tiles = GAMES.map((game) => {
    const el = document.createElement('button');
    el.className = 'channel';
    el.dataset.game = game.id;
    el.style.setProperty('--tile', game.color);
    const [min, max] = game.players;
    el.innerHTML = `<span class="icon">${game.icon}</span>
      <span class="title">${game.title}</span>
      <span class="meta">${min === max ? min : `${min}–${max}`} ${max === 1 ? 'hráč' : 'hráči'}</span>`;
    el.addEventListener('click', () => launch(game));
    // Aj myš ukáže popis hry v spodnej lište.
    el.addEventListener('mouseenter', () => showInfo(game));
    el.addEventListener('mouseleave', () => showInfo(null));
    return el;
  });
  while (tiles.length < CHANNEL_SLOTS) {
    const empty = document.createElement('div');
    empty.className = 'channel empty';
    tiles.push(empty);
  }
  $('channels').replaceChildren(...tiles);
}

// Zistí, nad ktorou dlaždicou je kurzor hráča (elementFromPoint = prvok na danom bode obrazovky).
function updateHover(player) {
  if (!player.online || player.mode !== MODES.POINTER) return setHover(player, null);
  const { x, y } = toScreen(player.x, player.y);
  setHover(player, document.elementFromPoint(x, y)?.closest('.channel[data-game]') ?? null);
}

// Zmení dlaždicu pod kurzorom hráča; pri nabehnutí na novú hru telefón krátko zavibruje.
function setHover(player, tile) {
  const cursor = cursors.get(player.id);
  if (!cursor || cursor.hover === tile) return;
  cursor.hover = tile;
  if (tile) vibrate(player.id, HOVER_BUZZ);
  // Zvýraznenie: dlaždica pod kurzorom má obrys vo farbe (posledného) hráča, ktorý na ňu mieri.
  for (const el of $('channels').children) {
    el.classList.remove('hover');
    el.style.removeProperty('--hc'); // myš potom zvýrazní dlaždicu opäť bielou
  }
  for (const [id, { hover }] of cursors) {
    if (!hover) continue;
    hover.classList.add('hover');
    hover.style.setProperty('--hc', players.get(id).color);
  }
  showInfo(tile ? GAMES.find((g) => g.id === tile.dataset.game) : null);
}

// Spodná lišta: popis hry, alebo nápoveda, keď kurzor nie je nad žiadnou hrou.
function showInfo(game) {
  $('info').textContent = game
    ? `${game.title} – ${game.description}`
    : players.size ? 'Namier telefón na hru a stlač A' : 'Pripoj telefón naskenovaním QR kódu';
}

// Štyri sloty hráčov v spodnej lište (pripojený / odpojený / voľný).
function renderSlots() {
  const slots = [];
  for (let id = 1; id <= MAX_PLAYERS; id++) {
    const player = players.get(id);
    const el = document.createElement('div');
    el.className = `slot ${player ? (player.online ? 'online' : 'offline') : 'free'}`;
    el.style.setProperty('--c', player?.color ?? PLAYER_COLORS[id - 1]);
    el.innerHTML = `<b>P${id}</b><span>${player ? (player.online ? 'pripojený' : 'odpojený') : 'voľné'}</span>`;
    slots.push(el);
  }
  $('slots').replaceChildren(...slots);
  if (!current) showInfo(null);
}

// Stavový text v hornej lište.
function updateStatus() {
  const online = [...players.values()].filter((p) => p.online).length;
  $('status').textContent = online ? `Pripojení hráči: ${online}` : 'Čakám na ovládače';
}

// Hodiny v rohu (ako na Wii). Stačí ich obnoviť raz za pár sekúnd.
function tickClock() {
  const now = new Date();
  $('clock').textContent =
    now.toLocaleDateString('sk', { weekday: 'short', day: 'numeric', month: 'numeric' }) + '  ' +
    now.toLocaleTimeString('sk', { hour: '2-digit', minute: '2-digit' });
}

// --- Spúšťanie hier -----------------------------------------------------------

// Načíta modul hry a spustí ho na ploche #stage.
async function launch(game) {
  if (current || loading) return;
  loading = true;
  $('info').textContent = `Načítavam ${game.title}…`;
  let start;
  try {
    // Dynamický import: súbor hry sa stiahne až teraz, keď ho treba.
    ({ default: start } = await import(`/games/${game.id}/game.js`));
    if (typeof start !== 'function') throw new Error('game.js musí mať `export default function start(api)`');
  } catch (err) {
    loading = false;
    console.error(err);
    $('info').textContent = `Hru „${game.title}“ sa nepodarilo načítať – detail v konzole prehliadača (F12).`;
    return;
  }
  loading = false;

  // Voliteľné štýly hry.
  if (game.css) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `/games/${game.id}/game.css`;
    link.id = 'game-css';
    document.head.append(link);
  }

  // Prepneme obrazovky: domov skryjeme, plochu hry vyčistíme a ukážeme.
  const stage = $('stage');
  stage.replaceChildren();
  stage.dataset.game = game.id;
  stage.hidden = false;
  $('home').hidden = true;
  players.forEach((p) => setHover(p, null));
  document.title = `${game.title} – WagglePlay`;

  current = { game, offs: [], cleanup: null };
  cursorsInGame = true;
  players.forEach(updateCursor);
  try {
    current.cleanup = (await start(createApi(current))) ?? null;
  } catch (err) {
    console.error(err);
    goHome();
    $('info').textContent = `Hra „${game.title}“ spadla pri štarte – detail v konzole prehliadača (F12).`;
  }
}

// Ukončí bežiacu hru a vráti sa na domovskú obrazovku.
function goHome() {
  if (!current) return;
  const { offs, cleanup } = current;
  current = null;
  offs.forEach((off) => off()); // odhlásime všetkých odberateľov vstupov, ktorých hra pridala
  try {
    cleanup?.();                // hra si upratá (časovače, requestAnimationFrame, ...)
  } catch (err) {
    console.error(err);
  }
  $('game-css')?.remove();
  const stage = $('stage');
  stage.replaceChildren();
  stage.hidden = true;
  delete stage.dataset.game;
  $('home').hidden = false;
  document.title = 'WagglePlay – Konzola';
  players.forEach(updateCursor);
  showInfo(null);
}

// API, ktoré dostane hra ako jediný argument funkcie start(api). Popis je v public/games/README.md.
function createApi(session) {
  return {
    root: $('stage'),
    game: session.game,
    players,
    // Odber vstupov: 'motion' (player, packet), 'button' (player, button, pressed), 'join' (player), 'leave' (player).
    // Vráti funkciu na odhlásenie; pri ukončení hry sa všetko odhlási automaticky.
    on(type, fn) {
      if (!listeners[type]) throw new Error(`Neznáma udalosť „${type}“`);
      if (session !== current) return () => {};
      listeners[type].add(fn);
      const off = () => listeners[type].delete(fn);
      session.offs.push(off);
      return off;
    },
    toScreen,
    vibrate,
    showCursors(visible) {
      cursorsInGame = visible;
      players.forEach(updateCursor);
    },
    exit: () => session === current && goHome(),
  };
}

// Pošle telefónu hráča príkaz na vibráciu. pattern = [vibruj, pauza, vibruj, ...] v ms.
function vibrate(playerId, pattern) {
  socket.emit(EVENTS.FEEDBACK_VIBRATE, { playerId, pattern });
}

// --- Štart ---------------------------------------------------------------------

// Klávesnica: Esc = späť domov (pre testovanie bez telefónu).
addEventListener('keydown', (e) => {
  if (e.key === 'Escape') goHome();
});

renderChannels();
renderSlots();
tickClock();
setInterval(tickClock, 5000);
