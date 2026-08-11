import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ---- Config ----
const SUPABASE_URL = 'https://luduooplhdhnzomirnre.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx1ZHVvb3BsaGRobnpvbWlybnJlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYzODc0OTMsImV4cCI6MjEwMTk2MzQ5M30.XLjIO1VtgcZ0BYef7R0BDdW-K_NOxWGFXZK1LgrzMmM';
const APP_PASSWORD = 'ALLProperty2026';
const MAX_DIM = 1568;
const PRICE_INPUT_PER_M = 3;   // $ / 1M input tokens
const PRICE_OUTPUT_PER_M = 15; // $ / 1M output tokens
const DEFAULT_MAINTENANCE_ITEMS = [
  'Local technique piscine',
  'Boîtier à clé',
  'Local rangement matériel ménage',
  'Réassort produits salle de bain',
  'Réassort linge de maison',
];

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ---- State ----
let state = {
  villas: [],
  currentVillaId: null,
  versions: [],
  currentVersionId: null,
  isReadOnly: false,
  rooms: [],
  currentRoomId: null,
  roomPhotosPending: [],
  existingRoomPhotos: [],
  itemPhotos: [],
  photosChangedSinceAnalysis: false,
  maintenanceItems: [],
  maintenanceItemPhotos: [],
};

// ---- Password gate ----
const gate = document.getElementById('gate');
const app = document.getElementById('app');

