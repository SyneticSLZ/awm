// db.js
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

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
  }
});

// Methods for password hashing and verification
WideoakUserSchema.statics.hashPassword = function(password) {
  const salt = bcrypt.genSaltSync(10);
  const hash = bcrypt.hashSync(password, salt);
  return { hash, salt };
};

WideoakUserSchema.statics.verifyPassword = function(password, hash, salt) {
  return bcrypt.compareSync(password, hash);
};

const User = mongoose.model('WideoakUser', WideoakUserSchema);

module.exports = { connectDB, User };