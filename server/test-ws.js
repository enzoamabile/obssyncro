import WebSocket from 'ws';

const API_KEY = '7bf0737ae24f63145d937e94421377cc4a462cb1af371632f991b41b68eae3a2';

const ws = new WebSocket('ws://localhost:3000/ws', {
  headers: {
    'Authorization': `Bearer ${API_KEY}`
  }
});

ws.on('open', () => {
  console.log('✅ WebSocket connected');

  // Send ping
  ws.send(JSON.stringify({ type: 'ping' }));

  // Send sync_manifest
  setTimeout(() => {
    ws.send(JSON.stringify({
      type: 'sync_manifest',
      session_id: 'test-client',
      client_type: 'agent',
      files: []
    }));
  }, 500);

  // Close after 2 seconds
  setTimeout(() => {
    ws.close();
  }, 2000);
});

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());
  console.log('📩 Received:', msg);
});

ws.on('error', (error) => {
  console.error('❌ WebSocket error:', error.message);
});

ws.on('close', () => {
  console.log('🔌 WebSocket disconnected');
  process.exit(0);
});
