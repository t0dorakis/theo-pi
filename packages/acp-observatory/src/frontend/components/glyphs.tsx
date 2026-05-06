import type { SVGProps } from "react"

export type GlyphKind = "prompt" | "thought" | "tool" | "message" | "artifact" | "decision" | "result" | "error"

type GlyphProps = SVGProps<SVGSVGElement> & {
  kind: GlyphKind
}

function Sparkle() {
  return <path d="M50 5 C58 35 65 42 95 50 C65 58 58 65 50 95 C42 65 35 58 5 50 C35 42 42 35 50 5Z" />
}

function PromptStar() {
  return <path d="M46 8h8v34l24-24 6 6-24 24h34v8H60l24 24-6 6-24-24v34h-8V62L22 86l-6-6 24-24H6v-8h34L16 24l6-6 24 24V8Z" />
}

function ToolDots() {
  const dots = []
  for (let y = 0; y < 4; y += 1) {
    for (let x = 0; x < 4; x += 1) dots.push(<circle key={`${x}-${y}`} cx={26 + x * 16} cy={26 + y * 16} r="7" />)
  }
  return <>{dots}</>
}

function MessageCircle() {
  return <circle cx="50" cy="50" r="36" />
}

function ArtifactSquare() {
  return <path fillRule="evenodd" d="M18 18h64v64H18V18Zm16 16v32h32V34H34Z" />
}

function DecisionFork() {
  return <path d="M47 8h6v42h40v6H57l26 26-5 5-28-28-28 28-5-5 26-26H7v-6h40V8Z" />
}

function ResultRing() {
  return <path fillRule="evenodd" d="M50 10a40 40 0 1 1 0 80 40 40 0 0 1 0-80Zm0 13a27 27 0 1 0 0 54 27 27 0 0 0 0-54Z" />
}

function ErrorCross() {
  return <path d="M24 16 50 42 76 16l8 8-26 26 26 26-8 8-26-26-26 26-8-8 26-26-26-26 8-8Z" />
}

function glyph(kind: GlyphKind) {
  if (kind === "prompt") return <PromptStar />
  if (kind === "thought") return <Sparkle />
  if (kind === "tool") return <ToolDots />
  if (kind === "message") return <MessageCircle />
  if (kind === "artifact") return <ArtifactSquare />
  if (kind === "decision") return <DecisionFork />
  if (kind === "result") return <ResultRing />
  return <ErrorCross />
}

export function Glyph({ kind, className, ...props }: GlyphProps) {
  return (
    <svg viewBox="0 0 100 100" aria-hidden="true" className={className} {...props}>
      <g fill="currentColor">{glyph(kind)}</g>
    </svg>
  )
}
