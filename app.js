import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ---- Config ----
const SUPABASE_URL = 'https://luduooplhdhnzomirnre.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx1ZHVvb3BsaGRobnpvbWlybnJlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYzODc0OTMsImV4cCI6MjEwMTk2MzQ5M30.XLjIO1VtgcZ0BYef7R0BDdW-K_NOxWGFXZK1LgrzMmM';
const APP_PASSWORD = 'ALLProperty2026';
const MAX_DIM = 1568;
const PRICE_INPUT_PER_M = 3;   // $ / 1M input tokens
const PRICE_OUTPUT_PER_M = 15; // $ / 1M output tokens

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ---- State ----
let state = {
  villas: [],
  currentVillaId: null,
  rooms: [],
  currentRoomId: null,
  roomPhotosPending: [], // { base64, mediaType, previewUrl } before upload
  existingRoomPhotos: [],
  itemPhotos: [],
};

// ---- Password gate ----
const gate = document.getElementById('gate');
const app = document.getElementById('app');

function checkGate() {
  if (sessionStorage.getItem('aps_gate_ok') === '1') {
    gate.classList.add('hidden');
    app.classList.remove('hidden');
    initApp();
  }
}
document.getElementById('gateSubmit').addEventListener('click', () => {
  const val = document.getElementById('gatePassword').value;
  if (val === APP_PASSWORD) {
    sessionStorage.setItem('aps_gate_ok', '1');
    checkGate();
  } else {
    document.getElementById('gateError').textContent = 'Mot de passe incorrect.';
  }
});
document.getElementById('gatePassword').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('gateSubmit').click();
});
checkGate();

// ---- Views ----
const views = {
  villas: document.getElementById('view-villas'),
  villa: document.getElementById('view-villa'),
  room: document.getElementById('view-room'),
};
function showView(name) {
  Object.values(views).forEach(v => v.classList.add('hidden'));
  views[name].classList.remove('hidden');
  document.getElementById('topbarTitle').textContent =
    name === 'villas' ? '' :
    name === 'villa' ? (state.villas.find(v => v.id === state.currentVillaId)?.name || '') :
    state.rooms.find(r => r.id === state.currentRoomId)?.name || '';
}
document.getElementById('homeLink').addEventListener('click', () => { showView('villas'); loadVillas(); });
document.querySelectorAll('[data-back]').forEach(btn => {
  btn.addEventListener('click', () => {
    const target = btn.dataset.back;
    if (target === 'villas') { showView('villas'); loadVillas(); }
    if (target === 'villa') { showView('villa'); loadRooms(); }
  });
});

// ---- Modals ----
function openModal(id) { document.getElementById(id).classList.remove('hidden'); }
function closeModal(id) { document.getElementById(id).classList.add('hidden'); }
document.querySelectorAll('[data-close-modal]').forEach(btn => {
  btn.addEventListener('click', () => btn.closest('.modal').classList.add('hidden'));
});

// ---- Init ----
async function initApp() {
  await loadVillas();
  showView('villas');
}

// ---- Villas ----
async function loadVillas() {
  const { data, error } = await supabase.from('villas').select('*').order('created_at', { ascending: false });
  if (error) { console.error(error); return; }
  state.villas = data;
  renderVillas();
}

function renderVillas() {
  const grid = document.getElementById('villasGrid');
  grid.innerHTML = '';
  state.villas.forEach(v => {
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `<div class="card-title">${escapeHtml(v.name)}</div>
      <div class="card-sub">${v.address ? escapeHtml(v.address) : 'Adresse non renseignée'}</div>
      <div class="card-sub">${v.bedrooms || 0} ch. · ${v.bathrooms || 0} sdb${v.has_pool ? ' · piscine' : ''}${v.sea_view ? ' · vue mer' : ''}</div>`;
    card.addEventListener('click', () => openVilla(v.id));
    grid.appendChild(card);
  });
  const addCard = document.createElement('div');
  addCard.className = 'card card-add';
  addCard.textContent = '+ Ajouter une villa';
  addCard.addEventListener('click', () => openModal('modalAddVilla'));
  grid.appendChild(addCard);
}

