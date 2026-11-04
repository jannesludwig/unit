// UNIT — AudioWorklet module location. The processors live in processors.js and are loaded by
// URL (works in Chrome and Safari on any http(s) host, including GitHub Pages).

export function workletURL() {
  return new URL('./processors.js', import.meta.url).href;
}
