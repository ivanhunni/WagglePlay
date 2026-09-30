// =============================================================================
// games.js – zoznam hier, ktoré sa zobrazia na domovskej obrazovke konzoly.
//
// Novú hru pridáš takto:
//   1. vytvor priečinok public/games/<id>/ so súborom game.js (návod v README.md)
//   2. pridaj sem riadok s rovnakým `id`
// Poradie v poli = poradie dlaždíc na domovskej obrazovke.
// =============================================================================

/**
 * @typedef {Object} GameInfo
 * @property {string}   id          – názov priečinka v public/games/ (bez medzier a diakritiky)
 * @property {string}   title       – názov na dlaždici
 * @property {string}   description – krátky popis (zobrazí sa pri nabehnutí kurzorom)
 * @property {string}   icon        – emoji alebo znak na dlaždici
 * @property {string}   color       – farba dlaždice (#RRGGBB)
 * @property {number[]} players     – [minimum, maximum] hráčov
 * @property {boolean} [css]        – true = konzola načíta aj public/games/<id>/game.css
 */

/** @type {GameInfo[]} */
export const GAMES = [
  {
    id: 'test',
    title: 'Test ovládačov',
    description: 'Náhľad kurzora, volantu a surových hodnôt senzorov každého telefónu.',
    icon: '🎮',
    color: '#64748b',
    players: [1, 4],
    css: true,
  },
];
