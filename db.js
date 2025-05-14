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

const UserSession = mongoose.model('UserSession', UserSessionSchema);
const User = mongoose.model('WideoakUser', WideoakUserSchema);
const Lead = mongoose.model('Lead', LeadSchema);

module.exports = { connectDB, User, Lead };
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
