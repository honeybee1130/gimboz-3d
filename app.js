(() => {
  const BASE = 'https://storage.googleapis.com/gimboz-public/AjhoiwlksdnERUB';
  const CONTRACT = '0x81C9ce55E8214Fd0f5181FD3D38f52fD8c33Ec38';
  const MIN = 1, MAX = 4443;
  const LS_KEY = 'gimboz-3d-recent';

  const $ = (id) => document.getElementById(id);
  const form = $('form'), input = $('tokenId'), status = $('status'), result = $('result');
  const viewer = $('viewer'), pbarFill = $('pbarFill');
  let current = null;          // { id, json, urls }
  let abort = null;

  const urlsFor = (id) => ({
    json: `${BASE}/token/${id}.json`,
    glb: `${BASE}/3d/glb/${id}.glb`,
    mml: `${BASE}/3d/mml/${id}.mml`,
    pfp: `${BASE}/3d/pfp/${id}.png`,
  });
  const mmlTag = (glb) => `<m-character src="${glb}"></m-character>`;
  const fmtMB = (b) => (b / 1048576).toFixed(1) + ' MB';

  function setStatus(msg, err = false) {
    status.textContent = msg; status.classList.toggle('err', !!err);
  }
  let toastT;
  function toast(msg) {
    let t = document.querySelector('.toast');
    if (!t) { t = document.createElement('div'); t.className = 'toast'; document.body.appendChild(t); }
    t.textContent = msg; t.classList.add('on');
    clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 1600);
  }
  async function copy(text, label) {
    try { await navigator.clipboard.writeText(text); toast(label + ' copied'); }
    catch { window.prompt('Copy this:', text); }
  }

  // ----- recent ids -----
  function getRecent() { try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]'); } catch { return []; } }
  function pushRecent(id) {
    try {
      const r = [id, ...getRecent().filter((x) => x !== id)].slice(0, 8);
      localStorage.setItem(LS_KEY, JSON.stringify(r)); renderRecent();
    } catch {}
  }
  function renderRecent() {
    const r = getRecent(); const box = $('recent');
    box.innerHTML = ''; box.hidden = r.length === 0;
    r.forEach((id) => {
      const b = document.createElement('button'); b.type = 'button'; b.textContent = '#' + id;
      b.addEventListener('click', () => { input.value = id; pull(id); });
      box.appendChild(b);
    });
  }

  // ----- main pull -----
  async function pull(id) {
    id = parseInt(id, 10);
    if (!Number.isInteger(id) || id < MIN || id > MAX) { setStatus(`Token IDs run ${MIN} to ${MAX}.`, true); return; }
    if (abort) abort.abort();
    abort = new AbortController();
    const urls = urlsFor(id);
    $('pullBtn').disabled = true;
    setStatus(`pulling tokenURI(${id}) …`);
    try {
      const res = await fetch(urls.json, { signal: abort.signal });
      if (res.status === 404) throw new Error(`No metadata for #${id}.`);
      if (!res.ok) throw new Error(`Metadata fetch failed (${res.status}).`);
      const text = (await res.text()).replace(/^﻿/, '');   // bucket files carry a BOM
      const json = JSON.parse(text);
      current = { id, json, urls: { ...urls, glb: json.glb || urls.glb, mml: json.mml || urls.mml, pfp: json.image || urls.pfp } };
      render(current);
      history.replaceState(null, '', `?id=${id}`);
      pushRecent(id);
      setStatus(`#${id} loaded`);
      // size, non-blocking
      fetch(current.urls.glb, { method: 'HEAD', signal: abort.signal })
        .then((h) => { const n = +h.headers.get('content-length'); if (n) { $('glbSize').textContent = 'GLB · ' + fmtMB(n); $('dlGlbNote').textContent = fmtMB(n); } })
        .catch(() => {});
    } catch (e) {
      if (e.name === 'AbortError') return;
      setStatus(e.message || 'Something broke.', true);
    } finally { $('pullBtn').disabled = false; }
  }

  function render({ id, json, urls }) {
    result.hidden = false;
    $('name').textContent = json.name || `GIMBOZ #${id}`;
    $('pfp').src = urls.pfp; $('pfp').alt = json.name || '';
    const tr = $('traits'); tr.innerHTML = '';
    (json.attributes || []).forEach((a) => {
      const el = document.createElement('span'); el.className = 'trait';
      el.innerHTML = `<b>${esc(a.trait_type)}</b><span>${esc(String(a.value))}</span>`; tr.appendChild(el);
    });
    pbarFill.style.width = '0'; $('glbSize').textContent = ''; $('dlGlbNote').textContent = ''; $('dlVrmNote').textContent = '';
    viewer.src = urls.glb;
    $('dlPfp').href = urls.pfp; $('dlPfp').download = `gimboz_${id}.png`;
    $('dlJson').href = urls.json; $('dlJson').download = `gimboz_${id}.json`;
    $('lnkOpensea').href = `https://opensea.io/assets/ape_chain/${CONTRACT}/${id}`;
    $('lnkApescan').href = `https://apescan.io/nft/${CONTRACT.toLowerCase()}/${id}`;
    $('lnkShare').href = `?id=${id}`;
    $('cUri').textContent = urls.json; $('cGlb').textContent = urls.glb; $('cMml').textContent = mmlTag(urls.glb);
    $('rawJson').textContent = JSON.stringify(json, null, 2);
    result.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ----- GLB download: cross-origin, so stream to a blob and save with a proper filename -----
  async function downloadGlb() {
    if (!current) return;
    const btn = $('dlGlb'); const note = $('dlGlbNote');
    btn.disabled = true;
    try {
      const res = await fetch(current.urls.glb);
      if (!res.ok) throw new Error('GLB fetch failed ' + res.status);
      const total = +res.headers.get('content-length') || 0;
      const reader = res.body.getReader(); const chunks = []; let got = 0;
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        chunks.push(value); got += value.length;
        note.textContent = total ? `${Math.round(got / total * 100)}%` : fmtMB(got);
      }
      const blob = new Blob(chunks, { type: 'model/gltf-binary' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `gimboz_${current.id}.glb`;
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      note.textContent = total ? fmtMB(total) : ''; toast(`gimboz_${current.id}.glb saved`);
    } catch (e) {
      note.textContent = ''; toast('download failed, opening direct link');
      window.open(current.urls.glb, '_blank', 'noopener');
    } finally { btn.disabled = false; }
  }

  // ----- VRM: fetch the GLB, convert in-browser, save -----
  async function downloadVrm() {
    if (!current) return;
    const btn = $('dlVrm'); const note = $('dlVrmNote');
    btn.disabled = true;
    try {
      const res = await fetch(current.urls.glb);
      if (!res.ok) throw new Error('GLB fetch failed ' + res.status);
      const total = +res.headers.get('content-length') || 0;
      const reader = res.body.getReader(); const chunks = []; let got = 0;
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        chunks.push(value); got += value.length;
        note.textContent = total ? `${Math.round(got / total * 100)}%` : fmtMB(got);
      }
      note.textContent = 'converting…';
      const buf = await new Blob(chunks).arrayBuffer();
      const { buffer, report } = GimbozVRM.convert(buf, { title: current.json.name || `Gimboz #${current.id}` });
      const blob = new Blob([buffer], { type: 'model/gltf-binary' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `gimboz_${current.id}.vrm`;
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      note.textContent = `${report.mapped.length} bones` + (report.expressions.length ? ` · ${report.expressions.length} expressions` : '');
      toast(`gimboz_${current.id}.vrm saved`);
    } catch (e) {
      note.textContent = ''; setStatus('VRM conversion failed: ' + (e.message || e), true);
    } finally { btn.disabled = false; }
  }

  // ----- wiring -----
  $('dlVrm').addEventListener('click', downloadVrm);
  form.addEventListener('submit', (e) => { e.preventDefault(); pull(input.value); });
  $('randomBtn').addEventListener('click', () => { const id = MIN + Math.floor(Math.random() * (MAX - MIN + 1)); input.value = id; pull(id); });
  $('dlGlb').addEventListener('click', downloadGlb);
  $('copyMml').addEventListener('click', () => current && copy(mmlTag(current.urls.glb), 'MML tag'));
  $('copyUrl').addEventListener('click', () => current && copy(current.urls.glb, 'GLB URL'));
  $('lnkShare').addEventListener('click', (e) => { e.preventDefault(); if (current) copy(`${location.origin}${location.pathname}?id=${current.id}`, 'Share link'); });
  $('resetCam').addEventListener('click', () => { viewer.cameraOrbit = '0deg 82deg 2.4m'; viewer.cameraTarget = 'auto auto auto'; });
  viewer.addEventListener('progress', (e) => { pbarFill.style.width = (e.detail.totalProgress * 100) + '%'; });
  viewer.addEventListener('load', () => { pbarFill.style.width = '0'; });
  viewer.addEventListener('error', () => setStatus('3D preview failed to load. The download buttons still work.', true));

  renderRecent();
  const q = new URLSearchParams(location.search).get('id');
  if (q) { input.value = q; pull(q); } else { input.focus(); }
})();
