// Płanetnik, the mascot. In Polish lore a płanetnik rides the storm clouds and
// drives the hail; here he stands on his cloud and judges the turn: calm skies
// for clean code, a gathering storm as the slop score rises, and lightning in
// his fist at Big Ball of Mud. One pixel grid, drawn as SVG on desktop and as
// half-block cells in the terminal. Presentation only.

import type { SlopState } from '../types/index.d.ts'
import { stateOf } from './score.ts'

export const WIDTH = 28
export const HEIGHT = 26

/** One pixel per letter: hair, skin, beard, cloak, boots, clouds and weather. */
const PALETTE = {
  h: '#9d968b', H: '#6b645b', l: '#cfc8bb', // hair, dark, light
  f: '#d9d1c3', F: '#aaa192', // skin, shadow
  e: '#1c1916', g: '#ffe9a3', // eyes, glowing eyes
  b: '#bdb5a7', B: '#7d7568', // beard, dark strands
  d: '#c9c1b2', D: '#8e8678', o: '#e8e0d0', k: '#3e3933', // cloak, folds, brooch, boots
  c: '#d8d4cc', n: '#7a7886', N: '#3f3e4c', // clouds: fair, grey, storm
  z: '#fff1a8', r: '#5f86b3', i: '#e9eef4', // lightning, rain, hail
  W: '#f6f2e8', w: '#cbc3b2', // slop and its shadow
} as const

export type Pixel = keyof typeof PALETTE
export type Grid = (Pixel | null)[][]
type Put = (x: number, y: number, p: Pixel) => void

const TILE = '#0f1729'
const FLASH = '#2f3a5c'
const MOODS: SlopState[] = ['CLEAN', 'MILD SLOP', 'GETTING SLOPPY', 'HEAVY SLOP', 'BIG BALL OF MUD']
const FACES = ['(•_•)', '(¬_¬)', '(ಠ_ಠ)', '(ಠ益ಠ)', '(╬ಠ益ಠ)']
const MOODS_SAID = ['calm skies', 'a cloud gathering', 'grey clouds and a heavy brow', 'raising lightning in the rain', 'a full storm, eyes blazing']
/** The bolt that strikes when a turn crosses into Big Ball of Mud. */
const STRIKE = [[2, 0], [1, 1], [2, 2], [3, 3], [2, 4], [1, 5], [2, 6], [3, 7], [2, 8], [1, 9], [2, 10], [1, 11], [2, 12], [3, 13], [2, 14], [1, 15], [2, 16], [1, 17], [2, 18], [1, 19], [2, 20], [1, 21]] as const

const moodOf = (score: number) => MOODS.indexOf(stateOf(Math.max(0, Math.min(100, Math.round(score)))))

/** His face for the band: calm to furious. */
export const planetnikFace = (score: number) => FACES[moodOf(score)]!

/** What the drawing shows, for readers that cannot see it. */
export const planetnikAlt = (score: number) => `Płanetnik: ${MOODS_SAID[moodOf(score)]}`

/**
 * Płanetnik at a score, one animation `frame` in: frames bob him when calm,
 * blink his eyes, drift the clouds and move the rain and hail.
 */
export function planetnik(score: number, frame = 0, { strike = false } = {}): Grid {
  const s = Math.max(0, Math.min(100, Math.round(score)))
  const mood = moodOf(s)
  const grid: Grid = Array.from({ length: HEIGHT }, () => Array<Pixel | null>(WIDTH).fill(null))
  const put: Put = (x, y, p) => {
    if (x >= 0 && x < WIDTH && y >= 0 && y < HEIGHT) grid[y]![x] = p
  }
  const bob = mood <= 1 && frame % 2 === 1 ? -1 : 0
  const lifted: Put = (x, y, p) => put(x, y + bob, p)

  weather(put, mood, frame)
  wind(lifted, mood, frame)
  figure(lifted, mood, frame)
  standingCloud(put, mood)
  if (mood >= 2) slop(put, lifted, s)
  if (mood === 4) hail(grid, put, frame)
  if (strike) STRIKE.forEach(([x, y]) => put(x, y, 'z'))
  return grid
}

