const axios = require('axios');
require('dotenv').config();

/**
 * Generates a 1536-dimensional embedding vector for a given text input.
 * @param {string} text - The input string to embed.
 * @returns {Promise<Array<number>>} - A 1536-dimensional array of numbers.
 */
async function getEmbedding(text) {
  const apiKey = process.env.EMBEDDING_API_KEY;
  const provider = process.env.EMBEDDING_PROVIDER || 'openai'; // 'openai' | 'openrouter' | 'gemini'
  const model = process.env.EMBEDDING_MODEL_NAME || 'text-embedding-3-small';
  const apiUrl = process.env.EMBEDDING_API_URL || 'https://api.openai.com/v1/embeddings';

  if (!apiKey) {
    console.warn('[Embeddings] No EMBEDDING_API_KEY is configured. Returning mock 1536-dimensional zero-vector.');
    return new Array(1536).fill(0);
  }

  // Pre-clean text: replace newlines with spaces as recommended for embeddings
  const cleanText = text.replace(/\n/g, ' ');

  try {
    if (provider === 'gemini') {
      // Direct Google Gemini API call using the configured model slug
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:embedContent?key=${apiKey}`;
      const response = await axios.post(url, {
        content: { parts: [{ text: cleanText }] }
      });
      
      const values = response.data.embedding?.values;
      if (!values || !Array.isArray(values)) {
        throw new Error('Invalid response structure from Gemini embeddings API');
      }

      // Gemini's text-embedding-004 outputs 768 dimensions. We pad with zeros to 1536.
      if (values.length < 1536) {
        const padding = new Array(1536 - values.length).fill(0);
        return values.concat(padding);
      }
      return values.slice(0, 1536);
    } else {
      // OpenAI or OpenRouter standard compliant embedding API
      const response = await axios.post(
        apiUrl,
        {
          input: cleanText,
          model: model
        },
        {
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
          },
          timeout: 10000
        }
      );

      const embedding = response.data.data?.[0]?.embedding;
      if (!embedding || !Array.isArray(embedding)) {
        throw new Error('Invalid response structure from OpenAI-compatible embeddings API');
      }
      return embedding;
    }
  } catch (error) {
    console.error('[Embeddings] Error generating embedding:', error.response?.data || error.message);
    
    // In local development, return a mock vector rather than crashing the worker pipeline
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[Embeddings] Local fallback: returning mock zero-vector.');
      return new Array(1536).fill(0);
    }
    throw error;
  }
}

module.exports = { getEmbedding };
