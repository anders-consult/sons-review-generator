// api/reviews-write.js
// Persists a batch of generated verbatims to Notion.
// Also migrates the database schema on first call (idempotent PATCH).

const NOTION_DB_ID = '368bdac9506c806cbf3fd3b74e039b08';
const NOTION_VERSION = '2022-06-28';

// Module-level flag so schema migration only runs once per cold start.
let schemaReady = false;

async function ensureSchema(apiKey) {
  if (schemaReady) return;
  try {
    await fetch(`https://api.notion.com/v1/databases/${NOTION_DB_ID}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Notion-Version': NOTION_VERSION,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        properties: {
          Product: { rich_text: {} },
          Style: {
            select: {
              options: [
                { name: 'Normal', color: 'blue' },
                { name: 'Young', color: 'yellow' },
                { name: 'Insightful', color: 'green' },
              ],
            },
          },
          'German Text': { rich_text: {} },
          'English Text': { rich_text: {} },
          Platform: {
            select: {
              options: [
                { name: 'Shop Apotheke', color: 'orange' },
                { name: 'DocMorris', color: 'red' },
                { name: 'apo.com', color: 'purple' },
                { name: 'AEP', color: 'gray' },
              ],
            },
          },
        },
      }),
    });
    schemaReady = true;
  } catch (_) {
    // Schema already exists or insufficient permission — writes still proceed
    schemaReady = true;
  }
}

function richText(str) {
  // Notion rich_text items have a 2000-char limit per block
  const safe = (str || '').slice(0, 2000);
  return safe ? [{ text: { content: safe } }] : [];
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.NOTION_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'NOTION_API_KEY not configured' });

  const { reviews, product, style } = req.body || {};
  if (!Array.isArray(reviews) || reviews.length === 0) {
    return res.status(400).json({ error: '"reviews" array is required' });
  }

  try {
    await ensureSchema(apiKey);

    const writes = reviews.map(r =>
      fetch('https://api.notion.com/v1/pages', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Notion-Version': NOTION_VERSION,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          parent: { database_id: NOTION_DB_ID },
          properties: {
            Name: {
              title: [{ text: { content: r.title || 'Untitled' } }],
            },
            Product: { rich_text: richText(product) },
            Style: style ? { select: { name: style } } : undefined,
            'German Text': { rich_text: richText(r.de) },
            'English Text': { rich_text: richText(r.en) },
          },
        }),
      }).then(async resp => {
        if (!resp.ok) {
          const body = await resp.text();
          throw new Error(`Notion ${resp.status}: ${body}`);
        }
        return resp.json();
      })
    );

    const results = await Promise.allSettled(writes);
    const failed = results.filter(r => r.status === 'rejected').length;

    res.status(200).json({
      ok: true,
      saved: reviews.length - failed,
      failed,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
