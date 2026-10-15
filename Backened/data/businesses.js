// data/businesses.js — Seed data + Mongoose model with in-memory offline fallback

const mongoose = require('mongoose');

// CRITICAL: fail fast if MongoDB is not connected, do not hang
try {
  mongoose.set('bufferCommands', false);
} catch (e) {
  // ignore if already configured
}

// ── Schema ──────────────────────────────────────────────────────────────────
const QuestionOptionSchema = new mongoose.Schema({
  label: { type: String, required: true },
  value: { type: String, default: '' },
  sentiment: { type: String, enum: ['positive', 'neutral', 'negative', ''] , default: '' }
}, { _id: false });

const BusinessQuestionSchema = new mongoose.Schema({
  id: { type: String, required: true },
  text: { type: String, required: true },
  type: { type: String, enum: ['single', 'multi', 'yesno', 'rating', 'text'], default: 'single' },
  required: { type: Boolean, default: false },
  enabled: { type: Boolean, default: true },
  order: { type: Number, default: 0 },
  options: { type: [QuestionOptionSchema], default: [] }
}, { _id: false });

const BusinessSchema = new mongoose.Schema({
  _id:          { type: String, required: true },
  name:         { type: String, required: true },
  type:         {
    type: String,
    enum: ['restaurant', 'hotel', 'salon', 'bar', 'hospital', 'cafe', 'gym', 'spa', 'retail', 'other'],
    required: true
  },
  description:  { type: String, default: '' },
  imageUrl:     { type: String, default: '' },
  googlePlaceId:{ type: String, default: '' },
  googleReviewUrl:{ type: String, default: '' },
  address:      { type: String, default: '' },
  phone:        { type: String, default: '' },

  country:      { type: String, default: 'India' },
  state:        { type: String, default: '' },
  city:         { type: String, default: '' },
  localLanguages: { type: [String], default: [] },

  businessProfile: {
    summary: { type: String, default: '' },
    services: { type: [String], default: [] },
    specialties: { type: [String], default: [] },
    amenities: { type: [String], default: [] },
    targetAudience: { type: String, default: '' },
    differentiators: { type: [String], default: [] },
    reviewFocus: { type: [String], default: [] },
    localContext: { type: String, default: '' },
    avoidClaims: { type: [String], default: [] },
    aiInstructions: { type: String, default: '' }
  },

  languageConfig: {
    mode: { type: String, enum: ['fixed', 'weighted', 'random', 'customer'], default: 'fixed' },
    languages: [{
      code: { type: String },
      label: { type: String },
      weight: { type: Number, default: 100 }
    }]
  },

  reviewConfig: {
    minWords: { type: Number, default: 18 },
    maxWords: { type: Number, default: 60 },
    tone: { type: String, default: 'natural, conversational and genuine' },
    style: { type: String, default: 'short to detailed customer review' },
    emoji: { type: Boolean, default: true },
    customInstructions: { type: String, default: '' }
  },

  questions: { type: [BusinessQuestionSchema], default: [] },

  subscription: {
    plan: { type: String, default: 'trial' },
    startDate: { type: Date, default: Date.now },
    endDate: { type: Date, default: () => new Date(Date.now() + 30*24*60*60*1000) },
    status: { type: String, enum: ['active', 'expired', 'suspended', 'trial'], default: 'trial' },
    reviewLimit: { type: Number, default: 1000 },
    reviewsUsed: { type: Number, default: 0 }
  },

  rating:       { type: Number, default: 4.5 },
  reviewCount:  { type: Number, default: 0 },
  createdAt:    { type: Date, default: Date.now }
});

const MongooseBusiness = mongoose.model('Business', BusinessSchema);

// ── Analytics Schema ─────────────────────────────────────────────────────────
const AnalyticsSchema = new mongoose.Schema({
  businessId:   { type: String, ref: 'Business', required: true },
  rating:       { type: Number, required: true },
  chips:        { type: [String], default: [] },
  reviewLength: { type: Number },
  wasPosted:    { type: Boolean, default: false },
  timestamp:    { type: Date, default: Date.now },
  userAgent:    { type: String }
});

const MongooseAnalytics = mongoose.model('Analytics', AnalyticsSchema);

// ── Review Schema ───────────────────────────────────────────────────────────
const ReviewSchema = new mongoose.Schema({
  businessId:   { type: String, ref: 'Business', required: true },
  businessName: { type: String, default: '' },
  rating:       { type: Number, required: true },
  reviewText:   { type: String, default: '' },
  chips:        { type: [String], default: [] },
  type:         { type: String, enum: ['positive', 'negative'], required: true },
  sentToGoogle: { type: Boolean, default: false },
  userAgent:    { type: String, default: '' },
  timestamp:    { type: Date, default: Date.now }
});

