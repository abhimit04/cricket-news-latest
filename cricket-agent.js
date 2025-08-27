const puppeteer = require('puppeteer');
const cheerio = require('cheerio');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const nodemailer = require('nodemailer');
const axios = require('axios');

class CricketNewsAgent {
  constructor() {
    // Initialize Gemini AI
    this.genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY);
    this.model = this.genAI.getGenerativeModel({ model: "gemini-pro" });
    
    // Initialize email transporter
    this.transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD, // Use app password
      },
    });

    // Cricket websites configuration
    this.sources = {
      cricinfo: {
        name: 'ESPNCricinfo',
        url: 'https://www.espncricinfo.com/cricket-news',
        selectors: {
          articles: '.ds-p-0',
          title: '.ds-text-title-s, .ds-text-title-xs',
          summary: '.ds-text-compact-s, .ds-text-compact-xs',
          link: 'a',
          time: '.ds-text-tight-xs'
        }
      },
      cricbuzz: {
        name: 'Cricbuzz',
        url: 'https://www.cricbuzz.com/cricket-news',
        selectors: {
          articles: '.cb-nws-lst-rt',
          title: '.cb-nws-hdln',
          summary: '.cb-nws-intr',
          link: 'a',
          time: '.cb-font-12'
        }
      }
    };
  }

  // Crawl ESPNCricinfo using Puppeteer (for dynamic content)
  async crawlCricinfo() {
    let browser;
    try {
      browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
      });
      
      const page = await browser.newPage();
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
      
      await page.goto(this.sources.cricinfo.url, { 
        waitUntil: 'networkidle2',
        timeout: 30000
      });

      // Wait for content to load
      await page.waitForSelector('.ds-p-0', { timeout: 10000 }).catch(() => {});

      const content = await page.content();
      const $ = cheerio.load(content);
      
      const articles = [];
      
      $('.ds-p-0').each((index, element) => {
        if (index >= 15) return false; // Limit to 15 articles
        
        const $element = $(element);
        const titleElement = $element.find('.ds-text-title-s, .ds-text-title-xs').first();
        const summaryElement = $element.find('.ds-text-compact-s, .ds-text-compact-xs').first();
        const linkElement = $element.find('a').first();
        const timeElement = $element.find('.ds-text-tight-xs').first();
        
        const title = titleElement.text().trim();
        const summary = summaryElement.text().trim();
        let link = linkElement.attr('href');
        const time = timeElement.text().trim();
        
        if (title && link) {
          // Convert relative URLs to absolute
          if (link.startsWith('/')) {
            link = 'https://www.espncricinfo.com' + link;
          }
          
          articles.push({
            title,
            summary: summary || title,
            link,
            time,
            source: 'ESPNCricinfo'
          });
        }
      });

      return articles;
    } catch (error) {
      console.error('Error crawling Cricinfo:', error);
      return [];
    } finally {
      if (browser) {
        await browser.close();
      }
    }
  }

  // Crawl Cricbuzz using HTTP request and Cheerio
  async crawlCricbuzz() {
    try {
      const response = await axios.get(this.sources.cricbuzz.url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        timeout: 15000
      });

      const $ = cheerio.load(response.data);
      const articles = [];

      $('.cb-nws-lst-rt').each((index, element) => {
        if (index >= 15) return false; // Limit to 15 articles
        
        const $element = $(element);
        const titleElement = $element.find('.cb-nws-hdln');
        const summaryElement = $element.find('.cb-nws-intr');
        const linkElement = $element.find('a').first();
        const timeElement = $element.find('.cb-font-12');
        
        const title = titleElement.text().trim();
        const summary = summaryElement.text().trim();
        let link = linkElement.attr('href');
        const time = timeElement.text().trim();
        
        if (title && link) {
          // Convert relative URLs to absolute
          if (link.startsWith('/')) {
            link = 'https://www.cricbuzz.com' + link;
          }
          
          articles.push({
            title,
            summary: summary || title,
            link,
            time,
            source: 'Cricbuzz'
          });
        }
      });

      return articles;
    } catch (error) {
      console.error('Error crawling Cricbuzz:', error);
      return [];
    }
  }

  // Alternative RSS feed approach
  async crawlRSSFeeds() {
    try {
      const feeds = [
        'https://www.espncricinfo.com/rss/content/story/feeds/0.xml',
        'https://cricbuzz.com/rss-feed/cricket-news'
      ];

      const articles = [];
      
      for (const feedUrl of feeds) {
        try {
          const response = await axios.get(feedUrl, { timeout: 10000 });
          const $ = cheerio.load(response.data, { xmlMode: true });
          
          $('item').each((index, element) => {
            if (index >= 10) return false; // Limit per feed
            
            const $element = $(element);
            const title = $element.find('title').text().trim();
            const summary = $element.find('description').text().trim().replace(/<[^>]*>/g, '');
            const link = $element.find('link').text().trim();
            const pubDate = $element.find('pubDate').text().trim();
            
            if (title && link) {
              articles.push({
                title,
                summary: summary.substring(0, 300) + '...',
                link,
                time: pubDate,
                source: feedUrl.includes('espncricinfo') ? 'ESPNCricinfo RSS' : 'Cricbuzz RSS'
              });
            }
          });
        } catch (feedError) {
          console.error(`Error with feed ${feedUrl}:`, feedError.message);
        }
      }

      return articles;
    } catch (error) {
      console.error('Error crawling RSS feeds:', error);
      return [];
    }
  }

  // Get cricket news from multiple sources
  async getAllCricketNews() {
    console.log('Starting cricket news crawl...');
    
    const results = await Promise.allSettled([
      this.crawlCricinfo(),
      this.crawlCricbuzz(),
      this.crawlRSSFeeds()
    ]);

    let allArticles = [];
    
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        allArticles = allArticles.concat(result.value);
        console.log(`Source ${index + 1} returned ${result.value.length} articles`);
      } else {
        console.error(`Source ${index + 1} failed:`, result.reason.message);
      }
    });

    // Remove duplicates based on title similarity
    const uniqueArticles = this.removeDuplicates(allArticles);
    
    // Sort by recency (if time info is available)
    const sortedArticles = this.sortArticlesByRecency(uniqueArticles);
    
    console.log(`Total unique articles found: ${sortedArticles.length}`);
    return sortedArticles.slice(0, 20); // Limit to top 20
  }

  // Remove duplicate articles based on title similarity
  removeDuplicates(articles) {
    const unique = [];
    const seenTitles = new Set();
    
    for (const article of articles) {
      const normalizedTitle = article.title.toLowerCase().replace(/[^\w\s]/g, '');
      const words = normalizedTitle.split(' ').filter(w => w.length > 3);
      const titleKey = words.slice(0, 5).join(' '); // Use first 5 significant words
      
      if (!seenTitles.has(titleKey)) {
        seenTitles.add(titleKey);
        unique.push(article);
      }
    }
    
    return unique;
  }

  // Sort articles by recency
  sortArticlesByRecency(articles) {
    return articles.sort((a, b) => {
      // Simple heuristic: articles with time info containing "hour", "min" are more recent
      const aRecent = a.time && (a.time.includes('hour') || a.time.includes('min'));
      const bRecent = b.time && (b.time.includes('hour') || b.time.includes('min'));
      
      if (aRecent && !bRecent) return -1;
      if (!aRecent && bRecent) return 1;
      return 0;
    });
  }

  // Generate comprehensive cricket report using Gemini AI
  async generateCricketReport(articles) {
    if (articles.length === 0) {
      return "No cricket news found today. Please check the sources manually.";
    }

    const newsContent = articles.map((article, index) => 
      `${index + 1}. **${article.title}** (${article.source})
Summary: ${article.summary}
Link: ${article.link}
Time: ${article.time || 'N/A'}
---`
    ).join('\n\n');

    const prompt = `
You are a cricket expert analyzing today's cricket news. Please create a comprehensive daily cricket report based on the following news articles.

Structure your report with these sections:

1. **TOP HEADLINES** - Most important 3-4 stories
2. **MATCH UPDATES** - Live games, results, upcoming fixtures  
3. **PLAYER NEWS** - Transfers, injuries, performances, records
4. **TEAM NEWS** - Squad selections, coaching changes, strategies
5. **TOURNAMENT NEWS** - League updates, points tables, qualifications
6. **OTHER CRICKET NEWS** - General cricket-related news
7. **KEY TAKEAWAYS** - 3-4 bullet points of what cricket fans should know today

Make it engaging and informative for cricket enthusiasts. Focus on the most newsworthy items and provide context where needed.

Here are today's cricket news articles:

${newsContent}

Please provide a well-structured, comprehensive report that a cricket fan would find valuable and informative.
    `;

    try {
      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      return response.text();
    } catch (error) {
      console.error('Error generating AI report:', error);
      
      // Fallback: Create a simple report without AI
      let fallbackReport = "# Daily Cricket News Report\n\n";
      fallbackReport += "## Latest Cricket News\n\n";
      
      articles.slice(0, 10).forEach((article, index) => {
        fallbackReport += `**${index + 1}. ${article.title}**\n`;
        fallbackReport += `Source: ${article.source}\n`;
        if (article.time) fallbackReport += `Time: ${article.time}\n`;
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
      subject: `🏏 Daily Cricket News Report - ${today}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto;">
          <header style="background: linear-gradient(135deg, #1e3c72, #2a5298); color: white; padding: 20px; text-align: center;">
            <h1>🏏 Daily Cricket News Report</h1>
            <p style="margin: 5px 0;">${today}</p>
            <p style="margin: 5px 0; opacity: 0.9;">Found ${articlesCount} cricket stories today</p>
          </header>
          
          <div style="background-color: #f8f9fa; padding: 30px; line-height: 1.6;">
            <div style="background: white; padding: 25px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
              ${reportContent.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                            .replace(/\*(.*?)\*/g, '<em>$1</em>')
                            .replace(/###? (.*?)$/gm, '<h3 style="color: #1e3c72; margin-top: 25px; margin-bottom: 15px;">$1</h3>')
                            .replace(/##? (.*?)$/gm, '<h2 style="color: #1e3c72; margin-top: 25px; margin-bottom: 15px;">$1</h2>')
                            .replace(/\n\n/g, '</p><p style="margin: 15px 0;">')
                            .replace(/^(.)/gm, '<p style="margin: 15px 0;">$1')
                            .replace(/(.)\n$/gm, '$1</p>')}
            </div>
          </div>
          
          <footer style="background-color: #333; color: white; padding: 20px; text-align: center;">
            <p style="margin: 5px 0;">
              <small>🤖 Generated by AI Cricket News Agent | 
              Sources: ESPNCricinfo, Cricbuzz | 
              ${new Date().toLocaleTimeString()}</small>
            </p>
            <p style="margin: 5px 0;">
              <small>Stay updated with the latest cricket news! 🏏</small>
            </p>
          </footer>
        </div>
      `
    };

    try {
      const info = await this.transporter.sendMail(mailOptions);
      console.log('Cricket report sent successfully:', info.messageId);
      return info;
    } catch (error) {
      console.error('Error sending cricket report:', error);
      throw error;
    }
  }

  // Main function to run daily cricket news report
  async runDailyCricketReport() {
    try {
      console.log('🏏 Starting daily cricket news report generation...');
      
      // Get cricket news from all sources
      const articles = await this.getAllCricketNews();
      
      if (articles.length === 0) {
        console.log('No articles found, sending notification email...');
        await this.sendCricketReport("No cricket news could be retrieved today. Please check the sources manually.", 0);
        return { success: true, articleCount: 0, message: 'No articles found' };
      }

      // Generate AI-powered report
      console.log(`Generating AI report for ${articles.length} articles...`);
      const report = await this.generateCricketReport(articles);

      // Send the report
      console.log('Sending cricket report via email...');
      await this.sendCricketReport(report, articles.length);

      console.log('✅ Daily cricket report completed successfully!');
      return { 
        success: true, 
        articleCount: articles.length,
        sources: [...new Set(articles.map(a => a.source))],
        message: 'Report sent successfully'
      };
      
    } catch (error) {
      console.error('❌ Error in cricket report process:', error);
      
      // Send error notification
      try {
        await this.sendCricketReport(
          `Error generating cricket report: ${error.message}\n\nPlease check the system logs.`,
          0
        );
      } catch (emailError) {
        console.error('Failed to send error notification:', emailError);
      }
      
      throw error;
    }
  }
}

// Export for use as a module
module.exports = CricketNewsAgent;

// If running directly
if (require.main === module) {
  const agent = new CricketNewsAgent();
  agent.runDailyCricketReport()
    .then(result => {
      console.log('Cricket report process completed:', result);
      process.exit(0);
    })
    .catch(error => {
      console.error('Cricket report process failed:', error);
      process.exit(1);
    });
}