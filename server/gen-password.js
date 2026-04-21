import bcrypt from 'bcrypt';

const password = process.argv[2] || 'AdminPassword123!';
const hash = await bcrypt.hash(password, 12);

console.log(`Password: ${password}`);
console.log(`Hash: ${hash}`);
