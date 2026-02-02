const express = require('express');
const path = require('path');
const fs = require('fs');
const app = express();
const PORT = process.env.PORT || 8082;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Static file server only — data loaded client-side

// Chat endpoint removed — no application-level context available

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Arbitrum Grants Dashboard running on port ${PORT}`);
});
