// server.js — QR Review System Backend

require('dotenv').config();
const express      = require('express');
const cors         = require('cors');
const rateLimit    = require('express-rate-limit');
const mongoose     = require('mongoose');
const QRCode       = require('qrcode');
const OpenAI       = require('openai');
const path         = require('path');
const crypto       = require('crypto');

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
  if (!obj.city && /new delhi/i.test(obj.address || '')) { obj.city='New Delhi'; obj.state='Delhi'; }
  else if (!obj.city && /lucknow/i.test(obj.address || '')) { obj.city='Lucknow'; obj.state='Uttar Pradesh'; }
  else if (!obj.city && /bengaluru|bangalore/i.test(obj.address || '')) { obj.city='Bengaluru'; obj.state='Karnataka'; }
  else if (!obj.city && /mumbai|bandra/i.test(obj.address || '')) { obj.city='Mumbai'; obj.state='Maharashtra'; }
  else if (!obj.city && /hyderabad|jubilee hills/i.test(obj.address || '')) { obj.city='Hyderabad'; obj.state='Telangana'; }
  if (!obj.localLanguages?.length) {
    if (obj.city === 'Bengaluru') obj.localLanguages = ['English', 'Kannada'];
    else if (obj.city === 'Chennai') obj.localLanguages = ['English', 'Tamil'];
    else if (obj.city === 'Hyderabad') obj.localLanguages = ['English', 'Telugu'];
    else if (obj.city === 'Kolkata') obj.localLanguages = ['English', 'Bengali'];
    else if (obj.city === 'Lucknow' || obj.state === 'Uttar Pradesh') obj.localLanguages = ['English', 'Hindi', 'Hinglish'];
    else obj.localLanguages = ['English'];
  }
  if (!obj.languageConfig?.languages?.length) {
    const city = String(obj.city || '').toLowerCase();
    let labels = obj.localLanguages;
    let mode = 'weighted';
    if (city === 'new delhi' || city === 'delhi') labels = ['English','Hinglish','Hindi'];
    else if (city === 'bengaluru' || city === 'bangalore') labels = ['English','Kannada'];
    else if (city === 'hyderabad') labels = ['English','Telugu'];
    else if (city === 'chennai') labels = ['English','Tamil'];
    else if (city === 'mumbai') labels = ['English','Hindi','Marathi','Hinglish'];
    else if (city === 'lucknow') labels = ['English','Hindi','Hinglish'];
    const weights = labels.map((x, i) => ({ code:x.toLowerCase(), label:x, weight: labels.length===2 ? (i===0?70:30) : (i===0?50:(i===labels.length-1?35:15)) }));
    obj.languageConfig = { mode, languages: weights };
  }
  if (!obj.businessProfile) obj.businessProfile = {};
  if (!Array.isArray(obj.businessProfile.services)) obj.businessProfile.services = [];
  if (!Array.isArray(obj.businessProfile.specialties)) obj.businessProfile.specialties = [];
  if (!Array.isArray(obj.businessProfile.amenities)) obj.businessProfile.amenities = [];
  if (!Array.isArray(obj.businessProfile.differentiators)) obj.businessProfile.differentiators = [];
  if (!Array.isArray(obj.businessProfile.reviewFocus)) obj.businessProfile.reviewFocus = [];
  if (!Array.isArray(obj.businessProfile.avoidClaims)) obj.businessProfile.avoidClaims = [];
  if (!obj.reviewConfig) obj.reviewConfig = {};
  if (!obj.questions?.length) obj.questions = defaultQuestions(obj.type);
  if (!obj.subscription) obj.subscription = { plan: 'trial', status: 'trial', reviewLimit: 1000, reviewsUsed: 0 };
  return obj;
}

function isSubscriptionActive(b) {
  const s = b.subscription || {};
  if (s.status === 'suspended' || s.status === 'expired') return false;
  if (s.endDate && new Date(s.endDate) < new Date()) return false;
  if (Number.isFinite(s.reviewLimit) && s.reviewLimit >= 0 && s.reviewLimit !== -1 && (s.reviewsUsed || 0) >= s.reviewLimit) return false;
  return true;
}

