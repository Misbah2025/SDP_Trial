const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const nodemailer = require('nodemailer');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// Enable Full CORS for local live servers and deployment domains
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

// Public Folder & Root Static Serve
app.use(express.static(path.join(__dirname)));
app.use(express.static(path.join(__dirname, 'public')));

// Nodemailer Transporter Configuration
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

// --- MongoDB Connection & Admin Auto-Sync ---
mongoose.connect(process.env.MONGO_URI)
  .then(async () => {
      console.log('✅ Connected to MongoDB Successfully!');
      await syncAdminAccount();
  })
  .catch((err) => console.error('❌ MongoDB Connection Error:', err));

// --- Schemas & Models ---
const userSchema = new mongoose.Schema({
    name: { type: String, required: true },
    emailOrPhone: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    role: { type: String, enum: ['donor', 'volunteer', 'org', 'NGO', 'admin'], required: true },
    otp: { type: String },
    otpExpires: { type: Date }
}, { timestamps: true });

const User = mongoose.model('User', userSchema);

// Admin Account Syncing Function
async function syncAdminAccount() {
    try {
        const adminEmail = 'rmisbah2019@gmail.com';
        await User.findOneAndUpdate(
            { emailOrPhone: adminEmail },
            {
                name: 'Misbah Ur Rahman',
                emailOrPhone: adminEmail,
                password: 'admin123',
                role: 'admin'
            },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );
        console.log('🛡️ Admin Account synced successfully for Misbah Ur Rahman!');
    } catch (err) {
        console.error('⚠️ Admin sync error:', err.message);
    }
}

const donationSchema = new mongoose.Schema({
    title: { type: String, required: true },
    donor: { type: String, required: true },
    quantity: { type: String, required: true },
    location: { type: String, required: true },
    expiry: { type: String, required: true },
    status: { type: String, default: 'Pending Verification' },
    type: { type: String, required: true },
    lat: { type: Number, required: true },
    lng: { type: Number, required: true },
    time: { type: String, default: 'Just now' }
}, { timestamps: true });

const Donation = mongoose.model('Donation', donationSchema);

// --- API Routes ---

// Get all donations & NGO requests
app.get('/api/donations', async (req, res) => {
    try {
        const donations = await Donation.find().sort({ createdAt: -1 });
        res.json(donations);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch donations' });
    }
});

// Create new donation or NGO food request
app.post('/api/donations', async (req, res) => {
    try {
        const newDonation = new Donation(req.body);
        const savedDonation = await newDonation.save();
        res.status(201).json(savedDonation);
    } catch (err) {
        res.status(400).json({ error: 'Failed to create donation post or NGO request' });
    }
});

// Update donation status (Support for NGO acceptance, In Transit, Delivered, Approved)
app.patch('/api/donations/:id', async (req, res) => {
    try {
        const updated = await Donation.findByIdAndUpdate(
            req.params.id, 
            { status: req.body.status }, 
            { new: true }
        );
        res.json(updated);
    } catch (err) {
        res.status(400).json({ error: 'Failed to update status' });
    }
});

// Register User (Supporting Donor, Volunteer, NGO/Org)
app.post('/api/auth/register', async (req, res) => {
    try {
        let { name, emailOrPhone, password, role } = req.body;
        role = role ? role.toLowerCase() : 'donor';
        if (role === 'ngo') role = 'org';

        if (role === 'admin') {
            return res.status(403).json({ error: 'Admin registration is restricted.' });
        }
        const existingUser = await User.findOne({ emailOrPhone: emailOrPhone.trim() });
        if (existingUser) {
            return res.status(400).json({ error: 'User already exists!' });
        }
        const newUser = new User({ 
            name: name.trim(), 
            emailOrPhone: emailOrPhone.trim(), 
            password, 
            role 
        });
        await newUser.save();
        res.status(201).json({ message: 'Account created successfully', user: { name: newUser.name, role: newUser.role } });
    } catch (err) {
        res.status(500).json({ error: 'Registration failed' });
    }
});

// Login User (Supporting case-insensitive role handling for org/NGO)
app.post('/api/auth/login', async (req, res) => {
    try {
        let { emailOrPhone, password, role } = req.body;
        emailOrPhone = emailOrPhone ? emailOrPhone.trim() : '';
        role = role ? role.toLowerCase() : '';
        if (role === 'ngo') role = 'org';

        if (role === 'admin') {
            if (emailOrPhone === 'rmisbah2019@gmail.com' && password === 'admin123') {
                return res.json({ 
                    message: 'Login successful', 
                    user: { name: 'Misbah Ur Rahman', role: 'admin' } 
                });
            }
        }

        const user = await User.findOne({ emailOrPhone, password, role });
        if (!user) {
            return res.status(400).json({ error: 'Invalid credentials or role.' });
        }
        res.json({ message: 'Login successful', user: { name: user.name, role: user.role } });
    } catch (err) {
        res.status(500).json({ error: 'Login failed' });
    }
});

// Step 1: Send OTP for Forgot Password
app.post('/api/auth/forgot', async (req, res) => {
    try {
        const { emailOrPhone } = req.body;
        const user = await User.findOne({ emailOrPhone: emailOrPhone.trim() });
        if (!user) {
            return res.status(404).json({ error: 'No account found with this email.' });
        }

        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const otpExpires = new Date(Date.now() + 2 * 60 * 1000); // 2 minutes expiry

        user.otp = otp;
        user.otpExpires = otpExpires;
        await user.save();

        const mailOptions = {
            from: process.env.EMAIL_USER,
            to: emailOrPhone.trim(),
            subject: 'ShareBite - Password Reset OTP',
            text: `Hello ${user.name},\n\nYour OTP for password reset is: ${otp}\nThis code is valid for 2 minutes.\n\nThank you,\nShareBite Team`
        };

        await transporter.sendMail(mailOptions);
        res.json({ message: 'OTP sent to your Gmail successfully.' });
    } catch (err) {
        console.error('Email sending error:', err);
        res.status(500).json({ error: 'Failed to send OTP email. Check Gmail App Password settings.' });
    }
});

// Step 2: Verify OTP & Reset Password
app.post('/api/auth/reset-password', async (req, res) => {
    try {
        const { emailOrPhone, otp, newPassword } = req.body;
        const user = await User.findOne({ emailOrPhone: emailOrPhone.trim() });

        if (!user || !user.otp || user.otp !== otp || user.otpExpires < Date.now()) {
            return res.status(400).json({ error: 'Invalid or expired OTP code.' });
        }

        user.password = newPassword;
        user.otp = undefined;
        user.otpExpires = undefined;
        await user.save();

        res.json({ message: 'Password reset successful!' });
    } catch (err) {
        res.status(500).json({ error: 'Password reset failed.' });
    }
});

// Serve index.html safely for both Local & Production Live Deployments
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Run Server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
});