const MongooseReview = mongoose.model('Review', ReviewSchema);

// ── Seed data ────────────────────────────────────────────────────────────────
const SEED_BUSINESSES = [
  {
    _id: 'spice-garden-001',
    name: 'Spice Garden',
    type: 'restaurant',
    description: 'Authentic North Indian cuisine crafted with heirloom spices and modern culinary artistry.',
    imageUrl: 'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=800&q=80',
    googlePlaceId: 'ChIJN1t_tDeuEmsRUsoyG83frY4',
    address: '12 Hazratganj, Lucknow, UP 226001',
    phone: '+91-522-4001234',
    country: 'India', state: 'Uttar Pradesh', city: 'Lucknow', localLanguages: ['English','Hindi','Hinglish'],
    businessProfile: { summary: 'North Indian restaurant serving dine-in meals and traditional Indian cuisine.', services: ['Dine-in', 'Food service'], specialties: ['North Indian cuisine'], amenities: ['Dine-in seating'], targetAudience: 'Local diners, families and food lovers', differentiators: ['Traditional spices and North Indian flavours'], reviewFocus: ['food quality', 'taste', 'service', 'ambience', 'value'], localContext: 'Lucknow, Uttar Pradesh', avoidClaims: [], aiInstructions: '' },
    rating: 4.7,
    reviewCount: 312
  },
  {
    _id: 'taj-palace-002',
    name: 'Taj Palace Hotel',
    type: 'hotel',
    description: 'Five-star luxury experience with heritage architecture, royal suites, and world-class amenities.',
    imageUrl: 'https://images.unsplash.com/photo-1551882547-ff40c63fe5fa?w=800&q=80',
    googlePlaceId: 'ChIJN1t_tDeuEmsRUsoyG83frY5',
    address: '1 Taj Road, New Delhi, 110001',
    phone: '+91-11-66510100',
    country: 'India', state: 'Delhi', city: 'New Delhi', localLanguages: ['English','Hindi','Hinglish'],
    businessProfile: { summary: 'Luxury hotel offering rooms, hospitality, dining and guest amenities.', services: ['Hotel stay', 'Guest services'], specialties: ['Luxury hospitality'], amenities: ['Hotel rooms', 'Dining', 'Guest amenities'], targetAudience: 'Business and leisure travellers', differentiators: ['Luxury hospitality and heritage setting'], reviewFocus: ['room', 'cleanliness', 'staff', 'facilities', 'location'], localContext: 'New Delhi, Delhi', avoidClaims: [], aiInstructions: '' },
    rating: 4.9,
    reviewCount: 1842
  },
  {
    _id: 'urban-glow-003',
    name: 'Urban Glow Salon',
    type: 'salon',
    description: 'Premium beauty studio offering cutting-edge hair styling, skin treatments, and wellness rituals.',
    imageUrl: 'https://images.unsplash.com/photo-1560066984-138daaa5c91a?w=800&q=80',
    googlePlaceId: 'ChIJN1t_tDeuEmsRUsoyG83frY6',
    address: '45 MG Road, Bengaluru, KA 560001',
    phone: '+91-80-41234567',
    country: 'India', state: 'Karnataka', city: 'Bengaluru', localLanguages: ['English','Kannada'],
    businessProfile: { summary: 'Premium salon providing hair, beauty and personal care services.', services: ['Hair styling', 'Hair colouring', 'Skin treatments'], specialties: ['Hair and beauty care'], amenities: ['Salon seating'], targetAudience: 'Beauty and personal-care customers', differentiators: ['Premium styling and beauty services'], reviewFocus: ['service', 'staff', 'hygiene', 'results', 'value'], localContext: 'Bengaluru, Karnataka', avoidClaims: [], aiInstructions: '' },
    rating: 4.6,
    reviewCount: 428
  },
  {
    _id: 'the-barrel-004',
    name: 'The Barrel & Brew',
    type: 'bar',
    description: 'Craft cocktails, live jazz, and an electric ambience that keeps the night alive.',
    imageUrl: 'https://images.unsplash.com/photo-1514362545857-3bc16c4c7d1b?w=800&q=80',
    googlePlaceId: 'ChIJN1t_tDeuEmsRUsoyG83frY7',
    address: '7 Bandra West, Mumbai, MH 400050',
    phone: '+91-22-26432100',
    country: 'India', state: 'Maharashtra', city: 'Mumbai', localLanguages: ['English','Hindi','Marathi','Hinglish'],
    businessProfile: { summary: 'Bar and nightlife venue offering drinks, ambience and entertainment.', services: ['Drinks service', 'Dining', 'Nightlife'], specialties: ['Cocktails and nightlife'], amenities: ['Bar seating', 'Music'], targetAudience: 'Adults seeking drinks and nightlife', differentiators: ['Cocktails and lively atmosphere'], reviewFocus: ['drinks', 'ambience', 'music', 'service', 'crowd'], localContext: 'Mumbai, Maharashtra', avoidClaims: [], aiInstructions: '' },
    rating: 4.5,
    reviewCount: 876
  },
  {
    _id: 'apollo-005',
    name: 'Apollo Medicity',
    type: 'hospital',
    description: 'Multi-speciality hospital with compassionate care, advanced diagnostics, and expert physicians.',
    imageUrl: 'https://images.unsplash.com/photo-1519494026892-80bbd2d6fd0d?w=800&q=80',
    googlePlaceId: 'ChIJN1t_tDeuEmsRUsoyG83frY8',
    address: 'Jubilee Hills, Hyderabad, TS 500033',
    phone: '+91-40-23607777',
    country: 'India', state: 'Telangana', city: 'Hyderabad', localLanguages: ['English','Telugu','Hindi'],
    businessProfile: { summary: 'Multi-speciality hospital providing medical consultation, diagnostics and patient care.', services: ['Medical consultation', 'Diagnostics', 'Patient care'], specialties: ['Multi-speciality healthcare'], amenities: ['Hospital facilities'], targetAudience: 'Patients and families', differentiators: ['Multi-speciality medical care'], reviewFocus: ['doctor', 'staff', 'waiting time', 'cleanliness', 'care'], localContext: 'Hyderabad, Telangana', avoidClaims: ['Do not make medical outcome or cure claims not supplied by the customer'], aiInstructions: 'Keep healthcare reviews focused on the patient experience and avoid inventing medical outcomes.' },
    rating: 4.8,
    reviewCount: 2140
  },
  {
    _id: 'brew-house-006',
    name: 'The Brew House Cafe',
    type: 'cafe',
    description: 'Specialty single-origin coffees, artisan pastries, and a cozy workspace vibe.',
    imageUrl: 'https://images.unsplash.com/photo-1501339847302-ac426a4a7cbb?w=800&q=80',
    googlePlaceId: 'ChIJN1t_tDeuEmsRUsoyG83frY9',
    address: '22 Koramangala, Bengaluru, KA 560034',
    phone: '+91-80-25678901',
    country: 'India', state: 'Karnataka', city: 'Bengaluru', localLanguages: ['English','Kannada'],
    businessProfile: { summary: 'Cafe serving specialty coffee, pastries and a relaxed workspace-friendly experience.', services: ['Coffee', 'Food and pastries', 'Cafe seating'], specialties: ['Specialty coffee'], amenities: ['Workspace seating'], targetAudience: 'Coffee lovers, students and professionals', differentiators: ['Specialty coffee and cozy workspace vibe'], reviewFocus: ['coffee', 'food', 'service', 'ambience', 'workspace'], localContext: 'Bengaluru, Karnataka', avoidClaims: [], aiInstructions: '' },
    rating: 4.7,
    reviewCount: 659
  }
];

