import { expect, test } from "bun:test"

import { createDominoLayoutState, layoutDominoBlocks, updateDominoLayout, type DominoBlock, type DominoCell } from "../src/frontend/components/domino-layout"

function distance(a: DominoCell, b: DominoCell) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y)
}

function assertChronologicalInvariants(cells: DominoCell[]) {
  expect(new Set(cells.map((cell) => `${cell.x},${cell.y}`)).size).toBe(cells.length)
  for (let index = 1; index < cells.length; index += 1) expect(distance(cells[index - 1], cells[index])).toBe(1)
  for (let left = 0; left < cells.length; left += 1) {
    for (let right = left + 1; right < cells.length; right += 1) {
      if (Math.abs(left - right) === 1) continue
      expect(distance(cells[left], cells[right])).not.toBe(1)
    }
  }
}

test("lays out chronological domino blocks without overlap", () => {
  const cells = layoutDominoBlocks([
    { id: "p", kind: "prompt" },
    { id: "i-1", kind: "thought" },
    { id: "i-2", kind: "thought" },
    { id: "t-1", kind: "tool" },
    { id: "t-2", kind: "tool" },
    { id: "i-3", kind: "thought" },
    { id: "t-3", kind: "tool" },
  ])

  expect(cells[0]).toMatchObject({ x: 0, y: 0 })
  assertChronologicalInvariants(cells)
})

test("tool burst branches and next thought continues from tool tip", () => {
  const cells = layoutDominoBlocks([
    { id: "p", kind: "prompt" },
    { id: "i-1", kind: "thought" },
    { id: "i-2", kind: "thought" },
    { id: "t-1", kind: "tool" },
    { id: "t-2", kind: "tool" },
    { id: "i-3", kind: "thought" },
    { id: "t-3", kind: "tool" },
    { id: "t-4", kind: "tool" },
  ])

  const byId = new Map(cells.map((cell) => [cell.id, cell]))
  expect(distance(byId.get("t-2")!, byId.get("i-3")!)).toBe(1)
  expect(byId.get("i-3")!.x).not.toBe(byId.get("i-2")!.x)
  assertChronologicalInvariants(cells)
})

test("long chronological layout preserves domino invariants", () => {
  const blocks: DominoBlock[] = []
  for (let index = 0; index < 80; index += 1) {
    blocks.push({ id: `thought-${index}`, kind: "thought" })
    if (index % 3 === 0) blocks.push({ id: `tool-${index}-a`, kind: "tool" }, { id: `tool-${index}-b`, kind: "tool" })
    if (index % 7 === 0) blocks.push({ id: `message-${index}`, kind: "message" })
  }

  assertChronologicalInvariants(layoutDominoBlocks(blocks))
})

test("chronological layout keeps existing cells stable for append-only growth", () => {
  const state = createDominoLayoutState()
  const firstBlocks: DominoBlock[] = [
    { id: "p", kind: "prompt" },
    { id: "i-1", kind: "thought" },
    { id: "t-1", kind: "tool" },
    { id: "t-2", kind: "tool" },
  ]
  const firstCells = updateDominoLayout(state, firstBlocks).map((cell) => ({ id: cell.id, x: cell.x, y: cell.y }))
  const nextCells = updateDominoLayout(state, [...firstBlocks, { id: "i-2", kind: "thought" }])

  expect(nextCells.slice(0, firstCells.length).map((cell) => ({ id: cell.id, x: cell.x, y: cell.y }))).toEqual(firstCells)
  assertChronologicalInvariants(nextCells)
})
