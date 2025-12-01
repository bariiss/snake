const fs = require('fs');
const path = require('path');

const apiUrl = process.env.API_URL || 'http://backend:8080';

const templatePath = path.join(__dirname, 'src/environments/environment.prod.template.ts');
const outputPath = path.join(__dirname, 'src/environments/environment.prod.ts');

let template = fs.readFileSync(templatePath, 'utf8');
template = template.replace('{{API_URL}}', apiUrl);

fs.writeFileSync(outputPath, template, 'utf8');
console.log('Environment file generated:', outputPath);
console.log('API_URL:', apiUrl);

