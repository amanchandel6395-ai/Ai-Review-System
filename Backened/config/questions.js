// config/questions.js — Contextual experience questions per business type

const QUESTIONS = {
  restaurant: [
    {
      id: 'dish',
      question: 'What did you try?',
      chips: ['Biryani', 'Kebabs', 'Curries', 'Dal Makhani', 'Tandoori', 'Desserts', 'Thali', 'Starters']
    },
    {
      id: 'taste',
      question: 'How was the taste?',
      chips: ['Outstanding', 'Delicious', 'Good', 'Average', 'Disappointing']
    },
    {
      id: 'service',
      question: 'How was the service speed?',
      chips: ['Lightning fast', 'Quick', 'Acceptable', 'Slow', 'Very slow']
    },
    {
      id: 'ambience',
      question: 'Restaurant ambience?',
      chips: ['Cozy & warm', 'Lively', 'Elegant', 'Noisy', 'Too crowded']
    }
  ],

  hotel: [
    {
      id: 'room',
      question: 'How was the room?',
      chips: ['Luxurious', 'Comfortable', 'Spacious', 'Clean', 'Average', 'Disappointing']
    },
    {
      id: 'cleanliness',
      question: 'Cleanliness?',
      chips: ['Spotless', 'Very clean', 'Acceptable', 'Needs improvement']
    },
    {
      id: 'facilities',
      question: 'Facilities?',
      chips: ['Excellent WiFi', 'Great AC', 'Pool available', 'Gym access', 'Good breakfast', 'Room service']
    },
    {
      id: 'staff',
      question: 'Staff behavior?',
      chips: ['Exceptional', 'Helpful', 'Courteous', 'Average', 'Rude']
    }
  ],

  bar: [
    {
      id: 'music',
      question: 'How was the music?',
      chips: ['Amazing', 'Great vibe', 'Perfect volume', 'Too loud', 'Not my style']
    },
    {
      id: 'ambience',
      question: 'Overall ambience?',
      chips: ['Electric', 'Chill & cozy', 'Trendy', 'Lively', 'Dull']
    },
    {
      id: 'drinks',
      question: 'Drinks quality?',
      chips: ['Craft cocktails', 'Great beer selection', 'Signature drinks', 'Overpriced', 'Excellent spirits']
    },
    {
      id: 'crowd',
      question: 'Crowd vibe?',
      chips: ['Fun crowd', 'Chill', 'Trendy', 'Mixed', 'Too packed']
    }
  ],

  salon: [
    {
      id: 'service',
      question: 'Service quality?',
      chips: ['Exceptional cut', 'Great coloring', 'Relaxing massage', 'Skin treatment', 'Nail care', 'Styling']
    },
    {
      id: 'staff',
      question: 'Staff behavior?',
      chips: ['Expert & skilled', 'Very friendly', 'Attentive', 'Professional', 'Average']
    },
    {
      id: 'hygiene',
      question: 'Hygiene & cleanliness?',
      chips: ['Impeccable', 'Very clean', 'Good', 'Acceptable']
    },
    {
      id: 'value',
      question: 'Value for money?',
      chips: ['Excellent value', 'Worth it', 'Reasonable', 'Pricey but good', 'Overpriced']
    }
  ],

  hospital: [
    {
      id: 'doctor',
      question: 'Doctor behavior?',
      chips: ['Extremely caring', 'Professional', 'Thorough', 'Empathetic', 'Rushed', 'Dismissive']
    },
    {
      id: 'waiting',
      question: 'Waiting time?',
      chips: ['No wait', 'Quick (< 15 min)', 'Acceptable', 'Long wait', 'Very long wait']
    },
    {
      id: 'cleanliness',
      question: 'Cleanliness & hygiene?',
      chips: ['Excellent', 'Very clean', 'Good', 'Needs improvement']
    },
    {
      id: 'staff',
      question: 'Support staff?',
      chips: ['Incredibly helpful', 'Courteous', 'Professional', 'Prompt', 'Could improve']
    }
  ],

  cafe: [
    {
      id: 'coffee',
      question: 'Coffee quality?',
      chips: ['Exceptional', 'Perfectly brewed', 'Great flavor', 'Average', 'Disappointing']
    },
    {
      id: 'food',
      question: 'Food / pastries?',
      chips: ['Delicious', 'Fresh baked', 'Great variety', 'Average', 'Limited options']
    },
    {
      id: 'vibe',
      question: 'Cafe vibe?',
      chips: ['Perfect workspace', 'Cozy', 'Instagrammable', 'Noisy', 'Relaxed']
    },
    {
      id: 'service',
      question: 'Service?',
      chips: ['Friendly baristas', 'Quick', 'Knowledgeable', 'Slow', 'Average']
    }
  ],

  gym: [
    {
      id: 'equipment',
      question: 'Equipment?',
      chips: ['State of the art', 'Well maintained', 'Good variety', 'Outdated', 'Insufficient']
    },
    {
      id: 'trainers',
      question: 'Trainers?',
      chips: ['Expert guidance', 'Motivating', 'Approachable', 'Unavailable', 'Not helpful']
    },
    {
      id: 'cleanliness',
      question: 'Cleanliness?',
      chips: ['Spotless', 'Clean', 'Acceptable', 'Needs improvement']
    },
    {
      id: 'crowd',
      question: 'Crowd & space?',
      chips: ['Never crowded', 'Manageable', 'Sometimes full', 'Always packed']
    }
  ],

  spa: [
    {
      id: 'treatment',
      question: 'Treatment quality?',
      chips: ['Deeply relaxing', 'Therapeutic', 'Rejuvenating', 'Average', 'Disappointing']
    },
    {
      id: 'staff',
      question: 'Therapist?',
      chips: ['Expert hands', 'Very professional', 'Attentive', 'Average skill', 'Inexperienced']
    },
    {
      id: 'ambience',
      question: 'Ambience?',
      chips: ['Tranquil', 'Luxurious', 'Calming', 'Average', 'Noisy']
    },
    {
      id: 'value',
      question: 'Value for money?',
      chips: ['Worth every penny', 'Good value', 'Reasonable', 'Expensive']
    }
  ],

  other: [
    {
      id: 'overall',
      question: 'Overall experience?',
      chips: ['Excellent', 'Good', 'Average', 'Below average', 'Poor']
    },
    {
      id: 'service',
      question: 'Service quality?',
      chips: ['Outstanding', 'Very good', 'Acceptable', 'Needs improvement']
    },
    {
      id: 'staff',
      question: 'Staff behavior?',
      chips: ['Exceptional', 'Helpful', 'Professional', 'Average', 'Rude']
    }
  ]
};

// Ensure retail/other fallbacks exist
QUESTIONS.retail = QUESTIONS.other;

module.exports = { QUESTIONS };
