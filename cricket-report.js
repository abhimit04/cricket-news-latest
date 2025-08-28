// Move this file to: api/cricket-report.js

const cheerio = require('cheerio');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const nodemailer = require('nodemailer');
const axios = require('axios');

class SimpleCricketNewsAgent {
  constructor() {
    // Initialize Gemini AI
    this.genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY);
    this.model = this.genAI.getGenerativeModel({ model: "gemini-pro" });
    
    // Initialize email transporter
    this.transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD,
      },
    });
  }

  // Crawl cricket news using RSS feeds (more reliable for serverless)
  async crawlCricketNews() {
    const feeds = [
      {
        url: 'https://www.espncricinfo.com/rss/content/story/feeds/0.xml',
        source: 'ESPNCricinfo'
      },
      {
        url: 'https://cricbuzz.com/rss-feed/cricket-news',
        source: 'Cricbuzz'
      }
    ];

    const articles = [];
    
    for (const feed of feeds) {
      try {
        console.log(`Crawling ${feed.source}...`);
        
        const response = await axios.get(feed.url, {
          timeout: 15000,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          }
        });
        
        const $ = cheerio.load(response.data, { xmlMode: true });
        
        $('item').each((index, element) => {
          if (index >= 15) return false; // Limit per feed
          
          const $element = $(element);
          const title = $element.find('title').text().trim();
          const summary = $element.find('description').text().trim().replace(/<[^>]*>/g, '');
          const link = $element.find('link').text().trim();
          const pubDate = $element.find('pubDate').text().trim();
          
          if (title && link) {
            articles.push({
              title,
              summary: summary.substring(0, 300) + (summary.length > 300 ? '...' : ''),
              link,
              time: pubDate,
              source: feed.source
            });
          }
        });
        
        console.log(`✅ ${feed.source}: ${articles.filter(a => a.source === feed.source).length} articles`);
        
      } catch (error) {
        console.error(`❌ Error crawling ${feed.source}:`, error.message);
      }
    }

    // Try to get additional news from cricket APIs
    try {
      const apiNews = await this.crawlCricketAPI();
      articles.push(...apiNews);
    } catch (error) {
      console.error('API crawl failed:', error.message);
    }

    return this.removeDuplicates(articles).slice(0, 20);
  }

  // Try to get news from cricket APIs
  async crawlCricketAPI() {
    try {
      // Using a free cricket API (you might need to register for an API key)
      const response = await axios.get('https://api.cricapi.com/v1/currentMatches', {
        params: {
          apikey: process.env.CRICKET_API_KEY || 'demo-key', // Optional
          offset: 0
        },
        timeout: 10000
      });

      const matches = response.data?.data || [];
      
      return matches.slice(0, 5).map(match => ({
        title: `${match.name || 'Cricket Match'} - ${match.status || 'Live'}`,
        summary: `${match.teams?.[0] || ''} vs ${match.teams?.[1] || ''}. ${match.venue || ''}`,
        link: `https://cricapi.com/matches/${match.id}`,
        time: match.dateTimeGMT || new Date().toISOString(),
        source: 'CricAPI'
      }));
    } catch (error) {
      console.log('Cricket API not available:', error.message);
      return [];
    }
  }

  // Remove duplicates
  removeDuplicates(articles) {
    const unique = [];
    const seenTitles = new Set();
    
    for (const article of articles) {
      const normalizedTitle = article.title.toLowerCase().replace(/[^\w\s]/g, '');
      const words = normalizedTitle.split(' ').filter(w => w.length > 3);
      const titleKey = words.slice(0, 5).join(' ');
      
      if (!seenTitles.has(titleKey) && titleKey.length > 10) {
        seenTitles.add(titleKey);
        unique.push(article);
      }
    }
    
    return unique;
  }

  // Generate cricket report using Gemini AI
  async generateCricketReport(articles) {
    if (articles.length === 0) {
      return "No cricket news found today. The RSS feeds might be temporarily unavailable.";
    }

    const newsContent = articles.map((article, index) => 
      `${index + 1}. **${article.title}** (${article.source})
Summary: ${article.summary}
Link: ${article.link}
---`
    ).join('\n\n');

    const prompt = `
You are a cricket expert creating a daily cricket news report. Analyze these cricket news articles and create a comprehensive report.

Structure your report with these sections:
1. **🔥 TOP HEADLINES** - Most important 3-4 stories
2. **🏏 MATCH UPDATES** - Live games, results, upcoming fixtures  
3. **👥 PLAYER NEWS** - Player updates, performances, transfers
4. **🏆 TEAM & TOURNAMENT NEWS** - Team news, league updates
5. **📈 KEY TAKEAWAYS** - 3-4 bullet points for cricket fans

Make it engaging and informative. Here are today's articles:

${newsContent}

Please provide a well-structured report that cricket enthusiasts would find valuable.
    `;

    try {
      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      return response.text();
    } catch (error) {
      console.error('Error generating AI report:', error);
      
      // Fallback report
      let fallbackReport = "# 🏏 Daily Cricket News Report\n\n";
      fallbackReport += "## Latest Cricket News\n\n";
      
      articles.slice(0, 10).forEach((article, index) => {
        fallbackReport += `**${index + 1}. ${article.title}**\n`;
        fallbackReport += `Source: ${article.source}\n`;
        fallbackReport += `${article.summary}\n`;
        fallbackReport += `[Read more](${article.link})\n\n`;
      });
      
      return fallbackReport;
    }
  }

  // Send cricket report via email
  async sendCricketReport(reportContent, articlesCount) {
    const today = new Date().toLocaleDateString('en-US', { 
      weekday: 'long',
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    });
    
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: process.env.REPORT_RECIPIENT_EMAIL,
      subject: `🏏 Daily Cricket News - ${today}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto;">
          <header style="background: linear-gradient(135deg, #1e3c72, #2a5298); color: white; padding: 20px; text-align: center;">
            <h1>🏏 Daily Cricket News Report</h1>
            <p>${today} | ${articlesCount} stories found</p>
          </header>
          
          <div style="padding: 20px; background: #f8f9fa;">
            <div style="background: white; padding: 20px; border-radius: 8px;">
              ${reportContent
                .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                .replace(/\*(.*?)\*/g, '<em>$1</em>')
                .replace(/###? (.*?)$/gm, '<h3 style="color: #1e3c72;">$1</h3>')
                .replace(/##? (.*?)$/gm, '<h2 style="color: #1e3c72;">$1</h2>')
                .replace(/\n\n/g, '</p><p>')
                .replace(/^/, '<p>')
                .replace(/$/, '</p>')}
            </div>
          </div>
          
          <footer style="background: #333; color: white; padding: 15px; text-align: center;">
            <small>🤖 Generated by AI Cricket News Agent | ${new Date().toLocaleTimeString()}</small>
          </footer>
        </div>
      `
    };

    try {
      const info = await this.transporter.sendMail(mailOptions);
      console.log('✅ Cricket report sent:', info.messageId);
      return info;
    } catch (error) {
      console.error('❌ Email error:', error);
      throw error;
    }
  }

  // Main function
  async runDailyCricketReport() {
    try {
      console.log('🏏 Starting cricket news report...');
      
      const articles = await this.crawlCricketNews();
      console.log(`📰 Found ${articles.length} articles`);
      
      if (articles.length === 0) {
        await this.sendCricketReport("No cricket news available today.", 0);
        return { success: true, articleCount: 0 };
      }

      console.log('🤖 Generating report...');
      const report = await this.generateCricketReport(articles);

      console.log('📧 Sending report...');
      await this.sendCricketReport(report, articles.length);

      console.log('✅ Report completed successfully!');
      return { 
        success: true, 
        articleCount: articles.length,
        sources: [...new Set(articles.map(a => a.source))]
      };
      
    } catch (error) {
      console.error('❌ Error:', error);
      throw error;
    }
  }
}

// Vercel serverless function handler - FIXED
module.exports = async function handler(req, res) {
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
};
   export default function handler(req, res) {
  res.status(200).json({ message: "Cricket report API is working!" });


