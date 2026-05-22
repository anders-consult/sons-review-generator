// api/reviews-read.js
// Returns the most recent stored verbatims from Notion so the generator
// can avoid repeating them across sessions and users.

const NOTION_DB_ID = '368bdac9506c806cbf3fd3b74e039b08';
const NOTION_VERSION = '2022-06-28';
const MAX_REVIEWS = 50; // cap to keep the avoid-list in the prompt concise

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.NOTION_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'NOTION_API_KEY not configured' });

  try {
    const notionRes = await fetch(
      `https://api.notion.com/v1/databases/${NOTION_DB_ID}/query`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Notion-Version': NOTION_VERSION,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          page_size: MAX_REVIEWS,
          sorts: [{ timestamp: 'created_time', direction: 'descending' }],
        }),
      }
    );

    if (!notionRes.ok) {
      const body = await notionRes.text();
      throw new Error(`Notion ${notionRes.status}: ${body}`);
    }

    const data = await notionRes.json();

    const reviews = (data.results || [])
      .map(page => {
        const props = page.properties || {};
        const title =
          props['Name']?.title?.[0]?.plain_text ||
          props['Title']?.title?.[0]?.plain_text ||
          '';
        const de =
          props['German Text']?.rich_text?.[0]?.plain_text || '';
        return { title, de };
      })
      .filter(r => r.title && r.de);

    res.status(200).json({ reviews });
  } catch (err) {
    // Non-fatal: frontend falls back to session-only avoidance
    res.status(500).json({ error: err.message, reviews: [] });
  }
}
