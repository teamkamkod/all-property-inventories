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
  renderRoomDetail();
}

async function loadRoomPhotos() {
  const { data } = await supabase.from('room_photos').select('*').eq('room_id', state.currentRoomId);
  state.existingRoomPhotos = data || [];
}

function renderRoomDetail() {
  const r = state.rooms.find(x => x.id === state.currentRoomId);
  if (!r) return;
  document.getElementById('roomTitle').textContent = r.name;
  const badgeClass = `status-${r.status}`;
  const badgeLabel = { pending: 'à faire', processing: 'analyse en cours...', done: 'terminé', error: 'erreur' }[r.status] || r.status;
  const badge = document.getElementById('roomStatusBadge');
  badge.className = `status-badge ${badgeClass}`;
  badge.textContent = badgeLabel;

  // thumbs: existing uploaded photos + pending ones
  const thumbs = document.getElementById('roomThumbs');
  thumbs.innerHTML = '';
  (state.existingRoomPhotos || []).forEach(p => {
    const url = `${SUPABASE_URL}/storage/v1/object/public/room-photos/${p.storage_path}`;
    const div = document.createElement('div');
    div.className = 'thumb';
    div.innerHTML = `<img src="${url}">`;
    thumbs.appendChild(div);
  });
  state.roomPhotosPending.forEach((p, idx) => {
    const div = document.createElement('div');
    div.className = 'thumb';
    div.innerHTML = `<img src="${p.previewUrl}"><div class="remove" data-idx="${idx}">×</div>`;
    thumbs.appendChild(div);
  });
  thumbs.querySelectorAll('.remove').forEach(btn => {
    btn.addEventListener('click', () => {
      state.roomPhotosPending.splice(parseInt(btn.dataset.idx), 1);
      renderRoomDetail();
    });
  });

  document.getElementById('analyzeRoomBtn').disabled = (state.roomPhotosPending.length === 0) || r.status === 'processing';

  // inventory
  const invDiv = document.getElementById('roomInventory');
  invDiv.innerHTML = '';
  if (r.error_message) {
    invDiv.innerHTML = `<p class="muted-text" style="color:var(--error)">Erreur : ${escapeHtml(r.error_message)}</p>`;
  }
  (r.inventory || []).forEach((item, idx) => renderItemCard(invDiv, item, idx));
}

function renderItemCard(container, item, idx) {
  const div = document.createElement('div');
  div.className = 'item-card';
  const isElectronic = item.category === 'electronic' || item.category === 'appliance';
  const estBadge = item.quantity_type === 'estimate' ? '<span class="badge-estimate">estimation</span>' : '';

  div.innerHTML = `
    <div class="item-card-row">
      <input class="item-name" data-field="item" value="${escapeAttr(item.item || '')}">
    </div>
    <div class="item-card-row">
      <input class="field-small" data-field="quantity" value="${escapeAttr(item.quantity ?? '')}" placeholder="Qté">
      ${estBadge}
      <input class="field-med" data-field="material" value="${escapeAttr(item.material || '')}" placeholder="Matériau">
      <input class="field-med" data-field="condition" value="${escapeAttr(item.condition || '')}" placeholder="État">
    </div>
    <div class="item-card-row">
      <input class="field-med" data-field="notes" value="${escapeAttr(item.notes || '')}" placeholder="Notes" style="flex:1 1 100%;">
    </div>
    ${isElectronic ? `
    <div class="warranty-fields">
      <input class="field-med" data-field="serial_number" value="${escapeAttr(item.serial_number || '')}" placeholder="N° de série">
      <select class="field-small" data-field="under_warranty">
        <option value="">Garantie ?</option>
        <option value="yes" ${item.under_warranty === 'yes' ? 'selected' : ''}>Oui</option>
        <option value="no" ${item.under_warranty === 'no' ? 'selected' : ''}>Non</option>
      </select>
      <input type="date" class="field-med" data-field="warranty_end_date" value="${escapeAttr(item.warranty_end_date || '')}">
    </div>` : ''}
  `;

  div.querySelectorAll('[data-field]').forEach(input => {
    input.addEventListener('change', () => {
      const r = state.rooms.find(x => x.id === state.currentRoomId);
      r.inventory[idx][input.dataset.field] = input.value;
      saveInventory(r);
    });
  });

  container.appendChild(div);
}

