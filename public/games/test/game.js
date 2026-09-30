// =============================================================================
// games/test/game.js – „Test ovládačov“: karta pre každého hráča s náhľadom
// kurzora (telefón na výšku) alebo volantu (na šírku) a surovými hodnotami senzorov.
// Zároveň je to najjednoduchší príklad hry – ukazuje celé API konzoly.
// =============================================================================

import { MODES, BUTTONS } from '/shared/protocol.js';

// Konzola zavolá túto funkciu pri spustení hry. `api` je popísané v public/games/README.md.
export default function start(api) {
  // Kurzory cez celú obrazovku tu nepotrebujeme – každá karta má vlastný náhľad.
  api.showCursors(false);

  api.root.innerHTML = `<header><h1>Test ovládačov</h1><p>⌂ Domov na telefóne alebo Esc = späť</p></header>
    <section class="players"></section>`;
  const list = api.root.querySelector('.players');

  // Karty hráčov: číslo hráča → { el, cursor, wheel, info, canvas, last }.
  const cards = new Map();

  // Kartu vytvoríme pre hráčov, ktorí už sú pripojení, aj pre tých, čo prídu neskôr.
  api.players.forEach((player) => cardFor(player));
  api.on('join', (player) => cardFor(player).el.classList.remove('offline'));
  api.on('leave', (player) => cards.get(player.id)?.el.classList.add('offline'));

  api.on('motion', (player, { o, a }) => {
    const card = cardFor(player);
    const wheel = player.mode === MODES.WHEEL;
    // CSS podľa triedy 'wheel' ukáže volant namiesto kurzora.
    card.el.classList.toggle('wheel', wheel);

    if (wheel) {
      card.last = null; // po návrate ku kurzoru začne stopa odznova
      // steer = -1 až 1 → otočenie obrázka volantu o ±90°.
      card.wheel.style.transform = `rotate(${player.steer * 90}deg)`;
      card.info.textContent = `volant ${fmt(player.steer * 100)} %\n`;
    } else {
      const { x, y, roll } = player;
      // x, y = -1 až 1 → pozícia v % náhľadu (0 % = ľavý/horný okraj, 100 % = pravý/dolný).
      card.cursor.style.left = `${50 + x * 50}%`;
      card.cursor.style.top = `${50 + y * 50}%`;
      card.cursor.style.transform = `rotate(${roll}deg)`;
      drawTrail(card, x, y);
      card.info.textContent = `kurzor  x ${fmt(x)}  y ${fmt(y)}  roll ${fmt(roll)}\n`;
    }
    card.info.textContent +=
      `orient  α ${fmt(o[0])}  β ${fmt(o[1])}  γ ${fmt(o[2])}\n` +
      `accel   x ${fmt(a[0])}  y ${fmt(a[1])}  z ${fmt(a[2])}`;
  });

  api.on('button', (player, button, pressed) => {
    // Počas držania tlačidla má karta farebný obrys.
    cardFor(player).el.classList.toggle('pressed', pressed);
    // Po stlačení A telefón krátko zavibruje (40 ms).
    if (pressed && button === BUTTONS.A) api.vibrate(player.id, [40]);
  });

  // Vráti kartu hráča; ak ešte neexistuje, vytvorí ju.
  function cardFor(player) {
    let card = cards.get(player.id);
    if (card) return card;
    const el = document.createElement('article');
    el.className = 'player';
    el.style.setProperty('--c', player.color);
    el.classList.toggle('offline', !player.online);
    el.innerHTML = `<h2>Hráč ${player.id}</h2>
      <div class="preview"><canvas></canvas><div class="cursor"></div><div class="wheel"></div></div><pre></pre>`;
    card = {
      el,
      cursor: el.querySelector('.cursor'),
      wheel: el.querySelector('.wheel'),
      info: el.querySelector('pre'),
      canvas: el.querySelector('canvas'),
      color: player.color,
      last: null, // posledná poloha kurzora (odkiaľ kresliť čiaru stopy)
    };
    cards.set(player.id, card);
    list.append(el);
    return card;
  }
  // Nič netreba upratovať: odber vstupov zruší konzola a obsah plochy vymaže sama.
}

// Stopa kurzora v náhľade: čiara z minulej polohy do novej, staršie časti postupne blednú.
// Slúži na vyskúšanie plynulosti (kreslenie) a rýchlych švihov (Fruit Ninja).
function drawTrail(card, x, y) {
  const { canvas } = card;
  // Rozlíšenie plátna prispôsobíme jeho veľkosti na obrazovke (inak by bola čiara rozmazaná).
  if (canvas.width !== canvas.clientWidth) {
    canvas.width = canvas.clientWidth;
    canvas.height = canvas.clientHeight;
  }
  const ctx = canvas.getContext('2d');
  // Zosvetlenie starej stopy: 'destination-out' ubera z toho, čo už je nakreslené.
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = 'rgba(0, 0, 0, 0.08)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.globalCompositeOperation = 'source-over';

  const px = ((x + 1) / 2) * canvas.width;
  const py = ((y + 1) / 2) * canvas.height;
  if (card.last) {
    ctx.strokeStyle = card.color;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(card.last[0], card.last[1]);
    ctx.lineTo(px, py);
    ctx.stroke();
  }
  card.last = [px, py];
}

// Naformátuje číslo na 1 desatinné miesto a doplní medzery zľava na 6 znakov,
// aby sa stĺpce v texte neposúvali. `v ?? 0` – chýbajúcu hodnotu zobrazí ako 0.
const fmt = (v) => (v ?? 0).toFixed(1).padStart(6);
