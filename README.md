# all. Inventory — PWA de test terrain

## Ce qui est déjà fait

- **Projet Supabase créé** : `aps-inventory-test` (région Singapour)
  - URL : `https://luduooplhdhnzomirnre.supabase.co`
  - Tables : `villas`, `rooms`, `room_photos` (RLS activé, policies publiques — cohérent avec le mot de passe unique de l'app)
  - Realtime activé sur `rooms`
  - Buckets Storage : `room-photos`, `villa-videos` (publics en lecture)
  - Clé anon déjà intégrée dans `app.js`

## Ce qu'il te reste à faire

### 1. Créer le repo GitHub et pousser le code

```bash
cd aps-inventory
git init
git add .
git commit -m "Initial commit - APS inventory test PWA"
git remote add origin <ton-repo-github>
git push -u origin main
```

### 2. Connecter le repo à Cloudflare Pages

Comme pour le PWA APS existant : Cloudflare Pages → Create project → Connect to Git → sélectionner le repo.
- **Build command** : (aucun, site statique) — laisser vide
- **Build output directory** : `/`

### 3. Ajouter les secrets d'environnement dans Cloudflare Pages

Dans **Settings → Environment variables** du projet Cloudflare Pages, ajouter (en Production ET Preview) :

| Variable | Valeur |
|---|---|
| `ANTHROPIC_API_KEY` | ta clé API Anthropic (nouvelle clé, pas celle déjà exposée) |
| `SUPABASE_URL` | `https://luduooplhdhnzomirnre.supabase.co` |
| `SUPABASE_ANON_KEY` | la clé anon (fournie séparément, déjà dans `app.js` aussi pour le client) |

⚠️ Ces variables doivent être marquées comme **secrets** (chiffrées) côté Cloudflare, elles ne sont utilisées que côté `functions/api/analyze-room.js` (jamais exposées au navigateur).

### 4. Déployer

Une fois le repo connecté et les secrets ajoutés, Cloudflare Pages build et déploie automatiquement à chaque push. L'app sera accessible sur `https://<ton-projet>.pages.dev`.

## Structure du projet

```
/
├── index.html          → shell de l'app (gate, villas, room detail)
├── styles.css           → design system "all." (cream/charcoal/clay)
├── app.js                → logique front (Supabase client, routing, upload, realtime)
├── manifest.json         → PWA manifest
├── sw.js                  → service worker minimal (installabilité seulement)
├── assets/
│   ├── icon-192.png
│   └── icon-512.png
└── functions/
    └── api/
        └── analyze-room.js  → Cloudflare Pages Function (appel Claude API côté serveur)
```

## Notes importantes

- **Mot de passe app** : `ALLProperty2026`, vérifié côté client uniquement (`sessionStorage`) — aucune vraie sécurité, à ne pas considérer comme une protection de données réelle.
- **Traitement asynchrone** : quand on lance "Analyser la pièce", le navigateur upload les photos puis déclenche `/api/analyze-room` et n'attend pas la réponse complète. Le traitement tourne côté Cloudflare Function ; le statut de la pièce se met à jour automatiquement via Supabase Realtime, même si l'app a été fermée entre-temps (au prochain chargement, le statut à jour sera de toute façon lu depuis Supabase).
- **Coût** : chaque pièce stocke ses tokens input/output ; le total villa (et coût estimé $3/$15 par Mtoken) s'affiche en haut de la vue villa.
- **Rapport PDF** : le bouton "Générer rapport d'inventaire" ouvre un nouvel onglet avec une page HTML brandée ; utiliser Cmd/Ctrl+P → "Enregistrer en PDF" depuis cet onglet.
