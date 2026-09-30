// =============================================================================
// modes.js – premení surové dáta senzorov na „herné“ vstupy podľa toho,
// ako hráč drží telefón.
//
//   Na výšku  → režim POINTER (Wii Remote): kurzor je tam, kam mieri vrch telefónu (ako laser).
//   Na šírku  → režim WHEEL   (Wii Wheel):  otáčanie telefónu = natočenie volantu.
//
// Režim sa prepína sám podľa smeru gravitácie – hráč nemusí nič ťukať.
//
// Súradnice telefónu (podľa štandardu prehliadačov), keď telefón leží na stole displejom hore:
//   os x = doprava, os y = k vrchu telefónu, os z = kolmo z displeja nahor.
// =============================================================================

import { MODES } from '/shared/protocol.js';

// --- Nastavenia (zmeň podľa citu pri hraní) ---------------------------------

// O koľko stupňov treba otočiť telefón od stredu doľava/doprava, aby kurzor došiel na okraj
// obrazovky. Menšie číslo = citlivejší kurzor.
const POINTER_RANGE_X = 25;
// Hore/dole sa rozsah dopočíta z pomeru strán obrazovky (16:9), aby jeden stupeň posunul
// kurzor rovnako ďaleko v oboch smeroch – inak by nakreslený kruh vyšiel ako vajce.
const SCREEN_ASPECT = 16 / 9;
const POINTER_RANGE_Y = POINTER_RANGE_X / SCREEN_ASPECT;
// Kurzor môže vyjsť kúsok za okraj (1 = presne okraj), ďalej sa zastaví.
// Keďže kurzor je vždy tam, kam telefón mieri, po návrate je presne tam, kde bol.
const POINTER_LIMIT = 1.15;

// Vyhladzovanie kurzora (One Euro filter): pri pomalom pohybe vyhladzuje silno (presné kreslenie),
// pri rýchlom takmer vôbec (švih v Fruit Ninja bez oneskorenia).
//   POINTER_MIN_CUTOFF – vyhladenie v pokoji (Hz): menej = pokojnejší kurzor, ale viac „ťahá“
//   POINTER_SPEED_COEF – ako rýchlo vyhladzovanie ustupuje s rýchlosťou: viac = menšie oneskorenie pri švihu
const POINTER_MIN_CUTOFF = 0.7;
const POINTER_SPEED_COEF = 15;

// Natočenie volantu v stupňoch, ktoré znamená „naplno doľava/doprava“.
const WHEEL_RANGE = 60;
// Mŕtva zóna v strede volantu (stupne) – malé chvenie rúk auto nerozkýve.
const WHEEL_DEADZONE = 3;
// Vyhladzovanie volantu: 0–1, menšie = plynulejšie, ale s väčším oneskorením.
const WHEEL_SMOOTHING = 0.35;

// Prepínanie režimov podľa toho, ako veľmi je telefón otočený na bok (0 = na výšku, 1 = úplne na šírku).
// Dva prahy (hysterézia) zabránia tomu, aby režim „blikal“ tam a späť na hranici.
const WHEEL_ENTER = 0.8;   // ≈ 53° na bok → prepni na volant
const POINTER_ENTER = 0.5; // ≈ 30° na bok → späť na kurzor
// Ako dlho (ms) musí nová poloha vydržať, kým sa režim naozaj prepne.
const MODE_SWITCH_MS = 300;

// Prevod stupňov na radiány a späť.
const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

/**
 * Vytvorí sledovanie režimov. Vráti objekt s funkciami:
 *   setOrientation(alpha, beta, gamma, time) – volaj pri každej udalosti 'deviceorientation'
 *   recenter()  – kalibrácia „mierim rovno“: aktuálny smer telefónu = stred obrazovky
 *   read()                      – aktuálny stav { m, c, s } na odoslanie konzole
 * onModeChange(mode) sa zavolá vždy, keď sa režim prepne.
 */
