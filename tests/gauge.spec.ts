import { describe, expect, test } from 'bun:test'

import { colorOf, crossedIntoMud, gaugeCells, gaugeSvg, needleAngle, sweep, ZONES } from '../src/gauge.ts'
import { stateOf } from '../src/score.ts'

const svg = (score: number, delta: number | null, animate = true) =>
  gaugeSvg({ score, state: stateOf(score), delta, animate })

describe('needle', () => {
  test('0 points left, 50 up, 100 right', () => {
    expect(needleAngle(0)).toBe(-90)
    expect(needleAngle(50)).toBe(0)
    expect(needleAngle(100)).toBe(90)
  })

  test('clamps outside the range', () => {
    expect(needleAngle(-20)).toBe(-90)
    expect(needleAngle(140)).toBe(90)
  })

  test('the needle rests at the score', () => {
    expect(svg(67, 10, false)).toContain(`rotate(${needleAngle(67)} `)
  })
})

describe('zones', () => {
  test('each threshold takes its zone colour', () => {
    expect(colorOf(20)).toBe(ZONES[0]!.color)
    expect(colorOf(21)).toBe(ZONES[1]!.color)
    expect(colorOf(81)).toBe(ZONES[4]!.color)
    expect(colorOf(100)).toBe(ZONES[4]!.color)
  })
})

describe('Big Ball of Mud transition', () => {
  test('fires only when crossing in', () => {
    expect(crossedIntoMud(87, 63)).toBe(true)
    expect(crossedIntoMud(87, null)).toBe(true)
    expect(crossedIntoMud(90, 87)).toBe(false)
    expect(crossedIntoMud(80, 63)).toBe(false)
  })

  test('crossing plays the slam; staying in mud does not', () => {
    expect(svg(87, 24)).toContain('keyTimes="0; 0.42')
    expect(svg(90, 3)).not.toContain('keyTimes="0; 0.42')
    expect(svg(90, 3)).toContain('⚠ BIG BALL OF MUD')
  })

  test('leaving mud after simplification sweeps back without the alert', () => {
    const out = svg(29, -58)
    expect(out).toContain(`from="${needleAngle(87)}`)
    expect(out).toContain('MILD SLOP')
    expect(out).not.toContain('⚠')
  })

  test('a stale result draws still', () => {
    expect(svg(87, 24, false)).not.toContain('animateTransform')
  })
})

describe('terminal gauge', () => {
  const decode = (b64: string) => new Uint32Array(Uint8Array.fromBase64(b64).buffer)

  test('two rows of cells with the needle under the score', () => {
    const words = decode(gaugeCells(50, 21))
    expect(words.length).toBe(21 * 2 * 3)
    const needle = Array.from({ length: 21 }, (_, x) => words[(21 + x) * 3]).indexOf(0x25b2)
    expect(needle).toBe(10)
  })

  test('0 and 100 put the needle at the ends', () => {
    const at = (score: number) => {
      const w = decode(gaugeCells(score, 30))
      return Array.from({ length: 30 }, (_, x) => w[(30 + x) * 3]).indexOf(0x25b2)
    }
    expect(at(0)).toBe(0)
    expect(at(100)).toBe(29)
    expect(at(150)).toBe(29)
  })

  test('sweep ends on the score, overshooting only when asked', () => {
    expect(sweep(20, 60, 8).at(-1)).toBe(60)
    const slam = sweep(60, 87, 8, true)
    expect(Math.max(...slam)).toBeGreaterThan(87)
    expect(slam.at(-1)).toBe(87)
  })
})
