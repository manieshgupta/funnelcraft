const db = require('../db');

/**
 * Checks if a candidate content draft is a near-duplicate of recently generated/published items.
 * @param {string} userId - User UUID
 * @param {Array<number>} embedding - 1536-dimensional embedding vector of the candidate content
 * @param {number} [threshold=0.92] - Cosine similarity threshold
 * @returns {Promise<{isDuplicate: boolean, similarity: number, duplicate: Object|null}>}
 */
async function checkDuplicate(userId, embedding, threshold = 0.92) {
  if (!embedding || embedding.every(val => val === 0)) {
    return { isDuplicate: false, similarity: 0, duplicate: null };
  }

  // Format array to pgvector literal '[0.123, 0.456, ...]'
  const vectorStr = `[${embedding.join(',')}]`;
  
  try {
    const queryText = `
      SELECT id, platform, title, status, created_at, (1 - (embedding <=> $1::vector)) as similarity 
      FROM public.published_content 
      WHERE user_id = $2 
        AND created_at >= NOW() - INTERVAL '90 days'
      ORDER BY embedding <=> $1::vector 
      LIMIT 1
    `;
    const result = await db.query(queryText, [vectorStr, userId]);

    if (result.rows.length > 0) {
      const match = result.rows[0];
      const similarity = parseFloat(match.similarity);
      if (similarity > threshold) {
        return {
          isDuplicate: true,
          similarity,
          duplicate: match
        };
      }
      return {
        isDuplicate: false,
        similarity,
        duplicate: match
      };
    }

    return { isDuplicate: false, similarity: 0, duplicate: null };
  } catch (error) {
    console.error('[Vector Service] Near-duplicate check failed:', error.message);
    // Fail-open locally to prevent blocking dev work if pgvector configuration contains errors
    return { isDuplicate: false, similarity: 0, duplicate: null };
  }
}

/**
 * Performs a vector cosine similarity search on knowledge chunks for RAG.
 * @param {string} userId - User UUID
 * @param {Array<number>} embedding - 1536-dimensional search query embedding
 * @param {number} [limit=5] - Number of chunks to retrieve
 * @returns {Promise<Array<{content: string, source: string, similarity: number}>>}
 */
async function searchKnowledgeChunks(userId, embedding, limit = 5) {
  if (!embedding || embedding.every(val => val === 0)) {
    return [];
  }

  const vectorStr = `[${embedding.join(',')}]`;

  try {
    const queryText = `
      SELECT content, source, (1 - (embedding <=> $1::vector)) as similarity
      FROM public.knowledge_chunks
      WHERE user_id = $2
      ORDER BY embedding <=> $1::vector
      LIMIT $3
    `;
    const result = await db.query(queryText, [vectorStr, userId, limit]);
    return result.rows;
  } catch (error) {
    console.error('[Vector Service] RAG vector search failed:', error.message);
    return [];
  }
}

module.exports = {
  checkDuplicate,
  searchKnowledgeChunks
};
