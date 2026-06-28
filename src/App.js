import { useEffect, useRef, useState } from "react";
import "./App.css";

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000';
const DEMO_VIDEO_EMBED_URL = "https://www.youtube.com/embed/mbetuUBiM-I";

const getApiCandidates = () => {
  const candidates = [API_URL];
  if (typeof window !== 'undefined') {
    candidates.push(`http://${window.location.hostname}:5000`);
    candidates.push('http://localhost:5000');
    candidates.push('http://127.0.0.1:5000');
  }
  return [...new Set(candidates.map(url => url.replace(/\/$/, '')))];
};

const stripAiReasoningClient = (value = '') => {
  let text = String(value || '');
  text = text.replace(/<think[^>]*>[\s\S]*?<\/think>/gi, ' ');
  text = text.replace(/^[\s\S]*?<\/think>/gi, ' ');
  if (/<think[^>]*>/i.test(text)) text = text.replace(/<think[^>]*>[\s\S]*$/i, ' ');
  text = text.replace(/```(?:json)?/gi, ' ').replace(/```/g, ' ');
  text = text.replace(/^okay,?\s+let['’]s[\s\S]*?(final|answer)[:-]/i, ' ');
  text = text.replace(/^(analysis|reasoning|thoughts?)\s*[:-][\s\S]*?(final|answer)\s*[:-]/i, ' ');
  return text.replace(/\s+/g, ' ').trim();
};

const fetchFromBackend = async (path, options) => {
  let lastError;
  for (const baseUrl of getApiCandidates()) {
    try {
      const response = await fetch(`${baseUrl}${path}`, options);
      return response;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('Could not connect to the MuseForge backend.');
};

const verificationRequestCache = new Map();

const verifyEmailTokenOnce = (token) => {
  if (!verificationRequestCache.has(token)) {
    const request = fetchFromBackend('/auth/verify-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    }).then(async response => {
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Email verification failed.');
      return data;
    }).catch(error => {
      verificationRequestCache.delete(token);
      throw error;
    });
    verificationRequestCache.set(token, request);
  }
  return verificationRequestCache.get(token);
};

const CREATOR_TYPES = {
  artist: {
    label: "Artist",
    medium: "Visual Arts & Painting",
    icon: "🎨",
    placeholder: "Describe your artistic style, mediums you work with (painting, sculpture, digital art), themes you explore, and what inspires your creative vision...",
    color: "#f97316",
    hoverColor: "#ea580c",
    showCV: false,
    cardImage: "/artist.png",
    cardDesc: "Showcase your artwork with beautiful galleries.",
    formImage: "/form-artist.png",
    formGradient: "linear-gradient(135deg, #f97316, #fb923c)",
    formQuote: "Every artist was first an amateur. Keep creating. The world is waiting.",
    imagePosition: "left",
    imageSide: "right"
  },
  musician: {
    label: "Musician",
    medium: "Music & Performance",
    icon: "🎵",
    placeholder: "Describe your musical style, instruments you play, genres you work in, notable performances or releases, and your creative approach to music...",
    color: "#8b5cf6",
    hoverColor: "#7c3aed",
    showCV: false,
    cardImage: "/muscian.png",
    cardDesc: "Share your sound, tracks, and story with the world.",
    formImage: "/form-muscian.png",
    formGradient: "linear-gradient(135deg, #667eea, #764ba2)",
    formQuote: "Music gives a soul to the universe and wings to the mind.",
    imagePosition: "right",
    imageSide: "left"
  },
  developer: {
    label: "Student / Job Seeker",
    medium: "",
    icon: "💻",
    placeholder: "Describe your education, skills, projects, experience, career goals, and the kind of opportunities you are seeking...",
    color: "#14b8a6",
    hoverColor: "#0d9488",
    showCV: true,
    cardImage: "/student.png",
    cardDesc: "Build a career-ready portfolio from your skills and CV.",
    formImage: "/form-student.png",
    formGradient: "linear-gradient(135deg, #4facfe, #00f2fe)",
    formQuote: "Your journey is still being written. Make every step count.",
    imagePosition: "left",
    imageSide: "right"
  },
  photographer: {
    label: "Photographer",
    medium: "Photography",
    icon: "📸",
    placeholder: "Describe your photography style, subjects you capture, equipment you use, your artistic vision, and what stories you tell through your lens...",
    color: "#f59e0b",
    hoverColor: "#d97706",
    showCV: false,
    cardImage: "/photographer.png",
    cardDesc: "Display your best shots in stunning layouts.",
    formImage: "/form-photographer.png",
    formGradient: "linear-gradient(135deg, #f6d365, #fda085)",
    formQuote: "Photography is the story I fail to put into words.",
    imagePosition: "right",
    imageSide: "right"
  },
  writer: {
    label: "Writer",
    medium: "Creative Writing",
    icon: "✍️",
    placeholder: "Describe your writing style, genres you work in, themes you explore, published works, and what drives your storytelling or creative writing...",
    color: "#ec4899",
    hoverColor: "#db2777",
    showCV: false,
    cardImage: "/writer.png",
    cardDesc: "Present your writing, articles, and ideas.",
    formImage: "/form-writer.png",
    formGradient: "linear-gradient(135deg, #f093fb, #f5576c)",
    formQuote: "A writer only begins a book. A reader finishes it.",
    imagePosition: "right",
    imageSide: "left"
  },
  other: {
    label: "Other",
    medium: "",
    icon: "✨",
    placeholder: "Describe your creator type, field, skills, projects, audience, and the kind of portfolio you want to build...",
    color: "#7c3aed",
    hoverColor: "#6d28d9",
    showCV: false,
    cardImage: "/other.png",
    cardDesc: "For any creator type not listed above.",
    formImage: "/other.png",
    formGradient: "linear-gradient(135deg, #7c3aed, #c084fc)",
    formQuote: "Your work may not fit a box. Build a portfolio that fits you.",
    imagePosition: "left",
    imageSide: "right"
  }
};

function isCareerCreatorType(selectedCreatorType, creatorLabel = "") {
  const text = `${selectedCreatorType || ""} ${creatorLabel || ""}`.toLowerCase();

  return (
    text.includes("student") ||
    text.includes("job") ||
    text.includes("career") ||
    text.includes("cv") ||
    text.includes("developer")
  );
}

function getBioHeading(selectedCreatorType, creatorLabel = "") {
  return isCareerCreatorType(selectedCreatorType, creatorLabel)
    ? "Bio"
    : "Artist Bio";
}

function getStatementHeading(selectedCreatorType, creatorLabel = "") {
  return isCareerCreatorType(selectedCreatorType, creatorLabel)
    ? "Professional Statement"
    : "Artist Statement";
}

const LANGUAGE_OPTIONS = [
  'English',
  'Spanish',
  'French',
  'German',
  'Italian',
  'Portuguese',
  'Dutch',
  'Turkish',
  'Chinese',
  'Japanese',
  'Korean',
  'Russian',
  'Bengali',
  'Punjabi',
  'Persian',
  'Pashto',
  'Sindhi',
  'Malay',
  'Indonesian',
  'Thai',
  'Vietnamese',
  'Filipino',
  'Swahili',
  'Greek',
  'Polish',
  'Tamil',
  'Telugu'
];

const isSupportedOutputLanguage = (language = '') => LANGUAGE_OPTIONS.includes(String(language || '').trim());
const normalizeOutputLanguage = (language = 'English') => isSupportedOutputLanguage(language) ? String(language).trim() : 'English';


const AI_TONE_OPTIONS = ['Professional', 'Creative', 'Minimal', 'Bold'];

const factLockScoreForReview = (review = {}) => {
  const preserved = Array.isArray(review.factsPreserved) ? review.factsPreserved.filter(Boolean).length : 0;
  const unsupported = Array.isArray(review.unsupportedNewFacts) ? review.unsupportedNewFacts.filter(Boolean).length : 0;
  if (!preserved && !unsupported) return 100;
  return Math.max(0, Math.min(100, Math.round((preserved / Math.max(1, preserved + unsupported)) * 100)));
};

const factLockScoreForReviews = (items = []) => {
  const list = Array.isArray(items) ? items.filter(Boolean) : [];
  if (!list.length) return 100;
  return Math.round(list.reduce((sum, item) => sum + factLockScoreForReview(item), 0) / list.length);
};

const REVIEW_SESSION_SUBMITTED = 'museforge_review_submitted';
const REVIEW_SESSION_SKIPPED = 'museforge_review_skipped';
const REVIEW_SESSION_AUTOPROMPT_KEY = 'museforge_review_auto_prompt_key';
const REVIEWS_LOCAL_CACHE_KEY = 'museforge_reviews_cache';


const DEFAULT_EXPORT_SETTINGS = {
  portfolioFont: 'current',
  customFont: '',
  template: 'default',
  headingColor: '#a855f7',
  subheadingColor: '#ec4899',
  headingFont: 'Playfair Display',
  bodyColor: '#cccccc',
  bodyFont: 'Times New Roman',
};

const EXPORT_FONT_OPTIONS = [
  { value: 'current', label: 'Current / Default', family: "'Times New Roman', Times, serif" },
  { value: 'serif', label: 'Classic Serif', family: "Georgia, 'Times New Roman', serif" },
  { value: 'sans', label: 'Clean Sans-serif', family: "Inter, Arial, sans-serif" },
  { value: 'modern', label: 'Modern', family: "Inter, system-ui, sans-serif" },
  { value: 'elegant', label: 'Elegant Editorial', family: "'Playfair Display', Georgia, serif" },
  { value: 'luxury', label: 'Luxury Serif', family: "'Cormorant Garamond', Georgia, serif" },
  { value: 'magazine', label: 'Magazine', family: "'Libre Baskerville', Georgia, serif" },
  { value: 'minimal', label: 'Minimal', family: "'Helvetica Neue', Arial, sans-serif" },
  { value: 'tech', label: 'Tech Mono', family: "'Space Mono', 'Courier New', monospace" },
  { value: 'creative', label: 'Creative Display', family: "'Trebuchet MS', Arial, sans-serif" },
  { value: 'playful', label: 'Playful', family: "Trebuchet MS, Arial, sans-serif" },
  { value: 'professional', label: 'Professional', family: "Arial, Helvetica, sans-serif" },
  { value: 'handwritten', label: 'Handwritten', family: "'Comic Sans MS', 'Segoe Print', cursive" },
  { value: 'portfolio', label: 'Portfolio Clean', family: "'Aptos', 'Segoe UI', Arial, sans-serif" },
  { value: 'custom', label: 'Custom typed font', family: "Arial, sans-serif" },
];

const EXPORT_TEMPLATE_OPTIONS = [
  { value: 'default', label: 'MuseForge Aurora', background: 'radial-gradient(circle at 12% 8%, rgba(168,85,247,.28), transparent 30%), radial-gradient(circle at 88% 12%, rgba(236,72,153,.20), transparent 34%), linear-gradient(135deg, #0b0614 0%, #17102b 55%, #09040f 100%)', hero: 'linear-gradient(135deg, rgba(168,85,247,.38), rgba(17,9,30,.94) 55%, rgba(236,72,153,.22))' },
  { value: 'dark', label: 'Velvet Night', background: 'radial-gradient(circle at 10% 16%, rgba(124,58,237,.35), transparent 28%), radial-gradient(circle at 90% 75%, rgba(236,72,153,.20), transparent 34%), linear-gradient(135deg,#080312,#170923 58%,#050109)', hero: 'linear-gradient(135deg,#2b0a52,#090113)' },
  { value: 'clean', label: 'Clean Glass', background: 'radial-gradient(circle at 18% 16%, rgba(196,181,253,.45), transparent 32%), radial-gradient(circle at 90% 80%, rgba(251,207,232,.42), transparent 34%), linear-gradient(135deg,#ffffff,#f8f5ff)', hero: 'linear-gradient(135deg,#f8f5ff,#ffffff)', light: true },
  { value: 'lavender', label: 'Lavender Bloom', background: 'radial-gradient(circle at 15% 10%, rgba(216,180,254,.55), transparent 30%), radial-gradient(circle at 88% 12%, rgba(244,114,182,.32), transparent 30%), linear-gradient(135deg,#fbf7ff,#fff7fb)', hero: 'linear-gradient(135deg,#efe2ff,#fff7fb)', light: true },
  { value: 'minimal', label: 'Minimal Editorial', background: 'linear-gradient(135deg,#ffffff 0%,#f8fafc 45%,#eef2ff 100%)', hero: 'linear-gradient(135deg,#ffffff,#eef2ff)', light: true },
  { value: 'artist', label: 'Artist Canvas', background: 'radial-gradient(circle at 15% 20%, rgba(251,146,60,.26), transparent 30%), radial-gradient(circle at 80% 12%, rgba(217,70,239,.23), transparent 28%), linear-gradient(135deg,#fff8f0,#fff3fb)', hero: 'linear-gradient(135deg,#fff0df,#f5e2ff)', light: true },
  { value: 'music', label: 'Music Stage Glow', background: 'radial-gradient(circle at 18% 8%, rgba(139,92,246,.42), transparent 30%), radial-gradient(circle at 78% 80%, rgba(59,130,246,.22), transparent 30%), linear-gradient(135deg,#070211,#17072d 55%,#05000d)', hero: 'linear-gradient(135deg,#2d1454,#090113)' },
  { value: 'photo', label: 'Photographer Noir', background: 'radial-gradient(circle at 20% 0%, rgba(99,102,241,.26), transparent 30%), linear-gradient(135deg,#0f172a,#111827 58%,#020617)', hero: 'linear-gradient(135deg,#111827,#312e81)' },
  { value: 'writer', label: 'Writer Paper', background: 'radial-gradient(circle at 12% 12%, rgba(251,191,36,.20), transparent 28%), linear-gradient(135deg,#fffbeb,#fff7ed)', hero: 'linear-gradient(135deg,#fff7ed,#fef3c7)', light: true },
  { value: 'rose', label: 'Rose Studio', background: 'radial-gradient(circle at 14% 15%, rgba(244,114,182,.36), transparent 30%), radial-gradient(circle at 90% 80%, rgba(167,139,250,.28), transparent 32%), linear-gradient(135deg,#fff1f2,#faf5ff)', hero: 'linear-gradient(135deg,#ffe4e6,#faf5ff)', light: true },
  { value: 'emerald', label: 'Emerald Gallery', background: 'radial-gradient(circle at 16% 12%, rgba(16,185,129,.28), transparent 28%), linear-gradient(135deg,#022c22,#111827 62%,#020617)', hero: 'linear-gradient(135deg,#064e3b,#111827)' },
  { value: 'ocean', label: 'Ocean Portfolio', background: 'radial-gradient(circle at 17% 12%, rgba(14,165,233,.26), transparent 32%), radial-gradient(circle at 84% 78%, rgba(99,102,241,.18), transparent 34%), linear-gradient(135deg,#eff6ff,#e0f2fe)', hero: 'linear-gradient(135deg,#dbeafe,#e0f2fe)', light: true },
  { value: 'gold', label: 'Golden Showcase', background: 'radial-gradient(circle at 12% 10%, rgba(245,158,11,.34), transparent 30%), linear-gradient(135deg,#1f1303,#111827 66%,#080500)', hero: 'linear-gradient(135deg,#78350f,#111827)' },
  { value: 'mono', label: 'Black & White Editorial', background: 'linear-gradient(135deg,#f8fafc,#e5e7eb)', hero: 'linear-gradient(135deg,#111827,#020617)', light: true },
  { value: 'cosmic', label: 'Cosmic Purple', background: 'radial-gradient(circle at 20% 20%, rgba(124,58,237,.55), transparent 32%), radial-gradient(circle at 88% 80%, rgba(236,72,153,.28), transparent 32%), linear-gradient(135deg,#080312,#13051f 55%,#030014)', hero: 'radial-gradient(circle at 20% 20%, #7c3aed, #13051f 55%, #030014)' },
  { value: 'pastel', label: 'Pastel Dream', background: 'radial-gradient(circle at 12% 10%, rgba(251,207,232,.52), transparent 33%), radial-gradient(circle at 85% 20%, rgba(191,219,254,.50), transparent 35%), linear-gradient(135deg,#fff7fb,#f5f3ff,#eff6ff)', hero: 'linear-gradient(135deg,#fbcfe8,#ddd6fe,#bfdbfe)', light: true },
  { value: 'sunset', label: 'Sunset Creator', background: 'radial-gradient(circle at 14% 12%, rgba(251,146,60,.38), transparent 30%), radial-gradient(circle at 88% 78%, rgba(236,72,153,.28), transparent 32%), linear-gradient(135deg,#fff7ed,#fff1f2)', hero: 'linear-gradient(135deg,#fed7aa,#fecdd3)', light: true },
  { value: 'mint', label: 'Mint Cloud', background: 'radial-gradient(circle at 18% 12%, rgba(110,231,183,.38), transparent 32%), radial-gradient(circle at 84% 78%, rgba(186,230,253,.36), transparent 32%), linear-gradient(135deg,#ecfdf5,#f0f9ff)', hero: 'linear-gradient(135deg,#d1fae5,#e0f2fe)', light: true },
];

const reviewGateCompleted = () => {
  if (typeof window === 'undefined') return false;
  return window.sessionStorage.getItem(REVIEW_SESSION_SUBMITTED) === 'true' || window.sessionStorage.getItem(REVIEW_SESSION_SKIPPED) === 'true';
};


const loadCachedReviews = () => {
  if (typeof window === 'undefined') return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(REVIEWS_LOCAL_CACHE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
};

const cacheReviews = (items = []) => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(REVIEWS_LOCAL_CACHE_KEY, JSON.stringify((Array.isArray(items) ? items : []).slice(0, 100)));
  } catch (_) {}
};

const detectInputLanguage = (...parts) => {
  const text = parts.flat(Infinity).filter(Boolean).join('\n');
  if (!text.trim()) return 'Original input';
  if (/[A-Za-z]/.test(text) && /\b(ma|mughy|mujhe|hai|ha|ky|ka|ki|ko|gana|pasand)\b/i.test(text)) return 'Roman Urdu';
  if (/[\u0600-\u06FF]/.test(text)) return 'Urdu / Arabic script';
  if (/[\u0900-\u097F]/.test(text)) return 'Hindi / Devanagari';
  if (/[\u4E00-\u9FFF]/.test(text)) return 'Chinese';
  if (/[\u3040-\u30FF]/.test(text)) return 'Japanese';
  if (/[\uAC00-\uD7AF]/.test(text)) return 'Korean';
  return 'English / Latin input';
};

const resolveExportFont = (value, customFont = '') => {
  if (value === 'custom' && customFont.trim()) return `${customFont.trim()}, Arial, sans-serif`;
  return EXPORT_FONT_OPTIONS.find(option => option.value === value)?.family || EXPORT_FONT_OPTIONS[0].family;
};

const buildExportTheme = (settings = DEFAULT_EXPORT_SETTINGS) => {
  const template = EXPORT_TEMPLATE_OPTIONS.find(option => option.value === settings.template) || EXPORT_TEMPLATE_OPTIONS[0];
  return {
    background: template.background,
    heroBackground: template.hero,
    isLight: Boolean(template.light),
    headingColor: settings.headingColor || DEFAULT_EXPORT_SETTINGS.headingColor,
    subheadingColor: settings.subheadingColor || DEFAULT_EXPORT_SETTINGS.subheadingColor,
    bodyColor: settings.bodyColor || (template.light ? '#334155' : '#cccccc'),
    cardBackground: template.light ? 'rgba(255, 255, 255, 0.78)' : 'rgba(22, 18, 36, 0.78)',
    cardBorder: template.light ? 'rgba(124, 58, 237, 0.18)' : 'rgba(168, 85, 247, 0.26)',
    navBackground: template.light ? 'rgba(255, 255, 255, 0.82)' : 'rgba(9, 5, 18, 0.88)',
    footerBackground: template.light ? 'rgba(255, 255, 255, 0.70)' : 'rgba(9, 5, 18, 0.88)',
    titleColor: template.light ? '#1f1733' : '#ffffff',
    mutedColor: template.light ? '#5f5870' : '#c8bedb',
    headingFont: resolveExportFont(settings.headingFont || 'elegant', settings.customFont),
    bodyFont: resolveExportFont(settings.bodyFont || settings.portfolioFont || 'current', settings.customFont),
  };
};

const getPublicPortfolioIdFromPath = () => {
  if (typeof window === 'undefined') return '';
  const match = window.location.pathname.match(/^\/portfolio\/([a-zA-Z0-9_-]+)$/);
  return match ? match[1] : '';
};

const buildFactLockTrustReport = ({
  factLockReviews = [],
  portfolioLanguage = 'English',
  inputLanguage = 'Original input',
  shareLinkCreated = false,
  projects = [],
  customSections = [],
} = {}) => {
  const reviews = Array.isArray(factLockReviews) ? factLockReviews : [];
  const projectCount = Array.isArray(projects) ? projects.filter(project => project && String(project.title || '').trim()).length : 0;
  const customItemCount = Array.isArray(customSections)
    ? customSections.reduce((total, section) => total + ((section.items || []).filter(item => item && (String(item.heading || '').trim() || String(item.desc || '').trim())).length), 0)
    : 0;
  const reviewableCount = projectCount + customItemCount;
  const statusOf = (item) => String(item?.status || '').toLowerCase();
  const enhancedDescriptionsAccepted = reviews.filter(item =>
    ['enhanced', 'accepted', 'edited'].includes(statusOf(item))
  ).length;
  const originalDescriptionsKept = reviews.length
    ? reviews.filter(item => ['original kept', 'kept original', 'original'].includes(statusOf(item))).length
    : reviewableCount;
  const unsupportedFactsDetected = reviews.reduce((total, item) => {
    const facts = Array.isArray(item?.unsupportedNewFacts) ? item.unsupportedNewFacts : [];
    return total + facts.filter(Boolean).length;
  }, 0);

  return {
    projectsReviewed: reviews.length || reviewableCount,
    enhancedDescriptionsAccepted,
    originalDescriptionsKept,
    unsupportedFactsDetected,
    inputLanguage: inputLanguage || 'Original input',
    outputLanguage: portfolioLanguage || 'English',
    shareLinkCreated: Boolean(shareLinkCreated),
  };
};

const PORTFOLIO_LABELS = {
  English: {
    contact: 'Contact', linkedin: 'LinkedIn', github: 'GitHub', phone: 'Phone', email: 'Email',
    location: 'Location', skills: 'Skills', projects: 'Projects', artistBio: 'Artist Bio',
    artistStatement: 'Artist Statement', technicalSkills: 'Technical Skills', about: 'About',
    statement: 'Statement', factLockTrustReport: 'FactLock Trust Report',
    trustSubtitle: 'Measurable proof that the AI enhancement is reviewable and grounded.',
    yourPortfolio: 'Your Portfolio', copyPortfolio: 'Copy Portfolio', copied: 'Copied', exportHtml: 'Export as HTML', createShareLink: 'Create Share Link',
    projectsReviewed: 'Projects reviewed', enhancedInUse: 'Enhanced in use', originalKept: 'Original kept', unsupportedFactsDetected: 'Unsupported facts detected', inputLanguage: 'Input language', outputLanguage: 'Output language', shareLinkCreated: 'Share link created', yes: 'Yes', no: 'No',
  },
  French: {
    contact: 'Contact', linkedin: 'LinkedIn', github: 'GitHub', phone: 'Téléphone', email: 'Email',
    location: 'Lieu', skills: 'Compétences', projects: 'Projets', artistBio: "Bio de l'artiste",
    artistStatement: 'Déclaration artistique', technicalSkills: 'Compétences techniques',
    about: 'À propos', statement: 'Déclaration', factLockTrustReport: 'Rapport de confiance FactLock',
    trustSubtitle: "Preuve mesurable que l'amélioration par l'IA reste vérifiable et fondée.",
    yourPortfolio: 'Votre portfolio', copyPortfolio: 'Copier le portfolio', copied: 'Copié', exportHtml: 'Exporter en HTML', createShareLink: 'Créer un lien public',
    projectsReviewed: 'Projets examinés', enhancedInUse: 'Améliorations utilisées', originalKept: 'Original conservé', unsupportedFactsDetected: 'Faits non vérifiés détectés', inputLanguage: 'Langue d’entrée', outputLanguage: 'Langue de sortie', shareLinkCreated: 'Lien public créé', yes: 'Oui', no: 'Non',
  },
  Urdu: {
    contact: 'رابطہ', linkedin: 'لنکڈ اِن', github: 'گٹ ہب', phone: 'فون', email: 'ای میل',
    location: 'مقام', skills: 'مہارتیں', projects: 'منصوبے', artistBio: 'تعارف',
    artistStatement: 'تخلیقی بیان', technicalSkills: 'تکنیکی مہارتیں', about: 'تعارف',
    statement: 'بیان', factLockTrustReport: 'فیکٹ لاک ٹرسٹ رپورٹ',
    trustSubtitle: 'یہ رپورٹ دکھاتی ہے کہ AI کی بہتری قابلِ جائزہ اور اصل معلومات پر مبنی ہے۔',
    yourPortfolio: 'آپ کا پورٹ فولیو', copyPortfolio: 'پورٹ فولیو کاپی کریں', copied: 'کاپی ہو گیا', exportHtml: 'HTML ایکسپورٹ کریں', createShareLink: 'شیئر لنک بنائیں',
    projectsReviewed: 'جائزہ شدہ منصوبے', enhancedInUse: 'استعمال شدہ بہتر متن', originalKept: 'اصل متن رکھا گیا', unsupportedFactsDetected: 'غیر مصدقہ حقائق', inputLanguage: 'اِن پٹ زبان', outputLanguage: 'آؤٹ پٹ زبان', shareLinkCreated: 'شیئر لنک بنا', yes: 'ہاں', no: 'نہیں',
  },
  'Roman Urdu': {
    contact: 'Rabita', linkedin: 'LinkedIn', github: 'GitHub', phone: 'Phone', email: 'Email',
    location: 'Location', skills: 'Skills', projects: 'Projects', artistBio: 'Taaruf',
    artistStatement: 'Creative Statement', technicalSkills: 'Technical Skills', about: 'Taaruf',
    statement: 'Statement', factLockTrustReport: 'FactLock Trust Report',
    trustSubtitle: 'Ye report dikhati hai ke AI enhancement reviewable aur asli facts par based hai.',
    yourPortfolio: 'Aap ka Portfolio', copyPortfolio: 'Portfolio Copy Karen', copied: 'Copy ho gaya', exportHtml: 'HTML Export Karen', createShareLink: 'Share Link Banayen',
    projectsReviewed: 'Reviewed projects', enhancedInUse: 'Enhanced in use', originalKept: 'Original kept', unsupportedFactsDetected: 'Unsupported facts', inputLanguage: 'Input language', outputLanguage: 'Output language', shareLinkCreated: 'Share link created', yes: 'Yes', no: 'No',
  },
  Hindi: {
    contact: 'संपर्क', linkedin: 'LinkedIn', github: 'GitHub', phone: 'फोन', email: 'ईमेल',
    location: 'स्थान', skills: 'कौशल', projects: 'प्रोजेक्ट्स', artistBio: 'परिचय',
    artistStatement: 'रचनात्मक वक्तव्य', technicalSkills: 'तकनीकी कौशल', about: 'परिचय',
    statement: 'वक्तव्य', factLockTrustReport: 'FactLock विश्वास रिपोर्ट',
    trustSubtitle: 'मापने योग्य प्रमाण कि AI सुधार समीक्षा योग्य और तथ्यों पर आधारित है।',
    yourPortfolio: 'आपका पोर्टफोलियो', copyPortfolio: 'पोर्टफोलियो कॉपी करें', copied: 'कॉपी हो गया', exportHtml: 'HTML एक्सपोर्ट करें', createShareLink: 'शेयर लिंक बनाएं',
    projectsReviewed: 'समीक्षित प्रोजेक्ट्स', enhancedInUse: 'उपयोग में सुधार', originalKept: 'मूल रखा गया', unsupportedFactsDetected: 'असमर्थित तथ्य', inputLanguage: 'इनपुट भाषा', outputLanguage: 'आउटपुट भाषा', shareLinkCreated: 'शेयर लिंक बना', yes: 'हाँ', no: 'नहीं',
  },
  Spanish: {
    contact: 'Contacto', linkedin: 'LinkedIn', github: 'GitHub', phone: 'Teléfono', email: 'Correo electrónico',
    location: 'Ubicación', skills: 'Habilidades', projects: 'Proyectos', artistBio: 'Biografía',
    artistStatement: 'Declaración artística', technicalSkills: 'Habilidades técnicas', about: 'Acerca de',
    statement: 'Declaración', factLockTrustReport: 'Informe de confianza de FactLock',
    trustSubtitle: 'Prueba medible de que la mejora de IA es revisable y basada en hechos.',
    yourPortfolio: 'Tu portafolio', copyPortfolio: 'Copiar portafolio', copied: 'Copiado', exportHtml: 'Exportar HTML', createShareLink: 'Crear enlace público',
    projectsReviewed: 'Proyectos revisados', enhancedInUse: 'Mejoras en uso', originalKept: 'Original conservado', unsupportedFactsDetected: 'Hechos no respaldados', inputLanguage: 'Idioma de entrada', outputLanguage: 'Idioma de salida', shareLinkCreated: 'Enlace creado', yes: 'Sí', no: 'No',
  },
  Arabic: {
    contact: 'التواصل', linkedin: 'لينكدإن', github: 'جيت هب', phone: 'الهاتف', email: 'البريد الإلكتروني',
    location: 'الموقع', skills: 'المهارات', projects: 'المشاريع', artistBio: 'نبذة',
    artistStatement: 'البيان الإبداعي', technicalSkills: 'المهارات التقنية', about: 'نبذة',
    statement: 'بيان', factLockTrustReport: 'تقرير ثقة FactLock',
    trustSubtitle: 'دليل قابل للقياس على أن تحسين الذكاء الاصطناعي قابل للمراجعة ومبني على الحقائق.',
    yourPortfolio: 'ملفك الشخصي', copyPortfolio: 'نسخ الملف', copied: 'تم النسخ', exportHtml: 'تصدير HTML', createShareLink: 'إنشاء رابط مشاركة',
    projectsReviewed: 'المشاريع التي تمت مراجعتها', enhancedInUse: 'التحسينات المستخدمة', originalKept: 'تم الاحتفاظ بالأصل', unsupportedFactsDetected: 'حقائق غير مدعومة', inputLanguage: 'لغة الإدخال', outputLanguage: 'لغة الإخراج', shareLinkCreated: 'تم إنشاء رابط المشاركة', yes: 'نعم', no: 'لا',
  },
};


const EXTRA_PORTFOLIO_LABELS = {
  Italian: { contact:'Contatti', phone:'Telefono', email:'Email', location:'Località', skills:'Competenze', projects:'Progetti', artistBio:'Biografia', artistStatement:'Dichiarazione artistica', about:'Informazioni', statement:'Dichiarazione', factLockTrustReport:'Report di fiducia FactLock', trustSubtitle:"Prova misurabile che il miglioramento IA è revisionabile e basato sui fatti.", yourPortfolio:'Il tuo portfolio', copyPortfolio:'Copia portfolio', copied:'Copiato', exportHtml:'Esporta HTML', createShareLink:'Crea link pubblico', projectsReviewed:'Progetti revisionati', enhancedInUse:'Miglioramenti usati', originalKept:'Originali mantenuti', unsupportedFactsDetected:'Fatti non supportati', outputLanguage:'Lingua di output', shareLinkCreated:'Link creato', yes:'Sì', no:'No' },
  Portuguese: { contact:'Contato', phone:'Telefone', email:'Email', location:'Localização', skills:'Habilidades', projects:'Projetos', artistBio:'Biografia', artistStatement:'Declaração artística', about:'Sobre', statement:'Declaração', factLockTrustReport:'Relatório de confiança FactLock', trustSubtitle:'Prova mensurável de que a melhoria por IA é revisável e baseada em fatos.', yourPortfolio:'Seu portfólio', copyPortfolio:'Copiar portfólio', copied:'Copiado', exportHtml:'Exportar HTML', createShareLink:'Criar link público', projectsReviewed:'Projetos revisados', enhancedInUse:'Melhorias em uso', originalKept:'Original mantido', unsupportedFactsDetected:'Fatos não suportados', outputLanguage:'Idioma de saída', shareLinkCreated:'Link criado', yes:'Sim', no:'Não' },
  Dutch: { contact:'Contact', phone:'Telefoon', email:'E-mail', location:'Locatie', skills:'Vaardigheden', projects:'Projecten', artistBio:'Biografie', artistStatement:'Artistieke verklaring', about:'Over', statement:'Verklaring', factLockTrustReport:'FactLock-vertrouwensrapport', trustSubtitle:'Meetbaar bewijs dat de AI-verbetering controleerbaar en feitelijk is.', yourPortfolio:'Je portfolio', copyPortfolio:'Portfolio kopiëren', copied:'Gekopieerd', exportHtml:'HTML exporteren', createShareLink:'Openbare link maken', projectsReviewed:'Projecten beoordeeld', enhancedInUse:'Verbeteringen gebruikt', originalKept:'Origineel behouden', unsupportedFactsDetected:'Niet-onderbouwde feiten', outputLanguage:'Uitvoertaal', shareLinkCreated:'Link gemaakt', yes:'Ja', no:'Nee' },
  Turkish: { contact:'İletişim', phone:'Telefon', email:'E-posta', location:'Konum', skills:'Yetenekler', projects:'Projeler', artistBio:'Biyografi', artistStatement:'Sanatçı beyanı', about:'Hakkında', statement:'Beyan', factLockTrustReport:'FactLock güven raporu', trustSubtitle:'Yapay zekâ iyileştirmesinin incelenebilir ve gerçeklere dayalı olduğuna dair ölçülebilir kanıt.', yourPortfolio:'Portfolyonuz', copyPortfolio:'Portfolyoyu kopyala', copied:'Kopyalandı', exportHtml:'HTML dışa aktar', createShareLink:'Paylaşım bağlantısı oluştur', projectsReviewed:'İncelenen projeler', enhancedInUse:'Kullanılan iyileştirmeler', originalKept:'Orijinal korundu', unsupportedFactsDetected:'Desteklenmeyen gerçekler', outputLanguage:'Çıktı dili', shareLinkCreated:'Bağlantı oluşturuldu', yes:'Evet', no:'Hayır' },
  Chinese: { contact:'联系方式', phone:'电话', email:'邮箱', location:'地点', skills:'技能', projects:'项目', artistBio:'简介', artistStatement:'创作陈述', about:'关于', statement:'陈述', factLockTrustReport:'FactLock 信任报告', trustSubtitle:'可衡量地证明 AI 优化可审查且基于事实。', yourPortfolio:'你的作品集', copyPortfolio:'复制作品集', copied:'已复制', exportHtml:'导出 HTML', createShareLink:'创建公开链接', projectsReviewed:'已审查项目', enhancedInUse:'已使用优化', originalKept:'保留原文', unsupportedFactsDetected:'未支持事实', outputLanguage:'输出语言', shareLinkCreated:'已创建链接', yes:'是', no:'否' },
  Japanese: { contact:'連絡先', phone:'電話', email:'メール', location:'所在地', skills:'スキル', projects:'プロジェクト', artistBio:'プロフィール', artistStatement:'アーティスト声明', about:'概要', statement:'声明', factLockTrustReport:'FactLock 信頼レポート', trustSubtitle:'AIによる改善が確認可能で事実に基づいていることを示す測定可能な証拠。', yourPortfolio:'あなたのポートフォリオ', copyPortfolio:'ポートフォリオをコピー', copied:'コピー済み', exportHtml:'HTMLを書き出す', createShareLink:'共有リンクを作成', projectsReviewed:'確認済みプロジェクト', enhancedInUse:'使用中の改善', originalKept:'原文を保持', unsupportedFactsDetected:'未確認の事実', outputLanguage:'出力言語', shareLinkCreated:'リンク作成済み', yes:'はい', no:'いいえ' },
  Korean: { contact:'연락처', phone:'전화', email:'이메일', location:'위치', skills:'기술', projects:'프로젝트', artistBio:'소개', artistStatement:'아티스트 설명', about:'소개', statement:'설명', factLockTrustReport:'FactLock 신뢰 보고서', trustSubtitle:'AI 개선이 검토 가능하고 사실에 기반한다는 측정 가능한 증거입니다.', yourPortfolio:'내 포트폴리오', copyPortfolio:'포트폴리오 복사', copied:'복사됨', exportHtml:'HTML 내보내기', createShareLink:'공유 링크 만들기', projectsReviewed:'검토된 프로젝트', enhancedInUse:'사용된 개선', originalKept:'원본 유지', unsupportedFactsDetected:'지원되지 않는 사실', outputLanguage:'출력 언어', shareLinkCreated:'링크 생성됨', yes:'예', no:'아니요' },
  Russian: { contact:'Контакты', phone:'Телефон', email:'Email', location:'Локация', skills:'Навыки', projects:'Проекты', artistBio:'Биография', artistStatement:'Творческое заявление', about:'О себе', statement:'Заявление', factLockTrustReport:'Отчет доверия FactLock', trustSubtitle:'Измеримое подтверждение того, что улучшение ИИ проверяемо и основано на фактах.', yourPortfolio:'Ваше портфолио', copyPortfolio:'Скопировать портфолио', copied:'Скопировано', exportHtml:'Экспорт HTML', createShareLink:'Создать публичную ссылку', projectsReviewed:'Проверенные проекты', enhancedInUse:'Использованные улучшения', originalKept:'Оригинал сохранен', unsupportedFactsDetected:'Неподтвержденные факты', outputLanguage:'Язык вывода', shareLinkCreated:'Ссылка создана', yes:'Да', no:'Нет' },
  Bengali: { contact:'যোগাযোগ', phone:'ফোন', email:'ইমেইল', location:'অবস্থান', skills:'দক্ষতা', projects:'প্রকল্প', artistBio:'পরিচিতি', artistStatement:'সৃজনশীল বিবৃতি', about:'পরিচিতি', statement:'বিবৃতি', factLockTrustReport:'FactLock বিশ্বাস রিপোর্ট', trustSubtitle:'AI উন্নতি পর্যালোচনাযোগ্য এবং তথ্যভিত্তিক—এর পরিমাপযোগ্য প্রমাণ।', yourPortfolio:'আপনার পোর্টফোলিও', copyPortfolio:'পোর্টফোলিও কপি করুন', copied:'কপি হয়েছে', exportHtml:'HTML এক্সপোর্ট', createShareLink:'শেয়ার লিংক তৈরি করুন', projectsReviewed:'পর্যালোচিত প্রকল্প', enhancedInUse:'ব্যবহৃত উন্নতি', originalKept:'মূল রাখা হয়েছে', unsupportedFactsDetected:'অসমর্থিত তথ্য', outputLanguage:'আউটপুট ভাষা', shareLinkCreated:'লিংক তৈরি হয়েছে', yes:'হ্যাঁ', no:'না' },
  Punjabi: { contact:'ਸੰਪਰਕ', phone:'ਫੋਨ', email:'ਈਮੇਲ', location:'ਥਾਂ', skills:'ਹੁਨਰ', projects:'ਪ੍ਰੋਜੈਕਟ', artistBio:'ਜਾਣ-ਪਛਾਣ', artistStatement:'ਰਚਨਾਤਮਕ ਬਿਆਨ', about:'ਬਾਰੇ', statement:'ਬਿਆਨ', factLockTrustReport:'FactLock ਭਰੋਸਾ ਰਿਪੋਰਟ', trustSubtitle:'AI ਸੁਧਾਰ ਸਮੀਖਿਆਯੋਗ ਅਤੇ ਤੱਥਾਂ ਤੇ ਆਧਾਰਿਤ ਹੈ।', yourPortfolio:'ਤੁਹਾਡਾ ਪੋਰਟਫੋਲਿਓ', copyPortfolio:'ਪੋਰਟਫੋਲਿਓ ਕਾਪੀ ਕਰੋ', copied:'ਕਾਪੀ ਹੋ ਗਿਆ', exportHtml:'HTML ਐਕਸਪੋਰਟ', createShareLink:'ਸ਼ੇਅਰ ਲਿੰਕ ਬਣਾਓ', projectsReviewed:'ਸਮੀਖਿਆ ਪ੍ਰੋਜੈਕਟ', enhancedInUse:'ਵਰਤੇ ਸੁਧਾਰ', originalKept:'ਅਸਲ ਰੱਖਿਆ', unsupportedFactsDetected:'ਅਸਮਰਥਿਤ ਤੱਥ', outputLanguage:'ਆਉਟਪੁੱਟ ਭਾਸ਼ਾ', shareLinkCreated:'ਲਿੰਕ ਬਣਿਆ', yes:'ਹਾਂ', no:'ਨਹੀਂ' },
  Persian: { contact:'ارتباط', phone:'تلفن', email:'ایمیل', location:'مکان', skills:'مهارت‌ها', projects:'پروژه‌ها', artistBio:'معرفی', artistStatement:'بیانیه هنری', about:'درباره', statement:'بیانیه', factLockTrustReport:'گزارش اعتماد FactLock', trustSubtitle:'اثبات قابل اندازه‌گیری که بهبود هوش مصنوعی قابل بازبینی و مبتنی بر واقعیت است.', yourPortfolio:'پورتفولیوی شما', copyPortfolio:'کپی پورتفولیو', copied:'کپی شد', exportHtml:'خروجی HTML', createShareLink:'ساخت لینک اشتراک', projectsReviewed:'پروژه‌های بررسی‌شده', enhancedInUse:'بهبودهای استفاده‌شده', originalKept:'اصل حفظ شد', unsupportedFactsDetected:'واقعیت‌های پشتیبانی‌نشده', outputLanguage:'زبان خروجی', shareLinkCreated:'لینک ساخته شد', yes:'بله', no:'نه' },
  Pashto: { contact:'اړیکه', phone:'تلیفون', email:'ایمیل', location:'ځای', skills:'مهارتونه', projects:'پروژې', artistBio:'پېژندنه', artistStatement:'هنري بیان', about:'په اړه', statement:'بیان', factLockTrustReport:'د FactLock باور راپور', trustSubtitle:'د AI ښه والی د بیاکتنې وړ او د حقایقو پر بنسټ دی.', yourPortfolio:'ستاسو پورټفولیو', copyPortfolio:'پورټفولیو کاپي کړئ', copied:'کاپي شو', exportHtml:'HTML صادر کړئ', createShareLink:'د شریکولو لینک جوړ کړئ', projectsReviewed:'کتل شوې پروژې', enhancedInUse:'کارول شوي ښه والی', originalKept:'اصلي وساتل شو', unsupportedFactsDetected:'نه ملاتړ شوي حقایق', outputLanguage:'د وتنې ژبه', shareLinkCreated:'لینک جوړ شو', yes:'هو', no:'نه' },
  Sindhi: { contact:'رابطو', phone:'فون', email:'اي ميل', location:'هنڌ', skills:'مهارتون', projects:'منصوبا', artistBio:'تعارف', artistStatement:'تخليقي بيان', about:'بابت', statement:'بيان', factLockTrustReport:'FactLock اعتماد رپورٽ', trustSubtitle:'AI بهتري جائزو وٺڻ جوڳي ۽ حقيقتن تي ٻڌل آهي.', yourPortfolio:'توهان جو پورٽفوليو', copyPortfolio:'پورٽفوليو ڪاپي ڪريو', copied:'ڪاپي ٿيو', exportHtml:'HTML ايڪسپورٽ', createShareLink:'شيئر لنڪ ٺاهيو', projectsReviewed:'جائزو ورتل منصوبا', enhancedInUse:'استعمال ٿيل بهتري', originalKept:'اصل رکيو ويو', unsupportedFactsDetected:'غير تصديق ٿيل حقيقتون', outputLanguage:'آئوٽ پٽ ٻولي', shareLinkCreated:'لنڪ ٺهيو', yes:'ها', no:'نه' },
  Malay: { contact:'Hubungan', phone:'Telefon', email:'E-mel', location:'Lokasi', skills:'Kemahiran', projects:'Projek', artistBio:'Biografi', artistStatement:'Pernyataan artistik', about:'Tentang', statement:'Pernyataan', factLockTrustReport:'Laporan kepercayaan FactLock', trustSubtitle:'Bukti boleh diukur bahawa peningkatan AI boleh disemak dan berasaskan fakta.', yourPortfolio:'Portfolio anda', copyPortfolio:'Salin portfolio', copied:'Disalin', exportHtml:'Eksport HTML', createShareLink:'Cipta pautan awam', projectsReviewed:'Projek disemak', enhancedInUse:'Peningkatan digunakan', originalKept:'Asal dikekalkan', unsupportedFactsDetected:'Fakta tidak disokong', outputLanguage:'Bahasa output', shareLinkCreated:'Pautan dicipta', yes:'Ya', no:'Tidak' },
  Indonesian: { contact:'Kontak', phone:'Telepon', email:'Email', location:'Lokasi', skills:'Keterampilan', projects:'Proyek', artistBio:'Biografi', artistStatement:'Pernyataan artistik', about:'Tentang', statement:'Pernyataan', factLockTrustReport:'Laporan kepercayaan FactLock', trustSubtitle:'Bukti terukur bahwa peningkatan AI dapat ditinjau dan berbasis fakta.', yourPortfolio:'Portofolio Anda', copyPortfolio:'Salin portofolio', copied:'Disalin', exportHtml:'Ekspor HTML', createShareLink:'Buat tautan publik', projectsReviewed:'Proyek ditinjau', enhancedInUse:'Peningkatan digunakan', originalKept:'Asli dipertahankan', unsupportedFactsDetected:'Fakta tidak didukung', outputLanguage:'Bahasa output', shareLinkCreated:'Tautan dibuat', yes:'Ya', no:'Tidak' },
  Thai: { contact:'ติดต่อ', phone:'โทรศัพท์', email:'อีเมล', location:'สถานที่', skills:'ทักษะ', projects:'โครงการ', artistBio:'ประวัติ', artistStatement:'คำแถลงศิลปิน', about:'เกี่ยวกับ', statement:'คำแถลง', factLockTrustReport:'รายงานความน่าเชื่อถือ FactLock', trustSubtitle:'หลักฐานที่วัดได้ว่าการปรับปรุงด้วย AI ตรวจสอบได้และอิงข้อเท็จจริง', yourPortfolio:'พอร์ตโฟลิโอของคุณ', copyPortfolio:'คัดลอกพอร์ตโฟลิโอ', copied:'คัดลอกแล้ว', exportHtml:'ส่งออก HTML', createShareLink:'สร้างลิงก์สาธารณะ', projectsReviewed:'โครงการที่ตรวจสอบ', enhancedInUse:'ใช้การปรับปรุง', originalKept:'เก็บต้นฉบับ', unsupportedFactsDetected:'ข้อเท็จจริงที่ไม่รองรับ', outputLanguage:'ภาษาเอาต์พุต', shareLinkCreated:'สร้างลิงก์แล้ว', yes:'ใช่', no:'ไม่' },
  Vietnamese: { contact:'Liên hệ', phone:'Điện thoại', email:'Email', location:'Địa điểm', skills:'Kỹ năng', projects:'Dự án', artistBio:'Tiểu sử', artistStatement:'Tuyên bố nghệ thuật', about:'Giới thiệu', statement:'Tuyên bố', factLockTrustReport:'Báo cáo tin cậy FactLock', trustSubtitle:'Bằng chứng đo lường rằng cải thiện AI có thể xem xét và dựa trên sự thật.', yourPortfolio:'Hồ sơ của bạn', copyPortfolio:'Sao chép hồ sơ', copied:'Đã sao chép', exportHtml:'Xuất HTML', createShareLink:'Tạo liên kết công khai', projectsReviewed:'Dự án đã xem xét', enhancedInUse:'Cải thiện đang dùng', originalKept:'Giữ bản gốc', unsupportedFactsDetected:'Sự thật chưa hỗ trợ', outputLanguage:'Ngôn ngữ đầu ra', shareLinkCreated:'Đã tạo liên kết', yes:'Có', no:'Không' },
  Filipino: { contact:'Kontak', phone:'Telepono', email:'Email', location:'Lokasyon', skills:'Kasanayan', projects:'Mga proyekto', artistBio:'Talambuhay', artistStatement:'Pahayag ng artist', about:'Tungkol', statement:'Pahayag', factLockTrustReport:'Ulat ng tiwala sa FactLock', trustSubtitle:'Nasusukat na patunay na ang AI enhancement ay mare-review at nakabatay sa facts.', yourPortfolio:'Iyong portfolio', copyPortfolio:'Kopyahin ang portfolio', copied:'Nakopya', exportHtml:'I-export HTML', createShareLink:'Gumawa ng public link', projectsReviewed:'Mga proyektong nasuri', enhancedInUse:'Ginamit na enhancement', originalKept:'Orihinal na pinanatili', unsupportedFactsDetected:'Hindi suportadong facts', outputLanguage:'Output language', shareLinkCreated:'Nagawa ang link', yes:'Oo', no:'Hindi' },
  Swahili: { contact:'Mawasiliano', phone:'Simu', email:'Barua pepe', location:'Mahali', skills:'Ujuzi', projects:'Miradi', artistBio:'Wasifu', artistStatement:'Kauli ya kisanii', about:'Kuhusu', statement:'Kauli', factLockTrustReport:'Ripoti ya uaminifu ya FactLock', trustSubtitle:'Ushahidi unaopimika kuwa uboreshaji wa AI unaweza kukaguliwa na unatokana na ukweli.', yourPortfolio:'Portfolio yako', copyPortfolio:'Nakili portfolio', copied:'Imenakiliwa', exportHtml:'Hamisha HTML', createShareLink:'Unda kiungo cha umma', projectsReviewed:'Miradi iliyokaguliwa', enhancedInUse:'Maboresho yaliyotumika', originalKept:'Asili imehifadhiwa', unsupportedFactsDetected:'Ukweli usioungwa mkono', outputLanguage:'Lugha ya matokeo', shareLinkCreated:'Kiungo kimeundwa', yes:'Ndiyo', no:'Hapana' },
  Greek: { contact:'Επικοινωνία', phone:'Τηλέφωνο', email:'Email', location:'Τοποθεσία', skills:'Δεξιότητες', projects:'Έργα', artistBio:'Βιογραφικό', artistStatement:'Καλλιτεχνική δήλωση', about:'Σχετικά', statement:'Δήλωση', factLockTrustReport:'Αναφορά εμπιστοσύνης FactLock', trustSubtitle:'Μετρήσιμη απόδειξη ότι η βελτίωση AI είναι ελέγξιμη και βασισμένη σε γεγονότα.', yourPortfolio:'Το portfolio σας', copyPortfolio:'Αντιγραφή portfolio', copied:'Αντιγράφηκε', exportHtml:'Εξαγωγή HTML', createShareLink:'Δημιουργία δημόσιου συνδέσμου', projectsReviewed:'Έργα που ελέγχθηκαν', enhancedInUse:'Βελτιώσεις σε χρήση', originalKept:'Διατηρήθηκε το αρχικό', unsupportedFactsDetected:'Μη υποστηριζόμενα γεγονότα', outputLanguage:'Γλώσσα εξόδου', shareLinkCreated:'Ο σύνδεσμος δημιουργήθηκε', yes:'Ναι', no:'Όχι' },
  Polish: { contact:'Kontakt', phone:'Telefon', email:'Email', location:'Lokalizacja', skills:'Umiejętności', projects:'Projekty', artistBio:'Biografia', artistStatement:'Oświadczenie artystyczne', about:'O mnie', statement:'Oświadczenie', factLockTrustReport:'Raport zaufania FactLock', trustSubtitle:'Mierzalny dowód, że ulepszenie AI jest sprawdzalne i oparte na faktach.', yourPortfolio:'Twoje portfolio', copyPortfolio:'Kopiuj portfolio', copied:'Skopiowano', exportHtml:'Eksportuj HTML', createShareLink:'Utwórz link publiczny', projectsReviewed:'Przejrzane projekty', enhancedInUse:'Użyte ulepszenia', originalKept:'Oryginał zachowany', unsupportedFactsDetected:'Niepotwierdzone fakty', outputLanguage:'Język wyjściowy', shareLinkCreated:'Link utworzony', yes:'Tak', no:'Nie' },
  Tamil: { contact:'தொடர்பு', phone:'தொலைபேசி', email:'மின்னஞ்சல்', location:'இடம்', skills:'திறன்கள்', projects:'திட்டங்கள்', artistBio:'சுயவிவரம்', artistStatement:'கலை அறிக்கை', about:'பற்றி', statement:'அறிக்கை', factLockTrustReport:'FactLock நம்பிக்கை அறிக்கை', trustSubtitle:'AI மேம்பாடு மதிப்பாய்வு செய்யக்கூடியதும் உண்மைகளை அடிப்படையாகக் கொண்டதும் என்பதை அளவிடக்கூடிய ஆதாரம்.', yourPortfolio:'உங்கள் போர்ட்ஃபோலியோ', copyPortfolio:'போர்ட்ஃபோலியோ நகலெடு', copied:'நகலெடுக்கப்பட்டது', exportHtml:'HTML ஏற்றுமதி', createShareLink:'பகிர்வு இணைப்பு உருவாக்கு', projectsReviewed:'மதிப்பாய்வு செய்யப்பட்ட திட்டங்கள்', enhancedInUse:'பயன்படுத்தப்பட்ட மேம்பாடுகள்', originalKept:'அசல் வைக்கப்பட்டது', unsupportedFactsDetected:'ஆதரிக்கப்படாத தகவல்கள்', outputLanguage:'வெளியீட்டு மொழி', shareLinkCreated:'இணைப்பு உருவானது', yes:'ஆம்', no:'இல்லை' },
  Telugu: { contact:'సంప్రదింపు', phone:'ఫోన్', email:'ఇమెయిల్', location:'స్థానం', skills:'నైపుణ్యాలు', projects:'ప్రాజెక్టులు', artistBio:'పరిచయం', artistStatement:'కళాత్మక ప్రకటన', about:'గురించి', statement:'ప్రకటన', factLockTrustReport:'FactLock విశ్వాస నివేదిక', trustSubtitle:'AI మెరుగుదల సమీక్షించదగినది మరియు వాస్తవాలపై ఆధారపడినదని కొలిచే ఆధారం.', yourPortfolio:'మీ పోర్ట్‌ఫోలియో', copyPortfolio:'పోర్ట్‌ఫోలియో కాపీ చేయండి', copied:'కాపీ అయింది', exportHtml:'HTML ఎగుమతి', createShareLink:'షేర్ లింక్ సృష్టించండి', projectsReviewed:'సమీక్షించిన ప్రాజెక్టులు', enhancedInUse:'ఉపయోగించిన మెరుగుదలలు', originalKept:'అసలు ఉంచబడింది', unsupportedFactsDetected:'మద్దతులేని వాస్తవాలు', outputLanguage:'అవుట్‌పుట్ భాష', shareLinkCreated:'లింక్ సృష్టించబడింది', yes:'అవును', no:'లేదు' }
};
Object.entries(EXTRA_PORTFOLIO_LABELS).forEach(([language, labels]) => {
  PORTFOLIO_LABELS[language] = { ...PORTFOLIO_LABELS.English, ...labels };
});

function fixPersonNameForDisplay(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

const containsArabicScript = (value = '') => /[\u0600-\u06FF]/.test(String(value));
const containsDevanagari = (value = '') => /[\u0900-\u097F]/.test(String(value));
const containsCJK = (value = '') => /[\u3040-\u30FF\u3400-\u9FFF\uAC00-\uD7AF]/.test(String(value));
const containsCyrillicScript = (value = '') => /[\u0400-\u04FF]/.test(String(value));
const containsBengaliScript = (value = '') => /[\u0980-\u09FF]/.test(String(value));
const containsTamilScript = (value = '') => /[\u0B80-\u0BFF]/.test(String(value));
const containsTeluguScript = (value = '') => /[\u0C00-\u0C7F]/.test(String(value));
const containsThaiScript = (value = '') => /[\u0E00-\u0E7F]/.test(String(value));

const frontendLatinWords = (value = '') => (String(value || '').match(/\b[A-Za-z][A-Za-z]{2,}\b/g) || [])
  .filter(word => !/^(http|https|www|com|net|org|gmail|email|github|linkedin|react|node|python|javascript|typescript|java|html|css|sql|mongodb|express|museforge|factlock|api|ui|ux|cv|pdf|ai|ml)$/i.test(word));

const frontendLooksRomanUrdu = (value = '') => {
  const text = String(value || '').toLowerCase();
  if (!text.trim()) return false;
  const romanUrduWords = [
    'main','mein','mai','mujhe','mughy','mera','meri','mere','hun','houn','hoon','hai','ha','hain',
    'aur','jo','ke','ki','ka','ko','se','par','ne','na','bhi','bohat','bht','pasand','karta','karti',
    'banata','banati','banaya','banai','shamil','zariye','apne','liye','liay','liyay','wala','wali','walay',
    'acha','achi','achay','kaam','jismein','jis','yeh','ye','khayal','khwab','kudrat'
  ];
  const hits = romanUrduWords.filter(word => new RegExp('\\b' + word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i').test(text)).length;
  const englishSignals = (text.match(/\b(the|and|with|for|from|that|this|which|where|while|because|creative|portfolio|project|design|artist|visual|digital|collection|book|cover)\b/g) || []).length;
  return hits >= 3 && hits > englishSignals;
};
const frontendNeedsNativeScript = (language = 'English') => ['arabic','urdu','persian','pashto','sindhi','hindi','bengali','tamil','telugu','thai','chinese','japanese','korean'].includes(languageFamilyName(language));
const frontendHasRequiredScript = (value = '', language = 'English') => {
  const family = languageFamilyName(language);
  if (['arabic','urdu','persian','pashto','sindhi'].includes(family)) return containsArabicScript(value);
  if (family === 'hindi') return containsDevanagari(value);
  if (family === 'bengali') return containsBengaliScript(value);
  if (family === 'tamil') return containsTamilScript(value);
  if (family === 'telugu') return containsTeluguScript(value);
  if (family === 'thai') return containsThaiScript(value);
  if (['chinese','japanese','korean'].includes(family)) return containsCJK(value);
  return true;
};
const frontendLeaksLatinForTarget = (value = '', language = 'English') => {
  if (!frontendNeedsNativeScript(language)) return false;
  const words = frontendLatinWords(value);
  return words.length >= 3 || (words.join('\n').length > 18 && !frontendHasRequiredScript(value, language));
};
const frontendGenericLocalized = (language = 'English', kind = 'description') => {
  const family = languageFamilyName(language);
  const map = {
    english: { medium:'Creative Portfolio', description:'This section presents the creator’s supplied information in clear professional English while preserving the original facts.', project:'This project presents the creator’s supplied work in clear professional English.', section:'Additional Section', item:'Additional Detail' },
    arabic: { medium:'مجال إبداعي', description:'يعرض هذا القسم المعلومات التي قدّمها المستخدم بأسلوب واضح ومهني يحافظ على الحقائق الأصلية.', project:'يعرض هذا المشروع فكرة قدّمها المستخدم بطريقة واضحة ومنظمة.', section:'قسم إضافي', item:'تفصيل إضافي' },
    urdu: { medium:'تخلیقی شعبہ', description:'یہ حصہ صارف کی فراہم کردہ معلومات کو واضح، پیشہ ورانہ اور اصل حقائق کے مطابق پیش کرتا ہے۔', project:'یہ منصوبہ صارف کے فراہم کردہ کام کو واضح اور منظم انداز میں پیش کرتا ہے۔', section:'اضافی سیکشن', item:'اضافی تفصیل' },
    hindi: { medium:'रचनात्मक क्षेत्र', description:'यह भाग उपयोगकर्ता द्वारा दी गई जानकारी को स्पष्ट, पेशेवर और मूल तथ्यों के अनुसार प्रस्तुत करता है।', project:'यह प्रोजेक्ट उपयोगकर्ता के दिए गए काम को साफ और व्यवस्थित रूप में प्रस्तुत करता है।', section:'अतिरिक्त अनुभाग', item:'अतिरिक्त विवरण' },
    chinese: { medium:'创意领域', description:'本部分以清晰、专业的方式呈现用户提供的信息，并保持原始事实。', project:'该项目以清晰、有条理的方式展示用户提供的作品。', section:'附加部分', item:'附加说明' },
    japanese: { medium:'クリエイティブ分野', description:'このセクションは、ユーザーが提供した情報を事実に基づいて明確かつ専門的に示します。', project:'このプロジェクトは、ユーザーが提供した作品を明確で整理された形で紹介します。', section:'追加セクション', item:'追加詳細' },
    korean: { medium:'창작 분야', description:'이 섹션은 사용자가 제공한 정보를 원래 사실에 맞게 명확하고 전문적으로 보여줍니다.', project:'이 프로젝트는 사용자가 제공한 작업을 명확하고 체계적으로 보여줍니다.', section:'추가 섹션', item:'추가 설명' },
    'roman urdu': { medium:'Creative field', description:'Yeh section user ki di hui information ko clear aur professional style mein show karta hai, bina naye facts add kiye.', project:'Yeh project user ke diye hue kaam ko clear aur organized way mein present karta hai.', section:'Extra Section', item:'Extra Detail' },
  };
  return map[family]?.[kind] || '';
};


const hasUnexpectedScriptForLanguage = (value = '', language = 'English') => {
  const text = String(value || '');
  const family = languageFamilyName(language);
  if (!text.trim()) return false;
  if (frontendLeaksLatinForTarget(text, language)) return true;
  if (family === 'english') return frontendLooksRomanUrdu(text) || containsArabicScript(text) || containsDevanagari(text) || containsCJK(text) || containsCyrillicScript(text) || containsBengaliScript(text) || containsTamilScript(text) || containsTeluguScript(text) || containsThaiScript(text);
  if (family === 'roman urdu') return containsArabicScript(text) || containsDevanagari(text) || containsCJK(text) || containsCyrillicScript(text) || containsBengaliScript(text) || containsTamilScript(text) || containsTeluguScript(text) || containsThaiScript(text);
  if (['spanish','french','german','italian','portuguese','dutch','turkish','malay','indonesian','filipino','swahili','polish','vietnamese'].includes(family)) {
    return containsArabicScript(text) || containsDevanagari(text) || containsCJK(text) || containsCyrillicScript(text) || containsBengaliScript(text) || containsTamilScript(text) || containsTeluguScript(text) || containsThaiScript(text);
  }
  if (family === 'russian') return containsArabicScript(text) || containsDevanagari(text) || containsCJK(text);
  if (['arabic','urdu','persian','pashto','sindhi'].includes(family)) return containsCyrillicScript(text) || containsDevanagari(text) || containsCJK(text);
  if (family === 'hindi') return containsArabicScript(text) || containsCyrillicScript(text) || containsCJK(text);
  if (family === 'bengali') return containsArabicScript(text) || containsCyrillicScript(text) || containsDevanagari(text) || containsCJK(text);
  if (family === 'tamil') return containsArabicScript(text) || containsCyrillicScript(text) || containsDevanagari(text) || containsCJK(text);
  if (family === 'telugu') return containsArabicScript(text) || containsCyrillicScript(text) || containsDevanagari(text) || containsCJK(text);
  if (family === 'thai') return containsArabicScript(text) || containsCyrillicScript(text) || containsDevanagari(text) || containsCJK(text);
  if (['chinese','japanese','korean'].includes(family)) return containsArabicScript(text) || containsCyrillicScript(text) || containsDevanagari(text);
  return false;
};

const _pickLocalizedCandidate = (candidate = '', fallback = '', language = 'English') => {
  const cleanCandidate = String(candidate || '').trim();
  const cleanFallback = String(fallback || '').trim();
  const fallbackLocalized = localizeClientText(cleanFallback, language) || cleanFallback;
  if (!cleanCandidate) return fallbackLocalized;
  if (hasUnexpectedScriptForLanguage(cleanCandidate, language)) return fallbackLocalized;
  if (textKey(cleanCandidate) === textKey(cleanFallback)) return fallbackLocalized;
  return cleanCandidate;
};

const isWeakDescription = (desc = '', title = '') => {
  const cleanDesc = String(desc || '').trim();
  const cleanTitle = String(title || '').trim();
  if (!cleanDesc) return true;
  if (cleanDesc.length < 18) return true;
  if (cleanTitle && textKey(cleanDesc) === textKey(cleanTitle)) return true;
  if (cleanTitle && textKey(cleanDesc).replace(/\b(project|song|portfolio|performance)\b/g, '').trim() === textKey(cleanTitle)) return true;
  return false;
};

const _chooseUsefulDescription = (candidate = '', fallback = '', title = '') => {
  const cleanCandidate = String(candidate || '').trim();
  const cleanFallback = String(fallback || '').trim();
  if (isWeakDescription(cleanCandidate, title) && cleanFallback) return cleanFallback;
  return cleanCandidate || cleanFallback;
};

const pickLocalizedName = (candidate = '', fallback = '', language = 'English') => {
  const cleanFallback = fixPersonNameForDisplay(fallback || candidate || '');
  const cleanCandidate = fixPersonNameForDisplay(candidate || '');
  const family = languageFamilyName(language);
  if (['english','roman urdu','spanish','french','german','italian','portuguese','dutch','turkish','malay','indonesian','filipino','swahili','polish','vietnamese'].includes(family)) return cleanFallback;
  if (cleanCandidate && !hasUnexpectedScriptForLanguage(cleanCandidate, language) && textKey(cleanCandidate) !== textKey(cleanFallback)) return cleanCandidate;
  return transliterateNameForLanguage(cleanFallback, language);
};

const getPortfolioLabels = (language = 'English') => PORTFOLIO_LABELS[language] || PORTFOLIO_LABELS.English;

const applyCreatorHeadingLabels = (labels = {}, language = 'English', selectedCreatorType = '', creatorLabel = '') => {
  const base = { ...labels };
  if (!isCareerCreatorType(selectedCreatorType, creatorLabel)) return base;
  const isEnglish = languageFamilyName(language) === 'english';
  return {
    ...base,
    artistBio: isEnglish ? 'Bio' : (base.about || base.artistBio || 'Bio'),
    artistStatement: isEnglish ? 'Professional Statement' : (base.statement || base.artistStatement || 'Professional Statement'),
  };
};

const frontendEnglishProseScore = (value = '') => {
  const text = String(value || '').toLowerCase();
  const matches = text.match(/\b(the|and|with|for|from|that|this|which|where|while|because|creative|portfolio|project|projects|work|works|artist|statement|skills|experience|professional|showcase|presents|provided|user|details|based|clear|authentic|centered|focused|my|i|is|are|was|were)\b/g) || [];
  return matches.length;
};

const frontendTargetLanguageSignalScore = (value = '', language = 'English') => {
  const text = String(value || '').toLowerCase();
  const family = languageFamilyName(language);
  const packs = {
    spanish: ['el','la','los','las','de','del','y','con','para','que','mi','trabajo','proyecto','portafolio','habilidades','presenta','artística'],
    french: ['le','la','les','de','des','et','avec','pour','que','mon','travail','projet','portfolio','compétences','présente','artistique'],
    german: ['der','die','das','und','mit','für','mein','arbeit','projekt','portfolio','fähigkeiten','stellt','kreativ'],
    italian: ['il','la','gli','le','di','e','con','per','mio','lavoro','progetto','portfolio','competenze'],
    portuguese: ['o','a','os','as','de','e','com','para','meu','trabalho','projeto','portfólio','habilidades'],
    dutch: ['de','het','en','met','voor','mijn','werk','project','portfolio','vaardigheden'],
    turkish: ['ve','ile','için','benim','çalışma','proje','portfolyo','yetenek','alanında'],
    polish: ['i','oraz','z','dla','mój','praca','projekt','portfolio','umiejętności'],
    swahili: ['na','kwa','ya','yangu','kazi','mradi','portfolio','ujuzi'],
    filipino: ['ang','at','sa','para','aking','trabaho','proyekto','portfolio','kasanayan'],
    vietnamese: ['và','với','cho','của','tôi','công','việc','dự','án','hồ','sơ','kỹ','năng'],
    malay: ['dan','dengan','untuk','saya','kerja','projek','portfolio','kemahiran'],
    indonesian: ['dan','dengan','untuk','saya','kerja','proyek','portofolio','keterampilan'],
  };
  const words = packs[family] || [];
  return words.reduce((count, word) => count + (new RegExp('\\b' + word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i').test(text) ? 1 : 0), 0);
};

const frontendLooksLikeWrongEnglishForTarget = (value = '', language = 'English') => {
  const family = languageFamilyName(language);
  if (['english', 'roman urdu'].includes(family) || frontendNeedsNativeScript(language)) return false;
  const englishScore = frontendEnglishProseScore(value);
  const targetScore = frontendTargetLanguageSignalScore(value, language);
  return englishScore >= 4 && englishScore >= targetScore + 3;
};

const safeClientLocalized = (candidate = '', fallback = '', language = 'English', kind = 'description') => {
  const cleanCandidate = stripAiReasoningClient(candidate);
  const cleanFallback = stripAiReasoningClient(fallback);
  const normalizedLanguage = String(language || 'English').trim().toLowerCase();
  const localizedFallback = localizeClientText(cleanFallback, language);
  if (cleanCandidate && !hasUnexpectedScriptForLanguage(cleanCandidate, language) && !frontendLooksLikeWrongEnglishForTarget(cleanCandidate, language)) return cleanCandidate;
  if (localizedFallback && !hasUnexpectedScriptForLanguage(localizedFallback, language) && !frontendLooksLikeWrongEnglishForTarget(localizedFallback, language)) return localizedFallback;
  if (normalizedLanguage === 'english' && cleanFallback) return cleanFallback;
  return frontendGenericLocalized(language, kind) || localizedFallback || cleanFallback || '';
};




const escapeClientHtml = (value = '') => String(value || '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#039;');

const textKey = (value = '') => String(value || '')
  .toLowerCase()
  .replace(/[^a-z0-9\s]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const languageFamilyName = (language = 'English') => {
  const key = String(language || '').toLowerCase().trim();
  if (key === 'roman urdu') return 'roman urdu';
  const supported = [
    'urdu','hindi','arabic','spanish','french','german','italian','portuguese','dutch','turkish',
    'chinese','japanese','korean','russian','bengali','punjabi','persian','pashto','sindhi','malay',
    'indonesian','thai','vietnamese','filipino','swahili','greek','polish','tamil','telugu'
  ];
  if (supported.includes(key)) return key;
  return 'english';
};

const LOCAL_PHRASES = {
  urdu: {
    'qamiyabi': 'کامیابی',
    'sb sy acha singer award': 'سب سے اچھے گلوکار کا ایوارڈ',
    'sab sy acha singer award': 'سب سے اچھے گلوکار کا ایوارڈ',
    'best singer award': 'بہترین گلوکار کا ایوارڈ',
    'ham safar': 'ہم سفر',
    'humsafar': 'ہم سفر',
    'teray bin': 'تیرے بن',
    'tery bin': 'تیرے بن',
    'teray wastay': 'تیرے واسطے',
    'siyara': 'سیارا',
    'nachna': 'رقص',
    'i composed the music for the drama ham safar which became very popular': 'میں نے ڈرامہ ہم سفر کے لیے موسیقی ترتیب دی، جو بہت مقبول ہوئی۔',
    'i learned a special dance for ham safar and the audience greatly appreciated the steps': 'میں نے ہم سفر کے لیے ایک خاص رقص سیکھا، اور حاضرین نے ان اسٹیپس کو بہت سراہا۔',
    'tery liyay': 'تیرے لیے',
    'tery liyaye': 'تیرے لیے',
    'music performance': 'موسیقی اور پرفارمنس',
    'music acting': 'موسیقی اور اداکاری',
    'karachi, pakistan': 'کراچی، پاکستان',
    'live performance siyara ma': 'سیارا میں لائیو پرفارمنس',
    'ma na siyara ganay ky liyai dance sikha r usky steps bht hit howay': 'میں نے سیارا گانے کے لیے رقص سیکھا اور اس کے اسٹیپس بہت مقبول ہوئے۔',
  },
  'roman urdu': {
    'qamiyabi': 'Qamiyabi',
    'sb sy acha singer award': 'Sab se achay singer ka award',
    'best singer award': 'Best singer award',
    'ham safar': 'Humsafar',
    'humsafar': 'Humsafar',
    'teray bin': 'Teray Bin',
    'teray wastay': 'Tumhare liye',
    'siyara': 'Siyara',
    'nachna': 'Naachna',
    'i composed the music for the drama ham safar which became very popular': 'Maine drama Humsafar ke liye music compose kiya, jo bohat mashhoor hua.',
    'i learned a special dance for ham safar and the audience greatly appreciated the steps': 'Maine Humsafar ke liye ek khaas dance seekha aur audience ne us ke steps ko bohat pasand kiya.',
    'tery liyay': 'Tumhare liye',
    'tery liyaye': 'Tumhare liye',
    'music performance': 'Music aur Performance',
    'karachi, pakistan': 'Karachi, Pakistan',
    'live performance siyara ma': 'Siyara mein live performance',
    'ma na siyara ganay ky liyai dance sikha r usky steps bht hit howay': 'Maine Siyara gaanay ke liye dance seekha aur us ke steps bohat hit hue.',
  },
  hindi: {
    'qamiyabi': 'सफलता',
    'sb sy acha singer award': 'सर्वश्रेष्ठ गायक पुरस्कार',
    'sab sy acha singer award': 'सर्वश्रेष्ठ गायक पुरस्कार',
    'best singer award': 'सर्वश्रेष्ठ गायक पुरस्कार',
    'ham safar': 'हमसफ़र',
    'humsafar': 'हमसफ़र',
    'teray bin': 'तेरे बिना',
    'teray wastay': 'तेरे वास्ते',
    'siyara': 'सियारा',
    'nachna': 'नृत्य',
    'i composed the music for the drama ham safar which became very popular': 'मैंने नाटक हमसफ़र के लिए संगीत तैयार किया, जो बहुत लोकप्रिय हुआ।',
    'i learned a special dance for ham safar and the audience greatly appreciated the steps': 'मैंने हमसफ़र के लिए एक खास नृत्य सीखा और दर्शकों ने उसके स्टेप्स को बहुत सराहा।',
    'tery liyay': 'तुम्हारे लिए',
    'tery liyaye': 'तुम्हारे लिए',
    'music performance': 'संगीत और प्रदर्शन',
    'karachi, pakistan': 'कराची, पाकिस्तान',
    'live performance siyara ma': 'सियारा में लाइव प्रदर्शन',
    'ma na siyara ganay ky liyai dance sikha r usky steps bht hit howay': 'मैंने सियारा गाने के लिए नृत्य सीखा और उसके स्टेप्स बहुत लोकप्रिय हुए।',
  },
  arabic: {
    'qamiyabi': 'النجاح',
    'sb sy acha singer award': 'جائزة أفضل مغنٍ',
    'sab sy acha singer award': 'جائزة أفضل مغنٍ',
    'best singer award': 'جائزة أفضل مغنٍ',
    'ham safar': 'رفيق الطريق',
    'humsafar': 'رفيق الطريق',
    'teray bin': 'بدونك',
    'teray wastay': 'لأجلك',
    'siyara': 'سيارا',
    'nachna': 'الرقص',
    'i composed the music for the drama ham safar which became very popular': 'قمت بتأليف الموسيقى لمسلسل رفيق الطريق، وقد أصبح مشهورًا جدًا.',
    'i learned a special dance for ham safar and the audience greatly appreciated the steps': 'تعلمت رقصة خاصة لرفيق الطريق، وقد أعجب الجمهور بالخطوات كثيرًا.',
    'tery liyay': 'من أجلك',
    'tery liyaye': 'من أجلك',
    'music performance': 'الموسيقى والأداء',
    'karachi, pakistan': 'كراتشي، باكستان',
    'live performance siyara ma': 'أداء مباشر في سيارا',
    'ma na siyara ganay ky liyai dance sikha r usky steps bht hit howay': 'تعلمت الرقص لأغنية سيارا وأصبحت خطواتها شائعة جدًا.',
  },
  spanish: {
    'qamiyabi': 'Éxito',
    'sb sy acha singer award': 'Premio al mejor cantante',
    'sab sy acha singer award': 'Premio al mejor cantante',
    'best singer award': 'Premio al mejor cantante',
    'ham safar': 'Compañero de viaje',
    'humsafar': 'Compañero de viaje',
    'teray bin': 'Sin ti',
    'teray wastay': 'Para ti',
    'siyara': 'Siyara',
    'nachna': 'Bailar',
    'i composed the music for the drama ham safar which became very popular': 'Compuse la música para el drama Compañero de viaje, que se volvió muy popular.',
    'i learned a special dance for ham safar and the audience greatly appreciated the steps': 'Aprendí un baile especial para Compañero de viaje y el público apreció mucho los pasos.',
    'tery liyay': 'Para ti',
    'tery liyaye': 'Para ti',
    'music performance': 'Música y actuación',
    'music acting': 'Música y actuación',
    'karachi, pakistan': 'Karachi, Pakistán',
    'live performance siyara ma': 'Presentación en vivo en Siyara',
    'ma na siyara ganay ky liyai dance sikha r usky steps bht hit howay': 'Aprendí a bailar para Siyara y sus pasos se volvieron muy populares.',
  },
  french: {
    'qamiyabi': 'Réussite',
    'sb sy acha singer award': 'Prix du meilleur chanteur',
    'best singer award': 'Prix du meilleur chanteur',
    'ham safar': 'Compagnon de voyage',
    'teray bin': 'Sans toi',
    'teray wastay': 'Pour toi',
    'siyara': 'Siyara',
    'nachna': 'Danser',
    'i composed the music for the drama ham safar which became very popular': 'J’ai composé la musique du drame Compagnon de voyage, qui est devenu très populaire.',
    'i learned a special dance for ham safar and the audience greatly appreciated the steps': 'J’ai appris une danse spéciale pour Compagnon de voyage, et le public a beaucoup apprécié les pas.',
    'tery liyay': 'Pour toi',
    'tery liyaye': 'Pour toi',
    'music performance': 'Musique et performance',
    'karachi, pakistan': 'Karachi, Pakistan',
    'live performance siyara ma': 'Performance en direct dans Siyara',
    'ma na siyara ganay ky liyai dance sikha r usky steps bht hit howay': 'J’ai appris une danse pour Siyara et ses pas sont devenus très populaires.',
  },
  german: {
    'qamiyabi': 'Erfolg',
    'sb sy acha singer award': 'Preis für den besten Sänger',
    'best singer award': 'Preis für den besten Sänger',
    'ham safar': 'Weggefährte',
    'teray bin': 'Ohne dich',
    'teray wastay': 'Für dich',
    'siyara': 'Siyara',
    'nachna': 'Tanzen',
    'i composed the music for the drama ham safar which became very popular': 'Ich habe die Musik für das Drama Weggefährte komponiert, das sehr beliebt wurde.',
    'i learned a special dance for ham safar and the audience greatly appreciated the steps': 'Ich habe für Weggefährte einen besonderen Tanz gelernt, und das Publikum hat die Schritte sehr geschätzt.',
    'tery liyay': 'Für dich',
    'tery liyaye': 'Für dich',
    'music performance': 'Musik und Auftritt',
    'karachi, pakistan': 'Karachi, Pakistan',
    'live performance siyara ma': 'Live-Auftritt in Siyara',
    'ma na siyara ganay ky liyai dance sikha r usky steps bht hit howay': 'Ich habe für Siyara einen Tanz gelernt und seine Schritte wurden sehr beliebt.',
  },
  turkish: {
    'qamiyabi': 'Başarı',
    'sb sy acha singer award': 'En iyi şarkıcı ödülü',
    'best singer award': 'En iyi şarkıcı ödülü',
    'ham safar': 'Yol arkadaşı',
    'teray bin': 'Sensiz',
    'teray wastay': 'Senin için',
    'siyara': 'Siyara',
    'nachna': 'Dans etmek',
    'i composed the music for the drama ham safar which became very popular': 'Çok popüler olan Yol arkadaşı dizisi için müzik besteledim.',
    'i learned a special dance for ham safar and the audience greatly appreciated the steps': 'Yol arkadaşı için özel bir dans öğrendim ve izleyiciler adımları çok beğendi.',
    'tery liyay': 'Senin için',
    'tery liyaye': 'Senin için',
    'music performance': 'Müzik ve performans',
    'karachi, pakistan': 'Karaçi, Pakistan',
    'live performance siyara ma': 'Siyara için canlı performans',
    'ma na siyara ganay ky liyai dance sikha r usky steps bht hit howay': 'Siyara için dans öğrendim ve adımları çok popüler oldu.',
  },
  chinese: {
    'qamiyabi': '成功',
    'sb sy acha singer award': '最佳歌手奖',
    'best singer award': '最佳歌手奖',
    'ham safar': '同行者',
    'teray bin': '没有你',
    'teray wastay': '为你',
    'siyara': '西亚拉',
    'nachna': '舞蹈',
    'i composed the music for the drama ham safar which became very popular': '我为电视剧《同行者》创作了音乐，这部剧非常受欢迎。',
    'i learned a special dance for ham safar and the audience greatly appreciated the steps': '我为《同行者》学习了一支特别的舞蹈，观众非常欣赏这些舞步。',
    'tery liyay': '献给你',
    'tery liyaye': '献给你',
    'music performance': '音乐与表演',
    'karachi, pakistan': '卡拉奇，巴基斯坦',
    'live performance siyara ma': '在《西亚拉》中的现场表演',
    'ma na siyara ganay ky liyai dance sikha r usky steps bht hit howay': '我为《西亚拉》学习了舞蹈，它的舞步非常受欢迎。',
  },
  japanese: {
    'qamiyabi': '成功',
    'sb sy acha singer award': '最優秀歌手賞',
    'best singer award': '最優秀歌手賞',
    'ham safar': '旅の仲間',
    'teray bin': '君なしで',
    'teray wastay': '君のために',
    'siyara': 'シヤラ',
    'nachna': 'ダンス',
    'i composed the music for the drama ham safar which became very popular': '私はドラマ「旅の仲間」の音楽を作曲し、この作品はとても人気になりました。',
    'i learned a special dance for ham safar and the audience greatly appreciated the steps': '私は「旅の仲間」のために特別なダンスを学び、観客はそのステップをとても高く評価しました。',
    'tery liyay': '君のために',
    'tery liyaye': '君のために',
    'music performance': '音楽とパフォーマンス',
    'karachi, pakistan': 'カラチ、パキスタン',
    'live performance siyara ma': 'シヤラでのライブパフォーマンス',
    'ma na siyara ganay ky liyai dance sikha r usky steps bht hit howay': '私はシヤラのためにダンスを学び、そのステップはとても人気になりました。',
  },
  korean: {
    'qamiyabi': '성공',
    'sb sy acha singer award': '최우수 가수상',
    'best singer award': '최우수 가수상',
    'ham safar': '동행자',
    'teray bin': '너 없이',
    'teray wastay': '너를 위해',
    'siyara': '시아라',
    'nachna': '춤',
    'i composed the music for the drama ham safar which became very popular': '저는 드라마 동행자를 위해 음악을 작곡했고, 이 작품은 매우 큰 인기를 얻었습니다.',
    'i learned a special dance for ham safar and the audience greatly appreciated the steps': '저는 동행자를 위해 특별한 춤을 배웠고, 관객들은 그 동작을 매우 좋아했습니다.',
    'tery liyay': '너를 위해',
    'tery liyaye': '너를 위해',
    'music performance': '음악과 공연',
    'karachi, pakistan': '카라치, 파키스탄',
    'live performance siyara ma': '시아라 라이브 공연',
    'ma na siyara ganay ky liyai dance sikha r usky steps bht hit howay': '저는 시아라를 위해 춤을 배웠고 그 동작들은 매우 인기를 얻었습니다.',
  },
};

const transliterateNameForLanguage = (value = '', language = 'English') => {
  const text = String(value || '').trim();
  const family = languageFamilyName(language);
  if (!text || ['english','roman urdu','spanish','french','german','turkish'].includes(family)) return text;
  const known = {
    fawad: { urdu: 'فواد', arabic: 'فواد', hindi: 'फ़वाद', chinese: '法瓦德', japanese: 'ファワド', korean: '파와드' },
    khan: { urdu: 'خان', arabic: 'خان', hindi: 'खान', chinese: '汗', japanese: 'カーン', korean: '칸' },
    muskan: { urdu: 'مسکان', arabic: 'مسكان', hindi: 'मुस्कान', chinese: '穆斯坎', japanese: 'ムスカン', korean: '무스칸' },
    ejaz: { urdu: 'اعجاز', arabic: 'إعجاز', hindi: 'एजाज़', chinese: '伊jaz', japanese: 'イジャーズ', korean: '이자즈' },
  };
  return text.split(/(\s+)/).map(part => {
    if (/^\s+$/.test(part)) return part;
    const key = part.toLowerCase().replace(/[^a-z]/g, '');
    return known[key]?.[family] || part;
  }).join('\n');
};

const replaceInsensitive = (source = '', find = '', replacement = '') => {
  if (!source || !find) return source;
  const escaped = String(find).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  return String(source).replace(new RegExp(escaped, 'ig'), replacement);
};

const localizeClientText = (value = '', language = 'English') => {
  const text = String(value || '').trim();
  const family = languageFamilyName(language);
  if (!text) return text;
  if (family === 'english') return frontendLooksRomanUrdu(text) ? '' : text;
  if (hasUnexpectedScriptForLanguage(text, language)) return '';
  const dict = LOCAL_PHRASES[family] || {};
  const key = textKey(text);
  if (dict[key]) return dict[key];

  let updated = text;
  const phrases = Object.entries(dict).sort((a, b) => b[0].length - a[0].length);
  for (const [phrase, translated] of phrases) {
    if (!phrase || !translated) continue;
    updated = replaceInsensitive(updated, phrase, translated);
  }
  if (frontendLeaksLatinForTarget(updated, language)) return frontendGenericLocalized(language, 'description') || '';
  return updated;
};


const localizeLocationText = (value = '', language = 'English') => {
  const text = String(value || '').trim();
  if (!text) return text;
  const family = languageFamilyName(language);
  const normalized = text.toLowerCase().replace(/\s+/g, ' ').replace(/،/g, ',');
  const countryMap = {
    pakistan: {
      spanish: 'Pakistán', french: 'Pakistan', german: 'Pakistan', italian: 'Pakistan', portuguese: 'Paquistão', dutch: 'Pakistan', turkish: 'Pakistan',
      chinese: '巴基斯坦', japanese: 'パキスタン', korean: '파키스탄', russian: 'Пакистан', bengali: 'পাকিস্তান', punjabi: 'ਪਾਕਿਸਤਾਨ', persian: 'پاکستان', pashto: 'پاکستان', sindhi: 'پاڪستان',
      malay: 'Pakistan', indonesian: 'Pakistan', thai: 'ปากีสถาน', vietnamese: 'Pakistan', filipino: 'Pakistan', swahili: 'Pakistan', greek: 'Πακιστάν', polish: 'Pakistan', tamil: 'பாகிஸ்தான்', telugu: 'పాకిస్తాన్'
    }
  };
  const cityMap = {
    islamabad: {
      spanish: 'Islamabad', french: 'Islamabad', german: 'Islamabad', italian: 'Islamabad', portuguese: 'Islamabade', dutch: 'Islamabad', turkish: 'İslamabad',
      chinese: '伊斯兰堡', japanese: 'イスラマバード', korean: '이슬라마바드', russian: 'Исламабад', bengali: 'ইসলামাবাদ', punjabi: 'ਇਸਲਾਮਾਬਾਦ', persian: 'اسلام‌آباد', pashto: 'اسلام اباد', sindhi: 'اسلام آباد',
      malay: 'Islamabad', indonesian: 'Islamabad', thai: 'อิสลามาบัด', vietnamese: 'Islamabad', filipino: 'Islamabad', swahili: 'Islamabad', greek: 'Ισλαμαμπάντ', polish: 'Islamabad', tamil: 'இஸ்லாமாபாத்', telugu: 'ఇస్లామాబాద్'
    },
    karachi: {
      spanish: 'Karachi', french: 'Karachi', german: 'Karatschi', italian: 'Karachi', portuguese: 'Carachi', dutch: 'Karachi', turkish: 'Karaçi',
      chinese: '卡拉奇', japanese: 'カラチ', korean: '카라치', russian: 'Карачи', bengali: 'করাচি', punjabi: 'ਕਰਾਚੀ', persian: 'کراچی', pashto: 'کراچۍ', sindhi: 'ڪراچي',
      malay: 'Karachi', indonesian: 'Karachi', thai: 'การาจี', vietnamese: 'Karachi', filipino: 'Karachi', swahili: 'Karachi', greek: 'Καράτσι', polish: 'Karaczi', tamil: 'கராச்சி', telugu: 'కరాచీ'
    },
    lahore: {
      spanish: 'Lahore', french: 'Lahore', german: 'Lahore', italian: 'Lahore', portuguese: 'Lahore', dutch: 'Lahore', turkish: 'Lahor',
      chinese: '拉合尔', japanese: 'ラホール', korean: '라호르', russian: 'Лахор', bengali: 'লাহোর', punjabi: 'ਲਾਹੌਰ', persian: 'لاهور', pashto: 'لاهور', sindhi: 'لاهور',
      malay: 'Lahore', indonesian: 'Lahore', thai: 'ลาฮอร์', vietnamese: 'Lahore', filipino: 'Lahore', swahili: 'Lahore', greek: 'Λαχόρη', polish: 'Lahore', tamil: 'லாகூர்', telugu: 'లాహోర్'
    }
  };
  if (family === 'english') return text;
  let updated = text;
  for (const [city, byLang] of Object.entries(cityMap)) {
    updated = updated.replace(new RegExp(`\\b${city}\\b`, 'ig'), byLang[family] || city);
  }
  for (const [country, byLang] of Object.entries(countryMap)) {
    updated = updated.replace(new RegExp(`\\b${country}\\b`, 'ig'), byLang[family] || country);
  }
  if (updated !== text) return updated;
  return localizeClientText(text, language) || text;
};

const normalizeContact = (contact = {}) => ({
  linkedin: contact.linkedin || '',
  github: contact.github || '',
  whatsapp: contact.whatsapp || '',
  email: contact.email || '',
  address: contact.address || '',
  links: Array.isArray(contact.links) ? contact.links : [],
});

const getContactLinks = (contact = {}) => {
  const safe = normalizeContact(contact);
  const normalizeUrl = (url = '') => String(url || '').trim().replace(/\/$/, '').toLowerCase();
  const seen = new Set();
  const addUnique = (list, item) => {
    const url = String(item?.url || '').trim();
    if (!url) return list;
    const key = normalizeUrl(url);
    if (seen.has(key)) return list;
    seen.add(key);
    return [...list, { ...item, url }];
  };

  let output = [];
  (safe.links || []).forEach((link, index) => {
    output = addUnique(output, {
      id: link.id || `link-${index}`,
      label: String(link.label || 'Link').trim() || 'Link',
      url: link.url,
    });
  });
  output = addUnique(output, { id: 'legacy-linkedin', label: 'LinkedIn', url: safe.linkedin });
  output = addUnique(output, { id: 'legacy-github', label: 'GitHub', url: safe.github });
  return output;
};

const localizeOutputClient = (output = {}, fallback = {}) => {
  const language = fallback.language || output.language || 'English';
  const labels = { ...getPortfolioLabels(language), ...(output.labels || {}) };
  const fallbackProjects = Array.isArray(fallback.projects) ? fallback.projects : [];
  const outputProjects = Array.isArray(output.projects) && output.projects.length ? output.projects : fallbackProjects;
  const fallbackSections = Array.isArray(fallback.customSections) ? fallback.customSections : [];
  const outputSections = Array.isArray(output.customSections) && output.customSections.length ? output.customSections : fallbackSections;

const bioCandidate = safeClientLocalized(
  output.bio || output.description,
  fallback.bio || fallback.description || '',
  language,
  'description'
);

let statementCandidate = safeClientLocalized(
  output.artistStatement || output.statement,
  fallback.artistStatement || fallback.statement || '',
  language,
  'description'
);

if (
  textKey(statementCandidate) &&
  textKey(bioCandidate) &&
  textKey(statementCandidate) === textKey(bioCandidate)
) {
  statementCandidate = '';
}

return {
  labels,
  name: pickLocalizedName(output.name, fallback.name || '', language),
  medium: safeClientLocalized(output.medium, fallback.medium || '', language, 'medium'),
  bio: bioCandidate,
  artistStatement: statementCandidate,
    projects: outputProjects.map((project, index) => {
      const original = fallbackProjects.find(item => String(item.id) === String(project.id)) || fallbackProjects[index] || {};
      const title = safeClientLocalized(project.title, original.title || `Project ${index + 1}`, language, 'project') || `${labels.projects || 'Project'} ${index + 1}`;
      const desc = safeClientLocalized(project.desc, original.desc || '', language, 'project');
      return {
        ...project,
        id: project.id || original.id || `project-${index}`,
        title,
        desc,
        link: project.link || original.link || '',
        media: original.media || project.media || null,
      };
    }),
    customSections: outputSections.map((section, sectionIndex) => {
      const originalSection = fallbackSections.find(item => String(item.id) === String(section.id)) || fallbackSections[sectionIndex] || {};
      const originalItems = Array.isArray(originalSection.items) ? originalSection.items : [];
      const sectionItems = Array.isArray(section.items) && section.items.length ? section.items : originalItems;
      const sectionName = safeClientLocalized(section.name, originalSection.name || '', language, 'section') || `${frontendGenericLocalized(language, 'section') || 'Section'} ${sectionIndex + 1}`;
      return {
        ...section,
        id: section.id || originalSection.id || `section-${sectionIndex}`,
        name: sectionName,
        items: sectionItems.map((item, itemIndex) => {
          const originalItem = originalItems.find(src => String(src.id) === String(item.id)) || originalItems[itemIndex] || {};
          const heading = safeClientLocalized(item.heading, originalItem.heading || '', language, 'item') || `${frontendGenericLocalized(language, 'item') || 'Item'} ${itemIndex + 1}`;
          const desc = safeClientLocalized(item.desc, originalItem.desc || '', language, 'item');
          return {
            ...item,
            id: item.id || originalItem.id || `item-${itemIndex}`,
            heading,
            desc,
            link: item.link || originalItem.link || '',
            media: originalItem.media || item.media || null,
          };
        }),
      };
    }),
    skills: Array.isArray(output.skills) && output.skills.length ? output.skills : (fallback.skills || []),
  };
};

const languageToHtmlLang = (language = 'English') => ({
  English: 'en',
  Urdu: 'ur',
  'Roman Urdu': 'ur-Latn',
  Hindi: 'hi',
  Arabic: 'ar',
  Spanish: 'es',
  French: 'fr',
  German: 'de',
  Italian: 'it',
  Portuguese: 'pt',
  Dutch: 'nl',
  Turkish: 'tr',
  Chinese: 'zh',
  Japanese: 'ja',
  Korean: 'ko',
  Russian: 'ru',
  Bengali: 'bn',
  Punjabi: 'pa',
  Persian: 'fa',
  Pashto: 'ps',
  Sindhi: 'sd',
  Malay: 'ms',
  Indonesian: 'id',
  Thai: 'th',
  Vietnamese: 'vi',
  Filipino: 'fil',
  Swahili: 'sw',
  Greek: 'el',
  Polish: 'pl',
  Tamil: 'ta',
  Telugu: 'te',
}[language] || 'en');

const languageDirection = (language = 'English') => (['Arabic', 'Urdu', 'Persian', 'Pashto', 'Sindhi'].includes(language) ? 'rtl' : 'ltr');

const isFactLockResolved = (review = {}) => ['accepted', 'edited', 'original kept', 'kept original', 'original'].includes(String(review.status || '').toLowerCase());

const translateMarkdownHeading = (heading = '', labels = PORTFOLIO_LABELS.English) => {
  const cleaned = String(heading).replace(/^#+\s*/, '').trim().toLowerCase();
  if (cleaned === 'artist bio' || cleaned === 'bio' || cleaned === 'about') return labels.artistBio;
  if (cleaned === 'artist statement' || cleaned === 'statement') return labels.artistStatement;
  return String(heading).replace(/^#+\s*/, '').trim();
};

const withOriginalProjectMedia = (localizedProjects = [], sourceProjects = []) => {
  const source = Array.isArray(sourceProjects) ? sourceProjects : [];
  const localized = Array.isArray(localizedProjects) ? localizedProjects : [];
  const base = localized.length ? localized : source;
  return base.map((project, index) => {
    const original = source.find(item => String(item.id) === String(project.id)) || source[index] || {};
    return {
      ...project,
      id: project.id || original.id || `${project.title || 'project'}-${index}`,
      title: project.title || '',
      desc: project.desc || '',
      link: project.link || original.link || '',
      media: original.media || project.media || null,
    };
  });
};

const withOriginalCustomSectionAssets = (localizedSections = [], sourceSections = []) => {
  const source = Array.isArray(sourceSections) ? sourceSections : [];
  const localized = Array.isArray(localizedSections) ? localizedSections : [];
  const base = localized.length ? localized : source;
  return base.map((section, sectionIndex) => {
    const originalSection = source.find(item => String(item.id) === String(section.id)) || source[sectionIndex] || {};
    const sourceItems = Array.isArray(originalSection.items) ? originalSection.items : [];
    const sectionItems = Array.isArray(section.items) ? section.items : [];
    const itemBase = sectionItems.length ? sectionItems : sourceItems;
    return {
      ...section,
      id: section.id || originalSection.id || `section-${sectionIndex}`,
      name: section.name || '',
      items: itemBase.map((item, itemIndex) => {
        const originalItem = sourceItems.find(src => String(src.id) === String(item.id)) || sourceItems[itemIndex] || {};
        return {
          ...item,
          id: item.id || originalItem.id || `item-${itemIndex}`,
          heading: item.heading || '',
          desc: item.desc || '',
          link: item.link || originalItem.link || '',
          media: originalItem.media || item.media || null,
        };
      }),
    };
  });
};

const applyDisplayLanguageToProjects = (items = [], language = 'English') => (Array.isArray(items) ? items : []).map((project, index) => ({
  ...project,
  title: safeClientLocalized(project.title, '', language, 'project') || `${getPortfolioLabels(language).projects || 'Project'} ${index + 1}`,
  desc: safeClientLocalized(project.desc, '', language, 'project'),
}));

const applyDisplayLanguageToSections = (sections = [], language = 'English') => (Array.isArray(sections) ? sections : []).map((section, sectionIndex) => ({
  ...section,
  name: safeClientLocalized(section.name, '', language, 'section') || `${frontendGenericLocalized(language, 'section') || 'Section'} ${sectionIndex + 1}`,
  items: (section.items || []).map((item, itemIndex) => ({
    ...item,
    heading: safeClientLocalized(item.heading, '', language, 'item') || `${frontendGenericLocalized(language, 'item') || 'Item'} ${itemIndex + 1}`,
    desc: safeClientLocalized(item.desc, '', language, 'item'),
  })),
}));

const factLockTarget = (id = '') => {
  const value = String(id);
  if (value.startsWith('meta:')) {
    const [, field] = value.split(':');
    return { type: 'meta', field };
  }
  if (value.startsWith('section:')) {
    const [, sectionId, itemId] = value.split(':');
    return { type: 'section', sectionId, itemId };
  }
  return { type: 'project', projectId: value };
};

const normalizeLocalizedOutput = (raw = {}, fallback = {}) => localizeOutputClient(raw || {}, fallback || {});

function PublicPortfolioView({ portfolio, status, error, onHome }) {
  if (status === 'loading') {
    return (
      <main className="public-portfolio-page">
        <section className="public-portfolio-card public-portfolio-state">
          <div className="brand-pill">M MuseForge</div>
          <h1>Loading portfolio...</h1>
          <p>Please wait while MuseForge opens this public portfolio.</p>
        </section>
      </main>
    );
  }

  if (error || !portfolio) {
    return (
      <main className="public-portfolio-page">
        <section className="public-portfolio-card public-portfolio-state">
          <div className="brand-pill">M MuseForge</div>
          <h1>Portfolio not found</h1>
          <p>{error || 'This public portfolio link is unavailable or expired.'}</p>
          <button type="button" onClick={onHome}>Open MuseForge</button>
        </section>
      </main>
    );
  }

  const rawPortfolioText = String(portfolio.portfolio || '');
  const contact = normalizeContact(portfolio.contact || {});
  const publicContactLinks = getContactLinks(contact);
  const projects = Array.isArray(portfolio.projects) ? portfolio.projects.filter(p => p?.title) : [];
  const customSections = Array.isArray(portfolio.customSections) ? portfolio.customSections : [];
  const skills = Array.isArray(portfolio.skills) ? portfolio.skills.filter(Boolean) : [];
  const localized = normalizeLocalizedOutput(portfolio.localizedOutput || {}, { language: portfolio.language, name: portfolio.name, medium: portfolio.medium, projects, customSections, skills });
  const labels = localized.labels;
  const extractPublicSection = (...headings) => {
  for (const heading of headings.filter(Boolean)) {
    const escaped = String(heading).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = rawPortfolioText.match(
      new RegExp(`(?:^|\\n)#+\\s*${escaped}\\s*\\n([\\s\\S]*?)(?=\\n#+\\s*|$)`, 'i')
    );
    if (match?.[1]?.trim()) return match[1].trim();
      }
      return '';
    };

    const publicBioText = stripAiReasoningClient(
      localized.bio ||
      localized.description ||
      portfolio.bio ||
      portfolio.description ||
      extractPublicSection(labels.artistBio, labels.about, 'Bio', 'Artist Bio')
    );

    const publicStatementText = stripAiReasoningClient(
      localized.artistStatement ||
      localized.statement ||
      portfolio.artistStatement ||
      portfolio.statement ||
      extractPublicSection(labels.artistStatement, labels.statement, 'Professional Statement', 'Artist Statement', 'Statement')
    );
  const displayName = pickLocalizedName(localized.name, portfolio.name || 'Creator Portfolio', portfolio.language);
  const displayMedium = localizeClientText(localized.medium || portfolio.medium || '', portfolio.language);
  const displayProjects = applyDisplayLanguageToProjects(withOriginalProjectMedia(localized.projects, projects), portfolio.language);
  const displayCustomSections = applyDisplayLanguageToSections(withOriginalCustomSectionAssets(localized.customSections, customSections), portfolio.language);
  const displaySkills = localized.skills;
  const trustReport = portfolio.trustReport || buildFactLockTrustReport({
    factLockReviews: portfolio.factLockReviews,
    portfolioLanguage: portfolio.language,
    inputLanguage: portfolio.inputLanguage || detectInputLanguage(
      portfolio.portfolio,
      projects.map(project => `${project.title || ''} ${project.desc || ''}`),
      customSections.map(section => `${section.name || ''} ${(section.items || []).map(item => `${item.heading || ''} ${item.desc || ''}`).join('\n')}`)
    ),
    shareLinkCreated: true,
    projects: displayProjects,
    customSections: displayCustomSections,
  });

  return (
    <main className="public-portfolio-page notranslate" lang={languageToHtmlLang(portfolio.language)} dir={languageDirection(portfolio.language)} translate="no">
      <section className="public-portfolio-card">
        <div className="public-portfolio-hero">
          {portfolio.imagePreview && (
            <div className="public-portfolio-photo">
              <img src={portfolio.imagePreview} alt={`${portfolio.name || 'Creator'} portfolio`} style={{ objectPosition: `${portfolio.imagePosition?.x || 50}% ${portfolio.imagePosition?.y || 50}%` }} />
            </div>
          )}
          <div>
            <div className="brand-pill">M MuseForge</div>
            <h1>{displayName}</h1>
            {displayMedium && <p>{displayMedium}</p>}
            {portfolio.language && <span className="public-language-pill">{portfolio.language}</span>}
          </div>
        </div>

        <div className="public-portfolio-body">
          {(publicContactLinks.length || contact.email || contact.whatsapp || contact.address) && (
            <section className="public-section">
              <h2>{labels.contact}</h2>
              <div className="public-contact-grid">
                {contact.email && <span><b>{labels.email}</b>{contact.email}</span>}
                {contact.whatsapp && <span><b>{labels.phone}</b>{contact.whatsapp}</span>}
                {publicContactLinks.map(link => <span key={link.id}><b>{link.label}</b><a href={link.url} target="_blank" rel="noreferrer">{link.url}</a></span>)}
                {contact.address && <span><b>{labels.location}</b>{localizeLocationText(contact.address, portfolio.language)}</span>}
              </div>
            </section>
          )}

          {displaySkills.length > 0 && (
            <section className="public-section">
              <h2>{labels.skills}</h2>
              <div className="public-skill-tags">{displaySkills.map(skill => <span key={skill}>{skill}</span>)}</div>
            </section>
          )}

          {trustReport.projectsReviewed > 0 && (
            <section className="public-section public-trust-report" aria-label="FactLock Trust Report">
              <div className="trust-report-title">
                <span>✓</span>
                <div>
                  <h2>{labels.factLockTrustReport}</h2>
                  <p>{labels.trustSubtitle}</p>
                </div>
              </div>
              <div className="trust-report-grid">
                <span><b>{trustReport.projectsReviewed}</b><small>{labels.projectsReviewed || 'Projects reviewed'}</small></span>
                <span><b>{trustReport.enhancedDescriptionsAccepted}</b><small>{labels.enhancedInUse || 'Enhanced in use'}</small></span>
                <span><b>{trustReport.originalDescriptionsKept}</b><small>{labels.originalKept || 'Original kept'}</small></span>
                <span><b>{trustReport.unsupportedFactsDetected}</b><small>{labels.unsupportedFactsDetected || 'Unsupported facts detected'}</small></span>
                <span><b>{trustReport.inputLanguage}</b><small>{labels.inputLanguage || 'Input language'}</small></span>
                <span><b>{trustReport.outputLanguage}</b><small>{labels.outputLanguage || 'Output language'}</small></span>
                <span><b>{trustReport.shareLinkCreated ? (labels.yes || 'Yes') : (labels.no || 'No')}</b><small>{labels.shareLinkCreated || 'Share link created'}</small></span>
              </div>
            </section>
          )}

          {publicBioText && (
          <section className="public-section public-written-content">
            <h2>{labels.artistBio || labels.about || 'Bio'}</h2>
            <p>{publicBioText}</p>
          </section>
        )}

        {publicStatementText && publicStatementText !== publicBioText && (
          <section className="public-section public-written-content">
            <h2>{labels.artistStatement || labels.statement || 'Statement'}</h2>
            <p>{publicStatementText}</p>
          </section>
        )}

          {displayProjects.length > 0 && (
            <section className="public-section">
              <h2>{labels.projects}</h2>
              <div className="public-project-grid">
                {displayProjects.map(project => (
                  <article key={project.id || project.title} className="public-project-card">
                    {project.link ? <a href={project.link} target="_blank" rel="noreferrer"><strong>{project.title}</strong></a> : <strong>{project.title}</strong>}
                    {project.desc && <p>{project.desc}</p>}
                    {project.media?.type === 'image' && <img src={project.media.src} alt={project.title} />}
                    {project.media?.type === 'video' && <video controls src={project.media.src} />}
                    {project.media?.type === 'audio' && <audio controls src={project.media.src} />}
                  </article>
                ))}
              </div>
            </section>
          )}

          {displayCustomSections.filter(s => s.items?.length).map(section => (
            <section className="public-section" key={section.id || section.name}>
              <h2>{section.name}</h2>
              {section.items.map(item => (
                <article className="public-custom-item" key={item.id || `${item.heading}-${item.desc}`}>
                  {item.heading && <strong>{item.heading}</strong>}
                  {item.desc && <p>{item.desc}</p>}
                  {item.link && <a href={item.link} target="_blank" rel="noreferrer" className="public-custom-link">🔗 {item.link}</a>}
                  {item.media && (
                    <div className="public-project-media">
                      {item.media.type === 'image' && <img src={item.media.src} alt={item.heading || section.name} />}
                      {item.media.type === 'video' && <video src={item.media.src} controls />}
                      {item.media.type === 'audio' && <audio src={item.media.src} controls />}
                    </div>
                  )}
                </article>
              ))}
            </section>
          ))}
        </div>
      </section>
    </main>
  );
}

const AUTH_TOKEN_KEY = 'museforge_auth_token';
const AUTH_USER_KEY = 'museforge_auth_user';
const USER_HISTORY_CACHE_PREFIX = 'museforge_user_history_';

const normalizeHistoryEmail = (email = '') => String(email || '').trim().toLowerCase();

const userHistoryCacheKey = (email = '') => `${USER_HISTORY_CACHE_PREFIX}${normalizeHistoryEmail(email) || 'guest'}`;

const readCachedUserHistory = (email = '') => {
  if (typeof window === 'undefined') return null;
  const normalizedEmail = normalizeHistoryEmail(email);
  if (!normalizedEmail) return null;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(userHistoryCacheKey(normalizedEmail)) || 'null');
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (_) {
    return null;
  }
};

const cacheUserHistory = (email = '', history = {}) => {
  if (typeof window === 'undefined') return;
  const normalizedEmail = normalizeHistoryEmail(email);
  if (!normalizedEmail) return;
  try {
    window.localStorage.setItem(userHistoryCacheKey(normalizedEmail), JSON.stringify({
      creatorDrafts: history.creatorDrafts || {},
      portfolioVersions: Array.isArray(history.portfolioVersions) ? history.portfolioVersions.slice(0, 3) : [],
      factLockReviews: Array.isArray(history.factLockReviews) ? history.factLockReviews : [],
      localizedOutput: history.localizedOutput || null,
      shareUrl: history.shareUrl || '',
      savedAt: new Date().toISOString(),
    }));
  } catch (_) {}
};


function readStoredAuth() {
  try {
    const token = window.localStorage.getItem(AUTH_TOKEN_KEY);
    const userRaw = window.localStorage.getItem(AUTH_USER_KEY);
    return { token, user: userRaw ? JSON.parse(userRaw) : null };
  } catch (_) {
    return { token: null, user: null };
  }
}

function readAuthLink() {
  try {
    const params = new URLSearchParams(window.location.search);
    return {
      verifyToken: params.get('verifyToken') || '',
      resetToken: params.get('resetToken') || '',
    };
  } catch (_) {
    return { verifyToken: '', resetToken: '' };
  }
}

function clearAuthLinkParams() {
  try {
    const url = new URL(window.location.href);
    url.searchParams.delete('verifyToken');
    url.searchParams.delete('resetToken');
    window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);
  } catch (_) {}
}

function GoogleLogo() {
  return (
    <svg className="google-logo" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M21.35 12.27c0-.74-.07-1.45-.19-2.13H12v4.03h5.24a4.48 4.48 0 0 1-1.94 2.94v2.61h3.14c1.84-1.69 2.91-4.19 2.91-7.45Z" />
      <path fill="#34A853" d="M12 21.75c2.63 0 4.83-.87 6.44-2.36l-3.14-2.61c-.87.58-1.98.93-3.3.93-2.54 0-4.69-1.72-5.46-4.03H3.3v2.69A9.75 9.75 0 0 0 12 21.75Z" />
      <path fill="#FBBC05" d="M6.54 13.68A5.86 5.86 0 0 1 6.23 12c0-.58.1-1.15.31-1.68V7.63H3.3A9.75 9.75 0 0 0 2.25 12c0 1.57.38 3.06 1.05 4.37l3.24-2.69Z" />
      <path fill="#EA4335" d="M12 6.29c1.43 0 2.71.49 3.72 1.45l2.79-2.79A9.35 9.35 0 0 0 12 2.25a9.75 9.75 0 0 0-8.7 5.38l3.24 2.69C7.31 8.01 9.46 6.29 12 6.29Z" />
    </svg>
  );
}

function WelcomeScreen({ onLogin }) {
  return (
    <main className="public-welcome" aria-label="MuseForge welcome page">
      <div className="public-welcome-overlay" aria-hidden="true" />
      <section className="public-welcome-content">
        <div className="public-welcome-brand"><span>M</span> MuseForge</div>
        <div className="public-welcome-badge"><span>✦</span> AI-POWERED CREATIVE PORTFOLIOS</div>
        <span className="public-welcome-script">Welcome to</span>
        <h1>MUSEFORGE</h1>
        <p className="public-welcome-kicker">WHERE CREATORS MEET AI</p>
        <p className="public-welcome-copy">Turn your real ideas, projects, and creative work into a polished portfolio—without adding anything fake.</p>
        <div className="public-welcome-actions">
          <button type="button" className="public-login-btn" onClick={onLogin}>Log in <span aria-hidden="true">→</span></button>
        </div>
        <p className="public-welcome-account-note">New here? Open the login form and choose <strong>Sign up</strong>.</p>
      </section>
      <div className="public-welcome-fine-line" aria-hidden="true" />
    </main>
  );
}

function AuthScreen({ mode, onBack, onSwitch, onSubmit, onGoogleSubmit, onForgotPassword, loading, error, notice }) {
  const [showPassword, setShowPassword] = useState(false);
  const isSignup = mode === 'signup';
  const [form, setForm] = useState({ name: '', email: '', password: '', confirmPassword: '' });
  const [localError, setLocalError] = useState('');
  const [googleReady, setGoogleReady] = useState(false);
  const googleButtonRef = useRef(null);
  const [runtimeGoogleClientId, setRuntimeGoogleClientId] = useState('');
  const googleClientId = String(process.env.REACT_APP_GOOGLE_CLIENT_ID || runtimeGoogleClientId || '').trim();

  const update = (field, value) => setForm(prev => ({ ...prev, [field]: value }));

  useEffect(() => {
    if (process.env.REACT_APP_GOOGLE_CLIENT_ID) return undefined;
    let cancelled = false;
    fetchFromBackend('/config')
      .then(response => response.json().catch(() => ({})))
      .then(data => {
        if (!cancelled && data.googleClientId) setRuntimeGoogleClientId(String(data.googleClientId || '').trim());
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!googleClientId) {
      setGoogleReady(false);
      return undefined;
    }

    let cancelled = false;

    const initializeGoogle = () => {
      if (cancelled || !window.google?.accounts?.id) return;
      window.google.accounts.id.initialize({
        client_id: googleClientId,
        callback: response => {
          if (!response?.credential) {
            setLocalError('Google did not return a sign-in credential. Please try again.');
            return;
          }
          setLocalError('');
          onGoogleSubmit(response.credential);
        },
        auto_select: false,
        cancel_on_tap_outside: true,
        ux_mode: 'popup',
      });
      if (googleButtonRef.current) {
        googleButtonRef.current.innerHTML = '';
        window.google.accounts.id.renderButton(googleButtonRef.current, {
          type: 'standard',
          theme: 'outline',
          size: 'large',
          text: 'continue_with',
          shape: 'rectangular',
          logo_alignment: 'left',
          width: 414,
        });
      }
      setGoogleReady(true);
    };

    if (window.google?.accounts?.id) {
      initializeGoogle();
      return () => { cancelled = true; };
    }

    const existingScript = document.getElementById('museforge-google-identity');
    if (existingScript) {
      existingScript.addEventListener('load', initializeGoogle, { once: true });
      return () => {
        cancelled = true;
        existingScript.removeEventListener('load', initializeGoogle);
      };
    }

    const script = document.createElement('script');
    script.id = 'museforge-google-identity';
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = initializeGoogle;
    script.onerror = () => {
      if (!cancelled) setLocalError('Google sign-in could not load. Check your internet connection and try again.');
    };
    document.head.appendChild(script);

    return () => { cancelled = true; };
  }, [googleClientId, mode, onGoogleSubmit]);

  const startGoogleSignIn = () => {
    setLocalError('');
    if (!googleClientId) {
      setLocalError('Google login needs REACT_APP_GOOGLE_CLIENT_ID in the frontend .env file.');
      return;
    }
    if (!googleReady) {
      setLocalError('Google sign-in is still loading. Please wait a second and try again.');
      return;
    }
    try {
      window.google?.accounts?.id?.prompt?.();
    } catch (error) {
      setLocalError('Google sign-in popup could not open. Use the visible Google button area again or check OAuth origin settings.');
    }
  };

  const submit = (event) => {
    event.preventDefault();
    setLocalError('');
    if (isSignup && form.password !== form.confirmPassword) {
      setLocalError('Passwords do not match.');
      return;
    }
    onSubmit({ mode, name: form.name, email: form.email, password: form.password });
  };

  return (
    <main className="auth-page">
      <button type="button" className="auth-back" onClick={onBack}>← Back</button>
      <section className="auth-card" aria-label={isSignup ? 'Create account' : 'Log in'}>
        <div className="auth-brand-mark">M</div>
        <p className="auth-eyebrow">MUSEFORGE</p>
        <h1>{isSignup ? 'Create your account' : 'Log in with email'}</h1>
        <p className="auth-intro">{isSignup ? 'Sign up, verify your email, then start building.' : 'Log in to continue to your creative workspace.'}</p>

        <div className="auth-google-area">
          <div className="google-clean-button" role="button" tabIndex={0} aria-label="Continue with Google" onClick={startGoogleSignIn} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') startGoogleSignIn(); }}>
            <div ref={googleButtonRef} className={`auth-google-official ${!googleReady ? 'is-loading' : ''}`} aria-hidden="true" />
            <div className="google-clean-face" aria-hidden="true">
              <span className="google-clean-icon"><GoogleLogo /></span>
              <span className="google-clean-text">Continue with Google</span>
            </div>
          </div>
        </div>

        <div className="auth-divider"><span>or continue with email</span></div>

        <form onSubmit={submit} className="auth-form" noValidate>
          {isSignup && (
            <label>
              <span>Full name</span>
              <div className="auth-input-wrap"><span aria-hidden="true">◇</span><input type="text" autoComplete="name" value={form.name} onChange={event => update('name', event.target.value)} placeholder="Your full name" required /></div>
            </label>
          )}
          <label>
            <span>Email address</span>
            <div className="auth-input-wrap"><span aria-hidden="true">✉</span><input type="email" autoComplete="email" value={form.email} onChange={event => update('email', event.target.value)} placeholder="Email address" required /></div>
          </label>
          <label>
            <span>Password</span>
            <div className="auth-input-wrap"><span aria-hidden="true">♙</span>< input type={showPassword ? "text" : "password"} autoComplete={isSignup ? 'new-password' : 'current-password'} minLength={8} value={form.password} onChange={event => update('password', event.target.value)} placeholder="At least 8 characters" required /><button
              type="button"
              className="auth-password-toggle"
              onClick={() => setShowPassword(prev => !prev)}
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? (
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M3 3l18 18" />
                  <path d="M10.58 10.58A2 2 0 0 0 12 14a2 2 0 0 0 1.42-.58" />
                  <path d="M9.88 5.09A9.8 9.8 0 0 1 12 4.86c5.25 0 8.5 4.64 9.5 7.14a13.4 13.4 0 0 1-2.21 3.31" />
                  <path d="M6.11 6.11C4.32 7.33 3.1 9.1 2.5 12c1 2.5 4.25 7.14 9.5 7.14a9.7 9.7 0 0 0 4.38-1.06" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M2.5 12S5.75 4.86 12 4.86 21.5 12 21.5 12 18.25 19.14 12 19.14 2.5 12 2.5 12Z" />
                  <circle cx="12" cy="12" r="2.5" />
                </svg>
              )}
          </button>
          </div>
          </label>
          {!isSignup && <button type="button" className="auth-text-action auth-forgot" onClick={onForgotPassword}>Forgot password?</button>}
          {isSignup && (
            <label>
              <span>Confirm password</span>
              <div className="auth-input-wrap"><span aria-hidden="true">♙</span><input type="password" autoComplete="new-password" minLength={8} value={form.confirmPassword} onChange={event => update('confirmPassword', event.target.value)} placeholder="Repeat your password" required /></div>
            </label>
          )}
          {notice && <div className="auth-notice" role="status">{notice}</div>}
          {(localError || error) && <div className="auth-error" role="alert">{localError || error}</div>}
          {(localError || error) && /google|origin|oauth|client id|sign-in/i.test(localError || error) && (
            <div className="google-oauth-help">
              Google login ke liye Google Cloud Console mein current URL ko <strong>Authorized JavaScript origins</strong> mein add karna zaroori hai. Local test ke liye <code>{window.location.origin}</code> add karo, phir OAuth Client ID frontend aur backend .env mein same rakho.
            </div>
          )}
          <button type="submit" className="auth-submit" disabled={loading}>{loading ? 'Please wait…' : isSignup ? 'Create Account' : 'Log In'}</button>
        </form>

        <p className="auth-switch">
          {isSignup ? 'Already have an account?' : "Don't have an account?"}{' '}
          <button type="button" onClick={onSwitch}>{isSignup ? 'Log in' : 'Sign up'}</button>
        </p>
      </section>
    </main>
  );
}

function VerificationPendingScreen({
  email,
  verificationCode,
  onCodeChange,
  onVerifyCode,
  onResend,
  onLogin,
  loading,
  error,
  notice,
}) {
  const code = String(verificationCode || '');

  return (
    <main className="auth-page">
      <section className="auth-card auth-action-card" aria-label="Verify your email">
        <div className="auth-action-icon" aria-hidden="true">#</div>
        <p className="auth-eyebrow">EMAIL VERIFICATION</p>
        <h1>Enter verification code</h1>
        <p className="auth-intro">
          We sent a 6-digit code to <strong>{email || 'your email address'}</strong>.
          Enter it below to activate your account.
        </p>

        {notice && <div className="auth-notice" role="status">{notice}</div>}
        {error && <div className="auth-error" role="alert">{error}</div>}

        <form className="auth-code-form" onSubmit={onVerifyCode}>
          <label className="auth-code-label" htmlFor="verification-code">Verification code</label>
          <input
            id="verification-code"
            className="auth-code-input"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(event) => onCodeChange(event.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="000000"
            aria-label="6 digit verification code"
          />

          <button
            type="submit"
            className="auth-submit"
            disabled={loading || code.length !== 6}
          >
            {loading ? 'Verifying…' : 'Verify account'}
          </button>
        </form>

        <button
          type="button"
          className="auth-secondary-action"
          onClick={onResend}
          disabled={loading}
        >
          {loading ? 'Sending…' : 'Resend code'}
        </button>

        <button type="button" className="auth-link-button" onClick={onLogin}>
          Back to log in
        </button>

        <div className="auth-help-box">
          The code expires in 10 minutes. Also check your Spam or Junk folder.
        </div>
      </section>
    </main>
  );
}
function ForgotPasswordScreen({ onBack, onSubmit, loading, error, notice }) {
  const [email, setEmail] = useState('');
  const submit = (event) => {
    event.preventDefault();
    onSubmit(email);
  };
  return (
    <main className="auth-page">
      <button type="button" className="auth-back" onClick={onBack}>← Back to log in</button>
      <section className="auth-card auth-action-card" aria-label="Forgot password">
        <div className="auth-action-icon" aria-hidden="true">↻</div>
        <p className="auth-eyebrow">ACCOUNT RECOVERY</p>
        <h1>Forgot your password?</h1>
        <p className="auth-intro">Enter your account email. We will send you a secure link for choosing a new password.</p>
        <form className="auth-form" onSubmit={submit}>
          <label>
            <span>Email address</span>
            <div className="auth-input-wrap"><span aria-hidden="true">✉</span><input type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="Email address" required /></div>
          </label>
          {notice && <div className="auth-notice" role="status">{notice}</div>}
          {error && <div className="auth-error" role="alert">{error}</div>}
          <button type="submit" className="auth-submit" disabled={loading}>{loading ? 'Sending…' : 'Send reset link'}</button>
        </form>
      </section>
    </main>
  );
}

function ResetPasswordScreen({ onBack, onSubmit, loading, error, notice }) {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [localError, setLocalError] = useState('');
  const submit = (event) => {
    event.preventDefault();
    setLocalError('');
    if (password !== confirmPassword) {
      setLocalError('Passwords do not match.');
      return;
    }
    onSubmit(password);
  };
  return (
    <main className="auth-page">
      <button type="button" className="auth-back" onClick={onBack}>← Back to log in</button>
      <section className="auth-card auth-action-card" aria-label="Reset password">
        <div className="auth-action-icon" aria-hidden="true">✓</div>
        <p className="auth-eyebrow">SECURE RESET</p>
        <h1>Choose a new password</h1>
        <p className="auth-intro">Use at least 8 characters, and do not reuse an important password from another account.</p>
        <form className="auth-form" onSubmit={submit}>
          <label>
            <span>New password</span>
            <div className="auth-input-wrap"><span aria-hidden="true">♙</span><input type="password" autoComplete="new-password" minLength={8} value={password} onChange={event => setPassword(event.target.value)} placeholder="At least 8 characters" required /></div>
          </label>
          <label>
            <span>Confirm new password</span>
            <div className="auth-input-wrap"><span aria-hidden="true">♙</span><input type="password" autoComplete="new-password" minLength={8} value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} placeholder="Repeat your new password" required /></div>
          </label>
          {notice && <div className="auth-notice" role="status">{notice}</div>}
          {(localError || error) && <div className="auth-error" role="alert">{localError || error}</div>}
          {(localError || error) && /google|origin|oauth|client id|sign-in/i.test(localError || error) && (
            <div className="google-oauth-help">
              Google login ke liye Google Cloud Console mein current URL ko <strong>Authorized JavaScript origins</strong> mein add karna zaroori hai. Local test ke liye <code>{window.location.origin}</code> add karo, phir OAuth Client ID frontend aur backend .env mein same rakho.
            </div>
          )}
          <button type="submit" className="auth-submit" disabled={loading}>{loading ? 'Updating…' : 'Change password'}</button>
        </form>
      </section>
    </main>
  );
}

function VerificationWorkingScreen({ loading, error, onLogin }) {
  return (
    <main className="auth-page">
      <section className="auth-card auth-action-card" aria-label="Email verification">
        <div className="auth-action-icon" aria-hidden="true">{error ? '!' : '✓'}</div>
        <p className="auth-eyebrow">EMAIL VERIFICATION</p>
        <h1>{loading ? 'Verifying your email…' : error ? 'Link could not be verified' : 'Email verified'}</h1>
        <p className="auth-intro">{loading ? 'Please wait for a moment. Do not close this page.' : error || 'Your account is ready.'}</p>
        {error && <div className="auth-error" role="alert">{error}</div>}
        {!loading && <button type="button" className="auth-submit" onClick={onLogin}>Go to log in</button>}
      </section>
    </main>
  );
}

function App() {
  readStoredAuth();
  const authLink = readAuthLink();
  const [verificationToken] = useState(authLink.verifyToken);
  const [resetToken] = useState(authLink.resetToken);
  const [authView, setAuthView] = useState(() => authLink.verifyToken ? 'verifying' : authLink.resetToken ? 'reset-password' : 'welcome');
  const [authUser, setAuthUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(Boolean(authLink.verifyToken));
  const [authError, setAuthError] = useState('');
  const [authNotice, setAuthNotice] = useState('');
  const [pendingEmail, setPendingEmail] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [showLanding, setShowLanding] = useState(true);
  const [selectedCreatorType, setSelectedCreatorType] = useState(null);
  const [name, setName] = useState("");
  const [medium, setMedium] = useState("");
  const [description, setDescription] = useState("");
  const [projects, setProjects] = useState([]);
  const [customSections, setCustomSections] = useState([]);
  const [portfolio, setPortfolio] = useState("");
  const [portfolioReady, setPortfolioReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [imagePreview, setImagePreview] = useState(null);
  const [imagePosition, setImagePosition] = useState({ x: 50, y: 50 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0, posX: 50, posY: 50 });
  const [cvLoading, setCvLoading] = useState(false);
  const [contact, setContact] = useState({ linkedin: '', github: '', whatsapp: '', email: '', address: '', links: [] });
  const [skills, setSkills] = useState([]);
  const [activeTab, setActiveTab] = useState("manual");
  const [cvFilled, setCvFilled] = useState(false);
  const [editingProject, setEditingProject] = useState(null);
  const [addingSectionName, setAddingSectionName] = useState(false);
  const [newSectionName, setNewSectionName] = useState("");
  const [editingSectionItem, setEditingSectionItem] = useState(null);
  const [addingItemTo, setAddingItemTo] = useState(null);
  const [newItemHeading, setNewItemHeading] = useState("");
  const [newItemDesc, setNewItemDesc] = useState("");
  const [newItemLink, setNewItemLink] = useState("");
  const [newItemMedia, setNewItemMedia] = useState(null);
  const [creatorDrafts, setCreatorDrafts] = useState({});
  const [showDemoVideo, setShowDemoVideo] = useState(false);
  const [demoStarted, setDemoStarted] = useState(false);
  const [generationNotice, setGenerationNotice] = useState('');
  const [imageUploadError, setImageUploadError] = useState('');
  const [portfolioLanguage, setPortfolioLanguage] = useState('English');
  const [aiTone, setAiTone] = useState('Professional');
  const [projectSuggestions, setProjectSuggestions] = useState([]);
  const [suggestionLoading, setSuggestionLoading] = useState(false);
  const [suggestionError, setSuggestionError] = useState('');
  const [portfolioVersions, setPortfolioVersions] = useState([]);
  const [_linkedinCopied, setLinkedinCopied] = useState(false);
  const [factLockReviews, setFactLockReviews] = useState([]);
  const [regeneratingFactLockId, setRegeneratingFactLockId] = useState('');
  const [localizedOutput, setLocalizedOutput] = useState(null);
  const [shareUrl, setShareUrl] = useState('');
  const [shareStatus, setShareStatus] = useState('');
  const [publicPortfolio, setPublicPortfolio] = useState(null);
  const [publicPortfolioStatus, setPublicPortfolioStatus] = useState('idle');
  const [publicPortfolioError, setPublicPortfolioError] = useState('');
  const [reviews, setReviews] = useState(() => loadCachedReviews());
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [showAllReviewsModal, setShowAllReviewsModal] = useState(false);
  const [reviewRating, setReviewRating] = useState(0);
  const [reviewText, setReviewText] = useState('');
  const [reviewError, setReviewError] = useState('');
  const [reviewSuccess, setReviewSuccess] = useState('');
  const [reviewSubmitting, setReviewSubmitting] = useState(false);
  const [pendingReviewAction, setPendingReviewAction] = useState(null);
  const [showExportCustomizer, setShowExportCustomizer] = useState(false);
  const [exportSettings, setExportSettings] = useState(DEFAULT_EXPORT_SETTINGS);
  const publicPortfolioId = getPublicPortfolioIdFromPath();
  const imageInputRef = useRef(null);

  const emptyDraftFor = (typeKey) => ({
    name: "",
    medium: CREATOR_TYPES[typeKey]?.medium || "",
    description: "",
    projects: [],
    customSections: [],
    portfolio: "",
    portfolioReady: false,
    portfolioLanguage: 'English',
    aiTone: 'Professional',
    projectSuggestions: [],
    portfolioVersions: [],
    factLockReviews: [],
    localizedOutput: null,
    shareUrl: '',
    imagePreview: null,
    imagePosition: { x: 50, y: 50 },
    contact: { linkedin: '', github: '', whatsapp: '', email: '', address: '', links: [] },
    skills: [],
    activeTab: "manual",
    cvFilled: false,
  });

  const currentDraftSnapshot = () => ({
    name, medium, description, projects, customSections, portfolio, portfolioReady, portfolioLanguage, factLockReviews, localizedOutput, shareUrl,
    imagePreview, imagePosition, contact, skills, activeTab, cvFilled, aiTone, projectSuggestions, portfolioVersions,
  });

  const applyDraft = (draft) => {
    setName(draft.name || "");
    setMedium(draft.medium || "");
    setDescription(draft.description || "");
    setProjects(draft.projects || []);
    setCustomSections(draft.customSections || []);
    setPortfolio(draft.portfolio || "");
    setPortfolioReady(Boolean(draft.portfolioReady && draft.portfolio));
    setPortfolioLanguage(draft.portfolioLanguage || 'English');
    setAiTone(draft.aiTone || 'Professional');
    setProjectSuggestions(draft.projectSuggestions || []);
    setSuggestionError('');
    setPortfolioVersions(draft.portfolioVersions || []);
    setFactLockReviews(draft.factLockReviews || []);
    setLocalizedOutput(draft.localizedOutput || null);
    setShareUrl(draft.shareUrl || '');
    setShareStatus('');
    setImagePreview(draft.imagePreview || null);
    setImagePosition(draft.imagePosition || { x: 50, y: 50 });
    setContact(normalizeContact(draft.contact || { linkedin: '', github: '', whatsapp: '', email: '', address: '', links: [] }));
    setSkills(draft.skills || []);
    setActiveTab(draft.activeTab || "manual");
    setCvFilled(Boolean(draft.cvFilled));
  };

  const saveCurrentDraft = (typeKey = selectedCreatorType) => {
    if (!typeKey) return;
    const snapshot = currentDraftSnapshot();
    setCreatorDrafts(prev => ({ ...prev, [typeKey]: snapshot }));
  };


  const applyUserHistory = (history = {}) => {
    if (!history || typeof history !== 'object') return;
    const restoredDrafts = history.creatorDrafts && typeof history.creatorDrafts === 'object' ? history.creatorDrafts : {};
    const restoredVersions = Array.isArray(history.portfolioVersions) ? history.portfolioVersions.slice(0, 3) : [];
    const restoredFactLock = Array.isArray(history.factLockReviews) ? history.factLockReviews : [];

    if (Object.keys(restoredDrafts).length) setCreatorDrafts(restoredDrafts);
    if (restoredVersions.length) setPortfolioVersions(restoredVersions);
    if (restoredFactLock.length) setFactLockReviews(restoredFactLock);
    if (history.localizedOutput) setLocalizedOutput(history.localizedOutput);
    if (history.shareUrl) setShareUrl(history.shareUrl);
  };

  const [particles] = useState(() =>
    Array.from({ length: 20 }, (_, i) => ({
      id: i,
      left: Math.random() * 100,
      top: Math.random() * 100,
      duration: Math.random() * 10 + 8,
      delay: Math.random() * 5,
    }))
  );

  useEffect(() => {
    if (!showLanding) {
      requestAnimationFrame(() => window.scrollTo({ top: 0, left: 0, behavior: "auto" }));
    }
  }, [showLanding, selectedCreatorType]);

  useEffect(() => {
    if (!authNotice) return undefined;
    const timer = window.setTimeout(() => setAuthNotice(''), 6500);
    return () => window.clearTimeout(timer);
  }, [authNotice]);


  useEffect(() => {
    if (!isSupportedOutputLanguage(portfolioLanguage)) {
      setPortfolioLanguage('English');
    }
  }, [portfolioLanguage]);

  useEffect(() => {
    if (!publicPortfolioId) return undefined;
    let active = true;
    setPublicPortfolioStatus('loading');
    setPublicPortfolioError('');
    fetchFromBackend(`/portfolio/${publicPortfolioId}`)
      .then(async response => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'Portfolio could not be opened.');
        return data;
      })
      .then(data => {
        if (!active) return;
        setPublicPortfolio(data.portfolio);
        setPublicPortfolioStatus('ready');
      })
      .catch(error => {
        if (!active) return;
        setPublicPortfolioError(error?.message || 'Portfolio could not be opened.');
        setPublicPortfolioStatus('error');
      });
    return () => { active = false; };
  }, [publicPortfolioId]);

  useEffect(() => {
    if (process.env.NODE_ENV === 'test') {
      setReviews([]);
      return undefined;
    }
    let active = true;
    fetchFromBackend('/reviews')
      .then(async response => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'Could not load reviews.');
        return data;
      })
      .then(data => {
        if (!active) return;
        const loadedReviews = Array.isArray(data.reviews) ? data.reviews : [];
        setReviews(loadedReviews);
        cacheReviews(loadedReviews);
      })
      .catch(() => {
        if (active) setReviews(loadCachedReviews());
      });
    return () => { active = false; };
  }, []);


  useEffect(() => {
    const email = normalizeHistoryEmail(authUser?.email || '');
    if (!email) return undefined;
    let active = true;

    const cached = readCachedUserHistory(email);
    if (cached) applyUserHistory(cached);

    fetchFromBackend(`/user-history/${encodeURIComponent(email)}`)
      .then(async response => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'Could not load saved portfolio history.');
        return data;
      })
      .then(data => {
        if (!active) return;
        const history = data.history || {};
        if (history && (Object.keys(history.creatorDrafts || {}).length || (history.portfolioVersions || []).length)) {
          applyUserHistory(history);
          cacheUserHistory(email, history);
        }
      })
      .catch(() => {});

    return () => { active = false; };
  }, [authUser?.email]);

  useEffect(() => {
    const email = normalizeHistoryEmail(authUser?.email || '');
    if (!email) return undefined;
    const hasAnythingToSave = Object.keys(creatorDrafts || {}).length || portfolioVersions.length || factLockReviews.length || localizedOutput || shareUrl;
    if (!hasAnythingToSave) return undefined;

    const history = {
      creatorDrafts,
      portfolioVersions: portfolioVersions.slice(0, 3),
      factLockReviews,
      localizedOutput,
      shareUrl,
    };

    cacheUserHistory(email, history);
    const timer = window.setTimeout(() => {
      fetchFromBackend('/user-history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, history }),
      }).catch(() => {});
    }, 450);

    return () => window.clearTimeout(timer);
  }, [authUser?.email, creatorDrafts, portfolioVersions, factLockReviews, localizedOutput, shareUrl]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    if (!showLanding || showReviewModal || !portfolioVersions.length) return undefined;

    const userKey = authUser?.email || contact.email || 'guest';
    const alreadyReviewed = window.localStorage.getItem(`museforge_reviewed_${userKey}`) === 'true';
    const sessionResolved = reviewGateCompleted();
    const latestVersionId = String(portfolioVersions[0]?.id || 'latest');
    const promptMarker = `${latestVersionId}:${userKey}`;
    const seenPrompt = window.sessionStorage.getItem(REVIEW_SESSION_AUTOPROMPT_KEY);

    if (alreadyReviewed || sessionResolved || seenPrompt === promptMarker) return undefined;

    const timer = window.setTimeout(() => {
      window.sessionStorage.setItem(REVIEW_SESSION_AUTOPROMPT_KEY, promptMarker);
      openReviewModal('landing-auto');
    }, 500);

    return () => window.clearTimeout(timer);
  }, [showLanding, showReviewModal, portfolioVersions, authUser?.email, contact.email]);

  const completeAuthentication = (data, fallbackMessage = '') => {
    if (!data?.token || !data?.user) throw new Error('The server returned an incomplete login response.');
    window.localStorage.setItem(AUTH_TOKEN_KEY, data.token);
    window.localStorage.setItem(AUTH_USER_KEY, JSON.stringify(data.user));
    const cachedHistory = readCachedUserHistory(data.user.email);
    if (cachedHistory) applyUserHistory(cachedHistory);
    if (data.history) applyUserHistory(data.history);
    setAuthUser(data.user);
    setAuthView('app');
    setShowLanding(true);
    setSelectedCreatorType(null);
    setAuthNotice(data.message || fallbackMessage);
    requestAnimationFrame(() => window.scrollTo({ top: 0, left: 0, behavior: 'auto' }));
  };

  const readableAuthError = (error) => {
    const message = error?.message || '';
    if (message === 'Failed to fetch') return 'Could not connect to the MuseForge server. Start the app with npm run dev and try again.';
    if (/origin_mismatch|OAuth|Google sign-in/i.test(message)) return `${message} Current origin is ${window.location.origin}. Add this exact origin in Google Cloud OAuth Authorized JavaScript origins.`;
    return message || 'Authentication failed.';
  };


  const _generateProfileBioAndStatement = async () => {
  const creatorLabel =
    selectedCreatorType && CREATOR_TYPES[selectedCreatorType]
      ? CREATOR_TYPES[selectedCreatorType].label
      : "";

  const outputLanguage =
    portfolioLanguage || "English";

  const payload = {
    name: name || "",
    creatorType: selectedCreatorType || "",
    creatorLabel,
    category: "" || "",
    description:
      description || "",
    projects: projects || [],
    skills: skills || [],
    contact: contact || {},
    outputLanguage,
    tone: aiTone || "Professional"
  };

  const res = await fetch("http://localhost:5000/api/profile-ai-text", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    throw new Error("Bio/Statement AI generation failed");
  }

  const data = await res.json();

  const bioHeading =
    data.bioHeading || getBioHeading(selectedCreatorType, creatorLabel);

  const statementHeading =
    data.statementHeading || getStatementHeading(selectedCreatorType, creatorLabel);

  const enhancedBio = data.bio || "";
  const enhancedStatement = data.statement || "";

  // bio/statement used in factLockReviews below

  setFactLockReviews((prev) => {
    const cleaned = (prev || []).filter(
      (item) => item.key !== "bio" && item.key !== "statement"
    );

    return [
      ...cleaned,
      {
        key: "bio",
        field: "bio",
        section: bioHeading,
        title: bioHeading,
        original: payload.description || "",
        enhanced: enhancedBio,
        originalText: payload.description || "",
        enhancedText: enhancedBio,
        status: "pending"
      },
      {
        key: "statement",
        field: "statement",
        section: statementHeading,
        title: statementHeading,
        original: "" || "",
        enhanced: enhancedStatement,
        originalText: "" || "",
        enhancedText: enhancedStatement,
        status: "pending"
      }
    ];
  });
};


  const handleAuthentication = async ({ mode, name: submittedName, email, password }) => {
    setAuthLoading(true);
    setAuthError('');
    setAuthNotice('');
    try {
      const response = await fetchFromBackend(`/auth/${mode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: submittedName, email, password }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (data.code === 'EMAIL_NOT_VERIFIED') {
          setPendingEmail(data.email || email);
          setAuthNotice(data.error || 'Please verify your email.');
          setAuthView('verify-pending');
          return;
        }
        throw new Error(data.error || 'Authentication failed.');
      }
      if (data.token && data.user) {
  completeAuthentication(data, mode === 'signup' ? 'Account created successfully.' : 'Logged in successfully.');
  return;
}

if (data.pendingVerification) {
  setPendingEmail(data.email || email);
  setVerificationCode('');
  setAuthNotice(data.message || 'Enter the 6-digit verification code we sent to your email.');
  setAuthView('verify-pending');
  return;
}

completeAuthentication(data, mode === 'signup' ? 'Account created successfully.' : 'Logged in successfully.');
      completeAuthentication(data, mode === 'signup' ? 'Account created successfully.' : 'Logged in successfully.');
    } catch (error) {
      setAuthError(readableAuthError(error));
    } finally {
      setAuthLoading(false);
    }
  };

  const handleGoogleAuthentication = async (credential) => {
    setAuthLoading(true);
    setAuthError('');
    setAuthNotice('');
    try {
      const response = await fetchFromBackend('/auth/google', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Google sign-in failed.');
      completeAuthentication(data, 'Logged in with Google successfully.');
    } catch (error) {
      setAuthError(readableAuthError(error));
    } finally {
      setAuthLoading(false);
    }
  };

  const handleVerifyCode = async (event) => {
    if (event) event.preventDefault();

    const code = String(verificationCode || '').replace(/\D/g, '').slice(0, 6);

    if (!pendingEmail) {
      setAuthError('Please sign up again so we know which email to verify.');
      return;
    }

    if (!/^\d{6}$/.test(code)) {
      setAuthError('Please enter the 6-digit verification code.');
      return;
    }

    setAuthLoading(true);
    setAuthError('');
    setAuthNotice('');

    try {
      const response = await fetchFromBackend('/auth/verify-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: pendingEmail, code }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Verification failed.');

      setVerificationCode('');
      completeAuthentication(data, data.message || 'Email verified successfully.');
    } catch (error) {
      setAuthError(readableAuthError(error));
    } finally {
      setAuthLoading(false);
    }
  };
  const handleResendVerification = async () => {
    if (!pendingEmail) {
      setAuthError('Please return to Sign up and enter your email again.');
      return;
    }
    setAuthLoading(true);
    setAuthError('');
    setAuthNotice('');
    try {
      const response = await fetchFromBackend('/auth/resend-verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: pendingEmail }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Could not resend the verification email.');
      setVerificationCode('');
      setAuthNotice(data.message || 'A new verification code has been sent.');
    } catch (error) {
      setAuthError(readableAuthError(error));
    } finally {
      setAuthLoading(false);
    }
  };

  const handleForgotPassword = async (email) => {
    setAuthLoading(true);
    setAuthError('');
    setAuthNotice('');
    try {
      const response = await fetchFromBackend('/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Could not send the reset link.');
      setAuthNotice(data.message || 'Check your email for the password reset link.');
    } catch (error) {
      setAuthError(readableAuthError(error));
    } finally {
      setAuthLoading(false);
    }
  };

  const handleResetPassword = async (password) => {
    setAuthLoading(true);
    setAuthError('');
    setAuthNotice('');
    try {
      const response = await fetchFromBackend('/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: resetToken, password }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Could not change the password.');
      clearAuthLinkParams();
      setAuthNotice(data.message || 'Password changed successfully.');
      setAuthView('login');
    } catch (error) {
      setAuthError(readableAuthError(error));
    } finally {
      setAuthLoading(false);
    }
  };

  useEffect(() => {
    if (authView !== 'verifying' || !verificationToken) return undefined;
    let active = true;
    setAuthLoading(true);
    setAuthError('');

    verifyEmailTokenOnce(verificationToken)
      .then(data => {
        if (!active) return;
        clearAuthLinkParams();
        completeAuthentication(data, 'Email verified successfully.');
      })
      .catch(error => {
        if (active) setAuthError(readableAuthError(error));
      })
      .finally(() => {
        if (active) setAuthLoading(false);
      });

    return () => { active = false; };
  }, [authView, verificationToken]);

  const logout = () => {
    try {
      window.localStorage.removeItem(AUTH_TOKEN_KEY);
      window.localStorage.removeItem(AUTH_USER_KEY);
    } catch (_) {}
    setAuthUser(null);
    setAuthView('welcome');
    setShowLanding(true);
    setSelectedCreatorType(null);
    setName('');
    setMedium('');
    setDescription('');
    setProjects([]);
    setCustomSections([]);
    setPortfolio('');
    setPortfolioReady(false);
    setPortfolioLanguage('English');
    setFactLockReviews([]);
    setLocalizedOutput(null);
    setShareUrl('');
    setShareStatus('');
    setGenerationNotice('');
    setAuthNotice('');
    setImageUploadError('');
    setCreatorDrafts({});
    setPortfolioVersions([]);
  };

  const scrollToSection = (id) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const newId = () => Math.floor(Date.now() + Math.random() * 9999);

  const fixName = (n) => n
    .replace(/\b([A-Z][a-z]?)\s+([a-z]+)\b/g, '$1$2')
    .replace(/\s+/g, ' ').trim();

  const handleImage = (e) => {
    const file = e.target.files?.[0];
    setImageUploadError('');
    if (!file) return;
    if (!file.type?.startsWith('image/')) {
      setImageUploadError('Please choose a valid image file.');
      e.target.value = '';
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setImageUploadError('Image is too large. Please choose an image smaller than 8 MB.');
      e.target.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = (event) => {
      setImagePreview(String(event.target?.result || ''));
      setImagePosition({ x: 50, y: 50 });
    };
    reader.onerror = () => setImageUploadError('This image could not be read. Please try another file.');
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleCV = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setCvLoading(true);
    setPortfolio(""); setPortfolioReady(false); setProjects([]); setCustomSections([]); setImageUploadError('');
    try {
      const formData = new FormData();
      formData.append('cv', file);
      const res = await fetchFromBackend('/parse-cv', { method: 'POST', body: formData });
      
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(errorData.error || `HTTP ${res.status}: ${res.statusText}`);
      }
      
      const data = await res.json();
      console.log('CV parsed:', data);
      
      if (data.error) {
        throw new Error(data.error);
      }
      if (data.warning) {
        setGenerationNotice(data.warning);
      }
      if (data.name) setName(fixName(data.name));
      if (data.medium) setMedium(data.medium);
      if (data.description) setDescription(data.description);
      if (data.projects?.length) {
        setProjects(data.projects.map(p => ({
          id: newId(),
          title: p.title || '',
          desc: p.desc || '',
          link: p.link || '',
          media: null,
        })));
      }
      if (data.contact) {
        setContact({
          linkedin: data.contact.linkedin || '',
          github: data.contact.github || '',
          whatsapp: data.contact.whatsapp || data.contact.phone || '',
          email: data.contact.email || '',
          address: data.contact.address || '',
          links: [
            data.contact.linkedin ? { id: newId(), label: 'LinkedIn', url: data.contact.linkedin } : null,
            data.contact.github ? { id: newId(), label: 'GitHub', url: data.contact.github } : null,
          ].filter(Boolean),
        });
      }
      if (data.skills?.length) setSkills(data.skills.filter(s => s && s !== 'null'));
      if (data.customSections?.length) {
        setCustomSections(data.customSections.map(s => ({
          id: newId(),
          name: s.name,
          items: (s.items || []).map(it => ({
            id: newId(),
            heading: it.heading || '',
            desc: it.desc || ''
          }))
        })));
      }
      setCvFilled(true);
      setActiveTab("cv");
      setGenerationNotice('CV details were auto-filled. Review is hidden in Upload CV mode; click Generate My Portfolio or switch to Fill Manually to edit.');
    } catch (err) {
      console.error('CV parsing error:', err);
      const message = err?.message === 'Failed to fetch'
        ? 'Could not connect to the MuseForge backend. Make sure node server.js is running on port 5000, then try again.'
        : err.message;
      alert(`CV parsing failed: ${message}\n\nPlease try again or fill manually.`);
    } finally {
      setCvLoading(false);
    }
  };

  const handleCreatorTypeSelect = (typeKey) => {
    if (selectedCreatorType) saveCurrentDraft(selectedCreatorType);
    const targetDraft = creatorDrafts[typeKey] || emptyDraftFor(typeKey);
    setSelectedCreatorType(typeKey);
    applyDraft(targetDraft);
    setShowLanding(false);
    requestAnimationFrame(() => window.scrollTo({ top: 0, left: 0, behavior: "auto" }));
  };

  const addProject = () => {
    const id = newId();
    setProjects([...projects, { id, title: "", desc: "", link: "", media: null }]);
    setEditingProject(id);
  };
  const updateProject = (id, f, v) => setProjects(projects.map(p => p.id === id ? { ...p, [f]: v } : p));
  const deleteProject = (id) => { setProjects(projects.filter(p => p.id !== id)); if (editingProject === id) setEditingProject(null); };

  const addSuggestedProject = (suggestion) => {
    const id = newId();
    setProjects([...projects, {
      id,
      title: String(suggestion?.title || 'Suggested project').trim(),
      desc: String(suggestion?.desc || '').trim(),
      link: '',
      media: null,
    }]);
    setEditingProject(id);
    setProjectSuggestions(prev => prev.filter(item => item.id !== suggestion?.id));
  };

  const dismissProjectSuggestion = (id) => {
    setProjectSuggestions(prev => prev.filter(item => item.id !== id));
  };

  const clearProjectSuggestions = () => {
    setProjectSuggestions([]);
    setSuggestionError('');
  };

  const suggestProjects = async () => {
    setSuggestionLoading(true);
    setSuggestionError('');
    try {
      const response = await fetchFromBackend('/suggest-projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          medium,
          description,
          projects: projects.map(project => ({ title: project.title, desc: project.desc })),
          targetLanguage: portfolioLanguage,
          aiTone,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Could not generate project suggestions.');
      setProjectSuggestions(Array.isArray(data.suggestions) ? data.suggestions.slice(0, 3) : []);
    } catch (error) {
      setSuggestionError(error?.message || 'Could not generate project suggestions.');
    } finally {
      setSuggestionLoading(false);
    }
  };

  const savePortfolioVersion = (label, content, lang = portfolioLanguage, snapshot = {}) => {
    const body = String(content || '').trim();
    if (!body) return;
    const normalizedSnapshot = snapshot.localizedOutput || localizedOutput || null;
    const version = {
      id: newId(),
      label,
      language: lang,
      createdAt: new Date().toISOString(),
      content: body,
      localizedOutput: normalizedSnapshot,
      projects: snapshot.projects || projects,
      customSections: snapshot.customSections || customSections,
      skills: snapshot.skills || skills,
      contact: snapshot.contact || contact,
      exportSettings: snapshot.exportSettings || exportSettings || DEFAULT_EXPORT_SETTINGS,
      imagePreview: snapshot.imagePreview || imagePreview,
      imagePosition: snapshot.imagePosition || imagePosition,
      projectCount: (snapshot.projects || projects).filter(project => String(project.title || '').trim()).length,
    };
    setPortfolioVersions(prev => [version, ...prev].slice(0, 3));
  };

  const restorePortfolioVersion = (version) => {
    if (!version) return;
    const restoredLanguage = version.language || portfolioLanguage;
    const restoredProjects = Array.isArray(version.projects) ? version.projects : projects;
    const restoredSections = Array.isArray(version.customSections) ? version.customSections : customSections;
    const restoredSkills = Array.isArray(version.skills) ? version.skills : skills;
    const restoredContact = version.contact ? normalizeContact(version.contact) : contact;
    const restoredExportSettings = version.exportSettings || DEFAULT_EXPORT_SETTINGS;
    const restoredImagePreview = Object.prototype.hasOwnProperty.call(version, 'imagePreview') ? version.imagePreview : imagePreview;
    const restoredImagePosition = version.imagePosition || imagePosition;
    const restoredLocalized = normalizeLocalizedOutput(version.localizedOutput || {}, {
      language: restoredLanguage,
      name,
      medium,
      description,
      projects: restoredProjects,
      customSections: restoredSections,
      skills: restoredSkills,
    });
    setPortfolio(version.content || '');
    setPortfolioLanguage(restoredLanguage);
    setLocalizedOutput(restoredLocalized);
    setProjects(restoredProjects);
    setCustomSections(restoredSections);
    setSkills(restoredSkills);
    setContact(restoredContact);
    setExportSettings(restoredExportSettings);
    setImagePreview(restoredImagePreview || null);
    setImagePosition(restoredImagePosition || { x: 50, y: 50 });
    setFactLockReviews([]);
    setShareUrl('');
    setShareStatus('');
    setActiveTab('manual');
    setPortfolioReady(Boolean(version.content));
    setGenerationNotice('Version restored. You can export, copy, or create a share link from this restored version.');
    setTimeout(() => document.querySelector('.result')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  };

  const downloadPortfolioVersion = (version) => {
    if (!version) return;

    restorePortfolioVersion(version);

    setTimeout(() => {
      exportPortfolio();
    }, 250);
  };

  const renderVersionHistoryPanel = (compact = false) => {
    if (!portfolioVersions.length) return null;
    return (
      <div className={`version-history-panel ${compact ? 'version-history-panel-form' : ''}`}>
        <h3>Version History</h3>
        <p>Last 3 generated portfolios are saved in this session.</p>
        <div className="version-history-list">
          {portfolioVersions.slice(0, 3).map((version, index) => (
            <div className="version-history-item" key={version.id}>
              <div className="version-history-meta">
                <strong>{index + 1}. {version.label}</strong>
                <span>{new Date(version.createdAt).toLocaleString()} · {version.language} · {version.projectCount} project{version.projectCount === 1 ? '' : 's'}</span>
              </div>
              <div className="version-history-actions">
                <button type="button" onClick={() => restorePortfolioVersion(version)}>Restore</button>
                <button type="button" onClick={() => downloadPortfolioVersion(version)}>Restore & Download HTML</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const buildLinkedInExportText = () => {
    const projectLines = projects
      .filter(project => String(project.title || '').trim())
      .slice(0, 5)
      .map(project => `• ${project.title}${project.desc ? ` — ${project.desc}` : ''}`)
      .join('\n');
    return [
      `${name || 'My Portfolio'} — ${medium || 'Creator Portfolio'}`,
      description,
      projectLines ? `\nSelected work:\n${projectLines}` : '',
      shareUrl ? `\nPortfolio link: ${shareUrl}` : '',
      '\nBuilt with MuseForge.'
    ].filter(Boolean).join('\n');
  };

  const _copyLinkedInExport = async () => {
    const text = buildLinkedInExportText();
    await navigator.clipboard.writeText(text);
    setLinkedinCopied(true);
    setTimeout(() => setLinkedinCopied(false), 2000);
  };

  const handleProjectMedia = (projectId, e, forcedType = null) => {
    const file = e.target.files[0];
    if (!file) return;
    const detectedType = file.type.startsWith('audio')
      ? 'audio'
      : file.type.startsWith('video')
        ? 'video'
        : 'image';
    const type = forcedType || detectedType;
    const reader = new FileReader();
    reader.onload = (ev) => updateProject(projectId, 'media', { type, src: ev.target.result, name: file.name });
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const addCustomSection = () => {
    if (!newSectionName.trim()) return;
    const id = newId();
    setCustomSections([...customSections, { id, name: newSectionName.trim(), items: [] }]);
    setNewSectionName(""); setAddingSectionName(false);
    setAddingItemTo(id);
  };
  const deleteSection = (id) => {
    setCustomSections(customSections.filter(s => s.id !== id));
    if (addingItemTo === id) setAddingItemTo(null);
  };
  const addItemToSection = (sectionId, heading, desc, link = '', media = null) => {
    const itemId = newId();
    setCustomSections(customSections.map(s =>
      s.id === sectionId
        ? { ...s, items: [...(s.items || []), { id: itemId, heading: heading.trim(), desc: desc.trim(), link: link.trim(), media }] }
        : s
    ));
  };
  const updateSectionItem = (sectionId, itemId, field, value) => {
    setCustomSections(customSections.map(s =>
      s.id === sectionId
        ? { ...s, items: s.items.map(it => it.id === itemId ? { ...it, [field]: value } : it) }
        : s
    ));
  };
  const handleCustomSectionMedia = (sectionId, itemId, e, forcedType = null) => {
    const file = e.target.files[0];
    if (!file) return;
    const detectedType = file.type.startsWith('audio') ? 'audio' : file.type.startsWith('video') ? 'video' : 'image';
    const type = forcedType || detectedType;
    const reader = new FileReader();
    reader.onload = (ev) => updateSectionItem(sectionId, itemId, 'media', { type, src: ev.target.result, name: file.name });
    reader.readAsDataURL(file);
    e.target.value = '';
  };
  const handleNewItemMedia = (e, forcedType = null) => {
    const file = e.target.files[0];
    if (!file) return;
    const detectedType = file.type.startsWith('audio') ? 'audio' : file.type.startsWith('video') ? 'video' : 'image';
    const type = forcedType || detectedType;
    const reader = new FileReader();
    reader.onload = (ev) => setNewItemMedia({ type, src: ev.target.result, name: file.name });
    reader.readAsDataURL(file);
    e.target.value = '';
  };
  const deleteSectionItem = (sectionId, itemId) => {
    setCustomSections(customSections.map(s =>
      s.id === sectionId ? { ...s, items: s.items.filter(it => it.id !== itemId) } : s
    ));
    if (editingSectionItem?.sectionId === sectionId && editingSectionItem?.itemId === itemId)
      setEditingSectionItem(null);
  };


  const addContactLink = () => {
    const safe = normalizeContact(contact);
    setContact({ ...safe, links: [...safe.links, { id: newId(), label: '', url: '' }] });
  };

  const updateContactLink = (id, field, value) => {
    const safe = normalizeContact(contact);
    setContact({
      ...safe,
      links: safe.links.map(link => String(link.id) === String(id) ? { ...link, [field]: value } : link),
    });
  };

  const deleteContactLink = (id) => {
    const safe = normalizeContact(contact);
    setContact({ ...safe, links: safe.links.filter(link => String(link.id) !== String(id)) });
  };

  const generate = async () => {
    if (!name || !medium || !description) {
      alert("Please fill all fields");
      return;
    }
    setLoading(true);
    setPortfolio("");
    setPortfolioReady(false);
    setGenerationNotice("");
    setFactLockReviews([]);
    setLocalizedOutput(null);
    setShareUrl('');
    setShareStatus('');
    try {
      const projectPayload = projects
        .filter(p => p.title.trim())
        .map(p => ({ id: p.id, title: p.title, desc: p.desc || '', link: p.link || '' }));
      const projectList = projectPayload
        .map(p => `- ${p.title}${p.desc ? ': ' + p.desc : ''}`)
        .join('\n');
      const lightweightCustomSections = customSections.map(section => ({
        id: section.id,
        name: section.name,
        items: (section.items || []).map(item => ({
          id: item.id,
          heading: item.heading || '',
          desc: item.desc || '',
          link: item.link || '',
        })),
      }));
      const shouldEnhanceProjects = !(selectedCreatorType === 'developer' && cvFilled);
      
      const res = await fetchFromBackend('/generate', {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          medium,
          description,
          projectList,
          projects: projectPayload,
          customSections: lightweightCustomSections,
          skills,
          contact,
          creatorType: selectedCreatorType,
          enhanceProjectDescriptions: shouldEnhanceProjects,
          targetLanguage: portfolioLanguage,
          aiTone,
        }),
      });
      
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(errorData.error || `HTTP ${res.status}: ${res.statusText}`);
      }
      
      const data = await res.json();
      setGenerationNotice(data.warning || '');
      const fallbackLocalized = normalizeLocalizedOutput({}, { language: portfolioLanguage, name, medium, projects, customSections, skills });
      const normalizedLocalized = normalizeLocalizedOutput(data.localizedOutput || {}, fallbackLocalized);
      setLocalizedOutput(normalizedLocalized);
      
      if (data.error) {
        throw new Error(data.error);
      }
      
      if (data.portfolio) {
        const projectReviews = Array.isArray(data.enhancedProjects)
          ? data.enhancedProjects
              .filter(item => item && String(item.desc || '').trim())
              .map((item, index) => {
                const originalProject = projects.find(p => String(p.id) === String(item.id)) || projects[index] || {};
                return {
                  id: String(originalProject.id || item.id),
                  title: String((normalizedLocalized.projects || []).find(project => String(project.id) === String(originalProject.id || item.id))?.title || item.title || originalProject.title || 'Project'),
                  originalDesc: String(item.originalDesc || originalProject.desc || ''),
                  enhancedDesc: String(item.desc || '').trim(),
                  factsPreserved: Array.isArray(item.factsPreserved) ? item.factsPreserved : [],
                  unsupportedNewFacts: Array.isArray(item.unsupportedNewFacts) ? item.unsupportedNewFacts : [],
                  status: 'pending',
                };
              })
          : [];
        const sectionReviews = Array.isArray(data.enhancedCustomSections)
          ? data.enhancedCustomSections.flatMap(section => (section.items || [])
              .filter(item => item && String(item.desc || '').trim())
              .map(item => ({
                id: String(item.reviewId || `section:${section.id}:${item.id}`),
                title: (() => {
                  const localizedSection = (normalizedLocalized.customSections || []).find(localSection => String(localSection.id) === String(section.id));
                  const localizedItem = localizedSection?.items?.find(localItem => String(localItem.id) === String(item.id));
                  return `${localizedSection?.name || section.name || 'Section'} — ${localizedItem?.heading || item.heading || 'Entry'}`;
                })(),
                originalDesc: String(item.originalDesc || customSections.find(s => String(s.id) === String(section.id))?.items?.find(it => String(it.id) === String(item.id))?.desc || ''),
                enhancedDesc: String(item.desc || '').trim(),
                factsPreserved: Array.isArray(item.factsPreserved) ? item.factsPreserved : [],
                unsupportedNewFacts: Array.isArray(item.unsupportedNewFacts) ? item.unsupportedNewFacts : [],
                status: 'pending',
              })))
          : [];
        const metaReviews = [];
        const reviewLabels = applyCreatorHeadingLabels(normalizedLocalized.labels || getPortfolioLabels(portfolioLanguage), portfolioLanguage, selectedCreatorType, CREATOR_TYPES[selectedCreatorType]?.label || '');
        if (shouldEnhanceProjects && String(normalizedLocalized.bio || '').trim()) {
          metaReviews.push({
            id: 'meta:bio',
            title: `${reviewLabels.artistBio || reviewLabels.about || 'Bio'} — portfolio intro`,
            originalDesc: String(description || ''),
            enhancedDesc: String(normalizedLocalized.bio || '').trim(),
            factsPreserved: [name, medium].filter(Boolean),
            unsupportedNewFacts: [],
            status: 'pending',
          });
        }
        if (shouldEnhanceProjects && String(normalizedLocalized.artistStatement || '').trim()) {
          metaReviews.push({
            id: 'meta:statement',
            title: `${reviewLabels.artistStatement || reviewLabels.statement || 'Statement'} — portfolio voice`,
            originalDesc: String(description || ''),
            enhancedDesc: String(normalizedLocalized.artistStatement || '').trim(),
            factsPreserved: [name, medium].filter(Boolean),
            unsupportedNewFacts: [],
            status: 'pending',
          });
        }
        const reviews = [...metaReviews, ...projectReviews, ...sectionReviews];
        if (reviews.length) {
          setFactLockReviews(reviews);
          setPortfolio('');
          setPortfolioReady(false);
          setGenerationNotice('Review each AI enhancement, choose Accept / Keep edited / Keep original, then click Generate Portfolio.');
        } else {
          setFactLockReviews([]);
          setPortfolio(data.portfolio);
          setPortfolioReady(true);
          savePortfolioVersion('Generated portfolio', data.portfolio, portfolioLanguage, { localizedOutput: normalizedLocalized, projects, customSections, skills, contact, exportSettings, imagePreview, imagePosition });
          setGenerationNotice(data.warning || '');
        }
      } else {
        throw new Error('No portfolio content received');
      }
    } catch (err) {
      console.error('Portfolio generation error:', err);
      setPortfolio("");
      setPortfolioReady(false);
      setGenerationNotice(`Portfolio generation could not connect to the backend: ${err.message}`);
    }
    setLoading(false);
  };

  const applyFactLockDescription = (id, value, sourceProjects = projects, sourceSections = customSections) => {
    const target = factLockTarget(id);
    if (target.type === 'meta') {
      return { projects: sourceProjects, customSections: sourceSections, meta: { [target.field]: value } };
    }
    if (target.type === 'section') {
      return {
        projects: sourceProjects,
        customSections: sourceSections.map(section => String(section.id) === String(target.sectionId)
          ? { ...section, items: (section.items || []).map(item => String(item.id) === String(target.itemId) ? { ...item, desc: value } : item) }
          : section
        ),
      };
    }
    return {
      projects: sourceProjects.map(project => String(project.id) === String(target.projectId) ? { ...project, desc: value } : project),
      customSections: sourceSections,
    };
  };

  const commitFactLockChoice = (id, status, value) => {
    const nextContent = applyFactLockDescription(id, value);
    setProjects(nextContent.projects);
    setCustomSections(nextContent.customSections);
    if (nextContent.meta) {
      setLocalizedOutput(prev => ({
        ...(prev || {}),
        ...(nextContent.meta.bio ? { bio: nextContent.meta.bio } : {}),
        ...(nextContent.meta.statement ? { artistStatement: nextContent.meta.statement } : {}),
      }));
    }
    setFactLockReviews(prev => prev.map(item => String(item.id) === String(id) ? { ...item, status } : item));
    setPortfolio('');
    setPortfolioReady(false);
    setShareUrl('');
    setShareStatus('');
  };

  const updateFactLockReview = (id, value) => {
    setFactLockReviews(prev => prev.map(item => String(item.id) === String(id)
      ? { ...item, enhancedDesc: value, status: isFactLockResolved(item) ? 'edited' : 'edited draft' }
      : item
    ));
    setPortfolio('');
    setPortfolioReady(false);
  };

  const regenerateFactLockReview = async (id) => {
    const review = factLockReviews.find(item => String(item.id) === String(id));
    if (!review || regeneratingFactLockId) return;
    setRegeneratingFactLockId(String(id));
    setGenerationNotice('Regenerating this FactLock item only...');
    try {
      const response = await fetchFromBackend('/factlock/regenerate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: review.id,
          title: review.title,
          originalDesc: review.originalDesc,
          targetLanguage: portfolioLanguage,
          creatorType: selectedCreatorType || 'creator',
          medium,
          aiTone,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Could not regenerate this item.');
      const regeneratedDesc = safeClientLocalized(data.enhancedDesc || data.desc || '', review.originalDesc || '', portfolioLanguage, 'project');
      setFactLockReviews(prev => prev.map(item => String(item.id) === String(id)
        ? {
            ...item,
            enhancedDesc: regeneratedDesc || frontendGenericLocalized(portfolioLanguage, 'project') || item.enhancedDesc,
            factsPreserved: Array.isArray(data.factsPreserved) ? data.factsPreserved : item.factsPreserved,
            unsupportedNewFacts: Array.isArray(data.unsupportedNewFacts) ? data.unsupportedNewFacts : item.unsupportedNewFacts,
            status: 'pending',
          }
        : item
      ));
      setPortfolio('');
      setPortfolioReady(false);
      setGenerationNotice('This FactLock item was regenerated. Review it and choose an action.');
    } catch (error) {
      setGenerationNotice(error?.message || 'Could not regenerate this FactLock item.');
    } finally {
      setRegeneratingFactLockId('');
    }
  };

  const acceptFactLockReview = (id) => {
    const review = factLockReviews.find(item => String(item.id) === String(id));
    if (!review) return;
    commitFactLockChoice(id, 'accepted', review.enhancedDesc);
  };

  const keepOriginalFactLock = (id) => {
    const review = factLockReviews.find(item => String(item.id) === String(id));
    if (!review) return;
    commitFactLockChoice(id, 'original kept', review.originalDesc);
  };

  const keepEditedFactLock = (id) => {
    const review = factLockReviews.find(item => String(item.id) === String(id));
    if (!review) return;
    commitFactLockChoice(id, 'edited', review.enhancedDesc);
  };

  const applyAllReviewChoices = () => {
    let reviewedProjects = projects;
    let reviewedCustomSections = customSections;
    const reviewedMeta = {};
    factLockReviews.forEach(review => {
      if (!isFactLockResolved(review)) return;
      const status = String(review.status || '').toLowerCase();
      const chosen = status === 'original kept' || status === 'kept original' || status === 'original'
        ? review.originalDesc
        : review.enhancedDesc;
      const next = applyFactLockDescription(review.id, chosen, reviewedProjects, reviewedCustomSections);
      reviewedProjects = next.projects;
      reviewedCustomSections = next.customSections;
      if (next.meta) Object.assign(reviewedMeta, next.meta);
    });
    return { reviewedProjects, reviewedCustomSections, reviewedMeta };
  };

  const finalizeReviewedPortfolio = async () => {
    const unresolved = factLockReviews.filter(review => !isFactLockResolved(review));
    if (unresolved.length) {
      setGenerationNotice(`Please choose Accept enhanced, Keep edited changes, or Keep original for ${unresolved.length} remaining item${unresolved.length > 1 ? 's' : ''}.`);
      return;
    }
    const { reviewedProjects, reviewedCustomSections, reviewedMeta } = applyAllReviewChoices();
    setLoading(true);
    setGenerationNotice('Generating final portfolio from your reviewed choices...');
    setShareUrl('');
    setShareStatus('');
    try {
      const finalProjectPayload = reviewedProjects
        .filter(p => String(p.title || '').trim())
        .map(p => ({ id: p.id, title: p.title, desc: p.desc || '', link: p.link || '' }));
      const finalProjectList = finalProjectPayload
        .map(p => `- ${p.title}${p.desc ? ': ' + p.desc : ''}`)
        .join('\n');
      const finalCustomSections = reviewedCustomSections.map(section => ({
        id: section.id,
        name: section.name,
        items: (section.items || []).map(item => ({
          id: item.id,
          heading: item.heading || '',
          desc: item.desc || '',
          link: item.link || '',
        })),
      }));
      const response = await fetchFromBackend('/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          medium,
          description,
          projectList: finalProjectList,
          projects: finalProjectPayload,
          customSections: finalCustomSections,
          skills,
          contact,
          creatorType: selectedCreatorType,
          enhanceProjectDescriptions: false,
          targetLanguage: portfolioLanguage,
          aiTone,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Final portfolio generation failed.');
      const fallbackLocalized = normalizeLocalizedOutput({}, { language: portfolioLanguage, name, medium, projects: reviewedProjects, customSections: reviewedCustomSections, skills });
      const finalLocalizedBase = normalizeLocalizedOutput(data.localizedOutput || {}, fallbackLocalized);
      const finalLocalized = {
        ...finalLocalizedBase,
        ...(reviewedMeta.bio ? { bio: reviewedMeta.bio } : {}),
        ...(reviewedMeta.statement ? { artistStatement: reviewedMeta.statement } : {}),
      };
      setProjects(reviewedProjects);
      setCustomSections(reviewedCustomSections);
      setLocalizedOutput(finalLocalized);
      const finalPortfolioText = `## ${getBioHeading(selectedCreatorType, CREATOR_TYPES[selectedCreatorType]?.label || '')}
      ${finalLocalized.bio || ''}

## ${getStatementHeading(selectedCreatorType, CREATOR_TYPES[selectedCreatorType]?.label || '')}
${finalLocalized.artistStatement || ''}`.trim();

setPortfolio(finalPortfolioText || data.portfolio || '');
setPortfolioReady(Boolean(finalPortfolioText || data.portfolio));

if (finalPortfolioText || data.portfolio) savePortfolioVersion('Reviewed portfolio', finalPortfolioText || data.portfolio, portfolioLanguage, {
        localizedOutput: finalLocalized,
        projects: reviewedProjects,
        customSections: reviewedCustomSections,
        skills,
        contact,
        exportSettings,
        imagePreview,
        imagePosition,
      });
      setGenerationNotice(data.warning || 'Final portfolio generated from reviewed FactLock choices.');
    } catch (error) {
      setGenerationNotice(error?.message || 'Final portfolio generation failed.');
    } finally {
      setLoading(false);
    }
  };

  const getFactLockTrustReport = (shareLinkCreated = Boolean(shareUrl)) => buildFactLockTrustReport({
    factLockReviews,
    portfolioLanguage,
    inputLanguage: detectInputLanguage(
      description,
      projects.map(project => `${project.title || ''} ${project.desc || ''}`),
      customSections.map(section => `${section.name || ''} ${(section.items || []).map(item => `${item.heading || ''} ${item.desc || ''}`).join('\n')}`)
    ),
    shareLinkCreated,
    projects,
    customSections,
  });

  const buildPortfolioSharePayload = (shareLinkCreated = Boolean(shareUrl)) => ({
    name: fixName(name),
    medium,
    localizedName: displayName,
    localizedMedium: displayMedium,
    language: portfolioLanguage,
    inputLanguage: getFactLockTrustReport(shareLinkCreated).inputLanguage,
    portfolio,
    projects,
    customSections,
    imagePreview,
    imagePosition,
    contact: normalizeContact(contact),
    skills,
    factLockReviews,
    localizedOutput: normalizeLocalizedOutput(localizedOutput || {}, { language: portfolioLanguage, name: displayName, medium: displayMedium, projects, customSections, skills }),
    trustReport: getFactLockTrustReport(shareLinkCreated),
    createdBy: authUser?.name || '',
  });

  const featuredReviews = reviews.slice(0, 3);
  const averageRating = reviews.length ? reviews.reduce((sum, item) => sum + (Number(item.rating) || 0), 0) / reviews.length : 0;

  const openReviewModal = (context = 'manual') => {
    setPendingReviewAction(context);
    setReviewRating(0);
    setReviewText('');
    setReviewError('');
    setReviewSuccess('');
    setShowReviewModal(true);
  };

  const afterReviewGateAction = (action = pendingReviewAction) => {
    if (action === 'export') {
      setShowExportCustomizer(true);
    }
    setPendingReviewAction(null);
  };

  const closeReviewModal = () => {
    setShowReviewModal(false);
    setReviewError('');
    setReviewSuccess('');
    if (typeof window !== 'undefined' && pendingReviewAction === 'export') window.sessionStorage.setItem(REVIEW_SESSION_SKIPPED, 'true');
    afterReviewGateAction();
  };

  const submitReview = async () => {
    const trimmedReview = reviewText.trim();
    if (!reviewRating) {
      setReviewError('Please select a star rating.');
      return;
    }
    if (trimmedReview.length < 5) {
      setReviewError('Please write at least 5 characters.');
      return;
    }
    setReviewSubmitting(true);
    setReviewError('');
    try {
      const response = await fetchFromBackend('/reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: authUser?.name || name || 'MuseForge Creator',
          email: authUser?.email || contact.email || '',
          rating: reviewRating,
          review: trimmedReview,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Could not submit review.');
      const savedReview = data.review || { id: `local-${Date.now()}`, name: authUser?.name || name || 'MuseForge Creator', rating: reviewRating, review: trimmedReview, created_at: new Date().toISOString() };
      setReviews(prev => [savedReview, ...prev.filter(item => String(item.id) !== String(savedReview.id))]);
      if (typeof window !== 'undefined') {
        window.sessionStorage.setItem(REVIEW_SESSION_SUBMITTED, 'true');
        window.localStorage.setItem(`museforge_reviewed_${authUser?.email || contact.email || 'guest'}`, 'true');
        window.sessionStorage.removeItem(REVIEW_SESSION_SKIPPED);
      }
      setReviewSuccess('Thank you — your review has been saved.');
      window.setTimeout(() => {
        setShowReviewModal(false);
        afterReviewGateAction();
      }, 650);
    } catch (error) {
      const networkError = error?.message === 'Failed to fetch' || /backend|server|connect/i.test(error?.message || '');
      if (networkError) {
        const localReview = { id: `local-${Date.now()}`, name: authUser?.name || name || 'MuseForge Creator', rating: reviewRating, review: trimmedReview, created_at: new Date().toISOString(), localOnly: true };
        setReviews(prev => {
          const next = [localReview, ...prev];
          cacheReviews(next);
          return next;
        });
        if (typeof window !== 'undefined') { window.sessionStorage.setItem(REVIEW_SESSION_SUBMITTED, 'true'); window.localStorage.setItem(`museforge_reviewed_${authUser?.email || contact.email || 'guest'}`, 'true'); }
        setReviewSuccess('Backend was not reachable, so this review was saved in this browser. Start the backend to save reviews globally.');
        window.setTimeout(() => {
          setShowReviewModal(false);
          afterReviewGateAction();
        }, 900);
      } else {
        setReviewError(error?.message || 'Could not submit review.');
      }
    } finally {
      setReviewSubmitting(false);
    }
  };

  const exportPortfolio = () => {
    if (!portfolioReady) {
      setGenerationNotice('Generate the final reviewed portfolio before exporting HTML.');
      return;
    }
    setShowExportCustomizer(true);
  };

  const updateExportSetting = (key, value) => {
    setExportSettings(prev => ({ ...prev, [key]: value }));
  };

  const resetExportSettings = () => setExportSettings(DEFAULT_EXPORT_SETTINGS);

  const generateExportWithSettings = () => {
    setShowExportCustomizer(false);
    performExportPortfolio(exportSettings);
  };

  const publishPortfolio = async () => {
    if (!portfolio || !portfolioReady) {
      setShareStatus('Generate the final reviewed portfolio before creating a share link.');
      return;
    }
    setShareStatus('Creating share link...');
    try {
      const response = await fetchFromBackend('/portfolio/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildPortfolioSharePayload(true)),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Could not publish this portfolio.');
      const finalUrl = data.publicPath ? `${window.location.origin}${data.publicPath}` : (data.publicUrl || '');
      setShareUrl(finalUrl);
      setShareStatus(portfolioLanguage === 'Arabic' ? 'تم إنشاء رابط المشاركة.' : portfolioLanguage === 'Urdu' ? 'شیئر لنک بن گیا۔' : 'Public share link created.');
      if (finalUrl && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(finalUrl).catch(() => undefined);
      }
    } catch (error) {
      setShareStatus(error?.message === 'Failed to fetch'
        ? 'Could not connect to the backend to create a share link.'
        : (error?.message || 'Could not create a share link.'));
    }
  };

  const performExportPortfolio = (customOptions = exportSettings) => {
    if (!portfolioReady) {
      setGenerationNotice('Generate the final reviewed portfolio before exporting HTML.');
      return;
    }
    const cleanName = fixName(name);
    const exportName = displayName || cleanName;
    const exportMedium = displayMedium || medium;
    const exportLabels = applyCreatorHeadingLabels((localizedOutput?.labels) || getPortfolioLabels(portfolioLanguage), portfolioLanguage, selectedCreatorType, CREATOR_TYPES[selectedCreatorType]?.label || '');
    const exportProjects = displayProjects;
    const exportCustomSections = displayCustomSections;
    const exportSkills = displaySkills;
    const exportContactLinks = getContactLinks(contact);
    const htmlLang = languageToHtmlLang(portfolioLanguage);
    const htmlDir = languageDirection(portfolioLanguage);
    const exportTheme = buildExportTheme(customOptions);

    const projectsHTML = exportProjects.filter(p => p.title.trim()).map((p, i) => {
      const titleEl = p.link
        ? `<a href="${p.link}" target="_blank" rel="noopener noreferrer" class="project-link"><strong class="project-title">${p.title}</strong></a>`
        : `<strong class="project-title">${p.title}</strong>`;
      let mediaEl = '';
      if (p.media) {
        mediaEl = p.media.type === 'image'
          ? `<div class="project-media"><img src="${p.media.src}" alt="${p.title}" class="project-media-img"/></div>`
          : p.media.type === 'video'
            ? `<div class="project-media"><video controls class="project-media-video"><source src="${p.media.src}"/></video></div>`
            : `<div class="project-media"><audio controls class="project-media-audio"><source src="${p.media.src}"/></audio></div>`;
      }
      return `<div class="project-card">
        <div class="project-number">${i + 1}</div>
        <div class="project-content">
          <div class="project-title-row">${titleEl}</div>
          ${p.desc ? `<div class="project-desc">${p.desc}</div>` : ''}
          ${mediaEl}
        </div>
      </div>`;
    }).join('\n');

    const skillsByCategory = { 'LANGUAGES': [], 'WEB & BACKEND': [], 'AI / ML': [], 'CLOUD & TOOLS': [] };
    exportSkills.forEach(s => {
      if (/\b(react|node\.?js|express\.?js|vue|angular|mongodb|postgresql|mysql|firebase|django|flask|spring|next\.?js|nuxt)\b/i.test(s)) skillsByCategory['WEB & BACKEND'].push(s);
      else if (/\b(tensorflow|pytorch|scikit|keras|nlp|pandas|numpy|librosa|opencv|hugging|bert|transformers)\b/i.test(s)) skillsByCategory['AI / ML'].push(s);
      else if (/python|javascript|typescript|\bjava\b|c\+\+|\bsql\b|html|css|assembly|pl\/sql|ruby|swift|kotlin|\bgo\b|rust|php/i.test(s)) skillsByCategory['LANGUAGES'].push(s);
      else skillsByCategory['CLOUD & TOOLS'].push(s);
    });

    const skillsHTML = exportSkills.length ? `<div class="section" id="skills-section">
      <h2 class="section-title">${exportLabels.technicalSkills}</h2>
      <div class="skills-grid">
        ${Object.entries(skillsByCategory).filter(([, v]) => v.length).map(([cat, items]) => `
          <div class="skill-category">
            <div class="skill-category-title">● ${cat}</div>
            <div class="skill-items">${items.map(s => `<span class="skill-tag">${s}</span>`).join('\n')}</div>
          </div>`).join('\n')}
      </div>
    </div>` : '';

    const contactHTML = (exportContactLinks.length || contact.email || contact.whatsapp || contact.address) ? `
      <div class="section" id="contact-section">
        <h2 class="section-title">${exportLabels.contact}</h2>
        <div class="contact-grid">
          ${contact.email ? `<div class="contact-item"><div class="contact-label">${exportLabels.email}</div><div class="contact-value">${contact.email}</div></div>` : ''}
          ${contact.whatsapp ? `<div class="contact-item"><div class="contact-label">${exportLabels.phone}</div><div class="contact-value">${contact.whatsapp}</div></div>` : ''}
          ${exportContactLinks.map(link => `<div class="contact-item"><div class="contact-label">${link.label}</div><div class="contact-value"><a href="${link.url}" target="_blank" class="contact-link">${link.url.split('/').filter(Boolean).pop() || link.url}</a></div></div>`).join('\n')}
          ${contact.address ? `<div class="contact-item" style="grid-column:1/-1"><div class="contact-label">${exportLabels.location}</div><div class="contact-value">${localizeLocationText(contact.address, portfolioLanguage)}</div></div>` : ''}
        </div>
      </div>` : '';

    const customHTML = exportCustomSections.filter(s => s.items && s.items.length > 0).map(s => `
      <div class="section" id="custom-${s.id}">
        <h2 class="section-title">${s.name}</h2>
        <div class="custom-items">
          ${s.items.map(it => {
            const mediaEl = it.media
              ? it.media.type === 'image'
                ? `<div class="project-media"><img src="${it.media.src}" alt="${it.heading || s.name}" class="project-media-img"/></div>`
                : it.media.type === 'video'
                  ? `<div class="project-media"><video controls class="project-media-video"><source src="${it.media.src}"/></video></div>`
                  : `<div class="project-media"><audio controls class="project-media-audio"><source src="${it.media.src}"/></audio></div>`
              : '';
            return `
            <div class="custom-item">
              ${it.heading ? `<div class="custom-item-heading">${it.heading}</div>` : ''}
              ${it.desc ? `<div class="custom-item-desc">${it.desc}</div>` : ''}
              ${it.link ? `<a href="${it.link}" target="_blank" rel="noopener noreferrer" class="project-link">${it.link}</a>` : ''}
              ${mediaEl}
            </div>`;
          }).join('\n')}
        </div>
      </div>`).join('\n');

    const aboutText = String(displayBio || '').trim();
    const stmtText = String(displayStatement || '').trim();

    const navLinks = [
      aboutText && { label: exportLabels.artistBio || exportLabels.about || 'Bio', id: 'about-section' },
      stmtText && { label: exportLabels.artistStatement || exportLabels.statement || 'Statement', id: 'statement-section' },
      projectsHTML && { label: exportLabels.projects, id: 'projects-section' },
      skillsHTML && { label: exportLabels.skills, id: 'skills-section' },
      ...exportCustomSections.filter(s => s.items?.length > 0).map(s => ({ label: s.name, id: `custom-${s.id}` })),
      (exportContactLinks.length || contact.email || contact.whatsapp || contact.address) && { label: exportLabels.contact, id: 'contact-section' },
    ].filter(Boolean);

    const circleImageHTML = imagePreview
      ? `<div class="hero-img-circle"><img src="${imagePreview}" class="hero-img" alt="Portfolio" style="object-position:${imagePosition.x}% ${imagePosition.y}%"/></div>`
      : '';

    const html = `<!DOCTYPE html>
<html lang="${htmlLang}" dir="${htmlDir}" translate="no">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Language" content="${htmlLang}">
  <title>${cleanName} — Portfolio</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;700&family=Inter:wght@300;400;500&display=swap');
    :root { --mf-heading: ${exportTheme.headingColor}; --mf-subheading: ${exportTheme.subheadingColor}; --mf-body: ${exportTheme.bodyColor}; --mf-body-font: ${exportTheme.bodyFont}; --mf-heading-font: ${exportTheme.headingFont}; --mf-bg: ${exportTheme.background}; --mf-hero: ${exportTheme.heroBackground}; --mf-card: ${exportTheme.cardBackground}; --mf-border: ${exportTheme.cardBorder}; --mf-nav: ${exportTheme.navBackground}; --mf-footer: ${exportTheme.footerBackground}; --mf-title: ${exportTheme.titleColor}; --mf-muted: ${exportTheme.mutedColor}; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: var(--mf-body-font); background: var(--mf-bg); background-attachment: fixed; color: var(--mf-body); min-height: 100vh; }
    .hero-nav-bar {
      width: 100%; background: var(--mf-nav);
      border-bottom: 1px solid var(--mf-border);
      display: flex; justify-content: center; align-items: center; flex-wrap: wrap;
      padding: 14px 40px; gap: 28px;
      position: sticky; top: 0; z-index: 200;
      backdrop-filter: blur(10px);
    }
    .hero-nav-link {
      color: var(--mf-heading); text-decoration: none;
      font-size: 0.76rem; letter-spacing: 2.5px; text-transform: uppercase;
      font-weight: 500; transition: color 0.2s; font-family: 'Inter', sans-serif;
    }
    .hero-nav-link:hover { color: #ec4899; }
    .hero {
      background: var(--mf-hero);
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      text-align: center;
      min-height: 420px; width: 100%; padding: 38px 40px 72px;
      border-bottom: 1px solid var(--mf-border);
    }
    .hero-img-circle {
      width: 220px; height: 220px; border-radius: 50%; overflow: hidden;
      border: 4px solid #a855f7;
      box-shadow: 0 0 40px rgba(168,85,247,0.3);
      margin-bottom: 32px;
    }
    .hero-img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .hero-img-placeholder {
      width: 220px; height: 220px; border-radius: 50%;
      background: var(--mf-card);
      border: 4px solid var(--mf-border); margin-bottom: 32px;
    }
    .hero h1 {
      font-family: var(--mf-heading-font); font-size: 3.05rem;
      background: linear-gradient(135deg, #a855f7, #ec4899);
      -webkit-background-clip: text; -webkit-text-fill-color: transparent;
      margin-bottom: 12px; line-height: 1.1;
    }
    .hero .medium {
      color: var(--mf-subheading); font-size: 0.9rem; letter-spacing: 4px;
      text-transform: uppercase; margin-bottom: 10px; font-family: 'Inter', sans-serif;
    }
    .hero .tagline {
      color: var(--mf-muted); font-size: 0.88rem; font-style: italic; letter-spacing: 1px;
      font-family: 'Inter', sans-serif;
    }
    .hero .tagline::after {
      content: ''; display: block; width: 52px; height: 2px;
      background: linear-gradient(90deg, #a855f7, #ec4899);
      margin: 12px auto 0;
    }
    .content { width: 100%; }
    .section { width: 100%; padding: 55px 80px; border-bottom: 1px solid var(--mf-border); scroll-margin-top: 60px; background: transparent; }
    .section:last-child { border-bottom: none; }
    .section-title {
      font-family: var(--mf-heading-font); font-size: 1.8rem; color: var(--mf-heading);
      margin-bottom: 24px; text-transform: uppercase; letter-spacing: 1px;
      display: flex; align-items: center; gap: 12px;
    }
    .section-title::before { content: '◈'; font-size: 1rem; color: var(--mf-subheading); }
    .section p { color: var(--mf-body); line-height: 1.9; font-size: 1.05rem; margin-bottom: 14px; font-weight: 300; }
    .custom-items { display: flex; flex-direction: column; gap: 14px; }
    .custom-item { background: var(--mf-card); backdrop-filter: blur(10px); border-radius: 14px; padding: 18px 22px; border: 1px solid var(--mf-border); }
    .custom-item-heading { color: var(--mf-title); font-size: 1rem; font-weight: 600; margin-bottom: 4px; font-family: 'Inter', sans-serif; }
    .custom-item-desc { color: var(--mf-muted); font-size: 0.92rem; line-height: 1.7; }
    .projects { display: grid; gap: 18px; }
    .project-card { background: var(--mf-card); backdrop-filter: blur(10px); border: 1px solid var(--mf-border); border-radius: 16px; padding: 24px; display: grid; grid-template-columns: 44px 1fr; gap: 18px; transition: border-color 0.2s, transform .2s ease; }
    .project-card:hover { border-color: var(--mf-heading); transform: translateY(-2px); }
    .project-number { font-family: 'Playfair Display', serif; font-size: 1.6rem; color: var(--mf-subheading); font-weight: 700; display: flex; align-items: flex-start; padding-top: 3px; }
    .project-title-row { margin-bottom: 6px; }
    .project-title { color: var(--mf-title); font-size: 1.1rem; font-weight: 700; font-family: 'Inter', sans-serif; }
    .project-link { text-decoration: none; }
    .project-link:hover .project-title { color: #a855f7; }
    .project-desc { color: var(--mf-body); font-size: 0.95rem; line-height: 1.6; margin-bottom: 10px; }
    .project-media { margin-top: 12px; }
    .project-media-img { max-width: 100%; max-height: 300px; border-radius: 6px; object-fit: cover; border: 1px solid var(--mf-border); }
    .project-media-video { max-width: 100%; max-height: 300px; border-radius: 6px; border: 1px solid var(--mf-border); }
    .project-media-audio { width: min(100%, 460px); }
    .skills-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 24px; }
    .skill-category-title { color: var(--mf-subheading); font-size: 0.78rem; letter-spacing: 2px; text-transform: uppercase; margin-bottom: 10px; font-weight: 600; font-family: 'Inter', sans-serif; }
    .skill-items { display: flex; flex-wrap: wrap; gap: 6px; }
    .skill-tag { background: var(--mf-card); border: 1px solid var(--mf-border); color: var(--mf-body); padding: 5px 10px; font-size: 0.82rem; }
    .skill-tag:hover { border-color: #a855f7; color: #a855f7; }
    .contact-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 18px; }
    .contact-item { background: var(--mf-card); backdrop-filter: blur(10px); border: 1px solid var(--mf-border); border-radius: 16px; padding: 22px; }
    .contact-label { color: var(--mf-subheading); font-size: 0.78rem; letter-spacing: 2px; text-transform: uppercase; margin-bottom: 6px; font-weight: 600; font-family: 'Inter', sans-serif; }
    .contact-value { color: var(--mf-body); font-size: 1rem; }
    .contact-link { color: var(--mf-body); text-decoration: none; font-weight: 500; }
    .contact-link:hover { color: #a855f7; }
    .footer { text-align: center; padding: 36px; border-top: 1px solid #2a1a4e; background: #0f0f1a; font-family: 'Inter', sans-serif; }
    .footer p { color: var(--mf-muted); font-size: 0.85rem; margin-bottom: 10px; }
    .badge { display: inline-block; background: linear-gradient(135deg, #a855f7, #ec4899); border-radius: 20px; padding: 8px 20px; font-size: 0.8rem; color: white; font-weight: 500; }
  </style>
</head>
<body>
  <nav class="hero-nav-bar">
    ${navLinks.map(s => `<a href="#${s.id}" class="hero-nav-link">${s.label}</a>`).join('\n')}
  </nav>
  <div class="hero">
    ${circleImageHTML}
    <h1>${exportName}</h1>
    <div class="medium">${exportMedium}</div>
    <div class="tagline">Creative Portfolio</div>
  </div>
  <div class="content">
    ${aboutText ? `<div class="section" id="about-section"><h2 class="section-title">${exportLabels.artistBio || exportLabels.about || 'Bio'}</h2><p>${aboutText}</p></div>` : ''}
    ${stmtText && stmtText !== aboutText ? `<div class="section" id="statement-section"><h2 class="section-title">${exportLabels.artistStatement || exportLabels.statement || 'Statement'}</h2>${stmtText.split('\n').filter(l => l.trim()).map(l => `<p>${l}</p>`).join('\n')}</div>` : ''}
    ${projectsHTML ? `<div class="section" id="projects-section"><h2 class="section-title">${exportLabels.projects}</h2><div class="projects">${projectsHTML}</div></div>` : ''}
    ${skillsHTML}
    ${customHTML}
    ${contactHTML}
  </div>
  <div class="footer">
    <p>Created with MuseForge</p>
  </div>
  <script>
    document.querySelectorAll('.hero-nav-link').forEach(l => {
      l.addEventListener('click', e => {
        e.preventDefault();
        const target = document.querySelector(l.getAttribute('href'));
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
  </script>
</body>
</html>`;

    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${cleanName}-portfolio.html`; a.click();
  };


  const extractPortfolioSection = (heading = '') => {
    const cleanHeading = String(heading || '').trim();
    if (!cleanHeading || !portfolio) return '';
    const escaped = cleanHeading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = String(portfolio).match(new RegExp(`(?:^|\\n)##\\s+${escaped}\\s*\\n([\\s\\S]*?)(?=\\n##\\s+|$)`, 'i'));
    return match ? match[1].trim() : '';
  };

  const portfolioLabels = applyCreatorHeadingLabels((localizedOutput?.labels) || getPortfolioLabels(portfolioLanguage), portfolioLanguage, selectedCreatorType, CREATOR_TYPES[selectedCreatorType]?.label || '');
  const displayName = pickLocalizedName(localizedOutput?.name, fixName(name), portfolioLanguage);
  const displayMedium = safeClientLocalized(localizedOutput?.medium, medium, portfolioLanguage, 'medium');
  const extractedBio = extractPortfolioSection(getBioHeading(selectedCreatorType, CREATOR_TYPES[selectedCreatorType]?.label || '')) || extractPortfolioSection('Artist Bio') || extractPortfolioSection('Bio');
  const extractedStatement = extractPortfolioSection(getStatementHeading(selectedCreatorType, CREATOR_TYPES[selectedCreatorType]?.label || '')) || extractPortfolioSection('Artist Statement') || extractPortfolioSection('Professional Statement');
  const displayBio = safeClientLocalized(
    localizedOutput?.bio || localizedOutput?.description || extractedBio,
    extractedBio || description,
    portfolioLanguage,
    'description'
  );

  const displayStatementCandidate = safeClientLocalized(
    localizedOutput?.artistStatement || localizedOutput?.statement || extractedStatement,
    extractedStatement,
    portfolioLanguage,
    'description'
  );

  const displayStatement = (
    textKey(displayStatementCandidate) &&
    textKey(displayBio) &&
    textKey(displayStatementCandidate) !== textKey(displayBio)
  )
    ? displayStatementCandidate
    : '';
  const rawDisplayProjects = withOriginalProjectMedia(localizedOutput?.projects, projects);
  const displayProjects = rawDisplayProjects.map((project, index) => {
    const original = projects.find(item => String(item.id) === String(project.id)) || projects[index] || {};
    return {
      ...project,
      title: safeClientLocalized(project.title, original.title || '', portfolioLanguage, 'project') || `${portfolioLabels.projects || 'Project'} ${index + 1}`,
      desc: safeClientLocalized(project.desc, original.desc || '', portfolioLanguage, 'project'),
    };
  });
  const rawDisplayCustomSections = withOriginalCustomSectionAssets(localizedOutput?.customSections, customSections);
  const displayCustomSections = rawDisplayCustomSections.map((section, sectionIndex) => {
    const originalSection = customSections.find(item => String(item.id) === String(section.id)) || customSections[sectionIndex] || {};
    const originalItems = Array.isArray(originalSection.items) ? originalSection.items : [];
    return {
      ...section,
      name: safeClientLocalized(section.name, originalSection.name || '', portfolioLanguage, 'section') || `${frontendGenericLocalized(portfolioLanguage, 'section') || 'Section'} ${sectionIndex + 1}`,
      items: (section.items || []).map((item, itemIndex) => {
        const originalItem = originalItems.find(src => String(src.id) === String(item.id)) || originalItems[itemIndex] || {};
        return {
          ...item,
          heading: safeClientLocalized(item.heading, originalItem.heading || '', portfolioLanguage, 'item') || `${frontendGenericLocalized(portfolioLanguage, 'item') || 'Item'} ${itemIndex + 1}`,
          desc: safeClientLocalized(item.desc, originalItem.desc || '', portfolioLanguage, 'item'),
        };
      }),
    };
  });
  const displaySkills = Array.isArray(localizedOutput?.skills) && localizedOutput.skills.length ? localizedOutput.skills : skills;
  const contactLinks = getContactLinks(contact);
  const buildVisiblePortfolioText = () => {
    const lines = [];
    if (displayName) lines.push(displayName);
    if (displayMedium) lines.push(displayMedium);
    if (displayBio) lines.push(`
${portfolioLabels.artistBio || portfolioLabels.about || 'Bio'}
${displayBio}`);
    if (displayStatement && displayStatement !== displayBio) lines.push(`
${portfolioLabels.artistStatement || portfolioLabels.statement || 'Statement'}
${displayStatement}`);
    const projectLines = displayProjects.filter(p => String(p.title || '').trim()).map(p => `- ${p.title}${p.desc ? `: ${p.desc}` : ''}`);
    if (projectLines.length) lines.push(`
${portfolioLabels.projects || 'Projects'}
${projectLines.join('\n')}`);
    displayCustomSections.filter(s => s.items?.length).forEach(section => {
      lines.push(`
${section.name}
${section.items.map(item => `- ${item.heading}${item.desc ? `: ${item.desc}` : ''}`).join('\n')}`);
    });
    return lines.filter(Boolean).join('\n');
  };
  const hasFactLockReviews = factLockReviews.length > 0;
  const unresolvedFactLockCount = factLockReviews.filter(review => !isFactLockResolved(review)).length;
  const canFinalizeFactLock = hasFactLockReviews && unresolvedFactLockCount === 0 && !portfolioReady;
  const isCvDirectGenerateMode = selectedCreatorType === 'developer' && cvFilled;

  if (publicPortfolioId) {
    return (
      <PublicPortfolioView
        portfolio={publicPortfolio}
        status={publicPortfolioStatus}
        error={publicPortfolioError}
        onHome={() => { window.location.href = '/'; }}
      />
    );
  }

  if (authView === 'welcome') {
    return <WelcomeScreen onLogin={() => { setAuthError(''); setAuthNotice(''); setAuthView('login'); }} />;
  }

  if (authView === 'login' || authView === 'signup') {
    return (
      <AuthScreen
        mode={authView}
        loading={authLoading}
        error={authError}
        notice={authNotice}
        onBack={() => { setAuthError(''); setAuthNotice(''); setAuthView('welcome'); }}
        onSwitch={() => { setAuthError(''); setAuthNotice(''); setAuthView(authView === 'login' ? 'signup' : 'login'); }}
        onForgotPassword={() => { setAuthError(''); setAuthNotice(''); setAuthView('forgot-password'); }}
        onSubmit={handleAuthentication}
        onGoogleSubmit={handleGoogleAuthentication}
      />
    );
  }

  if (authView === 'verify-pending') {
    return (
      <VerificationPendingScreen
        email={pendingEmail}
        verificationCode={verificationCode}
        onCodeChange={setVerificationCode}
        onVerifyCode={handleVerifyCode}
        loading={authLoading}
        error={authError}
        notice={authNotice}
        onResend={handleResendVerification}
        onLogin={() => { setAuthError(''); setAuthNotice(''); setVerificationCode(''); setAuthView('login'); }}
      />
    );
  }

  if (authView === 'forgot-password') {
    return (
      <ForgotPasswordScreen
        loading={authLoading}
        error={authError}
        notice={authNotice}
        onBack={() => { setAuthError(''); setAuthNotice(''); setAuthView('login'); }}
        onSubmit={handleForgotPassword}
      />
    );
  }

  if (authView === 'reset-password') {
    return (
      <ResetPasswordScreen
        loading={authLoading}
        error={authError}
        notice={authNotice}
        onBack={() => { clearAuthLinkParams(); setAuthError(''); setAuthNotice(''); setAuthView('login'); }}
        onSubmit={handleResetPassword}
      />
    );
  }

  if (authView === 'verifying') {
    return (
      <VerificationWorkingScreen
        loading={authLoading}
        error={authError}
        onLogin={() => { clearAuthLinkParams(); setAuthError(''); setAuthNotice(''); setAuthView('login'); }}
      />
    );
  }

  return (
    <div className="app">
      <div className="particles-bg">
        {particles.map(p => (
          <div key={p.id} className="particle" style={{ left:`${p.left}%`, top:`${p.top}%`, animationDuration:`${p.duration}s`, animationDelay:`${p.delay}s` }} />
        ))}
      </div>

      {showLanding ? (
        <div className="new-landing-page">
          <nav className="navbar" aria-label="Main navigation">
            <div className="navbar-container">
              <button className="navbar-logo" type="button" onClick={() => scrollToSection('home')} aria-label="MuseForge home">
                <span className="logo-icon">M</span>
                <span className="logo-text">MuseForge</span>
              </button>
              <div className="navbar-links">
                <button className="nav-link active" type="button" onClick={() => scrollToSection('home')}>Home</button>
                <button className="nav-link" type="button" onClick={() => scrollToSection('features')}>Features</button>
                <button className="nav-link" type="button" onClick={() => scrollToSection('templates')}>Templates</button>
                <button className="nav-link" type="button" onClick={() => scrollToSection('reviews')}>Reviews</button>
                <button className="nav-link" type="button" onClick={() => scrollToSection('creators')}>Creator Types</button>
              </div>
              <div className="navbar-actions">
                <span className="navbar-user" title={authUser?.email || ''}>{authUser?.name ? `Hi, ${authUser.name.split(' ')[0]}` : ''}</span>
                <button className="navbar-cta" type="button" onClick={() => scrollToSection('creators')}>Start</button>
                <button className="navbar-logout" type="button" onClick={logout}>Log out</button>
              </div>
            </div>
          </nav>

          {authNotice && (
            <div className="auth-success-toast" role="status">
              <span className="auth-success-icon">✓</span>
              <span>{authNotice}</span>
              <button type="button" onClick={() => setAuthNotice('')} aria-label="Dismiss message">×</button>
            </div>
          )}

          <main>
            <section className="hero-section" id="home">
              <div className="hero-container">
                <div className="hero-left">
                  <div className="hero-badge"><span className="badge-icon">✦</span>FACTLOCK + AI PORTFOLIOS</div>
                  <h1 className="hero-heading">
                    <span className="heading-line">Transform Your Creative</span>
                    <span className="heading-line">Journey into a</span>
                    <span className="heading-line gradient-text">Stunning Portfolio</span>
                  </h1>
                  <p className="hero-subtitle">MuseForge uses AI to help creators craft professional, personalized portfolios in minutes—while <strong>FactLock</strong> keeps project descriptions reviewable and grounded in the user's real work.</p>
                  <div className="hero-buttons">
                    <button className="btn-primary" type="button" onClick={() => scrollToSection('creators')}>Start <span>→</span></button>
                    <button className="btn-secondary" type="button" onClick={() => setShowDemoVideo(true)}><span className="play-icon">▶</span>See How It Works</button>
                  </div>
                  <div className="hero-trust">
                    <span className="trust-item"><span className="trust-icon">✦</span>No fake achievements added automatically</span>
                    <span className="trust-item"><span className="trust-icon">♢</span>Secure & private</span>
                    <span className="trust-item"><span className="trust-icon">⚡</span>Start in 60 seconds</span>
                  </div>
                </div>
                <div className="hero-right">
                  <div className="hero-image-wrapper">
                    <img src={`${process.env.PUBLIC_URL}/all.png`} alt="MuseForge AI portfolio builder preview" className="hero-image" onError={(e) => { e.currentTarget.src = `${process.env.PUBLIC_URL}/best.png`; }} />
                  </div>
                </div>
              </div>
            </section>

            <section className="creators-section" id="creators">
              <div className="creators-container">
                {Object.entries(CREATOR_TYPES).map(([key, type]) => (
                  <button key={key} type="button" className="creator-card" onClick={() => handleCreatorTypeSelect(key)}>
                    <span className="creator-card-image"><img src={`${process.env.PUBLIC_URL}${type.cardImage}`} alt="" /></span>
                    <span className="creator-card-title">{type.label}</span>
                    <span className="creator-card-desc">{type.cardDesc}</span>
                    <span className="creator-card-btn" aria-hidden="true">→</span>
                  </button>
                ))}
              </div>
            </section>

            <section className="reviews-section" id="reviews">
              <div className="reviews-container">
                <div className="reviews-header">
                  <div className="section-kicker">REVIEWS</div>
                  <h2>What creators are saying about MuseForge</h2>
                  <p>Real feedback from creators using FactLock, multilingual portfolios, and shareable portfolio links.</p>
                  {reviews.length > 0 && <div className="reviews-summary-pill"><span>★</span>{averageRating.toFixed(1)} average rating</div>}
                </div>
                <div className="reviews-grid">
                  {featuredReviews.length ? featuredReviews.map(review => (
                    <article className="review-card" key={review.id}>
                      <div className="review-card-stars" aria-label={`${review.rating} out of 5 stars`}>
                        {[1,2,3,4,5].map(star => <span key={star} className={star <= Number(review.rating) ? 'star-filled' : 'star-muted'}>★</span>)}
                      </div>
                      <p>“{review.review}”</p>
                      <div className="review-author-row">
                        <span>{review.name || 'MuseForge Creator'}</span>
                        <small>{review.created_at ? new Date(review.created_at).toLocaleDateString() : ''}</small>
                      </div>
                    </article>
                  )) : (
                    <article className="review-card review-empty-card">
                      <div className="review-card-stars"><span className="star-muted">★</span><span className="star-muted">★</span><span className="star-muted">★</span><span className="star-muted">★</span><span className="star-muted">★</span></div>
                      <p>No reviews yet. Be the first real creator to share feedback after using MuseForge.</p>
                      <div className="review-author-row"><span>Your review here</span><small>Real feedback only</small></div>
                    </article>
                  )}
                </div>
                <div className="reviews-actions">
                  <button type="button" className="btn-primary review-share-btn" onClick={() => openReviewModal('manual')}>Share your review</button>
                  <button type="button" className="btn-secondary review-view-btn" onClick={() => setShowAllReviewsModal(true)}>View all reviews</button>
                </div>
              </div>
            </section>

            <section className="info-section" id="features">
              <div className="section-kicker">FEATURES</div>
              <h2>Everything needed to shape a professional creative identity</h2>
              <div className="info-grid">
                <article><span>✓</span><h3>FactLock AI review</h3><p>Compare original and AI-enhanced project descriptions, then accept, edit, or keep the original without unsupported claims.</p></article>
                <article><span>🌐</span><h3>Multi-language portfolios</h3><p>Write in any language and choose the output language for the final portfolio.</p></article>
                <article><span>↗</span><h3>Shareable portfolio URL</h3><p>Publish a public portfolio link for judges, recruiters, or collaborators after generation.</p></article>
              </div>
            </section>

            <section className="templates-showcase" id="templates">
              <div className="templates-copy">
                <div className="section-kicker">TEMPLATES</div>
                <h2>One workflow, tailored to every kind of creator</h2>
                <p>Each creator path uses its own prompts, fields, visuals, media options, and portfolio structure.</p>
                <button type="button" className="text-link-button" onClick={() => scrollToSection('creators')}>Explore creator types <span>→</span></button>
              </div>
              <div className="template-preview-grid" aria-label="MuseForge portfolio templates">
                <article className="template-preview-card template-artist">
                  <span className="template-emoji">🎨</span>
                  <strong>Visual Portfolio</strong>
                  <small>Artwork, galleries, exhibitions</small>
                </article>

                <article className="template-preview-card template-career">
                  <span className="template-emoji">💼</span>
                  <strong>Career Portfolio</strong>
                  <small>Skills, CV, projects, experience</small>
                </article>

                <article className="template-preview-card template-media">
                  <span className="template-emoji">🎵</span>
                  <strong>Media Portfolio</strong>
                  <small>Audio, video, images, performances</small>
                </article>
              </div>
            </section>

            <section className="info-section" id="how-it-works">
              <div className="section-kicker">HOW IT WORKS</div>
              <h2>From your details to a portfolio in three focused steps</h2>
              <div className="steps-grid">
                <article><img src={`${process.env.PUBLIC_URL}/step-choose.png`} alt=""/><b>01</b><h3>Choose your creator type</h3><p>Select the path that best matches your work.</p></article>
                <article><img src={`${process.env.PUBLIC_URL}/step-details.png`} alt=""/><b>02</b><h3>Add authentic details</h3><p>Fill the form manually, or upload a CV when that option is available.</p></article>
                <article><img src={`${process.env.PUBLIC_URL}/step-generate.png`} alt=""/><b>03</b><h3>Generate and refine</h3><p>Review the AI-assisted result, add media, and export your finished portfolio.</p></article>
              </div>
            </section>
          </main>
          <footer className="landing-footer">Powered by <strong>IBM</strong> and <strong>AI</strong></footer>
        </div>
      ) : null}

      {showDemoVideo && (
        <div className="video-modal-backdrop" role="dialog" aria-modal="true" aria-label="MuseForge demo video" onClick={() => setShowDemoVideo(false)}>
          <div className="video-modal" onClick={e => e.stopPropagation()}>
            <button className="video-modal-close" type="button" onClick={() => setShowDemoVideo(false)} aria-label="Close video">✕</button>
            <div className="video-modal-heading">
              <span>HOW MUSEFORGE WORKS</span>
              <h2>See how to build your portfolio in minutes</h2>
            </div>
            {!demoStarted ? (
              <button
                type="button"
                className="demo-video-frame demo-video-preview"
                onClick={() => setDemoStarted(true)}
                aria-label="Play MuseForge demo video"
              >
                <img src="/all-original-rectangular.png" alt="MuseForge demo preview" />
                <span className="demo-play-button">▶</span>
              </button>
            ) : (
              <div className="demo-video-frame">
                <iframe
                  src={`${DEMO_VIDEO_EMBED_URL}?autoplay=1&rel=0&modestbranding=1&playsinline=1`}
                  title="MuseForge demo video"
                  allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
                  allowFullScreen
                  loading="eager"
                />
              </div>
            )}

            <p>Demo video</p>
          </div>
        </div>
      )}

      <header style={{ display: showLanding ? 'none' : 'block' }}>
        {selectedCreatorType && (
          <button
            className="back-to-landing-btn"
            onClick={() => {
              saveCurrentDraft();
              setShowLanding(true);
              setSelectedCreatorType(null);
              requestAnimationFrame(() => window.scrollTo({ top: 0, left: 0, behavior: "auto" }));
            }}
          >
            ← Back to Creator Selection
          </button>
        )}
        <div className="header-inner">
          <div className="header-brand">
            <div className="header-title-group">
              <h1 className="header-logo">MuseForge</h1>
              <div className="header-tagline">
                <span className="tagline-line"/>
                <span className="tagline-text">Where Creators Meet AI</span>
                <span className="tagline-line"/>
              </div>
            </div>
          </div>
        </div>
        <button className="top-clear" onClick={() => {
          setName(""); setMedium(""); setDescription(""); setProjects([]); setCustomSections([]);
          setPortfolio(""); setPortfolioReady(false); setFactLockReviews([]); setLocalizedOutput(null); setShareUrl(''); setShareStatus(''); setImagePreview(null); setImagePosition({ x: 50, y: 50 }); setImageUploadError(''); setSkills([]);
          setContact({ linkedin:'', github:'', whatsapp:'', email:'', address:'', links: [] });
          setCvFilled(false); setActiveTab("manual");
          if (selectedCreatorType) {
            setCreatorDrafts(prev => ({ ...prev, [selectedCreatorType]: emptyDraftFor(selectedCreatorType) }));
          }
        }}>✕</button>
      </header>

      <div className="tabs" style={{ display: showLanding ? 'none' : 'flex' }}>
        <button className={`tab ${activeTab==='manual' && !cvFilled ? 'active' : ''}`} onClick={() => {
          if (cvFilled) {
            setName(''); setMedium(''); setDescription(''); setProjects([]); setCustomSections([]);
            setPortfolio(''); setPortfolioReady(false); setFactLockReviews([]); setLocalizedOutput(null); setShareUrl(''); setShareStatus(''); setSkills([]); setImagePosition({ x: 50, y: 50 });
            setContact({ linkedin:'', github:'', whatsapp:'', email:'', address:'', links: [] });
            setCvFilled(false);
          }
          setActiveTab('manual');
        }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          <span className="tab-copy">
            <span className="tab-main">Fill Manually</span>
            <span className="tab-sub">Create your portfolio step by step</span>
          </span>
        </button>
        {(!selectedCreatorType || (selectedCreatorType && CREATOR_TYPES[selectedCreatorType].showCV)) && (
          <button className={`tab ${activeTab==='cv' || cvFilled ? 'active' : ''}`} onClick={() => setActiveTab('cv')}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
            <span className="tab-copy">
              <span className="tab-main">Upload CV</span>
              <span className="tab-sub">Auto-fill from your resume</span>
            </span>
          </button>
        )}
      </div>

      {activeTab==='cv' && !showLanding && (
        <div className="cv-upload-box" onClick={()=>document.getElementById('cvInput').click()}>
          {cvLoading
            ? <div className="cv-loading"><div className="spinner"/><p>Reading your CV...</p></div>
            : <div className="upload-placeholder">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#7c3aed" strokeWidth="1.5">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                  <polyline points="14 2 14 8 20 8"/>
                  <line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/>
                </svg>
                <p>Click to upload your CV</p>
                <small>PDF supported — AI will auto-fill your details</small>
              </div>}
          {cvFilled && !cvLoading && (
            <div className="cv-ready-panel" onClick={event => event.stopPropagation()}>
              <strong>CV loaded successfully</strong>
              <span>{fixName(name) || 'Your details'} {portfolioLanguage ? `• ${portfolioLanguage}` : ''}</span>
              <div className="cv-ready-actions">
                <button type="button" onClick={generate} disabled={loading}>{loading ? 'Generating portfolio...' : 'Generate My Portfolio'}</button>
                <button type="button" onClick={() => setActiveTab('manual')}>Edit manually</button>
              </div>
            </div>
          )}
          <input id="cvInput" type="file" accept=".pdf" style={{display:'none'}} onChange={handleCV}/>
        </div>
      )}

      {activeTab === 'manual' && !showLanding && (
      <div className={selectedCreatorType ? `form-with-image image-${CREATOR_TYPES[selectedCreatorType].imageSide}` : "form"}>
        <div className="form-fields">
          <div className="language-selector-card">
            <div>
              <span className="language-label">Portfolio language</span>
              <p>Input can be in any language. MuseForge will generate the final portfolio in your selected language.</p>
            </div>
            <select value={portfolioLanguage} onChange={e => setPortfolioLanguage(e.target.value)} aria-label="Portfolio language">
              {LANGUAGE_OPTIONS.map(language => <option key={language} value={language}>{language}</option>)}
            </select>
          </div>

          <div className="language-selector-card tone-selector-card">
            <div>
              <span className="language-label">AI style tone</span>
              <p>Choose how MuseForge writes the bio and FactLock-enhanced descriptions.</p>
            </div>
            <select value={aiTone} onChange={e => setAiTone(e.target.value)} aria-label="AI style tone">
              {AI_TONE_OPTIONS.map(tone => <option key={tone} value={tone}>{tone}</option>)}
            </select>
          </div>

          {renderVersionHistoryPanel(true)}

          <input placeholder="Your name" value={name} onChange={e=>setName(e.target.value)}/>
          <input placeholder="Your creative medium (e.g. Photography, Music, Software Development)" value={medium} onChange={e=>setMedium(e.target.value)}/>
          <textarea
            placeholder={selectedCreatorType && CREATOR_TYPES[selectedCreatorType]
              ? CREATOR_TYPES[selectedCreatorType].placeholder
              : "Describe your work and creative vision..."
            }
            value={description}
            onChange={e=>setDescription(e.target.value)}
            rows={5}
          />

        {/* Projects */}
        <div className="li-section">
          <div className="li-section-header">
            <span className="li-section-title">Projects</span>
            <div className="project-header-actions">
              <button className="ai-suggest-btn" type="button" onClick={suggestProjects} disabled={suggestionLoading || !description.trim()}>
                {suggestionLoading ? 'Suggesting...' : 'AI Suggestions'}
              </button>
              <button className="li-add-btn" onClick={addProject}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            </button>
            </div>
          </div>
          {suggestionError && <p className="suggestion-error">{suggestionError}</p>}
          {projectSuggestions.length > 0 && (
            <div className="project-suggestions-wrap">
              <div className="project-suggestions-toolbar">
                <span>Suggested ideas</span>
                <button type="button" className="project-suggestions-closeall" onClick={clearProjectSuggestions}>Close all</button>
              </div>
              <div className="project-suggestions">
                {projectSuggestions.map((suggestion, index) => (
                  <article key={`${suggestion.title}-${index}`}>
                    <button
                      type="button"
                      className="suggestion-dismiss"
                      aria-label={`Remove suggestion ${suggestion.title}`}
                      onClick={() => dismissProjectSuggestion(suggestion.id)}
                    >
                      ×
                    </button>
                    <strong>{suggestion.title}</strong>
                    <span>{suggestion.desc}</span>
                    <button type="button" onClick={() => addSuggestedProject(suggestion)}>Add</button>
                  </article>
                ))}
              </div>
            </div>
          )}
          {projects.length===0 && <p className="li-empty">No projects yet. Click + to add.</p>}
          {projects.map(p => (
            <div key={p.id} className="li-item">
              {editingProject===p.id ? (
                <div className="li-edit-form">
                  <input placeholder="Project title" value={p.title} onChange={e=>updateProject(p.id,'title',e.target.value)}/>
                  <textarea placeholder="Description (optional)" value={p.desc} onChange={e=>updateProject(p.id,'desc',e.target.value)} rows={2}/>
                  <input placeholder="Project link (GitHub repo URL, optional)" value={p.link||''} onChange={e=>updateProject(p.id,'link',e.target.value)}/>
                  <div className="project-media-upload">
                    {p.media ? (
                      <div className="project-media-preview">
                        {p.media.type === 'image' && <img src={p.media.src} alt="preview" className="project-media-thumb"/>}
                        {p.media.type === 'video' && <video src={p.media.src} className="project-media-thumb" controls/>}
                        {p.media.type === 'audio' && <audio src={p.media.src} className="project-audio-preview" controls/>}
                        <div className="project-media-actions">
                          <span className="project-media-name">{p.media.name}</span>
                          <button className="li-delete-btn" onClick={()=>updateProject(p.id,'media',null)}>Remove</button>
                        </div>
                      </div>
                    ) : selectedCreatorType === 'musician' ? (
                      <div className="musician-media-options" onClick={e=>e.stopPropagation()}>
                        <label className="project-media-label">
                          <input type="file" accept="image/*" style={{display:'none'}} onChange={e=>handleProjectMedia(p.id,e,'image')}/>
                          <span className="project-media-btn">Add Image</span>
                        </label>
                        <label className="project-media-label">
                          <input type="file" accept="video/*" style={{display:'none'}} onChange={e=>handleProjectMedia(p.id,e,'video')}/>
                          <span className="project-media-btn">Add Video</span>
                        </label>
                        <label className="project-media-label">
                          <input type="file" accept="audio/*" style={{display:'none'}} onChange={e=>handleProjectMedia(p.id,e,'audio')}/>
                          <span className="project-media-btn">Add Audio</span>
                        </label>
                      </div>
                    ) : (
                      <label className="project-media-label" onClick={e=>e.stopPropagation()}>
                        <input type="file" accept="image/*,video/*" style={{display:'none'}} onChange={e=>handleProjectMedia(p.id,e)}/>
                        <span className="project-media-btn">Add Media</span>
                      </label>
                    )}
                  </div>
                  <div className="li-edit-actions">
                    <button className="li-save-btn" onClick={()=>setEditingProject(null)}>Save</button>
                    <button className="li-delete-btn" onClick={()=>deleteProject(p.id)}>Delete</button>
                  </div>
                </div>
              ) : (
                <div className="li-item-preview">
                  <div className="li-item-text">
                    <strong>{p.title||"Untitled"}</strong>
                    {p.desc && <span>{p.desc}</span>}
                    {p.link && <span className="project-link-chip">🔗 {p.link}</span>}
                    {p.media && <span className="project-media-chip">{p.media.name}</span>}
                  </div>
                  <button className="li-edit-icon" onClick={()=>setEditingProject(p.id)}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                  </button>
                  <button className="li-delete-icon" onClick={()=>deleteProject(p.id)}>✕</button>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Custom Sections */}
        {customSections.map(s => (
          <div key={s.id} className="li-section">
            <div className="li-section-header">
              <span className="li-section-title">{s.name}</span>
              <div style={{display:'flex',gap:8}}>
                <button className="li-add-btn" onClick={() => { setAddingItemTo(addingItemTo===s.id?null:s.id); setNewItemHeading(""); setNewItemDesc(""); setNewItemLink(""); setNewItemMedia(null); }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                </button>
                <button className="li-delete-icon" onClick={()=>deleteSection(s.id)}>✕</button>
              </div>
            </div>
            {(!s.items||s.items.length===0) && addingItemTo!==s.id && <p className="li-empty">Click + to add entries to {s.name}.</p>}
            {s.items && s.items.map(it => (
              <div key={it.id} className="li-item">
                {editingSectionItem?.sectionId===s.id && editingSectionItem?.itemId===it.id ? (
                  <div className="li-edit-form">
                    <input placeholder="Heading" value={it.heading} onChange={e=>updateSectionItem(s.id,it.id,'heading',e.target.value)}/>
                    <textarea placeholder="Description" value={it.desc} onChange={e=>updateSectionItem(s.id,it.id,'desc',e.target.value)} rows={2}/>
                    <input placeholder="URL / link (optional)" value={it.link||''} onChange={e=>updateSectionItem(s.id,it.id,'link',e.target.value)}/>
                    <div className="project-media-upload">
                      {it.media ? (
                        <div className="project-media-preview">
                          {it.media.type === 'image' && <img src={it.media.src} alt="preview" className="project-media-thumb"/>}
                          {it.media.type === 'video' && <video src={it.media.src} className="project-media-thumb" controls/>}
                          {it.media.type === 'audio' && <audio src={it.media.src} className="project-audio-preview" controls/>}
                          <div className="project-media-actions">
                            <span className="project-media-name">{it.media.name}</span>
                            <button className="li-delete-btn" onClick={()=>updateSectionItem(s.id,it.id,'media',null)}>Remove</button>
                          </div>
                        </div>
                      ) : (
                        <div className="musician-media-options" onClick={e=>e.stopPropagation()}>
                          <label className="project-media-label">
                            <input type="file" accept="image/*" style={{display:'none'}} onChange={e=>handleCustomSectionMedia(s.id,it.id,e,'image')}/>
                            <span className="project-media-btn">Add Image</span>
                          </label>
                          <label className="project-media-label">
                            <input type="file" accept="video/*" style={{display:'none'}} onChange={e=>handleCustomSectionMedia(s.id,it.id,e,'video')}/>
                            <span className="project-media-btn">Add Video</span>
                          </label>
                          <label className="project-media-label">
                            <input type="file" accept="audio/*" style={{display:'none'}} onChange={e=>handleCustomSectionMedia(s.id,it.id,e,'audio')}/>
                            <span className="project-media-btn">Add Audio</span>
                          </label>
                        </div>
                      )}
                    </div>
                    <div className="li-edit-actions">
                      <button className="li-save-btn" onClick={()=>setEditingSectionItem(null)}>Save</button>
                      <button className="li-delete-btn" onClick={()=>deleteSectionItem(s.id,it.id)}>Delete</button>
                    </div>
                  </div>
                ) : (
                  <div className="li-item-preview">
                    <div className="li-item-text">
                      <strong>{it.heading||"Untitled"}</strong>
                      {it.desc && <span>{it.desc}</span>}
                      {it.link && <span className="project-link-chip">🔗 {it.link}</span>}
                      {it.media && <span className="project-media-chip">{it.media.name}</span>}
                    </div>
                    <button className="li-edit-icon" onClick={()=>setEditingSectionItem({sectionId:s.id,itemId:it.id})}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                    </button>
                    <button className="li-delete-icon" onClick={()=>deleteSectionItem(s.id,it.id)}>✕</button>
                  </div>
                )}
              </div>
            ))}
            {addingItemTo===s.id && (
              <div className="li-edit-form" style={{marginTop:8}}>
                <input placeholder={`Heading (e.g. ${s.name==='Education'?"Bachelor's in Computer Science":s.name+' title'})`} value={newItemHeading} onChange={e=>setNewItemHeading(e.target.value)} autoFocus/>
                <textarea placeholder={`Description (e.g. ${s.name==='Education'?'University name, 2020-2024':'Details...'})`} value={newItemDesc} onChange={e=>setNewItemDesc(e.target.value)} rows={2}/>
                <input placeholder="URL / link (optional)" value={newItemLink} onChange={e=>setNewItemLink(e.target.value)}/>
                <div className="project-media-upload">
                  {newItemMedia ? (
                    <div className="project-media-preview">
                      {newItemMedia.type === 'image' && <img src={newItemMedia.src} alt="preview" className="project-media-thumb"/>}
                      {newItemMedia.type === 'video' && <video src={newItemMedia.src} className="project-media-thumb" controls/>}
                      {newItemMedia.type === 'audio' && <audio src={newItemMedia.src} className="project-audio-preview" controls/>}
                      <div className="project-media-actions">
                        <span className="project-media-name">{newItemMedia.name}</span>
                        <button className="li-delete-btn" onClick={()=>setNewItemMedia(null)}>Remove</button>
                      </div>
                    </div>
                  ) : (
                    <div className="musician-media-options" onClick={e=>e.stopPropagation()}>
                      <label className="project-media-label">
                        <input type="file" accept="image/*" style={{display:'none'}} onChange={e=>handleNewItemMedia(e,'image')}/>
                        <span className="project-media-btn">Add Image</span>
                      </label>
                      <label className="project-media-label">
                        <input type="file" accept="video/*" style={{display:'none'}} onChange={e=>handleNewItemMedia(e,'video')}/>
                        <span className="project-media-btn">Add Video</span>
                      </label>
                      <label className="project-media-label">
                        <input type="file" accept="audio/*" style={{display:'none'}} onChange={e=>handleNewItemMedia(e,'audio')}/>
                        <span className="project-media-btn">Add Audio</span>
                      </label>
                    </div>
                  )}
                </div>
                <div className="li-edit-actions">
                  <button className="li-save-btn" onClick={() => { if(!newItemHeading.trim()&&!newItemDesc.trim()&&!newItemLink.trim()&&!newItemMedia) return; addItemToSection(s.id,newItemHeading,newItemDesc,newItemLink,newItemMedia); setNewItemHeading(""); setNewItemDesc(""); setNewItemLink(""); setNewItemMedia(null); setAddingItemTo(null); }}>Add</button>
                  <button className="li-delete-btn" onClick={()=>{setAddingItemTo(null);setNewItemHeading("");setNewItemDesc("");setNewItemLink("");setNewItemMedia(null);}}>Cancel</button>
                </div>
              </div>
            )}
          </div>
        ))}

        {addingSectionName ? (
          <div className="li-section">
            <input placeholder="Section name (e.g. Education, Certifications, Experience)" value={newSectionName} onChange={e=>setNewSectionName(e.target.value)} onKeyDown={e=>e.key==='Enter'&&addCustomSection()} autoFocus/>
            <div style={{display:'flex',gap:8,marginTop:8}}>
              <button className="li-save-btn" onClick={addCustomSection}>Add</button>
              <button className="li-delete-btn" onClick={()=>{setAddingSectionName(false);setNewSectionName("");}}>Cancel</button>
            </div>
          </div>
        ) : (
          <button className="li-add-section-btn" onClick={()=>setAddingSectionName(true)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Add Section
          </button>
        )}

        {/* Profile Pic */}
        <div className="upload-box" style={{cursor: imagePreview ? 'default' : 'pointer'}}
          onClick={imagePreview ? undefined : () => imageInputRef.current?.click()}>
          {imagePreview ? (
            <div className="img-preview-wrap" onClick={e=>e.stopPropagation()}>
              <div
                className="img-circle-preview"
                style={{cursor: isDragging ? 'grabbing' : 'grab', userSelect:'none'}}
                onMouseDown={e => { e.preventDefault(); setIsDragging(true); setDragStart({ x: e.clientX, y: e.clientY, posX: imagePosition.x, posY: imagePosition.y }); }}
                onMouseMove={e => { if (!isDragging) return; const dx = ((e.clientX - dragStart.x) / 130) * -100; const dy = ((e.clientY - dragStart.y) / 130) * -100; setImagePosition({ x: Math.max(0, Math.min(100, dragStart.posX + dx)), y: Math.max(0, Math.min(100, dragStart.posY + dy)) }); }}
                onMouseUp={() => setIsDragging(false)}
                onMouseLeave={() => setIsDragging(false)}
                onTouchStart={e => { const t = e.touches[0]; setIsDragging(true); setDragStart({ x: t.clientX, y: t.clientY, posX: imagePosition.x, posY: imagePosition.y }); }}
                onTouchMove={e => { if (!isDragging) return; const t = e.touches[0]; const dx = ((t.clientX - dragStart.x) / 130) * -100; const dy = ((t.clientY - dragStart.y) / 130) * -100; setImagePosition({ x: Math.max(0, Math.min(100, dragStart.posX + dx)), y: Math.max(0, Math.min(100, dragStart.posY + dy)) }); }}
                onTouchEnd={() => setIsDragging(false)}
              >
                <img src={imagePreview} alt="preview" className="img-preview-inner"
                  style={{objectPosition: `${imagePosition.x}% ${imagePosition.y}%`, pointerEvents:'none'}}/>
              </div>
              <small style={{color:'#9ca3af',fontSize:'0.75rem',marginTop:2,fontFamily:'Segoe UI,sans-serif'}}>Drag to reposition</small>
              <button className="remove-img" onClick={e=>{e.stopPropagation();setImagePreview(null);setImagePosition({x:50,y:50});}}>✕</button>
              <button className="change-img" onClick={e=>{e.stopPropagation();imageInputRef.current?.click();}}>Change Image</button>
            </div>
          ) : (
            <div className="upload-placeholder">
              <div className="upload-circle-icon">
                <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#7c3aed" strokeWidth="1.5">
                  <circle cx="12" cy="12" r="10"/>
                  <circle cx="12" cy="8" r="3"/>
                  <path d="M6 20c0-3.314 2.686-6 6-6s6 2.686 6 6"/>
                </svg>
              </div>
              <p>Upload Your Portfolio Pic</p>
              <small>Drag to reposition after upload</small>
            </div>
          )}
          <input ref={imageInputRef} id="imgInput" type="file" accept="image/*" style={{display:'none'}} onChange={handleImage} onClick={e=>e.stopPropagation()}/>
        </div>
        {imageUploadError && <div className="image-upload-error" role="alert">{imageUploadError}</div>}

        {/* Contact */}
        <div className="li-section">
          <div className="li-section-header">
            <span className="li-section-title">Contact Info</span>
            <button className="li-delete-btn" onClick={()=>setContact({linkedin:'',github:'',whatsapp:'',email:'',address:'', links: []})}>Clear</button>
          </div>
          <div className="contact-inputs">
            <input placeholder="Phone / WhatsApp" value={contact.whatsapp} onChange={e=>setContact({...normalizeContact(contact),whatsapp:e.target.value})}/>
            <input placeholder="Email" value={contact.email} onChange={e=>setContact({...normalizeContact(contact),email:e.target.value})}/>
            <input className="full-width" placeholder="Address / Location" value={contact.address} onChange={e=>setContact({...normalizeContact(contact),address:e.target.value})}/>
          </div>
          <div className="social-links-box">
            <div className="social-links-header">
              <span>Social / portfolio links</span>
              <button type="button" className="li-add-btn social-link-plus-btn" onClick={addContactLink}>+</button>
            </div>
            {normalizeContact(contact).links.length === 0 && <p className="li-empty">Add YouTube, Instagram, Facebook, LinkedIn, GitHub, Behance, or any other link.</p>}
            {normalizeContact(contact).links.map(link => (
              <div className="social-link-row" key={link.id}>
                <input placeholder="Link name (e.g. YouTube, Instagram, Facebook)" value={link.label || ''} onChange={e=>updateContactLink(link.id,'label',e.target.value)}/>
                <input placeholder="URL" value={link.url || ''} onChange={e=>updateContactLink(link.id,'url',e.target.value)}/>
                <button type="button" className="li-delete-btn" onClick={()=>deleteContactLink(link.id)}>Remove</button>
              </div>
            ))}
          </div>
        </div>

          <button onClick={generate} disabled={loading} aria-label="Generate My Portfolio">
            {loading ? (isCvDirectGenerateMode ? "Generating portfolio..." : "Preparing AI review...") : (isCvDirectGenerateMode ? "Generate My Portfolio" : "Show AI Enhancements")}
          </button>
        </div>

        {selectedCreatorType && CREATOR_TYPES[selectedCreatorType] && (
          <aside className="creator-image-panel" style={{'--creator-color': CREATOR_TYPES[selectedCreatorType].color, '--creator-gradient': CREATOR_TYPES[selectedCreatorType].formGradient}}>
            <img
              src={CREATOR_TYPES[selectedCreatorType].formImage}
              alt={`${CREATOR_TYPES[selectedCreatorType].label} inspiration`}
              onError={(e) => {
                e.currentTarget.style.display = 'none';
                console.error('Image failed to load:', CREATOR_TYPES[selectedCreatorType].formImage);
              }}
            />
            <p className="creator-quote">{CREATOR_TYPES[selectedCreatorType].formQuote}</p>
          </aside>
        )}
            </div>
        )}

      {factLockReviews.length > 0 && !showLanding && (
        <section className="factlock-panel" aria-label="MuseForge FactLock review">
          <div className="factlock-header">
            <span className="factlock-badge">✓ FactLock</span>
            <div>
              <h2>AI enhancement review</h2>
              <p>Each description was polished without adding unsupported achievements, tools, metrics, or awards.</p>
            </div>
          </div>
          <div className="factlock-score-banner">
            <strong>{factLockScoreForReviews(factLockReviews)}%</strong>
            <span>FactLock trust score based on preserved facts and unsupported new facts.</span>
          </div>
          <div className="factlock-list">
            {factLockReviews.map(review => (
              <article className="factlock-card" key={review.id}>
                <div className="factlock-card-title">
                  <strong>{review.title}</strong>
                  <div className="factlock-title-badges">
                    <span className="factlock-score-chip">{factLockScoreForReview(review)}% facts preserved</span>
                    <span>{review.status}</span>
                  </div>
                </div>
                <div className="factlock-compare">
                  <div>
                    <label>Original</label>
                    <p>{review.originalDesc || 'No original description supplied.'}</p>
                  </div>
                  <div>
                    <label>AI-enhanced</label>
                    <textarea
                      value={review.enhancedDesc}
                      onChange={event => updateFactLockReview(review.id, event.target.value)}
                      rows={3}
                      aria-label={`AI-enhanced description for ${review.title}`}
                    />
                  </div>
                </div>
                <div className="factlock-evidence">
                  <div><b>Facts preserved</b>{review.factsPreserved.length ? review.factsPreserved.map(fact => <span key={fact}>{fact}</span>) : <span>User-provided project title and description</span>}</div>
                  <div><b>Unsupported new facts</b>{review.unsupportedNewFacts.length ? review.unsupportedNewFacts.map(fact => <span className="danger" key={fact}>{fact}</span>) : <span>None detected</span>}</div>
                </div>
                <div className="factlock-actions">
                  <button type="button" onClick={() => acceptFactLockReview(review.id)}>Accept enhanced</button>
                  <button type="button" onClick={() => keepEditedFactLock(review.id)}>Keep edited changes</button>
                  <button type="button" onClick={() => keepOriginalFactLock(review.id)}>Keep original</button>
                  {!String(review.id).startsWith('meta:') && <button type="button" onClick={() => regenerateFactLockReview(review.id)} disabled={regeneratingFactLockId === String(review.id)}>{regeneratingFactLockId === String(review.id) ? 'Regenerating...' : 'Regenerate'}</button>}
                </div>
              </article>
            ))}
          </div>
          <div className="factlock-finalize">
            <div>
              <strong>{unresolvedFactLockCount ? `${unresolvedFactLockCount} item${unresolvedFactLockCount > 1 ? 's' : ''} still need a choice` : 'All FactLock choices are ready'}</strong>
              <span>Final portfolio will be generated only after your reviewed choices are locked.</span>
            </div>
            <button type="button" onClick={finalizeReviewedPortfolio} disabled={!canFinalizeFactLock || loading}>
              {loading ? 'Generating final portfolio...' : 'Generate Portfolio'}
            </button>
          </div>
        </section>
      )}

      {generationNotice && !showLanding && <div className="generation-notice" role="status">{generationNotice}</div>}

      {portfolio && portfolioReady && !showLanding && (() => {
        const trustReport = getFactLockTrustReport();
        return (
          <section className="factlock-trust-report" aria-label="FactLock Trust Report">
            <div className="trust-report-title">
              <span>✓</span>
              <div>
                <h2>{portfolioLabels.factLockTrustReport}</h2>
                <p>{portfolioLabels.trustSubtitle}</p>
              </div>
            </div>
            <div className="trust-report-grid">
              <span><b>{trustReport.projectsReviewed}</b><small>{portfolioLabels.projectsReviewed || 'Projects reviewed'}</small></span>
              <span><b>{trustReport.enhancedDescriptionsAccepted}</b><small>{portfolioLabels.enhancedInUse || 'Enhanced in use'}</small></span>
              <span><b>{trustReport.originalDescriptionsKept}</b><small>{portfolioLabels.originalKept || 'Original kept'}</small></span>
              <span><b>{trustReport.unsupportedFactsDetected}</b><small>{portfolioLabels.unsupportedFactsDetected || 'Unsupported facts detected'}</small></span>
              <span><b>{trustReport.inputLanguage}</b><small>{portfolioLabels.inputLanguage || 'Input language'}</small></span>
              <span><b>{trustReport.outputLanguage}</b><small>{portfolioLabels.outputLanguage || 'Output language'}</small></span>
              <span><b>{trustReport.shareLinkCreated ? (portfolioLabels.yes || 'Yes') : (portfolioLabels.no || 'No')}</b><small>{portfolioLabels.shareLinkCreated || 'Share link created'}</small></span>
            </div>
          </section>
        );
      })()}

      {portfolio && portfolioReady && !showLanding && (
        <div className="result">
          <h2>{portfolioLabels.yourPortfolio || 'Your Portfolio'}</h2>
          <div className="portfolio-content notranslate" lang={languageToHtmlLang(portfolioLanguage)} dir={languageDirection(portfolioLanguage)} translate="no">
            <div className={`portfolio-preview-hero ${imagePreview ? 'has-image' : 'name-only'}`}>
              {imagePreview && (
                <div className="portfolio-preview-photo">
                  <img src={imagePreview} alt={`${displayName} portfolio`} style={{objectPosition: `${imagePosition.x}% ${imagePosition.y}%`}} />
                </div>
              )}
              <div className="portfolio-preview-identity">
                <h1>{displayName}</h1>
                {displayMedium && <p>{displayMedium}</p>}
                {portfolioLanguage && <span className="portfolio-language-pill">{portfolioLanguage}</span>}
              </div>
            </div>
            {(contactLinks.length || contact.email || contact.whatsapp || contact.address) && (
              <div style={{marginBottom:16}}>
                <h3 style={{color:'#7c3aed',marginBottom:8}}>{portfolioLabels.contact}</h3>
                {contact.whatsapp && <div><strong>{portfolioLabels.phone}:</strong> {contact.whatsapp}</div>}
                {contact.email && <div><strong>{portfolioLabels.email}:</strong> {contact.email}</div>}
                {contactLinks.map(link => <div key={link.id}><strong>{link.label}:</strong> <a href={link.url} target="_blank" rel="noreferrer" style={{color:'#7c3aed'}}>{link.url}</a></div>)}
                {contact.address && <div><strong>{portfolioLabels.location}:</strong> {localizeLocationText(contact.address, portfolioLanguage)}</div>}
              </div>
            )}
            {displaySkills.length > 0 && (
              <div style={{marginBottom:16}}>
                <h3 style={{color:'#7c3aed',marginBottom:8}}>{portfolioLabels.skills}</h3>
                <p>{displaySkills.join(', ')}</p>
              </div>
            )}
            {displayBio && (
              <div className="localized-text-section">
                <h3>{portfolioLabels.artistBio || portfolioLabels.about || 'Bio'}</h3>
                <p>{displayBio}</p>
              </div>
            )}
            {displayStatement && displayStatement !== displayBio && (
              <div className="localized-text-section">
                <h3>{portfolioLabels.artistStatement || portfolioLabels.statement || 'Statement'}</h3>
                {String(displayStatement).split('\n').filter(Boolean).map((line, index) => <p key={index}>{line}</p>)}
              </div>
            )}
            {displayProjects.filter(p=>String(p.title || '').trim()).length > 0 && (
              <div className="projects-output">
                <h3>{portfolioLabels.projects}</h3>
                {displayProjects.filter(p=>String(p.title || '').trim()).map(p => (
                  <div key={p.id} className="project-output-card">
                    {p.link
                      ? <a href={p.link} target="_blank" rel="noreferrer" style={{color:'#7c3aed',textDecoration:'none'}}><strong>{p.title}</strong></a>
                      : <strong>{p.title}</strong>}
                    {p.desc && <span>{p.desc}</span>}
                    {p.media && (
                      <div style={{marginTop:8}}>
                        {p.media.type==='image' && <img src={p.media.src} alt={p.title} style={{maxWidth:'100%',maxHeight:180,borderRadius:6,objectFit:'cover'}}/>}
                        {p.media.type==='video' && <video src={p.media.src} controls style={{maxWidth:'100%',maxHeight:180,borderRadius:6}}/>}
                        {p.media.type==='audio' && <audio src={p.media.src} controls style={{width:'min(100%,420px)'}}/>}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
            {displayCustomSections.filter(s=>s.items?.length>0).map(s => (
              <div key={s.id} style={{marginTop:16}}>
                <h3 style={{color:'#7c3aed',marginBottom:8}}>{s.name}</h3>
                {s.items.map(it => (
                  <div key={it.id} className="result-custom-item">
                    {it.heading && <strong style={{display:'block',color:'#222'}}>{it.heading}</strong>}
                    {it.desc && <span style={{color:'#555',fontSize:'0.9rem'}}>{it.desc}</span>}
                    {it.link && <a href={it.link} target="_blank" rel="noreferrer" style={{display:'block',color:'#7c3aed',fontSize:'0.86rem',marginTop:5}}>🔗 {it.link}</a>}
                    {it.media && (
                      <div style={{marginTop:8}}>
                        {it.media.type==='image' && <img src={it.media.src} alt={it.heading || s.name} style={{maxWidth:'100%',maxHeight:180,borderRadius:6,objectFit:'cover'}}/>}
                        {it.media.type==='video' && <video src={it.media.src} controls style={{maxWidth:'100%',maxHeight:180,borderRadius:6}}/>}
                        {it.media.type==='audio' && <audio src={it.media.src} controls style={{width:'min(100%,420px)'}}/>}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ))}
          </div>
          <div className="btn-row">
            <button className="copy-btn" onClick={()=>{navigator.clipboard.writeText(buildVisiblePortfolioText());setCopied(true);setTimeout(()=>setCopied(false),2000);}}>
              {copied ? (portfolioLabels.copied || "Copied") : (portfolioLabels.copyPortfolio || "Copy Portfolio")}
            </button>
            <button className="export-btn" onClick={exportPortfolio}>{portfolioLabels.exportHtml || "Export as HTML"}</button>
            <button className="share-btn" onClick={publishPortfolio}>{portfolioLabels.createShareLink || "Create Share Link"}</button>
          </div>
          {(shareStatus || shareUrl) && (
            <div className="share-result" role="status">
              {shareStatus && <span>{shareStatus}</span>}
              {shareUrl && <a href={shareUrl} target="_blank" rel="noreferrer">{shareUrl}</a>}
            </div>
          )}
        </div>
      )}


      {showReviewModal && (
        <div className="modal-overlay muse-modal-overlay" role="dialog" aria-modal="true" aria-label="Share your review" onClick={closeReviewModal}>
          <div className="review-modal-pro" onClick={event => event.stopPropagation()}>
            <button type="button" className="review-modal-close" onClick={closeReviewModal} aria-label="Close review modal">×</button>
            <div className="review-modal-hero">
              <span className="review-modal-icon">★</span>
              <div>
                <h2>Share your review</h2>
                <p>Your feedback helps creators discover MuseForge.</p>
              </div>
            </div>
            <label className="review-field-label">Rating *</label>
            <div className="review-star-input" role="radiogroup" aria-label="Rating">
              {[1,2,3,4,5].map(star => (
                <button
                  key={star}
                  type="button"
                  className={`review-star-button ${star <= reviewRating ? 'active' : ''}`}
                  onClick={() => setReviewRating(star)}
                  aria-label={`${star} star${star > 1 ? 's' : ''}`}
                >★</button>
              ))}
            </div>
            <label className="review-field-label" htmlFor="review-textarea">Your review *</label>
            <textarea
              id="review-textarea"
              className="review-textarea-pro"
              value={reviewText}
              onChange={event => setReviewText(event.target.value.slice(0, 1000))}
              placeholder="Share your experience with MuseForge..."
              rows={5}
            />
            <div className="review-counter">{reviewText.length}/1000 characters</div>
            {reviewError && <div className="review-error" role="alert">{reviewError}</div>}
            {reviewSuccess && <div className="review-success" role="status">{reviewSuccess}</div>}
            <div className="review-modal-actions">
              <button type="button" className="review-skip-btn" onClick={closeReviewModal}>Skip for now</button>
              <button type="button" className="review-submit-btn" onClick={submitReview} disabled={reviewSubmitting}>{reviewSubmitting ? 'Submitting...' : 'Submit review'}</button>
            </div>
          </div>
        </div>
      )}

      {showAllReviewsModal && (
        <div className="modal-overlay muse-modal-overlay" role="dialog" aria-modal="true" aria-label="All reviews" onClick={() => setShowAllReviewsModal(false)}>
          <div className="all-reviews-modal-pro" onClick={event => event.stopPropagation()}>
            <button type="button" className="review-modal-close" onClick={() => setShowAllReviewsModal(false)} aria-label="Close all reviews">×</button>
            <div className="review-modal-hero">
              <span className="review-modal-icon">★</span>
              <div>
                <h2>All MuseForge reviews</h2>
                <p>Ratings and feedback from creators.</p>
              </div>
            </div>
            <div className="all-reviews-list-pro">
              {reviews.length ? reviews.map(review => (
                <article className="review-card compact" key={review.id}>
                  <div className="review-card-stars">{[1,2,3,4,5].map(star => <span key={star} className={star <= Number(review.rating) ? 'star-filled' : 'star-muted'}>★</span>)}</div>
                  <p>“{review.review}”</p>
                  <div className="review-author-row"><span>{review.name || 'MuseForge Creator'}</span><small>{review.created_at ? new Date(review.created_at).toLocaleDateString() : ''}</small></div>
                </article>
              )) : <p className="review-empty-message">No reviews have been submitted yet.</p>}
            </div>
            <button type="button" className="review-submit-btn wide" onClick={() => { setShowAllReviewsModal(false); openReviewModal('manual'); }}>Share your review</button>
          </div>
        </div>
      )}

      {showExportCustomizer && (
        <div className="modal-overlay muse-modal-overlay" role="dialog" aria-modal="true" aria-label="Export portfolio customizer" onClick={() => setShowExportCustomizer(false)}>
          <div className="export-customizer-modal" onClick={event => event.stopPropagation()}>
            <button type="button" className="review-modal-close" onClick={() => setShowExportCustomizer(false)} aria-label="Close export customizer">×</button>
            <div className="export-customizer-header">
              <span>EXPORT STYLE</span>
              <h2>Customize your HTML portfolio</h2>
              <p>Choose fonts, colors, and a background template before downloading.</p>
            </div>
            <div className="export-customizer-grid">
              <label>Portfolio font style
                <select value={exportSettings.portfolioFont} onChange={event => updateExportSetting('portfolioFont', event.target.value)}>
                  {EXPORT_FONT_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </label>
              <label>Custom font name
                <input value={exportSettings.customFont} onChange={event => updateExportSetting('customFont', event.target.value)} placeholder="e.g. Poppins, Lora, Montserrat" />
              </label>
              <label>Background / template
                <select value={exportSettings.template} onChange={event => updateExportSetting('template', event.target.value)}>
                  {EXPORT_TEMPLATE_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </label>
              <label>Heading font
                <select value={exportSettings.headingFont} onChange={event => updateExportSetting('headingFont', event.target.value)}>
                  {EXPORT_FONT_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </label>
              <label>Heading color
                <input type="color" value={exportSettings.headingColor} onChange={event => updateExportSetting('headingColor', event.target.value)} />
              </label>
              <label>Subheading color
                <input type="color" value={exportSettings.subheadingColor} onChange={event => updateExportSetting('subheadingColor', event.target.value)} />
              </label>
              <label>Body text font
                <select value={exportSettings.bodyFont} onChange={event => updateExportSetting('bodyFont', event.target.value)}>
                  {EXPORT_FONT_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </label>
              <label>Body text color
                <input type="color" value={exportSettings.bodyColor} onChange={event => updateExportSetting('bodyColor', event.target.value)} />
              </label>
            </div>
            <div className="export-style-preview" style={{ background: buildExportTheme(exportSettings).heroBackground, color: buildExportTheme(exportSettings).bodyColor, fontFamily: buildExportTheme(exportSettings).bodyFont }}>
              <strong style={{ color: buildExportTheme(exportSettings).headingColor, fontFamily: buildExportTheme(exportSettings).headingFont }}>{displayName || 'Your Name'}</strong>
              <span style={{ color: buildExportTheme(exportSettings).subheadingColor }}>{displayMedium || 'Creative Portfolio'}</span>
              <small>This preview shows the selected export style.</small>
            </div>
            <div className="export-customizer-actions">
              <button type="button" className="review-skip-btn" onClick={resetExportSettings}>Use Default Settings</button>
              <button type="button" className="review-skip-btn" onClick={() => setShowExportCustomizer(false)}>Cancel</button>
              <button type="button" className="review-submit-btn" onClick={generateExportWithSettings}>Generate Export HTML</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;