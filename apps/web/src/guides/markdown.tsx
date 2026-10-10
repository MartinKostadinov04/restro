// A small Markdown reader for the guides in docs/guides (brief S3-07): headings (#, ##, ###),
// paragraphs, `-` and `1.` lists, fenced code blocks, `>` notes, and **bold** and `code` inside
// text. Nothing else: the guides are written in that subset. It builds React elements, never HTML
// strings, so nothing in a guide can inject markup. No dependency.
import type { ReactNode } from 'react'

/** A block of a guide. */
export type Block =
  | { readonly type: 'heading'; readonly level: 1 | 2 | 3; readonly text: string }
  | { readonly type: 'paragraph'; readonly text: string }
  | { readonly type: 'list'; readonly ordered: boolean; readonly items: readonly string[] }
  | { readonly type: 'code'; readonly text: string }
  | { readonly type: 'note'; readonly text: string }

/** The languages a guide file holds, each after its own `<!-- lang:xx -->` marker. */
export function splitLanguages(source: string): Record<string, string> {
  const parts = source.split(/<!--\s*lang:([a-z]{2})\s*-->/)
  const found: Record<string, string> = {}
  // parts = [before, 'bg', textBg, 'en', textEn, …]
  for (let index = 1; index < parts.length; index += 2) {
    found[parts[index] as string] = (parts[index + 1] ?? '').trim()
  }
  return found
}

/** The blocks of a Markdown text. */
export function parseBlocks(source: string): Block[] {
  const lines = source.replace(/\r\n/g, '\n').split('\n')
  const blocks: Block[] = []
  let paragraph: string[] = []
  const flush = () => {
    if (paragraph.length > 0) blocks.push({ type: 'paragraph', text: paragraph.join(' ') })
    paragraph = []
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    if (line.trim() === '') {
      flush()
      continue
    }
    if (line.startsWith('```')) {
      flush()
      const code: string[] = []
      index += 1
      while (index < lines.length && !(lines[index] ?? '').startsWith('```')) {
        code.push(lines[index] ?? '')
        index += 1
      }
      blocks.push({ type: 'code', text: code.join('\n') })
      continue
    }
    const heading = /^(#{1,3})\s+(.*)$/.exec(line)
    if (heading) {
      flush()
      blocks.push({
        type: 'heading',
        level: (heading[1] as string).length as 1 | 2 | 3,
        text: heading[2] as string,
      })
      continue
    }
    if (line.startsWith('>')) {
      flush()
      const note: string[] = [line.replace(/^>\s?/, '')]
      while (index + 1 < lines.length && (lines[index + 1] ?? '').startsWith('>')) {
        index += 1
        note.push((lines[index] ?? '').replace(/^>\s?/, ''))
      }
      blocks.push({ type: 'note', text: note.join(' ') })
      continue
    }
    const item = /^(?:(-)|(\d+)\.)\s+(.*)$/.exec(line)
    if (item) {
      flush()
      const ordered = item[1] === undefined
      const items: string[] = [item[3] as string]
      // A line indented under an item continues it; another item of the same kind adds one.
      while (index + 1 < lines.length) {
        const next = lines[index + 1] ?? ''
        const sibling = /^(?:(-)|(\d+)\.)\s+(.*)$/.exec(next)
        if (sibling && (sibling[1] === undefined) === ordered) {
          items.push(sibling[3] as string)
        } else if (/^\s{2,}\S/.test(next)) {
          items[items.length - 1] = `${items[items.length - 1]} ${next.trim()}`
        } else {
          break
        }
        index += 1
      }
      blocks.push({ type: 'list', ordered, items })
      continue
    }
    paragraph.push(line.trim())
  }
  flush()
  return blocks
}

/** `**bold**` and `code` inside a line of text. */
export function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = []
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`)/g
  let last = 0
  let key = 0
  for (const match of text.matchAll(pattern)) {
    const at = match.index ?? 0
    if (at > last) nodes.push(text.slice(last, at))
    const token = match[0]
    nodes.push(
      token.startsWith('**') ? (
        <strong key={key++}>{token.slice(2, -2)}</strong>
      ) : (
        <code key={key++} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">
          {token.slice(1, -1)}
        </code>
      ),
    )
    last = at + token.length
  }
  if (last < text.length) nodes.push(text.slice(last))
  return nodes
}

/** A guide, drawn with the admin's typography. */
export function Markdown({ source }: { source: string }) {
  const blocks = parseBlocks(source)
  return (
    <div className="space-y-4 text-sm leading-relaxed" data-testid="guide-body">
      {blocks.map((block, index) => {
        const key = `${block.type}-${index}`
        switch (block.type) {
          case 'heading':
            if (block.level === 1) {
              return (
                <h1 key={key} className="text-2xl font-semibold tracking-tight">
                  {renderInline(block.text)}
                </h1>
              )
            }
            if (block.level === 2) {
              return (
                <h2 key={key} className="pt-4 text-xl font-semibold tracking-tight">
                  {renderInline(block.text)}
                </h2>
              )
            }
            return (
              <h3 key={key} className="pt-2 text-base font-semibold">
                {renderInline(block.text)}
              </h3>
            )
          case 'paragraph':
            return <p key={key}>{renderInline(block.text)}</p>
          case 'list': {
            const List = block.ordered ? 'ol' : 'ul'
            return (
              <List
                key={key}
                className={`ml-5 space-y-1.5 ${block.ordered ? 'list-decimal' : 'list-disc'}`}
              >
                {block.items.map((item) => (
                  <li key={item}>{renderInline(item)}</li>
                ))}
              </List>
            )
          }
          case 'code':
            return (
              <pre
                key={key}
                className="overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs leading-snug"
              >
                {block.text}
              </pre>
            )
          case 'note':
            return (
              <p key={key} className="rounded-md border-l-4 bg-muted/50 px-3 py-2">
                {renderInline(block.text)}
              </p>
            )
          default:
            return null
        }
      })}
    </div>
  )
}