document.getElementById('confirmAddVilla').addEventListener('click', async () => {
  const name = document.getElementById('newVillaName').value.trim();
  if (!name) return;
  const { data, error } = await supabase.from('villas').insert({ name }).select().single();
  if (error) { alert('Erreur : ' + error.message); return; }
  document.getElementById('newVillaName').value = '';
  closeModal('modalAddVilla');
  await loadVillas();
  openVilla(data.id);
});

async function openVilla(villaId) {
  state.currentVillaId = villaId;
  const v = state.villas.find(x => x.id === villaId);
  document.getElementById('villaName').value = v.name || '';
  document.getElementById('villaAddress').value = v.address || '';
  document.getElementById('villaBedrooms').value = v.bedrooms ?? '';
  document.getElementById('villaBathrooms').value = v.bathrooms ?? '';
  document.getElementById('villaPool').checked = !!v.has_pool;
  document.getElementById('villaSeaView').checked = !!v.sea_view;
  document.getElementById('villaInfoSummary').textContent = `— ${v.name}`;
  document.getElementById('videoStatus').textContent = v.video_url ? 'Vidéo déjà enregistrée.' : '';
  showView('villa');
  await loadRooms();
  subscribeRealtime(villaId);
}

document.getElementById('saveVillaInfo').addEventListener('click', async () => {
  const payload = {
    name: document.getElementById('villaName').value.trim(),
    address: document.getElementById('villaAddress').value.trim(),
    bedrooms: parseInt(document.getElementById('villaBedrooms').value) || null,
    bathrooms: parseInt(document.getElementById('villaBathrooms').value) || null,
    has_pool: document.getElementById('villaPool').checked,
    sea_view: document.getElementById('villaSeaView').checked,
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabase.from('villas').update(payload).eq('id', state.currentVillaId);
  if (error) { alert('Erreur : ' + error.message); return; }
  await loadVillas();
  document.getElementById('topbarTitle').textContent = payload.name;
});

// ---- Realtime ----
let realtimeChannel = null;
function subscribeRealtime(villaId) {
  if (realtimeChannel) supabase.removeChannel(realtimeChannel);
  realtimeChannel = supabase
    .channel(`rooms-villa-${villaId}`)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'rooms', filter: `villa_id=eq.${villaId}` },
      (payload) => {
        const idx = state.rooms.findIndex(r => r.id === payload.new.id);
        if (idx !== -1) state.rooms[idx] = payload.new;
        renderRooms();
        renderCostBar();
        if (state.currentRoomId === payload.new.id && !views.room.classList.contains('hidden')) {
          renderRoomDetail();
        }
      })
    .subscribe();
}

// ---- Rooms ----
async function loadRooms() {
  const { data, error } = await supabase.from('rooms').select('*').eq('villa_id', state.currentVillaId).order('created_at');
  if (error) { console.error(error); return; }
  state.rooms = data;
  renderRooms();
  renderCostBar();
}

function renderCostBar() {
  const totalIn = state.rooms.reduce((s, r) => s + (r.input_tokens || 0), 0);
  const totalOut = state.rooms.reduce((s, r) => s + (r.output_tokens || 0), 0);
  const cost = (totalIn / 1e6) * PRICE_INPUT_PER_M + (totalOut / 1e6) * PRICE_OUTPUT_PER_M;
  document.getElementById('costBar').textContent =
    `Consommation villa : ${totalIn.toLocaleString('fr-FR')} tokens in · ${totalOut.toLocaleString('fr-FR')} tokens out — coût estimé $${cost.toFixed(3)}`;
}

function renderRooms() {
  const grid = document.getElementById('roomsGrid');
  grid.innerHTML = '';
  state.rooms.forEach(r => {
    const card = document.createElement('div');
    card.className = 'card';
    const badgeClass = `status-${r.status}`;
    const badgeLabel = { pending: 'à faire', processing: 'analyse...', done: 'terminé', error: 'erreur' }[r.status] || r.status;
    card.innerHTML = `<div class="card-title">${escapeHtml(r.name)}</div>
      <span class="status-badge ${badgeClass}">${badgeLabel}</span>
      <div class="card-sub">${r.room_type ? escapeHtml(r.room_type) : ''}</div>`;
    card.addEventListener('click', () => openRoom(r.id));
    grid.appendChild(card);
  });
  const addCard = document.createElement('div');
  addCard.className = 'card card-add';
  addCard.textContent = '+ Ajouter une pièce';
  addCard.addEventListener('click', () => openModal('modalAddRoom'));
  grid.appendChild(addCard);
}

