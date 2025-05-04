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
  
  // New tracking fields
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

const User = mongoose.model('WideoakUser', WideoakUserSchema);

// // Run migration after connection
// const initDB = async () => {
//   await connectDB();
//   await migrateExistingUsers();
//   console.log("completed")
// };

// initDB()

module.exports = { connectDB, User };
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

// const User = mongoose.model('WideoakUser', WideoakUserSchema);

// module.exports = { connectDB, User };