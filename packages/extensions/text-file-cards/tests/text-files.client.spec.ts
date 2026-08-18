// @vitest-environment jsdom
/**
 * text-file-cards pure half: text classification, size formatting, and the
 * staged-file source (add with dead-session pruning, remove, get).
 */
import { describe, expect, it } from 'vitest'
import {
  createStagedFilesSource, formatBytes, isTextFile, MAX_BATCH_FILES, MAX_FILE_BYTES,
} from '../src/client/text-files.ts'

/** A File with the given name/type and a one-byte-per-char body of the given size. */
function fileOfSize(name: string, bytes: number, type = 'text/plain'): File {
  return new File(['x'.repeat(bytes)], name, { type })
}

describe('isTextFile', () => {
  it('accepts a text/* MIME regardless of extension', () => {
    expect(isTextFile(new File(['a'], 'weird.bin', { type: 'text/plain' }))).toBe(true)
    expect(isTextFile(new File(['a'], 'noext', { type: 'text/markdown' }))).toBe(true)
  })

  it('accepts an allowlisted extension when the MIME is empty', () => {
    expect(isTextFile(new File(['a'], 'note.md', { type: '' }))).toBe(true)
    expect(isTextFile(new File(['a'], 'app.ts', { type: '' }))).toBe(true)
    expect(isTextFile(new File(['a'], 'UPPER.TXT', { type: '' }))).toBe(true)
  })

  it('rejects images, binaries, and unknown extensions', () => {
    expect(isTextFile(new File(['a'], 'pixel.png', { type: 'image/png' }))).toBe(false)
    expect(isTextFile(new File(['a'], 'doc.docx', { type: '' }))).toBe(false)
  })

  it('rejects a file with no extension and no MIME', () => {
    expect(isTextFile(new File(['a'], 'noextension', { type: '' }))).toBe(false)
  })
})

describe('formatBytes', () => {
  it('steps B / KB / MB with one decimal past the unit step', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(1023)).toBe('1023 B')
    expect(formatBytes(1024)).toBe('1.0 KB')
    expect(formatBytes(MAX_FILE_BYTES)).toBe('100.0 KB')
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB')
    expect(formatBytes(5 * 1024 * 1024 + 512 * 1024)).toBe('5.5 MB')
  })
})

describe('createStagedFilesSource', () => {
  it('starts empty', () => {
    const source = createStagedFilesSource()
    expect(source.store.getSnapshot().bySession).toEqual({})
  })

  it('stages files under the session with minted ids in drop order', () => {
    const source = createStagedFilesSource()
    const a = new File(['alpha'], 'a.txt', { type: 'text/plain' })
    const b = new File(['beta'], 'b.md', { type: '' })
    source.add('s1', [a, b], ['s1'])
    const staged = source.store.getSnapshot().bySession['s1']
    expect(staged?.map(entry => entry.name)).toEqual(['a.txt', 'b.md'])
    expect(staged?.map(entry => entry.file)).toEqual([a, b])
    expect(new Set(staged?.map(entry => entry.id)).size).toBe(2)
  })

  it('appends to an existing session row', () => {
    const source = createStagedFilesSource()
    source.add('s1', [new File(['a'], 'a.txt')], ['s1'])
    source.add('s1', [new File(['b'], 'b.txt')], ['s1'])
    expect(source.store.getSnapshot().bySession['s1']?.map(entry => entry.name)).toEqual(['a.txt', 'b.txt'])
  })

  it('prunes sessions missing from the live list on add', () => {
    const source = createStagedFilesSource()
    source.add('gone', [new File(['a'], 'a.txt')], ['gone'])
    source.add('alive', [new File(['b'], 'b.txt')], ['alive'])
    const bySession = source.store.getSnapshot().bySession
    expect(bySession['gone']).toBeUndefined()
    expect(bySession['alive']?.length).toBe(1)
  })

  it('ignores an empty add', () => {
    const source = createStagedFilesSource()
    source.add('s1', [], ['s1'])
    expect(source.store.getSnapshot().bySession).toEqual({})
  })

  it('removes one entry and drops the session row when it empties', () => {
    const source = createStagedFilesSource()
    source.add('s1', [new File(['a'], 'a.txt'), new File(['b'], 'b.txt')], ['s1'])
    const [first] = source.store.getSnapshot().bySession['s1'] ?? []
    if (first === undefined) throw new Error('staging failed')
    source.remove('s1', first.id)
    expect(source.store.getSnapshot().bySession['s1']?.map(entry => entry.name)).toEqual(['b.txt'])
    const [second] = source.store.getSnapshot().bySession['s1'] ?? []
    if (second === undefined) throw new Error('staging failed')
    source.remove('s1', second.id)
    expect(source.store.getSnapshot().bySession['s1']).toBeUndefined()
  })

  it('treats remove of a missing id or session as a no-op', () => {
    const source = createStagedFilesSource()
    source.add('s1', [new File(['a'], 'a.txt')], ['s1'])
    source.remove('s1', 'nope')
    source.remove('other', 'nope')
    expect(source.store.getSnapshot().bySession['s1']?.length).toBe(1)
  })

  it('gets an entry by session and id, undefined once gone', () => {
    const source = createStagedFilesSource()
    source.add('s1', [new File(['a'], 'a.txt')], ['s1'])
    const [first] = source.store.getSnapshot().bySession['s1'] ?? []
    if (first === undefined) throw new Error('staging failed')
    expect(source.get('s1', first.id)?.name).toBe('a.txt')
    source.remove('s1', first.id)
    expect(source.get('s1', first.id)).toBeUndefined()
    expect(source.get('missing', first.id)).toBeUndefined()
  })
})

describe('ceilings', () => {
  it('pins the documented defaults', () => {
    expect(MAX_FILE_BYTES).toBe(100 * 1024)
    expect(MAX_BATCH_FILES).toBe(20)
    // The drop guard uses both constants; a silent change would invalidate the
    // README's documented ceilings.
    expect(fileOfSize('a.txt', MAX_FILE_BYTES).size).toBe(MAX_FILE_BYTES)
  })
})