document.getElementById('confirmAddRoom').addEventListener('click', async () => {
  const name = document.getElementById('newRoomName').value.trim();
  if (!name) return;
  const { data, error } = await supabase.from('rooms').insert({ name, villa_id: state.currentVillaId, status: 'pending' }).select().single();
  if (error) { alert('Erreur : ' + error.message); return; }
  document.getElementById('newRoomName').value = '';
  closeModal('modalAddRoom');
  await loadRooms();
  openRoom(data.id);
});

async function openRoom(roomId) {
  state.currentRoomId = roomId;
  state.roomPhotosPending = [];
  showView('room');
  await loadRoomPhotos();
  await loadItemPhotos();
  renderRoomDetail();
}

async function loadRoomPhotos() {
  const { data } = await supabase.from('room_photos').select('*').eq('room_id', state.currentRoomId);
  state.existingRoomPhotos = data || [];
}

async function loadItemPhotos() {
  const { data } = await supabase.from('item_photos').select('*').eq('room_id', state.currentRoomId);
  state.itemPhotos = data || [];
}

function renderRoomDetail() {
  const r = state.rooms.find(x => x.id === state.currentRoomId);
  if (!r) return;
  document.getElementById('roomTitle').textContent = r.name;
  const stale = r.status === 'processing' && (Date.now() - new Date(r.created_at).getTime()) > 3 * 60 * 1000;
  const badgeClass = stale ? 'status-error' : `status-${r.status}`;
  const badgeLabel = stale ? 'bloqué ? (>3min)' : ({ pending: 'à faire', processing: 'analyse en cours...', done: 'terminé', error: 'erreur' }[r.status] || r.status);
  const badge = document.getElementById('roomStatusBadge');
  badge.className = `status-badge ${badgeClass}`;
  badge.textContent = badgeLabel;
  if (stale) {
    document.getElementById('roomAnalyzeStatus').textContent = "Cette pièce est en 'processing' depuis plus de 3 minutes — la fonction serveur a probablement échoué silencieusement. Vérifie les logs Cloudflare, puis relance l'analyse.";
  }

  // thumbs: existing uploaded photos (deletable) + pending ones (deletable)
  const thumbs = document.getElementById('roomThumbs');
  thumbs.innerHTML = '';
  (state.existingRoomPhotos || []).forEach(p => {
    const url = `${SUPABASE_URL}/storage/v1/object/public/room-photos/${p.storage_path}`;
    const div = document.createElement('div');
    div.className = 'thumb';
    div.innerHTML = `<img src="${url}"><div class="remove" data-existing-id="${p.id}" data-existing-path="${escapeAttr(p.storage_path)}">×</div>`;
    thumbs.appendChild(div);
  });
  state.roomPhotosPending.forEach((p, idx) => {
    const div = document.createElement('div');
    div.className = 'thumb';
    div.innerHTML = `<img src="${p.previewUrl}"><div class="remove" data-idx="${idx}">×</div>`;
    thumbs.appendChild(div);
  });
  thumbs.querySelectorAll('.remove[data-idx]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.roomPhotosPending.splice(parseInt(btn.dataset.idx), 1);
      renderRoomDetail();
    });
  });
  thumbs.querySelectorAll('.remove[data-existing-id]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Supprimer cette photo ?')) return;
      await supabase.storage.from('room-photos').remove([btn.dataset.existingPath]);
      await supabase.from('room_photos').delete().eq('id', btn.dataset.existingId);
      await loadRoomPhotos();
      renderRoomDetail();
    });
  });

  document.getElementById('analyzeRoomBtn').disabled = (state.roomPhotosPending.length === 0 && (state.existingRoomPhotos || []).length === 0) || r.status === 'processing';

  // inventory
  const invDiv = document.getElementById('roomInventory');
  invDiv.innerHTML = '';
  if (r.error_message) {
    invDiv.innerHTML = `<p class="muted-text" style="color:var(--error)">Erreur : ${escapeHtml(r.error_message)}</p>`;
  }
  if (!r.inventory) r.inventory = [];
  r.inventory.forEach((item) => renderItemCard(invDiv, item, r));

  const addBtn = document.createElement('button');
  addBtn.className = 'btn btn-secondary btn-wide';
  addBtn.textContent = '+ Ajouter un élément manuellement';
  addBtn.addEventListener('click', () => {
    r.inventory.push({
      id: crypto.randomUUID(),
      source: 'manual',
      item: '',
      category: 'other',
      material: '',
      quantity: 1,
      quantity_type: 'exact',
      condition: '',
      notes: '',
    });
    saveInventory(r, true);
    renderRoomDetail();
  });
  invDiv.appendChild(addBtn);
}