function checkGate() {
  if (localStorage.getItem('aps_gate_ok') === '1') {
    gate.classList.add('hidden');
    app.classList.remove('hidden');
    initApp();
  }
}
document.getElementById('gateSubmit').addEventListener('click', () => {
  const val = document.getElementById('gatePassword').value;
  if (val === APP_PASSWORD) {
    localStorage.setItem('aps_gate_ok', '1');
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

// ---- Delete villa ----
document.getElementById('deleteVillaBtn').addEventListener('click', () => openModal('modalDeleteVilla'));
document.getElementById('confirmDeleteVilla').addEventListener('click', async () => {
  const btn = document.getElementById('confirmDeleteVilla');
  btn.disabled = true;
  btn.textContent = 'Suppression...';
  await deleteVillaCompletely(state.currentVillaId);
  closeModal('modalDeleteVilla');
  btn.disabled = false;
  btn.textContent = 'Supprimer';
  showView('villas');
  await loadVillas();
});

async function deleteVillaCompletely(villaId) {
  // Gather every storage object tied to this villa (across all versions) before
  // deleting DB rows, since Storage objects aren't removed by FK cascades.
  const { data: versions } = await supabase.from('inventory_versions').select('id, video_url').eq('villa_id', villaId);
  const versionIds = (versions || []).map(v => v.id);

  const { data: rooms } = versionIds.length
    ? await supabase.from('rooms').select('id').in('version_id', versionIds)
    : { data: [] };
  const roomIds = (rooms || []).map(r => r.id);

  if (roomIds.length) {
    const { data: roomPhotos } = await supabase.from('room_photos').select('storage_path').in('room_id', roomIds);
    const roomPaths = (roomPhotos || []).map(p => p.storage_path);
    if (roomPaths.length) await supabase.storage.from('room-photos').remove(roomPaths);

    const { data: itemPhotos } = await supabase.from('item_photos').select('storage_path').in('room_id', roomIds);
    const itemPaths = (itemPhotos || []).map(p => p.storage_path);
    if (itemPaths.length) await supabase.storage.from('item-photos').remove(itemPaths);
  }

  const videoPaths = (versions || [])
    .filter(v => v.video_url)
    .map(v => storagePathFromUrl(v.video_url, 'villa-videos'))
    .filter(Boolean);
  if (videoPaths.length) await supabase.storage.from('villa-videos').remove(videoPaths);

  const { data: maintItems } = await supabase.from('maintenance_items').select('id').eq('villa_id', villaId);
  const maintIds = (maintItems || []).map(m => m.id);
  if (maintIds.length) {
    const { data: maintPhotos } = await supabase.from('maintenance_item_photos').select('storage_path').in('maintenance_item_id', maintIds);
    const maintPaths = (maintPhotos || []).map(p => p.storage_path);
    if (maintPaths.length) await supabase.storage.from('maintenance-photos').remove(maintPaths);
  }

  // DB cascade handles inventory_versions -> rooms -> room_photos/item_photos,
  // and villa -> maintenance_items -> maintenance_item_photos.
  await supabase.from('villas').delete().eq('id', villaId);
}

function storagePathFromUrl(url, bucket) {
  const marker = `/storage/v1/object/public/${bucket}/`;
  const idx = url.indexOf(marker);
  return idx === -1 ? null : url.slice(idx + marker.length);
}

// ---- Open villa / version routing ----
async function openVilla(villaId) {
  state.currentVillaId = villaId;
  showView('villa');
  document.getElementById('deleteVillaBtn').classList.remove('hidden');
  await loadVersions();
  await loadRooms();
  await loadMaintenanceItems();
  subscribeRealtime(villaId);
  routeVillaOnboarding();
}

async function loadVersions() {
  const { data, error } = await supabase
    .from('inventory_versions')
    .select('*')
    .eq('villa_id', state.currentVillaId)
    .order('version_number', { ascending: false });
  if (error) { console.error(error); return; }
  state.versions = data || [];

  if (state.versions.length === 0) {
    const { data: created } = await supabase
      .from('inventory_versions')
      .insert({ villa_id: state.currentVillaId, version_number: 1, status: 'draft' })
      .select().single();
    state.versions = [created];
  }

  const draft = state.versions.find(v => v.status === 'draft');
  const active = draft || state.versions[0]; // most recent (versions sorted desc) if no draft
  state.currentVersionId = active.id;
  state.isReadOnly = active.status === 'finalized';
}

function currentVersion() {
  return state.versions.find(v => v.id === state.currentVersionId);
}

function routeVillaOnboarding() {
  const v = state.villas.find(x => x.id === state.currentVillaId);
  const version = currentVersion();
  const stepA = document.getElementById('onboardingStepA');
  const stepB = document.getElementById('onboardingStepB');
  const main = document.getElementById('villaMain');
  stepA.classList.add('hidden');
  stepB.classList.add('hidden');
  main.classList.add('hidden');

  renderVersionBar();

  if (version.rooms_confirmed || state.isReadOnly) {
    main.classList.remove('hidden');
    renderVillaMain(v);
  } else if (state.rooms.length === 0) {
    stepA.classList.remove('hidden');
    document.getElementById('obaName').value = v.name || '';
    document.getElementById('obaAddress').value = v.address || '';
    document.getElementById('obaBedrooms').value = v.bedrooms ?? 0;
    document.getElementById('obaBathrooms').value = v.bathrooms ?? 0;
    document.getElementById('obaPool').checked = !!v.has_pool;
    document.getElementById('obaSeaView').checked = !!v.sea_view;
  } else {
    stepB.classList.remove('hidden');
    renderOnboardingStepB();
  }
}

// ---- Version bar ----
function renderVersionBar() {
  const bar = document.getElementById('versionBar');
  const version = currentVersion();
  if (!version) { bar.classList.add('hidden'); return; }
  bar.classList.remove('hidden');

  const sorted = [...state.versions].sort((a, b) => b.version_number - a.version_number);
  const options = sorted.map(v =>
    `<option value="${v.id}" ${v.id === state.currentVersionId ? 'selected' : ''}>Version ${v.version_number} — ${v.status === 'finalized' ? 'finalisée' : 'brouillon'}</option>`
  ).join('');

  const latestIsFinalized = sorted[0]?.status === 'finalized';

  bar.innerHTML = `
    <select id="versionSelect">${options}</select>
    <div class="version-actions">
      ${!state.isReadOnly && version.status === 'draft' ? '<button id="finalizeVersionBtn" class="btn btn-secondary">Finaliser</button>' : ''}
      ${latestIsFinalized && version.id === sorted[0].id ? '<button id="newVersionBtn" class="btn btn-primary">+ Nouvelle version</button>' : ''}
    </div>
  `;

  document.getElementById('versionSelect').addEventListener('change', async (e) => {
    state.currentVersionId = e.target.value;
    state.isReadOnly = currentVersion().status === 'finalized';
    await loadRooms();
    routeVillaOnboarding();
  });

  const finalizeBtn = document.getElementById('finalizeVersionBtn');
  if (finalizeBtn) finalizeBtn.addEventListener('click', async () => {
    if (!confirm('Finaliser cet inventaire ? Il deviendra consultable en lecture seule et ne sera plus modifiable.')) return;
    await supabase.from('inventory_versions').update({ status: 'finalized', finalized_at: new Date().toISOString() }).eq('id', state.currentVersionId);
    await loadVersions();
    routeVillaOnboarding();
  });

  const newVersionBtn = document.getElementById('newVersionBtn');
  if (newVersionBtn) newVersionBtn.addEventListener('click', () => openModal('modalNewVersion'));
}

document.getElementById('confirmScratchVersion').addEventListener('click', async () => {
  closeModal('modalNewVersion');
  const maxNum = Math.max(...state.versions.map(v => v.version_number));
  const { data: created } = await supabase
    .from('inventory_versions')
    .insert({ villa_id: state.currentVillaId, version_number: maxNum + 1, status: 'draft', rooms_confirmed: false })
    .select().single();
  state.versions.push(created);
  state.currentVersionId = created.id;
  state.isReadOnly = false;
  await loadRooms();
  routeVillaOnboarding();
});

document.getElementById('confirmDuplicateVersion').addEventListener('click', async () => {
  closeModal('modalNewVersion');
  await duplicateCurrentVersion();
});

async function duplicateCurrentVersion() {
  const sourceVersion = currentVersion(); // the finalized version being viewed
  const maxNum = Math.max(...state.versions.map(v => v.version_number));

  const statusEl = document.getElementById('topbarTitle');
  const originalStatusText = statusEl.textContent;
  statusEl.textContent = 'Duplication en cours...';

  const { data: newVersion } = await supabase
    .from('inventory_versions')
    .insert({ villa_id: state.currentVillaId, version_number: maxNum + 1, status: 'draft', rooms_confirmed: true })
    .select().single();

  const { data: sourceRooms } = await supabase.from('rooms').select('*').eq('version_id', sourceVersion.id);

  for (const room of (sourceRooms || [])) {
    const { data: newRoom } = await supabase.from('rooms').insert({
      version_id: newVersion.id,
      villa_id: state.currentVillaId,
      name: room.name,
      status: room.status,
      room_type: room.room_type,
      photos_analyzed: room.photos_analyzed,
      inventory: [], // filled below once item ids are remapped
      input_tokens: 0,
      output_tokens: 0,
    }).select().single();

    // Remap item ids so duplicated item_photos can be relinked
    const idMap = {};
    const newInventory = (room.inventory || []).map(item => {
      const newId = crypto.randomUUID();
      idMap[item.id] = newId;
      return { ...item, id: newId };
    });
    await supabase.from('rooms').update({ inventory: newInventory }).eq('id', newRoom.id);

    const { data: photos } = await supabase.from('room_photos').select('*').eq('room_id', room.id);
    for (const p of (photos || [])) {
      const ext = p.storage_path.split('.').pop();
      const newPath = `${newRoom.id}/${crypto.randomUUID()}.${ext}`;
      await supabase.storage.from('room-photos').copy(p.storage_path, newPath);
      await supabase.from('room_photos').insert({ room_id: newRoom.id, storage_path: newPath });
    }

    const { data: itemPhotos } = await supabase.from('item_photos').select('*').eq('room_id', room.id);
    for (const p of (itemPhotos || [])) {
      const newItemId = idMap[p.item_id];
      if (!newItemId) continue;
      const ext = p.storage_path.split('.').pop();
      const newPath = `${newRoom.id}/${newItemId}/${crypto.randomUUID()}.${ext}`;
      await supabase.storage.from('item-photos').copy(p.storage_path, newPath);
      await supabase.from('item_photos').insert({ room_id: newRoom.id, item_id: newItemId, storage_path: newPath });
    }
  }

  statusEl.textContent = originalStatusText;
  await loadVersions();
  state.currentVersionId = newVersion.id;
  state.isReadOnly = false;
  await loadRooms();
  routeVillaOnboarding();
}

// ---- Onboarding Step A: villa info -> generates default rooms ----
document.getElementById('obaContinueBtn').addEventListener('click', async () => {
  const btn = document.getElementById('obaContinueBtn');
  btn.disabled = true;
  btn.textContent = 'Génération des pièces...';

  const bedrooms = parseInt(document.getElementById('obaBedrooms').value) || 0;
  const bathrooms = parseInt(document.getElementById('obaBathrooms').value) || 0;
  const payload = {
    name: document.getElementById('obaName').value.trim() || 'Villa',
    address: document.getElementById('obaAddress').value.trim(),
    bedrooms,
    bathrooms,
    has_pool: document.getElementById('obaPool').checked,
    sea_view: document.getElementById('obaSeaView').checked,
    updated_at: new Date().toISOString(),
  };
  await supabase.from('villas').update(payload).eq('id', state.currentVillaId);

  const defaultRoomNames = [];
  for (let i = 1; i <= bedrooms; i++) defaultRoomNames.push(`Chambre ${i}`);
  for (let i = 1; i <= bathrooms; i++) defaultRoomNames.push(`Salle de bain ${i}`);
  defaultRoomNames.push('Salon', 'Cuisine', 'Extérieur');

  const rows = defaultRoomNames.map(name => ({ name, villa_id: state.currentVillaId, version_id: state.currentVersionId, status: 'pending' }));
  await supabase.from('rooms').insert(rows);

  // Seed default maintenance items once per villa (not per version - maintenance isn't versioned)
  const { count } = await supabase.from('maintenance_items').select('id', { count: 'exact', head: true }).eq('villa_id', state.currentVillaId);
  if (!count) {
    await supabase.from('maintenance_items').insert(
      DEFAULT_MAINTENANCE_ITEMS.map(name => ({ villa_id: state.currentVillaId, name }))
    );
  }

  await loadVillas();
  await loadRooms();
  await loadMaintenanceItems();
  btn.disabled = false;
  btn.textContent = 'Continuer — générer les pièces';
  routeVillaOnboarding();
});

// ---- Onboarding Step B: review generated room list ----
function renderOnboardingStepB() {
  const list = document.getElementById('obbRoomList');
  list.innerHTML = '';
  state.rooms.forEach(r => {
    const row = document.createElement('div');
    row.className = 'room-review-item';
    row.innerHTML = `<input type="text" value="${escapeAttr(r.name)}" data-room-id="${r.id}"><button class="remove-room" data-room-id="${r.id}">✕</button>`;
    list.appendChild(row);
  });

  list.querySelectorAll('input[data-room-id]').forEach(input => {
    input.addEventListener('change', async () => {
      await supabase.from('rooms').update({ name: input.value.trim() }).eq('id', input.dataset.roomId);
      await loadRooms();
    });
  });
  list.querySelectorAll('.remove-room').forEach(btn => {
    btn.addEventListener('click', async () => {
      await supabase.from('rooms').delete().eq('id', btn.dataset.roomId);
      await loadRooms();
      renderOnboardingStepB();
    });
  });
}

document.getElementById('obbAddRoomBtn').addEventListener('click', async () => {
  const input = document.getElementById('obbNewRoomName');
  const name = input.value.trim();
  if (!name) return;
  await supabase.from('rooms').insert({ name, villa_id: state.currentVillaId, version_id: state.currentVersionId, status: 'pending' });
  input.value = '';
  await loadRooms();
  renderOnboardingStepB();
});

document.getElementById('obbValidateBtn').addEventListener('click', async () => {
  if (state.rooms.length === 0) { alert('Ajoute au moins une pièce avant de continuer.'); return; }
  await supabase.from('inventory_versions').update({ rooms_confirmed: true }).eq('id', state.currentVersionId);
  await loadVersions();
  routeVillaOnboarding();
});

// ---- Step C: normal villa view ----
function renderVillaMain(v) {
  document.getElementById('villaName').value = v.name || '';
  document.getElementById('villaAddress').value = v.address || '';
  document.getElementById('villaBedrooms').value = v.bedrooms ?? '';
  document.getElementById('villaBathrooms').value = v.bathrooms ?? '';
  document.getElementById('villaPool').checked = !!v.has_pool;
  document.getElementById('villaSeaView').checked = !!v.sea_view;
  document.getElementById('villaInfoSummary').textContent = `— ${v.name}`;

  const version = currentVersion();
  const videoStatus = document.getElementById('videoStatus');
  const deleteVideoBtn = document.getElementById('deleteVideoBtn');
  if (version.video_url) {
    videoStatus.textContent = 'Vidéo enregistrée pour cette version.';
    deleteVideoBtn.classList.remove('hidden');
  } else {
    videoStatus.textContent = '';
    deleteVideoBtn.classList.add('hidden');
  }

  const readonlyContainer = document.getElementById('villaMain');
  let banner = document.getElementById('readonlyBanner');
  if (state.isReadOnly) {
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'readonlyBanner';
      banner.className = 'readonly-banner';
      banner.textContent = '🔒 Version finalisée — lecture seule';
      readonlyContainer.prepend(banner);
    }
  } else if (banner) {
    banner.remove();
  }

  renderRooms();
  renderCostBar();
  renderProgressBar();
  renderMaintenanceList();
}

function renderProgressBar() {
  const total = state.rooms.length;
  const done = state.rooms.filter(r => r.status === 'done').length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  document.getElementById('progressLabel').textContent = `${done} / ${total} pièces scannées`;
  document.getElementById('progressFill').style.width = `${pct}%`;
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
        renderProgressBar();
        if (state.currentRoomId === payload.new.id && !views.room.classList.contains('hidden')) {
          renderRoomDetail();
        }
      })
    .subscribe();
}

