const API_BASE = '';

async function apiRequest(url, options = {}) {
  const token = localStorage.getItem('token');

  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token && { 'Authorization': `Bearer ${token}` }),
      ...options.headers
    }
  });

  if (!response.ok) {
    throw new Error(`API Error: ${response.status}`);
  }

  return response.json();
}

export const api = {
  // Auth
  login: (email, password) =>
    apiRequest('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password })
    }),

  // Files
  listFiles: () =>
    apiRequest('/api/list'),

  getFile: (path) =>
    apiRequest(`/api/file${path}`),

  createFile: (path, content) =>
    apiRequest(`/api/file${path}`, {
      method: 'POST',
      body: JSON.stringify({ content })
    }),

  updateFile: (path, content) =>
    apiRequest(`/api/file${path}`, {
      method: 'POST',
      body: JSON.stringify({ content })
    }),

  deleteFile: (path) =>
    apiRequest(`/api/file${path}`, {
      method: 'DELETE'
    }),

  createFolder: (path) =>
    apiRequest(`/api/folder${path}`, {
      method: 'POST'
    }),

  // Health
  health: () =>
    apiRequest('/health')
};
