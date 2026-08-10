// Cloudflare Pages Function
// POST /api/analyze-room  { roomId, roomName }
//
// Runs server-side (independent of the client browser), so the analysis
// survives the manager closing the PWA right after triggering it.
//
// Required environment variables (set as Cloudflare Pages secrets):
//   ANTHROPIC_API_KEY
//   SUPABASE_URL
//   SUPABASE_ANON_KEY   (anon/publishable key - RLS policies are public for this test)

const SYSTEM_PROMPT = `Tu es un expert en inventaire immobilier pour une société de property management de villas en Thaïlande.

On te fournit PLUSIEURS PHOTOS de la MÊME PIÈCE, prises sous différents angles ou zooms. Un même meuble ou objet peut apparaître sur plusieurs photos : tu dois le compter UNE SEULE FOIS dans ton inventaire final (déduplication basée sur ta compréhension globale de la pièce, pas photo par photo).

PÉRIMÈTRE - À INCLURE :
- Mobilier (canapés, tables, chaises, lits, meubles de rangement...)
- Électroménager et équipements amovibles (TV, ventilateurs, bouilloire...)
- Décoration (statuettes, cadres, plantes, coussins...)
- Linge et textile (rideaux, draps, serviettes...)
- Vaisselle, couverts, ustensiles de cuisine
- Tout objet qu'on pourrait retirer de la pièce sans travaux

PÉRIMÈTRE - À EXCLURE (bâti, ne pas lister) :
- Prises électriques, interrupteurs, luminaires encastrés/fixes au plafond
- Plomberie, robinetterie fixe, climatisation murale fixe
- Portes, fenêtres, revêtements de sol/mur, plinthes
- Éléments de cuisine encastrés (four encastré, plaques, hotte) sauf électroménager posé/amovible

RÈGLE DE COMPTAGE :
- Pour les objets uniques ou en petit nombre clairement dénombrables (meubles, TV, lampes) : donne un chiffre exact.
- Pour les objets nombreux et en vrac difficiles à compter précisément (couverts, épices, petits objets amoncelés) : donne une fourchette d'estimation (ex: "8-12") et indique "quantity_type": "estimate". Ne jamais donner un chiffre exact arbitraire pour ce type d'objet.

CATÉGORISATION :
- Pour chaque item, indique un champ "category" parmi : "furniture", "decor", "textile", "kitchenware", "electronic", "appliance", "other".
- Utilise "electronic" pour les appareils électroniques (TV, box internet, enceintes...) et "appliance" pour l'électroménager (bouilloire, micro-ondes, ventilateur, machine à café...). Ces catégories déclenchent l'affichage de champs garantie côté application, donc ne les utilise QUE pour de vrais appareils électriques/électroniques.

Réponds UNIQUEMENT avec un objet JSON valide, sans texte avant/après, sans balises markdown, au format suivant :
{
  "room_type": "string",
  "photos_analyzed": number,
  "inventory": [
    {
      "item": "string",
      "category": "furniture|decor|textile|kitchenware|electronic|appliance|other",
      "material": "string ou null",
      "quantity": "string ou number",
      "quantity_type": "exact" ou "estimate",
      "condition": "string ou null",
      "notes": "string ou null"
    }
  ]
}`;

