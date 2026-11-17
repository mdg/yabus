// MapLibre needs the browser, so pages are rendered client-side only.
// Page requests still go through the server (hooks), which later issues session cookies.
export const ssr = false;
