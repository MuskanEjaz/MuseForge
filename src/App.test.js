import { StrictMode } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from './App';

beforeEach(() => {
  window.localStorage.clear();
  window.history.replaceState({}, '', '/');
  window.HTMLElement.prototype.scrollIntoView = jest.fn();
  window.scrollTo = jest.fn();
  window.requestAnimationFrame = callback => callback();
  jest.restoreAllMocks();
});

function seedAuthenticatedUser() {
  window.localStorage.setItem('museforge_auth_token', 'test-token');
  window.localStorage.setItem('museforge_auth_user', JSON.stringify({ name: 'Test User', email: 'test@example.com' }));
}

test('renders a real welcome layout with one working login action', () => {
  render(<App />);
  expect(screen.getByRole('heading', { name: 'MUSEFORGE' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /^log in$/i })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /start free/i })).not.toBeInTheDocument();
});

test('opens the email login form from the welcome page', () => {
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: /^log in$/i }));
  expect(screen.getByRole('heading', { name: /log in with email/i })).toBeInTheDocument();
  expect(screen.getByPlaceholderText(/email address/i)).toBeInTheDocument();
  expect(screen.getByPlaceholderText(/at least 8 characters/i)).toBeInTheDocument();
});


test('login screen contains a coded Google option and no decorative login image', () => {
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: /^log in$/i }));
  expect(screen.getByRole('button', { name: /continue with google/i })).toBeInTheDocument();
  expect(document.querySelector('.auth-card img')).toBeNull();
  expect(document.querySelector('.auth-input-wrap input')).not.toBeNull();
});

test('creates an account and shows the email-verification step', async () => {
  jest.spyOn(global, 'fetch').mockResolvedValue({
    ok: true,
    json: async () => ({
      pendingVerification: true,
      email: 'muse@example.com',
      verificationEmailSent: true,
      message: 'Account created. We sent a verification link to muse@example.com.',
    }),
  });

  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: /^log in$/i }));
  fireEvent.click(screen.getByRole('button', { name: /^sign up$/i }));
  fireEvent.change(screen.getByPlaceholderText(/your full name/i), { target: { value: 'Muse User' } });
  fireEvent.change(screen.getByPlaceholderText(/email address/i), { target: { value: 'muse@example.com' } });
  fireEvent.change(screen.getByPlaceholderText(/at least 8 characters/i), { target: { value: 'password123' } });
  fireEvent.change(screen.getByPlaceholderText(/repeat your password/i), { target: { value: 'password123' } });
  fireEvent.click(screen.getByRole('button', { name: /create account/i }));

  await waitFor(() => expect(screen.getByRole('heading', { name: /check your email/i })).toBeInTheDocument());
  expect(screen.getByText('muse@example.com')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /resend verification email/i })).toBeInTheDocument();
  expect(window.localStorage.getItem('museforge_auth_token')).toBeNull();
});

test('verifies an email link and opens the authenticated app', async () => {
  window.history.replaceState({}, '', '/?verifyToken=valid-verification-token');
  jest.spyOn(global, 'fetch').mockResolvedValue({
    ok: true,
    json: async () => ({
      token: 'verified-token',
      user: { id: '1', name: 'Verified User', email: 'verified@example.com', emailVerified: true },
      message: 'Email verified successfully. Welcome to MuseForge!',
    }),
  });

  render(<StrictMode><App /></StrictMode>);
  await waitFor(() => expect(screen.getByText('Stunning Portfolio')).toBeInTheDocument());
  expect(window.localStorage.getItem('museforge_auth_token')).toBe('verified-token');
  expect(window.location.search).not.toContain('verifyToken');
});

test('forgot-password form sends a reset-link request', async () => {
  jest.spyOn(global, 'fetch').mockResolvedValue({
    ok: true,
    json: async () => ({ message: 'If a password account exists for that email, a reset link has been sent.' }),
  });

  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: /^log in$/i }));
  fireEvent.click(screen.getByRole('button', { name: /forgot password/i }));
  fireEvent.change(screen.getByPlaceholderText(/email address/i), { target: { value: 'muse@example.com' } });
  fireEvent.click(screen.getByRole('button', { name: /send reset link/i }));

  await waitFor(() => expect(screen.getByText(/if a password account exists/i)).toBeInTheDocument());
  const body = JSON.parse(global.fetch.mock.calls[0][1].body);
  expect(body.email).toBe('muse@example.com');
});

