const pdfParse = require('pdf-parse');

/**
 * Extracts plain text from a PDF file buffer.
 * @param {Buffer} buffer - The PDF file binary buffer.
 * @returns {Promise<string>} - The extracted plain text content.
 */
async function parsePDF(buffer) {
  try {
    const data = await pdfParse(buffer);
    return data.text || '';
  } catch (error) {
    console.error('[PDF Parser] Error parsing PDF buffer:', error);
    throw new Error('Failed to parse PDF document.');
  }
}

module.exports = { parsePDF };
