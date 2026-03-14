import { execSync } from 'child_process';
import path from 'path';

function main() {
  console.log('[RLS] Applying canonical migrations (includes RLS policies)...');
  execSync('npx prisma migrate deploy --schema=prisma/schema.prisma', {
    stdio: 'inherit',
    cwd: path.resolve(__dirname, '..'),
    env: process.env,
  });
  console.log('[RLS] Done.');
}

main();
