import { useMemo, useRef, useState } from "react"

import { Glyph } from "./glyphs"
import { createDominoLayoutState, updateDominoLayout, type DominoBlock } from "./domino-layout"

const TILE = 96
const GAP = 0
const PAD = 240

function statusClass(status: DominoBlock["status"]) {
  if (status === "failed") return "text-red-500"
  if (status === "pending" || status === "in_progress") return "animate-obv-pulse text-obv-ink"
  return "text-obv-ink"
}

export function DominoCanvas({ blocks }: { blocks: DominoBlock[] }) {
  const [selected, setSelected] = useState<string | null>(null)
  const layoutState = useRef(createDominoLayoutState())
  const cells = useMemo(() => updateDominoLayout(layoutState.current, blocks), [blocks])
  const bounds = useMemo(() => {
    if (cells.length === 0) return { minX: 0, minY: 0, width: 800, height: 600 }
    const minX = Math.min(...cells.map((cell) => cell.x))
    const maxX = Math.max(...cells.map((cell) => cell.x))
    const minY = Math.min(...cells.map((cell) => cell.y))
    const maxY = Math.max(...cells.map((cell) => cell.y))
    return {
      minX,
      minY,
      width: (maxX - minX + 1) * (TILE + GAP) + PAD * 2,
      height: (maxY - minY + 1) * (TILE + GAP) + PAD * 2,
    }
  }, [cells])

  return (
    <div className="h-full w-full overflow-auto bg-obv-bg">
      <svg width={bounds.width} height={bounds.height} className="block">
        <title>ACP domino trace canvas</title>
        <g transform={`translate(${PAD - bounds.minX * (TILE + GAP)} ${PAD - bounds.minY * (TILE + GAP)})`}>
          {cells.map((cell) => {
            const active = selected === cell.id
            return (
              <g
                key={cell.id}
                transform={`translate(${cell.x * (TILE + GAP)} ${cell.y * (TILE + GAP)})`}
                className={`cursor-pointer outline-none ${statusClass(cell.status)}`}
                tabIndex={0}
                role="button"
                aria-label={cell.summary ?? cell.kind}
                onPointerEnter={() => setSelected(cell.id)}
                onFocus={() => setSelected(cell.id)}
              >
                <rect x="0" y="0" width={TILE} height={TILE} fill="transparent" />
                {active ? <rect x="3" y="3" width={TILE - 6} height={TILE - 6} fill="none" stroke="currentColor" strokeWidth="1" opacity="0.28" /> : null}
                {cell.status === "pending" || cell.status === "in_progress" ? <circle cx="82" cy="14" r="5" fill="currentColor" opacity="0.9" /> : null}
                <Glyph kind={cell.kind} x="12" y="12" width="72" height="72" />
              </g>
            )
          })}
        </g>
      </svg>
    </div>
  )
}