export function createModes(onModeChange) {
  let mode = MODES.POINTER;
  // Smer „hore“ (proti gravitácii) v súradniciach telefónu – jednotkový vektor [x, y, z].
  let up = [0, 0, 1];
  // Smer mierenia (stupne): yaw = doľava/doprava, pitch = hore/dole.
  // yaw0/pitch0 = smer, ktorý je „stred obrazovky“ (nastaví ho kalibrácia).
  let yaw = 0;
  let pitch = 0;
  let yaw0 = 0;
  let pitch0 = 0;
  // Vyhladená poloha kurzora (-1 až 1) a otočenie zápästia.
  const filterX = createOneEuroFilter(POINTER_MIN_CUTOFF, POINTER_SPEED_COEF);
  const filterY = createOneEuroFilter(POINTER_MIN_CUTOFF, POINTER_SPEED_COEF);
  let x = 0;
  let y = 0;
  let roll = 0;
  // Natočenie volantu (-1 až 1).
  let steer = 0;
  // Režim, na ktorý sa chystáme prepnúť, a odkedy (pre MODE_SWITCH_MS).
  let pending = null;
  let pendingSince = 0;

  // Z orientácie telefónu (alpha, beta, gamma) vypočíta smer „hore“, režim, kurzor, zápästie a volant.
  // Používame orientáciu (nie akcelerometer), lebo iPhone a Android majú znamienka
  // akcelerometra navzájom otočené, kým orientácia je na oboch rovnaká.
  // time = čas udalosti v ms (pre vyhladzovanie kurzora).
  function setOrientation(alpha, beta, gamma, time) {
    const a = alpha * RAD;
    const b = beta * RAD;
    const g = gamma * RAD;
    up = [-Math.cos(b) * Math.sin(g), Math.sin(b), Math.cos(b) * Math.cos(g)];

    updateMode();

    // Smer, ktorým mieri vrch telefónu (os y), v súradniciach miestnosti:
    // [na východ, na sever, nahor] = [-sin α·cos β, cos α·cos β, sin β].
    // Počítame z celého vektora, nie priamo z uhlov – tie pri otočení telefónu „cez hlavu“
    // preskakujú (beta ide z 90 na 180 a alpha skočí o 180°), vektor je však stále ten istý.
    const forward = [-Math.sin(a) * Math.cos(b), Math.cos(a) * Math.cos(b), Math.sin(b)];
    yaw = Math.atan2(-forward[0], forward[1]) * DEG;
    pitch = Math.asin(clamp(forward[2], -1, 1)) * DEG;
    if (mode === MODES.POINTER) updatePointer(time);

    // Otočenie zápästia okolo osi, ktorou telefón mieri (kladné = doprava).
    roll = Math.atan2(-up[0], up[2]) * DEG;

    // Volant: uhol smeru „hore“ v rovine displeja. `side` = na ktorú stranu je telefón
    // otočený (vrchom doľava alebo doprava) – aby „doprava“ bolo doprava v oboch prípadoch.
    const side = Math.sign(up[0]) || 1;
    let angle = Math.atan2(side * up[1], side * up[0]) * DEG;
    // Mŕtva zóna: odrátame ju, aby volant za ňou začínal plynulo od nuly.
    angle = Math.sign(angle) * Math.max(0, Math.abs(angle) - WHEEL_DEADZONE);
    const target = clamp(angle / (WHEEL_RANGE - WHEEL_DEADZONE), -1, 1);
    // Exponenciálne vyhladzovanie: posunieme sa o kúsok smerom k novej hodnote.
    steer += (target - steer) * WHEEL_SMOOTHING;
  }

  // Rozhodne o režime podľa toho, ako veľmi je telefón otočený na bok (|up.x|).
  function updateMode() {
    const sideways = Math.abs(up[0]);
    const wanted =
      mode === MODES.POINTER && sideways > WHEEL_ENTER ? MODES.WHEEL
      : mode === MODES.WHEEL && sideways < POINTER_ENTER ? MODES.POINTER
      : mode;

    if (wanted === mode) {
      pending = null;
      return;
    }
    const now = performance.now();
    if (pending !== wanted) {
      pending = wanted;
      pendingSince = now;
    } else if (now - pendingSince >= MODE_SWITCH_MS) {
      mode = wanted;
      pending = null;
      // Pri návrate na kurzor predpokladáme, že hráč mieri na stred obrazovky.
      if (mode === MODES.POINTER) recenter();
      steer = 0;
      onModeChange?.(mode);
    }
  }

  // Smer mierenia → poloha kurzora. Ako laserové ukazovadlo: rovnaký smer = rovnaký bod.
  function updatePointer(time) {
    // Rozdiel oproti stredu. Yaw prepočítame do rozsahu -180 až 180,
    // aby prechod cez 0°/360° neurobil skok cez celú obrazovku.
    const dYaw = wrap180(yaw - yaw0);
    const dPitch = pitch - pitch0;
    // Otočenie doľava zvyšuje yaw, kurzor má ísť doľava → mínus. Hore zvyšuje pitch, y rastie nadol → mínus.
    const rawX = clamp(-dYaw / POINTER_RANGE_X, -POINTER_LIMIT, POINTER_LIMIT);
    const rawY = clamp(-dPitch / POINTER_RANGE_Y, -POINTER_LIMIT, POINTER_LIMIT);
    x = filterX(rawX, time);
    y = filterY(rawY, time);
  }

  // Kalibrácia: aktuálny smer telefónu sa stane stredom obrazovky.
  function recenter() {
    yaw0 = yaw;
    pitch0 = pitch;
    filterX.reset();
    filterY.reset();
    x = 0;
    y = 0;
  }

  // Stav na odoslanie. Zaokrúhľujeme, aby pakety boli menšie.
  function read() {
    return mode === MODES.POINTER
      ? { m: mode, c: [round(x, 3), round(y, 3), round(roll, 1)] }
      : { m: mode, s: round(steer, 3) };
  }

  return { setOrientation, recenter, read, get mode() { return mode; } };
}

