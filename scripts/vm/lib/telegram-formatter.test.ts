import { describe, it, expect } from "bun:test"
import {
  escapeHtml,
  formatThinking,
  formatToolRunning,
  formatToolDone,
  formatToolFailed,
  formatFinalAnswer,
  formatTable,
  formatApprovalMessage,
  buildApprovalKeyboard,
  parseCallbackData,
} from "./telegram-formatter.ts"

// ---------------------------------------------------------------------------
// escapeHtml
// ---------------------------------------------------------------------------

describe("escapeHtml", () => {
  it("escapes &", () => {
    expect(escapeHtml("foo & bar")).toBe("foo &amp; bar")
  })

  it("escapes <", () => {
    expect(escapeHtml("foo < bar")).toBe("foo &lt; bar")
  })

  it("escapes >", () => {
    expect(escapeHtml("foo > bar")).toBe("foo &gt; bar")
  })

  it("escapes all three in one string", () => {
    expect(escapeHtml("<b>a & b > c</b>")).toBe("&lt;b&gt;a &amp; b &gt; c&lt;/b&gt;")
  })

  it("leaves plain text unchanged", () => {
    expect(escapeHtml("hello world")).toBe("hello world")
  })
})

// ---------------------------------------------------------------------------
// formatThinking
// ---------------------------------------------------------------------------

describe("formatThinking", () => {
  it("wraps short text without truncation or ellipsis", () => {
    const result = formatThinking("hello", 200)
    expect(result).toBe("<blockquote expandable>🤔 <i>hello</i></blockquote>")
  })

  it("truncates to maxChars and appends ellipsis", () => {
    const long = "a".repeat(300)
    const result = formatThinking(long, 200)
    expect(result).toContain("a".repeat(200) + "…")
    expect(result).not.toContain("a".repeat(201))
  })

  it("does not append ellipsis when text equals exactly maxChars", () => {
    const exact = "x".repeat(200)
    const result = formatThinking(exact, 200)
    expect(result).not.toContain("…")
  })

  it("contains <blockquote expandable>", () => {
    const result = formatThinking("thinking", 200)
    expect(result).toContain("<blockquote expandable>")
  })

  it("collapses newlines to spaces in excerpt", () => {
    const result = formatThinking("line1\nline2", 200)
    expect(result).toContain("line1 line2")
    expect(result).not.toMatch(/<i>[^<]*\n/)
  })

  it("escapes HTML special chars in excerpt", () => {
    const result = formatThinking("a < b & c > d", 200)
    expect(result).toContain("a &lt; b &amp; c &gt; d")
  })
})

// ---------------------------------------------------------------------------
// formatToolRunning
// ---------------------------------------------------------------------------

describe("formatToolRunning", () => {
  it("produces running icon and bold title", () => {
    const result = formatToolRunning("bash")
    expect(result).toBe("🔧 <b>bash</b>")
  })

  it("includes input summary in code block", () => {
    const result = formatToolRunning("bash", "ls -la")
    expect(result).toContain("<code>ls -la</code>")
  })

  it("truncates input summary to 80 chars", () => {
    const longInput = "x".repeat(100)
    const result = formatToolRunning("bash", longInput)
    expect(result).toContain("<code>" + "x".repeat(80) + "</code>")
    expect(result).not.toContain("x".repeat(81))
  })

  it("escapes HTML in title", () => {
    const result = formatToolRunning("a<b>c", undefined)
    expect(result).toContain("a&lt;b&gt;c")
  })

  it("escapes HTML in input summary", () => {
    const result = formatToolRunning("tool", "<dangerous>")
    expect(result).toContain("&lt;dangerous&gt;")
  })
})

// ---------------------------------------------------------------------------
// formatToolDone
// ---------------------------------------------------------------------------

