// server.js — QR Review System Backend

require('dotenv').config();
const express      = require('express');
const cors         = require('cors');
const rateLimit    = require('express-rate-limit');
const mongoose     = require('mongoose');
const QRCode       = require('qrcode');
const OpenAI       = require('openai');
const path         = require('path');

const { Business, Analytics, Review, SEED_BUSINESSES } = require('./data/businesses');
const { QUESTIONS } = require('./config/questions');

const app  = express();
const PORT = process.env.PORT || 3001;

// ── OpenAI client ────────────────────────────────────────────────────────────
const openai = new OpenAI({
  apiKey: process.env.GROQ_API_KEY,
  baseURL: 'https://api.groq.com/openai/v1'
});
// ── MongoDB ──────────────────────────────────────────────────────────────────
mongoose.connect(process.env.MONGO_URI)
  .then(async () => {
    console.log('✅ MongoDB Connected');
    await seedDatabase();
  })
  .catch(err => console.error('❌ MongoDB connection error:', err));

async function seedDatabase() {
  const count = await Business.countDocuments();
  if (count === 0) {
    await Business.insertMany(SEED_BUSINESSES);
    console.log('🌱 Seeded', SEED_BUSINESSES.length, 'businesses');
  }
}

// ── Middleware ───────────────────────────────────────────────────────────────
app.use(cors({
  origin: [
    process.env.FRONTEND_URL || 'http://localhost:3000',
    /\.vercel\.app$/,
    /localhost:\d+/
  ],
  credentials: true
}));
app.use(express.json({ limit: '10kb' }));
// app.use(express.static(path.join(__dirname, '../frontend')));

// Rate limiters
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 100,
  standardHeaders: true,
  message: { error: 'Too many requests, please slow down.' }
});

const reviewLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 min
  max: 10,
  standardHeaders: true,
  message: { error: 'Review generation limit reached. Try again in 5 minutes.' }
});

app.use('/api/', generalLimiter);

