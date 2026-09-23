// =============================================================================
// socket.js – spracovanie všetkých správ cez Socket.IO (WebSocket).
//
// Server tu funguje ako „poštár“: nerozumie hre ani pohybu, iba vie,
// komu má ktorú správu doručiť (z telefónu do správnej konzoly a naopak).
//
// Základné pojmy Socket.IO:
//   socket          – jedno spojenie s jedným klientom (jedna karta prehliadača / jeden telefón)
//   socket.on(x,f)  – keď príde správa x od tohto klienta, zavolaj funkciu f
//   io.to(r).emit() – pošli správu všetkým klientom v miestnosti (room) r
//   socket.join(r)  – pridaj klienta do miestnosti r
//   ack             – callback funkcia; jej zavolaním pošleme odpoveď priamo na danú správu
// =============================================================================

// Knižnica na vytvorenie QR kódu ako obrázka.
import QRCode from 'qrcode';
// Názvy správ a rol zo spoločného protokolu.
import { EVENTS, ROLES } from '../shared/protocol.js';

// Ako dlho (v ms) si odpojený telefón drží svoj slot, aby sa mohol vrátiť ako ten istý hráč.
// 15_000 = 15 000 ms = 15 sekúnd (podčiarkovník je iba pre čitateľnosť čísla).
const REJOIN_GRACE_MS = 15_000;

/**
 * Zaregistruje všetky obsluhy správ.
 * io                – Socket.IO server (z index.js)
 * sessions          – úložisko relácií (SessionStore zo sessions.js)
 * controllerBaseUrl – adresa, na ktorej telefón nájde server, napr. https://192.168.1.23:3443
 */
