/**
 * Resolves the backend API URL dynamically based on the environment.
 * If VITE_API_URL is configured (e.g. in Vercel settings), it will use it.
 * Otherwise, it falls back to the local backend port.
 * 
 * @param {string} path - The API endpoint path starting with a slash (e.g. '/api/auth/login')
 * @returns {string} - The full request URL
 */
export const getApiUrl = (path) => {
  const base = import.meta.env.VITE_API_URL || 'http://localhost:5000';
  // Remove trailing slash if present in the base URL
  const cleanBase = base.endsWith('/') ? base.slice(0, -1) : base;
  return `${cleanBase}${path}`;
};
