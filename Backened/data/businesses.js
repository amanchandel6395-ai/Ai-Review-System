// data/businesses.js — Seed data + Mongoose model

const mongoose = require('mongoose');

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
  address:      { type: String, default: '' },
  phone:        { type: String, default: '' },

  country:      { type: String, default: 'India' },
  state:        { type: String, default: '' },
  city:         { type: String, default: '' },
  localLanguages: { type: [String], default: [] },

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
    maxWords: { type: Number, default: 45 },
    tone: { type: String, default: 'natural, conversational and genuine' },
    style: { type: String, default: 'short, everyday customer review' },
    emoji: { type: Boolean, default: false },
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

const Business = mongoose.model('Business', BusinessSchema);

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

const Analytics = mongoose.model('Analytics', AnalyticsSchema);

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
    rating: 4.7,
    reviewCount: 659
  }
];

// (export moved below)

// ── Review Schema (negative + positive both saved to MongoDB) ─────────────────
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

const Review = mongoose.model('Review', ReviewSchema);

module.exports = { Business, Analytics, Review, SEED_BUSINESSES };
