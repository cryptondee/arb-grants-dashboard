const express = require('express');
const path = require('path');
const fs = require('fs');
const app = express();
const PORT = process.env.PORT || 8082;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Load chat context
let chatContext = '';
try {
  chatContext = fs.readFileSync(path.join(__dirname, 'chat-context.txt'), 'utf-8');
  console.log(`Chat context loaded: ${chatContext.length} chars`);
} catch (e) {
  console.warn('No chat-context.txt found, chat disabled');
}

// Chat endpoint
app.post('/api/chat', async (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || !chatContext) {
    return res.status(503).json({ error: 'Chat not configured' });
  }

  const { message, history = [] } = req.body;
  if (!message || typeof message !== 'string' || message.length > 2000) {
    return res.status(400).json({ error: 'Invalid message' });
  }

  try {
    const messages = [];

    // Include last 6 messages of history for conversation continuity
    const recentHistory = history.slice(-6);
    for (const h of recentHistory) {
      if (h.role === 'user' || h.role === 'assistant') {
        messages.push({ role: h.role, content: h.content });
      }
    }

    messages.push({ role: 'user', content: message });

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-3-5-haiku-20241022',
        max_tokens: 1024,
        system: `You are an analyst for the Arbitrum DAO Season 3 Grant Program. You have access to the complete dataset of all applications across all 5 domains. Answer questions about the data accurately and concisely. Reference specific numbers and applications when relevant. If asked about something not in the data, say so.\n\nHere is the complete dataset:\n\n${chatContext}`,
        messages
      })
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('Anthropic API error:', response.status, err);
      return res.status(502).json({ error: 'LLM request failed' });
    }

    const data = await response.json();
    const reply = data.content?.[0]?.text || 'No response';
    res.json({ reply });
  } catch (err) {
    console.error('Chat error:', err.message);
    res.status(500).json({ error: 'Internal error' });
  }
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Arbitrum Grants Dashboard running on port ${PORT}`);
});
