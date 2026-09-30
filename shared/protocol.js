// =============================================================================
// protocol.js – „slovník“ komunikácie medzi serverom, konzolou (PC) a ovládačom (telefón).
//
// Všetky tri časti importujú tento jeden súbor, takže názvy správ sú všade rovnaké.
// Ak chceš pridať novú správu (napr. „input:shake“), pridaj ju sem a použi konštantu
// EVENTS.XYZ – nikdy nepíš názov správy ručne ako text, ľahko sa spraví preklep.
//
// Súbor sa posiela aj do prehliadača (na adrese /shared/protocol.js),
// preto nesmie importovať nič z Node.js ani z npm knižníc.
//
// Značenie smerov:  K = konzola (PC), S = server, T = telefón (ovládač)
// =============================================================================

// Roly, ktoré môže mať pripojený klient. Server si ich pamätá pri každom spojení.
// Object.freeze = objekt sa nedá neskôr omylom zmeniť.
export const ROLES = Object.freeze({
  CONSOLE: 'console',       // karta prehliadača na PC, ktorá zobrazuje hru
  CONTROLLER: 'controller', // telefón
});

// Názvy všetkých správ (udalostí), ktoré sa posielajú cez Socket.IO.
// Formát komentára: smer – aké dáta správa nesie.
export const EVENTS = Object.freeze({
  // K → S: „vytvor novú reláciu“.
  // Server odpovie (ack = odpoveď na konkrétnu správu) objektom { code, joinUrl, qr }.
  CONSOLE_CREATE: 'console:create',

  // T → S: „pripoj ma do relácie s týmto kódom“. Dáta: { code, playerId? }
  // playerId sa posiela iba pri znovupripojení (aby hráč dostal späť svoj slot).
  // Odpoveď: { ok: true, playerId, color } alebo { ok: false, error }.
  CONTROLLER_JOIN: 'controller:join',

  // T → S → K: pohybové dáta, ~60× za sekundu. Dáta: MotionPacket (popis nižšie).
  // Posiela sa ako „volatile“ – ak sa nestihne doručiť, zahodí sa (nechceme starý pohyb).
  INPUT_MOTION: 'input:motion',

  // T → S → K: stlačenie/pustenie tlačidla. Dáta: { button: BUTTONS.x, pressed: true/false }
  // Posiela sa spoľahlivo – stlačenie sa nesmie stratiť.
  INPUT_BUTTON: 'input:button',

  // K → S → T: konzola chce, aby telefón zavibroval.
  // Dáta: { playerId, pattern } – pattern je pole milisekúnd [vibruj, pauza, vibruj, ...].
  FEEDBACK_VIBRATE: 'feedback:vibrate',

  // S → K: pripojil sa nový hráč (alebo sa vrátil po výpadku). Dáta: { playerId, color }
  PLAYER_JOINED: 'player:joined',

  // S → K: hráč sa odpojil. Dáta: { playerId }
  PLAYER_LEFT: 'player:left',

  // S → T: konzola sa zatvorila, relácia už neexistuje.
  SESSION_CLOSED: 'session:closed',
});

// Tlačidlá ovládača (hodnota `button` v správe INPUT_BUTTON).
//   A    – hlavné tlačidlo (výber v menu, akcia v hre)
//   B    – vedľajšie tlačidlo
//   HOME – návrat na domovskú obrazovku konzoly (hru ukončí konzola, nie hra sama)
export const BUTTONS = Object.freeze({
  A: 'A',
  B: 'B',
  HOME: 'HOME',
});

// Maximálny počet hráčov v jednej relácii. Ak ho zvýšiš, doplň aj farby nižšie.
export const MAX_PLAYERS = 4;

// Farba každého hráča (index 0 = hráč 1, index 1 = hráč 2, ...). Formát #RRGGBB.
// Farba sa zobrazí na karte hráča v konzole aj na tlačidlách v telefóne.
export const PLAYER_COLORS = ['#3b82f6', '#ef4444', '#22c55e', '#eab308'];

// Koľkokrát za sekundu posiela telefón pohybové dáta.
// Vyššie číslo = plynulejší pohyb, ale viac dát v sieti a vyššia spotreba batérie.
export const MOTION_HZ = 60;

// Režimy ovládača. Telefón ich prepína sám podľa toho, ako ho hráč drží:
//   POINTER – na výšku, vrch telefónu mieri na obrazovku (ako Wii Remote) → kurzor
//   WHEEL   – na šírku, displej otočený k hráčovi (ako Wii Wheel) → volant
export const MODES = Object.freeze({
  POINTER: 'pointer',
  WHEEL: 'wheel',
});

/**
 * MotionPacket – jeden balík pohybových dát z telefónu.
 * Názvy sú schválne jednopísmenové, lebo sa posiela 60× za sekundu (menej dát = nižšia latencia).
 *
 * @typedef {Object} MotionPacket
 * @property {number}   t – čas odoslania v ms (performance.now() v telefóne); hodí sa na meranie oneskorenia
 * @property {number[]} o – orientácia [alpha, beta, gamma] v stupňoch:
 *                          alpha = otočenie okolo zvislej osi (ako kompas), 0–360
 *                          beta  = predklon/záklon (vrch telefónu k tebe/od teba), -180–180
 *                          gamma = náklon doľava/doprava, -90–90
 * @property {number[]} a – zrýchlenie vrátane gravitácie [x, y, z] v m/s²
 *                          (v pokoji na stole je z ≈ 9.8; pri švihu hodnoty prudko skočia)
 * @property {number[]} r – rýchlosť otáčania z gyroskopu [alpha, beta, gamma] v stupňoch za sekundu
 * @property {string}   m – aktuálny režim ovládača: MODES.POINTER alebo MODES.WHEEL
 * @property {number[]} c – kurzor (iba v režime POINTER) [x, y, roll]:
 *                          x, y = poloha na obrazovke od -1 do 1 (0, 0 = stred; x doprava, y nadol)
 *                          roll = otočenie zápästia v stupňoch (kladné = v smere hodinových ručičiek)
 * @property {number}   s – natočenie volantu (iba v režime WHEEL) od -1 (naplno doľava) po 1 (naplno doprava)
 *
 * Server pred preposlaním do konzoly pridá ešte `p` = číslo hráča (playerId).
 */
