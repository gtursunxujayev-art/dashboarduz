// Database migration script with rollback capability

import { PrismaClient } from '@prisma/client';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

interface MigrationResult {
  success: boolean;
  migrationName?: string;
  error?: string;
  rollbackAvailable?: boolean;
}

export async function runMigrations(environment: string = 'production'): Promise<MigrationResult> {
  try {
    console.log(`[Migration] Starting migrations for ${environment}...`);
    
    // Check database connection
    await prisma.$connect();
    console.log('[Migration] Database connection established');

    // Get pending migrations
    const migrationsPath = path.join(__dirname, '../prisma/migrations');
    const migrations = fs.readdirSync(migrationsPath)
      .filter(dir => fs.statSync(path.join(migrationsPath, dir)).isDirectory())
      .sort();

    console.log(`[Migration] Found ${migrations.length} migrations`);

    // Run migrations
    try {
      execSync('pnpm prisma migrate deploy', {
        stdio: 'inherit',
        cwd: path.join(__dirname, '../../..'),
        env: {
          ...process.env,
          DATABASE_URL: process.env.DATABASE_URL,
        },
      });

      console.log('[Migration] Migrations applied successfully');
      
      return {
        success: true,
        migrationName: migrations[migrations.length - 1],
        rollbackAvailable: true,
      };
    } catch (error: any) {
      console.error('[Migration] Migration failed:', error.message);
      return {
        success: false,
        error: error.message,
        rollbackAvailable: true,
      };
    }
  } catch (error: any) {
    console.error('[Migration] Error:', error);
    return {
      success: false,
      error: error.message,
    };
  } finally {
    await prisma.$disconnect();
  }
}

export async function rollbackMigration(migrationName?: string): Promise<MigrationResult> {
  try {
    console.log(`[Migration] Rolling back ${migrationName || 'last migration'}...`);
    
    // In production, we should be more careful about rollbacks
    // For now, this is a placeholder that would need proper implementation
    console.warn('[Migration] Rollback functionality requires manual intervention');
    
    return {
      success: false,
      error: 'Automatic rollback not implemented. Use manual database restore.',
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message,
    };
  }
}

export async function checkMigrationStatus(): Promise<{
  applied: string[];
  pending: string[];
  lastApplied?: string;
}> {
  try {
    await prisma.$connect();
    
    // Get applied migrations from database
    const appliedMigrations = await prisma.$queryRaw<Array<{ migration_name: string }>>`
      SELECT migration_name FROM _prisma_migrations ORDER BY finished_at DESC
    `;

    // Get all migrations from filesystem
    const migrationsPath = path.join(__dirname, '../prisma/migrations');
    const allMigrations = fs.readdirSync(migrationsPath)
      .filter(dir => fs.statSync(path.join(migrationsPath, dir)).isDirectory())
      .sort();

    const applied = appliedMigrations.map(m => m.migration_name);
    const pending = allMigrations.filter(m => !applied.includes(m));

    return {
      applied,
      pending,
      lastApplied: applied[applied.length - 1],
    };
  } catch (error: any) {
    console.error('[Migration] Error checking status:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// CLI interface
if (require.main === module) {
  const command = process.argv[2];
  const environment = process.env.NODE_ENV || 'development';

  switch (command) {
    case 'migrate':
      runMigrations(environment)
        .then(result => {
          if (result.success) {
            console.log('✅ Migrations completed successfully');
            process.exit(0);
          } else {
            console.error('❌ Migration failed:', result.error);
            process.exit(1);
          }
        })
        .catch(error => {
          console.error('❌ Migration error:', error);
          process.exit(1);
        });
      break;

    case 'status':
      checkMigrationStatus()
        .then(status => {
          console.log('Applied migrations:', status.applied.length);
          console.log('Pending migrations:', status.pending.length);
          if (status.lastApplied) {
            console.log('Last applied:', status.lastApplied);
          }
          process.exit(0);
        })
        .catch(error => {
          console.error('Error:', error);
          process.exit(1);
        });
      break;

    case 'rollback':
      const migrationName = process.argv[3];
      rollbackMigration(migrationName)
        .then(result => {
          if (result.success) {
            console.log('✅ Rollback completed');
            process.exit(0);
          } else {
            console.error('❌ Rollback failed:', result.error);
            process.exit(1);
          }
        })
        .catch(error => {
          console.error('❌ Rollback error:', error);
          process.exit(1);
        });
      break;

    default:
      console.log('Usage:');
      console.log('  migrate  - Run pending migrations');
      console.log('  status   - Check migration status');
      console.log('  rollback - Rollback last migration');
      process.exit(1);
  }
}
