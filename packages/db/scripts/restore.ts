// Database restore script

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
// Note: @aws-sdk/client-s3 needs to be installed
// import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';

interface RestoreOptions {
  backupPath?: string;
  s3Bucket?: string;
  s3Key?: string;
  targetDatabase?: string;
  createDatabase?: boolean;
}

export async function restoreBackup(options: RestoreOptions = {}): Promise<{
  success: boolean;
  error?: string;
}> {
  const {
    backupPath,
    s3Bucket = process.env.AWS_S3_BUCKET || 'dashboarduz-backups',
    s3Key,
    targetDatabase,
    createDatabase = false,
  } = options;

  try {
    let localBackupPath = backupPath;

    // Download from S3 if s3Key is provided
    if (s3Key && !backupPath) {
      try {
        const { S3Client, GetObjectCommand } = await import('@aws-sdk/client-s3');
        console.log(`[Restore] Downloading backup from S3: s3://${s3Bucket}/${s3Key}`);
        
        const s3Client = new S3Client({
          region: process.env.AWS_REGION || 'us-east-1',
        });

        const response = await s3Client.send(
          new GetObjectCommand({
            Bucket: s3Bucket,
            Key: s3Key,
          })
        );

      const tempDir = './temp-restore';
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }

      localBackupPath = path.join(tempDir, path.basename(s3Key));
      
        const chunks: Uint8Array[] = [];
        for await (const chunk of response.Body as any) {
          chunks.push(chunk);
        }
        
        fs.writeFileSync(localBackupPath, Buffer.concat(chunks));
        console.log(`[Restore] Backup downloaded: ${localBackupPath}`);
      } catch (error: any) {
        console.error('[Restore] S3 download failed:', error);
        throw new Error(`S3 download failed: ${error.message}. Install @aws-sdk/client-s3 package.`);
      }
    }

    if (!localBackupPath || !fs.existsSync(localBackupPath)) {
      throw new Error('Backup file not found');
    }

    // Decompress if needed
    let finalBackupPath = localBackupPath;
    if (localBackupPath.endsWith('.gz')) {
      console.log('[Restore] Decompressing backup...');
      const decompressedPath = localBackupPath.replace('.gz', '');
      execSync(`gunzip -c ${localBackupPath} > ${decompressedPath}`);
      finalBackupPath = decompressedPath;
    }

    console.log(`[Restore] Restoring from: ${finalBackupPath}`);

    // Parse database URL
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error('DATABASE_URL environment variable is required');
    }

    const url = new URL(databaseUrl);
    const dbHost = url.hostname;
    const dbPort = url.port || '5432';
    const dbUser = url.username;
    const dbPassword = url.password;
    const dbName = targetDatabase || url.pathname.slice(1);

    // Set PGPASSWORD
    const env = {
      ...process.env,
      PGPASSWORD: dbPassword,
    };

    // Create database if requested
    if (createDatabase) {
      console.log(`[Restore] Creating database: ${dbName}`);
      execSync(
        `psql -h ${dbHost} -p ${dbPort} -U ${dbUser} -d postgres -c "CREATE DATABASE ${dbName}"`,
        { env, stdio: 'inherit' }
      );
    }

    // Restore backup
    console.log('[Restore] Restoring database...');
    
    if (finalBackupPath.endsWith('.sql')) {
      // SQL dump
      execSync(
        `psql -h ${dbHost} -p ${dbPort} -U ${dbUser} -d ${dbName} < ${finalBackupPath}`,
        { env, stdio: 'inherit' }
      );
    } else {
      // Custom format dump
      execSync(
        `pg_restore -h ${dbHost} -p ${dbPort} -U ${dbUser} -d ${dbName} -c ${finalBackupPath}`,
        { env, stdio: 'inherit' }
      );
    }

    console.log('[Restore] Database restored successfully');

    // Cleanup temp files
    if (s3Key && localBackupPath.startsWith('./temp-restore')) {
      fs.rmSync('./temp-restore', { recursive: true, force: true });
    }

    return {
      success: true,
    };
  } catch (error: any) {
    console.error('[Restore] Error restoring backup:', error);
    return {
      success: false,
      error: error.message,
    };
  }
}

export async function listBackups(s3Bucket?: string): Promise<Array<{
  key: string;
  lastModified: Date;
  size: number;
}>> {
    try {
    const bucket = s3Bucket || process.env.AWS_S3_BUCKET || 'dashboarduz-backups';
    
    const { S3Client, ListObjectsV2Command } = await import('@aws-sdk/client-s3');
    
    const s3Client = new S3Client({
      region: process.env.AWS_REGION || 'us-east-1',
    });
    const response = await s3Client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: 'backups/',
      })
    );

    return (response.Contents || []).map(item => ({
      key: item.Key || '',
      lastModified: item.LastModified || new Date(),
      size: item.Size || 0,
    }));
  } catch (error: any) {
    console.error('[Restore] Error listing backups:', error);
    return [];
  }
}

// CLI interface
if (require.main === module) {
  const command = process.argv[2];

  switch (command) {
    case 'restore':
      const backupPath = process.argv[3];
      const s3Key = process.argv.includes('--s3') ? process.argv[process.argv.indexOf('--s3') + 1] : undefined;
      
      restoreBackup({ backupPath, s3Key })
        .then(result => {
          if (result.success) {
            console.log('✅ Database restored successfully');
            process.exit(0);
          } else {
            console.error('❌ Restore failed:', result.error);
            process.exit(1);
          }
        })
        .catch(error => {
          console.error('❌ Restore error:', error);
          process.exit(1);
        });
      break;

    case 'list':
      listBackups()
        .then(backups => {
          console.log('Available backups:');
          backups.forEach(backup => {
            console.log(`  ${backup.key} (${new Date(backup.lastModified).toLocaleString()})`);
          });
          process.exit(0);
        })
        .catch(error => {
          console.error('❌ Error listing backups:', error);
          process.exit(1);
        });
      break;

    default:
      console.log('Usage:');
      console.log('  restore <backup-path>     - Restore from local backup');
      console.log('  restore --s3 <s3-key>    - Restore from S3 backup');
      console.log('  list                     - List available backups in S3');
      process.exit(1);
  }
}
