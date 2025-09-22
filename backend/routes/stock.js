const express = require('express');
const router = express.Router();
const authenticateToken = require('../middleware/auth');

// Toutes les routes ici sont protégées
router.get('/stock', authenticateToken, (req, res) => {
  // Logique pour retourner les stocks
  res.json([/* tes données de stock ici */]);
});

module.exports = router;