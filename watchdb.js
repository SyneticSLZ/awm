// db.js
const mongoose = require('mongoose');
const crypto = require('crypto'); // Node.js built-in module

// MongoDB Connection
const connectDB = async () => {
  try {
    await mongoose.connect('mongodb+srv://syneticslz:gMN1GUBtevSaw8DE@synetictest.bl3xxux.mongodb.net/?retryWrites=true&w=majority&appName=SyneticTest');
    console.log('MongoDB connected successfully');
  } catch (error) {
    console.error('MongoDB connection error:', error);
    process.exit(1);
  }
};

// Drug Watch Schema for monitoring drug updates
const DrugWatchSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'WideoakUser',
    required: true,
    index: true
  },
  watchName: {
    type: String,
    required: [true, 'Watch name is required'],
    trim: true
  },
  drugName: {
    type: String,
    required: [true, 'Drug name is required'],
    trim: true
  },
  condition: {
    type: String,
    trim: true,
    default: null
  },
  
  // Notification preferences
  notificationSources: {
    ema: {
      type: Boolean,
      default: true
    },
    fda: {
      type: Boolean,
      default: true
    },
    clinicalTrials: {
      type: Boolean,
      default: true
    },
    pubmed: {
      type: Boolean,
      default: true
    },
    dailyMed: {
      type: Boolean,
      default: false
    }
  },
  
  // Email preferences
  notificationEmail: {
    type: String,
    required: [true, 'Notification email is required'],
    trim: true,
    lowercase: true,
    match: [/^\S+@\S+\.\S+$/, 'Please enter a valid email']
  },
  
  // Frequency settings
  notificationFrequency: {
    type: String,
    enum: ['immediate', 'daily', 'weekly', 'monthly'],
    default: 'weekly'
  },
  
  // Search filters
  searchFilters: {
    hasResultsOnly: {
      type: Boolean,
      default: false
    },
    trdFocusOnly: {
      type: Boolean,
      default: false
    },
    yearsBack: {
      type: Number,
      default: 5
    },
    exactMatch: {
      type: Boolean,
      default: false
    }
  },
  
  // Status and tracking
  isActive: {
    type: Boolean,
    default: true
  },
  lastChecked: {
    type: Date,
    default: Date.now
  },
  nextCheck: {
    type: Date,
    default: function() {
      const now = new Date();
      switch(this.notificationFrequency) {
        case 'daily':
          return new Date(now.getTime() + 24 * 60 * 60 * 1000);
        case 'weekly':
          return new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
        case 'monthly':
          return new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
        default:
          return new Date(now.getTime() + 60 * 60 * 1000); // 1 hour for immediate
      }
    }
  },
  totalNotificationsSent: {
    type: Number,
    default: 0
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Drug Watch Results Schema - stores previous search results for comparison
const DrugWatchResultSchema = new mongoose.Schema({
  watchId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'DrugWatch',
    required: true,
    index: true
  },
  
  // Source of the result
  source: {
    type: String,
    enum: ['ema', 'fda', 'clinicalTrials', 'pubmed', 'dailyMed'],
    required: true
  },
  
  // Result data
  resultId: {
    type: String,
    required: true // External ID from the source (e.g., NCT number, PubMed ID)
  },
  title: {
    type: String,
    required: true
  },
  description: {
    type: String,
    default: null
  },
  url: {
    type: String,
    default: null
  },
  publishedDate: {
    type: Date,
    default: null
  },
  
  // Metadata
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  
  // Status tracking
  isNew: {
    type: Boolean,
    default: true
  },
  notificationSent: {
    type: Boolean,
    default: false
  },
  notificationSentAt: {
    type: Date,
    default: null
  },
  
  createdAt: {
    type: Date,
    default: Date.now
  }
});





// Drug Watch Methods
DrugWatchSchema.methods.updateLastChecked = function() {
  this.lastChecked = new Date();
  this.updatedAt = new Date();
  
  // Calculate next check time based on frequency
  const now = new Date();
  switch(this.notificationFrequency) {
    case 'immediate':
      this.nextCheck = new Date(now.getTime() + 60 * 60 * 1000); // 1 hour
      break;
    case 'daily':
      this.nextCheck = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24 hours
      break;
    case 'weekly':
      this.nextCheck = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 days
      break;
    case 'monthly':
      this.nextCheck = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // 30 days
      break;
  }
  
  return this.save();
};

DrugWatchSchema.methods.incrementNotificationCount = function() {
  this.totalNotificationsSent += 1;
  this.updatedAt = new Date();
  return this.save();
};

// Static method to find watches that need checking
DrugWatchSchema.statics.findWatchesNeedingCheck = function() {
  return this.find({
    isActive: true,
    nextCheck: { $lte: new Date() }
  }).populate('userId');
};

// Add indexes for DrugWatch
DrugWatchSchema.index({ userId: 1, isActive: 1 });
DrugWatchSchema.index({ nextCheck: 1, isActive: 1 });
DrugWatchSchema.index({ drugName: 1 });

// Add indexes for DrugWatchResult
DrugWatchResultSchema.index({ watchId: 1, source: 1 });
DrugWatchResultSchema.index({ resultId: 1, source: 1 }, { unique: true });
DrugWatchResultSchema.index({ isNew: 1, notificationSent: 1 });



const DrugWatch = mongoose.model('DrugWatch', DrugWatchSchema);
const DrugWatchResult = mongoose.model('DrugWatchResult', DrugWatchResultSchema);

module.exports = { 
  connectDB,  
  DrugWatch, 
  DrugWatchResult
};