export function registerSocketHandlers(io, sessions, { controllerBaseUrl }) {
  // Táto funkcia sa zavolá pri KAŽDOM novom pripojení (konzola aj telefón).
  // Všetko vo vnútri platí pre jedno konkrétne spojenie `socket`.
  io.on('connection', (socket) => {
    // --- Konzola (PC) -------------------------------------------------------

    // Konzola žiada o vytvorenie novej relácie.
    // `_payload` – dáta správy (tu žiadne nie sú, podčiarkovník = „nepoužívam“)
    // `ack`      – funkcia na poslanie odpovede späť konzole
    socket.on(EVENTS.CONSOLE_CREATE, async (_payload, ack) => {
      // Vytvoríme reláciu s novým kódom.
      const session = sessions.create(socket.id);
      // socket.data = miesto, kde si k spojeniu pamätáme vlastné údaje.
      // Neskôr (napr. pri odpojení) z toho zistíme, kto to bol.
      socket.data = { role: ROLES.CONSOLE, code: session.code };
      // Konzolu dáme do jej vlastnej miestnosti – telefóny budú posielať správy do nej.
      socket.join(consoleRoom(session.code));

      // Adresa, ktorú otvorí telefón po naskenovaní QR kódu (kód relácie je v parametri ?s=).
      const joinUrl = `${controllerBaseUrl}/controller/?s=${session.code}`;
      // Vytvoríme QR kód ako obrázok zakódovaný v texte („data URL“), ktorý sa dá
      // priamo vložiť do <img src="...">.
      //   margin – šírka bieleho okraja okolo kódu (v „štvorčekoch“)
      //   width  – veľkosť obrázka v pixeloch
      const qr = await QRCode.toDataURL(joinUrl, { margin: 1, width: 320 });
      // Pošleme konzole odpoveď. `ack?.(...)` = zavolaj iba ak ack existuje.
      ack?.({ code: session.code, joinUrl, qr });
    });

    // Konzola chce, aby niektorý telefón zavibroval.
    // `= {}` – ak by dáta chýbali, použije sa prázdny objekt (inak by rozloženie spadlo).
    socket.on(EVENTS.FEEDBACK_VIBRATE, ({ playerId, pattern } = {}) => {
      // Overíme, že správu poslala naozaj konzola, a nájdeme jej reláciu.
      const session = ownSession(socket, ROLES.CONSOLE);
      // Nájdeme hráča v relácii.
      const player = session?.players.get(playerId);
      // Ak je hráč práve pripojený, pošleme správu iba jeho telefónu
      // (ID socketu funguje aj ako názov miestnosti s jediným členom).
      if (player?.socketId) io.to(player.socketId).emit(EVENTS.FEEDBACK_VIBRATE, { pattern });
    });

    // --- Ovládač (telefón) --------------------------------------------------

    // Telefón sa chce pripojiť do relácie.
    socket.on(EVENTS.CONTROLLER_JOIN, ({ code, playerId } = {}, ack) => {
      // Nájdeme reláciu podľa kódu z QR kódu.
      const session = sessions.get(code);
      // Neexistuje (zlý kód alebo konzola bola zatvorená) → pošleme chybu a skončíme.
      if (!session) return ack?.({ ok: false, error: 'SESSION_NOT_FOUND' });

      // Pridáme hráča (alebo mu vrátime pôvodný slot).
      const player = sessions.addPlayer(session, socket.id, playerId);
      // Žiadny voľný slot → chyba.
      if (!player) return ack?.({ ok: false, error: 'SESSION_FULL' });

      // Ak hráč mal po výpadku bežiaci časovač na odstránenie, zrušíme ho – vrátil sa.
      clearTimeout(player.removeTimer);
      // Zapamätáme si, kto je toto spojenie.
      socket.data = { role: ROLES.CONTROLLER, code: session.code, playerId: player.playerId };
      // Telefón pridáme do miestnosti všetkých ovládačov tejto relácie
      // (aby sme im naraz mohli poslať napr. „relácia skončila“).
      socket.join(controllersRoom(session.code));

      // Oznámime konzole, že sa pripojil hráč.
      io.to(consoleRoom(session.code)).emit(EVENTS.PLAYER_JOINED, {
        playerId: player.playerId,
        color: player.color,
      });
      // Odpovieme telefónu: úspech, tvoje číslo a farba.
      ack?.({ ok: true, playerId: player.playerId, color: player.color });
    });

    // Telefón poslal pohybové dáta.
    socket.on(EVENTS.INPUT_MOTION, (packet) => {
      // Bezpečnostná kontrola: pohyb môže posielať iba pripojený ovládač.
      if (socket.data?.role !== ROLES.CONTROLLER) return;
      // Prepošleme do konzoly relácie.
      // `.volatile` = ak konzola nestíha (sieť je zahltená), správu zahoď
      // namiesto zaradenia do fronty – pri pohybe chceme iba najčerstvejšie dáta.
      io.to(consoleRoom(socket.data.code)).volatile.emit(EVENTS.INPUT_MOTION, {
        ...packet,            // skopírujeme všetky údaje z telefónu (t, o, a, r)
        p: socket.data.playerId, // a pridáme číslo hráča, aby konzola vedela, od koho to je
      });
    });

    // Telefón poslal stlačenie tlačidla.
    socket.on(EVENTS.INPUT_BUTTON, (payload) => {
      if (socket.data?.role !== ROLES.CONTROLLER) return;
      // Rovnako ako pohyb, ale BEZ volatile – stlačenie sa nesmie stratiť.
      io.to(consoleRoom(socket.data.code)).emit(EVENTS.INPUT_BUTTON, {
        ...payload,
        p: socket.data.playerId,
      });
    });

    // --- Odpojenie ----------------------------------------------------------

    // Spustí sa, keď sa spojenie preruší (zatvorená karta, výpadok Wi-Fi, zamknutý telefón…).
    socket.on('disconnect', () => {
      // Vytiahneme si, kto to bol (údaje sme uložili pri create/join).
      const { role, code, playerId } = socket.data ?? {};
      const session = sessions.get(code);
      // Klient sa nikdy nepripojil do relácie → nie je čo upratovať.
      if (!session) return;

      if (role === ROLES.CONSOLE) {
        // Zatvorila sa konzola → oznámime všetkým telefónom, že relácia skončila, a zmažeme ju.
        io.to(controllersRoom(code)).emit(EVENTS.SESSION_CLOSED);
        sessions.delete(code);
      } else if (role === ROLES.CONTROLLER) {
        const player = session.players.get(playerId);
        // Ak sa telefón medzitým pripojil znova (nové spojenie má iné socketId),
        // toto staré odpojenie ignorujeme.
        if (player?.socketId !== socket.id) return;
        // Označíme hráča ako odpojeného, ale slot mu zatiaľ necháme.
        player.socketId = null;
        // Konzola zobrazí hráča ako neaktívneho.
        io.to(consoleRoom(code)).emit(EVENTS.PLAYER_LEFT, { playerId });
        // Po REJOIN_GRACE_MS hráča úplne odstránime – ale iba ak sa medzitým nevrátil.
        player.removeTimer = setTimeout(() => {
          if (!player.socketId) sessions.removePlayer(session, playerId);
        }, REJOIN_GRACE_MS);
      }
    });

    // Pomocná funkcia: vráti reláciu spojenia `sock`, ale iba ak má požadovanú rolu.
    // Zabráni tomu, aby napr. telefón posielal správy určené iba konzole.
    function ownSession(sock, role) {
      return sock.data?.role === role ? sessions.get(sock.data.code) : undefined;
    }
  });
}

// Názvy miestností. Každá relácia má dve:
//   console:K7PX     – iba konzola
//   controllers:K7PX – všetky telefóny v relácii
const consoleRoom = (code) => `console:${code}`;
const controllersRoom = (code) => `controllers:${code}`;
