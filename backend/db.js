const { Pool } = require('pg');
require('dotenv').config();

const connectionString = process.env.DATABASE_URL || 
  'postgres://postgres:password@localhost:5432/ai_content_creator';

const pool = new Pool({
  connectionString,
  ssl: (process.env.NODE_ENV === 'production' && !connectionString.includes('localhost') && !connectionString.includes('127.0.0.1'))
    ? { rejectUnauthorized: false } 
    : false
});

// Helper to escape string values securely to prevent SQL injection in simple queries
function escapeSql(val) {
  if (val === null || val === undefined) return 'NULL';
  if (typeof val === 'boolean') return val ? 'true' : 'false';
  if (typeof val === 'number') return val.toString();
  return "'" + val.toString().replace(/'/g, "''") + "'";
}

// Intercepts query text and parameters, formatting them into a standard query string
function formatQuery(text, params) {
  if (!params || params.length === 0) return text;
  
  let formattedText = text;
  // Sort placeholders in descending order to avoid partial replacement of double-digit indexes
  const placeholders = params.map((val, idx) => ({
    placeholder: `$${idx + 1}`,
    value: escapeSql(val)
  })).sort((a, b) => b.placeholder.localeCompare(a.placeholder, undefined, { numeric: true }));

  for (const { placeholder, value } of placeholders) {
    const escapedPlaceholder = placeholder.replace('$', '\\$');
    const regex = new RegExp(escapedPlaceholder + '(?!\\d)', 'g');
    formattedText = formattedText.replace(regex, () => value);
  }

  return formattedText;
}

const dbModule = {
  // Execute a parameterized query by formatting it first to use the Simple Query Protocol
  query: (text, params) => {
    const formattedText = formatQuery(text, params);
    return pool.query(formattedText);
  },
  pool,
  
  // Helper to store a secret in the vault and get back its secret_id
  async createVaultSecret(rawSecret, name, description = 'User AI provider API key') {
    const queryText = `SELECT vault.create_secret($1, $2, $3) AS secret_id`;
    const result = await dbModule.query(queryText, [rawSecret, name, description]);
    return result.rows[0].secret_id;
  },

  // Helper to retrieve and decrypt a secret from the vault by its secret_id
  async getVaultSecret(secretId) {
    const queryText = `SELECT decrypted_secret FROM vault.decrypted_secrets WHERE id = $1`;
    const result = await dbModule.query(queryText, [secretId]);
    if (result.rows.length === 0) {
      throw new Error(`Secret not found in vault: ${secretId}`);
    }
    return result.rows[0].decrypted_secret;
  },

  // Helper to delete a secret from the vault by its secret_id
  async deleteVaultSecret(secretId) {
    const queryText = `DELETE FROM vault.secrets WHERE id = $1`;
    await dbModule.query(queryText, [secretId]);
  }
};

module.exports = dbModule;
