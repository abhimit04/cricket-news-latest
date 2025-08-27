const CricketNewsAgent = require('../cricket-agent');

// Vercel serverless function handler
export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // Only allow GET and POST requests
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ 
      success: false, 
      error: 'Method not allowed. Use GET or POST.' 
    });
  }

  // Add timeout handling
  const timeout = setTimeout(() => {
    res.status(504).json({
      success: false,
      error: 'Request timeout - cricket report generation took too long',
      timestamp: new Date().toISOString()
    });
  }, 55000); // 55 seconds timeout (Vercel allows 60s max)

  try {
    console.log('🏏 Cricket report API called at:', new Date().toISOString());
    
    const agent = new CricketNewsAgent();
    const result = await agent.runDailyCricketReport();
    
    clearTimeout(timeout);
    
    res.status(200).json({
      success: true,
      message: 'Cricket report sent successfully',
      articleCount: result.articleCount,
      sources: result.sources,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    clearTimeout(timeout);
    console.error('❌ Cricket API Error:', error);
    
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString(),
      details: 'Check server logs for more information'
    });
  }
}