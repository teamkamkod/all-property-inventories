# all. Inventory — PWA de test terrain

## ⚠️ Architecture de déploiement

Ce projet est déployé en **Cloudflare Worker avec assets statiques** (domaine `*.workers.dev`), pas en Cloudflare Pages classique. `worker.js` sert à la fois les fichiers statiques et la route `/api/analyze-room`. La configuration est dans `wrangler.jsonc`.

## Ce qui est déjà fait

- **Projet Supabase créé** : `aps-inventory-test` (région Singapour)
  - URL : `https://luduooplhdhnzomirnre.supabase.co`
  - Tables : `villas`, `rooms`, `room_photos` (RLS activé, policies publiques — cohérent avec le mot de passe unique de l'app)
  - Realtime activé sur `rooms`
  - Buckets Storage : `room-photos`, `villa-videos` (publics en lecture)
  - Clé anon déjà intégrée dans `app.js`

## Ce qu'il te reste à faire

### 1. Vérifier que le projet Cloudflare détecte bien `wrangler.jsonc`

Dans le dashboard Cloudflare (Workers & Pages > ton projet > Settings > Build), la présence de `wrangler.jsonc` à la racine du repo doit suffire à ce que Cloudflare exécute `wrangler deploy` automatiquement à chaque push. Si le projet a été créé avant l'ajout de ce fichier, il peut être nécessaire de vérifier/forcer cette détection (Settings > Build > Build command, qui doit rester vide ou utiliser wrangler).

### 2. Ajouter les secrets d'environnement

Dans **Settings → Variables and Secrets** du Worker, ajouter (en Production) :

| Variable | Valeur |
|---|---|
| `ANTHROPIC_API_KEY` | ta clé API Anthropic |
| `SUPABASE_URL` | `https://luduooplhdhnzomirnre.supabase.co` |
| `SUPABASE_ANON_KEY` | la clé anon (déjà dans `app.js` aussi pour le client) |

Marquées comme **secrets** (chiffrées). Un redéploiement est nécessaire après leur ajout pour qu'elles soient prises en compte.

### 3. Tester

```bash
curl -s -X POST https://<ton-projet>.workers.dev/api/analyze-room \
  -H "Content-Type: application/json" \
  -d '{"roomId":"<un-id-de-pièce-existant>","roomName":"test"}'
```

Une réponse `{"error":"No photos found"}` en HTTP 200 est un **bon signe** (le worker tourne, les secrets sont lus). Une 404 signifie que `wrangler.jsonc` n'est pas détecté par le pipeline. Une 500 avec `"Missing environment variable(s)..."` signifie que les secrets ne sont pas encore configurés/déployés.

## Structure du projet

```
/
├── index.html          → shell de l'app (gate, villas, room detail)
├── styles.css           → design system "all." (cream/charcoal/clay)
├── app.js                → logique front (Supabase client, routing, upload, realtime)
├── manifest.json         → PWA manifest
├── sw.js                  → service worker minimal (installabilité seulement)
├── wrangler.jsonc         → config déploiement Cloudflare Worker + assets
├── worker.js               → route /api/analyze-room + sert les assets statiques
├── .assetsignore           → exclut worker.js/wrangler.jsonc/README du bundle d'assets
└── assets/
    ├── icon-192.png
    └── icon-512.png
```

## Notes importantes

- **Mot de passe app** : `ALLProperty2026`, vérifié côté client uniquement (`sessionStorage`) — aucune vraie sécurité, à ne pas considérer comme une protection de données réelle.
- **Traitement asynchrone** : quand on lance "Analyser la pièce", le navigateur upload les photos puis déclenche `/api/analyze-room` et n'attend pas la réponse complète. Le traitement tourne côté Worker ; le statut de la pièce se met à jour automatiquement via Supabase Realtime, même si l'app a été fermée entre-temps.
- **Coût** : chaque pièce stocke ses tokens input/output ; le total villa (et coût estimé $3/$15 par Mtoken) s'affiche en haut de la vue villa.
- **Rapport PDF** : le bouton "Générer rapport d'inventaire" ouvre un nouvel onglet avec une page HTML brandée ; utiliser Cmd/Ctrl+P → "Enregistrer en PDF" depuis cet onglet.