function cloud(put: Put, x0: number, y0: number, width: number, p: Pixel) {
  for (let x = x0 + 2; x <= x0 + Math.min(4, width - 2); x++) put(x, y0 - 1, p)
  for (let x = x0 + 1; x <= x0 + width - 2; x++) put(x, y0, p)
  for (let y = y0 + 1; y <= y0 + 2; y++) for (let x = x0; x < x0 + width; x++) put(x, y, p)
}

/** Behind him: clouds that gather and darken, rain, and lightning in the distance. */
function weather(put: Put, mood: number, frame: number) {
  const drift = Math.floor(frame / 2) % 2
  if (mood >= 3) for (let k = 0; k < 16; k++) put((k * 7 + frame) % WIDTH, (k * 5 + frame * 2) % 22, 'r')
  const skies: [number, number, number, Pixel][][] = [
    [],
    [[0, 9, 5, 'c']],
    [[0, 9, 6, 'n'], [23, 12, 5, 'n']],
    [[0, 8, 6, 'N'], [24, 13, 4, 'N'], [1, 1, 7, 'n']],
    [[0, 7, 6, 'N'], [24, 12, 4, 'N'], [0, 0, 9, 'N'], [15, 0, 7, 'N']],
  ]
  for (const [x, y, w, p] of skies[mood]!) cloud(put, x + drift, y, w, p)
  if (mood === 4 || (mood === 3 && frame % 3 !== 2)) {
    for (const [x, y] of [[1, 11], [0, 12], [1, 13], [2, 14], [1, 15]] as const) put(x, y, 'z')
  }
}

/** Hair streaming in the wind, longer as the storm grows; his raised arm takes the lower strands. */
function wind(put: Put, mood: number, frame: number) {
  const reach = [0, 1, 3, 5, 7][mood]!
  const strand = (x0: number, y: number, len: number) => {
    for (let i = 0; i < len; i++) put(x0 + i, y, i === len - 1 ? 'l' : 'h')
  }
  for (const y of [1, 2, 3]) strand(20, y, Math.max(0, reach - (y % 2) + ((frame + y) % 2)))
  if (mood < 3) for (const y of [5, 7, 9]) strand(22, y, Math.max(0, reach - 1 + ((frame + y) % 2)))
}

function figure(put: Put, mood: number, frame: number) {
  const row = (y: number, x0: number, x1: number, p: Pixel) => {
    for (let x = x0; x <= x1; x++) put(x, y, p)
  }
  hair(row)
  for (let y = 4; y <= 9; y++) row(y, 9, 18, 'f')
  for (let y = 5; y <= 8; y++) {
    row(y, 9, 9, 'F')
    row(y, 18, 18, 'F')
  }
  row(7, 13, 14, 'F')
  cloak(row)
  arms(row, mood)
  beard(row)
  row(20, 8, 12, 'D'); row(21, 8, 12, 'D'); row(20, 15, 19, 'D'); row(21, 15, 19, 'D')
  row(22, 7, 12, 'k'); row(22, 15, 20, 'k')
  face(row, mood, frame)
}

function hair(row: (y: number, x0: number, x1: number, p: Pixel) => void) {
  row(1, 10, 17, 'h'); row(2, 8, 19, 'h'); row(2, 10, 10, 'l'); row(3, 7, 20, 'h'); row(3, 9, 9, 'l'); row(3, 15, 15, 'H')
  for (let y = 4; y <= 11; y++) {
    row(y, 6, 8, 'h')
    row(y, 19, 21, 'h')
  }
  row(5, 7, 7, 'l'); row(8, 6, 6, 'H'); row(6, 20, 20, 'l'); row(10, 21, 21, 'H')
}

