// Service worker minimal - permet l'installation "Add to Home Screen".
// Pas de stratégie de cache offline avancée à ce stade (app dépendante
// de Supabase + de l'API en ligne, l'offline complet n'est pas un objectif du test).

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Passthrough réseau simple - pas d'interception/cache pour l'instant.
});
