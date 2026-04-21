<script>
  import { onMount, onDestroy } from 'svelte';
  import { currentFile, currentContent } from '../stores/files.js';
  import { auth } from '../stores/auth.js';
  import { api } from '../lib/api.js';
  import { createWebSocketClient } from '../lib/websocket.js';

  let content = '';
  let previewMode = false;
  let saving = false;
  let lastSave = null;
  let connected = false;
  let wsClient = null;

  let saveTimeout = null;
  let saveDebounce = 1000;

  onMount(() => {
    // Setup WebSocket
    wsClient = createWebSocketClient();

    wsClient.onConnected = () => {
      connected = true;
    };

    wsClient.onDisconnected = () => {
      connected = false;
    };

    wsClient.onFileChanged = (data) => {
      if (data.path !== $currentFile?.path) return;
      // Reload content if changed by another client
      if (data.session_id !== wsClient.sessionId) {
        loadFileContent();
      }
    };

    wsClient.connect();

    // Listen for file changes from WebSocket
    window.addEventListener('file:changed', handleFileChanged);

    return () => {
      window.removeEventListener('file:changed', handleFileChanged);
      if (wsClient) {
        wsClient.disconnect();
      }
    };
  });

  function handleFileChanged(e) {
    const { path, type } = e.detail;
    if (path === $currentFile?.path && type === 'file_deleted') {
      currentFile.set(null);
      content = '';
    }
  }

  $: if ($currentFile) {
    loadFileContent();
  }

  async function loadFileContent() {
    if (!$currentFile) return;

    try {
      const data = await api.getFile($currentFile.path);
      content = data.content || '';
    } catch (err) {
      console.error('Failed to load file:', err);
    }
  }

  $: if (content !== $currentContent) {
    scheduleSave();
  }

  function scheduleSave() {
    if (saveTimeout) {
      clearTimeout(saveTimeout);
    }

    saveTimeout = setTimeout(() => {
      saveContent();
    }, saveDebounce);
  }

  async function saveContent() {
    if (!$currentFile || saving) return;

    saving = true;

    try {
      const hash = await calculateHash(content);

      await api.updateFile($currentFile.path, content);

      lastSave = new Date();
      saving = false;

      // Sync via WebSocket
      if (wsClient && connected) {
        wsClient.syncFile($currentFile.path, content, hash);
      }
    } catch (err) {
      console.error('Failed to save:', err);
      saving = false;
    }
  }

  async function calculateHash(content) {
    const msgBuffer = new TextEncoder().encode(content);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  function renderMarkdown(markdown) {
    if (!markdown) return '';

    // Simple markdown to HTML conversion
    return markdown
      // Headers
      .replace(/^### (.*$)/gim, '<h3>$1</h3>')
      .replace(/^## (.*$)/gim, '<h2>$1</h2>')
      .replace(/^# (.*$)/gim, '<h1>$1</h1>')
      // Bold
      .replace(/\*\*(.*?)\*\*/gim, '<strong>$1</strong>')
      // Italic
      .replace(/\*(.*?)\*/gim, '<em>$1</em>')
      // Links
      .replace(/\[([^\]]+)\]\(([^)]+)\)/gim, '<a href="$2">$1</a>')
      // Images
      .replace(/!\[([^\]]*)\]\(([^)]+)\)/gim, '<img src="$2" alt="$1" />')
      // Code
      .replace(/`([^`]+)`/gim, '<code>$1</code>')
      // Line breaks
      .replace(/\n/gim, '<br>');
  }

  $: previewHTML = renderMarkdown(content || '');

  function togglePreview() {
    previewMode = !previewMode;
  }
</script>

<div class="editor-container">
  <div class="editor-header">
    <div class="file-info">
      <span class="icon">📄</span>
      <span class="path">
        {$currentFile?.path || 'Nessun file selezionato'}
      </span>
    </div>

    <div class="actions">
      {#if saving}
        <span class="saving">💾 Salvataggio...</span>
      {:else if lastSave}
        <span class="saved">✅ Salvato {lastSave.toLocaleTimeString()}</span>
      {/if}

      <button
        on:click={togglePreview}
        disabled={!$currentFile}
        title={previewMode ? "Mostra editor" : "Mostra preview"}
      >
        {previewMode ? '📝 Edit' : '👁 Preview'}
      </button>

      <div class="status" class:connected>
        <span class="dot"></span>
        {connected ? 'Online' : 'Offline'}
      </div>
    </div>
  </div>

  <div class="editor-content">
    {#if !$currentFile}
      <div class="empty">
        <h2>📭 Nessun file selezionato</h2>
        <p>Seleziona un file dalla sidebar per visualizzarlo</p>
      </div>
    {:else if previewMode}
      <div class="preview">
        {@html previewHTML}
      </div>
    {:else}
      <textarea
        bind:value={content}
        placeholder="Scrivi qui..."
        disabled={!$currentFile}
      ></textarea>
    {/if}
  </div>
</div>

<style>
  .editor-container {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: #1e1e1e;
  }

  .editor-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 15px 20px;
    background: #252526;
    border-bottom: 1px solid #333;
  }

  .file-info {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 14px;
  }

  .file-info .icon {
    font-size: 16px;
  }

  .file-info .path {
    color: #999;
    font-family: monospace;
  }

  .actions {
    display: flex;
    align-items: center;
    gap: 15px;
  }

  .saving, .saved {
    font-size: 12px;
    color: #999;
  }

  .status {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    background: #333;
    border-radius: 4px;
    font-size: 12px;
  }

  .status.connected {
    background: #1a4d1a;
    color: #4ade80;
  }

  .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #999;
  }

  .status.connected .dot {
    background: #4ade80;
  }

  button {
    padding: 6px 12px;
    background: #333;
    color: #dcddde;
    border: 1px solid #444;
    border-radius: 4px;
    font-size: 13px;
    cursor: pointer;
  }

  button:hover:not(:disabled) {
    background: #444;
  }

  button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .editor-content {
    flex: 1;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: #666;
  }

  .empty h2 {
    font-size: 24px;
    margin-bottom: 10px;
  }

  textarea {
    flex: 1;
    width: 100%;
    padding: 20px;
    background: #1e1e1e;
    color: #dcddde;
    border: none;
    resize: none;
    font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
    font-size: 14px;
    line-height: 1.6;
  }

  textarea:focus {
    outline: none;
  }

  textarea:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .preview {
    flex: 1;
    padding: 20px;
    overflow-y: auto;
    color: #dcddde;
    line-height: 1.6;
  }

  .preview :global(h1) {
    font-size: 28px;
    font-weight: 600;
    margin-bottom: 20px;
    padding-bottom: 10px;
    border-bottom: 1px solid #333;
  }

  .preview :global(h2) {
    font-size: 24px;
    font-weight: 600;
    margin: 20px 0 10px;
  }

  .preview :global(h3) {
    font-size: 20px;
    font-weight: 600;
    margin: 15px 0 10px;
  }

  .preview :global(strong) {
    font-weight: 600;
  }

  .preview :global(em) {
    font-style: italic;
  }

  .preview :global(code) {
    background: #333;
    padding: 2px 6px;
    border-radius: 3px;
    font-family: monospace;
    font-size: 13px;
  }

  .preview :global(a) {
    color: #7c3aed;
    text-decoration: none;
  }

  .preview :global(a:hover) {
    text-decoration: underline;
  }

  .preview :global(img) {
    max-width: 100%;
    height: auto;
    border-radius: 4px;
    margin: 10px 0;
  }

  .preview::-webkit-scrollbar {
    width: 8px;
  }

  .preview::-webkit-scrollbar-track {
    background: #1e1e1e;
  }

  .preview::-webkit-scrollbar-thumb {
    background: #444;
    border-radius: 4px;
  }
</style>
