#!/usr/bin/env node
// Generate a JWT for a user (default id=7). Usage examples:
//   node scripts/gen-token.js --id 7
//   node scripts/gen-token.js --id 7 --email user@example.com --username elmorijah --expires 2h

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const jwt = require('jsonwebtoken');
const db = require('../config/db');

function parseArgs() {
	const args = process.argv.slice(2);
	const out = {};
	for (let i = 0; i < args.length; i++) {
		const a = args[i];
		if (a === '--id') out.id = parseInt(args[++i], 10);
		else if (a === '--email') out.email = String(args[++i]);
		else if (a === '--username') out.username = String(args[++i]);
		else if (a === '--expires' || a === '--exp') out.expires = String(args[++i]);
	}
	return out;
}

(async () => {
	try {
		const { id = 7, email, username, expires = '2h' } = parseArgs();
		let em = email;
		let un = username;

		// If email/username missing, try to fetch from DB
		if (!em || !un) {
			try {
				const [rows] = await db.query(
					'SELECT u.email, p.username FROM users u LEFT JOIN profiles p ON u.id = p.user_id WHERE u.id = ? LIMIT 1',
					[id]
				);
				if (rows && rows[0]) {
					em = em || rows[0].email || undefined;
					un = un || rows[0].username || undefined;
				}
			} catch (_) {}
		}

		const payload = { id, email: em, username: un };
		const secret = process.env.JWT_SECRET;
		if (!secret) {
			console.error('JWT_SECRET manquant dans backend/.env');
			process.exit(1);
		}
		const token = jwt.sign(payload, secret, { expiresIn: expires });
		console.log('user:', payload);
		console.log('token:', token);
	} catch (e) {
		console.error('Erreur gen-token:', e?.message || e);
		process.exit(1);
	} finally {
		// best-effort close for mysql pools; sqlite adapter no-op
		try { if (db && db.end) await db.end(); } catch {}
	}
})();