/**
 * One Euro filter – vyhladzovanie, ktoré sa prispôsobuje rýchlosti pohybu
 * (Casiez a kol., 2012; https://gery.casiez.net/1euro/).
 * Je to dolnopriepustný filter, ktorého „priepustnosť“ (cutoff, v Hz) rastie s rýchlosťou:
 *   pomalý pohyb → nízky cutoff → silné vyhladenie (preč s chvením rúk)
 *   rýchly pohyb → vysoký cutoff → skoro žiadne oneskorenie
 * Vráti funkciu filter(hodnota, časVMs) → vyhladená hodnota; filter.reset() ho vynuluje.
 */
function createOneEuroFilter(minCutoff, speedCoef, speedCutoff = 5) {
  let prev;      // posledná vyhladená hodnota
  let prevSpeed; // posledná vyhladená rýchlosť
  let prevTime;

  // Koľko z novej hodnoty prevziať (0–1) pri danom cutoff a časovom kroku.
  const smoothing = (cutoff, dt) => 1 / (1 + 1 / (2 * Math.PI * cutoff * dt));

  function filter(value, time) {
    const dt = prevTime === undefined ? 0 : (time - prevTime) / 1000;
    // Prvá hodnota alebo nezmyselný čas (napr. po uspatí telefónu) → prevezmeme hodnotu priamo.
    if (prev === undefined || !(dt > 0) || dt > 0.5) {
      prev = value;
      prevSpeed = 0;
      prevTime = time;
      return value;
    }
    prevTime = time;
    // Rýchlosť (jednotky za sekundu), tiež mierne vyhladená, aby cutoff neskákal.
    const speed = (value - prev) / dt;
    prevSpeed += (speed - prevSpeed) * smoothing(speedCutoff, dt);
    const cutoff = minCutoff + speedCoef * Math.abs(prevSpeed);
    prev += (value - prev) * smoothing(cutoff, dt);
    return prev;
  }
  filter.reset = () => { prev = undefined; };
  return filter;
}

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
// Prevedie uhol na rozsah -180 až 180 (napr. 350° → -10°).
const wrap180 = (deg) => ((((deg + 180) % 360) + 360) % 360) - 180;
const round = (v, digits) => Math.round(v * 10 ** digits) / 10 ** digits;
