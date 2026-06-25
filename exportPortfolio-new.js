// This is the exportPortfolio function replacement
// Replace the entire exportPortfolio function in App.js with this code

const exportPortfolio = () => {
  const cleanName = name.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/\s+/g, ' ').trim();

  // Build projects HTML with better styling
  const projectsHTML = projects.filter(p => p.title.trim()).map((p, idx) => `
    <div class="project-card">
      <div class="project-number">${idx + 1}</div>
      <div class="project-content">
        <div class="project-title">${p.title}</div>
        ${p.desc ? `<div class="project-desc">${p.desc}</div>` : ''}
      </div>
    </div>
  `).join('');

  // Build skills HTML in grid layout like sample image
  const skillsHTML = skills && skills.length ? (() => {
    const skillsByCategory = {
      'LANGUAGES': [],
      'WEB & BACKEND': [],
      'AI / ML': [],
      'CLOUD & TOOLS': []
    };
    
    skills.forEach(skill => {
      const lower = skill.toLowerCase();
      if (/python|javascript|java|c\+\+|sql|html|css|typescript|ruby|php|go|rust/i.test(lower)) {
        skillsByCategory['LANGUAGES'].push(skill);
      } else if (/react|node|express|vue|angular|mongodb|postgresql|mysql|firebase|restapi|graphql/i.test(lower)) {
        skillsByCategory['WEB & BACKEND'].push(skill);
      } else if (/tensorflow|pytorch|scikit|keras|nlp|ml|ai|torch|pandas|numpy|opencv/i.test(lower)) {
        skillsByCategory['AI / ML'].push(skill);
      } else {
        skillsByCategory['CLOUD & TOOLS'].push(skill);
      }
    });
    
    let html = '<div class="section" id="projects-section"><h2 class="section-title">Technical Skills</h2><div class="skills-grid">';\n    
    Object.entries(skillsByCategory).forEach(([category, categorySkills]) => {
      if (categorySkills.length > 0) {
        html += `
          <div class="skill-category">
            <div class="skill-category-title">● ${category}</div>
            <div class="skill-items">
              ${categorySkills.map(s => `<span class="skill-tag">${s}</span>`).join('')}
            </div>
          </div>
        `;
      }
    });
    
    html += '</div></div>';
    return html;
  })() : '';
  
  // Build contact HTML at the end
  const contactHTML = (Object.values(contact).some(v => v && v.length > 0)) ? (`
    <div class="section" id="contact-section">
      <h2 class="section-title">Contact</h2>
      <div class="contact-grid">
        ${contact.email ? `<div class="contact-item"><div class="contact-icon">✉</div><div class="contact-label">EMAIL</div><div class="contact-value">${contact.email}</div></div>` : ''}
        ${contact.whatsapp || contact.phone ? `<div class="contact-item"><div class="contact-icon">📱</div><div class="contact-label">PHONE</div><div class="contact-value">${contact.whatsapp || contact.phone}</div></div>` : ''}
        ${contact.github ? `<div class="contact-item"><div class="contact-icon">git</div><div class="contact-label">GITHUB</div><div class="contact-value">${contact.github.split('/').pop() || contact.github}</div></div>` : ''}
        ${contact.linkedin ? `<div class="contact-item"><div class="contact-icon">in</div><div class="contact-label">LINKEDIN</div><div class="contact-value">${contact.linkedin.split('/').pop() || contact.linkedin}</div></div>` : ''}
        ${contact.address ? `<div class="contact-item" style="grid-column: 1 / -1;"><div class="contact-icon">📍</div><div class="contact-label">LOCATION</div><div class="contact-value">${contact.address}</div></div>` : ''}
      </div>
    </div>
  `) : '';
  
  // Build TOC with section navigation
  const sections = [];
  if (portfolio) sections.push({label: 'Work', id: 'work-section'});
  if (projectsHTML) sections.push({label: 'Projects', id: 'projects-section'});
  if (skillsHTML) sections.push({label: 'Skills', id: 'skills-section'});
  if (contactHTML) sections.push({label: 'Contact', id: 'contact-section'});
  
  const tocHTML = sections.length > 0 ? `
    <nav class="toc">
      ${sections.map(s => `<a href="#${s.id}" class="toc-link">${s.label}</a>`).join('')}
    </nav>
  ` : '';

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${cleanName} — Creative Portfolio</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;700&display=swap');
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { 
      font-family: 'Times New Roman', Times, serif;
      background: #0a0a0f; 
      color: #ccc; 
      min-height: 100vh; 
      line-height: 1.6;
    }
    
    .hero {
      background: linear-gradient(135deg, #1a0a2e 0%, #0f0f1a 52%, #1a0a1f 100%);
      padding: 0;
      display: grid;
      grid-template-columns: minmax(300px, 1.45fr) minmax(280px, 1.1fr);
      gap: 4px;
      align-items: center;
      border-bottom: 1px solid #2a1a4e;
      min-height: 260px;
      overflow: hidden;
    }
    
    .hero-text {
      padding: 38px 28px;
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      text-align: center;
    }
    
    .hero-text h1 {
      font-family: 'Playfair Display', serif;
      font-size: 4.5rem;
      background: linear-gradient(135deg, #a855f7, #ec4899);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      margin-bottom: 10px;
      word-break: break-word;
      max-width: 90%;
    }
    
    .hero-text .medium {
      color: #a855f7;
      font-size: 1rem;
      letter-spacing: 5px;
      text-transform: uppercase;
      margin-bottom: 10px;
    }
    
    .hero-text .tagline { color: #888; font-size: 0.95rem; }
    
    .hero-img-wrap {
      width: 100%;
      height: 100%;
      overflow: hidden;
      display: flex;
      align-items: center;
      justify-content: flex-start;
      padding: 50px 12px 50px 8px;
    }
    
    .hero-img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
      border-radius: 24px;
      min-height: 100%;
      max-height: 100%;
      transform: none;
      margin-left: 0;
      max-width: 360px;
    }
    
    .toc {
      max-width: 800px;
      margin: 0 auto;
      padding: 40px;
      display: flex;
      gap: 30px;
      justify-content: center;
      border-bottom: 1px solid #1a1a2e;
      flex-wrap: wrap;
    }
    
    .toc-link {
      color: #a855f7;
      text-decoration: none;
      font-size: 0.95rem;
      letter-spacing: 2px;
      text-transform: uppercase;
      cursor: pointer;
      transition: color 0.3s;
    }
    
    .toc-link:hover {
      color: #ec4899;
    }
    
    .content { 
      max-width: 800px; 
      margin: 0 auto; 
      padding: 60px 40px; 
    }
    
    .section { 
      margin-bottom: 50px; 
      padding-bottom: 50px; 
      border-bottom: 1px solid #1a1a2e; 
      scroll-margin-top: 100px;
    }
    
    .section:last-child { border-bottom: none; }
    
    .section-title { 
      font-family: 'Playfair Display', serif;
      font-size: 2.2rem; 
      color: #a855f7; 
      margin-bottom: 30px;
      letter-spacing: 1px;
      text-transform: uppercase;
    }
    
    .section p { 
      color: #ccc; 
      line-height: 1.9; 
      font-size: 1.1rem; 
      margin-bottom: 18px; 
      font-weight: 300;
    }
    
    .projects { 
      display: grid; 
      gap: 24px; 
    }
    
    .project-card { 
      background: #1a1a2e; 
      border: 1px solid #2a1a4e; 
      border-radius: 0;
      padding: 28px;
      display: grid;
      grid-template-columns: 40px 1fr;
      gap: 20px;
      transition: border-color 0.3s;
    }
    
    .project-card:hover {
      border-color: #a855f7;
    }
    
    .project-number {
      font-family: 'Playfair Display', serif;
      font-size: 1.8rem;
      color: #a855f7;
      font-weight: 700;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    
    .project-content {
      display: flex;
      flex-direction: column;
      justify-content: center;
    }
    
    .project-title { 
      color: #fff;
      font-size: 1.3rem; 
      margin-bottom: 10px;
      font-weight: 600;
      letter-spacing: 0.5px;
    }
    
    .project-desc { 
      color: #aaa; 
      font-size: 1rem; 
      line-height: 1.6;
    }
    
    .skills-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 28px;
    }
    
    .skill-category {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    
    .skill-category-title {
      color: #a855f7;
      font-size: 0.9rem;
      letter-spacing: 2px;
      text-transform: uppercase;
      font-weight: 600;
    }
    
    .skill-items {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    
    .skill-tag {
      display: inline-block;
      background: #1a1a2e;
      border: 1px solid #2a1a4e;
      color: #ccc;
      padding: 6px 12px;
      border-radius: 4px;
      font-size: 0.9rem;
      cursor: default;
      transition: all 0.3s;
    }
    
    .skill-tag:hover {
      border-color: #a855f7;
      color: #a855f7;
    }
    
    .contact-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 28px;
    }
    
    .contact-item {
      background: #1a1a2e;
      border: 1px solid #2a1a4e;
      padding: 24px;
      border-radius: 0;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    
    .contact-icon {
      color: #a855f7;
      font-size: 1.2rem;
      font-weight: 600;
    }
    
    .contact-label {
      color: #a855f7;
      font-size: 0.8rem;
      letter-spacing: 2px;
      text-transform: uppercase;
      font-weight: 600;
    }
    
    .contact-value {
      color: #ccc;
      font-size: 1rem;
    }
    
    .contact-value a {
      color: #a855f7;
      text-decoration: none;
      transition: color 0.3s;
    }
    
    .contact-value a:hover {
      color: #ec4899;
    }
    
    .footer { 
      text-align: center; 
      padding: 40px; 
      border-top: 1px solid #2a1a4e; 
      background: #0f0f1a; 
    }
    
    .footer p { 
      color: #aaa; 
      font-size: 0.9rem; 
      margin-bottom: 8px; 
    }
    
    .badge { 
      display: inline-block; 
      background: linear-gradient(135deg, #a855f7, #ec4899); 
      border-radius: 0;
      padding: 8px 16px; 
      font-size: 0.8rem; 
      color: white; 
      font-weight: 500; 
    }
  </style>
</head>
<body>
  <div class="hero">
    <div class="hero-text">
      <h1>${cleanName}</h1>
      <div class="medium">${medium}</div>
      <div class="tagline">Creative Portfolio</div>
    </div>
    ${imagePreview ? `<div class="hero-img-wrap"><img src="${imagePreview}" class="hero-img" alt="Artwork" /></div>` : '<div style="background:#1a1a2e"></div>'}
  </div>
  
  ${tocHTML}
  
  <div class="content">
    <div id="work-section">
      ${portfolio.split('\n\n').map(block => {
        if (!block.trim()) return '';
        if (block.startsWith('## Artist Bio')) {
          const text = block.replace('## Artist Bio', '').trim();
          return `<div class="section"><h2 class="section-title">About</h2><p>${text}</p></div>`;
        }
        if (block.startsWith('## Artist Statement')) {
          const text = block.replace('## Artist Statement', '').trim();
          return `<div class="section"><h2 class="section-title">Statement</h2>${text.split('\n').map(p => `<p>${p}</p>`).join('')}</div>`;
        }
        return '';
      }).join('')}
    </div>
    
    ${projectsHTML ? `<div class="section" id="projects-section"><h2 class="section-title">Projects</h2><div class="projects">${projectsHTML}</div></div>` : ''}
    
    ${skillsHTML}
    
    ${contactHTML}
  </div>
  
  <div class="footer">
    <p>Created with MuseForge AI Portfolio Builder</p>
    <span class="badge">Powered by IBM Bob × AI</span>
  </div>
  
  <script>
    document.querySelectorAll('.toc-link').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const target = document.querySelector(link.getAttribute('href'));
        if (target) {
          target.scrollIntoView({ behavior: 'smooth' });
        }
      });
    });
  </script>
</body>
</html>`;

  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${cleanName}-portfolio.html`;
  a.click();
};
