// =============================================================================
// controller.js – logika ovládača (beží v prehliadači telefónu).
//
// Čo robí:
//   1. z adresy prečíta kód relácie (?s=KÓD)
//   2. po ťuknutí na „Pripojiť“ požiada o prístup k senzorom pohybu
//   3. začne čítať gyroskop a akcelerometer
//   4. pripojí sa na server a vstúpi do relácie
//   5. 60× za sekundu posiela aktuálny pohyb, pri ťuknutí posiela tlačidlá
//   6. vibruje, keď o to konzola požiada
// =============================================================================

// Názvy správ a frekvencia posielania zo spoločného protokolu.
import { EVENTS, MOTION_HZ } from '/shared/protocol.js';

// Skratka na hľadanie HTML prvku podľa id.
const $ = (id) => document.getElementById(id);

// Kód relácie z adresy stránky. Napr. pre .../controller/?s=k7px → "K7PX".
// `?.` – ak parameter chýba, nevolá sa toUpperCase a výsledok je undefined.
const code = new URLSearchParams(location.search).get('s')?.toUpperCase();
// Zobrazíme kód na úvodnej obrazovke (alebo pomlčku, ak chýba).
$('code').textContent = code ?? '—';

// Texty chýb, ktoré vidí používateľ. Kľúč = kód chyby (zo servera alebo z tohto súboru).
const ERRORS = {
  SESSION_NOT_FOUND: 'Relácia neexistuje. Naskenuj QR kód znova.',
  SESSION_FULL: 'Relácia je plná (max. 4 hráči).',
  NO_SENSORS: 'Tento prehliadač nesprístupnil pohybové senzory. Skús iný prehliadač alebo povoľ prístup k pohybu.',
  PERMISSION_DENIED: 'Prístup k pohybovým senzorom bol zamietnutý.',
  NO_CODE: 'Chýba kód relácie. Naskenuj QR kód z obrazovky počítača.',
};

// Posledné namerané hodnoty senzorov. Udalosti senzorov ich priebežne prepisujú
// a časovač ich 60× za sekundu odošle (namiesto posielania pri každej udalosti,
// ktorých môže byť aj 100+ za sekundu a prichádzajú nepravidelne).
//   o = orientácia [alpha, beta, gamma], a = zrýchlenie [x, y, z], r = rýchlosť otáčania
const motion = { o: [0, 0, 0], a: [0, 0, 0], r: [0, 0, 0] };

// Číslo hráča z predchádzajúceho pripojenia (ak sa stránka obnovila alebo vypadla Wi-Fi).
// sessionStorage = malé úložisko v prehliadači, platné kým je karta otvorená.
// Number(null) = 0 → `|| undefined` → pri prvom pripojení žiadne číslo neposielame.
let playerId = Number(sessionStorage.getItem(`wp:${code}`)) || undefined;
let socket;    // spojenie so serverom (vytvorí sa až po ťuknutí na „Pripojiť“)
let sendTimer; // ID časovača, ktorý posiela pohyb (aby sa dal zastaviť)

// Ťuknutie na „Pripojiť ovládač“.
$('btn-start').addEventListener('click', async () => {
  if (!code) return showError('NO_CODE'); // bez kódu nemáme kam sa pripojiť
  try {
    // Žiadosť o povolenie MUSÍ byť priamo v obsluhe ťuknutia, inak ju iPhone zamietne.
    await requestSensorPermission();
  } catch (err) {
    return showError(err.message); // zobrazíme dôvod (NO_SENSORS alebo PERMISSION_DENIED)
  }
  startSensors(); // začneme čítať senzory
  connect();      // pripojíme sa na server
});

// Overí, že senzory sú dostupné, a na iPhone vyžiada povolenie.
async function requestSensorPermission() {
  // Senzory nie sú dostupné, ak ich prehliadač nepozná alebo stránka nebeží cez HTTPS.
  if (!('DeviceMotionEvent' in window) || !window.isSecureContext) throw new Error('NO_SENSORS');
  // iPhone (iOS 13+) má funkciu requestPermission a zobrazí dialóg „Povoliť prístup k pohybu“.
  // Android ju nemá – tam je prístup povolený automaticky a cyklus nič neurobí.
  // Pýtame sa na oba typy: DeviceMotion (zrýchlenie, gyroskop) a DeviceOrientation (náklon).
  for (const Ev of [DeviceMotionEvent, window.DeviceOrientationEvent]) {
    if (typeof Ev?.requestPermission === 'function' && (await Ev.requestPermission()) !== 'granted') {
      throw new Error('PERMISSION_DENIED');
    }
  }
}

// Začne počúvať udalosti senzorov a ukladať posledné hodnoty do `motion`.
function startSensors() {
  // Orientácia telefónu v priestore (v stupňoch). `?? 0` – ak hodnota chýba, použije sa 0.
  addEventListener('deviceorientation', (e) => {
    motion.o = [e.alpha ?? 0, e.beta ?? 0, e.gamma ?? 0];
  });
  // Pohyb telefónu: zrýchlenie (akcelerometer) a rýchlosť otáčania (gyroskop).
  addEventListener('devicemotion', (e) => {
    // accelerationIncludingGravity = zrýchlenie vrátane gravitácie (dostupné takmer na všetkých telefónoch).
    const g = e.accelerationIncludingGravity ?? {};
    const r = e.rotationRate ?? {};
    motion.a = [g.x ?? 0, g.y ?? 0, g.z ?? 0];
    motion.r = [r.alpha ?? 0, r.beta ?? 0, r.gamma ?? 0];
  });
}

