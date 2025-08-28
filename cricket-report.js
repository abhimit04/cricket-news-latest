import puppeteer from "puppeteer";
import * as cheerio from "cheerio";
import nodemailer from "nodemailer";
import { GoogleGenerativeAI } from "@google/generative-ai";

export default async function handler(req, res) {
  try {
    // Initialize Gemini
    const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-pro" });

    // Puppeteer fetch cricket news
    const browser = await puppeteer.launch({
      args: ["--no-sandbox", "--disable-setuid-sandbox"]
    });
    const page = await browser.newPage();
    await page.goto("https://www.espncricinfo.com/cricket-news", {
      waitUntil: "domcontentloaded"
    });

    const content = await page.content();
    const $ = cheerio.load(content);
    let headlines = [];
    $("h2, h3").each((i, el) => {
      headlines.push($(el).text().trim());
    });

    await browser.close();

    // Summarize with Gemini
    const prompt = `Summarize the following cricket news headlines into a digest:\n${headlines.slice(0, 10).join("\n")}`;
    const result = await model.generateContent(prompt);
    const summary = result.response.text();

    // Send email
    const transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      }
    });

    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: process.env.EMAIL_TO,
      subject: "Cricket News Digest",
      text: summary
    });

    return res.status(200).json({
      message: "✅ Cricket report email sent!",
      summary
    });
  } catch (err) {
    console.error("❌ Error in cricket-report:", err);
    return res.status(500).json({ error: err.message });
  }
}