function cloak(row: (y: number, x0: number, x1: number, p: Pixel) => void) {
  row(10, 8, 19, 'd')
  for (let y = 11; y <= 19; y++) row(y, 6, 21, 'd')
  for (let y = 12; y <= 19; y++) row(y, 8, 8, 'D')
  for (let y = 13; y <= 19; y++) row(y, 19, 19, 'D')
  row(16, 6, 21, 'D'); row(16, 13, 14, 'o'); row(19, 6, 21, 'D')
  row(11, 18, 19, 'o'); row(12, 18, 19, 'o')
}

/** Arms at his sides; from Heavy Slop on, his right fist goes up. */
function arms(row: (y: number, x0: number, x1: number, p: Pixel) => void, mood: number) {
  const sleeve = (x0: number, y0: number, y1: number, shade: number) => {
    for (let y = y0; y <= y1; y++) {
      row(y, x0, x0 + 2, 'd')
      row(y, shade, shade, 'D')
    }
  }
  sleeve(3, 11, 16, 3)
  row(17, 3, 5, 'f')
  if (mood >= 3) {
    sleeve(22, 5, 10, 24)
    row(3, 22, 24, 'f')
    row(4, 22, 24, 'f')
  } else {
    sleeve(22, 11, 16, 24)
    row(17, 22, 24, 'f')
  }
}

function beard(row: (y: number, x0: number, x1: number, p: Pixel) => void) {
  for (const [y, x0, x1] of [[8, 9, 18], [9, 8, 19], [10, 8, 19], [11, 8, 19], [12, 9, 18], [13, 10, 17], [14, 11, 16], [15, 12, 15]] as const) {
    row(y, x0, x1, 'b')
  }
  row(8, 10, 12, 'B'); row(8, 15, 17, 'B')
  for (let y = 10; y <= 12; y++) {
    row(y, 10, 10, 'B')
    row(y, 17, 17, 'B')
  }
  for (let y = 10; y <= 14; y++) row(y, 13, 13, 'B')
}

/** Brows from calm to furious, a shout, and the bolt in his raised fist. */
function face(row: (y: number, x0: number, x1: number, p: Pixel) => void, mood: number, frame: number) {
  const eye: Pixel = mood === 4 ? 'g' : mood === 0 && frame % 10 === 9 ? 'F' : 'e'
  row(6, 11, 11, eye)
  row(6, 16, 16, eye)
  const brows: [number, number][] =
    mood <= 1 ? [[10, 5], [11, 5], [16, 5], [17, 5]]
    : mood === 2 ? [[10, 5], [11, 5], [12, 5], [15, 5], [16, 5], [17, 5]]
    : [[9, 4], [10, 4], [11, 5], [12, 5], [18, 4], [17, 4], [16, 5], [15, 5]]
  for (const [x, y] of brows) row(y, x, x, 'H')
  if (mood >= 3) {
    row(4, 13, 14, 'F')
    row(9, 13, 14, 'e')
    const bolt: [number, number][] = mood === 4 ? [[23, 2], [24, 1], [23, 0], [22, 1], [25, 0]] : [[23, 2], [24, 1], [23, 0]]
    if (mood === 4 || frame % 3 !== 2) for (const [x, y] of bolt) row(y, x, x, 'z')
  }
  if (mood === 4) row(10, 13, 14, 'e')
}

/** The cloud he stands on: fair, grey, then storm-dark. */
function standingCloud(put: Put, mood: number) {
  const p: Pixel = mood <= 1 ? 'c' : mood === 2 ? 'n' : 'N'
  for (const [y, x0, x1] of [[22, 5, 8], [22, 12, 15], [22, 20, 23], [23, 2, 25], [24, 1, 26], [25, 3, 24]] as const) {
    for (let x = x0; x <= x1; x++) put(x, y, p)
  }
  put(8, 22, 'k'); put(15, 22, 'k'); put(20, 22, 'k')
}

const SPLATS = [[7, 11], [20, 11], [4, 23], [22, 23], [10, 24], [17, 24], [6, 18], [21, 18], [12, 1], [15, 1], [3, 24], [24, 24], [14, 17], [9, 23]] as const

