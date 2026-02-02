const express = require('express');
const path = require('path');
const fs = require('fs');
const app = express();
const PORT = process.env.PORT || 8082;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Load full data for chat context generation
let fullData = null;
try {
  const raw = fs.readFileSync(path.join(__dirname, 'public', 'data', 'all-domains-v2.json'), 'utf-8');
  fullData = JSON.parse(raw);
  const totalApps = Object.values(fullData.domains).reduce((s, d) => s + d.applications.length, 0);
  console.log(`Data loaded: ${Object.keys(fullData.domains).length} domains, ${totalApps} applications`);
} catch (e) {
  // Fallback to v1 data
  try {
    const raw = fs.readFileSync(path.join(__dirname, 'public', 'data', 'all-domains-data.json'), 'utf-8');
    fullData = JSON.parse(raw);
    console.log('Loaded v1 data as fallback');
  } catch (e2) {
    console.warn('No data files found, chat will be limited');
  }
}

function buildChatContext(periodStart, periodEnd) {
  if (!fullData) return 'No grant data available.';

  const lines = [];
  lines.push('# Arbitrum DAO Season 3 Grant Program Data');
  lines.push(`Data as of: ${fullData.lastUpdated}`);

  if (periodStart && periodEnd) {
    lines.push(`\nREPORTING PERIOD: ${new Date(periodStart).toLocaleDateString('en-US', {month:'long',day:'numeric',year:'numeric'})} to ${new Date(periodEnd).toLocaleDateString('en-US', {month:'long',day:'numeric',year:'numeric'})}`);
  }

  const startTs = periodStart ? new Date(periodStart).getTime() / 1000 : 0;
  const endTs = periodEnd ? new Date(periodEnd).getTime() / 1000 : Infinity;

  let totalApps = 0, totalApproved = 0, totalDisbursed = 0;
  let periodReceived = 0, periodProcessed = 0;

  for (const [dk, dv] of Object.entries(fullData.domains)) {
    const info = dv.info;
    const apps = dv.applications;
    totalApps += apps.length;
    totalApproved += (dv.states.approved || 0);
    totalDisbursed += (dv.meta?.disbursedUSD || 0);

    // Period-scoped apps
    const received = apps.filter(a => a.created >= startTs && a.created < endTs);
    const processed = apps.filter(a => a.updated >= startTs && a.updated < endTs && a.state !== 'submitted');
    periodReceived += received.length;
    periodProcessed += processed.length;

    lines.push(`\n## ${info.name} (Allocator: ${info.allocator})`);
    lines.push(`Total: ${apps.length} apps | States: ${JSON.stringify(dv.states)}`);
    lines.push(`Disbursed: $${(dv.meta?.disbursedUSD || 0).toLocaleString()}`);

    if (periodStart) {
      lines.push(`\nIn reporting period: ${received.length} received, ${processed.length} processed`);
    }

    // List apps relevant to the period (or all non-rejected if no period)
    const relevantApps = periodStart
      ? [...new Set([...received, ...processed])]
      : apps.filter(a => a.state !== 'rejected');

    if (relevantApps.length > 0) {
      lines.push(`\n### Applications (${relevantApps.length}):`);
      for (const a of relevantApps.slice(0, 80)) {
        const dt = new Date(a.created * 1000).toISOString().split('T')[0];
        const name = a.name || a.applicant || `App ${a.id.slice(-8)}`;
        const ms = a.milestones?.length ? ` | ${a.milestones.length} milestones` : '';
        const cat = a.category ? ` | ${a.category}` : '';
        const funding = a.fundingAsk || a.grantAmount || '';
        const fundStr = funding ? ` | Ask: ${funding}` : '';
        lines.push(`- ${name} | ${a.state} | ${dt}${cat}${fundStr}${ms} | ID: ${a.id}`);
      }
      if (relevantApps.length > 80) {
        lines.push(`... and ${relevantApps.length - 80} more`);
      }
    }
  }

  lines.push(`\n## Program Totals`);
  lines.push(`Total applications: ${totalApps}`);
  lines.push(`Total approved: ${totalApproved}`);
  lines.push(`Total disbursed: $${totalDisbursed.toLocaleString()}`);
  if (periodStart) {
    lines.push(`\nIn reporting period: ${periodReceived} received, ${periodProcessed} processed`);
  }
  lines.push(`Program timeline: March 2025 - March 2026`);
  lines.push(`Grant range: $25,000 - $50,000 USDC`);
  lines.push(`Domains: NPI (Castle Labs), Dev Tooling (SeedGov), Events (MaxLomu), Gaming (Flook), Orbit (Juandi)`);

  return lines.join('\n');
}

// Chat endpoint
app.post('/api/chat', async (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ error: 'Chat not configured — set ANTHROPIC_API_KEY' });
  }

  const { message, history = [], periodStart, periodEnd } = req.body;
  if (!message || typeof message !== 'string' || message.length > 2000) {
    return res.status(400).json({ error: 'Invalid message' });
  }

  try {
    const context = buildChatContext(periodStart, periodEnd);

    const messages = [];
    const recentHistory = history.slice(-6);
    for (const h of recentHistory) {
      if (h.role === 'user' || h.role === 'assistant') {
        messages.push({ role: h.role, content: h.content });
      }
    }
    messages.push({ role: 'user', content: message });

    const periodLabel = periodStart && periodEnd
      ? `The user is viewing data for the reporting period ${new Date(periodStart).toLocaleDateString()} to ${new Date(periodEnd).toLocaleDateString()}. Focus your answers on this period unless asked otherwise.`
      : 'No specific reporting period selected — answer about all data.';

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
        system: `You are an analyst for the Arbitrum DAO Season 3 Grant Program. You have access to the complete dataset of all applications across all 5 domains. Answer questions about the data accurately and concisely. Reference specific numbers and applications when relevant. If asked about something not in the data, say so.\n\n${periodLabel}\n\nHere is the dataset:\n\n${context}`,
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
