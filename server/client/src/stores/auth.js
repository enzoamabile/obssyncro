import { writable } from 'svelte/store';

export const auth = writable({
  token: localStorage.getItem('token') || null,
  email: localStorage.getItem('email') || null,
  isAuthenticated: !!localStorage.getItem('token')
});

export function login(email, token) {
  localStorage.setItem('token', token);
  localStorage.setItem('email', email);
  auth.set({ token, email, isAuthenticated: true });
}

export function logout() {
  localStorage.removeItem('token');
  localStorage.removeItem('email');
  auth.set({ token: null, email: null, isAuthenticated: false });
}