/** Slop landing on him and his cloud, more of it as the score climbs. */
function slop(put: Put, lifted: Put, score: number) {
  const count = Math.max(0, Math.round(((score - 40) / 60) * SPLATS.length))
  for (const [x, y] of SPLATS.slice(0, count)) {
    const at = y < 20 ? lifted : put
    at(x, y, 'W')
    at(x, y + 1, 'w')
  }
}

function hail(grid: Grid, put: Put, frame: number) {
  for (let k = 0; k < 10; k++) {
    const x = (k * 11 + frame) % WIDTH
    const y = (k * 3 + frame * 2) % 21
    const under = grid[y]![x]
    if (!under || under === 'r') put(x, y, 'i')
  }
}

const SCALE = 6

/** Horizontal runs of one colour, so the SVG needs far fewer rectangles. */
function runs(grid: Grid): string {
  let out = ''
  grid.forEach((line, y) => {
    for (let x = 0; x < WIDTH;) {
      const p = line[x]
      let end = x
      while (end + 1 < WIDTH && line[end + 1] === p) end++
      if (p) out += `<rect x="${x * SCALE}" y="${y * SCALE}" width="${(end - x + 1) * SCALE}" height="${SCALE}" fill="${PALETTE[p]}"/>`
      x = end + 1
    }
  })
  return out
}

/**
 * Płanetnik as SVG. A fresh result animates once: a calm bob, a flickering
 * bolt in the storm, and, when the turn crossed into Big Ball of Mud, a strike
 * from the sky that lands with the gauge's slam (0.38 s).
 */
export function planetnikSvg(score: number, { animate = false, crossing = false } = {}): string {
  const mood = moodOf(score)
  const motion = !animate ? ''
    : mood <= 1 ? '<animateTransform attributeName="transform" type="translate" values="0 0;0 -6;0 0" dur="1.2s" calcMode="discrete" repeatCount="3"/>'
    : crossing ? '<animateTransform attributeName="transform" type="translate" begin="0.38s" dur="0.32s" values="0 0;-4 1;4 -1;-3 0;2 1;0 0"/>'
    : ''
  const strike = crossing
    ? `<g opacity="0">${STRIKE.map(([x, y]) => `<rect x="${x * SCALE}" y="${y * SCALE}" width="${SCALE}" height="${SCALE}" fill="${PALETTE.z}"/>`).join('')}<animate attributeName="opacity" begin="0.38s" dur="0.6s" values="0;1;1;0" keyTimes="0;0.1;0.6;1"/></g>`
    : ''
  const flash = crossing ? `<animate attributeName="fill" begin="0.38s" dur="0.4s" values="${TILE};${FLASH};${TILE}"/>` : ''
  const w = WIDTH * SCALE
  const h = HEIGHT * SCALE
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-12 -12 ${w + 24} ${h + 24}" shape-rendering="crispEdges" role="img">` +
    `<rect x="-12" y="-12" width="${w + 24}" height="${h + 24}" rx="10" fill="${TILE}">${flash}</rect>` +
    `<g>${motion}${runs(planetnik(score))}${strike}</g></svg>`
}

export const CELL_ROWS = HEIGHT / 2

/** Płanetnik as terminal cells: each cell is two pixels, ▀ over ▄, on his navy tile. */
export function planetnikCells(score: number, frame = 0, options: { strike?: boolean } = {}): string {
  const grid = planetnik(score, frame, options)
  const tile = parseInt(TILE.slice(1), 16)
  const color = (p: Pixel | null | undefined) => (p ? parseInt(PALETTE[p].slice(1), 16) : tile)
  const words = new Uint32Array(WIDTH * CELL_ROWS * 3)
  for (let row = 0; row < CELL_ROWS; row++) {
    for (let x = 0; x < WIDTH; x++) {
      const top = grid[row * 2]![x]
      const bottom = grid[row * 2 + 1]?.[x]
      const code = top ? 0x2580 : bottom ? 0x2584 : 0x20
      words.set([code, color(top ?? bottom), top ? color(bottom) : tile], (row * WIDTH + x) * 3)
    }
  }
  return new Uint8Array(words.buffer).toBase64()
}
