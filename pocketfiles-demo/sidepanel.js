(() => {
  const $ = (selector) => document.querySelector(selector);
  const state = {
    root: null,
    current: null,
    currentPath: [],
    records: [],
    recordMap: new Map(),
    selected: new Set(),
    favorites: new Set(),
    recents: [],
    view: 'all',
    grid: false,
    activePreview: null,
    previewUrl: null,
    toastTimer: null,
    scanLimitReached: false
  };

  const dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open('pocketfiles-handles', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('handles');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  async function idbGet(key) {
    const db = await dbPromise;
    return new Promise((resolve, reject) => {
      const request = db.transaction('handles', 'readonly').objectStore('handles').get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  async function idbSet(key, value) {
    const db = await dbPromise;
    return new Promise((resolve, reject) => {
      const tx = db.transaction('handles', 'readwrite');
      tx.objectStore('handles').put(value, key);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }

  const escapeHTML = (value) => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const basename = (path) => path.split('/').filter(Boolean).pop() || path;
  const parentPath = (path) => path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
  const extOf = (name) => name.includes('.') ? name.split('.').pop().toLowerCase() : '';
  const formatSize = (bytes) => {
    if (bytes == null) return 'Folder';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };
  const formatDate = (value) => value ? new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—';

  function toast(message) {
    const el = $('#toast');
    el.textContent = message;
    el.classList.add('visible');
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => el.classList.remove('visible'), 2500);
  }
  function setFooter(message) { $('#footer-status').textContent = message; }
  function setConnected(connected, label = 'Connected') {
    const el = $('#connection-indicator');
    el.classList.toggle('connected', connected);
    el.querySelector('span').textContent = label;
  }
  function setScan(active, message = 'Indexing folder…') {
    $('#scan-status').hidden = !active;
    $('#scan-status-text').textContent = message;
  }

  async function setTheme(theme) {
    if (theme === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', theme);
    $('#theme-select').value = theme;
    await chrome.storage.local.set({ theme });
  }
  async function loadPreferences() {
    const saved = await chrome.storage.local.get(['theme', 'favorites', 'recents']);
    const theme = saved.theme || 'system';
    if (theme === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', theme);
    $('#theme-select').value = theme;
    state.favorites = new Set(saved.favorites || []);
    state.recents = saved.recents || [];
  }
  async function persistFavorites() {
    await chrome.storage.local.set({ favorites: [...state.favorites] });
  }
  async function persistRecents() {
    await chrome.storage.local.set({ recents: state.recents.slice(0, 20) });
  }

  async function ensurePermission(handle, mode = 'readwrite', ask = false) {
    if (!handle) return false;
    let permission = await handle.queryPermission({ mode });
    if (permission === 'granted') return true;
    if (ask) permission = await handle.requestPermission({ mode });
    return permission === 'granted';
  }

  async function connectFolder() {
    if (!('showDirectoryPicker' in window)) {
      toast('Folder access is not supported in this browser. Try Chrome or Edge on desktop.');
      return;
    }
    try {
      const handle = await window.showDirectoryPicker({ id: 'pocketfiles-root', mode: 'readwrite' });
      const granted = await ensurePermission(handle, 'readwrite', true);
      if (!granted) { toast('Folder permission was not granted.'); return; }
      state.root = handle;
      state.currentPath = [];
      state.selected.clear();
      await idbSet('root', handle);
      await indexRoot();
      toast(`Connected ${handle.name}`);
    } catch (error) {
      if (error?.name !== 'AbortError') {
        console.error(error);
        toast('Could not connect that folder.');
      }
    }
  }

  async function restoreFolder() {
    try {
      const handle = await idbGet('root');
      if (!handle) return;
      const granted = await ensurePermission(handle, 'readwrite', false);
      if (!granted) {
        state.root = handle;
        setConnected(false, 'Permission needed');
        renderWelcome('Folder access needs permission', 'Reconnect your folder to continue browsing. Your saved folder choice is still here.');
        $('#connect-button span').textContent = 'Reconnect folder';
        return;
      }
      state.root = handle;
      await indexRoot();
    } catch (error) {
      console.warn('Could not restore PocketFiles folder handle:', error);
    }
  }

  async function indexRoot() {
    if (!state.root) return;
    const permitted = await ensurePermission(state.root, 'readwrite', true);
    if (!permitted) { setConnected(false, 'Permission needed'); toast('Please allow access to the selected folder.'); return; }
    state.records = [];
    state.recordMap.clear();
    state.scanLimitReached = false;
    setScan(true, `Indexing ${state.root.name}…`);
    setFooter('Indexing');
    setConnected(true, state.root.name);
    $('#connect-button span').textContent = 'Change folder';
    try {
      await scanDirectory(state.root, '', 0);
      state.records.sort((a, b) => Number(b.kind === 'directory') - Number(a.kind === 'directory') || a.name.localeCompare(b.name));
      state.currentPath = state.currentPath.filter(Boolean);
      await resolveCurrentDirectory();
      setScan(false);
      setFooter(state.scanLimitReached ? 'Index limit reached' : `${state.records.length.toLocaleString()} items indexed`);
      $('#search-hint').textContent = `Search ${state.root.name} and its subfolders`;
      render();
    } catch (error) {
      console.error(error);
      setScan(false);
      setFooter('Could not index folder');
      toast('Some folders could not be read. Check access permissions.');
      render();
    }
  }

  async function scanDirectory(directory, relativePath, depth) {
    if (depth > 24 || state.records.length >= 12000) { state.scanLimitReached = true; return; }
    for await (const [name, handle] of directory.entries()) {
      if (state.records.length >= 12000) { state.scanLimitReached = true; break; }
      const path = relativePath ? `${relativePath}/${name}` : name;
      if (handle.kind === 'directory') {
        const record = { name, path, kind: 'directory', size: null, modified: null, handle };
        state.records.push(record); state.recordMap.set(path, record);
        if (state.records.length % 100 === 0) setScan(true, `Indexing… ${state.records.length.toLocaleString()} items`);
        await scanDirectory(handle, path, depth + 1);
      } else {
        try {
          const file = await handle.getFile();
          const record = { name, path, kind: 'file', size: file.size, modified: file.lastModified, type: file.type, handle, file };
          state.records.push(record); state.recordMap.set(path, record);
        } catch (_) { /* Skip files that become unavailable while indexing. */ }
      }
    }
  }

  async function resolveCurrentDirectory() {
    let handle = state.root;
    for (const part of state.currentPath) {
      handle = await handle.getDirectoryHandle(part);
    }
    state.current = handle;
  }

  function renderWelcome(title, message) {
    $('#file-list').innerHTML = `<div class="empty-state"><div class="empty-icon">${folderSvg()}</div><h2>${escapeHTML(title)}</h2><p>${escapeHTML(message)}</p><button class="button button-secondary" id="empty-connect-button" type="button">Choose a folder</button></div>`;
    $('#empty-connect-button')?.addEventListener('click', connectFolder);
    $('#item-count').textContent = '—';
    $('#breadcrumbs').innerHTML = '<span class="crumb-muted">No folder selected</span>';
  }

  function folderSvg() { return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 7A2.5 2.5 0 0 1 6 4.5h4l2 2h6A2.5 2.5 0 0 1 20.5 9v8A2.5 2.5 0 0 1 18 19.5H6A2.5 2.5 0 0 1 3.5 17V7Z"/><path d="M3.8 9.5h16.4"/></svg>'; }
  function fileSvg(ext, isFolder) {
    if (isFolder) return folderSvg();
    if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'heic'].includes(ext)) return '<svg viewBox="0 0 24 24"><rect x="3.5" y="4" width="17" height="16" rx="2"/><circle cx="9" cy="9" r="1.5"/><path d="m4.5 17 5-5 3 3 2.5-2.5 4.5 4.5"/></svg>';
    if (['pdf'].includes(ext)) return '<svg viewBox="0 0 24 24"><path d="M6 3.5h8l4 4V20a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1Z"/><path d="M14 3.5v4h4M8 14h8M8 17h5"/></svg>';
    if (['zip', 'rar', '7z', 'gz', 'tar'].includes(ext)) return '<svg viewBox="0 0 24 24"><path d="M7 3.5h10v17H7z"/><path d="M10 3.5v3h4v-3m-4 6h4m-4 3h4m-4 3h4m-4 3h4"/></svg>';
    return '<svg viewBox="0 0 24 24"><path d="M6 3.5h8l4 4V20a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1Z"/><path d="M14 3.5v4h4M8 12h8M8 15h8M8 18h5"/></svg>';
  }

  function renderBreadcrumbs() {
    const rootName = state.root?.name || 'Folder';
    const parts = [rootName, ...state.currentPath];
    const html = parts.map((part, index) => {
      const active = index === parts.length - 1;
      return `${index ? '<span class="crumb-sep">/</span>' : ''}<button class="crumb ${active ? 'current' : ''}" data-crumb-index="${index}" type="button" ${active ? 'aria-current="page"' : ''}>${escapeHTML(part)}</button>`;
    }).join('');
    $('#breadcrumbs').innerHTML = html;
    $('#breadcrumbs').querySelectorAll('[data-crumb-index]').forEach((button) => button.addEventListener('click', async () => {
      const index = Number(button.dataset.crumbIndex);
      state.currentPath = state.currentPath.slice(0, Math.max(0, index));
      state.selected.clear();
      await resolveCurrentDirectory();
      $('#search-input').value = '';
      state.view = 'all';
      updateTabs(); render();
    }));
    $('#up-button').disabled = state.currentPath.length === 0 || state.view !== 'all' || Boolean($('#search-input').value.trim());
    $('#refresh-button').disabled = !state.root;
  }

  function getVisibleRecords() {
    const query = $('#search-input').value.trim().toLocaleLowerCase();
    let results;
    if (query) {
      results = state.records.filter((record) => `${record.name} ${record.path}`.toLocaleLowerCase().includes(query));
    } else if (state.view === 'recent') {
      results = state.recents.map((item) => state.recordMap.get(item.path)).filter(Boolean);
    } else if (state.view === 'favorites') {
      results = [...state.favorites].map((path) => state.recordMap.get(path)).filter(Boolean);
    } else {
      const currentKey = state.currentPath.join('/');
      results = state.records.filter((record) => parentPath(record.path) === currentKey);
    }
    return results.sort((a, b) => Number(b.kind === 'directory') - Number(a.kind === 'directory') || a.name.localeCompare(b.name));
  }

  function render() {
    if (!state.root) return;
    renderBreadcrumbs();
    const query = $('#search-input').value.trim();
    const records = getVisibleRecords();
    $('#item-count').textContent = `${records.length} ${records.length === 1 ? 'item' : 'items'}`;
    $('#selection-toolbar').hidden = state.selected.size === 0;
    $('#selection-count').textContent = `${state.selected.size} selected`;
    $('#extract-button').hidden = !(state.selected.size === 1 && extOf(basename([...state.selected][0])) === 'zip');
    $('#file-list').classList.toggle('grid-layout', state.grid);
    if (!records.length) {
      let title = 'No files here';
      let message = 'This folder is empty. Try another folder or search term.';
      if (query) { title = 'No matches found'; message = `No files or folders match “${query}”. Try a shorter search.`; }
      else if (state.view === 'favorites') { title = 'No favorites yet'; message = 'Use the star beside a file or folder to keep it close.'; }
      else if (state.view === 'recent') { title = 'Nothing recent'; message = 'Files you preview or download will appear here.'; }
      $('#file-list').innerHTML = `<div class="empty-state"><div class="empty-icon">${folderSvg()}</div><h2>${escapeHTML(title)}</h2><p>${escapeHTML(message)}</p></div>`;
      return;
    }
    $('#file-list').innerHTML = records.map((record) => renderRecord(record)).join('');
    wireRows();
  }

  function renderRecord(record) {
    const isFolder = record.kind === 'directory';
    const ext = extOf(record.name);
    const favorite = state.favorites.has(record.path);
    const selected = state.selected.has(record.path);
    const sizeText = isFolder ? 'Folder' : formatSize(record.size);
    const metaText = isFolder ? 'Folder' : `${sizeText} · ${formatDate(record.modified)}`;
    return `<article class="file-row ${selected ? 'selected' : ''}" role="listitem" data-path="${escapeHTML(record.path)}" draggable="${!isFolder}">
      <input class="file-select" type="checkbox" aria-label="Select ${escapeHTML(record.name)}" ${selected ? 'checked' : ''}>
      <button class="file-open" type="button" aria-label="${isFolder ? 'Open folder' : 'Preview file'} ${escapeHTML(record.name)}">
        <span class="file-icon ${isFolder ? 'folder' : ''}">${fileSvg(ext, isFolder)}</span>
        <span class="file-info"><span class="file-name">${escapeHTML(record.name)}</span><span class="file-sub"><span>${escapeHTML(metaText)}</span></span></span>
      </button>
      <span class="row-actions">
        <button class="row-action favorite-button ${favorite ? 'is-favorite' : ''}" type="button" aria-label="${favorite ? 'Remove from' : 'Add to'} favorites" title="${favorite ? 'Remove favorite' : 'Add favorite'}"><svg viewBox="0 0 24 24"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3l-5.6 2.9 1.1-6.2L3 9.6l6.2-.9L12 3Z"/></svg></button>
        ${!isFolder ? `<button class="row-action download-one" type="button" aria-label="Download ${escapeHTML(record.name)}" title="Download"><svg viewBox="0 0 24 24"><path d="M12 3v12m-4-4 4 4 4-4M4 19h16"/></svg></button>` : ''}
      </span>
    </article>`;
  }

  function wireRows() {
    $('#file-list').querySelectorAll('.file-row').forEach((row) => {
      const path = row.dataset.path;
      const record = state.recordMap.get(path);
      row.querySelector('.file-select').addEventListener('change', (event) => {
        if (event.target.checked) state.selected.add(path); else state.selected.delete(path);
        render();
      });
      row.querySelector('.file-open').addEventListener('click', async () => {
        if (record.kind === 'directory') {
          state.currentPath = path.split('/');
          state.selected.clear();
          state.view = 'all'; updateTabs(); $('#search-input').value = '';
          await resolveCurrentDirectory(); render();
        } else await previewRecord(record);
      });
      row.querySelector('.favorite-button').addEventListener('click', async () => {
        if (state.favorites.has(path)) state.favorites.delete(path); else state.favorites.add(path);
        await persistFavorites(); render();
      });
      row.querySelector('.download-one')?.addEventListener('click', () => downloadRecord(record));
      if (record.kind === 'file') {
        row.addEventListener('dragstart', (event) => {
          try {
            // Cache the File during indexing so it can be attached during the synchronous dragstart event.
            event.dataTransfer.effectAllowed = 'copy';
            event.dataTransfer.items.add(record.file);
            event.dataTransfer.setData('text/plain', record.name);
            row.classList.add('dragging');
          } catch (error) {
            event.preventDefault(); toast('Could not prepare this file for dragging.');
          }
        });
        row.addEventListener('dragend', () => row.classList.remove('dragging'));
      }
    });
  }

  function updateTabs() {
    document.querySelectorAll('.view-tab').forEach((button) => button.classList.toggle('active', button.dataset.view === state.view));
  }

  async function markRecent(record) {
    state.recents = [{ path: record.path, at: Date.now() }, ...state.recents.filter((item) => item.path !== record.path)].slice(0, 20);
    await persistRecents();
  }

  async function previewRecord(record) {
    const file = await record.handle.getFile();
    await markRecent(record);
    state.activePreview = { record, file };
    $('#preview-name').textContent = file.name;
    $('#preview-meta').textContent = `${formatSize(file.size)} · Modified ${formatDate(file.lastModified)}`;
    $('#preview-type').textContent = (extOf(file.name) || 'FILE').toUpperCase().slice(0, 8);
    const content = $('#preview-content');
    content.innerHTML = '';
    if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
    state.previewUrl = URL.createObjectURL(file);
    const ext = extOf(file.name);
    if (file.type.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'].includes(ext)) {
      const image = document.createElement('img'); image.src = state.previewUrl; image.alt = file.name; content.append(image);
    } else if (file.type === 'application/pdf' || ext === 'pdf') {
      const frame = document.createElement('iframe'); frame.src = state.previewUrl; frame.title = `${file.name} preview`; content.append(frame);
    } else if (['txt', 'md', 'json', 'csv', 'js', 'ts', 'css', 'html', 'xml', 'log', 'yaml', 'yml'].includes(ext) && file.size <= 2 * 1024 * 1024) {
      const pre = document.createElement('pre'); pre.textContent = await file.text(); content.append(pre);
    } else {
      content.innerHTML = `<div class="preview-unsupported">Preview is not available for this file type.<br><br>You can still download it or drag it into a supported upload field.</div>`;
    }
    $('#preview-dialog').showModal();
  }

  function saveBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = filename; anchor.style.display = 'none';
    document.body.append(anchor); anchor.click(); anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
  async function downloadRecord(record) {
    try {
      const file = await record.handle.getFile();
      saveBlob(file, file.name);
      await markRecent(record);
      toast(`Preparing ${file.name}`);
    } catch (error) { console.error(error); toast('Could not download this file.'); }
  }

  async function collectFiles(handle, basePath, output, depth = 0) {
    if (depth > 25 || output.length > 5000) return;
    for await (const [name, child] of handle.entries()) {
      const path = basePath ? `${basePath}/${name}` : name;
      if (child.kind === 'directory') {
        await collectFiles(child, path, output, depth + 1);
      } else {
        const file = await child.getFile();
        output.push({ name: path, data: new Uint8Array(await file.arrayBuffer()) });
      }
    }
  }

  async function selectedEntries() {
    const output = [];
    const chosen = [...state.selected].map((path) => state.recordMap.get(path)).filter(Boolean);
    for (const record of chosen) {
      if (record.kind === 'directory') {
        const files = [];
        await collectFiles(record.handle, basename(record.path), files);
        output.push(...files);
      } else {
        const file = await record.handle.getFile();
        output.push({ name: record.name, data: new Uint8Array(await file.arrayBuffer()) });
      }
    }
    const seen = new Set();
    return output.filter((entry) => !seen.has(entry.name) && seen.add(entry.name));
  }

  async function compressSelection() {
    if (!state.selected.size) return;
    const button = $('#compress-button'); button.disabled = true; button.textContent = 'Working…';
    setFooter('Creating ZIP');
    try {
      const entries = await selectedEntries();
      if (!entries.length) { toast('There are no files in this selection.'); return; }
      const result = await window.PocketZip.createZip(entries);
      const selectedNames = [...state.selected].map(basename);
      const zipName = selectedNames.length === 1 ? `${selectedNames[0]}.zip` : 'PocketFiles-selection.zip';
      saveBlob(result.blob, zipName);
      toast(`Created ${zipName} · ${entries.length} files${result.compressionUsed ? '' : ' (store mode)'}`);
      setFooter('ZIP ready');
    } catch (error) {
      console.error(error); toast(`Could not create ZIP: ${error.message || 'unknown error'}`); setFooter('ZIP failed');
    } finally { button.disabled = false; button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 4h8l4 4v12H4V4h4Z"/><path d="M8 4v5h8V4M10 13h4m-4 3h4"/></svg> ZIP'; }
  }

  function safeParts(path) {
    const parts = path.replace(/\\/g, '/').split('/').filter((part) => part && part !== '.');
    if (path.startsWith('/') || parts.some((part) => part === '..' || part.includes('\0'))) throw new Error('Unsafe path in ZIP archive.');
    return parts;
  }
  async function writeZipEntry(root, entry) {
    const parts = safeParts(entry.name);
    if (!parts.length) return;
    let directory = root;
    const endIndex = entry.isDirectory ? parts.length : parts.length - 1;
    for (let i = 0; i < endIndex; i++) directory = await directory.getDirectoryHandle(parts[i], { create: true });
    if (entry.isDirectory) return;
    const fileName = parts[parts.length - 1];
    let exists = false;
    try { await directory.getFileHandle(fileName); exists = true; } catch (_) {}
    if (exists && !confirm(`“${entry.name}” already exists. Replace it?`)) return;
    const handle = await directory.getFileHandle(fileName, { create: true });
    const writable = await handle.createWritable();
    await writable.write(entry.data);
    await writable.close();
  }
  async function extractSelection() {
    const path = [...state.selected][0];
    const record = state.recordMap.get(path);
    if (!record || record.kind !== 'file') return;
    const button = $('#extract-button'); button.disabled = true; button.textContent = 'Extracting…';
    try {
      if (!(await ensurePermission(state.current, 'readwrite', true))) throw new Error('Folder write permission is needed.');
      const file = await record.handle.getFile();
      const entries = await window.PocketZip.readZip(file);
      let extracted = 0;
      for (const entry of entries) {
        await writeZipEntry(state.current, entry);
        if (!entry.isDirectory) extracted++;
      }
      toast(`Extracted ${extracted} files into ${state.current.name}`);
      await indexRoot();
    } catch (error) { console.error(error); toast(`Could not extract ZIP: ${error.message || 'unknown error'}`); }
    finally { button.disabled = false; button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m-4-4 4 4 4-4M4 19h16"/></svg> Extract'; }
  }

  async function saveSelected() {
    if (!state.selected.size) return;
    const chosen = [...state.selected].map((path) => state.recordMap.get(path)).filter(Boolean);
    if (chosen.some((record) => record.kind === 'directory') || chosen.length > 1) {
      await compressSelection();
      return;
    }
    await downloadRecord(chosen[0]);
  }

  async function writeDroppedFiles(files) {
    if (!state.current || !files.length) return;
    if (!(await ensurePermission(state.current, 'readwrite', true))) { toast('Write permission is needed to add files.'); return; }
    let saved = 0;
    for (const file of files) {
      const handle = await state.current.getFileHandle(file.name, { create: true });
      const writable = await handle.createWritable();
      await writable.write(file);
      await writable.close();
      saved++;
    }
    toast(`Added ${saved} ${saved === 1 ? 'file' : 'files'}`);
    await indexRoot();
  }

  function setupDropTarget() {
    const card = $('.browser-card');
    let dragDepth = 0;
    card.addEventListener('dragenter', (event) => {
      if (!Array.from(event.dataTransfer?.types || []).includes('Files')) return;
      event.preventDefault(); dragDepth++;
      $('#drop-overlay').hidden = false;
    });
    card.addEventListener('dragover', (event) => {
      if (Array.from(event.dataTransfer?.types || []).includes('Files')) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; }
    });
    card.addEventListener('dragleave', (event) => {
      event.preventDefault(); dragDepth = Math.max(0, dragDepth - 1);
      if (!dragDepth) $('#drop-overlay').hidden = true;
    });
    card.addEventListener('drop', async (event) => {
      event.preventDefault(); dragDepth = 0; $('#drop-overlay').hidden = true;
      // File drags that originate inside PocketFiles are for uploading elsewhere, not copying back into this folder.
      if (event.dataTransfer?.files?.length) {
        const files = [...event.dataTransfer.files];
        if (files.length && !state.root) return;
        try { await writeDroppedFiles(files); } catch (error) { console.error(error); toast('Could not add dropped files.'); }
      }
    });
  }

  function bindEvents() {
    $('#connect-button').addEventListener('click', connectFolder);
    $('#empty-connect-button')?.addEventListener('click', connectFolder);
    $('#theme-select').addEventListener('change', (event) => setTheme(event.target.value));
    $('#search-input').addEventListener('input', () => { state.selected.clear(); render(); });
    $('#search-input').addEventListener('keydown', (event) => { if (event.key === 'Escape') { event.currentTarget.value = ''; render(); } });
    document.querySelectorAll('.view-tab').forEach((button) => button.addEventListener('click', () => { state.view = button.dataset.view; state.selected.clear(); updateTabs(); render(); }));
    $('#up-button').addEventListener('click', async () => {
      if (!state.currentPath.length) return;
      state.currentPath.pop(); state.selected.clear(); $('#search-input').value = '';
      await resolveCurrentDirectory(); render();
    });
    $('#refresh-button').addEventListener('click', indexRoot);
    $('#layout-button').addEventListener('click', () => { state.grid = !state.grid; $('#layout-button').setAttribute('aria-label', state.grid ? 'Switch to list layout' : 'Switch to grid layout'); render(); });
    $('#compress-button').addEventListener('click', compressSelection);
    $('#extract-button').addEventListener('click', extractSelection);
    $('#download-button').addEventListener('click', saveSelected);
    $('#clear-selection').addEventListener('click', () => { state.selected.clear(); render(); });
    $('#close-preview').addEventListener('click', () => $('#preview-dialog').close());
    $('#preview-close-bottom').addEventListener('click', () => $('#preview-dialog').close());
    $('#preview-dialog').addEventListener('close', () => { if (state.previewUrl) URL.revokeObjectURL(state.previewUrl); state.previewUrl = null; state.activePreview = null; });
    $('#preview-download').addEventListener('click', () => { if (state.activePreview) saveBlob(state.activePreview.file, state.activePreview.file.name); });
    document.addEventListener('keydown', (event) => {
      if (event.key === '/' && !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName) && !$('#preview-dialog').open) { event.preventDefault(); $('#search-input').focus(); }
      if (event.key === 'Escape' && !$('#preview-dialog').open && $('#search-input').value) { $('#search-input').value = ''; render(); }
    });
    setupDropTarget();
  }

  async function init() {
    bindEvents();
    await loadPreferences();
    await restoreFolder();
    if (!state.root) setConnected(false, 'Not connected');
  }

  init().catch((error) => { console.error(error); toast('PocketFiles could not start.'); });
})();