function renderItemCard(container, item, room) {
  const div = document.createElement('div');
  div.className = 'item-card';
  const isElectronic = item.category === 'electronic' || item.category === 'appliance';
  const estBadge = item.quantity_type === 'estimate' ? '<span class="badge-estimate">estimation</span>' : '';
  const conditionOptions = ['', 'Neuf', 'Bon état', 'Usé', 'Vétuste'];
  const photos = (state.itemPhotos || []).filter(p => p.item_id === item.id);

  div.innerHTML = `
    <div class="item-card-row" style="justify-content:space-between; align-items:flex-start;">
      <div style="flex:1;">
        <label class="field-label">Élément</label>
        <input class="item-name" data-field="item" value="${escapeAttr(item.item || '')}" placeholder="Nom de l'élément">
      </div>
      <button class="btn-delete-item" title="Supprimer cet élément" data-delete-item>🗑</button>
    </div>
    <div class="item-card-row">
      <div class="field-small">
        <label class="field-label">Qté ${estBadge}</label>
        <input class="field-small" data-field="quantity" value="${escapeAttr(item.quantity ?? '')}">
      </div>
      <div class="field-med">
        <label class="field-label">Matériau</label>
        <input class="field-med" data-field="material" value="${escapeAttr(item.material || '')}">
      </div>
      <div class="field-med">
        <label class="field-label">État</label>
        <select class="field-med" data-field="condition">
          ${conditionOptions.map(opt => `<option value="${opt}" ${item.condition === opt ? 'selected' : ''}>${opt || '—'}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="item-card-row">
      <div style="flex:1 1 100%;">
        <label class="field-label">Notes</label>
        <input class="field-med" data-field="notes" value="${escapeAttr(item.notes || '')}" style="width:100%;">
      </div>
    </div>
    ${isElectronic ? `
    <div class="warranty-fields">
      <div class="field-med">
        <label class="field-label">N° de série</label>
        <input class="field-med" data-field="serial_number" value="${escapeAttr(item.serial_number || '')}">
      </div>
      <div class="field-small">
        <label class="field-label">Sous garantie</label>
        <select class="field-small" data-field="under_warranty">
          <option value="">—</option>
          <option value="yes" ${item.under_warranty === 'yes' ? 'selected' : ''}>Oui</option>
          <option value="no" ${item.under_warranty === 'no' ? 'selected' : ''}>Non</option>
        </select>
      </div>
      <div class="field-med">
        <label class="field-label">Fin garantie</label>
        <input type="date" class="field-med" data-field="warranty_end_date" value="${escapeAttr(item.warranty_end_date || '')}">
      </div>
    </div>` : ''}
    <div class="item-photos-section">
      <label class="field-label">Photos détaillées de cet élément</label>
      <div class="thumbs item-photo-thumbs"></div>
      <input type="file" accept="image/*" capture="environment" multiple class="item-photo-input">
    </div>
  `;

  div.querySelectorAll('[data-field]').forEach(input => {
    input.addEventListener('change', () => {
      const field = input.dataset.field;
      item[field] = input.value;
      saveInventory(room);
    });
  });

  div.querySelector('[data-delete-item]').addEventListener('click', async () => {
    if (!confirm(`Supprimer "${item.item || 'cet élément'}" ?`)) return;
    room.inventory = room.inventory.filter(i => i.id !== item.id);
    saveInventory(room, true);
    // clean up any sub-photos tied to this item
    const relatedPhotos = (state.itemPhotos || []).filter(p => p.item_id === item.id);
    for (const p of relatedPhotos) {
      await supabase.storage.from('item-photos').remove([p.storage_path]);
      await supabase.from('item_photos').delete().eq('id', p.id);
    }
    await loadItemPhotos();
    renderRoomDetail();
  });

  // Sub-photos: render existing + upload handler
  const subThumbs = div.querySelector('.item-photo-thumbs');
  photos.forEach(p => {
    const url = `${SUPABASE_URL}/storage/v1/object/public/item-photos/${p.storage_path}`;
    const t = document.createElement('div');
    t.className = 'thumb';
    t.innerHTML = `<img src="${url}"><div class="remove" data-photo-id="${p.id}" data-photo-path="${escapeAttr(p.storage_path)}">×</div>`;
    subThumbs.appendChild(t);
  });
  subThumbs.querySelectorAll('.remove').forEach(btn => {
    btn.addEventListener('click', async () => {
      await supabase.storage.from('item-photos').remove([btn.dataset.photoPath]);
      await supabase.from('item_photos').delete().eq('id', btn.dataset.photoId);
      await loadItemPhotos();
      renderRoomDetail();
    });
  });

  div.querySelector('.item-photo-input').addEventListener('change', async (e) => {
    const files = Array.from(e.target.files);
    for (const file of files) {
      const resized = await resizeImage(file);
      const blob = await (await fetch(resized.previewUrl)).blob();
      const path = `${room.id}/${item.id}/${crypto.randomUUID()}.jpg`;
      const { error } = await supabase.storage.from('item-photos').upload(path, blob, { contentType: 'image/jpeg' });
      if (error) { alert('Erreur upload photo : ' + error.message); continue; }
      await supabase.from('item_photos').insert({ room_id: room.id, item_id: item.id, storage_path: path });
    }
    await loadItemPhotos();
    renderRoomDetail();
  });

  container.appendChild(div);
}

let saveTimeout = null;
function saveInventory(room, immediate) {
  clearTimeout(saveTimeout);
  const doSave = async () => {
    await supabase.from('rooms').update({ inventory: room.inventory, updated_at: new Date().toISOString() }).eq('id', room.id);
    renderCostBar();
  };
  if (immediate) { doSave(); return; }
  saveTimeout = setTimeout(doSave, 400);
}

// ---- Photo capture + resize ----
document.getElementById('roomPhotoInput').addEventListener('change', async (e) => {
  const files = Array.from(e.target.files);
  for (const file of files) {
    const resized = await resizeImage(file);
    state.roomPhotosPending.push(resized);
  }
  e.target.value = '';
  renderRoomDetail();
});

function resizeImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onload = (e) => { img.src = e.target.result; };
    reader.onerror = reject;
    img.onload = () => {
      let { width, height } = img;
      if (width > height && width > MAX_DIM) { height = Math.round(height * (MAX_DIM / width)); width = MAX_DIM; }
      else if (height > MAX_DIM) { width = Math.round(width * (MAX_DIM / height)); height = MAX_DIM; }
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
      resolve({ base64: dataUrl.split(',')[1], mediaType: 'image/jpeg', previewUrl: dataUrl });
    };
    img.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ---- Analyze room ----
document.getElementById('analyzeRoomBtn').addEventListener('click', async () => {
  const roomId = state.currentRoomId;
  const room = state.rooms.find(r => r.id === roomId);
  const photosToUpload = [...state.roomPhotosPending];
  if (photosToUpload.length === 0) return;

  document.getElementById('analyzeRoomBtn').disabled = true;
  document.getElementById('roomAnalyzeStatus').textContent = 'Upload des photos...';

  // 1. Upload photos to Storage + insert room_photos rows
  for (const p of photosToUpload) {
    const path = `${roomId}/${crypto.randomUUID()}.jpg`;
    const blob = await (await fetch(p.previewUrl)).blob();
    const { error: upErr } = await supabase.storage.from('room-photos').upload(path, blob, { contentType: 'image/jpeg' });
    if (upErr) { document.getElementById('roomAnalyzeStatus').textContent = 'Erreur upload : ' + upErr.message; document.getElementById('analyzeRoomBtn').disabled = false; return; }
    await supabase.from('room_photos').insert({ room_id: roomId, storage_path: path });
  }
  state.roomPhotosPending = [];
  await loadRoomPhotos();

  // 2. Mark room as processing
  await supabase.from('rooms').update({ status: 'processing', error_message: null }).eq('id', roomId);
  room.status = 'processing';
  renderRoomDetail();
  renderRooms();

  document.getElementById('roomAnalyzeStatus').textContent = 'Analyse en cours (tu peux passer à une autre pièce, le traitement continue en arrière-plan)...';

  // 3. Trigger backend analysis (Cloudflare Pages Function) - fire and forget,
  //    but still check the HTTP status so a 404/500 doesn't leave the room
  //    silently stuck in "processing" forever.
  try {
    const res = await fetch('/api/analyze-room', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomId, roomName: room.name }),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => res.statusText);
      await supabase.from('rooms').update({
        status: 'error',
        error_message: `Échec de déclenchement (HTTP ${res.status}) : ${errText.slice(0, 300)}`,
      }).eq('id', roomId);
      document.getElementById('roomAnalyzeStatus').textContent = `Erreur : la fonction d'analyse a répondu ${res.status}. Vérifie le déploiement Cloudflare.`;
      document.getElementById('analyzeRoomBtn').disabled = false;
      await loadRooms();
      renderRoomDetail();
      return;
    }
  } catch (err) {
    await supabase.from('rooms').update({
      status: 'error',
      error_message: 'Impossible de joindre la fonction d\'analyse : ' + err.message,
    }).eq('id', roomId);
    document.getElementById('roomAnalyzeStatus').textContent = 'Erreur réseau au déclenchement de l\'analyse.';
    document.getElementById('analyzeRoomBtn').disabled = false;
    await loadRooms();
    renderRoomDetail();
    return;
  }

  document.getElementById('roomAnalyzeStatus').textContent = 'Analyse lancée. Le statut se mettra à jour automatiquement.';
  document.getElementById('analyzeRoomBtn').disabled = false;
});

