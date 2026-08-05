(async () => {
  const base = 'http://localhost:3000';
  const id = Math.random().toString(36).slice(2, 8);
  const email = `node_test+${id}@example.com`;
  console.log('Using email:', email);

  function extractCookie(res) {
    const sc = res.headers.get('set-cookie');
    if (!sc) return '';
    // For simplicity take whole header value (node may combine)
    return sc.split(';')[0];
  }

  try {
    console.log('\n1) Registering client...');
    let res = await fetch(base + '/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Node Tester', email, password: 'Pass1234', referredBy: 'alpha' })
    });
    const setCookie = extractCookie(res);
    const data = await res.json().catch(() => ({}));
    console.log('register status', res.status, data, 'set-cookie:', setCookie);

    const cookie = setCookie || (data && data.token ? `token=${data.token}` : '');

    console.log('\n2) GET /api/auth/me');
    res = await fetch(base + '/api/auth/me', { headers: { Cookie: cookie } });
    console.log('auth/me', res.status, await res.text());

    console.log('\n3) GET assigned-wallet');
    res = await fetch(base + '/api/client/assigned-wallet', { headers: { Cookie: cookie } });
    console.log('assigned-wallet', res.status, await res.text());

    console.log('\n4) POST investments');
    res = await fetch(base + '/api/investments', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ tier:1, amount:500, price:500 }) });
    console.log('investments create', res.status, await res.text());

    console.log('\n5) POST withdrawals');
    res = await fetch(base + '/api/withdrawals', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ walletName: 'Trust Wallet', walletAddress: 'bc1qtest', passphrase: 'secret', amount:50 }) });
    console.log('withdrawals create', res.status, await res.text());

    console.log('\n6) POST support ticket');
    res = await fetch(base + '/api/support/ticket', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ message: 'Test support message' }) });
    console.log('support ticket', res.status, await res.text());

    console.log('\n7) Admin login (alpha)');
    res = await fetch(base + '/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'alpha@admin.com', password: 'Moses081' }) });
    const adminCookie = extractCookie(res);
    console.log('admin login', res.status);
    const adminTokenResp = await res.json().catch(()=>({}));
    console.log('admin data', adminTokenResp, 'set-cookie:', adminCookie);

    console.log('\n8) GET /api/admin/clients');
    res = await fetch(base + '/api/admin/clients', { headers: { Cookie: adminCookie } });
    const clients = await res.text();
    console.log('admin clients', res.status, clients);

    console.log('\n9) Search clients by email');
    res = await fetch(base + '/api/admin/clients?q=' + encodeURIComponent(email), { headers: { Cookie: adminCookie } });
    console.log('admin clients query', res.status, await res.text());

  } catch (err) {
    console.error('Error during test flow', err);
  }
})();
