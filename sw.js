const CACHE_NAME = "financas-cache-v11";

const APP_SHELL = [
  "/",
  "/app",
  "/index.html",
  "/app.html",
  "/404.html",
  "/manifest.json",
  "/css/style.css",
  "/js/app.js",
  "/js/auth.js",
  "/js/profile.js",
  "/js/supabaseClient.js",
  "/js/theme.js",
  "/js/register-sw.js",
  "/favicon.ico",
  "/favicon.svg",
  "/favicon-16.png",
  "/favicon-32.png",
  "/apple-touch-icon.png",
  "/icon-192.png",
  "/icon-512.png",
  "/icon-512-maskable.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      // cache: "reload" ignora o cache HTTP do GitHub Pages (max-age=600),
      // senão o precache podia guardar a versão anterior dos arquivos
      Promise.allSettled(APP_SHELL.map((url) => cache.add(new Request(url, { cache: "reload" }))))
    )
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) {
    return;
  }

  // rede primeiro pra tudo (páginas, JS, CSS): servir um JS antigo do cache
  // junto com um HTML novo quebra o app. O cache fica só pra uso offline.
  event.respondWith(
    fetch(request, { cache: "no-cache" })
      .then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      })
      .catch(() =>
        caches.match(request, { ignoreSearch: true }).then((cached) =>
          cached || (request.mode === "navigate" ? caches.match("/404.html") : Response.error())
        )
      )
  );
});
