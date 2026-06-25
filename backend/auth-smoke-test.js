const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'museforge-auth-test-'));
process.env.NODE_ENV = 'test';
process.env.AUTH_SECRET = 'test-secret-that-is-long-enough-for-smoke-tests';
process.env.MUSEFORGE_DATA_DIR = tempDir;
process.env.MAIL_TRANSPORT = 'json';
process.env.MAIL_FROM = 'MuseForge Test <test@museforge.local>';
process.env.GOOGLE_CLIENT_ID = 'museforge-test-client.apps.googleusercontent.com';
process.env.FRONTEND_URL = 'http://localhost:3000';

const { OAuth2Client } = require('google-auth-library');
const originalVerify = OAuth2Client.prototype.verifyIdToken;
OAuth2Client.prototype.verifyIdToken = async function verifyIdTokenForSmokeTest({ idToken, audience }) {
  assert.strictEqual(audience, process.env.GOOGLE_CLIENT_ID);
  if (idToken === 'invalid-test-token') throw new Error('invalid token');
  return {
    getPayload: () => ({
      sub: 'google-test-user-123',
      email: 'google.user@example.com',
      email_verified: true,
      name: 'Google User',
      picture: 'https://example.com/avatar.png',
    }),
  };
};

const { app } = require('./server');

async function request(baseUrl, route, body) {
  const response = await fetch(`${baseUrl}${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  return { response, data };
}

async function run() {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const signup = await request(baseUrl, '/auth/signup', {
      name: 'Email User',
      email: 'Email.User@Example.com ',
      password: 'password123',
    });
    assert.strictEqual(signup.response.status, 201);
    assert.strictEqual(signup.data.email, 'email.user@example.com');
    assert.strictEqual(signup.data.pendingVerification, true);
    assert.strictEqual(signup.data.verificationEmailSent, true);
    assert.ok(signup.data.testVerificationToken);
    assert.strictEqual(signup.data.token, undefined);

    const blockedLogin = await request(baseUrl, '/auth/login', {
      email: ' EMAIL.USER@example.com',
      password: 'password123',
    });
    assert.strictEqual(blockedLogin.response.status, 403);
    assert.strictEqual(blockedLogin.data.code, 'EMAIL_NOT_VERIFIED');

    const invalidVerification = await request(baseUrl, '/auth/verify-email', { token: 'wrong-token' });
    assert.strictEqual(invalidVerification.response.status, 400);

    const verified = await request(baseUrl, '/auth/verify-email', { token: signup.data.testVerificationToken });
    assert.strictEqual(verified.response.status, 200);
    assert.strictEqual(verified.data.user.emailVerified, true);
    assert.ok(verified.data.token);
    assert.strictEqual(verified.data.welcomeEmailSent, true);

    const login = await request(baseUrl, '/auth/login', {
      email: ' EMAIL.USER@example.com',
      password: 'password123',
    });
    assert.strictEqual(login.response.status, 200);
    assert.strictEqual(login.data.user.email, 'email.user@example.com');

    const forgot = await request(baseUrl, '/auth/forgot-password', { email: 'email.user@example.com' });
    assert.strictEqual(forgot.response.status, 200);
    assert.strictEqual(forgot.data.emailSent, true);
    assert.ok(forgot.data.testResetToken);

    const invalidReset = await request(baseUrl, '/auth/reset-password', {
      token: 'wrong-reset-token',
      password: 'newpassword123',
    });
    assert.strictEqual(invalidReset.response.status, 400);

    const reset = await request(baseUrl, '/auth/reset-password', {
      token: forgot.data.testResetToken,
      password: 'newpassword123',
    });
    assert.strictEqual(reset.response.status, 200);

    const oldPasswordLogin = await request(baseUrl, '/auth/login', {
      email: 'email.user@example.com',
      password: 'password123',
    });
    assert.strictEqual(oldPasswordLogin.response.status, 401);

    const newPasswordLogin = await request(baseUrl, '/auth/login', {
      email: 'email.user@example.com',
      password: 'newpassword123',
    });
    assert.strictEqual(newPasswordLogin.response.status, 200);

    const unknownForgot = await request(baseUrl, '/auth/forgot-password', { email: 'missing@example.com' });
    assert.strictEqual(unknownForgot.response.status, 200);
    assert.strictEqual(unknownForgot.data.testResetToken, undefined);

    const googleFirst = await request(baseUrl, '/auth/google', { credential: 'valid-test-token' });
    assert.strictEqual(googleFirst.response.status, 200);
    assert.strictEqual(googleFirst.data.isNewAccount, true);
    assert.strictEqual(googleFirst.data.welcomeEmailSent, true);
    assert.strictEqual(googleFirst.data.user.emailVerified, true);

    const googleAgain = await request(baseUrl, '/auth/google', { credential: 'valid-test-token' });
    assert.strictEqual(googleAgain.response.status, 200);
    assert.strictEqual(googleAgain.data.isNewAccount, false);

    const googleInvalid = await request(baseUrl, '/auth/google', { credential: 'invalid-test-token' });
    assert.strictEqual(googleInvalid.response.status, 401);

    const generated = await request(baseUrl, '/generate', {
      name: 'Fact Lock Artist',
      medium: 'Painting',
      description: 'I create floral paintings.',
      targetLanguage: 'Roman Urdu',
      projects: [{ id: 'p1', title: 'Pink Flowers', desc: 'I love flowers.', link: '' }],
      projectList: '- Pink Flowers: I love flowers.',
      creatorType: 'artist',
      enhanceProjectDescriptions: true,
    });
    assert.strictEqual(generated.response.status, 200);
    assert.strictEqual(generated.data.targetLanguage, 'Roman Urdu');
    assert.strictEqual(generated.data.enhancementApplied, true);
    assert.strictEqual(generated.data.enhancedProjects[0].originalDesc, 'I love flowers.');
    assert.strictEqual(generated.data.enhancedProjects[0].unsupportedNewFacts.length, 0);

    const share = await request(baseUrl, '/portfolio/share', {
      name: 'Fact Lock Artist',
      medium: 'Painting',
      language: 'Roman Urdu',
      portfolio: generated.data.portfolio,
      projects: [{ id: 'p1', title: 'Pink Flowers', desc: generated.data.enhancedProjects[0].desc }],
      customSections: [],
      skills: [],
      contact: {},
      factLockReviews: generated.data.enhancedProjects,
    });
    assert.strictEqual(share.response.status, 201);
    assert.ok(share.data.id);
    assert.ok(share.data.publicPath.includes('/portfolio/'));

    const opened = await fetch(`${baseUrl}/portfolio/${share.data.id}`);
    const openedData = await opened.json();
    assert.strictEqual(opened.status, 200);
    assert.strictEqual(openedData.portfolio.name, 'Fact Lock Artist');
    assert.strictEqual(openedData.portfolio.language, 'Roman Urdu');

    console.log('Auth smoke tests passed: verification email, blocked unverified login, email verification, password reset, password login, Google login, invalid-token rejection, FactLock generation, language setting, and shareable portfolio URLs.');
  } finally {
    await new Promise(resolve => server.close(resolve));
    OAuth2Client.prototype.verifyIdToken = originalVerify;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

run().catch(error => {
  OAuth2Client.prototype.verifyIdToken = originalVerify;
  fs.rmSync(tempDir, { recursive: true, force: true });
  console.error(error);
  process.exit(1);
});
