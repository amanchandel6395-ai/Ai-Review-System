// server.js — QR Review System Unified Backend & Frontend Server
require('dotenv').config();
const express      = require('express');
const cors         = require('cors');
const rateLimit    = require('express-rate-limit');
const mongoose     = require('mongoose');
const QRCode       = require('qrcode');
const OpenAI       = require('openai');
const path         = require('path');
const crypto       = require('crypto');

// Optional Gemini API client
let GoogleGenAI = null;
let ThinkingLevel = null;
try {
  const genaiPkg = require('@google/genai');
  GoogleGenAI = genaiPkg.GoogleGenAI;
  ThinkingLevel = genaiPkg.ThinkingLevel;
} catch (e) {
  // Optional package
}

const { Business, Analytics, Review, SEED_BUSINESSES } = require('./data/businesses');
const { QUESTIONS } = require('./config/questions');

function defaultQuestions(type) {
  const qs = QUESTIONS[type] || QUESTIONS.other;
  return (qs || []).map((q, i) => ({
    id: q.id || 'q' + (i + 1), text: q.q || q.question || '', type: 'single',
    required: false, enabled: true, order: i,
    options: (q.chips || []).map(x => ({ label: x, value: x, sentiment: '' }))
  }));
}

function normalizeBusiness(b) {
  const obj = b.toObject ? b.toObject() : { ...b };
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
    else if (city === 'lucknow') labels = ['English','Hinglish','Hindi'];
    const weights = labels.map((x, i) => ({ code:x.toLowerCase(), label:x, weight: labels.length===2 ? (i===0?80:20) : (i===0?80:(i===labels.length-1?10:10)) }));
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

  // Ensure googleReviewUrl is derived if placeId exists
  if (!obj.googleReviewUrl && obj.googlePlaceId) {
    obj.googleReviewUrl = 'https://search.google.com/local/writereview?placeid=' + obj.googlePlaceId;
  }

  const finalId = obj._id || obj.id;
  obj._id = finalId;
  obj.id = finalId;
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

// Credentials
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const ADMIN_TOKEN_SECRET = process.env.ADMIN_TOKEN_SECRET || 'zuit-review-admin-token-secret-2024';

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
  try {
    const expected = crypto.createHmac('sha256', ADMIN_TOKEN_SECRET).update(body).digest('base64url');
    if (signature.length !== expected.length) return false;
    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return false;
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
const PORT = process.env.PORT || 3000;

// ── AI Clients (OpenAI & Gemini) ─────────────────────────────────────────────
let openai = null;
if (process.env.OPENAI_API_KEY) {
  try { openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY }); } catch(e){}
}

let geminiClient = null;
if (GoogleGenAI && (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY)) {
  try {
    geminiClient = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY
    });
  } catch (e) {
    console.warn('Gemini client initialization warning:', e.message);
  }
}

// ── MongoDB ──────────────────────────────────────────────────────────────────
const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;
if (!MONGO_URI) console.warn('⚠️ MONGO_URI is not set. Operating with in-memory offline fallback storage.');
if (MONGO_URI) {
  mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 5000 })
    .then(async () => {
      console.log('✅ MongoDB Connected');
      await seedDatabase();
    })
    .catch(err => {
      console.warn('⚠️ MongoDB connection failed:', err.message);
      console.warn('   Operating with resilient in-memory offline data fallback.');
    });
}

async function seedDatabase() {
  try {
    const count = await Business.countDocuments();
    if (count === 0 && SEED_BUSINESSES?.length) {
      await Business.insertMany(SEED_BUSINESSES);
      console.log('🌱 Seeded', SEED_BUSINESSES.length, 'businesses into database');
    }
  } catch(e) {}
}

// ── Middleware ───────────────────────────────────────────────────────────────
app.use(cors({
  origin: true,
  credentials: true
}));
app.use(express.json({ limit: '10kb' }));

// Rate limiters
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  message: { error: 'Too many requests, please slow down.' }
});

const reviewLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  message: { error: 'Review generation limit reached. Try again in 5 minutes.' }
});

const adminLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  message: { error: 'Too many login attempts. Try again later.' }
});

app.use('/api/', generalLimiter);