// ── In-Memory Database Store (Active when MongoDB is not connected) ──────────
const inMemoryStore = {
  businesses: new Map(),
  analytics: [],
  reviews: []
};

// Initialize in-memory businesses
SEED_BUSINESSES.forEach(b => {
  const clone = JSON.parse(JSON.stringify(b));
  clone.toObject = function() { return { ...this }; };
  inMemoryStore.businesses.set(b._id, clone);
});

// Seed a few sample reviews in memory
inMemoryStore.reviews.push(
  {
    _id: 'rev-001',
    businessId: 'spice-garden-001',
    businessName: 'Spice Garden',
    rating: 5,
    reviewText: 'The Dal Makhani and Garlic Naan were exceptional! Prompt service and wonderful ambiance.',
    chips: ['Dal Makhani', 'Outstanding', 'Lightning fast'],
    type: 'positive',
    sentToGoogle: true,
    timestamp: new Date(Date.now() - 3600000),
    userAgent: 'Mozilla/5.0'
  },
  {
    _id: 'rev-002',
    businessId: 'taj-palace-002',
    businessName: 'Taj Palace Hotel',
    rating: 5,
    reviewText: 'World-class hospitality and spotless heritage suites. Will definitely stay again.',
    chips: ['Luxurious', 'Spotless', 'Exceptional'],
    type: 'positive',
    sentToGoogle: true,
    timestamp: new Date(Date.now() - 7200000),
    userAgent: 'Mozilla/5.0'
  }
);

