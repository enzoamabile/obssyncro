<script>
  import { onMount } from 'svelte';
  import { files, selectedPath, currentFile } from '../stores/files.js';
  import { api } from '../lib/api.js';

  let loading = true;
  let error = null;
  let expandedFolders = new Set(['']);

  onMount(async () => {
    await loadFiles();
  });

  async function loadFiles() {
    loading = true;
    error = null;

    try {
      const data = await api.listFiles();
      files.set(data.files || []);
    } catch (err) {
      error = err.message;
    } finally {
      loading = false;
    }
  }

  function selectFile(file) {
    if (file.type === 'folder') {
      if (expandedFolders.has(file.path)) {
        expandedFolders.delete(file.path);
      } else {
        expandedFolders.add(file.path);
      }
      expandedFolders = expandedFolders;
    } else {
      selectedPath.set(file.path);
      loadFileContent(file);
    }
  }

  async function loadFileContent(file) {
    try {
      const data = await api.getFile(file.path);
      currentFile.set({
        path: file.path,
        content: data.content || '',
        hash: data.hash || ''
      });
    } catch (err) {
      error = err.message;
    }
  }

  function getIcon(file) {
    if (file.type === 'folder') return '📁';
    if (file.path.endsWith('.md')) return '📄';
    if (file.path.match(/\.(png|jpg|jpeg|gif|webp)$/i)) return '🖼️';
    if (file.path.match(/\.(mp3|wav|ogg)$/i)) return '🎵';
    if (file.path.match(/\.(mp4|mov|avi)$/i)) return '🎬';
    if (file.path.endsWith('.pdf')) return '📕';
    return '📄';
  }

  function getFileHierarchy(fileList) {
    const root = [];

    fileList.forEach(file => {
      const parts = file.path.split('/').filter(Boolean);
      let currentLevel = root;
      let currentPath = '';

      parts.forEach((part, index) => {
        currentPath += (currentPath ? '/' : '') + part;
        const isFolder = index < parts.length - 1;

        let existing = currentLevel.find(item => item.name === part);

        if (!existing) {
          existing = {
            name: part,
            path: currentPath,
            type: isFolder ? 'folder' : 'file',
            original: file
          };

          if (isFolder) {
            existing.children = [];
          }

          currentLevel.push(existing);
        }

        if (isFolder) {
          currentLevel = existing.children;
        }
      });
    });

    return root;
  }

  function renderTree(items, level = 0) {
    return items.map(item => {
      const isExpanded = expandedFolders.has(item.path);

      return `
        <div class="tree-item" style="padding-left: ${level * 16 + 8}px">
          <div
            class="tree-item-content ${selectedPath === item.path ? 'selected' : ''}"
            data-path="${item.path}"
            data-type="${item.type}"
          >
            <span class="icon">${item.type === 'folder' ? (isExpanded ? '📂' : '📁') : getIcon(item)}</span>
            <span class="name">${item.name}</span>
          </div>
        </div>
        ${item.type === 'folder' && isExpanded && item.children ? renderTree(item.children, level + 1).join('') : ''}
      `;
    });
  }

  $: hierarchy = getFileHierarchy($files);
  $: treeHTML = renderTree(hierarchy).join('');

  function handleClick(e) {
    const target = e.target.closest('.tree-item-content');
    if (!target) return;

    const path = target.dataset.path;
    const type = target.dataset.type;
    const file = $files.find(f => f.path === path);

    if (file) {
      selectFile(file);
    }
  }
</script>

<div class="file-tree">
  <div class="header">
    <h3>📁 Vault</h3>
    <button on:click={loadFiles} title="Aggiorna" disabled={loading}>
      {loading ? '⏳' : '🔄'}
    </button>
  </div>

  {#if error}
    <div class="error">{error}</div>
  {/if}

  <div class="tree" on:click={handleClick}>
    {@html treeHTML}
  </div>
</div>

<style>
  .file-tree {
    height: 100%;
    display: flex;
    flex-direction: column;
    background: #252526;
    border-right: 1px solid #333;
  }

  .header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 15px;
    border-bottom: 1px solid #333;
  }

  .header h3 {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
  }

  .header button {
    background: none;
    border: none;
    font-size: 16px;
    cursor: pointer;
    padding: 4px;
    opacity: 0.7;
  }

  .header button:hover {
    opacity: 1;
  }

  .error {
    padding: 10px 15px;
    background: #4a1818;
    color: #ff6b6b;
    font-size: 12px;
  }

  .tree {
    flex: 1;
    overflow-y: auto;
    padding: 8px 0;
  }

  .tree-item {
    cursor: pointer;
    user-select: none;
  }

  .tree-item-content {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    font-size: 13px;
    color: #dcddde;
    border-radius: 4px;
    transition: background 0.1s;
  }

  .tree-item-content:hover {
    background: #333;
  }

  .tree-item-content.selected {
    background: #7c3aed;
  }

  .icon {
    font-size: 14px;
    width: 16px;
    text-align: center;
  }

  .name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tree::-webkit-scrollbar {
    width: 8px;
  }

  .tree::-webkit-scrollbar-track {
    background: #1e1e1e;
  }

  .tree::-webkit-scrollbar-thumb {
    background: #444;
    border-radius: 4px;
  }

  .tree::-webkit-scrollbar-thumb:hover {
    background: #555;
  }
</style>