// ── Authentication Route ─────────────────────────────────────────────────────
app.post('/api/admin/login', adminLoginLimiter, (req, res) => {
  const password = String(req.body?.password || '');
  // If custom ADMIN_PASSWORD is set in environment, only allow that strong password.
  const candidates = process.env.ADMIN_PASSWORD ? [process.env.ADMIN_PASSWORD] : ['admin123'];
  const valid = candidates.some(cand => {
    try {
      const expected = Buffer.from(cand);
      const supplied = Buffer.from(password);
      return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
    } catch {
      return false;
    }
  });

  if (!valid) return res.status(401).json({ error: 'Invalid admin password' });
  const now = Date.now();
  const token = signAdminToken({ role: 'admin', iat: now, exp: now + 12 * 60 * 60 * 1000 });
  res.json({ success: true, token, expiresAt: now + 12 * 60 * 60 * 1000 });
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});
app.get('/health', (req, res) => {
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
        id: data._id,
        name: data.name,
        type: data.type,
        description: data.description,
        imageUrl: data.imageUrl,
        googlePlaceId: data.googlePlaceId,
        googleReviewUrl: data.googleReviewUrl || (data.googlePlaceId ? ('https://search.google.com/local/writereview?placeid=' + data.googlePlaceId) : null),
        address: data.address,
        phone: data.phone,
        rating: data.rating,
        reviewCount: data.reviewCount,
        country: data.country,
        state: data.state,
        city: data.city,
        localLanguages: data.localLanguages,
        languageConfig: data.languageConfig,
        reviewConfig: data.reviewConfig,
        businessProfile: data.businessProfile,
        subscription: data.subscription
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
    const raw = await Business.find({});
    const businesses = (raw || []).map(b => normalizeBusiness(b));
    res.json({ businesses });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/business — create new business (admin)
app.post('/api/business', requireAdmin, async (req, res) => {
  try {
    const { id, name, type, description, imageUrl, googlePlaceId, googleReviewUrl, address, phone, country, state, city, localLanguages, businessProfile, languageConfig, reviewConfig, questions, subscription } = req.body;
    if (!name || !type) return res.status(400).json({ error: 'Missing required fields: name, type' });

    const finalId = (id || (name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') + '-' + Math.floor(100 + Math.random() * 900))).trim();
    
    // Auto-derive googleReviewUrl if Place ID given
    const derivedReviewUrl = googleReviewUrl || (googlePlaceId ? ('https://search.google.com/local/writereview?placeid=' + googlePlaceId) : '');

    const business = new Business({
      _id: finalId,
      id: finalId,
      name,
      type,
      description: description || '',
      imageUrl: imageUrl || '',
      googlePlaceId: googlePlaceId || '',
      googleReviewUrl: derivedReviewUrl,
      address: address || '',
      phone: phone || '',
      country: country || 'India',
      state: state || '',
      city: city || '',
      localLanguages: localLanguages || ['English'],
      businessProfile: businessProfile || {},
      languageConfig: languageConfig || { mode: 'weighted', languages: [{ code: 'en', label: 'English', weight: 80 }, { code: 'hinglish', label: 'Hinglish', weight: 20 }] },
      reviewConfig: reviewConfig || { minWords: 18, maxWords: 45, tone: 'natural, conversational and genuine', emoji: true },
      questions: Array.isArray(questions) && questions.length ? questions : defaultQuestions(type),
      subscription: subscription || { plan: 'trial', status: 'trial', reviewLimit: 1000, reviewsUsed: 0 }
    });

    await business.save();
    const ret = normalizeBusiness(business);
    res.status(201).json({ success: true, id: finalId, business: ret });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ error: 'Business ID already exists' });
    res.status(500).json({ error: 'Internal server error: ' + err.message });
  }
});

// PUT /api/business/:id — admin update all business settings
app.put('/api/business/:id', requireAdmin, async (req, res) => {
  try {
    const allowed = ['name','type','description','imageUrl','googlePlaceId','googleReviewUrl','address','phone','country','state','city','localLanguages','businessProfile','languageConfig','reviewConfig','questions','subscription'];
    const patch = {};
    allowed.forEach(k => { if (req.body[k] !== undefined) patch[k] = req.body[k]; });
    if (patch.questions) patch.questions = patch.questions.map((q,i) => ({ ...q, order: q.order ?? i }));
    if (!patch.googleReviewUrl && patch.googlePlaceId) {
      patch.googleReviewUrl = 'https://search.google.com/local/writereview?placeid=' + patch.googlePlaceId;
    }

    const business = await Business.findByIdAndUpdate(req.params.id, patch, { new: true, runValidators: true });
    if (!business) return res.status(404).json({ error: 'Business not found' });
    res.json({ success: true, business: normalizeBusiness(business) });
  } catch (err) {
    console.error('PUT /business error:', err);
    res.status(400).json({ error: err.message || 'Failed to update business' });
  }
});

// POST /api/business/:id/subscription — quick toggle/update subscription
app.post('/api/business/:id/subscription', requireAdmin, async (req, res) => {
  try {
    const { status, plan, reviewLimit, endDate, startDate } = req.body;
    const patch = {};
    if (status !== undefined) patch['subscription.status'] = status;
    if (plan !== undefined) patch['subscription.plan'] = plan;
    if (reviewLimit !== undefined) patch['subscription.reviewLimit'] = Number(reviewLimit);
    if (endDate !== undefined) patch['subscription.endDate'] = endDate ? new Date(endDate) : null;
    if (startDate !== undefined) patch['subscription.startDate'] = startDate ? new Date(startDate) : new Date();

    const business = await Business.findByIdAndUpdate(req.params.id, { $set: patch }, { new: true });
    if (!business) return res.status(404).json({ error: 'Business not found' });
    res.json({ success: true, business: normalizeBusiness(business) });
  } catch (err) {
    console.error('Subscription update error:', err);
    res.status(500).json({ error: 'Failed to update subscription' });
  }
});

// DELETE /api/business/:id — admin delete business
app.delete('/api/business/:id', requireAdmin, async (req, res) => {
  try {
    const business = await Business.findByIdAndDelete(req.params.id);
    if (!business) return res.status(404).json({ error: 'Business not found' });
    await Analytics.deleteMany({ businessId: req.params.id });
    await Review.deleteMany({ businessId: req.params.id });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Failed to delete business' }); }
});

// GET /api/business/:id/admin — full editable configuration
app.get('/api/business/:id/admin', requireAdmin, async (req,res) => {
  try {
    const b = await Business.findById(req.params.id);
    if (!b) return res.status(404).json({ error: 'Business not found' });
    res.json({ business: normalizeBusiness(b) });
  } catch(e) { res.status(500).json({ error: 'Failed to fetch business' }); }
});

// Helper: category-aware, authentic human-style review generator with anti-repetition and dynamic tiers
function generateFallbackReview(rating, businessName, businessType, selectedChips, profile, language, previousReview) {
  const ans = Array.isArray(selectedChips) ? selectedChips.filter(Boolean) : [];
  const type = String(businessType || 'other').toLowerCase();

  let defaultHighlight = 'the experience';
  if (['restaurant', 'cafe', 'bar'].includes(type)) defaultHighlight = 'the food';
  else if (['salon', 'spa'].includes(type)) defaultHighlight = 'the service';
  else if (type === 'hotel') defaultHighlight = 'the stay';
  else if (type === 'gym') defaultHighlight = 'the workout';
  else if (type === 'hospital') defaultHighlight = 'the consultation';
  else if (type === 'retail') defaultHighlight = 'the collection';

  const a1 = ans[0] || (profile?.specialties?.[0] || profile?.services?.[0] || defaultHighlight);
  const a2 = ans[1] || 'great';
  const a3 = ans[2] || '';
  const prev = (previousReview || '').toLowerCase();

  const isExplicitHinglish = /^(hinglish|hindi)$/i.test(String(language || '').trim());
  const allowsHinglish = /hinglish|hindi/i.test(language || '');
  const isHinglish = isExplicitHinglish || (allowsHinglish && Math.random() < 0.20);

  const rTier = Math.random();
  const tier = rTier < 0.35 ? 'short' : (rTier < 0.75 ? 'medium' : 'long');

  let pool = [];

  if (isHinglish) {
    if (rating >= 4) {
      if (['restaurant', 'cafe', 'bar'].includes(type)) {
        if (tier === 'short') {
          pool = [
            `Khana sach me lajawab tha! Specially ${a1} ekdum fresh aur flavorful tha. Service super fast thi, definitely recommend karunga! 😋⭐`,
            `Pehli baar try kiya aur maza aa gaya. ${a1} ka taste spot-on tha aur staff kafi polite tha. 5/5 stars! 🙌🔥`,
            `Bahut sahi jagah hai! ${a1} try kiya jo ki sach me zabardast tha. Full paisa vasool experience raha! 💯👍`,
            `Taste aur quality dono top notch! ${a1} must-try hai yahan ka. Agli baar bhi yahin aayenge! ✨👌`
          ];
        } else if (tier === 'medium') {
          pool = [
            `Family ke sath visit kiya aur overall experience bahut badiya raha! Specially ${a1} ka taste ek number tha aur service bhi kafi prompt thi. Staff ka behavior polite tha, definitely repeat visit banta hai! 😋🙌⭐`,
            `Weekend par friends ke sath yahan gaye the. ${a1} order kiya jo ki fresh, hot aur ekdum delicious tha. Ambience bhi mast tha aur service super fast thi. 10/10 from my side! 🔥💯👌`,
            `Genuinely bahut accha experience raha ${businessName} me. Yahan ka ${a1} sach me best hai, portion size aur taste dono perfect the. Service quick aur staff welcoming tha. Jarur try karein! ✨👍`,
            `Taste, quality aur hygiene sab kuch top notch tha! ${a1} try kiya aur maza aa gaya. Staff kafi helpful tha aur order bina kisi delay ke aa gaya. Full paisa vasool! 👏⭐`
          ];
        } else {
          pool = [
            `Aaj family ke sath ${businessName} me visit kiya aur experience sach me lajawab raha! Humne ${a1} order kiya jo ki ekdum fresh, hot aur perfect flavor ke sath serve hua. Staff bahut polite aur cooperative tha, service lightning fast thi aur hygiene maintain thi. Aise taste aur hospitality ke liye full marks bante hain! 😋⭐🙌💯`,
            `Dosto ke sath visit kiya aur honestly expectations se bhi better experience raha! ${a1} ka taste sach me zabardast tha aur portion size bhi kaafi accha tha. Waiters kafi attentive the aur order aane me bilkul time nahi laga. Ambience fresh aur pleasant tha. Overall vibe aur quality dono 10 on 10 hain! 🔥✨👌👍`
          ];
        }
      } else if (['salon', 'spa'].includes(type)) {
        pool = [
          `Bohot hi accha service experience raha! Yahan ${a1} karwaya, staff super professional aur skilled tha. Ambience peaceful aur clean tha. 5 stars! ✨💇`,
          `Great service! ${a1} bilkul perfection ke sath kiya gaya. Staff ne properly care kiya aur guidance bhi di. Highly recommended! 💯👌`,
          `Pehli baar visit kiya aur experience lajawab tha. Cleanliness top-notch thi aur ${a1} se fully satisfied hoon. Definitely coming back! ⭐🙌`
        ];
      } else if (type === 'hotel') {
        pool = [
          `Stay bahut comfortable aur pleasant raha! Rooms spotless the, staff polite tha aur service prompt thi. Worth staying here! ⭐🏨`,
          `Family ke sath stay kiya. Location convenient thi aur hospitality dil jeetne wali thi. ${a1} ka experience bahut badiya tha! 🙌💯`,
          `Great ambiance and superb hospitality at ${businessName}. Check-in fast tha aur staff helpful tha. Highly recommended! ✨👌`
        ];
      } else {
        pool = [
          `Bohot hi shandar experience raha! ${a1} ki quality sach me top-class thi aur staff ka response bahut quick tha. Full satisfaction! 👏⭐`,
          `Service aur quality dono ekdum perfect! Yahan ka ${a1} must-experience hai. Very cooperative staff. 5/5! 💯👍`,
          `Experience bahut badiya raha yahan. Time par kaam hua aur professionalism dikhayi. Definitely recommend karunga! ✨🙌`
        ];
      }
    } else if (rating === 3) {
      pool = [
        `Decent visit raha. ${a1} theek tha, lekin thoda wait karna pada. Staff polite tha. 👍⏳`,
        `Average experience overall. ${a1} accha tha par service me thoda improvement chahiye. Clean space tha. 😐👍`
      ];
    } else {
      pool = [
        `Experience thoda disappointing raha aaj. ${a1} expect jaisa nahi tha aur service kafi slow thi. Improvement ki jarurat hai. 👎😕`
      ];
    }
  } else {
    // English reviews
    if (rating >= 4) {
      if (['restaurant', 'cafe', 'bar'].includes(type)) {
        if (tier === 'short') {
          pool = [
            `Had lunch here today and the ${a1.toLowerCase()} was absolutely delicious! Fast service and warm staff. Highly recommended! ⭐🙌`,
            `Popped in for a quick bite. Really loved the ${a1.toLowerCase()} — fresh, piping hot, and full of flavor. Great vibe! ✨👍`,
            `Stopped by ${businessName} and was seriously impressed. The ${a1.toLowerCase()} was cooked to perfection. Will definitely be coming back! 😋🔥`,
            `Such a great experience! Ordered the ${a1.toLowerCase()} and it totally hit the spot. Friendly team and quick service. 💯👌`,
            `Solid 5-star experience! The ${a1.toLowerCase()} was top notch and didn't take long at all. Warm hospitality throughout. ⭐👏`
          ];
        } else if (tier === 'medium') {
          pool = [
            `Came here with friends and had a wonderful experience! The ${a1.toLowerCase()} was exceptionally flavorful and fresh. Service was quick, tables were spotless, and the team was super polite. Will definitely visit again soon! 😋🙌✨`,
            `First time visiting ${businessName} and it exceeded our expectations. Ordered the ${a1.toLowerCase()}${a3 ? ' along with ' + a3.toLowerCase() : ''} and every bite was wonderful. Generous portions and very courteous hospitality. Highly recommended! ⭐👍💯`,
            `Such a delightful meal today! The ${a1.toLowerCase()} came out piping hot and tasted amazing. Staff was attentive without being intrusive, and the ambiance was cozy. A true standout place in town! 🔥👌⭐`,
            `Really loved everything about this visit. From the warm welcome to the delicious ${a1.toLowerCase()}, everything was top tier. Quick turnaround time and great pricing too. Deserves all the 5 stars! ⭐👏`
          ];
        } else {
          pool = [
            `Had an exceptional experience visiting ${businessName} today! We decided to order the ${a1.toLowerCase()}${a3 ? ' along with ' + a3.toLowerCase() : ''}, and it was prepared to absolute perfection with wonderful freshness and authentic flavor. The staff was incredibly welcoming, service was prompt despite the crowd, and the whole atmosphere was clean and lively. Easily one of our best visits — highly recommended! ⭐😋🙌💯`,
            `We visited on a recommendation and it truly lived up to expectations. The ${a1.toLowerCase()} was the highlight of our meal — rich, fresh, and cooked with genuine care. Service was speedy and courteous from start to finish, with great attention to cleanliness and presentation. Definitely coming back very soon! ✨🔥🍽️👌`,
            `Dropped in for dinner and left thoroughly impressed with both the food and the hospitality. The ${a1.toLowerCase()} was bursting with flavor and served piping hot without any long wait. The team went out of their way to make sure we were comfortable and satisfied. Great ambiance, reasonable prices, and authentic taste. A solid 5-star experience! ⭐👏💯`
          ];
        }
      } else if (['salon', 'spa'].includes(type)) {
        pool = [
          `Had an appointment today and couldn't be happier! The specialist did an outstanding job with ${a1.toLowerCase()}. Very clean, hygienic, and relaxing vibe. Highly recommend! ✨💇`,
          `Fantastic service! The team was super skilled and attentive. Loved how the ${a1.toLowerCase()} turned out. True professionals! ⭐🙌`,
          `Top-notch experience from start to finish. Welcoming reception, skilled stylists, and prompt service. My ${a1.toLowerCase()} was done to absolute perfection! 💯👌`
        ];
      } else if (type === 'hotel') {
        pool = [
          `Had a wonderful stay at ${businessName}! The room was spotless, the bed was comfortable, and the staff was courteous from check-in to check-out. Will definitely book again! ⭐🏨`,
          `Great hospitality and fantastic service! The amenities were clean and well maintained, especially ${a1.toLowerCase()}. Prompt room service and prime location. Highly recommended! 🙌💯`,
          `A truly pleasant and relaxing stay. Check-in was breezy, rooms were spacious and fresh, and the staff was always eager to help. Great value for money! ✨👌`
        ];
      } else {
        pool = [
          `Really great quality and fast service! The ${a1.toLowerCase()} was handled with complete professionalism. Friendly team and hassle-free experience. Deserves 5 stars! 💯👍`,
          `Exceeded all expectations! The staff was courteous, knowledgeable, and delivered great results with ${a1.toLowerCase()}. Will definitely visit again! ⭐👏`,
          `Super smooth experience at ${businessName}. Clean space, polite team, and prompt attention. Very happy with the service! ✨🙌`
        ];
      }
    } else if (rating === 3) {
      pool = [
        `Decent visit to ${businessName}. The ${a1.toLowerCase()} was alright, but service was a bit slow today. Staff was polite though. 👍⏳`,
        `Average experience overall. The ${a1.toLowerCase()} was good, but had to wait a while for everything. Clean space and courteous team, hope service speed improves. 😐👍`
      ];
    } else {
      pool = [
        `Disappointed with our visit today. The ${a1.toLowerCase()} fell below expectations and service was way too slow. Needs improvement. 👎😕`,
        `Unfortunately not a great experience at ${businessName}. The ${a1.toLowerCase()} took too long and staff seemed overwhelmed. Expected much better. 👎⏳`
      ];
    }
  }

  const filtered = pool.filter(t => !prev || !t.toLowerCase().includes(prev.slice(0, 15)));
  const finalPool = filtered.length ? filtered : pool;
  return finalPool[Math.floor(Math.random() * finalPool.length)];
}

// POST /api/generate-review — AI review generation
app.post('/api/generate-review', reviewLimiter, async (req, res) => {
  let dbBusiness = null;
  try {
    const { rating, businessType, businessName, selectedChips, businessId, language, reviewConfig, previousReview, qaDetails } = req.body;
    let languageConfig = req.body.languageConfig;

    if (!rating || !businessType || !businessName) {
      return res.status(400).json({ error: 'Missing required fields: rating, businessType, businessName' });
    }
    if (rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'Rating must be between 1 and 5' });
    }

    let cfg = reviewConfig || {};
    let customerLang = language || '';
    let profile = {};
    let data = { businessProfile: {}, reviewConfig: cfg, languageConfig };

    if (businessId) {
      dbBusiness = await Business.findById(businessId);
      if (!dbBusiness) return res.status(404).json({ error: 'Business not found' });
      if (!isSubscriptionActive(dbBusiness)) {
        return res.status(403).json({ error: 'Business subscription is inactive, paused, or review limit has been reached.' });
      }
      const reserved = await Business.findOneAndUpdate(
        { _id: businessId },
        { $inc: { 'subscription.reviewsUsed': 1 } },
        { new: true }
      );
      if (reserved) dbBusiness = reserved;
      data = normalizeBusiness(dbBusiness);
      cfg = data.reviewConfig || cfg;
      languageConfig = languageConfig || data.languageConfig;
      profile = data.businessProfile || {};

      const rawLang = language || pickLanguage(languageConfig) || 'English';
      const supportsHinglish = /hindi|hinglish/i.test(rawLang) ||
        (data.localLanguages || []).some(l => /hindi|hinglish/i.test(l));

      if (supportsHinglish) {
        if (/^(hinglish|hindi)$/i.test(String(language || '').trim())) {
          customerLang = language;
        } else {
          customerLang = Math.random() < 0.20 ? 'Hinglish' : 'English';
        }
      } else {
        customerLang = rawLang || 'English';
      }
    } else {
      const allowsHinglish = /hindi|hinglish/i.test(language || '');
      customerLang = /^(hinglish|hindi)$/i.test(String(language || '').trim())
        ? language
        : (allowsHinglish && Math.random() < 0.20 ? 'Hinglish' : (language || 'English'));
    }

    const userChips = Array.isArray(selectedChips) && selectedChips.length
      ? selectedChips.join(', ')
      : 'Everything was great';

    // Dynamic length tier: ~19 words (short), ~30 words (medium), ~50 words (long)
    const lengthTiers = [
      { name: 'short', min: 18, max: 24, desc: 'Keep it punchy, around 18 to 24 words (1 to 2 crisp sentences).' },
      { name: 'medium', min: 28, max: 36, desc: 'Keep it balanced, around 28 to 36 words (2 to 3 natural sentences).' },
      { name: 'long', min: 46, max: 55, desc: 'Make it a detailed, comprehensive review, around 46 to 55 words (3 to 4 sentences).' }
    ];
    const rTier = Math.random();
    const chosenTier = rTier < 0.35 ? lengthTiers[0] : (rTier < 0.75 ? lengthTiers[1] : lengthTiers[2]);

    const personas = [
      'a casual customer texting a quick review while leaving the venue, relaxed and authentic',
      'a local regular customer who loves good quality and appreciates attentive staff',
      'a customer who visited with friends or family and had a really pleasant time',
      'a busy professional who values prompt service, fresh ingredients, and hassle-free visit',
      'an enthusiastic reviewer highlighting the specific flavors, service, and vibe',
      'a first-time visitor pleasantly surprised by the warm hospitality and great quality'
    ];
    const randomPersona = personas[Math.floor(Math.random() * personas.length)];

    const structures = [
      'Start directly with what was ordered/experienced and how it tasted/felt, followed by a quick note on staff.',
      'Start with a casual opening about the visit, spotlight the main choices, and give a genuine recommendation.',
      'Compliment the prompt service and friendly team first, then mention the specific highlight.',
      'Keep it super punchy, 2 to 3 natural sentences like a real phone review on Google Maps.',
      'Focus on the freshness, quality, and great atmosphere before signing off happily.'
    ];
    const randomStructure = structures[Math.floor(Math.random() * structures.length)];

    const previousNotice = previousReview && typeof previousReview === 'string' && previousReview.trim().length > 5
      ? `DO NOT REPEAT PREVIOUS DRAFT: The user is regenerating. The previous draft was: "${previousReview.trim()}". You MUST produce a completely different, fresh review with different phrasing, different opening words, and unique sentence flow.`
      : '';

    const qaContext = Array.isArray(qaDetails) && qaDetails.length
      ? `SPECIFIC CUSTOMER QUESTION ANSWERS:
${qaDetails.map(q => `- ${q.question || 'Topic'}: ${q.answer}`).join('\n')}`
      : `CUSTOMER CHOICES: ${userChips}`;

    const bizSummary = profile.summary || dbBusiness?.description || '';
    const bizSpecialties = (profile.specialties && profile.specialties.length)
      ? profile.specialties.join(', ')
      : ((profile.services && profile.services.length) ? profile.services.join(', ') : '');
    const bizAmenities = (profile.amenities && profile.amenities.length) ? profile.amenities.join(', ') : '';
    const bizLocation = [data.city, data.state].filter(Boolean).join(', ');
    const bizAvoid = (profile.avoidClaims && profile.avoidClaims.length) ? `AVOID MENTIONING: ${profile.avoidClaims.join(', ')}` : '';
    const bizCustomInstructions = cfg.customInstructions || profile.aiInstructions || '';

    const businessContextBlock = [
      bizLocation ? `LOCATION: ${bizLocation}` : '',
      bizSummary ? `BUSINESS SUMMARY: ${bizSummary}` : '',
      bizSpecialties ? `SPECIALTIES / HIGHLIGHTS: ${bizSpecialties}` : '',
      bizAmenities ? `AMENITIES & AMBIENCE: ${bizAmenities}` : '',
      bizAvoid ? bizAvoid : '',
      bizCustomInstructions ? `OWNER INSTRUCTIONS: ${bizCustomInstructions}` : ''
    ].filter(Boolean).join('\n');

    const prompt = `Write an authentic, 100% human-sounding public Google review (rating: ${rating}/5) for "${businessName}" (${businessType}).
${businessContextBlock ? businessContextBlock + '\n' : ''}${qaContext}
CUSTOMER CHOICES: ${userChips}
PERSONA CONTEXT: ${randomPersona}
FLOW / STRUCTURE: ${randomStructure}
${previousNotice}
LANGUAGE: ${customerLang === 'Hinglish' ? 'Write in casual, authentic Hinglish (natural everyday mix of simple Hindi & English spoken by real customers in India).' : 'Write in natural, everyday conversational English.'}
STRICT HUMAN-VOICE RULES:
1. Sound like a real person typing a quick review on their phone right after their visit.
2. Incorporate the customer's choices (${userChips}) and naturally mention 1 relevant detail or specialty (${bizSpecialties || businessType}) to make the review feel 100% authentic.
3. ABSOLUTELY NO AI CLICHÉS OR MARKETING JARGON. Never use words like: "culinary journey", "symphony of flavours", "testament to", "delightful gastronomic", "epitome of", "tantalizing", "impeccable", "gem of a place", "feast for the senses", "a must-visit destination", "nestled in", "look no further", "delve", "elevate", "haven", "plethora".
4. Do NOT start with "${businessName}" or "I recently visited". Start directly with the experience.
5. LENGTH INSTRUCTION: ${chosenTier.desc} Target word count: between ${chosenTier.min} and ${chosenTier.max} words.
6. EMOJIS: Use 1 to 2 natural, expressive emojis (e.g. ⭐, 😋, 🙌, 🔥, ✨, 👍, 💯) exactly as real customers do when posting Google reviews.
7. Return ONLY the review text. No quotation marks, no preamble.`.trim();

    let review = null;
    let tokensUsed = 0;

    const withTimeout = (p, ms = 8000) => Promise.race([
      p,
      new Promise((_, rej) => setTimeout(() => rej(new Error('AI call timeout')), ms))
    ]);

    // 1. Try Gemini API
    if (geminiClient) {
      try {
        const response = await withTimeout(geminiClient.models.generateContent({
          model: 'gemini-3.8-flash',
          contents: prompt,
          config: {
            systemInstruction: 'You write authentic, concise Google reviews like a real local customer typing on their smartphone. Never sound like an AI, marketer, or copywriter.',
            thinkingConfig: { thinkingLevel: ThinkingLevel ? ThinkingLevel.LOW : 'LOW' },
            temperature: 1.05,
            maxOutputTokens: 600
          }
        }), 8000);
        review = response.text?.trim();
      } catch (geminiErr) {
        console.warn('Gemini review generation fallback:', geminiErr.message);
      }
    }

    // 2. Try OpenAI if configured and Gemini was not used or failed
    if (!review && openai) {
      try {
        const completion = await withTimeout(openai.chat.completions.create({
          model: 'gpt-4o-mini',
          max_tokens: 150,
          temperature: 1.05,
          messages: [
            { role: 'system', content: 'You write authentic, concise Google reviews for real customers. No clichés.' },
            { role: 'user', content: prompt }
          ]
        }), 6000);
        review = completion.choices[0]?.message?.content?.trim();
        tokensUsed = completion.usage?.total_tokens || 0;
      } catch (openAiErr) {
        console.warn('OpenAI review generation fallback:', openAiErr.message);
      }
    }

    // 3. Fallback generator with anti-repetition support
    if (!review) {
      review = generateFallbackReview(rating, businessName, businessType, selectedChips, profile, customerLang, previousReview);
    }

    if (review && review.startsWith('"') && review.endsWith('"')) {
      review = review.slice(1, -1).trim();
    }

    res.json({ review, tokensUsed });
  } catch (err) {
    console.error('Error generating review:', err);
    res.status(500).json({ error: 'Review generation encountered an error: ' + err.message });
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
        total:          entries.length,
        avgRating:      +avgRating.toFixed(2),
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
    const isHttps = req.headers['x-forwarded-proto'] === 'https' || req.protocol === 'https';
    const proto = isHttps ? 'https' : 'http';
    const baseUrl = req.query.baseUrl || `${proto}://${req.get('host')}`;
    const reviewUrl = req.query.reviewUrl || `${baseUrl}/review/${businessId}?auto=1`;

    const qrDataUrl = await QRCode.toDataURL(reviewUrl, {
      errorCorrectionLevel: 'H',
      margin: 2,
      color: { dark: '#0f0f0f', light: '#FFFFFF' },
      width: 512
    });

    res.json({ qrDataUrl, qr: qrDataUrl, reviewUrl, businessId });
  } catch (err) {
    res.status(500).json({ error: 'QR generation failed' });
  }
});

// GET /api/qr/:businessId/svg — SVG QR for print
app.get('/api/qr/:businessId/svg', requireAdmin, async (req, res) => {
  try {
    const { businessId } = req.params;
    const isHttps = req.headers['x-forwarded-proto'] === 'https' || req.protocol === 'https';
    const proto = isHttps ? 'https' : 'http';
    const baseUrl = req.query.baseUrl || `${proto}://${req.get('host')}`;
    const reviewUrl = req.query.reviewUrl || `${baseUrl}/review/${businessId}?auto=1`;

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

// POST /api/save-review — Save any review
app.post('/api/save-review', async (req, res) => {
  try {
    const { businessId, businessName, rating, reviewText, chips, type, sentToGoogle, customerName, customerPhone, source } = req.body;
    if (!businessId || rating === undefined) {
      return res.status(400).json({ error: 'Missing required fields: businessId and rating' });
    }

    const finalType = type || (Number(rating) >= 4 ? 'positive' : 'negative');
    const finalSentToGoogle = sentToGoogle !== undefined ? sentToGoogle : (Number(rating) >= 4);

    const doc = new Review({
      businessId,
      businessName: businessName || '',
      rating: Number(rating),
      reviewText: reviewText || '',
      chips: Array.isArray(chips) ? chips : [],
      type: finalType,
      sentToGoogle: finalSentToGoogle,
      customerName: customerName || '',
      customerPhone: customerPhone || '',
      source: source || 'qr_scan',
      userAgent: req.headers['user-agent'] || '',
      timestamp: new Date()
    });

    await doc.save();
    try {
      await Business.findByIdAndUpdate(businessId, { $inc: { reviewCount: 1 } });
    } catch (e) {}

    res.json({ success: true, id: doc._id });
  } catch (err) {
    console.error('Error saving review:', err);
    res.status(500).json({ error: 'Failed to save review: ' + err.message });
  }
});

// GET /api/reviews — Admin: list all saved reviews
app.get('/api/reviews', requireAdmin, async (req, res) => {
  try {
    const { businessId, type, limit = 100 } = req.query;
    const filter = {};
    if (businessId) filter.businessId = businessId;
    if (type && type !== 'all') filter.type = type;

    const reviews = await Review.find(filter)
      .sort({ timestamp: -1 })
      .limit(Number(limit));

    const total = await Review.countDocuments(businessId ? { businessId } : {});
    const positive = await Review.countDocuments(Object.assign({ type: 'positive' }, businessId ? { businessId } : {}));
    const negative = await Review.countDocuments(Object.assign({ type: 'negative' }, businessId ? { businessId } : {}));

    const avgDoc = await Review.aggregate([
      ...(businessId ? [{ $match: { businessId } }] : []),
      { $group: { _id: null, avgRating: { $avg: '$rating' } } }
    ]);
    const avgRating = avgDoc.length ? Number(avgDoc[0].avgRating.toFixed(1)) : 0;

    res.json({
      reviews,
      stats: { total, positive, negative, avgRating }
    });
  } catch (err) {
    console.error('GET /reviews error:', err);
    res.status(500).json({ error: 'Failed to fetch reviews' });
  }
});

// DELETE /api/reviews/:id — Admin: delete one review
app.delete('/api/reviews/:id', requireAdmin, async (req, res) => {
  try {
    await Review.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete review' });
  }
});

// DELETE /api/reviews — Admin: delete ALL reviews
app.delete('/api/reviews', requireAdmin, async (req, res) => {
  try {
    const result = await Review.deleteMany({});
    res.json({ success: true, deleted: result.deletedCount });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete reviews' });
  }
});

// Database offline error handler fallback
app.use((err, req, res, next) => {
  if (err.name === 'MongooseError' || err.name === 'MongoNetworkError' || (err.message && err.message.includes('buffering timed out'))) {
    console.warn('[AI Studio] Database offline fallback triggered:', err.message);
    if (req.method === 'GET') {
      return res.json(req.path.endsWith('s') || req.path.endsWith('s/') ? [] : {});
    }
    return res.status(503).json({ error: 'Service temporarily unavailable (database offline)' });
  }
  next(err);
});

// Static Frontend Serving (if Frontend folder is available next to Backened)
const frontendPath = path.join(__dirname, '../Frontend');
try {
  app.use(express.static(frontendPath));
  app.get('/admin', (req, res) => res.sendFile(path.join(frontendPath, 'admin.html')));
  app.get('/admin/*', (req, res) => res.sendFile(path.join(frontendPath, 'admin.html')));
  app.get('/review/:businessId', (req, res) => res.sendFile(path.join(frontendPath, 'review.html')));
  app.get('/review/*', (req, res) => res.sendFile(path.join(frontendPath, 'review.html')));
  app.get('/', (req, res) => res.sendFile(path.join(frontendPath, 'index.html')));
} catch (e) {}

if (require.main === module) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🚀 Zuit Review Platform running on http://0.0.0.0:${PORT}`);
    console.log(`   • Landing:   http://0.0.0.0:${PORT}/`);
    console.log(`   • Admin:     http://0.0.0.0:${PORT}/admin`);
    console.log(`   • Review:    http://0.0.0.0:${PORT}/review/delhi-spice-garden`);
    console.log(`   • Health:    http://0.0.0.0:${PORT}/api/health\n`);
  });
}

module.exports = app;