function isDbConnected() {
  return mongoose.connection && mongoose.connection.readyState === 1;
}

// ── Business Proxy ──────────────────────────────────────────────────────────
const Business = function(doc) {
  if (isDbConnected()) {
    return new MongooseBusiness(doc);
  }
  const self = {
    ...doc,
    _id: doc._id || doc.id,
    toObject: function() { return { ...self }; },
    save: async function() {
      inMemoryStore.businesses.set(self._id, self);
      return self;
    }
  };
  return self;
};

Business.findById = async function(id) {
  if (isDbConnected()) {
    try {
      return await MongooseBusiness.findById(id);
    } catch (err) {
      console.warn('[AI Studio] MongoDB query failed, falling back to memory:', err.message);
    }
  }
  const b = inMemoryStore.businesses.get(id);
  if (!b) return null;
  return { ...b, toObject: () => ({ ...b }) };
};

Business.find = async function(filter, projection) {
  if (isDbConnected()) {
    try {
      return await MongooseBusiness.find(filter, projection);
    } catch (err) {
      console.warn('[AI Studio] MongoDB query failed, falling back to memory:', err.message);
    }
  }
  return Array.from(inMemoryStore.businesses.values());
};

Business.countDocuments = async function() {
  if (isDbConnected()) {
    try {
      return await MongooseBusiness.countDocuments();
    } catch (err) {
      console.warn('[AI Studio] MongoDB query failed, falling back to memory:', err.message);
    }
  }
  return inMemoryStore.businesses.size;
};

Business.insertMany = async function(docs) {
  if (isDbConnected()) {
    try {
      return await MongooseBusiness.insertMany(docs);
    } catch (err) {
      console.warn('[AI Studio] MongoDB query failed, falling back to memory:', err.message);
    }
  }
  docs.forEach(d => {
    const item = { ...d, toObject: () => ({ ...d }) };
    inMemoryStore.businesses.set(d._id, item);
  });
  return docs;
};

Business.findByIdAndUpdate = async function(id, patch, opts) {
  if (isDbConnected()) {
    try {
      return await MongooseBusiness.findByIdAndUpdate(id, patch, opts);
    } catch (err) {
      console.warn('[AI Studio] MongoDB query failed, falling back to memory:', err.message);
    }
  }
  const existing = inMemoryStore.businesses.get(id);
  if (!existing) return null;

  const toApply = Object.assign({}, patch.$set || {}, patch);
  delete toApply.$set;

  // Handle $inc
  if (toApply.$inc) {
    for (const [k, v] of Object.entries(toApply.$inc)) {
      if (k.includes('.')) {
        const parts = k.split('.');
        existing[parts[0]] = existing[parts[0]] || {};
        existing[parts[0]][parts[1]] = (existing[parts[0]][parts[1]] || 0) + v;
      } else {
        existing[k] = (existing[k] || 0) + v;
      }
    }
    delete toApply.$inc;
  }

  for (const [k, v] of Object.entries(toApply)) {
    if (k.includes('.')) {
      const parts = k.split('.');
      let curr = existing;
      for (let i = 0; i < parts.length - 1; i++) {
        curr[parts[i]] = curr[parts[i]] || {};
        curr = curr[parts[i]];
      }
      curr[parts[parts.length - 1]] = v;
    } else if (typeof v === 'object' && v !== null && !Array.isArray(v) && typeof existing[k] === 'object' && existing[k] !== null && !Array.isArray(existing[k])) {
      existing[k] = Object.assign({}, existing[k], v);
    } else {
      existing[k] = v;
    }
  }

  return { ...existing, toObject: () => ({ ...existing }) };
};

Business.findOneAndUpdate = async function(query, update, opts) {
  if (isDbConnected()) {
    try {
      return await MongooseBusiness.findOneAndUpdate(query, update, opts);
    } catch (err) {
      console.warn('[AI Studio] MongoDB query failed, falling back to memory:', err.message);
    }
  }
  const id = query._id;
  const existing = inMemoryStore.businesses.get(id);
  if (!existing) return null;
  if (update.$inc) {
    for (const [k, v] of Object.entries(update.$inc)) {
      if (k.includes('.')) {
        const parts = k.split('.');
        existing[parts[0]] = existing[parts[0]] || {};
        existing[parts[0]][parts[1]] = (existing[parts[0]][parts[1]] || 0) + v;
      } else {
        existing[k] = (existing[k] || 0) + v;
      }
    }
  }
  return { ...existing, toObject: () => ({ ...existing }) };
};