let saveTimeout = null;
function saveInventory(room) {
  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(async () => {
    await supabase.from('rooms').update({ inventory: room.inventory, updated_at: new Date().toISOString() }).eq('id', room.id);
    renderCostBar();
  }, 400);
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

  // 3. Trigger backend analysis (Cloudflare Pages Function) - fire and forget
  try {
    await fetch('/api/analyze-room', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomId, roomName: room.name }),
    });
  } catch (err) {
    console.error('Trigger error', err);
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
  const villa = state.villas.find(v => v.id === state.currentVillaId);
  const rooms = state.rooms;
  const reportWindow = window.open('', '_blank');
  const html = buildReportHtml(villa, rooms);
  reportWindow.document.write(html);
  reportWindow.document.close();
}

function buildReportHtml(villa, rooms) {
  const dateStr = new Date().toLocaleDateString('fr-FR', { year: 'numeric', month: 'long', day: 'numeric' });
  let roomsHtml = '';
  rooms.forEach(r => {
    const items = (r.inventory || []).map(item => {
      const extra = (item.category === 'electronic' || item.category === 'appliance')
        ? `<div class="meta">N° série: ${escapeHtml(item.serial_number || '—')} · Garantie: ${item.under_warranty === 'yes' ? 'Oui' : item.under_warranty === 'no' ? 'Non' : '—'}${item.warranty_end_date ? ' (jusqu\'au ' + escapeHtml(item.warranty_end_date) + ')' : ''}</div>`
        : '';
      return `<tr>
        <td>${escapeHtml(item.item || '')}</td>
        <td>${escapeHtml(String(item.quantity ?? ''))}</td>
        <td>${escapeHtml(item.material || '—')}</td>
        <td>${escapeHtml(item.condition || '—')}</td>
        <td>${escapeHtml(item.notes || '—')}${extra}</td>
      </tr>`;
    }).join('');
    roomsHtml += `
      <section class="room-section">
        <h2>${escapeHtml(r.name)}${r.room_type ? ' — ' + escapeHtml(r.room_type) : ''}</h2>
        <table>
          <thead><tr><th>Élément</th><th>Qté</th><th>Matériau</th><th>État</th><th>Notes</th></tr></thead>
          <tbody>${items || '<tr><td colspan="5" class="empty">Aucun élément renseigné</td></tr>'}</tbody>
        </table>
      </section>`;
  });

  return `<!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8"><title>Rapport d'inventaire — ${escapeHtml(villa.name)}</title>
<style>
  @page { margin: 20mm 16mm; }
  body { font-family: Georgia, serif; color: #1B1B18; max-width: 800px; margin: 0 auto; padding: 24px; }
  .wordmark { font-size: 22px; font-weight: 700; letter-spacing: -0.01em; }
  .cover { border-bottom: 2px solid #1B1B18; padding-bottom: 16px; margin-bottom: 24px; }
  .cover h1 { font-size: 26px; margin: 10px 0 4px; }
  .cover .meta { font-family: Arial, sans-serif; font-size: 13px; color: #555; }
  .villa-facts { font-family: Arial, sans-serif; font-size: 13px; margin-top: 10px; color: #333; }
  .room-section { margin-bottom: 26px; page-break-inside: avoid; }
  .room-section h2 { font-size: 17px; border-bottom: 1px solid #ddd; padding-bottom: 4px; }
  table { width: 100%; border-collapse: collapse; font-family: Arial, sans-serif; font-size: 12px; }
  th { text-align: left; background: #F0ECE3; padding: 6px 8px; }
  td { padding: 6px 8px; border-bottom: 1px solid #eee; vertical-align: top; }
  td .meta { font-size: 10px; color: #777; margin-top: 3px; }
  .empty { color: #999; font-style: italic; }
  @media print { body { padding: 0; } }
</style>
</head>
<body>
  <div class="cover">
    <div class="wordmark">all.</div>
    <h1>Rapport d'inventaire — ${escapeHtml(villa.name)}</h1>
    <div class="meta">Généré le ${dateStr}</div>
    <div class="villa-facts">
      ${villa.address ? escapeHtml(villa.address) + ' · ' : ''}${villa.bedrooms || 0} chambre(s) · ${villa.bathrooms || 0} salle(s) de bain${villa.has_pool ? ' · piscine' : ''}${villa.sea_view ? ' · vue mer' : ''}
    </div>
  </div>
  ${roomsHtml}
</body></html>`;
}

// ---- Utils ----
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escapeAttr(str) { return escapeHtml(str); }
