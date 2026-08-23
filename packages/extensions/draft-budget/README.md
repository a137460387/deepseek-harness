# @deepseek-ai/dsh-client-draft-budget

English | [中文](README.zh.md)

Draft token budget for the Web UI: a muted readout under the composer estimating the current draft's token cost and, when the provider reports context figures, the after-send occupancy as a percentage of the context window. The estimate mirrors the token-meter's own heuristic, so the readout prices a draft at exactly what the meter will charge it when sent.

The readout is a pure slot consumer mounted beside the stats line in the composer dock (`conversation.composer.dock`): the live draft arrives through the dock's `useInput` share behind a 250 ms trailing debounce, and the context baseline through the session projection `contextPressure` — provider-anchored `projectedTokens` preferred, `pressureTokens` fallback, a percentage only when a route capacity exists (tokens-only otherwise). The composer is never written; no listener of any kind is registered.

How the numbers work:

- **Estimate**: `ceil(length / 4) + 8` — the token-meter's fixed text density plus block and role framing, the exact price a plain-text draft pays as a sent user message. A contract spec pins the mirror against the real `estimateMessage` from `@deepseek-ai/dsh-token-meter`, so an upstream formula change turns this fork's test red on the next sync.
- **After-send percent**: `(baseline + draft) / context window`, capped at 100%, baseline anchored on the provider-reported projection — the heuristic prices only the draft increment.
- **Every figure carries `~`**: the heuristic underprices CJK text and JSON schemas and has measured tens-of-percent divergence from provider-reported usage in long sessions (see the upstream token-meter README and discussion #3514). Approximation is stated, never implied.

## Model Experience

None, as the browser-side plugin only reads slot props (the draft share and a session projection) and renders an estimate; it registers nothing model-facing.

#### KV Cache effect

None; the package never assembles or sends provider requests.

## Known Limitations and Deferred Work

- **The estimate is heuristic, not tokenized** — it inherits the meter's documented error band (CJK/JSON underpricing, tens-of-percent divergence possible). The displayed `~` and this note are the disclosure; the after-send baseline stays provider-anchored to keep the error out of the large number.
- **Not counted**: slash-command claims and @ reference chips (machine state beside the draft string), queued steering rows, and draft images — sending costs at least the displayed figure, usually a little more.
- **No per-tokenizer pricing** — the density constant is the meter's, not the active model's; a future meter with exact tokenization supersedes this mirror (the contract spec flags the drift).
- **No toggle** — a zero-config readout; composing the plugin out of `cordis.patch.yml` removes it entirely.
