const { Worker } = require('bullmq');
const db = require('./db');
const { callLLM } = require('./services/llm');
const { crawlWebsite } = require('./services/crawler');
const { parsePDF } = require('./services/pdf');
const { getEmbedding } = require('./services/embeddings');
const { downloadAndStoreImage } = require('./services/images');
const { checkDuplicate, searchKnowledgeChunks } = require('./services/dedup');
const { registerDirectProcessor, redisClient } = require('./queue');
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

require('dotenv').config();

// Initialize Supabase Client
let supabase = null;
if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
  supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

// -------------------------------------------------------------
// HELPER: Fetch Serper Web Search Results
// -------------------------------------------------------------
async function searchWeb(query) {
  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) {
    console.warn('[Web Search] No SERPER_API_KEY provided. Returning mock search results for local testing.');
    return [
      { title: `SEO Guide on ${query}`, link: 'https://example.com/seo-guide', snippet: `Best practices and tips regarding ${query} in the current year.` },
      { title: `Top Competitor Trends for ${query}`, link: 'https://example.com/trends', snippet: `A breakdown of what leaders are posting about ${query} right now.` },
      { title: `How to Scale ${query}`, link: 'https://example.com/how-to-scale', snippet: `Practical guide detailing strategy, operations, and mistakes to avoid around ${query}.` }
    ];
  }

  try {
    const response = await axios.post(
      'https://google.serper.dev/search',
      { q: query, num: 6 },
      {
        headers: {
          'X-API-KEY': apiKey,
          'Content-Type': 'application/json'
        },
        timeout: 10000
      }
    );
    return (response.data.organic || []).map(item => ({
      title: item.title,
      link: item.link,
      snippet: item.snippet
    }));
  } catch (error) {
    console.error('[Web Search] Serper search failed:', error.message);
    return [];
  }
}

