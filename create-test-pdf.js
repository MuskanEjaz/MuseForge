const fs = require('fs');
const PDFDocument = require('pdfkit');

// Create a simple test PDF with contact info
const doc = new PDFDocument();
const stream = fs.createWriteStream('c:\\Projects\\museforge\\test-cv.pdf');

doc.pipe(stream);

doc.fontSize(24).text('ALICE JOHNSON', 100, 100);
doc.fontSize(12).text('Creative Designer & Photographer\n');

doc.fontSize(11).text('Email: alice.johnson@gmail.com');
doc.text('Phone: +1-555-123-4567');
doc.text('LinkedIn: https://linkedin.com/in/alice-johnson');
doc.text('GitHub: https://github.com/alicejohnson');
doc.text('Address: San Francisco, CA\n');

doc.fontSize(13).text('PROFESSIONAL SUMMARY', { underline: true });
doc.fontSize(11).text('Innovative creative designer with 5+ years of experience in photography, graphic design, and digital media. Passionate about creating visually compelling content.\n');

doc.fontSize(13).text('TECHNICAL SKILLS', { underline: true });
doc.fontSize(11).text('Photography, Adobe Photoshop, Adobe Lightroom, Graphic Design, UI/UX Design, Web Design, Digital Illustration, Video Editing, Figma\n');

doc.fontSize(13).text('EXPERIENCE', { underline: true });
doc.fontSize(11).text('Senior Designer at Creative Studio (2021 - Present)');
doc.text('Led design initiatives for 20+ major clients.\n');
doc.text('Freelance Photographer & Designer (2019 - 2021)');
doc.text('Provided services to 50+ clients.\n');

doc.fontSize(13).text('PROJECTS', { underline: true });
doc.fontSize(11).text('1. Corporate Website Redesign - Redesigned website for Fortune 500 company');
doc.text('2. Photography Portfolio - Curated and designed personal portfolio');
doc.text('3. Brand Identity Project - Created complete brand identity');
doc.text('4. Mobile App UI - Designed user interface for mobile app');
doc.text('5. Digital Campaign - Created integrated marketing campaign\n');

doc.fontSize(13).text('EDUCATION', { underline: true });
doc.fontSize(11).text('Bachelor of Fine Arts in Graphic Design, University of California, 2018');

doc.end();

stream.on('finish', () => {
  console.log('Test PDF created: c:\\Projects\\museforge\\test-cv.pdf');
});