// ---- Video upload ----
document.getElementById('videoInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  document.getElementById('videoStatus').textContent = 'Upload en cours...';
  const path = `${state.currentVillaId}/${crypto.randomUUID()}-${file.name}`;
  const { error } = await supabase.storage.from('villa-videos').upload(path, file);
  if (error) { document.getElementById('videoStatus').textContent = 'Erreur : ' + error.message; return; }
  const videoUrl = `${SUPABASE_URL}/storage/v1/object/public/villa-videos/${path}`;
  await supabase.from('villas').update({ video_url: videoUrl }).eq('id', state.currentVillaId);
  document.getElementById('videoStatus').textContent = 'Vidéo enregistrée.';
  await loadVillas();
});

// ---- Report generation ----
document.getElementById('generateReportBtn').addEventListener('click', () => openModal('modalReport'));
document.getElementById('confirmGenerateReport').addEventListener('click', () => {
  closeModal('modalReport');
  generateReport();
});

function generateReport() {
  // window.open must happen synchronously within the click handler (user gesture),
  // before any await, otherwise it can get popup-blocked — especially in PWA contexts.
  const reportWindow = window.open('', '_blank');
  reportWindow.document.write('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Génération du rapport…</title></head><body style="font-family:sans-serif;padding:40px;color:#1B1B18;">Génération du rapport en cours…</body></html>');
  reportWindow.document.close();

  buildReportData().then(({ villa, rooms, roomPhotosByRoom, itemPhotosByItem }) => {
    const html = buildReportHtml(villa, rooms, roomPhotosByRoom, itemPhotosByItem);
    reportWindow.document.open();
    reportWindow.document.write(html);
    reportWindow.document.close();
  }).catch(err => {
    reportWindow.document.body.textContent = 'Erreur lors de la génération du rapport : ' + err.message;
  });
}