export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }
  const { roomId, roomName } = body;
  if (!roomId) return json({ error: 'roomId is required' }, 400);

  const SUPABASE_URL = env.SUPABASE_URL;
  const SUPABASE_KEY = env.SUPABASE_ANON_KEY;
  const ANTHROPIC_API_KEY = env.ANTHROPIC_API_KEY;

  try {
    // 1. Fetch photo paths for this room
    const photosRes = await fetch(
      `${SUPABASE_URL}/rest/v1/room_photos?room_id=eq.${roomId}&select=storage_path`,
      { headers: supabaseHeaders(SUPABASE_KEY) }
    );
    const photoRows = await photosRes.json();
    if (!Array.isArray(photoRows) || photoRows.length === 0) {
      await setRoomError(SUPABASE_URL, SUPABASE_KEY, roomId, 'Aucune photo trouvée pour cette pièce.');
      return json({ error: 'No photos found' }, 400);
    }

    // 2. Download each photo and base64-encode it
    const imageBlocks = [];
    for (const row of photoRows) {
      const photoUrl = `${SUPABASE_URL}/storage/v1/object/public/room-photos/${row.storage_path}`;
      const imgRes = await fetch(photoUrl);
      if (!imgRes.ok) continue;
      const buf = await imgRes.arrayBuffer();
      const base64 = arrayBufferToBase64(buf);
      const contentType = imgRes.headers.get('content-type') || 'image/jpeg';
      imageBlocks.push({ type: 'image', source: { type: 'base64', media_type: contentType, data: base64 } });
    }

    if (imageBlocks.length === 0) {
      await setRoomError(SUPABASE_URL, SUPABASE_KEY, roomId, "Impossible de récupérer les photos depuis le stockage.");
      return json({ error: 'Could not download photos' }, 500);
    }

    imageBlocks.push({
      type: 'text',
      text: `Voici ${imageBlocks.length} photo(s) de la pièce suivante : "${roomName || 'pièce'}". Analyse l'ensemble de ces photos comme UNE SEULE pièce et renvoie l'inventaire consolidé (sans doublons) en JSON, selon le format demandé.`,
    });

    // 3. Call Claude API
    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 30000,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: imageBlocks }],
      }),
    });

    const claudeData = await claudeRes.json();

    if (claudeData.error) {
      await setRoomError(SUPABASE_URL, SUPABASE_KEY, roomId, 'Erreur API Claude : ' + claudeData.error.message);
      return json({ error: claudeData.error.message }, 500);
    }

    const usage = claudeData.usage || { input_tokens: 0, output_tokens: 0 };
    const textBlock = (claudeData.content || []).find(b => b.type === 'text');
    let rawText = textBlock ? textBlock.text : '';
    rawText = rawText.replace(/```json|```/g, '').trim();

    let parsed;
    try {
      parsed = JSON.parse(rawText);
    } catch (e) {
      await setRoomError(
        SUPABASE_URL, SUPABASE_KEY, roomId,
        (claudeData.stop_reason === 'max_tokens'
          ? 'Réponse tronquée (limite max_tokens atteinte).'
          : 'JSON non parsable renvoyé par le modèle.'),
        usage
      );
      return json({ error: 'Unparsable JSON', raw: rawText, usage }, 200);
    }

    // 4. Update room in Supabase
    await fetch(`${SUPABASE_URL}/rest/v1/rooms?id=eq.${roomId}`, {
      method: 'PATCH',
      headers: { ...supabaseHeaders(SUPABASE_KEY), 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({
        status: 'done',
        room_type: parsed.room_type || null,
        photos_analyzed: parsed.photos_analyzed || imageBlocks.length - 1,
        inventory: parsed.inventory || [],
        input_tokens: usage.input_tokens || 0,
        output_tokens: usage.output_tokens || 0,
        error_message: null,
        updated_at: new Date().toISOString(),
      }),
    });

    return json({ success: true, usage });
  } catch (err) {
    await setRoomError(SUPABASE_URL, SUPABASE_KEY, roomId, 'Erreur serveur : ' + err.message);
    return json({ error: err.message }, 500);
  }
}

function supabaseHeaders(key) {
  return { apikey: key, Authorization: `Bearer ${key}` };
}

async function setRoomError(SUPABASE_URL, SUPABASE_KEY, roomId, message, usage) {
  await fetch(`${SUPABASE_URL}/rest/v1/rooms?id=eq.${roomId}`, {
    method: 'PATCH',
    headers: { ...supabaseHeaders(SUPABASE_KEY), 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({
      status: 'error',
      error_message: message,
      input_tokens: usage?.input_tokens || 0,
      output_tokens: usage?.output_tokens || 0,
      updated_at: new Date().toISOString(),
    }),
  });
}

function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
}
