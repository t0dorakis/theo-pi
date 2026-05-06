import type { GlyphKind } from "./glyphs"

export type DominoBlock = {
  id: string
  kind: GlyphKind
  status?: "pending" | "in_progress" | "completed" | "failed"
  summary?: string
  parentId?: string
  lane?: "spine" | "branch"
}

export type DominoCell = DominoBlock & {
  x: number
  y: number
}

export type DominoLayoutState = {
  cells: DominoCell[]
}

type Direction = { x: number; y: number }

const RIGHT = { x: 1, y: 0 } satisfies Direction
const DOWN = { x: 0, y: 1 } satisfies Direction
const UP = { x: 0, y: -1 } satisfies Direction
const LEFT = { x: -1, y: 0 } satisfies Direction
const DIRECTIONS = [RIGHT, DOWN, UP, LEFT] as const

function key(x: number, y: number) {
  return `${x},${y}`
}

function sameDirection(left: Direction, right: Direction) {
  return left.x === right.x && left.y === right.y
}

function turnClockwise(direction: Direction): Direction {
  if (sameDirection(direction, RIGHT)) return DOWN
  if (sameDirection(direction, DOWN)) return LEFT
  if (sameDirection(direction, LEFT)) return UP
  return RIGHT
}

function turnCounterClockwise(direction: Direction): Direction {
  if (sameDirection(direction, RIGHT)) return UP
  if (sameDirection(direction, UP)) return LEFT
  if (sameDirection(direction, LEFT)) return DOWN
  return RIGHT
}

function opposite(direction: Direction): Direction {
  return { x: -direction.x, y: -direction.y }
}

function isAdjacent(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1
}

function neighbors(position: { x: number; y: number }) {
  return DIRECTIONS.map((direction) => ({ x: position.x + direction.x, y: position.y + direction.y }))
}

function isLegalNext(input: { candidate: { x: number; y: number }; previous: { x: number; y: number }; occupied: Set<string> }) {
  if (input.occupied.has(key(input.candidate.x, input.candidate.y))) return false
  if (!isAdjacent(input.candidate, input.previous)) return false
  return neighbors(input.candidate).every((neighbor) => {
    if (neighbor.x === input.previous.x && neighbor.y === input.previous.y) return true
    return !input.occupied.has(key(neighbor.x, neighbor.y))
  })
}

function preference(block: DominoBlock, index: number) {
  let hash = 2166136261
  const seed = `${block.id}:${block.kind}:${index}`
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function preferredDirections(input: { previousBlock: DominoBlock; block: DominoBlock; heading: Direction; branchSide: 1 | -1; index: number }) {
  const branchTurn = input.branchSide === 1 ? turnClockwise(input.heading) : turnCounterClockwise(input.heading)
  const otherTurn = input.branchSide === 1 ? turnCounterClockwise(input.heading) : turnClockwise(input.heading)
  const forward = input.heading

  if (input.previousBlock.kind === "tool" && input.block.kind === "tool") return [forward, branchTurn, otherTurn, opposite(forward)]
  if (input.previousBlock.kind !== "tool" && input.block.kind === "tool") return [branchTurn, forward, otherTurn, opposite(forward)]
  if (input.previousBlock.kind === "tool" && input.block.kind !== "tool") return [otherTurn, forward, branchTurn, opposite(forward)]

  const jitter = preference(input.block, input.index) % 5
  if (jitter === 0) return [branchTurn, forward, otherTurn, opposite(forward)]
  if (jitter === 1) return [otherTurn, forward, branchTurn, opposite(forward)]
  return [forward, branchTurn, otherTurn, opposite(forward)]
}

function hasFalseAdjacency(cells: DominoCell[]) {
  for (let left = 0; left < cells.length; left += 1) {
    for (let right = left + 1; right < cells.length; right += 1) {
      if (!isAdjacent(cells[left], cells[right])) continue
      if (Math.abs(left - right) === 1) continue
      return true
    }
  }
  return false
}

function buildPath(blocks: DominoBlock[], branchSide: 1 | -1): DominoCell[] | null {
  if (blocks.length === 0) return []
  const cells: DominoCell[] = [{ ...blocks[0], x: 0, y: 0 }]
  const occupied = new Set([key(0, 0)])
  let heading: Direction = RIGHT

  for (let index = 1; index < blocks.length; index += 1) {
    const previous = cells[index - 1]
    const directions = preferredDirections({ previousBlock: blocks[index - 1], block: blocks[index], heading, branchSide, index })
    let next: { x: number; y: number; direction: Direction } | undefined
    for (const direction of directions) {
      const candidate = { x: previous.x + direction.x, y: previous.y + direction.y }
      if (isLegalNext({ candidate, previous, occupied })) {
        next = { ...candidate, direction }
        break
      }
    }
    if (!next) return null
    cells.push({ ...blocks[index], x: next.x, y: next.y })
    occupied.add(key(next.x, next.y))
    heading = next.direction
  }

  return hasFalseAdjacency(cells) ? null : cells
}

export function createDominoLayoutState(): DominoLayoutState {
  return { cells: [] }
}

export function updateDominoLayout(state: DominoLayoutState, blocks: DominoBlock[]): DominoCell[] {
  const primary = buildPath(blocks, 1) ?? buildPath(blocks, -1)
  if (!primary) throw new Error("unable to layout chronological domino path")
  state.cells = primary
  return primary
}

export function layoutDominoBlocks(blocks: DominoBlock[]): DominoCell[] {
  return updateDominoLayout(createDominoLayoutState(), blocks)
}
