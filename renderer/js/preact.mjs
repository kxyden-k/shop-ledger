// Preact setup for screens written as components (the first is screens/insights.mjs).
//
// Component screens are the way forward for this app: Preact keeps the cursor and scroll position
// itself, and htm escapes every value, so they need none of render()'s focus handling or esc().
// The older screens build HTML strings and are being moved over one tab at a time.
//
// Libraries come from renderer/vendor through the import map in index.html. Write markup with html``:
//   html`<button class="btn" onClick=${save}>Save ${name}</button>`
// Values inside ${} are text, never markup. The app's own globals (db, ui, money, save, render, ...)
// can be used directly.

import { h, render as preactRender } from 'preact';
import htm from 'htm';

export const html = htm.bind(h);
export * from 'preact/hooks';

// Called by app.js to show or remove a component screen in an element.
export const mount = (Component, element) => preactRender(html`<${Component} />`, element);
export const unmount = element => preactRender(null, element);
