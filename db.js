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

// User Schema
const WideoakUserSchema = new mongoose.Schema({
  username: {
    type: String,
    required: [true, 'Username is required'],
    unique: true,
    trim: true
  },
  email: {
    type: String,
    required: [true, 'Email is required'],
    unique: true,
    trim: true,
    lowercase: true,
    match: [/^\S+@\S+\.\S+$/, 'Please enter a valid email']
  },
  passwordHash: {
    type: String,
    required: true
  },
  salt: {
    type: String,
    required: true
  },
  role: {
    type: String,
    enum: ['user', 'admin'],
    default: 'user'
  },
  usage: {
    type: Number,
    default: 0
  },
  billingPeriod: {
    type: String,
    default: () => {
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      return `${monthStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} - ${monthEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
    }
  },
  subscriptionStatus: {
    type: String,
    default: 'free-trial'
  },
  darkModeEnabled: {
    type: Boolean,
    default: false
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  
  // Tracking fields
  lastLogin: {
    type: Date,
    default: null
  },
  loginDates: {
    type: [Date],
    default: []
  },
  dailyLogins: {
    type: Map,
    of: Number,
    default: {}
  },
  monthlyLogins: {
    type: Map,
    of: Number,
    default: {}
  },
  activityLog: {
    type: [{
      timestamp: {
        type: Date,
        default: Date.now
      },
      activity: {
        type: String,
        required: true
      },
      details: {
        type: mongoose.Schema.Types.Mixed,
        default: {}
      }
    }],
    default: []
  }
});

// New Lead Schema for demo requests and contact form submissions
const LeadSchema = new mongoose.Schema({
  firstName: {
    type: String,
    required: [true, 'First name is required'],
    trim: true
  },
  lastName: {
    type: String,
    required: [true, 'Last name is required'],
    trim: true
  },
  email: {
    type: String,
    required: [true, 'Email is required'],
    trim: true,
    lowercase: true,
    match: [/^\S+@\S+\.\S+$/, 'Please enter a valid email']
  },
  company: {
    type: String,
    trim: true,
    default: null
  },
  companyRevenueRange: {
    type: String,
    enum: ['Under $10M', '$10M - $50M', '$50M - $100M', 'Over $100M', null],
    default: null
  },
  phone: {
    type: String,
    trim: true,
    default: null
  },
  message: {
    type: String,
    trim: true,
    default: null
  },
  source: {
    type: String,
    enum: ['demo_form', 'contact_form', 'linkedin_ad', 'other'],
    required: true
  },
  campaign: {
    type: String,
    default: null
  },
  leadStatus: {
    type: String,
    enum: ['new', 'contacted', 'qualified', 'unqualified', 'converted'],
    default: 'new'
  },
  agreeToTerms: {
    type: Boolean,
    default: false
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  linkedinData: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  },
  notes: {
    type: String,
    default: null
  }
});

// Updated Drug Watch Schema for db.js
// Add this updated schema to your existing db.js file

// Drug Watch Schema for monitoring drug updates
const DrugWatchSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'WideoakUser',
    required: true,
    index: true
  },
  userEmail: {
    type: String,
    required: true,
    trim: true,
    lowercase: true,
    index: true // Add index for faster queries by email
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
DrugWatchSchema.index({ userEmail: 1, isActive: 1 }); // New index for email queries
DrugWatchSchema.index({ nextCheck: 1, isActive: 1 });
DrugWatchSchema.index({ drugName: 1 });

// Migration function to add userEmail to existing records
const migrateWatchesToIncludeEmail = async () => {
  try {
    const DrugWatch = mongoose.model('DrugWatch');
    const User = mongoose.model('WideoakUser');
    
    // Find watches without userEmail
    const watchesWithoutEmail = await DrugWatch.find({ 
      userEmail: { $exists: false } 
    }).populate('userId');
    
    console.log(`Found ${watchesWithoutEmail.length} watches needing email migration`);
    
    for (const watch of watchesWithoutEmail) {
      if (watch.userId && watch.userId.email) {
        watch.userEmail = watch.userId.email;
        await watch.save();
        console.log(`Updated watch ${watch._id} with email ${watch.userId.email}`);
      }
    }
    
    console.log('Email migration completed');
  } catch (error) {
    console.error('Error in email migration:', error);
  }
};


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

// Methods for password hashing and verification using crypto
WideoakUserSchema.statics.hashPassword = function(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
  return { hash, salt };
};

WideoakUserSchema.statics.verifyPassword = function(password, hash, salt) {
  const verifyHash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
  return hash === verifyHash;
};

// Migration function to add tracking fields to existing users
const migrateExistingUsers = async () => {
  try {
    const now = new Date();
    
    // Count documents that need updating
    const needsUpdate = await User.countDocuments({
      $or: [
        { lastLogin: { $exists: false } },
        { loginDates: { $exists: false } },
        { dailyLogins: { $exists: false } },
        { monthlyLogins: { $exists: false } },
        { activityLog: { $exists: false } }
      ]
    });
    
    if (needsUpdate > 0) {
      console.log(`Found ${needsUpdate} users that need migration`);
      
      // Update all users that need the new fields
      const result = await User.updateMany(
        {
          $or: [
            { lastLogin: { $exists: false } },
            { loginDates: { $exists: false } },
            { dailyLogins: { $exists: false } },
            { monthlyLogins: { $exists: false } },
            { activityLog: { $exists: false } }
          ]
        },
        {
          $set: {
            lastLogin: null,
            loginDates: [],
            dailyLogins: {},
            monthlyLogins: {},
            activityLog: []
          }
        }
      );
      
      console.log(`Migration complete: ${result.modifiedCount} users updated`);
    } else {
      console.log('No users need migration');
    }
  } catch (error) {
    console.error('Migration error:', error);
  }
};
// New UserSession Schema for detailed tracking
const UserSessionSchema = new mongoose.Schema({
  sessionId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'WideoakUser',
    default: null
  },
  pageUrl: {
    type: String,
    required: true
  },
  referrer: {
    type: String,
    default: null
  },
  startTime: {
    type: Date,
    required: true
  },
  endTime: {
    type: Date,
    default: null
  },
  timeSpent: {
    type: Number,
    default: 0
  },
  screenWidth: {
    type: Number,
    required: true
  },
  screenHeight: {
    type: Number,
    required: true
  },
  userAgent: {
    type: String,
    required: true
  },
  deviceType: {
    type: String,
    enum: ['desktop', 'tablet', 'mobile'],
    required: true
  },
  mousePositions: [{
    x: Number,
    y: Number,
    timestamp: Date
  }],
  clicks: [{
    x: Number,
    y: Number,
    timestamp: Date,
    target: {
      tagName: String,
      id: String,
      className: String,
      text: String,
      href: String
    }
  }],
  scrollDepth: {
    type: Number,
    default: 0
  },
  scrollPositions: [{
    position: Number,
    timestamp: Date
  }],
  inactive: {
    type: Boolean,
    default: false
  },
  isFinal: {
    type: Boolean,
    default: false
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

// Add index for querying by date range
UserSessionSchema.index({ startTime: 1 });
// Add index for analyzing specific page performance
UserSessionSchema.index({ pageUrl: 1 });

// Add method to calculate device type from user agent
UserSessionSchema.pre('save', function(next) {
  if (!this.deviceType) {
    const userAgent = this.userAgent.toLowerCase();
    if (/(tablet|ipad|playbook|silk)|(android(?!.*mobi))/i.test(userAgent)) {
      this.deviceType = 'tablet';
    } else if (/Mobile|Android|iP(hone|od)|IEMobile|BlackBerry|Kindle|Silk-Accelerated|(hpw|web)OS|Opera M(obi|ini)/.test(userAgent)) {
      this.deviceType = 'mobile';
    } else {
      this.deviceType = 'desktop';
    }
  }
  this.updatedAt = Date.now();
  next();
});





// Add indexes for DrugWatchResult
DrugWatchResultSchema.index({ watchId: 1, source: 1 });
DrugWatchResultSchema.index({ resultId: 1, source: 1 }, { unique: true });
DrugWatchResultSchema.index({ isNew: 1, notificationSent: 1 });



const DrugWatch = mongoose.model('DrugWatch', DrugWatchSchema);
const DrugWatchResult = mongoose.model('DrugWatchResult', DrugWatchResultSchema);
const UserSession = mongoose.model('UserSession', UserSessionSchema);
const User = mongoose.model('WideoakUser', WideoakUserSchema);
const Lead = mongoose.model('Lead', LeadSchema);




module.exports = { connectDB, User, Lead, DrugWatch, DrugWatchResult, migrateWatchesToIncludeEmail };
// // db.js
// const mongoose = require('mongoose');
// const crypto = require('crypto'); // Node.js built-in module

// // MongoDB Connection
// const connectDB = async () => {
//   try {
//     await mongoose.connect('mongodb+srv://syneticslz:gMN1GUBtevSaw8DE@synetictest.bl3xxux.mongodb.net/?retryWrites=true&w=majority&appName=SyneticTest');
//     console.log('MongoDB connected successfully');
//   } catch (error) {
//     console.error('MongoDB connection error:', error);
//     process.exit(1);
//   }
// };

// // User Schema
// const WideoakUserSchema = new mongoose.Schema({
//   username: {
//     type: String,
//     required: [true, 'Username is required'],
//     unique: true,
//     trim: true
//   },
//   email: {
//     type: String,
//     required: [true, 'Email is required'],
//     unique: true,
//     trim: true,
//     lowercase: true,
//     match: [/^\S+@\S+\.\S+$/, 'Please enter a valid email']
//   },
//   passwordHash: {
//     type: String,
//     required: true
//   },
//   salt: {
//     type: String,
//     required: true
//   },
//   role: {
//     type: String,
//     enum: ['user', 'admin'],
//     default: 'user'
//   },
//   usage: {
//     type: Number,
//     default: 0
//   },
//   billingPeriod: {
//     type: String,
//     default: () => {
//       const now = new Date();
//       const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
//       const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
//       return `${monthStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} - ${monthEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
//     }
//   },
//   subscriptionStatus: {
//     type: String,
//     default: 'free-trial'
//   },
//   darkModeEnabled: {
//     type: Boolean,
//     default: false
//   },
//   createdAt: {
//     type: Date,
//     default: Date.now
//   },
  
//   // New tracking fields
//   lastLogin: {
//     type: Date,
//     default: null
//   },
//   loginDates: {
//     type: [Date],
//     default: []
//   },
//   dailyLogins: {
//     type: Map,
//     of: Number,
//     default: {}
//   },
//   monthlyLogins: {
//     type: Map,
//     of: Number,
//     default: {}
//   },
//   activityLog: {
//     type: [{
//       timestamp: {
//         type: Date,
//         default: Date.now
//       },
//       activity: {
//         type: String,
//         required: true
//       },
//       details: {
//         type: mongoose.Schema.Types.Mixed,
//         default: {}
//       }
//     }],
//     default: []
//   }
// });

// // Methods for password hashing and verification using crypto
// WideoakUserSchema.statics.hashPassword = function(password) {
//   const salt = crypto.randomBytes(16).toString('hex');
//   const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
//   return { hash, salt };
// };

// WideoakUserSchema.statics.verifyPassword = function(password, hash, salt) {
//   const verifyHash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
//   return hash === verifyHash;
// };

// // Migration function to add tracking fields to existing users
// const migrateExistingUsers = async () => {
//   try {
//     const now = new Date();
    
//     // Count documents that need updating
//     const needsUpdate = await User.countDocuments({
//       $or: [
//         { lastLogin: { $exists: false } },
//         { loginDates: { $exists: false } },
//         { dailyLogins: { $exists: false } },
//         { monthlyLogins: { $exists: false } },
//         { activityLog: { $exists: false } }
//       ]
//     });
    
//     if (needsUpdate > 0) {
//       console.log(`Found ${needsUpdate} users that need migration`);
      
//       // Update all users that need the new fields
//       const result = await User.updateMany(
//         {
//           $or: [
//             { lastLogin: { $exists: false } },
//             { loginDates: { $exists: false } },
//             { dailyLogins: { $exists: false } },
//             { monthlyLogins: { $exists: false } },
//             { activityLog: { $exists: false } }
//           ]
//         },
//         {
//           $set: {
//             lastLogin: null,
//             loginDates: [],
//             dailyLogins: {},
//             monthlyLogins: {},
//             activityLog: []
//           }
//         }
//       );
      
//       console.log(`Migration complete: ${result.modifiedCount} users updated`);
//     } else {
//       console.log('No users need migration');
//     }
//   } catch (error) {
//     console.error('Migration error:', error);
//   }
// };

// const User = mongoose.model('WideoakUser', WideoakUserSchema);

// // // Run migration after connection
// // const initDB = async () => {
// //   await connectDB();
// //   await migrateExistingUsers();
// //   console.log("completed")
// // };

// // initDB()

// module.exports = { connectDB, User };
