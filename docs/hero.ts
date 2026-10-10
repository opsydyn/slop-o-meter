// Draws docs/hero.svg, the README's animated hero, from the real gauge and Płanetnik:
// a clean turn at 18, a slam into Big Ball of Mud at 87, then the Sunbreak down to 14.
// Run with `bun docs/hero.ts` after changing either drawing.

import { colorOf, dial, DIAL, needleAngle } from '../src/gauge.ts'
import { planetnikRects } from '../src/mascot.ts'

const LOOP = '9s'
/** When each act begins, as a share of the loop: clean, mud, sunbreak. */
const ACTS = [0, 0.22, 0.66]
const { cx, cy, r } = DIAL

/** Shown during act `i` only. */
const during = (i: number) =>
  `<animate attributeName="opacity" dur="${LOOP}" repeatCount="indefinite" calcMode="discrete"
    keyTimes="${ACTS.join(';')}" values="${ACTS.map((_, j) => (j === i ? 1 : 0)).join(';')}"/>`

const at = (angle: number) => `${angle.toFixed(1)} ${cx} ${cy}`
const needle = `<g>
  <animateTransform attributeName="transform" type="rotate" dur="${LOOP}" repeatCount="indefinite"
    keyTimes="0; 0.17; 0.25; 0.28; 0.31; 0.61; 0.7; 1"
    values="${[18, 18, 92, 82, 87, 87, 14, 14].map(s => at(needleAngle(s) + (s > 87 ? (s - 87) * 1.8 : 0))).join('; ')}"/>
  <path d="M ${cx - 3.5} ${cy} L ${cx} ${cy - r + 8} L ${cx + 3.5} ${cy} Z">
    <animate attributeName="fill" dur="${LOOP}" repeatCount="indefinite" calcMode="discrete"
      keyTimes="${ACTS.join(';')}" values="${[18, 87, 14].map(colorOf).join(';')}"/>
  </path>
</g>`

const shake = `<animateTransform attributeName="transform" type="translate" dur="${LOOP}" repeatCount="indefinite"
  keyTimes="0; 0.255; 0.265; 0.275; 0.285; 0.3; 1" values="0 0; 0 0; -5 1; 5 -1; -3 0; 0 0; 0 0"/>`

const pulse = `<circle cx="${cx}" cy="${cy}" r="${r + 10}" fill="none" stroke="${colorOf(87)}" stroke-width="3" opacity="0">
  <animate attributeName="opacity" dur="${LOOP}" repeatCount="indefinite" keyTimes="0; 0.25; 0.27; 0.34; 1" values="0; 0; 0.8; 0; 0"/>
</circle>`

const readouts = [
  [18, 'CLEAN', 'Clear skies.'],
  [87, '⚠ BIG BALL OF MUD', 'Burza! 6 new abstractions, 4 with one consumer. The clouds gather.'],
  [14, 'CLEAN  ☀ SUNBREAK', 'The sun breaks through. 87 down to 14. Well simplified.'],
] as const

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 540 250" role="img">
<title>Slop-O-Meter: a clean turn, a slam into Big Ball of Mud, then the Sunbreak</title>
<style>
  .tick { stroke: #8b949e } .dim { fill: #8b949e } .voice { fill: #a39b8e; font-style: italic }
  text { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; text-anchor: middle }
</style>
<g>${shake}
  ${dial(100)}
  <text x="${cx - r}" y="${cy + 18}" class="dim" font-size="9">CLEAN</text>
  <text x="${cx + r}" y="${cy + 18}" class="dim" font-size="9">MUD</text>
  ${needle}
  <circle cx="${cx}" cy="${cy}" r="7" fill="#8b949e"/>
  ${pulse}
  ${readouts.map(([score, state], i) => `<g opacity="${i ? 0 : 1}">${during(i)}
    <text x="${cx}" y="${cy + 40}" fill="${colorOf(score)}" font-size="30" font-weight="700">${score}</text>
    <text x="${cx}" y="${cy + 60}" fill="${colorOf(score)}" font-size="13" font-weight="700" letter-spacing="1">${state}</text>
  </g>`).join('')}
</g>
<g transform="translate(330 18)">
  ${[[18, false], [87, false], [14, true]].map(([score, sun], i) =>
    `<g opacity="${i ? 0 : 1}" shape-rendering="crispEdges">${during(i)}${planetnikRects(score as number, { sun: sun as boolean })}</g>`).join('')}
</g>
${readouts.map(([, , said], i) => `<text x="270" y="236" class="voice" font-size="11" opacity="${i ? 0 : 1}">${during(i)}Płanetnik: “${said}”</text>`).join('')}
</svg>
`

await Bun.write(new URL('./hero.svg', import.meta.url), svg)
console.log(`docs/hero.svg: ${svg.length} characters`)
