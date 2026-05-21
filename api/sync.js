export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Use global variable to store data in memory (persists across warm invocations)
  if (!global.avtrDataStore) {
    global.avtrDataStore = {
      users: [],
      txns: [],
      tickets: [],
      activity_logs: []
    };
  }

  if (req.method === 'GET') {
    return res.status(200).json(global.avtrDataStore);
  }

  if (req.method === 'POST') {
    try {
      const { users, txns, tickets, activity_logs } = req.body;
      if (users) global.avtrDataStore.users = users;
      if (txns) global.avtrDataStore.txns = txns;
      if (tickets) global.avtrDataStore.tickets = tickets;
      if (activity_logs) global.avtrDataStore.activity_logs = activity_logs;
      
      return res.status(200).json({ success: true });
    } catch (error) {
      return res.status(500).json({ error: 'Failed to save data' });
    }
  }

  res.status(405).json({ error: 'Method not allowed' });
}