function pickLanguage(config) {
  const langs = config?.languages || [];
  if (!langs.length) return '';
  if (config.mode === 'customer') return '';
  if (config.mode === 'fixed') return (langs.find(x => (x.weight ?? 0) > 0) || langs[0]).label || '';
  if (config.mode === 'random') return langs[Math.floor(Math.random() * langs.length)].label || '';
  const total = langs.reduce((s,x) => s + Math.max(0, Number(x.weight || 0)), 0);
  if (!total) return langs[0].label || '';
  let n = Math.random() * total;
  for (const lang of langs) { n -= Math.max(0, Number(lang.weight || 0)); if (n <= 0) return lang.label || lang.code || ''; }
  return langs[0].label || '';
}

function languageInstruction(cfg, business) {
  const langs = cfg?.languages?.length ? cfg.languages : [{ label: 'English', weight: 100 }];
  const list = langs.map(x => `${x.label || x.code} (${x.weight ?? 0}%)`).join(', ');
  return `Write naturally in the configured language mix: ${list}. If Hinglish is configured, mix simple everyday Hindi and English as a real local customer would. Do not force a translation or unnatural language switching.`;
}

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const ADMIN_TOKEN_SECRET = process.env.ADMIN_TOKEN_SECRET || '';

function signAdminToken(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', ADMIN_TOKEN_SECRET).update(body).digest('base64url');
  return body + '.' + sig;
}

function verifyAdminToken(token) {
  if (!token || !ADMIN_TOKEN_SECRET) return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const body = parts[0], signature = parts[1];
  const expected = crypto.createHmac('sha256', ADMIN_TOKEN_SECRET).update(body).digest('base64url');
  if (signature.length !== expected.length) return false;
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return false;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    return payload.role === 'admin' && Number(payload.exp) > Date.now();
  } catch { return false; }
}

function requireAdmin(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!verifyAdminToken(token)) return res.status(401).json({ error: 'Admin authentication required' });
  next();
}

const app  = express();
const PORT = process.env.PORT || 3001;

// ── OpenAI client ────────────────────────────────────────────────────────────
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});
// ── MongoDB ──────────────────────────────────────────────────────────────────
const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;
if (!MONGO_URI) console.warn('⚠️ MONGO_URI/MONGODB_URI is not configured');
mongoose.connect(MONGO_URI)
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

const adminLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 8,
  standardHeaders: true,
  message: { error: 'Too many login attempts. Try again later.' }
});

app.use('/api/', generalLimiter);

// ── Routes ───────────────────────────────────────────────────────────────────

