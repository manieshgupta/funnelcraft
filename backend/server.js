const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./db');
const authMiddleware = require('./middleware/auth');
const { enqueueJob } = require('./queue');
const { callLLM } = require('./services/llm');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use((req, res, next) => {
  console.log(`[API Request] ${req.method} ${req.path}`);
  next();
});
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Serve static images directory (used for local dev re-hosting)
app.use('/images', express.static(path.join(__dirname, 'public', 'images')));

// Ensure company_profile table has the content_pillars column
(async () => {
  try {
    await db.query(`ALTER TABLE public.company_profile ADD COLUMN IF NOT EXISTS content_pillars JSONB`);
    console.log('[Startup] DB Migrations completed successfully.');
  } catch (err) {
    console.warn('[Startup] Database migration warning:', err.message);
  }
})();

// HELPER: Escape string values to prevent SQL injection in simple queries
function escapeSql(val) {
  if (val === null || val === undefined) return 'NULL';
  if (typeof val === 'boolean') return val ? 'true' : 'false';
  if (typeof val === 'number') return val.toString();
  return "'" + val.toString().replace(/'/g, "''") + "'";
}

// -------------------------------------------------------------
// HELPER: Validate API key via minimal completion
// -------------------------------------------------------------
async function testAPIKey(provider, apiKey) {
  let modelSlug = 'openrouter/free';
  if (provider === 'groq') modelSlug = 'llama-3.3-70b-versatile';
  if (provider === 'gemini') modelSlug = 'gemini-1.5-flash';

  try {
    const response = await callLLM({
      provider,
      apiKey,
      modelSlug,
      messages: [{ role: 'user', content: 'Say OK' }]
    });
    return response.includes('OK') || response.trim().length > 0;
  } catch (err) {
    console.error('[API Key Validation] Validation failed:', err.message);
    return false;
  }
}

// User Login
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  try {
    const result = await db.query(
      `SELECT id, account_type FROM public.users WHERE email = ${escapeSql(email)}`
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User account not found. Please sign up first.' });
    }

    const user = result.rows[0];
    res.status(200).json({
      userId: user.id,
      accountType: user.account_type,
      token: `mock-user-${user.id}`
    });
  } catch (err) {
    console.error('[Login Endpoint] Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// SIGNUP ENDPOINTS (Auth & Profile Ingestion)
// -------------------------------------------------------------

// Company Signup
app.post('/api/auth/signup/company', async (req, res) => {
  const { userId, email, companyName, websiteUrl, linkedinUrl, provider, apiKey } = req.body;

  if (!email || !companyName || !provider || !apiKey) {
    return res.status(400).json({ error: 'Missing required signup fields.' });
  }

  // 1. Validate key (done BEFORE acquiring DB client to avoid holding it during HTTP request)
  try {
    const isValidKey = await testAPIKey(provider, apiKey);
    if (!isValidKey) {
      return res.status(400).json({ error: 'Invalid API Key. Verification check failed.' });
    }
  } catch (err) {
    return res.status(500).json({ error: 'Failed to validate API key: ' + err.message });
  }

  let resolvedUserId = userId || require('crypto').randomUUID();
  const { Client } = require('pg');
  const client = new Client({
    connectionString: process.env.DATABASE_URL || 'postgres://postgres:password@localhost:5432/ai_content_creator',
    ssl: (process.env.DATABASE_URL && (process.env.DATABASE_URL.includes('localhost') || process.env.DATABASE_URL.includes('127.0.0.1')))
      ? false
      : { rejectUnauthorized: false }
  });
  await client.connect();

  try {
    await client.query('BEGIN');

    // 2. Insert or retrieve from mock auth.users (for local dev and test support)
    try {
      const existingAuth = await client.query(`SELECT id FROM auth.users WHERE email = ${escapeSql(email)}`);
      if (existingAuth.rows.length > 0) {
        resolvedUserId = existingAuth.rows[0].id;
      } else {
        await client.query(
          `INSERT INTO auth.users (id, email) VALUES (${escapeSql(resolvedUserId)}, ${escapeSql(email)}) ON CONFLICT (id) DO NOTHING`
        );
      }
    } catch (e) {
      console.warn('[Signup] auth.users check/insert bypassed:', e.message);
    }

    // 3. Insert into public.users
    await client.query(
      `INSERT INTO public.users (id, email, account_type) VALUES (${escapeSql(resolvedUserId)}, ${escapeSql(email)}, 'company') ON CONFLICT (id) DO NOTHING`
    );

    // 4. Encrypt and store API key in Supabase Vault (delete existing first to avoid duplicate name index violations)
    const secretName = `ai_key_${resolvedUserId}`;
    await client.query(`DELETE FROM vault.secrets WHERE name = ${escapeSql(secretName)}`);

    const vaultRes = await client.query(
      `SELECT vault.create_secret(${escapeSql(apiKey)}, ${escapeSql(secretName)}, ${escapeSql(`User AI provider key for ${provider}`)}) AS secret_id`
    );
    const vaultSecretId = vaultRes.rows[0].secret_id;

    // 5. Insert credential row
    await client.query(
      `INSERT INTO public.user_ai_credentials (user_id, provider, vault_secret_id, is_valid, last_validated_at)
       VALUES (${escapeSql(resolvedUserId)}, ${escapeSql(provider)}, ${escapeSql(vaultSecretId)}, true, NOW())
       ON CONFLICT (user_id, provider) DO UPDATE SET vault_secret_id = EXCLUDED.vault_secret_id, is_valid = true, last_validated_at = NOW()`
    );

    // 6. Seed model preferences defaults in a bulk insert to prevent PgBouncer prepared statement deallocation collisions
    const defaultModels = [
      { task: 'planning', slug: provider === 'groq' ? 'llama-3.3-70b-versatile' : provider === 'gemini' ? 'gemini-1.5-flash' : 'openrouter/free' },
      { task: 'draft', slug: provider === 'groq' ? 'llama-3.3-70b-versatile' : provider === 'gemini' ? 'gemini-1.5-flash' : 'openrouter/free' },
      { task: 'linkedin', slug: provider === 'groq' ? 'llama-3.3-70b-versatile' : provider === 'gemini' ? 'gemini-1.5-flash' : 'openrouter/free' },
      { task: 'twitter', slug: provider === 'groq' ? 'llama-3.3-70b-versatile' : provider === 'gemini' ? 'gemini-1.5-flash' : 'openrouter/free' }
    ];

    const valuePlaceholders = defaultModels.map(pref =>
      `(${escapeSql(resolvedUserId)}, ${escapeSql(pref.task)}, ${escapeSql(pref.slug)})`
    ).join(', ');

    await client.query(
      `INSERT INTO public.user_model_preferences (user_id, task_type, model_slug)
       VALUES ${valuePlaceholders}
       ON CONFLICT (user_id, task_type) DO UPDATE SET model_slug = EXCLUDED.model_slug`
    );

    // 7. Create company profile
    await client.query(
      `INSERT INTO public.company_profile (user_id, company_name, website_url, linkedin_url, onboarding_status)
       VALUES (${escapeSql(resolvedUserId)}, ${escapeSql(companyName)}, ${escapeSql(websiteUrl)}, ${escapeSql(linkedinUrl)}, 'pending')
       ON CONFLICT (user_id) DO NOTHING`
    );

    await client.query('COMMIT');

    // 8. Enqueue onboarding background research job
    const jobId = await enqueueJob(resolvedUserId, 'onboarding_research', {});

    res.status(200).json({
      message: 'Company signup initiated successfully.',
      userId: resolvedUserId,
      jobId
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[Signup Endpoint] Error:', err);
    res.status(500).json({ error: 'Internal server error during signup initialization: ' + err.message });
  } finally {
    await client.end();
  }
});

// Personal Signup
app.post('/api/auth/signup/personal', async (req, res) => {
  const { userId, email, fullName, jobRole, resumeUrl, linkedinUrl, twitterUrl, portfolioUrl, targetAudience, contentGoal, provider, apiKey, resumeFile } = req.body;

  if (!email || !fullName || !provider || !apiKey) {
    return res.status(400).json({ error: 'Missing required signup fields.' });
  }

  // 1. Validate key (done BEFORE acquiring DB client)
  try {
    const isValidKey = await testAPIKey(provider, apiKey);
    if (!isValidKey) {
      return res.status(400).json({ error: 'Invalid API Key. Verification check failed.' });
    }
  } catch (err) {
    return res.status(500).json({ error: 'Failed to validate API key: ' + err.message });
  }

  let resolvedUserId = userId || require('crypto').randomUUID();

  // 2. Process and save base64 resumeFile if present
  let resolvedResumeUrl = resumeUrl || '';
  try {
    if (resumeFile && resumeFile.data) {
      const fs = require('fs');
      const path = require('path');
      const buffer = Buffer.from(resumeFile.data, 'base64');
      const fileName = `${resolvedUserId}_${Date.now()}_resume.pdf`;

      if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
        // Upload to Supabase Storage Bucket 'resumes'
        const { createClient } = require('@supabase/supabase-js');
        const supabaseAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
        const { data, error } = await supabaseAdmin.storage
          .from('resumes')
          .upload(fileName, buffer, {
            contentType: 'application/pdf',
            upsert: true
          });
        
        if (error) {
          console.error('[Signup PDF Ingestion] Supabase Storage failed:', error.message);
          throw error;
        }
        resolvedResumeUrl = fileName;
      } else {
        // Local folder storage
        const resumesDir = path.join(__dirname, 'public', 'resumes');
        if (!fs.existsSync(resumesDir)) {
          fs.mkdirSync(resumesDir, { recursive: true });
        }
        fs.writeFileSync(path.join(resumesDir, fileName), buffer);
        resolvedResumeUrl = `resumes/${fileName}`;
      }
    }
  } catch (err) {
    return res.status(500).json({ error: 'Failed to process resume: ' + err.message });
  }

  const { Client } = require('pg');
  const client = new Client({
    connectionString: process.env.DATABASE_URL || 'postgres://postgres:password@localhost:5432/ai_content_creator',
    ssl: (process.env.DATABASE_URL && (process.env.DATABASE_URL.includes('localhost') || process.env.DATABASE_URL.includes('127.0.0.1')))
      ? false
      : { rejectUnauthorized: false }
  });
  await client.connect();

  try {
    await client.query('BEGIN');

    // 3. Insert or retrieve from mock auth.users (for local dev and test support)
    try {
      const existingAuth = await client.query(`SELECT id FROM auth.users WHERE email = ${escapeSql(email)}`);
      if (existingAuth.rows.length > 0) {
        resolvedUserId = existingAuth.rows[0].id;
      } else {
        await client.query(
          `INSERT INTO auth.users (id, email) VALUES (${escapeSql(resolvedUserId)}, ${escapeSql(email)}) ON CONFLICT (id) DO NOTHING`
        );
      }
    } catch (e) {
      console.warn('[Signup] auth.users check/insert bypassed:', e.message);
    }

    // 4. Insert into public.users
    await client.query(
      `INSERT INTO public.users (id, email, account_type) VALUES (${escapeSql(resolvedUserId)}, ${escapeSql(email)}, 'personal') ON CONFLICT (id) DO NOTHING`
    );

    // 5. Encrypt and store API key in Supabase Vault (delete existing first to avoid duplicate name index violations)
    const secretName = `ai_key_${resolvedUserId}`;
    await client.query(`DELETE FROM vault.secrets WHERE name = ${escapeSql(secretName)}`);

    const vaultRes = await client.query(
      `SELECT vault.create_secret(${escapeSql(apiKey)}, ${escapeSql(secretName)}, ${escapeSql(`User AI provider key for ${provider}`)}) AS secret_id`
    );
    const vaultSecretId = vaultRes.rows[0].secret_id;

    // 6. Insert credentials
    await client.query(
      `INSERT INTO public.user_ai_credentials (user_id, provider, vault_secret_id, is_valid, last_validated_at)
       VALUES (${escapeSql(resolvedUserId)}, ${escapeSql(provider)}, ${escapeSql(vaultSecretId)}, true, NOW())
       ON CONFLICT (user_id, provider) DO UPDATE SET vault_secret_id = EXCLUDED.vault_secret_id, is_valid = true, last_validated_at = NOW()`
    );

    // 7. Seed model preferences in a bulk insert to prevent PgBouncer prepared statement deallocation collisions
    const defaultModels = [
      { task: 'planning', slug: provider === 'groq' ? 'llama-3.3-70b-versatile' : provider === 'gemini' ? 'gemini-1.5-flash' : 'openrouter/free' },
      { task: 'draft', slug: provider === 'groq' ? 'llama-3.3-70b-versatile' : provider === 'gemini' ? 'gemini-1.5-flash' : 'openrouter/free' },
      { task: 'linkedin', slug: provider === 'groq' ? 'llama-3.3-70b-versatile' : provider === 'gemini' ? 'gemini-1.5-flash' : 'openrouter/free' },
      { task: 'twitter', slug: provider === 'groq' ? 'llama-3.3-70b-versatile' : provider === 'gemini' ? 'gemini-1.5-flash' : 'openrouter/free' }
    ];

    const valuePlaceholders = defaultModels.map(pref =>
      `(${escapeSql(resolvedUserId)}, ${escapeSql(pref.task)}, ${escapeSql(pref.slug)})`
    ).join(', ');

    await client.query(
      `INSERT INTO public.user_model_preferences (user_id, task_type, model_slug)
       VALUES ${valuePlaceholders}
       ON CONFLICT (user_id, task_type) DO UPDATE SET model_slug = EXCLUDED.model_slug`
    );

    // 8. Create personal profile
    await client.query(
      `INSERT INTO public.personal_profile (user_id, full_name, job_role, resume_url, linkedin_url, twitter_url, portfolio_url, target_audience, content_goal, onboarding_status)
       VALUES (${escapeSql(resolvedUserId)}, ${escapeSql(fullName)}, ${escapeSql(jobRole)}, ${escapeSql(resolvedResumeUrl)}, ${escapeSql(linkedinUrl)}, ${escapeSql(twitterUrl)}, ${escapeSql(portfolioUrl)}, ${escapeSql(targetAudience)}, ${escapeSql(contentGoal)}, 'pending')
       ON CONFLICT (user_id) DO NOTHING`
    );

    await client.query('COMMIT');

    // 9. Enqueue onboarding research
    const jobId = await enqueueJob(resolvedUserId, 'onboarding_research', {});

    res.status(200).json({
      message: 'Personal signup initiated successfully.',
      userId: resolvedUserId,
      jobId
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[Signup Endpoint] Error:', err);
    res.status(500).json({ error: 'Internal server error during signup initialization: ' + err.message });
  } finally {
    await client.end();
  }
});

// -------------------------------------------------------------
// SECURED ENDPOINTS (Require Authorization JWT)
// -------------------------------------------------------------
app.use(authMiddleware);

// Get onboarding status
app.get('/api/onboarding/status', async (req, res) => {
  const userId = req.user.id;

  try {
    const userRes = await db.query(`SELECT account_type FROM public.users WHERE id = $1`, [userId]);
    if (userRes.rows.length === 0) {
      return res.status(404).json({ error: 'User profile not found.' });
    }

    const { account_type } = userRes.rows[0];
    let queryText = '';
    if (account_type === 'company') {
      queryText = `SELECT onboarding_status as status FROM public.company_profile WHERE user_id = $1`;
    } else {
      queryText = `SELECT onboarding_status as status FROM public.personal_profile WHERE user_id = $1`;
    }

    const statusRes = await db.query(queryText, [userId]);
    if (statusRes.rows.length === 0) {
      return res.status(200).json({ status: 'pending' });
    }

    res.status(200).json({ status: statusRes.rows[0].status });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get AI credentials status (never returns the raw key)
app.get('/api/settings/ai-credential', async (req, res) => {
  const userId = req.user.id;

  try {
    const result = await db.query(
      `SELECT provider, is_valid, last_validated_at FROM public.user_ai_credentials WHERE user_id = $1`,
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'No API Key registered' });
    }

    res.status(200).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Add / Rotate credentials
app.post('/api/settings/ai-credential', async (req, res) => {
  const userId = req.user.id;
  const { provider, apiKey } = req.body;

  if (!provider || !apiKey) {
    return res.status(400).json({ error: 'Provider and apiKey are required.' });
  }

  try {
    const isValidKey = await testAPIKey(provider, apiKey);
    if (!isValidKey) {
      return res.status(400).json({ error: 'API key verification failed.' });
    }

    // Upsert key in Vault
    const vaultSecretId = await db.createVaultSecret(
      apiKey,
      `ai_key_${userId}`,
      `User AI provider key for ${provider}`
    );

    await db.query(
      `INSERT INTO public.user_ai_credentials (user_id, provider, vault_secret_id, is_valid, last_validated_at)
       VALUES ($1, $2, $3, true, NOW())
       ON CONFLICT (user_id, provider) DO UPDATE SET vault_secret_id = EXCLUDED.vault_secret_id, is_valid = true, last_validated_at = NOW()`,
      [userId, provider, vaultSecretId]
    );

    res.status(200).json({ message: 'API key updated and verified successfully.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Revoke credentials
app.delete('/api/settings/ai-credential', async (req, res) => {
  const userId = req.user.id;

  try {
    const credsResult = await db.query(
      `SELECT vault_secret_id FROM public.user_ai_credentials WHERE user_id = $1`,
      [userId]
    );

    if (credsResult.rows.length > 0) {
      await db.deleteVaultSecret(credsResult.rows[0].vault_secret_id);
      await db.query(`DELETE FROM public.user_ai_credentials WHERE user_id = $1`, [userId]);
    }

    res.status(200).json({ message: 'API key revoked and deleted successfully.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get model preferences
app.get('/api/settings/model-preferences', async (req, res) => {
  const userId = req.user.id;

  try {
    const result = await db.query(
      `SELECT task_type, model_slug FROM public.user_model_preferences WHERE user_id = $1`,
      [userId]
    );

    const preferences = {};
    result.rows.forEach(row => {
      preferences[row.task_type] = row.model_slug;
    });

    res.status(200).json(preferences);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update model preference
app.put('/api/settings/model-preferences', async (req, res) => {
  const userId = req.user.id;
  const { taskType, modelSlug } = req.body;

  if (!taskType || !modelSlug) {
    return res.status(400).json({ error: 'taskType and modelSlug are required.' });
  }

  try {
    await db.query(
      `INSERT INTO public.user_model_preferences (user_id, task_type, model_slug)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, task_type) DO UPDATE SET model_slug = EXCLUDED.model_slug, updated_at = NOW()`,
      [userId, taskType, modelSlug]
    );

    res.status(200).json({ message: `Model preference for ${taskType} updated to ${modelSlug}.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// BLOG ENDPOINTS
// -------------------------------------------------------------

// Suggested Topics based on profile
app.get('/api/blog/suggested-topics', async (req, res) => {
  const userId = req.user.id;

  try {
    let pillars = [];
    
    // 1. Try company profile
    const compRes = await db.query(`SELECT content_pillars, industry FROM public.company_profile WHERE user_id = $1`, [userId]);
    if (compRes.rows.length > 0) {
      const row = compRes.rows[0];
      if (row.content_pillars) {
        pillars = typeof row.content_pillars === 'string' ? JSON.parse(row.content_pillars) : row.content_pillars;
      } else if (row.industry) {
        // Fallback to basic derivation if not generated yet
        pillars = [row.industry, `${row.industry} Trends`, `${row.industry} Scaling`].map(p => `${p} Marketing`);
      }
    } else {
      // 2. Try personal profile
      const persRes = await db.query(`SELECT content_pillars FROM public.personal_profile WHERE user_id = $1`, [userId]);
      if (persRes.rows.length > 0 && persRes.rows[0].content_pillars) {
        const row = persRes.rows[0];
        pillars = typeof row.content_pillars === 'string' ? JSON.parse(row.content_pillars) : row.content_pillars;
      }
    }

    if (!pillars || pillars.length === 0) {
      pillars = ['SEO Strategy Marketing', 'Content Writing Marketing', 'AI Agent Architecture Marketing'];
    }

    res.status(200).json({
      topics: pillars,
      gapAnalysisCompleted: true
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Helper: Compile profile context for LLM prompt
async function getUserProfileContext(userId) {
  const userResult = await db.query(`SELECT account_type FROM public.users WHERE id = $1`, [userId]);
  if (userResult.rows.length === 0) return '';
  const { account_type } = userResult.rows[0];

  if (account_type === 'company') {
    const compRes = await db.query(
      `SELECT company_name, summary, industry, icp_description, services, brand_tone FROM public.company_profile WHERE user_id = $1`,
      [userId]
    );
    if (compRes.rows.length > 0) {
      const profile = compRes.rows[0];
      let servicesText = '';
      try {
        const servicesList = typeof profile.services === 'string' ? JSON.parse(profile.services) : profile.services;
        if (Array.isArray(servicesList)) {
          servicesText = servicesList.map(s => `- ${s.name}: ${s.description}`).join('\n');
        }
      } catch (e) {
        servicesText = String(profile.services);
      }
      return `Company Name: ${profile.company_name}
Industry: ${profile.industry}
Summary: ${profile.summary}
Ideal Customer Profile: ${profile.icp_description}
Services Offered:
${servicesText}
Brand Tone: ${profile.brand_tone}`;
    }
  } else {
    const persRes = await db.query(
      `SELECT full_name, job_role, summary, target_audience, content_goal, content_pillars FROM public.personal_profile WHERE user_id = $1`,
      [userId]
    );
    if (persRes.rows.length > 0) {
      const profile = persRes.rows[0];
      let pillarsText = '';
      try {
        const pillarsList = typeof profile.content_pillars === 'string' ? JSON.parse(profile.content_pillars) : profile.content_pillars;
        if (Array.isArray(pillarsList)) {
          pillarsText = pillarsList.map(p => `- ${p}`).join('\n');
        }
      } catch (e) {
        pillarsText = String(profile.content_pillars);
      }
      return `Individual Name: ${profile.full_name}
Role/Specialty: ${profile.job_role}
Summary: ${profile.summary}
Target Audience: ${profile.target_audience}
Content Goal: ${profile.content_goal}
Content Pillars:
${pillarsText}`;
    }
  }
  return '';
}

// Helper: Retrieve credentials and preferred model
async function getUserLLMConfig(userId, taskType) {
  const credsResult = await db.query(
    `SELECT provider, vault_secret_id, is_valid FROM public.user_ai_credentials WHERE user_id = $1`,
    [userId]
  );
  if (credsResult.rows.length === 0) throw new Error('API key not configured.');
  const creds = credsResult.rows[0];
  if (!creds.is_valid) throw new Error('API credentials are marked invalid.');

  const apiKey = await db.getVaultSecret(creds.vault_secret_id);
  const prefResult = await db.query(
    `SELECT model_slug FROM public.user_model_preferences WHERE user_id = $1 AND task_type = $2`,
    [userId, taskType]
  );

  let modelSlug;
  if (prefResult.rows.length > 0) {
    modelSlug = prefResult.rows[0].model_slug;
  } else {
    modelSlug = creds.provider === 'groq' ? 'llama-3.3-70b-versatile' : creds.provider === 'gemini' ? 'gemini-1.5-flash' : 'openrouter/free';
  }
  return { provider: creds.provider, apiKey, modelSlug };
}

// Regenerate Suggested Content Pillars
app.post('/api/blog/suggested-topics/regenerate', async (req, res) => {
  const userId = req.user.id;

  try {
    const config = await getUserLLMConfig(userId, 'planning');
    const profileContext = await getUserProfileContext(userId);

    const prompt = `You are a content strategist. Brainstorm exactly 5 fresh, highly specific, and creative content/blog pillars (topics/themes) for our brand. They must be directly relevant to our specific business, services, and target audience. Do not return generic AI or general technology topics unless that is our core business.

Our Brand Profile Context:
${profileContext}

Provide your response strictly as a JSON object with this shape:
{
  "pillars": [
    "Specific Content Pillar 1",
    "Specific Content Pillar 2",
    "Specific Content Pillar 3",
    "Specific Content Pillar 4",
    "Specific Content Pillar 5"
  ]
}`;

    const rawResponse = await callLLM({
      provider: config.provider,
      apiKey: config.apiKey,
      modelSlug: config.modelSlug,
      messages: prompt,
      jsonMode: true
    });

    const extraction = JSON.parse(rawResponse);
    const pillars = extraction.pillars || [];

    // Save to DB
    const userResult = await db.query(`SELECT account_type FROM public.users WHERE id = $1`, [userId]);
    if (userResult.rows.length > 0) {
      const { account_type } = userResult.rows[0];
      if (account_type === 'company') {
        await db.query(
          `UPDATE public.company_profile SET content_pillars = $1 WHERE user_id = $2`,
          [JSON.stringify(pillars), userId]
        );
      } else {
        await db.query(
          `UPDATE public.personal_profile SET content_pillars = $1 WHERE user_id = $2`,
          [JSON.stringify(pillars), userId]
        );
      }
    }

    res.status(200).json({ topics: pillars });
  } catch (err) {
    console.error('[Regenerate Pillars Error]:', err);
    res.status(500).json({ error: err.message });
  }
});

// Enqueue blog titles job
app.post('/api/blog/titles', async (req, res) => {
  const userId = req.user.id;
  const { topic } = req.body;

  if (!topic) return res.status(400).json({ error: 'Topic is required.' });

  try {
    const jobId = await enqueueJob(userId, 'blog_titles', { topic });
    res.status(200).json({ jobId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Poll result of blog titles
app.get('/api/blog/titles/:jobId', async (req, res) => {
  const jobId = req.params.jobId;

  try {
    const result = await db.query(`SELECT status, result, error FROM public.jobs WHERE id = $1`, [jobId]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Job not found.' });

    const job = result.rows[0];
    res.status(200).json({
      status: job.status,
      suggestions: job.status === 'complete' ? job.result : [],
      error: job.error
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Enqueue blog draft writer job
app.post('/api/blog/generate', async (req, res) => {
  const userId = req.user.id;
  const { title } = req.body;

  if (!title) return res.status(400).json({ error: 'Title is required.' });

  try {
    const jobId = await enqueueJob(userId, 'blog_draft', { title });
    res.status(200).json({ jobId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Poll blog draft writer results
app.get('/api/blog/drafts/:jobId', async (req, res) => {
  const jobId = req.params.jobId;

  try {
    const result = await db.query(`SELECT status, result, error FROM public.jobs WHERE id = $1`, [jobId]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Job not found.' });

    const job = result.rows[0];
    res.status(200).json({
      status: job.status,
      draft: job.status === 'complete' ? job.result : null,
      error: job.error
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Mark blog as published
app.post('/api/blog/:contentId/mark-published', async (req, res) => {
  const contentId = req.params.contentId;
  const userId = req.user.id;

  try {
    await db.query(
      `UPDATE public.published_content 
       SET status = 'marked_published', published_at = NOW() 
       WHERE id = $1 AND user_id = $2`,
      [contentId, userId]
    );
    res.status(200).json({ message: 'Content marked as published.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// LINKEDIN ENDPOINTS
// -------------------------------------------------------------

// Enqueue LinkedIn post job
app.post('/api/linkedin/generate', async (req, res) => {
  const userId = req.user.id;

  try {
    const jobId = await enqueueJob(userId, 'linkedin_draft', {});
    res.status(200).json({ jobId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Poll draft
app.get('/api/linkedin/drafts/:jobId', async (req, res) => {
  const jobId = req.params.jobId;

  try {
    const result = await db.query(`SELECT status, result, error FROM public.jobs WHERE id = $1`, [jobId]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Job not found.' });

    const job = result.rows[0];
    res.status(200).json({
      status: job.status,
      draft: job.status === 'complete' ? job.result : null,
      error: job.error
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Mark as published
app.post('/api/linkedin/:contentId/mark-published', async (req, res) => {
  const contentId = req.params.contentId;
  const userId = req.user.id;

  try {
    await db.query(
      `UPDATE public.published_content 
       SET status = 'marked_published', published_at = NOW() 
       WHERE id = $1 AND user_id = $2`,
      [contentId, userId]
    );
    res.status(200).json({ message: 'LinkedIn post marked as published.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// TWITTER ENDPOINTS
// -------------------------------------------------------------

// Enqueue Twitter tweet job
app.post('/api/twitter/generate', async (req, res) => {
  const userId = req.user.id;

  try {
    const jobId = await enqueueJob(userId, 'twitter_draft', {});
    res.status(200).json({ jobId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Poll draft
app.get('/api/twitter/drafts/:jobId', async (req, res) => {
  const jobId = req.params.jobId;

  try {
    const result = await db.query(`SELECT status, result, error FROM public.jobs WHERE id = $1`, [jobId]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Job not found.' });

    const job = result.rows[0];
    res.status(200).json({
      status: job.status,
      draft: job.status === 'complete' ? job.result : null,
      error: job.error
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Mark as published
app.post('/api/twitter/:contentId/mark-published', async (req, res) => {
  const contentId = req.params.contentId;
  const userId = req.user.id;

  try {
    await db.query(
      `UPDATE public.published_content 
       SET status = 'marked_published', published_at = NOW() 
       WHERE id = $1 AND user_id = $2`,
      [contentId, userId]
    );
    res.status(200).json({ message: 'Tweet marked as published.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// CONTENT HISTORY ENDPOINTS
// -------------------------------------------------------------
app.get('/api/content/history', async (req, res) => {
  const userId = req.user.id;
  const platform = req.query.platform; // 'blog' | 'linkedin' | 'twitter'

  if (!platform) {
    return res.status(400).json({ error: 'platform query parameter is required.' });
  }

  try {
    const result = await db.query(
      `SELECT id, platform, title, body, image_urls, status, keywords, created_at, published_at 
       FROM public.published_content
       WHERE user_id = $1 AND platform = $2
       ORDER BY created_at DESC`,
      [userId, platform]
    );

    res.status(200).json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update existing content draft (save edit changes)
app.put('/api/content/:contentId', async (req, res) => {
  const contentId = req.params.contentId;
  const userId = req.user.id;
  const { title, body } = req.body;

  if (!title || !body) {
    return res.status(400).json({ error: 'Title and body are required.' });
  }

  try {
    const result = await db.query(
      `UPDATE public.published_content 
       SET title = $1, body = $2 
       WHERE id = $3 AND user_id = $4
       RETURNING id, title, body`,
      [title, body, contentId, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Content draft not found or unauthorized.' });
    }

    res.status(200).json({ message: 'Content draft updated successfully.', content: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update content status (publish/unpublish)
app.post('/api/content/:contentId/status', async (req, res) => {
  const contentId = req.params.contentId;
  const userId = req.user.id;
  const { status } = req.body;

  if (!status || !['draft', 'marked_published'].includes(status)) {
    return res.status(400).json({ error: 'Valid status is required.' });
  }

  try {
    const result = await db.query(
      `UPDATE public.published_content 
       SET status = $1, published_at = ${status === 'marked_published' ? 'NOW()' : 'NULL'} 
       WHERE id = $2 AND user_id = $3
       RETURNING id, status`,
      [status, contentId, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Content not found or unauthorized.' });
    }

    res.status(200).json({ message: `Status updated to ${status}.`, content: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete published content or draft
app.delete('/api/content/:contentId', async (req, res) => {
  const contentId = req.params.contentId;
  const userId = req.user.id;

  try {
    const result = await db.query(
      `DELETE FROM public.published_content 
       WHERE id = $1 AND user_id = $2
       RETURNING id`,
      [contentId, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Content not found or unauthorized.' });
    }

    res.status(200).json({ message: 'Content deleted successfully.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// GENERAL JOBS STATUS POLLING ENDPOINT
// -------------------------------------------------------------
app.get('/api/jobs/:id', async (req, res) => {
  const jobId = req.params.id;

  try {
    const result = await db.query(
      `SELECT id, user_id, job_type, status, result, error, created_at, finished_at 
       FROM public.jobs 
       WHERE id = $1`,
      [jobId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Job not found.' });
    }

    res.status(200).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Fallback JSON error-handling middleware for all uncaught/middleware exceptions
app.use((err, req, res, next) => {
  console.error('[Unhandled Server Error]', err);
  res.status(err.status || 500).json({
    error: err.message || 'An unexpected server error occurred.'
  });
});

// Start Express Listener
app.listen(PORT, () => {
  console.log(`[API Server] Express listening on http://localhost:${PORT}`);
});
