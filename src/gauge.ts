// The gauge, as pure functions of the score: an SVG instrument for surfaces
// that draw Svg, raster cells for the terminal. Presentation only.

import type { SlopState } from '../types/index.d.ts'

export const MUD = 81

export const ZONES: { from: number; to: number; color: string }[] = [
  { from: 0, to: 20, color: '#3fb950' },
  { from: 20, to: 40, color: '#a3c43a' },
  { from: 40, to: 60, color: '#d29922' },
  { from: 60, to: 80, color: '#f0883e' },
  { from: 80, to: 100, color: '#f85149' },
]

export const clamp = (score: number) => Math.min(100, Math.max(0, score))

export const colorOf = (score: number) =>
  ZONES.find(z => clamp(score) <= z.to)?.color ?? ZONES[ZONES.length - 1]!.color

/** Needle rotation in degrees from straight up: 0 → −90, 50 → 0, 100 → +90. */
export const needleAngle = (score: number) => (clamp(score) - 50) * 1.8

/** True when this score is the one that crossed into Big Ball of Mud. */
export const crossedIntoMud = (score: number, previous: number | null) =>
  score >= MUD && (previous === null || previous < MUD)

export type GaugeInput = {
  score: number
  state: SlopState
  delta: number | null
  /** Animate the needle from the previous score (a fresh result only). */
  animate: boolean
}

const CX = 130
const CY = 128
const R = 100

function point(score: number, radius: number): string {
  const a = Math.PI - (clamp(score) / 100) * Math.PI
  return `${(CX + radius * Math.cos(a)).toFixed(2)} ${(CY - radius * Math.sin(a)).toFixed(2)}`
}

const arc = (from: number, to: number, radius: number) =>
  `M ${point(from, radius)} A ${radius} ${radius} 0 0 1 ${point(to, radius)}`

/** The gauge's centre and radius, for drawings that put their own needle on the dial. */
export const DIAL = { cx: CX, cy: CY, r: R }

/** The dial: the five zones (lit up to `score`) and the ticks, without needle or labels. */
export function dial(score: number): string {
  const zones = ZONES.map(z =>
    `<path d="${arc(z.from + 0.6, z.to - 0.6, R)}" stroke="${z.color}" stroke-width="16" fill="none" opacity="${score >= z.from ? 0.95 : 0.3}"/>`,
  ).join('')
  const ticks = Array.from({ length: 11 }, (_, i) => {
    const v = i * 10
    const major = v % 50 === 0
    return `<path d="M ${point(v, R - 12)} L ${point(v, R - (major ? 22 : 17))}" class="tick" stroke-width="${major ? 2 : 1}"/>`
  }).join('')
  return zones + ticks
}

