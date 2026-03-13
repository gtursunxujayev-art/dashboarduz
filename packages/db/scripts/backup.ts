// Database backup script

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
// Note: @aws-sdk/client-s3 needs to be installed
// import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

interface BackupOptions {
  outputDir?: string;
  uploadToS3?: boolean;
  s3Bucket?: string;
  s3Key?: string;
  compress?: boolean;
}

export async function createBackup(options: BackupOptions = {}): Promise<{
  success: boolean;
  backupPath?: string;
  s3Location?: string;
  error?: string;
}> {
  const {
    outputDir = './backups',
    uploadToS3 = false,
    s3Bucket = process.env.AWS_S3_BUCKET || 'dashboarduz-backups',
    s3Key,
    compress = true,
  } = options;

  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const dbName = process.env.DB_NAME || 'dashboarduz';
    const backupFileName = `${dbName}-${timestamp}.sql`;
    const backupPath = path.join(outputDir, backupFileName);
    const compressedPath = compress ? `${backupPath}.gz` : backupPath;

    // Ensure output directory exists
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    console.log(`[Backup] Creating backup: ${backupFileName}`);

    // Create database backup using pg_dump
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error('DATABASE_URL environment variable is required');
    }

    // Parse database URL
    const url = new URL(databaseUrl);
    const dbHost = url.hostname;
    const dbPort = url.port || '5432';
    const dbUser = url.username;
    const dbPassword = url.password;
    const dbNameFromUrl = url.pathname.slice(1);

    // Set PGPASSWORD environment variable for pg_dump
    const env = {
      ...process.env,
      PGPASSWORD: dbPassword,
    };

    // Run pg_dump
    const dumpCommand = `pg_dump -h ${dbHost} -p ${dbPort} -U ${dbUser} -d ${dbNameFromUrl} -F c -f ${backupPath}`;
    
    execSync(dumpCommand, {
      env,
      stdio: 'inherit',
    });

    console.log(`[Backup] Backup created: ${backupPath}`);

    // Compress if requested
    if (compress) {
      execSync(`gzip ${backupPath}`);
      console.log(`[Backup] Backup compressed: ${compressedPath}`);
    }

    // Upload to S3 if requested
    let s3Location: string | undefined;
    if (uploadToS3) {
      try {
        const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
        const s3Client = new S3Client({
          region: process.env.AWS_REGION || 'us-east-1',
        });

        const finalS3Key = s3Key || `backups/${path.basename(compressedPath)}`;
        
        const fileContent = fs.readFileSync(compressedPath);
        
        await s3Client.send(
          new PutObjectCommand({
            Bucket: s3Bucket,
            Key: finalS3Key,
            Body: fileContent,
            ServerSideEncryption: 'AES256',
          })
        );

        s3Location = `s3://${s3Bucket}/${finalS3Key}`;
        console.log(`[Backup] Backup uploaded to S3: ${s3Location}`);
      } catch (error: any) {
        console.error('[Backup] S3 upload failed:', error);
        throw new Error(`S3 upload failed: ${error.message}. Install @aws-sdk/client-s3 package.`);
      }
    }

    // Clean up old backups (keep last 7 days)
    cleanupOldBackups(outputDir, 7);

    return {
      success: true,
      backupPath: compressedPath,
      s3Location,
    };
  } catch (error: any) {
    console.error('[Backup] Error creating backup:', error);
    return {
      success: false,
      error: error.message,
    };
  }
}

function cleanupOldBackups(backupDir: string, keepDays: number): void {
  try {
    const files = fs.readdirSync(backupDir);
    const cutoffDate = Date.now() - keepDays * 24 * 60 * 60 * 1000;

    files.forEach(file => {
      const filePath = path.join(backupDir, file);
      const stats = fs.statSync(filePath);
      
      if (stats.mtimeMs < cutoffDate) {
        fs.unlinkSync(filePath);
        console.log(`[Backup] Deleted old backup: ${file}`);
      }
    });
  } catch (error: any) {
    console.warn('[Backup] Error cleaning up old backups:', error.message);
  }
}

export async function scheduleBackup(cronSchedule: string = '0 2 * * *'): Promise<void> {
  // In production, this would set up a cron job or use AWS EventBridge
  console.log(`[Backup] Backup scheduled: ${cronSchedule}`);
  console.log('[Backup] In production, use AWS EventBridge or cron to schedule backups');
}

// CLI interface
if (require.main === module) {
  const command = process.argv[2];

  switch (command) {
    case 'create':
      const uploadToS3 = process.argv.includes('--s3');
      createBackup({ uploadToS3 })
        .then(result => {
          if (result.success) {
            console.log('✅ Backup created successfully');
            if (result.s3Location) {
              console.log(`   S3 Location: ${result.s3Location}`);
            }
            process.exit(0);
          } else {
            console.error('❌ Backup failed:', result.error);
            process.exit(1);
          }
        })
        .catch(error => {
          console.error('❌ Backup error:', error);
          process.exit(1);
        });
      break;

    default:
      console.log('Usage:');
      console.log('  create [--s3]  - Create a backup (optionally upload to S3)');
      process.exit(1);
  }
}
