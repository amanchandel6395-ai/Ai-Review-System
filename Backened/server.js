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

const DEFAULT_LANGUAGES = {
  India: [
    { code: 'en', label: 'English', weight: 100 },
    { code: 'hi', label: 'Hindi', weight: 0 },
    { code: 'hinglish', label: 'Hinglish', weight: 0 },
    { code: 'bn', label: 'Bengali', weight: 0 },
    { code: 'ta', label: 'Tamil', weight: 0 },
    { code: 'te', label: 'Telugu', weight: 0 },
    { code: 'kn', label: 'Kannada', weight: 0 },
    { code: 'ml', label: 'Malayalam', weight: 0 },
    { code: 'mr', label: 'Marathi', weight: 0 },
    { code: 'gu', label: 'Gujarati', weight: 0 },
    { code: 'pa', label: 'Punjabi', weight: 0 },
    { code: 'od', label: 'Odia', weight: 0 },
    { code: 'bho', label: 'Bhojpuri', weight: 0 }
  ]
};

function defaultQuestions(type) {
  const qs = QUESTIONS[type] || QUESTIONS.other;
  return (qs || []).map((q, i) => ({
    id: q.id || 'q' + (i + 1), text: q.q || q.question || '', type: 'single',
    required: false, enabled: true, order: i,
    options: (q.chips || []).map(x => ({ label: x, value: x, sentiment: '' }))
  }));
}

function normalizeBusiness(b) {
  const obj = b.toObject ? b.toObject() : b;
  if (!obj.localLanguages?.length) {
    if (obj.city === 'Bengaluru') obj.localLanguages = ['English', 'Kannada'];
    else if (obj.city === 'Chennai') obj.localLanguages = ['English', 'Tamil'];
    else if (obj.city === 'Hyderabad') obj.localLanguages = ['English', 'Telugu'];
    else if (obj.city === 'Kolkata') obj.localLanguages = ['English', 'Bengali'];
    else if (obj.city === 'Lucknow' || obj.state === 'Uttar Pradesh') obj.localLanguages = ['English', 'Hindi', 'Hinglish'];
    else obj.localLanguages = ['English'];
  }
  if (!obj.languageConfig?.languages?.length) obj.languageConfig = { mode: 'fixed', languages: obj.localLanguages.map((x, i) => ({ code: x.toLowerCase(), label: x, weight: i === 0 ? 100 : 0 })) };
  if (!obj.reviewConfig) obj.reviewConfig = {};
  if (!obj.questions?.length) obj.questions = defaultQuestions(obj.type);
  if (!obj.subscription) obj.subscription = { plan: 'trial', status: 'trial', reviewLimit: 1000, reviewsUsed: 0 };
  return obj;
}

function isSubscriptionActive(b) {
  const s = b.subscription || {};
  if (s.status === 'suspended' || s.status === 'expired') return false;
  if (s.endDate && new Date(s.endDate) < new Date()) return false;
  if (Number.isFinite(s.reviewLimit) && s.reviewLimit >= 0 && (s.reviewsUsed || 0) >= s.reviewLimit) return false;
  return true;
}

function languageInstruction(cfg, business) {
  const langs = cfg?.languages?.length ? cfg.languages : [{ label: 'English', weight: 100 }];
  const list = langs.map(x => `${x.label || x.code} (${x.weight ?? 0}%)`).join(', ');
  return `Write naturally in the configured language mix: ${list}. If Hinglish is configured, mix simple everyday Hindi and English as a real local customer would. Do not force a translation or unnatural language switching.`;
}

const app  = express();
const PORT = process.env.PORT || 3001;

// ── OpenAI client ────────────────────────────────────────────────────────────
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
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

    const data = normalizeBusiness(business);
    res.json({
      business: {
        id: data._id, name: data.name, type: data.type, description: data.description,
        imageUrl: data.imageUrl, googlePlaceId: data.googlePlaceId, address: data.address,
        phone: data.phone, rating: data.rating, reviewCount: data.reviewCount,
        country: data.country, state: data.state, city: data.city,
        localLanguages: data.localLanguages, languageConfig: data.languageConfig,
        reviewConfig: data.reviewConfig, subscription: data.subscription
      },
      questions: data.questions
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
    const { id, name, type, description, imageUrl, googlePlaceId, address, phone, country, state, city, localLanguages, languageConfig, reviewConfig, questions, subscription } = req.body;
    if (!id || !name || !type) return res.status(400).json({ error: 'Missing required fields: id, name, type' });
    const business = new Business({ _id: id, name, type, description, imageUrl, googlePlaceId, address, phone, country, state, city, localLanguages, languageConfig, reviewConfig, questions, subscription });
    await business.save();
    res.status(201).json({ success: true, business });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ error: 'Business ID already exists' });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/business/:id — admin update all business settings