// ── Routes ───────────────────────────────────────────────────────────────────

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// GET /api/business/:id — fetch business info + contextual questions
app.get('/api/business/:id', async (req, res) => {
  try {
    const business = await Business.findById(req.params.id);
    if (!business) {
      return res.status(404).json({ error: 'Business not found' });
    }

    const questions = QUESTIONS[business.type] || QUESTIONS.other;

    res.json({
      business: {
        id:            business._id,
        name:          business.name,
        type:          business.type,
        description:   business.description,
        imageUrl:      business.imageUrl,
        googlePlaceId: business.googlePlaceId,
        address:       business.address,
        phone:         business.phone,
        rating:        business.rating,
        reviewCount:   business.reviewCount
      },
      questions
    });
  } catch (err) {
    console.error('GET /business/:id error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/businesses — list all businesses (admin / QR generator)
app.get('/api/businesses', async (req, res) => {
  try {
    const businesses = await Business.find({}, '_id name type rating reviewCount');
    res.json({ businesses });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/business — create new business (admin)
app.post('/api/business', async (req, res) => {
  try {
    const { id, name, type, description, imageUrl, googlePlaceId, address, phone } = req.body;
    if (!id || !name || !type || !googlePlaceId) {
      return res.status(400).json({ error: 'Missing required fields: id, name, type, googlePlaceId' });
    }
    const business = new Business({ _id: id, name, type, description, imageUrl, googlePlaceId, address, phone });
    await business.save();
    res.status(201).json({ success: true, business });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ error: 'Business ID already exists' });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/generate-review — AI review generation
app.post('/api/generate-review', reviewLimiter, async (req, res) => {
  try {
    const { rating, businessType, businessName, selectedChips } = req.body;

    if (!rating || !businessType || !businessName) {
      return res.status(400).json({ error: 'Missing required fields: rating, businessType, businessName' });
    }

    if (rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'Rating must be between 1 and 5' });
    }

    // Build tone directive
    const toneMap = {
      5: 'highly positive, enthusiastic, and genuinely delighted — use warm, vivid language',
      4: 'positive and appreciative, with a touch of personality',
      3: 'balanced and honest — mention what worked and what could be better',
      2: 'mildly critical but fair — note the issues without being harsh',
      1: 'critically honest and disappointed, but still constructive and respectful'
    };

    const chipsContext = selectedChips && selectedChips.length > 0
      ? `The customer specifically experienced/noted: ${selectedChips.join(', ')}.`
      : '';

    const prompt = `
You are a genuine customer writing a short Google review.

Business: "${businessName}"
Type: ${businessType}
Star rating: ${rating}/5
Tone: ${toneMap[rating] || toneMap[3]}
${chipsContext}

Write a natural, human-like review in 2–3 sentences. It should:
- Sound like a real person wrote it (not AI)
- Reference the star rating's sentiment naturally
- Include specific details from the context chips if provided
- NOT use phrases like "I must say", "I have to say", "As a customer", "I recently visited"
- NOT start with the business name
- Be ready to post directly on Google Maps

Output ONLY the review text. No quotes, no preamble.
`.trim();

    const completion = await openai.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      max_tokens:  150,
      temperature: 0.85,
      messages: [
        { role: 'system', content: 'You write authentic, concise Google reviews for real customers.' },
        { role: 'user',   content: prompt }
      ]
    });

    const review = completion.choices[0]?.message?.content?.trim();
    if (!review) throw new Error('Empty AI response');

    res.json({ review, tokensUsed: completion.usage?.total_tokens });

  } catch (err) {
    console.error('POST /generate-review error:', err);
    if (err?.status === 401) return res.status(401).json({ error: 'Invalid OpenAI API key' });
    if (err?.status === 429) return res.status(429).json({ error: 'AI rate limit reached. Try again shortly.' });
    res.status(500).json({ error: 'Review generation failed. Please try again.' });
  }
});

// POST /api/save-analytics — track review interactions
app.post('/api/save-analytics', async (req, res) => {
  try {
    const { businessId, rating, chips, reviewLength, wasPosted } = req.body;
    if (!businessId || !rating) return res.status(400).json({ error: 'Missing required fields' });

    const entry = new Analytics({
      businessId,
      rating,
      chips:        chips || [],
      reviewLength: reviewLength || 0,
      wasPosted:    wasPosted || false,
      userAgent:    req.headers['user-agent'] || ''
    });
    await entry.save();

    // Bump review count
    await Business.findByIdAndUpdate(businessId, { $inc: { reviewCount: 1 } });

    res.json({ success: true });
  } catch (err) {
    console.error('POST /save-analytics error:', err);
    res.status(500).json({ error: 'Failed to save analytics' });
  }
});

// GET /api/analytics/:businessId — basic analytics for a business
app.get('/api/analytics/:businessId', async (req, res) => {
  try {
    const entries = await Analytics.find({ businessId: req.params.businessId });
    if (!entries.length) return res.json({ entries: [], summary: null });

    const avgRating = entries.reduce((s, e) => s + e.rating, 0) / entries.length;
    const postedCount = entries.filter(e => e.wasPosted).length;
    const ratingDist = [1,2,3,4,5].map(r => ({
      stars: r,
      count: entries.filter(e => e.rating === r).length
    }));

    res.json({
      summary: {
        total:        entries.length,
        avgRating:    +avgRating.toFixed(2),
        postedToGoogle: postedCount,
        conversionRate: +((postedCount / entries.length) * 100).toFixed(1)
      },
      ratingDist,
      recent: entries.slice(-10).reverse()
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch analytics' });
  }
});

// GET /api/qr/:businessId — generate QR code as PNG data URL
app.get('/api/qr/:businessId', async (req, res) => {
  try {
    const { businessId } = req.params;
    const baseUrl = req.query.baseUrl || `${req.protocol}://${req.get('host')}`;
    const reviewUrl = `${baseUrl}/review/${businessId}`;

    const qrDataUrl = await QRCode.toDataURL(reviewUrl, {
      errorCorrectionLevel: 'H',
      margin: 2,
      color: { dark: '#0f0f0f', light: '#FFFFFF' },
      width: 512
    });

    res.json({ qrDataUrl, reviewUrl, businessId });
  } catch (err) {
    res.status(500).json({ error: 'QR generation failed' });
  }
});

// GET /api/qr/:businessId/svg — SVG QR for print
app.get('/api/qr/:businessId/svg', async (req, res) => {
  try {
    const { businessId } = req.params;
    const baseUrl   = req.query.baseUrl || `${req.protocol}://${req.get('host')}`;
    const reviewUrl = `${baseUrl}/review/${businessId}`;

    const svg = await QRCode.toString(reviewUrl, {
      type: 'svg',
      errorCorrectionLevel: 'H',
      margin: 2,
      color: { dark: '#0f0f0f', light: '#FFFFFF' }
    });

    res.setHeader('Content-Type', 'image/svg+xml');
    res.send(svg);
  } catch (err) {
    res.status(500).json({ error: 'QR generation failed' });
  }
});


// POST /api/save-review — Save any review to MongoDB (called from frontend)
app.post('/api/save-review', async (req, res) => {
  try {
    const { businessId, businessName, rating, reviewText, chips, type, sentToGoogle } = req.body;
    if (!businessId || !rating || !type) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    const review = new Review({
      businessId,
      businessName: businessName || '',
      rating,
      reviewText:   reviewText || '',
      chips:        chips || [],
      type,
      sentToGoogle: sentToGoogle || false,
      userAgent:    req.headers['user-agent'] || ''
    });
    await review.save();
    // Bump review count on business
    await Business.findByIdAndUpdate(businessId, { $inc: { reviewCount: 1 } });
    res.json({ success: true, id: review._id });
  } catch (err) {
    console.error('POST /save-review error:', err);
    res.status(500).json({ error: 'Failed to save review' });
  }
});

// GET /api/reviews — Admin: get all reviews with optional filters
// Query params: type=positive|negative, businessId=xxx, limit=50
app.get('/api/reviews', async (req, res) => {
  try {
    const filter = {};
    if (req.query.type)       filter.type       = req.query.type;
    if (req.query.businessId) filter.businessId = req.query.businessId;

    const limit = Math.min(parseInt(req.query.limit) || 200, 500);
    const reviews = await Review.find(filter)
      .sort({ timestamp: -1 })
      .limit(limit);

    const total    = await Review.countDocuments({});
    const positive = await Review.countDocuments({ type: 'positive' });
    const negative = await Review.countDocuments({ type: 'negative' });
    const allRatings = await Review.find({}, 'rating');
    const avgRating  = allRatings.length
      ? (allRatings.reduce((s, r) => s + r.rating, 0) / allRatings.length).toFixed(1)
      : 0;

    res.json({ reviews, stats: { total, positive, negative, avgRating } });
  } catch (err) {
    console.error('GET /reviews error:', err);
    res.status(500).json({ error: 'Failed to fetch reviews' });
  }
});

// DELETE /api/reviews/:id — Admin: delete single review
app.delete('/api/reviews/:id', async (req, res) => {
  try {
    const result = await Review.findByIdAndDelete(req.params.id);
    if (!result) return res.status(404).json({ error: 'Review not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete review' });
  }
});

// DELETE /api/reviews — Admin: delete ALL reviews (use with caution)
app.delete('/api/reviews', async (req, res) => {
  try {
    const result = await Review.deleteMany({});
    res.json({ success: true, deleted: result.deletedCount });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete reviews' });
  }
});

// SPA fallback — serve review.html for /review/* routes
// app.get('/review/*', (req, res) => {
//   res.sendFile(path.join(__dirname, '../frontend/review.html'));
// });

// app.get('/admin*', (req, res) => {
//   res.sendFile(path.join(__dirname, '../frontend/admin.html'));
// });

// app.get('/', (req, res) => {
//   res.sendFile(path.join(__dirname, '../frontend/index.html'));
// });

// ── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀 QR Review API running on http://localhost:${PORT}`);
  console.log(`   • Frontend:   http://localhost:${PORT}/`);
  console.log(`   • Admin:      http://localhost:${PORT}/admin`);
  console.log(`   • Review:     http://localhost:${PORT}/review/{businessId}`);
  console.log(`   • Health:     http://localhost:${PORT}/api/health\n`);
});

module.exports = app;
