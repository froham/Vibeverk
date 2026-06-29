# Module Conventions

All modules in Vibeverk follow a strict IIFE pattern. These conventions exist to keep the codebase compatible with no-bundler deployment, to make modules self-contained, and to avoid global namespace pollution.

## IIFE structure

Every module file is a single immediately-invoked function expression:

```js
(function () {
  "use strict";

  // module code here

})();
```

## Code style within modules

- `var` declarations only — no `let`, no `const`
- Named function declarations — no arrow functions in module code
- No class syntax
- No module imports (`import`/`require`) — all dependencies are accessed via `window.*` globals

These constraints keep the code compatible with the no-bundler, no-transpiler deployment model.

## Reading configuration

Modules read customer configuration via globals set by `config.js`:

```js
var CFG = window.SITE_CONFIG;
var features = window.SITE_CONFIG.features;
```

Never read `productMode` from `CFG` defaults — read it from `superconfig` in the Supabase store. Reading from CFG defaults would block tests in environments without Supabase.

## Public site module registration

Public site modules register themselves with the App via:

```js
App.registerModule({
  id: 'module-id',
  label: 'Display Name',
  order: 10,
  adminOnly: false,        // if true, only visible to web admin
  render: function () {
    return '<div>...</div>';  // HTML string, no side effects
  },
  admin: {
    label: 'Admin Tab Name',
    category: 'content',   // 'content' | 'settings' | etc.
    render: function () {
      return '<div>...</div>';  // admin panel HTML string
    },
    mount: function (container) {
      // DOM manipulation, event binding, data fetching
    }
  }
});
```

## Intranet module registration

Intranet modules register with the intranet bootstrap via:

```js
window.Intranet.registerModule({
  id: 'module-id',
  navLabel: 'Sidebar Label',
  icon: '📋',
  order: 20,
  render: function () {
    return '<div>...</div>';  // HTML string
  },
  mount: function (container) {
    // DOM manipulation, event binding, data fetching
  }
});
```

## render() and mount() contract

- `render()` returns a complete HTML string for the module's content area. No DOM access, no network calls, no side effects. Called once to produce the initial HTML.
- `mount(container)` receives the DOM container after `innerHTML` has been set. Does all DOM manipulation, event binding, data fetching, and interval setup here.

## Modules that register in both contexts

Some modules are loaded by both `index.html` (public site) and `intranet/index.html` (intranet) and register in both App and Intranet:

- `module-users.js` — user admin for intranet, optionally exposed via web admin
- `module-chat.js` — visitor chat widget on public site, admin panel in intranet
- `module-crm.js` — CRM admin on public site (/#admin), CRM in intranet

These files live in the root directory (not in `intranet/`) because they are loaded by both entry points.

## Supabase client

Modules access the Supabase client via:

```js
var _sb = (window.App && window.App.supabase) || null;
```

This is set once when the module loads. If `_sb` is null (e.g., in the test harness without Supabase), the module should degrade gracefully rather than throw.

## localStorage via App.store

Modules use `App.store` for persistent key/value storage:

```js
App.store.get('my-key', defaultValue);  // reads localStorage, falls back to default
App.store.set('my-key', value);         // writes to localStorage immediately, debounced Supabase sync
App.store.remove('my-key');             // removes from localStorage and Supabase
```

All keys are namespaced automatically with the `nordpunkt:` prefix. **Do not use `localStorage` directly** — always go through `App.store`.

## The storageKey constraint

`storageKey: "nordpunkt"` in `config.js` MUST NEVER be changed. All existing Supabase `store` rows and all localStorage entries are keyed with this prefix. Renaming it would silently corrupt all existing data and break hydration for existing users.

## Cache busting

Every time a module file is changed, the corresponding `?v=N` version number in `index.html` (and `intranet/index.html` for intranet modules) must be incremented by 1. Only increment the version for files that actually changed. Do not bump all versions on every commit.

Example in `index.html`:
```html
<script src="module-chat.js?v=14"></script>
```

## Module files by location

| Location | Loaded by | Context |
|---|---|---|
| `module-*.js` (root) | `index.html` | Public site (and web admin) |
| `intranet/module-*.js` | `intranet/index.html` | Intranet/workspace only |
| `module-users.js`, `module-chat.js`, `module-crm.js` | Both `index.html` files | Both contexts |
| `console/console-core.js` | `console/index.html` | Vibeverk operator console only |