describe("formatToolDone", () => {
  it("produces done icon and bold title", () => {
    const result = formatToolDone("bash")
    expect(result).toBe("✅ <b>bash</b>")
  })

  it("includes output summary in code block", () => {
    const result = formatToolDone("bash", "ok")
    expect(result).toContain("<code>ok</code>")
  })

  it("truncates output summary to 200 chars", () => {
    const longOutput = "y".repeat(300)
    const result = formatToolDone("bash", longOutput)
    expect(result).toContain("<code>" + "y".repeat(200) + "</code>")
    expect(result).not.toContain("y".repeat(201))
  })

  it("escapes HTML in title", () => {
    const result = formatToolDone("<tool>")
    expect(result).toContain("&lt;tool&gt;")
  })

  it("escapes HTML in output summary", () => {
    const result = formatToolDone("tool", "result: a > b")
    expect(result).toContain("result: a &gt; b")
  })
})

// ---------------------------------------------------------------------------
// formatToolFailed
// ---------------------------------------------------------------------------

describe("formatToolFailed", () => {
  it("produces failed icon and bold title", () => {
    const result = formatToolFailed("bash")
    expect(result).toBe("❌ <b>bash</b>")
  })

  it("includes error message in italic block", () => {
    const result = formatToolFailed("bash", "command not found")
    expect(result).toContain("<i>command not found</i>")
  })

  it("truncates error to 100 chars", () => {
    const longErr = "e".repeat(150)
    const result = formatToolFailed("bash", longErr)
    expect(result).toContain("<i>" + "e".repeat(100) + "</i>")
    expect(result).not.toContain("e".repeat(101))
  })

  it("escapes HTML in error", () => {
    const result = formatToolFailed("tool", "err: a < b")
    expect(result).toContain("err: a &lt; b")
  })
})

// ---------------------------------------------------------------------------
// formatFinalAnswer
// ---------------------------------------------------------------------------

describe("formatFinalAnswer", () => {
  it("returns single element for short text", () => {
    const chunks = formatFinalAnswer("hello world")
    expect(chunks).toHaveLength(1)
    expect(chunks[0]).toBe("hello world")
  })

  it("returns single element for text exactly at MAX", () => {
    const text = "a".repeat(4000)
    const chunks = formatFinalAnswer(text)
    expect(chunks).toHaveLength(1)
  })

  it("splits text longer than 4000 chars into multiple chunks", () => {
    const text = "a".repeat(8001)
    const chunks = formatFinalAnswer(text)
    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(4000)
    }
  })

  it("reassembled chunks contain all original content", () => {
    const text = "ab".repeat(3000) // 6000 chars
    const chunks = formatFinalAnswer(text)
    // Trim-start is applied when splitting; check content preserved
    const joined = chunks.join("")
    expect(joined.replace(/\s/g, "")).toBe(text.replace(/\s/g, ""))
  })

  it("prefers newline split points", () => {
    // Build a string where there is a newline near the 4000-char boundary
    const part1 = "a".repeat(3900) + "\n"
    const part2 = "b".repeat(4000)
    const text = part1 + part2
    const chunks = formatFinalAnswer(text)
    // First chunk should end right at the newline
    expect(chunks[0]).toBe("a".repeat(3900))
  })

  it("does not apply HTML escaping", () => {
    const text = "<b>Hello</b> & world"
    const chunks = formatFinalAnswer(text)
    expect(chunks[0]).toBe("<b>Hello</b> & world")
  })
})

// ---------------------------------------------------------------------------
// formatTable
// ---------------------------------------------------------------------------

describe("formatTable", () => {
  const headers = ["Name", "Value"]
  const rows = [["alpha", "1"], ["beta", "2"]]

  it("wraps output in <pre> tags", () => {
    const result = formatTable(headers, rows)
    expect(result.startsWith("<pre>")).toBe(true)
    expect(result.endsWith("</pre>")).toBe(true)
  })

  it("includes all header values", () => {
    const result = formatTable(headers, rows)
    expect(result).toContain("Name")
    expect(result).toContain("Value")
  })

  it("includes all row values", () => {
    const result = formatTable(headers, rows)
    expect(result).toContain("alpha")
    expect(result).toContain("beta")
    expect(result).toContain("1")
    expect(result).toContain("2")
  })

  it("uses box-drawing separator characters", () => {
    const result = formatTable(headers, rows)
    expect(result).toContain("│")
    expect(result).toContain("─")
    expect(result).toContain("┼")
  })

  it("handles empty rows", () => {
    const result = formatTable(["Col"], [])
    expect(result).toContain("Col")
    expect(result.startsWith("<pre>")).toBe(true)
  })

  it("pads columns to max width", () => {
    // "beta" (4) is wider than "Name" (4) — both same; "alpha" (5) > "Name" (4)
    const result = formatTable(["A"], [["short"], ["muchlonger"]])
    // All rows should be padded to the width of "muchlonger" (10)
    expect(result).toContain(" short      ")
  })
})

