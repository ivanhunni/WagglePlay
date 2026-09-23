// =============================================================================
// sessions.js – správa relácií (herných miestností) a hráčov v nich.
//
// Relácia = jedna otvorená karta konzoly na PC + najviac MAX_PLAYERS telefónov.
// Všetko je iba v pamäti (RAM) – po reštarte servera relácie zmiznú.
// =============================================================================

// Z protokolu potrebujeme max. počet hráčov a ich farby.
import { MAX_PLAYERS, PLAYER_COLORS } from '../shared/protocol.js';

// Znaky, z ktorých sa skladá kód relácie. Chýbajú 0/O a 1/I, lebo sa ľahko zamenia,
// ak by kód niekto opisoval ručne.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

// Trieda = „šablóna“ objektu, ktorý drží dáta aj funkcie na prácu s nimi.
// V server/index.js sa vytvorí jedna inštancia: new SessionStore().
export class SessionStore {
  // Mapa všetkých relácií: kód → objekt relácie.
  // `#` pred názvom = súkromná premenná, zvonka triedy sa k nej nedá dostať.
  #sessions = new Map();

  // Vytvorí novú reláciu pre konzolu s daným ID socketu (spojenia).
  create(consoleSocketId) {
    let code;
    // Generujeme náhodný kód, kým nenájdeme taký, ktorý ešte nie je obsadený.
    // (Pri 32^4 ≈ 1 milión možností sa to takmer vždy podarí na prvý pokus.)
    // Ak chceš dlhší kód, zmeň číslo 4.
    do code = randomCode(4);
    while (this.#sessions.has(code));

    // Objekt relácie:
    //   code            – kód relácie (napr. "K7PX")
    //   consoleSocketId – ID spojenia konzoly
    //   players         – mapa číslo hráča → objekt hráča (viď addPlayer)
    const session = { code, consoleSocketId, players: new Map() };
    this.#sessions.set(code, session); // uložíme ju do mapy
    return session;
  }

  // Nájde reláciu podľa kódu. Kód prevedie na veľké písmená, takže "k7px" = "K7PX".
  // `code ?? ''` – ak kód chýba, použije sa prázdny text (a nič sa nenájde).
  get(code) {
    return this.#sessions.get(String(code ?? '').toUpperCase());
  }

  // Zmaže reláciu (keď sa zatvorí konzola).
  delete(code) {
    this.#sessions.delete(code);
  }

  /**
   * Pridá telefón do relácie a vráti objekt hráča, alebo null, ak je relácia plná.
   *
   * requestedId – číslo hráča, ktoré mal telefón predtým (po výpadku Wi-Fi).
   *               Ak je ten slot stále rezervovaný a voľný, telefón ho dostane späť.
   */
  addPlayer(session, socketId, requestedId) {
    // Skúsime nájsť pôvodný slot tohto telefónu.
    const existing = session.players.get(requestedId);
    // Ak slot existuje a nikto k nemu nie je pripojený (socketId je null = hráč je odpojený),
    // priradíme ho znova tomuto telefónu.
    if (existing && !existing.socketId) {
      existing.socketId = socketId;
      return existing;
    }

    // Inak hľadáme prvý voľný slot od 1 po MAX_PLAYERS.
    for (let id = 1; id <= MAX_PLAYERS; id++) {
      if (!session.players.has(id)) {
        // Objekt hráča:
        //   playerId    – číslo hráča (1–4)
        //   socketId    – ID aktuálneho spojenia telefónu (null = dočasne odpojený)
        //   color       – farba hráča (id - 1, lebo pole farieb začína indexom 0)
        //   removeTimer – časovač, ktorý hráča po výpadku po čase úplne odstráni
        const player = { playerId: id, socketId, color: PLAYER_COLORS[id - 1], removeTimer: null };
        session.players.set(id, player);
        return player;
      }
    }

    // Všetky sloty sú obsadené.
    return null;
  }

  // Úplne odstráni hráča z relácie (uvoľní slot pre niekoho iného).
  removePlayer(session, playerId) {
    session.players.delete(playerId);
  }
}

// Vygeneruje náhodný kód danej dĺžky zo znakov CODE_ALPHABET.
function randomCode(length) {
  let code = '';
  for (let i = 0; i < length; i++) {
    // Math.random() dá číslo 0–0.999…, vynásobíme počtom znakov a zaokrúhlime nadol
    // → dostaneme náhodný index do CODE_ALPHABET.
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return code;
}
