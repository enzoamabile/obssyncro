<script>
  import { onMount } from 'svelte';

  let loading = true;
  let connected = false;
  let error = null;

  onMount(() => {
    // Remove loading screen
    setTimeout(() => {
      loading = false;
    }, 500);

    // Check server connection
    fetch('/health')
      .then(res => res.json())
      .then(() => {
        connected = true;
      })
      .catch(err => {
        error = 'Impossibile connettersi al server';
        console.error(err);
      });
  });
</script>

<div class="app">
  {#if loading}
    <div class="loading">
      <div class="spinner"></div>
      <p>Caricamento...</p>
    </div>
  {:else if error}
    <div class="error">
      <h1>⚠️ Errore</h1>
      <p>{error}</p>
      <button on:click={() => window.location.reload()}>Riprova</button>
    </div>
  {:else}
    <div class="main">
      <header>
        <h1>📝 Obsidian Sync</h1>
        <div class="status" class:connected>
          <span class="dot"></span>
          {connected ? 'Online' : 'Offline'}
        </div>
      </header>

      <main>
        <div class="placeholder">
          <h2>🚀 Benvenuto in Obsidian Sync</h2>
          <p>L'interfaccia web è in fase di sviluppo.</p>
          <p>Usa Obsidian sul Mac per sincronizzare le tue note.</p>

          <div class="info">
            <h3>📡 Server Status</h3>
            <ul>
              <li>✅ WebSocket Server: Attivo</li>
              <li>✅ Database: Connesso</li>
              <li>✅ Vault: Pronto</li>
            </ul>
          </div>
        </div>
      </main>
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

  .error {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100vh;
    gap: 20px;
    text-align: center;
  }

  .error h1 {
    font-size: 48px;
    margin-bottom: 10px;
  }

  .error button {
    padding: 10px 20px;
    background: #7c3aed;
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 16px;
  }

  .error button:hover {
    background: #6d28d9;
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
    padding: 15px 20px;
    background: #252526;
    border-bottom: 1px solid #333;
  }

  header h1 {
    font-size: 20px;
    font-weight: 600;
  }

  .status {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 5px 12px;
    background: #333;
    border-radius: 4px;
    font-size: 14px;
  }

  .status.connected {
    background: #1a4d1a;
  }

  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #999;
  }

  .status.connected .dot {
    background: #4ade80;
  }

  main {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 40px;
  }

  .placeholder {
    max-width: 600px;
    text-align: center;
  }

  .placeholder h2 {
    font-size: 32px;
    margin-bottom: 20px;
  }

  .placeholder p {
    font-size: 16px;
    color: #999;
    line-height: 1.6;
    margin-bottom: 10px;
  }

  .info {
    margin-top: 40px;
    padding: 20px;
    background: #252526;
    border-radius: 8px;
    text-align: left;
  }

  .info h3 {
    margin-bottom: 15px;
    font-size: 18px;
  }

  .info ul {
    list-style: none;
    padding: 0;
  }

  .info li {
    padding: 8px 0;
    font-size: 14px;
    color: #999;
  }
</style>