export function gaugeSvg({ score, state, delta, animate }: GaugeInput): string {
  const s = clamp(score)
  const to = needleAngle(s)
  const previous = delta === null ? s : clamp(s - delta)
  const from = needleAngle(previous)
  const isMud = state === 'BIG BALL OF MUD'
  const crossing = animate && crossedIntoMud(s, delta === null ? null : previous)
  const color = colorOf(s)


  const needleMotion = !animate || from === to
    ? ''
    : crossing
      // Accelerate into the red, slam past the line, settle.
      ? `<animateTransform attributeName="transform" type="rotate" dur="0.9s" fill="freeze"
          values="${from} ${CX} ${CY}; ${to + 7} ${CX} ${CY}; ${to - 3} ${CX} ${CY}; ${to + 1.5} ${CX} ${CY}; ${to} ${CX} ${CY}"
          keyTimes="0; 0.42; 0.62; 0.8; 1" calcMode="spline"
          keySplines="0.55 0 1 0.6; 0.2 0.6 0.4 1; 0.3 0 0.6 1; 0.3 0 0.6 1"/>`
      : `<animateTransform attributeName="transform" type="rotate" dur="0.35s" fill="freeze"
          from="${from} ${CX} ${CY}" to="${to} ${CX} ${CY}" calcMode="spline" keyTimes="0; 1" keySplines="0.2 0.8 0.2 1"/>`

  const impact = crossing
    ? `<animateTransform attributeName="transform" type="translate" begin="0.38s" dur="0.32s"
        values="0 0; -4 1; 4 -1; -3 0; 2 1; 0 0"/>`
    : ''
  const pulse = crossing
    ? `<circle cx="${CX}" cy="${CY}" r="${R + 10}" fill="none" stroke="#f85149" stroke-width="3" opacity="0">
        <animate attributeName="opacity" begin="0.38s" dur="0.7s" values="0; 0.8; 0"/>
        <animate attributeName="r" begin="0.38s" dur="0.7s" values="${R}; ${R + 18}"/>
      </circle>`
    : ''
  const trend = delta === null || delta === 0 ? '' : `${delta > 0 ? '▲' : '▼'} ${Math.abs(delta)}`

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 260 206" role="img">
<style>
  .dim { fill: #8b949e } .tick { stroke: #8b949e } .hub { fill: #8b949e }
  text { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; text-anchor: middle }
</style>
${isMud ? `<defs><filter id="glow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="4"/></filter></defs>` : ''}
<g>${impact}
  ${isMud ? `<path d="${arc(80, 100, R)}" stroke="#f85149" stroke-width="22" fill="none" opacity="0.45" filter="url(#glow)"/>` : ''}
  ${dial(s)}
  <text x="${point(0, R).split(' ')[0]}" y="${CY + 18}" class="dim" font-size="9">CLEAN</text>
  <text x="${point(100, R).split(' ')[0]}" y="${CY + 18}" class="dim" font-size="9">MUD</text>
  <g transform="rotate(${to} ${CX} ${CY})">${needleMotion}
    <path d="M ${CX - 3.5} ${CY} L ${CX} ${CY - R + 8} L ${CX + 3.5} ${CY} Z" fill="${color}"/>
  </g>
  <circle cx="${CX}" cy="${CY}" r="7" class="hub"/>
  <circle cx="${CX}" cy="${CY}" r="3" fill="${color}"/>
  ${pulse}
  <text x="${CX}" y="${CY + 40}" fill="${color}" font-size="30" font-weight="700">${s}</text>
  <text x="${CX}" y="${CY + 60}" fill="${color}" font-size="13" font-weight="700" letter-spacing="1">${isMud ? '⚠ ' : ''}${state}${
    crossing ? `<animate attributeName="opacity" begin="0.4s" dur="0.25s" values="1; 0.2; 1" repeatCount="3"/>` : ''
  }</text>
  <text x="${CX}" y="${CY + 75}" class="dim" font-size="10">${trend}</text>
</g>
</svg>`
}

/** A two-row terminal gauge: a zoned scale and the needle beneath it. */
export function gaugeCells(score: number, columns: number, flash = false): string {
  const s = clamp(score)
  const width = Math.max(10, columns)
  const at = Math.round((s / 100) * (width - 1))
  const DEFAULT = 0x01000000
  const words = new Uint32Array(width * 2 * 3)
  for (let x = 0; x < width; x++) {
    const v = (x / (width - 1)) * 100
    const zone = hex(colorOf(v))
    const fg = x <= at ? zone : dim(zone)
    put(words, x, flash && x <= at ? 0x2588 : 0x2584, fg, DEFAULT)
    put(words, width + x, x === at ? 0x25b2 : 0x20, x === at ? hex(colorOf(s)) : DEFAULT, DEFAULT)
  }
  return new Uint8Array(words.buffer).toBase64()
}

function put(words: Uint32Array, cell: number, code: number, fg: number, bg: number) {
  words.set([code, fg, bg], cell * 3)
}

const hex = (color: string) => parseInt(color.slice(1), 16)
const dim = (rgb: number) =>
  (((rgb >> 16) & 0xff) * 0.35) << 16 | (((rgb >> 8) & 0xff) * 0.35) << 8 | ((rgb & 0xff) * 0.35)

/** Needle positions for a terminal sweep from one score to another. */
export function sweep(from: number, to: number, frames: number, overshoot = false): number[] {
  const ease = (t: number) => 1 - (1 - t) ** 3
  const path = Array.from({ length: frames }, (_, i) => from + (to - from) * ease((i + 1) / frames))
  return overshoot ? [...path.slice(0, -1), clamp(to + 6), clamp(to - 2), to] : path
}
