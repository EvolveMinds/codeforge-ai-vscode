const fs = require('fs');
const html = fs.readFileSync('src/desktop/renderer/index.html', 'utf8');
const ts = fs.readFileSync('src/desktop/renderer/renderer.ts', 'utf8');

const btnRegex = /<button[^>]*\bid=["']([^"']+)["'][^>]*>/gi;
let match;
const buttons = [];
while ((match = btnRegex.exec(html)) !== null) {
  buttons.push(match[1]);
}

const missing = [];
for (const id of buttons) {
  if (!ts.includes(id)) {
    missing.push(id);
  }
}
console.log('Total buttons with ID in HTML:', buttons.length);
console.log('Buttons not referenced in renderer.ts:', missing.length);
console.log(JSON.stringify(missing, null, 2));