// Pripojí sa na server a nastaví reakcie na správy zo servera.
function connect() {
  // Pripojenie na ten istý server, z ktorého prišla stránka, priamo cez WebSocket.
  socket = io({ transports: ['websocket'] });

  // Spustí sa pri prvom pripojení aj po každom automatickom znovupripojení
  // (Socket.IO sa po výpadku Wi-Fi pripája znova sám).
  socket.on('connect', () => {
    // Požiadame o vstup do relácie. Ak už máme playerId, server nám vráti ten istý slot.
    socket.emit(EVENTS.CONTROLLER_JOIN, { code, playerId }, (res) => {
      if (!res.ok) return showError(res.error);            // relácia neexistuje / je plná
      playerId = res.playerId;                             // naše číslo hráča
      sessionStorage.setItem(`wp:${code}`, playerId);      // uložíme ho pre prípadné znovupripojenie
      showPad(res);                                        // prepneme na obrazovku ovládača
      startSending();                                      // začneme posielať pohyb
    });
  });

  // Pri odpojení prestaneme posielať (nemalo by to kam ísť).
  socket.on('disconnect', stopSending);

  // Konzola sa zatvorila → relácia skončila. Odpojíme sa úplne (bez ďalších pokusov o pripojenie).
  socket.on(EVENTS.SESSION_CLOSED, () => {
    stopSending();
    socket.disconnect();
    showError('SESSION_NOT_FOUND');
  });

  // Konzola žiada vibráciu. navigator.vibrate funguje na Androide;
  // iPhone ju nepodporuje – `?.` zabezpečí, že tam sa jednoducho nič nestane.
  socket.on(EVENTS.FEEDBACK_VIBRATE, ({ pattern }) => navigator.vibrate?.(pattern));
}

// Spustí časovač, ktorý MOTION_HZ-krát za sekundu pošle aktuálny pohyb.
function startSending() {
  stopSending(); // pre istotu zastavíme starý časovač (aby nebežali dva naraz)
  let sent = 0;                         // počet odoslaných paketov v aktuálnej sekunde
  let windowStart = performance.now();  // začiatok aktuálnej sekundy (ms)
  // setInterval(funkcia, interval) volá funkciu opakovane; 1000 / 60 ≈ 16.7 ms.
  sendTimer = setInterval(() => {
    // Pošleme čas + kópiu aktuálnych hodnôt senzorov (…motion rozbalí o, a, r).
    // volatile = ak sa paket nedá hneď odoslať, zahodí sa (nechceme posielať starý pohyb).
    socket.volatile.emit(EVENTS.INPUT_MOTION, { t: performance.now(), ...motion });
    sent++;
    // Raz za sekundu zobrazíme, koľko paketov sme poslali, a začneme počítať odznova.
    const now = performance.now();
    if (now - windowStart >= 1000) {
      $('rate').textContent = `${sent} pkt/s`;
      sent = 0;
      windowStart = now;
    }
  }, 1000 / MOTION_HZ);
}

// Zastaví posielanie pohybu.
function stopSending() {
  clearInterval(sendTimer);
}

// Obsluha tlačidiel: pre každý prvok s atribútom data-button (A, B, ...).
for (const btn of document.querySelectorAll('[data-button]')) {
  // Vytvorí obsluhu udalosti pre stav `pressed` (true = stlačené, false = pustené).
  const send = (pressed) => (e) => {
    e.preventDefault();                           // zabráni predvolenému správaniu (výber textu, zoom)
    btn.classList.toggle('active', pressed);      // vizuálne zvýraznenie počas držania
    // Pošleme konzole názov tlačidla a stav. `socket?.` – ak ešte nie sme pripojení, nič sa nestane.
    socket?.emit(EVENTS.INPUT_BUTTON, { button: btn.dataset.button, pressed });
  };
  // „Pointer“ udalosti fungujú pre dotyk aj myš:
  btn.addEventListener('pointerdown', send(true));    // prst sa dotkol tlačidla
  btn.addEventListener('pointerup', send(false));     // prst sa zdvihol
  btn.addEventListener('pointercancel', send(false)); // dotyk bol prerušený (napr. prišiel hovor)
}

// Prepne na obrazovku ovládača a nastaví farbu a číslo hráča.
function showPad({ playerId, color }) {
  document.documentElement.style.setProperty('--c', color); // farba hráča pre celé CSS
  $('player-id').textContent = playerId;
  $('screen-start').hidden = true;  // skryjeme úvod
  $('screen-pad').hidden = false;   // ukážeme ovládač
}

// Zobrazí chybu na úvodnej obrazovke.
// `key` je kód chyby; ak pre neho nemáme text v ERRORS, zobrazí sa samotný kód.
function showError(key) {
  $('error').textContent = ERRORS[key] ?? key;
  $('error').hidden = false;
  $('screen-start').hidden = false;
  $('screen-pad').hidden = true;
}