test('reset-password link accepts matching passwords and returns to login', async () => {
  window.history.replaceState({}, '', '/?resetToken=valid-reset-token');
  jest.spyOn(global, 'fetch').mockResolvedValue({
    ok: true,
    json: async () => ({ message: 'Password changed successfully. You can now log in with your new password.' }),
  });

  render(<App />);
  fireEvent.change(screen.getByPlaceholderText('At least 8 characters'), { target: { value: 'newpassword123' } });
  fireEvent.change(screen.getByPlaceholderText('Repeat your new password'), { target: { value: 'newpassword123' } });
  fireEvent.click(screen.getByRole('button', { name: /change password/i }));

  await waitFor(() => expect(screen.getByRole('heading', { name: /log in with email/i })).toBeInTheDocument());
  expect(screen.getByText(/password changed successfully/i)).toBeInTheDocument();
  const body = JSON.parse(global.fetch.mock.calls[0][1].body);
  expect(body.token).toBe('valid-reset-token');
  expect(body.password).toBe('newpassword123');
  expect(window.location.search).not.toContain('resetToken');
});

test('opens demo video modal after authentication', () => {
  seedAuthenticatedUser();
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: /see how it works/i }));
  expect(screen.getByRole('dialog', { name: /museforge demo video/i })).toBeInTheDocument();
  expect(screen.getByText(/public\/museforge-demo\.mp4/i)).toBeInTheDocument();
});

test('musician project editor still offers image, video and audio uploads', () => {
  seedAuthenticatedUser();
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: /musician/i }));
  const addProjectButton = document.querySelector('.li-add-btn');
  expect(addProjectButton).not.toBeNull();
  fireEvent.click(addProjectButton);
  expect(screen.getByText('🖼️ Add Image')).toBeInTheDocument();
  expect(screen.getByText('🎬 Add Video')).toBeInTheDocument();
  expect(screen.getByText('🎵 Add Audio')).toBeInTheDocument();
});

test('student CV uploads keep original project descriptions and disable enhancement', async () => {
  seedAuthenticatedUser();
  jest.spyOn(global, 'fetch')
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        name: 'Student User',
        medium: 'Software Development',
        description: 'I build web applications.',
        projects: [{ title: 'Student Portal', desc: 'built portal for students', link: null }],
        skills: ['React'],
        contact: {},
        customSections: [],
      }),
    })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        portfolio: '## Artist Bio\nStudent bio.\n\n## Artist Statement\nStudent statement.',
        enhancedProjects: [],
        warning: '',
      }),
    });

  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: /student \/ job seeker/i }));
  fireEvent.click(screen.getByRole('button', { name: /upload cv/i }));
  const file = new File(['fake pdf'], 'student-cv.pdf', { type: 'application/pdf' });
  fireEvent.change(document.querySelector('#cvInput'), { target: { files: [file] } });

  await waitFor(() => expect(screen.getByDisplayValue('Student User')).toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', { name: /generate my portfolio/i }));
  await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));

  const generateBody = JSON.parse(global.fetch.mock.calls[1][1].body);
  expect(generateBody.enhanceProjectDescriptions).toBe(false);
});

