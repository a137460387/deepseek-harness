/**
 * The model list of one pi-ai provider profile, plus the action that asks the
 * provider what it serves.
 *
 * The list is the profile's `models` array as the card holds it: an empty list
 * means "serve this route's built-in catalog", and any entry replaces that
 * catalog, so a row is only ever added deliberately. Fetching asks the endpoint
 * **the form currently shows** — including a key typed but not yet saved — so
 * adding a provider is one pass instead of save-then-return; the reply is
 * candidates the user picks from, never configuration written behind them.
 *
 * Each row's disclosure also edits its `reasoningEfforts`: follow the installed
 * catalog, declare the model non-reasoning, or declare the offered levels with
 * the wire value each dispatches. The level vocabulary arrives from the caller,
 * read out of the adapter's own schema, so the page offers nothing the section
 * schema would refuse.
 *
 * A provider that cannot be interrogated (an unreachable endpoint, a protocol
 * with no readable listing) is not a dead end: the failure is shown next to the
 * rows the user can still fill in by hand.
 */

import { useState } from 'react'
import type { ReactNode } from 'react'
import type { LlmDiscoveredModel } from '@deepseek-ai/dsh-api-remotes/client'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import { formatCapacity, parseCapacity } from './DeepSeekModelsEditor.tsx'
import type { ModelsOperations } from './operations.ts'
import type { DeepSeekModelDraft } from './DeepSeekModelsEditor.tsx'
import type { en } from './locales.ts'
import styles from './ModelsSection.module.css'

/**
 * One configured model row. Fields this card does not edit must survive an
 * edit rather than being dropped by a rebuild.
 */
export type ModelDraft = DeepSeekModelDraft

/** A row's text field, or the empty string when unset or not a string. */
function textOf(model: ModelDraft, key: string): string {
  const value = model[key]
  return typeof value === 'string' ? value : ''
}

/** A row's numeric field, or `undefined` when unset or not a number. */
function numberOf(model: ModelDraft, key: string): number | undefined {
  const value = model[key]
  return typeof value === 'number' ? value : undefined
}

/** The three editable states of one row's `reasoningEfforts` field. */
type EffortsMode = 'inherit' | 'disable' | 'custom'

/** The mode a row's stored efforts render as: absent inherits, `false` disables, anything else declares. */
function effortsModeOf(model: ModelDraft): EffortsMode {
  const value = model['reasoningEfforts']
  if (value === undefined) return 'inherit'
  return value === false ? 'disable' : 'custom'
}

