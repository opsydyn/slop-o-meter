import { describe, expect, test } from 'bun:test'

import { CELL_ROWS, planetnik, planetnikAlt, planetnikCells, planetnikFace, planetnikSvg, WIDTH, type Grid, type Pixel } from '../src/mascot.ts'

const count = (g: Grid, ...ps: Pixel[]) => g.flat().filter(p => p !== null && ps.includes(p)).length

describe('Płanetnik', () => {
  test('clean code is calm skies: no storm, no rain, no lightning, no slop', () => {
    const g = planetnik(5)
    expect(count(g, 'N', 'r', 'z', 'W')).toBe(0)
  })

  test('the storm and the slop grow with the score', () => {
    const storm = [5, 30, 50, 70, 90].map(s => count(planetnik(s), 'n', 'N', 'r', 'z', 'i'))
    const slop = [5, 30, 50, 70, 90].map(s => count(planetnik(s), 'W'))
    for (let i = 1; i < storm.length; i++) {
      expect(storm[i]!).toBeGreaterThanOrEqual(storm[i - 1]!)
      expect(slop[i]!).toBeGreaterThanOrEqual(slop[i - 1]!)
    }
    expect(storm[4]!).toBeGreaterThan(storm[0]!)
    expect(slop[4]!).toBeGreaterThan(slop[1]!)
  })

  test('his eyes always show, and blaze only at Big Ball of Mud', () => {
    for (let s = 0; s <= 100; s += 5) expect(count(planetnik(s), 'e', 'g')).toBeGreaterThanOrEqual(2)
    expect(count(planetnik(79), 'g')).toBe(0)
    expect(count(planetnik(87), 'g')).toBe(2)
  })

  test('he raises his fist from Heavy Slop on', () => {
    expect(planetnik(30)[4]![23]).not.toBe('f')
    expect(planetnik(70)[4]![23]).toBe('f')
  })

  test('the strike is drawn only when asked', () => {
    expect(planetnik(87, 0, { strike: true })[10]![2]).toBe('z')
    expect(planetnik(87)[10]![2]).not.toBe('z')
  })

  test('faces and descriptions run calm to furious', () => {
    expect(planetnikFace(0)).toBe('(•_•)')
    expect(planetnikFace(90)).toBe('(╬ಠ益ಠ)')
    expect(planetnikAlt(90)).toContain('storm')
  })
})

describe('Płanetnik in the terminal', () => {
  test('half-block cells on his tile', () => {
    const words = new Uint32Array(Uint8Array.fromBase64(planetnikCells(87, 3)).buffer)
    expect(words.length).toBe(WIDTH * CELL_ROWS * 3)
    for (let i = 0; i < words.length; i += 3) expect([0x20, 0x2580, 0x2584]).toContain(words[i]!)
  })
})

describe('Płanetnik as SVG', () => {
  test('a stale result draws still', () => {
    expect(planetnikSvg(10)).not.toContain('<animate')
  })

  test('a fresh calm result bobs; crossing into mud strikes in time with the gauge', () => {
    expect(planetnikSvg(10, { animate: true })).toContain('animateTransform')
    const crossing = planetnikSvg(87, { animate: true, crossing: true })
    expect(crossing).toContain('begin="0.38s"')
    expect(planetnikSvg(90, { animate: true })).not.toContain('begin="0.38s"')
  })

  test('fits the surface limit', () => {
    expect(planetnikSvg(100, { animate: true, crossing: true }).length).toBeLessThan(131072)
  })
})