async function buildReportData() {
  const villa = state.villas.find(v => v.id === state.currentVillaId);
  const rooms = state.rooms;
  const roomIds = rooms.map(r => r.id);

  const [{ data: roomPhotos }, { data: itemPhotos }] = await Promise.all([
    supabase.from('room_photos').select('*').in('room_id', roomIds),
    supabase.from('item_photos').select('*').in('room_id', roomIds),
  ]);

  const roomPhotosByRoom = {};
  (roomPhotos || []).forEach(p => {
    (roomPhotosByRoom[p.room_id] ||= []).push(`${SUPABASE_URL}/storage/v1/object/public/room-photos/${p.storage_path}`);
  });

  const itemPhotosByItem = {};
  (itemPhotos || []).forEach(p => {
    (itemPhotosByItem[p.item_id] ||= []).push(`${SUPABASE_URL}/storage/v1/object/public/item-photos/${p.storage_path}`);
  });

  return { villa, rooms, roomPhotosByRoom, itemPhotosByItem };
}

function buildReportHtml(villa, rooms, roomPhotosByRoom, itemPhotosByItem) {
  const dateStr = new Date().toLocaleDateString('fr-FR', { year: 'numeric', month: 'long', day: 'numeric' });

  let roomsHtml = '';
  rooms.forEach(r => {
    const roomPhotos = roomPhotosByRoom[r.id] || [];
    const roomGallery = roomPhotos.length
      ? `<div class="photo-gallery">${roomPhotos.map(url => `<img class="report-photo" src="${url}" crossorigin="anonymous">`).join('')}</div>`
      : '';

    const itemsHtml = (r.inventory || []).map(item => {
      const extra = (item.category === 'electronic' || item.category === 'appliance')
        ? `<div class="item-extra">N° série : ${escapeHtml(item.serial_number || '—')} · Garantie : ${item.under_warranty === 'yes' ? 'Oui' : item.under_warranty === 'no' ? 'Non' : '—'}${item.warranty_end_date ? ' (jusqu\'au ' + escapeHtml(item.warranty_end_date) + ')' : ''}</div>`
        : '';
      const itemPhotos = itemPhotosByItem[item.id] || [];
      const itemGallery = itemPhotos.length
        ? `<div class="photo-gallery small">${itemPhotos.map(url => `<img class="report-photo small" src="${url}" crossorigin="anonymous">`).join('')}</div>`
        : '';
      return `
        <div class="item-row">
          <div class="item-row-main">
            <span class="item-row-name">${escapeHtml(item.item || '')}</span>
            <span class="item-row-qty">× ${escapeHtml(String(item.quantity ?? ''))}</span>
            <span class="item-row-detail">${escapeHtml(item.material || '')}${item.material && item.condition ? ' · ' : ''}${escapeHtml(item.condition || '')}</span>
          </div>
          ${item.notes ? `<div class="item-row-notes">${escapeHtml(item.notes)}</div>` : ''}
          ${extra}
          ${itemGallery}
        </div>`;
    }).join('');

    roomsHtml += `
      <section class="room-section">
        <h2>${escapeHtml(r.name)}${r.room_type ? ' — ' + escapeHtml(r.room_type) : ''}</h2>
        ${roomGallery}
        <div class="items-list">${itemsHtml || '<p class="empty">Aucun élément renseigné</p>'}</div>
      </section>`;
  });

  return `<!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Rapport d'inventaire — ${escapeHtml(villa.name)}</title>
<script src="https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"></script>
<style>
  @page { margin: 20mm 16mm; }
  body { font-family: Georgia, serif; color: #1B1B18; max-width: 800px; margin: 0 auto; padding: 24px; background: #FAF8F4; }
  .wordmark { font-size: 22px; font-weight: 700; letter-spacing: -0.01em; }
  .cover { border-bottom: 2px solid #1B1B18; padding-bottom: 16px; margin-bottom: 24px; }
  .cover h1 { font-size: 26px; margin: 10px 0 4px; }
  .cover .meta { font-family: Arial, sans-serif; font-size: 13px; color: #555; }
  .villa-facts { font-family: Arial, sans-serif; font-size: 13px; margin-top: 10px; color: #333; }
  .room-section { margin-bottom: 30px; page-break-inside: avoid; }
  .room-section h2 { font-size: 17px; border-bottom: 1px solid #ddd; padding-bottom: 4px; }
  .photo-gallery { display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0 12px; }
  .report-photo { width: 110px; height: 82px; object-fit: cover; border-radius: 4px; }
  .photo-gallery.small { margin: 6px 0 2px; }
  .report-photo.small { width: 70px; height: 52px; }
  .items-list { font-family: Arial, sans-serif; font-size: 12px; }
  .item-row { padding: 8px 0; border-bottom: 1px solid #eee; }
  .item-row-main { display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; }
  .item-row-name { font-weight: 700; font-size: 13px; }
  .item-row-qty { color: #555; }
  .item-row-detail { color: #777; }
  .item-row-notes { color: #555; margin-top: 2px; font-style: italic; }
  .item-extra { font-size: 10px; color: #999; margin-top: 3px; }
  .empty { color: #999; font-style: italic; font-family: Arial, sans-serif; font-size: 13px; }
  .no-print { position: sticky; top: 0; background: #1B1B18; padding: 10px 14px; margin: -24px -24px 24px; display: flex; justify-content: center; z-index: 10; }
  .no-print button { background: #C67C4E; color: white; border: none; padding: 10px 18px; border-radius: 8px; font-family: Arial, sans-serif; font-weight: 600; font-size: 14px; cursor: pointer; }
  .no-print button:disabled { background: #999; }
  @media print { .no-print { display: none; } body { padding: 0; background: white; } }
</style>
</head>
<body>
  <div class="no-print">
    <button id="pdfBtn" onclick="exportToPdf()">Imprimer en PDF</button>
  </div>
  <div id="report-content">
    <div class="cover">
      <div class="wordmark">all.</div>
      <h1>Rapport d'inventaire — ${escapeHtml(villa.name)}</h1>
      <div class="meta">Généré le ${dateStr}</div>
      <div class="villa-facts">
        ${villa.address ? escapeHtml(villa.address) + ' · ' : ''}${villa.bedrooms || 0} chambre(s) · ${villa.bathrooms || 0} salle(s) de bain${villa.has_pool ? ' · piscine' : ''}${villa.sea_view ? ' · vue mer' : ''}
      </div>
    </div>
    ${roomsHtml}
  </div>
  <script>
    // Real client-side PDF generation (not window.print/browser print dialog,
    // which is unreliable inside an installed PWA in standalone mode).
    async function exportToPdf() {
      const btn = document.getElementById('pdfBtn');
      btn.disabled = true;
      btn.textContent = 'Génération du PDF…';
      try {
        const { jsPDF } = window.jspdf;
        const element = document.getElementById('report-content');
        const canvas = await html2canvas(element, { scale: 2, useCORS: true, backgroundColor: '#FAF8F4' });
        const imgData = canvas.toDataURL('image/jpeg', 0.92);
        const pdf = new jsPDF('p', 'mm', 'a4');
        const pdfWidth = pdf.internal.pageSize.getWidth();
        const pageHeight = pdf.internal.pageSize.getHeight();
        const imgHeight = (canvas.height * pdfWidth) / canvas.width;
        let heightLeft = imgHeight;
        let position = 0;
        pdf.addImage(imgData, 'JPEG', 0, position, pdfWidth, imgHeight);
        heightLeft -= pageHeight;
        while (heightLeft > 0) {
          position = heightLeft - imgHeight;
          pdf.addPage();
          pdf.addImage(imgData, 'JPEG', 0, position, pdfWidth, imgHeight);
          heightLeft -= pageHeight;
        }
        pdf.save('inventaire-${escapeHtml(villa.name).replace(/[^a-zA-Z0-9]/g, '-')}.pdf');
      } catch (err) {
        alert('Erreur génération PDF : ' + err.message);
      }
      btn.disabled = false;
      btn.textContent = 'Imprimer en PDF';
    }
  <\/script>
</body></html>`;
}

// ---- Utils ----
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escapeAttr(str) { return escapeHtml(str); }