// -------------------------------------------------------------
// HELPER: Retrieve compiled profile context for LLM prompt context
// -------------------------------------------------------------
async function getUserProfileContext(userId) {
  const userResult = await db.query(`SELECT account_type FROM public.users WHERE id = $1`, [userId]);
  if (userResult.rows.length === 0) {
    return '';
  }
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
Services/Products Offered:
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

// -------------------------------------------------------------
// HELPER: Decrypt credentials and resolve preferred model
// -------------------------------------------------------------
async function getUserLLMConfig(userId, taskType) {
  const credsResult = await db.query(
    `SELECT provider, vault_secret_id, is_valid FROM public.user_ai_credentials WHERE user_id = $1`,
    [userId]
  );

  if (credsResult.rows.length === 0) {
    throw new Error('API key not configured. Please add an API key in Settings.');
  }

  const creds = credsResult.rows[0];
  if (!creds.is_valid) {
    throw new Error('API credentials are marked invalid. Please check your key in Settings.');
  }

  let apiKey;
  try {
    apiKey = await db.getVaultSecret(creds.vault_secret_id);
  } catch (err) {
    await db.query(
      `UPDATE public.user_ai_credentials SET is_valid = false, last_validated_at = NOW() WHERE user_id = $1`,
      [userId]
    );
    throw new Error('Failed to decrypt credentials. Please re-enter your key in Settings.');
  }

  // Fetch model preference
  const prefResult = await db.query(
    `SELECT model_slug FROM public.user_model_preferences WHERE user_id = $1 AND task_type = $2`,
    [userId, taskType]
  );

  let modelSlug;
  if (prefResult.rows.length > 0) {
    modelSlug = prefResult.rows[0].model_slug;
  } else {
    // Default fallback model slugs per provider
    if (creds.provider === 'groq') {
      modelSlug = 'llama-3.3-70b-versatile';
    } else if (creds.provider === 'gemini') {
      modelSlug = 'gemini-1.5-flash';
    } else {
      modelSlug = 'openrouter/free';
    }
  }

  return { provider: creds.provider, apiKey, modelSlug };
}

// -------------------------------------------------------------
// JOB HANDLER: Onboarding Research
// -------------------------------------------------------------
async function handleOnboardingResearch(userId, payload) {
  console.log(`[Worker] Running onboarding research for User ${userId}`);
  
  // Find account type
  const userResult = await db.query(`SELECT account_type FROM public.users WHERE id = $1`, [userId]);
  if (userResult.rows.length === 0) {
    throw new Error('User not found in database.');
  }
  const { account_type } = userResult.rows[0];
  const config = await getUserLLMConfig(userId, 'planning');

  let crawledContent = '';
  const knowledgeBase = [];

  if (account_type === 'company') {
    await db.query(`UPDATE public.company_profile SET onboarding_status = 'processing' WHERE user_id = $1`, [userId]);
    const profileRes = await db.query(`SELECT company_name, website_url, linkedin_url FROM public.company_profile WHERE user_id = $1`, [userId]);
    const profile = profileRes.rows[0];

    // Crawl site
    if (profile.website_url) {
      console.log(`[Worker] Crawling website: ${profile.website_url}`);
      const pages = await crawlWebsite(profile.website_url, 15);
      for (const p of pages) {
        crawledContent += `Page: ${p.url}\nTitle: ${p.title}\nContent:\n${p.content}\n\n`;
        knowledgeBase.push({ source: 'website', content: `Source: ${p.url}\nTitle: ${p.title}\n\n${p.content}` });
      }
    }

    // Crawl mock LinkedIn
    if (profile.linkedin_url) {
      knowledgeBase.push({ source: 'linkedin', content: `Crawl date: ${new Date().toISOString()}\nTarget URL: ${profile.linkedin_url}\nNote: Scrape limited due to ToS restrictions. Manual post pasting is recommended.` });
    }

    // Call LLM to extract profile
    const prompt = `You are an expert research analyst. Extract a structured profile for this company based on their crawled website data.
Website Text:
"""
${crawledContent.substring(0, 35000)}
"""

Provide your extraction strictly as a JSON object with this shape:
{
  "summary": "High-level company summary",
  "industry": "Industry classification",
  "icp_description": "Detailed description of the Ideal Customer Profile",
  "services": [{"name": "service or product name", "description": "short description"}],
  "brand_tone": "Brand tone and voice guidelines (e.g. authoritative but conversational)",
  "content_pillars": ["Pillar 1", "Pillar 2", "Pillar 3", "Pillar 4", "Pillar 5"]
}`;

    const rawResponse = await callLLM({
      provider: config.provider,
      apiKey: config.apiKey,
      modelSlug: config.modelSlug,
      messages: prompt,
      jsonMode: true
    });

    const extraction = JSON.parse(rawResponse);

    // Save company profile
    await db.query(
      `UPDATE public.company_profile 
       SET summary = $1, industry = $2, icp_description = $3, services = $4, brand_tone = $5, content_pillars = $6, onboarding_status = 'complete'
       WHERE user_id = $7`,
      [
        extraction.summary,
        extraction.industry,
        extraction.icp_description,
        JSON.stringify(extraction.services),
        extraction.brand_tone,
        JSON.stringify(extraction.content_pillars || []),
        userId
      ]
    );

  } else {
    // Personal Branding onboarding
    await db.query(`UPDATE public.personal_profile SET onboarding_status = 'processing' WHERE user_id = $1`, [userId]);
    const profileRes = await db.query(`SELECT full_name, resume_url, portfolio_url, target_audience, content_goal FROM public.personal_profile WHERE user_id = $1`, [userId]);
    const profile = profileRes.rows[0];

    let resumeText = '';
    // Download and parse resume PDF
    if (profile.resume_url) {
      console.log(`[Worker] Downloading resume from storage: ${profile.resume_url}`);
      let pdfBuffer;
      let isParsed = false;
      if (supabase) {
        try {
          const { data, error } = await supabase.storage.from('resumes').download(profile.resume_url);
          if (error) throw error;
          pdfBuffer = Buffer.from(await data.arrayBuffer());
          resumeText = await parsePDF(pdfBuffer);
          isParsed = true;
        } catch (err) {
          console.warn('[Worker] Failed to download/parse resume from Supabase storage, trying local fallback:', err.message);
        }
      }

      if (!isParsed) {
        // Local fallback path
        const localPath = path.join(__dirname, 'public', profile.resume_url);
        if (fs.existsSync(localPath)) {
          try {
            pdfBuffer = fs.readFileSync(localPath);
            resumeText = await parsePDF(pdfBuffer);
            isParsed = true;
          } catch (err) {
            console.error('[Worker] Error parsing local resume PDF:', err.message);
          }
        }
      }

      if (!isParsed) {
        console.warn('[Worker] Resume file not found or failed to parse. Using placeholder text.');
        resumeText = 'Resume placeholder text: Software Engineer seeking roles, experienced in full stack development and AI integration.';
      }
      
      knowledgeBase.push({ source: 'resume', content: `User Resume Text:\n${resumeText}` });
    }

    // Crawl Portfolio
    let portfolioText = '';
    if (profile.portfolio_url) {
      console.log(`[Worker] Crawling portfolio URL: ${profile.portfolio_url}`);
      const pages = await crawlWebsite(profile.portfolio_url, 10);
      for (const p of pages) {
        portfolioText += `Page: ${p.url}\nTitle: ${p.title}\nContent:\n${p.content}\n\n`;
        knowledgeBase.push({ source: 'portfolio', content: `Portfolio Source: ${p.url}\n${p.content}` });
      }
    }

    const prompt = `You are a career and brand coaching assistant. Extract professional brand pillars and a summary from this individual's resume and portfolio text.
Resume Text:
"""
${resumeText}
"""
Portfolio Text:
"""
${portfolioText.substring(0, 20000)}
"""

Provide your extraction strictly as a JSON object with this shape:
{
  "summary": "Synthesized profile summarizing their unique expertise and professional angle",
  "content_pillars": [
    "Content Pillar 1 - focused topic of expertise",
    "Content Pillar 2",
    "Content Pillar 3"
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

    // Update personal profile
    await db.query(
      `UPDATE public.personal_profile
       SET summary = $1, content_pillars = $2, onboarding_status = 'complete'
       WHERE user_id = $3`,
      [
        extraction.summary,
        JSON.stringify(extraction.content_pillars),
        userId
      ]
    );
  }

  // -------------------------------------------------------------
  // Chunk and embed the extracted knowledge base into pgvector
  // -------------------------------------------------------------
  console.log(`[Worker] Chunking and embedding knowledge base (Count: ${knowledgeBase.length})`);
  for (const item of knowledgeBase) {
    const text = item.content;
    // Simple chunking strategy: split by paragraph/size ~1000 characters
    const paragraphs = text.split('\n\n').filter(p => p.trim().length > 50);
    let currentChunk = '';
    
    for (const p of paragraphs) {
      if ((currentChunk + '\n\n' + p).length > 2000) {
        if (currentChunk.trim().length > 0) {
          const embedding = await getEmbedding(currentChunk);
          await db.query(
            `INSERT INTO public.knowledge_chunks (user_id, source, content, embedding) VALUES ($1, $2, $3, $4::vector)`,
            [userId, item.source, currentChunk, `[${embedding.join(',')}]`]
          );
        }
        currentChunk = p;
      } else {
        currentChunk += (currentChunk.length === 0 ? '' : '\n\n') + p;
      }
    }
    
    if (currentChunk.trim().length > 0) {
      const embedding = await getEmbedding(currentChunk);
      await db.query(
        `INSERT INTO public.knowledge_chunks (user_id, source, content, embedding) VALUES ($1, $2, $3, $4::vector)`,
        [userId, item.source, currentChunk, `[${embedding.join(',')}]`]
      );
    }
  }

  console.log(`[Worker] Completed onboarding research for User ${userId}`);
}

// -------------------------------------------------------------
// JOB HANDLER: Blog Title Suggestions
// -------------------------------------------------------------
async function handleBlogTitles(userId, payload) {
  const { topic } = payload;
  console.log(`[Worker] Generating blog titles for User ${userId} (Topic: ${topic})`);

  const config = await getUserLLMConfig(userId, 'planning');
  
  // 1. Fetch user profile context
  const profileContext = await getUserProfileContext(userId);
  const compRes = await db.query(`SELECT industry FROM public.company_profile WHERE user_id = $1`, [userId]);
  const industry = compRes.rows.length > 0 ? compRes.rows[0].industry : 'business technology';

  // 2. Perform Web Competitor Search
  const searchQuery = `${topic} blog`;
  console.log(`[Worker] Searching web for competitor content: "${searchQuery}"`);
  const searchResults = await searchWeb(searchQuery);

  // Store competitor contents in competitor_content_seen and embed them
  for (const item of searchResults) {
    const embedText = `Title: ${item.title}\nSnippet: ${item.snippet}`;
    const embedding = await getEmbedding(embedText);
    
    await db.query(
      `INSERT INTO public.competitor_content_seen (user_id, platform, url, title, summary, embedding) 
       VALUES ($1, 'blog', $2, $3, $4, $5::vector)
       ON CONFLICT DO NOTHING`,
      [userId, item.link, item.title, item.snippet, `[${embedding.join(',')}]`]
    );
  }

  // 3. Gap Analysis & Title Creation
  const gapAnalysisPrompt = `You are an SEO Content Planner. Perform a gap analysis on these competitor articles regarding "${topic}" for a company in "${industry}".
Competitors Articles:
${searchResults.map((r, i) => `${i+1}. Title: ${r.title}\n   Snippet: ${r.snippet}`).join('\n\n')}

Our Brand Profile Context:
${profileContext}

Based on this, identify content gaps and generate 4 high-ranking blog title suggestions that would outrank these competitors and be directly relevant to our business, services, and target audience.
For each suggestion, provide a Rank (1 to 4), Title, Rationale, and target SEO keywords.

Return your response strictly as a JSON object with this shape:
{
  "suggestions": [
    {
      "title": "Proposed Blog Title",
      "rank": 1,
      "rationale": "Why this title fills a gap and will outrank competitors",
      "target_keywords": ["keyword 1", "keyword 2"]
    }
  ]
}`;

  const rawResponse = await callLLM({
    provider: config.provider,
    apiKey: config.apiKey,
    modelSlug: config.modelSlug,
    messages: gapAnalysisPrompt,
    jsonMode: true
  });

  const extraction = JSON.parse(rawResponse);

  // 4. Save suggestions to database
  await db.query(
    `INSERT INTO public.blog_title_suggestions (user_id, input_topic, suggestions)
     VALUES ($1, $2, $3)`,
    [userId, topic, JSON.stringify(extraction.suggestions)]
  );

  return extraction.suggestions;
}

// -------------------------------------------------------------
// JOB HANDLER: Blog Draft Generation
// -------------------------------------------------------------
async function handleBlogDraft(userId, payload) {
  const { title } = payload;
  console.log(`[Worker] Generating blog draft for User ${userId} (Title: ${title})`);

  const config = await getUserLLMConfig(userId, 'draft');
  
  // 1. Vector Embed the chosen title to retrieve RAG chunks
  const titleEmbedding = await getEmbedding(title);
  const relevantChunks = await searchKnowledgeChunks(userId, titleEmbedding, 5);
  const ragContext = relevantChunks.map(c => `[Context from Onboarding]:\n${c.content}`).join('\n\n');

  // 2. Fetch profile context
  const profileContext = await getUserProfileContext(userId);

  // 3. Request LLM draft
  const prompt = `You are a professional blog writer. Write a comprehensive, high-quality, SEO-optimized blog draft on the title: "${title}" for our brand.
  
Our Brand Profile Context:
${profileContext}

Incorporate the following target/background knowledge context if relevant:
${ragContext}

Structure your blog using markdown:
- An engaging introduction hook.
- Use clean H2 and H3 subheadings.
- Naturally integrate relevant keywords (do not stuff).
- Dedicate sections to specific company expertise or unique angles.
- Conclude with a strong, relevant Call to Action (CTA) matching the post goals.

Your output must be between 1200 and 2000 words. At the end of the text, list 4-5 target keywords in a JSON section.`;

  let blogText = await callLLM({
    provider: config.provider,
    apiKey: config.apiKey,
    modelSlug: config.modelSlug,
    messages: prompt
  });

  // Extract keywords if any, or general list
  const keywords = [title.split(' ')[0], "seo blog", "industry tips"];

  // 4. Near-duplicate cosine similarity check against database
  const draftEmbedding = await getEmbedding(blogText.substring(0, 1000));
  const dupCheck = await checkDuplicate(userId, draftEmbedding, 0.92);

  if (dupCheck.isDuplicate) {
    console.warn(`[Worker] Near-duplicate detected (Similarity: ${dupCheck.similarity}) against ${dupCheck.duplicate.id}. Regenerating draft with angle shift.`);
    const shiftPrompt = `Your previous draft was too similar to an existing post. Please rewrite the blog draft on "${title}" from a completely different angle. Focus on alternative use cases, contrasting perspectives, or newer developments. Avoid repeating phrases from previous content.
Previous draft draft summary: ${dupCheck.duplicate.title}`;

    blogText = await callLLM({
      provider: config.provider,
      apiKey: config.apiKey,
      modelSlug: config.modelSlug,
      messages: [
        { role: 'user', content: prompt },
        { role: 'assistant', content: blogText },
        { role: 'user', content: shiftPrompt }
      ]
    });
  }

  // 5. Image generation step (Pollinations.ai)
  console.log('[Worker] Sourcing and downloading cover image');
  const imagePrompt = `A professional, realistic high-quality conceptual photograph representing: ${title}. Detailed scenery, corporate technology setting, clean natural lighting, DSLR photo, 4k resolution, no text, clean composition.`;
  const rehostedImageUrl = await downloadAndStoreImage(imagePrompt, userId);

  // Insert image markdown tag into body (usually right after the title or intro)
  const imageMarkdown = `\n![Blog Cover Image](${rehostedImageUrl})\n`;
  const paragraphs = blogText.split('\n');
  if (paragraphs.length > 2) {
    paragraphs.splice(2, 0, imageMarkdown);
    blogText = paragraphs.join('\n');
  } else {
    blogText = imageMarkdown + blogText;
  }

  // 6. Save final draft
  const finalEmbedding = await getEmbedding(blogText.substring(0, 1000));
  const insertResult = await db.query(
    `INSERT INTO public.published_content (user_id, platform, title, body, image_urls, embedding, status, keywords)
     VALUES ($1, 'blog', $2, $3, $4, $5::vector, 'draft', $6)
     RETURNING id`,
    [
      userId,
      title,
      blogText,
      JSON.stringify([rehostedImageUrl]),
      `[${finalEmbedding.join(',')}]`,
      JSON.stringify(keywords)
    ]
  );

  return {
    contentId: insertResult.rows[0].id,
    title,
    body: blogText,
    imageUrls: [rehostedImageUrl],
    keywords
  };
}

// -------------------------------------------------------------
// JOB HANDLER: LinkedIn Post Generation
// -------------------------------------------------------------
async function handleLinkedInDraft(userId, payload) {
  console.log(`[Worker] Generating LinkedIn draft for User ${userId}`);
  const config = await getUserLLMConfig(userId, 'linkedin');

  // 1. Fetch profile context and determine industry for search
  const profileContext = await getUserProfileContext(userId);
  
  const userResult = await db.query(`SELECT account_type FROM public.users WHERE id = $1`, [userId]);
  const accountType = userResult.rows[0]?.account_type;
  let industry = 'business technology';
  if (accountType === 'company') {
    const compRes = await db.query(`SELECT industry FROM public.company_profile WHERE user_id = $1`, [userId]);
    if (compRes.rows[0]?.industry) {
      industry = compRes.rows[0].industry;
    }
  } else {
    const persRes = await db.query(`SELECT job_role FROM public.personal_profile WHERE user_id = $1`, [userId]);
    if (persRes.rows[0]?.job_role) {
      industry = persRes.rows[0].job_role;
    }
  }

  // 2. Gather Style DNA Context (from onboarding knowledge base, including website content for companies)
  const styleChunks = await db.query(
    `SELECT content FROM public.knowledge_chunks WHERE user_id = $1 AND source IN ('website', 'linkedin', 'resume') LIMIT 4`,
    [userId]
  );
  const styleDNA = styleChunks.rows.map(r => r.content).join('\n---\n');

  // 3. Trend Research
  const searchQuery = `trending ${industry} posts site:linkedin.com`;
  console.log(`[Worker] Searching web for LinkedIn trend context: "${searchQuery}"`);
  const trendResults = await searchWeb(searchQuery);
  const trendContext = trendResults.map(r => r.title).join('\n');

  const prompt = `You are a social media copywriter. Write an engaging LinkedIn post (150-300 words) tailored to this brand:

Our Brand Profile Context:
${profileContext}

Format DNA to adopt:
- Start with an attention-grabbing hook line.
- Use plenty of paragraph breaks (white space) for mobile readability.
- Add 1-3 emojis naturally.
- Conclude with a conversational question or soft CTA.

Style & Background Knowledge DNA References:
"""
${styleDNA.substring(0, 4000)}
"""

Trending inspiration context in our domain:
"""
${trendContext}
"""

The post should discuss a modern insight related to our services and industry, providing real value. Do not repeat content of past posts.`;

  const postBody = await callLLM({
    provider: config.provider,
    apiKey: config.apiKey,
    modelSlug: config.modelSlug,
    messages: prompt
  });

  // Save to drafts
  const embedding = await getEmbedding(postBody.substring(0, 1000));
  const insertResult = await db.query(
    `INSERT INTO public.published_content (user_id, platform, title, body, embedding, status)
     VALUES ($1, 'linkedin', $2, $3, $4::vector, 'draft')
     RETURNING id`,
    [userId, 'LinkedIn Post Insight', postBody, `[${embedding.join(',')}]`]
  );

  return {
    contentId: insertResult.rows[0].id,
    title: 'LinkedIn Post Insight',
    body: postBody
  };
}

// -------------------------------------------------------------
// JOB HANDLER: Twitter Post Generation
// -------------------------------------------------------------
async function handleTwitterDraft(userId, payload) {
  console.log(`[Worker] Generating Twitter tweet for User ${userId}`);
  const config = await getUserLLMConfig(userId, 'twitter');

  // 1. Fetch profile context
  const profileContext = await getUserProfileContext(userId);

  // 2. Gather some RAG context
  const styleChunks = await db.query(
    `SELECT content FROM public.knowledge_chunks WHERE user_id = $1 LIMIT 4`,
    [userId]
  );
  const context = styleChunks.rows.map(r => r.content).join('\n');

  const prompt = `You are an expert ghostwriter. Write a powerful, punchy tweet (maximum 280 characters) for this brand:

Our Brand Profile Context:
${profileContext}

Additional Knowledge Context Chunks:
"""
${context}
"""

Follow these guidelines:
- Capture attention in the first 5 words.
- Provide a bold, contrarian take or a highly structured key value lesson directly relevant to our industry, services, or target audience.
- No hashtags. No generic fluff.

Ensure the final output is under 280 characters.`;

  const tweet = await callLLM({
    provider: config.provider,
    apiKey: config.apiKey,
    modelSlug: config.modelSlug,
    messages: prompt
  });

  const embedding = await getEmbedding(tweet);
  const insertResult = await db.query(
    `INSERT INTO public.published_content (user_id, platform, title, body, embedding, status)
     VALUES ($1, 'twitter', $2, $3, $4::vector, 'draft')
     RETURNING id`,
    [userId, 'Twitter Tweet', tweet, `[${embedding.join(',')}]`]
  );

  return {
    contentId: insertResult.rows[0].id,
    title: 'Twitter Tweet',
    body: tweet
  };
}

// -------------------------------------------------------------
// CENTRAL ROUTER: Maps job name to handler and updates Postgres
// -------------------------------------------------------------
async function processJob(job) {
  const { jobId, userId, payload } = job.data;
  const jobType = job.name;
  
  console.log(`[Worker] Processing Job ${jobId} (Type: ${jobType}) for User ${userId}`);

  try {
    // 1. Update jobs status in DB to 'running'
    await db.query(
      `UPDATE public.jobs SET status = 'running' WHERE id = $1`,
      [jobId]
    );

    let result;
    // 2. Dispatch to specific handler
    switch (jobType) {
      case 'onboarding_research':
        await handleOnboardingResearch(userId, payload);
        result = { success: true, message: 'Onboarding research completed.' };
        break;
      case 'blog_titles':
        result = await handleBlogTitles(userId, payload);
        break;
      case 'blog_draft':
        result = await handleBlogDraft(userId, payload);
        break;
      case 'linkedin_draft':
        result = await handleLinkedInDraft(userId, payload);
        break;
      case 'twitter_draft':
        result = await handleTwitterDraft(userId, payload);
        break;
      default:
        throw new Error(`Unknown job type: ${jobType}`);
    }

    // 3. Update jobs status to 'complete'
    await db.query(
      `UPDATE public.jobs 
       SET status = 'complete', result = $1, finished_at = NOW() 
       WHERE id = $2`,
      [JSON.stringify(result), jobId]
    );

    console.log(`[Worker] Job ${jobId} completed successfully.`);
  } catch (err) {
    console.error(`[Worker] Job ${jobId} failed:`, err.message);

    // Surface provider credentials rejection back to settings if 401/403 hit
    const isAuthError = err.message.includes('401') || err.message.includes('403') || err.message.toLowerCase().includes('api key');
    if (isAuthError) {
      await db.query(
        `UPDATE public.user_ai_credentials SET is_valid = false, last_validated_at = NOW() WHERE user_id = $1`,
        [userId]
      );
    }

    // Update jobs status to 'failed' in DB
    await db.query(
      `UPDATE public.jobs 
       SET status = 'failed', error = $1, finished_at = NOW() 
       WHERE id = $2`,
      [err.message, jobId]
    );
    
    throw err;
  }
}

// Connect back to the local direct execution trigger
registerDirectProcessor(processJob);

// -------------------------------------------------------------
// Initialize BullMQ Worker process if Redis is active
// -------------------------------------------------------------
if (redisClient) {
  try {
    const worker = new Worker('agent-jobs', processJob, {
      connection: redisClient,
      concurrency: 2
    });

    // Silence unhandled worker error events to prevent Node from printing stack traces
    worker.on('error', (err) => {});

    worker.on('failed', (job, err) => {
      console.error(`[BullMQ Worker] Job ${job?.id} failed:`, err.message);
    });

    console.log('[Worker] BullMQ Worker service listening for background queue jobs...');
  } catch (e) {
    console.warn('[Worker] BullMQ worker initialization failed. Running only in direct execution mode.');
  }
} else {
  console.log('[Worker] Redis inactive. Running in in-process direct execution mode only.');
}

module.exports = { processJob };
