const fs = require('fs');

const html = fs.readFileSync('src/desktop/renderer/index.html', 'utf8');
const renderer = fs.readFileSync('src/desktop/renderer/renderer.ts', 'utf8');

// Match all button tags
const btnRegex = /<button\b([^>]*)>(.*?)<\/button>/gis;
let match;
const buttons = [];

while ((match = btnRegex.exec(html)) !== null) {
  const attrs = match[1];
  const innerText = match[2].replace(/<[^>]+>/g, '').trim();
  const idMatch = attrs.match(/\bid=["']([^"']+)["']/i);
  const classMatch = attrs.match(/\bclass=["']([^"']+)["']/i);
  const onclickMatch = attrs.match(/\bonclick=["']([^"']+)["']/i);

  buttons.push({
    id: idMatch ? idMatch[1] : null,
    classes: classMatch ? classMatch[1] : '',
    onclick: onclickMatch ? onclickMatch[1] : null,
    text: innerText.slice(0, 40),
    attrs: attrs.trim()
  });
}

console.log('Total buttons found in index.html:', buttons.length);
const withoutId = buttons.filter(b => !b.id);
console.log('Buttons without ID:', withoutId.length);

// Analyze buttons without ID: do they have classes or onclick?
const unhandledNoId = withoutId.filter(b => {
  // check if any of its classes are referenced in renderer.ts
  const classes = b.classes.split(/\s+/).filter(Boolean);
  const classHandled = classes.some(c => renderer.includes(c));
  const onclickHandled = Boolean(b.onclick);
  return !classHandled && !onclickHandled;
});

console.log('Buttons without ID that have NO matching class or onclick in renderer.ts:', unhandledNoId.length);
if (unhandledNoId.length > 0) {
  console.log(JSON.stringify(unhandledNoId.map(b => ({ text: b.text, classes: b.classes })), null, 2));
}
