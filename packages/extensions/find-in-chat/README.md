# @deepseek-ai/dsh-client-find-in-chat

English | [中文](README.zh.md)

In-conversation find for the Web UI: Ctrl/Cmd+F opens a top-center find bar over the active chat view — literal case-insensitive matching over the conversation's loaded messages, wrap-around stepping, center-scrolling highlights, and an honest coverage note. The browser's native find bar is otherwise untouched wherever this plugin declines the key.

The interception is a document-level capture-phase keydown listener (the global-paste pattern). It only ever takes Ctrl/Cmd+F without Shift/Alt, and only while a chat flow is mounted and no dialog owns the page: the no-session hero and the trajectory tab both leave the chat DOM, and with it the interception — those states keep the browser's own find. The composer is never touched; the package consumes no `conversation.input` verbs and requests no composer-guards module row.

How the search works:

- **Match**: literal substrings, case-insensitive, one text node at a time (a query spanning two text nodes — how React splits rendered prose — deliberately does not match, matching the native find's behavior over split nodes). Code-block text matches like any prose; `aria-hidden` decorative text is skipped.
- **Navigate**: Enter steps forward and Shift+Enter steps backward, wrapping at both ends; the active match scrolls to the conversation scrollport's center and paints through the CSS Custom Highlight API — ranges over the existing DOM, zero mutation of the React tree, cleared on every step and on close. Platforms without the API (old browsers, jsdom) degrade to counting and scrolling without paint.
- **Coverage**: searches run over the chat flow's live DOM — exactly what the native find can see — and the bar says so: the settled-message count plus an "earlier messages not loaded" note whenever the loaded window does not reach the session's head. Nothing calls `loadOlder` automatically: the chat view keeps every loaded message mounted, so auto-paging would grow the DOM without bound; clicking the view's own Load earlier button and searching again picks the older window up.
- **Close**: Escape (from the find input), a session switch, or the chat view unmounting (session closed, trajectory tab) closes the bar, clears every highlight, and restores the pre-open focus. Streaming stays live: DOM mutations rescan the window behind a 200 ms debounce, and the current index clamps when matches shrink.

## Model Experience

None, as the browser-side plugin only reads the rendered conversation DOM and paints highlights; it registers nothing model-facing.

#### KV Cache effect

None; the package never assembles or sends provider requests.

## Known Limitations and Deferred Work

- **Loaded window only** — messages outside the loaded window (the initial page is the latest 50 messages) are not searched. This matches the browser's native find, which can only see the DOM too; the coverage note states the window explicitly instead of paging unboundedly.
- **No regex, no case sensitivity** — literal, case-insensitive matching only.
- **No cross-session search** — the current session's chat view only; the sidebar's session search remains the cross-session tool. Trajectory-view text is not searched.
- **One text node at a time** — occurrences split across React text nodes do not match; re-rendering or the Load earlier round-trip often rejoins the nodes.
- **Ctrl/Cmd+F is taken over in chat views** — when the plugin accepts the key, the browser's native find bar no longer opens there. Every declined state (no session, trajectory tab, any open dialog) keeps the native behavior.
