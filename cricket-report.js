const SimpleCricketNewsAgent = require('../simple-cricket-agent');

// Vercel serverless function handler
export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    console.log('🏏 Cricket report API called');
    
    const agent = new SimpleCricketNewsAgent();
    const result = await agent.runDailyCricketReport();
    
    res.status(200).json({
      success: true,
      message: 'Cricket report sent successfully',
      articleCount: result.articleCount,
      sources: result.sources,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ API Error:', error);
    
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
}
