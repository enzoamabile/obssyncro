<script>
  import { onMount } from 'svelte';
  import { auth, login, logout } from './stores/auth.js';
  import { api } from './lib/api.js';
  import Auth from './components/Auth.svelte';
  import FileTree from './components/FileTree.svelte';
  import Editor from './components/Editor.svelte';

  let loading = true;
  let healthCheck = false;

  onMount(async () => {
    // Check if already authenticated
    if ($auth.isAuthenticated) {
      await verifyAuth();
    }
    loading = false;
  });

  async function verifyAuth() {
    try {
      await api.health();
      healthCheck = true;
    } catch (err) {
      console.error('Health check failed:', err);
      logout();
    }
  }

  function handleLogout() {
    logout();
    window.location.reload();
  }
</script>

<div class="app">
  {#if loading}
    <div class="loading">
      <div class="spinner"></div>
      <p>Caricamento...</p>
    </div>
  {:else if !$auth.isAuthenticated}
    <Auth />
  {:else}
    <div class="main">
      <header>
        <div class="logo">
          <h1>📝 Obsidian Sync</h1>
          <span class="version">v1.0</span>
        </div>
        <div class="user">
          <span class="email">{$auth.email}</span>
          <button on:click={handleLogout} class="logout">Logout</button>
        </div>
      </header>

      <div class="content">
        <FileTree />
        <Editor />
      </div>
    </div>
  {/if}
</div>

<style>
  :global(body) {
    margin: 0;
    padding: 0;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
  }

  .app {
    width: 100vw;
    height: 100vh;
    background: #1e1e1e;
    color: #dcddde;
    overflow: hidden;
  }

  .loading {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100vh;
    gap: 20px;
  }

  .spinner {
    width: 40px;
    height: 40px;
    border: 3px solid #333;
    border-top-color: #7c3aed;
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .main {
    display: flex;
    flex-direction: column;
    height: 100vh;
  }

  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0 20px;
    height: 60px;
    background: #1a1a1a;
    border-bottom: 1px solid #333;
  }

  .logo {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .logo h1 {
    font-size: 20px;
    font-weight: 600;
    margin: 0;
  }

  .logo .version {
    font-size: 12px;
    color: #666;
    background: #333;
    padding: 2px 8px;
    border-radius: 4px;
  }

  .user {
    display: flex;
    align-items: center;
    gap: 15px;
  }

  .user .email {
    font-size: 14px;
    color: #999;
  }

  .logout {
    padding: 6px 12px;
    background: #333;
    color: #dcddde;
    border: 1px solid #444;
    border-radius: 4px;
    font-size: 13px;
    cursor: pointer;
  }

  .logout:hover {
    background: #444;
  }

  .content {
    display: flex;
    flex: 1;
    overflow: hidden;
  }

  .content > :global(*) {
    flex: 1;
  }

  :global(.file-tree) {
    flex: 0 0 280px;
    min-width: 280px;
  }

  :global(.editor-container) {
    flex: 1;
  }
</style>