app.post('/api/admin/login', adminLoginLimiter, (req, res) => {
  if (!ADMIN_PASSWORD || !ADMIN_TOKEN_SECRET) {
    return res.status(503).json({ error: 'Admin authentication is not configured on the server.' });
  }
  const password = String(req.body?.password || '');
  const expected = Buffer.from(ADMIN_PASSWORD);
  const supplied = Buffer.from(password);
  const valid = supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
  if (!valid) return res.status(401).json({ error: 'Invalid admin password' });
  const now = Date.now();
  const token = signAdminToken({ role: 'admin', iat: now, exp: now + 12 * 60 * 60 * 1000 });
  res.json({ token, expiresAt: now + 12 * 60 * 60 * 1000 });
});

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
        reviewConfig: { minWords: data.reviewConfig?.minWords, maxWords: data.reviewConfig?.maxWords }
      },
      questions: data.questions
    });
  } catch (err) {
    console.error('GET /business/:id error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/businesses — list all businesses (admin / QR generator)
app.get('/api/businesses', requireAdmin, async (req, res) => {
  try {
    const businesses = await Business.find({}, '_id name type rating reviewCount');
    res.json({ businesses });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/business — create new business (admin)
app.post('/api/business', requireAdmin, async (req, res) => {
  try {
    const { id, name, type, description, imageUrl, googlePlaceId, address, phone, country, state, city, localLanguages, businessProfile, languageConfig, reviewConfig, questions, subscription } = req.body;
    if (!id || !name || !type) return res.status(400).json({ error: 'Missing required fields: id, name, type' });
    const business = new Business({ _id: id, name, type, description, imageUrl, googlePlaceId, address, phone, country, state, city, localLanguages, businessProfile, languageConfig, reviewConfig, questions: Array.isArray(questions) && questions.length ? questions : defaultQuestions(type), subscription: subscription || { plan:'trial', status:'trial', reviewLimit:1000, reviewsUsed:0 } });
    await business.save();
    res.status(201).json({ success: true, business });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ error: 'Business ID already exists' });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/business/:id — admin update all business settings
app.put('/api/business/:id', requireAdmin, async (req, res) => {
  try {
    const allowed = ['name','type','description','imageUrl','googlePlaceId','address','phone','country','state','city','localLanguages','businessProfile','languageConfig','reviewConfig','questions','subscription'];
    const patch = {};
    allowed.forEach(k => { if (req.body[k] !== undefined) patch[k] = req.body[k]; });
    if (patch.questions) patch.questions = patch.questions.map((q,i) => ({ ...q, order: q.order ?? i }));
    const business = await Business.findByIdAndUpdate(req.params.id, patch, { new:true, runValidators:true });
    if (!business) return res.status(404).json({ error:'Business not found' });
    res.json({ success:true, business: normalizeBusiness(business) });
  } catch (err) { console.error('PUT /business error:', err); res.status(400).json({ error: err.message || 'Failed to update business' }); }
});

// DELETE /api/business/:id — admin delete business
app.delete('/api/business/:id', requireAdmin, async (req, res) => {
  try {
    const business = await Business.findByIdAndDelete(req.params.id);
    if (!business) return res.status(404).json({ error:'Business not found' });
    await Analytics.deleteMany({ businessId:req.params.id });
    await Review.deleteMany({ businessId:req.params.id });
    res.json({ success:true });
  } catch (err) { res.status(500).json({ error:'Failed to delete business' }); }
});

// GET /api/business/:id/admin — full editable configuration
app.get('/api/business/:id/admin', requireAdmin, async (req,res) => {
  try { const b=await Business.findById(req.params.id); if(!b)return res.status(404).json({error:'Business not found'}); res.json({business:normalizeBusiness(b)}); }
  catch(e){res.status(500).json({error:'Failed to fetch business'});}
});

// POST /api/generate-review — AI review generation
app.post('/api/generate-review', reviewLimiter, async (req, res) => {
  try {
    const { rating, businessType, businessName, selectedChips, businessId, language, reviewConfig } = req.body;
    let languageConfig = req.body.languageConfig;

    if (!rating || !businessType || !businessName) {
      return res.status(400).json({ error: 'Missing required fields: rating, businessType, businessName' });
    }
    if (rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'Rating must be between 1 and 5' });
    }

    const toneMap = {
      5: 'highly positive, enthusiastic, and genuinely delighted',
      4: 'positive and appreciative, with a little personality',
      3: 'balanced and honest — mention what worked and what could be better',
      2: 'mildly critical but fair — note issues without being harsh',
      1: 'critically honest and disappointed, but constructive and respectful'
    };

    let cfg = reviewConfig || {};
    let customerLang = language || '';
    let dbBusiness = null;
    let profile = {};
    if (businessId) {
      dbBusiness = await Business.findById(businessId);
      if (!dbBusiness) return res.status(404).json({ error: 'Business not found' });
      if (!isSubscriptionActive(dbBusiness)) return res.status(403).json({ error: 'Business subscription is inactive or review limit has been reached.' });
      const reserved = await Business.findOneAndUpdate(
        {
          _id: businessId,
          'subscription.status': { $nin: ['suspended', 'expired'] },
          $or: [
            { 'subscription.endDate': { $exists: false } },
            { 'subscription.endDate': { $gte: new Date() } }
          ],
          $expr: {
            $or: [
              { $lt: [{ $ifNull: ['$subscription.reviewsUsed', 0] }, { $ifNull: ['$subscription.reviewLimit', 1000] }] },
              { $eq: [{ $ifNull: ['$subscription.reviewLimit', 1000] }, -1] }
            ]
          }
        },
        { $inc: { 'subscription.reviewsUsed': 1 } },
        { new: true }
      );
      if (!reserved) return res.status(403).json({ error: 'Business subscription is inactive or review limit has been reached.' });
      dbBusiness = reserved;
      const data = normalizeBusiness(dbBusiness);
      cfg = data.reviewConfig || cfg;
      languageConfig = languageConfig || data.languageConfig;
      profile = data.businessProfile || {};
      customerLang = language || pickLanguage(languageConfig) || data.localLanguages?.join(' + ') || 'English';
    }

    const list = v => Array.isArray(v) ? v.filter(Boolean).join(', ') : '';
    const chipsContext = Array.isArray(selectedChips) && selectedChips.length
      ? `Customer-selected details (use only if they fit naturally): ${selectedChips.join(', ')}.`
      : 'No specific customer details were selected.';
    const businessKnowledge = `
Business summary: ${profile.summary || 'No additional summary supplied.'}
Services offered: ${list(profile.services) || 'Not specified.'}
Specialties: ${list(profile.specialties) || 'Not specified.'}
Amenities/features: ${list(profile.amenities) || 'Not specified.'}
Target audience: ${profile.targetAudience || 'General customers.'}
What makes it different: ${list(profile.differentiators) || 'Not specified.'}
Review focus: ${list(profile.reviewFocus) || 'Overall customer experience.'}
Business location/context: ${profile.localContext || [dbBusiness?.city, dbBusiness?.state, dbBusiness?.country].filter(Boolean).join(', ') || 'Not specified.'}
Facts/claims to avoid: ${list(profile.avoidClaims) || 'Do not invent claims.'}
Extra AI instructions: ${profile.aiInstructions || 'None.'}
`.trim();

    const minWords = Math.max(8, Number(cfg.minWords || 18));
    const maxWords = Math.min(80, Math.max(minWords, Number(cfg.maxWords || 45)));
    const prompt = `
You are Zuit AI, writing a short public review from the customer's first-person perspective.
You have a detailed business profile below. Use it to understand what this business actually does, what kind of experience a customer can review, where it is located, and what language/style is appropriate.

BUSINESS
Name: "${businessName}"
Type: ${businessType}
Star rating: ${rating}/5

BUSINESS KNOWLEDGE
${businessKnowledge}

LANGUAGE
Requested language: ${customerLang || 'configured business language'}
${languageInstruction(languageConfig, null)}

REVIEW SETTINGS
Tone: ${cfg.tone || toneMap[rating] || toneMap[3]}
Style: ${cfg.style || 'short, everyday customer review'}
Length: ${minWords}-${maxWords} words
Emoji: ${cfg.emoji ? 'allowed, at most one' : 'do not use'}

CUSTOMER INPUT
${chipsContext}

STRICT RULES
- Write ONLY the review text.
- Sound like a real local customer, not a marketer or AI.
- Use first person naturally.
- Use business knowledge only for context; do NOT pretend the customer experienced a service they did not select.
- Never invent prices, staff names, facilities, results, medical outcomes, events, awards, or other facts.
- Do not start with the business name.
- Do not mention AI, prompts, or these instructions.
- Avoid repetitive generic phrases and excessive punctuation.
- For a 4–5 star review, be warm but not unrealistically promotional.
- For a 1–3 star review, be honest and specific without abusive language.
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

    res.json({ review, tokensUsed: completion.usage?.total_tokens });

  } catch (err) {
    if (dbBusiness) await Business.findByIdAndUpdate(dbBusiness._id, { $inc: { 'subscription.reviewsUsed': -1 } }).catch(() => {});
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
app.get('/api/analytics/:businessId', requireAdmin, async (req, res) => {
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
app.get('/api/qr/:businessId', requireAdmin, async (req, res) => {
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
app.get('/api/qr/:businessId/svg', requireAdmin, async (req, res) => {
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
app.get('/api/reviews', requireAdmin, async (req, res) => {
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
app.delete('/api/reviews/:id', requireAdmin, async (req, res) => {
  try {
    const result = await Review.findByIdAndDelete(req.params.id);
    if (!result) return res.status(404).json({ error: 'Review not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete review' });
  }
});

// DELETE /api/reviews — Admin: delete ALL reviews (use with caution)
app.delete('/api/reviews', requireAdmin, async (req, res) => {
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