Business.findByIdAndDelete = async function(id) {
  if (isDbConnected()) {
    try {
      return await MongooseBusiness.findByIdAndDelete(id);
    } catch (err) {
      console.warn('[AI Studio] MongoDB query failed, falling back to memory:', err.message);
    }
  }
  const b = inMemoryStore.businesses.get(id);
  inMemoryStore.businesses.delete(id);
  return b;
};

// ── Analytics Proxy ─────────────────────────────────────────────────────────
const Analytics = function(doc) {
  if (isDbConnected()) {
    return new MongooseAnalytics(doc);
  }
  const self = {
    ...doc,
    _id: 'an-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
    timestamp: new Date(),
    save: async function() {
      inMemoryStore.analytics.push(self);
      return self;
    }
  };
  return self;
};

Analytics.find = async function(filter) {
  if (isDbConnected()) {
    try {
      return await MongooseAnalytics.find(filter);
    } catch (err) {
      console.warn('[AI Studio] MongoDB query failed, falling back to memory:', err.message);
    }
  }
  return inMemoryStore.analytics.filter(a => !filter.businessId || a.businessId === filter.businessId);
};

Analytics.deleteMany = async function(filter) {
  if (isDbConnected()) {
    try {
      return await MongooseAnalytics.deleteMany(filter);
    } catch (err) {
      console.warn('[AI Studio] MongoDB query failed, falling back to memory:', err.message);
    }
  }
  const before = inMemoryStore.analytics.length;
  inMemoryStore.analytics = inMemoryStore.analytics.filter(a => filter.businessId && a.businessId !== filter.businessId);
  return { deletedCount: before - inMemoryStore.analytics.length };
};

// ── Review Proxy ────────────────────────────────────────────────────────────
const Review = function(doc) {
  if (isDbConnected()) {
    return new MongooseReview(doc);
  }
  const self = {
    ...doc,
    _id: 'rev-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
    timestamp: new Date(),
    save: async function() {
      inMemoryStore.reviews.push(self);
      return self;
    }
  };
  return self;
};

Review.find = function(filter, projection) {
  if (isDbConnected()) {
    try {
      return MongooseReview.find(filter, projection);
    } catch (err) {
      console.warn('[AI Studio] MongoDB query failed, falling back to memory:', err.message);
    }
  }
  const f = filter || {};
  let list = inMemoryStore.reviews.filter(r => {
    if (f.type && r.type !== f.type) return false;
    if (f.businessId && r.businessId !== f.businessId) return false;
    return true;
  }).slice();

  const queryObj = {
    _list: list,
    sort: function(sortOpts) {
      this._list.sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));
      return this;
    },
    limit: function(lim) {
      this._list = this._list.slice(0, lim);
      return this;
    },
    then: function(resolve, reject) {
      return Promise.resolve(this._list).then(resolve, reject);
    }
  };
  return queryObj;
};

Review.countDocuments = async function(filter = {}) {
  if (isDbConnected()) {
    try {
      return await MongooseReview.countDocuments(filter);
    } catch (err) {
      console.warn('[AI Studio] MongoDB query failed, falling back to memory:', err.message);
    }
  }
  return inMemoryStore.reviews.filter(r => {
    if (filter.type && r.type !== filter.type) return false;
    if (filter.businessId && r.businessId !== filter.businessId) return false;
    return true;
  }).length;
};

Review.findByIdAndDelete = async function(id) {
  if (isDbConnected()) {
    try {
      return await MongooseReview.findByIdAndDelete(id);
    } catch (err) {
      console.warn('[AI Studio] MongoDB query failed, falling back to memory:', err.message);
    }
  }
  const idx = inMemoryStore.reviews.findIndex(r => r._id === id);
  if (idx !== -1) {
    const deleted = inMemoryStore.reviews.splice(idx, 1)[0];
    return deleted;
  }
  return null;
};

Review.deleteMany = async function(filter = {}) {
  if (isDbConnected()) {
    try {
      return await MongooseReview.deleteMany(filter);
    } catch (err) {
      console.warn('[AI Studio] MongoDB query failed, falling back to memory:', err.message);
    }
  }
  const count = inMemoryStore.reviews.length;
  inMemoryStore.reviews = [];
  return { deletedCount: count };
};

module.exports = { Business, Analytics, Review, SEED_BUSINESSES, isDbConnected };
