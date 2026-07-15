const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

// Initialize Supabase admin client if environment variables are provided
let supabase = null;
if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
  supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

/**
 * Generates an image using Pollinations.ai, downloads it, and re-hosts it
 * either on Supabase Storage or the local backend filesystem.
 * 
 * @param {string} promptText - The visual description/prompt for the image
 * @param {string} userId - The user UUID
 * @returns {Promise<string>} - The public URL of the re-hosted image
 */
async function downloadAndStoreImage(promptText, userId) {
  // Sanitize and URL-encode the prompt
  const sanitizedPrompt = encodeURIComponent(promptText.trim().substring(0, 300));
  const pollinationsUrl = `https://image.pollinations.ai/prompt/${sanitizedPrompt}?width=800&height=500&nologo=true&seed=${Math.floor(Math.random() * 1000000)}`;

  console.log(`[Images] Requesting image from Pollinations.ai: ${pollinationsUrl}`);
  try {
    const response = await axios.get(pollinationsUrl, { responseType: 'arraybuffer', timeout: 30000 });
    const buffer = Buffer.from(response.data, 'binary');

    const fileName = `${userId || 'system'}_${Date.now()}_${Math.random().toString(36).substring(7)}.jpg`;

    if (supabase) {
      console.log(`[Images] Uploading image to Supabase bucket 'content-images' as ${fileName}`);
      try {
        const { data, error } = await supabase.storage
          .from('content-images')
          .upload(fileName, buffer, {
            contentType: 'image/jpeg',
            cacheControl: '3600',
            upsert: false
          });

        if (error) {
          console.error('[Images] Supabase Storage upload error:', error.message);
          throw error;
        }

        const { data: publicUrlData } = supabase.storage
          .from('content-images')
          .getPublicUrl(fileName);

        return publicUrlData.publicUrl;
      } catch (uploadError) {
        console.warn(`[Images] Supabase upload failed (${uploadError.message}). Falling back to local file storage.`);
      }
    }

    // Local development storage fallback
    console.log('[Images] Storing image locally.');
    const publicDir = path.join(__dirname, '..', 'public', 'images');
    
    if (!fs.existsSync(publicDir)) {
      fs.mkdirSync(publicDir, { recursive: true });
    }

    const filePath = path.join(publicDir, fileName);
    fs.writeFileSync(filePath, buffer);

    // Resolve the local backend server port
    const port = process.env.PORT || 5000;
    return `http://localhost:${port}/images/${fileName}`;
  } catch (error) {
    console.error('[Images] Image generation or storage failed:', error.message);
    // Return a beautiful, generic tech background image from Unsplash as fallback
    return `https://images.unsplash.com/photo-1518770660439-4636190af475?w=800&auto=format&fit=crop&q=60`;
  }
}

module.exports = { downloadAndStoreImage };
