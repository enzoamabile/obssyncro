import WebSocket from 'ws';
import { createHash } from 'crypto';

const API_KEY = '7bf0737ae24f63145d937e94421377cc4a462cb1af371632f991b41b68eae3a2';

function calculateHash(content) {
  return 'sha256:' + createHash('sha256').update(content).digest('hex');
}

const ws = new WebSocket('ws://localhost:3000/ws', {
  headers: {
    'Authorization': `Bearer ${API_KEY}`
  }
});

let sessionId = null;

ws.on('open', () => {
  console.log('✅ WebSocket connected');
});

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());

  if (msg.type === 'connected') {
    sessionId = msg.session_id;
    console.log(`📝 Session ID: ${sessionId}`);

    // Send sync_manifest
    ws.send(JSON.stringify({
      type: 'sync_manifest',
      session_id: sessionId,
      client_type: 'agent',
      files: []
    }));
  }

  if (msg.type === 'sync_delta') {
    console.log(`📊 Sync Delta: ${msg.push_to_server.length} files to push, ${msg.pull_from_server.length} to pull`);

    // Create a new file via upsert
    const content = Buffer.from('# Hello from WebSocket!\n\nThis is a test note created via WebSocket sync.').toString('base64');
    const hash = calculateHash(Buffer.from(content, 'base64'));

    console.log('📤 Sending file_upsert...');

    ws.send(JSON.stringify({
      type: 'file_upsert',
      session_id: sessionId,
      payload: {
        path: 'websocket-test.md',
        content: content,
        hash: hash,
        size: content.length,
        mime: 'text/markdown',
        mtime: Date.now()
      }
    }));
  }

  if (msg.type === 'ack') {
    console.log(`✅ Acknowledged: ${msg.action} - ${msg.path}`);

    // Close after ACK
    setTimeout(() => {
      console.log('🔌 Test complete, closing connection...');
      ws.close();
    }, 500);
  }

  if (msg.type === 'error') {
    console.error('❌ Error:', msg.message);
    ws.close();
  }
});

ws.on('error', (error) => {
  console.error('❌ WebSocket error:', error.message);
  process.exit(1);
});

ws.on('close', () => {
  console.log('🔌 WebSocket disconnected');
  setTimeout(() => process.exit(0), 100);
});

// Timeout after 10 seconds
setTimeout(() => {
  console.error('❌ Test timed out');
  process.exit(1);
}, 10000);
