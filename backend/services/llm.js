const axios = require('axios');

// Curated zero-cost fallback models per provider (used for paid/specific model fallbacks)
const FALLBACK_MODELS = {
  openrouter: 'meta-llama/llama-3.3-70b-instruct:free',
  groq: 'llama-3.3-70b-versatile',
  gemini: 'gemini-1.5-flash'
};

// Pool of stable, active free models on OpenRouter (queried live from OpenRouter catalog)
const FREE_MODELS_POOL = [
  'meta-llama/llama-3.3-70b-instruct:free',
  'google/gemma-4-31b-it:free',
  'meta-llama/llama-3.2-3b-instruct:free',
  'nousresearch/hermes-3-llama-3.1-405b:free',
  'openai/gpt-oss-20b:free',
  'cognitivecomputations/dolphin-mistral-24b-venice-edition:free'
];

/**
 * Call the swappable OpenAI-compatible LLM provider with fallback handling.
 * 
 * @param {Object} options
 * @param {string} options.provider - 'openrouter' | 'groq' | 'gemini'
 * @param {string} options.apiKey - The decrypted API key
 * @param {string} options.modelSlug - The preferred model slug
 * @param {Array<Object>|string} options.messages - String prompt or array of message objects
 * @param {boolean} [options.jsonMode=false] - Whether to request structured JSON output
 * @param {number} [options.attemptIndex=0] - Tracker for cascading retry attempts
 * @returns {Promise<string>} - The LLM text response
 */
async function callLLM({ provider, apiKey, modelSlug, messages, jsonMode = false, attemptIndex = 0 }) {
  let baseURL = '';
  const headers = {
    'Content-Type': 'application/json'
  };

  // Map generic free auto-router slug to the active model from our free models pool
  let activeModelSlug = modelSlug;
  if (provider === 'openrouter') {
    if (modelSlug === 'openrouter/free' || !modelSlug) {
      activeModelSlug = FREE_MODELS_POOL[attemptIndex % FREE_MODELS_POOL.length];
    }
  }

  // Configure endpoint and auth headers
  if (provider === 'openrouter') {
    baseURL = 'https://openrouter.ai/api/v1/chat/completions';
    headers['Authorization'] = `Bearer ${apiKey}`;
    headers['HTTP-Referer'] = 'https://github.com/google-antigravity';
    headers['X-Title'] = 'AI Content Creator';
  } else if (provider === 'groq') {
    baseURL = 'https://api.groq.com/openai/v1/chat/completions';
    headers['Authorization'] = `Bearer ${apiKey}`;
  } else if (provider === 'gemini') {
    // Gemini's OpenAI-compatible endpoint
    baseURL = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
    headers['Authorization'] = `Bearer ${apiKey}`;
  } else {
    throw new Error(`Unsupported LLM provider: ${provider}`);
  }

  // Format prompt input
  const formattedMessages = typeof messages === 'string'
    ? [{ role: 'user', content: messages }]
    : messages;

  const requestBody = {
    model: activeModelSlug,
    messages: formattedMessages,
    temperature: 0.7
  };

  // Enable JSON mode if requested
  if (jsonMode) {
    requestBody.response_format = { type: 'json_object' };
    
    // Ensure JSON instruction is present in system/user message if using JSON mode
    const hasJsonInstruction = formattedMessages.some(m => 
      m.content.toLowerCase().includes('json')
    );
    if (!hasJsonInstruction) {
      formattedMessages.push({
        role: 'system',
        content: 'IMPORTANT: You must return your response as a valid JSON object.'
      });
    }
  }

  try {
    console.log(`[LLM Service] Requesting ${provider} (Model: ${activeModelSlug}, Attempt: ${attemptIndex}, JSON: ${jsonMode})`);
    const response = await axios.post(baseURL, requestBody, { headers, timeout: 60000 });
    
    const content = response.data?.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error('No content returned from LLM provider.');
    }
    return content;
  } catch (error) {
    const status = error.response?.status;
    const errorData = error.response?.data;
    const errorMessage = errorData?.error?.message || error.message;

    console.error(`[LLM Service] Error from ${provider} (${activeModelSlug}): status=${status}, message=${errorMessage}`);

    // Case A: Free model on OpenRouter has no active endpoints or has rate limits -> cycle to next free model in pool
    const isFreeOpenRouter = provider === 'openrouter' && (modelSlug === 'openrouter/free' || modelSlug.endsWith(':free'));
    
    if (isFreeOpenRouter && attemptIndex < 5) {
      const nextAttempt = attemptIndex + 1;
      const nextModel = FREE_MODELS_POOL[nextAttempt % FREE_MODELS_POOL.length];
      const waitTime = status === 429 ? 3000 : 1500;
      console.warn(`[LLM Service] Free endpoint failed. Retrying (Attempt ${nextAttempt}/5) in ${waitTime}ms with next pool model: ${nextModel}...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
      return callLLM({
        provider,
        apiKey,
        modelSlug, // Keep original slug so it retrieves the next index in the pool recursively
        messages,
        jsonMode,
        attemptIndex: nextAttempt
      });
    }

    // Case B: Paid / specific model failed -> try the default fallback model once
    const isRateLimit = status === 429;
    const isModelError = status === 400 || status === 404;
    const isDeprecation = errorMessage.toLowerCase().includes('deprecat') || errorMessage.toLowerCase().includes('model not found') || errorMessage.toLowerCase().includes('unknown model');

    if (attemptIndex === 0 && (isRateLimit || isModelError || isDeprecation)) {
      const fallbackModel = FALLBACK_MODELS[provider];
      if (fallbackModel && fallbackModel !== modelSlug) {
        console.warn(`[LLM Service] Rate limit/error hit. Sleeping 2 seconds before retrying with fallback model: ${fallbackModel}...`);
        await new Promise(resolve => setTimeout(resolve, 2000));
        return callLLM({
          provider,
          apiKey,
          modelSlug: fallbackModel,
          messages,
          jsonMode,
          attemptIndex: 1
        });
      }
    }

    // Pass through errors if all attempts are exhausted
    throw new Error(`LLM request failed (attempts exhausted). Error: ${errorMessage}`);
  }
}

module.exports = { callLLM, FALLBACK_MODELS };
