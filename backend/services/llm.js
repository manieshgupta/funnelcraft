const axios = require('axios');

// Curated zero-cost fallback models per provider
const FALLBACK_MODELS = {
  openrouter: 'meta-llama/llama-3-8b-instruct:free',
  groq: 'llama-3.3-70b-versatile',
  gemini: 'gemini-1.5-flash' // Or gemini-2.5-flash / gemini-3.5-flash depending on API version
};

/**
 * Call the swappable OpenAI-compatible LLM provider with fallback handling.
 * 
 * @param {Object} options
 * @param {string} options.provider - 'openrouter' | 'groq' | 'gemini'
 * @param {string} options.apiKey - The decrypted API key
 * @param {string} options.modelSlug - The preferred model slug
 * @param {Array<Object>|string} options.messages - String prompt or array of message objects
 * @param {boolean} [options.jsonMode=false] - Whether to request structured JSON output
 * @param {boolean} [options.isRetry=false] - Tracker for recursive fallback retry
 * @returns {Promise<string>} - The LLM text response
 */
async function callLLM({ provider, apiKey, modelSlug, messages, jsonMode = false, isRetry = false }) {
  let baseURL = '';
  const headers = {
    'Content-Type': 'application/json'
  };

  // Map generic free auto-router slug to a reliable free model to prevent OpenRouter
  // from incorrectly routing the request to safety/moderation-only models (like Nemotron Safety)
  let activeModelSlug = modelSlug;
  if (provider === 'openrouter' && (modelSlug === 'openrouter/free' || !modelSlug)) {
    activeModelSlug = 'google/gemma-2-9b-it:free';
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
    console.log(`[LLM Service] Requesting ${provider} (Model: ${modelSlug}, JSON: ${jsonMode})`);
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

    console.error(`[LLM Service] Error from ${provider} (${modelSlug}): status=${status}, message=${errorMessage}`);

    // If it's already a retry, fail immediately
    if (isRetry) {
      throw new Error(`Primary and fallback LLM requests both failed. Error: ${errorMessage}`);
    }

    // Trigger fallback retry on Rate Limit (429) or Bad Request/Model Deprecation (400/404)
    const isRateLimit = status === 429;
    const isModelError = status === 400 || status === 404;
    const isDeprecation = errorMessage.toLowerCase().includes('deprecat') || errorMessage.toLowerCase().includes('model not found') || errorMessage.toLowerCase().includes('unknown model');

    if (isRateLimit || isModelError || isDeprecation) {
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
          isRetry: true
        });
      }
    }

    // Pass through other errors
    throw error;
  }
}

module.exports = { callLLM, FALLBACK_MODELS };