app.put('/api/business/:id', async (req, res) => {
  try {
    const allowed = ['name','type','description','imageUrl','googlePlaceId','address','phone','country','state','city','localLanguages','languageConfig','reviewConfig','questions','subscription'];
    const patch = {};
    allowed.forEach(k => { if (req.body[k] !== undefined) patch[k] = req.body[k]; });
    if (patch.questions) patch.questions = patch.questions.map((q,i) => ({ ...q, order: q.order ?? i }));
    const business = await Business.findByIdAndUpdate(req.params.id, patch, { new:true, runValidators:true });
    if (!business) return res.status(404).json({ error:'Business not found' });
    res.json({ success:true, business: normalizeBusiness(business) });
  } catch (err) { console.error('PUT /business error:', err); res.status(400).json({ error: err.message || 'Failed to update business' }); }
});

// DELETE /api/business/:id — admin delete business
app.delete('/api/business/:id', async (req, res) => {
  try {
    const business = await Business.findByIdAndDelete(req.params.id);
    if (!business) return res.status(404).json({ error:'Business not found' });
    await Analytics.deleteMany({ businessId:req.params.id });
    await Review.deleteMany({ businessId:req.params.id });
    res.json({ success:true });
  } catch (err) { res.status(500).json({ error:'Failed to delete business' }); }
});

// GET /api/business/:id/admin — full editable configuration
app.get('/api/business/:id/admin', async (req,res) => {
  try { const b=await Business.findById(req.params.id); if(!b)return res.status(404).json({error:'Business not found'}); res.json({business:normalizeBusiness(b)}); }
  catch(e){res.status(500).json({error:'Failed to fetch business'});}
});

// POST /api/generate-review — AI review generation
app.post('/api/generate-review', reviewLimiter, async (req, res) => {
  try {
    const { rating, businessType, businessName, selectedChips, businessId, language, languageConfig, reviewConfig } = req.body;

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

    let cfg = reviewConfig || {};
    let customerLang = language || '';
    let dbBusiness = null;
    if (businessId) {
      dbBusiness = await Business.findById(businessId);
      if (!dbBusiness) return res.status(404).json({ error: 'Business not found' });
      if (!isSubscriptionActive(dbBusiness)) return res.status(403).json({ error: 'Business subscription is inactive or review limit has been reached.' });
      const data = normalizeBusiness(dbBusiness);
      cfg = data.reviewConfig || cfg;
      customerLang = language || data.localLanguages?.join(' + ') || 'English';
      languageConfig = languageConfig || data.languageConfig;
    }
    const chipsContext = selectedChips && selectedChips.length > 0 ? `The customer specifically experienced/noted: ${selectedChips.join(', ')}.` : '';
    const minWords = Math.max(8, Number(cfg.minWords || 18));
    const maxWords = Math.min(80, Math.max(minWords, Number(cfg.maxWords || 45)));
    const prompt = `
You are a genuine customer writing a short public review for a real business.
Business: "${businessName}"
Type: ${businessType}
Star rating: ${rating}/5
Tone: ${cfg.tone || toneMap[rating] || toneMap[3]}
Style: ${cfg.style || 'short, everyday customer review'}
Language: ${customerLang || 'use the configured language mix'}
${languageInstruction(languageConfig, null)}
${chipsContext}
Admin instructions: ${cfg.customInstructions || 'None'}

Write ONLY ${minWords}-${maxWords} words, preferably 2 short sentences. Sound like a normal customer, not a marketer or AI. Use only details supplied above; never invent food, staff, facilities, prices, events, or other experiences. Do not start with the business name. Avoid generic AI phrases and excessive punctuation. Emojis: ${cfg.emoji ? 'allowed, at most one' : 'do not use'}.
Output ONLY the review text.
`.trim();

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',    
      max_tokens:  120,
      temperature: Number(cfg.temperature || 0.75),
      messages: [
        { role: 'system', content: 'You write authentic, concise Google reviews for real customers.' },
        { role: 'user',   content: prompt }
      ]
    });

    const review = completion.choices[0]?.message?.content?.trim();
    if (!review) throw new Error('Empty AI response');

    if (dbBusiness) await Business.findByIdAndUpdate(dbBusiness._id, { $inc: { 'subscription.reviewsUsed': 1 } });
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