// ---------------------------------------------------------------------------
// formatApprovalMessage
// ---------------------------------------------------------------------------

describe("formatApprovalMessage", () => {
  it("produces pause icon and bold title", () => {
    const result = formatApprovalMessage("Approve action?")
    expect(result).toBe("⏸ <b>Approve action?</b>")
  })

  it("includes detail in italic when provided", () => {
    const result = formatApprovalMessage("Approve?", "Run rm -rf /tmp")
    expect(result).toContain("<i>Run rm -rf /tmp</i>")
  })

  it("escapes HTML in title and detail", () => {
    const result = formatApprovalMessage("a < b", "c & d")
    expect(result).toContain("a &lt; b")
    expect(result).toContain("c &amp; d")
  })
})

// ---------------------------------------------------------------------------
// buildApprovalKeyboard
// ---------------------------------------------------------------------------

describe("buildApprovalKeyboard", () => {
  it("returns inline_keyboard with one row of two buttons", () => {
    const kb = buildApprovalKeyboard("run-1")
    expect(kb.inline_keyboard).toHaveLength(1)
    expect(kb.inline_keyboard[0]).toHaveLength(2)
  })

  it("first button is approve with correct callback_data", () => {
    const kb = buildApprovalKeyboard("run-1", "continue")
    const btn = kb.inline_keyboard[0][0]
    expect(btn.callback_data).toBe("approve:run-1:continue")
    expect(btn.text).toContain("✅")
  })

  it("second button is reject with correct callback_data", () => {
    const kb = buildApprovalKeyboard("run-1", "continue")
    const btn = kb.inline_keyboard[0][1]
    expect(btn.callback_data).toBe("reject:run-1:continue")
    expect(btn.text).toContain("❌")
  })

  it("defaults action to continue", () => {
    const kb = buildApprovalKeyboard("run-42")
    expect(kb.inline_keyboard[0][0].callback_data).toBe("approve:run-42:continue")
  })

  it("supports custom action string", () => {
    const kb = buildApprovalKeyboard("run-99", "exec:rm /tmp/foo")
    expect(kb.inline_keyboard[0][0].callback_data).toBe("approve:run-99:exec:rm /tmp/foo")
  })
})

// ---------------------------------------------------------------------------
// parseCallbackData
// ---------------------------------------------------------------------------

describe("parseCallbackData", () => {
  it("parses approve callback", () => {
    const result = parseCallbackData("approve:run-1:continue")
    expect(result).toEqual({ type: "approve", runId: "run-1", action: "continue" })
  })

  it("parses reject callback", () => {
    const result = parseCallbackData("reject:run-1:continue")
    expect(result).toEqual({ type: "reject", runId: "run-1", action: "continue" })
  })

  it("handles action with colons", () => {
    const result = parseCallbackData("approve:run-7:exec:rm /tmp/foo")
    expect(result).toEqual({ type: "approve", runId: "run-7", action: "exec:rm /tmp/foo" })
  })

  it("returns null for unknown type", () => {
    expect(parseCallbackData("confirm:run-1:continue")).toBeNull()
  })

  it("returns null for too few parts (missing action)", () => {
    expect(parseCallbackData("approve:run-1")).toBeNull()
  })

  it("returns null for completely invalid data", () => {
    expect(parseCallbackData("garbage")).toBeNull()
  })

  it("returns null for empty string", () => {
    expect(parseCallbackData("")).toBeNull()
  })
})