// ---- Rooms (scoped to current version) ----
async function loadRooms() {
  const { data, error } = await supabase.from('rooms').select('*').eq('version_id', state.currentVersionId).order('created_at');
  if (error) { console.error(error); return; }
  state.rooms = data;
  const version = currentVersion();
  if (version && (version.rooms_confirmed || state.isReadOnly)) {
    renderRooms();
    renderCostBar();
    renderProgressBar();
  }
}

function renderCostBar() {
  const totalIn = state.rooms.reduce((s, r) => s + (r.input_tokens || 0), 0);
  const totalOut = state.rooms.reduce((s, r) => s + (r.output_tokens || 0), 0);
  const cost = (totalIn / 1e6) * PRICE_INPUT_PER_M + (totalOut / 1e6) * PRICE_OUTPUT_PER_M;
  document.getElementById('costBar').textContent =
    `Consommation version : ${totalIn.toLocaleString('fr-FR')} tokens in · ${totalOut.toLocaleString('fr-FR')} tokens out — coût estimé $${cost.toFixed(3)}`;
}

function renderRooms() {
  const grid = document.getElementById('roomsGrid');
  grid.innerHTML = '';
  state.rooms.forEach(r => {
    const card = document.createElement('div');
    card.className = 'card';
    const badgeClass = `status-${r.status}`;
    const badgeLabel = { pending: 'à faire', processing: 'analyse...', done: 'terminé', error: 'erreur' }[r.status] || r.status;
    const itemCount = (r.inventory || []).length;
    card.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:flex-start;">
        <div class="card-title">${escapeHtml(r.name)}</div>
        ${!state.isReadOnly ? `<div class="room-card-actions">
          <button class="icon-btn" data-duplicate-room="${r.id}" title="Dupliquer">⧉</button>
          <button class="icon-btn" data-delete-room="${r.id}" title="Supprimer">🗑</button>
        </div>` : ''}
      </div>
      <span class="status-badge ${badgeClass}">${badgeLabel}</span>
      <div class="card-sub">${itemCount} élément${itemCount > 1 ? 's' : ''}${r.room_type ? ' · ' + escapeHtml(r.room_type) : ''}</div>`;
    card.addEventListener('click', (e) => {
      if (e.target.closest('[data-duplicate-room]') || e.target.closest('[data-delete-room]')) return;
      openRoom(r.id);
    });
    grid.appendChild(card);
  });

  grid.querySelectorAll('[data-delete-room]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      state.pendingDeleteRoomId = btn.dataset.deleteRoom;
      openModal('modalDeleteRoom');
    });
  });
  grid.querySelectorAll('[data-duplicate-room]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      state.pendingDuplicateRoomId = btn.dataset.duplicateRoom;
      openModal('modalDuplicateRoom');
    });
  });

  if (!state.isReadOnly) {
    const addCard = document.createElement('div');
    addCard.className = 'card card-add';
    addCard.textContent = '+ Ajouter une pièce';
    addCard.addEventListener('click', () => openModal('modalAddRoom'));
    grid.appendChild(addCard);
  }
}

document.getElementById('confirmDeleteRoom').addEventListener('click', async () => {
  const roomId = state.pendingDeleteRoomId;
  if (!roomId) return;
  const btn = document.getElementById('confirmDeleteRoom');
  btn.disabled = true;

  const { data: photos } = await supabase.from('room_photos').select('storage_path').eq('room_id', roomId);
  const roomPaths = (photos || []).map(p => p.storage_path);
  if (roomPaths.length) await supabase.storage.from('room-photos').remove(roomPaths);

  const { data: iPhotos } = await supabase.from('item_photos').select('storage_path').eq('room_id', roomId);
  const itemPaths = (iPhotos || []).map(p => p.storage_path);
  if (itemPaths.length) await supabase.storage.from('item-photos').remove(itemPaths);

  await supabase.from('rooms').delete().eq('id', roomId);

  btn.disabled = false;
  closeModal('modalDeleteRoom');
  await loadRooms();
  routeVillaOnboarding();
});

document.getElementById('confirmDuplicateRoom').addEventListener('click', async () => {
  const roomId = state.pendingDuplicateRoomId;
  if (!roomId) return;
  const original = state.rooms.find(r => r.id === roomId);
  if (!original) return;

  const newInventory = (original.inventory || []).map(item => ({ ...item, id: crypto.randomUUID(), source: 'manual' }));
  await supabase.from('rooms').insert({
    name: `${original.name} (copie)`,
    villa_id: state.currentVillaId,
    version_id: state.currentVersionId,
    status: 'pending',
    inventory: newInventory,
  });

  closeModal('modalDuplicateRoom');
  await loadRooms();
  routeVillaOnboarding();
});

document.getElementById('confirmAddRoom').addEventListener('click', async () => {
  const name = document.getElementById('newRoomName').value.trim();
  if (!name) return;
  const { data, error } = await supabase.from('rooms').insert({ name, villa_id: state.currentVillaId, version_id: state.currentVersionId, status: 'pending' }).select().single();
  if (error) { alert('Erreur : ' + error.message); return; }
  document.getElementById('newRoomName').value = '';
  closeModal('modalAddRoom');
  await loadRooms();
  openRoom(data.id);
});

async function openRoom(roomId) {
  state.currentRoomId = roomId;
  state.roomPhotosPending = [];
  state.photosChangedSinceAnalysis = false;
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

  const photoInputRow = document.querySelector('label[for="roomPhotoInput"]');
  const analyzeBtn = document.getElementById('analyzeRoomBtn');

  if (state.isReadOnly) {
    photoInputRow.classList.add('hidden');
    analyzeBtn.classList.add('hidden');
    document.getElementById('analyzeHelperText').textContent = '';
    document.getElementById('roomAnalyzeStatus').textContent = '';
  } else {
    photoInputRow.classList.remove('hidden');
    analyzeBtn.classList.remove('hidden');
  }

  // thumbs: existing uploaded photos (deletable unless read-only) + pending ones
  const thumbs = document.getElementById('roomThumbs');
  thumbs.innerHTML = '';
  (state.existingRoomPhotos || []).forEach(p => {
    const url = `${SUPABASE_URL}/storage/v1/object/public/room-photos/${p.storage_path}`;
    const div = document.createElement('div');
    div.className = 'thumb';
    div.innerHTML = `<img src="${url}">${!state.isReadOnly ? `<div class="remove" data-existing-id="${p.id}" data-existing-path="${escapeAttr(p.storage_path)}">×</div>` : ''}`;
    thumbs.appendChild(div);
  });
  if (!state.isReadOnly) {
    state.roomPhotosPending.forEach((p, idx) => {
      const div = document.createElement('div');
      div.className = 'thumb';
      div.innerHTML = `<img src="${p.previewUrl}"><div class="remove" data-idx="${idx}">×</div>`;
      thumbs.appendChild(div);
    });
  }
  thumbs.querySelectorAll('.remove[data-idx]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.roomPhotosPending.splice(parseInt(btn.dataset.idx), 1);
      state.photosChangedSinceAnalysis = true;
      renderRoomDetail();
    });
  });
  thumbs.querySelectorAll('.remove[data-existing-id]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Supprimer cette photo ?')) return;
      await supabase.storage.from('room-photos').remove([btn.dataset.existingPath]);
      await supabase.from('room_photos').delete().eq('id', btn.dataset.existingId);
      state.photosChangedSinceAnalysis = true;
      await loadRoomPhotos();
      renderRoomDetail();
    });
  });

  if (!state.isReadOnly) {
    const noPhotos = state.roomPhotosPending.length === 0 && (state.existingRoomPhotos || []).length === 0;
    const alreadyAnalyzedAndUnchanged = r.status === 'done' && !state.photosChangedSinceAnalysis;
    analyzeBtn.disabled = noPhotos || r.status === 'processing' || alreadyAnalyzedAndUnchanged;
    document.getElementById('analyzeHelperText').textContent = alreadyAnalyzedAndUnchanged
      ? 'Analyse déjà effectuée. Ajoute ou retire une photo pour pouvoir relancer une analyse.'
      : '';
  }

  // inventory
  const invDiv = document.getElementById('roomInventory');
  invDiv.innerHTML = '';
  if (r.error_message) {
    invDiv.innerHTML = `<p class="muted-text" style="color:var(--error)">Erreur : ${escapeHtml(r.error_message)}</p>`;
  }
  if (!r.inventory) r.inventory = [];
  r.inventory.forEach((item) => renderItemCard(invDiv, item, r));

  if (!state.isReadOnly) {
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
}

function renderItemCard(container, item, room) {
  const div = document.createElement('div');
  div.className = 'item-card';
  const isElectronic = item.category === 'electronic' || item.category === 'appliance';
  const estBadge = item.quantity_type === 'estimate' ? '<span class="badge-estimate">estimation</span>' : '';
  const conditionOptions = ['', 'Neuf', 'Bon état', 'Usé', 'Vétuste'];
  const photos = (state.itemPhotos || []).filter(p => p.item_id === item.id);
  const ro = state.isReadOnly;
  const dis = ro ? 'disabled' : '';

  div.innerHTML = `
    <div class="item-card-row" style="justify-content:space-between; align-items:flex-start;">
      <div style="flex:1;">
        <label class="field-label">Élément</label>
        <input class="item-name" data-field="item" value="${escapeAttr(item.item || '')}" placeholder="Nom de l'élément" ${dis}>
      </div>
      ${!ro ? '<button class="btn-delete-item" title="Supprimer cet élément" data-delete-item>🗑</button>' : ''}
    </div>
    <div class="item-card-row">
      <div class="field-small">
        <label class="field-label">Qté ${estBadge}</label>
        <input class="field-small" data-field="quantity" value="${escapeAttr(item.quantity ?? '')}" ${dis}>
      </div>
      <div class="field-med">
        <label class="field-label">Matériau</label>
        <input class="field-med" data-field="material" value="${escapeAttr(item.material || '')}" ${dis}>
      </div>
      <div class="field-med">
        <label class="field-label">État</label>
        <select class="field-med" data-field="condition" ${dis}>
          ${conditionOptions.map(opt => `<option value="${opt}" ${item.condition === opt ? 'selected' : ''}>${opt || '—'}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="item-card-row">
      <div style="flex:1 1 100%;">
        <label class="field-label">Notes</label>
        <input class="field-med" data-field="notes" value="${escapeAttr(item.notes || '')}" style="width:100%;" ${dis}>
      </div>
    </div>
    ${isElectronic ? `
    <div class="warranty-fields">
      <div class="field-med">
        <label class="field-label">N° de série</label>
        <input class="field-med" data-field="serial_number" value="${escapeAttr(item.serial_number || '')}" ${dis}>
      </div>
      <div class="field-small">
        <label class="field-label">Sous garantie</label>
        <select class="field-small" data-field="under_warranty" ${dis}>
          <option value="">—</option>
          <option value="yes" ${item.under_warranty === 'yes' ? 'selected' : ''}>Oui</option>
          <option value="no" ${item.under_warranty === 'no' ? 'selected' : ''}>Non</option>
        </select>
      </div>
      <div class="field-med">
        <label class="field-label">Fin garantie</label>
        <input type="date" class="field-med" data-field="warranty_end_date" value="${escapeAttr(item.warranty_end_date || '')}" ${dis}>
      </div>
    </div>` : ''}
    <div class="item-photos-section">
      <label class="field-label">Photos détaillées de cet élément</label>
      <div class="thumbs item-photo-thumbs"></div>
      ${!ro ? '<input type="file" accept="image/*" capture="environment" multiple class="item-photo-input">' : ''}
    </div>
  `;

  if (!ro) {
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
      const relatedPhotos = (state.itemPhotos || []).filter(p => p.item_id === item.id);
      for (const p of relatedPhotos) {
        await supabase.storage.from('item-photos').remove([p.storage_path]);
        await supabase.from('item_photos').delete().eq('id', p.id);
      }
      await loadItemPhotos();
      renderRoomDetail();
    });
  }

  const subThumbs = div.querySelector('.item-photo-thumbs');
  photos.forEach(p => {
    const url = `${SUPABASE_URL}/storage/v1/object/public/item-photos/${p.storage_path}`;
    const t = document.createElement('div');
    t.className = 'thumb';
    t.innerHTML = `<img src="${url}">${!ro ? `<div class="remove" data-photo-id="${p.id}" data-photo-path="${escapeAttr(p.storage_path)}">×</div>` : ''}`;
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

  if (!ro) {
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
  }

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
  state.photosChangedSinceAnalysis = true;
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
  const hasExistingPhotos = (state.existingRoomPhotos || []).length > 0;
  if (photosToUpload.length === 0 && !hasExistingPhotos) return;

  document.getElementById('analyzeRoomBtn').disabled = true;

  if (photosToUpload.length > 0) {
    document.getElementById('roomAnalyzeStatus').textContent = 'Upload des photos...';
    for (const p of photosToUpload) {
      const path = `${roomId}/${crypto.randomUUID()}.jpg`;
      const blob = await (await fetch(p.previewUrl)).blob();
      const { error: upErr } = await supabase.storage.from('room-photos').upload(path, blob, { contentType: 'image/jpeg' });
      if (upErr) { document.getElementById('roomAnalyzeStatus').textContent = 'Erreur upload : ' + upErr.message; document.getElementById('analyzeRoomBtn').disabled = false; return; }
      await supabase.from('room_photos').insert({ room_id: roomId, storage_path: path });
    }
    state.roomPhotosPending = [];
    await loadRoomPhotos();
  }

  await supabase.from('rooms').update({ status: 'processing', error_message: null }).eq('id', roomId);
  room.status = 'processing';
  renderRoomDetail();
  renderRooms();

  document.getElementById('roomAnalyzeStatus').textContent = 'Analyse en cours (tu peux passer à une autre pièce, le traitement continue en arrière-plan)...';

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

  state.photosChangedSinceAnalysis = false;
  document.getElementById('roomAnalyzeStatus').textContent = 'Analyse lancée. Le statut se mettra à jour automatiquement.';
  document.getElementById('analyzeRoomBtn').disabled = false;
});

// ---- Video (per version) ----
document.getElementById('videoInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  document.getElementById('videoStatus').textContent = 'Upload en cours...';
  const path = `${state.currentVillaId}/${state.currentVersionId}/${crypto.randomUUID()}-${file.name}`;
  const { error } = await supabase.storage.from('villa-videos').upload(path, file);
  if (error) { document.getElementById('videoStatus').textContent = 'Erreur : ' + error.message; return; }
  const videoUrl = `${SUPABASE_URL}/storage/v1/object/public/villa-videos/${path}`;
  await supabase.from('inventory_versions').update({ video_url: videoUrl }).eq('id', state.currentVersionId);
  await loadVersions();
  renderVillaMain(state.villas.find(v => v.id === state.currentVillaId));
});

document.getElementById('deleteVideoBtn').addEventListener('click', async () => {
  if (!confirm('Supprimer la vidéo de cette version ?')) return;
  const version = currentVersion();
  const path = storagePathFromUrl(version.video_url, 'villa-videos');
  if (path) await supabase.storage.from('villa-videos').remove([path]);
  await supabase.from('inventory_versions').update({ video_url: null }).eq('id', state.currentVersionId);
  await loadVersions();
  renderVillaMain(state.villas.find(v => v.id === state.currentVillaId));
});

// ---- Maintenance (villa-level, not versioned) ----
async function loadMaintenanceItems() {
  const { data: items } = await supabase.from('maintenance_items').select('*').eq('villa_id', state.currentVillaId).order('created_at');
  state.maintenanceItems = items || [];
  const ids = state.maintenanceItems.map(i => i.id);
  if (ids.length) {
    const { data: photos } = await supabase.from('maintenance_item_photos').select('*').in('maintenance_item_id', ids);
    state.maintenanceItemPhotos = photos || [];
  } else {
    state.maintenanceItemPhotos = [];
  }
}

function renderMaintenanceList() {
  const countEl = document.getElementById('maintenanceCount');
  countEl.textContent = state.maintenanceItems.length ? `(${state.maintenanceItems.length})` : '';

  const list = document.getElementById('maintenanceList');
  list.innerHTML = '';
  state.maintenanceItems.forEach(item => {
    const photos = state.maintenanceItemPhotos.filter(p => p.maintenance_item_id === item.id);
    const row = document.createElement('div');
    row.className = 'item-card';
    row.innerHTML = `
      <div class="item-card-row" style="justify-content:space-between; align-items:flex-start;">
        <div style="flex:1;">
          <label class="field-label">Nom</label>
          <input class="item-name" data-maint-field="name" value="${escapeAttr(item.name || '')}">
        </div>
        <button class="btn-delete-item" title="Supprimer" data-delete-maint="${item.id}">🗑</button>
      </div>
      <div class="item-card-row">
        <div style="flex:1 1 100%;">
          <label class="field-label">Description</label>
          <input class="field-med" data-maint-field="description" value="${escapeAttr(item.description || '')}" style="width:100%;" placeholder="Ex : code 4821, à gauche du portail">
        </div>
      </div>
      <div class="item-photos-section">
        <label class="field-label">Photos</label>
        <div class="thumbs maint-photo-thumbs"></div>
        <input type="file" accept="image/*" capture="environment" multiple class="maint-photo-input">
      </div>
    `;

    row.querySelectorAll('[data-maint-field]').forEach(input => {
      input.addEventListener('change', async () => {
        await supabase.from('maintenance_items').update({ [input.dataset.maintField]: input.value, updated_at: new Date().toISOString() }).eq('id', item.id);
      });
    });

    row.querySelector('[data-delete-maint]').addEventListener('click', async () => {
      if (!confirm(`Supprimer "${item.name}" ?`)) return;
      for (const p of photos) {
        await supabase.storage.from('maintenance-photos').remove([p.storage_path]);
      }
      await supabase.from('maintenance_items').delete().eq('id', item.id);
      await loadMaintenanceItems();
      renderMaintenanceList();
    });

    const subThumbs = row.querySelector('.maint-photo-thumbs');
    photos.forEach(p => {
      const url = `${SUPABASE_URL}/storage/v1/object/public/maintenance-photos/${p.storage_path}`;
      const t = document.createElement('div');
      t.className = 'thumb';
      t.innerHTML = `<img src="${url}"><div class="remove" data-photo-id="${p.id}" data-photo-path="${escapeAttr(p.storage_path)}">×</div>`;
      subThumbs.appendChild(t);
    });
    subThumbs.querySelectorAll('.remove').forEach(btn => {
      btn.addEventListener('click', async () => {
        await supabase.storage.from('maintenance-photos').remove([btn.dataset.photoPath]);
        await supabase.from('maintenance_item_photos').delete().eq('id', btn.dataset.photoId);
        await loadMaintenanceItems();
        renderMaintenanceList();
      });
    });

    row.querySelector('.maint-photo-input').addEventListener('change', async (e) => {
      const files = Array.from(e.target.files);
      for (const file of files) {
        const resized = await resizeImage(file);
        const blob = await (await fetch(resized.previewUrl)).blob();
        const path = `${item.id}/${crypto.randomUUID()}.jpg`;
        const { error } = await supabase.storage.from('maintenance-photos').upload(path, blob, { contentType: 'image/jpeg' });
        if (error) { alert('Erreur upload photo : ' + error.message); continue; }
        await supabase.from('maintenance_item_photos').insert({ maintenance_item_id: item.id, storage_path: path });
      }
      await loadMaintenanceItems();
      renderMaintenanceList();
    });

    list.appendChild(row);
  });
}

document.getElementById('addMaintenanceBtn').addEventListener('click', async () => {
  const input = document.getElementById('newMaintenanceName');
  const name = input.value.trim();
  if (!name) return;
  await supabase.from('maintenance_items').insert({ villa_id: state.currentVillaId, name });
  input.value = '';
  await loadMaintenanceItems();
  renderMaintenanceList();
});

// ---- Export XLSX ----
document.getElementById('exportXlsxBtn').addEventListener('click', async () => {
  const villa = state.villas.find(v => v.id === state.currentVillaId);
  const rows = [];
  state.rooms.forEach(r => {
    (r.inventory || []).forEach(item => {
      rows.push({
        'Pièce': r.name,
        'Élément': item.item || '',
        'Catégorie': item.category || '',
        'Quantité': item.quantity ?? '',
        'Matériau': item.material || '',
        'État': item.condition || '',
        'Notes': item.notes || '',
        'N° série': item.serial_number || '',
        'Garantie': item.under_warranty === 'yes' ? 'Oui' : item.under_warranty === 'no' ? 'Non' : '',
        'Fin garantie': item.warranty_end_date || '',
        'Source': item.source === 'manual' ? 'Manuel' : 'IA',
      });
    });
  });

  const wb = XLSX.utils.book_new();

  if (rows.length > 0) {
    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = [
      { wch: 16 }, { wch: 24 }, { wch: 12 }, { wch: 8 }, { wch: 14 },
      { wch: 12 }, { wch: 28 }, { wch: 14 }, { wch: 9 }, { wch: 12 }, { wch: 8 },
    ];
    XLSX.utils.book_append_sheet(wb, ws, 'Inventaire');
  }

  if (state.maintenanceItems.length > 0) {
    const maintRows = state.maintenanceItems.map(m => ({ 'Nom': m.name, 'Description': m.description || '' }));
    const wsMaint = XLSX.utils.json_to_sheet(maintRows);
    wsMaint['!cols'] = [{ wch: 28 }, { wch: 50 }];
    XLSX.utils.book_append_sheet(wb, wsMaint, 'Maintenance');
  }

  if (rows.length === 0 && state.maintenanceItems.length === 0) { alert('Rien à exporter pour le moment.'); return; }

  const filename = `inventaire-${(villa.name || 'villa').replace(/[^a-zA-Z0-9]/g, '-')}.xlsx`;
  XLSX.writeFile(wb, filename);
});

// ---- Report generation ----
document.getElementById('generateReportBtn').addEventListener('click', () => openModal('modalReport'));
document.getElementById('confirmGenerateReport').addEventListener('click', () => {
  closeModal('modalReport');
  generateReport();
});

function generateReport() {
  const reportWindow = window.open('', '_blank');
  reportWindow.document.write('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Génération du rapport…</title></head><body style="font-family:sans-serif;padding:40px;color:#1E3B2F;">Génération du rapport en cours…</body></html>');
  reportWindow.document.close();

  buildReportData().then(({ villa, version, rooms, roomPhotosByRoom, itemPhotosByItem, maintenanceItems, maintenancePhotosByItem }) => {
    const html = buildReportHtml(villa, version, rooms, roomPhotosByRoom, itemPhotosByItem, maintenanceItems, maintenancePhotosByItem);
    reportWindow.document.open();
    reportWindow.document.write(html);
    reportWindow.document.close();
  }).catch(err => {
    reportWindow.document.body.textContent = 'Erreur lors de la génération du rapport : ' + err.message;
  });
}

async function buildReportData() {
  const villa = state.villas.find(v => v.id === state.currentVillaId);
  const version = currentVersion();
  const rooms = state.rooms;
  const roomIds = rooms.map(r => r.id);

  const [{ data: roomPhotos }, { data: itemPhotos }] = await Promise.all([
    roomIds.length ? supabase.from('room_photos').select('*').in('room_id', roomIds) : Promise.resolve({ data: [] }),
    roomIds.length ? supabase.from('item_photos').select('*').in('room_id', roomIds) : Promise.resolve({ data: [] }),
  ]);

  const roomPhotosByRoom = {};
  (roomPhotos || []).forEach(p => {
    (roomPhotosByRoom[p.room_id] ||= []).push(`${SUPABASE_URL}/storage/v1/object/public/room-photos/${p.storage_path}`);
  });

  const itemPhotosByItem = {};
  (itemPhotos || []).forEach(p => {
    (itemPhotosByItem[p.item_id] ||= []).push(`${SUPABASE_URL}/storage/v1/object/public/item-photos/${p.storage_path}`);
  });

  const maintenanceItems = state.maintenanceItems;
  const maintIds = maintenanceItems.map(m => m.id);
  const { data: maintPhotos } = maintIds.length
    ? await supabase.from('maintenance_item_photos').select('*').in('maintenance_item_id', maintIds)
    : { data: [] };
  const maintenancePhotosByItem = {};
  (maintPhotos || []).forEach(p => {
    (maintenancePhotosByItem[p.maintenance_item_id] ||= []).push(`${SUPABASE_URL}/storage/v1/object/public/maintenance-photos/${p.storage_path}`);
  });

  return { villa, version, rooms, roomPhotosByRoom, itemPhotosByItem, maintenanceItems, maintenancePhotosByItem };
}

function buildReportHtml(villa, version, rooms, roomPhotosByRoom, itemPhotosByItem, maintenanceItems, maintenancePhotosByItem) {
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

  const maintenanceHtml = maintenanceItems.length ? `
    <section class="room-section">
      <h2>Maintenance & accès</h2>
      <div class="items-list">
        ${maintenanceItems.map(m => {
          const photos = maintenancePhotosByItem[m.id] || [];
          const gallery = photos.length
            ? `<div class="photo-gallery">${photos.map(url => `<img class="report-photo" src="${url}" crossorigin="anonymous">`).join('')}</div>`
            : '';
          return `<div class="item-row">
            <div class="item-row-main"><span class="item-row-name">${escapeHtml(m.name)}</span></div>
            ${m.description ? `<div class="item-row-notes">${escapeHtml(m.description)}</div>` : ''}
            ${gallery}
          </div>`;
        }).join('')}
      </div>
    </section>` : '';

  return `<!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Rapport d'inventaire — ${escapeHtml(villa.name)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<script src="https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"></script>
<style>
  @page { margin: 20mm 16mm; }
  body { font-family: 'Inter', Arial, sans-serif; color: #1E3B2F; max-width: 800px; margin: 0 auto; padding: 24px; background: #F3EDDF; }
  .wordmark { font-family: 'Fraunces', Georgia, serif; font-size: 24px; font-weight: 600; letter-spacing: -0.01em; color: #1E3B2F; }
  .wordmark::after { content: ''; display: inline-block; width: 5px; height: 5px; border-radius: 50%; background: #F0A868; margin-left: 3px; vertical-align: middle; transform: translateY(-2px); }
  .cover { border-bottom: 2px solid #1E3B2F; padding-bottom: 18px; margin-bottom: 28px; }
  .cover h1 { font-family: 'Fraunces', Georgia, serif; font-weight: 500; font-size: 25px; margin: 14px 0 6px; }
  .cover .meta { font-size: 13px; color: #5A7362; }
  .villa-facts { font-size: 13px; margin-top: 10px; color: #4A5C50; }
  .video-link { display: inline-flex; align-items: center; gap: 6px; margin-top: 14px; padding: 10px 20px; background: #F0A868; color: #3A2410; text-decoration: none; border-radius: 100px; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; }
  .room-section { margin-bottom: 30px; page-break-inside: avoid; }
  .room-section h2 { font-family: 'Fraunces', Georgia, serif; font-weight: 500; font-size: 18px; border-bottom: 1px solid #E4DECB; padding-bottom: 5px; color: #1E3B2F; }
  .photo-gallery { display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0 12px; }
  .report-photo { width: 110px; height: 82px; object-fit: cover; border-radius: 6px; }
  .photo-gallery.small { margin: 6px 0 2px; }
  .report-photo.small { width: 70px; height: 52px; border-radius: 4px; }
  .items-list { font-size: 12px; }
  .item-row { padding: 9px 0; border-bottom: 1px solid #E4DECB; }
  .item-row-main { display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; }
  .item-row-name { font-weight: 700; font-size: 13px; }
  .item-row-qty { color: #5A7362; }
  .item-row-detail { color: #7A8A7E; }
  .item-row-notes { color: #4A5C50; margin-top: 2px; font-style: italic; }
  .item-extra { font-size: 10px; color: #9CA89F; margin-top: 3px; }
  .empty { color: #9CA89F; font-style: italic; font-size: 13px; }
  .no-print { position: sticky; top: 0; background: #1E3B2F; padding: 12px 14px; margin: -24px -24px 24px; display: flex; justify-content: center; gap: 10px; z-index: 10; }
  .no-print button { background: #F0A868; color: #3A2410; border: none; padding: 12px 24px; border-radius: 100px; font-family: 'Inter', Arial, sans-serif; font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; cursor: pointer; transition: background 0.15s ease; }
  .no-print button:hover { background: #EDBA85; }
  .no-print button:disabled { background: #999; color: white; }
  .no-print .btn-back { background: transparent; border: 1px solid #5A7362; color: #F3EDDF; }
  .no-print .btn-back:hover { background: rgba(255,255,255,0.08); }
  @media print { .no-print { display: none; } body { padding: 0; background: white; } }
</style>
</head>
<body>
  <div class="no-print">
    <button id="backBtn" onclick="window.close()" class="btn-back">← Retour</button>
    <button id="pdfBtn" onclick="exportToPdf()">Imprimer en PDF</button>
  </div>
  <div id="report-content">
    <div class="cover">
      <div class="wordmark">all.</div>
      <h1>Rapport d'inventaire — ${escapeHtml(villa.name)}</h1>
      <div class="meta">Version ${version.version_number} · Généré le ${dateStr}</div>
      <div class="villa-facts">
        ${villa.address ? escapeHtml(villa.address) + ' · ' : ''}${villa.bedrooms || 0} chambre(s) · ${villa.bathrooms || 0} salle(s) de bain${villa.has_pool ? ' · piscine' : ''}${villa.sea_view ? ' · vue mer' : ''}
      </div>
      ${version.video_url ? `<a class="video-link" href="${version.video_url}" target="_blank" rel="noopener">▶ Voir la vidéo</a>` : ''}
    </div>
    ${roomsHtml}
    ${maintenanceHtml}
  </div>
  <script>
    async function exportToPdf() {
      const btn = document.getElementById('pdfBtn');
      btn.disabled = true;
      btn.textContent = 'Génération du PDF…';
      try {
        const { jsPDF } = window.jspdf;
        const element = document.getElementById('report-content');
        const canvas = await html2canvas(element, { scale: 2, useCORS: true, backgroundColor: '#F3EDDF' });
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