test('manual creator entries request, review, and finalize project-description enhancement', async () => {
  seedAuthenticatedUser();
  jest.spyOn(global, 'fetch')
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        portfolio: '## Artist Bio\nDraft bio.\n\n## Artist Statement\nDraft statement.',
        enhancedProjects: [{ id: 'server-id', desc: 'This project reflects my love for flowers.' }],
        warning: '',
      }),
    })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        portfolio: '## Artist Bio\nArtist bio.\n\n## Artist Statement\nArtist statement.',
        enhancedProjects: [],
        localizedOutput: {
          labels: {},
          name: 'Artist User',
          medium: 'Painting',
          projects: [{ id: 'server-id', title: 'Pink Flowers', desc: 'This project reflects my love for flowers.' }],
          customSections: [],
          skills: [],
        },
        warning: '',
      }),
    });

  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: /^artist/i }));
  fireEvent.change(screen.getByPlaceholderText('Your name'), { target: { value: 'Artist User' } });
  fireEvent.change(screen.getByPlaceholderText(/your creative medium/i), { target: { value: 'Painting' } });
  fireEvent.change(document.querySelector('.form-fields > textarea'), { target: { value: 'I create floral paintings.' } });
  fireEvent.click(document.querySelector('.li-add-btn'));
  fireEvent.change(screen.getByPlaceholderText('Project title'), { target: { value: 'Pink Flowers' } });
  fireEvent.change(screen.getByPlaceholderText('Description (optional)'), { target: { value: 'I love flowers.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  fireEvent.click(screen.getByRole('button', { name: /generate my portfolio/i }));

  await waitFor(() => expect(screen.getAllByText('This project reflects my love for flowers.').length).toBeGreaterThan(0));
  const generateBody = JSON.parse(global.fetch.mock.calls[0][1].body);
  expect(generateBody.enhanceProjectDescriptions).toBe(true);
  expect(generateBody.creatorType).toBe('artist');
  expect(generateBody.targetLanguage).toBe('English');
  expect(generateBody.projects[0].desc).toBe('I love flowers.');
  expect(screen.getByLabelText(/museforge factlock review/i)).toBeInTheDocument();
  expect(screen.queryByLabelText(/factlock trust report/i)).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: /accept enhanced/i }));
  fireEvent.click(screen.getByRole('button', { name: /^generate portfolio$/i }));

  await waitFor(() => expect(screen.getByLabelText(/factlock trust report/i)).toBeInTheDocument());
  expect(screen.getByText(/unsupported facts detected/i)).toBeInTheDocument();
  const finalBody = JSON.parse(global.fetch.mock.calls[1][1].body);
  expect(finalBody.enhanceProjectDescriptions).toBe(false);
  expect(finalBody.projects[0].desc).toBe('This project reflects my love for flowers.');
});

test('uploaded portfolio picture appears in the generated preview', async () => {
  seedAuthenticatedUser();
  jest.spyOn(global, 'fetch').mockResolvedValue({
    ok: true,
    json: async () => ({
      portfolio: '## Artist Bio\nArtist bio.\n\n## Artist Statement\nArtist statement.',
      enhancedProjects: [],
      warning: '',
    }),
  });

  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: /^artist/i }));
  fireEvent.change(screen.getByPlaceholderText('Your name'), { target: { value: 'Artist User' } });
  fireEvent.change(screen.getByPlaceholderText(/your creative medium/i), { target: { value: 'Painting' } });
  fireEvent.change(document.querySelector('.form-fields > textarea'), { target: { value: 'I create floral paintings.' } });

  const image = new File(['image bytes'], 'profile.png', { type: 'image/png' });
  fireEvent.change(document.querySelector('#imgInput'), { target: { files: [image] } });
  await waitFor(() => expect(screen.getByAltText('preview')).toBeInTheDocument());

  fireEvent.click(screen.getByRole('button', { name: /generate my portfolio/i }));
  await waitFor(() => expect(screen.getByAltText('Artist User portfolio')).toBeInTheDocument());
  expect(screen.getByRole('heading', { name: 'Artist User' })).toBeInTheDocument();
});


test('creates a public share link after portfolio generation', async () => {
  seedAuthenticatedUser();
  jest.spyOn(global, 'fetch')
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        portfolio: '## Artist Bio\nArtist bio.\n\n## Artist Statement\nArtist statement.',
        enhancedProjects: [],
        warning: '',
      }),
    })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'artist-user-1234', publicPath: '/portfolio/artist-user-1234' }),
    });

  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: /^artist/i }));
  fireEvent.change(screen.getByPlaceholderText('Your name'), { target: { value: 'Artist User' } });
  fireEvent.change(screen.getByPlaceholderText(/your creative medium/i), { target: { value: 'Painting' } });
  fireEvent.change(document.querySelector('.form-fields > textarea'), { target: { value: 'I create floral paintings.' } });
  fireEvent.change(screen.getByLabelText(/portfolio language/i), { target: { value: 'Roman Urdu' } });
  fireEvent.click(screen.getByRole('button', { name: /generate my portfolio/i }));
  await waitFor(() => expect(screen.getByRole('button', { name: /create share link/i })).toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', { name: /create share link/i }));
  await waitFor(() => expect(screen.getByText(/public share link created/i)).toBeInTheDocument());
  expect(screen.getByText(/\/portfolio\/artist-user-1234/i)).toBeInTheDocument();
  const shareBody = JSON.parse(global.fetch.mock.calls[1][1].body);
  expect(shareBody.language).toBe('Roman Urdu');
  expect(shareBody.name).toBe('Artist User');
  expect(shareBody.trustReport.outputLanguage).toBe('Roman Urdu');
  expect(shareBody.trustReport.shareLinkCreated).toBe(true);
});
