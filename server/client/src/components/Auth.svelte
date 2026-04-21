<script>
  import { auth, login } from '../stores/auth.js';
  import { api } from '../lib/api.js';

  let email = '';
  let password = '';
  let loading = false;
  let error = '';

  async function handleLogin() {
    if (!email || !password) {
      error = 'Inserisci email e password';
      return;
    }

    loading = true;
    error = '';

    try {
      const response = await api.login(email, password);

      if (response.token) {
        login(email, response.token);
      } else {
        error = 'Credenziali non valide';
      }
    } catch (err) {
      error = err.message || 'Errore durante il login';
    } finally {
      loading = false;
    }
  }

  function handleKeydown(e) {
    if (e.key === 'Enter') {
      handleLogin();
    }
  }
</script>

<div class="auth-container">
  <div class="auth-box">
    <h1>📝 Obsidian Sync</h1>
    <p>Login per accedere al vault</p>

    {#if error}
      <div class="error">
        {error}
      </div>
    {/if}

    <form on:submit|preventDefault={handleLogin}>
      <div class="form-group">
        <label>Email</label>
        <input
          type="email"
          bind:value={email}
          placeholder="enzoamabile@gmail.com"
          on:keydown={handleKeydown}
          disabled={loading}
          autocomplete="email"
        />
      </div>

      <div class="form-group">
        <label>Password</label>
        <input
          type="password"
          bind:value={password}
          placeholder="••••••••"
          on:keydown={handleKeydown}
          disabled={loading}
          autocomplete="current-password"
        />
      </div>

      <button type="submit" disabled={loading} class:loading>
        {loading ? 'Accesso...' : 'Accedi'}
      </button>
    </form>
  </div>
</div>

<style>
  .auth-container {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    background: #1e1e1e;
  }

  .auth-box {
    width: 100%;
    max-width: 400px;
    padding: 40px;
    background: #252526;
    border-radius: 8px;
    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);
  }

  .auth-box h1 {
    text-align: center;
    margin-bottom: 10px;
    font-size: 28px;
  }

  .auth-box > p {
    text-align: center;
    color: #999;
    margin-bottom: 30px;
  }

  .error {
    padding: 12px;
    background: #4a1818;
    border: 1px solid #8b2020;
    border-radius: 4px;
    color: #ff6b6b;
    margin-bottom: 20px;
    font-size: 14px;
  }

  .form-group {
    margin-bottom: 20px;
  }

  .form-group label {
    display: block;
    margin-bottom: 8px;
    font-size: 14px;
    color: #dcddde;
  }

  .form-group input {
    width: 100%;
    padding: 10px 12px;
    background: #1e1e1e;
    border: 1px solid #333;
    border-radius: 4px;
    color: #dcddde;
    font-size: 14px;
    box-sizing: border-box;
  }

  .form-group input:focus {
    outline: none;
    border-color: #7c3aed;
  }

  .form-group input:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  button {
    width: 100%;
    padding: 12px;
    background: #7c3aed;
    color: white;
    border: none;
    border-radius: 4px;
    font-size: 16px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.2s;
  }

  button:hover:not(:disabled) {
    background: #6d28d9;
  }

  button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  button.loading {
    background: #5b21b6;
  }
</style>