/** A row's stored efforts when they are a declared dict, else an empty one. */
function effortsDictOf(model: ModelDraft): Record<string, unknown> {
  const value = model['reasoningEfforts']
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

/** What an interrogation needs, taken from the live form. */
export interface ProbeTarget {
  /** Settings namespace whose adapter family answers. */
  settingsNs: string
  /**
   * Route being edited, when the card edits one. An adapter that already
   * describes it answers from its own registry, so such a card can ask without
   * an endpoint at all.
   */
  provider?: string
  /** Endpoint as the form currently shows it. */
  baseURL?: string
  /** Wire protocol the form names, when it names one. */
  api?: string
  /** Key typed into the form and not yet stored, when there is one. */
  apiKey?: string
}

/** Props of {@link ModelListEditor}. */
export interface ModelListEditorProps {
  /** The rows as currently drafted. */
  models: readonly ModelDraft[]
  /** Whether the user layer currently owns the whole array; absent on a create. */
  overridden?: boolean
  /**
   * The reasoning levels a row may declare efforts for, in escalation order,
   * read out of the owning namespace's schema. Absent or empty — a family
   * whose models carry no such field — hides the control entirely.
   */
  reasoningLevels?: readonly string[]
  /** Replace the drafted rows. */
  onChange: (models: ModelDraft[]) => void
  /** Remove the user-owned array and return to inheritance; absent on a create. */
  onReset?: () => void
  /** Endpoint facts for the fetch action. */
  probe: ProbeTarget
  /**
   * Copy key naming why the fetch action is unavailable, or `undefined` when
   * it is. The card owns this because the key it would send is judged there:
   * asking with a key the form has already refused spends a round trip to be
   * told what the field already says.
   */
  probeBlocked?: keyof typeof en | undefined
  /** The Host operations whose interrogation answers the fetch action. */
  operations: ModelsOperations
  /** Section copy. */
  t: (key: keyof typeof en) => string
  /** Disable every control (read-only deployment or a pending write). */
  disabled: boolean
}

/** Disclosure chevron; rotates to point down while its row is open. */
function IconChevron({ open }: { open: boolean }): ReactNode {
  return (
    <svg
      width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden
      style={{ transform: open ? 'rotate(90deg)' : undefined, transition: 'transform 120ms ease' }}
    >
      <path d="M6 3.5L10.5 8L6 12.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** Removal glyph for one model row. */
function IconTrash(): ReactNode {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M2.5 4h11M6.5 4V2.5h3V4M4 4l.7 9a1 1 0 001 .9h4.6a1 1 0 001-.9L12 4M6.5 6.8v4.4M9.5 6.8v4.4"
        stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"
      />
    </svg>
  )
}

/** The two token counts edited as K/M-suffixed text behind a row's disclosure. */
type CapacityField = 'contextWindow' | 'maxTokens'

/**
 * What an empty capacity field is worth, shown as its placeholder so a row left
 * blank does not read as a model with no capacity at all.
 *
 * The magnitudes are the adapter's own route-level fallbacks (`llm-pi-ai`'s
 * `defaultContextWindow` and `defaultMaxTokens`), spelled the way a person
 * would say them. They are a hint, not a mirror: this page counts `K` as 1000,
 * so typing `256K` stores 256000 while leaving the field blank keeps the
 * adapter's 262144. A deployment that overrides those defaults is not
 * reflected here — nothing on this page can read them.
 */
const CAPACITY_HINT: Readonly<Record<CapacityField, string>> = {
  contextWindow: '256K',
  maxTokens: '32K',
}

/**
 * Spell a stored count for a field that may be unset. The spelling itself is
 * {@link formatCapacity}, shared with the DeepSeek catalog editor so both
 * surfaces read and write one K/M vocabulary.
 * @param value - stored capacity, or `undefined` for an unset field.
 * @returns the field text, empty when unset.
 */
function capacitySpelling(value: number | undefined): string {
  return value === undefined ? '' : formatCapacity(value)
}

/** Adopt a candidate, keeping whatever capacities the provider disclosed. */
function adopt(candidate: LlmDiscoveredModel): ModelDraft {
  return {
    id: candidate.id,
    ...candidate.name === undefined ? {} : { name: candidate.name },
    ...candidate.contextWindow === undefined ? {} : { contextWindow: candidate.contextWindow },
    ...candidate.maxTokens === undefined ? {} : { maxTokens: candidate.maxTokens },
  }
}

/**
 * Render the model list with its fetch action.
 * @param props - the drafted rows, probe target, wire face, and copy.
 * @returns the model-list editor.
 */
export function ModelListEditor(props: ModelListEditorProps): ReactNode {
  const { models, onChange, probe, operations, t, disabled } = props
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | undefined>(undefined)
  const [candidates, setCandidates] = useState<readonly LlmDiscoveredModel[] | undefined>(undefined)
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set())
  const [candidateQuery, setCandidateQuery] = useState('')
  // Rows carry an id and a name; capacities are the exception, so they stay
  // folded until asked for rather than crowding every row with four inputs.
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(new Set())
  // Capacities are edited as text, so a field's keystrokes are held here rather
  // than re-derived from the parsed count on every change — that would rewrite
  // `1000` to `1K` mid-word. Unreadable text is kept past blur so the refusal
  // names a row the user can still see, which is why this is one entry PER
  // FIELD: a single buffer would be displaced by editing any other field, and
  // the abandoned one would render its stored NaN as the literal `NaN`.
  const [editing, setEditing] = useState<ReadonlyMap<string, string>>(new Map())

  /** Buffer key for one capacity field; the row half moves when rows do. */
  const bufferKey = (index: number, field: CapacityField): string => `${String(index)}:${field}`

  const editCapacity = (index: number, field: CapacityField, text: string): void => {
    setEditing(current => new Map(current).set(bufferKey(index, field), text))
    patch(index, { [field]: parseCapacity(text) })
  }

  /** What a capacity field shows: the buffer while typing, else the stored count. */
  const capacityText = (model: ModelDraft, index: number, field: CapacityField): string =>
    editing.get(bufferKey(index, field)) ?? capacitySpelling(numberOf(model, field))

  const levels = props.reasoningLevels ?? []

  /** One level's wire text: the stored spelling, or empty when absent or null. */
  const wireText = (model: ModelDraft, level: string): string => {
    const wire = effortsDictOf(model)[level]
    return typeof wire === 'string' ? wire : ''
  }

  /** Write one row's `reasoningEfforts`, keeping every other field on the row. */
  const writeEfforts = (index: number, next: Record<string, unknown> | false | undefined): void => {
    onChange(models.map((model, at) => {
      if (at !== index) return model
      const copy = { ...model }
      if (next === undefined) Reflect.deleteProperty(copy, 'reasoningEfforts')
      else copy['reasoningEfforts'] = next
      return copy
    }))
  }

  const changeEffortsMode = (index: number, mode: string): void => {
    if (mode === 'inherit') {
      writeEfforts(index, undefined)
      return
    }
    if (mode === 'disable') {
      writeEfforts(index, false)
      return
    }
    const model = models[index]
    // A fresh declaration starts from the stored dict when it is one; otherwise
    // it declares `off` with no wire value — the spelling every dispatch reads
    // as "supported, send nothing".
    writeEfforts(index, { off: null, ...effortsDictOf(model ?? {}) })
  }

  /**
   * Rewrite the declared dict from the schema's level vocabulary instead of
   * spreading over the stored value: a hand-written key outside the vocabulary,
   * or a non-off level left valueless, is drift the adapter refuses, and an
   * edit through this editor is the moment to shed it. `off` stays declared —
   * an empty spelling means "supported, send nothing", which is what a stored
   * null renders as.
   */
  const editWire = (index: number, level: string, raw: string): void => {
    const wire = raw.trim()
    onChange(models.map((model, at) => {
      if (at !== index) return model
      const stored = effortsDictOf(model)
      const next: Record<string, unknown> = {}
      for (const name of levels) {
        if (name === level) continue
        const kept = stored[name]
        if (name === 'off') {
          next['off'] = typeof kept === 'string' && kept.length > 0 ? kept : null
          continue
        }
        if (typeof kept === 'string' && kept.length > 0) next[name] = kept
      }
      if (level === 'off') next['off'] = wire.length > 0 ? wire : null
      else if (wire.length > 0) next[level] = wire
      return { ...model, reasoningEfforts: next }
    }))
  }

  /** Settle one level's spelling on blur, the way a pasted id settles. */
  const settleWire = (index: number, level: string): void => {
    const model = models[index]
    if (model === undefined) return
    editWire(index, level, wireText(model, level).trim())
  }

  /** Drop one row's entries and shift the rows after it down, in one pass. */
  const reindexOnRemove = (
    current: ReadonlyMap<string, string>,
    index: number,
  ): Map<string, string> => {
    const next = new Map<string, string>()
    for (const [key, value] of current) {
      const at = Number(key.slice(0, key.indexOf(':')))
      if (at === index) continue
      // Only the row number moves; the field half of the key is untouched.
      next.set(at > index ? key.replace(/^\d+/, String(at - 1)) : key, value)
    }
    return next
  }

  const toggleExpanded = (index: number): void => {
    setExpanded((current) => {
      const next = new Set(current)
      if (!next.delete(index)) next.add(index)
      return next
    })
  }

  const patch = (index: number, next: Record<string, string | number | undefined>): void => {
    onChange(models.map((model, at) => {
      if (at !== index) return model
      // Rebuilt rather than spread over: an emptied optional field has to leave
      // the profile, not be stored as a value its schema would reject.
      // Spread first so a field this card does not edit survives; an emptied
      // optional field is then dropped rather than stored as a value its
      // schema would reject.
      const cleared = new Set(
        Object.entries(next).filter(([, value]) => value === undefined || value === '').map(([key]) => key),
      )
      return Object.fromEntries(
        Object.entries({ ...model, ...next }).filter(([key]) => !cleared.has(key)),
      )
    }))
  }

  const fetchModels = async (): Promise<void> => {
    setBusy(true)
    setFailure(undefined)
    try {
      const answer = await operations.discoverModels(probe.settingsNs, {
        ...probe.provider === undefined ? {} : { provider: probe.provider },
        ...probe.baseURL === undefined || probe.baseURL.length === 0 ? {} : { baseURL: probe.baseURL },
        ...probe.api === undefined ? {} : { api: probe.api },
        ...probe.apiKey === undefined ? {} : { apiKey: probe.apiKey },
      })
      if (answer.kind === 'refused') {
        setFailure(answer.message)
        return
      }
      const found = answer.models
      if (found.length === 0) {
        setFailure(t('fetchEmpty'))
        return
      }
      // Everything already configured starts unchecked, so adopting a
      // selection never silently rewrites a capacity the user corrected.
      const known = new Set(models.map(model => textOf(model, 'id')))
      setCandidateQuery('')
      setCandidates(found)
      setPicked(new Set(found.filter(model => !known.has(model.id)).map(model => model.id)))
    } finally {
      setBusy(false)
    }
  }

  const closePicker = (): void => {
    setCandidates(undefined)
    setPicked(new Set())
    setCandidateQuery('')
  }

  const adoptPicked = (): void => {
    /* v8 ignore next -- the dialog only renders with candidates loaded */
    if (candidates === undefined) return
    const byId = new Map(models.map(model => [textOf(model, 'id'), model]))
    for (const candidate of candidates) {
      if (!picked.has(candidate.id)) continue
      // A row the user already tuned wins over the provider's own numbers.
      // Keyed by id, so a half-typed row whose id is still empty is not a
      // match and the candidate joins as its own row — correct, since a row
      // without an id is not yet a model and the create/apply gates refuse it.
      byId.set(candidate.id, byId.get(candidate.id) ?? adopt(candidate))
    }
    onChange([...byId.values()])
    closePicker()
  }

  const toggle = (id: string): void => {
    setPicked((current) => {
      const next = new Set(current)
      if (!next.delete(id)) next.add(id)
      return next
    })
  }

  const activeCandidates = candidates ?? []
  const normalizedCandidateQuery = candidateQuery.trim().toLowerCase()
  const visibleCandidates = normalizedCandidateQuery.length === 0
    ? activeCandidates
    : activeCandidates.filter(candidate => candidate.id.toLowerCase().includes(normalizedCandidateQuery)
      || candidate.name?.toLowerCase().includes(normalizedCandidateQuery) === true)
  const allVisibleCandidatesPicked = visibleCandidates.length > 0
    && visibleCandidates.every(candidate => picked.has(candidate.id))

  const toggleVisibleCandidates = (): void => {
    setPicked((current) => {
      if (visibleCandidates.every(candidate => current.has(candidate.id))) {
        return new Set()
      }
      const next = new Set(current)
      for (const candidate of visibleCandidates) next.add(candidate.id)
      return next
    })
  }

  // A route the adapter already describes answers without an endpoint; only a
  // draft with neither has nothing to ask about.
  const askable = probe.provider !== undefined || (probe.baseURL !== undefined && probe.baseURL.length > 0)
  return (
    <section className={styles['modelCatalog']} aria-label={t('models')}>
      <div className={styles['modelListHead']}>
        <div className={styles['modelCatalogHeading']}>
          <span className={styles['modelCatalogTitle']}>{t('models')}</span>
          {props.overridden === undefined
            ? null
            : (
              <span className={styles['modelCatalogMeta']}>
                {props.overridden ? t('modelsCustomized') : t('modelsInherited')}
              </span>
            )}
        </div>
        {props.overridden === true && props.onReset !== undefined
          ? (
            <button
              type="button"
              className={styles['linkButton']}
              disabled={disabled}
              onClick={props.onReset}
            >
              {t('resetModels')}
            </button>
          )
          : null}
        <button
          type="button"
          className={styles['linkButton']}
          disabled={disabled || busy || !askable || props.probeBlocked !== undefined}
          title={props.probeBlocked !== undefined
            ? t(props.probeBlocked)
            : askable ? undefined : t('fetchNeedsBaseUrl')}
          onClick={() => { void fetchModels() }}
        >
          {busy ? t('fetching') : t('fetchModels')}
        </button>
      </div>
      {models.length === 0 ? <p className={styles['modelEmpty']}>{t('modelsEmpty')}</p> : null}
      {models.map((model, index) => (
        <div key={index} className={styles['modelEntry']}>
          <div className={styles['modelRow']}>
            <input
              className={styles['input']}
              type="text"
              value={textOf(model, 'id')}
              placeholder={t('modelId')}
              aria-label={`${t('modelId')} ${index + 1}`}
              disabled={disabled}
              onChange={(event) => { patch(index, { id: event.target.value }) }}
            />
            <input
              className={styles['input']}
              type="text"
              value={textOf(model, 'name')}
              placeholder={t('modelName')}
              aria-label={`${t('modelName')} ${index + 1}`}
              disabled={disabled}
              onChange={(event) => { patch(index, { name: event.target.value === '' ? undefined : event.target.value }) }}
            />
            <button
              type="button"
              className={styles['iconButton']}
              aria-label={`${t('modelAdvanced')} ${index + 1}`}
              aria-expanded={expanded.has(index)}
              title={t('modelAdvanced')}
              onClick={() => { toggleExpanded(index) }}
            >
              <IconChevron open={expanded.has(index)} />
            </button>
            <button
              type="button"
              className={`${styles['iconButton']} ${styles['iconButtonDanger']}`}
              aria-label={`${t('removeModel')} ${index + 1}`}
              title={t('removeModel')}
              disabled={disabled}
              onClick={() => {
                onChange(models.filter((_model, at) => at !== index))
                // Both stores are keyed by position, so every row after this
                // one shifts down and would otherwise inherit its neighbour's
                // state — a different row's capacities popping open, or its
                // half-typed text appearing in another row's field.
                setExpanded((current) => {
                  const next = new Set<number>()
                  for (const at of current) {
                    if (at < index) next.add(at)
                    else if (at > index) next.add(at - 1)
                  }
                  return next
                })
                setEditing(current => reindexOnRemove(current, index))
              }}
            >
              <IconTrash />
            </button>
          </div>
          {expanded.has(index)
            ? (
              <>
                <div className={styles['modelAdvanced']}>
                  <label className={styles['modelField']}>
                    <span className={styles['modelFieldLabel']}>{t('modelContextWindow')}</span>
                    <input
                      className={styles['input']}
                      type="text"
                      inputMode="numeric"
                      value={capacityText(model, index, 'contextWindow')}
                      placeholder={CAPACITY_HINT.contextWindow}
                      aria-label={`${t('modelContextWindow')} ${index + 1}`}
                      disabled={disabled}
                      onChange={(event) => { editCapacity(index, 'contextWindow', event.target.value) }}
                    />
                  </label>
                  <label className={styles['modelField']}>
                    <span className={styles['modelFieldLabel']}>{t('modelMaxTokens')}</span>
                    <input
                      className={styles['input']}
                      type="text"
                      inputMode="numeric"
                      value={capacityText(model, index, 'maxTokens')}
                      placeholder={CAPACITY_HINT.maxTokens}
                      aria-label={`${t('modelMaxTokens')} ${index + 1}`}
                      disabled={disabled}
                      onChange={(event) => { editCapacity(index, 'maxTokens', event.target.value) }}
                    />
                  </label>
                </div>
                {levels.length > 0
                  ? (
                    <div className={styles['modelReasoning']}>
                      <label className={styles['modelField']}>
                        <span className={styles['modelFieldLabel']}>{t('modelReasoning')}</span>
                        <select
                          className={`${styles['input']} ${styles['selectInput']}`}
                          value={effortsModeOf(model)}
                          aria-label={`${t('modelReasoning')} ${index + 1}`}
                          disabled={disabled}
                          onChange={(event) => { changeEffortsMode(index, event.target.value) }}
                        >
                          <option value="inherit">{t('modelReasoningInherit')}</option>
                          <option value="disable">{t('modelReasoningDisable')}</option>
                          <option value="custom">{t('modelReasoningCustom')}</option>
                        </select>
                      </label>
                      {effortsModeOf(model) !== 'custom'
                        ? null
                        : (
                          <>
                            <div className={styles['modelReasoningLevels']}>
                              {levels.map(level => (
                                <label key={level} className={styles['modelField']}>
                                  <span className={styles['modelFieldLabel']}>{level}</span>
                                  <input
                                    className={styles['input']}
                                    type="text"
                                    value={wireText(model, level)}
                                    placeholder={level === 'off'
                                      ? t('modelReasoningOffPlaceholder')
                                      : t('modelReasoningWirePlaceholder')}
                                    aria-label={`${t('modelReasoning')} ${index + 1}: ${level}`}
                                    disabled={disabled}
                                    onChange={(event) => { editWire(index, level, event.target.value) }}
                                    onBlur={() => { settleWire(index, level) }}
                                  />
                                </label>
                              ))}
                            </div>
                            <p className={styles['modelReasoningHint']}>{t('modelReasoningHint')}</p>
                          </>
                        )}
                    </div>
                  )
                  : null}
              </>
            )
            : null}
        </div>
      ))}
      <button
        type="button"
        className={styles['addModelButton']}
        disabled={disabled}
        onClick={() => { onChange([...models, { id: '' }]) }}
      >
        {t('addModel')}
      </button>
      {failure !== undefined ? <p className={styles['error']}>{failure}</p> : null}
      <Modal
        open={candidates !== undefined}
        onClose={closePicker}
        title={t('fetchTitle')}
        closeLabel={t('close')}
        description={t('fetchDescription')}
        className={styles['fetchDialog'] as string}
        footer={(
          <>
            <Button variant="outline" onClick={closePicker}>{t('cancel')}</Button>
            <Button variant="outline" onClick={adoptPicked}>{t('fetchAdopt')}</Button>
          </>
        )}
      >
        <div className={styles['candidateToolbar']}>
          <input
            className={`${styles['input']} ${styles['candidateSearch']}`}
            type="search"
            value={candidateQuery}
            placeholder={t('fetchSearch')}
            aria-label={t('fetchSearch')}
            onChange={(event) => { setCandidateQuery(event.target.value) }}
          />
          <Button
            variant="ghost"
            size="sm"
            disabled={visibleCandidates.length === 0}
            onClick={toggleVisibleCandidates}
          >
            {t(allVisibleCandidatesPicked ? 'fetchDeselectAll' : 'fetchSelectAll')}
          </Button>
        </div>
        {visibleCandidates.length === 0
          ? <p className={styles['candidateEmpty']} role="status">{t('fetchNoMatches')}</p>
          : (
            <ul className={styles['candidateList']}>
              {visibleCandidates.map(candidate => (
                <li key={candidate.id} className={styles['candidate']}>
                  <label className={styles['candidateLabel']}>
                    <input
                      type="checkbox"
                      checked={picked.has(candidate.id)}
                      onChange={() => { toggle(candidate.id) }}
                    />
                    {/* The id alone: it is the string adoption writes, and the
                        capacities the endpoint reported are adopted with it and
                        editable in the row that appears. */}
                    <span className={styles['candidateId']}>{candidate.id}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
      </Modal>
    </section>
  )
}
