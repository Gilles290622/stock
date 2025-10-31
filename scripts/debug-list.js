const fs = require('fs');
const path = require('path');
const base = path.join(__dirname, '..', 'backend', 'scripts');
console.log('base =', base);
console.log('exists? =', fs.existsSync(base));
try {
  const list = fs.readdirSync(base);
  console.log('count =', list.length);
  console.log(list.slice(0, 50));
} catch (e) {
  console.log('error:', e.message);
}
